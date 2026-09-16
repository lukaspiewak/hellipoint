import { describe, expect, it } from 'vitest';
import { GCProfiler } from 'node:v8';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, type BufferAttribute, type BufferGeometry, type Object3D, type Scene } from 'three';
import { BUILDINGS, createPlanet, type Building, type BuildingType } from '@heliopolis/sim';
import { buildPlanetGeometry } from '../src/geometry.js';
import {
  buildCellBases,
  coreScale,
  createBuildingLayer,
  healthFraction,
  writeCoreColor,
  ALERT_COLOR_DARK,
  ALERT_COLOR_LIGHT,
  ALERT_INNER_FACTOR,
  ALERT_RADIUS_FACTOR,
  BUILDING_HEIGHT_FACTOR,
  BUILDING_RADIUS_FACTOR,
  BUILDING_SHAPES,
  CORE_COLOR_CRITICAL,
  CORE_COLOR_HEALTHY,
  CORE_RIM_FACTOR,
  CORE_SCALE_MIN,
  SHELL_COLOR,
  SHELL_TAPER,
  SURFACE_LIFT_FACTOR,
} from '../src/buildingMesh.js';
import { DEFAULT_OUTLINE_PALETTE, DEFAULT_PALETTE, type Rgb } from '../src/shading.js';
import { buildCellOutlines } from '../src/planetMesh.js';
import { MAX_DISTANCE_FACTOR } from '../src/camera.js';
import { createSceneWithRenderer, type SceneRenderer } from '../src/scene.js';
import { createFakeCanvas } from './support/fakeCanvas.js';

const planet = createPlanet({ seed: 20260915 });
const geo = buildPlanetGeometry(planet);
const CELL_COUNT = planet.cells.length;

const ALL_TYPES: readonly BuildingType[] = [
  'CORE',
  'BARRICADE',
  'PYLON',
  'SOLAR_PANEL',
  'BATTERY',
  'EXTRACTOR',
  'KINETIC_TURRET',
  'LASER_TURRET',
  'GEOTHERMAL_CAP',
  'EVACUATION_MODULE',
];

/** Pusta tablica budynków o kształcie `SimState.buildings` — jeden slot na komórkę. */
function emptyBuildings(): (Building | null)[] {
  return new Array<Building | null>(CELL_COUNT).fill(null);
}

function place(
  list: (Building | null)[],
  cellId: number,
  type: BuildingType,
  opts: { hp?: number; powered?: boolean } = {},
): Building {
  const building: Building = {
    cellId,
    type,
    hp: opts.hp ?? BUILDINGS[type].hp,
    powered: opts.powered ?? true,
  };
  list[cellId] = building;
  return building;
}

/** Macierz instancji `slot` — czytana przez API Three.js, nie przez arytmetykę testu. */
function matrixAt(mesh: { getMatrixAt(i: number, m: Matrix4): void }, slot: number): Matrix4 {
  const m = new Matrix4();
  mesh.getMatrixAt(slot, m);
  return m;
}

/** Kolumna bazy macierzy (0 = X, 1 = Y, 2 = Z) — `Matrix4.elements` jest kolumnowo. */
function basisColumn(m: Matrix4, column: 0 | 1 | 2): Vector3 {
  const e = m.elements;
  return new Vector3(e[column * 4], e[column * 4 + 1], e[column * 4 + 2]);
}

function translationOf(m: Matrix4): Vector3 {
  const e = m.elements;
  return new Vector3(e[12], e[13], e[14]);
}

function instanceColorAt(mesh: { instanceColor: { array: ArrayLike<number> } | null }, slot: number): Rgb {
  const a = mesh.instanceColor;
  if (!a) throw new Error('test: warstwa rdzenia nie ma bufora barw instancji');
  return [a.array[slot * 3], a.array[slot * 3 + 1], a.array[slot * 3 + 2]];
}

// --- Geometria komórki: wielkość, która NAPRAWDĘ ogranicza okrąg --------------------------

const outlines = buildCellOutlines(geo);

function unit(v: Vector3): Vector3 {
  return v.clone().normalize();
}

function outlineVertex(index: number): Vector3 {
  return new Vector3(outlines.positions[index * 3], outlines.positions[index * 3 + 1], outlines.positions[index * 3 + 2]);
}

/**
 * Najmniejszy KĄT (mierzony od środka planety) między kierunkiem środka komórki a KRAWĘDZIĄ
 * jej obrysu — minimum po wszystkich 1442 komórkach i wszystkich krawędziach.
 *
 * **To jest wielkość wiążąca dla każdego OKRĘGU rysowanego wokół środka komórki, i to jej
 * nie mierzył test 8 do rundy naprawczej 1.** Poprzednia wersja brała `min|narożnik − środek|
 * × (1 − OUTLINE_INSET)`, czyli promień OPISANY (3,9208). Obrys nie przechodzi przez
 * narożniki — to zamknięta pętla po nich — więc okrąg mieści się w nim wtedy i tylko wtedy,
 * gdy jest mniejszy od promienia WPISANEGO (3,1720). Na tej różnicy pierścień alarmu
 * wychodził poza komórkę w 72 z 1442 komórek.
 *
 * Liczone KĄTOWO, nie w jednostkach świata, bo obrys leży na kuli, a pierścień w płaszczyźnie
 * stycznej uniesionej ponad nią — porównanie odległości płaskich mieszałoby dwie różne
 * powierzchnie. Odczyt idzie z FAKTYCZNEGO bufora obrysów (`buildCellOutlines`), tego samego,
 * który rysuje kratę, a nie z przeliczenia narożników własnym wzorem.
 *
 * Krawędź jest próbkowana `EDGE_SAMPLES` razy (nieparzyście, więc jej środek — w którym
 * minimum wypada — trafia w próbkę dokładnie). Przy 201 próbkach na krawędź o rozpiętości
 * ok. 2° błąd próbkowania jest rzędu 10⁻⁸ rad, czyli 10⁻⁶ jednostki świata.
 */
const EDGE_SAMPLES = 201;
function minOutlineEdgeAngle(): { angle: number; cellId: number } {
  let best = Infinity;
  let cellId = -1;
  const p = new Vector3();
  for (let i = 0; i < CELL_COUNT; i++) {
    const center = unit(new Vector3(planet.cells[i].center.x, planet.cells[i].center.y, planet.cells[i].center.z));
    const start = outlines.cellVertexStart[i];
    const edges = outlines.cellVertexCount[i] / 2;
    for (let e = 0; e < edges; e++) {
      const a = outlineVertex(start + e * 2);
      const b = outlineVertex(start + e * 2 + 1);
      for (let s = 0; s < EDGE_SAMPLES; s++) {
        const f = s / (EDGE_SAMPLES - 1);
        p.copy(a).lerp(b, f).normalize();
        const angle = Math.acos(Math.min(1, p.dot(center)));
        if (angle < best) {
          best = angle;
          cellId = i;
        }
      }
    }
  }
  return { angle: best, cellId };
}

/** To samo co wyżej, ale do NAROŻNIKA obrysu — wyłącznie jako kontrola strukturalna testu 8. */
function minOutlineCornerAngle(): number {
  let best = Infinity;
  for (let i = 0; i < CELL_COUNT; i++) {
    const center = unit(new Vector3(planet.cells[i].center.x, planet.cells[i].center.y, planet.cells[i].center.z));
    const start = outlines.cellVertexStart[i];
    for (let v = 0; v < outlines.cellVertexCount[i]; v++) {
      best = Math.min(best, Math.acos(Math.min(1, unit(outlineVertex(start + v)).dot(center))));
    }
  }
  return best;
}

/** Kąt (od środka planety), pod jakim widać okrąg o promieniu `r` leżący `lift` nad powierzchnią. */
function ringAngle(r: number, lift: number): number {
  return Math.atan2(r, planet.radius + lift);
}

/** Najmniejszy promień opisany komórki — wyłącznie do GÓRNEJ granicy uniesienia. */
function smallestCellRadius(): number {
  let smallest = Infinity;
  for (const cell of planet.cells) {
    for (const corner of cell.corners) {
      smallest = Math.min(
        smallest,
        Math.hypot(corner.x - cell.center.x, corner.y - cell.center.y, corner.z - cell.center.z),
      );
    }
  }
  return smallest;
}

