import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { PlanetGeometry } from './geometry.js';
import {
  DEFAULT_OUTLINE_PALETTE,
  DEFAULT_PALETTE,
  writeCellColors,
  writeCellColorsSmooth,
  type CellVertexRanges,
  type Palette,
} from './shading.js';

/**
 * `THREE.Mesh` całej planety, budowany RAZ z geometrii Zadania 2, plus sposób na
 * odświeżenie kolorów (Zadanie 3) co klatkę bez alokacji.
 */
export interface PlanetMesh {
  // Generyki podane WPROST (nie domyślne `Mesh`): domyślny `TMaterial` w typach Three.js
  // to `Material | Material[]` (mesh może mieć wiele materiałów per grupa geometrii) — bez
  // zawężenia `mesh.material` byłoby tą szeroką unią dla KAŻDEGO konsumenta tego interfejsu,
  // zmuszając do rzutowania nawet tam, gdzie wiadomo, że to zawsze jeden `MeshBasicMaterial`
  // (dokładnie to, co ten moduł konstruuje, patrz `createPlanetMesh` niżej).
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  /**
   * Obrysy komórek (Faza 2B, Zadanie 2) — DZIECKO `mesh`, nie osobny obiekt sceny.
   * Wystawione dla testowalności, tym samym wzorcem co `mesh` wyżej.
   */
  readonly outline: LineSegments<BufferGeometry, LineBasicMaterial>;
  /**
   * Przelicza kolory wszystkich komórek wg `light` (np. z `lightField`) i pisze je do
   * WŁASNEGO, raz zaalokowanego bufora — patrz komentarz przy `colors` niżej. Bezpieczne
   * do wołania co klatkę (do 60×/s): jedyna praca to jedno przejście `writeCellColors`
   * (już zmierzone w Zadaniu 3 jako tania funkcja czysta) plus podniesienie `needsUpdate`.
   */
  updateColors(light: Float32Array, palette?: Palette, outlinePalette?: Palette): void;
  /**
   * Wariant GŁADKI tego samego (`writeCellColorsSmooth`) — wyłącznie dla trybu
   * porównawczego bramki czytelności (`readabilityGate.ts`, `setMode('smooth')`), nigdy
   * dla renderu gry.
   *
   * Istnieje jako metoda, a nie jako sięgnięcie bramki po atrybut `color` tej siatki (tak
   * było do Fazy 2B, Zadanie 2), bo od dołożenia obrysów kolor planety mieszka w DWÓCH
   * buforach. Bramka pisząca tylko do jednego z nich zostawiłaby w trybie „smooth"
   * wypełnienia gładkie, a kratę nadal progowaną — czyli terminator WIDOCZNY jako skok
   * barwy obrysu, w trybie, którego cała rola polega na pokazaniu, jak wygląda render BEZ
   * progowania. Instrument mierzyłby wtedy coś innego, niż deklaruje.
   *
   * ## UWAGA DLA ZADANIA 5: krata w tym trybie NIE jest neutralna (przegląd, znalezisko 6)
   *
   * Obie palety są tu interpolowane między SWOIMI końcami, więc krok obrys↔wypełnienie zmienia
   * się wzdłuż `light`. Przeliczone ze stałych, w sRGB: **0,226 przy `light = 0`** (czyli na
   * CAŁEJ półkuli nocnej, którą `saturate` spłaszcza do jednej wartości), 0,145 przy 0,05,
   * 0,096 przy 0,10, **minimum 0,032 przy ≈0,25**, z powrotem 0,214 przy 1,0; znak różnicy
   * luminancji przechodzi przez zero przy `light ≈ 0,22`. Człowiek widzi więc jasną kratę na
   * ciemnym tle nad całą nocą, która GAŚNIE I ODWRACA POLARYZACJĘ w pierścieniu ok. 13° za
   * terminatorem.
   *
   * Kierunek przecieku jest zachowawczy — UŁATWIA tryb gładki, więc ZMNIEJSZA zmierzony
   * przyrost z progowania, nie zawyża go. Ale log z tego trybu wolno czytać wyłącznie jako
   * „tyle progowanie dokłada CO NAJMNIEJ"; **nie wolno go czytać jako „render jest czytelny
   * bez progowania"**, bo część tego, co widać, jest artefaktem kraty, nie cieniowania.
   */
  updateColorsSmooth(light: Float32Array, palette?: Palette, outlinePalette?: Palette): void;
  /** Zwalnia geometrię i materiał Three.js — terenu i obrysów. */
  dispose(): void;
}

