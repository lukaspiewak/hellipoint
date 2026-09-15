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

/**
 * Tolerancja na błąd akumulacji zmiennoprzecinkowej `evacAlarmRemaining -= TICK_SECONDS`.
 * NIE jest to liczba balansowa (stąd brak `[STROJENIE]`) — to ten sam problem i ta sama
 * decyzja, co `EXPOSURE_EPSILON` w burning.ts, tylko odchylenie idzie w drugą stronę:
 * tam `+=` ląduje tuż PONIŻEJ progu, tutaj `-=` zatrzymuje się tuż NAD zerem.
 *
 * Zmierzone: `0,05` nie ma dokładnej reprezentacji binarnej, więc odjęcie go 1200 razy
 * od 60 zostawia **1,2706086183200682e-12** zamiast zera — bez tolerancji odliczanie
 * potrzebuje 1201 ticków, a alarm trwa 60,05 s zamiast 60 s. Reszta nie jest monotoniczna
 * ani zawsze dodatnia (dla 30 s wychodzi −2,92e-13, czyli tam problem nie występuje);
 * przeskanowane co sekundę w zakresie 1–600 s, najgorsza DODATNIA reszta to
 * **5,135961100855013e-12** (dla 128 s).
 *
 * Stąd 1e-9: margines nad zmierzonym najgorszym przypadkiem **~195×**, a jednocześnie
 * 5×10⁷ razy mniej niż jeden tick (0,05 s), więc nie jest w stanie skrócić alarmu
 * o cały krok. Ten sam rząd wielkości, co `EXPOSURE_EPSILON` (1e-9) i `theta < 1e-9`
 * w `slerpToward` (movement.ts) — pakiet ma jedną skalę dla tej klasy błędu.
 */
const ALARM_EPSILON = 1e-9;

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
    if (s.evacAlarmRemaining <= ALARM_EPSILON) s.phase = 'VICTORY';
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