/**
 * Trzy promienie krawędzi obręczy alarmu (wewnętrzna, podział jasny/ciemny, zewnętrzna),
 * odczytane z FAKTYCZNEGO bufora pozycji warstwy w scenie — w przestrzeni lokalnej, gdzie
 * promień zewnętrzny wynosi 1. Odczyt z geometrii, a nie ze stałych `ALERT_INNER_FACTOR` /
 * `ALERT_SPLIT_FACTOR`, żeby asercja mierzyła to, co narysowane, a nie to, co zadeklarowane.
 */
function alertBandRadii(layer: { alert: { geometry: BufferGeometry } }): {
  inner: number;
  split: number;
  outer: number;
} {
  const position = layer.alert.geometry.getAttribute('position') as BufferAttribute;
  const radii = new Set<number>();
  for (let i = 0; i < position.count; i++) {
    radii.add(Number(Math.hypot(position.getX(i), position.getY(i)).toFixed(6)));
  }
  const sorted = [...radii].sort((a, b) => a - b);
  if (sorted.length !== 3) {
    throw new Error(`test: obręcz ma ${sorted.length} różnych promieni, oczekiwano 3 — ${sorted.join(', ')}`);
  }
  return { inner: sorted[0], split: sorted[1], outer: sorted[2] };
}

// --- Nawinięcie trójkątów ------------------------------------------------------------------

/**
 * Ile trójkątów geometrii jest nawiniętych ODWROTNIE niż kierunek, w który mają patrzeć, plus
 * najgorszy (najmniejszy) iloczyn skalarny znormalizowanej normalnej z tym kierunkiem.
 *
 * Istnieje, bo **defekt nawinięcia w tym zadaniu naprawdę wystąpił** — pierścień alarmu nie
 * renderował się w ogóle, bo `side: FrontSide` wycinał całą warstwę — i znalazły go dopiero
 * oczy, po zielonym pakiecie. W raporcie Zadania 3 napisałem, że takiego testu nie da się
 * tanio napisać bez GPU. **To była nieprawda i przegląd to pokazał, pisząc go.** Nawinięcie
 * jest własnością czysto arytmetyczną bufora pozycji i indeksów.
 *
 * `reference` dostaje CENTROID trójkąta i zwraca kierunek, w który ta ściana ma patrzeć.
 */
function windingReport(
  geometry: BufferGeometry,
  reference: (centroid: Vector3) => Vector3,
): { triangles: number; wrong: number; worstDot: number } {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const index = geometry.getIndex();
  if (!index) throw new Error('test: geometria bez bufora indeksów');
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let wrong = 0;
  let worstDot = Infinity;
  const triangles = index.count / 3;
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(position, index.getX(t * 3));
    b.fromBufferAttribute(position, index.getX(t * 3 + 1));
    c.fromBufferAttribute(position, index.getX(t * 3 + 2));
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (normal.lengthSq() === 0) continue; // trójkąt zdegenerowany — do policzenia osobno
    normal.normalize();
    const centroid = new Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    const d = normal.dot(reference(centroid).normalize());
    if (d <= 0) wrong++;
    worstDot = Math.min(worstDot, d);
  }
  return { triangles, wrong, worstDot };
}

// --- Kontrast WCAG -----------------------------------------------------------------------
// Stałe barw w tym projekcie są LINIOWE (patrz `Rgb` w `shading.ts`), więc luminancja
// względna bierze je WPROST — bez dekodowania sRGB. Potraktowanie ich jako sRGB dałoby
// kontrasty WYŻSZE, niż są naprawdę, i akurat na najsłabszym boku (zmierzch↔dzień, 1,79).
function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Odległość euklidesowa barw po ZAKODOWANIU do sRGB — miara „jak bardzo to widać",
 * w odróżnieniu od kontrastu WCAG, który bierze luminancję liniową wprost (`shading.ts`,
 * komentarz przy `Rgb`). Potrzebna tam, gdzie luminancja z definicji nie wystarcza: dwie
 * barwy o identycznej luminancji mają identyczny kontrast wobec każdego tła, a mimo to
 * jedna może być czerwienią, a druga szarością.
 */
function srgbDistance(a: Rgb, b: Rgb): number {
  const encode = (u: number): number => (u <= 0.0031308 ? u * 12.92 : 1.055 * Math.pow(u, 1 / 2.4) - 0.055);
  return Math.hypot(encode(a[0]) - encode(b[0]), encode(a[1]) - encode(b[1]), encode(a[2]) - encode(b[2]));
}

/** Każde tło, na którym budynek może stanąć: trzy pasma wypełnień i trzy barwy kraty. */
const BACKGROUNDS: readonly (readonly [string, Rgb])[] = [
  ['noc', DEFAULT_PALETTE[0]],
  ['zmierzch', DEFAULT_PALETTE[1]],
  ['dzień', DEFAULT_PALETTE[2]],
  ['obrys nocy', DEFAULT_OUTLINE_PALETTE[0]],
  ['obrys zmierzchu', DEFAULT_OUTLINE_PALETTE[1]],
  ['obrys dnia', DEFAULT_OUTLINE_PALETTE[2]],
];

const WCAG_MIN = 3;

// --- Progi CZYTELNOŚCI: minimum po populacji, w PIKSELACH (runda naprawcza 2) -------------
//
// Runda 1 dała progi bezwzględne, ale postawione na wielkościach, które są spełnione przez
// JEDNEGO członka populacji: `widestRim` to maksimum po dziesięciu typach, więc próg 0,35 j.
// spełniał wyłącznie `CORE`, a `PYLON` miał obwódkę 0,59 px. Próg na maksimum albo na
// ilorazie nie jest progiem czytelności — jest progiem na najlepszym przypadku.
//
// **Każdy próg poniżej wiąże MINIMUM po populacji, wyrażone w pikselach.**
//
// Przelicznik: z widoku DOMYŚLNEGO (`INITIAL_DISTANCE_FACTOR = 3`, kamera 300 jednostek od
// środka planety, pole widzenia 50°) sylwetka planety zajmuje 0,7148 wysokości kadru, czyli
// przy płótnie 900 px ma 643 px średnicy na 200 jednostek świata — **3,22 px na jednostkę**.
// To jest miara UŚREDNIONA po tarczy; w jej środku, gdzie powierzchnia jest zwrócona wprost
// do kamery, skala wynosi 4,83 px/j. Biorę zachowawczą.
const PIXELS_PER_UNIT = 3.22;
const px = (world: number): number => world * PIXELS_PER_UNIT;

/**
 * Jeden próg na wszystko, co ma być WIDOCZNE. Liczba pochodzi z §5.3 raportu tego zadania:
 * pierwsza wersja obręczy alarmu miała pasy poniżej piksela i została odrzucona OBEJRZENIEM
 * — „alarmu nie było widać w ogóle". To jest jedyny werdykt wzrokowy, jaki to zadanie ma na
 * temat granicy widoczności, więc on jest progiem.
 */
const MIN_VISIBLE_PX = 1;

/** Pole rdzenia przy `hp === 0` jako ułamek pola przy pełnym — kanał geometryczny uszkodzenia. */
const MAX_CORE_AREA_AT_ZERO_HP = 0.36;
/** Odległość barw (sRGB) barwy krytycznej od SZAROŚCI o tej samej luminancji. */
const MIN_CRITICAL_CHROMA = 0.3;

