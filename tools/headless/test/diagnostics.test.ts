import { describe, expect, it } from 'vitest';
import { diagnozuj } from '../src/diagnostics.js';
import { formatReport } from '../src/report.js';
import { NAZWA_ZNANEJ_LINII, SKILLED_POLICY_NAME } from '../src/skilledPolicy.js';
import type { RunResult } from '../src/run.js';

/**
 * # Sita przyrządu (Faza 3, narzędzia balansu)
 *
 * Każde z nich powstało z pomyłki, którą naprawdę popełniłem w Zadaniu 3, i każde ma tu
 * **parę**: partię, która MA je uruchomić, i partię zdrową, która NIE MA. Sito krzyczące
 * zawsze jest tak samo bezużyteczne jak sito, które nie krzyczy nigdy — tyle że drugie
 * przepuszcza wynik, a pierwsze każe go wyrzucić.
 */

const run = (over: Partial<RunResult> = {}): RunResult => ({
  seed: 0, phase: 'DEFEAT', ticks: 1_000, cycle: 3, peakBuildings: 10, oreMined: 0,
  killsBySun: 0, killsByTurret: 0, firstDepletionTick: -1, coreDamager: null,
  policy: SKILLED_POLICY_NAME, configFingerprint: 'aaaaaaaa', opening: NAZWA_ZNANEJ_LINII, ...over,
});

/** Partia zdrowa: przebiegi się RÓŻNIĄ, zabudowa jest rozrzucona, część wygrywa. */
const zdrowa = (n = 250): RunResult[] =>
  Array.from({ length: n }, (_, i) =>
    run({
      seed: i,
      ticks: 1_000 + i * 7,
      peakBuildings: 5 + (i % 40),
      phase: i % 3 === 0 ? 'VICTORY' : 'DEFEAT',
    }),
  );

const kody = (r: readonly RunResult[]) => diagnozuj(r).map((d) => d.kod);

describe('1. [SITO] zakleszczenie odróżnia się od przegranej', () => {
  /**
   * Zmierzone w Zadaniu 3: trzy warianty otwarcia raportowały `0,0 %` i wyglądało to
   * na wynik o grze. W rzeczywistości polityka stawała na szóstym budynku na KAŻDEJ
   * planecie, bo nie stać jej było na kolejną pozycję, a przeskoczyć jej nie umie.
   */
  it('1a. [PARA] stały szczyt zabudowy + zero zwycięstw = ZAKLESZCZENIE', () => {
    const zakleszczona = Array.from({ length: 250 }, (_, i) =>
      run({ seed: i, ticks: 800 + i, peakBuildings: 6 }),
    );
    expect(kody(zakleszczona)).toContain('ZAKLESZCZENIE');
    expect(kody(zdrowa()), 'zdrowa partia NIE MA być zgłaszana').toEqual([]);
  });

  it('1b. sam stały szczyt NIE wystarczy — kolejka, którą zawsze da się dokończyć, jest OK', () => {
    // 48 budynków na każdej planecie i większość runów wygrana: to jest kolejka wykonana
    // do końca, czyli dokładnie to, co ma robić dobre otwarcie. Bez tego członu sito
    // zgłaszałoby najlepszy wariant jako zepsuty.
    const dokonczona = Array.from({ length: 250 }, (_, i) =>
      run({ seed: i, ticks: 30_000 + i, peakBuildings: 48, phase: 'VICTORY' }),
    );
    expect(kody(dokonczona)).not.toContain('ZAKLESZCZENIE');
  });

  it('1c. samo zero zwycięstw NIE wystarczy — przegrana z rozrzutem to prawdziwy wynik', () => {
    const przegrana = Array.from({ length: 250 }, (_, i) =>
      run({ seed: i, ticks: 900 + i * 3, peakBuildings: 5 + (i % 30) }),
    );
    expect(kody(przegrana)).not.toContain('ZAKLESZCZENIE');
  });
});

