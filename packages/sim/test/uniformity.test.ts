import { describe, expect, it } from 'vitest';
import { buildGeodesic } from '../src/world/geodesic.js';
import { buildDual } from '../src/world/dual.js';
import { areaCv, spacingCv } from '../src/world/uniformity.js';

const dual12 = buildDual(buildGeodesic(12));

describe('spacingCv', () => {
  it('przypina zmierzony rozrzut odstępów przy frequency 12', () => {
    expect(spacingCv(dual12)).toBeCloseTo(0.0716, 3);
  });

  it('jest dodatni i skończony', () => {
    const v = spacingCv(dual12);
    expect(v).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
  });

  it('jest deterministyczny', () => {
    expect(spacingCv(buildDual(buildGeodesic(4)))).toBe(spacingCv(buildDual(buildGeodesic(4))));
  });

  it('siatka idealnie regularna miałaby zerowy rozrzut — dwudziestościan bazowy jest taki', () => {
    // Przy frequency 1 wszystkie krawędzie dwudziestościanu są równe z konstrukcji,
    // więc rozrzut musi być numerycznie zerowy. To kalibruje samą metrykę:
    // gdyby liczyła coś innego niż odległości środek–sąsiad, tu by nie wyszło zero.
    expect(spacingCv(buildDual(buildGeodesic(1)))).toBeCloseTo(0, 9);
  });
});

describe('areaCv', () => {
  it('przypina zmierzony rozrzut pól przy frequency 12', () => {
    expect(areaCv(dual12)).toBeCloseTo(0.1330, 3);
  });

  it('rozrzut pól jest większy niż rozrzut odstępów — pole skaluje się kwadratowo', () => {
    expect(areaCv(dual12)).toBeGreaterThan(spacingCv(dual12));
  });

  it('jest deterministyczny', () => {
    expect(areaCv(buildDual(buildGeodesic(4)))).toBe(areaCv(buildDual(buildGeodesic(4))));
  });
});
