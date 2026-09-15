import type { Planet } from '@heliopolis/sim';
import { DEFAULT_PALETTE, type Palette } from './shading.js';

/**
 * # KONTROLA POZYTYWNA BRAMKI CZYTELNOŚCI — geometria, która MA rozmazywać
 *
 * **Ten moduł istnieje po to, żeby bramka potrafiła powiedzieć „NIE".** Nie jest kodem
 * rozgrywki, nigdy nie trafia do `scene.ts`/`main.ts` i nie wolno go używać do rysowania
 * planety — jedynym konsumentem jest `readabilityGate.ts` w trybie `'control'`.
 *
 * ## Po co
 *
 * Przyrząd, który nie umie oblać, nie mierzy. Bramka Fazy 2A miała „kontrolę pozytywną"
 * (`writeCellColorsSmooth`), która oblać NIE MOGŁA: zmieniała MAPOWANIE palety, zostawiając
 * każdą komórkę płaską, bo `geometry.ts` daje każdej własne wierzchołki. Tryb awarii
 * zmierzony w Fazie 0 był inny — kolor był interpolowany **po powierzchni**, między
 * wierzchołkami WSPÓŁDZIELONYMI przez sąsiadów, i granica się **rozmazywała**
 * (spec Fazy 2A, §7.3.1 i §7.3.2).
 *
 * Ten moduł odtwarza tamtą awarię dosłownie, a nie przez analogię:
 *
 * 1. **Wierzchołki współdzielone.** Jeden wierzchołek na KOMÓRKĘ (jej środek), a trójkąty
 *    łączą środki trzech wzajemnie sąsiadujących komórek — czyli dokładnie siatka
 *    geodezyjna DUALNA do goldbergowej siatki gry. Każdy wierzchołek należy do ~6 trójkątów,
 *    więc GPU interpoluje jego kolor we wszystkie strony. Zero płaskich łat: na całej
 *    powierzchni nie ma ANI JEDNEJ nieciągłości koloru (C⁰), a to nieciągłości C⁰ oko czyta
 *    jako „linia".
 * 2. **Kolor liczony per wierzchołek, ciągły.** `writeSmearedColors` interpoluje liniowo
 *    noc→dzień wg `light` komórki-wierzchołka, z pominięciem `lightBand`. Razem z punktem 1
 *    daje to `saturate(dot(normal, sunDir))` rozlane po kuli — prototyp Fazy 0 co do joty.
 *
 * ## Czym ta kontrola NIE jest
 *
 * Nie jest „gorszą paletą" ani „ciemniejszym wariantem". Różnica między nią a trybem
 * ocenianym leży w DWÓCH warstwach naraz (geometria + mapowanie), i tak ma być: kontrola ma
 * odtworzyć ZNANĄ awarię, nie izolować jej przyczynę. Przyczynę izoluje zestawienie z
 * trzecim trybem (`writeCellColorsSmooth` — gładka paleta, ale płaskie komórki), który
 * zmienia tylko mapowanie.
 *
 * ## Wydajność
 *
 * Nieistotna z założenia (brief: „nie musi być wydajny ani ładny, ma rozmazywać"). Budowa
 * jest jednorazowa, przy tworzeniu harnessu. Zmierzone przy `frequency 12`: **1442
 * wierzchołki, 2880 trójkątów** — czyli dokładnie `2·V − 4` ze wzoru Eulera dla
 * triangulacji sfery, co jest zarazem najtańszym dowodem, że wyszukiwanie trójkątów nie
 * gubi ani nie dubluje żadnego (test #2 w `positiveControl.test.ts`).
 */
export interface SmearedGeometry {
  /** xyz na wierzchołek — DOKŁADNIE jeden wierzchołek na komórkę, w jej środku. */
  readonly positions: Float32Array;
  /** Normalna komórki, po jednej na wierzchołek (ten sam układ co `positions`). */
  readonly normals: Float32Array;
  /** Trójkąty łączące środki trzech wzajemnie sąsiadujących komórek. Zwrócone NA ZEWNĄTRZ. */
  readonly indices: Uint32Array;
  /** Liczba wierzchołków = liczba komórek. Wystawione, żeby konsument nie dzielił przez 3 w głowie. */
  readonly vertexCount: number;
}

/**
 * Buduje siatkę o WSPÓŁDZIELONYCH wierzchołkach: wierzchołek = środek komórki, trójkąt =
 * trójka wzajemnie sąsiadujących komórek.
 *
 * Każdy trójkąt znajdowany jest DOKŁADNIE RAZ dzięki warunkowi `a > i && b > a` (kanoniczna
 * kolejność rosnąca po `id`) — bez niego każda trójka wpadłaby sześć razy (3! permutacji),
 * co dałoby 17280 zamiast 2880 trójkątów i, co gorsza, połowę z nich w odwrotnym nawinięciu.
 *
 * **Nawinięcie (winding) jest NAPRAWIANE, nie zakładane.** `MeshBasicMaterial` domyślnie
 * rysuje tylko przednie ściany (`FrontSide`), więc trójkąt nawinięty do wewnątrz byłby
 * DZIURĄ w kontroli — a dziura w kontroli to nie jest „kontrola, która rozmazuje", tylko
 * artefakt, który sam z siebie zdradza, gdzie coś jest. Kolejność `(i, a, b)` z pętli nie ma
 * żadnego powodu być spójna (indeksy rosną po `id`, a `id` nie koduje orientacji), więc dla
 * każdego trójkąta liczony jest znak `dot(cross(A−I, B−I), normalna trójkąta)` i para
 * indeksów zamieniana, gdy wyjdzie ujemny. Zmierzone: bez tej poprawki **1440 z 2880**
 * trójkątów wychodzi nawiniętych do wewnątrz (log testu #4).
 */