describe('2. [SITO] partia, do której nie dociera seed', () => {
  /**
   * Tak wygląda zepsuty szew procesowy: identyczne przebiegi, doskonale spójne rozkłady
   * i zero informacji. W Zadaniu 2 pilnował tego osobny test forka; to sito łapie skutek
   * także tam, gdzie nikt takiego testu nie napisał.
   */
  it('2a. [PARA] wszystkie przebiegi identyczne = BRAK_ZROZNICOWANIA', () => {
    const skopiowana = Array.from({ length: 250 }, (_, i) => run({ seed: i }));
    expect(kody(skopiowana)).toContain('BRAK_ZROZNICOWANIA');
    expect(kody(zdrowa())).not.toContain('BRAK_ZROZNICOWANIA');
  });

  it('2b. wystarczy JEDEN różny przebieg, żeby sito zamilkło — to sito na kopię, nie na podobieństwo', () => {
    const prawieIdentyczna = Array.from({ length: 250 }, (_, i) =>
      run({ seed: i, ticks: i === 0 ? 1_001 : 1_000 }),
    );
    expect(kody(prawieIdentyczna)).not.toContain('BRAK_ZROZNICOWANIA');
  });
});

describe('3. [SITO] małe partie nie są diagnozowane', () => {
  it('3a. przy garstce przebiegów p10 i p90 to ta sama próbka — milczymy', () => {
    const garstka = Array.from({ length: 5 }, (_, i) => run({ seed: i, peakBuildings: 6 }));
    expect(kody(garstka)).toEqual([]);
  });
});

describe('4. [SITO] diagnoza trafia do RAPORTU, i to na samą górę', () => {
  /**
   * Sito, którego nie widać w raporcie, nie działa — dokładnie tak jak w Zadaniu 3,
   * gdzie informacja była w rozkładzie, ale trzeba było na nią popatrzeć.
   */
  it('4a. zakleszczona partia niesie ostrzeżenie w PIERWSZEJ linii', () => {
    const zakleszczona = Array.from({ length: 250 }, (_, i) =>
      run({ seed: i, ticks: 800 + i, peakBuildings: 6 }),
    );
    const pierwsza = formatReport(zakleszczona).split('\n')[0];
    expect(pierwsza).toContain('PRZYRZĄD');
    expect(pierwsza).toContain('ZAKLESZCZENIE');
  });

  it('4b. [PARA] zdrowa partia nie ma w raporcie ANI SŁOWA o przyrządzie', () => {
    expect(formatReport(zdrowa())).not.toContain('PRZYRZĄD');
  });
});

describe('5. [SITO] otwarcie jedzie przy KAŻDYM wyniku, nie tylko w nagłówku', () => {
  /**
   * Bramka gałęzi Fazy 3, znalezisko #1. Otwarcie było zapisane wyłącznie w nagłówku
   * raportu TEKSTOWEGO, a `--combine` czyta `.json`, do którego nagłówek nie trafia.
   * `configFingerprint` tego nie łapie i **słusznie** — otwarcie jest własnością polityki,
   * nie nastawy — więc partia policzona inną linią wchodziła do „raportu bazowego"
   * bez jednego ostrzeżenia. Pokazane uruchomieniem: H1 i H3 policzone na otwarciu
   * ekonomicznym, zero wystąpień słowa „ekonomiczne" w wynikowym dokumencie.
   */
  it('5a. [PARA] partia z DWÓCH otwarć jest zgłaszana, z jednego — nie', () => {
    const jedno = Array.from({ length: 30 }, (_, i) => run({ seed: i, ticks: 1_000 + i }));
    expect(formatReport(jedno)).not.toContain('MIESZA');

    const dwa = jedno.map((r, i) => (i % 2 === 0 ? { ...r, opening: 'kinetyczne' } : r));
    const raport = formatReport(dwa);
    expect(raport).toContain('MIESZA');
    expect(raport, 'ostrzeżenie ma NAZWAĆ otwarcia, inaczej nie wiadomo, co rozdzielić')
      .toContain('kinetyczne');
  });

  it('5b. ostrzeżenie o otwarciach stoi NAD liczbami, tak jak pozostałe', () => {
    const dwa = Array.from({ length: 30 }, (_, i) =>
      run({ seed: i, ticks: 1_000 + i, opening: i % 2 === 0 ? 'kinetyczne' : 'mur najpierw' }),
    );
    const linie = formatReport(dwa).split('\n');
    const ostrzezenie = linie.findIndex((l) => l.includes('MIESZA'));
    const liczby = linie.findIndex((l) => l.includes('runów:'));
    expect(ostrzezenie).toBeGreaterThanOrEqual(0);
    expect(ostrzezenie, 'ostrzeżenie pod liczbami jest ostrzeżeniem po fakcie').toBeLessThan(liczby);
  });
});