describe('barwy budynku wobec trzech pasm terenu', () => {
  it('1. [SEDNO DOBORU] dwa tony budynku pokrywają KAŻDE tło progiem 3:1 — a ŻADEN z nich sam tego nie potrafi', () => {
    // Własność, na której stoi cały dobór barw tego zadania. Dwutonowość nie jest
    // stylistyką: przy palecie, w której zmierzch↔dzień to 1,79, pojedynczy ton NIE ISTNIEJE
    // (patrz kontrola pozytywna na dole tego testu).
    for (const [name, background] of BACKGROUNDS) {
      const best = Math.max(contrast(SHELL_COLOR, background), contrast(CORE_COLOR_HEALTHY, background));
      expect(best, `tło "${name}"`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
    // Pierścień alarmu to osobna para tonów i musi spełniać to samo — bo pojawia się
    // dokładnie tam, gdzie budynek już stoi, na tym samym tle.
    for (const [name, background] of BACKGROUNDS) {
      const best = Math.max(contrast(ALERT_COLOR_DARK, background), contrast(ALERT_COLOR_LIGHT, background));
      expect(best, `pierścień alarmu na tle "${name}"`).toBeGreaterThanOrEqual(WCAG_MIN);
    }

    // --- KONTROLA POZYTYWNA NA SAM PRZYRZĄD -------------------------------------------
    // Gdyby ten test dało się zdać JEDNYM tonem, nie mierzyłby dwutonowości, tylko "kolory
    // są jakieś". Sprawdzamy więc, że każdy z tonów Z OSOBNA na czymś OBLEWA...
    const alone = (tone: Rgb): number =>
      Math.min(...DEFAULT_PALETTE.map((band) => contrast(tone, band)));
    expect(alone(SHELL_COLOR)).toBeLessThan(WCAG_MIN); // ciemny ginie w nocy
    expect(alone(CORE_COLOR_HEALTHY)).toBeLessThan(WCAG_MIN); // jasny ginie w dniu
    // ...i że nie jest to kwestia nietrafionego wyboru: NAJLEPSZY MOŻLIWY pojedynczy ton
    // osiąga 2,3202 (maksimum minimum po trzech pasmach, przy luminancji 0,18388 —
    // przeszukane z krokiem 1e-5). Odtwarzamy to tutaj, więc liczba jest MIERZONA, nie
    // przepisana: gdyby ktoś zmienił paletę terenu, ta asercja pokaże nową granicę.
    let bestPossible = 0;
    let bestLuminance = 0;
    for (let i = 0; i <= 100000; i++) {
      const l = i / 100000;
      const worst = Math.min(
        ...DEFAULT_PALETTE.map((band) => {
          const lb = luminance(band);
          return (Math.max(l, lb) + 0.05) / (Math.min(l, lb) + 0.05);
        }),
      );
      if (worst > bestPossible) {
        bestPossible = worst;
        bestLuminance = l;
      }
    }
    expect(bestPossible, 'najlepszy możliwy pojedynczy ton').toBeLessThan(WCAG_MIN);
    // Kotwic na 2,3202 i 0,18388 tu NIE MA, choć tyle wychodzi dziś: obie przypinałyby
    // `DEFAULT_PALETTE`, czyli `[WYGLĄD]`-ową stałą CUDZEGO modułu, i zestrojenie palety w
    // Fazie 4 dałoby czerwień w module budynków przy całkowicie zdrowej własności. Chroniona
    // własność brzmi „dwuton jest wymuszony", a nie „granica wynosi tyle a tyle" — i tę
    // pierwszą asercja wyżej wyraża w całości. Kontrola, że przeszukanie w ogóle znalazło
    // sensowne optimum (a nie zatrzymało się na brzegu zakresu):
    expect(bestLuminance).toBeGreaterThan(0);
    expect(bestLuminance).toBeLessThan(1);
  });

  it('2. rampa uszkodzenia NIGDY nie kosztuje widoczności nocnej — jasny ton zostaje jasny na całej długości', () => {
    // Barwa rdzenia jest kanałem NADMIAROWYM dla `hp`, ale rdzeń jest zarazem JEDYNYM
    // tonem budynku widocznym na paśmie nocy. Rampa, która po drodze ciemnieje, kupowałaby
    // czytelność uszkodzenia za cenę zgubienia budynku po ciemnej stronie.
    const buffer = new Float32Array(3);
    let worst = Infinity;
    for (let i = 0; i <= 100; i++) {
      writeCoreColor(i / 100, buffer, 0);
      const tone: Rgb = [buffer[0], buffer[1], buffer[2]];
      worst = Math.min(worst, contrast(tone, DEFAULT_PALETTE[0]));
    }
    expect(worst).toBeGreaterThanOrEqual(WCAG_MIN);
    // Kotwicy na dzisiejszych 4,25 tu NIE MA — oblewałaby przed progiem i czyniła go
    // ozdobnikiem (patrz komentarz przy progach na górze pliku).
  });

  it('3. ciemna obwódka wokół rdzenia ma tę samą szerokość dla KAŻDEGO typu i przekracza próg widoczności', () => {
    // Runda 1 mierzyła `widestRim`, czyli MAKSIMUM po typach — próg 0,35 j. spełniał wtedy
    // wyłącznie `CORE` (1,74 px), a `PYLON` miał **0,59 px**. Obwódka jest zadeklarowanym
    // nośnikiem czytelności budynku na paśmie dnia (rdzeń ma tam kontrast 1,04) i jedynym,
    // co oddziela czerwony rdzeń od pomarańczu zmierzchu (odległość barw 0,195) — dla
    // dziewięciu typów z dziesięciu po prostu jej nie było.
    //
    // Naprawa jest w KODZIE, nie w progu: promień rdzenia liczy się przez odjęcie obwódki o
    // stałej szerokości, więc obwódka nie zależy już od wielkości bryły. Ten test sprawdza
    // jedno i drugie: że jest STAŁA i że najgorszy (tu: każdy) przypadek przekracza próg.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type));
    layer.update(list);
    const rims: number[] = [];
    for (let slot = 0; slot < ALL_TYPES.length; slot++) {
      const shellRadius = basisColumn(matrixAt(layer.shell, slot), 0).length();
      const coreRadius = basisColumn(matrixAt(layer.core, slot), 0).length();
      const rim = shellRadius * SHELL_TAPER - coreRadius;
      expect(coreRadius, `${ALL_TYPES[slot]}: rdzeń wystaje poza szczyt skorupy`).toBeLessThan(
        shellRadius * SHELL_TAPER,
      );
      rims.push(rim);
    }
    // STAŁOŚĆ: różnica między najszerszą a najwęższą obwódką jest zerowa.
    // Rozrzut poniżej 10⁻⁴ jednostki (3·10⁻⁴ px) — czyli szum zaokrągleń float32 w buforze
    // macierzy instancji, nie zależność od typu. Zależność proporcjonalna dawała tu 0,356.
    expect(Math.max(...rims) - Math.min(...rims), 'obwódka zależy od typu').toBeLessThan(1e-4);
    // MINIMUM po populacji, w pikselach.
    expect(px(Math.min(...rims)), 'najwęższa obwódka').toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
    layer.dispose();
  });

});

describe('osadzenie budynku na komórce', () => {
  it('4. bryła stoi w ŚRODKU swojej komórki i jest zorientowana JEJ normalną — zwrócona NA ZEWNĄTRZ, nie do środka', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    const cells = [0, 7, 311, 900, 1441];
    cells.forEach((id) => place(list, id, 'CORE'));
    layer.update(list);

    cells.forEach((id, slot) => {
      const m = matrixAt(layer.shell, slot);
      // Pozycja porównana z `planet.cells[id].center`. To NIE jest źródło niezależne —
      // `geometry.ts` kopiuje `cell.center` wprost do `positions[cellVertexStart[i]]`, więc
      // to te same liczby inną drogą (przegląd rundy 1, znalezisko Z8; raport Zadania 3
      // twierdził inaczej i był w tym za mocny). Ta asercja łapie BŁĄD INDEKSOWANIA —
      // budynek narysowany na cudzej komórce — i tylko tego dotyczy.
      const cell = planet.cells[id];
      const t = translationOf(m);
      expect(t.x, `komórka ${id}`).toBeCloseTo(cell.center.x, 3);
      expect(t.y, `komórka ${id}`).toBeCloseTo(cell.center.y, 3);
      expect(t.z, `komórka ${id}`).toBeCloseTo(cell.center.z, 3);

      // Oś pionowa bryły kontra normalna komórki — asercja KIERUNKOWA (iloczyn skalarny),
      // NIE na wielkości bezwzględnej. `Math.abs`/`Math.hypot` przepuściłyby normalną
      // odwróconą, czyli budynek wbity w planetę zamiast stojący na niej: sylwetka byłaby
      // identyczna co do rozmiaru i niewidoczna w każdym pomiarze bez znaku.
      const up = basisColumn(m, 2).normalize();
      expect(up.dot(new Vector3(cell.normal.x, cell.normal.y, cell.normal.z)), `komórka ${id}`).toBeGreaterThan(0.9999);

      // Baza jest ortonormalna i PRAWOSKRĘTNA (X × Y = Z): lewoskrętna odwróciłaby
      // nawinięcie trójkątów, więc bryła pokazywałaby wnętrze, a odcinanie tylnych ścian
      // wycięłoby jej ściany boczne.
      const x = basisColumn(m, 0).normalize();
      const y = basisColumn(m, 1).normalize();
      expect(x.dot(y), `komórka ${id}`).toBeCloseTo(0, 5);
      expect(x.dot(up), `komórka ${id}`).toBeCloseTo(0, 5);
      expect(new Vector3().crossVectors(x, y).dot(up), `komórka ${id}`).toBeCloseTo(1, 5);

      // Oś X celuje w PIERWSZY NAROŻNIK komórki — dzięki temu sześciokąt budynku leży w
      // kracie z Zadania 2, a nie stoi w niej obrócony o przypadkowy kąt.
      const corner = cell.corners[0];
      const toCorner = new Vector3(
        corner.x - cell.center.x,
        corner.y - cell.center.y,
        corner.z - cell.center.z,
      ).normalize();
      expect(x.dot(toCorner), `komórka ${id}`).toBeGreaterThan(0.99);
    });
    layer.dispose();
  });

  it('5. dziesięć typów daje DZIESIĘĆ różnych brył, i KAŻDA jest większa od progu widoczności', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 20 + k * 13, type));
    layer.update(list);
    expect(layer.shell.count).toBe(10);

    const seen = new Map<string, BuildingType>();
    let smallestRadius = Infinity;
    let smallestHeight = Infinity;
    ALL_TYPES.forEach((type, slot) => {
      const m = matrixAt(layer.shell, slot);
      const radius = basisColumn(m, 0).length();
      const height = basisColumn(m, 2).length();
      // Wymiary zgadzają się z tabelą kształtów przemnożoną przez skalę planety —
      // czyli tabela faktycznie DOCIERA do macierzy, a nie tylko istnieje w module.
      expect(radius, type).toBeCloseTo(planet.radius * BUILDING_RADIUS_FACTOR * BUILDING_SHAPES[type].radius, 3);
      expect(height, type).toBeCloseTo(planet.radius * BUILDING_HEIGHT_FACTOR * BUILDING_SHAPES[type].height, 3);
      const key = `${radius.toFixed(4)}/${height.toFixed(4)}`;
      const clash = seen.get(key);
      expect(clash, `${type} ma tę samą bryłę co ${clash}`).toBeUndefined();
      seen.set(key, type);
      smallestRadius = Math.min(smallestRadius, radius);
      smallestHeight = Math.min(smallestHeight, height);
    });

    // Próg BEZWZGLĘDNY. Do rundy naprawczej 1 tabela kształtów była przypięta wyłącznie do
    // samej siebie, więc `PYLON` o promieniu 0,03 (bryła o średnicy 0,2 piksela — typ
    // znikający z ekranu) przechodził komplet testów: asercje wyżej sprawdzają zgodność
    // macierzy z tabelą i wzajemną różność par, a obie są prawdziwe dla dowolnie małych brył.
    expect(px(smallestRadius), 'najmniejszy promień bryły').toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
    expect(px(smallestHeight), 'najmniejsza wysokość bryły').toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
    layer.dispose();
  });
});

