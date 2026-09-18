import { describe, expect, it } from 'vitest';
import { describeGcWindows, gcMedian, gcNoiseLimit, measureGcWindows } from './support/gcWindows.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, type BufferAttribute, type BufferGeometry, type Object3D, type Scene } from 'three';
import {
  BUILDINGS,
  createPlanet,
  OUTAGE_SHED,
  OUTAGE_UNLINKED,
  type Building,
  type BuildingType,
} from '@heliopolis/sim';
import { buildPlanetGeometry } from '../src/geometry.js';
import {
  alertSpans,
  buildAlertGeometry,
  buildCellBases,
  coreScale,
  createBuildingLayer,
  healthFraction,
  writeCoreColor,
  ALERT_BREAK_COUNT,
  ALERT_BREAK_FRACTION,
  ALERT_COLOR_DARK,
  ALERT_COLOR_LIGHT,
  ALERT_INNER_FACTOR,
  alertPulse,
  ALERT_PULSE_AMPLITUDE_FACTOR,
  ALERT_PULSE_PERIOD_SECONDS,
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
  ALERT_SIDES,
} from '../src/buildingMesh.js';
import { DEFAULT_OUTLINE_PALETTE, DEFAULT_PALETTE, type Rgb } from '../src/shading.js';
import { buildCellOutlines } from '../src/planetMesh.js';
import { MAX_DISTANCE_FACTOR } from '../src/camera.js';
import { createSceneWithRenderer, type SceneRenderer } from '../src/scene.js';
import { createFakeCanvas } from './support/fakeCanvas.js';
import { MIN_VISIBLE_PX, pixelsPerUnit, pixelsPerUnitFacingClosest } from './support/pixelScale.js';

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
// ## Przelicznik jednostek świata na piksele — WYPROWADZANY, nie przepisywany
//
// Skala bierze się ze stałych `camera.ts` (`INITIAL_DISTANCE_FACTOR`, `FIELD_OF_VIEW_DEGREES`
// — obie `[WYGLĄD]`, obie strojalne w Fazie 4) plus jawnego założenia o wysokości płótna.
// Wyprowadzenie, jego kontrola negatywna (naiwne `R/d` daje obalone 3,22) i powód, dla
// którego ta liczba NIE jest już literałem w dwóch plikach: `support/pixelScale.ts`.
// Kotwica na sam przyrząd stoi w `camera.test.ts`, czyli tam, gdzie mieszkają stałe — więc
// zmiana kadrowania oblewa Z NAZWY, a nie dopiero przez próg pikselowy pięć plików dalej.
const PIXELS_PER_UNIT = pixelsPerUnit(planet.radius);
const px = (world: number): number => world * PIXELS_PER_UNIT;

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

    // ...I TO SAMO NA SZCZYCIE PULSU. Puls jest DOMYŚLNYM wyglądem gry (ustalenie U2 bramki
    // Zadania 5); sama WARSTWA nie zna zegara, więc bez argumentu rysuje spoczynek, a
    // wychylenie do `ALERT_PULSE_AMPLITUDE_FACTOR` wnosi wywołujący. Niezmiennik „pierścień
    // nie wychodzi z komórki" musi więc obowiązywać przy MAKSYMALNYM wychyleniu, nie tylko w
    // spoczynku — bo to wychylenie maksymalne jest tym, co widzi gracz. Para mutacji na samej
    // stałej jest w teście 23.
    const maxPulse = planet.radius * ALERT_PULSE_AMPLITUDE_FACTOR;
    layer.update(list, undefined, maxPulse);
    let widestPulsedRing = 0;
    for (let slot = 0; slot < ALL_TYPES.length; slot++) {
      widestPulsedRing = Math.max(widestPulsedRing, basisColumn(matrixAt(layer.alert, slot), 0).length());
    }
    expect(widestPulsedRing, 'szczyt pulsu musi być WIĘKSZY od spoczynku').toBeGreaterThan(widestRing);
    expect(
      widestPulsedRing,
      `pierścień na szczycie pulsu (${widestPulsedRing.toFixed(4)}) wychodzi poza krawędź obrysu (${maxRingRadius.toFixed(4)})`,
    ).toBeLessThan(maxRingRadius);
    // Amplituda ponad sufit musi RZUCAĆ, a nie po cichu wyprowadzić pierścień z komórki.
    expect(() => layer.update(list, undefined, maxPulse * 1.0001)).toThrow(RangeError);
    expect(() => layer.update(list, undefined, -1e-9)).toThrow(RangeError);
    layer.update(list); // powrót do spoczynku — reszta testu mierzy konfigurację produkcyjną
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

    // Teren + krata + CZTERY warstwy budynków + dwie warstwy jednostek = osiem rysowalnych,
    // wszystkie widoczne. Liczba jest PRZYPIĘTA, nie „co najmniej": dołożenie czegokolwiek
    // do sceny ma przejść przez ten test, bo dokładnie tego dotyczy jego druga połowa
    // (schowanie planety gasi WSZYSTKO). Podniesiona z 5 na 7 w Zadaniu 4 Fazy 2B, a z 7 na 8
    // w Zadaniu 4 Fazy 2C (wycinki domykające obręcz alarmu) — asercja na zbiorach i sam
    // mechanizm zostały nietknięte.
    const before = drawables();
    expect(before.length).toBe(8);
    expect(before.every((d) => d.visible)).toBe(true);
    const terrain = before.find((d) => d.object.parent === lastScene);
    expect(terrain, 'siatka terenu jest jedynym rysowalnym dzieckiem sceny').toBeDefined();

    // Schowanie SAMEJ planety — nic nie wie o budynkach — musi wygasić wszystko.
    terrain!.object.visible = false;
    const after = drawables();
    expect(after.length).toBe(8);
    expect(after.filter((d) => d.visible)).toEqual([]);

    scene.dispose();
  });
});

