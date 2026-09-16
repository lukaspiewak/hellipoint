import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { describeGcWindows, gcMedian, gcNoiseLimit, measureGcWindows } from './support/gcWindows.js';
import {
  BUILDINGS,
  createPlanet,
  ENEMIES,
  lightField,
  sunDirection,
  type Building,
  type EnemyType,
  type Unit,
} from '@heliopolis/sim';
import { buildPlanetGeometry } from '../src/geometry.js';
import { buildCellOutlines, createPlanetMesh } from '../src/planetMesh.js';
import { createBuildingLayer } from '../src/buildingMesh.js';
import { createUnitLayer } from '../src/unitMesh.js';
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
   * SYNCHRONICZNA — nic innego w tym izolacie nie może się w jej trakcie wykonać.
   *
   * **Ostatnie zdanie tego akapitu brzmiało wcześniej: „zero cykli GC w oknie 2000 wywołań to
   * nie »mało śmieci«, tylko »żaden przydział nie przepełnił młodej generacji«" — i było
   * fałszywe.** `GCProfiler` liczy odśmiecanie CAŁEGO PROCESU, a vitest uruchamia pliki
   * testowe RÓWNOLEGLE w jednym procesie; pętla mierzona jest synchroniczna w swoim izolacie,
   * ale izolat nie jest sam. Zmierzone w rundzie naprawczej 2 Zadania 4: okno BEZCZYNNE
   * (aktywne czekanie, zero alokacji z definicji) tej samej długości daje **2-4 cykle**, a
   * mierzona pętla 0-1. Asercja żądająca zera pytała więc o zajętość maszyny. Dlatego pomiar
   * i kształt asercji mieszkają teraz w `support/gcWindows.ts` i porównują mierzoną pętlę z
   * OKNEM BEZCZYNNYM i z KONTROLĄ POZYTYWNĄ, a nie z zerem.
   *
   * Dlaczego NIE próbnik sterty (`inspector` / `HeapProfiler.startSampling`), który wydaje
   * się bardziej bezpośredni: zmierzone w tej sesji — próbnik NIE WIDZI pamięci bufora
   * `Float32Array` (backing store powyżej ~64 kB leży poza stertą V8), więc dla mutacji
   * "jeden `Float32Array(30246)` na wywołanie" pokazał 912 B na 1000 wywołań przy
   * faktycznych 121 MB, a jego własny szum na PUSTEJ pętli wynosił 6288 B. Licznik cykli GC
   * widzi oba rodzaje pamięci (`GCProfiler`: 0 / 9 dla tych samych dwóch wariantów).
   */
  it('nie alokuje NICZEGO: 2000 wywołań nie wychodzi ponad podłogę szumu odśmiecania', () => {
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

    /** Wariant kontrolny: DOKŁADNIE ta sama praca + jeden pełnowymiarowy bufor na wywołanie. */
    function allocatingVariant(g: typeof geo, l: Float32Array, o: Float32Array): number {
      const scratch = new Float32Array(o.length);
      writeCellColors(g, l, o, DEFAULT_PALETTE);
      scratch[0] = o[0];
      return scratch[0]; // ucieczka wyniku — inaczej V8 ma prawo usunąć alokację w całości
    }

    const windows = measureGcWindows({
      empty: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += i;
      },
      measured: () => {
        for (let i = 0; i < ITERATIONS; i++) writeCellColors(geo, light, out, DEFAULT_PALETTE);
      },
      control: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += allocatingVariant(geo, light, out);
      },
    });

    console.log(
      `[BUDGET] cykle GC na ${ITERATIONS} wywołań writeCellColors, kontrola +1 Float32Array(${out.length})/wyw. — ${describeGcWindows(windows)}`,
    );

    // Trzy asercje, ten sam kształt co w `buildingMesh.test.ts` i `unitMesh.test.ts` —
    // uzasadnienie i historia w `support/gcWindows.ts`. W skrócie: poprzednia wersja żądała
    // `min(okna) === 0`, czyli mierzyła, czy inne pliki testowe akurat nic nie alokowały.
    //
    // 1. PODŁOGA: przyrząd potrafi zwrócić 0 (pętla mikrosekundowa, szum tła jej nie sięga).
    expect(Math.min(...windows.empty), 'przyrząd nie potrafi zwrócić zera').toBe(0);
    // 2. CZUŁOŚĆ: ta sama praca z JEDNĄ dodatkową alokacją na wywołanie odstaje od szumu tła.
    //    Bez tego „mało cykli" znaczyłoby tyle, co wyłączony przyrząd — tryb awarii, który
    //    ta gałąź ma już na koncie siedmiokrotnie.
    //    Odniesieniem jest okno MIERZONE, nie bezczynne: kontrola to z definicji „mierzona
    //    praca + jedna alokacja na element", więc oba okna robią to samo i różni je DOKŁADNIE
    //    ta alokacja. Poprzednia wersja (`min(control) > max(idle)`) zestawiała podłogę
    //    jednego szumu z sufitem drugiego i przewracała się pod obciążeniem bez żadnego
    //    defektu — bo samo okno bezczynne alokuje. Pomiary: `support/gcWindows.ts`.
    expect(gcMedian(windows.control), 'kontrola alokująca nie odstaje od mierzonej pętli').toBeGreaterThan(
      gcMedian(windows.measured),
    );
    // 3. WŁASNOŚĆ: mierzona pętla nie wychodzi ponad sufit zmierzonego szumu tła (plus jeden
    //    cykl rozdzielczości przyrządu). Próg NIE zależy od badanego kodu — okno bezczynne go
    //    nie zawiera — więc defekt nie może go podnieść razem ze sobą.
    expect(Math.max(...windows.measured), 'writeCellColors alokuje').toBeLessThanOrEqual(gcNoiseLimit(windows));
    expect(sink).not.toBe(0); // kontrola: kontrola faktycznie się wykonała, nie została usunięta
  // Limit czasu podniesiony z domyślnych 5 s. Ten test mierzy SZEŚĆ przeplatanych okien
  // odśmiecania (`rounds = 3` × cztery rodzaje, plus rozgrzewka) na tysiącach iteracji, a
  // Vitest uruchamia pliki RÓWNOLEGLE — więc jego czas zależy od tego, ile innych plików
  // akurat liczy. Zmierzone na BEZCZYNNYM M5 przy `rounds = 2`: 3111 ms z 5000 ms, czyli
  // 62 % domyślnego limitu na najszybszej maszynie, jaką ten projekt zobaczy; pod
  // obciążeniem (5 alokujących procesów w tle) test wypadał na TIMEOUT, nie na asercji —
  // czyli czerwień wyglądająca na regresję wydajności, którą nie jest. Podniesienie
  // `rounds` do 3 (naprawa asercji czułości, patrz `support/gcWindows.ts`) dokłada do tego
  // jeszcze połowę pracy.
  //
  // Zmieniony jest WYŁĄCZNIE limit — ani jedna asercja, ani liczba iteracji, ani kontrola
  // pozytywna. To samo uzasadnienie i ta sama decyzja co w `packages/sim/test/light.test.ts`
  // (5 s → 30 s, Zadanie 3); ledger zapisał wtedy „pakiet jest blisko progu, na którym
  // dołożenie pliku testowego wywraca NIEZWIĄZANY test — wróci". Wrócił, wewnątrz tej samej
  // gałęzi. Koszt, jeśli źle: prawdziwa regresja wydajności schowa się pod limitem 30 s —
  // ale tego pilnuje pomiar MEDIANY czasu (osobny test), nie ten.
  }, 30_000);
});

