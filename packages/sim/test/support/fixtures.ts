import { canBuild } from '../../src/sim/commands.js';
import type { BuildingType, SimState } from '../../src/sim/state.js';

/**
 * Wspólni pomocnicy testowi — pisani przy PIERWSZYM użyciu, ale od razu we wspólnym miejscu
 * (`global-constraints.md`, tabela „Pomocnicy testowi"). Kopia takiego pomocnika w drugim
 * pliku to następna liczba, która przeżyje swoje wejście.
 *
 * ## Dlaczego TUTAJ, skoro Zadanie 2 założyło je w `apps/client/test/support/`
 *
 * Bo Zadanie 2 przewidziało, że wszystkich czterech pomocników z tabeli fazy będą potrzebować
 * zadania KLIENTA — i dla `freeHexagonNear` to była prawda. `fourFreeHexagonsNear` ma jednak
 * pierwszego konsumenta w `packages/sim/test/power.test.ts` (Zadanie 4, Krok 1), a test
 * symulacji importujący z `apps/client` odwracałby kierunek zależności całego repozytorium.
 *
 * Wyprowadzenie BFS mieszka więc tutaj, a `apps/client/test/support/fixtures.ts`
 * REEKSPORTUJE te trzy funkcje, zamiast trzymać drugą kopię przeszukiwania. Wszystkie
 * dotychczasowe importy klienta (`./support/fixtures.js`) działają bez zmiany.
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
  return buildableNearMany(s, type, 1)[0];
}

/**
 * CZTERY różne puste heksagony w pobliżu komórki startowej (Zadanie 4, Krok 1) — dokładnie
 * scenariusz Q3 z Fazy 1C: cztery lasery po 12/s przy produkcji CORE 10/s.
 *
 * „W pobliżu" nie jest tu wygodą, tylko WARUNKIEM POMIARU: budynek niepodłączony do sieci
 * nie liczy się do popytu w ogóle (`updatePower` wychodzi na `!connected[i]`), więc cztery
 * lasery postawione gdziekolwiek dałyby `rawDemand === 0` i test mierzyłby własną fikstirę
 * zamiast kaskady. BFS rusza od `startCell`, na której stoi CORE o `connectionRadius: 3`,
 * więc pierwsze znalezione komórki leżą w jego zasięgu.
 *
 * @throws {RangeError} gdy nie ma czterech takich komórek.
 */
export function fourFreeHexagonsNear(s: SimState): number[] {
  return buildableNearMany(s, 'BARRICADE', 4);
}

/**
 * Wspólne jądro obu funkcji wyżej: `count` najbliższych komórek, na których `canBuild`
 * przepuszcza `type`. Jedno przeszukiwanie, nie dwa — `fourFreeHexagonsNear` wołające
 * `freeHexagonNear` cztery razy zwróciłoby CZTERY RAZY TĘ SAMĄ komórkę (nic w stanie się
 * między wywołaniami nie zmienia), co jest dokładnie tym rodzajem fikstury, która wygląda
 * na spełnioną i mierzy jedną czwartą tego, co obiecuje.
 */
function buildableNearMany(s: SimState, type: BuildingType, count: number): number[] {
  const visited = new Uint8Array(s.planet.cells.length);
  const queue: number[] = [s.planet.startCell];
  const found: number[] = [];
  visited[s.planet.startCell] = 1;
  for (let head = 0; head < queue.length && found.length < count; head++) {
    const id = queue[head];
    if (canBuild(s, id, type).ok) found.push(id);
    for (const neighbor of s.planet.cells[id].neighbors) {
      if (visited[neighbor] === 0) {
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  if (found.length < count) {
    throw new RangeError(
      `buildableNearMany: znaleziono ${found.length} z ${count} komórek, na których ` +
        `canBuild(s, id, '${type}') zwraca ok — przeszukano wszystkie ` +
        `${s.planet.cells.length} komórek (ruda: ${s.ore}).`,
    );
  }
  return found;
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
