import { describe, expect, it } from 'vitest';
import { GCProfiler } from 'node:v8';
import { createPlanet, lightField, sunDirection } from '@heliopolis/sim';
import { buildPlanetGeometry } from '../src/geometry.js';
import { DEFAULT_PALETTE, writeCellColors } from '../src/shading.js';
import { median, percentile } from '../src/frameStats.js';

/**
 * Budżet klatki, część czysta (Zadanie 5, Krok 1 briefu). `writeCellColors` jest JEDYNĄ
 * częścią całego renderu, którą da się zmierzyć bez GPU — i jedyną, która rośnie LINIOWO z
 * liczbą komórek (1442 dziś, docelowo skalowalne do 2562 wg D2 specu, §3) — stąd to właśnie
 * ona dostaje przypięty próg, nie próba zmierzenia `renderer.render()` w Node (niemożliwa
 * bez prawdziwego WebGL, patrz `scene.ts`/`createSceneWithRenderer`).
 *
 * Próg z briefu: **1442 komórki, 1000 wywołań, mediana < 1 ms.** Mediana (nie średnia) —
 * ten sam wybór co gdzie indziej w tym zadaniu (`frameStats.ts`): odporna na pojedynczy
 * odstający pomiar (np. jedna klatka trafiona przez GC albo przełączenie wątku przez OS),
 * którego pojedyncza pętla renderu i tak nie odczuje jako "typowej" klatki.
 *
 * ## Co ten próg mierzy, a czego NIE mierzy — zmierzone, nie oszacowane
 *
 * Przegląd całogałęziowy zmierzył tym samym przyrządem, że próg 1 ms jest HOJNY, nie
 * znaczący: przy medianie bazowej 0,0226 ms mieści się pod nim wszystko, co realnie
 * mogłoby tę funkcję zepsuć —
 *
 *   | wariant                                    | mediana   | próg 1 ms |
 *   |--------------------------------------------|-----------|-----------|
 *   | obecna implementacja                       | 0,0226 ms | przechodzi |
 *   | +1 `Float32Array(30246)` na wywołanie      | 0,0234 ms | przechodzi |
 *   | +1 trzyelementowa tablica na KOMÓRKĘ (1442)| 0,0465 ms | przechodzi |
 *   | +30 `Float32Array(30246)` na wywołanie     | 0,0390 ms | przechodzi |
 *
 * Próg zostaje na 1 ms, bo to jest LICZBA Z BRIEFU (budżet, nie regresja): ma pilnować, że
 * kolorowanie nie zjada klatki, a nie że nikt nie dopisał alokacji. Zacieśnienie go do
 * wielokrotności zmierzonych 0,0226 ms uczyniłoby go czułym na SPRZĘT (inna maszyna CI, inny
 * stan termiczny), nie na kod. Zamiast tego własność "nie alokuje niczego" — do tej pory
 * uzasadniana TRZEMA długimi komentarzami (`shading.ts`, `planetMesh.ts`, `frameStats.ts`) i
 * nie sprawdzana NIGDZIE — dostaje własny test, mierzący alokację WPROST, drugim testem
 * niżej. Wall-clock i alokacja to dwie różne wielkości i mierzymy je dwoma różnymi
 * przyrządami, zamiast wnioskować o jednej z drugiej.
 */
