import { cross, length, sub } from '../math/vec3.js';
import type { DualMesh } from './dual.js';

/**
 * WYNIK NEGATYWNY — NIE IMPLEMENTUJ RELAKSACJI PONOWNIE.
 *
 * Spec pierwotnie zakładał 2-3 iteracje wygładzania laplasjanowego, mające zredukować
 * rozrzut pól komórek z ~20 % do ~5 %. Zmierzone przy frequency 12:
 *
 *   iteracje:      0        1        3       10      200
 *   spacingCv:  0,0716   0,0704   0,0706   0,0718   0,0717
 *   areaCv:     0,1330   0,1327   0,1328   0,1338   0,1335
 *
 * Sfera geodezyjna już leży w punkcie stałym operatora laplasjanowego, więc iterowanie
 * niczego nie poprawia, a powyżej ~3 iteracji dryfuje numerycznie na gorsze.
 * Lloyd na siatce dualnej to algebraicznie `normalize(3v + Σsąsiedzi)`, czyli tłumiona
 * wersja tego samego operatora — jeszcze słabsza.
 *
 * Rozrzut jest akceptowalny: reguły gry idą w krokach grafu (N1), więc rozgrywki nie
 * dotyczy wcale. Gdyby warstwa wizualna uznała inaczej, właściwym narzędziem jest
 * relaksacja sprężynowa wyrównująca DŁUGOŚCI KRAWĘDZI, nie operator centroidowy.
 */

/** Współczynnik zmienności odległości środek–sąsiad. Frequency 12: 0,0716. */
export function spacingCv(dual: DualMesh): number {
  const samples: number[] = [];
  for (let v = 0; v < dual.centers.length; v++) {
    for (const n of dual.neighbors[v]) {
      if (n > v) samples.push(length(sub(dual.centers[n], dual.centers[v])));
    }
  }
  return coefficientOfVariation(samples);
}

/** Współczynnik zmienności pól komórek (suma planarnych trójkątów cięciw od środka). Frequency 12: 0,1330. */
export function areaCv(dual: DualMesh): number {
  const areas: number[] = [];
  for (let v = 0; v < dual.centers.length; v++) {
    const center = dual.centers[v];
    const corners = dual.corners[v];
    let area = 0;
    for (let i = 0; i < corners.length; i++) {
      const p = sub(corners[i], center);
      const q = sub(corners[(i + 1) % corners.length], center);
      area += length(cross(p, q)) / 2;
    }
    areas.push(area);
  }
  return coefficientOfVariation(areas);
}

function coefficientOfVariation(samples: number[]): number {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance) / mean;
}
