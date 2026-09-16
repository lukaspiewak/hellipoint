import { describe, expect, it } from 'vitest';
import { createPlanet, lightAt, lightField, sunDirection } from '@heliopolis/sim';
import {
  buildGateTrials,
  findBoundaryCells,
  findTerminatorPairs,
  selectSpread,
  type GateTrial,
} from '../src/terminatorPairs.js';

const planet = createPlanet({ seed: 20260915 });
const sun = sunDirection(0, 180);
const light = lightField(planet, sun);

/** Trzy fazy, dokładnie te, których używa `apps/client/src/gate.ts`. */
const gateSunDirs = [0, 1 / 3, 2 / 3].map((f) => sunDirection(f * 180, 180));

/**
 * Prawda o oświetleniu policzona DRUGĄ ŚCIEŻKĄ: `lightAt` per komórka zamiast `lightField`
 * na całej planecie. Testy niżej porównują wynik funkcji z TĄ wartością, nie z tą samą
 * tablicą `light`, którą funkcja dostała na wejściu — inaczej asercja sprawdzałaby własność
 * swojego WEJŚCIA (kształt defektu, który ta gałąź ma już na koncie).
 */
function litByIndependentPath(cellId: number, sunDir: { x: number; y: number; z: number }): boolean {
  return lightAt(planet.cells[cellId].normal, sunDir) > 0;
}

describe('findTerminatorPairs', () => {
  it('1. każda zwrócona para to PRAWDZIWI sąsiedzi (symetrycznie)', () => {
    const pairs = findTerminatorPairs(planet.cells, light);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(planet.cells[p.litCellId].neighbors).toContain(p.darkCellId);
      expect(planet.cells[p.darkCellId].neighbors).toContain(p.litCellId);
    }
  });

  it('2. litCellId jest dla SYMULACJI oświetlona, darkCellId nie — sprawdzone drugą ścieżką (lightAt), nie tą samą tablicą', () => {
    const pairs = findTerminatorPairs(planet.cells, light);
    let checked = 0;
    for (const p of pairs) {
      expect(litByIndependentPath(p.litCellId, sun), `para (${p.litCellId}, ${p.darkCellId})`).toBe(true);
      expect(litByIndependentPath(p.darkCellId, sun), `para (${p.litCellId}, ${p.darkCellId})`).toBe(false);
      checked++;
    }
    expect(checked).toBe(pairs.length);
  });

  it('3. brak duplikatów: liczba par nieuporządkowanych (min,max) równa się liczbie zwróconych par', () => {
    const pairs = findTerminatorPairs(planet.cells, light);
    const keys = new Set(pairs.map((p) => `${Math.min(p.litCellId, p.darkCellId)}-${Math.max(p.litCellId, p.darkCellId)}`));
    expect(keys.size).toBe(pairs.length);
  });

  it('4. [kotwica niezależna od implementacji] liczba par × 2 = liczba krawędzi skierowanych rozbieżnych, liczonych z OBU końców', () => {
    let directed = 0;
    for (const cell of planet.cells) {
      for (const n of cell.neighbors) {
        if (light[cell.id] > 0 !== light[n] > 0) directed++;
      }
    }
    expect(findTerminatorPairs(planet.cells, light).length * 2).toBe(directed);
  });

  it('5. [kontrola pozytywna] planeta bez ani jednej ciemnej komórki nie ma par', () => {
    const allLit = new Float32Array(planet.cells.length).fill(1);
    expect(findTerminatorPairs(planet.cells, allLit)).toEqual([]);
    const allDark = new Float32Array(planet.cells.length);
    expect(findTerminatorPairs(planet.cells, allDark)).toEqual([]);
  });
});

