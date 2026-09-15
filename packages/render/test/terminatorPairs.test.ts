import { describe, expect, it } from 'vitest';
import { createPlanet, lightField, sunDirection } from '@heliopolis/sim';
import { lightBand } from '../src/shading.js';
import {
  buildGateTrials,
  findTerminatorPairs,
  selectSpreadPairs,
  type TerminatorPair,
} from '../src/terminatorPairs.js';

// Ta sama planeta-fixture co pozostałe pliki testowe tego pakietu (ten sam seed).
const planet = createPlanet({ seed: 20260915 });
const sun = sunDirection(0, 180);
const light = lightField(planet, sun);

describe('findTerminatorPairs', () => {
  it('1. każda zwrócona para to PRAWDZIWI sąsiedzi (litCellId ∈ neighbors darkCellId, symetrycznie)', () => {
    const pairs = findTerminatorPairs(planet.cells, light);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(planet.cells[p.litCellId].neighbors).toContain(p.darkCellId);
      expect(planet.cells[p.darkCellId].neighbors).toContain(p.litCellId);
    }
  });

  it('2. litCellId zawsze ma pasmo >= 1 (półmrok LUB dzień), darkCellId zawsze pasmo DOKŁADNIE 0 (noc)', () => {
    const pairs = findTerminatorPairs(planet.cells, light);
    for (const p of pairs) {
      expect(lightBand(light[p.litCellId])).toBeGreaterThanOrEqual(1);
      expect(lightBand(light[p.darkCellId])).toBe(0);
    }
  });

  it('3. brak duplikatów: liczba par nieuporządkowanych (min,max) równa się liczbie zwróconych par', () => {
    const pairs = findTerminatorPairs(planet.cells, light);
    const keys = new Set(pairs.map((p) => `${Math.min(p.litCellId, p.darkCellId)}-${Math.max(p.litCellId, p.darkCellId)}`));
    expect(keys.size).toBe(pairs.length);
  });

  it('4. [kotwica niezależna od implementacji] liczba par × 2 = liczba WSZYSTKICH krawędzi skierowanych rozbieżnych (licząc z OBU końców, bez odrzucania duplikatów)', () => {
    // Nie porównuje wyniku z samym sobą (patrz uzasadnienie `expectedVertexCount` w
    // geometry.test.ts): liczy niezależnie, pętlą BEZ pominięcia `neighborId <= cell.id`,
    // więc każda krawędzia granicy jest tu policzona z OBU stron. Gdyby `findTerminatorPairs`
    // gubiło albo podwajało pary, ten iloczyn by się rozjechał.
    let directedMismatches = 0;
    for (const cell of planet.cells) {
      const selfLit = lightBand(light[cell.id]) >= 1;
      for (const n of cell.neighbors) {
        if (lightBand(light[n]) >= 1 !== selfLit) {
          directedMismatches++;
        }
      }
    }
    const pairs = findTerminatorPairs(planet.cells, light);
    expect(pairs.length * 2).toBe(directedMismatches);
  });

  it('5. [kontrola pozytywna] planeta całkowicie oświetlona (sunDir == dowolna normalna, np. brak nocy) — jeśli podać "światło" bez ani jednej ciemnej komórki, par NIE MA', () => {
    // Fixture syntetyczna: wszystkie komórki "w pełni oświetlone" (1) — zero komórek w paśmie
    // 0, więc granica noc/reszta nie istnieje NIGDZIE. Dowód, że funkcja nie zwraca par "na
    // wszelki wypadek" niezależnie od danych wejściowych.
    const allLit = new Float32Array(planet.cells.length).fill(1);
    expect(findTerminatorPairs(planet.cells, allLit)).toEqual([]);
  });
});

