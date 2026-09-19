import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '@heliopolis/sim';
import { assessHealth, HEALTH_THRESHOLDS, type HealthId } from '../src/health.js';
import type { RunResult } from '../src/run.js';

/**
 * # Sześć liczb zdrowia (Faza 3, Zadanie 2)
 *
 * Kamień milowy §9 mówi „rozkłady z 10 000 runów są zdrowe". To nie jest kryterium, dopóki
 * nie ma progów — rozstrzygnięcie R1 planu daje im sześć liczb, a ten plik zamienia je
 * w kod, **żeby werdykt liczyła maszyna, a nie oko patrzące na histogram**.
 *
 * **Każde kryterium ma PARĘ**: rozkład zdrowy przechodzi, chory oblewa. Kryterium bez
 * połówki „ma przejść" spełni też funkcja zwracająca zawsze `false` — a taka wyglądałaby
 * jak bardzo surowy strażnik.
 */

/** Minimalny wynik przebiegu — tylko pola, które czyta `assessHealth`. */
function run(over: Partial<RunResult> = {}): RunResult {
  return {
    seed: 0,
    phase: 'DEFEAT',
    ticks: 1_000,
    cycle: 1,
    peakBuildings: 10,
    oreMined: 0,
    killsBySun: 0,
    killsByTurret: 0,
    firstDepletionTick: -1,
    coreDamager: null,
    policy: 'skilled',
    configFingerprint: 'aaaaaaaa',
    ...over,
  };
}

/** `n` przebiegów, z czego `wins` zwycięskich o zadanej długości. */
function batch(n: number, wins: number, winTicks = 36_000, policy = 'skilled'): RunResult[] {
  return Array.from({ length: n }, (_, i) =>
    run(
      i < wins
        ? { phase: 'VICTORY', ticks: winTicks, cycle: 7, policy }
        : { phase: 'DEFEAT', ticks: 2_000, cycle: 3, policy },
    ),
  );
}

const verdict = (id: HealthId, skilled: RunResult[], beginner: RunResult[]) => {
  const v = assessHealth({ skilled, beginner }).find((x) => x.id === id);
  if (v === undefined) throw new Error(`brak werdyktu ${id}`);
  return v;
};

const HEALTHY_BEGINNER = batch(1_000, 100, 36_000, 'beginner'); // 10 %

describe('1. [ZDROWIE] każde kryterium ma parę po obu stronach progu', () => {
  it('1a. [PARA] H1 — odsetek zwycięstw wprawnej: 40 % przechodzi, 85 % oblewa', () => {
    expect(verdict('H1', batch(1_000, 400), HEALTHY_BEGINNER).ok).toBe(true);
    expect(verdict('H1', batch(1_000, 850), HEALTHY_BEGINNER).ok).toBe(false);
  });

  it('1b. [PARA] H1 oblewa też OD DOŁU — 10 % to nie „trudno", tylko „nie da się"', () => {
    expect(verdict('H1', batch(1_000, 100), HEALTHY_BEGINNER).ok).toBe(false);
  });

  /**
   * H2 ma DWA warunki i oba muszą być wiązane osobno: początkujący musi wygrywać czasem
   * (inaczej gra jest nie do nauczenia) i wyraźnie rzadziej niż wprawny (inaczej
   * umiejętność nic nie znaczy).
   */
  it('1c. [PARA] H2 — 10 % przy wprawnej 40 % przechodzi, 0 % oblewa', () => {
    const skilled = batch(1_000, 400);
    expect(verdict('H2', skilled, batch(1_000, 100, 36_000, 'beginner')).ok).toBe(true);
    expect(verdict('H2', skilled, batch(1_000, 0, 36_000, 'beginner')).ok).toBe(false);
  });

  it('1d. [PARA] H2 oblewa, gdy początkujący wygrywa TYLE CO wprawny', () => {
    const skilled = batch(1_000, 400);
    expect(verdict('H2', skilled, batch(1_000, 390, 36_000, 'beginner')).ok).toBe(false);
  });

  it('1e. [PARA] H3 — mediana 30 min przechodzi, 19,8 min oblewa', () => {
    const minutes = (m: number) => Math.round((m * 60) / TICK_SECONDS);
    expect(verdict('H3', batch(1_000, 400, minutes(30)), HEALTHY_BEGINNER).ok).toBe(true);
    expect(verdict('H3', batch(1_000, 400, minutes(19.8)), HEALTHY_BEGINNER).ok).toBe(false);
    expect(verdict('H3', batch(1_000, 400, minutes(40)), HEALTHY_BEGINNER).ok).toBe(false);
  });

  /**
   * **H4 mierzy politykę POCZĄTKUJĄCĄ** — i ten test to wiąże, bo pierwsza wersja liczyła
   * ją na wprawnej. Zobaczone dopiero w raporcie bazowym: wprawna nigdy nie ginie w cyklu 1,
   * więc kryterium raportowało 0,0 % i OK, podczas gdy początkująca ginęła tam w 10 000
   * na 10 000 przebiegów. Kryterium napisane po to, żeby złapać dokładnie tę wadę,
   * przepuszczało ją — bo patrzyło nie na tę populację.
   */
  it('1f. [PARA] H4 — 10 % porażek w cyklu 1 przechodzi, 20 % oblewa', () => {
    const withCycle1 = (share: number): RunResult[] =>
      Array.from({ length: 1_000 }, (_, i) =>
        run({ phase: 'DEFEAT', cycle: i < share * 1_000 ? 1 : 5, policy: 'beginner' }),
      );
    expect(verdict('H4', batch(1_000, 400), withCycle1(0.1)).ok).toBe(true);
    expect(verdict('H4', batch(1_000, 400), withCycle1(0.2)).ok).toBe(false);
  });

  it('1g. H4 patrzy na POCZĄTKUJĄCĄ — zdrowa wprawna nie może go uratować', () => {
    const wprawnaBezPorazek = batch(1_000, 1_000); // same zwycięstwa
    const poczatkujacaGinacaOdRazu = Array.from({ length: 1_000 }, () =>
      run({ phase: 'DEFEAT', cycle: 1, policy: 'beginner' }),
    );
    expect(verdict('H4', wprawnaBezPorazek, poczatkujacaGinacaOdRazu).ok).toBe(false);
  });
});

