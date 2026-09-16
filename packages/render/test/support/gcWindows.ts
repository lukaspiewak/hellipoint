import { GCProfiler } from 'node:v8';

/**
 * Przyrząd do pytania „czy ta funkcja alokuje w pętli renderu", wspólny dla `budget.test.ts`,
 * `buildingMesh.test.ts` i `unitMesh.test.ts` (Faza 2B, Zadanie 4, runda naprawcza 2).
 *
 * ## Dlaczego istnieje: asercja „zero cykli GC" mierzyła ZAJĘTOŚĆ MASZYNY, nie kod
 *
 * Wszystkie trzy pliki stały wcześniej na `expect(Math.min(...okna)).toBe(0)`. Na luźnej
 * maszynie to przechodzi; pod obciążeniem równoległym (a vitest uruchamia pliki RÓWNOLEGLE
 * w jednym procesie) oblewa. Zmierzone w rundzie naprawczej 2, trzy pełne przebiegi pakietu
 * jeden po drugim: 577 zielonych / 1 oblany / 2 oblane. Mechanizm podał własny log testu:
 *
 *     BEZCZYNNE okno: 3/2      ← czekanie i nierobienie NICZEGO
 *     600× update:    0/1/1/1  ← mierzona praca
 *     kontrola:       12/11    ← ta sama praca + jeden obiekt na jednostkę
 *
 * `GCProfiler` liczy cykle CAŁEGO procesu, więc odczyt z okna pomiarowego to
 * `alokacje_mierzonej_pętli + szum tła`. Szum tła w tym pakiecie sięga 2-4 cykli na okno
 * rzędu 100-600 ms — czyli JEST WIĘKSZY od sygnału, którego szukamy. Asercja żądająca zera
 * pyta więc o to, czy inne pliki testowe akurat nic nie alokowały.
 *
 * ## Co mierzy zamiast tego
 *
 * Cztery rodzaje okien, PRZEPLATANE, żeby wszystkie próbkowały ten sam odcinek czasu i to
 * samo obciążenie:
 *
 * | okno | co robi | po co |
 * |---|---|---|
 * | `empty` | pętla `sink += i`, mikrosekundy | podłoga: przyrząd potrafi zwrócić 0 |
 * | `idle` | AKTYWNE czekanie przez tyle, ile trwa okno mierzone | **szum tła**, zmierzony a nie założony |
 * | `measured` | funkcja badana | sygnał |
 * | `control` | ta sama praca + jedna alokacja na iterację | **czułość**: przyrząd widzi alokację |
 *
 * Okno `idle` jest tu kluczowe i to ono było wcześniej ZAŁOŻONE (jako zero), zamiast
 * zmierzone. Jego długość bierze się z faktycznego czasu jednego przebiegu pętli mierzonej,
 * więc skaluje się razem z obciążeniem maszyny: pod obciążeniem oba okna rosną tak samo.
 *
 * Asercje ZOSTAJĄ w plikach testowych, nie tutaj — ten moduł dostarcza wyłącznie liczby.
 * Kształt, który wszystkie trzy pliki stosują:
 *
 *     expect(Math.min(...w.empty)).toBe(0);                                   // podłoga
 *     expect(gcMedian(w.control)).toBeGreaterThan(gcMedian(w.measured));      // czułość
 *     expect(Math.max(...w.measured)).toBeLessThanOrEqual(gcNoiseLimit(w));   // własność
 *
 * ## Dlaczego czułość porównuje kontrolę z MIERZONYM, a nie z oknem bezczynnym
 *
 * Do przeglądu gałęzi asercja czułości brzmiała `min(control) > max(idle)` przy `rounds = 2`,
 * czyli zestawiała PODŁOGĘ jednego szumu z SUFITEM drugiego, mając po dwie próbki z każdego.
 * Odtworzone przez przegląd, `unitMesh.test.ts`:
 *
 *     AssertionError: kontrola alokująca nie odstaje od szumu tła: expected 12 to be greater than 16
 *
 * **Pierwsza próba naprawy — mediany zamiast skrajnych, `rounds = 3` — NIE WYSTARCZYŁA i to
 * jest pouczające.** Zmierzone pod obciążeniem (8 procesów alokujących na 10 rdzeniach, trzy
 * pełne przebiegi pakietu):
 *
 *     BEZCZYNNE okno (szum tła): 3/56/42    ← mediana 42
 *     kontrola alokująca:        13/13/13   ← mediana 13
 *
 * To nie jest problem PRÓBKOWANIA, tylko wady przyrządu: **okno bezczynne alokuje więcej niż
 * kontrola alokująca.** `busyWait` niżej odpytuje `performance.now()` w najciaśniejszej możliwej
 * pętli, a ta funkcja zwraca liczbę ZMIENNOPRZECINKOWĄ — każde wywołanie boksuje `HeapNumber`.
 * Przy oknie 500-700 ms to miliony wywołań. Okno bezczynne NIE JEST więc podłogą i żadna
 * statystyka po nim liczona nie zrobi z niego podłogi.
 *
 * **Właściwym odniesieniem dla kontroli jest okno MIERZONE, nie bezczynne.** `control` to z
 * definicji `measured + jedna alokacja na element`, więc te dwa okna wykonują tę samą pracę,
 * trwają podobnie i biegną pod tym samym obciążeniem — różni je DOKŁADNIE ta jedna rzecz,
 * której widoczności ma dowodzić asercja czułości. Zmierzone pod tym samym obciążeniem, pięć
 * miejsc × trzy przebiegi, **piętnaście na piętnaście z ogromnym zapasem**:
 *
 *     writeCellColors   mierzone 0    kontrola 7
 *     BuildingLayer     mierzone 0    kontrola 8
 *     UnitLayer         mierzone 1    kontrola 11-12
 *     updateColors      mierzone 0    kontrola 13-22
 *     pełna scena       mierzone 2-3  kontrola 147
 *
 * Mediany (`rounds = 3`) zostają jako odporność na pojedyncze błądzące okno; nośnikiem naprawy
 * jest zmiana ODNIESIENIA. Przyrząd naprawdę ślepy dalej oblewa — sprawdzone mutacją, w której
 * okno kontrolne mierzy pętlę NIEALOKUJĄCĄ: oblewa we wszystkich pięciu miejscach naraz.
 *
 * Podniesienie `rounds` NIE rozluźnia progu własności: próg to `max(idle) + 1`, a sprawdzana
 * wielkość to `max(measured)` — obie strony dostają tyle samo nowych próbek, więc rosną razem.
 *
 * ## ZNANE OGRANICZENIE tego przyrządu — ODTWORZONE POZA VITEST, dług Fazy 2C
 *
 * `busyWait` niżej odpytuje `performance.now()` w najciaśniejszej możliwej pętli, a ta funkcja
 * zwraca liczbę ZMIENNOPRZECINKOWĄ — więc **samo okno bezczynne alokuje** (boksowanie
 * `HeapNumber` na wywołanie; przy oknie 500-700 ms to miliony wywołań). Skutek:
 * `gcNoiseLimit` jest zawyżony o artefakt przyrządu, czyli **własność jest pilnowana luźniej,
 * niż deklaruje jej nazwa.** Wersja czekająca na liczbach CAŁKOWITYCH (zegar odpytywany raz na
 * 100 000 iteracji) sprowadza okno bezczynne do zera i stoi w `packages/sim/test/light.test.ts`,
 * gdzie była konieczna.
 *
 * ### Co ten artefakt zasłania — zmierzone POZA vitest, osobnym procesem
 *
 * Sonda: `GCProfiler`, okno bezczynne całkowitoliczbowe, warstwy z `dist`, 400 klatek
 * rozgrzewki, trzy powtórzenia każdego okna
 * (`.superpowers/sdd/2026-09-15-faza-2b-jednostki-i-budynki/wykonawca-gcprobe.mjs`):
 *
 *                            2000 iteracji   8000 iteracji
 *     updateColors               0/0/0           0/0/0
 *     buildings.update           0/0/0           0/0/0
 *     units.update             **1/1/1**       **5/5/5**
 *     PEŁNA KLATKA               2/1/1           5/5/5
 *     okno BEZCZYNNE (do 1200 ms)  0/0/0
 *
 * Czyli: **alokuje wyłącznie `UnitLayer.update`**, liczba cykli rośnie LINIOWO z liczbą
 * wywołań (4× iteracji → 5× cykli), a pełna klatka nie dokłada nic ponad warstwę jednostek.
 * Druga sonda (4000 wywołań, różna populacja) pokazuje, że skaluje się z LICZBĄ JEDNOSTEK,
 * nie z liczbą wywołań: `0 → 0/0/0`, `1 → 0/0/0`, `100 → 1/0/1`, `481 → 2/3/2`,
 * `2048 → 11/10/10`. Rząd wielkości: jeden cykl na ok. 800 tysięcy przepisanych jednostek.
 *
 * **Czego NIE ustaliłem:** która linia `update` alokuje. Pętla pisze wyłącznie do buforów
 * typowanych, a `writeInstance`, `writeUnitRimColor` i `writeUnitCoreColor` też. Wskazanie
 * winowajcy wymaga profilowania sterty albo `--trace-gc`, i to jest praca na kodzie
 * produkcyjnym — nie do zrobienia przy domykaniu gałęzi z werdyktem SCALIĆ.
 *
 * **Skala:** 0,0015 cyklu na klatkę wobec 0,0735 w kontroli tego samego testu, czyli 50 razy
 * poniżej progu wykrywalności zdefiniowanego przez kontrolę pozytywną. To NIE jest problem
 * budżetu 8 ms. Problemem jest wyłącznie to, że test twierdzi więcej, niż mierzy — i dlatego
 * poprawione są TYTUŁY testów (mówią teraz „nie wychodzi ponad zmierzoną podłogę szumu"),
 * a nie próg.
 *
 * **Kalibracja progu zostaje ta sama, co przy wszystkich pomiarach tej fazy.** Asercja
 * CZUŁOŚCI już od niej nie zależy (patrz wyżej): jej odniesieniem jest okno mierzone, więc
 * artefakt okna bezczynnego nie przewraca jej ani pod obciążeniem, ani bez.
 *
 * ### Uwaga dla następnego, kto to będzie mierzył: `PerformanceObserver` tu NIE DZIAŁA
 *
 * Sonda oparta na `new PerformanceObserver(...).observe({ entryTypes: ['gc'] })` zwraca
 * **zero dla KAŻDEGO okna synchronicznego** — sprawdzone kontrolą pozytywną na pętli
 * alokującej 115 MB śmieci: obserwator 0, `GCProfiler` 4 na tej samej pętli, i 0 także po
 * oddaniu sterowania pętli zdarzeń (`wykonawca-gcprobe-kontrola.mjs`). Odczyt „same zera"
 * z takiej sondy nie jest pomiarem braku alokacji, tylko przyrządem bez kontroli pozytywnej.
 *
 * ## Dlaczego próg stoi na OKNIE BEZCZYNNYM, a nie w połowie drogi do kontroli
 *
 * Pierwsza wersja tej poprawki liczyła próg jako środek między sufitem szumu a podłogą
 * kontroli. **Mutacja go przebiła i to jest pouczające:** kontrola nie jest niezależną
 * miarką, tylko `mierzona praca + jedna alokacja na element`. Gdy sama mierzona praca zaczyna
 * alokować, kontrola rośnie RAZEM z nią i podnosi próg. Zmierzone na mutacji
 * `Math.sqrt → Math.hypot` w `unitMesh.ts`: szum 5, mierzone 8, kontrola **19** (czysto: 11),
 * środek 12 — mutacja przeszła. Ta sama pułapka złapała `buildingMesh` (mierzone 11, próg 11,5).
 *
 * Okno BEZCZYNNE tej pułapki nie ma: nie zawiera badanego kodu, więc jego wysokość zależy
 * WYŁĄCZNIE od obciążenia maszyny. `+1` to rozdzielczość przyrządu — `GCProfiler` liczy całe
 * cykle, więc najmniejszą różnicą, jaką umie wyrazić, jest jeden; żądanie „ani jednego ponad
 * sufit szumu" czyniłoby test czułym na pojedynczy błądzący cykl, czyli na kwant pomiaru.
 *
 * Zmierzona rozdzielczość tak postawionego progu (cztery miejsca, po jednej mutacji na każde):
 *
 *     czysto:    szczyt mierzonych 0-1, sufit szumu 1-5  → z zapasem pod progiem
 *     mutacja:   szczyt mierzonych 8-13                  → ponad próg w każdym z czterech
 */