describe('budżet klatki', () => {
  it('16. 600 wywołań update() przy komplecie 1442 budynków nie wychodzi ponad zmierzoną podłogę szumu odśmiecania', () => {
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

    const windows = measureGcWindows({
      empty: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += i;
      },
      measured: () => {
        for (let i = 0; i < ITERATIONS; i++) layer.update(list);
      },
      control: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += allocatingVariant();
      },
    });

    console.log(
      `[BUDGET] cykle GC na ${ITERATIONS} wywołań BuildingLayer.update @ ${CELL_COUNT} budynków, kontrola +${CELL_COUNT} Matrix4/wyw. — ${describeGcWindows(windows)}`,
    );

    // Trzy asercje, ten sam kształt co w `budget.test.ts` i `unitMesh.test.ts` —
    // uzasadnienie i historia w `support/gcWindows.ts`. Poprzednia wersja żądała
    // `min(okna) === 0` i migała pod obciążeniem równoległym, bo szum tła bywa większy od
    // mierzonego sygnału.
    expect(Math.min(...windows.empty), 'przyrząd nie potrafi zwrócić zera').toBe(0);
    //    Odniesieniem jest okno MIERZONE, nie bezczynne: kontrola to z definicji „mierzona
    //    praca + jedna alokacja na element", więc oba okna robią to samo i różni je DOKŁADNIE
    //    ta alokacja. Poprzednia wersja (`min(control) > max(idle)`) zestawiała podłogę
    //    jednego szumu z sufitem drugiego i przewracała się pod obciążeniem bez żadnego
    //    defektu — bo samo okno bezczynne alokuje. Pomiary: `support/gcWindows.ts`.
    expect(gcMedian(windows.control), 'kontrola alokująca nie odstaje od mierzonej pętli').toBeGreaterThan(
      gcMedian(windows.measured),
    );
    expect(Math.max(...windows.measured), 'BuildingLayer.update alokuje').toBeLessThanOrEqual(gcNoiseLimit(windows));
    expect(sink).not.toBe(0);
    layer.dispose();
    // Limit czasu podniesiony z domyślnych 5 s — to samo uzasadnienie i ta sama decyzja co
    // w `budget.test.ts` i w `packages/sim/test/light.test.ts` (5 s → 30 s, Zadanie 3).
    // W skrócie: test mierzy sześć przeplatanych okien odśmiecania (`rounds = 3`) na
    // tysiącach iteracji, a Vitest uruchamia pliki RÓWNOLEGLE, więc jego czas zależy od
    // tego, ile innych plików akurat liczy — pod obciążeniem wypadał na TIMEOUT, nie na
    // asercji, czyli czerwienią wyglądającą na regresję wydajności, którą nie jest.
    // Zmieniony jest WYŁĄCZNIE limit: ani asercje, ani liczba iteracji, ani kontrola.
  }, 30_000);
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

    // Liczba trójkątów obręczy NIE jest tu przypięta, w odróżnieniu od bryły i rdzenia:
    // zależy od `ALERT_BREAK_FRACTION` (kąt przerwy dzieli łuki inaczej), a to jest stała
    // `[WYGLĄD]`. Przypięta byłaby kotwicą na dzisiejszą wartość przebraną za kontrolę —
    // i oblewałaby przy KAŻDEJ zmianie szerokości przerwy, także takiej, która niczego nie
    // psuje. Kontrolą na przyrząd jest to, że trójkąty W OGÓLE są (po co najmniej jednym
    // czworokącie na łuk i pas), bo raport nawinięcia po pustej geometrii jest zielony.
    const alert = windingReport(layer.alert.geometry, () => up);
    expect(alert.triangles, 'obręcz przerywana nie ma ANI JEDNEGO trójkąta').toBeGreaterThanOrEqual(
      ALERT_BREAK_COUNT * 2 * 2,
    );
    expect(alert.wrong, 'pierścień: trójkąty zwrócone w dół — DOKŁADNIE defekt z Zadania 3').toBe(0);
    expect(alert.worstDot).toBeCloseTo(1, 9);

    // Wycinki DOMYKAJĄCE obręcz (Zadanie 4) — ta sama geometria, ta sama klasa defektu.
    // Warstwa dołożona bez tej asercji byłaby warstwą, którą odcinanie tylnych ścian mogłoby
    // zjeść w całości, a na ekranie wyglądałoby to jak „wszystkie budynki są odcięte od
    // sieci" — czyli jak POPRAWNY, ale fałszywy odczyt.
    const link = windingReport(layer.link.geometry, () => up);
    expect(link.triangles, 'wycinki domykające nie mają ANI JEDNEGO trójkąta').toBeGreaterThanOrEqual(
      ALERT_BREAK_COUNT * 2 * 2,
    );
    expect(link.wrong, 'wycinki domykające: trójkąty zwrócone w dół').toBe(0);
    expect(link.worstDot).toBeCloseTo(1, 9);

    layer.dispose();
  });
});

