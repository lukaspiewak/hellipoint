import { describe, expect, it } from 'vitest';
import { describeGcWindows, gcMedian, gcNoiseLimit, measureGcWindows } from './support/gcWindows.js';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, type BufferAttribute, type BufferGeometry, type Object3D, type Scene } from 'three';
import { createPlanet, ENEMIES, type EnemyType, type Unit, type Vec3 } from '@heliopolis/sim';
import {
  burnCoreScale,
  createUnitLayer,
  exposureFraction,
  unitShade,
  writeUnitCoreColor,
  writeUnitRimColor,
  INITIAL_UNIT_CAPACITY,
  UNIT_BAND_SHADE,
  UNIT_BAND_SHADE_LEGAL,
  UNIT_CORE_COLOR_COOL,
  UNIT_CORE_COLOR_HOT,
  UNIT_CORE_LIFT_FACTOR,
  UNIT_CORE_SCALE_MIN,
  UNIT_LIFT_FACTOR,
  UNIT_RADIUS_FACTOR,
  UNIT_RIM_COLOR,
  UNIT_RIM_FACTOR,
  UNIT_SHAPES,
  type UnitShadingMode,
} from '../src/unitMesh.js';
import { DEFAULT_OUTLINE_PALETTE, DEFAULT_PALETTE, LIGHT_BANDS, lightBand, type Rgb } from '../src/shading.js';
import { buildCellOutlines, OUTLINE_LIFT } from '../src/planetMesh.js';
import { SURFACE_LIFT_FACTOR } from '../src/buildingMesh.js';
import { buildPlanetGeometry } from '../src/geometry.js';
import { MAX_DISTANCE_FACTOR } from '../src/camera.js';
import { createSceneWithRenderer, type SceneRenderer } from '../src/scene.js';
import { createFakeCanvas } from './support/fakeCanvas.js';
import { MIN_VISIBLE_PX, pixelsPerUnit } from './support/pixelScale.js';

const planet = createPlanet({ seed: 20260915 });
const geo = buildPlanetGeometry(planet);
const CELL_COUNT = planet.cells.length;

/** Wszystkie typy wroga, w stałej kolejności. Typowana tablica — dołożenie typu w `EnemyType`
 *  bez dopisania go tutaj przestaje się kompilować, więc żaden test nie pominie go po cichu. */
const ALL_TYPES: readonly EnemyType[] = ['SWARM', 'ARMOR', 'DISRUPTOR'];
const ALL_SHADING_MODES: readonly UnitShadingMode[] = ['flat', 'threshold', 'smooth'];

function darkField(): Float32Array {
  return new Float32Array(CELL_COUNT);
}

/** Pozycja świata jednostki stojącej dokładnie na środku komórki (KOPIA, jak `spawnUnit`). */
function centerOf(cellId: number): Vec3 {
  const c = planet.cells[cellId].center;
  return { x: c.x, y: c.y, z: c.z };
}

/**
 * Pozycja świata MIĘDZY środkami dwóch komórek, zrzutowana na sferę — czyli dokładnie to,
 * co produkuje `slerpToward` w `movement.ts`. Potrzebna, bo cała różnica między tą warstwą
 * a warstwą budynków polega na tym, że jednostka NIE stoi na środku komórki.
 */
function betweenCells(a: number, b: number, t: number): Vec3 {
  const ca = planet.cells[a].center;
  const cb = planet.cells[b].center;
  const v = new Vector3(ca.x + (cb.x - ca.x) * t, ca.y + (cb.y - ca.y) * t, ca.z + (cb.z - ca.z) * t)
    .normalize()
    .multiplyScalar(planet.radius);
  return { x: v.x, y: v.y, z: v.z };
}

let nextId = 1;
function unit(type: EnemyType, cellId: number, opts: { exposure?: number; pos?: Vec3 } = {}): Unit {
  return {
    id: nextId++,
    type,
    cellId,
    pos: opts.pos ?? centerOf(cellId),
    hp: ENEMIES[type].hp,
    exposure: opts.exposure ?? 0,
  };
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
  if (!a) throw new Error('test: warstwa nie ma bufora barw instancji');
  return [a.array[slot * 3], a.array[slot * 3 + 1], a.array[slot * 3 + 2]];
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
/** Odległość barw po ZAKODOWANIU do sRGB — miara „jak bardzo to widać". */
function srgbDistance(a: Rgb, b: Rgb): number {
  const encode = (u: number): number => (u <= 0.0031308 ? u * 12.92 : 1.055 * Math.pow(u, 1 / 2.4) - 0.055);
  return Math.hypot(encode(a[0]) - encode(b[0]), encode(a[1]) - encode(b[1]), encode(a[2]) - encode(b[2]));
}

/** Każde tło, na którym jednostka może stanąć: trzy pasma wypełnień i trzy barwy kraty. */
const BACKGROUNDS: readonly (readonly [string, Rgb])[] = [
  ['noc', DEFAULT_PALETTE[0]],
  ['zmierzch', DEFAULT_PALETTE[1]],
  ['dzień', DEFAULT_PALETTE[2]],
  ['obrys nocy', DEFAULT_OUTLINE_PALETTE[0]],
  ['obrys zmierzchu', DEFAULT_OUTLINE_PALETTE[1]],
  ['obrys dnia', DEFAULT_OUTLINE_PALETTE[2]],
];

const WCAG_MIN = 3;

// --- Progi CZYTELNOŚCI: minimum po populacji, w PIKSELACH ---------------------------------
//
// Przelicznik jest WYPROWADZANY ze stałych `camera.ts` w jednym miejscu (`support/pixelScale.ts`)
// i importowany tutaj — nie przepisywany. Do przeglądu gałęzi stał tu i w `buildingMesh.test.ts`
// ręczny literał `3.41`, więc zestrojenie kadrowania w Fazie 4 (jedna liczba `[WYGLĄD]`)
// unieważniało KAŻDY próg pikselowy obu warstw przy zielonym CI. Dwa przeliczniki na dwie
// warstwy tej samej sceny rozjechałyby się przy pierwszej zmianie kamery, a progi obu warstw
// opisują TEN SAM ekran.
//
// **Każdy próg poniżej wiąże MINIMUM po populacji, wyrażone w pikselach.** Nie maksimum, nie
// iloraz, nie ułamek promienia — populacja jednostek ma trzech członków i najmniejszy z nich
// jest tym, o który chodzi.
const PIXELS_PER_UNIT = pixelsPerUnit(planet.radius);
const px = (world: number): number => world * PIXELS_PER_UNIT;

/** Odległość barw (sRGB) gorącego końca rampy od SZAROŚCI o tej samej luminancji. */
const MIN_HOT_CHROMA = 0.3;

/**
 * Najmniejszy promień WPISANY komórki, zmierzony w Zadaniu 3 na wszystkich 1442 komórkach
 * (`buildingMesh.test.ts`, `minOutlineEdgeAngle`). Tutaj potrzebny wyłącznie jako GÓRNA
 * granica wielkości jednostki, więc odtwarzany skrótem — odległością środek → najbliższy
 * punkt najbliższej krawędzi obrysu — a nie całym przyrządem tamtego pliku.
 */
function smallestInscribedRadius(): number {
  const outlines = buildCellOutlines(geo);
  let best = Infinity;
  const p = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 0; i < CELL_COUNT; i++) {
    const center = new Vector3(
      planet.cells[i].center.x,
      planet.cells[i].center.y,
      planet.cells[i].center.z,
    ).normalize();
    const start = outlines.cellVertexStart[i];
    const edges = outlines.cellVertexCount[i] / 2;
    for (let e = 0; e < edges; e++) {
      const i0 = (start + e * 2) * 3;
      const i1 = (start + e * 2 + 1) * 3;
      a.set(outlines.positions[i0], outlines.positions[i0 + 1], outlines.positions[i0 + 2]);
      b.set(outlines.positions[i1], outlines.positions[i1 + 1], outlines.positions[i1 + 2]);
      for (let s = 0; s <= 40; s++) {
        p.copy(a).lerp(b, s / 40).normalize();
        best = Math.min(best, Math.acos(Math.min(1, p.dot(center))));
      }
    }
  }
  return Math.tan(best) * planet.radius;
}

