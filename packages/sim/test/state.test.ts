import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { stateHash } from '../src/sim/hash.js';

const planet = createPlanet({ seed: 1 });

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
});
