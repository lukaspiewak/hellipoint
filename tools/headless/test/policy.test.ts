import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN } from '@heliopolis/sim';
import { simulateRun, type RunResult } from '../src/run.js';
import { formatReport } from '../src/report.js';
import { BeginnerPolicy } from '../src/policy.js';
import { SkilledPolicy } from '../src/skilledPolicy.js';

/**
 * # Dwie polityki, każda na inne pytanie (Faza 3, Zadanie 1)
 *
 * `BeginnerPolicy` odpowiada „czy początkujący ma szansę?", `SkilledPolicy` — „gdzie jest
 * sufit?". Mieszanie ich to dokładnie ta wada, która unieważniła tabelę ekstraktorów
 * w §11.1 specu: progi bezwzględne zmierzone na słabej polityce **nie są wiążące**.
 *
 * Ten plik jest PRZYRZĄDEM całej Fazy 3. Każdy pomiar balansu zrobiony zanim on przejdzie
 * mierzy bota, nie grę.
 */

/** [STROJENIE w teście] ~1,65× zmierzonej długości zwycięskiego przebiegu (24 133 ticki). */
const WIN_CAP = 40_000;

/**
 * Limity czasu WYPROWADZONE Z POMIARU POD OBCIĄŻENIEM, nie z bezczynnej maszyny.
 *
 * Zmierzone bezczynnie (`tools/headless/dist`, pięć seedów): pojedynczy przebieg polityki
 * wprawnej bierze **3,3–6,4 s** — bo to 19–32 tysiące ticków z setkami żywych jednostek.
 * Domyślne 5 s vitesta nie starcza i **oblewało dwa z czterech testów tego pliku**.
 *
 * Współczynnik obciążeniowy zmierzony w Fazie 2C (20 procesów na 10 rdzeniach): **3,2×**.
 * Definicja ukończenia wymaga sześciu przebiegów pakietu pod obciążeniem, więc limit liczony
 * z bezczynnego pomiaru wpisywałby do pakietu test, który oblewa dokładnie wtedy, gdy ma być
 * sprawdzany. To ta sama wada, którą naprawiono w `headless.test.ts` dzień wcześniej.
 *
 * Stąd: najgorszy przebieg 6,4 s × liczba przebiegów × 3,2 × zapas 2.
 */
const ONE_RUN_MS = 60_000; // 1 przebieg: 6,4 × 3,2 × 2 ≈ 41 s, zaokrąglone w górę
const FIVE_RUNS_MS = 240_000; // 5 przebiegów: 32 × 3,2 × 2 ≈ 205 s, zaokrąglone w górę