describe('[MUTACJA] stan NIEZASILONY jest widoczny w wyjściu', () => {
  it('6. pierścień alarmu pojawia się DOKŁADNIE przy budynkach bez prądu i znika, gdy prąd wraca', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    const powered = place(list, 200, 'KINETIC_TURRET');
    const alsoPowered = place(list, 400, 'LASER_TURRET');
    const dark = place(list, 600, 'PYLON');
    void alsoPowered;

    layer.update(list);
    expect(layer.shell.count).toBe(3);
    expect(layer.alert.count, 'wszystko zasilone — ani jednego alarmu').toBe(0);

    dark.powered = false;
    layer.update(list);
    expect(layer.alert.count, 'jeden budynek bez prądu — dokładnie jeden alarm').toBe(1);
    // Alarm stoi na komórce TEGO budynku, nie byle którego — asercja, której nie zdałaby
    // implementacja "rysuj pierścień pod każdym budynkiem" ani "pod pierwszym z brzegu".
    // Pierścień leży NAD powierzchnią (`SURFACE_LIFT_FACTOR`), więc porównujemy KIERUNEK:
    // ten sam promień wodzący co środek komórki, i ani jedna inna komórka go nie dzieli.
    const at = translationOf(matrixAt(layer.alert, 0)).normalize();
    const cell = planet.cells[600];
    expect(at.dot(new Vector3(cell.normal.x, cell.normal.y, cell.normal.z))).toBeGreaterThan(0.99999);

    // Drugi budynek gaśnie — licznik rośnie, a nie zostaje na jedynce.
    powered.powered = false;
    layer.update(list);
    expect(layer.alert.count).toBe(2);

    // Prąd wraca wszystkim — pierścienie znikają. Bez tego kroku test przeszedłby dla
    // implementacji, która alarm tylko DODAJE i nigdy nie kasuje.
    dark.powered = true;
    powered.powered = true;
    layer.update(list);
    expect(layer.alert.count).toBe(0);
    layer.dispose();
  });

  it('7. [N1] OBA pasy obręczy zostają widoczne poza bryłą KAŻDEGO z dziesięciu typów', () => {
    // ## Czego runda naprawcza 1 nie pilnowała — i usunęła jedyne, co pilnowało
    //
    // Test 8 mierzył `promień pierścienia − promień bryły`, czyli wielkość SĄSIEDNIĄ wobec
    // tej, o którą chodzi. Widoczność alarmu niesie SZEROKOŚĆ PASÓW, a nie różnica promieni:
    // przy `ALERT_INNER_FACTOR = 0,80` różnica promieni pozostawała ta sama, a jasny pas —
    // nośnik alarmu na paśmie nocy — schodził do **0,08 px**. Ta wartość została odrzucona
    // OBEJRZENIEM w §5.3 raportu i oblewała w rundzie 0; runda 1 skasowała tę ochronę.
    // `ALERT_SPLIT_FACTOR` nie był dotykany przez żadną asercję w całym `test/`: 0,63
    // zabijało pas jasny, 0,99 pas ciemny, oba przechodziły komplet.
    //
    // Promienie obu krawędzi czytane są z FAKTYCZNEJ geometrii pierścienia (bufor pozycji
    // warstwy w scenie), nie ze stałych modułu.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type, { powered: false }));
    layer.update(list);
    expect(layer.alert.count).toBe(10);

    const { inner, split, outer } = alertBandRadii(layer);
    expect(inner).toBeLessThan(split);
    expect(split).toBeLessThan(outer);

    let worstAmber = Infinity;
    let worstDark = Infinity;
    let worstAmberType: BuildingType = ALL_TYPES[0];
    let worstDarkType: BuildingType = ALL_TYPES[0];
    ALL_TYPES.forEach((type, slot) => {
      const scale = basisColumn(matrixAt(layer.alert, slot), 0).length();
      const shellRadius = basisColumn(matrixAt(layer.shell, slot), 0).length();
      // Bryła jest nieprzezroczysta i wyższa od pierścienia, więc zasłania wszystko poniżej
      // swojego promienia. Widoczne jest wyłącznie to, co zostaje NA ZEWNĄTRZ.
      const amber = Math.max(0, split * scale - Math.max(inner * scale, shellRadius));
      const dark = Math.max(0, outer * scale - Math.max(split * scale, shellRadius));
      if (amber < worstAmber) {
        worstAmber = amber;
        worstAmberType = type;
      }
      if (dark < worstDark) {
        worstDark = dark;
        worstDarkType = type;
      }
    });
    expect(px(worstAmber), `najwęższy pas JASNY (${worstAmberType}) — nośnik alarmu na nocy`).toBeGreaterThanOrEqual(
      MIN_VISIBLE_PX,
    );
    expect(px(worstDark), `najwęższy pas CIEMNY (${worstDarkType}) — nośnik na dniu i zmierzchu`).toBeGreaterThanOrEqual(
      MIN_VISIBLE_PX,
    );
    layer.dispose();
  });

  it('8. [NIEZMIENNIK] pierścień i bryła NIE wychodzą poza komórkę w ŻADNEJ z 1442 komórek', () => {
    // ## Co ten test mierzył ŹLE do rundy naprawczej 1
    //
    // Porównywał promień pierścienia z `min|narożnik − środek| × (1 − OUTLINE_INSET)`, czyli
    // z promieniem OPISANYM komórki. Obrys nie przechodzi przez narożniki — to zamknięta
    // pętla po nich — więc okrąg mieści się w nim wtedy i tylko wtedy, gdy jest mniejszy od
    // promienia WPISANEGO. Pierścień o promieniu 3,808 przechodził ten test i JEDNOCZEŚNIE
    // wychodził poza kratę w 12 komórkach i wchodził na sąsiada w 72.
    const { angle: edgeAngle, cellId } = minOutlineEdgeAngle();

    // KONTROLA PRZYRZĄDU, bez przypinania cudzych stałych. Runda 1 miała tu `toBeCloseTo`
    // na wartości zależnej od `OUTLINE_INSET` (`planetMesh.ts`, `[WYGLĄD]`) — zestrojenie
    // tamtej stałej oblewało ten test, choć chroniony niezmiennik trzymał się z zapasem.
    // Zamiast liczby: własności STRUKTURALNE, prawdziwe dla każdego wciągnięcia obrysu.
    const cornerAngle = minOutlineCornerAngle();
    expect(edgeAngle, 'krawędź musi leżeć BLIŻEJ środka niż narożnik').toBeLessThan(cornerAngle);
    expect(cellId, 'najciaśniejsza komórka jest pięciokątem').toBeLessThan(12);
    expect(planet.cells[cellId].corners.length).toBe(5);

    const lift = planet.radius * SURFACE_LIFT_FACTOR;
    const maxRingRadius = Math.tan(edgeAngle) * (planet.radius + lift);

    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type, { powered: false }));
    layer.update(list);

    let widestRing = 0;
    let widestShell = 0;
    for (let slot = 0; slot < ALL_TYPES.length; slot++) {
      widestRing = Math.max(widestRing, basisColumn(matrixAt(layer.alert, slot), 0).length());
      widestShell = Math.max(widestShell, basisColumn(matrixAt(layer.shell, slot), 0).length());
    }
    expect(widestRing, `pierścień (${widestRing.toFixed(4)}) wychodzi poza krawędź obrysu`).toBeLessThan(maxRingRadius);
    // Ta sama granica dotyczy BRYŁY: budynek też jest okrągły i też nie może wyjść z komórki.
    expect(widestShell).toBeLessThan(Math.tan(edgeAngle) * planet.radius);

    // Uwaga do przeglądu: padła prośba o dołożenie asercji „krawędź wewnętrzna obręczy chowa
    // się pod bryłą", bo widoczna obręcz liczona jako RÓŻNICA PROMIENI jest prawdziwa tylko
    // pod tym warunkiem. Zamiast dokładać strażnika do wadliwej miary — USUNĄŁEM MIARĘ:
    // test 7 liczy każdy pas z osobna, biorąc `max(krawędź_wewnętrzna, promień_bryły)`, więc
    // jest poprawny NIEZALEŻNIE od tego, czy zasłonięcie zachodzi. Asercja na samym
    // zasłonięciu przypinałaby dzisiejszy układ i oblewała przy każdym zestrojeniu
    // `ALERT_INNER_FACTOR`, które własności nie narusza (sprawdzone: para Q7b).
    layer.dispose();
  });
});

