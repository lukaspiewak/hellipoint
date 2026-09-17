import { canBuild, stateHash, type Planet, type SimState } from '@heliopolis/sim';

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

/**
 * Odcisk palca PLANETY — po bitach `radius`, `startCell` oraz `center`/`normal` każdej
 * komórki.
 *
 * Istnieje, bo `global-constraints.md` wymienia `Planet` w ograniczeniu nadrzędnym
 * Z NAZWY („Render NIGDY nie mutuje `SimState` **ani `Planet`**"), a `stateHash`
 * (`packages/sim`) planety nie dotyka w ogóle. Zmierzone w przeglądzie rundy 1:
 * `planet.cells[0].center.x += 1e-9` wstawione do nasłuchu zostawiało 24/24 zielone.
 *
 * Hash po BITACH (`setFloat64` + FNV-1a), nie po reprezentacji dziesiętnej — tym samym
 * idiomem co `stateHash`: różnica na poziomie ULP ma być widoczna, a nie dopiero na
 * drugim miejscu po przecinku.
 */
export function planetFingerprint(planet: Planet): string {
  const view = new DataView(new ArrayBuffer(8));
  let hash = 2166136261 >>> 0;
  const mix = (value: number): void => {
    view.setFloat64(0, value);
    for (let byte = 0; byte < 8; byte++) {
      hash = (hash ^ view.getUint8(byte)) >>> 0;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };
  mix(planet.radius);
  mix(planet.startCell);
  for (const cell of planet.cells) {
    mix(cell.center.x); mix(cell.center.y); mix(cell.center.z);
    mix(cell.normal.x); mix(cell.normal.y); mix(cell.normal.z);
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Jedna liczba opisująca CAŁY świat, którego klientowi nie wolno tknąć: stan symulacji
 * plus planeta.
 *
 * **Znana granica, zapisana tutaj, żeby nikt nie wziął tego za pełną gwarancję:**
 * `stateHash` (`packages/sim/src/sim/hash.ts`) **nie hashuje `Building.cellId`** —
 * hashuje indeks tablicy, a nie pole. Zapis `building.cellId = 0` na budynku wyjętym ze
 * stanu przechodzi więc przez ten strażnik. Dziś nic w kodzie produkcyjnym tego pola nie
 * czyta, ale pierwszy konsument (netcode Fazy 5) dostałby śmieć. Dopisanie pola do
 * `stateHash` unieważnia wszystkie baseline'y determinizmu i jest pytaniem o
 * `packages/sim`, nie o zadanie o wejściu gracza — stąd granica jest tu ZAPISANA,
 * a nie po cichu obchodzona.
 */
export function worldFingerprint(state: SimState): string {
  return `${stateHash(state)}:${planetFingerprint(state.planet)}`;
}
