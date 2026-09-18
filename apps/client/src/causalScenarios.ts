import {
  BUILDINGS,
  createState,
  lightField,
  multiSourceDistances,
  OUTAGE_NONE,
  OUTAGE_SHED,
  OUTAGE_UNLINKED,
  sunDirection,
  updatePower,
  type Building,
  type BuildingType,
  type Planet,
  type PowerReport,
  type SimState,
} from '@heliopolis/sim';

/**
 * # Scenariusze bramki czytelności PRZYCZYNOWEJ (Faza 2C, Zadanie 6)
 *
 * ## Czym ta bramka różni się od pięciu poprzednich
 *
 * Tamte mierzą czytelność **optyczną**: czy widać kontrast pasm, czy rzecz o danym rozmiarze
 * jest nad progiem piksela, po której stronie terminatora leży komórka. Ta pyta o co innego:
 * **czy gracz potrafi cofnąć się o krok po przyczynie.** Nie „co widzisz", tylko „dlaczego
 * tak jest".
 *
 * ## Dlaczego pytanie ma tę postać
 *
 * Cztery odpowiedzi to **cztery stany zasilania, które gra rozróżnia na ekranie** — nie
 * dowolne cztery zdania. `packages/sim/src/sim/power.ts` koduje dokładnie trzy powody braku
 * prądu (`OUTAGE_NONE`/`OUTAGE_SHED`/`OUTAGE_UNLINKED`), a linia bilansu z Zadania 4 dokłada
 * czwarty stan: **niedobór, który magazyn jeszcze pokrywa**. To jest ostrzeżenie PRZED awarią,
 * czyli dokładnie „jeden krok wstecz", o który prosi kryterium zadania.
 *
 * Para `SHED` ↔ `UNLINKED` jest tu sednem: to ta sama para, którą Zadanie 4 kazało rozróżnić
 * w świecie (obręcz przerwana kontra zamknięta), bo wymaga od gracza DWÓCH RÓŻNYCH reakcji —
 * „dobuduj produkcję" kontra „napraw pylon". Bramka, która by ich nie rozdzielała, nie
 * mierzyłaby niczego, co Zadanie 4 zbudowało.
 *
 * ## Prawda jest WYPROWADZANA, nie wpisana
 *
 * Każdy scenariusz buduje prawdziwy `SimState`, przepuszcza go przez prawdziwe `updatePower`
 * i odczytuje wynik z `outage`/`powered`. Gdyby prawda była wpisana ręcznie, bramka mierzyłaby
 * zgodność gracza z moim przekonaniem o symulacji, a nie z symulacją. `assertTruth` niżej
 * wywala scenariusz, który nie wyszedł tak, jak zapowiada — głośno, przy budowie strony,
 * zamiast po cichu przekłamać jedną pozycję tabeli.
 */

/** Cztery stany zasilania, które ekran rozróżnia — i cztery odpowiedzi w bramce. */
export type CausalAnswer = 'POWERED' | 'DEFICIT_COVERED' | 'SHED' | 'UNLINKED';

export const CAUSAL_ANSWERS: readonly CausalAnswer[] = [
  'POWERED',
  'DEFICIT_COVERED',
  'SHED',
  'UNLINKED',
];

/**
 * Treść odpowiedzi tak, jak czyta ją człowiek. **Każda nazywa PRZYCZYNĘ, nie objaw** —
 * „nie ma prądu" byłoby objawem i nie odróżniałoby dwóch z czterech pozycji.
 */
export const ANSWER_LABELS: Readonly<Record<CausalAnswer, string>> = {
  POWERED: 'Ma prąd i pracuje — sieć produkuje tyle, ile zużywa',
  DEFICIT_COVERED: 'Ma prąd, ale sieć nie nadąża — różnicę dopłaca magazyn',
  SHED: 'Nie ma prądu: zgaszony, bo zapotrzebowanie przekroczyło produkcję',
  UNLINKED: 'Nie ma prądu: odcięty od Core — przerwany łańcuch sieci',
};

/** Jeden osąd bramki: zamrożony stan, wskazany budynek i znana prawda. */
export interface CausalTrial {
  readonly id: string;
  readonly truth: CausalAnswer;
  readonly state: SimState;
  readonly power: PowerReport;
  /** Budynek, o który pytamy. */
  readonly cellId: number;
  /** Jednozdaniowy opis układu — do tabeli wyników, nie na ekran gracza. */
  readonly note: string;
}

