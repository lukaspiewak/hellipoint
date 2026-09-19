import { describe, expect, it } from 'vitest';
import { createPlanet, DEFAULT_RUN, Sim, type RunConfig } from '@heliopolis/sim';
import { simulateRun } from '../src/run.js';
import { formatReport } from '../src/report.js';
import { BeginnerPolicy } from '../src/policy.js';

describe('simulateRun', () => {
  it('każdy run kończy się w skończonej liczbie ticków', () => {
    const r = simulateRun(1, DEFAULT_RUN, 100_000);
    expect(r.phase).not.toBe('RUNNING');
    expect(r.ticks).toBeLessThan(100_000);
  });

  it('polityka faktycznie coś buduje — test antyregresyjny na martwego bota', () => {
    const r = simulateRun(1, DEFAULT_RUN, 100_000);
    expect(r.peakBuildings).toBeGreaterThan(5);
    expect(r.oreMined).toBeGreaterThan(0);
  });

  it('ten sam seed daje identyczny wynik', () => {
    expect(simulateRun(7, DEFAULT_RUN, 50_000)).toEqual(simulateRun(7, DEFAULT_RUN, 50_000));
  });

  it('różne seedy dają różne przebiegi', () => {
    const a = simulateRun(11, DEFAULT_RUN, 50_000);
    const b = simulateRun(12, DEFAULT_RUN, 50_000);
    expect(a).not.toEqual(b);
  });

  // Standing hunt, znaleziony tutaj: `RunResult.seed` to DOSŁOWNE echo parametru
  // wejściowego, niezależne od tego, czy symulacja w ogóle go użyła. Test wyżej
  // przeszedłby WYŁĄCZNIE dzięki temu polu, nawet gdyby `simulateRun` całkowicie
  // ignorował `seed` przy generacji planety — zmierzone bezpośrednio (lokalna mutacja,
  // odwrócona): podmiana na `createPlanet({ seed: 0 })` na stałe zostawiała poprzedni
  // test zielonym. Porównanie niżej pomija pole `seed`, więc naprawdę sprawdza
  // SYMULACJĘ, nie etykietę doklejoną do wyniku.
  it('różne seedy dają różne przebiegi — nie tylko przez echo pola `seed`', () => {
    const { seed: _a, ...a } = simulateRun(11, DEFAULT_RUN, 50_000);
    const { seed: _b, ...b } = simulateRun(12, DEFAULT_RUN, 50_000);
    expect(a).not.toEqual(b);
  });

  // THE standing hunt (task-6-brief kontekst): "test determinizmu nad martwym runem" —
  // `expect(simulateRun(7,…)).toEqual(simulateRun(7,…))` byłby zielony, gdyby run nic nie
  // robił. Ten test dowodzi, że NIE jest martwy: dochodzi do porażki (nie utyka w RUNNING)
  // i stawia więcej niż sam CORE — więc test determinizmu obok porównuje realny,
  // ruchliwy przebieg, a nie zerowy punkt odniesienia.
  it('determinizm dla seed=7 nie jest testem martwego runu — realnie coś się dzieje', () => {
    // Zmierzone wprost (`simulateRun(7, DEFAULT_RUN, 50_000)`, po rundzie poprawek 2 —
    // ogólna rezerwa rudy, bez wyjątku dla ekstraktora): DEFEAT w ticku 1101,
    // 13 budynków w szczycie, 52,6 rudy wydobytej. Asercja celowo NIE na zabiciach:
    // to jedyna z czterech liczb, która zmienia się z każdą zmianą polityki/balansu
    // (0 w rundzie 1, 2 w rundzie 2 wariant A, 25 w finalnym wariancie — patrz
    // task-6-report.md), a ruda/ticki/budynki są stabilniejszym dowodem "to nie
    // jest martwy run".
    const r = simulateRun(7, DEFAULT_RUN, 50_000);
    expect(r.phase).toBe('DEFEAT');
    expect(r.ticks).toBeGreaterThan(100);
    expect(r.peakBuildings).toBeGreaterThan(5);
    expect(r.oreMined).toBeGreaterThan(0);
  });

  // Standing hunt: "firstDepletionTick — czy -1 (nic nie wyczerpano) jest odróżnione od
  // ticka 0, i czy jakikolwiek run w suicie faktycznie wyczerpuje złoże?"
  it('firstDepletionTick odróżnia „nic nie wyczerpano" (-1) od ticka 0 — i realnie się zdarza', () => {
    // Run krótszy niż jeden tick mining-u: -1 nie może być pomylone z "wyczerpane w ticku 0".
    expect(simulateRun(1, DEFAULT_RUN, 1).firstDepletionTick).toBe(-1);

    // Zmierzone OSOBNO (poza tym plikiem): DEFAULT_RUN + BeginnerPolicy nigdy nie
    // wyczerpuje ŻADNEGO złoża w 400 próbkowanych seedach — presja wroga zabija bazę
    // szybciej, niż jeden ekstraktor zdąży wydobyć 400 rudy z pojedynczej komórki.
    // Bez poniższego "wyczerpanie" w raporcie zawsze czytałoby "brak danych" dla
    // KAŻDEGO seeda, a wartość -1 nigdy nie zostałaby odróżniona od realnej w praktyce —
    // dokładnie ten rodzaj testu, który przechodzi, bo nigdy nie widzi interesującej
    // gałęzi. Config niżej drastycznie obniża tempo spawnu (ale > 0 — Sim odrzuca
    // dokładne zero), żeby dać polityce czas na wydobycie, i pokazuje, że ścieżka
    // "wyczerpano" jest OSIĄGALNA, nie tylko teoretyczna.
    //
    // Seedy 2/3/4, nie zakres od zera, i maxTicks obcięty do 20 000: run bez presji
    // wroga z rezerwą rudy (runda poprawek 2) potrafi wyhodować bazę rzędu SETEK
    // budynków, zanim padnie — zmierzone: seed=1 dochodzi do 629-702 budynków i
    // ~17-62 s liczenia SAMEGO SIEBIE, bo koszt na tick rośnie z rozmiarem sieci
    // (BFS zasięgu, pola przepływu). Seedy 2/3/4 zostają małe (30-46 budynków w
    // 20 000 ticków) i każdy z osobna i tak wystarcza do `depleted.length > 0`
    // (wyczerpanie na tickach 2661-6861, głęboko przed cięciem) — test ma
    // dowodzić, że ścieżka "wyczerpano" jest osiągalna, nie hodować farmę.
    const easy: RunConfig = {
      ...DEFAULT_RUN,
      spawn: { ...DEFAULT_RUN.spawn, baseRatePerPentagon: 0.001, growthPerCycle: 1 },
    };
    const results = [2, 3, 4].map((seed) => simulateRun(seed, easy, 20_000));
    const depleted = results.filter((r) => r.firstDepletionTick > 0);
    expect(depleted.length).toBeGreaterThan(0);
    for (const r of depleted) expect(Number.isInteger(r.firstDepletionTick)).toBe(true);
  }, 30_000);
});

