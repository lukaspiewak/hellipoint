import { TICK_SECONDS } from '@heliopolis/sim';
import type { RunResult } from './run.js';

/**
 * # Sześć liczb zdrowia (Faza 3, Zadanie 2)
 *
 * Kamień milowy §9 specu brzmi „rozkłady z 10 000 runów są zdrowe". **To nie jest kryterium,
 * dopóki nie ma progów** — rozstrzygnięcie R1 planu nadaje im sześć liczb, a ten moduł
 * zamienia je w kod, żeby werdykt liczyła maszyna, a nie oko patrzące na histogram.
 *
 * ## Trzy stany, nie dwa
 *
 * `ok: null` przy `measured: false` jest tu **odpowiedzią, nie brakiem odpowiedzi**. H5 i H6
 * nie dają się policzyć z jednej partii — pierwsze potrzebuje wyników wielu OTWARĆ
 * (Zadanie 3), drugie wyników z pulą i bez niej (Zadanie 5). Gdyby niezmierzone kryterium
 * raportowało `false`, wyglądałoby jak wada balansu i ktoś zacząłby ją „naprawiać"; gdyby
 * `true` — bramka przepuściłaby fazę na dwóch kryteriach, których nikt nie sprawdził.
 *
 * ## Przedział ufności przy każdej liczbie
 *
 * „85 %" bez „±2,2" obok jest dokładnie tą klasą liczby, która w tym projekcie wracała:
 * ktoś porówna ją potem z 84 % i zobaczy różnicę, której nie ma. Półszerokość liczona
 * z rozkładu dwumianowego.
 */

export type HealthId = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6';

/**
 * Progi — **w JEDNYM miejscu**, bo Zadanie 3 będzie je czytać przy strojeniu. Rozsypane po
 * sześciu funkcjach zaczęłyby się rozjeżdżać z dokumentem planu; to ta sama klasa wady,
 * co liczba przepisana w dwóch plikach.
 *
 * Wszystkie pochodzą z tabeli R1 planu. **H1 zatwierdzone przez właściciela projektu.**
 */
export const HEALTH_THRESHOLDS = {
  /** Odsetek zwycięstw polityki WPRAWNEJ. Ani „przechodzi się samo", ani „nie da się". */
  H1: { minPct: 25, maxPct: 60 },
  /**
   * Odsetek zwycięstw polityki POCZĄTKUJĄCEJ: dodatni (gra do nauczenia) i wyraźnie niższy
   * od H1 (umiejętność ma znaczenie). DWA warunki, wiązane osobno.
   */
  H2: { minPct: 2, maxShareOfH1: 0.5 },
  /** Mediana długości runu WYGRANEGO, w minutach. Wprost z filaru D4. */
  H3: { minMinutes: 25, maxMinutes: 35 },
  /** Odsetek porażek w cyklu 1 — run kończący się przed pierwszą decyzją nie jest runem. */
  H4: { maxPct: 15 },
  /** Ile RÓŻNYCH otwarć wygrywa ≥ 20 % seedów. Celuje w główną wadę zmierzoną w §11.1. */
  H5: { minOpenings: 3 },
  /** Zmiana H1 po USUNIĘCIU ulepszenia z puli. Powyżej — to nie wybór, tylko podatek. */
  H6: { maxDeltaPp: 10 },
} as const;

export interface HealthVerdict {
  readonly id: HealthId;
  /** Czy partia w ogóle niosła dane potrzebne do policzenia tego kryterium. */
  readonly measured: boolean;
  /** Zmierzona wartość w jednostce kryterium (procenty, minuty, sztuki). `null` gdy brak danych. */
  readonly value: number | null;
  /** `null` znaczy „nie zmierzone", nie „nie wiadomo" — patrz doc-comment modułu. */
  readonly ok: boolean | null;
  /** Półszerokość 95 % przedziału ufności w punktach proc.; `null` dla kryteriów nie-proporcji. */
  readonly ciHalfWidthPp: number | null;
  /** Zdanie dla człowieka: co zmierzono i wobec jakiego progu. Raport ma być czytelny bez kodu. */
  readonly note: string;
}

export interface HealthInput {
  readonly skilled: readonly RunResult[];
  readonly beginner: readonly RunResult[];
  /** Liczba różnych otwarć wygrywających ≥ 20 % seedów — wchodzi z Zadania 3. */
  readonly winningOpenings?: number;
  /** Największa zmiana H1 po usunięciu pojedynczego ulepszenia — wchodzi z Zadania 5. */
  readonly maxUpgradeDeltaPp?: number;
}

const wins = (runs: readonly RunResult[]): number =>
  runs.filter((r) => r.phase === 'VICTORY').length;

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : (100 * part) / whole);

/**
 * Półszerokość 95 % przedziału ufności dla proporcji, w punktach procentowych.
 *
 * Przybliżenie normalne (Walda) — wystarczające przy próbach rzędu setek i tysięcy, których
 * ta faza używa. **Granica, którą trzeba znać:** przy `p` blisko 0 albo 1 i małym `n` Wald
 * zaniża przedział; przy n = 1 000 i p = 0,85 (dzisiejszy pomiar) błąd tego przybliżenia
 * jest rzędu dziesiątych punktu, czyli nieistotny wobec 35-punktowego pasma H1.
 */
export function ciHalfWidthPp(p: number, n: number): number {
  if (n === 0) return 0;
  return 1.96 * Math.sqrt((p * (1 - p)) / n) * 100;
}

function unmeasured(id: HealthId, why: string): HealthVerdict {
  return { id, measured: false, value: null, ok: null, ciHalfWidthPp: null, note: why };
}