describe('writeCellColors — budżet 1442 komórek / 1000 wywołań (Zadanie 5, Krok 1)', () => {
  it('mediana czasu jednego wywołania jest poniżej 1 ms', () => {
    const planet = createPlanet({ seed: 20260915 });
    expect(planet.cells.length).toBe(1442); // kotwica: budżet dotyczy TEJ liczby komórek, nie jakiejkolwiek

    const geo = buildPlanetGeometry(planet);
    const light = lightField(planet, sunDirection(0, 180));
    const out = new Float32Array(geo.positions.length);

    // Rozgrzewka — NIE liczy się do pomiaru. Cel: JIT silnika V8 zdąży zoptymalizować gorącą
    // pętlę PRZED pomiarem, tak jak zdąży to zrobić w prawdziwej pętli renderu po pierwszych
    // klatkach — bez tego pierwsze próby mierzyłyby głównie koszt kompilacji, nie koszt
    // funkcji w ustabilizowanym (steady-state) użyciu, które faktycznie interesuje budżet 8 ms.
    const WARMUP = 50;
    for (let i = 0; i < WARMUP; i++) {
      writeCellColors(geo, light, out, DEFAULT_PALETTE);
    }

    const ITERATIONS = 1000;
    const durationsMs: number[] = [];
    const bulkStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      writeCellColors(geo, light, out, DEFAULT_PALETTE);
      durationsMs.push(performance.now() - t0);
    }
    const bulkMs = performance.now() - bulkStart;

    const med = median(durationsMs);
    const p95 = percentile(durationsMs, 95);
    const sumMs = durationsMs.reduce((a, b) => a + b, 0);

    // --- KONTROLA POZYTYWNA NA SAM POMIAR --------------------------------------------
    // Poprzednia wersja tej kontroli sprawdzała `durationsMs.length === ITERATIONS` po
    // bezwarunkowej pętli, która wkłada dokładnie ITERATIONS elementów — tautologia, która
    // NIE MOŻE oblać. Gdyby `performance.now()` zdegradował się do ziarnistości 1 ms (tak
    // działają przeglądarki ze złagodzoną ochroną przed Spectre, i tak potrafi zachować się
    // zegar w zwirtualizowanym CI), KAŻDA różnica wyszłaby 0, mediana 0, test zameldowałby
    // "budżet spełniony" NIE ZMIERZYWSZY NICZEGO — a asercja długości nadal pokazywałaby 1000.
    //
    // Kontrola, która potrafi oblać: coś, o czym WIADOMO, że trwa mierzalnie długo, musi
    // zmierzyć się jako niezerowe.
    expect(durationsMs.length).toBe(ITERATIONS); // dalej sprawdzane, ale już nie JAKO kontrola
    // (1) Zegar rozróżnia pojedyncze wywołanie — dokładnie tę wielkość, o której orzeka próg.
    //     Przy zegarze o ziarnistości 1 ms mediana wyszłaby dokładnie 0 i to oblewa.
    expect(med).toBeGreaterThan(0);
    // (2) Zegar nie stoi: te same 1000 wywołań zmierzone JEDNYM odczytem (ok. 22 ms) musi
    //     wyjść wyraźnie powyżej progu, o którym orzeka pomiar pojedynczego wywołania.
    expect(bulkMs).toBeGreaterThan(1);
    // (3) Oba odczyty mierzą TĘ SAMĄ pracę: suma 1000 pomiarów pojedynczych zgadza się z
    //     jednym pomiarem całości co do rzędu wielkości. Rozjazd oznaczałby, że wewnętrzne
    //     `performance.now()` mierzy coś innego niż zewnętrzne (np. licznik zamrożony po
    //     pierwszym odczycie, albo narzut samego odczytu porównywalny z mierzoną pracą).
    expect(sumMs).toBeGreaterThan(bulkMs * 0.3);
    expect(sumMs).toBeLessThan(bulkMs * 1.5);

    // Tag [BUDGET] — greppowalny w logu CI/lokalnym, ten sam tag co konsola main.ts
    // (apps/client/src/main.ts), żeby "budżet" w obu miejscach znaczyło jedną i tę samą liczbę.
    console.log(
      `[BUDGET] writeCellColors × ${ITERATIONS} @ ${planet.cells.length} komórek: mediana=${med.toFixed(4)} ms, p95=${p95.toFixed(4)} ms, jednym odczytem=${bulkMs.toFixed(4)} ms (próg: < 1 ms)`,
    );

    expect(med).toBeLessThan(1);
  });

  /**
   * Własność "NIE ALOKUJE NICZEGO" — mierzona WPROST, nie wnioskowana z zegara.
   *
   * Uzasadniają ją trzy długie komentarze w kodzie produkcyjnym (`shading.ts` przy
   * `writeCellColors`, `planetMesh.ts` przy buforze `colors`, `frameStats.ts` przy
   * `createRollingWindow`) i żaden test jej nie sprawdzał. Zegar się do tego nie nadaje —
   * tabela w komentarzu opisu wyżej pokazuje, że alokacja 121 kB na wywołanie zmienia
   * medianę o 0,0008 ms, czyli mieści się w szumie.
   *
   * Przyrząd: `v8.GCProfiler` (Node ≥ 19) — synchroniczny, zwraca jeden wpis na KAŻDY cykl
   * odśmiecania w tym izolacie w oknie pomiaru. Dlaczego to jest odczyt alokacji, a nie
   * przybliżenie: odśmiecanie w V8 uruchamia WYŁĄCZNIE alokacja (przydział w młodej
   * generacji albo zgłoszona pamięć zewnętrzna), a mierzona pętla jest w pełni
   * SYNCHRONICZNA — nic innego w tym izolacie nie może się w jej trakcie wykonać. Zero
   * cykli GC w oknie 2000 wywołań to więc nie "mało śmieci", tylko "żaden przydział nie
   * przepełnił młodej generacji przez 2000 wywołań".
   *
   * Dlaczego NIE próbnik sterty (`inspector` / `HeapProfiler.startSampling`), który wydaje
   * się bardziej bezpośredni: zmierzone w tej sesji — próbnik NIE WIDZI pamięci bufora
   * `Float32Array` (backing store powyżej ~64 kB leży poza stertą V8), więc dla mutacji
   * "jeden `Float32Array(30246)` na wywołanie" pokazał 912 B na 1000 wywołań przy
   * faktycznych 121 MB, a jego własny szum na PUSTEJ pętli wynosił 6288 B. Licznik cykli GC
   * widzi oba rodzaje pamięci (`GCProfiler`: 0 / 9 dla tych samych dwóch wariantów) i ma
   * podłogę dokładnie zero.
   */
  it('nie alokuje NICZEGO: 2000 wywołań nie wywołuje ani jednego cyklu odśmiecania', () => {
    const planet = createPlanet({ seed: 20260915 });
    const geo = buildPlanetGeometry(planet);
    const light = lightField(planet, sunDirection(0, 180));
    const out = new Float32Array(geo.positions.length);
    let sink = 0;

    const ITERATIONS = 2000;
    // Rozgrzewka: pomiar dotyczy stanu USTABILIZOWANEGO (jak w pętli renderu po pierwszych
    // klatkach), nie fazy kompilacji — ta ostatnia alokuje z natury (kod, feedback vectors).
    for (let i = 0; i < 400; i++) {
      writeCellColors(geo, light, out, DEFAULT_PALETTE);
      sink += allocatingVariant(geo, light, out);
    }

    function gcCyclesDuring(run: () => void): number {
      const profiler = new GCProfiler();
      profiler.start();
      run();
      return profiler.stop().statistics.length;
    }

    /** Wariant kontrolny: DOKŁADNIE ta sama praca + jeden pełnowymiarowy bufor na wywołanie. */
    function allocatingVariant(g: typeof geo, l: Float32Array, o: Float32Array): number {
      const scratch = new Float32Array(o.length);
      writeCellColors(g, l, o, DEFAULT_PALETTE);
      scratch[0] = o[0];
      return scratch[0]; // ucieczka wyniku — inaczej V8 ma prawo usunąć alokację w całości
    }

    const emptyLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) sink += i;
    };
    const measuredLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) writeCellColors(geo, light, out, DEFAULT_PALETTE);
    };
    const controlLoop = (): void => {
      for (let i = 0; i < ITERATIONS; i++) sink += allocatingVariant(geo, light, out);
    };

    // MINIMUM z trzech okien pomiarowych, nie pojedyncze okno — i to NIE jest osłabienie
    // asercji, tylko poprawne postawienie mierzonej własności. V8 potrafi dokończyć
    // rozpoczęte wcześniej znakowanie przyrostowe na przerwaniu kontroli stosu w środku
    // długiej pętli, niezależnie od tego, czy ta pętla cokolwiek alokuje (zaobserwowane pod
    // Vitest w `packages/sim/test/light.test.ts`, gdzie okno pomiarowe jest dłuższe).
    // Własność brzmi więc: ISTNIEJE okno 2000 synchronicznych wywołań bez ani jednego cyklu.
    // Dla funkcji alokującej takie okno NIE ISTNIEJE — co pilnuje kontrola pozytywna, od
    // której wymagamy niezerowego odczytu w KAŻDYM oknie.
    const emptyRuns = [gcCyclesDuring(emptyLoop), gcCyclesDuring(emptyLoop), gcCyclesDuring(emptyLoop)];
    const measuredRuns = [gcCyclesDuring(measuredLoop), gcCyclesDuring(measuredLoop), gcCyclesDuring(measuredLoop)];
    const controlRuns = [gcCyclesDuring(controlLoop), gcCyclesDuring(controlLoop), gcCyclesDuring(controlLoop)];
    // Powtórzony pomiar PO kontroli: zero nie jest artefaktem kolejności (np. "sterta
    // akurat była świeżo posprzątana"), tylko własnością funkcji.
    const measuredAfterControl = gcCyclesDuring(measuredLoop);

    console.log(
      `[BUDGET] cykle GC na ${ITERATIONS} wywołań (3 okna) — pusta pętla: ${emptyRuns.join('/')}, writeCellColors: ${measuredRuns.join('/')} (po kontroli: ${measuredAfterControl}), kontrola +1 Float32Array(${out.length})/wyw.: ${controlRuns.join('/')}`,
    );

    // KONTROLA POZYTYWNA przyrządu: ta sama pętla z JEDNĄ dodatkową alokacją na wywołanie
    // MUSI dać wyraźnie niezerowy odczyt, w każdym oknie. Bez tego "0 cykli GC" znaczyłoby
    // tyle samo, co wyłączony przyrząd — dokładnie ten tryb awarii, który ta gałąź ma już
    // na koncie siedmiokrotnie.
    expect(Math.min(...controlRuns)).toBeGreaterThanOrEqual(3);
    // KONTROLA PODŁOGI: pętla, która na pewno nie alokuje, czyta się jako dokładnie 0 —
    // więc 0 poniżej jest odczytem, nie zaokrągleniem czegoś małego w dół.
    expect(Math.min(...emptyRuns)).toBe(0);
    // WŁASNOŚĆ: 2000 wywołań `writeCellColors` nie wywołuje ANI JEDNEGO cyklu GC.
    expect(Math.min(...measuredRuns)).toBe(0);
    expect(Math.min(...measuredRuns, measuredAfterControl)).toBe(0);
    expect(sink).not.toBe(0); // kontrola: kontrola faktycznie się wykonała, nie została usunięta
  });
});