describe('BeginnerPolicy', () => {
  // Kontekst zadania: "jednorazowa lista budowy nie przeżywa pełnego runu — pierścień
  // barykad znika między cyklami 2 i 3... polityka, która dochodzi do zwycięstwa,
  // ODBUDOWUJE: każdy tick stawia pierwszą brakującą pozycję ze swojego planu." decide()
  // nie pamięta NIC między wywołaniami — liczy `reachable`/`free` na nowo z aktualnego
  // `s.buildings` za każdym razem, więc zniszczona pozycja wraca do puli "wolnych" i
  // MUSI zostać ponownie rozważona. Ten test dowodzi tego wprost, zamiast zakładać.
  it('odbudowuje zniszczoną pozycję zamiast trwale ją pomijać', () => {
    // Wersja pierwsza tego testu budowała przez 400 ticków, burzyła WSZYSTKO poza CORE
    // i sprawdzała tylko `cmds.length > 0` — mutacja "pamiętaj raz zdecydowane komórki
    // na zawsze" (dokładnie anti-pattern z kontekstu zadania) i tak ją przechodziła,
    // bo 3-krokowe sąsiedztwo CORE ma więcej wolnych komórek niż zdążyło się zapełnić
    // do ticka 400 — test miał dość miejsca, żeby "odbudować" gdzie indziej, nawet
    // z pamięcią. Ta wersja jest ciasna: DOKŁADNIE jedna komórka, zbudowana, zburzona,
    // i sprawdzana, że wraca jako TA SAMA decyzja — nic więcej się nie zmieniło,
    // więc "pierwsza brakująca pozycja z planu" musi wyjść identyczna.
    const planet = createPlanet({ seed: 1 });
    const sim = new Sim(planet, DEFAULT_RUN);
    const policy = new BeginnerPolicy(sim);

    const first = policy.decide();
    expect(first).toHaveLength(1);
    expect(first[0].kind).toBe('BUILD');
    const cellId = (first[0] as { kind: 'BUILD'; cellId: number }).cellId;
    sim.enqueue(first[0]);
    sim.step();
    expect(sim.state.buildings[cellId]).not.toBeNull();

    // Zniszcz DOKŁADNIE tę pozycję — reszta stanu nietknięta.
    sim.state.buildings[cellId] = null;

    const second = policy.decide();
    expect(second).toEqual(first); // ta sama komórka, ten sam typ budynku
  });
});

