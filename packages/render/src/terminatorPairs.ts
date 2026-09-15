import type { Cell, Planet, Vec3 } from '@heliopolis/sim';
import { lightField, Rng } from '@heliopolis/sim';

/**
 * Próbkowanie granicy dnia i nocy na potrzeby bramki czytelności.
 *
 * **Prawda o tym, która komórka jest oświetlona, bierze się TU I WSZĘDZIE z predykatu
 * SYMULACJI — `light[cellId] > 0`** (tego samego, którym rozstrzygają `spawning.ts`,
 * `burning.ts` i `movement.ts`), nie z pasma renderu. Do Fazy 2A było odwrotnie: bramka
 * pytała o `lightBand(light) >= 1`, czyli o granicę WIDZIANĄ, która przy progu 0,05 leżała
 * o jeden krok grafu od granicy, po której decyduje symulacja (spec Fazy 2A, §4.1: w 6 z 15
 * prób komórka opisana jako „ciemna" była dla symulacji oświetlona). Po obniżeniu
 * `LIGHT_BANDS[0]` do zera obie granice pokrywają się DOKŁADNIE — ale zapisanie tu predykatu
 * symulacji, a nie renderu, jest tym, co czyni bramkę zdolną WYKRYĆ ich ponowne rozejście:
 * gdyby ktoś podniósł pierwszy próg, komórki oznaczone jako „jasne" wciąż byłyby tymi, które
 * pali słońce, a render przestałby je tak malować — i człowiek by na tym poległ, zamiast
 * dostać cicho zgodny, bezużyteczny wynik.
 */

/** Para komórek SĄSIADUJĄCYCH, jedna oświetlona (`light > 0`), druga nie. */
export interface TerminatorPair {
  readonly litCellId: number;
  readonly darkCellId: number;
}

/**
 * Wszystkie pary sąsiadów, których granica dnia/nocy stawia po dwóch stronach — z
 * PRAWDZIWEGO `light` (np. z `lightField(planet, sunDirection(...))`), nie z liczb wpisanych
 * ręcznie.
 *
 * Nie napędza już samej bramki (ta pyta o POJEDYNCZE komórki — patrz `buildGateTrials`), ale
 * zostaje jako przyrząd pomiarowy: „o ile różni się kolor po dwóch stronach granicy" jest
 * wielkością, którą mierzymy w `shading.test.ts` i raportujemy w dokumencie wyników, i
 * potrzebuje dokładnie takiej listy par.
 *
 * Każda nieskierowana krawędź liczona DOKŁADNIE RAZ: pętla pomija sąsiadów o mniejszym `id`
 * (już odwiedzonych z ich strony) — bezpieczne, bo sąsiedztwo w `@heliopolis/sim` jest
 * symetryczne (zweryfikowane w Fazie 0, §6: „asymetryczne krawędzie sąsiedztwa: 0").
 */
export function findTerminatorPairs(cells: readonly Cell[], light: Float32Array): TerminatorPair[] {
  const pairs: TerminatorPair[] = [];
  for (const cell of cells) {
    const selfLit = light[cell.id] > 0;
    for (const neighborId of cell.neighbors) {
      if (neighborId <= cell.id) continue; // każda krawędź nieskierowana raz, od mniejszego id
      const neighborLit = light[neighborId] > 0;
      if (selfLit === neighborLit) continue;
      pairs.push(
        selfLit ? { litCellId: cell.id, darkCellId: neighborId } : { litCellId: neighborId, darkCellId: cell.id },
      );
    }
  }
  return pairs;
}

/**
 * Komórki PRZYLEGAJĄCE do granicy dnia i nocy, rozdzielone na stronę oświetloną i ciemną:
 * komórka trafia tu wtedy i tylko wtedy, gdy ma co najmniej jednego sąsiada po DRUGIEJ
 * stronie granicy (odległość 1 w grafie).
 *
 * To jest zbiór, z którego bramka losuje (deterministycznie — patrz `selectSpread`) swoje
 * pytania, i wybór „dokładnie odległość 1" jest jej najważniejszym parametrem. Uzasadnienie:
 * pytanie „po której stronie granicy leży ta komórka" jest TRYWIALNE dla komórki daleko od
 * granicy (środek dnia jest jasny w każdym trybie cieniowania, łącznie z kontrolą pozytywną)
 * i rozstrzygające tylko tuż przy niej. Komórki przy granicy to zarazem DOKŁADNIE te, o które
 * spór między renderem a symulacją toczył się w Fazie 2A — jednokomórkowy pierścień, w którym
 * gracz widział noc, a jednostki się paliły.
 *
 * Obie listy rosną po `id`. Zmierzone przy `frequency 12` i trzech fazach bramki: 70–72
 * komórki po stronie jasnej i 72 po ciemnej, w każdej fazie.
 */