/**
 * `[STROJENIE w bramce]` Faza słońca, w której zamrażane są wszystkie scenariusze.
 *
 * Jedna dla wszystkich i **stała**, bo bramka nie pyta o oświetlenie — pyta o zasilanie.
 * Zmienna faza dokładałaby do każdego osądu drugi, niekontrolowany wymiar trudności
 * (ta sama komórka raz w dzień, raz w nocy), a to jest oś poprzednich pięciu bramek.
 */
const SUN_FRACTION = 0.15;

/** Ticki dobijania magazynu przed scenariuszem, który go potrzebuje pełnego. */
const CHARGE_TICKS = 600;

/** Ticki ustalania się bilansu po postawieniu odbiorników. */
const SETTLE_TICKS = 40;

function place(s: SimState, cellId: number, type: BuildingType): Building {
  const b: Building = { cellId, type, hp: BUILDINGS[type].hp, powered: false };
  s.buildings[cellId] = b;
  return b;
}

function freshState(planet: Planet): { s: SimState; light: Float32Array; outage: Uint8Array } {
  const s = createState(planet, 0);
  const light = lightField(planet, sunDirection(SUN_FRACTION * 180, 180));
  const outage = new Uint8Array(planet.cells.length);
  return { s, light, outage };
}

function settle(s: SimState, light: Float32Array, outage: Uint8Array, ticks: number): PowerReport {
  let report = updatePower(s, light, outage);
  for (let i = 1; i < ticks; i++) report = updatePower(s, light, outage);
  return report;
}

/**
 * Odczytuje z ZAMROŻONEGO stanu, który z czterech stanów dotyczy wskazanego budynku.
 *
 * To jest jedyne miejsce, w którym powstaje prawda scenariusza — czytana z `outage`
 * i `PowerReport`, czyli z tych samych liczb, które idą na ekran. Scenariusz deklaruje,
 * co CHCE pokazać; ta funkcja mówi, co NAPRAWDĘ pokazał.
 */
export function readTruth(power: PowerReport, cellId: number): CausalAnswer {
  const code = power.outage[cellId];
  if (code === OUTAGE_UNLINKED) return 'UNLINKED';
  if (code === OUTAGE_SHED) return 'SHED';
  if (code !== OUTAGE_NONE) throw new Error(`causalScenarios: nieznany kod awarii ${code}`);
  // Ma prąd. Rozstrzyga, czy sieć się bilansuje, czy dopłaca magazyn — to jest ten
  // „jeden krok wstecz", którego nie widać po samym budynku, tylko po linii bilansu.
  return power.rawDemand > power.supply ? 'DEFICIT_COVERED' : 'POWERED';
}

/** Sąsiedzi w odległości dokładnie `steps` od `from`, rosnąco. */
function ringAt(planet: Planet, from: number, steps: number): number[] {
  const dist = multiSourceDistances(
    planet.cells.map((c) => c.neighbors),
    [from],
  );
  const out: number[] = [];
  for (let i = 0; i < dist.length; i++) if (dist[i] === steps) out.push(i);
  return out;
}

function hexNeighbours(planet: Planet, from: number, count: number, steps = 1): number[] {
  const out = ringAt(planet, from, steps).filter((i) => planet.cells[i].cellType === 'HEXAGON');
  if (out.length < count) {
    throw new Error(`causalScenarios: za mało heksów w odległości ${steps} od ${from}`);
  }
  return out.slice(0, count);
}

// =========================================================================================
// Cztery układy — po jednym na odpowiedź
// =========================================================================================

/** Sieć z nadwyżką: CORE (10/s) i jedna wieża kinetyczna (3/s). */
function layoutPowered(planet: Planet, anchor: number): CausalTrial {
  const { s, light, outage } = freshState(planet);
  place(s, anchor, 'CORE');
  const [turret] = hexNeighbours(planet, anchor, 1);
  place(s, turret, 'KINETIC_TURRET');
  const power = settle(s, light, outage, SETTLE_TICKS);
  return {
    id: `powered@${anchor}`,
    truth: 'POWERED',
    state: s,
    power,
    cellId: turret,
    note: 'CORE 10/s, jedna wieża kinetyczna 3/s — sieć z nadwyżką',
  };
}