describe('[MUTACJA] stan USZKODZONY jest widoczny w wyjściu', () => {
  it('9. rdzeń kurczy się i czerwienieje MONOTONICZNIE, a NAJMNIEJSZY typ nadal to pokazuje', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    const building = place(list, 300, 'CORE');
    const maxHp = BUILDINGS.CORE.hp;

    const radii: number[] = [];
    const redness: number[] = [];
    for (const fraction of [1, 0.75, 0.5, 0.25, 0]) {
      building.hp = maxHp * fraction;
      layer.update(list);
      radii.push(basisColumn(matrixAt(layer.core, 0), 0).length());
      const c = instanceColorAt(layer.core, 0);
      redness.push(c[0] - c[1]); // przewaga czerwieni nad zielenią — wielkość ZE ZNAKIEM
    }
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i], `krok ${i}`).toBeLessThan(radii[i - 1]);
      expect(redness[i], `krok ${i}`).toBeGreaterThan(redness[i - 1]);
    }

    // Kanał geometryczny ograniczamy POLEM (to ono, nie promień, decyduje o tym, jak bardzo
    // plama skurczyła się dla oka). Runda 1 pinowała oba końce rampy do stałych, których
    // pilnowała, więc `CORE_SCALE_MIN = 0,985` przechodziło komplet testów.
    const areaRatio = (radii[radii.length - 1] / radii[0]) ** 2;
    expect(areaRatio, 'pole rdzenia przy zerowym hp').toBeLessThanOrEqual(MAX_CORE_AREA_AT_ZERO_HP);

    // --- MINIMUM PO POPULACJI, w pikselach (runda naprawcza 2) -------------------------
    // Runda 1 mierzyła skok promienia wyłącznie dla `CORE`, czyli dla NAJWIĘKSZEJ bryły.
    // Obie wielkości muszą przekroczyć próg dla NAJMNIEJSZEJ: rdzeń przy zerowym `hp` (bo to
    // jedyny ton widoczny na nocy) ORAZ skok promienia (bo to on jest sygnałem uszkodzenia).
    // Ich suma to promień rdzenia przy pełnym `hp`, więc ciągną w przeciwne strony.
    const wide = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(wide, 100 + k * 7, type));
    layer.update(wide);
    const full = ALL_TYPES.map((_, slot) => basisColumn(matrixAt(layer.core, slot), 0).length());
    ALL_TYPES.forEach((type, k) => {
      wide[100 + k * 7] = { cellId: 100 + k * 7, type, hp: 0, powered: true };
    });
    layer.update(wide);
    const empty = ALL_TYPES.map((_, slot) => basisColumn(matrixAt(layer.core, slot), 0).length());

    let worstRemaining = Infinity;
    let worstDrop = Infinity;
    let worstRemainingType: BuildingType = ALL_TYPES[0];
    let worstDropType: BuildingType = ALL_TYPES[0];
    ALL_TYPES.forEach((type, k) => {
      if (empty[k] < worstRemaining) {
        worstRemaining = empty[k];
        worstRemainingType = type;
      }
      if (full[k] - empty[k] < worstDrop) {
        worstDrop = full[k] - empty[k];
        worstDropType = type;
      }
    });
    expect(px(worstRemaining), `rdzeń przy zerowym hp, najgorszy typ (${worstRemainingType})`).toBeGreaterThanOrEqual(
      MIN_VISIBLE_PX,
    );
    expect(px(worstDrop), `skok promienia rdzenia, najgorszy typ (${worstDropType})`).toBeGreaterThanOrEqual(
      MIN_VISIBLE_PX,
    );

    // Kanał barwny musi być BARWNY, nie tylko monotoniczny: szarość o identycznej luminancji
    // przechodziła wszystko, bo kontrast wobec każdego pasma zostawał bez zmiany.
    const criticalTone = instanceColorAt(layer.core, 0);
    const grey = luminance(criticalTone);
    expect(srgbDistance(criticalTone, [grey, grey, grey]), 'nasycenie barwy krytycznej').toBeGreaterThanOrEqual(
      MIN_CRITICAL_CHROMA,
    );
    layer.dispose();
  });

  it('10. uszkodzenie rusza WYŁĄCZNIE rdzeń, brak prądu WYŁĄCZNIE pierścień — dwa stany, dwa rozłączne kanały', () => {
    // Gdyby `hp` skalowało całą bryłę, uszkodzony CORE wyglądałby jak zdrowy BARRICADE i
    // kodowanie typu zjadłoby kodowanie stanu. Gdyby brak prądu ruszał rdzeń, dwa stany
    // zlałyby się w jeden odczyt.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    const building = place(list, 300, 'CORE');

    layer.update(list);
    const shellFull = matrixAt(layer.shell, 0).elements.slice();
    const coreFull = matrixAt(layer.core, 0).elements.slice();
    const colorFull = instanceColorAt(layer.core, 0);

    building.hp = BUILDINGS.CORE.hp * 0.3;
    layer.update(list);
    expect([...matrixAt(layer.shell, 0).elements], 'skorupa NIE reaguje na hp').toEqual([...shellFull]);
    expect([...matrixAt(layer.core, 0).elements], 'rdzeń reaguje na hp').not.toEqual([...coreFull]);

    const coreDamaged = matrixAt(layer.core, 0).elements.slice();
    const colorDamaged = instanceColorAt(layer.core, 0);
    building.powered = false;
    layer.update(list);
    expect([...matrixAt(layer.core, 0).elements], 'rdzeń NIE reaguje na prąd').toEqual([...coreDamaged]);
    expect(instanceColorAt(layer.core, 0), 'barwa rdzenia NIE reaguje na prąd').toEqual(colorDamaged);
    expect(layer.alert.count, 'pierścień reaguje na prąd').toBe(1);
    expect(colorDamaged).not.toEqual(colorFull);
    layer.dispose();
  });

  it('11. hp poza zakresem nie wysadza renderu ani nie odwraca kodowania', () => {
    // `combat.ts` odejmuje obrażenia zanim sprzątnie budynek, więc `hp <= 0` jest stanem
    // POPRAWNYM przez jeden tick. Render, który by na nim rzucał, wysadziłby aplikację.
    expect(healthFraction(-40, 100)).toBe(0);
    expect(healthFraction(0, 100)).toBe(0);
    expect(healthFraction(140, 100)).toBe(1);
    expect(healthFraction(Number.NaN, 100)).toBe(0);
    expect(() => healthFraction(50, 0)).toThrow(RangeError);
    expect(() => healthFraction(50, -1)).toThrow(RangeError);
    // Przycięcie musi trzymać rdzeń W OKNIE, a nie tylko nie rzucać.
    expect(coreScale(healthFraction(-40, 100))).toBe(CORE_SCALE_MIN);
    expect(coreScale(healthFraction(140, 100))).toBe(1);

    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    place(list, 300, 'CORE', { hp: -10 });
    expect(() => layer.update(list)).not.toThrow();
    expect(basisColumn(matrixAt(layer.core, 0), 0).length()).toBeGreaterThan(0);
    layer.dispose();
  });
});

