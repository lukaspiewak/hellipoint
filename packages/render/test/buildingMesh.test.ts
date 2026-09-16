import { describe, expect, it } from 'vitest';
import { GCProfiler } from 'node:v8';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, type BufferAttribute, type BufferGeometry, type Object3D, type Scene } from 'three';
import { BUILDINGS, createPlanet, type Building, type BuildingType } from '@heliopolis/sim';
import { buildPlanetGeometry } from '../src/geometry.js';
import {
  alertPulseScale,
  buildCellBases,
  coreScale,
  createBuildingLayer,
  healthFraction,
  writeCoreColor,
  ALERT_COLOR_DARK,
  ALERT_COLOR_LIGHT,
  ALERT_INNER_FACTOR,
  ALERT_PULSE_AMPLITUDE,
  ALERT_PULSE_PERIOD_SECONDS,
  ALERT_RADIUS_FACTOR,
  BUILDING_HEIGHT_FACTOR,
  BUILDING_RADIUS_FACTOR,
  BUILDING_SHAPES,
  CORE_COLOR_CRITICAL,
  CORE_COLOR_HEALTHY,
  CORE_RADIUS_FACTOR,
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

// --- Progi BEZWZGLĘDNE (runda naprawcza 1) ------------------------------------------------
//
// Do rundy naprawczej 1 każda asercja „stan widać" była wyrażona przez TĘ SAMĄ stałą, którą
// testowała (`toBeCloseTo(1 + ALERT_PULSE_AMPLITUDE)`, `toBeCloseTo(fullRadius * CORE_SCALE_MIN)`
// …), więc zostawała z niej wyłącznie asercja kierunkowa — prawdziwa dla dowolnie małej
// zmiany. Przegląd sprowadził tym każdy kanał stanu do niewidoczności przy zielonym pakiecie.
//
// Poniższe progi są WEJŚCIEM, nie wyprowadzeniem: żaden nie jest liczony ze stałej, której
// pilnuje. Wszystkie w jednostkach świata dla `planet.radius === 100`.
//
// **Przy tych progach CELOWO nie ma kotwic na dzisiejszą wartość.** Kotwica `toBeCloseTo`
// obok progu na TEJ SAMEJ wielkości oblewa przy każdej zmianie, więc próg nigdy nie zdąży
// zadziałać i staje się ozdobnikiem — a przy okazji nie da się już pokazać, GDZIE stoi
// (mutacja „tuż przed progiem" oblewałaby kotwicę, nie próg). Dzisiejsze wartości są
// wypisane w komentarzach przy samych stałych w `buildingMesh.ts` i w raporcie zadania.
// Kotwice zostają WYŁĄCZNIE tam, gdzie przypinają PRZYRZĄD (np. `maxRingRadius = 3,172`,
// `depthResolution = 0,0292`), bo tam każda zmiana jest błędem pomiaru, nie strojeniem.
//
// Przelicznik na piksele, potrzebny żeby te liczby cokolwiek znaczyły: z widoku DOMYŚLNEGO
// (`INITIAL_DISTANCE_FACTOR = 3`, czyli kamera 300 jednostek od środka planety) tarcza
// zajmuje 2·asin(1/3) = 38,94° przy polu widzenia 50°, więc przy płótnie 900 px ma 700 px
// średnicy — **3,5 piksela na jednostkę świata**. Używam zachowawczych **3,22** (pomiar
// recenzenta), bo liczy się najgorszy przypadek, nie najlepszy.
const PIXELS_PER_UNIT = 3.22;

/** Najmniejsza widoczna obręcz alarmu poza bryłą NAJWIĘKSZEGO budynku — ok. 1,8 px. */
const MIN_ALERT_RING_WORLD = 0.5;
/** Szczytowa prędkość promieniowa krawędzi pierścienia — ok. 3,2 px/s, czyli ok. 1 px na rzut oka. */
const MIN_PULSE_SPEED_UNITS_PER_SECOND = 1;
/** Pole rdzenia przy `hp === 0` jako ułamek pola przy pełnym — musi spaść wyraźnie. */
const MAX_CORE_AREA_AT_ZERO_HP = 0.36;
/** Skok promienia rdzenia między pełnym a zerowym `hp`, dla NAJWIĘKSZEJ bryły — ok. 1,1 px. */
const MIN_CORE_RADIUS_DROP_WORLD = 0.35;
/** Odległość barw (sRGB) barwy krytycznej od SZAROŚCI o tej samej luminancji. */
const MIN_CRITICAL_CHROMA = 0.3;
/** Ciemna obwódka rdzenia: ułamek promienia bryły i wartość bezwzględna dla największej. */
const MIN_RIM_RATIO = 0.15;
const MIN_RIM_WORLD = 0.35;
/** Najmniejszy dopuszczalny promień i wysokość bryły JAKIEGOKOLWIEK typu. */
const MIN_SHAPE_WORLD = 0.5;

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
    expect(bestPossible).toBeLessThan(WCAG_MIN);
    expect(bestPossible).toBeCloseTo(2.3202, 3);
    expect(bestLuminance).toBeCloseTo(0.18388, 4);
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

  it('3. ciemna obwódka wokół rdzenia jest SZEROKA, nie tylko niezerowa — to ona niesie budynek na dniu', () => {
    // Do rundy naprawczej 1 stała tu wyłącznie ostra nierówność `CORE < TAPER`, więc
    // `SHELL_TAPER = 0,56` przechodziło, a obwódka schodziła z 0,54 jednostki do 0,02.
    // To jest zadeklarowany nośnik dwóch własności naraz: widoczności budynku na paśmie
    // dnia (rdzeń ma tam kontrast 1,04) i oddzielenia czerwonego rdzenia od pomarańczu
    // zmierzchu (odległość barw 0,195). Zerowa obwódka zabiera obie, nie oblewając nic.
    expect(SHELL_TAPER - CORE_RADIUS_FACTOR).toBeGreaterThanOrEqual(MIN_RIM_RATIO);

    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type));
    layer.update(list);
    let widestRim = 0;
    for (let slot = 0; slot < ALL_TYPES.length; slot++) {
      const shellRadius = basisColumn(matrixAt(layer.shell, slot), 0).length();
      const shellTopRadius = shellRadius * SHELL_TAPER;
      const coreRadius = basisColumn(matrixAt(layer.core, slot), 0).length();
      expect(coreRadius, ALL_TYPES[slot]).toBeLessThan(shellTopRadius);
      widestRim = Math.max(widestRim, shellTopRadius - coreRadius);
    }
    // Próg BEZWZGLĘDNY na największej bryle — sam stosunek przepuściłby bryły tak małe, że
    // obwódka byłaby ułamkiem piksela mimo poprawnej proporcji.
    expect(widestRim).toBeGreaterThanOrEqual(MIN_RIM_WORLD);
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
    expect(smallestRadius, 'najmniejszy promień bryły').toBeGreaterThanOrEqual(MIN_SHAPE_WORLD);
    expect(smallestHeight, 'najmniejsza wysokość bryły').toBeGreaterThanOrEqual(MIN_SHAPE_WORLD);
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

  it('7. pierścień alarmu PULSUJE dość szybko, żeby ruch było widać — próg na PRĘDKOŚCI, nie na amplitudzie', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    place(list, 600, 'PYLON', { powered: false });

    layer.update(list, 0);
    const trough = basisColumn(matrixAt(layer.alert, 0), 0).length();
    layer.update(list, ALERT_PULSE_PERIOD_SECONDS / 2);
    const peak = basisColumn(matrixAt(layer.alert, 0), 0).length();

    // KIERUNKOWO: szczyt jest WIĘKSZY od minimum (nie "różny od" — różnica bez znaku
    // przeszłaby także dla pulsu odwróconego, czyli pierścienia wchodzącego pod skorupę).
    expect(peak).toBeGreaterThan(trough);

    // --- PRÓG BEZWZGLĘDNY (runda naprawcza 1) -----------------------------------------
    // Poprzednia wersja pinowała `peak / trough` do `1 + ALERT_PULSE_AMPLITUDE`, czyli do tej
    // samej stałej, którą testowała — zostawała z niej wyłącznie asercja kierunkowa i
    // przechodziła amplituda 0,004 ORAZ okres 90 s. Sama amplituda zresztą nie wystarcza jako
    // miara: da się ją wyzerować okresem, bo to prędkość, nie przemieszczenie, czyni ruch
    // widocznym. Wielkość, którą ograniczamy, to szczytowa prędkość promieniowa krawędzi —
    // MIERZONA z macierzy różnicą skończoną, nie wyprowadzona ze wzoru modułu.
    const dt = ALERT_PULSE_PERIOD_SECONDS / 2000;
    let fastest = 0;
    let previous = trough;
    for (let i = 1; i <= 2000; i++) {
      layer.update(list, i * dt);
      const r = basisColumn(matrixAt(layer.alert, 0), 0).length();
      fastest = Math.max(fastest, Math.abs(r - previous) / dt);
      previous = r;
    }
    expect(fastest, 'szczytowa prędkość promieniowa krawędzi pierścienia').toBeGreaterThanOrEqual(
      MIN_PULSE_SPEED_UNITS_PER_SECOND,
    );

    // Okresowość i determinizm — puls wraca do minimum i ten sam czas daje ten sam obraz.
    layer.update(list, ALERT_PULSE_PERIOD_SECONDS);
    expect(basisColumn(matrixAt(layer.alert, 0), 0).length()).toBeCloseTo(trough, 4);
    layer.update(list, ALERT_PULSE_PERIOD_SECONDS / 2);
    expect(basisColumn(matrixAt(layer.alert, 0), 0).length()).toBeCloseTo(peak, 6);
    layer.dispose();
  });

  it('8. [NIEZMIENNIK] pierścień NIE wychodzi poza komórkę w ŻADNEJ z 1442 komórek i w żadnej fazie pulsu', () => {
    // ## Co ten test mierzył ŹLE do rundy naprawczej 1
    //
    // Porównywał promień pierścienia z `min|narożnik − środek| × (1 − OUTLINE_INSET)`, czyli
    // z promieniem OPISANYM komórki (3,9208). Obrys nie przechodzi przez narożniki — to
    // zamknięta pętla po nich — więc okrąg mieści się w nim wtedy i tylko wtedy, gdy jest
    // mniejszy od promienia WPISANEGO (3,1720). Pierścień o promieniu 3,808 przechodził ten
    // test i JEDNOCZEŚNIE wychodził poza kratę w 12 komórkach w spoczynku i wchodził na
    // sąsiada w 72 na szczycie pulsu (największe wyjście 0,6360). Dla budynku przy
    // terminatorze znaczyło to bursztyn po granicy dnia i nocy.
    //
    // Teraz: minimum po WSZYSTKICH komórkach i WSZYSTKICH krawędziach, liczone kątowo od
    // środka planety z FAKTYCZNEGO bufora obrysów, i obowiązujące dla SZCZYTU pulsu.
    const { angle: edgeAngle, cellId } = minOutlineEdgeAngle();
    expect(cellId, 'najciaśniejsza komórka to pięciokąt').toBe(0);

    // Kąt przeliczony z powrotem na promień W PŁASZCZYŹNIE, w której leży pierścień (czyli
    // uniesionej o `SURFACE_LIFT_FACTOR`) — od tej chwili wszystko jest w jednych jednostkach.
    // Kotwica idzie na wielkość CZYSTO GEOMETRYCZNĄ (bez uniesienia) — inaczej byłaby
    // czuła na `SURFACE_LIFT_FACTOR`, czyli na stałą, o której ten test nie orzeka.
    expect(Math.tan(edgeAngle) * planet.radius, 'przyrząd: promień wpisany obrysu').toBeCloseTo(3.1673, 3);
    const lift = planet.radius * SURFACE_LIFT_FACTOR;
    const maxRingRadius = Math.tan(edgeAngle) * (planet.radius + lift);
    // Dla porównania to, z czym test porównywał do rundy naprawczej 1 — promień OPISANY:
    expect(smallestCellRadius() * (1 - 0.07)).toBeCloseTo(3.9126, 3);

    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    place(list, 300, 'CORE', { powered: false });

    let widest = 0;
    let narrowest = Infinity;
    for (let i = 0; i <= 240; i++) {
      layer.update(list, (i / 240) * ALERT_PULSE_PERIOD_SECONDS);
      const outer = basisColumn(matrixAt(layer.alert, 0), 0).length();
      widest = Math.max(widest, outer);
      narrowest = Math.min(narrowest, outer);
    }

    // GÓRNA GRANICA — pierścień zostaje w komórce. Przy poprzednich stałych było tu 3,808.
    expect(widest, 'szczyt pulsu wychodzi poza krawędź obrysu').toBeLessThan(maxRingRadius);

    // Ta sama granica dotyczy BRYŁY: budynek też jest okrągły i też nie może wyjść z komórki.
    const biggestShell =
      planet.radius * BUILDING_RADIUS_FACTOR * Math.max(...ALL_TYPES.map((t) => BUILDING_SHAPES[t].radius));
    expect(ringAngle(biggestShell, 0)).toBeLessThan(edgeAngle);

    // DOLNA GRANICA — obręcz musi WYSTAWAĆ poza najgrubszą bryłę, i to o próg BEZWZGLĘDNY,
    // nie o „cokolwiek dodatniego": to `promień pierścienia − promień bryły` decyduje o tym,
    // ile alarmu widać, bo reszta chowa się pod budynkiem.
    expect(narrowest - biggestShell, 'widoczna obręcz w spoczynku').toBeGreaterThanOrEqual(MIN_ALERT_RING_WORLD);
    layer.dispose();
  });
});

