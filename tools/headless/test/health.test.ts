import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '@heliopolis/sim';
import {
  assessHealth,
  ciHalfWidthPp,
  HEALTH_THRESHOLDS,
  medianCiHalfWidth,
  PopulationMismatch,
  type HealthId,
} from '../src/health.js';
import { BEGINNER_POLICY_NAME } from '../src/policy.js';
import { NAZWA_ZNANEJ_LINII, SKILLED_POLICY_NAME } from '../src/skilledPolicy.js';
import type { RunResult } from '../src/run.js';

/**
 * # Sześć liczb zdrowia (Faza 3, Zadanie 2)
 *
 * Kamień milowy §9 mówi „rozkłady z 10 000 runów są zdrowe". To nie jest kryterium, dopóki
 * nie ma progów — rozstrzygnięcie R1 planu daje im sześć liczb, a ten plik zamienia je
 * w kod, **żeby werdykt liczyła maszyna, a nie oko patrzące na histogram**.
 *
 * ## Para wiąże KRAWĘDŹ, nie pasmo
 *
 * Pierwsza wersja tego pliku miała dla H1 (próg 25–60 %) parę 40 % / 85 %. Obie połówki
 * robiły, co trzeba, komplet świecił na zielono — a mutacja `minPct = 35` **przeżywała**,
 * bo 40 leży po właściwej stronie i trzydziestki piątki. Para odległa od granicy wiąże
 * „gdzieś w paśmie", czyli nie wiąże progu. Dlatego każda para poniżej stoi o dziesiątą
 * część jednostki od liczby, którą ma związać.
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
    policy: SKILLED_POLICY_NAME,
    configFingerprint: 'aaaaaaaa', opening: NAZWA_ZNANEJ_LINII,
    ...over,
  };
}

/** `n` przebiegów, z czego `wins` zwycięskich o zadanej długości. */
function batch(
  n: number,
  wins: number,
  winTicks = 36_000,
  policy = SKILLED_POLICY_NAME,
): RunResult[] {
  return Array.from({ length: n }, (_, i) =>
    run(
      i < wins
        ? { phase: 'VICTORY', ticks: winTicks, cycle: 7, policy }
        : { phase: 'DEFEAT', ticks: 2_000, cycle: 3, policy },
    ),
  );
}

const beginners = (n: number, wins: number) => batch(n, wins, 36_000, BEGINNER_POLICY_NAME);

const verdict = (id: HealthId, skilled: RunResult[], beginner: RunResult[]) => {
  const v = assessHealth({ skilled, beginner }).find((x) => x.id === id);
  if (v === undefined) throw new Error(`brak werdyktu ${id}`);
  return v;
};

/** Zdrowa populacja odniesienia: 10 % zwycięstw, żadnej śmierci w cyklu 1. */
const HEALTHY_BEGINNER = beginners(1_000, 100);

const minuty = (m: number) => Math.round((m * 60) / TICK_SECONDS);