/**
 * Faza 2B, Zadanie 2: krata komórek podwoiła liczbę buforów, które pętla renderu przepisuje
 * co klatkę (wypełnienia + obrysy). Test wyżej mierzy SAMĄ `writeCellColors`; ten mierzy
 * CAŁĄ ścieżkę klatki `PlanetMesh.updateColors`, czyli oba przejścia plus podniesienie
 * `needsUpdate` na obu atrybutach — bo to jest to, co faktycznie biegnie 60 razy na sekundę,
 * a najbardziej prawdopodobny sposób zepsucia tego zadania to przebudowywanie geometrii
 * obrysów w pętli zamiast raz, przy konstrukcji siatki.
 *
 * Przyrząd i jego uzasadnienie — patrz długi komentarz przy teście GC wyżej.
 */
describe('PlanetMesh.updateColors — cała ścieżka klatki, po dołożeniu kraty (Faza 2B, Zadanie 2)', () => {
  it('nie alokuje NICZEGO: 2000 wywołań nie wychodzi ponad podłogę szumu odśmiecania', () => {
    const planet = createPlanet({ seed: 20260915 });
    const geo = buildPlanetGeometry(planet);
    const light = lightField(planet, sunDirection(0, 180));
    const planetMesh = createPlanetMesh(geo);
    let sink = 0;

    const ITERATIONS = 2000;
    for (let i = 0; i < 400; i++) {
      planetMesh.updateColors(light);
      sink += allocatingVariant();
    }

    /**
     * Wariant kontrolny: DOKŁADNIE ta sama praca plus jedno przebudowanie geometrii obrysów
     * na wywołanie — czyli konkretny, realny błąd („buduj kratę w pętli renderu"), nie
     * abstrakcyjna alokacja.
     */
    function allocatingVariant(): number {
      const outlines = buildCellOutlines(geo);
      planetMesh.updateColors(light);
      return outlines.positions[0]; // ucieczka wyniku — inaczej V8 ma prawo usunąć alokację
    }

    const windows = measureGcWindows({
      empty: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += i;
      },
      measured: () => {
        for (let i = 0; i < ITERATIONS; i++) planetMesh.updateColors(light);
      },
      control: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += allocatingVariant();
      },
    });

    console.log(
      `[BUDGET] cykle GC na ${ITERATIONS} wywołań updateColors, kontrola +buildCellOutlines/wyw. — ${describeGcWindows(windows)}`,
    );

    // Trzy asercje, ten sam kształt co wyżej — uzasadnienie w `support/gcWindows.ts`.
    expect(Math.min(...windows.empty), 'przyrząd nie potrafi zwrócić zera').toBe(0);
    //    Odniesieniem jest okno MIERZONE, nie bezczynne: kontrola to z definicji „mierzona
    //    praca + jedna alokacja na element", więc oba okna robią to samo i różni je DOKŁADNIE
    //    ta alokacja. Poprzednia wersja (`min(control) > max(idle)`) zestawiała podłogę
    //    jednego szumu z sufitem drugiego i przewracała się pod obciążeniem bez żadnego
    //    defektu — bo samo okno bezczynne alokuje. Pomiary: `support/gcWindows.ts`.
    expect(gcMedian(windows.control), 'kontrola alokująca nie odstaje od mierzonej pętli').toBeGreaterThan(
      gcMedian(windows.measured),
    );
    expect(Math.max(...windows.measured), 'updateColors alokuje').toBeLessThanOrEqual(gcNoiseLimit(windows));
    expect(sink).not.toBe(0);

    planetMesh.dispose();
  // Limit czasu podniesiony z domyślnych 5 s. Ten test mierzy SZEŚĆ przeplatanych okien
  // odśmiecania (`rounds = 3` × cztery rodzaje, plus rozgrzewka) na tysiącach iteracji, a
  // Vitest uruchamia pliki RÓWNOLEGLE — więc jego czas zależy od tego, ile innych plików
  // akurat liczy. Zmierzone na BEZCZYNNYM M5 przy `rounds = 2`: 3111 ms z 5000 ms, czyli
  // 62 % domyślnego limitu na najszybszej maszynie, jaką ten projekt zobaczy; pod
  // obciążeniem (5 alokujących procesów w tle) test wypadał na TIMEOUT, nie na asercji —
  // czyli czerwień wyglądająca na regresję wydajności, którą nie jest. Podniesienie
  // `rounds` do 3 (naprawa asercji czułości, patrz `support/gcWindows.ts`) dokłada do tego
  // jeszcze połowę pracy.
  //
  // Zmieniony jest WYŁĄCZNIE limit — ani jedna asercja, ani liczba iteracji, ani kontrola
  // pozytywna. To samo uzasadnienie i ta sama decyzja co w `packages/sim/test/light.test.ts`
  // (5 s → 30 s, Zadanie 3); ledger zapisał wtedy „pakiet jest blisko progu, na którym
  // dołożenie pliku testowego wywraca NIEZWIĄZANY test — wróci". Wrócił, wewnątrz tej samej
  // gałęzi. Koszt, jeśli źle: prawdziwa regresja wydajności schowa się pod limitem 30 s —
  // ale tego pilnuje pomiar MEDIANY czasu (osobny test), nie ten.
  }, 30_000);
});

