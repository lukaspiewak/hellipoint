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

  it('na idealnie regularnej siatce (dwudziestościan) zwraca zero — test wiarygodności', () => {
    // Frequency 1 to regularny dwudziestościan (vertex- i edge-transitive), więc każda
    // metryka odstępów powinna zwracać zero. Test ten to wiarygodność: łapie niszczące błędy
    // w implementacji (asymetrię, skalowanie, niespójne wyliczanie). Ale nie dowodzi, że ta
    // konkretna formuła to dokładnie odległości środek–sąsiad — na tej siatce wiele rozsądnych
    // metryk równie dobrze daje zero (np. edge CV, center-to-corner CV). Prawdziwą regresji dla
    // tożsamości metryki broni pinowana wartość przy frequency 12, gdzie zmiana formuły
    // wyskoczy poza tolerancję toBeCloseTo(…, 3).
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