describe('findBoundaryCells', () => {
  it('6. KAŻDA zwrócona komórka ma co najmniej jednego sąsiada po drugiej stronie granicy, a żadna NIEzwrócona nie ma — obie strony implikacji', () => {
    const { lit, dark } = findBoundaryCells(planet.cells, light);
    const returned = new Set([...lit, ...dark]);
    expect(returned.size).toBe(lit.length + dark.length); // żadna komórka nie trafiła na obie listy

    let onBoundary = 0;
    let offBoundary = 0;
    for (const cell of planet.cells) {
      const selfLit = light[cell.id] > 0;
      const touches = cell.neighbors.some((n) => (light[n] > 0) !== selfLit);
      expect(returned.has(cell.id), `komórka ${cell.id}`).toBe(touches);
      if (touches) onBoundary++;
      else offBoundary++;
    }
    // Kontrola pozytywna na sam test: obie gałęzie implikacji faktycznie wystąpiły. Bez tego
    // pętla, w której KAŻDA komórka jest graniczna (albo żadna), przechodziłaby formalnie.
    expect(onBoundary).toBeGreaterThan(0);
    expect(offBoundary).toBeGreaterThan(0);
  });

  it('7. rozdziela komórki po predykacie SYMULACJI (light > 0), sprawdzonym drugą ścieżką', () => {
    const { lit, dark } = findBoundaryCells(planet.cells, light);
    expect(lit.length).toBeGreaterThan(0);
    expect(dark.length).toBeGreaterThan(0);
    for (const id of lit) expect(litByIndependentPath(id, sun), `komórka ${id}`).toBe(true);
    for (const id of dark) expect(litByIndependentPath(id, sun), `komórka ${id}`).toBe(false);
  });

  it('8. każda komórka z listy `lit` tworzy parę z `findTerminatorPairs` — te dwa widoki tej samej granicy się zgadzają', () => {
    const { lit, dark } = findBoundaryCells(planet.cells, light);
    const pairs = findTerminatorPairs(planet.cells, light);
    expect(new Set(pairs.map((p) => p.litCellId))).toEqual(new Set(lit));
    expect(new Set(pairs.map((p) => p.darkCellId))).toEqual(new Set(dark));
  });

  it('9. [kontrola pozytywna] planeta jednolicie oświetlona nie ma komórek granicznych po żadnej stronie', () => {
    const allLit = new Float32Array(planet.cells.length).fill(1);
    expect(findBoundaryCells(planet.cells, allLit)).toEqual({ lit: [], dark: [] });
  });
});

