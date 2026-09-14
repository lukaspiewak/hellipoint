import { describe, expect, it } from 'vitest';
import { buildGeodesic, vertexCountFor } from '../src/world/geodesic.js';
import { cross, dot, length, sub } from '../src/math/vec3.js';

describe('buildGeodesic', () => {
  it('liczba wierzchołków spełnia 10·n²+2 dla n = 1..8', () => {
    for (let n = 1; n <= 8; n++) {
      expect(buildGeodesic(n).vertices.length).toBe(10 * n * n + 2);
      expect(vertexCountFor(n)).toBe(10 * n * n + 2);
    }
  });

  it('częstotliwość 1 to goły dwudziestościan', () => {
    const m = buildGeodesic(1);
    expect(m.vertices.length).toBe(12);
    expect(m.faces.length).toBe(20);
  });

  it('częstotliwość 12 daje docelowe 1442 komórki', () => {
    const m = buildGeodesic(12);
    expect(m.vertices.length).toBe(1442);
    expect(m.faces.length).toBe(20 * 144);
  });

  it('spełnia wzór Eulera V - E + F = 2', () => {
    const m = buildGeodesic(12);
    const edges = new Set<string>();
    for (const [a, b, c] of m.faces) {
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        edges.add(u < v ? `${u}_${v}` : `${v}_${u}`);
      }
    }
    expect(m.vertices.length - edges.size + m.faces.length).toBe(2);
  });

  it('wszystkie wierzchołki leżą na sferze jednostkowej', () => {
    for (const v of buildGeodesic(6).vertices) {
      expect(length(v)).toBeCloseTo(1, 12);
    }
  });

  it('wszystkie ściany są nawinięte na zewnątrz', () => {
    const m = buildGeodesic(5);
    for (const [ia, ib, ic] of m.faces) {
      const a = m.vertices[ia], b = m.vertices[ib], c = m.vertices[ic];
      const n = cross(sub(b, a), sub(c, a));
      expect(dot(n, a)).toBeGreaterThan(0);
    }
  });

  it('jest deterministyczny', () => {
    expect(buildGeodesic(4)).toEqual(buildGeodesic(4));
  });
});