describe('1. [ZDROWIE] każda para stoi o DZIESIĄTĄ CZĘŚĆ od progu, który wiąże', () => {
  it('1a. [PARA] H1 dolna krawędź 25 %: 25,1 % przechodzi, 24,9 % oblewa', () => {
    expect(verdict('H1', batch(1_000, 251), HEALTHY_BEGINNER).ok).toBe(true);
    expect(verdict('H1', batch(1_000, 249), HEALTHY_BEGINNER).ok).toBe(false);
  });

  it('1b. [PARA] H1 górna krawędź 60 %: 59,9 % przechodzi, 60,1 % oblewa', () => {
    expect(verdict('H1', batch(1_000, 599), HEALTHY_BEGINNER).ok).toBe(true);
    expect(verdict('H1', batch(1_000, 601), HEALTHY_BEGINNER).ok).toBe(false);
  });

  /**
   * H2 ma DWA warunki i oba muszą być wiązane osobno: początkujący musi wygrywać czasem
   * (inaczej gra jest nie do nauczenia) i wyraźnie rzadziej niż wprawny (inaczej
   * umiejętność nic nie znaczy). Plan pisze obie nierówności OSTRO — `> 2 %` i `< H1/2` —
   * więc dokładna wartość progu ma OBLAĆ, i to też jest wiązane.
   */
  it('1c. [PARA] H2 dolna krawędź 2 %: 2,1 % przechodzi, 2,0 % i 1,9 % oblewają', () => {
    const skilled = batch(1_000, 400);
    expect(verdict('H2', skilled, beginners(1_000, 21)).ok).toBe(true);
    expect(verdict('H2', skilled, beginners(1_000, 20)).ok, 'dokładnie próg').toBe(false);
    expect(verdict('H2', skilled, beginners(1_000, 19)).ok).toBe(false);
  });

  it('1d. [PARA] H2 sufit = połowa H1: przy H1 = 40 % przechodzi 19,9 %, oblewa 20,0 %', () => {
    const skilled = batch(1_000, 400); // H1 = 40,0 % → sufit 20,0 %
    expect(verdict('H2', skilled, beginners(1_000, 199)).ok).toBe(true);
    expect(verdict('H2', skilled, beginners(1_000, 200)).ok, 'dokładnie sufit').toBe(false);
    expect(verdict('H2', skilled, beginners(1_000, 201)).ok).toBe(false);
  });

  it('1e. [PARA] sufit H2 RUCHOMY — ta sama podłoga 19,9 % oblewa, gdy H1 spadnie', () => {
    // Bez tego sufit mógłby być stałą 20 i wszystkie pary powyżej nadal by przechodziły.
    expect(verdict('H2', batch(1_000, 390), beginners(1_000, 199)).ok).toBe(false);
  });

  it('1f. [PARA] H3 dolna krawędź 25 min: 25,1 przechodzi, 24,9 oblewa', () => {
    expect(verdict('H3', batch(1_000, 400, minuty(25.1)), HEALTHY_BEGINNER).ok).toBe(true);
    expect(verdict('H3', batch(1_000, 400, minuty(24.9)), HEALTHY_BEGINNER).ok).toBe(false);
  });

  it('1g. [PARA] H3 górna krawędź 35 min: 34,9 przechodzi, 35,1 oblewa', () => {
    expect(verdict('H3', batch(1_000, 400, minuty(34.9)), HEALTHY_BEGINNER).ok).toBe(true);
    expect(verdict('H3', batch(1_000, 400, minuty(35.1)), HEALTHY_BEGINNER).ok).toBe(false);
  });

  /**
   * **H4 mierzy politykę POCZĄTKUJĄCĄ** — bo pierwsza wersja liczyła ją na wprawnej.
   * Zobaczone dopiero w raporcie bazowym: wprawna nigdy nie ginie w cyklu 1, więc kryterium
   * raportowało 0,0 % i OK, podczas gdy początkująca ginęła tam w 10 000 na 10 000
   * przebiegów. Kryterium napisane po to, żeby złapać dokładnie tę wadę, przepuszczało ją.
   */
  it('1h. [PARA] H4 krawędź 15 %: 14,9 % przechodzi, 15,0 % i 15,1 % oblewają', () => {
    const zCyklem1 = (ile: number): RunResult[] =>
      Array.from({ length: 1_000 }, (_, i) =>
        run({ phase: 'DEFEAT', cycle: i < ile ? 1 : 5, policy: BEGINNER_POLICY_NAME }),
      );
    expect(verdict('H4', batch(1_000, 400), zCyklem1(149)).ok).toBe(true);
    expect(verdict('H4', batch(1_000, 400), zCyklem1(150)).ok, 'dokładnie próg').toBe(false);
    expect(verdict('H4', batch(1_000, 400), zCyklem1(151)).ok).toBe(false);
  });

  it('1i. [PARA] H5 krawędź: trzy otwarcia przechodzą, dwa oblewają', () => {
    const oceń = (otwarcia: number) =>
      assessHealth({
        skilled: batch(100, 40),
        beginner: HEALTHY_BEGINNER,
        winningOpenings: otwarcia,
      }).find((v) => v.id === 'H5')!;
    expect(oceń(3).ok).toBe(true);
    expect(oceń(2).ok).toBe(false);
    expect(oceń(3).measured).toBe(true);
  });

  it('1j. [PARA] H6 krawędź 10 pp: 9,9 przechodzi, 10,0 oblewa', () => {
    const oceń = (delta: number) =>
      assessHealth({
        skilled: batch(100, 40),
        beginner: HEALTHY_BEGINNER,
        maxUpgradeDeltaPp: delta,
      }).find((v) => v.id === 'H6')!;
    expect(oceń(9.9).ok).toBe(true);
    expect(oceń(10).ok, 'dokładnie próg').toBe(false);
  });
});

