import type { Planet } from '../world/planet.js';
import { applyCommand, type Command } from './commands.js';
import { updateEconomy } from './economy.js';
import { lightField, sunDirection } from './light.js';
import { updatePower } from './power.js';
import { createState, TICK_SECONDS, type SimState } from './state.js';

export interface SimConfig {
  rotationPeriod: number;
  startingOre: number;
}

/**
 * Pętla o stałym kroku 20 Hz, całkowicie niezależna od czasu ściennego.
 * Kolejne zadania tego planu dopinają swoje systemy do metody step()
 * w miejscu oznaczonym komentarzem — kolejność systemów jest częścią kontraktu
 * determinizmu i nie wolno jej zmieniać bez aktualizacji testów.
 */
export class Sim {
  readonly config: SimConfig;
  private readonly s: SimState;
  private readonly pending: Command[] = [];

  constructor(planet: Planet, config: SimConfig) {
    // `!(x > 0)` NIE łapie Infinity (Infinity > 0 jest prawdziwe) — stąd Number.isFinite.
    // Walidacja tu, a nie w scale.ts, chroni WSZYSTKICH konsumentów rotationPeriod naraz:
    // terminatorSpeedWorld/terminatorSpeedCells/terminatorCrossingTime dzielą przez nie
    // bez żadnej straży i po cichu dają Infinity/0 zamiast rzucić błąd.
    if (!Number.isFinite(config.rotationPeriod) || config.rotationPeriod <= 0) {
      throw new RangeError(`SimConfig.rotationPeriod must be finite and positive, got ${config.rotationPeriod}`);
    }
    // Druga warstwa tej samej straży, na poziomie DOMENY zamiast arytmetyki: finite i
    // dodatni nie wystarczy, jeśli okres jest krótszy niż jeden tick — Słońce robiłoby
    // wtedy pełny obrót WEWNĄTRZ pojedynczego kroku symulacji, co nie jest cyklem
    // dzień/noc w żadnym sensownym znaczeniu (a przy skrajnych wartościach, np. 1e-320,
    // to właśnie ten zakres, w którym `angle` w `sunDirection` przepełnia się do
    // Infinity — patrz light.ts). Granica inclusive: dokładnie jeden tick jest ostatnią
    // wartością, przy której obrót JEST rozłożony na (przynajmniej) jeden krok.
    if (config.rotationPeriod < TICK_SECONDS) {
      throw new RangeError(
        `SimConfig.rotationPeriod must be at least one tick (${TICK_SECONDS}s), got ${config.rotationPeriod} — a shorter period completes a full day/night cycle inside a single tick and is not a simulable cycle`,
      );
    }
    if (!Number.isFinite(config.startingOre) || config.startingOre < 0) {
      throw new RangeError(`SimConfig.startingOre must be finite and non-negative, got ${config.startingOre}`);
    }
    this.config = config;
    this.s = createState(planet, config.startingOre);
  }

  get state(): SimState { return this.s; }

  get elapsedSeconds(): number { return this.s.tick * TICK_SECONDS; }

  enqueue(cmd: Command): void { this.pending.push(cmd); }

  step(): void {
    if (this.s.phase !== 'RUNNING') {
      // Drenuj też tutaj, nie tylko w ścieżce RUNNING poniżej — inaczej kolejka rośnie
      // bez ograniczeń, gdy komendy wciąż napływają po końcu meczu (Faza 5: klient
      // może spamować zakończony mecz; bez tego 1000 wysłanych komend to 1000
      // rezydujących w pamięci, bez końca).
      this.pending.length = 0;
      return;
    }

    // 1. Komendy — zawsze pierwsze, żeby tick widział świat już zmieniony.
    for (const cmd of this.pending) applyCommand(this.s, cmd);
    this.pending.length = 0;

    // 2. Oświetlenie — liczone raz i podawane pozostałym systemom.
    const sun = sunDirection(this.elapsedSeconds, this.config.rotationPeriod);
    const light = lightField(this.s.planet, sun);

    // 3. Energia — musi być przed ekonomią i walką, bo ustawia flagi `powered`.
    updatePower(this.s, light);

    // 4. Ekonomia — po energii, bo wydobycie zależy od flagi `powered`.
    updateEconomy(this.s);

    // TUTAJ dopinane są kolejne systemy, w tej kolejności:
    //   pola przepływu → jednostki → walka → spalanie → fale → warunki końca

    this.s.tick++;
  }
}
