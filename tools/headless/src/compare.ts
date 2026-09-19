import { diagnozuj } from './diagnostics.js';
import { ciHalfWidthPp } from './health.js';
import type { RunResult } from './run.js';

/**
 * # Porównanie nazwanych wariantów (Faza 3, narzędzia balansu)
 *
 * ## Jedno narzędzie, nie dwa
 *
 * „Które z pięciu otwarć wygrywa" i „czy ta zmiana balansu coś dała" wyglądają jak dwa
 * pytania, a mają identyczny kształt: **lista nazwanych wariantów, każdy ze swoją partią,
 * zestawione w jednej tabeli**. „Przed" i „po" to po prostu dwa warianty. Rozdzielenie
 * tego na dwa narzędzia byłoby powieleniem tej samej tabeli i tych samych sit.
 *
 * ## Po co to istnieje — pytanie, na które odpowiadałem OKIEM
 *
 * Przez całe Zadanie 3 zestawiałem liczby ręcznie: „było 59,8, jest 37,2 — to dużo czy
 * mało?". Przy przedziałach ±3 pp odpowiedź bywa nieoczywista, a **przy ±6 pp dwie liczby
 * różniące się o pięć punktów są nierozróżnialne** i wyglądają na wynik. Ta klasa pomyłki
 * wracała w tym projekcie wielokrotnie: liczba bez przedziału obok zaprasza do porównania,
 * którego nie wolno zrobić.
 *
 * Różnica dwóch odsetków ma własny przedział — szerszy niż każdy z osobna, bo niepewności
 * się sumują. Tu jest liczony wprost i tu zapada werdykt „istotna" albo „w granicach szumu".
 *
 * ## Czego to NIE robi
 *
 * Nie mówi, który wariant jest LEPSZY — od tego są progi w `assessHealth` i człowiek.
 * Mówi wyłącznie, czy warianty się **różnią**, i o ile, z uczciwym marginesem.
 */

/** Wariant: nazwa i partia, która z niej powstała. */
export interface Wariant {
  readonly nazwa: string;
  readonly wyniki: readonly RunResult[];
}

/**
 * Co porównujemy. Obie miary są ODSETKIEM RUNÓW, więc obowiązuje je ta sama arytmetyka
 * różnicy; mediana długości runu celowo nie jest tu obsługiwana, bo nie jest proporcją
 * i wymagałaby innego przedziału (statystyki pozycyjne — patrz `medianCiHalfWidth`).
 */
export type Miara = 'zwyciestwa' | 'cykl1';

const MIARY: Record<Miara, { readonly opis: string; readonly licz: (r: RunResult) => boolean }> = {
  zwyciestwa: { opis: 'zwycięstw', licz: (r) => r.phase === 'VICTORY' },
  cykl1: { opis: 'ginie w cyklu 1', licz: (r) => r.phase === 'DEFEAT' && r.cycle === 1 },
};

const odsetek = (w: readonly RunResult[], miara: Miara): number =>
  w.length === 0 ? 0 : w.filter(MIARY[miara].licz).length / w.length;

/**
 * Półszerokość 95 % przedziału dla RÓŻNICY dwóch odsetków, w punktach procentowych.
 *
 * Niepewności **sumują się kwadratowo**, więc przedział różnicy jest zawsze szerszy niż
 * każdy ze składowych. To jest dokładnie ten fakt, który sprawia, że „36,8 % wobec 35,2 %"
 * przy ±6 pp na każdym z osobna jest nierozróżnialne.
 *
 * **Składowe liczone Wilsonem, nie Waldem** — i to nie jest ozdoba. Pierwsza wersja tej
 * funkcji brała wzór Walda `z·√(p(1−p)/n)` wprost i przy `p₁ = p₂ = 0` dawała **±0,0 pp**,
 * czyli „te dwa zera różnią się z pewnością o zero". Zobaczyłem to na pierwszym prawdziwym
 * porównaniu: dwie partie polityki początkującej, obie z zerowym odsetkiem zwycięstw.
 * To ta sama zapaść, którą `health.ts` naprawiał tydzień wcześniej — powtórzona, bo wzór
 * przepisałem zamiast użyć gotowego.
 */