/**
 * Pozycje obrysów komórek: dla każdej komórki zamknięta pętla po jej narożnikach, w układzie
 * `THREE.LineSegments` (para wierzchołków na odcinek). Ten sam kształt „komórka → zakres
 * wierzchołków" co `PlanetGeometry`, więc `writeCellColors` koloruje to bez żadnej nowej
 * funkcji (patrz `CellVertexRanges` w `shading.ts`).
 */
export interface CellOutlines extends CellVertexRanges {
  readonly positions: Float32Array;
  readonly cellVertexStart: Uint32Array;
  readonly cellVertexCount: Uint32Array;
}

/**
 * `[WYGLĄD]` Jak mocno obrys komórki jest WCIĄGNIĘTY do jej środka, jako ułamek odcinka
 * narożnik→środek.
 *
 * **To nie jest estetyka, tylko warunek na nienaruszalność terminatora — i o mało go nie
 * przegapiłem.** Sąsiadujące komórki dzielą krawędź. Obrys rysowany DOKŁADNIE po krawędziach
 * dawałby na każdej z nich DWIE pokrywające się linie (po jednej z każdej komórki), a na
 * granicy pasm — dwie pokrywające się linie w RÓŻNYCH kolorach. Dwa skutki, oba złe:
 * migotanie z walki o bufor głębokości oraz, znacznie gorzej, PRZYKRYCIE samej granicy.
 * Piksele terminatora przestałyby pokazywać skok „wypełnienie nocy ↔ wypełnienie zmierzchu"
 * (odległość barw 0,9005) i pokazywałyby skok „obrys nocy ↔ obrys zmierzchu" — przeliczone
 * z `DEFAULT_OUTLINE_PALETTE`: **0,5918, czyli 65,7% tego, co jest dziś** (w sRGB 0,5632 =
 * 65,5%). Bramka Zadania 1 mierzy właśnie tę pierwszą liczbę, więc przeszłaby na pomiarze,
 * a oko dostałoby drugą. Przypina to test 21 w `shading.test.ts`.
 *
 * > Do rundy naprawczej 1 stała była tu liczba **0,5546 (62%)** i była zła. Pochodzenie
 * > ustalone: to odległość policzona, gdy kanał R obrysu zmierzchu wynosił jeszcze 0,598 —
 * > wartość z PORZUCONEGO wariantu palety (mieszanie ku szarości), nieprzeliczona po
 * > przejściu na paletę jawną, w której ten kanał ma 0,638. Podstawienie 0,598 odtwarza
 * > 0,5546 co do czwartej cyfry. Kierunek błędu był zachowawczy, więc decyzja o wciągnięciu
 * > zostaje w mocy — ale liczba zdążyła trafić do specu fazy.
 *
 * Wciągnięcie zostawia między obrysami dwóch sąsiadów pasek ICH WŁASNYCH wypełnień, więc
 * granica pasm zostaje narysowana pełnym skokiem palety — tak jak przed tą zmianą.
 *
 * ## Zakres, a nie tylko dolna granica (runda naprawcza 1)
 *
 * Wciągnięcie musi być DODATNIE (wyżej) **i MAŁE**: obrys ma nadal obrysowywać komórkę, a nie
 * kurczyć się w kropkę przy jej środku. Przy `0,48` obrysy sąsiadów dzieli już 96% długości
 * krawędzi zamiast 11%, przy `0,97` z kraty zostaje punkcik — a testy pilnujące tylko dolnego
 * progu przechodziły na obu tych wartościach. Górna granica jest zapisana jako własność
 * geometrii, nie jako drugi próg na tej stałej: **każdy wierzchołek obrysu zachowuje co
 * najmniej 75% odległości swojego narożnika od środka komórki** (dziś dokładnie 93%), czyli
 * `OUTLINE_INSET < 0,25`. Test 24 w `planetMesh.test.ts`.
 */
export const OUTLINE_INSET = 0.07; // [WYGLĄD]