export interface BoundaryCells {
  /** Komórki oświetlone (`light > 0`) mające ciemnego sąsiada. */
  readonly lit: readonly number[];
  /** Komórki nieoświetlone (`light === 0`) mające oświetlonego sąsiada. */
  readonly dark: readonly number[];
}

export function findBoundaryCells(cells: readonly Cell[], light: Float32Array): BoundaryCells {
  const lit: number[] = [];
  const dark: number[] = [];
  for (const cell of cells) {
    const selfLit = light[cell.id] > 0;
    let touchesOtherSide = false;
    for (const neighborId of cell.neighbors) {
      if ((light[neighborId] > 0) !== selfLit) {
        touchesOtherSide = true;
        break;
      }
    }
    if (!touchesOtherSide) continue;
    (selfLit ? lit : dark).push(cell.id);
  }
  return { lit, dark };
}

/**
 * Wybiera `count` elementów ROZŁOŻONYCH równomiernie po `items` (indeksy
 * `floor(i·len/count) + offset`, modulo długość), nie pierwsze `count` z brzegu ani losowe.
 * Deterministyczne: te same wejścia dają zawsze to samo wyjście — bramka ma być odtwarzalna
 * dla drugiej sesji człowieka, nie za każdym razem inna.
 *
 * `offset` daje ROZŁĄCZNE plany prób z tego samego pierścienia granicznego. Bramka potrzebuje
 * trzech planów (oceniany, porównawczy, kontrolny) i one MUSZĄ używać innych komórek: gdyby
 * plan kontrolny pytał o te same komórki co oceniany, człowiek znałby odpowiedzi z
 * odsłonięcia poprzedniego przebiegu i kontrola mierzyłaby jego pamięć, nie czytelność.
 * Rozłączność jest własnością liczb, nie nadzieją: przy kroku `floor(len/count)` ≥ liczba
 * planów kolejne przesunięcia nie mogą trafić w te same indeksy — pilnuje tego strażnik
 * w `createReadabilityGate` (który sprawdza rozłączność WPROST, na gotowych planach) i
 * test #8 w `terminatorPairs.test.ts`.
 *
 * @throws {RangeError} gdy `count` nie jest dodatnią liczbą całkowitą, gdy `offset` nie jest
 *   nieujemną liczbą całkowitą, albo gdy `items` ma mniej elementów niż `count` — cichy zwrot
 *   krótszej listy oznaczałby, że bramka „PASS wymaga kompletu piętnastu" mogłaby po cichu
 *   dostać mniej niż piętnaście prób.
 */
export function selectSpread<T>(items: readonly T[], count: number, offset = 0): T[] {
  if (!(Number.isInteger(count) && count > 0)) {
    throw new RangeError(`selectSpread: count must be a positive integer, got ${count}`);
  }
  if (!(Number.isInteger(offset) && offset >= 0)) {
    throw new RangeError(`selectSpread: offset must be a non-negative integer, got ${offset}`);
  }
  if (items.length < count) {
    throw new RangeError(`selectSpread: need ${count} items, only ${items.length} available`);
  }
  const selected: T[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(items[(Math.floor((i * items.length) / count) + offset) % items.length]);
  }
  return selected;
}

/**
 * Jedna próba bramki czytelności: faza słońca + JEDNA zaznaczona komórka + prawda o niej.
 *
 * **Jedna komórka, nie para — i na tym polega cała zmiana Fazy 2B (spec Fazy 2A, §7.3.3).**
 * Bramka 2A pokazywała dwie SĄSIADUJĄCE komórki i pytała, która z nich jest oświetlona. To
 * pytanie LOKALNE: sprowadza się do „wskaż jaśniejszą" i jest rozwiązywalne przy DOWOLNEJ
 * monotonicznej palecie, więc przechodziło także przy cieniowaniu, które Faza 0 zmierzyła
 * jako nieczytelne. Pojedyncza komórka odbiera tę strategię: bez drugiej komórki w kadrze
 * nie ma czego z czym porównać, więc jedyną informacją, która na to pytanie odpowiada, jest
 * POŁOŻENIE GRANICY na kuli — a to jest własność globalna, dokładnie ta, o której mówi D1.
 */
export interface GateTrial {
  /** Indeks fazy słońca w tablicy `sunDirs` przekazanej do `buildGateTrials` (0-bazowany). */
  readonly phaseIndex: number;
  readonly sunDir: Vec3;
  readonly cellId: number;
  /** Prawda z symulacji: `light[cellId] > 0`. Nie z pasma renderu — patrz komentarz modułu. */
  readonly lit: boolean;
}