export interface GcWindows {
  /** Okna pustej pętli (mikrosekundy) — podłoga przyrządu. */
  readonly empty: readonly number[];
  /** Okna AKTYWNEGO czekania o długości okna mierzonego — szum tła. */
  readonly idle: readonly number[];
  /** Okna mierzonej pętli. Więcej niż rund, bo każda runda mierzy też PO kontroli. */
  readonly measured: readonly number[];
  /** Okna wariantu alokującego — kontrola pozytywna. */
  readonly control: readonly number[];
  /** Zmierzona długość jednego okna mierzonego, w milisekundach. */
  readonly windowMs: number;
}

export interface GcLoops {
  /** Pętla, która na pewno nie alokuje i trwa mikrosekundy. */
  empty(): void;
  /** Pętla badana. */
  measured(): void;
  /** Ta sama praca plus JEDNA alokacja na iterację. */
  control(): void;
}

function cyclesDuring(run: () => void): number {
  const profiler = new GCProfiler();
  profiler.start();
  run();
  return profiler.stop().statistics.length;
}

/**
 * Mierzy cztery rodzaje okien, przeplatane, `rounds` razy. Wywołujący odpowiada za
 * rozgrzewkę JIT PRZED wywołaniem — pomiar dotyczy stanu ustabilizowanego, a faza
 * kompilacji alokuje z natury (kod, feedback vectors).
 */