describe('2. [ZDROWIE] kryterium BEZ DANYCH nie udaje spełnionego', () => {
  /**
   * **H5 i H6 nie dają się policzyć z jednej partii** — pierwsze potrzebuje wyników wielu
   * OTWARĆ (Zadanie 3), drugie wyników z pulą i bez niej (Zadanie 5).
   *
   * Gdyby niezmierzone kryterium raportowało `ok: false`, wyglądałoby jak wada balansu
   * i ktoś zacząłby ją „naprawiać". Gdyby raportowało `ok: true`, bramka przepuściłaby
   * fazę na dwóch kryteriach, których nikt nie sprawdził. **Trzeci stan jest jedyną
   * uczciwą odpowiedzią** — i musi być odróżnialny w raporcie.
   */
  it('2a. H5 i H6 bez danych są NIEZMIERZONE, a nie spełnione ani oblane', () => {
    for (const id of ['H5', 'H6'] as const) {
      const v = verdict(id, batch(100, 40), HEALTHY_BEGINNER);
      expect(v.measured, `${id} bez danych`).toBe(false);
      expect(v.ok, `${id} nie ma werdyktu`).toBeNull();
      expect(v.value).toBeNull();
    }
  });

  it('2b. [PARA] H5 Z danymi już ma werdykt: trzy otwarcia przechodzą, dwa nie', () => {
    const assess = (openings: number) =>
      assessHealth({
        skilled: batch(100, 40),
        beginner: HEALTHY_BEGINNER,
        winningOpenings: openings,
      }).find((v) => v.id === 'H5')!;
    expect(assess(3).ok).toBe(true);
    expect(assess(2).ok).toBe(false);
    expect(assess(3).measured).toBe(true);
  });
});

describe('3. [ZDROWIE] liczba niesie PRZEDZIAŁ UFNOŚCI', () => {
  /**
   * „85 %" bez „±2,2" obok jest tą klasą liczby, która w tym projekcie wracała: ktoś porówna
   * ją potem z 84 % i zobaczy różnicę, której nie ma. Półszerokość liczona z dwumianu,
   * `1,96·√(p(1−p)/n)`, w punktach procentowych.
   */
  it('3a. przedział zwęża się z pierwiastkiem próby — 4× więcej runów, 2× węższy', () => {
    const maly = verdict('H1', batch(250, 125), HEALTHY_BEGINNER).ciHalfWidthPp!;
    const duzy = verdict('H1', batch(1_000, 500), HEALTHY_BEGINNER).ciHalfWidthPp!;
    expect(maly / duzy).toBeCloseTo(2, 1);
  });

  it('3b. zmierzone liczby: 1 000 runów przy p=0,5 daje ±3,1 pp', () => {
    expect(verdict('H1', batch(1_000, 500), HEALTHY_BEGINNER).ciHalfWidthPp!).toBeCloseTo(3.1, 1);
  });
});

describe('4. [ZDROWIE] progi mieszkają w JEDNYM miejscu', () => {
  /**
   * Zadanie 3 będzie je czytać przy strojeniu. Rozsypane po sześciu funkcjach zaczęłyby się
   * rozjeżdżać z dokumentem — i to jest ta sama klasa, co liczba przepisana w dwóch plikach.
   */
  it('4a. każde kryterium ma wpis w tabeli progów', () => {
    for (const id of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const) {
      expect(HEALTH_THRESHOLDS[id], `próg ${id}`).toBeDefined();
    }
  });

  it('4b. werdykt cytuje próg, z którego korzysta — raport ma być czytelny bez kodu', () => {
    const v = verdict('H1', batch(1_000, 850), HEALTHY_BEGINNER);
    expect(v.note).toContain('25');
    expect(v.note).toContain('60');
  });
});
