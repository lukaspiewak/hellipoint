import { canBuild, type SimState } from '@heliopolis/sim';

/**
 * Wspólni pomocnicy testowi `apps/client` — pisani przy PIERWSZYM użyciu, ale od razu tutaj,
 * a nie w pliku testowym (`global-constraints.md`, tabela „Pomocnicy testowi"). Kopia
 * takiego pomocnika w drugim pliku to następna liczba, która przeżyje swoje wejście.
 *
 * Tu, a nie w `packages/sim/test/support/`, bo wszystkie cztery pomocniki z tabeli fazy
 * służą zadaniom KLIENTA: `freeHexagonNear` — Zadanie 2 (to zadanie), `fourFreeHexagonsNear`
 * — Zadanie 4 (menu budowy), `defeatedStateWithDamager` — Zadanie 5 (ekrany końca).
 */

/**
 * Indeks PUSTEGO heksagonu w pobliżu komórki startowej — takiego, na którym
 * `canBuild(s, id, 'BARRICADE').ok === true`.
 *
 * Kontrakt jest zapisany przez `canBuild`, a nie przez własne sprawdzenie „czy to heksagon
 * i czy pusty": test, który sam decyduje, co jest budowalne, przestaje mierzyć symulację
 * w chwili, gdy dojdzie ósmy powód odmowy. Przeszukiwanie wszerz od `startCell`, więc
 * „w pobliżu" jest dosłowne (najbliższy w metryce grafu), a wynik deterministyczny:
 * sąsiedzi komórki są w `Planet` w ustalonej kolejności.
 *
 * @throws {RangeError} gdy cała planeta jest zabudowana albo zabraknie rudy — głośno,
 *   bo test oparty na `-1` szukałby potem defektu tam, gdzie go nie ma.
 */
export function freeHexagonNear(s: SimState): number {
  const visited = new Uint8Array(s.planet.cells.length);
  const queue: number[] = [s.planet.startCell];
  visited[s.planet.startCell] = 1;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (canBuild(s, id, 'BARRICADE').ok) return id;
    for (const neighbor of s.planet.cells[id].neighbors) {
      if (visited[neighbor] === 0) {
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  throw new RangeError(
    `freeHexagonNear: brak komórki, na której canBuild(s, id, 'BARRICADE') zwraca ok — ` +
      `przeszukano wszystkie ${s.planet.cells.length} komórek (ruda: ${s.ore}).`,
  );
}