/** Najmniejszy promień OPISANY komórki — wyłącznie do GÓRNEJ granicy uniesienia. */
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
 * Ile trójkątów geometrii jest nawiniętych ODWROTNIE niż kierunek, w który mają patrzeć.
 * Ten sam przyrząd i to samo uzasadnienie co w `buildingMesh.test.ts`: w Zadaniu 3
 * odwrotne nawinięcie skasowało CAŁĄ warstwę z ekranu, a znalazły to dopiero oczy.
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
    if (normal.lengthSq() === 0) continue;
    normal.normalize();
    const centroid = new Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    const d = normal.dot(reference(centroid).normalize());
    if (d <= 0) wrong++;
    worstDot = Math.min(worstDot, d);
  }
  return { triangles, wrong, worstDot };
}

describe('barwy jednostki wobec trzech pasm terenu', () => {
  it('1. [SEDNO DOBORU] dwa tony jednostki pokrywają KAŻDE tło progiem 3:1 na CAŁEJ rampie spalania — a ŻADEN z nich sam tego nie potrafi', () => {
    // Własność, na której stoi cały dobór barw. Sprawdzana na CAŁEJ rampie, nie na jej
    // końcach: rampa jest liniowa w przestrzeni liniowej, więc luminancja też — ale test,
    // który bierze tylko dwa punkty, przestałby wiązać w chwili, gdy ktoś wprowadzi trzeci
    // punkt kontrolny albo krzywą.
    const buffer = new Float32Array(3);
    for (const [name, background] of BACKGROUNDS) {
      let worst = Infinity;
      for (let i = 0; i <= 100; i++) {
        writeUnitCoreColor(i / 100, 1, buffer, 0);
        const core: Rgb = [buffer[0], buffer[1], buffer[2]];
        worst = Math.min(worst, Math.max(contrast(UNIT_RIM_COLOR, background), contrast(core, background)));
      }
      expect(worst, `tło "${name}"`).toBeGreaterThanOrEqual(WCAG_MIN);
    }

    // --- KONTROLA POZYTYWNA NA SAM PRZYRZĄD -------------------------------------------
    // Gdyby ten test dało się zdać JEDNYM tonem, nie mierzyłby dwutonowości, tylko „kolory
    // są jakieś". Każdy ton Z OSOBNA musi więc gdzieś oblewać...
    const alone = (tone: Rgb): number => Math.min(...DEFAULT_PALETTE.map((band) => contrast(tone, band)));
    expect(alone(UNIT_RIM_COLOR)).toBeLessThan(WCAG_MIN); // ciemny ginie w nocy
    expect(alone(UNIT_CORE_COLOR_COOL)).toBeLessThan(WCAG_MIN); // jasny ginie w dniu
    expect(alone(UNIT_CORE_COLOR_HOT)).toBeLessThan(WCAG_MIN);
    // ...i nie jest to kwestia nietrafionego wyboru: NAJLEPSZY MOŻLIWY pojedynczy ton na tej
    // palecie osiąga 2,3202. Przeliczane TUTAJ, a nie przepisywane z Zadania 3 — gdyby ktoś
    // zmienił paletę terenu, ta asercja pokaże nową granicę zamiast powtórzyć starą liczbę.
    let bestPossible = 0;
    for (let i = 0; i <= 100000; i++) {
      const l = i / 100000;
      const worst = Math.min(
        ...DEFAULT_PALETTE.map((band) => {
          const lb = luminance(band);
          return (Math.max(l, lb) + 0.05) / (Math.min(l, lb) + 0.05);
        }),
      );
      if (worst > bestPossible) bestPossible = worst;
    }
    expect(bestPossible, 'najlepszy możliwy pojedynczy ton').toBeLessThan(WCAG_MIN);
  });

  it('2. rampa spalania NIGDY nie kosztuje widoczności nocnej, a jej gorący koniec jest BARWĄ, nie szarością', () => {
    // Rdzeń jest JEDYNYM tonem jednostki widocznym na paśmie nocy — a jednostka z wysoką
    // ekspozycją dogasa właśnie w cieniu (`SHADOW_RECOVERY_RATE`, burning.ts). Rampa, która
    // po drodze ciemnieje, kupowałaby czytelność spalania za cenę zgubienia uciekiniera.
    const buffer = new Float32Array(3);
    let worstNight = Infinity;
    for (let i = 0; i <= 100; i++) {
      writeUnitCoreColor(i / 100, 1, buffer, 0);
      worstNight = Math.min(worstNight, contrast([buffer[0], buffer[1], buffer[2]], DEFAULT_PALETTE[0]));
    }
    expect(worstNight).toBeGreaterThanOrEqual(WCAG_MIN);

    // Szarość o identycznej luminancji ma ten sam kontrast wobec KAŻDEGO tła, więc żadna
    // asercja oparta na luminancji jej nie odróżni — a kanał barwy byłby wtedy martwy.
    // Dokładnie ta mutacja przechodziła komplet testów w Zadaniu 3, rundzie 1.
    const hotLuminance = luminance(UNIT_CORE_COLOR_HOT);
    expect(srgbDistance(UNIT_CORE_COLOR_HOT, [hotLuminance, hotLuminance, hotLuminance])).toBeGreaterThanOrEqual(
      MIN_HOT_CHROMA,
    );
    // ...i oba końce rampy muszą się od siebie różnić, inaczej kanał nie ma amplitudy.
    expect(srgbDistance(UNIT_CORE_COLOR_COOL, UNIT_CORE_COLOR_HOT)).toBeGreaterThanOrEqual(MIN_HOT_CHROMA);
  });
});