describe('warstwa jako całość', () => {
  it('12. puste sloty są pomijane, a licznik instancji równa się liczbie budynków — także przy komplecie 1442', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    layer.update(list);
    expect(layer.shell.count).toBe(0);
    expect(layer.core.count).toBe(0);
    expect(layer.alert.count).toBe(0);

    for (let i = 0; i < CELL_COUNT; i++) {
      place(list, i, ALL_TYPES[i % ALL_TYPES.length], { powered: i % 3 !== 0 });
    }
    layer.update(list);
    expect(layer.shell.count).toBe(CELL_COUNT);
    expect(layer.core.count).toBe(CELL_COUNT);
    expect(layer.alert.count).toBe(Math.ceil(CELL_COUNT / 3));
    // Ostatnia instancja też ma sensowną macierz — pojemność 1442 jest FAKTYCZNA, nie
    // deklarowana (przepełnienie bufora w Three.js gubi zapis po cichu).
    const last = translationOf(matrixAt(layer.shell, CELL_COUNT - 1));
    expect(last.length()).toBeCloseTo(planet.radius, 1);
    layer.dispose();
  });

  it('13. rzuca RangeError na rozjazdach, których nic nie wiąże składniowo', () => {
    const layer = createBuildingLayer(planet, geo);
    expect(() => layer.update(new Array<Building | null>(10).fill(null))).toThrow(RangeError);

    const mismatched = emptyBuildings();
    mismatched[5] = { cellId: 6, type: 'PYLON', hp: 80, powered: true };
    expect(() => layer.update(mismatched)).toThrow(/cellId/);

    const unknown = emptyBuildings();
    unknown[5] = { cellId: 5, type: 'WIEŻA_Z_KOŚCI' as BuildingType, hp: 80, powered: true };
    expect(() => layer.update(unknown)).toThrow(/unknown building type/);

    layer.dispose();
    // Geometria opisująca inną liczbę komórek niż planeta — dwie struktury indeksowane tym
    // samym `cellId`, których nic nie wiąże składniowo.
    expect(() =>
      createBuildingLayer(planet, {
        ...geo,
        cellVertexStart: geo.cellVertexStart.slice(0, 10),
        cellVertexCount: geo.cellVertexCount.slice(0, 10),
      }),
    ).toThrow(RangeError);
  });

  it('14. update() NICZEGO nie mutuje — ani listy budynków, ani buforów geometrii, z których czyta', () => {
    // ## Dlaczego ten test buduje WŁASNĄ geometrię (runda naprawcza 2)
    //
    // Runda 1 hashowała wspólny, modułowy `geo` — a ten jest stanem dzielonym przez wszystkie
    // testy pliku, i test 12 obsadza nim wszystkie 1442 komórki ZANIM ten test się wykona.
    // „Stan przed" był więc brany z bufora już ewentualnie skażonego. Odczyt przeglądu:
    // `geo.positions[c] = 0` w `writeInstance` PRZECHODZIŁO ten test w pełnym przebiegu
    // pliku, a OBLEWAŁO w izolacji — strażnik zależny od kolejności jest gorszy niż jego
    // brak, bo daje fałszywą pewność. Świeża geometria znosi zależność od kolejności i od
    // idempotentności skażenia.
    const freshGeo = buildPlanetGeometry(planet);
    const layer = createBuildingLayer(planet, freshGeo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 30 + k * 11, type, { hp: BUILDINGS[type].hp * 0.4, powered: k % 2 === 0 }));

    const hashes = (): string[] =>
      [freshGeo.positions, freshGeo.normals, freshGeo.indices, freshGeo.cellVertexStart, freshGeo.cellVertexCount].map(
        (buffer) =>
          createHash('sha256').update(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)).digest('hex'),
      );
    const buildingsBefore = JSON.stringify(list);
    const geometryBefore = hashes();
    layer.update(list);
    layer.update(list);
    expect(JSON.stringify(list)).toBe(buildingsBefore);
    expect(hashes()).toEqual(geometryBefore);
    layer.dispose();
  });

  it('15. warstwa jest DZIECKIEM siatki terenu — schowanie planety chowa też budynki', () => {
    // To jest własność, na której opiera się kontrola pozytywna bramki czytelności:
    // `visible` w Three.js jest dziedziczne, więc schowanie planety chowa też wszystko, co
    // pokazuje stan komórek. Gdyby warstwa była RODZEŃSTWEM siatki, zostałaby widoczna w
    // trybie, który ma pokazywać WYŁĄCZNIE siatkę kontrolną (patrz test 33 w
    // `readabilityGate.test.ts`) — i nikt by tego nie zauważył aż do Zadania 5.
    //
    // Mierzone na SCENIE, którą renderer faktycznie dostaje do narysowania, i BEZ
    // wymieniania typów: „rysowalny" to tutaj „ma geometrię", dokładnie jak w teście 33.
    let lastScene: Scene | null = null;
    const renderer: SceneRenderer = {
      render: (scene: Scene): void => {
        lastScene = scene;
      },
      setSize: (): void => {},
      setPixelRatio: (): void => {},
      setClearColor: (): void => {},
      dispose: (): void => {},
    };
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => renderer);
    const list = emptyBuildings();
    place(list, 300, 'CORE', { powered: false });
    scene.updateBuildings(list);
    scene.render(new Float32Array(CELL_COUNT), { x: 1, y: 0, z: 0 });

    const drawables = (): { object: Object3D; visible: boolean }[] => {
      const root = lastScene;
      if (!root) throw new Error('test: renderer nie dostał sceny');
      const out: { object: Object3D; visible: boolean }[] = [];
      root.traverse((object) => {
        if (!('geometry' in object)) return;
        let visible = true;
        for (let node: Object3D | null = object; node; node = node.parent) {
          if (!node.visible) {
            visible = false;
            break;
          }
        }
        out.push({ object, visible });
      });
      return out;
    };

    // Teren + krata + trzy warstwy budynków = pięć rysowalnych, wszystkie widoczne.
    const before = drawables();
    expect(before.length).toBe(5);
    expect(before.every((d) => d.visible)).toBe(true);
    const terrain = before.find((d) => d.object.parent === lastScene);
    expect(terrain, 'siatka terenu jest jedynym rysowalnym dzieckiem sceny').toBeDefined();

    // Schowanie SAMEJ planety — nic nie wie o budynkach — musi wygasić wszystko.
    terrain!.object.visible = false;
    const after = drawables();
    expect(after.length).toBe(5);
    expect(after.filter((d) => d.visible)).toEqual([]);

    scene.dispose();
  });
});

