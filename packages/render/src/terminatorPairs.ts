import type { Cell, Planet, Vec3 } from '@heliopolis/sim';
import { lightField } from '@heliopolis/sim';
import { lightBand } from './shading.js';

/**
 * Para komórek SĄSIADUJĄCYCH (patrz `findTerminatorPairs`), jedna po każdej stronie granicy
 * D1-krytycznej — patrz uzasadnienie doboru granicy przy `findTerminatorPairs` niżej. Same
 * identyfikatory komórek, zero Three.js: `readabilityGate.ts` zamienia je na pozycje w
 * świecie dopiero przy budowie znaczników.
 */
export interface TerminatorPair {
  readonly litCellId: number;
  readonly darkCellId: number;
}

/**
 * Znajduje WSZYSTKIE pary sąsiadujących komórek, które granica D1 stawia po dwóch stronach —
 * jedna faktycznie oświetlona, druga faktycznie nie — z PRAWDZIWEGO `light` (np. z
 * `lightField(planet, sunDirection(...))`), nie z liczb wpisanych ręcznie. To jest most
 * między symulacją a harnessem bramki czytelności (Zadanie 5, Krok 4 briefu): "użyj
 * prawdziwego lightField, żeby znaleźć prawdziwe pary sąsiadów".
 *
 * **Wybór granicy: `lightBand(light) === 0` (noc) kontra `>= 1` (półmrok LUB dzień) — NIE
 * granica między pasmem 1 i 2.** To jest decyzja, nie przypadek, i jest tu udokumentowana,
 * bo od niej zależy, CO ta bramka w ogóle mierzy:
 *
 * 1. **To jest granica WIDZIANA — granica pasma, a nie granica `dot <= 0`.** Pasmo 0 to
 *    `light < LIGHT_BANDS[0]` (dziś 0,05), czyli noc PLUS wąski rąbek świtu, którego
 *    symulacja nie uznaje za noc. Wcześniejsza wersja tego komentarza mówiła "pasmo 0 to
 *    DOKŁADNIE `dot <= 0`" — to było NIEPRAWDĄ i zostało zmierzone (spec §4.1): przez 12
 *    faz słońca w szczelinę `0 < light < 0,05` wpada od 8 do 38 komórek (4,28% tych, które
 *    symulacja traktuje jako oświetlone). Bramka mierzy więc granicę, którą widzi OKO — i
 *    to jest właściwa rzecz do mierzenia dla D1, bo D1 mówi o tym, co gracz czyta wzrokiem
 *    — ale to NIE jest ta sama linia, co granica, po której decyduje symulacja
 *    (`light[cellId] > 0` w `spawning.ts`, `burning.ts`, `movement.ts`).
 *
 *    Wybór granicy pasmowej pozostaje właściwy: kryterium bramki (§8.1, cytowane w briefie)
 *    brzmi "ta świeci, ta nie" — dwuwartościowe z natury, a pasma 1 i 2 to dwa poziomy TEGO
 *    SAMEGO stanu "coś świeci". Konsekwencja, którą trzeba znać czytając wynik: w 6 z 15
 *    zapisanych prób komórka oznaczona jako "ciemna" jest dla symulacji OŚWIETLONA (spec
 *    §4.1). Bramka nadal bada granicę dnia i nocy tak, jak ją widać — ale nie orzeka o tym,
 *    gdzie ją stawia symulacja.
 * 2. **To jest granica o mocnym kontraście barwnym, nie o słabym.** Przegląd Zadania 3 zmierzył
 *    odległości barwne palety: noc↔półmrok Δodcienia 155,9° (kontrast WCAG 5,60), noc↔dzień
 *    178,3° (kontrast 16,24) — obie mocno rozdzielone. Półmrok↔dzień rozdziela się tylko Δ22,4°
 *    i kontrastem 2,90, PONIŻEJ progu 3:1 z UI — to granica czysto estetyczna (Faza 4), nie
 *    D1-owa. Dobierając granicę noc/(półmrok LUB dzień), ten harness bada WYŁĄCZNIE granicę,
 *    o której mówi D1 — nigdy przypadkiem nie testuje granicy estetycznej półmrok↔dzień.
 *
 * Każda nieskierowana krawędź sąsiedztwa liczona DOKŁADNIE RAZ: pętla po `cell.neighbors`
 * pomija sąsiadów o mniejszym `id` (już odwiedzeni z ich własnej strony) — bezpieczne, bo
 * sąsiedztwo w `@heliopolis/sim` jest symetryczne (zweryfikowane w Fazie 0, §6: "asymetryczne
 * krawędzie sąsiedztwa: 0").
 */