describe('1. [PRZYRZĄD] dwie polityki dają RÓŻNE wyniki na tym samym seedzie', () => {
  it('1a. SkilledPolicy wygrywa na seedzie 33, BeginnerPolicy na tym samym ginie w cyklu 1', () => {
    const skilled = simulateRun(33, DEFAULT_RUN, WIN_CAP, (sim) => new SkilledPolicy(sim));
    const beginner = simulateRun(33, DEFAULT_RUN, WIN_CAP, (sim) => new BeginnerPolicy(sim));

    expect(skilled.phase).toBe('VICTORY');
    expect(beginner.phase).toBe('DEFEAT');
    expect(beginner.cycle).toBe(1);
  }, ONE_RUN_MS);

  /**
   * Bot wygrywający wyłącznie na seedzie 33 jest **przepisaną odpowiedzią, nie polityką** —
   * `WINNING_OPENING` powstało przez przemiatanie właśnie na tym seedzie.
   *
   * Próg `>= 2` z pięciu jest NISKI CELOWO: przy dzisiejszym balansie (0 zwycięstw na 1000
   * runów bota początkującego) nie wiadomo, ile seedów w ogóle jest wygrywalnych. Ten test
   * pilnuje jednej rzeczy — że to nie jest odpowiedź na jeden seed. **Zadanie 3 ma podnieść
   * ten próg** i zapisać go razem ze zmierzonym odsetkiem.
   *
   * ZMIERZONE dziś na tych pięciu seedach: wygrywają **33 i 303** (tick 24 340 i 24 920,
   * oba w cyklu 7), przegrywają 101 (cykl 6), 202 i 404 (oba cykl 9). Czyli 2 z 5 — próg
   * jest spełniony **dokładnie na styk**, i to też jest informacja: przy dzisiejszym
   * balansie nawet najlepsza znana linia przegrywa większość seedów.
   */
  it('1b. SkilledPolicy wygrywa na WIĘCEJ NIŻ JEDNYM seedzie', () => {
    const seeds = [33, 101, 202, 303, 404];
    const wins = seeds.filter(
      (seed) =>
        simulateRun(seed, DEFAULT_RUN, WIN_CAP, (sim) => new SkilledPolicy(sim)).phase ===
        'VICTORY',
    );
    // eslint-disable-next-line no-console
    console.log(`[PRZYRZĄD] SkilledPolicy wygrywa na ${wins.length} z ${seeds.length}: ${wins}`);
    expect(wins.length, `wygrane seedy: ${wins}`).toBeGreaterThanOrEqual(2);
  }, FIVE_RUNS_MS);

  /**
   * Fabryka jest OPCJONALNA i domyślnie daje politykę początkującą — bez tego wszystkie
   * dotychczasowe pomiary (raport z 1000 runów, `pnpm bench`) zmieniłyby po cichu znaczenie.
   */
  it('1c. domyślna polityka to dalej POCZĄTKUJĄCA — stare pomiary nie zmieniają znaczenia', () => {
    const domyslna = simulateRun(33, DEFAULT_RUN, WIN_CAP);
    const jawna = simulateRun(33, DEFAULT_RUN, WIN_CAP, (sim) => new BeginnerPolicy(sim));
    expect(domyslna.policy).toBe('beginner');
    expect(domyslna.ticks).toBe(jawna.ticks);
    expect(domyslna.phase).toBe(jawna.phase);
  }, ONE_RUN_MS);

  /**
   * Nazwa polityki w KAŻDYM wyniku, nie tylko w nagłówku raportu. Dwie liczby z dwóch
   * polityk wyglądają identycznie; bez nazwy przy wierszu nie da się ich potem rozdzielić.
   */
  it('1d. wynik niesie nazwę polityki, na której powstał', () => {
    expect(simulateRun(33, DEFAULT_RUN, WIN_CAP, (sim) => new SkilledPolicy(sim)).policy).toBe(
      'skilled',
    );
  }, ONE_RUN_MS);
});

describe('2. [RAPORT] partia nazywa politykę, a mieszana krzyczy', () => {
  const runFor = (policy: string): RunResult =>
    ({ ...simulateRun(1, DEFAULT_RUN, 2_000), policy }) as RunResult;

  it('2a. raport z jednej polityki podaje jej nazwę', () => {
    expect(formatReport([runFor('beginner'), runFor('beginner')])).toContain('polityka: beginner');
  });

  /**
   * **To jest cały powód, dla którego `policy` siedzi w `RunResult`.** Partia złożona
   * z dwóch polityk nie opisuje żadnej z nich, a wygląda dokładnie jak poprawna: dwie
   * liczby z dwóch botów są nierozróżnialne. §11.1 ma gotowy koszt tej pomyłki.
   */
  it('2b. [PARA] partia z dwóch polityk krzyczy, z jednej — nie', () => {
    const mieszana = formatReport([runFor('beginner'), runFor('skilled')]);
    expect(mieszana).toContain('MIESZA');
    expect(mieszana).toContain('beginner');
    expect(mieszana).toContain('skilled');

    expect(formatReport([runFor('skilled'), runFor('skilled')])).not.toContain('MIESZA');
  });
});