describe('2. [ZDROWIE] populacja jest częścią kryterium, nie argumentem wywołania', () => {
  /**
   * Commit naprawiający H4 domknął INSTANCJĘ: policzył je na `beginner`. Nie domknął
   * KLASY — tablice nadal przychodziły pozycyjnie, więc zamiana dwóch ścieżek w `--combine`
   * dawała raport, w którym **H4 zgłaszało OK**, bo liczyło wprawną, która nigdy nie ginie
   * w cyklu 1. Kontrola ma CZYTAĆ to, co sprawdza — `RunResult.policy` istnieje dokładnie
   * po to i do tej pory nie był czytany ani razu.
   */
  it('2a. ZAMIANA populacji rzuca, zamiast policzyć prawdopodobnie wyglądający raport', () => {
    const wprawna = batch(1_000, 760);
    const początkująca = beginners(1_000, 0);
    expect(() => assessHealth({ skilled: wprawna, beginner: początkująca })).not.toThrow();
    expect(() => assessHealth({ skilled: początkująca, beginner: wprawna })).toThrow(
      PopulationMismatch,
    );
  });

  it('2b. [KONTROLA] bez strażnika zamiana dawałaby H4 = OK — oto dlaczego rzuca', () => {
    // Wprawna nie ginie w cyklu 1 ani razu (wszystkie porażki mają cycle: 3), więc H4
    // policzone na niej wychodzi 0,0 % i przechodzi. To jest dokładnie ta wada.
    const wprawnaJakoPoczątkująca = batch(1_000, 760).map((r) => ({
      ...r,
      policy: BEGINNER_POLICY_NAME,
    }));
    const v = verdict('H4', batch(1_000, 760), wprawnaJakoPoczątkująca);
    expect(v.value, 'gdyby etykieta kłamała, liczba byłaby zerowa i OK').toBe(0);
    expect(v.ok).toBe(true);
  });

  it('2c. populacja NIEJEDNORODNA rzuca — jedna obca próbka wystarczy', () => {
    const zanieczyszczona = [...beginners(999, 100), run({ policy: SKILLED_POLICY_NAME })];
    expect(() => assessHealth({ skilled: batch(10, 4), beginner: zanieczyszczona })).toThrow(
      /POCZĄTKUJĄCA/,
    );
  });

  it('2d. pusta populacja NIE rzuca — „brak danych" zostaje trzecim stanem', () => {
    expect(() => assessHealth({ skilled: [], beginner: [] })).not.toThrow();
    const v = assessHealth({ skilled: [], beginner: [] });
    expect(v.every((x) => x.measured === false)).toBe(true);
  });
});

describe('3. [ZDROWIE] H4 liczy udział w RUNACH, nie wśród porażek', () => {
  /**
   * Plan uzasadnia H4 zdaniem „run kończący się przed pierwszą decyzją **nie jest runem**"
   * — to jest udział w próbach gracza, nie udział wśród przegranych. Dziś oba mianowniki
   * są równe, bo początkująca nie wygrywa ani razu, więc wada jest UŚPIONA. Obudzi się
   * w Zadaniu 3, którego jedynym celem jest sprawić, żeby zaczęła wygrywać.
   */
  it('3a. przy 400 zwycięstwach i 100 śmierciach w cyklu 1 na 1 000 runów: 10,0 %, nie 16,7 %', () => {
    const początkująca = Array.from({ length: 1_000 }, (_, i) =>
      run(
        i < 400
          ? { phase: 'VICTORY' as const, ticks: 36_000, cycle: 7, policy: BEGINNER_POLICY_NAME }
          : { phase: 'DEFEAT' as const, cycle: i < 500 ? 1 : 5, policy: BEGINNER_POLICY_NAME },
      ),
    );
    const v = verdict('H4', batch(1_000, 900), początkująca);
    expect(v.value, '100/1000, nie 100/600').toBeCloseTo(10.0, 1);
    expect(v.ok).toBe(true);
    expect(v.note).toContain('runów');
  });
});