describe('formatReport', () => {
  /**
   * Domyślny timeout vitest (5000 ms) nie starcza: 20 runów × 2 wywołania `batch()` to
   * 40 pełnych przebiegów. Sam JS jest synchroniczny, więc timeout (mechanizm asynchroniczny)
   * i tak nie przerwie pętli w środku — zgłosi przekroczenie PO jej zakończeniu.
   *
   * ## Skąd 120 s, skoro zmierzony czas to ~15,5 s
   *
   * **Bo poprzedni limit (30 s) był wyprowadzony z pomiaru na BEZCZYNNEJ maszynie**, a
   * definicja ukończenia Fazy 2C wymaga sześciu przebiegów pakietu **pod obciążeniem**.
   * Zmierzone przy dwukrotnym przeciążeniu rdzeni (20 procesów palących CPU na 10 rdzeniach):
   *
   * | | bezczynnie | pod obciążeniem | czynnik |
   * |---|---|---|---|
   * | sonda arytmetyczna | 1807 ms | 5171 ms | 2,9× |
   * | ten plik testowy | 25,5 s | 79–84 s | 3,2× |
   *
   * Ten test to ~15,5 s bezczynnie, czyli **~50 s pod obciążeniem** — czyli 30 s oblewało
   * **we wszystkich sześciu** przebiegach. 120 s daje 2,4× zapasu nad zmierzonym najgorszym
   * przypadkiem obciążeniowym.
   *
   * **Czego NIE zrobiono i dlaczego:** nie skrócono partii z 20 runów. Test mierzy, że
   * RAPORT ZBIORCZY jest powtarzalny, a zmniejszanie próby po to, żeby zmieścić się
   * w zegarze, jest osłabianiem strażnika pod pretekstem wydajności. Zmieniona została
   * przesłanka progu, nie treść testu.
   */
  it('partia 20 runów na tych samych seedach daje identyczny raport', () => {
    const batch = () =>
      formatReport(Array.from({ length: 20 }, (_, i) => simulateRun(i, DEFAULT_RUN, 50_000)));
    expect(batch()).toBe(batch());
  }, 120_000);

  it('raport zawiera pozycje wymagane przez §8.3 specu', () => {
    const text = formatReport(
      Array.from({ length: 5 }, (_, i) => simulateRun(i, DEFAULT_RUN, 50_000)),
    );
    // `porażek`/`obciętych` doszły w przeglądzie gałęzi: §8.3 mówi o ROZKŁADACH, a te
    // są czytelne tylko wtedy, gdy wiadomo, ile runów w ogóle się skończyło.
    for (const key of ['zwycięstw', 'porażek', 'obciętych', 'porażki', 'wyczerpanie', 'słońce', 'wieże']) {
      expect(text).toContain(key);
    }
  });
});