export function ciRoznicyPp(
  p1: number, n1: number,
  p2: number, n2: number,
): number {
  if (n1 === 0 || n2 === 0) return 0;
  const h1 = ciHalfWidthPp(p1, n1);
  const h2 = ciHalfWidthPp(p2, n2);
  return Math.sqrt(h1 * h1 + h2 * h2);
}

export interface Roznica {
  readonly nazwa: string;
  /** Odsetek wybranej miary w tym wariancie, w punktach procentowych. */
  readonly odsetekPp: number;
  /** Różnica wobec wariantu odniesienia (pierwszego), w punktach procentowych. */
  readonly deltaPp: number;
  /** Półszerokość przedziału RÓŻNICY. `null` dla wariantu odniesienia. */
  readonly ciPp: number | null;
  /**
   * Czy różnica wykracza poza swój przedział. `null` dla wariantu odniesienia.
   *
   * **To nie jest test istotności statystycznej w sensie formalnym** — to reguła
   * „czy zero mieści się w przedziale różnicy", czyli najprostsze możliwe sito na
   * porównania, których nie wolno robić.
   */
  readonly istotna: boolean | null;
}

/** Zestawia warianty wobec PIERWSZEGO z listy — on jest odniesieniem. */
export function porownaj(warianty: readonly Wariant[], miara: Miara = 'zwyciestwa'): Roznica[] {
  if (warianty.length === 0) return [];
  const bazowy = warianty[0];
  const p0 = odsetek(bazowy.wyniki, miara);
  const n0 = bazowy.wyniki.length;

  return warianty.map((w, i) => {
    const p = odsetek(w.wyniki, miara);
    if (i === 0) {
      return { nazwa: w.nazwa, odsetekPp: p * 100, deltaPp: 0, ciPp: null, istotna: null };
    }
    const ci = ciRoznicyPp(p0, n0, p, w.wyniki.length);
    const delta = (p - p0) * 100;
    return {
      nazwa: w.nazwa,
      odsetekPp: p * 100,
      deltaPp: delta,
      ciPp: ci,
      istotna: Math.abs(delta) > ci,
    };
  });
}

/**
 * Tabela porównania — z diagnozami przyrządu NAD nią.
 *
 * Kolejność ta sama i z tego samego powodu, co w `formatReport` i `formatSweep`: wariant
 * zakleszczony ma zostać rozpoznany, ZANIM ktoś przeczyta jego zero jako wynik. W Zadaniu 3
 * dokładnie takie zero trafiło do trzech wniosków.
 */
export function formatPorownanie(
  warianty: readonly Wariant[],
  miara: Miara = 'zwyciestwa',
): string {
  const roznice = porownaj(warianty, miara);
  const alarmy = warianty.flatMap((w) =>
    diagnozuj(w.wyniki).map((d) => `!!! PRZYRZĄD [${d.kod}] w wariancie „${w.nazwa}": ${d.opis}`),
  );

  const szer = Math.max(20, ...warianty.map((w) => w.nazwa.length));
  const wiersze = roznice.map((r) => {
    const n = warianty.find((w) => w.nazwa === r.nazwa)?.wyniki.length ?? 0;
    if (r.ciPp === null) {
      return `${r.nazwa.padEnd(szer)} ${r.odsetekPp.toFixed(1).padStart(6)}%   (odniesienie)      n=${n}`;
    }
    const znak = r.deltaPp >= 0 ? '+' : '−';
    const werdykt = r.istotna ? 'ISTOTNA' : 'w granicach szumu';
    return (
      `${r.nazwa.padEnd(szer)} ${r.odsetekPp.toFixed(1).padStart(6)}%   ` +
      `${znak}${Math.abs(r.deltaPp).toFixed(1).padStart(5)} ±${r.ciPp.toFixed(1)} pp   ` +
      `${werdykt}   n=${n}`
    );
  });

  return [
    ...alarmy.flatMap((a) => [a, '']),
    `${'wariant'.padEnd(szer)} ${MIARY[miara].opis.padStart(7)}   różnica wobec odniesienia`,
    '─'.repeat(szer + 52),
    ...wiersze,
    '',
    'Różnica niesie WŁASNY przedział, szerszy niż każdy ze składowych — niepewności się',
    'sumują. „W granicach szumu" znaczy, że zero mieści się w tym przedziale, czyli',
    'porównania nie wolno robić bez większej próby.',
  ].join('\n');
}
