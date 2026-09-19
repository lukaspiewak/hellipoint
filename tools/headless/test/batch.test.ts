import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN } from '@heliopolis/sim';
import { mergeBatches, runBatch, splitRange } from '../src/batch.js';

/**
 * Zrównoleglenie sprowadza się do PODZIAŁU ZAKRESU SEEDÓW. Testowany jest niezmiennik,
 * nie mechanika procesów: proces jest szczegółem, niezmiennik jest kontraktem.
 */
describe('1. [PARTIA] podział i sklejenie nie zmieniają ANI JEDNEGO wyniku', () => {
  const RANGE = { from: 0, to: 12 };
  const TICKS = 800;

  /**
   * Limit WYPROWADZONY, nie zgadnięty — ten sam rachunek, co w `policy.test.ts`.
   *
   * Każdy z tych testów przepuszcza 24–36 przebiegów po 800 ticków; bezczynnie to ~3 s,
   * a domyślne 5 s vitesta **oblewało pod obciążeniem pakietu** (pliki idą równolegle).
   * Współczynnik obciążeniowy zmierzony w Fazie 2C: 3,2×. Stąd 3 × 3,2 × 2 ≈ 20 s,
   * zaokrąglone w górę.
   */
  const BUDGET_MS = 30_000;

  it('1a. sklejone kawałki są IDENTYCZNE z przebiegiem całości — run po runie', () => {
    const calosc = runBatch(RANGE, DEFAULT_RUN, TICKS);
    const kawalki = splitRange(RANGE, 4).map((r) => runBatch(r, DEFAULT_RUN, TICKS));
    expect(mergeBatches(kawalki)).toEqual(calosc);
  }, BUDGET_MS);

  /**
   * Kontrola na fiksturę: porównanie dwóch pustych partii też byłoby „identyczne", a partia
   * samych przebiegów bez zdarzeń nie odróżniłaby poprawnego podziału od losowego.
   */
  it('1b. partia NIE jest pusta i przebiegi się między sobą różnią', () => {
    const calosc = runBatch(RANGE, DEFAULT_RUN, TICKS);
    expect(calosc).toHaveLength(12);
    expect(new Set(calosc.map((r) => r.ticks + ':' + r.peakBuildings)).size).toBeGreaterThan(1);
  }, BUDGET_MS);

  it('1c. KOLEJNOŚĆ jest częścią kontraktu — kawałki w odwrotnej kolejności dają to samo', () => {
    const calosc = runBatch(RANGE, DEFAULT_RUN, TICKS);
    const kawalki = splitRange(RANGE, 4).map((r) => runBatch(r, DEFAULT_RUN, TICKS));
    // Procesy wracają w kolejności, w jakiej skończyły — czyli dowolnej.
    expect(mergeBatches([...kawalki].reverse())).toEqual(calosc);
  }, BUDGET_MS);
});

describe('2. [PARTIA] podział jest szczelny', () => {
  it('2a. [PARA] kawałki pokrywają zakres bez luk i bez zakładek', () => {
    for (const parts of [1, 3, 7, 8]) {
      const kawalki = splitRange({ from: 5, to: 105 }, parts);
      expect(kawalki[0].from).toBe(5);
      expect(kawalki[kawalki.length - 1].to).toBe(105);
      for (let i = 1; i < kawalki.length; i++) {
        expect(kawalki[i].from, `styk kawałków przy ${parts} częściach`).toBe(kawalki[i - 1].to);
      }
      const suma = kawalki.reduce((n, k) => n + (k.to - k.from), 0);
      expect(suma, `suma przy ${parts} częściach`).toBe(100);
    }
  });

  it('2b. reszta z dzielenia idzie do PIERWSZYCH kawałków, nie do ostatniego', () => {
    // Ostatni kawałek kończy najpóźniej, więc doklejona do niego reszta przedłuża CAŁOŚĆ.
    const kawalki = splitRange({ from: 0, to: 10 }, 4).map((k) => k.to - k.from);
    expect(kawalki).toEqual([3, 3, 2, 2]);
  });

  it('2c. zakładka w sklejaniu jest GŁOŚNA, nie cicha', () => {
    const a = runBatch({ from: 0, to: 3 }, DEFAULT_RUN, 300);
    const b = runBatch({ from: 2, to: 5 }, DEFAULT_RUN, 300); // seed 2 w obu
    expect(() => mergeBatches([a, b])).toThrow(/zakładkę/);
  }, 30_000);

  it('2d. zły podział rzuca zamiast po cichu oddać pusty zakres', () => {
    expect(() => splitRange({ from: 0, to: 10 }, 0)).toThrow(/dodatnią/);
    expect(() => splitRange({ from: 10, to: 0 }, 2)).toThrow(/od tyłu/);
  });
});