export function buildSmearedGeometry(planet: Planet): SmearedGeometry {
  const cells = planet.cells;
  const cellCount = cells.length;

  const positions = new Float32Array(cellCount * 3);
  const normals = new Float32Array(cellCount * 3);
  for (let i = 0; i < cellCount; i++) {
    const cell = cells[i];
    const o = i * 3;
    positions[o] = cell.center.x;
    positions[o + 1] = cell.center.y;
    positions[o + 2] = cell.center.z;
    normals[o] = cell.normal.x;
    normals[o + 1] = cell.normal.y;
    normals[o + 2] = cell.normal.z;
  }

  const triangles: number[] = [];
  for (let i = 0; i < cellCount; i++) {
    const neighbors = cells[i].neighbors;
    for (const a of neighbors) {
      if (a <= i) continue;
      for (const b of cells[a].neighbors) {
        if (b <= a) continue;
        if (!neighbors.includes(b)) continue; // b musi sąsiadować także z i — inaczej to nie trójkąt
        triangles.push(...orientOutward(positions, i, a, b));
      }
    }
  }

  return {
    positions,
    normals,
    indices: Uint32Array.from(triangles),
    vertexCount: cellCount,
  };
}

/**
 * Zwraca trójkę indeksów w kolejności dającej ścianę zwróconą NA ZEWNĄTRZ sfery: normalna
 * geometryczna `cross(A−I, B−I)` ma mieć dodatni rzut na kierunek od środka planety
 * (planeta jest zawsze wyśrodkowana w (0,0,0) — patrz `createCamera`), czyli na sam
 * środek trójkąta. Przy ujemnym rzucie zamienia dwa indeksy miejscami.
 */
function orientOutward(positions: Float32Array, i: number, a: number, b: number): [number, number, number] {
  const ix = positions[i * 3];
  const iy = positions[i * 3 + 1];
  const iz = positions[i * 3 + 2];
  const ax = positions[a * 3] - ix;
  const ay = positions[a * 3 + 1] - iy;
  const az = positions[a * 3 + 2] - iz;
  const bx = positions[b * 3] - ix;
  const by = positions[b * 3 + 1] - iy;
  const bz = positions[b * 3 + 2] - iz;

  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;

  // Kierunek "na zewnątrz" w punkcie trójkąta = jego środek (planeta w (0,0,0)).
  const mx = ix + (ax + bx) / 3;
  const my = iy + (ay + by) / 3;
  const mz = iz + (az + bz) / 3;

  return cx * mx + cy * my + cz * mz >= 0 ? [i, a, b] : [i, b, a];
}

/**
 * Kolor PER WIERZCHOŁEK, interpolowany liniowo noc→dzień wg `light` komórki tego
 * wierzchołka — z całkowitym pominięciem `lightBand`/`LIGHT_BANDS`. W połączeniu ze
 * współdzielonymi wierzchołkami `buildSmearedGeometry` daje to kolor rozlany PO POWIERZCHNI,
 * czyli awarię Fazy 0.
 *
 * Sygnatura (bufor własności wywołującego, brak alokacji, te same strażniki `RangeError`)
 * celowo naśladuje `writeCellColors` — żeby harness mógł traktować oba tryby jednym kodem i
 * żeby „tryb kontrolny" nie stał się ścieżką o innych regułach niż tryb oceniany.
 *
 * @throws {RangeError} gdy `out.length !== geo.vertexCount * 3`.
 * @throws {RangeError} gdy `light.length !== geo.vertexCount`.
 * @throws {RangeError} gdy `palette` ma mniej niż dwie pozycje (nie ma czego interpolować).
 */
export function writeSmearedColors(
  geo: SmearedGeometry,
  light: Float32Array,
  out: Float32Array,
  palette: Palette = DEFAULT_PALETTE,
): void {
  if (out.length !== geo.vertexCount * 3) {
    throw new RangeError(
      `writeSmearedColors: out.length (${out.length}) must equal geo.vertexCount * 3 (${geo.vertexCount * 3})`,
    );
  }
  if (light.length !== geo.vertexCount) {
    throw new RangeError(
      `writeSmearedColors: light.length (${light.length}) must equal geo.vertexCount (${geo.vertexCount})`,
    );
  }
  if (palette.length < 2) {
    throw new RangeError(`writeSmearedColors: palette must have at least 2 entries, got ${palette.length}`);
  }

  const night = palette[0];
  const day = palette[palette.length - 1];
  for (let i = 0; i < geo.vertexCount; i++) {
    const t = light[i];
    const o = i * 3;
    out[o] = night[0] + (day[0] - night[0]) * t;
    out[o + 1] = night[1] + (day[1] - night[1]) * t;
    out[o + 2] = night[2] + (day[2] - night[2]) * t;
  }
}
