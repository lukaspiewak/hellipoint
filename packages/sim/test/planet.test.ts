import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { multiSourceDistances } from '../src/world/graph.js';
import { length, scale, sub } from '../src/math/vec3.js';

const planet = createPlanet({ seed: 20260914 });

describe('multiSourceDistances', () => {
  it('liczy odległość grafową od najbliższego źródła', () => {
    //  0 -- 1 -- 2 -- 3
    const neighbors = [[1], [0, 2], [1, 3], [2]];
    expect(multiSourceDistances(neighbors, [0])).toEqual([0, 1, 2, 3]);
    expect(multiSourceDistances(neighbors, [0, 3])).toEqual([0, 1, 1, 0]);
  });

  it('oznacza nieosiągalne jako Infinity', () => {
    expect(multiSourceDistances([[], []], [0])).toEqual([0, Infinity]);
  });
});

describe('createPlanet', () => {
  it('daje 1442 komórki z 12 pentagonami', () => {
    expect(planet.cells.length).toBe(1442);
    expect(planet.pentagons.length).toBe(12);
    for (const p of planet.pentagons) expect(planet.cells[p].cellType).toBe('PENTAGON');
  });

  it('skaluje komórki do promienia planety', () => {
    for (const c of planet.cells) {
      expect(length(c.center)).toBeCloseTo(planet.radius, 9);
      for (const corner of c.corners) expect(length(corner)).toBeCloseTo(planet.radius, 9);
    }
  });

  it('normal jest jednostkowa i równa center/radius (tak jak deklaruje komentarz pola)', () => {
    for (const c of planet.cells) {
      expect(length(c.normal)).toBeCloseTo(1, 9);
      expect(length(sub(c.normal, scale(c.center, 1 / planet.radius)))).toBeCloseTo(0, 9);
    }
  });

  it('jest w pełni deterministyczna względem seeda', () => {
    expect(createPlanet({ seed: 20260914 })).toEqual(planet);
  });

  it('jawnie podane `undefined` dla opcjonalnego pola zachowuje się jak jego brak', () => {
    // `PlanetOptions` nie ma `exactOptionalPropertyTypes`, więc `{ radius: undefined }`
    // typuje się identycznie jak brak pola w ogóle — ale `{ ...DEFAULTS, ...opts }`
    // rozróżniałoby te dwa przypadki w runtime (nadpisując domyślną wartość
    // jawnym `undefined`). Dokładnie tak wygląda przekazanie dalej częściowo
    // wypełnionej, opcjonalnej konfiguracji (np. przez Fazę 2 albo headless
    // runner Fazy 1C) — musi dać ten sam wynik co pominięcie pola.
    const baseline = createPlanet({ seed: 1 });
    expect(createPlanet({ seed: 1, radius: undefined })).toEqual(baseline);
    expect(createPlanet({ seed: 1, frequency: undefined })).toEqual(baseline);
  });

  it('inny seed daje inny rozkład rudy', () => {
    const other = createPlanet({ seed: 777 });
    const oreA = planet.cells.filter((c) => c.oreCapacity > 0).map((c) => c.id);
    const oreB = other.cells.filter((c) => c.oreCapacity > 0).map((c) => c.id);
    expect(oreA).not.toEqual(oreB);
  });

  it('ruda leży wyłącznie na heksagonach', () => {
    for (const c of planet.cells) {
      if (c.oreCapacity > 0) expect(c.cellType).toBe('HEXAGON');
    }
  });

  it('ruda tworzy klastry, a nie pojedyncze rozsypane komórki', () => {
    const ore = planet.cells.filter((c) => c.oreCapacity > 0);
    expect(ore.length).toBeGreaterThan(30);
    // Pojedyncza izolowana komórka jest teoretycznie możliwa, gdy sąsiedzi przy pentagonie
    // zostaną pominięte — ale ruda ma być zasadniczo klastrowa, nie rozsypana.
    const isolated = ore.filter(
      (c) => !c.neighbors.some((n) => planet.cells[n].oreCapacity > 0),
    );
    expect(isolated.length / ore.length).toBeLessThan(0.02);
  });

  it('komórka startowa to heksagon bez rudy, odsunięty od pentagonów', () => {
    const start = planet.cells[planet.startCell];
    expect(start.cellType).toBe('HEXAGON');
    expect(start.oreCapacity).toBe(0);

    const distances = multiSourceDistances(
      planet.cells.map((c) => c.neighbors),
      planet.pentagons,
    );
    expect(distances[planet.startCell]).toBeGreaterThanOrEqual(4);
  });

  it('odrzuca wymagania niemożliwe do spełnienia zamiast po cichu je obniżać', () => {
    expect(() => createPlanet({ seed: 1, minStartDistanceFromPentagon: 99 })).toThrow(
      /komórkę startową/,
    );
  });

  it('odrzuca frequency, przy której nie ma heksagonów na rudę, zamiast rzucić niejasny błąd z BFS', () => {
    // frequency 1 to sam bazowy dwudziestościan: 12 wierzchołków, wszystkie stopnia 5 ⇒
    // wszystkie PENTAGON, zero HEXAGON. buildGeodesic akceptuje frequency=1 jako poprawne
    // (por. uniformity.test.ts), więc to osiągalne wejście, nie tylko teoretyczny przypadek.
    expect(() => createPlanet({ seed: 1, frequency: 1 })).toThrow(/heksagonów/);
  });
});
