import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/math/vec3.js';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { stateHash } from '../src/sim/hash.js';

const planet = createPlanet({ seed: 1 });

/**
 * Stan z jednym budynkiem (domyślnie na indeksie 0) i jedną jednostką — wspólny
 * punkt odniesienia dla testów wrażliwości hasha na pola budynków/jednostek,
 * których `createState` sam z siebie nigdy nie populuje. `buildingIndex`
 * parametryzowany, żeby test pozycyjności (§cellId) mógł postawić IDENTYCZNY
 * budynek pod innym indeksem bez ręcznego powielania jego pól.
 */
function withBuildingAndUnit(buildingIndex = 0) {
  const s = createState(planet, 150);
  s.buildings[buildingIndex] = { cellId: 0, type: 'PYLON', hp: 80, powered: false };
  s.units.push({ id: 1, type: 'SWARM', cellId: 0, pos: vec3(1, 2, 3), hp: 30, exposure: 0.25 });
  return s;
}

describe('createState', () => {
  it('startuje z zadaną rudą i pustą planszą', () => {
    const s = createState(planet, 150);
    expect(s.tick).toBe(0);
    expect(s.ore).toBe(150);
    expect(s.phase).toBe('RUNNING');
    expect(s.units).toEqual([]);
    expect(s.buildings.filter((b) => b !== null)).toEqual([]);
  });

  it('kopiuje pojemność złóż do mutowalnego stanu, nie dzieli referencji z planetą', () => {
    const s = createState(planet, 150);
    expect(s.oreRemaining.length).toBe(planet.cells.length);
    s.oreRemaining[planet.startCell] = 999;
    expect(planet.cells[planet.startCell].oreCapacity).not.toBe(999);
  });

  it('krok symulacji to dokładnie 20 Hz', () => {
    expect(TICK_SECONDS).toBe(0.05);
    expect(1 / TICK_SECONDS).toBe(20);
  });
});

describe('stateHash', () => {
  it('identyczne stany dają identyczny hash', () => {
    expect(stateHash(createState(planet, 150))).toBe(stateHash(createState(planet, 150)));
  });

  it('zmiana JAKIEJKOLWIEK wartości zmienia hash', () => {
    const base = createState(planet, 150);
    const h = stateHash(base);

    const a = createState(planet, 150); a.ore = 151;
    const b = createState(planet, 150); b.tick = 1;
    const c = createState(planet, 150); c.storedEnergy = 0.0001;
    const d = createState(planet, 150); d.oreRemaining[0] += 1;

    for (const variant of [a, b, c, d]) {
      expect(stateHash(variant)).not.toBe(h);
    }
  });

  it('wykrywa różnicę zmiennoprzecinkową poniżej progu widoczności', () => {
    const a = createState(planet, 150); a.storedEnergy = 1;
    const b = createState(planet, 150); b.storedEnergy = 1 + Number.EPSILON;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  // `createState` zawsze zwraca puste `buildings`/`units`, więc bez poniższych
  // pętle po budynkach i jednostkach w hash.ts nigdy by się nie wykonały w całym
  // pakiecie testów — regresja w którejkolwiek z nich przeszłaby niezauważona.

  it('budynek: zmiana `type` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.buildings[0]!.type = 'BARRICADE';
    expect(stateHash(variant)).not.toBe(h);
  });

  it('budynek: zmiana `hp` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.buildings[0]!.hp += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('budynek: zmiana `powered` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.buildings[0]!.powered = true;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('budynek: `cellId` jest niesiony POZYCYJNIE przez indeks tablicy, nie przez pole — ten sam budynek pod innym indeksem zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit(0));
    const moved = withBuildingAndUnit(1);
    expect(stateHash(moved)).not.toBe(h);
  });

  it('jednostka: zmiana `id` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].id += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `type` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].type = 'ARMOR';
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `cellId` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].cellId += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `pos.x` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    const p = variant.units[0].pos;
    variant.units[0].pos = vec3(p.x + 1, p.y, p.z);
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `pos.y` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    const p = variant.units[0].pos;
    variant.units[0].pos = vec3(p.x, p.y + 1, p.z);
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `pos.z` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    const p = variant.units[0].pos;
    variant.units[0].pos = vec3(p.x, p.y, p.z + 1);
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `hp` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].hp += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `exposure` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].exposure += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('zmiana `nextUnitId` zmienia hash', () => {
    const h = stateHash(createState(planet, 150));
    const variant = createState(planet, 150);
    variant.nextUnitId += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('zmiana `phase` zmienia hash', () => {
    const h = stateHash(createState(planet, 150));
    const variant = createState(planet, 150);
    variant.phase = 'VICTORY';
    expect(stateHash(variant)).not.toBe(h);
  });
});
