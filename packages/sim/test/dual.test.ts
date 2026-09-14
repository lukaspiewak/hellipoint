import { describe, expect, it } from 'vitest';
import { buildGeodesic } from '../src/world/geodesic.js';
import { buildDual } from '../src/world/dual.js';

const dual12 = buildDual(buildGeodesic(12));

describe('buildDual', () => {
  it('daje jedną komórkę na wierzchołek geodezyjny', () => {
    expect(dual12.centers.length).toBe(1442);
  });

  it('ma DOKŁADNIE 12 pentagonów, reszta to heksagony', () => {
    const pent = dual12.cellTypes.filter((t) => t === 'PENTAGON').length;
    const hex = dual12.cellTypes.filter((t) => t === 'HEXAGON').length;
    expect(pent).toBe(12);
    expect(hex).toBe(1430);
  });

  it('każda komórka ma 5 albo 6 sąsiadów, zgodnie ze swoim typem', () => {
    for (let i = 0; i < dual12.centers.length; i++) {
      const expected = dual12.cellTypes[i] === 'PENTAGON' ? 5 : 6;
      expect(dual12.neighbors[i].length).toBe(expected);
    }
  });

  it('liczba narożników zgadza się z liczbą sąsiadów', () => {
    for (let i = 0; i < dual12.centers.length; i++) {
      expect(dual12.corners[i].length).toBe(dual12.neighbors[i].length);
    }
  });

  it('sąsiedztwo jest symetryczne', () => {
    for (let i = 0; i < dual12.centers.length; i++) {
      for (const n of dual12.neighbors[i]) {
        expect(dual12.neighbors[n]).toContain(i);
      }
    }
  });

  it('żadna komórka nie jest swoim własnym sąsiadem i nie ma duplikatów', () => {
    for (let i = 0; i < dual12.centers.length; i++) {
      const ns = dual12.neighbors[i];
      expect(ns).not.toContain(i);
      expect(new Set(ns).size).toBe(ns.length);
    }
  });

  it('12 pentagonów to wierzchołki wyjściowego dwudziestościanu — są maksymalnie rozproszone', () => {
    const pentIds = dual12.cellTypes
      .map((t, i) => (t === 'PENTAGON' ? i : -1))
      .filter((i) => i >= 0);
    // Żadne dwa pentagony nie sąsiadują ze sobą przy tej częstotliwości.
    for (const p of pentIds) {
      for (const n of dual12.neighbors[p]) {
        expect(dual12.cellTypes[n]).toBe('HEXAGON');
      }
    }
  });

  it('jest deterministyczny', () => {
    expect(buildDual(buildGeodesic(4))).toEqual(buildDual(buildGeodesic(4)));
  });
});