export function measureGcWindows(loops: GcLoops, rounds = 3): GcWindows {
  // Długość okna mierzona na FAKTYCZNYM przebiegu, nie szacowana — pod obciążeniem
  // równoległym rośnie razem z nim, więc okno bezczynne zawsze odpowiada oknu mierzonemu.
  // Ten przebieg nie jest liczony do wyniku.
  const started = performance.now();
  loops.measured();
  const windowMs = performance.now() - started;
  const busyWait = (): void => {
    const end = performance.now() + windowMs;
    while (performance.now() < end) {
      /* nic — okno odniesienia dla szumu tła */
    }
  };

  const empty: number[] = [];
  const idle: number[] = [];
  const measured: number[] = [];
  const control: number[] = [];
  for (let round = 0; round < rounds; round++) {
    empty.push(cyclesDuring(loops.empty));
    idle.push(cyclesDuring(busyWait));
    measured.push(cyclesDuring(loops.measured));
    control.push(cyclesDuring(loops.control));
    // Powtórka PO kontroli: zero nie ma być artefaktem kolejności („sterta akurat była
    // świeżo posprzątana"), tylko własnością mierzonej funkcji.
    measured.push(cyclesDuring(loops.measured));
  }
  return { empty, idle, measured, control, windowMs };
}

