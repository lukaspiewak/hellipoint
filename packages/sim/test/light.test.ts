import { describe, expect, it } from 'vitest';
import { GCProfiler } from 'node:v8';
import { lightAt, lightField, lightFieldInto, sunDirection } from '../src/sim/light.js';
import { length, vec3 } from '../src/math/vec3.js';
import { createPlanet } from '../src/world/planet.js';

const T = 180;

describe('sunDirection', () => {
  it('jest wektorem jednostkowym w każdej chwili', () => {
    for (const t of [0, 45, 90, 123.4, T, 2 * T]) {
      expect(length(sunDirection(t, T))).toBeCloseTo(1, 12);
    }
  });

  it('ma okres równy okresowi obrotu', () => {
    const a = sunDirection(37, T);
    const b = sunDirection(37 + T, T);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
  });

  it('po pół okresie wskazuje przeciwnie', () => {
    const a = sunDirection(0, T);
    const b = sunDirection(T / 2, T);
    expect(b.x).toBeCloseTo(-a.x, 9);
    expect(b.y).toBeCloseTo(-a.y, 9);
    expect(b.z).toBeCloseTo(-a.z, 9);
  });

  it('wyrzuca błąd dla rotationPeriod <= 0 lub nieskończonego', () => {
    expect(() => sunDirection(0, 0)).toThrow(RangeError);
    expect(() => sunDirection(0, -180)).toThrow(RangeError);
    expect(() => sunDirection(0, NaN)).toThrow(RangeError);
    expect(() => sunDirection(0, Infinity)).toThrow(RangeError);
    expect(() => sunDirection(0, -Infinity)).toThrow(RangeError);
  });

  // Regresja na Important #3 z przeglądu końcowego Fazy 1B: odłożone wcześniej na
  // fałszywej przesłance "nieskończoność da głośny NaN". Zmierzone: nie daje — `lightAt`
  // robi `d > 0 ? d : 0`, a `NaN > 0` jest `false`, więc CAŁA planeta cicho ląduje na
  // dokładnym 0.0 (trwała ciemność, zero komórek z NaN) — bajt w bajt ten sam tryb
  // awarii co `rotationPeriod = 0`, który kosztował tę fazę dwie rundy.
  it('wyrzuca błąd dla elapsedSeconds NaN lub nieskończonego', () => {
    expect(() => sunDirection(NaN, T)).toThrow(RangeError);
    expect(() => sunDirection(Infinity, T)).toThrow(RangeError);
    expect(() => sunDirection(-Infinity, T)).toThrow(RangeError);
  });

  // Residual z przeglądu końcowego Fazy 1B (trzecie wystąpienie tego trybu awarii):
  // `rotationPeriod = 1e-320` jest finite i > 0 — przechodzi OBIE powyższe straże —
  // ale `angle = (2π·elapsedSeconds)/rotationPeriod` przepełnia się do Infinity.
  // `Math.cos(Infinity)`/`Math.sin(Infinity)` dają NaN, a `lightAt` robi `d > 0 ? d : 0`,
  // gdzie `NaN > 0` jest `false` — więc PRZED tą strażą cała planeta cicho gasła do
  // dokładnego 0.0, zero komórek z NaN, zero błędu (zmierzone w raporcie naprawy).
  // Straży pilnuje `angle` w miejscu, gdzie faktycznie staje się zły, nie argumenty.
  it('wyrzuca błąd, gdy angle przepełnia się do Infinity mimo że oba argumenty są finite i dodatnie', () => {
    expect(() => sunDirection(0.05, 1e-320)).toThrow(RangeError);
    // Komunikat musi nazywać OBA wejścia, żeby przyczyna była widoczna, nie tylko skutek.
    expect(() => sunDirection(0.05, 1e-320)).toThrow(/0\.05/);
    expect(() => sunDirection(0.05, 1e-320)).toThrow(/1e-320/);
  });
});

describe('lightAt', () => {
  const sun = vec3(1, 0, 0);

  it('daje 1 zwrócone prosto w słońce', () => {
    expect(lightAt(vec3(1, 0, 0), sun)).toBeCloseTo(1, 12);
  });

  it('daje 0 na terminatorze', () => {
    expect(lightAt(vec3(0, 0, 1), sun)).toBeCloseTo(0, 12);
  });

  it('daje wartość pośrednią dla kąta pośredniego', () => {
    // Normal at 60° to sun: cos(60°) = 0.5
    expect(lightAt(vec3(0.5, 0, 0.866), sun)).toBeCloseTo(0.5, 12);
  });

  it('obcina stronę nocną do 0, nigdy do wartości ujemnej', () => {
    expect(lightAt(vec3(-1, 0, 0), sun)).toBe(0);
    expect(lightAt(vec3(-0.5, 0, 0.866), sun)).toBe(0);
  });
});