/** Mediana — na kopii, bo `sort` mutuje, a wejście jest cudze. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function assessHealth(input: HealthInput): HealthVerdict[] {
  const { skilled, beginner, winningOpenings, maxUpgradeDeltaPp } = input;
  const t = HEALTH_THRESHOLDS;

  // --- H1: sufit ---------------------------------------------------------------------
  let h1: HealthVerdict;
  let h1Pct = 0;
  if (skilled.length === 0) {
    h1 = unmeasured('H1', 'brak przebiegów polityki wprawnej');
  } else {
    h1Pct = pct(wins(skilled), skilled.length);
    const ci = ciHalfWidthPp(h1Pct / 100, skilled.length);
    h1 = {
      id: 'H1',
      measured: true,
      value: h1Pct,
      ok: h1Pct >= t.H1.minPct && h1Pct <= t.H1.maxPct,
      ciHalfWidthPp: ci,
      note:
        `zwycięstw polityki wprawnej: ${h1Pct.toFixed(1)}% ±${ci.toFixed(1)} ` +
        `(n=${skilled.length}), próg ${t.H1.minPct}–${t.H1.maxPct}%`,
    };
  }

  // --- H2: czy początkujący ma szansę, i czy umiejętność coś znaczy ----------------
  let h2: HealthVerdict;
  if (beginner.length === 0) {
    h2 = unmeasured('H2', 'brak przebiegów polityki początkującej');
  } else if (!h1.measured) {
    h2 = unmeasured('H2', 'H2 odnosi się do H1, a H1 nie zostało zmierzone');
  } else {
    const h2Pct = pct(wins(beginner), beginner.length);
    const ci = ciHalfWidthPp(h2Pct / 100, beginner.length);
    const ceiling = h1Pct * t.H2.maxShareOfH1;
    h2 = {
      id: 'H2',
      measured: true,
      value: h2Pct,
      // DWA warunki, oba wiązane: gra do nauczenia ORAZ umiejętność ma znaczenie.
      ok: h2Pct >= t.H2.minPct && h2Pct <= ceiling,
      ciHalfWidthPp: ci,
      note:
        `zwycięstw polityki początkującej: ${h2Pct.toFixed(1)}% ±${ci.toFixed(1)} ` +
        `(n=${beginner.length}), próg ≥${t.H2.minPct}% i ≤${ceiling.toFixed(1)}% ` +
        `(połowa H1 = ${h1Pct.toFixed(1)}%)`,
    };
  }

  // --- H3: czy run trwa tyle, ile obiecuje D4 --------------------------------------
  const won = skilled.filter((r) => r.phase === 'VICTORY');
  const h3: HealthVerdict =
    won.length === 0
      ? unmeasured('H3', 'żaden przebieg polityki wprawnej nie zakończył się zwycięstwem')
      : (() => {
          const minutes = (median(won.map((r) => r.ticks)) * TICK_SECONDS) / 60;
          return {
            id: 'H3' as const,
            measured: true,
            value: minutes,
            ok: minutes >= t.H3.minMinutes && minutes <= t.H3.maxMinutes,
            // Mediana nie jest proporcją — przedział dwumianowy nie ma tu sensu i dlatego
            // jest `null`, a nie zero. Zero czytałoby się jako „zmierzone z pewnością".
            ciHalfWidthPp: null,
            note:
              `mediana runu wygranego: ${minutes.toFixed(1)} min (n=${won.length}), ` +
              `próg ${t.H3.minMinutes}–${t.H3.maxMinutes} min`,
          };
        })();

  // --- H4: czy run w ogóle się zaczyna ---------------------------------------------
  const defeats = skilled.filter((r) => r.phase === 'DEFEAT');
  const h4: HealthVerdict =
    defeats.length === 0
      ? unmeasured('H4', 'żaden przebieg polityki wprawnej nie zakończył się porażką')
      : (() => {
          const share = pct(defeats.filter((r) => r.cycle === 1).length, defeats.length);
          const ci = ciHalfWidthPp(share / 100, defeats.length);
          return {
            id: 'H4' as const,
            measured: true,
            value: share,
            ok: share <= t.H4.maxPct,
            ciHalfWidthPp: ci,
            note:
              `porażek w cyklu 1: ${share.toFixed(1)}% ±${ci.toFixed(1)} ` +
              `(n=${defeats.length} porażek), próg <${t.H4.maxPct}%`,
          };
        })();

  // --- H5 i H6: wchodzą z Zadań 3 i 5 ------------------------------------------------
  const h5: HealthVerdict =
    winningOpenings === undefined
      ? unmeasured('H5', 'wymaga wyników wielu OTWARĆ — Zadanie 3')
      : {
          id: 'H5',
          measured: true,
          value: winningOpenings,
          ok: winningOpenings >= t.H5.minOpenings,
          ciHalfWidthPp: null,
          note: `otwarć wygrywających ≥20% seedów: ${winningOpenings}, próg ≥${t.H5.minOpenings}`,
        };

  const h6: HealthVerdict =
    maxUpgradeDeltaPp === undefined
      ? unmeasured('H6', 'wymaga wyników z pulą i bez niej — Zadanie 5')
      : {
          id: 'H6',
          measured: true,
          value: maxUpgradeDeltaPp,
          ok: maxUpgradeDeltaPp < t.H6.maxDeltaPp,
          ciHalfWidthPp: null,
          note:
            `największa zmiana H1 po usunięciu ulepszenia: ${maxUpgradeDeltaPp.toFixed(1)} pp, ` +
            `próg <${t.H6.maxDeltaPp} pp`,
        };

  return [h1, h2, h3, h4, h5, h6];
}
