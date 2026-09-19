import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN } from '@heliopolis/sim';
import { MAX_TICKS, mergeBatches, runBatch, splitRange } from '../src/batch.js';
import { BeginnerPolicy } from '../src/policy.js';
import { configFingerprint, type RunResult } from '../src/run.js';
import { AXES } from '../src/sweep.js';

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

describe('3. [SZEW] partia RÓWNOLEGŁA daje to samo, co sekwencyjna', () => {
  /**
   * ## Dlaczego ten opis jest dłuższy niż test
   *
   * Testy 1a–1c sprawdzają `splitRange` + `mergeBatches` — **w jednym procesie**. To jest
   * asercja o arytmetyce podziału, nie o zrównolegleniu. Produkcyjną ścieżką każdego
   * pomiaru balansu w tej fazie jest `batchCli.js` z `fork`, a ta dokłada szwy, których
   * arytmetyka nie widzi: round-trip `RunResult` przez JSON, przekazanie `--policy`
   * do dziecka, ponowny import `DEFAULT_RUN` i `MAX_TICKS` po stronie potomka, parsowanie
   * `--slice`, kompletność zbioru seedów.
   *
   * Raport bazowy na 20 000 przebiegów powstał **wyłącznie tą ścieżką**, a jedyne, co ją
   * strzegło, to przekonanie, że musi działać. CLAUDE.md §4 nazywa dokładnie ten układ:
   * gdyby dziecko dostało inną politykę albo inny sufit ticków, partia wróciłaby jako
   * prawdopodobnie wyglądające liczby, a wszystkie testy zostałyby zielone.
   *
   * Test chodzi po `dist/`, nie po źródłach — bo `fork` uruchamia plik, a nie moduł.
   * `pretest` buduje `dist` przed przebiegiem, więc plik istnieje.
   */
  const CLI = fileURLToPath(new URL('../dist/batchCli.js', import.meta.url));
  const RUNS = 8;

  it('3a. 2 procesy na 8 seedach = jeden proces na 8 seedach, run po runie', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heliopolis-partia-'));
    try {
      execFileSync(process.execPath, [
        CLI, '--runs', String(RUNS), '--policy', 'beginner',
        '--workers', '2', '--out', join(dir, 'raport.txt'),
      ], { stdio: 'pipe' });
      const rownolegle = JSON.parse(
        readFileSync(join(dir, 'raport.txt.json'), 'utf8'),
      ) as ReturnType<typeof runBatch>;

      const sekwencyjnie = runBatch(
        { from: 0, to: RUNS },
        DEFAULT_RUN,
        MAX_TICKS,
        (sim) => new BeginnerPolicy(sim),
      );

      // Kontrola na fiksturę: gdyby wszystkie przebiegi były identyczne, porównanie
      // przepuściłoby też losowy podział. Patrz CLAUDE.md §2.
      expect(new Set(sekwencyjnie.map((r) => `${r.ticks}:${r.seed}`)).size).toBe(RUNS);
      expect(rownolegle).toEqual(sekwencyjnie);
      expect(rownolegle.map((r) => r.seed)).toEqual([...Array(RUNS).keys()]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('3b. dziecko z zepsutym --slice UMIERA, zamiast oddać pusty kawałek', () => {
    // Zmierzone przed naprawą: `--slice abc:def` dawało `NaN`, pętla nie wykonywała się
    // ani razu, dziecko zapisywało `[]` i wychodziło z kodem 0. Rodzic przyjmował to
    // bez słowa — i partia na 10 000 runów wracała jako 8 750 z rzetelnym przedziałem
    // ufności policzonym dla złego `n`.
    const dir = mkdtempSync(join(tmpdir(), 'heliopolis-slice-'));
    try {
      expect(() =>
        execFileSync(process.execPath, [
          CLI, '--slice', 'abc:def', '--policy', 'beginner', '--out', join(dir, 'k.json'),
        ], { stdio: 'pipe' }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  /**
   * Oś przemiatania musi przejść przez granicę procesu — inaczej KAŻDY punkt tabeli
   * liczyłby się na `DEFAULT_RUN`, wszystkie wyszłyby takie same, a tabela wyglądałaby
   * całkowicie wiarygodnie. To jest ta sama klasa, co szew polityki: wynik prawdopodobny
   * zamiast błędu (CLAUDE.md §4).
   *
   * Asercja jest na `configFingerprint`, bo to JEDYNA rzecz w wyniku, która mówi, na jakiej
   * nastawie run powstał — i jest liczona po stronie dziecka, z konfiguracji, której
   * dziecko naprawdę użyło.
   */
  it('3c. --axis dociera do procesów POTOMNYCH, nie tylko do rodzica', () => {
    const dir = mkdtempSync(join(tmpdir(), 'heliopolis-os-'));
    try {
      const odciskPartii = (args: string[]) => {
        execFileSync(process.execPath, [
          CLI, '--runs', '4', '--policy', 'beginner', '--workers', '2',
          '--out', join(dir, 'r.txt'), ...args,
        ], { stdio: 'pipe' });
        const wyniki = JSON.parse(readFileSync(join(dir, 'r.txt.json'), 'utf8')) as RunResult[];
        const odciski = new Set(wyniki.map((r) => r.configFingerprint));
        expect(odciski.size, 'partia ma być jednorodna').toBe(1);
        return [...odciski][0];
      };

      const bezOsi = odciskPartii([]);
      const zOsia = odciskPartii(['--axis', 'killRewardScale', '--value', '0.25']);

      expect(zOsia, 'oś przechodząca przez fork MUSI zmienić odcisk').not.toBe(bezOsi);
      // Sedno: odcisk dziecka zgadza się z konfiguracją nałożoną W TYM procesie. Sama
      // różnica nie wystarczy — dziecko mogłoby nałożyć oś inną wartością.
      expect(zOsia).toBe(configFingerprint(AXES.killRewardScale.apply(DEFAULT_RUN, 0.25)));
      expect(bezOsi).toBe(configFingerprint(DEFAULT_RUN));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