describe('puls pierścienia alarmu — materiał do pytania 5 bramki (Zadanie 5)', () => {
  it('23. [PARA MUTACJI] maksymalne LEGALNE wychylenie mieści się w komórce, o 0,0002 większe JUŻ NIE — i jest PONIŻEJ progu, który wiąże ROZMIARY', () => {
    // Pytanie 5 bramki brzmiało „czy widać, że pierścień alarmu pulsuje". Zadanie 3 puls
    // wyłączyło POMIAREM; rozstrzygnął człowiek — **puls widać, i jest domyślnym wyglądem
    // gry** (ustalenie U2). Ten test nie jest już materiałem do pytania, tylko strażnikiem
    // sufitu, który to pytanie zostawiło.
    //
    // Ten test ustala dwie rzeczy naraz: (1) ile wychylenia w ogóle zostało, (2) że to mniej
    // niż `MIN_VISIBLE_PX` — i to drugie NIE znaczy „niewidoczne". Próg 1 px pochodzi z
    // obejrzenia cechy NIERUCHOMEJ (pas obręczy cieńszy niż piksel znikał), więc wiąże
    // ROZMIARY; ruch jest wykrywalny poniżej niego i właśnie to zmierzył człowiek.
    const { angle: edgeAngle } = minOutlineEdgeAngle();
    const maxRingRadius = Math.tan(edgeAngle) * (planet.radius + planet.radius * SURFACE_LIFT_FACTOR);
    const restingRadius = planet.radius * ALERT_RADIUS_FACTOR;
    const amplitude = planet.radius * ALERT_PULSE_AMPLITUDE_FACTOR;

    // PARA TUŻ PRZY GRANICY. „Ma przejść": dzisiejsza amplituda mieści się w komórce.
    expect(restingRadius + amplitude, 'szczyt pulsu wychodzi poza komórkę').toBeLessThan(maxRingRadius);
    // „Ma oblać": amplituda większa o 0,02 jednostki już nie — czyli stała stoi TUŻ pod
    // sufitem narzuconym rozmiarem komórki, a nie gdziekolwiek poniżej niego.
    expect(restingRadius + amplitude + 0.02).toBeGreaterThan(maxRingRadius);

    // WYNIK, nie próg: całe wychylenie to 0,44 piksela z widoku domyślnego, przy progu
    // ROZMIARU 1 px. Sufitem jest ROZMIAR KOMÓRKI, nie dobór wartości — i dlatego odpowiedź
    // na pytanie 5 zapadła wzrokiem, a nie przez podniesienie tej liczby. Zapadła na TAK:
    // ta amplituda jest widoczna, mimo że leży pod progiem rozmiaru.
    expect(px(amplitude)).toBeLessThan(MIN_VISIBLE_PX);
    console.log(
      `[BRAMKA/P5] maksymalne legalne wychylenie pulsu: ${amplitude.toFixed(4)} j. = ${px(amplitude).toFixed(3)} px` +
        ` (spoczynek ${restingRadius.toFixed(4)}, sufit komórki ${maxRingRadius.toFixed(4)}, próg ROZMIARU ${MIN_VISIBLE_PX} px —` +
        ` widziane przez człowieka MIMO to, bo ruch jest wykrywalny poniżej niego)`,
    );
  });

  it('24. [NIEZMIENNIK] wywołanie WARSTWY bez zegara jest deterministyczne — a produkcja i tak pulsuje (pilnuje tego scene.test.ts)', () => {
    // Warstwa nie zna zegara i to jest własność z Zadania 3, nie niedopatrzenie: bez
    // argumentu nie ma wychylenia, bo nie ma skąd go wziąć. **To NIE znaczy „produkcja nie
    // pulsuje"** — od rundy naprawczej 2 Zadania 5 pulsuje, a wnosi to wywołujący
    // (`scene.ts` → `apps/client`), funkcją czystą `alertPulse`. Strażnik jest tu po to, żeby
    // wywołanie bez zegara (test, zrzut pojedynczej klatki) było DETERMINISTYCZNE.
    //
    // Tytuł tego testu brzmiał wcześniej „`update` bez wychylenia daje macierze IDENTYCZNE
    // co do bitu jak w spoczynku" i czytało się to jak zapadka chroniąca wariant BEZ pulsu —
    // czyli dokładnie odwrotność ustalenia U2, przy braku (do tej rundy) jakiegokolwiek testu
    // po drugiej stronie. Test jest ten sam; drugą stronę wiąże teraz `scene.test.ts`
    // („scena gry przekazuje warstwie budynków NIEZEROWE wychylenie pulsu").
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type, { powered: false }));

    layer.update(list);
    const implicit = Array.from(layer.alert.instanceMatrix.array);
    layer.update(list, undefined, 0);
    const explicitZero = Array.from(layer.alert.instanceMatrix.array);
    expect(explicitZero).toEqual(implicit);

    // Kontrola pozytywna na sam pomiar: niezerowe wychylenie te macierze ZMIENIA — inaczej
    // „identyczne" byłoby prawdą dla implementacji, która ignoruje argument w ogóle.
    layer.update(list, undefined, planet.radius * ALERT_PULSE_AMPLITUDE_FACTOR);
    expect(Array.from(layer.alert.instanceMatrix.array)).not.toEqual(implicit);
    layer.dispose();
  });

  it('25. [PARA MUTACJI] faza pulsu nigdy nie przekracza legalnej amplitudy, a jej SZCZYT sięga jej dokładnie', () => {
    // Runda naprawcza 2 Zadania 5 włączyła puls domyślnie, więc `alertPulse` jest teraz
    // częścią wyglądu gry, a nie materiałem bramki. Wiąże go ta sama granica co przedtem:
    // sufitem jest ROZMIAR KOMÓRKI i to się nie zmieniło.
    //
    // Dwie połówki: faza nie wychodzi ponad amplitudę (inaczej `update` rzuci w połowie
    // sekundy, na losowej klatce) ORAZ szczyt sięga jej dokładnie (inaczej puls byłby cichszy,
    // niż pozwala budżet, a to jest jedyny kanał, którego ta komórka jeszcze nie zajmuje).
    const maxPulse = planet.radius * ALERT_PULSE_AMPLITUDE_FACTOR;
    const SAMPLES = 2000;
    let peak = -Infinity;
    let trough = Infinity;
    for (let i = 0; i <= SAMPLES; i++) {
      const seconds = (i / SAMPLES) * ALERT_PULSE_PERIOD_SECONDS * 3; // trzy pełne okresy
      const value = alertPulse(planet.radius, seconds);
      expect(value, `faza ${seconds.toFixed(3)} s`).toBeGreaterThanOrEqual(0);
      expect(value, `faza ${seconds.toFixed(3)} s`).toBeLessThanOrEqual(maxPulse);
      peak = Math.max(peak, value);
      trough = Math.min(trough, value);
    }
    expect(peak).toBeCloseTo(maxPulse, 9);
    expect(trough).toBeCloseTo(0, 9);
    // OKRESOWOŚĆ: ten sam moment w kolejnym okresie daje tę samą wartość.
    expect(alertPulse(planet.radius, 0.37)).toBeCloseTo(
      alertPulse(planet.radius, 0.37 + ALERT_PULSE_PERIOD_SECONDS),
      9,
    );
    // ...i faza faktycznie SIĘ RUSZA — inaczej „w granicach" byłoby prawdą dla stałej zero.
    expect(alertPulse(planet.radius, ALERT_PULSE_PERIOD_SECONDS / 2)).toBeGreaterThan(maxPulse * 0.99);

    // KAŻDA wartość, jaką faza produkuje, jest przyjmowana przez `update` — czyli puls nie
    // może wysadzić renderu na losowej klatce. To jest ta druga połówka pary: gdyby szczyt
    // wychodził choć o bit ponad amplitudę, `update` rzuciłby.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    place(list, 300, 'CORE', { powered: false });
    for (let i = 0; i <= 200; i++) {
      const seconds = (i / 200) * ALERT_PULSE_PERIOD_SECONDS;
      expect(() => layer.update(list, undefined, alertPulse(planet.radius, seconds))).not.toThrow();
    }
    layer.dispose();
  });
});

// =========================================================================================
// PRZERWANA OBRĘCZ — DLACZEGO budynek nie ma prądu (Faza 2C, Zadanie 4, Krok 6)
//
// `powered === false` zlewało dwie przyczyny wymagające dwóch RÓŻNYCH reakcji gracza:
// brownout („dobuduj produkcję") i odcięcie od sieci („napraw pylon"). Kodowanie: obręcz
// PRZERWANA znaczy „poza siecią", ZAMKNIĘTA — „w sieci, ale bez mocy".
// =========================================================================================

/**
 * Kąty, pod którymi obręcz NAPRAWDĘ coś rysuje — odczytane z FAKTYCZNEGO bufora pozycji
 * i indeksów, nie ze stałych modułu i nie z `alertSpans`.
 *
 * Bez próbkowania i bez punktu-w-trójkącie: każdy czworokąt obręczy jest trapezem
 * promieniowym, więc PARA jego trójkątów pokrywa dokładnie przedział `[kąt_i, kąt_j]` na
 * każdym promieniu swojego pasa. Przedział pojedynczego trójkąta zawiera się w przedziale
 * jego czworokąta, więc suma po wszystkich trójkątach jest DOKŁADNIE pokryciem kątowym —
 * bez błędu próbkowania, który przy różnicy 1 % (para mutacji niżej) trzeba by dopiero
 * uzasadniać.
 *
 * Pokrycie jest tu jedno dla całej obręczy, a nie osobne dla każdego promienia, i to jest
 * własność KONSTRUKCJI, nie założenie: oba pasy mają te same łuki (patrz `buildAlertGeometry`),
 * więc zbiór kątów nie zależy od promienia. Sprawdza to test 28 drugą drogą.
 */
