import { describe, expect, it } from 'vitest';
import { add, normalize, scale, type Vec3 } from '../src/math/vec3.js';
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

  it('narożniki i sąsiedzi są współbieżnie uporządkowane: sąsiad k leży za krawędzią między narożnikami k i k+1', () => {
    // Test at multiple frequencies to catch regressions early
    const frequencies = [1, 4, 12];
    let totalEdgeChecks = 0;

    for (const freq of frequencies) {
      const mesh = buildGeodesic(freq);
      const dual = buildDual(mesh);

      // Precompute face centroids using the same formula as buildDual
      const faceCentroids: Vec3[] = mesh.faces.map(([a, b, c]) =>
        normalize(scale(add(add(mesh.vertices[a], mesh.vertices[b]), mesh.vertices[c]), 1 / 3)),
      );

      // For each cell
      for (let v = 0; v < dual.centers.length; v++) {
        const corners = dual.corners[v];
        const neighbors = dual.neighbors[v];

        // For each edge in the cell
        for (let k = 0; k < neighbors.length; k++) {
          const neighbor = neighbors[k];
          const cornerCurrent = corners[k];
          const cornerNext = corners[(k + 1) % corners.length];

          // Find the two faces that share edge (v, neighbor)
          const sharedFaces: number[] = [];
          for (let f = 0; f < mesh.faces.length; f++) {
            const [a, b, c] = mesh.faces[f];
            if (
              ((a === v || b === v || c === v) && (a === neighbor || b === neighbor || c === neighbor))
            ) {
              sharedFaces.push(f);
            }
          }

          // There must be exactly 2 faces sharing this edge
          expect(sharedFaces).toHaveLength(2);

          // Get the centroids of the two shared faces
          const centroid1 = faceCentroids[sharedFaces[0]];
          const centroid2 = faceCentroids[sharedFaces[1]];

          // The two centroids should match the two adjacent corners (in either order)
          const eps = 1e-9;
          const match1 = (
            Math.abs(centroid1.x - cornerCurrent.x) < eps &&
            Math.abs(centroid1.y - cornerCurrent.y) < eps &&
            Math.abs(centroid1.z - cornerCurrent.z) < eps &&
            Math.abs(centroid2.x - cornerNext.x) < eps &&
            Math.abs(centroid2.y - cornerNext.y) < eps &&
            Math.abs(centroid2.z - cornerNext.z) < eps
          );

          const match2 = (
            Math.abs(centroid2.x - cornerCurrent.x) < eps &&
            Math.abs(centroid2.y - cornerCurrent.y) < eps &&
            Math.abs(centroid2.z - cornerCurrent.z) < eps &&
            Math.abs(centroid1.x - cornerNext.x) < eps &&
            Math.abs(centroid1.y - cornerNext.y) < eps &&
            Math.abs(centroid1.z - cornerNext.z) < eps
          );

          expect(match1 || match2).toBe(true);
          totalEdgeChecks++;
        }
      }
    }

    // Exact count, not just non-zero: a loop-bound regression that silently skipped
    // most cells would still pass a `toBeGreaterThan(0)` check. 60 (freq 1) + 960 (freq 4)
    // + 8640 (freq 12) = 9660.
    expect(totalEdgeChecks).toBe(9660);
  });
});