describe('4. [ZDROWIE] kryterium BEZ DANYCH nie udaje spełnionego', () => {
  /**
   * **H5 i H6 nie dają się policzyć z jednej partii** — pierwsze potrzebuje wyników wielu
   * OTWARĆ (Zadanie 3), drugie wyników z pulą i bez niej (Zadanie 5).
   *
   * Gdyby niezmierzone kryterium raportowało `ok: false`, wyglądałoby jak wada balansu
   * i ktoś zacząłby ją „naprawiać". Gdyby raportowało `ok: true`, bramka przepuściłaby
   * fazę na dwóch kryteriach, których nikt nie sprawdził. **Trzeci stan jest jedyną
   * uczciwą odpowiedzią** — i musi być odróżnialny w raporcie.
   */
  it('4a. H5 i H6 bez danych są NIEZMIERZONE, a nie spełnione ani oblane', () => {
    for (const id of ['H5', 'H6'] as const) {
      const v = verdict(id, batch(100, 40), HEALTHY_BEGINNER);
      expect(v.measured, `${id} bez danych`).toBe(false);
      expect(v.ok, `${id} nie ma werdyktu`).toBeNull();
      expect(v.value).toBeNull();
    }
  });
});

describe('5. [ZDROWIE] liczba niesie PRZEDZIAŁ UFNOŚCI — także na krańcach', () => {
  /**
   * „85 %" bez „±2,2" obok jest tą klasą liczby, która w tym projekcie wracała: ktoś porówna
   * ją potem z 84 % i zobaczy różnicę, której nie ma.
   */
  it('5a. przedział zwęża się z pierwiastkiem próby — 4× więcej runów, 2× węższy', () => {
    const mały = verdict('H1', batch(250, 125), HEALTHY_BEGINNER).ciHalfWidth!;
    const duży = verdict('H1', batch(1_000, 500), HEALTHY_BEGINNER).ciHalfWidth!;
    expect(mały / duży).toBeCloseTo(2, 1);
  });

  it('5b. zmierzone liczby: 1 000 runów przy p = 0,5 daje ±3,1 pp', () => {
    expect(verdict('H1', batch(1_000, 500), HEALTHY_BEGINNER).ciHalfWidth!).toBeCloseTo(3.1, 1);
  });

  /**
   * **Tu leży powód przejścia na Wilsona.** Wald daje przy `p = 0` dokładnie zero —
   * NIEZALEŻNIE od `n` — więc raport bazowy wypisał „H2: 0,0 % ±0,0 (n=10000)", a to samo
   * wypisałby po ośmiu przebiegach. Zero czyta się jak pewność; przy ośmiu próbach
   * prawdziwa granica leży koło 31 %.
   */
  it('5c. [PARA] przy p = 0 przedział ZALEŻY od n: ±16 pp przy 8, ±0,02 pp przy 10 000', () => {
    expect(ciHalfWidthPp(0, 8)).toBeGreaterThan(10);
    expect(ciHalfWidthPp(0, 10_000)).toBeLessThan(0.1);
    expect(ciHalfWidthPp(0, 10_000)).toBeGreaterThan(0);
    // Połówka „ma przejść": w środku pasma Wilson zgadza się z Waldem do setnych.
    const wald = 1.96 * Math.sqrt((0.5 * 0.5) / 1_000) * 100;
    expect(ciHalfWidthPp(0.5, 1_000)).toBeCloseTo(wald, 1);
  });

  it('5d. p = 1 jest tak samo niepewne jak p = 0 — symetrycznie', () => {
    expect(ciHalfWidthPp(1, 8)).toBeCloseTo(ciHalfWidthPp(0, 8), 5);
  });

  /**
   * Mediana nie jest proporcją, ale przedział ma: rangi z dwumianu, granice z posortowanej
   * próbki. Bez tego „20,2 min" stało w jednej kolumnie z „76,0 % ±0,8" i czytało się jak
   * liczba równie dokładna.
   */
  it('5e. [PARA] H3 niesie przedział w MINUTACH i zwęża się z próbą', () => {
    const rozrzucone = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        run({
          phase: 'VICTORY',
          // 25–35 min rozłożone równomiernie — mediana w paśmie, ogon po obu stronach.
          ticks: minuty(25 + (10 * i) / n),
          cycle: 7,
          policy: SKILLED_POLICY_NAME,
        }),
      );
    const mały = verdict('H3', rozrzucone(100), HEALTHY_BEGINNER).ciHalfWidth!;
    const duży = verdict('H3', rozrzucone(400), HEALTHY_BEGINNER).ciHalfWidth!;
    expect(mały, 'przedział mediany nie jest zerem').toBeGreaterThan(0);
    expect(duży).toBeLessThan(mały);
    expect(verdict('H3', rozrzucone(400), HEALTHY_BEGINNER).note).toContain('±');
  });

  it('5f. przedział mediany oddaje ROZRZUT, nie wielkość próby samą w sobie', () => {
    // Kontrola: gdyby `medianCiHalfWidth` zwracało cokolwiek własnego zamiast czytać
    // próbkę, ta para nie odróżniłaby próbki wąskiej od szerokiej przy tym samym n.
    const wąska = Array.from({ length: 200 }, (_, i) => 1_000 + (i % 2));
    const szeroka = Array.from({ length: 200 }, (_, i) => 1_000 + i * 50);
    expect(medianCiHalfWidth(wąska)!).toBeLessThan(medianCiHalfWidth(szeroka)!);
  });

  it('5g. próbka za mała na rangi daje `null`, nie zero', () => {
    expect(medianCiHalfWidth([1, 2, 3])).toBeNull();
  });
});