/**
 * Niedobór, który magazyn jeszcze pokrywa: CORE (10/s) i dwa lasery (24/s), magazyn
 * naładowany do pełna PRZED ich postawieniem.
 *
 * Kolejność ma znaczenie i jest realna: w grze magazyn napełnia się w spokojnej fazie runu,
 * a odbiorniki dokłada się później. Stan „pełny magazyn i świeży niedobór" jest więc
 * OSIĄGALNY, a nie ustawiony ręcznie — dlatego ładowanie idzie przez prawdziwe `updatePower`.
 */
function layoutDeficitCovered(planet: Planet, anchor: number): CausalTrial {
  const { s, light, outage } = freshState(planet);
  place(s, anchor, 'CORE');
  settle(s, light, outage, CHARGE_TICKS);

  const lasers = hexNeighbours(planet, anchor, 2);
  for (const cell of lasers) place(s, cell, 'LASER_TURRET');
  const power = settle(s, light, outage, 1);
  return {
    id: `covered@${anchor}`,
    truth: 'DEFICIT_COVERED',
    state: s,
    power,
    cellId: lasers[0],
    note: 'CORE 10/s, dwa lasery 24/s, magazyn pełny — niedobór 14/s pokryty z magazynu',
  };
}

/**
 * **Scenariusz Q3 z Fazy 1C.** Cztery lasery (48/s) przy produkcji CORE 10/s i pustym
 * magazynie. `BROWNOUT_ORDER` gasi `EXTRACTOR` jako pierwszy — i o niego pytamy.
 *
 * Magazyn pusty, bo scenariusz ma pokazać AWARIĘ, a nie ostrzeżenie: przy pełnym magazynie
 * ten sam układ daje `DEFICIT_COVERED` (200 jednostek zapasu to 4000/s chwilowej mocy).
 * Różnica między tymi dwoma scenariuszami JEST treścią bramki.
 */
function layoutShed(planet: Planet, anchor: number): CausalTrial {
  const { s, light, outage } = freshState(planet);
  place(s, anchor, 'CORE');
  const ring = hexNeighbours(planet, anchor, 4);
  for (const cell of ring) place(s, cell, 'LASER_TURRET');
  const [victim] = hexNeighbours(planet, anchor, 1, 2);
  place(s, victim, 'KINETIC_TURRET');
  const power = settle(s, light, outage, SETTLE_TICKS);
  return {
    id: `shed@${anchor}`,
    truth: 'SHED',
    state: s,
    power,
    cellId: victim,
    note: 'Q3: cztery lasery 48/s przy produkcji 10/s, magazyn pusty — kaskada gasi odbiorniki',
  };
}

/**
 * **Scenariusz Q4 z Fazy 1C.** Łańcuch pylonów od CORE do dalekiego budynku; jedno ogniwo
 * usunięte, tak jak zjadłby je `DISRUPTOR`.
 *
 * Pytamy o budynek NA KOŃCU łańcucha: jest cały i sieć ma nadwyżkę, a mimo to nie działa.
 * To jest właśnie ta przyczyna, której nie da się odczytać z samego budynku — trzeba
 * zobaczyć, że obręcz jest PRZERWANA, a nie zamknięta.
 */