/**
 * `[WYGLĄD]` O ile obrys jest uniesiony ponad powierzchnię terenu, jako ułamek promienia
 * planety (pozycja wierzchołka × `1 + OUTLINE_LIFT`).
 *
 * Bez tego linia leży DOKŁADNIE w płaszczyźnie trójkąta wachlarza, który ją otacza (odcinek
 * narożnik→środek należy do tego trójkąta) — czyli walczy z nim o bufor głębokości i miga.
 * Ułamek promienia, a nie stała światowa: `createPlanet` może dostać inny `radius` (tak samo
 * jak granice zoomu w `camera.ts`).
 *
 * ## Zakres, a nie tylko dolna granica (runda naprawcza 1)
 *
 * **Dół:** uniesienie musi przewyższyć STRZAŁKĘ płaskiego wieloboku komórki — zmierzone na tej
 * planecie: najgłębszy punkt cięciwy środek→narożnik schodzi **0,050** jednostki pod sferę,
 * a uniesienie wynosi **0,200**, czyli czterokrotność. Poniżej strzałki linia wraca do
 * płaszczyzny terenu i miga.
 *
 * **Góra — i to jest realne ryzyko, nie teoretyczne:** ktoś w Zadaniu 3 podniesie tę stałą,
 * żeby krata nie znikała pod budynkiem. Pod kątem STYCZNYM pozorne przesunięcie linii względem
 * jej własnej komórki równa się właśnie uniesieniu w jednostkach świata, a przy limbie krata
 * strony nocnej zaczyna NAWISAĆ nad stroną oświetloną — czyli rysować granicę tam, gdzie jej
 * nie ma. Granica: **uniesienie poniżej 5% średnicy NAJMNIEJSZEJ komórki** (8,41 jednostki na
 * tej planecie → 0,42); dziś 0,200, czyli 2,4%. Przy `0,09` uniesienie wyniosłoby 9 jednostek,
 * ponad całą średnicę komórki — a testy pilnujące tylko dolnego progu to przepuszczały.
 * Test 24 w `planetMesh.test.ts` mierzy obie strony okna.
 *
 * Dla porównania `MARKER_SURFACE_OFFSET_FACTOR` w `readabilityGate.ts` jest sześć razy
 * większe — bo billboard znacznika musi wystawać ponad KRZYWIZNĘ KULI, a linia tylko ponad
 * płaski wielobok jednej komórki.
 */
export const OUTLINE_LIFT = 0.002; // [WYGLĄD]

/**
 * Buduje pozycje obrysów wszystkich komórek z gotowej `PlanetGeometry` (Zadanie 2 Fazy 2A).
 * Funkcja CZYSTA, bez Three.js — testowalna bez WebGL, tak samo jak `buildPlanetGeometry`.
 *
 * Układ wejścia jest kontraktem `PlanetGeometry`: wierzchołek `cellVertexStart[i]` to ŚRODEK
 * komórki `i`, a `cellVertexStart[i] + 1 .. + cellVertexCount[i] - 1` to jej narożniki w
 * kolejności obiegu. Obrys komórki to zamknięta pętla po tych narożnikach, wciągnięta o
 * `OUTLINE_INSET` do środka i uniesiona o `OUTLINE_LIFT` — patrz uzasadnienia przy obu
 * stałych. Wyjście jest w układzie `LineSegments`: dwa kolejne wierzchołki to jeden odcinek,
 * więc komórka o `n` narożnikach zajmuje `2n` wierzchołków.
 *
 * Zmierzone przy `frequency 12` (1442 komórki: 12 pentagonów + 1430 heksagonów):
 * **8640 odcinków** (12×5 + 1430×6) → 17280 wierzchołków → 51840 floatów.
 *
 * @throws {RangeError} gdy `cellVertexStart` i `cellVertexCount` mają różne długości —
 *   dwie tablice indeksowane tym samym `i`, których nic nie wiąże składniowo.
 * @throws {RangeError} gdy któraś komórka ma mniej niż 4 wierzchołki (środek + 3 narożniki).
 *   Bez tego zdegenerowane `cellVertexCount` (np. same zera) dałoby po cichu ZERO odcinków,
 *   czyli pusty bufor, pustą siatkę i planetę wyglądającą dokładnie tak, jak przed tą
 *   zmianą — awarię nie do odróżnienia od „nie zaimplementowano".
 */