describe('kodowanie spalania — minimum po populacji, w pikselach', () => {
  it('3. ciemna obwódka ma tę samą szerokość dla KAŻDEGO typu i przekracza próg widoczności', () => {
    // Obwódka jest RAMKĄ: to lekcja rundy naprawczej 2 Zadania 3, w której obwódka
    // PROPORCJONALNA spełniała próg wyłącznie dla największego typu, a najmniejszy miał
    // 0,59 px. Przeniesiona tu od razu — i sprawdzona na FAKTYCZNYCH macierzach, nie na
    // stałej, bo sprawdzana jest implementacja, a nie deklaracja.
    const layer = createUnitLayer(planet);
    const units = ALL_TYPES.map((type, k) => unit(type, 100 + k * 37));
    layer.update(units, darkField());

    const rims: number[] = [];
    ALL_TYPES.forEach((type, slot) => {
      const bodyRadius = basisColumn(matrixAt(layer.body, slot), 0).length();
      const coreRadius = basisColumn(matrixAt(layer.core, slot), 0).length();
      expect(coreRadius, `${type}: rdzeń wystaje poza tarczę`).toBeLessThan(bodyRadius);
      rims.push(bodyRadius - coreRadius);
    });
    // STAŁOŚĆ: rozrzut poniżej 10⁻⁴ jednostki (3·10⁻⁴ px) to szum float32 w buforze macierzy,
    // nie zależność od typu. Proporcja dawałaby tu 0,245.
    expect(Math.max(...rims) - Math.min(...rims), 'obwódka zależy od typu').toBeLessThan(1e-4);
    // MINIMUM po populacji, w pikselach.
    expect(px(Math.min(...rims)), 'najwęższa obwódka').toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
    layer.dispose();
  });

  it('4. tarcza stoi we WŁASNEJ pozycji jednostki, nie na środku komórki, i jest zwrócona NA ZEWNĄTRZ', () => {
    // To jest cała różnica między tą warstwą a warstwą budynków: `Unit.pos` jest wektorem
    // świata przepisywanym co tick, więc jednostka stoi MIĘDZY komórkami. Warstwa, która
    // rysowałaby ją na środku `cellId`, przechodziłaby każdy test zbudowany na środkach
    // komórek, a na ekranie skakałaby skokowo z komórki na komórkę.
    const layer = createUnitLayer(planet);
    const cellId = 311;
    const neighbor = planet.cells[cellId].neighbors[0];
    const pos = betweenCells(cellId, neighbor, 0.5);
    layer.update([unit('ARMOR', cellId, { pos })], darkField());

    const m = matrixAt(layer.body, 0);
    const t = translationOf(m);
    const normal = new Vector3(pos.x, pos.y, pos.z).normalize();
    const lift = planet.radius * UNIT_LIFT_FACTOR;

    // KONTROLA POZYTYWNA na sam dobór pozycji: punkt testowy MUSI leżeć wyraźnie daleko od
    // środka komórki, inaczej asercja niżej byłaby prawdziwa także dla warstwy rysującej na
    // środkach. Połowa odstępu sąsiadów to ok. 3,9 jednostki.
    const center = new Vector3(...([centerOf(cellId).x, centerOf(cellId).y, centerOf(cellId).z] as const));
    expect(t.distanceTo(center), 'punkt testowy zbyt blisko środka komórki').toBeGreaterThan(1);

    // Pozycja: kierunek `pos`, długość `|pos| + uniesienie`.
    expect(t.clone().normalize().dot(normal)).toBeGreaterThan(0.999999);
    expect(t.length()).toBeCloseTo(planet.radius + lift, 4);

    // Oś Z bazy kontra normalna powierzchni — asercja KIERUNKOWA (iloczyn skalarny), NIE na
    // wielkości bezwzględnej: `Math.abs`/`Math.hypot` przepuściłyby normalną odwróconą, czyli
    // tarczę zwróconą do wnętrza planety, którą odcinanie tylnych ścian usunęłoby z ekranu.
    const up = basisColumn(m, 2).normalize();
    expect(up.dot(normal)).toBeGreaterThan(0.999999);

    // Baza ortonormalna i PRAWOSKRĘTNA (X × Y = Z).
    const x = basisColumn(m, 0).normalize();
    const y = basisColumn(m, 1).normalize();
    expect(x.dot(y)).toBeCloseTo(0, 5);
    expect(x.dot(up)).toBeCloseTo(0, 5);
    expect(new Vector3().crossVectors(x, y).dot(up)).toBeCloseTo(1, 5);

    // Rdzeń dzieli z tarczą oś i kierunek — inaczej byłby przesunięty w bok albo obrócony.
    const coreMatrix = matrixAt(layer.core, 0);
    expect(translationOf(coreMatrix).clone().normalize().dot(normal)).toBeGreaterThan(0.999999);
    layer.dispose();
  });

  it('5. trzy typy dają TRZY różne tarcze, każda para różni się o ponad piksel, i największa mieści się w komórce', () => {
    const layer = createUnitLayer(planet);
    const units = ALL_TYPES.map((type, k) => unit(type, 20 + k * 131));
    layer.update(units, darkField());
    expect(layer.body.count).toBe(3);

    const radii = new Map<EnemyType, number>();
    ALL_TYPES.forEach((type, slot) => {
      const radius = basisColumn(matrixAt(layer.body, slot), 0).length();
      // Tabela kształtów faktycznie DOCIERA do macierzy, a nie tylko istnieje w module.
      expect(radius, type).toBeCloseTo(planet.radius * UNIT_RADIUS_FACTOR * UNIT_SHAPES[type], 4);
      radii.set(type, radius);
    });

    const sorted = [...radii.values()].sort((a, b) => a - b);
    // Próg wiąże MINIMUM po parach SĄSIEDNICH, nie rozpiętość SWARM↔ARMOR: rozpiętość jest
    // spełniona przez dwa skrajne typy nawet wtedy, gdy trzeci leży na jednym z nich.
    for (let i = 1; i < sorted.length; i++) {
      expect(px(sorted[i] - sorted[i - 1]), `rozstęp ${i}`).toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
    }
    // Próg BEZWZGLĘDNY na najmniejszym typie: bez niego trzy różne, dowolnie małe tarcze
    // przechodzą wszystko powyżej (to jest dokładnie ta wada, którą Zadanie 3 miało w
    // tabeli `BUILDING_SHAPES` po rundzie 1).
    expect(px(sorted[0]), 'najmniejsza tarcza').toBeGreaterThanOrEqual(MIN_VISIBLE_PX);

    // GÓRNA granica: nawet największa jednostka jest mniejsza od promienia WPISANEGO
    // najmniejszej komórki, więc nie przykrywa całego pola terenu, na którym stoi.
    const inscribed = smallestInscribedRadius();
    // NIE `toBeCloseTo(3.172, 2)`. Ta liczba jest CZYSTĄ FUNKCJĄ `OUTLINE_INSET` z
    // `planetMesh.ts` — stałej `[WYGLĄD]` CUDZEGO modułu — więc przypięta tutaj robiła z
    // testu JEDNOSTEK strażnika kraty: zestrojenie `OUTLINE_INSET` 0,07 → 0,10 oblewało ten
    // test komunikatem o jednostkach, choć własność linijkę niżej trzymała się z 45 %
    // zapasu. Dokładnie ten wzorzec („kotwice na stałe CUDZYCH modułów przebrane za kotwice
    // na przyrząd") kazał usunąć przegląd Zadania 3 z `buildingMesh.test.ts`; wrócił tu, bo
    // Zadanie 4 pisało własny plik po zamknięciu tamtego przeglądu.
    //
    // Zostaje to, co ta linia naprawdę miała chronić: że przyrząd COŚ policzył, a nie zwrócił
    // `Infinity` (pętla nigdy nie weszła) ani zera (obrysy puste) — w obu tych przypadkach
    // asercja niżej byłaby albo zawsze prawdziwa, albo zawsze fałszywa, niezależnie od tarcz.
    expect(Number.isFinite(inscribed), 'przyrząd nie policzył promienia wpisanego').toBe(true);
    expect(inscribed).toBeGreaterThan(0);
    expect(inscribed).toBeLessThan(planet.radius);
    expect(sorted[sorted.length - 1], 'największa tarcza przykrywa komórkę').toBeLessThan(inscribed);
    layer.dispose();
  });

  it('6. rdzeń kurczy się MONOTONICZNIE z ekspozycją, a NAJMNIEJSZY typ nadal to pokazuje', () => {
    // Dwa progi ciągnące w przeciwne strony, oba muszą być spełnione dla NAJMNIEJSZEGO typu:
    // rdzeń tuż przed śmiercią zostaje widoczny (uciekinier dogasa na nocy, gdzie tylko on
    // jest widoczny) ORAZ skok promienia między zerową a pełną ekspozycją jest widoczny (bo
    // to on JEST sygnałem). Ich suma jest stała — dlatego `UNIT_CORE_SCALE_MIN` musi dzielić
    // budżet po równo, a nie „gdzieś pośrodku".
    const layer = createUnitLayer(planet);
    const smallest = ALL_TYPES.reduce((a, b) => (UNIT_SHAPES[a] <= UNIT_SHAPES[b] ? a : b));
    expect(smallest).toBe('SWARM'); // kotwica: to on jest najgorszym przypadkiem

    const burnTime = ENEMIES[smallest].burnTime;
    const steps = 20;
    const units: Unit[] = [];
    for (let i = 0; i <= steps; i++) {
      units.push(unit(smallest, 40 + i, { exposure: (burnTime * i) / steps }));
    }
    layer.update(units, darkField());

    let previous = Infinity;
    const sizes: number[] = [];
    const bodies: number[] = [];
    for (let slot = 0; slot <= steps; slot++) {
      const r = basisColumn(matrixAt(layer.core, slot), 0).length();
      expect(r, `krok ${slot}`).toBeLessThan(previous); // ŚCIŚLE malejąca
      previous = r;
      sizes.push(r);
      bodies.push(basisColumn(matrixAt(layer.body, slot), 0).length());
    }

    const full = sizes[0];
    const burnt = sizes[steps];
    expect(px(burnt), 'rdzeń SWARM tuż przed śmiercią').toBeGreaterThanOrEqual(MIN_VISIBLE_PX);
    expect(px(full - burnt), 'skok promienia rdzenia SWARM').toBeGreaterThanOrEqual(MIN_VISIBLE_PX);

    // --- Ciemna plama ROŚNIE, i to jest OSOBNA własność, nie przeliczenie tamtych dwóch ----
    //
    // Do rundy naprawczej 1 stała tu asercja `px(tarcza − rdzeń_spalony) ≥ px(tarcza −
    // rdzeń_świeży) + 1`, która po skróceniu `tarcza` redukuje się do linijki wyżej — dwa
    // strażniki policzone tam, gdzie stoi jeden. Dowód, nie podejrzenie: przegląd puścił
    // mutację „tarcza kurczy się RAZEM z rdzeniem, obwódka NIE rośnie" i **test 6 przeszedł**.
    //
    // Treścią, której tamte dwie asercje NIE niosą, jest ROSNĄCA OBWÓDKA: to ona czyni z
    // płonącej jednostki rosnącą czarną plamę na paśmie, na którym spalanie zachodzi — a
    // spalanie zachodzi wyłącznie tam, gdzie `light > 0`, czyli tam, gdzie widoczny jest
    // TYLKO ton ciemny. Mierzona na WSZYSTKICH krokach rampy i na NAJMNIEJSZYM typie, jako
    // ścisła monotoniczność `tarcza − rdzeń`.
    //
    // Granica jest ostra i ma sens fizyczny, nie tolerancyjny: gdyby tarcza kurczyła się z
    // czynnikiem `1 − k·ułamek`, obwódka rośnie wtedy i tylko wtedy, gdy
    // `k < 0,5·(promień − obwódka)/promień` = 0,325 dla SWARM-a. Przy `k = 0,5` (czyli
    // „tarcza kurczy się RAZEM z rdzeniem" — dokładnie ta mutacja, którą przegląd puścił i
    // którą poprzednia wersja tego testu PRZEPUŚCIŁA) obwódka nie rośnie wcale, tylko maleje.
    //
    // Czego tu ŚWIADOMIE NIE MA:
    //  • osobnej asercji na STAŁOŚĆ tarczy — wiąże ją DOKŁADNIE test 9, porównując macierz
    //    tarczy tej samej jednostki między dwoma wywołaniami `update`; tam basis jest ten sam,
    //    więc równość co do bitu jest uprawniona. Tutaj każdy krok rampy stoi na INNEJ
    //    komórce, więc promienie różnią się szumem float32 (zmierzone: do 3,9·10⁻⁸) i
    //    jakakolwiek tolerancja byłaby luźniejsza od tamtego strażnika, czyli nigdy by nie
    //    zadziałała. Dwa strażniki policzone tam, gdzie stoi jeden — to jest ta sama wada,
    //    którą runda naprawcza 1 usunęła z tego miejsca, tylko w drugiej postaci.
    //  • asercji na to, O ILE obwódka urosła — przy stałej tarczy to jest co do bitu
    //    `full − burnt`, czyli liczba, którą wiąże już asercja „skok promienia rdzenia" wyżej.
    let previousRim = -Infinity;
    for (let slot = 0; slot <= steps; slot++) {
      const rim = bodies[slot] - sizes[slot];
      expect(rim, `obwódka na kroku ${slot}`).toBeGreaterThan(previousRim);
      previousRim = rim;
    }
    layer.dispose();
  });

  it('7. postęp spalania liczy się z burnTime TYPU — te same sekundy w słońcu znaczą co innego dla SWARM i ARMOR', () => {
    // Bez tego kanał odpowiadałby na pytanie „jak długo stoi w słońcu" zamiast „ile mu
    // zostało" — a cała ekonomia dnia i nocy stoi właśnie na tym drugim: ARMOR (burnTime 8,
    // speedFactor 0,85) jest w świetle skazany, SWARM (3 / 2,3) zdąży uciec.
    expect(ENEMIES.SWARM.burnTime).not.toBe(ENEMIES.ARMOR.burnTime); // kontrola na przesłankę
    const seconds = 2;
    expect(exposureFraction(seconds, ENEMIES.SWARM.burnTime)).toBeCloseTo(2 / 3, 6);
    expect(exposureFraction(seconds, ENEMIES.ARMOR.burnTime)).toBeCloseTo(0.25, 6);

    const layer = createUnitLayer(planet);
    layer.update([unit('SWARM', 50, { exposure: seconds }), unit('SWARM', 51)], darkField());
    const swarmBurnt = basisColumn(matrixAt(layer.core, 0), 0).length();
    const swarmFresh = basisColumn(matrixAt(layer.core, 1), 0).length();

    layer.update([unit('ARMOR', 50, { exposure: seconds }), unit('ARMOR', 51)], darkField());
    const armorBurnt = basisColumn(matrixAt(layer.core, 0), 0).length();
    const armorFresh = basisColumn(matrixAt(layer.core, 1), 0).length();

    // Ten sam czas w świetle, RÓŻNY ubytek rdzenia — i to w stronę zgodną z `burnTime`.
    expect(1 - swarmBurnt / swarmFresh).toBeCloseTo((1 - UNIT_CORE_SCALE_MIN) * (2 / 3), 5);
    expect(1 - armorBurnt / armorFresh).toBeCloseTo((1 - UNIT_CORE_SCALE_MIN) * 0.25, 5);
    layer.dispose();
  });

  it('8. ekspozycja poza zakresem nie wysadza renderu ani nie odwraca kodowania', () => {
    // `burning.ts` nabija `exposure` PRZED sprzątnięciem martwych, więc klatka z ekspozycją
    // powyżej `burnTime` jest poprawnym stanem symulacji, nie błędem. Ujemna nie zdarza się
    // dziś, ale `Math.max(0, …)` w regeneracji to jedna linia od tego, żeby się zdarzyła.
    expect(exposureFraction(-5, 3)).toBe(0);
    expect(exposureFraction(1e9, 3)).toBe(1);
    expect(exposureFraction(Number.NaN, 3)).toBe(0);
    expect(() => exposureFraction(1, 0)).toThrow(RangeError);
    expect(() => exposureFraction(1, -1)).toThrow(RangeError);

    const layer = createUnitLayer(planet);
    layer.update(
      [unit('SWARM', 60, { exposure: -10 }), unit('SWARM', 61, { exposure: 1e9 }), unit('SWARM', 62)],
      darkField(),
    );
    const below = basisColumn(matrixAt(layer.core, 0), 0).length();
    const above = basisColumn(matrixAt(layer.core, 1), 0).length();
    const fresh = basisColumn(matrixAt(layer.core, 2), 0).length();
    expect(below).toBeCloseTo(fresh, 6); // przycięte do zera, nie „większe niż pełne"
    expect(above).toBeCloseTo(fresh * UNIT_CORE_SCALE_MIN, 6);
    expect(above).toBeLessThan(below); // kierunek kodowania NIE odwrócony
    layer.dispose();
  });

  it('9. [MUTACJA] spalanie rusza WYŁĄCZNIE rdzeń — tarcza i jej barwa zostają nietknięte', () => {
    // Dwa kanały mają być rozłączne: gdyby spalanie ruszało też tarczę, nie dałoby się
    // odróżnić „ten wróg jest większy" od „ten wróg się pali".
    const layer = createUnitLayer(planet);
    const light = darkField();
    layer.update([unit('DISRUPTOR', 700)], light);
    const bodyFresh = matrixAt(layer.body, 0).elements.slice();
    const coreFresh = matrixAt(layer.core, 0).elements.slice();
    const rimFresh = instanceColorAt(layer.body, 0);
    const colorFresh = instanceColorAt(layer.core, 0);

    layer.update([unit('DISRUPTOR', 700, { exposure: ENEMIES.DISRUPTOR.burnTime })], light);
    const bodyBurnt = matrixAt(layer.body, 0).elements.slice();
    const coreBurnt = matrixAt(layer.core, 0).elements.slice();
    const rimBurnt = instanceColorAt(layer.body, 0);
    const colorBurnt = instanceColorAt(layer.core, 0);

    expect(bodyBurnt).toEqual(bodyFresh);
    expect(rimBurnt).toEqual(rimFresh);
    // ...a rdzeń MUSI się zmienić — i geometrią, i barwą.
    expect(coreBurnt).not.toEqual(coreFresh);
    expect(srgbDistance(colorBurnt, colorFresh)).toBeGreaterThanOrEqual(MIN_HOT_CHROMA);
    layer.dispose();
  });

  it('10. update() NICZEGO nie mutuje — ani listy jednostek, ani ich wektorów pozycji', () => {
    // `global-constraints.md`: render czyta i rysuje. `Unit.pos` jest przy tym obiektem
    // MUTOWALNYM, którego symulacja używa dalej — zapis w miejscu przestawiłby jednostkę.
    const layer = createUnitLayer(planet);
    const units = [
      unit('SWARM', 10, { pos: betweenCells(10, planet.cells[10].neighbors[0], 0.3), exposure: 1 }),
      unit('ARMOR', 11, { exposure: 4 }),
    ];
    const before = JSON.stringify(units);
    const light = darkField();
    const lightBefore = Array.from(light);
    layer.update(units, light);
    layer.update(units, light);
    expect(JSON.stringify(units)).toBe(before);
    expect(Array.from(light)).toEqual(lightBefore);
    layer.dispose();
  });

  it('11. rzuca RangeError na rozjazdach, których nic nie wiąże składniowo', () => {
    const layer = createUnitLayer(planet);
    // `light` innej planety: `light[cellId]` byłoby `undefined`, a `lightBand(undefined)`
    // cicho zwraca 0 („noc") — czyli cicha, BŁĘDNA klasyfikacja zamiast błędu.
    expect(() => layer.update([unit('SWARM', 0)], new Float32Array(CELL_COUNT - 1))).toThrow(RangeError);
    // `cellId` poza zakresem — ten sam tryb awarii, z drugiej strony.
    expect(() => layer.update([unit('SWARM', 0, {})].map((u) => ({ ...u, cellId: CELL_COUNT })), darkField())).toThrow(
      RangeError,
    );
    expect(() => layer.update([unit('SWARM', 0, {})].map((u) => ({ ...u, cellId: -1 })), darkField())).toThrow(
      RangeError,
    );
    // Typ spoza `ENEMIES` — `ENEMIES[type]` byłoby `undefined`, a `undefined.burnTime`
    // wysadziłoby render z komunikatem nieprowadzącym do przyczyny.
    expect(() =>
      layer.update([{ ...unit('SWARM', 0), type: 'BOSS' as EnemyType }], darkField()),
    ).toThrow(RangeError);
    // Wektor zerowy nie ma kierunku, więc nie ma z czego zbudować bazy stycznej.
    expect(() => layer.update([unit('SWARM', 0, { pos: { x: 0, y: 0, z: 0 } })], darkField())).toThrow(RangeError);
    // KONTROLA POZYTYWNA: poprawne wejście nie rzuca (inaczej wszystkie powyższe byłyby
    // prawdziwe z byle jakiego powodu).
    expect(() => layer.update([unit('SWARM', 0)], darkField())).not.toThrow();
    layer.dispose();
  });
});

