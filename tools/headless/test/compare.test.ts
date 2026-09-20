import { describe, expect, it } from 'vitest';
import { ciRoznicyPp, formatPorownanie, porownaj, type Wariant } from '../src/compare.js';
import { ciHalfWidthPp } from '../src/health.js';
import { NAZWA_ZNANEJ_LINII, SKILLED_POLICY_NAME } from '../src/skilledPolicy.js';
import type { RunResult } from '../src/run.js';

/**
 * # Porównanie wariantów (Faza 3, narzędzia balansu)
 *
 * Narzędzie odpowiada na pytanie, na które przez całe Zadanie 3 odpowiadałem OKIEM:
 * „było 59,8, jest 37,2 — to różnica czy szum?". Przy przedziałach ±6 pp dwie liczby
 * różniące się o pięć punktów są nierozróżnialne, a wyglądają na wynik.
 */

const run = (over: Partial<RunResult> = {}): RunResult => ({
  seed: 0, phase: 'DEFEAT', ticks: 1_000, cycle: 3, peakBuildings: 10, oreMined: 0,
  killsBySun: 0, killsByTurret: 0, firstDepletionTick: -1, coreDamager: null,
  policy: SKILLED_POLICY_NAME, configFingerprint: 'aaaaaaaa', opening: NAZWA_ZNANEJ_LINII, ...over,
});

/** Partia o zadanym odsetku zwycięstw, ze ZRÓŻNICOWANYMI przebiegami (żeby sita milczały). */
const partia = (n: number, wins: number): RunResult[] =>
  Array.from({ length: n }, (_, i) =>
    run({
      seed: i,
      ticks: 1_000 + i * 7,
      peakBuildings: 5 + (i % 40),
      phase: i < wins ? 'VICTORY' : 'DEFEAT',
    }),
  );

const wariant = (nazwa: string, n: number, wins: number): Wariant => ({
  nazwa,
  wyniki: partia(n, wins),
});

describe('1. [PORÓWNANIE] różnica niesie WŁASNY przedział, szerszy niż składowe', () => {
  /**
   * Sedno tego narzędzia. Przedział różnicy to `z·√(p₁(1−p₁)/n₁ + p₂(1−p₂)/n₂)` —
   * niepewności się SUMUJĄ, więc jest zawsze szerszy niż każdy ze składowych osobno.
   * Właśnie dlatego „36,8 % wobec 35,2 %" przy ±6 pp na każdym nie jest różnicą.
   */
  it('1a. przedział różnicy jest DOKŁADNIE √2 razy szerszy niż składowy, przy równych próbach', () => {
    // Porównanie do `ciHalfWidthPp`, a NIE do przepisanego wzoru Walda: obie połówki liczy
    // ta sama funkcja, więc `√(h² + h²) = h√2` dokładnie. Pierwsza wersja tego testu
    // zestawiała Wilsona z Waldem i wychodziło 1,4035 — różnica formuł, nie arytmetyki.
    const skladowy = ciHalfWidthPp(0.5, 250);
    const roznicy = ciRoznicyPp(0.5, 250, 0.5, 250);
    expect(roznicy).toBeGreaterThan(skladowy);
    expect(roznicy / skladowy).toBeCloseTo(Math.SQRT2, 6);
  });

  it('1b. [PARA] 36,8 % wobec 35,2 % przy n=250 to SZUM, a 36,8 wobec 80,4 to różnica', () => {
    const szum = porownaj([wariant('laserowe', 250, 92), wariant('kinetyczne', 250, 88)]);
    expect(szum[1].istotna, 'to jest dokładnie parytet zmierzony w Zadaniu 3').toBe(false);

    const realna = porownaj([wariant('laserowe', 250, 92), wariant('kinetyczne', 250, 201)]);
    expect(realna[1].istotna).toBe(true);
    expect(realna[1].deltaPp).toBeCloseTo(43.6, 0);
  });

  it('1c. ta sama różnica przy WIĘKSZEJ próbie staje się istotna — przedział się zwęża', () => {
    // Bez tego werdykt „szum" czytałoby się jak „te warianty są równe", a znaczy on
    // „przy TEJ próbie nie da się rozstrzygnąć".
    const male = porownaj([wariant('a', 250, 92), wariant('b', 250, 75)]);
    const duze = porownaj([wariant('a', 4_000, 1_472), wariant('b', 4_000, 1_200)]);
    expect(male[1].istotna).toBe(false);
    expect(duze[1].istotna, 'ten sam odsetek, cztery razy większa próba').toBe(true);
  });
});