export function buildCellOutlines(geo: PlanetGeometry): CellOutlines {
  const cellCount = geo.cellVertexStart.length;
  if (geo.cellVertexCount.length !== cellCount) {
    throw new RangeError(
      `buildCellOutlines: cellVertexCount.length (${geo.cellVertexCount.length}) must equal cellVertexStart.length (${cellCount})`,
    );
  }

  let totalVertices = 0;
  for (let i = 0; i < cellCount; i++) {
    const vertexCount = geo.cellVertexCount[i];
    if (vertexCount < 4) {
      throw new RangeError(
        `buildCellOutlines: cell ${i} has ${vertexCount} vertices, expected at least 4 (center + 3 corners)`,
      );
    }
    totalVertices += (vertexCount - 1) * 2;
  }

  const positions = new Float32Array(totalVertices * 3);
  const cellVertexStart = new Uint32Array(cellCount);
  const cellVertexCount = new Uint32Array(cellCount);

  const lift = 1 + OUTLINE_LIFT;
  let cursor = 0;
  for (let i = 0; i < cellCount; i++) {
    const start = geo.cellVertexStart[i];
    const cornerCount = geo.cellVertexCount[i] - 1;
    const c = start * 3;
    const cx = geo.positions[c];
    const cy = geo.positions[c + 1];
    const cz = geo.positions[c + 2];

    cellVertexStart[i] = cursor;
    cellVertexCount[i] = cornerCount * 2;

    for (let k = 0; k < cornerCount; k++) {
      // Oba końce odcinka liczone tą samą formułą; narożnik dzielony przez dwa kolejne
      // odcinki jest liczony dwa razy, zamiast trzymać bufor pośredni — arytmetyka jest
      // tańsza od alokacji, a ta funkcja i tak biegnie RAZ, przy budowie siatki.
      const a = (start + 1 + k) * 3;
      const b = (start + 1 + ((k + 1) % cornerCount)) * 3;
      cursor = writeInsetCorner(positions, cursor, geo.positions, a, cx, cy, cz, lift);
      cursor = writeInsetCorner(positions, cursor, geo.positions, b, cx, cy, cz, lift);
    }
  }

  return { positions, cellVertexStart, cellVertexCount };
}

/** Jeden narożnik obrysu: wciągnięty do `(cx, cy, cz)` i uniesiony. Zwraca nowy kursor. */
function writeInsetCorner(
  out: Float32Array,
  cursor: number,
  source: Float32Array,
  src: number,
  cx: number,
  cy: number,
  cz: number,
  lift: number,
): number {
  const o = cursor * 3;
  out[o] = (source[src] + (cx - source[src]) * OUTLINE_INSET) * lift;
  out[o + 1] = (source[src + 1] + (cy - source[src + 1]) * OUTLINE_INSET) * lift;
  out[o + 2] = (source[src + 2] + (cz - source[src + 2]) * OUTLINE_INSET) * lift;
  return cursor + 1;
}

