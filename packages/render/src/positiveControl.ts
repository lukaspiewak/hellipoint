import type { Planet, Vec3 } from '@heliopolis/sim';
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
 * 2. **Kolor liczony per wierzchołek, ciągły, BEZ PRZYCIĘCIA.** `writeSmearedColors`
 *    interpoluje noc→dzień wg `(dot(normal, sunDir) + 1) / 2`, liczonego SAMODZIELNIE z
 *    normalnych komórek — patrz akapit niżej, dlaczego NIE wolno tu użyć `lightField`.
 *
 * ## KOREKTA: `saturate` przeciekał, i to jest zmierzone
 *
 * Pierwsza wersja tej kontroli używała `saturate(dot)`, czyli dokładnie tego samego wzoru co
 * `lightAt` w symulacji, z uzasadnieniem „prototyp Fazy 0 co do joty". **Kontrola nie
 * oblała: właściciel projektu dostał w niej 14/15.** Przyczyna, zmierzona na planecie bramki:
 *
 * | odwzorowanie | komórek NIEODRÓŻNIALNYCH od wszystkich sąsiadów (faza 1 / 2 / 3) |
 * |---|---|
 * | `saturate(dot)` | **673 / 650 / 650** z 1442 |
 * | `(dot + 1) / 2` | **0 / 0 / 0** |
 *
 * `saturate` ścina CAŁĄ półkulę nocną do jednej wartości `0.0`, więc noc jest jedną
 * jednolitą łatą — **a krawędź tej łaty JEST terminatorem.** Interpolacja po powierzchni
 * rozmywa tę krawędź lokalnie o mniej więcej komórkę, więc z bliska widać tylko rozmazanie;
 * z widoku całej tarczy krawędź obszaru jednolitego jest doskonale widoczna. Do tego
 * `saturate` daje **załamanie pochodnej** dokładnie na terminatorze (zero po stronie nocnej,
 * dodatnia po oświetlonej) — kolor jest ciągły, ale gradient skacze, a oko czyta nieciągłość
 * gradientu jako krawędź.
 *
 * **Na czym polegał błąd: odtworzony został WZÓR, a nie WŁASNOŚĆ.** Własność, która czyniła
 * render Fazy 0 nieczytelnym, brzmi „terminator nie ma żadnej cechy szczególnej". Wzór z
 * przycięciem tej własności nie ma — daje terminatorowi dwie cechy naraz.
 *
 * `(dot + 1) / 2` nie ma ani przycięcia, ani załamania: jasność narasta gładko od antypody
 * słońca (wartość 0) do punktu podsłonecznego (wartość 1), żaden obszar nie jest jednolity,
 * a terminator jest po prostu izolinią `0,5` — nieodróżnialną od każdej innej.
 *
 * **Dlatego ta funkcja NIE przyjmuje `lightField`** (ono jest już przycięte) tylko surowy
 * `sunDir`, i liczy iloczyn skalarny sama z `geo.normals`. To nie jest wygoda API — to
 * jedyny sposób, żeby przycięcie nie mogło tu wrócić tylnymi drzwiami.
 *
 * ## Czego ta kontrola NIE usuwa — i to jest granica tej konstrukcji
 *
 * Terminator pozostaje izolinią o NAJWIĘKSZYM gradiencie jasności, bo `dot = cos θ` ma
 * maksymalne nachylenie dokładnie przy `θ = 90°`. Zmierzone: średni krok barwny między
 * sąsiadami wynosi 0,0359 na całej kuli i 0,0561 na krawędziach przez terminator — czyli
 * 1,56×, wobec 2,78× przy `saturate`. Żadne gładkie, monotoniczne odwzorowanie `dot` tego nie
 * usunie; to jest własność geometrii kuli, nie palety. Kontrola jest więc najsłabszym
 * możliwym sygnałem terminatora przy tej geometrii, a nie sygnałem zerowym.
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
 * Kolor PER WIERZCHOŁEK, interpolowany liniowo noc→dzień wg `(dot(normal, sunDir) + 1) / 2`
 * — z całkowitym pominięciem `lightBand`/`LIGHT_BANDS` **i bez przycięcia**. W połączeniu ze
 * współdzielonymi wierzchołkami `buildSmearedGeometry` daje to kolor rozlany PO POWIERZCHNI,
 * bez ani jednego obszaru jednolitego i bez załamania pochodnej — patrz KOREKTA w komentarzu
 * modułu, gdzie jest zapisane, dlaczego `saturate(dot)` w tej roli PRZECIEKAŁ.
 *
 * **Bierze `sunDir`, nie `light`, i to jest wymóg poprawności, nie wygoda API.** `lightField`
 * zwraca `saturate(dot)`, czyli pole JUŻ PRZYCIĘTE: cała półkula nocna ma w nim dokładnie
 * jedną wartość. Gdyby ta funkcja przyjmowała gotowe pole, przycięcie wróciłoby tu przy
 * pierwszym wywołaniu z `lightField` — a to jest dokładnie ten przeciek, który sprawił, że
 * kontrola dawała 14/15 zamiast poziomu zgadywania.
 *
 * Iloczyn skalarny liczony jest z `geo.normals` (jedna normalna na wierzchołek = na komórkę),
 * w miejscu, bez alokacji — ten sam wzorzec bufora własności wywołującego co `writeCellColors`.
 *
 * @throws {RangeError} gdy `out.length !== geo.vertexCount * 3`.
 * @throws {RangeError} gdy `palette` ma mniej niż dwie pozycje (nie ma czego interpolować).
 * @throws {RangeError} gdy `sunDir` nie jest skończonym wektorem niezerowym. Bez tej straży
 *   `sunDir = {0,0,0}` (albo z `NaN`) dałoby `dot === 0` w KAŻDEJ komórce, czyli `t === 0,5`
 *   wszędzie — kulę w jednym płaskim kolorze. Kontrola wyglądałaby wtedy na działającą
 *   („granicy nie widać!"), będąc w istocie wyłączoną: nie widać NICZEGO. To jest najgorszy
 *   możliwy tryb awarii akurat tej funkcji, bo fałszuje wynik w stronę „kontrola oblała".
 */
export function writeSmearedColors(
  geo: SmearedGeometry,
  sunDir: Vec3,
  out: Float32Array,
  palette: Palette = DEFAULT_PALETTE,
): void {
  if (out.length !== geo.vertexCount * 3) {
    throw new RangeError(
      `writeSmearedColors: out.length (${out.length}) must equal geo.vertexCount * 3 (${geo.vertexCount * 3})`,
    );
  }
  if (palette.length < 2) {
    throw new RangeError(`writeSmearedColors: palette must have at least 2 entries, got ${palette.length}`);
  }
  const sunLength = Math.hypot(sunDir.x, sunDir.y, sunDir.z);
  if (!(sunLength > 0) || !Number.isFinite(sunLength)) {
    throw new RangeError(`writeSmearedColors: sunDir must be a finite non-zero vector, got length ${sunLength}`);
  }

  const night = palette[0];
  const day = palette[palette.length - 1];
  const sx = sunDir.x / sunLength;
  const sy = sunDir.y / sunLength;
  const sz = sunDir.z / sunLength;

  for (let i = 0; i < geo.vertexCount; i++) {
    const o = i * 3;
    // (dot + 1) / 2 — całe [-1, 1] rozciągnięte na [0, 1]. ŻADNEGO przycięcia: to jest
    // cała różnica między kontrolą, która obla, a kontrolą, która przecieka.
    const t = (geo.normals[o] * sx + geo.normals[o + 1] * sy + geo.normals[o + 2] * sz + 1) / 2;
    out[o] = night[0] + (day[0] - night[0]) * t;
    out[o + 1] = night[1] + (day[1] - night[1]) * t;
    out[o + 2] = night[2] + (day[2] - night[2]) * t;
  }
}