export function findTerminatorPairs(cells: readonly Cell[], light: Float32Array): TerminatorPair[] {
  const pairs: TerminatorPair[] = [];
  for (const cell of cells) {
    const selfLit = lightBand(light[cell.id]) >= 1;
    for (const neighborId of cell.neighbors) {
      if (neighborId <= cell.id) continue; // każda krawędź nieskierowana raz, od mniejszego id
      const neighborLit = lightBand(light[neighborId]) >= 1;
      if (selfLit === neighborLit) continue; // obie strony po tej samej stronie granicy — nie terminator
      pairs.push(
        selfLit ? { litCellId: cell.id, darkCellId: neighborId } : { litCellId: neighborId, darkCellId: cell.id },
      );
    }
  }
  return pairs;
}

/**
 * Wybiera `count` par ROZŁOŻONYCH równomiernie po tablicy `pairs` (indeksy
 * `floor(i·len/count)`), nie pierwsze `count` z brzegu ani losowe. `findTerminatorPairs`
 * odwiedza komórki w kolejności ich `id`, która w tej geometrii jest z grubsza (nie ściśle)
 * przestrzennie spójna lokalnie — równe rozstawienie indeksów w wyniku daje próbki z różnych
 * fragmentów pierścienia terminatora zamiast piętnastu par stłoczonych w jednym jego
 * zakątku. Deterministyczne (ten sam `pairs` i `count` dają zawsze te same pary) — bramka
 * czytelności ma być odtwarzalna dla drugiej sesji człowieka, nie za każdym razem inna.
 *
 * @throws {RangeError} gdy `count` nie jest dodatnią liczbą całkowitą, albo gdy `pairs` ma
 *   mniej elementów niż `count` — cichy zwrot krótszej niż zamówiona listy oznaczałby, że
 *   bramka "PASS wymaga kompletu piętnastu" mogłaby po cichu dostać mniej niż piętnaście prób.
 */
export function selectSpreadPairs(pairs: readonly TerminatorPair[], count: number): TerminatorPair[] {
  if (!(Number.isInteger(count) && count > 0)) {
    throw new RangeError(`selectSpreadPairs: count must be a positive integer, got ${count}`);
  }
  if (pairs.length < count) {
    throw new RangeError(`selectSpreadPairs: need ${count} straddling pairs, only ${pairs.length} available`);
  }
  const selected: TerminatorPair[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(pairs[Math.floor((i * pairs.length) / count)]);
  }
  return selected;
}

/** Jedna próba bramki czytelności: faza słońca + para komórek do oznaczenia. */
export interface GateTrial {
  /** Indeks fazy słońca w tablicy `sunDirs` przekazanej do `buildGateTrials` (0-bazowany). */
  readonly phaseIndex: number;
  readonly sunDir: Vec3;
  readonly pair: TerminatorPair;
}

/**
 * Buduje pełny plan prób bramki czytelności: dla KAŻDEGO `sunDir` w `sunDirs`, liczy
 * `lightField` PRAWDZIWEJ planety, znajduje pary graniczne (`findTerminatorPairs`) i wybiera
 * z nich `pairsPerPhase` rozłożonych równomiernie (`selectSpreadPairs`). `apps/client/src/
 * gate.ts` woła to raz z trzema fazami słońca (§8.1: "trzy różne fazy słońca") i
 * `pairsPerPhase = 5`, dając piętnaście prób — ale ta funkcja sama nie wie nic o liczbie
 * "trzy" ani "pięć": to parametry protokołu tej KONKRETNEJ bramki, nie własność biblioteki.
 */
export function buildGateTrials(planet: Planet, sunDirs: readonly Vec3[], pairsPerPhase: number): GateTrial[] {
  const trials: GateTrial[] = [];
  for (let phaseIndex = 0; phaseIndex < sunDirs.length; phaseIndex++) {
    const sunDir = sunDirs[phaseIndex];
    const light = lightField(planet, sunDir);
    const pairs = findTerminatorPairs(planet.cells, light);
    const chosen = selectSpreadPairs(pairs, pairsPerPhase);
    for (const pair of chosen) {
      trials.push({ phaseIndex, sunDir, pair });
    }
  }
  return trials;
}
