import {
  canBuild,
  stateHash,
  type BuildingType,
  type Planet,
  type SimState,
} from '@heliopolis/sim';

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
  return buildableNear(s, 'BARRICADE');
}

/**
 * Uogólnienie `freeHexagonNear` na dowolny typ — pentagon dla `GEOTHERMAL_CAP`, złoże dla
 * `EXTRACTOR`. Dopisane w Zadaniu 3 (menu budowy musi zobaczyć KAŻDY rodzaj komórki,
 * nie tylko pusty heksagon).
 *
 * Kontrakt niesie `canBuild`, nie własne sprawdzenie „czy to pentagon i czy pusty" —
 * z tego samego powodu, co wyżej: test, który sam decyduje, co jest budowalne, przestaje
 * mierzyć symulację w chwili, gdy dojdzie ósmy powód odmowy.
 *
 * **Uwaga wołającego:** wynik zależy od RUDY w stanie, bo `canBuild` sprawdza ją na końcu.
 * Wołaj po ustawieniu `s.ore`, inaczej dla droższych typów dostaniesz `RangeError` zamiast
 * komórki. Błąd niesie tę liczbę, żeby nikt nie szukał wady w planecie.
 */
export function buildableNear(s: SimState, type: BuildingType): number {
  const visited = new Uint8Array(s.planet.cells.length);
  const queue: number[] = [s.planet.startCell];
  visited[s.planet.startCell] = 1;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    if (canBuild(s, id, type).ok) return id;
    for (const neighbor of s.planet.cells[id].neighbors) {
      if (visited[neighbor] === 0) {
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  throw new RangeError(
    `buildableNear: brak komórki, na której canBuild(s, id, '${type}') zwraca ok — ` +
      `przeszukano wszystkie ${s.planet.cells.length} komórek (ruda: ${s.ore}).`,
  );
}

/**
 * Pierwsza komórka, na której COŚ stoi — w świeżym runie jest to CORE na `startCell`
 * (`Sim` zasiewa go bezpośrednim zapisem, `loop.ts`).
 *
 * Szukane po stanie, nie przez `planet.startCell`: menu ma pokazywać `CELL_OCCUPIED` dla
 * KAŻDEJ zabudowanej komórki, a nie dla jednej wyróżnionej, i test, który celuje wprost
 * w komórkę startową, nie odróżniłby tych dwóch reguł.
 */
export function builtCell(s: SimState): number {
  const id = s.buildings.findIndex((b) => b !== null);
  if (id < 0) {
    throw new RangeError('builtCell: w stanie nie ma ANI JEDNEGO budynku — nawet CORE.');
  }
  return id;
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
