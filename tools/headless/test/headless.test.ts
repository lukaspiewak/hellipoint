import { describe, expect, it } from 'vitest';
import { createPlanet, DEFAULT_RUN, Sim, type RunConfig } from '@heliopolis/sim';
import { simulateRun } from '../src/run.js';
import { formatReport } from '../src/report.js';
import { ScriptedPolicy } from '../src/policy.js';

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
    // Zmierzone wprost (`simulateRun(7, DEFAULT_RUN, 50_000)`, po rundzie poprawek 1 —
    // wieża przed barykadą): DEFEAT w ticku 862, 9 budynków w szczycie, 61,9 rudy
    // wydobytej. Asercja celowo NIE na zabiciach: to jedyna z czterech liczb, która
    // zmienia się z każdą zmianą polityki/balansu (przed poprawką było ich 0, po —
    // 2), a ruda/ticki/budynki są stabilniejszym dowodem "to nie jest martwy run".
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

    // Zmierzone OSOBNO (poza tym plikiem): DEFAULT_RUN + ScriptedPolicy nigdy nie
    // wyczerpuje ŻADNEGO złoża w 400 próbkowanych seedach — presja wroga zabija bazę
    // szybciej, niż jeden ekstraktor zdąży wydobyć 400 rudy z pojedynczej komórki.
    // Bez poniższego "wyczerpanie" w raporcie zawsze czytałoby "brak danych" dla
    // KAŻDEGO seeda, a wartość -1 nigdy nie zostałaby odróżniona od realnej w praktyce —
    // dokładnie ten rodzaj testu, który przechodzi, bo nigdy nie widzi interesującej
    // gałęzi. Config niżej drastycznie obniża tempo spawnu (ale > 0 — Sim odrzuca
    // dokładne zero), żeby dać polityce czas na wydobycie, i pokazuje, że ścieżka
    // "wyczerpano" jest OSIĄGALNA, nie tylko teoretyczna.
    //
    // 3 seedy, nie 5: run bez presji wroga trwa ~40 tys. ticków z rosnącą do
    // kilkudziesięciu budynków bazą — zmierzone ~5-9 s na seed. Runda poprawek 1
    // (wieża przed barykadą) podniosła koszt jeszcze trochę i 5 seedów zaczęło
    // przekraczać nawet podniesiony timeout (30 s); 3 mieszczą się z zapasem,
    // a każdy z osobna i tak wystarcza do `depleted.length > 0`.
    const easy: RunConfig = {
      ...DEFAULT_RUN,
      spawn: { ...DEFAULT_RUN.spawn, baseRatePerPentagon: 0.001, growthPerCycle: 1 },
    };
    const results = Array.from({ length: 3 }, (_, i) => simulateRun(i, easy, 100_000));
    const depleted = results.filter((r) => r.firstDepletionTick > 0);
    expect(depleted.length).toBeGreaterThan(0);
    for (const r of depleted) expect(Number.isInteger(r.firstDepletionTick)).toBe(true);
  }, 45_000);
});

describe('ScriptedPolicy', () => {
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
    const policy = new ScriptedPolicy(sim);

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
  // Domyślny timeout vitest (5000 ms) nie starcza: 20 runów × 2 wywołania batch() to
  // 40 przebiegów do 50 000 ticków. Zmierzone: ~15,5 s na tej maszynie — sam JS jest
  // synchroniczny, więc domyślny timeout (asynchroniczny mechanizm) i tak nie przerwałby
  // pętli w środku, tylko zgłosiłby przekroczenie PO jej zakończeniu. Defekt brief-u:
  // podany dosłownie test wywala się na własnym timeoucie, nie na złej wartości.
  it('partia 20 runów na tych samych seedach daje identyczny raport', () => {
    const batch = () =>
      formatReport(Array.from({ length: 20 }, (_, i) => simulateRun(i, DEFAULT_RUN, 50_000)));
    expect(batch()).toBe(batch());
  }, 30_000);

  it('raport zawiera pozycje wymagane przez §8.3 specu', () => {
    const text = formatReport(
      Array.from({ length: 5 }, (_, i) => simulateRun(i, DEFAULT_RUN, 50_000)),
    );
    for (const key of ['zwycięstw', 'porażki', 'wyczerpanie', 'słońce', 'wieże']) {
      expect(text).toContain(key);
    }
  });
});