describe('budżet klatki', () => {
  it('16. update() nie alokuje NICZEGO: 600 wywołań przy komplecie 1442 budynków nie wywołuje ani jednego cyklu odśmiecania', () => {
    // Ta warstwa przepisuje do 1442 × 3 macierze co klatkę — to jest dokładnie to miejsce,
    // w którym alokacja per budynek (jeden `Matrix4`, jeden `Vector3`, jedna tablica barwy)
    // byłaby niewidoczna w zegarze, a zauważalna w odśmiecaniu. Przyrząd i jego uzasadnienie:
    // patrz długi komentarz w `budget.test.ts`.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    for (let i = 0; i < CELL_COUNT; i++) {
      place(list, i, ALL_TYPES[i % ALL_TYPES.length], {
        hp: BUILDINGS[ALL_TYPES[i % ALL_TYPES.length]].hp * ((i % 7) / 6),
        powered: i % 3 !== 0,
      });
    }
    let sink = 0;

    function gcCyclesDuring(run: () => void): number {
      const profiler = new GCProfiler();
      profiler.start();
      run();
      return profiler.stop().statistics.length;
    }

    /** Kontrola: DOKŁADNIE ta sama praca plus jedna macierz na budynek — realny błąd. */
    function allocatingVariant(): number {
      layer.update(list);
      let acc = 0;
      for (let i = 0; i < CELL_COUNT; i++) acc += new Matrix4().elements[0];
      return acc;
    }

    // 600, nie 2000 jak w `budget.test.ts`: tam jedno wywołanie kosztuje 0,02 ms, tutaj
    // 0,19 ms (1442 budynki × 3 warstwy), więc okno 2000 wywołań × pięć przebiegów zajmuje
    // procesor na ok. 2 sekundy — a vitest uruchamia pliki RÓWNOLEGLE i wywracało to
    // `packages/sim/test/light.test.ts` (20 000 wywołań przy limicie 5 s) przez samą walkę
    // o rdzeń. Zmierzone: bez tego pliku pakiet przechodzi, z nim w wersji 2000-krotnej
    // oblewał tamten test w 3 przebiegach na 4. 600 wywołań przy KOMPLECIE 1442 budynków to
    // wciąż 865 tysięcy przepisań instancji w jednym oknie, czyli dziesięć sekund rozgrywki
    // przy 60 Hz — a wariant alokujący daje w tym samym oknie kilkanaście cykli, więc czułość
    // przyrządu zostaje (patrz kontrola pozytywna niżej).
    const ITERATIONS = 600;
    for (let i = 0; i < 100; i++) {
      layer.update(list);
      sink += allocatingVariant();
    }

    const emptyLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) sink += i;
    };
    const measuredLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) layer.update(list);
    };
    const controlLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) sink += allocatingVariant();
    };

    const emptyRuns = [gcCyclesDuring(emptyLoop), gcCyclesDuring(emptyLoop), gcCyclesDuring(emptyLoop)];
    const measuredRuns = [gcCyclesDuring(measuredLoop), gcCyclesDuring(measuredLoop), gcCyclesDuring(measuredLoop)];
    const controlRuns = [gcCyclesDuring(controlLoop), gcCyclesDuring(controlLoop)];
    const measuredAfterControl = gcCyclesDuring(measuredLoop);

    console.log(
      `[BUDGET] cykle GC na ${ITERATIONS} wywołań BuildingLayer.update @ ${CELL_COUNT} budynków — pusta pętla: ${emptyRuns.join('/')}, update: ${measuredRuns.join('/')} (po kontroli: ${measuredAfterControl}), kontrola +${CELL_COUNT} Matrix4/wyw.: ${controlRuns.join('/')}`,
    );

    expect(Math.min(...controlRuns)).toBeGreaterThanOrEqual(3);
    expect(Math.min(...emptyRuns)).toBe(0);
    expect(Math.min(...measuredRuns, measuredAfterControl)).toBe(0);
    expect(sink).not.toBe(0);
    layer.dispose();
  });
});

describe('buildCellBases — funkcja czysta', () => {
  it('17. dla KAŻDEJ z 1442 komórek baza jest ortonormalna i styczna do kuli', () => {
    const bases = buildCellBases(geo);
    expect(bases.length).toBe(CELL_COUNT * 6);
    let checked = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      const o = i * 6;
      const t1 = new Vector3(bases[o], bases[o + 1], bases[o + 2]);
      const t2 = new Vector3(bases[o + 3], bases[o + 4], bases[o + 5]);
      const n = planet.cells[i].normal;
      const normal = new Vector3(n.x, n.y, n.z);
      expect(t1.length(), `komórka ${i}`).toBeCloseTo(1, 5);
      expect(t2.length(), `komórka ${i}`).toBeCloseTo(1, 5);
      expect(t1.dot(t2), `komórka ${i}`).toBeCloseTo(0, 5);
      expect(t1.dot(normal), `komórka ${i}`).toBeCloseTo(0, 4);
      expect(t2.dot(normal), `komórka ${i}`).toBeCloseTo(0, 4);
      // PRAWOSKRĘTNOŚĆ — ze znakiem. Odwrócony `t2` dałby te same długości i te same
      // zera w iloczynach skalarnych.
      expect(new Vector3().crossVectors(t1, t2).dot(normal), `komórka ${i}`).toBeCloseTo(1, 4);
      checked++;
    }
    expect(checked).toBe(1442);
  });

  it('18. rzuca RangeError dla komórki bez narożników', () => {
    expect(() =>
      buildCellBases({
        positions: new Float32Array(9),
        normals: new Float32Array(9),
        indices: new Uint32Array(0),
        cellVertexStart: Uint32Array.of(0),
        cellVertexCount: Uint32Array.of(3),
      }),
    ).toThrow(RangeError);
  });

  it('19. pierścień alarmu jest STAŁY: ten sam dla każdego typu, każdej komórki i niezależny od zegara', () => {
    // Do rundy naprawczej 2 ten numer trzymał własności pulsu. Puls odpadł (patrz
    // `ALERT_RADIUS_FACTOR`), a własność, która została, też wymaga strażnika: alarm ma być
    // JEDNAKOWY, bo alarm o zmiennej wielkości byłby najsłabszy akurat przy najmniejszych
    // budynkach — a najmniejszy z nich to `PYLON`, czyli szkielet sieci energetycznej,
    // której awarię ten alarm zgłasza.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type, { powered: false }));
    layer.update(list);
    const radii = ALL_TYPES.map((_, slot) => basisColumn(matrixAt(layer.alert, slot), 0).length());
    expect(Math.max(...radii) - Math.min(...radii), 'promień alarmu zależy od typu').toBeLessThan(1e-4);

    // Niezależność od zegara — ten sam stan wywołany dwa razy daje bufor co do bitu ten sam.
    const before = [...(layer.alert.instanceMatrix.array as Float32Array).slice(0, 10 * 16)];
    layer.update(list);
    expect([...(layer.alert.instanceMatrix.array as Float32Array).slice(0, 10 * 16)]).toEqual(before);
    layer.dispose();
  });
});

