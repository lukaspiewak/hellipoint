import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { buildAllFlowFields, buildFlowField } from '../src/sim/flowfield.js';
import { MinHeap } from '../src/sim/heap.js';
import { ENEMIES } from '../src/sim/defs.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 41 });
const neighbors = planet.cells.map((c) => c.neighbors);

describe('MinHeap', () => {
  it('zwraca elementy w kolejności rosnącego kosztu', () => {
    const h = new MinHeap(16);
    for (const [n, c] of [[1, 5], [2, 1], [3, 9], [4, 3]] as const) h.push(n, c);
    expect([h.pop(), h.pop(), h.pop(), h.pop()]).toEqual([2, 4, 1, 3]);
    expect(h.pop()).toBeUndefined();
  });

  it('rośnie ponad pojemność początkową', () => {
    const h = new MinHeap(2);
    for (let i = 10; i > 0; i--) h.push(i, i);
    expect(h.size).toBe(10);
    expect(h.pop()).toBe(1);
    expect(h.size).toBe(9);
  });

  it('przy remisach kosztów kolejność jest niemalejąca i identyczna między uruchomieniami', () => {
    const pairs = [[1, 5], [2, 5], [3, 1], [4, 1], [5, 5], [6, 1]] as const;
    const costOf = new Map<number, number>(pairs);

    function drain(): number[] {
      const h = new MinHeap(4); // mniej niż liczba elementów — wymusza `grow()` w trakcie remisów.
      for (const [n, c] of pairs) h.push(n, c);
      const order: number[] = [];
      for (let popped = h.pop(); popped !== undefined; popped = h.pop()) order.push(popped);
      return order;
    }

    const a = drain();
    const b = drain();
    const costsA = a.map((n) => costOf.get(n)!);
    for (let i = 1; i < costsA.length; i++) expect(costsA[i]).toBeGreaterThanOrEqual(costsA[i - 1]);
    // Ruch Fazy 1C rozstrzyga remisy odległości tą samą kolejnością co kopiec, więc kolejność
    // wyciągania MUSI być deterministyczna, nie tylko "poprawna": ten sam ciąg push() ma dawać
    // dokładnie ten sam ciąg pop(), nie tylko ciąg o tych samych kosztach.
    expect(a).toEqual(b);
  });
});

function withCore() {
  const s = createState(planet, 100000);
  applyCommand(s, { kind: 'BUILD', cellId: planet.startCell, type: 'CORE' });
  return s;
}

describe('buildFlowField', () => {
  it('cel ma odległość 0, wszystko inne większą', () => {
    const f = buildFlowField(withCore(), 'CORE', ENEMIES.ARMOR.dps);
    expect(f.distance[planet.startCell]).toBe(0);
    for (let i = 0; i < f.distance.length; i++) {
      if (i !== planet.startCell) expect(f.distance[i]).toBeGreaterThan(0);
    }
  });

  it('na pustej planecie odwzorowuje odległość grafową', () => {
    const f = buildFlowField(withCore(), 'CORE', ENEMIES.ARMOR.dps);
    const bfs = multiSourceDistances(neighbors, [planet.startCell]);
    for (let i = 0; i < f.distance.length; i++) {
      expect(f.distance[i]).toBeCloseTo(bfs[i], 9);
    }
  });

  it('podążanie za `next` zawsze dochodzi do celu — ścieżka ISTNIEJE zawsze (D3)', () => {
    const s = withCore();
    // Otocz CORE pierścieniem barykad — w twardym blokowaniu byłoby to nieprzejściowe.
    for (const n of planet.cells[planet.startCell].neighbors) {
      applyCommand(s, { kind: 'BUILD', cellId: n, type: 'BARRICADE' });
    }
    const f = buildFlowField(s, 'CORE', ENEMIES.ARMOR.dps);

    for (const start of [100, 500, 900, 1300]) {
      let cur = start;
      let hops = 0;
      while (cur !== planet.startCell && hops < 5000) {
        cur = f.next[cur];
        expect(cur).toBeGreaterThanOrEqual(0);
        hops++;
      }
      expect(cur).toBe(planet.startCell);
    }
  });

  it('zabudowana komórka jest droższa od pustej', () => {
    const empty = buildFlowField(withCore(), 'CORE', ENEMIES.ARMOR.dps);
    const s = withCore();
    const target = planet.cells[planet.startCell].neighbors[0];
    applyCommand(s, { kind: 'BUILD', cellId: target, type: 'BARRICADE' });
    const walled = buildFlowField(s, 'CORE', ENEMIES.ARMOR.dps);
    expect(walled.distance[target]).toBeGreaterThan(empty.distance[target]);
  });

  it('wróg o wyższym DPS wycenia ten sam mur taniej', () => {
    const s = withCore();
    const target = planet.cells[planet.startCell].neighbors[0];
    applyCommand(s, { kind: 'BUILD', cellId: target, type: 'BARRICADE' });

    const weak = buildFlowField(s, 'CORE', 10);
    const strong = buildFlowField(s, 'CORE', 100);
    expect(strong.distance[target]).toBeLessThan(weak.distance[target]);
  });

  it('DISRUPTOR celuje w infrastrukturę energetyczną, nie w barykady', () => {
    const s = withCore();
    const ring = planet.cells[planet.startCell].neighbors;
    applyCommand(s, { kind: 'BUILD', cellId: ring[0], type: 'BARRICADE' });

    const f = buildFlowField(s, 'ENERGY_INFRASTRUCTURE', ENEMIES.DISRUPTOR.dps);
    expect(f.distance[planet.startCell]).toBe(0); // CORE jest infrastrukturą
    expect(f.distance[ring[0]]).toBeGreaterThan(0); // barykada nie jest
  });

  it('bez żadnego celu wszystkie odległości są nieskończone, a `next` nigdzie nie wskazuje', () => {
    const f = buildFlowField(createState(planet, 0), 'CORE', 50);
    for (const d of f.distance) expect(d).toBe(Infinity);
    for (const n of f.next) expect(n).toBe(-1);
  });

  it('wyrzuca błąd dla attackerDps <= 0 lub nieskończonego', () => {
    const s = withCore();
    expect(() => buildFlowField(s, 'CORE', 0)).toThrow(RangeError);
    expect(() => buildFlowField(s, 'CORE', -10)).toThrow(RangeError);
    expect(() => buildFlowField(s, 'CORE', NaN)).toThrow(RangeError);
    expect(() => buildFlowField(s, 'CORE', Infinity)).toThrow(RangeError);
    expect(() => buildFlowField(s, 'CORE', -Infinity)).toThrow(RangeError);
  });
});

describe('buildAllFlowFields', () => {
  it('daje jedno pole na typ wroga', () => {
    const fields = buildAllFlowFields(withCore());
    expect(Object.keys(fields).sort()).toEqual(['ARMOR', 'DISRUPTOR', 'SWARM']);
  });

  it('jest deterministyczne dla każdego typu wroga, `distance` i `next`', () => {
    const a = buildAllFlowFields(withCore());
    const b = buildAllFlowFields(withCore());
    for (const type of ['SWARM', 'ARMOR', 'DISRUPTOR'] as const) {
      expect([...a[type].distance]).toEqual([...b[type].distance]);
      expect([...a[type].next]).toEqual([...b[type].next]);
    }
  });
});