describe('6. [ZDROWIE] progi mieszkają w JEDNYM miejscu, a nota je CYTUJE', () => {
  /**
   * Zadanie 3 będzie je czytać przy strojeniu. Rozsypane po sześciu funkcjach zaczęłyby się
   * rozjeżdżać z dokumentem — i to jest ta sama klasa, co liczba przepisana w dwóch plikach.
   */
  it('6a. każde kryterium ma wpis w tabeli progów', () => {
    for (const id of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] as const) {
      expect(HEALTH_THRESHOLDS[id], `próg ${id}`).toBeDefined();
    }
  });

  it('6b. nota każdego zmierzonego kryterium cytuje swój próg — raport czytelny bez kodu', () => {
    const wszystkie = assessHealth({
      skilled: batch(1_000, 850),
      beginner: beginners(1_000, 100),
      winningOpenings: 2,
      maxUpgradeDeltaPp: 12,
    });
    const nota = (id: HealthId) => wszystkie.find((v) => v.id === id)!.note;
    expect(nota('H1')).toContain('25');
    expect(nota('H1')).toContain('60');
    expect(nota('H2')).toContain(String(HEALTH_THRESHOLDS.H2.minPct));
    expect(nota('H3')).toContain('25');
    expect(nota('H3')).toContain('35');
    expect(nota('H4')).toContain('15');
    expect(nota('H5')).toContain('3');
    expect(nota('H6')).toContain('10');
  });

  it('6c. nota nazywa POLITYKĘ, bo w tej fazie każdy pomiar balansu musi ją nazwać (R2)', () => {
    const wszystkie = assessHealth({ skilled: batch(1_000, 400), beginner: HEALTHY_BEGINNER });
    const nota = (id: HealthId) => wszystkie.find((v) => v.id === id)!.note.toLowerCase();
    expect(nota('H1')).toContain('wprawnej');
    expect(nota('H3'), 'H3 liczy się wyłącznie ze zwycięstw wprawnej').toContain('wprawnej');
    expect(nota('H2')).toContain('początkującej');
    expect(nota('H4')).toContain('początkującej');
  });

  it('6d. nota mówi, CZEGO jest `n` — trzy kryteria, trzy różne mianowniki', () => {
    const wszystkie = assessHealth({ skilled: batch(1_000, 400), beginner: HEALTHY_BEGINNER });
    const nota = (id: HealthId) => wszystkie.find((v) => v.id === id)!.note;
    expect(nota('H1')).toContain('n=1000 runów');
    expect(nota('H3'), 'mianownikiem H3 są ZWYCIĘSTWA, nie runy').toContain('n=400 zwycięstw');
    expect(nota('H4')).toContain('n=1000 runów');
  });
});