function coveredAngles(geometry: BufferGeometry): { from: number; to: number }[] {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const index = geometry.getIndex();
  if (!index) throw new Error('test: geometria bez bufora indeksów');
  const TWO_PI = Math.PI * 2;
  const raw: { from: number; to: number }[] = [];
  for (let t = 0; t < index.count / 3; t++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = index.getX(t * 3 + k);
      let a = Math.atan2(position.getY(v), position.getX(v));
      if (a < 0) a += TWO_PI;
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    // Żaden czworokąt obręczy nie rozpina więcej niż ~15°, więc przedział szerszy niż π
    // może znaczyć wyłącznie przejście przez 0 — rozcinany na dwa, zamiast zostać zapisany
    // jako „prawie cały okrąg" (co zamaskowałoby KAŻDĄ przerwę).
    if (hi - lo > Math.PI) {
      raw.push({ from: 0, to: lo });
      raw.push({ from: hi, to: TWO_PI });
    } else {
      raw.push({ from: lo, to: hi });
    }
  }
  raw.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const span of raw) {
    const last = merged.at(-1);
    // Tolerancja szwu: sąsiednie czworokąty dzielą kąt co do ostatniego bitu, ale liczony
    // jest on przez `atan2` dwóch różnych par współrzędnych, więc równość bywa o 1 ULP obok.
    if (last !== undefined && span.from <= last.to + 1e-9) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/** Przerwy w obręczy: dopełnienie pokrycia kątowego — łuk `[from, to]` każdej z nich. */
function ringGapSpans(geometry: BufferGeometry): { from: number; to: number }[] {
  const TWO_PI = Math.PI * 2;
  const covered = coveredAngles(geometry);
  const gaps: { from: number; to: number }[] = [];
  for (let i = 0; i < covered.length; i++) {
    const from = covered[i].to;
    const to = i + 1 < covered.length ? covered[i + 1].from : covered[0].from + TWO_PI;
    if (to - from > 1e-9) gaps.push({ from, to });
  }
  return gaps;
}

/** Szerokości kątowe przerw, w radianach. */
function ringGaps(geometry: BufferGeometry): number[] {
  return ringGapSpans(geometry).map((g) => g.to - g.from);
}

/** Długości kątowe ŁUKÓW obręczy (dopełnienie przerw), w radianach. */
function ringArcs(geometry: BufferGeometry): number[] {
  return coveredAngles(geometry).map((a) => a.to - a.from);
}

/**
 * Jaka CZĘŚĆ najlepiej zachowanej przerwy zostaje, gdy obręcz jest oglądana skrajnie
 * skośnie — minimum po wszystkich azymutach osi ściśnięcia.
 *
 * Obręcz leży płasko na kuli, więc budynek z dala od środka tarczy widać pod kątem: koło
 * rzutuje się na elipsę, ściśniętą wzdłuż jednej osi. W granicy (limb) przerwa leżąca NA tej
 * osi znika całkowicie, a przerwa prostopadła do niej zostaje w pełni — zachowanie przerwy
 * o środku `φ` przy osi `α` to `|sin(φ − α)|`.
 *
 * Stąd własność, której szuka test 26c: **nie może istnieć azymut, przy którym znikają
 * WSZYSTKIE przerwy naraz.** Jedna przerwa znika zawsze (jest azymut, na którym leży), dwie
 * naprzeciw siebie — również (leżą na tej samej osi). Dopiero trzy rozstawione równomiernie
 * nie dają się wygasić razem. Wartość jest tu liczona jako UŁAMEK, żeby pomnożyć ją przez
 * zmierzoną szerokość przerwy w pikselach i porównać z tym samym progiem `MIN_VISIBLE_PX`,
 * co wszystko inne w tym pliku.
 *
 * Granica stosowalności, zapisana: w limbie kurczy się TAKŻE szerokość pasów obręczy, więc
 * warunek jest ZACHOWAWCZY — spełnienie go nie obiecuje czytelności dokładnie na krawędzi
 * tarczy, tylko wyklucza konfigurację, która gubi kanał przy PEWNYM ustawieniu kamery
 * niezależnie od tego, jak szeroka jest sama przerwa.
 */
function worstGapSurvival(geometry: BufferGeometry): number {
  const gaps = ringGapSpans(geometry);
  if (gaps.length === 0) return 0;
  const centres = gaps.map((g) => (g.from + g.to) / 2);
  const SAMPLES = 3600; // 0,05° po półokresie |sin|
  let worst = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    const alpha = (i / SAMPLES) * Math.PI;
    let best = 0;
    for (const centre of centres) best = Math.max(best, Math.abs(Math.sin(centre - alpha)));
    worst = Math.min(worst, best);
  }
  return worst;
}