function layoutUnlinked(planet: Planet, anchor: number): CausalTrial {
  const { s, light, outage } = freshState(planet);
  place(s, anchor, 'CORE');

  // Łańcuch co 3 kroki — tyle wynosi `connectionRadius` PYLON-a i CORE-a, więc ogniwa
  // sięgają do siebie dokładnie, a usunięcie jednego rozspaja łańcuch na pewno.
  //
  // Ogniwa dobierane są tak, żeby każde kolejne ODDALAŁO się od kotwicy — inaczej pierścień
  // o promieniu 3 wokół ogniwa zawiera też komórki BLIŻSZE CORE-a, łańcuch zawraca i po
  // usunięciu środka daleki budynek bywa dalej w zasięgu CORE-a. Wtedy scenariusz deklaruje
  // odcięcie, a symulacja pokazuje działającą sieć; `assertTruth` łapie to głośno, ale
  // właściwa naprawa jest tutaj.
  const fromAnchor = multiSourceDistances(
    planet.cells.map((c) => c.neighbors),
    [anchor],
  );
  const stepOut = (from: number, minDistance: number): number => {
    const candidates = ringAt(planet, from, 3).filter(
      (c) => planet.cells[c].cellType === 'HEXAGON' && fromAnchor[c] >= minDistance,
    );
    if (candidates.length === 0) {
      throw new Error(`causalScenarios: brak ogniwa łańcucha za ${from} (kotwica ${anchor})`);
    }
    // Najdalsze od kotwicy, a przy remisie najniższy numer — dobór deterministyczny.
    return candidates.sort((a, b) => fromAnchor[b] - fromAnchor[a] || a - b)[0];
  };
  const link1 = stepOut(anchor, 3);
  const link2 = stepOut(link1, fromAnchor[link1] + 1);
  const far = stepOut(link2, fromAnchor[link2] + 1);

  place(s, link1, 'PYLON');
  place(s, link2, 'PYLON');
  place(s, far, 'KINETIC_TURRET');
  // Ogniwo zjedzone — dokładnie to, co robi DISRUPTOR z łańcuchem pylonów.
  s.buildings[link2] = null;

  const power = settle(s, light, outage, SETTLE_TICKS);
  return {
    id: `unlinked@${anchor}`,
    truth: 'UNLINKED',
    state: s,
    power,
    cellId: far,
    note: 'Q4: łańcuch pylonów do dalekiej wieży, środkowe ogniwo zjedzone — wieża bez drogi do Core',
  };
}

const LAYOUTS: Readonly<Record<CausalAnswer, (p: Planet, anchor: number) => CausalTrial>> = {
  POWERED: layoutPowered,
  DEFICIT_COVERED: layoutDeficitCovered,
  SHED: layoutShed,
  UNLINKED: layoutUnlinked,
};

/**
 * Sprawdza, że scenariusz pokazał to, co zapowiada — i wywala GŁOŚNO, gdy nie.
 *
 * Bez tego jedna zmiana w `defs.ts` (inny pobór lasera, inna produkcja CORE) po cichu
 * przestawiłaby prawdę jednego osądu, a bramka dalej stawiałaby przy nim „OK" albo „BŁĄD"
 * wedle starej deklaracji. Tabela wyników wyglądałaby tak samo. To jest ta sama klasa,
 * co liczba, która przeżyła swoje wejście.
 */
function assertTruth(trial: CausalTrial): CausalTrial {
  const actual = readTruth(trial.power, trial.cellId);
  if (actual !== trial.truth) {
    throw new Error(
      `causalScenarios: scenariusz ${trial.id} zapowiada ${trial.truth}, a symulacja daje ` +
        `${actual} (produkcja ${trial.power.supply}/s, zapotrzebowanie ${trial.power.rawDemand}/s, ` +
        `kod awarii ${trial.power.outage[trial.cellId]}). Scenariusz albo deklaracja są nieaktualne.`,
    );
  }
  return trial;
}

/**
 * Dwanaście osądów, po trzy na każdą z czterech odpowiedzi.
 *
 * **Plan jest ZRÓWNOWAŻONY z konstrukcji**, nie z dobrego trafu: pętla idzie po
 * `CAUSAL_ANSWERS`, więc każda odpowiedź jest prawdziwa dokładnie trzy razy. Odpowiadanie
 * w kółko tym samym daje więc 3/12 — czyli tyle, co losowanie, i panel ma to nazwać
 * (patrz `constantAnswerWarning`).
 *
 * `offset` rozsuwa ZESTAWY: przebieg oceniany i kontrolny dostają **rozłączne kotwice**,
 * więc kontrola nie zdradza odpowiedzi z przebiegu ocenianego. Ta sama zasada, co rozłączne
 * komórki w bramce Fazy 2B.
 */
export function buildTrials(planet: Planet, offset: number): CausalTrial[] {
  const anchors = pickAnchors(planet, CAUSAL_ANSWERS.length * 3, offset);
  const trials: CausalTrial[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const answer = CAUSAL_ANSWERS[i % CAUSAL_ANSWERS.length];
    trials.push(assertTruth(LAYOUTS[answer](planet, anchors[i])));
  }
  return trials;
}

/**
 * Kotwice scenariuszy: heksy rozrzucone po planecie, z zapasem miejsca na własny układ.
 *
 * Dobór jest DETERMINISTYCZNY (krok po posortowanej liście heksów), bo tabela wyników ma
 * dać się powtórzyć co do wiersza. `offset` przesuwa okno — stąd rozłączność zestawów.
 */