/**
 * Ziarno przeplotu jasna/ciemna. Stałe, więc plan jest odtwarzalny; NIE zależy od `offset`,
 * więc wszystkie plany biorą z każdej fazy tyle samo komórek jasnych i tyle samo ciemnych —
 * a od tego zależy dowód rozłączności planów (patrz `selectSpread`): przy TEJ SAMEJ liczbie
 * pobrań krok wyboru jest ten sam, więc przesunięcia 0/1/2 nie mogą trafić w te same indeksy.
 */
const LIT_PATTERN_SEED = 0x48454c49; // "HELI"

/**
 * Maska „która próba dotyczy komórki oświetlonej": ZRÓWNOWAŻONA (`ceil(total/2)` jasnych) i
 * PRZETASOWANA deterministycznie.
 *
 * **Zrównoważenie i nieprzewidywalność to dwa różne wymogi i oba są konieczne.**
 * Zrównoważenie odbiera strategię „odpowiadaj zawsze OŚWIETLONA": bez niego plan złożony
 * z samych komórek jasnych dawałby komplet trafień bez patrzenia na ekran. Ale pierwsza
 * wersja tej funkcji realizowała je NAPRZEMIENNIE (`ordinal % 2 === 0`) — i wtedy cała
 * sekwencja odpowiedzi jest odgadywalna z jednej reguły, więc znów daje się przejść bramkę
 * bez patrzenia, tylko innym skrótem. Wada wyszła przy pierwszej własnej próbie w trybie
 * kontrolnym: znając regułę, znało się komplet odpowiedzi.
 *
 * Tasowanie jest Fisher–Yates na `Rng` (xoshiro128**, `@heliopolis/sim`) — tym samym
 * generatorze, którego używa symulacja, więc plan jest identyczny na każdej platformie i w
 * każdej sesji człowieka.
 */
function buildLitMask(total: number): boolean[] {
  const litCount = Math.ceil(total / 2);
  const mask = Array.from({ length: total }, (_, i) => i < litCount);
  const rng = new Rng(LIT_PATTERN_SEED);
  for (let i = total - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = mask[i];
    mask[i] = mask[j];
    mask[j] = tmp;
  }
  return mask;
}

/**
 * Buduje plan prób: dla KAŻDEGO `sunDir` wybiera `cellsPerPhase` komórek przylegających do
 * granicy, rozłożonych równomiernie po pierścieniu, o stronach zadanych przez `buildLitMask`.
 *
 * Przy `cellsPerPhase = 5` i trzech fazach plan ma 8 komórek jasnych i 7 ciemnych, więc
 * najlepsza stała odpowiedź trafia 8/15, a komplet piętnastu trafień przez zgadywanie ma
 * prawdopodobieństwo 0,5¹⁵ ≈ 0,00003.
 *
 * `offset` przekazywany jest do `selectSpread` i służy WYŁĄCZNIE do budowy rozłącznych planów
 * dla trybów nieocenianych — patrz `selectSpread`.
 */
export function buildGateTrials(
  planet: Planet,
  sunDirs: readonly Vec3[],
  cellsPerPhase: number,
  offset = 0,
): GateTrial[] {
  const litMask = buildLitMask(sunDirs.length * cellsPerPhase);
  const trials: GateTrial[] = [];
  for (let phaseIndex = 0; phaseIndex < sunDirs.length; phaseIndex++) {
    const sunDir = sunDirs[phaseIndex];
    const light = lightField(planet, sunDir);
    const { lit, dark } = findBoundaryCells(planet.cells, light);

    // Ile z tej fazy ma być jasnych, a ile ciemnych — policzone Z GÓRY, bo `selectSpread`
    // rozkłada równomiernie po CAŁEJ liście, więc nie da się go wołać po jednym elemencie.
    let wantLitCount = 0;
    for (let i = 0; i < cellsPerPhase; i++) {
      if (litMask[phaseIndex * cellsPerPhase + i]) wantLitCount++;
    }
    const litPicks = wantLitCount > 0 ? selectSpread(lit, wantLitCount, offset) : [];
    const darkPicks =
      cellsPerPhase - wantLitCount > 0 ? selectSpread(dark, cellsPerPhase - wantLitCount, offset) : [];

    let litCursor = 0;
    let darkCursor = 0;
    for (let i = 0; i < cellsPerPhase; i++) {
      const wantsLit = litMask[phaseIndex * cellsPerPhase + i];
      const cellId = wantsLit ? litPicks[litCursor++] : darkPicks[darkCursor++];
      trials.push({ phaseIndex, sunDir, cellId, lit: light[cellId] > 0 });
    }
  }
  return trials;
}