describe('nawinięcie trójkątów — nawrót defektu, który w tym zadaniu wystąpił (runda naprawcza 1)', () => {
  it('20. KAŻDY trójkąt każdej z trzech warstw jest zwrócony NA ZEWNĄTRZ — inaczej odcinanie tylnych ścian zjada warstwę', () => {
    // Pierścień alarmu nie renderował się w ogóle, bo jego trójkąty były nawinięte odwrotnie
    // i `side: FrontSide` wycinał całą warstwę. Znalazły to dopiero oczy, po zielonym
    // pakiecie, a raport Zadania 3 twierdził, że testu na to nie da się tanio napisać bez
    // GPU. Przegląd pokazał, że to nieprawda — nawinięcie jest własnością arytmetyczną
    // bufora pozycji i indeksów, nie własnością rasteryzacji.
    //
    // Geometrie brane ze SCENY (`layer.shell.geometry` …), a nie z osobno wywołanych
    // funkcji budujących: sprawdzane jest to, co trafia do renderera.
    const layer = createBuildingLayer(planet, geo);

    // Skorupa: bryła wypukła wokół punktu (0, 0, 0.5) w przestrzeni lokalnej (podstawa w
    // z = 0, szczyt w z = 1), więc każda ściana ma patrzeć OD tego punktu.
    const insideShell = new Vector3(0, 0, 0.5);
    const shell = windingReport(layer.shell.geometry, (centroid) => centroid.clone().sub(insideShell));
    expect(shell.triangles, 'ścian bocznych + pokrywa').toBe(18);
    expect(shell.wrong, 'skorupa: trójkąty zwrócone do wnętrza').toBe(0);
    expect(shell.worstDot).toBeGreaterThan(0.5);

    // Rdzeń i pierścień: płaskie, leżą w z = 0 i mają patrzeć wzdłuż +Z.
    const up = new Vector3(0, 0, 1);
    const core = windingReport(layer.core.geometry, () => up);
    expect(core.triangles).toBe(6);
    expect(core.wrong, 'rdzeń: trójkąty zwrócone w dół').toBe(0);
    expect(core.worstDot).toBeCloseTo(1, 9);

    const alert = windingReport(layer.alert.geometry, () => up);
    expect(alert.triangles, 'dwa pasy × 24 boki × 2 trójkąty').toBe(96);
    expect(alert.wrong, 'pierścień: trójkąty zwrócone w dół — DOKŁADNIE defekt z Zadania 3').toBe(0);
    expect(alert.worstDot).toBeCloseTo(1, 9);

    layer.dispose();
  });
});

describe('uniesienie rdzenia ponad skorupę (runda naprawcza 1)', () => {
  it('21. rdzeń stoi NAD pokrywą skorupy o więcej niż rozdzielczość bufora głębokości', () => {
    // `SURFACE_LIFT_FACTOR = 0` przechodziło komplet testów, choć cała ta stała istnieje po
    // to, żeby rdzeń nie leżał w TEJ SAMEJ płaszczyźnie co pokrywa skorupy. Skutkiem zera
    // jest migotanie — widoczne wyłącznie na GPU, czyli NIGDY w CI, i objawiłoby się jako
    // „budynki migoczą" w losowym późniejszym zadaniu, bez śladu prowadzącego tutaj.
    //
    // Próg liczony ze stałych `camera.ts`, NIE z testowanej stałej: przy 24-bitowym buforze
    // głębokości rozdzielczość w odległości `z` wynosi `z²(far − near)/(near · far · 2²⁴)`.
    const near = planet.radius * 0.01;
    const far = planet.radius * MAX_DISTANCE_FACTOR * 2;
    const furthest = planet.radius * (MAX_DISTANCE_FACTOR - 1); // kamera nad powierzchnią
    const depthResolution = (furthest * furthest * (far - near)) / (near * far * 2 ** 24);
    expect(depthResolution).toBeCloseTo(0.0292, 4); // kotwica na sam przyrząd

    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type));
    layer.update(list);
    for (let slot = 0; slot < ALL_TYPES.length; slot++) {
      // Mierzone na FAKTYCZNYCH macierzach: pokrywa skorupy to jej przesunięcie plus pełna
      // trzecia kolumna bazy (wysokość), rdzeń to jego własne przesunięcie.
      const shellMatrix = matrixAt(layer.shell, slot);
      const shellTop = translationOf(shellMatrix).add(basisColumn(shellMatrix, 2));
      const lift = translationOf(matrixAt(layer.core, slot)).sub(shellTop);
      const normal = basisColumn(shellMatrix, 2).normalize();
      // ZE ZNAKIEM: rdzeń ma stać NAD skorupą, nie pod nią. Wielkość bezwzględna
      // przepuściłaby uniesienie ujemne, czyli rdzeń schowany we wnętrzu bryły.
      expect(lift.dot(normal), ALL_TYPES[slot]).toBeGreaterThanOrEqual(depthResolution * 3);
    }
    // Górna granica, ta sama reguła co dla `OUTLINE_LIFT`: poniżej 5% średnicy najmniejszej
    // komórki, żeby przy limbie nic nie nawisało nad sąsiadem.
    expect(planet.radius * SURFACE_LIFT_FACTOR).toBeLessThan(0.05 * 2 * smallestCellRadius());
    layer.dispose();
  });
});

describe('konwencja [WYGLĄD] (runda naprawcza 1)', () => {
  it('22. KAŻDA stała modułu — także tablicowa i obiektowa — jest oznaczona `// [WYGLĄD]`', () => {
    // `global-constraints.md`: „Każda liczba czysto wizualna oznaczona `// [WYGLĄD]`".
    // Runda 1 wymagała wartości SKALARNEJ, więc regex nie widział pięciu stałych barwnych
    // ani `BUILDING_SHAPES` — 13 z 19. Teraz strażnik bierze każdą deklarację `const` na
    // poziomie modułu i szuka markera gdziekolwiek między jej początkiem a średnikiem
    // kończącym, więc obejmuje literały wielolinijkowe.
    const source = readFileSync(new URL('../src/buildingMesh.ts', import.meta.url), 'utf8');
    const lines = source.split('\n');
    const declarations: { name: string; marked: boolean }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const head = /^(?:export )?const ([A-Za-z_][A-Za-z_0-9]*)/.exec(lines[i]);
      if (!head) continue;
      let body = lines[i];
      let j = i;
      while (!/;\s*(\/\/.*)?$/.test(lines[j]) && j + 1 < lines.length) {
        j++;
        body += '\n' + lines[j];
      }
      declarations.push({ name: head[1], marked: body.includes('[WYGLĄD]') });
    }
    // Kontrola na sam przyrząd: musi znaleźć WSZYSTKIE stałe modułu, także te wielolinijkowe.
    expect(declarations.map((d) => d.name)).toContain('BUILDING_SHAPES');
    expect(declarations.map((d) => d.name)).toContain('SHELL_COLOR');
    // Dolna granica LUŹNA (dziś jest ich 17): przypięta liczba oblewałaby przy dołożeniu
    // albo usunięciu stałej, czyli przy zmianie, która z konwencją nie ma nic wspólnego.
    // Przed regresją samego regexu bronią dwie asercje wyżej — skalarna i wielolinijkowa.
    expect(declarations.length, 'regex przestał widzieć deklaracje').toBeGreaterThanOrEqual(12);
    const unmarked = declarations.filter((d) => !d.marked).map((d) => d.name);
    expect(unmarked, `stałe bez markera: ${unmarked.join(', ')}`).toEqual([]);
  });
});