function pickAnchors(planet: Planet, count: number, offset: number): number[] {
  const hexes: number[] = [];
  for (let i = 0; i < planet.cells.length; i++) {
    if (planet.cells[i].cellType === 'HEXAGON') hexes.push(i);
  }
  const stride = Math.floor(hexes.length / (count * 2));
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(hexes[(offset + i) * stride]);
  if (new Set(out).size !== count) throw new Error('causalScenarios: kotwice się powtarzają');
  return out;
}

/**
 * Ostrzeżenie o odpowiedzi stałej — wymóg Kroku 1 zadania.
 *
 * Przy planie zrównoważonym 3/3/3/3 gracz wciskający w kółko ten sam przycisk dostaje 3/12,
 * czyli dokładnie tyle, co losowanie. Sam wynik tego nie zdradza (3/12 to po prostu wynik
 * poniżej progu), ale ROZKŁAD zdradza natychmiast — i dlatego jest liczony osobno.
 * Ta wada wyszła przy bramce Fazy 2B: wynik wyglądał jak umiejętność, a był artefaktem.
 */
export function constantAnswerWarning(given: readonly CausalAnswer[]): string | null {
  if (given.length < 4) return null;
  const counts = new Map<CausalAnswer, number>();
  for (const a of given) counts.set(a, (counts.get(a) ?? 0) + 1);
  const [top, topCount] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  const share = topCount / given.length;
  if (share < 0.6) return null;
  return (
    `UWAGA: ${topCount} z ${given.length} odpowiedzi to „${ANSWER_LABELS[top]}" ` +
    `(${Math.round(share * 100)}%). Plan jest zrównoważony 3/3/3/3, więc odpowiedź stała ` +
    'daje wynik nieodróżnialny od losowania. Wynik tego przebiegu jest podejrzany.'
  );
}

/** Który przebieg bramki: oceniany czy kontrolny. */
export type GateMode = 'graded' | 'control';

/**
 * Gotowy blok Markdown do wklejenia w dokument wyników.
 *
 * Panel **nie stawia werdyktu** — pisze „PRÓG OSIĄGNIĘTY" albo „PRÓG NIEOSIĄGNIĘTY", czyli
 * fakt arytmetyczny, i zostawia miejsce na zdanie właściciela projektu. Bramka jest
 * przyrządem; werdykt należy do człowieka, tak samo jak w pięciu poprzednich.
 */
export function gateReport(
  mode: GateMode,
  trials: readonly CausalTrial[],
  given: readonly CausalAnswer[],
  threshold: number,
): string {
  const rows = trials.map((trial, i) => {
    const got = given[i];
    const ok = got === trial.truth ? 'OK' : 'BŁĄD';
    return `| ${i + 1} | ${trial.id} | ${trial.truth} | ${got ?? '—'} | ${ok} |`;
  });
  const correct = given.filter((a, i) => a === trials[i].truth).length;
  const warning = constantAnswerWarning(given);
  return [
    `### Przebieg: ${mode === 'graded' ? 'OCENIANY' : 'KONTROLA POZYTYWNA'}`,
    '',
    `Wynik: **${correct} z ${trials.length}** (próg ${threshold}) — ` +
      `${correct >= threshold ? 'PRÓG OSIĄGNIĘTY' : 'PRÓG NIEOSIĄGNIĘTY'}.`,
    '',
    warning === null ? '' : `> ${warning}`,
    warning === null ? '' : '',
    '| # | układ | prawda | odpowiedź | wynik |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '_Werdykt wpisuje właściciel projektu. Panel podaje wyłącznie arytmetykę._',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');
}

/**
 * Obręcz alarmu **bez rozróżnienia przyczyny** — jedyna zmiana w świecie, jaką robi kontrola.
 *
 * Każdy powód braku prądu dostaje ten sam kod, więc budynek zgaszony kaskadą wygląda dokładnie
 * tak samo jak odcięty od sieci. Zostaje widoczne, ŻE coś nie działa — i to jest celowe: gdyby
 * kontrola ukrywała także sam fakt awarii, pytanie stawałoby się nieodpowiadalne, a nie
 * trudne, i sufit spadłby do 25 % z powodu, który nie ma nic wspólnego z przyczynowością.
 */
export function blindOutage(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) {
    out[i] = source[i] === OUTAGE_NONE ? OUTAGE_NONE : OUTAGE_SHED;
  }
  return out;
}
