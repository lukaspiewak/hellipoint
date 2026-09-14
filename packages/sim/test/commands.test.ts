import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand, canBuild } from '../src/sim/commands.js';

const planet = createPlanet({ seed: 3 });
const anyOreCell = planet.cells.find((c) => c.oreCapacity > 0)!.id;
const anyPentagon = planet.pentagons[0];
const plainHex = planet.cells.find(
  (c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell,
)!.id;

describe('canBuild', () => {
  it('pozwala postawić pylon na pustym heksie przy wystarczającej rudzie', () => {
    const s = createState(planet, 100);
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: true });
  });

  it('odmawia przy niewystarczającej rudzie', () => {
    const s = createState(planet, 1);
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: false, reason: 'INSUFFICIENT_ORE' });
  });

  it('odmawia na zajętej komórce', () => {
    const s = createState(planet, 500);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: false, reason: 'CELL_OCCUPIED' });
  });

  it('wpuszcza GEOTHERMAL_CAP wyłącznie na pentagon', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyPentagon, 'GEOTHERMAL_CAP')).toEqual({ ok: true });
    expect(canBuild(s, plainHex, 'GEOTHERMAL_CAP')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });

  it('wpuszcza EXTRACTOR wyłącznie na złoże', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyOreCell, 'EXTRACTOR')).toEqual({ ok: true });
    expect(canBuild(s, plainHex, 'EXTRACTOR')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });

  it('nie wpuszcza zwykłych budynków na pentagon', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyPentagon, 'PYLON')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });
});

describe('applyCommand', () => {
  it('BUILD pobiera rudę i stawia budynek z pełnym HP', () => {
    const s = createState(planet, 100);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    expect(s.ore).toBe(85);
    expect(s.buildings[plainHex]).toMatchObject({ type: 'PYLON', hp: 80, powered: false });
  });

  it('BUILD niedozwolony jest po cichu ignorowany, nie rzuca — komendy przychodzą z sieci', () => {
    const s = createState(planet, 1);
    expect(() => applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' })).not.toThrow();
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(1);
  });

  it('DEMOLISH usuwa budynek i zwraca połowę kosztu', () => {
    const s = createState(planet, 100);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    applyCommand(s, { kind: 'DEMOLISH', cellId: plainHex });
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(85 + 7);
  });

  it('DEMOLISH nie rusza CORE', () => {
    const s = createState(planet, 100);
    applyCommand(s, { kind: 'BUILD', cellId: planet.startCell, type: 'CORE' });
    applyCommand(s, { kind: 'DEMOLISH', cellId: planet.startCell });
    expect(s.buildings[planet.startCell]).not.toBeNull();
  });
});