describe('selectSpread', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);

  it('10. rozkłada wybór równomiernie (indeksy floor(i·len/count)), nie bierze pierwszych z brzegu', () => {
    expect(selectSpread(items, 5)).toEqual([0, 20, 40, 60, 80]);
  });

  it('11. offset przesuwa CAŁY wybór o tyle samo i zawija się modulo długość', () => {
    expect(selectSpread(items, 5, 3)).toEqual([3, 23, 43, 63, 83]);
    expect(selectSpread(items, 5, 99)).toEqual([99, 19, 39, 59, 79]); // zawinięcie, nie wyjście poza tablicę
  });

  it('12. plany o różnych offsetach są ROZŁĄCZNE, dopóki offset jest mniejszy niż krok — własność, na której stoi kontrola pozytywna', () => {
    const a = new Set(selectSpread(items, 5, 0));
    const b = new Set(selectSpread(items, 5, 1));
    const c = new Set(selectSpread(items, 5, 2));
    expect([...a].filter((x) => b.has(x))).toEqual([]);
    expect([...a].filter((x) => c.has(x))).toEqual([]);
    expect([...b].filter((x) => c.has(x))).toEqual([]);
    // Kontrola pozytywna: przy offsetach RÓWNYCH wynik jest identyczny — dowód, że test wyżej
    // mierzy działanie offsetu, a nie to, że dwa dowolne wybory zawsze się rozchodzą.
    expect(selectSpread(items, 5, 0)).toEqual(selectSpread(items, 5, 0));
  });

  it('13. count === items.length zwraca WSZYSTKIE, w tej samej kolejności', () => {
    const short = [10, 20, 30];
    expect(selectSpread(short, 3)).toEqual(short);
  });

  it('14. wybiera zawsze DOKŁADNIE `count` RÓŻNYCH elementów, także gdy podział nie jest równy', () => {
    for (const count of [1, 2, 3, 7, 13, 99, 100]) {
      const picked = selectSpread(items, count);
      expect(picked.length).toBe(count);
      expect(new Set(picked).size).toBe(count);
    }
  });

  it('15. rzuca RangeError dla złego count, złego offset i za krótkiej listy', () => {
    expect(() => selectSpread(items, 101)).toThrow(RangeError);
    expect(() => selectSpread(items, 0)).toThrow(RangeError);
    expect(() => selectSpread(items, -1)).toThrow(RangeError);
    expect(() => selectSpread(items, 2.5)).toThrow(RangeError);
    expect(() => selectSpread(items, 5, -1)).toThrow(RangeError);
    expect(() => selectSpread(items, 5, 1.5)).toThrow(RangeError);
    expect(() => selectSpread(items, 5, 0)).not.toThrow(); // kontrola: poprawne wejście przechodzi
  });

  it('16. deterministyczne: wielokrotne wywołania dają ten sam wynik, i jest to wynik PRZYPIĘTY (nie tylko "zgodny sam ze sobą")', () => {
    // Pierwsza wersja tego testu porównywała DWA wywołania. Zmierzone tabelą mutacji: przy
    // mutacji „selectSpread niedeterministyczny" (losowe przesunięcie o 0 albo 1) ten test
    // przechodził — bo dwa losowania trafiają tę samą wartość w połowie przypadków. Był to
    // jedyny test tej gałęzi, którego ŻADNA mutacja nie zabiła; stąd dwie poprawki:
    //
    // (1) wiele powtórzeń zamiast dwóch — prawdopodobieństwo przeoczenia spada z 1/2 do 2⁻¹⁹;
    const first = selectSpread(items, 17, 4);
    for (let i = 0; i < 20; i++) {
      expect(selectSpread(items, 17, 4), `powtórzenie ${i}`).toEqual(first);
    }
    // (2) wartość PRZYPIĘTA — „deterministyczny" znaczy „daje TĘ konkretną listę", a nie
    //     „zgadza się sam ze sobą". Wynik zgodny sam ze sobą daje też funkcja, która zwraca
    //     stale coś zupełnie innego, niż powinna.
    expect(first).toEqual([4, 9, 15, 21, 27, 33, 39, 45, 51, 56, 62, 68, 74, 80, 86, 92, 98]);
  });
});

