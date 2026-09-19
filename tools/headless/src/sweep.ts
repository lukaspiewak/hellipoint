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
  /**
   * Faza słońca na starcie runu, względem ŚWITU komórki startowej (ułamek obrotu).
   *
   * Nie jest to pokrętło trudności w tym samym sensie, co pozostałe: 0 daje graczowi
   * okno, w którym słońce broni za niego, 0,5 wypuszcza go w pełną noc. Zadanie 3
   * zmierzyło, że H4 nie rusza się od żadnej liczby balansowej, więc to jest oś,
   * która ma szansę ruszyć podłogę — i dlatego musi dać się przemiatać.
   */
  sunPhaseAtStart: {
    name: 'sunPhaseAtStart',
    unit: 'obrotu po świcie',
    apply: (base, value) => ({ ...base, sunPhaseAtStart: value }),
  },
  /**
   * Przepuszczalność światła — 0 to ściana, wartości dodatnie wpuszczają wrogów w światło
   * na głębokość zależną od `burnTime` (pas śmierci §4.4).
   *
   * Oś istnieje, bo włączenie tej mechaniki wymaga PRZESTROJENIA CAŁEGO balansu, nie samego
   * pokrętła: zmierzone H1 przy 0,5 / 0,7 / 0,85 / 1,0 to 4,2 / 4,2 / 0,8 / 5,8 % wobec
   * 32,2 % przy ścianie. Bez tej osi to przestrojenie trzeba by robić ręcznie.
   */
  lightPermeability: {
    name: 'lightPermeability',
    unit: 'ułamka burnTime do zawrotu',
    apply: (base, value) => ({ ...base, lightPermeability: value }),
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

/**
 * Oś TRZYMANA na stałej wartości, podczas gdy przemiatana jest inna.
 *
 * Istnieje, bo osie się **przenikają**: stopa nagród rusza wyłącznie sufit (zmierzone:
 * H2 i H4 identyczne co do dziesiątej przy stawkach od 0,2 do 0,7), więc podłogę trzeba
 * przemiatać inną osią — ale nie na dzisiejszej stawce nagród, tylko na wybranej.
 *
 * Trzymane wartości MUSZĄ trafiać do nagłówka tabeli. Przemiatanie bez zapisu, co przy
 * nim stało, jest liczbą, której nikt nie odtworzy — a Zadanie 3 produkuje właśnie takie
 * tabele jako uzasadnienia dla liczb wpisywanych na stałe.
 */
export interface FixedAxis {
  readonly name: AxisName;
  readonly value: number;
}

/** Parsuje `nazwa=wartość`; rzuca GŁOŚNO, bo cichy błąd dałby przemiatanie na złej bazie. */
export function parseFixed(specs: readonly string[]): FixedAxis[] {
  return specs.map((spec) => {
    const [name, raw] = spec.split('=');
    if (name === undefined || !isAxisName(name)) {
      throw new Error(`--fix ${spec}: nieznana oś ${name} (jest: ${Object.keys(AXES).join(', ')})`);
    }
    const value = Number(raw);
    if (raw === undefined || !Number.isFinite(value)) {
      throw new Error(`--fix ${spec}: ${raw} nie jest liczbą skończoną`);
    }
    return { name, value };
  });
}

/** Nakłada trzymane osie w podanej kolejności. Ostatnia wygrywa, gdy nazwa się powtórzy. */
export function applyFixed(base: RunConfig, fixed: readonly FixedAxis[]): RunConfig {
  return fixed.reduce((cfg, f) => AXES[f.name].apply(cfg, f.value), base);
}

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

/**
 * Co ta oś MA ruszyć, a czego NIE MA PRAWA — deklaracja sprawdzana po pomiarze.
 *
 * ## Skąd to się wzięło
 *
 * Dwie pomyłki z Zadania 3, obie kosztowne, obie tej samej rodziny.
 *
 * **Raz nie ruszyło się nic, a wyglądało to na wynik.** Przemiatanie `growthPerCycle`
 * dało H4 = 82,5 % w każdym z czterech punktów. Wyglądało jak odkrycie („eskalacja nie
 * wpływa na podłogę"), a było arytmetyką: tempo to `base × growth^(cykl−1)`, więc w cyklu 1
 * wykładnik wynosi zero i ta oś NIE MOŻE tam wpłynąć. Straciłem na to całe przemiatanie.
 *
 * **Raz ruszyło się coś, co nie miało prawa.** Podczas kalibracji drugiej wieży linia
 * laserowa — która tej wieży w ogóle nie używa — skoczyła z 36,8 na 79,2 %. To nie był
 * wynik, tylko podmiana wyrażeniem regularnym, która zmieniła nie ten budynek, co trzeba.
 * **Złapałem to wyłącznie dlatego, że przypadkiem patrzyłem na liczbę, która miała stać
 * w miejscu.**
 *
 * Deklaracja zamienia oba spojrzenia w sito: mówisz z góry, czego się spodziewasz,
 * a tabela sprawdza, czy pomiar to potwierdził.
 */
/** Nazwa kryterium w deklaracji — te same identyfikatory, co w `assessHealth`. */
export type HealthIdLista = HealthId;

export interface Oczekiwania {
  /** Kryteria, którymi ta oś MA ruszać. Brak ruchu = oś nie działa albo nie może działać. */
  readonly rusza?: readonly HealthId[];
  /**
   * Kryteria, które NIE MAJĄ PRAWA drgnąć — jawnie zadeklarowana kontrola.
   *
   * Osobne od `rusza`, bo to są dwa różne twierdzenia, a nie dwie strony jednego.
   * Kryterium niewymienione w żadnej liście jest **nieobjęte**: pomiar o nim nie orzeka.
   * Gdyby „nie wymienione" znaczyło „ma stać", każde przemiatanie sypałoby alarmami
   * o kryteriach, które słusznie się poruszyły.
   */
  readonly stoi?: readonly HealthId[];
}

const wartosci = (punkty: readonly SweepPoint[], id: HealthId): (number | null)[] =>
  punkty.map((p) => p.health.find((v) => v.id === id)?.value ?? null);

const drgnelo = (v: readonly (number | null)[]): boolean =>
  new Set(v.map((x) => (x === null ? 'null' : x.toFixed(4)))).size > 1;

/**
 * Sprawdza deklarację wobec pomiaru. Pusta tablica = deklaracja się potwierdziła.
 *
 * Nie rozstrzyga, KTÓRA strona się myli — oś może nie działać albo przyrząd może być
 * zepsuty, i to są dwie różne naprawy. Mówi tylko, że jedno z dwojga zaszło.
 */
export function sprawdzOczekiwania(
  punkty: readonly SweepPoint[],
  oczekiwania: Oczekiwania,
): string[] {
  if (punkty.length < 2) return [];
  const out: string[] = [];
  for (const id of KOLUMNY) {
    const ruch = drgnelo(wartosci(punkty, id));
    const miało = oczekiwania.rusza?.includes(id) ?? false;
    const miałoStać = oczekiwania.stoi?.includes(id) ?? false;
    if (miało && miałoStać) {
      throw new Error(`Oczekiwania: ${id} jest naraz w „rusza" i „stoi" — sprzeczna deklaracja`);
    }
    if (miało && !ruch) {
      out.push(
        `${id} ma REAGOWAĆ na tę oś, a jest identyczne we wszystkich ${punkty.length} punktach. ` +
          'Albo oś nie dotyka tego kryterium (sprawdź arytmetykę, zanim uznasz to za wynik), ' +
          'albo wartość osi nie dociera do przebiegów.',
      );
    }
    if (miałoStać && ruch) {
      out.push(
        `${id} zadeklarowano jako NIERUCHOME na tej osi, a drgnęło. Liczba, która miała stać ` +
          'w miejscu, ' +
          'jest najtańszym detektorem zepsutego przyrządu — sprawdź, co jeszcze zmieniła ' +
          'ostatnia podmiana w plikach balansu.',
      );
    }
  }
  return out;
}

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
export function formatSweep(
  axis: Axis,
  points: readonly SweepPoint[],
  fixed: readonly FixedAxis[] = [],
  oczekiwania?: Oczekiwania,
): string {
  const trzymane =
    fixed.length === 0
      ? 'trzymane: nic — reszta na DEFAULT_RUN'
      : `trzymane: ${fixed.map((f) => `${f.name}=${f.value}`).join(', ')}`;
  const naglowek = `oś: ${axis.name} [${axis.unit}]\n${trzymane}`;
  const wiersze = points.map((p) => {
    const komorki = KOLUMNY.map((id) =>
      komorka(p.health.find((v) => v.id === id)).padStart(12),
    ).join(' ');
    return `${String(p.value).padStart(8)} ${komorki}   n=${p.skilledRuns}/${p.beginnerRuns}`;
  });
  const alarmy = oczekiwania === undefined ? [] : sprawdzOczekiwania(points, oczekiwania);
  return [
    // Alarmy przyrządu na SAMEJ GÓRZE, przed tabelą — ta sama kolejność i ten sam powód,
    // co w `formatReport`: czytelnik ma dowiedzieć się, że nie wolno ufać liczbom, ZANIM
    // je przeczyta.
    ...alarmy.flatMap((a) => [`!!! PRZYRZĄD: ${a}`, '']),
    naglowek,
    `${'wartość'.padStart(8)} ${KOLUMNY.map((id) => id.padStart(12)).join(' ')}   n=wprawna/początkująca`,
    `${'—'.repeat(8)} ${KOLUMNY.map(() => '—'.repeat(12)).join(' ')}`,
    ...wiersze,
    '',
    '! = poza progiem. H1 sufit 25–60 %, H2 podłoga >2 % i <H1/2, H3 mediana 25–35 min,',
    'H4 udział runów początkującej ginących w cyklu 1, próg <15 %.',
  ].join('\n');
}
