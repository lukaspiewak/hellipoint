import { stateHash, type Planet, type SimState } from '@heliopolis/sim';

/**
 * Wspólni pomocnicy testowi `apps/client` — pisani przy PIERWSZYM użyciu, ale od razu tutaj,
 * a nie w pliku testowym (`global-constraints.md`, tabela „Pomocnicy testowi"). Kopia
 * takiego pomocnika w drugim pliku to następna liczba, która przeżyje swoje wejście.
 *
 * ## Co się przeprowadziło w Zadaniu 4 — i dlaczego
 *
 * Zadanie 2 założyło tu WSZYSTKICH czterech pomocników z tabeli fazy, przewidując, że
 * każdego z nich potrzebują zadania KLIENTA. Dla `freeHexagonNear` to była prawda;
 * `fourFreeHexagonsNear` ma jednak pierwszego konsumenta w `packages/sim/test/power.test.ts`
 * (Zadanie 4, Krok 1), a test symulacji importujący z `apps/client` odwracałby kierunek
 * zależności całego repozytorium.
 *
 * Przeszukiwanie mieszka więc od Zadania 4 w `packages/sim/test/support/fixtures.ts`,
 * a tutaj jest REEKSPORTOWANE — jedna kopia BFS, wszystkie dotychczasowe importy klienta
 * (`./support/fixtures.js`) bez zmiany. Tutaj zostaje to, co JEST klienta: odcisk palca
 * świata, którego `packages/sim` nie potrzebuje.
 */
export {
  buildableNear,
  builtCell,
  fourFreeHexagonsNear,
  freeHexagonNear,
} from '../../../../packages/sim/test/support/fixtures.js';

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
