import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { BUILDINGS } from '../src/sim/defs.js';
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

/**
 * CORE ma `playerBuildable: false` (Important #1, przegląd końcowy Fazy 1B), więc
 * `applyCommand` go już nie postawi. `connectedToCore` liczy propagację OD CORE, więc
 * niemal każdy test w tym pliku go potrzebuje jako scaffolding — stawiamy go tak samo,
 * jak zrobi to `Sim` w Fazie 1C: bezpośrednim zapisem do stanu.
 */
function withCore() {
  const s = createState(planet, 5000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
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

  // Minor z przeglądu końcowego Fazy 1B: powyższy test próbkuje odległość 7 wobec
  // promienia 3 — spory margines, który nie złapałby off-by-one w warunku pętli BFS
  // (`step <= radius` zamiast `step < radius` poszerzyłby zasięg do 4, a ŻADEN
  // dotychczasowy test by tego nie oblał). Poniższe dwa testy pinują samą GRANICĘ z obu
  // stron. KAŻDY stawia dokładnie JEDEN budynek na świeżym `withCore()` — w odróżnieniu
  // od pierwszej (nieudanej) wersji tego testu, która stawiała BATTERY (connectionRadius
  // 2) na OBU odległościach naraz i przez to łączyła odległość 4 z CORE pośrednio,
  // przez budynek na odległości 3, zamiast testować wyłącznie promień samego CORE.
  it('na granicy zasięgu (odległość 3, promień CORE też 3) budynek JEST połączony', () => {
    const s = withCore();
    const atLimit = cellAtDistance(3);
    applyCommand(s, { kind: 'BUILD', cellId: atLimit, type: 'BATTERY' });
    expect(connectedToCore(s)[atLimit]).toBe(true);
  });

  it('o jeden krok POZA granicą zasięgu (odległość 4) budynek NIE jest połączony', () => {
    const s = withCore();
    const justPast = cellAtDistance(4);
    applyCommand(s, { kind: 'BUILD', cellId: justPast, type: 'BATTERY' });
    expect(connectedToCore(s)[justPast]).toBe(false);
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