/**
 * Faza 2B, Zadanie 5, Krok 3: **CAŁA praca per klatka przy pełnej scenie** — teren plus krata
 * (`PlanetMesh.updateColors`) plus budynki plus jednostki, przy szczycie zmierzonym w Fazie 1C.
 *
 * ## Co ten test mierzy, a czego NIE mierzy
 *
 * Mierzy CPU: przepisanie wszystkich buforów, które pętla renderu przepisuje 60 razy na
 * sekundę. NIE mierzy `renderer.render()` — tego nie da się zmierzyć w Node bez prawdziwego
 * WebGL (patrz `scene.ts`/`createSceneWithRenderer`), i dlatego liczba z budżetu 8 ms
 * odczytuje się z HUD na żywym płótnie (`apps/client/scene-gate.html`), a nie stąd. Ten test
 * pilnuje WŁASNOŚCI, której HUD nie umie zobaczyć: że przy 481 jednostkach **ani jedna z
 * trzech warstw nie alokuje w pętli renderu**.
 *
 * Trzy warstwy razem, nie każda osobno: `buildingMesh.test.ts` (test 16) i `unitMesh.test.ts`
 * (test 13) mierzą swoje warstwy w izolacji, więc alokacja w SKLEJCE — a to ona jest nowa w
 * tym zadaniu — przechodziłaby przez oba.
 *
 * ## ROZDZIELCZOŚĆ TEGO POMIARU, zmierzona i zapisana, a nie przemilczana
 *
 * Szum tła `GCProfiler` rośnie z DŁUGOŚCIĄ okna (to cykle odśmiecania całego procesu, a
 * vitest uruchamia pliki równolegle), a sygnał defektu rośnie z LICZBĄ ALOKACJI. Przy 481
 * jednostkach oba rosną podobnie, więc ten konkretny pomiar ma skończoną czułość i warto
 * wiedzieć jaką. Zmierzone parą mutacji na tej maszynie (okno ok. 250 ms):
 *
 *   | wariant                                          | mierzone | sufit szumu | próg | wynik |
 *   |--------------------------------------------------|----------|-------------|------|-------|
 *   | czysto                                           | 0-1      | 6-14        | 7-15 | przechodzi |
 *   | kontrola: +2071 `Matrix4` na klatkę               | 37-43    | 7-14        | 8-15 | **wykryte** |
 *   | `Float64Array(64)` na JEDNOSTKĘ (481/kl.)         | ponad próg | —         | —    | **wykryte** |
 *   | `Math.sqrt` → `Math.hypot` w jednostkach (481/kl.)| 6-7      | 7           | 8    | **NIE wykryte** |
 *   | jedna krótkotrwała tablica na budynek (148/kl.)   | 0-1      | 6-14        | 7-15 | nie alokuje (patrz niżej) |
 *
 * Dwa różne powody, dla których dwa ostatnie wiersze wyglądają podobnie, i tylko jeden z
 * nich jest ograniczeniem tego testu:
 *
 * (Zakresy, nie pojedyncze liczby: szum tła zależy od tego, ile innych plików testowych biegnie
 * w tej samej chwili — mierzone i przy pojedynczym pliku, i przy pełnym pakiecie. Próg idzie
 * razem z szumem, więc margines czysto ↔ kontrola zostaje w obu przypadkach.)
 *
 * 1. **`Math.hypot` przy 481 jednostkach leży poniżej progu i to JEST granica czułości** —
 *    granica po WIELKOŚCI alokacji, nie po tym, że jest „na jednostkę": wiersz wyżej pokazuje,
 *    że alokacja na jednostkę JEST wykrywana, gdy jest większa. Tablica `rest` z `Math.hypot`
 *    ma trzy elementy, więc 481 takich na klatkę daje sygnał porównywalny z szumem tła
 *    procesu. Łapie ją test 13 w `unitMesh.test.ts`, który mierzy przy PEŁNEJ pojemności
 *    bufora (2048 jednostek), czyli przy czterokrotnie gęstszej alokacji. Populacji 481 nie
 *    wolno tu podnosić dla wygody pomiaru — to liczba z briefu (szczyt Fazy 1C) — więc
 *    granica zostaje zapisana.
 * 2. **Krótkotrwała tablica na budynek to NIE jest alokacja** — V8 usuwa ją analizą
 *    ucieczki, bo nie opuszcza ramki wywołania. Brak wykrycia jest tu POPRAWNY: pomiar
 *    mierzy alokacje, które faktycznie zachodzą, a ta nie zachodzi. (Dlatego kontrola tego
 *    testu używa `Matrix4`, który ucieczkę przeżywa — patrz `allocatingFrame`.)
 */
