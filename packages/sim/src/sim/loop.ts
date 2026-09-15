import { cellSpacing, terminatorSpeedCells } from '../world/scale.js';
import { Rng, STREAM } from '../math/rng.js';
import type { Planet } from '../world/planet.js';
import { updateBurning } from './burning.js';
import { updateCombat } from './combat.js';
import { applyCommand, type Command } from './commands.js';
import { BUILDINGS } from './defs.js';
import { updateEconomy } from './economy.js';
import { buildAllFlowFields } from './flowfield.js';
import { lightField, sunDirection } from './light.js';
import type { MotionContext } from './movement.js';
import { updateMovement } from './movement.js';
import { updatePower } from './power.js';
import { currentCycle, updateRules, type RunConfig } from './rules.js';
import { updateSpawning } from './spawning.js';
import { createState, TICK_SECONDS, type SimState } from './state.js';

/** [STROJENIE] Co ile ticków przeliczane są pola przepływu. 4 ticki = 5 Hz (§4.5). */
const FLOWFIELD_INTERVAL_TICKS = 4;

export class Sim {
  readonly config: RunConfig;
  private readonly s: SimState;
  private readonly pending: Command[] = [];
  private readonly motion: MotionContext;
  private readonly waveRng: Rng;
  private fields = null as ReturnType<typeof buildAllFlowFields> | null;

  constructor(planet: Planet, config: RunConfig) {
    // `!(x > 0)` NIE łapie Infinity (Infinity > 0 jest prawdziwe) — stąd Number.isFinite.
    // Walidacja tu, a nie w scale.ts, chroni WSZYSTKICH konsumentów rotationPeriod naraz:
    // terminatorSpeedWorld/terminatorSpeedCells/terminatorCrossingTime dzielą przez nie
    // bez żadnej straży i po cichu dają Infinity/0 zamiast rzucić błąd.
    if (!Number.isFinite(config.rotationPeriod) || config.rotationPeriod <= 0) {
      throw new RangeError(`RunConfig.rotationPeriod must be finite and positive, got ${config.rotationPeriod}`);
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
        `RunConfig.rotationPeriod must be at least one tick (${TICK_SECONDS}s), got ${config.rotationPeriod} — a shorter period completes a full day/night cycle inside a single tick and is not a simulable cycle`,
      );
    }
    if (!Number.isFinite(config.startingOre) || config.startingOre < 0) {
      throw new RangeError(`RunConfig.startingOre must be finite and non-negative, got ${config.startingOre}`);
    }

    this.config = config;
    this.s = createState(planet, config.startingOre);
    this.waveRng = new Rng(planet.seed).fork(STREAM.WAVES);

    const n = planet.cells.length;
    this.motion = {
      termSpeedCells: terminatorSpeedCells(n, config.rotationPeriod),
      spacing: cellSpacing(planet.radius, n),
      radius: planet.radius,
    };

    // CORE na komórce startowej: punkt wyjścia runu, nie decyzja gracza — więc bez kosztu
    // i WPROST do stanu, nie przez `applyCommand`. `canBuild` odrzuca CORE niezależnie od
    // komórki (`playerBuildable: false`), bo inaczej gracz mnożyłby go za darmo — zmierzone
    // przed wprowadzeniem tej flagi: 50 rdzeni przy zerowej rudzie, bo `CORE.costOre = 0`,
    // a `CELL_OCCUPIED` chroni tylko TĘ SAMĄ komórkę przed drugim CORE, nie planetę przed
    // setnym. Przy warunku przegranej `!buildings.some(b => b?.type === 'CORE')` (§5.6)
    // dawałoby to darmową nieśmiertelność. Ten sam zapis stosują pomocniki testowe Fazy 1B.
    this.s.buildings[planet.startCell] = {
      cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
    };
  }

  get state(): SimState { return this.s; }
  get elapsedSeconds(): number { return this.s.tick * TICK_SECONDS; }
  get cycle(): number { return currentCycle(this.elapsedSeconds, this.config.rotationPeriod); }

  enqueue(cmd: Command): void { this.pending.push(cmd); }

  /**
   * Kolejność systemów jest CZĘŚCIĄ KONTRAKTU DETERMINIZMU.
   * Zmiana kolejności zmienia wynik gry przy tym samym seedzie — nie wolno jej ruszać
   * bez aktualizacji testów determinizmu.
   */
  step(): void {
    if (this.s.phase !== 'RUNNING') {
      // Kolejka opróżniana TAKŻE tutaj, nie tylko w ścieżce RUNNING niżej. Dwa powody,
      // oba realne w Fazie 5, gdzie klient może wysyłać komendy po końcu meczu:
      //  • kolejka nie rośnie bez ograniczeń (zmierzone przed poprawką: 1000 komend
      //    wysłanych, 1000 wciąż rezydujących),
      //  • komenda zakolejkowana po końcu runu nie może przeleżeć do chwili, w której
      //    faza wróciłaby do RUNNING, i wykonać się z opóźnieniem.
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

    // 5. Pola przepływu — przeliczane rzadziej niż co tick, zabudowa zmienia się wolno (§4.5).
    // Lokalna `const`, nie `this.fields` z `!`: zawężenie typu z tego `if` nie przenosi się
    // na pole klasy w kolejnych wywołaniach, a `!` uciszyłoby kompilator zamiast rozwiązać
    // problem.
    if (this.fields === null || this.s.tick % FLOWFIELD_INTERVAL_TICKS === 0) {
      this.fields = buildAllFlowFields(this.s);
    }
    const fields = this.fields;

    // 6–8. Ruch → walka → spalanie.
    updateMovement(this.s, fields, light, sun, this.motion);
    updateCombat(this.s, fields);
    updateBurning(this.s, light);

    // 9. Fale i spawn.
    updateSpawning(this.s, light, this.waveRng, this.cycle, this.config.spawn);

    // 10. Warunki końca — ostatnie, żeby widziały świat po wszystkich zmianach ticka.
    updateRules(this.s, this.config);

    this.s.tick++;
  }
}
