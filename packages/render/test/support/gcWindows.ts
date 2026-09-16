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
 *     expect(Math.min(...w.control)).toBeGreaterThan(Math.max(...w.idle));    // czułość
 *     expect(Math.max(...w.measured)).toBeLessThanOrEqual(gcNoiseLimit(w));   // własność
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
export function measureGcWindows(loops: GcLoops, rounds = 2): GcWindows {
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

/** Wiersz do logu — te same pola w trzech plikach, żeby dało się je zestawiać. */
export function describeGcWindows(w: GcWindows): string {
  const j = (a: readonly number[]): string => a.join('/');
  return (
    `okno ${w.windowMs.toFixed(0)} ms — pusta pętla: ${j(w.empty)}, BEZCZYNNE okno (szum tła): ${j(w.idle)}, ` +
    `mierzone: ${j(w.measured)}, kontrola alokująca: ${j(w.control)} ` +
    `[sufit szumu ${Math.max(...w.idle)}, podłoga kontroli ${Math.min(...w.control)}, ` +
    `próg ${gcNoiseLimit(w)}, szczyt mierzonych ${Math.max(...w.measured)}]`
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