describe('pełna scena — praca per klatka przy 481 jednostkach (Faza 2B, Zadanie 5, Krok 3)', () => {
  it('nie alokuje NICZEGO: 2000 klatek pełnej sceny nie wychodzi ponad podłogę szumu odśmiecania', () => {
    const planet = createPlanet({ seed: 20260915 });
    const geo = buildPlanetGeometry(planet);
    const light = lightField(planet, sunDirection(0, 180));
    const planetMesh = createPlanetMesh(geo);
    const buildings = createBuildingLayer(planet, geo);
    const units = createUnitLayer(planet);

    // Szczyt z Fazy 1C: 481 ŻYWYCH jednostek. Liczba przypięta, bo to ona jest budżetem —
    // pomiar przy dowolnej innej nie odpowiadałby na pytanie Kroku 3.
    const UNIT_COUNT = 481;
    const TYPES: readonly EnemyType[] = ['SWARM', 'DISRUPTOR', 'ARMOR'];
    const unitList: Unit[] = Array.from({ length: UNIT_COUNT }, (_, i) => {
      const type = TYPES[i % TYPES.length];
      const cellId = (i * 3) % planet.cells.length;
      const center = planet.cells[cellId].center;
      return {
        id: i + 1,
        type,
        cellId,
        pos: { x: center.x, y: center.y, z: center.z },
        hp: ENEMIES[type].hp,
        exposure: (ENEMIES[type].burnTime * (i % 7)) / 6,
      };
    });

    // „Kilkadziesiąt budynków" z briefu — tu 148, czyli dokładnie tyle, ile stawia podgląd
    // bramki pełnego obrazu (`apps/client/src/sceneGate.ts`), żeby obie liczby opisywały
    // TĘ SAMĄ scenę.
    const buildingList: (Building | null)[] = new Array<Building | null>(planet.cells.length).fill(null);
    let placed = 0;
    for (let cellId = 0; cellId < planet.cells.length && placed < 148; cellId += 9) {
      buildingList[cellId] = {
        cellId,
        type: 'KINETIC_TURRET',
        hp: BUILDINGS.KINETIC_TURRET.hp * (0.1 + (placed % 10) / 10),
        powered: placed % 4 !== 0,
      };
      placed++;
    }
    expect(placed).toBe(148);

    let sink = 0;
    const ITERATIONS = 2000;
    const frame = (): void => {
      planetMesh.updateColors(light);
      buildings.update(buildingList);
      units.update(unitList, light);
    };
    /**
     * Kontrola: DOKŁADNIE ta sama klatka plus JEDNA macierz na rysowany obiekt — ten sam
     * kształt kontroli, co w `unitMesh.test.ts` (test 13) i `buildingMesh.test.ts` (test 16),
     * żeby dało się zestawić liczby z trzech plików. To jest realny błąd (`new Matrix4()` w
     * pętli przepisywania instancji), nie abstrakcyjna alokacja.
     */
    const ELEMENTS_PER_FRAME = planet.cells.length + UNIT_COUNT + 148;
    const allocatingFrame = (): number => {
      frame();
      let acc = 0;
      for (let i = 0; i < ELEMENTS_PER_FRAME; i++) acc += new Matrix4().elements[0];
      return acc; // ucieczka wyniku — inaczej V8 ma prawo usunąć alokację w całości
    };
    for (let i = 0; i < 120; i++) {
      frame();
      sink += allocatingFrame();
    }

    const windows = measureGcWindows({
      empty: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += i;
      },
      measured: () => {
        for (let i = 0; i < ITERATIONS; i++) frame();
      },
      control: () => {
        for (let i = 0; i < ITERATIONS; i++) sink += allocatingFrame();
      },
    });

    console.log(
      `[BUDGET] cykle GC na ${ITERATIONS} klatek PEŁNEJ SCENY (${UNIT_COUNT} jednostek, ${placed} budynków, ${planet.cells.length} komórek), ` +
        `kontrola +${ELEMENTS_PER_FRAME} Matrix4/klatkę — ${describeGcWindows(windows)}`,
    );

    // Ten sam kształt trzech asercji co wyżej — uzasadnienie w `support/gcWindows.ts`.
    expect(Math.min(...windows.empty), 'przyrząd nie potrafi zwrócić zera').toBe(0);
    //    Odniesieniem jest okno MIERZONE, nie bezczynne: kontrola to z definicji „mierzona
    //    praca + jedna alokacja na element", więc oba okna robią to samo i różni je DOKŁADNIE
    //    ta alokacja. Poprzednia wersja (`min(control) > max(idle)`) zestawiała podłogę
    //    jednego szumu z sufitem drugiego i przewracała się pod obciążeniem bez żadnego
    //    defektu — bo samo okno bezczynne alokuje. Pomiary: `support/gcWindows.ts`.
    expect(gcMedian(windows.control), 'kontrola alokująca nie odstaje od mierzonej pętli').toBeGreaterThan(
      gcMedian(windows.measured),
    );
    expect(Math.max(...windows.measured), 'pełna scena alokuje w pętli renderu').toBeLessThanOrEqual(
      gcNoiseLimit(windows),
    );
    expect(sink).not.toBe(0);

    // Kontrola pozytywna na sam pomiar: warstwy FAKTYCZNIE narysowały to, co miały —
    // pomiar „zero alokacji" na warstwie rysującej zero instancji nic by nie znaczył.
    expect(units.body.count).toBe(UNIT_COUNT);
    expect(buildings.shell.count).toBe(placed);
    expect(buildings.alert.count).toBeGreaterThan(0);

    planetMesh.dispose();
    buildings.dispose();
    units.dispose();
  // Limit czasu podniesiony z domyślnych 5 s. Ten test mierzy SZEŚĆ przeplatanych okien
  // odśmiecania (`rounds = 3` × cztery rodzaje, plus rozgrzewka) na tysiącach iteracji, a
  // Vitest uruchamia pliki RÓWNOLEGLE — więc jego czas zależy od tego, ile innych plików
  // akurat liczy. Zmierzone na BEZCZYNNYM M5 przy `rounds = 2`: 3111 ms z 5000 ms, czyli
  // 62 % domyślnego limitu na najszybszej maszynie, jaką ten projekt zobaczy; pod
  // obciążeniem (5 alokujących procesów w tle) test wypadał na TIMEOUT, nie na asercji —
  // czyli czerwień wyglądająca na regresję wydajności, którą nie jest. Podniesienie
  // `rounds` do 3 (naprawa asercji czułości, patrz `support/gcWindows.ts`) dokłada do tego
  // jeszcze połowę pracy.
  //
  // Zmieniony jest WYŁĄCZNIE limit — ani jedna asercja, ani liczba iteracji, ani kontrola
  // pozytywna. To samo uzasadnienie i ta sama decyzja co w `packages/sim/test/light.test.ts`
  // (5 s → 30 s, Zadanie 3); ledger zapisał wtedy „pakiet jest blisko progu, na którym
  // dołożenie pliku testowego wywraca NIEZWIĄZANY test — wróci". Wrócił, wewnątrz tej samej
  // gałęzi. Koszt, jeśli źle: prawdziwa regresja wydajności schowa się pod limitem 30 s —
  // ale tego pilnuje pomiar MEDIANY czasu (osobny test), nie ten.
  }, 30_000);
});
