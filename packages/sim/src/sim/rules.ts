import { DEFAULT_SPAWN, type SpawnConfig } from './spawning.js';
import { TICK_SECONDS, type SimState } from './state.js';

export interface RunConfig {
  rotationPeriod: number;
  startingOre: number;
  cyclesPerRun: number;
  /** Ułamek runu, po którym Evac staje się dostępny. 0,67 = ostatnia tercja. */
  evacUnlockFraction: number;
  evacEnergyRequired: number;
  evacChargeRate: number;
  evacAlarmSeconds: number;
  spawn: SpawnConfig;
}

// [STROJENIE] — cała tabela do wyznaczenia headlessem w Fazie 3.
export const DEFAULT_RUN: RunConfig = {
  rotationPeriod: 180,
  startingOre: 150,
  cyclesPerRun: 10,       // 10 × 180 s = 30 min, zgodnie z D4
  evacUnlockFraction: 0.67,
  evacEnergyRequired: 1000,
  evacChargeRate: 25,
  evacAlarmSeconds: 60,
  spawn: DEFAULT_SPAWN,
};

/** Cykle numerowane od 1. */
export const currentCycle = (elapsed: number, rotationPeriod: number): number =>
  Math.floor(elapsed / rotationPeriod) + 1;

export const evacUnlocked = (cycle: number, cfg: RunConfig): boolean =>
  cycle >= Math.ceil(cfg.cyclesPerRun * cfg.evacUnlockFraction);

export function updateRules(s: SimState, cfg: RunConfig): void {
  if (s.phase !== 'RUNNING') return;

  // Przegrana: utrata CORE. Jedyny warunek (§5.6).
  if (!s.buildings.some((b) => b?.type === 'CORE')) {
    s.phase = 'DEFEAT';
    return;
  }

  const evac = s.buildings.find((b) => b?.type === 'EVACUATION_MODULE') ?? null;

  if (evac === null) {
    // Zniszczony Evac kosztuje ładunek i alarm, ale NIE kończy runu — da się go odbudować.
    s.evacCharge = 0;
    s.evacAlarmRemaining = -1;
    return;
  }

  if (s.evacAlarmRemaining >= 0) {
    s.evacAlarmRemaining -= TICK_SECONDS;
    if (s.evacAlarmRemaining <= 0) s.phase = 'VICTORY';
    return;
  }

  if (evac.powered && s.evacCharge < cfg.evacEnergyRequired) {
    const draw = Math.min(cfg.evacChargeRate * TICK_SECONDS, s.storedEnergy);
    s.evacCharge += draw;
    s.storedEnergy -= draw;
  }

  if (s.evacCharge >= cfg.evacEnergyRequired) {
    s.evacAlarmRemaining = cfg.evacAlarmSeconds;
  }
}