describe('selectSpreadPairs', () => {
  // Pary syntetyczne, łatwo rozróżnialne (litCellId = i) — nie prawdziwa geometria, bo ta
  // funkcja o geometrii nic nie wie.
  const synthetic: TerminatorPair[] = Array.from({ length: 10 }, (_, i) => ({ litCellId: i, darkCellId: 100 + i }));

  it('6. rozkłada wybór równomiernie po tablicy (indeksy floor(i·len/count)), nie bierze pierwszych z brzegu', () => {
    const chosen = selectSpreadPairs(synthetic, 5);
    expect(chosen.map((p) => p.litCellId)).toEqual([0, 2, 4, 6, 8]);
  });

  it('7. count === pairs.length zwraca WSZYSTKIE, w tej samej kolejności', () => {
    const chosen = selectSpreadPairs(synthetic, synthetic.length);
    expect(chosen).toEqual(synthetic);
  });

  it('8. rzuca RangeError, gdy count przekracza liczbę dostępnych par', () => {
    expect(() => selectSpreadPairs(synthetic, synthetic.length + 1)).toThrow(RangeError);
  });

  it('9. rzuca RangeError dla count niedodatniego albo niecałkowitego', () => {
    expect(() => selectSpreadPairs(synthetic, 0)).toThrow(RangeError);
    expect(() => selectSpreadPairs(synthetic, -2)).toThrow(RangeError);
    expect(() => selectSpreadPairs(synthetic, 2.5)).toThrow(RangeError);
  });

  it('10. wybiera zawsze DOKŁADNIE `count` par RÓŻNYCH (żaden indeks wybrany dwukrotnie) — także gdy podział nie jest równy', () => {
    // len/count niepodzielne bez reszty — dokładnie ten przypadek, w którym błąd
    // zaokrąglenia mógłby (teoretycznie) wybrać ten sam indeks dwukrotnie.
    for (const [len, count] of [
      [7, 5],
      [11, 5],
      [13, 5],
    ] as const) {
      const pool: TerminatorPair[] = Array.from({ length: len }, (_, i) => ({ litCellId: i, darkCellId: 1000 + i }));
      const chosen = selectSpreadPairs(pool, count);
      expect(chosen.length).toBe(count);
      expect(new Set(chosen.map((p) => p.litCellId)).size).toBe(count);
    }
  });

  it('11. deterministyczne: dwa wywołania z tymi samymi argumentami dają dokładnie ten sam wynik', () => {
    expect(selectSpreadPairs(synthetic, 4)).toEqual(selectSpreadPairs(synthetic, 4));
  });
});

describe('buildGateTrials', () => {
  const sunA = sunDirection(0, 180);
  const sunB = sunDirection(60, 180);
  const trials = buildGateTrials(planet, [sunA, sunB], 3);

  it('12. liczba prób = liczba faz × pairsPerPhase', () => {
    expect(trials.length).toBe(2 * 3);
  });

  it('13. każda próba niesie phaseIndex spójny z pozycją w tablicy sunDirs (0 dla pierwszych 3, 1 dla kolejnych 3)', () => {
    expect(trials.slice(0, 3).every((t) => t.phaseIndex === 0)).toBe(true);
    expect(trials.slice(3, 6).every((t) => t.phaseIndex === 1)).toBe(true);
  });

  it('14. [dowód przeciwko pomyleniu faz] para KAŻDEJ próby faktycznie odpowiada ŚWIATŁU JEJ WŁASNEJ fazy, nie innej', () => {
    // Gdyby buildGateTrials przez pomyłkę policzyło lightField RAZ i użyło go dla obu faz
    // (albo pomieszało który sunDir należy do której), ten test złapałby to: light przeliczone
    // TU, niezależnie, z trial.sunDir, musi zgadzać się z klasyfikacją litCellId/darkCellId.
    for (const trial of trials) {
      const ownLight = lightField(planet, trial.sunDir);
      expect(lightBand(ownLight[trial.pair.litCellId])).toBeGreaterThanOrEqual(1);
      expect(lightBand(ownLight[trial.pair.darkCellId])).toBe(0);
    }
  });

  it('15. sunDir niesiony przez próbę to DOKŁADNIE ten sam obiekt (co do wartości) co w sunDirs[phaseIndex]', () => {
    for (const trial of trials) {
      const expected = [sunA, sunB][trial.phaseIndex];
      expect(trial.sunDir).toEqual(expected);
    }
  });

  it('16. propaguje RangeError z selectSpreadPairs, gdy któraś faza ma za mało par granicznych', () => {
    expect(() => buildGateTrials(planet, [sunA], 100_000)).toThrow(RangeError);
  });
});
