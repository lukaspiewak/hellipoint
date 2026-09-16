import { describe, expect, it } from 'vitest';
import { GCProfiler } from 'node:v8';
import { Matrix4, Vector3, type Object3D, type Scene } from 'three';
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
} from '../src/buildingMesh.js';
import { DEFAULT_OUTLINE_PALETTE, DEFAULT_PALETTE, type Rgb } from '../src/shading.js';
import { OUTLINE_INSET } from '../src/planetMesh.js';
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
    expect(worst).toBeCloseTo(4.25, 2); // minimum wypada na końcu krytycznym rampy
  });

  it('3. jasny rdzeń zawsze mieści się w ciemnym szczycie skorupy — inaczej traci obwódkę, na której stoi dzień', () => {
    expect(CORE_RADIUS_FACTOR).toBeLessThan(SHELL_TAPER);
    // I to samo na LICZBACH, które faktycznie trafiają do macierzy: promień rdzenia przy
    // pełnym `hp` kontra promień szczytu skorupy, dla każdego typu.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 100 + k * 7, type));
    layer.update(list);
    for (let slot = 0; slot < ALL_TYPES.length; slot++) {
      const shellRadius = basisColumn(matrixAt(layer.shell, slot), 0).length();
      const shellTopRadius = shellRadius * SHELL_TAPER;
      const coreRadius = basisColumn(matrixAt(layer.core, slot), 0).length();
      expect(coreRadius, ALL_TYPES[slot]).toBeLessThan(shellTopRadius);
    }
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
      // Pozycja porównana z `planet.cells[id].center` — źródłem NIEZALEŻNYM od bufora,
      // z którego warstwa czyta (`PlanetGeometry`).
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

  it('5. dziesięć typów daje DZIESIĘĆ różnych brył — typ czyta się z sylwetki, nie z barwy', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 20 + k * 13, type));
    layer.update(list);
    expect(layer.shell.count).toBe(10);

    const seen = new Map<string, BuildingType>();
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
    });
    expect(seen.size).toBe(10);
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

  it('7. pierścień alarmu PULSUJE — ten sam stan w dwóch chwilach daje różne macierze', () => {
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
    expect(peak / trough).toBeCloseTo(1 + ALERT_PULSE_AMPLITUDE, 6);
    // Kotwica bezwzględna: minimum pulsu to promień spoczynkowy, nie przypadkowa liczba.
    expect(trough).toBeCloseTo(planet.radius * ALERT_RADIUS_FACTOR, 6);
    // Pełny okres wraca do minimum — puls jest okresowy, a nie rosnący w nieskończoność.
    layer.update(list, ALERT_PULSE_PERIOD_SECONDS);
    expect(basisColumn(matrixAt(layer.alert, 0), 0).length()).toBeCloseTo(trough, 4);
    // Ten sam czas daje ten sam obraz — puls nie jest szumem.
    layer.update(list, ALERT_PULSE_PERIOD_SECONDS / 2);
    expect(basisColumn(matrixAt(layer.alert, 0), 0).length()).toBeCloseTo(peak, 6);
    layer.dispose();
  });

  it('8. pierścień alarmu ZOSTAJE w swojej komórce przez cały cykl pulsu — i mimo to wystaje poza najgrubszą bryłę', () => {
    // DWIE granice naraz, bo obie da się złamać w przeciwne strony:
    //  • za duży — wchodzi na kratę i na sąsiada, a przy terminatorze rysuje po samej
    //    granicy dnia i nocy, która jest nadrzędna wobec wszystkiego, co ta faza dodaje;
    //  • za mały — chowa się pod bryłą i alarmu nie widać wcale.
    // Obie liczone z RZECZYWISTYCH macierzy, a górna granica dodatkowo z NIEZALEŻNEGO
    // źródła: najmniejszego promienia komórki w `planet` i wciągnięcia obrysu z Zadania 2.
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    place(list, 300, 'CORE', { powered: false });

    let widest = 0;
    let narrowest = Infinity;
    for (let i = 0; i <= 24; i++) {
      layer.update(list, (i / 24) * ALERT_PULSE_PERIOD_SECONDS);
      const outer = basisColumn(matrixAt(layer.alert, 0), 0).length();
      widest = Math.max(widest, outer);
      narrowest = Math.min(narrowest, outer);
    }

    let smallestCellRadius = Infinity;
    for (const cell of planet.cells) {
      for (const corner of cell.corners) {
        smallestCellRadius = Math.min(
          smallestCellRadius,
          Math.hypot(corner.x - cell.center.x, corner.y - cell.center.y, corner.z - cell.center.z),
        );
      }
    }
    const smallestOutline = smallestCellRadius * (1 - OUTLINE_INSET);
    expect(widest, 'szczyt pulsu wychodzi poza obrys najmniejszej komórki').toBeLessThan(smallestOutline);

    const biggestShell =
      planet.radius * BUILDING_RADIUS_FACTOR * Math.max(...ALL_TYPES.map((t) => BUILDING_SHAPES[t].radius));
    // Widoczna obręcz na zewnątrz najgrubszej bryły — ZE ZNAKIEM, nie co do wielkości.
    expect(narrowest - biggestShell).toBeGreaterThan(0.5);
    // Wewnętrzna krawędź WOLNO chować się pod bryłą — to jest świadoma decyzja (komórka
    // jest za mała na obręcz, która i wystaje, i nie wchodzi pod budynek), więc pinujemy
    // ją, zamiast udawać, że jej nie ma.
    expect(narrowest * ALERT_INNER_FACTOR).toBeLessThan(biggestShell);
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
    // Kotwice bezwzględne obu końców — test kierunkowy sam nie wykluczyłby rampy o
    // mikroskopijnym zakresie, której człowiek by nie zobaczył.
    const fullRadius = planet.radius * BUILDING_RADIUS_FACTOR * BUILDING_SHAPES.CORE.radius * CORE_RADIUS_FACTOR;
    expect(radii[0]).toBeCloseTo(fullRadius, 4);
    expect(radii[radii.length - 1]).toBeCloseTo(fullRadius * CORE_SCALE_MIN, 4);
    expect(redness[0]).toBeCloseTo(CORE_COLOR_HEALTHY[0] - CORE_COLOR_HEALTHY[1], 5);
    expect(redness[redness.length - 1]).toBeCloseTo(CORE_COLOR_CRITICAL[0] - CORE_COLOR_CRITICAL[1], 5);
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

  it('14. update() NICZEGO nie mutuje — ani listy budynków, ani planety', () => {
    const layer = createBuildingLayer(planet, geo);
    const list = emptyBuildings();
    ALL_TYPES.forEach((type, k) => place(list, 30 + k * 11, type, { hp: BUILDINGS[type].hp * 0.4, powered: k % 2 === 0 }));
    const buildingsBefore = JSON.stringify(list);
    const planetBefore = JSON.stringify(planet);
    layer.update(list, 0.37);
    layer.update(list, 0.74);
    expect(JSON.stringify(list)).toBe(buildingsBefore);
    expect(JSON.stringify(planet)).toBe(planetBefore);
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
    expect(alertPulseScale(ALERT_PULSE_PERIOD_SECONDS / 2)).toBeCloseTo(1 + ALERT_PULSE_AMPLITUDE, 12);
    expect(alertPulseScale(ALERT_PULSE_PERIOD_SECONDS)).toBeCloseTo(1, 12);
    // Nigdy poniżej minimum — pierścień nie wjeżdża pod skorupę w żadnej fazie.
    for (let i = 0; i <= 200; i++) {
      const s = alertPulseScale((i / 200) * ALERT_PULSE_PERIOD_SECONDS * 3);
      expect(s).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(s).toBeLessThanOrEqual(1 + ALERT_PULSE_AMPLITUDE + 1e-12);
    }
  });
});
