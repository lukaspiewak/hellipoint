import type { Planet } from '../world/planet.js';
import { applyCommand, type Command } from './commands.js';
import { lightField, sunDirection } from './light.js';
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
    if (this.s.phase !== 'RUNNING') return;

    // 1. Komendy — zawsze pierwsze, żeby tick widział świat już zmieniony.
    for (const cmd of this.pending) applyCommand(this.s, cmd);
    this.pending.length = 0;

    // 2. Oświetlenie — liczone raz i podawane pozostałym systemom.
    const sun = sunDirection(this.elapsedSeconds, this.config.rotationPeriod);
    const light = lightField(this.s.planet, sun);
    void light; // systemy dopinane w Task 5-13

    // TUTAJ dopinane są kolejne systemy, w tej kolejności:
    //   energia → ekonomia → pola przepływu → jednostki → walka → spalanie → fale → warunki końca

    this.s.tick++;
  }
}