describe('lightFieldInto — wariant bez alokacji, do pętli renderu', () => {
  const planet = createPlanet({ seed: 5 });

  it('daje DOKŁADNIE ten sam wynik co lightField, co do bitu', () => {
    for (const t of [0, 37, T / 2, T]) {
      const sunDir = sunDirection(t, T);
      const allocated = lightField(planet, sunDir);
      const reused = new Float32Array(planet.cells.length);
      lightFieldInto(planet, sunDir, reused);
      expect(Array.from(reused), `t=${t}`).toEqual(Array.from(allocated));
    }
  });

  it('nadpisuje CAŁY bufor — po ponownym użyciu nie zostaje ani jedna wartość z poprzedniej fazy', () => {
    // Bufor własności wywołującego jest używany WIELOKROTNIE (na tym polega jego sens), więc
    // pominięcie choćby jednej komórki zostawiłoby w nim wartość z poprzedniej klatki —
    // awaria widoczna jako komórka „zamrożona" w dawnym świetle, nie jako wyjątek.
    const buffer = new Float32Array(planet.cells.length);
    lightFieldInto(planet, sunDirection(0, T), buffer);
    const first = Array.from(buffer);
    lightFieldInto(planet, sunDirection(T / 2, T), buffer);

    const expected = lightField(planet, sunDirection(T / 2, T));
    expect(Array.from(buffer)).toEqual(Array.from(expected));
    // Kontrola pozytywna: obie fazy NAPRAWDĘ dają inne wartości, więc porównanie wyżej
    // rozróżnia „nadpisano" od „zostawiono stare".
    expect(Array.from(buffer)).not.toEqual(first);
  });

  it('rzuca RangeError, gdy długość bufora nie zgadza się z liczbą komórek (wzorzec updatePower)', () => {
    const sunDir = sunDirection(0, T);
    expect(() => lightFieldInto(planet, sunDir, new Float32Array(planet.cells.length))).not.toThrow();
    expect(() => lightFieldInto(planet, sunDir, new Float32Array(planet.cells.length - 1))).toThrow(RangeError);
    expect(() => lightFieldInto(planet, sunDir, new Float32Array(planet.cells.length + 1))).toThrow(RangeError);
    // Komunikat musi nazywać obie długości — inaczej przyczyna jest niewidoczna.
    expect(() => lightFieldInto(planet, sunDir, new Float32Array(3))).toThrow(/3/);
  });

  it('NIE ALOKUJE: 20 000 wywołań nie wywołuje ani jednego cyklu odśmiecania, a lightField wywołuje', () => {
    // Powód istnienia tej funkcji, zmierzony wprost. `apps/client/src/main.ts` woła to w
    // KAŻDEJ klatce pętli renderu; `lightField` alokuje tam `Float32Array(1442)` = 5768 B
    // na klatkę, czyli ok. 346 kB/s przy 60 Hz — wewnątrz tej samej pętli, której czas
    // raportuje licznik klatek, i wbrew dyscyplinie bufora własności wywołującego, którą ta
    // gałąź stosuje wszędzie indziej (`writeCellColors`, `createRollingWindow`).
    //
    // Przyrząd: `v8.GCProfiler` — ten sam co w `packages/render/test/budget.test.ts` i z
    // tego samego powodu: odśmiecanie w V8 uruchamia wyłącznie alokacja, a mierzona pętla
    // jest w pełni synchroniczna, więc nic innego w izolacie nie może jej przerwać.
    const sunDir = sunDirection(0, T);
    const buffer = new Float32Array(planet.cells.length);

    // Ujście wyników w `Float64Array`, NIE w zwykłej zmiennej. Zmierzone w tej sesji:
    // `let sink = 0` akumulujące wartości ułamkowe alokuje po jednym `HeapNumber` na
    // przypisanie (liczba niecałkowita nie mieści się w Smi), czyli ~320 kB na 20 000
    // iteracji — dość, by pętla „bez alokacji" pokazała JEDEN cykl odśmiecania i test
    // oblał z powodu samego swojego ujścia. Zapis do komórki tablicy typowanej nie boksuje.
    const sink = new Float64Array(1);

    // Indeks komórki, która przy tej fazie NAPRAWDĘ jest oświetlona. Odczyt akurat spod
    // zera (np. komórki 0) dawałby sumę 0 i kontrola „wywołania się wykonały" nie
    // odróżniałaby się od „V8 usunął je jako martwy kod".
    const probe = lightField(planet, sunDir);
    let litIndex = 0;
    for (let i = 0; i < probe.length; i++) {
      if (probe[i] > 0.5) {
        litIndex = i;
        break;
      }
    }
    expect(probe[litIndex]).toBeGreaterThan(0.5);

    // 20 000, nie 2000: bufor oświetlenia to 5768 B, więc 2000 wywołań `lightField` daje
    // tylko ~11 MB śmieci i ZALEDWIE JEDEN cykl odśmiecania — zmierzone. Kontrola pozytywna
    // opierająca się na jednym cyklu byłaby na granicy szumu. 20 000 wywołań to ok. 115 MB i
    // pewny, wielokrotny odczyt. (W `budget.test.ts` wystarcza 2000, bo tam bufor ma 121 kB.)
    const ITERATIONS = 20_000;
    for (let i = 0; i < 400; i++) {
      lightFieldInto(planet, sunDir, buffer);
      sink[0] += buffer[litIndex] + lightField(planet, sunDir)[litIndex];
    }

    const cycles = (run: () => void): number => {
      const profiler = new GCProfiler();
      profiler.start();
      run();
      return profiler.stop().statistics.length;
    };

    // Obie pętle robią DOKŁADNIE tę samą pracę i czytają tę samą komórkę — jedyna różnica
    // między nimi to świeży bufor na wywołanie kontra bufor własności wywołującego.
    const reusedLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) {
        lightFieldInto(planet, sunDir, buffer);
        sink[0] += buffer[litIndex];
      }
    };
    const allocatingLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) sink[0] += lightField(planet, sunDir)[litIndex];
    };

    // MINIMUM z trzech okien pomiarowych, nie pojedyncze okno. Zmierzone w tej sesji: poza
    // Vitest ta pętla daje zero w KAŻDYM przebiegu, ale pod Vitest jedno okno na kilka
    // pokazuje JEDEN cykl — V8 potrafi dokończyć rozpoczęte wcześniej znakowanie
    // przyrostowe na przerwaniu kontroli stosu w środku długiej pętli, niezależnie od tego,
    // czy ta pętla cokolwiek alokuje. Własność, którą naprawdę mierzymy, brzmi więc: ISTNIEJE
    // okno 20 000 synchronicznych wywołań, w którym nie zdarzył się ani jeden cykl. Dla
    // funkcji alokującej 5768 B na wywołanie TAKIE OKNO NIE ISTNIEJE — 115 MB śmieci musi
    // wywołać odśmiecanie w każdym oknie z osobna, co pilnuje kontrola pozytywna niżej.
    const reusedRuns = [cycles(reusedLoop), cycles(reusedLoop), cycles(reusedLoop)];
    const allocatingRuns = [cycles(allocatingLoop), cycles(allocatingLoop), cycles(allocatingLoop)];

    // KONTROLA POZYTYWNA: wariant alokujący MUSI dać wyraźnie niezerowy odczyt w KAŻDYM
    // oknie — inaczej „zero" poniżej znaczyłoby tyle samo, co wyłączony przyrząd.
    expect(Math.min(...allocatingRuns)).toBeGreaterThanOrEqual(3);
    expect(Math.min(...reusedRuns)).toBe(0);
    expect(sink[0]).toBeGreaterThan(0); // kontrola: obie pętle faktycznie się wykonały
  });
});

describe('lightField', () => {
  const planet = createPlanet({ seed: 5 });

  it('daje jedną wartość na komórkę, wszystkie w [0,1]', () => {
    const f = lightField(planet, sunDirection(0, T));
    expect(f.length).toBe(planet.cells.length);
    for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('dzieli planetę na mniej więcej równe połowy — brak możliwości globalnej nocy (D1)', () => {
    // Test validates that the lit/dark split is roughly even (~50/50),
    // disproving a "global night phase". Orientation is pinned by lightAt tests.
    const f = lightField(planet, sunDirection(0, T));
    const lit = [...f].filter((v) => v > 0).length;
    expect(lit / f.length).toBeGreaterThan(0.45);
    expect(lit / f.length).toBeLessThan(0.55);
  });

  it('po pół obrocie oświetlone są dokładnie te komórki, które były ciemne', () => {
    const a = lightField(planet, sunDirection(0, T));
    const b = lightField(planet, sunDirection(T / 2, T));
    for (let i = 0; i < a.length; i++) {
      if (a[i] > 0.01) expect(b[i]).toBeLessThan(0.02);
    }
  });
});
