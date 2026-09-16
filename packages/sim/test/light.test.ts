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

    // Okno BEZCZYNNE: aktywne czekanie przez tyle, ile trwa jedno okno mierzone. NIE zawiera
    // badanego kodu, więc mierzy WYŁĄCZNIE szum tła procesu — i skaluje się razem z
    // obciążeniem maszyny, bo jego długość bierze się z faktycznego przebiegu pętli.
    const startedAt = performance.now();
    reusedLoop();
    const windowMs = performance.now() - startedAt;
    // Czekanie CAŁKOWITOLICZBOWE, zegar sprawdzany raz na 100 000 iteracji — **nie**
    // `while (performance.now() < end)`, choć tak wygląda `busyWait` w `gcWindows.ts`.
    //
    // `performance.now()` zwraca liczbę ZMIENNOPRZECINKOWĄ, więc w najciaśniejszej pętli
    // boksuje `HeapNumber` na każde wywołanie i **okno BEZCZYNNE alokuje SAMO** — zmierzone
    // 12 cykli na oknie 640 ms, przy realnym szumie tła 0-2. Próg liczony z takiego okna jest
    // luźniejszy, niż deklaruje, i tutaj byłby wprost ŚLEPY: sprawdzone, mutacja alokująca
    // 5768 B na wywołanie (dokładnie tyle, ile `lightField`) mieściła się pod progiem 13.
    // Z tą wersją okno bezczynne daje 0/0/0, próg 1, a ta sama mutacja oblewa.
    //
    // Dlaczego `gcWindows.ts` ma nadal tamtą wersję: tam uczciwe okno zmienia kalibrację
    // progów CAŁEGO pakietu renderu i odsłania odczyt wymagający własnego pomiaru — opisane
    // w tamtym module jako dług Fazy 2C. Suma przycięta do `int32`, żeby została w zakresie
    // Smi (ten sam powód, dla którego wyniki idą do `Float64Array`, a nie do `let sink = 0`).
    let spin = 0;
    const idleLoop = (): void => {
      const end = performance.now() + windowMs;
      do {
        for (let i = 0; i < 100_000; i++) spin = (spin + i) | 0;
      } while (performance.now() < end);
    };

    // Trzy okna każdego rodzaju, PRZEPLATANE, żeby wszystkie próbkowały ten sam odcinek
    // czasu i to samo obciążenie.
    const reusedRuns: number[] = [];
    const idleRuns: number[] = [];
    const allocatingRuns: number[] = [];
    for (let round = 0; round < 3; round++) {
      idleRuns.push(cycles(idleLoop));
      reusedRuns.push(cycles(reusedLoop));
      allocatingRuns.push(cycles(allocatingLoop));
    }
    console.log(
      `[GC] lightFieldInto × ${ITERATIONS} — okno ${windowMs.toFixed(0)} ms, BEZCZYNNE: ${idleRuns.join('/')}, ` +
        `mierzone: ${reusedRuns.join('/')}, alokujące: ${allocatingRuns.join('/')} ` +
        `[sufit szumu ${Math.max(...idleRuns)}, próg ${Math.max(...idleRuns) + 1}]`,
    );

    // KONTROLA POZYTYWNA: wariant alokujący MUSI dać wyraźnie niezerowy odczyt w KAŻDYM
    // oknie — inaczej wynik poniżej znaczyłby tyle samo, co wyłączony przyrząd. 115 MB
    // śmieci na okno musi wywołać odśmiecanie w każdym oknie z osobna.
    expect(Math.min(...allocatingRuns)).toBeGreaterThanOrEqual(3);

    // WŁASNOŚĆ: **NIE** `Math.min(...reusedRuns) === 0`. Tamten kształt — „ISTNIEJE okno bez
    // ani jednego cyklu" — jest tym samym wzorcem migającym, który runda naprawcza 2 Zadania
    // 4 usunęła z trzech plików `packages/render/test/` i opisała w
    // `packages/render/test/support/gcWindows.ts`: pyta o to, czy inne pliki testowe akurat
    // nic nie alokowały, bo `GCProfiler` liczy cykle CAŁEGO procesu. To była czwarta, ostatnia
    // kopia; przeżyła tamtą rundę, bo leży w innym pakiecie — akurat w tym pliku, który ta
    // gałąź musiała ratować podniesieniem limitu czasu, czyli w tym, który jako pierwszy
    // odczuwa dołożone obciążenie.
    //
    // Zamiast tego pytamy o to, o co naprawdę chodzi: **żadne okno mierzone nie wychodzi
    // ponad sufit ZMIERZONEGO szumu tła**, plus jeden cykl rozdzielczości przyrządu
    // (`GCProfiler` liczy całe cykle, więc żądanie „ani jednego ponad sufit" czyniłoby test
    // czułym na kwant pomiaru). Asercja jest przy tym MOCNIEJSZA niż poprzednia: wiąże
    // wszystkie okna, nie najlepsze z nich.
    //
    // Modułu `gcWindows.ts` nie da się tu zaimportować: `packages/sim` jest pakietem o ZERO
    // zależnościach (D5) i jego `tsconfig.test.json` ma `rootDir` na katalogu pakietu, więc
    // sięgnięcie do drzewa `packages/render` byłoby i błędem kompilacji, i regresją tej
    // właśnie własności. Wspólny pakiet testowy to decyzja o strukturze, której nie podejmuję
    // na końcu fazy — metoda jest tu odtworzona, źródło nazwane.
    const noiseLimit = Math.max(...idleRuns) + 1;
    expect(Math.max(...reusedRuns), 'lightFieldInto alokuje').toBeLessThanOrEqual(noiseLimit);
    expect(sink[0]).toBeGreaterThan(0); // kontrola: obie pętle faktycznie się wykonały
    // Limit czasu podniesiony z domyślnych 5 s (Faza 2B, Zadanie 3). Ten test wykonuje
    // dziewięć okien po 20 000 wywołań plus okna bezczynne i rozgrzewkę — w izolacji ok. 2,5 s
    // przy sześciu oknach, czyli połowa
    // domyślnego limitu. Vitest uruchamia pliki RÓWNOLEGLE, więc ten zapas zjada każdy
    // nowy plik testowy, który liczy: dołożenie `buildingMesh.test.ts` (0,6 s pracy CPU)
    // wywracało ten test w KAŻDYM przebiegu całego pakietu, choć w izolacji przechodził.
    // Zmieniony jest WYŁĄCZNIE limit czasu — ani jedna asercja, ani liczba iteracji, ani
    // kontrola pozytywna. Alternatywy odrzucone: zmniejszenie liczby iteracji osłabiłoby
    // kontrolę pozytywną (patrz akapit „20 000, nie 2000" wyżej), a wyłączenie
    // równoległości plików spowolniłoby cały pakiet dla jednego testu.
  }, 30_000);
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
