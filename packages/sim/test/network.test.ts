import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { connectedToCore } from '../src/sim/network.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 11 });
const neighbors = planet.cells.map((c) => c.neighbors);

const fromStart = multiSourceDistances(neighbors, [planet.startCell]);

const isPlainHex = (i: number) =>
  planet.cells[i].cellType === 'HEXAGON' && planet.cells[i].oreCapacity === 0;

/** Pusty heks oddalony o dokładnie `steps` kroków od komórki startowej. */
function cellAtDistance(steps: number): number {
  for (let i = 0; i < fromStart.length; i++) {
    if (fromStart[i] === steps && isPlainHex(i)) return i;
  }
  throw new Error(`brak pustego heksa w odległości ${steps} od startu`);
}

/**
 * Pusty heks oddalony o `steps` kroków od `from` ORAZ o więcej niż `minFromStart`
 * kroków od komórki startowej. Bez drugiego warunku „daleki" kandydat mógłby
 * wylądować po przeciwnej stronie planety niż pylon-pośrednik i test łańcucha
 * sprawdzałby coś innego, niż zakłada.
 */
function cellNear(from: number, steps: number, minFromStart: number): number {
  const d = multiSourceDistances(neighbors, [from]);
  for (let i = 0; i < d.length; i++) {
    if (d[i] === steps && fromStart[i] > minFromStart && isPlainHex(i)) return i;
  }
  throw new Error(`brak heksa ${steps} kroków od ${from} i dalej niż ${minFromStart} od startu`);
}

function withCore() {
  const s = createState(planet, 5000);
  applyCommand(s, { kind: 'BUILD', cellId: planet.startCell, type: 'CORE' });
  return s;
}

describe('connectedToCore', () => {
  it('CORE jest połączony sam ze sobą', () => {
    expect(connectedToCore(withCore())[planet.startCell]).toBe(true);
  });

  it('budynek w zasięgu CORE jest połączony', () => {
    const s = withCore();
    const near = cellAtDistance(2); // connectionRadius CORE = 3
    applyCommand(s, { kind: 'BUILD', cellId: near, type: 'BATTERY' });
    expect(connectedToCore(s)[near]).toBe(true);
  });

  it('budynek poza zasięgiem NIE jest połączony', () => {
    const s = withCore();
    const far = cellAtDistance(7);
    applyCommand(s, { kind: 'BUILD', cellId: far, type: 'BATTERY' });
    expect(connectedToCore(s)[far]).toBe(false);
  });

  it('pylon przedłuża sieć', () => {
    const s = withCore();
    const mid = cellAtDistance(3);
    const far = cellNear(mid, 3, 3);
    applyCommand(s, { kind: 'BUILD', cellId: mid, type: 'PYLON' });
    applyCommand(s, { kind: 'BUILD', cellId: far, type: 'BATTERY' });
    expect(connectedToCore(s)[far]).toBe(true);
  });

  it('BARRICADE nie przewodzi — connectionRadius = 0', () => {
    const s = withCore();
    const mid = cellAtDistance(3);
    const far = cellNear(mid, 3, 3);
    applyCommand(s, { kind: 'BUILD', cellId: mid, type: 'BARRICADE' });
    applyCommand(s, { kind: 'BUILD', cellId: far, type: 'BATTERY' });
    expect(connectedToCore(s)[far]).toBe(false);
  });

  it('zniszczenie pylonu rozspójnia sieć, odbudowa ją spaja', () => {
    const s = withCore();
    const mid = cellAtDistance(3);
    const far = cellNear(mid, 3, 3);
    applyCommand(s, { kind: 'BUILD', cellId: mid, type: 'PYLON' });
    applyCommand(s, { kind: 'BUILD', cellId: far, type: 'BATTERY' });
    expect(connectedToCore(s)[far]).toBe(true);

    s.buildings[mid] = null;
    expect(connectedToCore(s)[far]).toBe(false);

    applyCommand(s, { kind: 'BUILD', cellId: mid, type: 'PYLON' });
    expect(connectedToCore(s)[far]).toBe(true);
  });

  it('bez CORE nic nie jest połączone', () => {
    const s = createState(planet, 5000);
    applyCommand(s, { kind: 'BUILD', cellId: cellAtDistance(1), type: 'BATTERY' });
    expect(connectedToCore(s).some((v) => v)).toBe(false);
  });
});
