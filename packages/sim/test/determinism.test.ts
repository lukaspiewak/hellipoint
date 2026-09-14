import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { Sim } from '../src/sim/loop.js';
import { stateHash } from '../src/sim/hash.js';
import type { Command } from '../src/sim/commands.js';

const CONFIG = { rotationPeriod: 180, startingOre: 150 };

function runScripted(seed: number, ticks: number): string {
  const planet = createPlanet({ seed });
  const sim = new Sim(planet, CONFIG);

  // Komórki wybierane z planety, NIE zaszyte na sztywno: stały indeks mógłby trafić
  // na pentagon albo złoże, przez co komenda byłaby po cichu ignorowana
  // i test determinizmu przechodziłby, nie sprawdzając niczego.
  const buildable = planet.cells
    .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell)
    .map((c) => c.id);
  const [c1, c2] = [buildable[0], buildable[1]];

  const script: Array<[number, Command]> = [
    [10, { kind: 'BUILD', cellId: c1, type: 'PYLON' }],
    [25, { kind: 'BUILD', cellId: c2, type: 'BARRICADE' }],
    [40, { kind: 'DEMOLISH', cellId: c1 }],
  ];
  for (let t = 0; t < ticks; t++) {
    for (const [at, cmd] of script) if (at === t) sim.enqueue(cmd);
    sim.step();
  }
  return stateHash(sim.state);
}

describe('determinizm (§7.2)', () => {
  it('ten sam seed + ta sama kolejka komend ⇒ ten sam hash po 1200 tickach', () => {
    expect(runScripted(2026, 1200)).toBe(runScripted(2026, 1200));
  });

  it('inny seed ⇒ inny hash', () => {
    expect(runScripted(2026, 600)).not.toBe(runScripted(2027, 600));
  });

  it('czas symulacji wynika wyłącznie z liczby ticków, nie z zegara', () => {
    const sim = new Sim(createPlanet({ seed: 1 }), CONFIG);
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.elapsedSeconds).toBeCloseTo(1, 12);
    expect(sim.state.tick).toBe(20);
  });
});

/**
 * `rotationPeriod` zły przepływa do `terminatorSpeedWorld`/`terminatorSpeedCells`/
 * `terminatorCrossingTime` w scale.ts, które dzielą przez nie bez żadnej straży —
 * zdegenerowana wartość dałaby ciche Infinity/0 dopiero w Fazie 1C, bez błędu
 * w tym miejscu. Walidacja w konstruktorze chroni WSZYSTKICH konsumentów naraz.
 * `!(x > 0)` NIE łapie Infinity (Infinity > 0 jest prawdziwe) — stąd Number.isFinite.
 */
describe('SimConfig — walidacja w konstruktorze Sim', () => {
  const planet = createPlanet({ seed: 1 });

  it('odrzuca rotationPeriod <= 0 lub nieskończony', () => {
    expect(() => new Sim(planet, { rotationPeriod: 0, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { rotationPeriod: -180, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { rotationPeriod: NaN, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { rotationPeriod: Infinity, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { rotationPeriod: -Infinity, startingOre: 100 })).toThrow(RangeError);
  });

  it('odrzuca startingOre ujemny lub nieskończony', () => {
    expect(() => new Sim(planet, { rotationPeriod: 180, startingOre: -1 })).toThrow(RangeError);
    expect(() => new Sim(planet, { rotationPeriod: 180, startingOre: NaN })).toThrow(RangeError);
    expect(() => new Sim(planet, { rotationPeriod: 180, startingOre: Infinity })).toThrow(RangeError);
    expect(() => new Sim(planet, { rotationPeriod: 180, startingOre: -Infinity })).toThrow(RangeError);
  });

  it('akceptuje startingOre = 0 — niezerowa dolna granica byłaby błędem (pole jest NIEUJEMNE, nie dodatnie)', () => {
    expect(() => new Sim(planet, { rotationPeriod: 180, startingOre: 0 })).not.toThrow();
  });

  it('komunikat błędu nazywa pole i wartość, a nie tylko ogólnikowo "invalid config"', () => {
    expect(() => new Sim(planet, { rotationPeriod: -5, startingOre: 100 })).toThrow(/rotationPeriod.*-5/);
    expect(() => new Sim(planet, { rotationPeriod: 180, startingOre: -5 })).toThrow(/startingOre.*-5/);
  });
});
