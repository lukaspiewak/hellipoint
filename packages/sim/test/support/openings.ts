import type { BuildingType } from '../../src/sim/state.js';

/**
 * # Zwycięskie otwarcie — JEDNA definicja (Faza 3, naprawa Z3)
 *
 * Kolejka zabudowy, która na `DEFAULT_RUN` prowadzi run od startu do zwycięstwa. Wyznaczona
 * przemiataniem headlessem w Fazie 2C, **nie wymyślona** — i dlatego nie wolno jej
 * przepisywać „na oko". Gdy strojenie Fazy 3 sprawi, że przestanie wygrywać, właściwą
 * reakcją jest **wyznaczenie nowej przemiataniem**, a nie osłabienie asercji.
 *
 * ## Dlaczego mieszka w `test/support`, a nie przy bocie
 *
 * Bo używają jej DWIE strony: test pełnego runu (`fullrun.test.ts`) i polityka wprawna
 * (`tools/headless/src/skilledPolicy.ts`). Produkcyjny kod narzędzia nie może importować
 * pliku testowego, więc ma własną kopię — a ich zgodności pilnuje test porównawczy
 * w `tools/headless/test/policy.test.ts`.
 *
 * **Poprzednio kopia była CICHA.** Komentarz przy niej twierdził, że „rozjazd wyłapie test
 * 1a"; zmierzone w przeglądzie: zmiana jednej pozycji (17 → 18 barykad w hex4) zostawiała
 * `fullrun` 16/16 zielone i `policy.test.ts` 6/6 zielone, w obie strony. Żaden test nie
 * pilnował zgodności, choć komentarz deklarował ochronę.
 */

/** Pierścienie grafowe wokół CORE, z których kolejka bierze komórki. */
export type Pool = 'hex1' | 'hex2' | 'hex3' | 'hex4';

const times = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value);

export const WINNING_OPENING: ReadonlyArray<readonly [Pool, BuildingType]> = [
  ['hex1', 'LASER_TURRET'], ['hex1', 'LASER_TURRET'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex1', 'BATTERY'], ['hex1', 'BATTERY'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex2', 'BATTERY'], ['hex2', 'BATTERY'], ['hex2', 'BATTERY'],
  ...times(13, ['hex3', 'BARRICADE'] as const),
  ...times(17, ['hex4', 'BARRICADE'] as const),
  ['hex2', 'EVACUATION_MODULE'],
];
