import type { RunConfig } from '@heliopolis/sim';
import { assessHealth, type HealthId, type HealthVerdict } from './health.js';
import type { RunResult } from './run.js';

/**
 * # Przemiatanie jednej osi (Faza 3, Zadanie 3)
 *
 * ## Co tu jest, a czego nie ma
 *
 * Są **definicje osi** (jak wartość liczbowa zmienia `RunConfig`), **złożenie punktu**
 * (dwie populacje → sześć werdyktów) i **formatowanie tabeli**. Nie ma uruchamiania
 * przebiegów — to robi `batchCli.js` z `--axis/--value`, procesami.
 *
 * Ten sam podział, co w `batch.ts`: **kontrakt osobno od mechaniki procesów**. Dzięki temu
 * oś daje się przetestować bez odpalania ani jednego runu, a przemiatanie 6 punktów po
 * 250 przebiegów nie musi mieszkać w teście.
 *
 * ## Dlaczego oś jest DANĄ, a nie gałęzią `switch`
 *
 * Bo Zadanie 3 przemiata ich kilka (stopa nagród, ruda startowa, dwie liczby eskalacji),
 * a raport z każdej ma wyglądać tak samo. Oś zapisana jako dana niesie przy sobie własną
 * nazwę i jednostkę, więc tabela nie potrzebuje wiedzieć, co właściwie mierzy.
 */

/** Jedna oś przemiatania: nazwa do raportu i sposób nałożenia wartości na konfigurację. */
export interface Axis {
  readonly name: string;
  /** Co ta liczba znaczy — trafia do nagłówka tabeli, żeby raport czytał się bez kodu. */
  readonly unit: string;
  readonly apply: (base: RunConfig, value: number) => RunConfig;
}

/**
 * Osie, które Zadanie 3 ma prawo ruszać.
 *
 * Zamknięta lista, a nie dowolna ścieżka w konfiguracji, bo §11.1 zmierzył już, czego
 * ruszać NIE warto: cena modułu ewakuacyjnego nie jest bramką (300 → 1200 przesuwa
 * zwycięstwo o 281 ticków). Oś, której nie ma na tej liście, wymaga najpierw pomiaru
 * mówiącego, że w ogóle porusza wynikiem.
 */
export const AXES = {
  /** §11.1: PRAWDZIWY suwak trudności, z progiem między 0,25× a 0,1×. */
  killRewardScale: {
    name: 'killRewardScale',
    unit: '× nagrody za zabicie',
    apply: (base, value) => ({ ...base, killRewardScale: value }),
  },
  /** §11.1: rozstrzyga run dokładnie wtedy, gdy nagrody nie pokrywają odbudowy muru. */
  startingOre: {
    name: 'startingOre',
    unit: 'rudy na starcie',
    apply: (base, value) => ({ ...base, startingOre: value }),
  },
  /** Krzywa eskalacji — tempo narastania fali z cyklu na cykl. */
  growthPerCycle: {
    name: 'growthPerCycle',
    unit: '× fala na cykl',
    apply: (base, value) => ({ ...base, spawn: { ...base.spawn, growthPerCycle: value } }),
  },
  /** Krzywa eskalacji — punkt wyjścia, zanim wzrost cokolwiek pomnoży. */
  baseRatePerPentagon: {
    name: 'baseRatePerPentagon',
    unit: 'jedn./s z pentagonu',
    apply: (base, value) => ({ ...base, spawn: { ...base.spawn, baseRatePerPentagon: value } }),
  },
} as const satisfies Record<string, Axis>;

export type AxisName = keyof typeof AXES;

export const isAxisName = (name: string): name is AxisName =>
  Object.prototype.hasOwnProperty.call(AXES, name);

/** Jeden punkt przemiatania: wartość osi i to, co o niej mówi sześć kryteriów. */
export interface SweepPoint {
  readonly value: number;
  readonly health: readonly HealthVerdict[];
  readonly skilledRuns: number;
  readonly beginnerRuns: number;
}

/**
 * Składa punkt z dwóch populacji.
 *
 * Obie są potrzebne nawet wtedy, gdy interesuje nas tylko sufit: **H2 odnosi się do H1**
 * (podłoga ma być wyraźnie niższa od sufitu), więc punkt policzony z jednej populacji
 * miałby połowę kryteriów niezmierzonych — a przemiatanie ma porównywać punkty, nie luki.
 */
export function sweepPoint(
  value: number,
  skilled: readonly RunResult[],
  beginner: readonly RunResult[],
): SweepPoint {
  return {
    value,
    health: assessHealth({ skilled, beginner }),
    skilledRuns: skilled.length,
    beginnerRuns: beginner.length,
  };
}

const KOLUMNY: readonly HealthId[] = ['H1', 'H2', 'H3', 'H4'];

const komorka = (v: HealthVerdict | undefined): string => {
  if (v === undefined || !v.measured || v.value === null) return '—';
  const ci = v.ciHalfWidth === null ? '' : ` ±${v.ciHalfWidth < 0.05 ? v.ciHalfWidth.toFixed(2) : v.ciHalfWidth.toFixed(1)}`;
  return `${v.value.toFixed(1)}${ci}${v.ok === false ? '!' : ''}`;
};

/**
 * Tabela przemiatania — jeden wiersz na punkt, po kolumnie na kryterium.
 *
 * H5 i H6 nie mają tu kolumn, bo żadne z nich nie daje się policzyć z jednej partii
 * (jedno potrzebuje wielu OTWARĆ, drugie puli i jej braku) — kolumna pełna kresek
 * sugerowałaby, że coś się nie policzyło, zamiast że nikt o to nie pytał.
 *
 * **Wykrzyknik znaczy „poza progiem".** Punkt bez wykrzyknika przy H1 to kandydat;
 * kandydatów porównuje się dopiero potem, i to po całym wierszu, nie po jednej liczbie.
 */
export function formatSweep(axis: Axis, points: readonly SweepPoint[]): string {
  const naglowek = `oś: ${axis.name} [${axis.unit}]`;
  const wiersze = points.map((p) => {
    const komorki = KOLUMNY.map((id) =>
      komorka(p.health.find((v) => v.id === id)).padStart(12),
    ).join(' ');
    return `${String(p.value).padStart(8)} ${komorki}   n=${p.skilledRuns}/${p.beginnerRuns}`;
  });
  return [
    naglowek,
    `${'wartość'.padStart(8)} ${KOLUMNY.map((id) => id.padStart(12)).join(' ')}   n=wprawna/początkująca`,
    `${'—'.repeat(8)} ${KOLUMNY.map(() => '—'.repeat(12)).join(' ')}`,
    ...wiersze,
    '',
    '! = poza progiem. H1 sufit 25–60 %, H2 podłoga >2 % i <H1/2, H3 mediana 25–35 min,',
    'H4 udział runów początkującej ginących w cyklu 1, próg <15 %.',
  ].join('\n');
}