describe('[MUTACJA] przyczyna braku prądu jest widoczna W ŚWIECIE', () => {
  it('26. [PARA MUTACJI, PRÓG] przerwa obręczy ma ≥ 1,00 px na NAJGORSZYM członku populacji — kąt dający 0,99 px oblewa, 1,01 px przechodzi', () => {
    // ## Co tu jest wielkością wiążącą
    //
    // Przerwa jest oknem na teren, więc jej widoczność mierzy jej NAJWĘŻSZY wymiar: łuk na
    // wewnętrznej krawędzi tej części obręczy, która NIE JEST zasłonięta bryłą. Im mniejsza
    // bryła, tym bliżej środka zaczyna się widoczna obręcz i tym KRÓTSZY jest łuk o tym
    // samym kącie — więc najgorszym członkiem populacji jest tu najmniejszy typ (`PYLON`),
    // a nie największy, jak przy szerokości pasów (test 7).
    //
    // Mierzone na obręczy Z WARSTWY W SCENIE i na jej faktycznej macierzy instancji, nie na
    // stałych modułu.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    const outage = new Uint8Array(CELL_COUNT);
    ALL_TYPES.forEach((type, k) => {
      const cellId = 100 + k * 7;
      place(list, cellId, type, { powered: false });
      outage[cellId] = OUTAGE_UNLINKED; // przerwana obręcz: to ją mierzymy
    });
    layer.update(list, outage);
    expect(layer.alert.count, 'obręcz pod każdym budynkiem bez prądu').toBe(ALL_TYPES.length);
    expect(layer.link.count, 'nic nie domyka obręczy odciętych od sieci').toBe(0);

    const gaps = ringGaps(layer.alert.geometry);
    expect(gaps.length, 'liczba przerw').toBe(ALERT_BREAK_COUNT);
    // KOTWICA NA PRZYRZĄD, nie próg: zmierzony kąt przerwy zgadza się z zadeklarowanym.
    // Gdyby budowniczy gubił albo dokładał segmenty, wszystkie liczby niżej byłyby liczone
    // z geometrii innej niż ta, którą opisuje stała — i nikt by tego nie zauważył.
    for (const gap of gaps) expect(gap / (Math.PI * 2)).toBeCloseTo(ALERT_BREAK_FRACTION, 6);
    const { inner, split } = alertBandRadii(layer);

    // MINIMUM PO POPULACJI: dla każdego typu — najwęższa przerwa na wewnętrznej krawędzi
    // WIDOCZNEJ części pasa jasnego (nośnika alarmu na paśmie nocy).
    const widthByType = new Map<BuildingType, number>();
    ALL_TYPES.forEach((type, slot) => {
      const scale = basisColumn(matrixAt(layer.alert, slot), 0).length();
      const shellRadius = basisColumn(matrixAt(layer.shell, slot), 0).length();
      const visibleFrom = Math.max(inner * scale, shellRadius);
      // Kontrola na fikstrę: jasny pas musi w ogóle być widoczny, inaczej mierzylibyśmy
      // przerwę w czymś, czego nie widać (to pilnuje test 7, tu jest tylko straż).
      expect(split * scale).toBeGreaterThan(visibleFrom);
      widthByType.set(type, px(Math.min(...gaps) * visibleFrom));
    });
    const worstPx = Math.min(...widthByType.values());
    expect(worstPx, 'najwęższa przerwa po całej populacji — kanał „poza siecią"').toBeGreaterThanOrEqual(
      MIN_VISIBLE_PX,
    );

    // `PYLON` JEST najgorszym członkiem populacji — nie „jednym z", tylko osiąga minimum.
    // Minimum dzieli z nim każdy typ, którego bryła chowa się pod wewnętrzną krawędzią
    // obręczy (osiem z dziesięciu), więc asercja „najgorszy nazywa się PYLON" byłaby
    // rozstrzyganiem remisu przez kolejność pętli — a ta zależy od ostatnich bitów skali
    // instancji. Wiązane jest więc to, co jest treścią: najmniejszy typ leży NA minimum,
    // a największy (CORE, jedyny, którego bryła zasłania krawędź) — WYRAŹNIE nad nim.
    // Bez drugiej połowy próg mógłby mierzyć wielkość niezależną od bryły w ogóle.
    // Porównanie WZGLĘDNE, nie `toBeCloseTo(…, 6)`: tamto ma tolerancję BEZWZGLĘDNĄ
    // (5·10⁻⁷ px) na wielkości, która rośnie razem z przerwą, więc przy szerszej przerwie
    // oblewało na szumie `Float32` macierzy instancji, a nie na progu — czerwień mówiąca
    // „expected 9.665412694 to be close to 9.665412180", czyli awaria przyrządu, nie kodu.
    // Szum jest WZGLĘDNY (ostatnie bity pojedynczej precyzji), więc i tolerancja jest.
    expect(
      Math.abs(widthByType.get('PYLON')! - worstPx) / worstPx,
      'PYLON nie leży na minimum populacji',
    ).toBeLessThan(1e-6);
    expect(widthByType.get('CORE')!).toBeGreaterThan(worstPx * 1.05);
    console.log(
      `[KANAŁ] przerwa obręczy: minimum po populacji ${worstPx.toFixed(2)} px (PYLON), ` +
        `CORE ${widthByType.get('CORE')!.toFixed(2)} px, próg ${MIN_VISIBLE_PX} px, ` +
        `przerw ${gaps.length} po ${((Math.min(...gaps) * 180) / Math.PI).toFixed(1)}°`,
    );

    // ## PARA MUTACJI, obie połówki TUŻ przy granicy
    //
    // Kąt progowy liczony z MIERZONYCH wielkości (promień wewnętrzny z geometrii, skala
    // z macierzy, przelicznik ze stałych `camera.ts`) i z `MIN_VISIBLE_PX` — nie ze stałej,
    // którą testuje. Geometria budowana tym samym budowniczym, co produkcyjna, i mierzona
    // tym samym przyrządem.
    const worstRadius = inner * basisColumn(matrixAt(layer.alert, 0), 0).length();
    const thresholdAngle = MIN_VISIBLE_PX / PIXELS_PER_UNIT / worstRadius;
    const measure = (fractionOfTurn: number): number => {
      const spans = alertSpans(ALERT_BREAK_COUNT, fractionOfTurn);
      const geometry = buildAlertGeometry(spans.broken, 24);
      const widthPx = px(Math.min(...ringGaps(geometry)) * worstRadius);
      geometry.dispose();
      return widthPx;
    };
    const justUnder = measure((thresholdAngle * 0.99) / (Math.PI * 2));
    const justOver = measure((thresholdAngle * 1.01) / (Math.PI * 2));
    expect(justUnder, 'połówka „ma OBLAĆ": 0,99 px').toBeLessThan(MIN_VISIBLE_PX);
    expect(justOver, 'połówka „ma PRZEJŚĆ": 1,01 px').toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
    // Obie połówki NAPRAWDĘ leżą przy granicy, a nie rząd wielkości od niej — inaczej para
    // dowodziłaby wyłącznie tego, że przyrząd reaguje na wielkie zmiany.
    expect(justUnder).toBeCloseTo(0.99, 3);
    expect(justOver).toBeCloseTo(1.01, 3);
    // Zapasu produkcyjnego NIE ma tu asercji — byłby kotwicą na dzisiejszą wartość przebraną
    // za próg (katalog wad tej fazy). Wiążący próg to `MIN_VISIBLE_PX` wyżej; ile jest ponad
    // nim, mówi `console.log` i raport zadania.

    layer.dispose();
  });

  it('26b. [PARA MUTACJI, PRÓG] ŁUK obręczy jest DŁUŻSZY, niż obręcz jest szeroka — minimum po populacji', () => {
    // ## Druga strona progu z testu 26
    //
    // Test 26 wiąże przerwę OD DOŁU i na tym poprzestawał, więc obręcz dało się zjeść do
    // 20 % bez jednego czerwonego testu (zmierzone w przeglądzie: `ALERT_BREAK_FRACTION`
    // 0,20 przechodziło 686/686). A obręcz niesie kanał NADRZĘDNY — „ten budynek nie ma
    // prądu" — który ma zostać czytelny NIEZALEŻNIE od tego, czy gracz rozpozna przyczynę.
    //
    // Wielkość wiążąca: **łuk musi być dłuższy, niż obręcz jest szeroka**. To jest kryterium
    // KSZTAŁTU, nie kotwica na dzisiejszą wartość: odcinek krótszy od własnej szerokości
    // przestaje się czytać jako łuk okręgu, a staje się kropką — i wtedy „pierścień wokół
    // budynku" znika jako forma, choć każdy jego piksel dalej tam jest. Obie strony
    // porównania są MIERZONE (geometria + macierze instancji), żadna nie jest wpisana.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type, { powered: false }));
    layer.update(list);
    const { inner, outer } = alertBandRadii(layer);
    const arcs = ringArcs(layer.alert.geometry);

    let worstRatio = Infinity;
    let worstType: BuildingType = ALL_TYPES[0];
    let worstArcPx = 0;
    let worstWidthPx = 0;
    ALL_TYPES.forEach((type, slot) => {
      const scale = basisColumn(matrixAt(layer.alert, slot), 0).length();
      const shellRadius = basisColumn(matrixAt(layer.shell, slot), 0).length();
      const visibleFrom = Math.max(inner * scale, shellRadius);
      const arcPx = px(Math.min(...arcs) * visibleFrom);
      const widthPx = px(outer * scale - visibleFrom);
      if (arcPx / widthPx < worstRatio) {
        worstRatio = arcPx / widthPx;
        worstType = type;
        worstArcPx = arcPx;
        worstWidthPx = widthPx;
      }
    });
    expect(
      worstArcPx,
      `najkrótszy łuk (${worstType}) jest krótszy, niż obręcz szeroka — obręcz przestaje być obręczą`,
    ).toBeGreaterThanOrEqual(worstWidthPx);
    // Kontrola na przyrząd: łuk NAPRAWDĘ jest mierzony, a nie wychodzi z pustej listy.
    expect(arcs.length).toBeGreaterThan(0);
    expect(Math.min(...arcs)).toBeGreaterThan(0);
    console.log(
      `[KANAŁ] najkrótszy łuk obręczy: ${worstArcPx.toFixed(2)} px przy szerokości ` +
        `${worstWidthPx.toFixed(2)} px (${worstType}), stosunek ${worstRatio.toFixed(2)}`,
    );

    // ## PARA MUTACJI przy samej granicy — kąt liczony z MIERZONYCH wielkości
    const scale0 = basisColumn(matrixAt(layer.alert, 0), 0).length();
    const shell0 = basisColumn(matrixAt(layer.shell, 0), 0).length();
    const visible0 = Math.max(inner * scale0, shell0);
    const sector = (Math.PI * 2) / ALERT_BREAK_COUNT;
    // Łuk = szerokość obręczy ⇒ kąt łuku = szerokość / promień wewnętrzny widocznej części.
    const thresholdArc = (outer * scale0 - visible0) / visible0;
    const measure = (arcAngle: number): { arcPx: number; widthPx: number } => {
      const spans = alertSpans(ALERT_BREAK_COUNT, (sector - arcAngle) / (Math.PI * 2));
      const geometry = buildAlertGeometry(spans.broken, 24);
      const arcPx = px(Math.min(...ringArcs(geometry)) * visible0);
      geometry.dispose();
      return { arcPx, widthPx: px(outer * scale0 - visible0) };
    };
    const justUnder = measure(thresholdArc * 0.99);
    const justOver = measure(thresholdArc * 1.01);
    expect(justUnder.arcPx, 'połówka „ma OBLAĆ": łuk o 1 % krótszy od szerokości').toBeLessThan(
      justUnder.widthPx,
    );
    expect(justOver.arcPx, 'połówka „ma PRZEJŚĆ": łuk o 1 % dłuższy od szerokości').toBeGreaterThanOrEqual(
      justOver.widthPx,
    );
    // Obie połówki NAPRAWDĘ leżą przy granicy — w przeciwnym razie para dowodziłaby tylko,
    // że przyrząd reaguje na zmiany o rząd wielkości.
    expect(justUnder.arcPx / justUnder.widthPx).toBeCloseTo(0.99, 2);
    expect(justOver.arcPx / justOver.widthPx).toBeCloseTo(1.01, 2);
    layer.dispose();
  });

  it('26c. [PARA MUTACJI, PRÓG] przerwy nie dają się wygasić WSZYSTKIE naraz skośnym spojrzeniem', () => {
    // Drugie pół dziury z przeglądu: `ALERT_BREAK_COUNT = 1` przechodziło 686/686, choć
    // doc-comment modułu odrzuca jedno wcięcie wprost („czyta się jak artefakt rasteryzacji
    // albo przesłonięcie przez sąsiada"). Jedyna asercja o liczbie przerw porównywała ją ze
    // STAŁĄ, którą testuje — czyli z samą sobą.
    //
    // Własność zamiast liczby: obręcz leży płasko na kuli, więc budynek z dala od środka
    // tarczy widać skośnie i koło rzutuje się na elipsę. Przerwa leżąca na osi ściśnięcia
    // znika. **Jedna przerwa znika zawsze przy pewnym ustawieniu kamery, dwie naprzeciw
    // siebie — również.** Wiązane jest więc to, ile zostaje z NAJLEPIEJ zachowanej przerwy
    // w najgorszym azymucie, przemnożone przez jej zmierzoną szerokość w pikselach.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    place(list, 300, 'PYLON', { powered: false }); // najgorszy członek populacji (test 26)
    layer.update(list);
    const { inner } = alertBandRadii(layer);
    const scale = basisColumn(matrixAt(layer.alert, 0), 0).length();
    const shellRadius = basisColumn(matrixAt(layer.shell, 0), 0).length();
    const visibleFrom = Math.max(inner * scale, shellRadius);

    const survivingPx = (geometry: BufferGeometry): number =>
      px(Math.min(...ringGaps(geometry)) * visibleFrom) * worstGapSurvival(geometry);

    expect(
      survivingPx(layer.alert.geometry),
      'istnieje ustawienie kamery, w którym znikają WSZYSTKIE przerwy naraz',
    ).toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
    console.log(
      `[KANAŁ] najgorszy azymut: zostaje ${survivingPx(layer.alert.geometry).toFixed(2)} px ` +
        `z przerwy (${(worstGapSurvival(layer.alert.geometry) * 100).toFixed(1)} % szerokości), próg ${MIN_VISIBLE_PX} px`,
    );

    // PARA po liczbie przerw, przy samej granicy: DWIE leżą naprzeciw siebie i gasną razem,
    // TRZY już nie. Mierzone tym samym przyrządem, na geometriach z tego samego budowniczego.
    const build = (count: number): BufferGeometry =>
      buildAlertGeometry(alertSpans(count, ALERT_BREAK_FRACTION).broken, 24);
    const two = build(2);
    const three = build(3);
    expect(survivingPx(two), 'połówka „ma OBLAĆ": dwie przerwy gasną razem').toBeLessThan(MIN_VISIBLE_PX);
    expect(survivingPx(three), 'połówka „ma PRZEJŚĆ": trzy przerwy już nie').toBeGreaterThanOrEqual(
      MIN_VISIBLE_PX,
    );
    // …i jedna przerwa jest przypadkiem skrajnym tej samej własności, nie osobną regułą.
    const one = build(1);
    expect(survivingPx(one)).toBeLessThan(MIN_VISIBLE_PX);
    for (const g of [one, two, three]) g.dispose();
    layer.dispose();
  });

  it('27. [MUTACJA] dwie przyczyny dają DWA różne obrazy — zrównanie kodowania oblewa', () => {
    // Stan z briefu: oba budynki mają `powered === false` i do Zadania 4 wyglądały
    // identycznie. Test wiąże OBIE strony: odcięty od sieci NIE dostaje domknięcia, zgaszony
    // kaskadą — dostaje.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    const shedCell = 200;
    const orphanCell = 400;
    place(list, shedCell, 'EXTRACTOR', { powered: false });
    place(list, orphanCell, 'EXTRACTOR', { powered: false });

    const outage = new Uint8Array(CELL_COUNT);
    outage[shedCell] = OUTAGE_SHED;
    outage[orphanCell] = OUTAGE_UNLINKED;
    layer.update(list, outage);

    // Kanał NADRZĘDNY nietknięty: obręcz jest pod OBOMA (to jest `powered === false`).
    expect(layer.alert.count).toBe(2);
    // …a domknięcie — tylko pod zgaszonym kaskadą, i to na JEGO komórce, nie byle której.
    expect(layer.link.count).toBe(1);
    const at = translationOf(matrixAt(layer.link, 0)).normalize();
    const cell = planet.cells[shedCell];
    expect(at.dot(new Vector3(cell.normal.x, cell.normal.y, cell.normal.z))).toBeGreaterThan(0.99999);

    // MUTACJA „zrównaj kodowanie obu": jedna wartość dla obu przyczyn. Cokolwiek by nią było,
    // liczba domknięć przestaje wynosić 1 — więc obraz przestaje rozróżniać przyczyny.
    for (const single of [OUTAGE_SHED, OUTAGE_UNLINKED]) {
      outage[shedCell] = single;
      outage[orphanCell] = single;
      layer.update(list, outage);
      expect(layer.link.count, `zrównane kodowanie (${single}) rozróżnia przyczyny`).not.toBe(1);
    }

    // Brak informacji o przyczynie ⇒ obręcz PEŁNA pod każdym, czyli wygląd sprzed Zadania 4.
    // Bez tej połówki wywołujący, który zapomni podać `outage`, ogłaszałby awarię sieci pod
    // każdym zgaszonym budynkiem — i byłby to fałsz, którego nikt by nie zauważył.
    layer.update(list);
    expect(layer.link.count).toBe(2);

    // Budynek ZASILONY nie dostaje ani obręczy, ani domknięcia — nawet gdy bufor przyczyn
    // niesie przy nim śmieć (a niesie, bo to bufor współdzielony między tickami).
    list[shedCell]!.powered = true;
    list[orphanCell]!.powered = true;
    outage[shedCell] = OUTAGE_SHED;
    outage[orphanCell] = OUTAGE_UNLINKED;
    layer.update(list, outage);
    expect(layer.alert.count).toBe(0);
    expect(layer.link.count).toBe(0);

    layer.dispose();
  });

  it('28. [NIEZMIENNIK] obie połowy obręczy tworzą RAZEM pełny okrąg — bez luki i bez zakładki', () => {
    // Zamknięta obręcz ma być DOKŁADNIE tą obręczą, którą Zadanie 3 Fazy 2B zmierzyło
    // i obejrzało: brownout nie może wyglądać inaczej niż „bez prądu" wyglądał przedtem,
    // bo wtedy zmiana z Zadania 4 przestrojałaby kanał, który miała tylko uszczegółowić.
    //
    // Zakładka byłaby z kolei dwiema powierzchniami w tej samej płaszczyźnie — czyli walką
    // o bufor głębokości, awarią widoczną wyłącznie na GPU (ten sam tryb, dla którego
    // istnieje `SURFACE_LIFT_FACTOR`).
    const layer = createBuildingLayer(planet, geo);
    const broken = coveredAngles(layer.alert.geometry);
    const closing = coveredAngles(layer.link.geometry);
    expect(broken.length).toBe(ALERT_BREAK_COUNT);
    expect(closing.length).toBe(ALERT_BREAK_COUNT);

    const total = (spans: { from: number; to: number }[]): number =>
      spans.reduce((sum, s) => sum + (s.to - s.from), 0);
    // Sześć miejsc, nie dziewięć: kąty są odczytywane z bufora `Float32Array`, więc mają
    // precyzję pojedynczą (~10⁻⁷ rad). Zmierzona rozbieżność to 7,5 · 10⁻⁸ rad, czyli
    // 2 · 10⁻⁷ jednostki świata — o siedem rzędów wielkości poniżej piksela.
    expect(total(broken) + total(closing)).toBeCloseTo(Math.PI * 2, 6);
    // Rozłączność: żaden łuk przerywanej nie zachodzi na żaden łuk domykającej. Tolerancja
    // 10⁻⁶ rad wynika z precyzji bufora (`Float32Array`), a nie z pobłażliwości: to jest
    // 3 · 10⁻⁶ jednostki świata, czyli 10⁻⁵ piksela. Zakładka, która ma znaczenie (walka
    // o bufor głębokości między dwiema powierzchniami), zaczyna się rzędy wielkości wyżej.
    for (const a of broken) {
      for (const b of closing) {
        expect(Math.min(a.to, b.to) - Math.max(a.from, b.from), 'łuki zachodzą na siebie').toBeLessThan(1e-6);
      }
    }
    // Ten sam PROMIEŃ i te same PASY: domknięcie jest fragmentem tej samej obręczy, a nie
    // osobną ozdobą o własnej geometrii.
    expect(alertBandRadii({ alert: { geometry: layer.link.geometry } })).toEqual(alertBandRadii(layer));

    // Pełny okrąg NAPRAWDĘ nie ma przerw — kontrola pozytywna na sam przyrząd `ringGaps`,
    // który wyżej znalazł cztery.
    const full = buildAlertGeometry([[0, Math.PI * 2]], 24);
    expect(ringGaps(full)).toEqual([]);
    full.dispose();

    layer.dispose();
  });

  it('29. bufor przyczyn o złej długości to RangeError, a `update` go nie mutuje', () => {
    // Ta sama klasa rozjazdu, co `buildings.length` i `light.length`: dwie tablice
    // indeksowane tym samym `cellId`, których nic nie wiąże składniowo. Plus zakaz zapisu:
    // bufor należy do symulacji i jest przepisywany w każdym ticku — render, który by go
    // tknął, kłamałby symulacji o jej własnym stanie w następnej klatce.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    place(list, 300, 'PYLON', { powered: false });
    expect(() => layer.update(list, new Uint8Array(CELL_COUNT - 1))).toThrow(RangeError);
    expect(() => layer.update(list, new Uint8Array(CELL_COUNT + 1))).toThrow(RangeError);

    const outage = new Uint8Array(CELL_COUNT);
    outage[300] = OUTAGE_UNLINKED;
    const before = [...outage];
    layer.update(list, outage);
    layer.update(list, outage, planet.radius * ALERT_PULSE_AMPLITUDE_FACTOR);
    expect([...outage]).toEqual(before);
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

// ---------------------------------------------------------------------------------------
// 31. Obręcz alarmu ma czytać się jako OKRĄG, nie jako wielokąt
// ---------------------------------------------------------------------------------------
describe('31. [KSZTAŁT] obręcz alarmu nie zdradza się jako wielokąt przy zbliżeniu', () => {
  /**
   * `ALERT_SIDES = 24` miało w doc-commencie uzasadnienie („tyle, żeby przy zbliżeniu czytał
   * się jako okrąg") i ANI JEDNEGO testu: ponowny przegląd Zadania 4 pokazał, że `= 3`
   * przechodzi cały pakiet, a obręcz staje się czworokątem. Test 26b mierzy DŁUGOŚĆ KĄTOWĄ
   * łuku i jest na kształt ślepy z konstrukcji.
   *
   * Własność, która to wiąże: **strzałka cięciwy** — odległość między cięciwą wielokąta
   * a łukiem, który on udaje. Dla wielokąta o `n` bokach wpisanego w okrąg promienia `R`
   * wynosi `R · (1 − cos(π/n))`. Gdy spada poniżej progu widoczności, oko nie ma jak odróżnić
   * wielokąta od okręgu.
   *
   * **Odniesieniem jest NAJWIĘKSZE przybliżenie**, nie domyślne — i to jest różnica wobec
   * wszystkich pozostałych progów tej fazy. Progi WIDOCZNOŚCI biorą widok domyślny, bo rzecz
   * niewidoczna stamtąd jest niewidoczna. Próg WIERNOŚCI KSZTAŁTU jest odwrotny: wielokąt
   * zdradza się, gdy podjedziesz blisko, więc najgorszym przypadkiem jest `MIN_DISTANCE_FACTOR`.
   */
  /**
   * Strzałka cięciwy odczytana z **NARYSOWANEJ GEOMETRII**, nie policzona ze stałej.
   *
   * Pierwsza wersja liczyła `R · (1 − cos(π/ALERT_SIDES))` z samej stałej i przez to pilnowała
   * STAŁEJ, a nie obręczy: pięciokrotne zgrubienie podziału łuku przy `ALERT_SIDES` nietkniętym
   * na 24 przechodziło 699/699 (znalezisko N12). To był ten sam wzorzec „wyjście porównane
   * z przepisanym wzorem", który w tej fazie wystąpił już trzykrotnie.
   *
   * Czytane są PARY WIERZCHOŁKÓW ZEWNĘTRZNEGO pierścienia, które faktycznie tworzą trójkąt —
   * czyli cięciwy, które GPU naprawdę rysuje. Dzięki temu rachunek nie musi odtwarzać ani
   * podziału łuków (`Math.ceil` w `buildAlertGeometry` daje krok mniejszy niż `2π/n`), ani
   * kąta przerw: cokolwiek zmieni kształt, zmieni te pary.
   */
  function worstSagittaLocal(geometry: BufferGeometry): number {
    const position = geometry.getAttribute('position') as BufferAttribute;
    const index = geometry.getIndex();
    if (!index) throw new Error('test: geometria bez bufora indeksów');
    const radiusOf = (v: number): number => Math.hypot(position.getX(v), position.getY(v));

    let outer = 0;
    for (let v = 0; v < position.count; v++) outer = Math.max(outer, radiusOf(v));

    let worst = 0;
    const seen = new Set<string>();
    for (let t = 0; t < index.count / 3; t++) {
      const onOuter: number[] = [];
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t * 3 + k);
        if (Math.abs(radiusOf(v) - outer) < 1e-6) onOuter.push(v);
      }
      // Trójkąt trapezu promieniowego ma na pierścieniu zewnętrznym dokładnie dwa
      // wierzchołki — to jest jedna narysowana cięciwa. Trójkąty z jednym są pomijane.
      if (onOuter.length !== 2) continue;
      const key = onOuter[0] < onOuter[1] ? `${onOuter[0]},${onOuter[1]}` : `${onOuter[1]},${onOuter[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mx = (position.getX(onOuter[0]) + position.getX(onOuter[1])) / 2;
      const my = (position.getY(onOuter[0]) + position.getY(onOuter[1])) / 2;
      worst = Math.max(worst, outer - Math.hypot(mx, my));
    }
    // Kontrola na fiksturę: bez ANI JEDNEJ cięciwy „zero" znaczyłoby „idealny okrąg",
    // czyli test przechodziłby najgłośniej wtedy, gdy nic nie zmierzył.
    expect(seen.size, 'liczba zmierzonych cięciw pierścienia zewnętrznego').toBeGreaterThan(2);
    return worst;
  }

  /**
   * Najgorsza strzałka z OBU odmian obręczy, w pikselach.
   *
   * Odniesieniem jest **skala CZOŁOWA przy największym przybliżeniu** (`pixelsPerUnitFacingClosest`),
   * nie sylwetkowa. Progi WIDOCZNOŚCI biorą widok domyślny i skalę sylwetkową, bo mniejsza
   * skala daje ostrzejszy próg. Tutaj kierunek jest ODWROTNY: wielokąt zdradza się z bliska
   * i na wprost, a skala mniejsza od prawdziwej robi próg POBŁAŻLIWY — pierwsza wersja tego
   * testu wzięła sylwetkową i zaniżyła próg 2,77× (N13).
   */
  function sagittaPx(sides: number): number {
    const planet = createPlanet({ seed: 20260915 });
    const spans = alertSpans(ALERT_BREAK_COUNT, ALERT_BREAK_FRACTION);
    let worstLocal = 0;
    for (const variant of [spans.broken, spans.closing]) {
      worstLocal = Math.max(worstLocal, worstSagittaLocal(buildAlertGeometry(variant, sides)));
    }
    const ringRadius = planet.radius * ALERT_RADIUS_FACTOR;
    return worstLocal * ringRadius * pixelsPerUnitFacingClosest(planet.radius);
  }

  it('31a. strzałka cięciwy przy dzisiejszej liczbie boków jest poniżej progu widoczności', () => {
    const s = sagittaPx(ALERT_SIDES);
    // eslint-disable-next-line no-console
    console.log(
      `[KSZTAŁT] strzałka cięciwy przy ${ALERT_SIDES} bokach: ${s.toFixed(3)} px ` +
        `(próg ${MIN_VISIBLE_PX} px, zapas ${(MIN_VISIBLE_PX / s).toFixed(1)}×)`,
    );
    expect(s).toBeLessThan(MIN_VISIBLE_PX);
  });

  /**
   * **Granica jest SCHODKOWA, nie ciągła** — i to jest wynik pomiaru, nie założenie.
   *
   * `buildAlertGeometry` dzieli każdy z czterech łuków osobno
   * (`ceil((to − from)/2π × segmentsPerTurn)`), a łuk ma 0,2 obrotu, więc `segmentsPerTurn`
   * od 21 do 25 daje IDENTYCZNĄ geometrię: 5 cięciw na łuk i strzałkę 0,769 px. Płaskowyże
   * mają po pięć wartości, a próg przechodzi między 20 (1,200 px) a 21 (0,769 px).
   *
   * Dlatego para jest 20/21, a nie „o jeden mniej niż dzisiejsze 24": zmniejszenie `ALERT_SIDES`
   * z 24 na 21 NIE ZMIENIA ANI JEDNEGO WIERZCHOŁKA, więc test wiążący przy 23/24 twierdziłby
   * o czułości, której ta geometria nie ma.
   */
  it('31b. [PARA] 21 boków jeszcze przechodzi, 20 już nie — próg wiąże przy granicy', () => {
    expect(sagittaPx(21)).toBeLessThan(MIN_VISIBLE_PX);
    expect(sagittaPx(20)).toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
  });

  it('31c. [REGRESJA] liczba boków z ponownego przeglądu (3) łamie próg wielokrotnie', () => {
    // Kontrola kierunku: gdyby próg dało się spełnić czworokątem, nie mierzyłby kształtu.
    expect(sagittaPx(3)).toBeGreaterThan(MIN_VISIBLE_PX * 5);
  });
});