describe('[MUTACJA] stan USZKODZONY jest widoczny w wyjściu', () => {
  it('9. rdzeń kurczy się i czerwienieje MONOTONICZNIE wraz ze spadkiem hp', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    const maxHp = BUILDINGS.CORE.hp;
    const building = place(list, 300, 'CORE');

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

    // --- PROGI BEZWZGLĘDNE (runda naprawcza 1) ----------------------------------------
    // Poprzednia wersja kotwiczyła oba końce rampy do stałych, których pilnowała
    // (`fullRadius * CORE_SCALE_MIN`, `CORE_COLOR_CRITICAL[0] − [1]`), więc zostawała
    // wyłącznie monotoniczność — a ta jest prawdziwa dla dowolnie małej zmiany.
    // `CORE_SCALE_MIN = 0,985` przechodziło komplet testów.
    //
    // Kanał geometryczny ograniczamy POLEM (to ono, nie promień, decyduje o tym, jak bardzo
    // plama się skurczyła dla oka) oraz bezwzględnym skokiem promienia na największej bryle.
    const areaRatio = (radii[radii.length - 1] / radii[0]) ** 2;
    expect(areaRatio, 'pole rdzenia przy zerowym hp').toBeLessThanOrEqual(MAX_CORE_AREA_AT_ZERO_HP);
    expect(radii[0] - radii[radii.length - 1], 'skok promienia rdzenia').toBeGreaterThanOrEqual(
      MIN_CORE_RADIUS_DROP_WORLD,
    );

    // Kanał barwny musi być BARWNY, nie tylko monotoniczny: szarość o identycznej luminancji
    // (0,378608) przechodziła wszystko, łącznie z testem 2, bo kontrast wobec każdego pasma
    // zostawał bez zmiany. Mierzymy więc odległość barw od szarości o WŁASNEJ luminancji
    // końca rampy — w sRGB, bo to ona odpowiada postrzeganiu.
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
    // Do rundy naprawczej 1 druga połowa tego testu brzmiała `JSON.stringify(planet)` i NIE
    // MOGŁA oblać: `createBuildingLayer` czyta z `planet` wyłącznie `radius` i `cells.length`
    // w chwili budowy i nie trzyma do niego referencji, więc `update` nie ma go jak dotknąć.
    // Strażnikiem udającym strażnika była więc połowa testu.
    //
    // Bufory `PlanetGeometry` to co innego: warstwa TRZYMA do nich referencję i czyta z nich
    // w pętli renderu co klatkę. Pomyłka `target` ↔ `geo.positions` w `writeInstance`
    // zniszczyłaby geometrię TERENU spod siatki planety, i to nieodwracalnie.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 30 + k * 11, type, { hp: BUILDINGS[type].hp * 0.4, powered: k % 2 === 0 }));
    const buildingsBefore = JSON.stringify(list);
    const geometryBefore = [geo.positions, geo.normals, geo.indices, geo.cellVertexStart, geo.cellVertexCount].map(
      (buffer) => createHash('sha256').update(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)).digest('hex'),
    );
    layer.update(list, 0.37);
    layer.update(list, 0.74);
    expect(JSON.stringify(list)).toBe(buildingsBefore);
    expect(
      [geo.positions, geo.normals, geo.indices, geo.cellVertexStart, geo.cellVertexCount].map((buffer) =>
        createHash('sha256').update(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)).digest('hex'),
      ),
    ).toEqual(geometryBefore);
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
    scene.updateBuildings(list, ALERT_PULSE_PERIOD_SECONDS / 2);
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
      layer.update(list, sink * 1e-6);
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
      layer.update(list, i * 1e-3);
      sink += allocatingVariant();
    }

    const emptyLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) sink += i;
    };
    const measuredLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) layer.update(list, i * 1e-3);
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

  it('19. puls jest gładki, okresowy i ZACZYNA się w minimum', () => {
    expect(alertPulseScale(0)).toBeCloseTo(1, 12);
    expect(alertPulseScale(ALERT_PULSE_PERIOD_SECONDS)).toBeCloseTo(1, 12);
    // Maksimum w połowie okresu — ZE ZNAKIEM i bez odwoływania się do amplitudy (poprzednia
    // wersja pinowała tu `1 + ALERT_PULSE_AMPLITUDE`, czyli stałą, której pilnowała).
    expect(alertPulseScale(ALERT_PULSE_PERIOD_SECONDS / 2)).toBeGreaterThan(alertPulseScale(0));
    let highest = 0;
    for (let i = 0; i <= 2000; i++) highest = Math.max(highest, alertPulseScale((i / 2000) * ALERT_PULSE_PERIOD_SECONDS));
    expect(alertPulseScale(ALERT_PULSE_PERIOD_SECONDS / 2)).toBeCloseTo(highest, 9);
    // Nigdy poniżej minimum — pierścień nie wjeżdża pod skorupę w żadnej fazie.
    for (let i = 0; i <= 200; i++) {
      const s = alertPulseScale((i / 200) * ALERT_PULSE_PERIOD_SECONDS * 3);
      expect(s).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(s).toBeLessThanOrEqual(highest + 1e-12);
    }
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
  it('22. KAŻDA liczbowa stała modułu jest oznaczona `// [WYGLĄD]`', () => {
    // `global-constraints.md`: „Każda liczba czysto wizualna oznaczona `// [WYGLĄD]`".
    // Konwencji nie pilnował dotąd żaden test w repozytorium, i dwie stałe tego modułu
    // (`SHELL_SIDES`, `ALERT_SIDES`) faktycznie jej nie spełniały. Strażnik jest wąski —
    // dotyczy TEGO pliku — ale tani, a plik jest dziś największym skupiskiem takich liczb.
    const source = readFileSync(new URL('../src/buildingMesh.ts', import.meta.url), 'utf8');
    const declarations = [...source.matchAll(/^(?:export )?const ([A-Z_0-9]+)(?::[^=]+)? = (-?[\d.]+);(.*)$/gm)];
    expect(declarations.length, 'żadna stała liczbowa nie została znaleziona — regex przestał pasować').toBeGreaterThan(
      10,
    );
    const unmarked = declarations.filter((m) => !m[3].includes('[WYGLĄD]')).map((m) => m[1]);
    expect(unmarked, `stałe bez markera: ${unmarked.join(', ')}`).toEqual([]);
  });
});