describe('buildGateTrials — plan prób bramki', () => {
  const trials = buildGateTrials(planet, gateSunDirs, 5);

  it('17. liczba prób = liczba faz × cellsPerPhase, a phaseIndex zgadza się z pozycją w sunDirs', () => {
    expect(trials.length).toBe(15);
    for (let i = 0; i < trials.length; i++) {
      expect(trials[i].phaseIndex).toBe(Math.floor(i / 5));
      expect(trials[i].sunDir).toEqual(gateSunDirs[trials[i].phaseIndex]);
    }
  });

  it('18. KAŻDA komórka planu przylega do granicy (ma sąsiada po drugiej stronie) — pytanie nigdy nie jest trywialne', () => {
    let checked = 0;
    for (const t of trials) {
      const phaseLight = lightField(planet, t.sunDir);
      const selfLit = phaseLight[t.cellId] > 0;
      const neighbors = planet.cells[t.cellId].neighbors;
      expect(neighbors.some((n) => (phaseLight[n] > 0) !== selfLit), `próba komórki ${t.cellId}`).toBe(true);
      checked++;
    }
    expect(checked).toBe(trials.length);
  });

  it('19. plan jest ZRÓWNOWAŻONY: 8 komórek oświetlonych i 7 ciemnych, więc stała odpowiedź daje najwyżej 8/15', () => {
    // To jest własność, na której stoi podłoga zgadywania 0,5¹⁵. Bez przeplotu („zawsze
    // oświetlona") komplet trafień byłby osiągalny bez patrzenia na ekran — i to jest
    // dokładnie ta klasa wady, którą ta bramka naprawia po Fazie 2A.
    const litCount = trials.filter((t) => t.lit).length;
    expect(litCount).toBe(8);
    expect(trials.length - litCount).toBe(7);
    expect(Math.max(litCount, trials.length - litCount)).toBeLessThan(trials.length);
  });

  it('19b. kolejność jasna/ciemna NIE JEST naprzemienna ani okresowa — inaczej komplet trafień daje się uzyskać z jednej reguły, bez patrzenia na ekran', () => {
    // To jest zapis wady, którą ten plan MIAŁ i którą złapała dopiero pierwsza własna próba
    // w trybie kontrolnym: zrównoważenie realizowane przez `ordinal % 2 === 0` daje wprawdzie
    // 8/15 dla stałej odpowiedzi, ale CAŁĄ sekwencję odgadywalną z jednej reguły. Balans i
    // nieprzewidywalność to dwa różne wymogi.
    const flags = trials.map((t) => t.lit);
    const alternating = trials.map((_, i) => i % 2 === 0);
    expect(flags).not.toEqual(alternating);
    expect(flags).not.toEqual(alternating.map((b) => !b));

    // Sekwencja naprzemienna NIE MA ani jednej pary sąsiadujących prób o tej samej stronie.
    // Wymagamy obu rodzajów par — to odróżnia „przetasowana" od „przesunięta o jeden".
    let repeatedLit = 0;
    let repeatedDark = 0;
    for (let i = 1; i < flags.length; i++) {
      if (flags[i] && flags[i - 1]) repeatedLit++;
      if (!flags[i] && !flags[i - 1]) repeatedDark++;
    }
    expect(repeatedLit).toBeGreaterThan(0);
    expect(repeatedDark).toBeGreaterThan(0);

    // Kontrola pozytywna na sam test: ten sam licznik na sekwencji naprzemiennej daje ZERO,
    // więc powyższe „większe od zera" jest odczytem, nie stwierdzeniem, że tak zawsze wychodzi.
    let altRepeats = 0;
    for (let i = 1; i < alternating.length; i++) if (alternating[i] === alternating[i - 1]) altRepeats++;
    expect(altRepeats).toBe(0);
  });

  it('20. pole `lit` niesie PRAWDĘ SYMULACJI dla WŁASNEJ fazy próby — sprawdzone drugą ścieżką (lightAt), i NIEPRAWDĘ dla fazy sąsiedniej', () => {
    // Pierwsza połowa testu łapie „lit wpisane na sztywno". Druga łapie groźniejszy defekt,
    // który w Fazie 2A przeżył cały przegląd: plan zbudowany ze światła JEDNEJ fazy, podpisany
    // trzema. Gdyby tak było, prawda dla fazy własnej i obcej byłaby ta sama.
    let disagreementsWithOtherPhase = 0;
    for (const t of trials) {
      expect(t.lit, `próba komórki ${t.cellId}`).toBe(litByIndependentPath(t.cellId, t.sunDir));
      const otherPhase = gateSunDirs[(t.phaseIndex + 1) % gateSunDirs.length];
      if (litByIndependentPath(t.cellId, otherPhase) !== t.lit) disagreementsWithOtherPhase++;
    }
    expect(disagreementsWithOtherPhase).toBeGreaterThan(0);
  });

  it('21. trzy offsety dają plany ROZŁĄCZNE co do pary (faza, komórka) — dokładnie to, czego potrzebuje kontrola pozytywna', () => {
    const key = (t: GateTrial): string => `${t.phaseIndex}:${t.cellId}`;
    const plans = [0, 1, 2].map((offset) => new Set(buildGateTrials(planet, gateSunDirs, 5, offset).map(key)));
    for (let a = 0; a < plans.length; a++) {
      expect(plans[a].size).toBe(15); // kontrola: plan nie zdegenerował się do powtórzeń
      for (let b = a + 1; b < plans.length; b++) {
        expect([...plans[a]].filter((k) => plans[b].has(k)), `plany ${a} i ${b}`).toEqual([]);
      }
    }
  });

  it('22. deterministyczne: dwa wywołania dają identyczne plany (druga sesja człowieka ma dostać tę samą bramkę)', () => {
    expect(buildGateTrials(planet, gateSunDirs, 5, 1)).toEqual(buildGateTrials(planet, gateSunDirs, 5, 1));
  });

  it('23. propaguje RangeError z selectSpread, gdy faza nie ma dość komórek granicznych', () => {
    expect(() => buildGateTrials(planet, gateSunDirs, 400)).toThrow(RangeError);
  });
});