/**
 * PRZEGLĄD GAŁĘZI, Important #3. `Phase` ma trzy wartości, `formatReport` obsługiwał
 * dwie: runy wciąż `RUNNING` (obcięte limitem ticków) nie były nigdzie policzone.
 * Zmierzone przed poprawką: pięć runów, z których ŻADEN się nie skończył, drukowało
 * `runów: 5 / zwycięstw: 0 (0.0%)` i „moment porażki: brak danych" — czytelnik nie miał
 * skąd wiedzieć, że zero runów w ogóle dobiegło końca. Raport z 1000 runów był sensowny
 * WYŁĄCZNIE dlatego, że wszystkie naprawdę przegrały, czego nic nie asercjowało.
 */
describe('formatReport — rozróżnienie „przegrał" od „skończył się budżet ticków"', () => {
  it('partia obcięta jest oznaczona jako obcięta, w miejscu nie do przeoczenia', () => {
    // 500 ticków: zmierzone, wszystkie te seedy są wtedy jeszcze w fazie RUNNING.
    const cut = Array.from({ length: 5 }, (_, i) => simulateRun(i, DEFAULT_RUN, 500));
    expect(cut.every((r) => r.phase === 'RUNNING')).toBe(true); // przesłanka testu

    const text = formatReport(cut);
    const first = text.split('\n')[0];

    // Ostrzeżenie w PIERWSZEJ linii, nie schowane w środku tabeli.
    expect(first).toContain('UWAGA');
    expect(first).toContain('NIE ZAKOŃCZYŁO SIĘ');
    expect(text).toContain('obciętych: 5 (100.0%)');
    expect(text).toContain('porażek:   0 (0.0%)');
  });

  it('partia zakończona NIE jest oznaczana jako obcięta, a rozbicie się zgadza', () => {
    const done = Array.from({ length: 5 }, (_, i) => simulateRun(i, DEFAULT_RUN, 50_000));
    expect(done.every((r) => r.phase === 'DEFEAT')).toBe(true); // przesłanka testu

    const text = formatReport(done);
    expect(text).not.toContain('UWAGA');
    // Pierwsza linia czystego raportu to od Fazy 3 NAZWA POLITYKI, a `runów:` zaraz pod nią.
    // Kolejność jest kontraktem: ostrzeżenia (gdy są) — kontekst — liczby. Bez nazwy
    // polityki dwa raporty z dwóch botów są nierozróżnialne (§11.1).
    const [pierwsza, druga] = text.split('\n');
    expect(pierwsza).toBe('polityka: beginner');
    expect(druga).toBe('runów: 5');
    expect(text).toContain('porażek:   5 (100.0%)');
    expect(text).toContain('obciętych: 0 (0.0%)');
    expect(text).toContain('zwycięstw: 0 (0.0%)');
  });

  /**
   * Trzy kubełki muszą sumować się do całości — inaczej „obciętych: 0" mogłoby znaczyć
   * „nie umiem ich policzyć" zamiast „nie było żadnego". Partia mieszana składana
   * z dwóch przebiegów tych samych seedów: jednego do końca, drugiego uciętego.
   */
  it('zwycięstwa + porażki + obcięte sumują się do liczby runów, także w partii mieszanej', () => {
    const mixed = [
      ...Array.from({ length: 3 }, (_, i) => simulateRun(i, DEFAULT_RUN, 50_000)),
      ...Array.from({ length: 2 }, (_, i) => simulateRun(i, DEFAULT_RUN, 500)),
    ];
    const text = formatReport(mixed);
    expect(text).toContain('UWAGA');
    expect(text).toContain('runów: 5');
    expect(text).toContain('porażek:   3 (60.0%)');
    expect(text).toContain('obciętych: 2 (40.0%)');
  });
}, 30_000);