describe('2. [PORÓWNANIE] pierwszy wariant jest ODNIESIENIEM', () => {
  it('2a. odniesienie nie ma różnicy ani werdyktu — nie porównuje się z samym sobą', () => {
    const r = porownaj([wariant('przed', 250, 92), wariant('po', 250, 150)]);
    expect(r[0].deltaPp).toBe(0);
    expect(r[0].ciPp).toBeNull();
    expect(r[0].istotna).toBeNull();
  });

  it('2b. znak różnicy mówi KIERUNEK — pogorszenie jest ujemne', () => {
    const r = porownaj([wariant('przed', 250, 150), wariant('po', 250, 92)]);
    expect(r[1].deltaPp).toBeLessThan(0);
  });

  it('2c. pusta lista nie wywraca narzędzia', () => {
    expect(porownaj([])).toEqual([]);
  });
});

describe('3. [PORÓWNANIE] diagnozy przyrządu NAD tabelą', () => {
  /**
   * Wariant zakleszczony ma zostać rozpoznany, ZANIM ktoś przeczyta jego zero jako wynik.
   * W Zadaniu 3 dokładnie takie zero trafiło do trzech wniosków.
   */
  it('3a. zakleszczony wariant jest zgłoszony w PIERWSZEJ linii, z nazwą', () => {
    const zakleszczony: Wariant = {
      nazwa: 'kinetyczne',
      wyniki: Array.from({ length: 250 }, (_, i) => run({ seed: i, ticks: 800 + i, peakBuildings: 6 })),
    };
    const pierwsza = formatPorownanie([wariant('laserowe', 250, 92), zakleszczony]).split('\n')[0];
    expect(pierwsza).toContain('ZAKLESZCZENIE');
    expect(pierwsza, 'bez nazwy nie wiadomo, KTÓRY wariant poprawić').toContain('kinetyczne');
  });

  it('3b. [PARA] zdrowe warianty nie dają w tabeli ANI SŁOWA o przyrządzie', () => {
    expect(formatPorownanie([wariant('a', 250, 92), wariant('b', 250, 100)]))
      .not.toContain('PRZYRZĄD');
  });

  it('3c. tabela nazywa werdykt słowami, nie samą liczbą', () => {
    const t = formatPorownanie([wariant('przed', 250, 92), wariant('po', 250, 201)]);
    expect(t).toContain('ISTOTNA');
    const s = formatPorownanie([wariant('przed', 250, 92), wariant('po', 250, 88)]);
    expect(s).toContain('w granicach szumu');
  });
});

describe('4. [PORÓWNANIE] przedział NIE ZAPADA SIĘ przy zerowym odsetku', () => {
  /**
   * Pierwsza wersja `ciRoznicyPp` brała wzór Walda wprost i przy `p₁ = p₂ = 0` dawała
   * **±0,0 pp** — „te dwa zera różnią się z pewnością o zero". Zobaczyłem to na pierwszym
   * prawdziwym porównaniu: dwie partie polityki początkującej, obie z zerem zwycięstw.
   *
   * To ta sama zapaść, którą `health.ts` naprawił tydzień wcześniej przejściem na Wilsona.
   * Powtórzyłem ją, bo przepisałem wzór zamiast użyć gotowej funkcji — stąd ten test
   * stoi tutaj, a nie tam.
   */
  it('4a. [PARA] przy p = 0 w obu partiach przedział jest DODATNI i zależy od n', () => {
    const male = ciRoznicyPp(0, 20, 0, 20);
    const duze = ciRoznicyPp(0, 10_000, 0, 10_000);
    expect(male, 'zero przy n=20 nie znaczy „z pewnością zero"').toBeGreaterThan(1);
    expect(duze).toBeGreaterThan(0);
    expect(duze).toBeLessThan(male);
  });

  it('4b. dwie partie z zerem zwycięstw dają werdykt „w granicach szumu", nie fałszywą pewność', () => {
    const zero = (n: number): Wariant => ({ nazwa: `n${n}`, wyniki: partia(n, 0) });
    const r = porownaj([zero(1_000), zero(1_000)]);
    expect(r[1].ciPp!).toBeGreaterThan(0);
    expect(r[1].istotna).toBe(false);
  });

  it('4c. w środku pasma Wilson zgadza się z Waldem — naprawa nie przesunęła zwykłych liczb', () => {
    const wald = 1.96 * Math.sqrt((0.25 / 1_000) * 2) * 100;
    expect(ciRoznicyPp(0.5, 1_000, 0.5, 1_000)).toBeCloseTo(wald, 1);
  });
});