/**
 * Zamienia `PlanetGeometry` (Zadanie 2 — pozycje/normalne/indeksy, WŁASNE wierzchołki na
 * komórkę) w renderowalny `THREE.Mesh`. Materiał to `MeshBasicMaterial` z
 * `vertexColors: true` — CELOWO, nie `MeshStandardMaterial` ani cokolwiek z modelem
 * oświetlenia silnika: kolory z `writeCellColors` (Zadanie 3) JUŻ niosą wynik progowania
 * światła symulacji (`lightField`/`sunDirection`, filar D1 — terminator jako GRANICA, nie
 * gradient, zmierzone w bramce Fazy 0). Gdyby renderer dołożył WŁASNE cieniowanie na
 * wierzch tych kolorów (np. `MeshStandardMaterial` reagujący na `THREE.Light` w scenie),
 * rozmyłoby to ostre progi z powrotem w gładki gradient — dokładnie ten, który bramka
 * Fazy 0 zmierzyła jako NIECZYTELNY. To jest, wg briefu Zadania 4, najłatwiejszy sposób
 * na ciche zepsucie Fazy 2A: żaden test typów/testów jednostkowych by tego formalnie nie
 * wymagał, gdyby nie ten właśnie wybór materiału — stąd `planetMesh.test.ts` sprawdza go
 * wprost (`toBeInstanceOf(MeshBasicMaterial)`, `not.toBeInstanceOf(MeshStandardMaterial)`).
 *
 * Bufor kolorów (`colors`) jest WŁASNOŚCIĄ tego modułu: zaalokowany RAZ, o długości
 * `geo.positions.length` (jak wymaga `writeCellColors`), i podpięty jako atrybut `color`
 * geometrii. `updateColors` PISZE w niego wielokrotnie, nigdy nie tworzy nowego —
 * `writeCellColors` sama nie alokuje nic (Zadanie 3), a alokacja per klatka rzuciłaby
 * ~30 tys. floatów pod nogi odśmiecacza sześćdziesiąt razy na sekundę, dokładnie w pętli
 * renderu (budżet klatki 8 ms, `global-constraints.md`).
 *
 * ## Obrysy komórek (Faza 2B, Zadanie 2)
 *
 * Do Fazy 2A dzienna strona planety była przy przybliżeniu JEDNOLITĄ płaszczyzną bez jednej
 * linii: materiał bez modelu oświetlenia (wyżej) plus jeden kolor na całe pasmo znaczą, że
 * wewnątrz pasma nie ma NIC — ani krawędzi komórek, ani punktu odniesienia. Dla Fazy 2A to
 * nie była wada; dla tower defense, w którym rozmieszczenie jest główną decyzją gracza, jest
 * — nie widać kraty, na której się buduje.
 *
 * Krata wchodzi jako OSOBNA GEOMETRIA LINII (`LineSegments`), nie jako zróżnicowanie koloru
 * wewnątrz pasma: wypełnienia komórek zostają co do bitu takie, jak były, więc odległość barw
 * przez terminator zostaje dokładnie ta sama (0,9005 — zmierzone przed zmianą i po niej,
 * `shading.test.ts` test 20). Wariant „subtelne zróżnicowanie w obrębie pasma" tej własności
 * NIE MA z definicji: cokolwiek by robił z odcieniami, najciemniejszy odcień pasma jaśniejszego
 * leży bliżej pasma ciemniejszego niż leżał jego kolor bazowy.
 *
 * `LineBasicMaterial` — tak samo jak teren, BEZ modelu oświetlenia (jedyne materiały Three.js
 * z modelem oświetlenia to `MeshLambert/Phong/Standard/Physical`; linie i tak nie mają
 * normalnych). Obrys jest DZIECKIEM siatki terenu, nie osobnym obiektem sceny — `visible`
 * w Three.js jest dziedziczne, więc `readabilityGate.ts`, który chowa planetę w trybie
 * kontroli pozytywnej (`planetMesh.mesh.visible = false`), chowa też kratę, bez wiedzy o niej.
 * To jest ważne: krata widoczna w trybie kontrolnym byłaby cue pokazującym granicę tam, gdzie
 * kontrola ma jej NIE pokazywać — czyli kontrola przestałaby móc oblać.
 */
export function createPlanetMesh(geo: PlanetGeometry): PlanetMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(geo.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(geo.normals, 3));
  geometry.setIndex(new BufferAttribute(geo.indices, 1));

  const colors = new Float32Array(geo.positions.length);
  const colorAttribute = new BufferAttribute(colors, 3);
  geometry.setAttribute('color', colorAttribute);

  const material = new MeshBasicMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);

  const outlines = buildCellOutlines(geo);
  const outlineGeometry = new BufferGeometry();
  outlineGeometry.setAttribute('position', new BufferAttribute(outlines.positions, 3));
  const outlineColors = new Float32Array(outlines.positions.length);
  const outlineColorAttribute = new BufferAttribute(outlineColors, 3);
  outlineGeometry.setAttribute('color', outlineColorAttribute);
  const outlineMaterial = new LineBasicMaterial({ vertexColors: true });
  const outline = new LineSegments(outlineGeometry, outlineMaterial);
  mesh.add(outline);

  return {
    mesh,
    outline,
    updateColors(
      light: Float32Array,
      palette: Palette = DEFAULT_PALETTE,
      outlinePalette: Palette = DEFAULT_OUTLINE_PALETTE,
    ): void {
      writeCellColors(geo, light, colors, palette);
      writeCellColors(outlines, light, outlineColors, outlinePalette);
      colorAttribute.needsUpdate = true;
      outlineColorAttribute.needsUpdate = true;
    },
    updateColorsSmooth(
      light: Float32Array,
      palette: Palette = DEFAULT_PALETTE,
      outlinePalette: Palette = DEFAULT_OUTLINE_PALETTE,
    ): void {
      writeCellColorsSmooth(geo, light, colors, palette);
      writeCellColorsSmooth(outlines, light, outlineColors, outlinePalette);
      colorAttribute.needsUpdate = true;
      outlineColorAttribute.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
      outlineGeometry.dispose();
      outlineMaterial.dispose();
    },
  };
}