describe('pojemność buforów i budżet klatki', () => {
  it('12. pojemność startowa ma zapas nad zmierzonym szczytem, a jej przekroczenie NIE GUBI jednostki', () => {
    // Pomiar Fazy 1C: szczyt 481 ŻYWYCH jednostek w zwycięskim runie. Cały `ENEMIES` i cała
    // konfiguracja fal są `[STROJENIE]`, więc zapas ma pokryć realne przestrojenie, a nie
    // dzisiejszą liczbę plus trochę.
    const MEASURED_PEAK = 481;
    expect(INITIAL_UNIT_CAPACITY / MEASURED_PEAK).toBeGreaterThanOrEqual(4);

    const layer = createUnitLayer(planet);
    expect(layer.capacity).toBe(INITIAL_UNIT_CAPACITY);
    const light = darkField();

    // PRZEKROCZENIE: warstwa ma narysować WSZYSTKIE jednostki. Ani rzucić (stan „gracz jest
    // zalewany" jest legalny), ani narysować pierwsze `capacity` i resztę pominąć po cichu.
    const many = Array.from({ length: INITIAL_UNIT_CAPACITY + 7 }, (_, i) =>
      unit(ALL_TYPES[i % ALL_TYPES.length], i % CELL_COUNT),
    );
    layer.update(many, light);
    expect(layer.body.count).toBe(many.length);
    expect(layer.core.count).toBe(many.length);
    expect(layer.capacity).toBeGreaterThanOrEqual(many.length);
    // Ostatnia jednostka jest NAPRAWDĘ zapisana, nie tylko policzona.
    expect(basisColumn(matrixAt(layer.body, many.length - 1), 0).length()).toBeGreaterThan(0);

    // ...a DRUGIE wywołanie z tą samą liczbą już nic nie przebudowuje: te same bufory, te
    // same siatki, ta sama pojemność. To jest ta połowa własności, która pilnuje, że
    // powiększanie nie dzieje się co klatkę.
    const bodyMesh = layer.body;
    const matrixBuffer = layer.body.instanceMatrix.array;
    const grownCapacity = layer.capacity;
    layer.update(many, light);
    expect(layer.body).toBe(bodyMesh);
    expect(layer.body.instanceMatrix.array).toBe(matrixBuffer);
    expect(layer.capacity).toBe(grownCapacity);

    // Powiększona warstwa nadal wisi w SWOIM węźle — podmiana siatek nie może wypiąć
    // warstwy ze sceny (a przy okazji: stare siatki zniknęły, nie zostały obok nowych).
    const children = layer.object.children;
    expect(children).toContain(layer.body);
    expect(children).toContain(layer.core);
    expect(children.length).toBe(2);

    // Powrót do małej liczby nie zmniejsza buforów, ale zmniejsza liczbę rysowanych.
    layer.update([unit('SWARM', 0)], light);
    expect(layer.body.count).toBe(1);
    expect(layer.capacity).toBe(grownCapacity);
    layer.update([], light);
    expect(layer.body.count).toBe(0);
    layer.dispose();
  });

  it('13. update() nie alokuje NICZEGO: 600 wywołań przy PEŁNEJ pojemności nie wychodzi ponad podłogę szumu odśmiecania', () => {
    // Jednostki przepisują macierze i barwy CO KLATKĘ — to jest jedyne miejsce w renderze,
    // w którym alokacja per obiekt jest niewidoczna w zegarze, a zauważalna w odśmiecaniu.
    // Przyrząd i jego uzasadnienie: patrz długi komentarz w `budget.test.ts`.
    const layer = createUnitLayer(planet);
    const light = darkField();
    const units = Array.from({ length: INITIAL_UNIT_CAPACITY }, (_, i) => {
      const type = ALL_TYPES[i % ALL_TYPES.length];
      return unit(type, i % CELL_COUNT, {
        exposure: (ENEMIES[type].burnTime * (i % 7)) / 6,
        pos: betweenCells(i % CELL_COUNT, planet.cells[i % CELL_COUNT].neighbors[0], (i % 5) / 4),
      });
    });
    let sink = 0;

    /** Kontrola: DOKŁADNIE ta sama praca plus jedna macierz na jednostkę — realny błąd. */
    function allocatingVariant(): number {
      layer.update(units, light);
      let acc = 0;
      for (let i = 0; i < units.length; i++) acc += new Matrix4().elements[0];
      return acc;
    }

    const ITERATIONS = 600;
    for (let i = 0; i < 100; i++) {
      layer.update(units, light);
      sink += allocatingVariant();
    }

    const windows = measureGcWindows({
      empty: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += i;
      },
      measured: () => {
        for (let i = 0; i < ITERATIONS; i++) layer.update(units, light);
      },
      control: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += allocatingVariant();
      },
    });

    console.log(
      `[BUDGET] cykle GC na ${ITERATIONS} wywołań UnitLayer.update @ ${units.length} jednostek, kontrola +${units.length} Matrix4/wyw. — ${describeGcWindows(windows)}`,
    );

    // Trzy asercje, ten sam kształt co w `budget.test.ts` i `buildingMesh.test.ts` —
    // uzasadnienie i historia w `support/gcWindows.ts`.
    //
    // Runda naprawcza 1 zamieniła tu `min(okna) === 0` na porównanie z oknem BEZCZYNNYM i to
    // było w połowie trafne, ale nadal migało: zostawiłem obok `min(mierzone) === 0`, czyli
    // tę samą wadę, którą naprawiałem. Zmierzone przez przegląd pod obciążeniem
    // równoległym, trzy przebiegi pakietu: 577 zielonych / 1 oblany / 2 oblane. Log z
    // oblanego przebiegu podał mechanizm wprost — BEZCZYNNE okno 3/2, mierzone 0/1/1/1,
    // czyli **sygnał mniejszy od szumu tła**, a asercja żądała zera.
    //
    // 1. PODŁOGA: przyrząd potrafi zwrócić 0.
    expect(Math.min(...windows.empty), 'przyrząd nie potrafi zwrócić zera').toBe(0);
    // 2. CZUŁOŚĆ: wariant z JEDNĄ macierzą na jednostkę odstaje od szumu tła.
    //    Odniesieniem jest okno MIERZONE, nie bezczynne: kontrola to z definicji „mierzona
    //    praca + jedna alokacja na element", więc oba okna robią to samo i różni je DOKŁADNIE
    //    ta alokacja. Poprzednia wersja (`min(control) > max(idle)`) zestawiała podłogę
    //    jednego szumu z sufitem drugiego i przewracała się pod obciążeniem bez żadnego
    //    defektu — bo samo okno bezczynne alokuje. Pomiary: `support/gcWindows.ts`.
    expect(gcMedian(windows.control), 'kontrola alokująca nie odstaje od mierzonej pętli').toBeGreaterThan(
      gcMedian(windows.measured),
    );
    // 3. WŁASNOŚĆ: mierzona pętla nie wychodzi ponad sufit zmierzonego szumu tła.
    expect(Math.max(...windows.measured), 'UnitLayer.update alokuje').toBeLessThanOrEqual(gcNoiseLimit(windows));
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

describe('warstwa w scenie', () => {
  it('14. warstwa jest DZIECKIEM siatki terenu — schowanie planety chowa też jednostki', () => {
    // Ta sama własność, co dla kraty (Zadanie 2) i budynków (Zadanie 3), i ważniejsza niż
    // obie: jednostka pokazuje, po której stronie terminatora stoi (pali się albo nie), więc
    // zostawiona widoczna w trybie kontroli pozytywnej bramki byłaby WPROST podpowiedzią do
    // pytania, które bramka zadaje.
    //
    // Mierzone na SCENIE, którą renderer faktycznie dostaje do narysowania, i BEZ wymieniania
    // typów: „rysowalny" to tutaj „ma geometrię", dokładnie jak w teście 33
    // (`readabilityGate.test.ts`).
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
    scene.updateUnits([unit('ARMOR', 300, { exposure: 2 })], darkField());
    scene.render(darkField(), { x: 1, y: 0, z: 0 });

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

    // Teren + krata + trzy warstwy budynków + dwie warstwy jednostek = siedem rysowalnych.
    const before = drawables();
    expect(before.length).toBe(7);
    expect(before.every((d) => d.visible)).toBe(true);
    const terrain = before.find((d) => d.object.parent === lastScene);
    expect(terrain, 'siatka terenu jest jedynym rysowalnym dzieckiem sceny').toBeDefined();

    // Schowanie SAMEJ planety — nic nie wie o jednostkach — musi wygasić wszystko.
    terrain!.object.visible = false;
    const after = drawables();
    expect(after.length).toBe(7);
    expect(after.filter((d) => d.visible)).toEqual([]);

    scene.dispose();
  });

  it('15. KAŻDY trójkąt obu warstw jest zwrócony NA ZEWNĄTRZ — inaczej odcinanie tylnych ścian zjada warstwę', () => {
    // W Zadaniu 3 pierścień alarmu nie renderował się W OGÓLE, bo `side: FrontSide` wycinał
    // całą warstwę odwrotnie nawiniętą — a macierze instancji były poprawne, więc znalazły
    // to dopiero oczy. Nawinięcie jest własnością czysto arytmetyczną bufora pozycji i
    // indeksów, więc test jest tani i istnieje od pierwszej wersji tej warstwy.
    const layer = createUnitLayer(planet);
    // W przestrzeni LOKALNEJ obie tarcze leżą w z = 0 i mają patrzeć w +Z.
    for (const [name, mesh] of [
      ['tarcza', layer.body],
      ['rdzeń', layer.core],
    ] as const) {
      const report = windingReport(mesh.geometry, () => new Vector3(0, 0, 1));
      expect(report.triangles, name).toBeGreaterThan(0);
      expect(report.wrong, `${name}: trójkąty nawinięte odwrotnie`).toBe(0);
      expect(report.worstDot, name).toBeGreaterThan(0.99);
    }

    // ...a po przepuszczeniu przez macierz instancji mają patrzeć OD ŚRODKA PLANETY.
    const cellId = 900;
    layer.update([unit('ARMOR', cellId)], darkField());
    const m = matrixAt(layer.body, 0);
    const transformed = layer.body.geometry.clone().applyMatrix4(m);
    const world = windingReport(transformed, (centroid) => centroid.clone());
    expect(world.wrong, 'w świecie: trójkąty zwrócone do wnętrza planety').toBe(0);
    transformed.dispose();
    layer.dispose();
  });

  it('16. rdzeń stoi NAD tarczą, a tarcza NAD kratą i nad pierścieniem alarmu budynku', () => {
    // Uniesienie zerowe kładzie dwie powierzchnie w tej samej płaszczyźnie — migotanie
    // widoczne wyłącznie na GPU, czyli NIGDY w CI. Próg liczony ze stałych `camera.ts`, NIE
    // z testowanej stałej: przy 24-bitowym buforze rozdzielczość w odległości `z` wynosi
    // `z²(far − near)/(near · far · 2²⁴)`.
    const near = planet.radius * 0.01;
    const far = planet.radius * MAX_DISTANCE_FACTOR * 2;
    const furthest = planet.radius * (MAX_DISTANCE_FACTOR - 1);
    const depthResolution = (furthest * furthest * (far - near)) / (near * far * 2 ** 24);
    expect(depthResolution).toBeCloseTo(0.0292, 4); // kotwica na sam przyrząd

    const layer = createUnitLayer(planet);
    layer.update(ALL_TYPES.map((type, k) => unit(type, 500 + k * 11)), darkField());
    ALL_TYPES.forEach((type, slot) => {
      const bodyPos = translationOf(matrixAt(layer.body, slot));
      const corePos = translationOf(matrixAt(layer.core, slot));
      const normal = bodyPos.clone().normalize();
      // ZE ZNAKIEM: rdzeń NAD tarczą, nie pod nią. Wielkość bezwzględna przepuściłaby
      // uniesienie ujemne, czyli rdzeń schowany pod tarczą i niewidoczny.
      expect(corePos.clone().sub(bodyPos).dot(normal), type).toBeGreaterThanOrEqual(depthResolution * 3);
      // Tarcza wyżej niż krata komórek i niż pierścień alarmu budynku — obie rysowane są
      // pod nią i nie mogą z nią remisować w buforze głębokości.
      expect(bodyPos.length() - planet.radius, type).toBeGreaterThan(planet.radius * OUTLINE_LIFT);
      expect(bodyPos.length() - planet.radius, type).toBeGreaterThan(planet.radius * SURFACE_LIFT_FACTOR);
    });
    // Górna granica, ta sama reguła co dla `OUTLINE_LIFT`: poniżej 5% średnicy najmniejszej
    // komórki, żeby przy limbie nic nie nawisało nad sąsiadem.
    expect(planet.radius * (UNIT_LIFT_FACTOR + UNIT_CORE_LIFT_FACTOR)).toBeLessThan(0.05 * 2 * smallestCellRadius());
    layer.dispose();
  });
});

describe('Krok 3: cieniowanie jednostki światłem', () => {
  it('17. progowy jest SCHODKOWY, gładki CIĄGŁY — a KAŻDE widoczne przyciemnienie łamie próg 3:1', () => {
    // Pytanie Kroku 3 sprowadzone do liczb. Najpierw: oba warianty faktycznie się różnią i
    // każdy jest tym, czym się nazywa.
    expect(UNIT_BAND_SHADE.length).toBe(LIGHT_BANDS.length + 1);
    for (const mode of ALL_SHADING_MODES) {
      expect(unitShade(mode, 0)).toBeGreaterThan(0);
    }
    // `'flat'` NIE zależy od światła wcale — to jest wariant wysyłany na ekran.
    expect(unitShade('flat', 0)).toBe(1);
    expect(unitShade('flat', 1)).toBe(1);

    // PROGOWY: dokładnie tyle różnych wartości, ile pasm, i skok DOKŁADNIE na progu —
    // ta sama własność, którą `shading.test.ts` sprawdza dla terenu.
    const thresholdValues = new Set<number>();
    for (let i = 0; i <= 1000; i++) thresholdValues.add(unitShade('threshold', i / 1000));
    expect(thresholdValues.size).toBe(LIGHT_BANDS.length + 1);
    for (const t of LIGHT_BANDS) {
      expect(unitShade('threshold', t)).toBe(UNIT_BAND_SHADE[lightBand(t)]);
      expect(unitShade('threshold', t + 1e-9)).not.toBe(unitShade('threshold', t));
    }

    // GŁADKI: ściśle rosnący i CIĄGŁY — żadnych skoków na progach pasm.
    let previous = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      const v = unitShade('smooth', i / 1000);
      expect(v).toBeGreaterThan(previous);
      previous = v;
    }
    for (const t of LIGHT_BANDS) {
      expect(unitShade('smooth', t + 1e-6) - unitShade('smooth', t)).toBeLessThan(1e-3);
    }

    // --- STERNIK WERDYKTU: ile cieniowania w ogóle mieści się w budżecie kontrastu -------
    // Dwutonowość zjada CAŁY zapas tej palety, więc każde przemnożenie barw jednostki przez
    // czynnik < 1 zbliża ją do tła. Granica liczona TUTAJ (nie przepisana): najmniejszy
    // czynnik, przy którym oba tony nadal pokrywają każde tło progiem 3:1.
    const buffer = new Float32Array(3);
    const passesAt = (shade: number, backgrounds: readonly (readonly [string, Rgb])[]): boolean =>
      backgrounds.every(([, background]) => {
        let worst = Infinity;
        for (let i = 0; i <= 20; i++) {
          writeUnitRimColor(shade, buffer, 0);
          const rim: Rgb = [buffer[0], buffer[1], buffer[2]];
          writeUnitCoreColor(i / 20, shade, buffer, 0);
          const core: Rgb = [buffer[0], buffer[1], buffer[2]];
          worst = Math.min(worst, Math.max(contrast(rim, background), contrast(core, background)));
        }
        return worst >= WCAG_MIN;
      });
    /**
     * BISEKCJA, nie skan po siatce 10⁻⁴ (runda naprawcza 1). Siatka zwracała pierwszy punkt
     * PRZECHODZĄCY, czyli 0,8464, a prawdziwa granica to 0,846334 — i z tej różnicy wzięły się
     * dwie pisownie jednej stałej, jedna w module i jedna w raporcie. Dwie pisownie w
     * dokumencie decyzyjnym są zaproszeniem do „ujednolicenia" w złą stronę, więc przyrząd
     * podaje teraz sześć cyfr, a nie cztery.
     *
     * Bisekcja jest poprawna, bo `passesAt` jest na tym zakresie monotoniczne: wiążącym tłem
     * jest zawsze ciemne (obrys nocy albo wypełnienie nocy), a wobec ciemnego tła kontrast
     * jaśniejszego tonu rośnie z czynnikiem. Poprawność założenia trzymają dwie kontrole
     * niżej: `passesAt(1)` musi być prawdą, `passesAt(0)` fałszem.
     */
    const floorFor = (backgrounds: readonly (readonly [string, Rgb])[]): number => {
      let below = 0;
      let above = 1;
      for (let i = 0; i < 60; i++) {
        const middle = (below + above) / 2;
        if (passesAt(middle, backgrounds)) above = middle;
        else below = middle;
      }
      return above;
    };

    const floor = floorFor(BACKGROUNDS);
    const fillsOnly = BACKGROUNDS.filter(([name]) => !name.startsWith('obrys'));
    const floorWithoutGrid = floorFor(fillsOnly);
    console.log(
      `[KROK 3] najmniejszy czynnik cieniowania, przy którym jednostka nadal czyta się na każdym tle: ${floor.toFixed(6)} (bez kraty: ${floorWithoutGrid.toFixed(6)})`,
    );

    // KONTROLE POZYTYWNE NA SAM PRZYRZĄD: tryb wysyłany na ekran przechodzi, a czynnik
    // zerowy (jednostka zgaszona do czerni) OBLEWA — inaczej „granica" mogłaby wyjść z
    // przyrządu, który zawsze mówi „tak".
    expect(passesAt(1, BACKGROUNDS)).toBe(true);
    expect(passesAt(0, BACKGROUNDS)).toBe(false);

    // WŁASNOŚĆ, nie kotwica: granicę wyznacza OBRYS nocy, nie jej wypełnienie. Kotwicy na
    // dzisiejsze 0,846334 tu NIE MA i to jest poprawka z pary mutacji — okno „0,8 < x < 0,9"
    // stało tu wcześniej i oblewało przy DOWOLNEJ zmianie barwy rdzenia, także takiej, która
    // wszystkie progi czytelności spełnia. To była kotwica na dzisiejszą paletę przebrana za
    // próg (wzorzec z katalogu wad tej fazy), a nie strażnik czegokolwiek.
    //
    // Słabość tej asercji, wskazana przez przegląd i zapisana, a nie zakryta: jest ona
    // prawdziwa Z KONSTRUKCJI dla każdej palety kraty poza jednym przypadkiem (krata
    // ciemniejsza od wypełnienia nocy). Nie jest więc strażnikiem — jest zapisem tego, GDZIE
    // wypada granica, po to, żeby zmiana palety kraty w Fazie 4 pokazała nową liczbę w logu.
    expect(floor).toBeGreaterThan(floorWithoutGrid);

    // PRZESŁANKA WERDYKTU KROKU 3, jako asercja: czynniki `UNIT_BAND_SHADE` — najmniejsze,
    // przy których różnicę w ogóle WIDAĆ — leżą PONIŻEJ tej granicy. Czyli oba warianty
    // cieniowania kupują spójność za czytelność, i dlatego na ekran idzie `'flat'`.
    //
    // **To jest JEDYNA asercja w całym pakiecie, która broni werdyktu Kroku 3.** Reszta tego
    // testu opisuje przyrząd; ta jedna linia mówi, że dobrane czynniki cieniowania leżą poza
    // budżetem czytelności. Gdyby Faza 4 zmieniła paletę tak, że cieniowanie zaczyna się
    // mieścić, ta linia oblei i zmusi do ponownego rozstrzygnięcia — zamiast po cichu
    // przepuścić decyzję podjętą na innych liczbach.
    expect(Math.min(...UNIT_BAND_SHADE)).toBeLessThan(floor);

    // Warstwa startuje w trybie domyślnym i daje się przełączyć (bramka Zadania 5).
    const layer = createUnitLayer(planet);
    expect(layer.shadingMode()).toBe('flat');
    const light = new Float32Array(CELL_COUNT);
    light[0] = 1;
    layer.update([unit('SWARM', 0)], light);
    const flatColor = instanceColorAt(layer.core, 0);
    layer.setShadingMode('threshold');
    expect(layer.shadingMode()).toBe('threshold');
    layer.update([unit('SWARM', 0)], light);
    // Pasmo DNIA ma czynnik 1, więc barwa się nie zmienia — kontrola, że test mierzy
    // cieniowanie, a nie samo przełączenie trybu.
    expect(instanceColorAt(layer.core, 0)).toEqual(flatColor);
    layer.update([unit('SWARM', 1)], light); // komórka 1 jest ciemna
    expect(instanceColorAt(layer.core, 0)[0]).toBeLessThan(flatColor[0]);
    layer.dispose();
  });

  it('22. [PARA MUTACJI] wariant LEGALNY (0,8464) mieści się w budżecie kontrastu, a 0,8463 już NIE — i warstwa go faktycznie stosuje', () => {
    // Pytanie 4 bramki Zadania 5 pokazuje człowiekowi jednostkę przyciemnioną czynnikiem
    // **0,8464**, bo drugie ogniwo argumentu Zadania 4 („łagodnego cieniowania gładkiego i
    // tak nie widać") zostało oparte na obserwacji przy 0,55, czyli przy zmianie rdzenia o
    // 59/255 — a legalne maksimum zmienia go o 18/255 i tego nikt nie obejrzał.
    //
    // Ten test pilnuje JEDNEJ rzeczy: że liczba pokazywana człowiekowi naprawdę leży w
    // budżecie 3:1, a nie o włos poniżej. Granica jest KRESEM DOLNYM, nie osiągalnym
    // minimum — `passesAt(0,846334)` jest fałszem — więc pokazanie 0,8463 pokazywałoby
    // wariant POZA budżetem, którego ma dowodzić.
    const buffer = new Float32Array(3);
    const passesAt = (shade: number): boolean =>
      BACKGROUNDS.every(([, background]) => {
        let worst = Infinity;
        for (let i = 0; i <= 20; i++) {
          writeUnitRimColor(shade, buffer, 0);
          const rim: Rgb = [buffer[0], buffer[1], buffer[2]];
          writeUnitCoreColor(i / 20, shade, buffer, 0);
          const core: Rgb = [buffer[0], buffer[1], buffer[2]];
          worst = Math.min(worst, Math.max(contrast(rim, background), contrast(core, background)));
        }
        return worst >= WCAG_MIN;
      });

    // PARA TUŻ PRZY GRANICY, obie połówki. „Ma przejść" jest tu ważniejsza: to ona łapie
    // pomyłkę o jedną cyfrę w drugą stronę (przepisanie granicy 0,846334 jako wartości).
    expect(passesAt(0.8464), '0,8464 musi MIEŚCIĆ SIĘ w budżecie 3:1').toBe(true);
    expect(passesAt(0.8463), '0,8463 musi WYPAŚĆ poza budżet 3:1').toBe(false);
    expect(passesAt(0.846334), 'sama wypisana granica leży PONIŻEJ progu').toBe(false);

    // WŁASNOŚĆ, nie kotwica na dzisiejszą liczbę: czynnik wariantu legalnego ma być
    // NAJMNIEJSZYM, który jeszcze przechodzi — bo pytanie 4 bramki ma pokazać człowiekowi
    // MAKSYMALNE legalne przyciemnienie, a nie dowolne legalne. Sprawdzane minimalnością przy
    // rozdzielczości czterech cyfr, więc przechodzi dla każdej poprawnie dobranej stałej i
    // oblewa zarówno dla 0,8463 (poza budżetem), jak i dla 0,8465 (legalne, ale nie maksymalne).
    const legal = Math.min(...UNIT_BAND_SHADE_LEGAL);
    expect(passesAt(legal), 'wariant legalny NIE mieści się w budżecie').toBe(true);
    expect(passesAt(legal - 0.0001), 'istnieje MNIEJSZY czynnik, który też przechodzi').toBe(false);
    // Kontrola pozytywna na sam przyrząd: wariant Zadania 4 budżetu NIE spełnia — czyli
    // `passesAt` nie jest funkcją, która zawsze mówi „tak".
    expect(passesAt(Math.min(...UNIT_BAND_SHADE))).toBe(false);

    // ...i warstwa faktycznie liczy barwy TYMI czynnikami, a nie stałą modułu: barwa rdzenia
    // na paśmie NOCY (czynnik `bands[0]`) musi wyjść dokładnie `flat × 0,8464`.
    const layer = createUnitLayer(planet);
    const light = darkField(); // komórka 0 ciemna ⇒ pasmo 0
    layer.update([unit('SWARM', 0)], light);
    const flatColor = instanceColorAt(layer.core, 0);
    expect(layer.shadingBands()).toEqual([...UNIT_BAND_SHADE]);

    layer.setShadingBands(UNIT_BAND_SHADE_LEGAL);
    layer.setShadingMode('threshold');
    layer.update([unit('SWARM', 0)], light);
    const legalColor = instanceColorAt(layer.core, 0);
    for (let k = 0; k < 3; k++) {
      expect(legalColor[k]).toBeCloseTo(flatColor[k] * 0.8464, 5);
    }
    // Kontrola pozytywna: podmiana czynników NAPRAWDĘ coś zmienia (inaczej równość wyżej
    // byłaby prawdziwa dla czynnika 1,0 i test nie mierzyłby niczego).
    expect(legalColor[0]).toBeLessThan(flatColor[0]);

    // Strażnik kształtu tablicy: zła długość dałaby po cichu `undefined`, czyli barwę `NaN`
    // na najwyższym paśmie; czynnik 0 — jednostkę zgaszoną do czerni.
    expect(() => layer.setShadingBands([0.9, 1.0])).toThrow(RangeError);
    expect(() => layer.setShadingBands([0, 0.9, 1.0])).toThrow(RangeError);
    expect(() => layer.setShadingBands([0.9, 1.0, 1.2])).toThrow(RangeError);
    layer.dispose();
  });
});

describe('konwencja [WYGLĄD]', () => {
  it('18. KAŻDA wizualna stała modułu — także tablicowa i obiektowa — jest oznaczona `// [WYGLĄD]`', () => {
    // `global-constraints.md`: „Każda liczba czysto wizualna oznaczona `// [WYGLĄD]`".
    // Strażnik bierze każdą deklarację `const` na poziomie modułu i szuka markera gdziekolwiek
    // między jej początkiem a średnikiem kończącym, więc obejmuje literały wielolinijkowe.
    const source = readFileSync(new URL('../src/unitMesh.ts', import.meta.url), 'utf8');
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
    // Kontrola na sam przyrząd: musi znaleźć także stałe wielolinijkowe.
    expect(declarations.map((d) => d.name)).toContain('UNIT_SHAPES');
    expect(declarations.map((d) => d.name)).toContain('UNIT_CORE_COLOR_HOT');
    expect(declarations.length, 'regex przestał widzieć deklaracje').toBeGreaterThanOrEqual(10);

    // Asercja na ZBIORZE, nie „zawiera": jedyną nieoznaczoną stałą modułu jest pojemność
    // buforów, która nie jest liczbą wizualną — nic w niej nie widać, bo warstwa i tak
    // rośnie po przekroczeniu. Dołożenie JAKIEJKOLWIEK innej nieoznaczonej stałej ma ten
    // test oblać, a nie przesunąć wraz z nim.
    const unmarked = declarations.filter((d) => !d.marked).map((d) => d.name);
    expect(unmarked, `stałe bez markera: ${unmarked.join(', ')}`).toEqual(['INITIAL_UNIT_CAPACITY']);
  });
});

describe('funkcje czyste — kodowanie', () => {
  it('19. burnCoreScale idzie od 1 do UNIT_CORE_SCALE_MIN i jest ŚCIŚLE malejąca', () => {
    expect(burnCoreScale(0)).toBe(1);
    expect(burnCoreScale(1)).toBeCloseTo(UNIT_CORE_SCALE_MIN, 12);
    let previous = Infinity;
    for (let i = 0; i <= 1000; i++) {
      const v = burnCoreScale(i / 1000);
      expect(v).toBeLessThan(previous);
      previous = v;
    }
  });

  it('20. writeUnitCoreColor pisze DOKŁADNIE trzy składowe od offsetu i nie rusza sąsiadów', () => {
    // Ta funkcja pisze do wspólnego bufora barw instancji po `slot * 3` — pomyłka o jeden
    // przemalowałaby cudzą jednostkę, co na ekranie wygląda jak losowy szum, nie jak błąd.
    // Porównania `toBeCloseTo`, nie `toEqual`: bufor jest `Float32Array`, więc 0,98 wraca
    // jako 0,9800000190734863 — dokładnie tak, jak trafi do GPU.
    const out = new Float32Array(9).fill(-1);
    writeUnitCoreColor(0, 1, out, 3);
    expect(out[0]).toBe(-1);
    expect(out[1]).toBe(-1);
    expect(out[2]).toBe(-1);
    for (let k = 0; k < 3; k++) expect(out[3 + k]).toBeCloseTo(UNIT_CORE_COLOR_COOL[k], 6);
    expect(out[6]).toBe(-1);
    writeUnitCoreColor(1, 1, out, 3);
    for (let k = 0; k < 3; k++) expect(out[3 + k]).toBeCloseTo(UNIT_CORE_COLOR_HOT[k], 6);
    // Czynnik cieniowania mnoży, a nie zastępuje.
    writeUnitCoreColor(0, 0.5, out, 3);
    expect(out[3]).toBeCloseTo(UNIT_CORE_COLOR_COOL[0] * 0.5, 6);
    const rim = new Float32Array(3);
    writeUnitRimColor(1, rim, 0);
    for (let k = 0; k < 3; k++) expect(rim[k]).toBeCloseTo(UNIT_RIM_COLOR[k], 6);
  });

  it('21. promień rdzenia liczy się przez ODJĘCIE obwódki, nie przez ułamek promienia tarczy', () => {
    // To rozróżnienie jest cały mechanizm testu 3, sprawdzony tu na trzech typach naraz:
    // przy ułamku iloraz `rdzeń/tarcza` byłby dla wszystkich trzech IDENTYCZNY, a przy
    // odjęciu jest tym mniejszy, im mniejsza tarcza.
    const layer = createUnitLayer(planet);
    layer.update(ALL_TYPES.map((type, k) => unit(type, 200 + k * 53)), darkField());
    const ratios = ALL_TYPES.map((_, slot) => {
      const body = basisColumn(matrixAt(layer.body, slot), 0).length();
      const core = basisColumn(matrixAt(layer.core, slot), 0).length();
      return core / body;
    });
    expect(Math.max(...ratios) - Math.min(...ratios), 'iloraz jest stały — obwódka jest proporcjonalna').toBeGreaterThan(
      0.05,
    );
    // ...i zgadza się z konstrukcją: promień tarczy minus STAŁA szerokość obwódki.
    ALL_TYPES.forEach((type, slot) => {
      const body = basisColumn(matrixAt(layer.body, slot), 0).length();
      const core = basisColumn(matrixAt(layer.core, slot), 0).length();
      expect(core, type).toBeCloseTo(body - planet.radius * UNIT_RIM_FACTOR, 4);
    });
    layer.dispose();
  });
});
