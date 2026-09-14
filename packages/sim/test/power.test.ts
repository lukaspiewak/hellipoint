import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { updatePower } from '../src/sim/power.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 8 });
const neighbors = planet.cells.map((c) => c.neighbors);
const dist = multiSourceDistances(neighbors, [planet.startCell]);

function nearbyHexes(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < dist.length && out.length < count; i++) {
    if (dist[i] >= 1 && dist[i] <= 2 && planet.cells[i].cellType === 'HEXAGON' && planet.cells[i].oreCapacity === 0) {
      out.push(i);
    }
  }
  if (out.length < count) throw new Error('za mało pustych heksów blisko startu');
  return out;
}

/**
 * Jak `nearbyHexes`, ale zwraca heksy ZE złożem (`oreCapacity > 0`) — jedyne, na których
 * `canBuild` wpuszcza EXTRACTOR (`allowedCells: 'ORE_HEXAGON'` wymaga `oreRemaining > 0`,
 * a świeży stan ma `oreRemaining === oreCapacity`). `nearbyHexes` celowo filtruje odwrotnie
 * (`oreCapacity === 0`), więc nie nadaje się do stawiania ekstraktora.
 */
function nearbyOreHexes(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < dist.length && out.length < count; i++) {
    if (dist[i] >= 1 && dist[i] <= 2 && planet.cells[i].cellType === 'HEXAGON' && planet.cells[i].oreCapacity > 0) {
      out.push(i);
    }
  }
  if (out.length < count) throw new Error('za mało heksów ze złożem blisko startu');
  return out;
}

function base() {
  const s = createState(planet, 100000);
  applyCommand(s, { kind: 'BUILD', cellId: planet.startCell, type: 'CORE' });
  return s;
}

const fullLight = new Float32Array(planet.cells.length).fill(1);
const noLight = new Float32Array(planet.cells.length).fill(0);

describe('updatePower', () => {
  it('CORE sam produkuje 10/s i zasila się sam', () => {
    const s = base();
    const r = updatePower(s, noLight);
    expect(r.supply).toBeCloseTo(10, 9);
    expect(r.demand).toBeCloseTo(0, 9);
    expect(s.buildings[planet.startCell]!.powered).toBe(true);
  });

  it('SOLAR produkuje proporcjonalnie do oświetlenia, nie skokowo', () => {
    const s = base();
    const [cell] = nearbyHexes(1);
    applyCommand(s, { kind: 'BUILD', cellId: cell, type: 'SOLAR_PANEL' });

    const half = new Float32Array(planet.cells.length).fill(0);
    half[cell] = 0.5;
    expect(updatePower(s, half).supply).toBeCloseTo(10 + 20, 6);
    expect(updatePower(s, noLight).supply).toBeCloseTo(10, 6);
  });

  it('niepodłączony budynek nie produkuje i nie pobiera', () => {
    const s = base();
    const orphan = planet.cells.find(
      (c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && dist[c.id] > 8,
    )!.id;
    applyCommand(s, { kind: 'BUILD', cellId: orphan, type: 'SOLAR_PANEL' });
    expect(updatePower(s, fullLight).supply).toBeCloseTo(10, 6);
    expect(s.buildings[orphan]!.powered).toBe(false);
  });

  it('nadwyżka ładuje magazyn, ale nie ponad pojemność', () => {
    const s = base();
    s.storedEnergy = 0;
    for (let i = 0; i < 100; i++) updatePower(s, noLight);
    const coreStorage = 200;
    expect(s.storedEnergy).toBeLessThanOrEqual(coreStorage);
    expect(s.storedEnergy).toBeGreaterThan(0);
  });

  it('przy niedoborze gasi EKSTRAKTORY przed obroną (§5.1)', () => {
    const s = base();
    const [a] = nearbyOreHexes(1);
    const [b, c, d] = nearbyHexes(3);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'KINETIC_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'LASER_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: d, type: 'SOLAR_PANEL' });
    s.storedEnergy = 0;

    // Podaż: CORE 10 + panel 40·0,1 = 14/s. Popyt: 5+3+12 = 20/s.
    // Zgaszenie ekstraktora daje 15 (wciąż za mało), plus kinetyka daje 12 ≤ 14 — laser przeżywa.
    const dimLight = new Float32Array(planet.cells.length).fill(0);
    dimLight[d] = 0.1;

    const r = updatePower(s, dimLight);
    expect(r.shedTypes).toContain('EXTRACTOR');
    expect(r.shedTypes).toContain('KINETIC_TURRET');
    expect(s.buildings[c]!.powered).toBe(true); // obrona laserowa gaśnie ostatnia
  });

  it('gasi lasery dopiero jako ostatnie', () => {
    const s = base();
    const [a] = nearbyOreHexes(1);
    const [b, c] = nearbyHexes(2);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'KINETIC_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'LASER_TURRET' });
    s.storedEnergy = 0;

    // Odetnij całą produkcję poza CORE i zobacz, co gaśnie.
    const r = updatePower(s, noLight);
    const order = ['EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET'];
    for (let i = 1; i < r.shedTypes.length; i++) {
      expect(order.indexOf(r.shedTypes[i])).toBeGreaterThan(order.indexOf(r.shedTypes[i - 1]));
    }
  });

  it('magazyn pokrywa chwilowy niedobór zamiast natychmiast gasić', () => {
    const s = base();
    const [a, b, c] = nearbyOreHexes(3);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'EXTRACTOR' });
    s.storedEnergy = 100;

    // Popyt 15/s przy podaży 10/s — realny niedobór, ale magazyn go pokrywa.
    const before = s.storedEnergy;
    const r = updatePower(s, noLight);
    expect(r.shedTypes).toEqual([]);
    expect(s.storedEnergy).toBeLessThan(before);
    expect(s.storedEnergy).toBeCloseTo(before + (10 - 15) * TICK_SECONDS, 6);
  });
});