/**
 * Mediana próbek — statystyka ODPORNA na jedno błądzące okno, używana przez asercję CZUŁOŚCI.
 * Dla parzystej liczby próbek średnia dwóch środkowych; przy `rounds = 3` (domyślnych) okna
 * `idle` i `control` mają po trzy próbki, więc jest to prawdziwy środek.
 *
 * @throws {RangeError} dla pustego wejścia — pusty odczyt to „nie mierzone", nie „zero", a
 *   cicha `NaN`-owa mediana przeszłaby porównanie `>` jako `false` bez podania przyczyny.
 */
export function gcMedian(samples: readonly number[]): number {
  if (samples.length === 0) {
    throw new RangeError('gcMedian: empty sample list — nothing was measured');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Wiersz do logu — te same pola w trzech plikach, żeby dało się je zestawiać. */
export function describeGcWindows(w: GcWindows): string {
  const j = (a: readonly number[]): string => a.join('/');
  return (
    `okno ${w.windowMs.toFixed(0)} ms — pusta pętla: ${j(w.empty)}, BEZCZYNNE okno (szum tła): ${j(w.idle)}, ` +
    `mierzone: ${j(w.measured)}, kontrola alokująca: ${j(w.control)} ` +
    `[sufit szumu ${Math.max(...w.idle)}, mediana szumu ${gcMedian(w.idle)}, ` +
    `mediana kontroli ${gcMedian(w.control)}, próg ${gcNoiseLimit(w)}, ` +
    `szczyt mierzonych ${Math.max(...w.measured)}]`
  );
}

/**
 * Próg własności: sufit zmierzonego szumu tła plus jeden cykl rozdzielczości przyrządu.
 * Wysokość progu NIE zależy od badanego kodu — okno bezczynne go nie zawiera — więc defekt
 * w mierzonej pętli nie może podnieść progu razem ze sobą. Uzasadnienie i pomiar mutacji,
 * która przebiła poprzednią wersję progu: komentarz modułu wyżej.
 */
export function gcNoiseLimit(w: GcWindows): number {
  return Math.max(...w.idle) + 1;
}
