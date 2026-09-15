import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { Sim } from '../src/sim/loop.js';
import { stateHash } from '../src/sim/hash.js';
import { TICK_SECONDS } from '../src/sim/state.js';
import type { Command } from '../src/sim/commands.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';

/**
 * Pola `rotationPeriod`/`startingOre` wypisane JAWNIE, mimo że `DEFAULT_RUN` ma dziś
 * dokładnie te wartości: reszta `DEFAULT_RUN` jest oznaczona `[STROJENIE]` i Faza 3
 * będzie ją przestawiać headlessem, a te dwie liczby są dobrane pod konkretne asercje
 * tego pliku (1200 ticków = 60 s przy obrocie 180 s; 150 rudy starcza na skrypt
 * PYLON+BARRICADE). Bez jawnego nadpisania przestrojenie `DEFAULT_RUN` po cichu
 * zmieniałoby sens tych testów.
 */
const CONFIG = { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: 150 };

/**
 * `withCommands = false` daje IDENTYCZNĄ pętlę step() bez żadnej komendy w kolejce —
 * potrzebne, żeby odróżnić "hash różni się, bo komendy coś zmieniły" od "hash różni
 * się, bo `oreRemaining` (seedowane z rozmieszczenia rudy) jest inne dla innego seeda".
 */
function runScripted(seed: number, ticks: number, withCommands = true): string {
  const planet = createPlanet({ seed });
  const sim = new Sim(planet, CONFIG);

  // Komórki wybierane z planety, NIE zaszyte na sztywno: stały indeks mógłby trafić
  // na pentagon albo złoże, przez co komenda byłaby po cichu ignorowana
  // i test determinizmu przechodziłby, nie sprawdzając niczego.
  const buildable = planet.cells
    .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell)
    .map((c) => c.id);
  const [c1, c2] = [buildable[0], buildable[1]];

  const script: Array<[number, Command]> = withCommands
    ? [
        [10, { kind: 'BUILD', cellId: c1, type: 'PYLON' }],
        [25, { kind: 'BUILD', cellId: c2, type: 'BARRICADE' }],
        [40, { kind: 'DEMOLISH', cellId: c1 }],
      ]
    : [];
  for (let t = 0; t < ticks; t++) {
    for (const [at, cmd] of script) if (at === t) sim.enqueue(cmd);
    sim.step();
  }
  return stateHash(sim.state);
}

describe('determinizm (§7.2)', () => {
  it('ten sam seed + ta sama kolejka komend ⇒ ten sam hash po 1200 tickach', () => {
    expect(runScripted(2026, 1200)).toBe(runScripted(2026, 1200));
  });

  // UWAGA na zakres tego testu: NIE dowodzi, że komendy/step() biorą udział w hashu —
  // `stateHash` hashuje `oreRemaining`, a to jest seedowane wprost z rozmieszczenia rudy
  // (`planet.cells[].oreCapacity`), różnego dla różnych seedów już w `createState`,
  // zanim jakikolwiek `step()` się wykona. Dowód, że komendy naprawdę zmieniają hash,
  // jest w teście `komendy zmieniają hash` niżej.
  it('różne ziarno ⇒ różny hash — już od stanu startowego (oreRemaining), niezależnie od komend czy step()', () => {
    expect(runScripted(2026, 600)).not.toBe(runScripted(2027, 600));
  });

  it('komendy zmieniają hash: ten sam seed i liczba ticków, z komendami vs. bez komend w kolejce, dają różny hash', () => {
    expect(runScripted(2026, 1200, true)).not.toBe(runScripted(2026, 1200, false));
  });

  it('czas symulacji wynika wyłącznie z liczby ticków, nie z zegara', () => {
    const sim = new Sim(createPlanet({ seed: 1 }), CONFIG);
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.elapsedSeconds).toBeCloseTo(1, 12);
    expect(sim.state.tick).toBe(20);
  });
});

/**
 * `pending` w Sim to zwykła tablica z push + for...of — poprawne dziś tylko dlatego,
 * że nikt tego nie zmienił. Faza 5 będzie polegać na kolejności FIFO przy replayu
 * komend z sieci, więc przyszła zmiana struktury kolejki mogłaby złamać ten kontrakt
 * niewidocznie, gdyby nic go nie pilnowało.
 */
describe('kolejność komend w jednym ticku', () => {
  it('dwie komendy dotykające tej samej komórki w tym samym ticku stosowane są w kolejności enqueue (FIFO) — wygrywa PIERWSZA, nie druga', () => {
    const planet = createPlanet({ seed: 4 });
    const target = planet.cells.find(
      (c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell,
    )!.id;
    const sim = new Sim(planet, CONFIG);

    sim.enqueue({ kind: 'BUILD', cellId: target, type: 'PYLON' });
    sim.enqueue({ kind: 'BUILD', cellId: target, type: 'BARRICADE' });
    sim.step();

    // Gdyby kolejność była odwrócona (albo niezdeterminowana), na komórce
    // stanąłby BARRICADE — druga komenda — a nie PYLON, pierwsza.
    expect(sim.state.buildings[target]).toMatchObject({ type: 'PYLON' });
  });
});

/**
 * Minor z przeglądu końcowego Fazy 1B: `step()` wracał wcześniej PRZED
 * `this.pending.length = 0`, gdy `phase !== 'RUNNING'` — kolejka rosła bez ograniczeń.
 * Zmierzone przed poprawką: 1000 komend wysłanych, 1000 wciąż rezydujących. Nieszkodliwe
 * dziś (nic tak nie woła `Sim`), realne w Fazie 5, gdzie klient może nadal wysyłać
 * komendy po zakończeniu meczu.
 */
describe('drenowanie kolejki komend poza fazą RUNNING', () => {
  it('step() opróżnia kolejkę nawet gdy gra się skończyła, zamiast pozwolić jej rosnąć bez końca', () => {
    const planet = createPlanet({ seed: 6 });
    const sim = new Sim(planet, CONFIG);
    const target = planet.cells.find(
      (c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell,
    )!.id;

    sim.state.phase = 'VICTORY'; // mecz zakończony
    for (let i = 0; i < 1000; i++) sim.enqueue({ kind: 'BUILD', cellId: target, type: 'PYLON' });
    sim.step(); // no-op z powodu fazy — ale MUSI zdrenować kolejkę, nie tylko pominąć krok

    sim.state.phase = 'RUNNING'; // gdyby kolejka przeciekła, WŁAŚNIE TEN krok by ją zużył
    sim.step();

    // Skoro kolejka została opróżniona podczas kroku no-op, żadna z tych 1000 komend
    // nigdy się nie zastosowała: budynek nie powstał.
    expect(sim.state.buildings[target]).toBeNull();
  });
});

/**
 * `rotationPeriod` zły przepływa do `terminatorSpeedWorld`/`terminatorSpeedCells`/
 * `terminatorCrossingTime` w scale.ts, które dzielą przez nie bez żadnej straży —
 * zdegenerowana wartość dałaby ciche Infinity/0 dopiero w Fazie 1C, bez błędu
 * w tym miejscu. Walidacja w konstruktorze chroni WSZYSTKICH konsumentów naraz.
 * `!(x > 0)` NIE łapie Infinity (Infinity > 0 jest prawdziwe) — stąd Number.isFinite.
 */
describe('RunConfig — walidacja w konstruktorze Sim', () => {
  const planet = createPlanet({ seed: 1 });

  it('odrzuca rotationPeriod <= 0 lub nieskończony', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 0, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: -180, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: NaN, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: Infinity, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: -Infinity, startingOre: 100 })).toThrow(RangeError);
  });

  it('odrzuca startingOre ujemny lub nieskończony', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: -1 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: NaN })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: Infinity })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: -Infinity })).toThrow(RangeError);
  });

  it('akceptuje startingOre = 0 — niezerowa dolna granica byłaby błędem (pole jest NIEUJEMNE, nie dodatnie)', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: 0 })).not.toThrow();
  });

  it('komunikat błędu nazywa pole i wartość, a nie tylko ogólnikowo "invalid config"', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: -5, startingOre: 100 })).toThrow(/rotationPeriod.*-5/);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: -5 })).toThrow(/startingOre.*-5/);
  });

  /**
   * Residual z przeglądu końcowego Fazy 1B: `rotationPeriod` skończony i dodatni
   * (przechodzi powyższą straż) ale krótszy niż jeden tick oznacza, że Słońce robi
   * pełny obrót WEWNĄTRZ pojedynczego ticku — to nie jest symulowalny cykl dzień/noc,
   * niezależnie od tego, czy akurat przepełnia `angle` w `sunDirection` (por.
   * light.test.ts, `rotationPeriod = 1e-320`). Druga warstwa tej samej straży: tu
   * łapiemy DOMENOWO ("za krótki, żeby cokolwiek symulować"), w `sunDirection` —
   * LOKALNIE ("angle wyszedł nieskończony"). Zweryfikowano: żaden istniejący test
   * w tym pakiecie nie używa rotationPeriod < 180s poza testami odrzucenia.
   */
  it('odrzuca rotationPeriod krótszy niż jeden tick — pełny obrót Słońca w jednym ticku nie jest symulowalnym cyklem dzień/noc', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: TICK_SECONDS / 2, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 1e-320, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: TICK_SECONDS / 2, startingOre: 100 })).toThrow(/rotationPeriod/);
  });

  it('akceptuje rotationPeriod dokładnie równy jednemu tickowi — granica jest inclusive, "krótszy niż" to ostra nierówność', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: TICK_SECONDS, startingOre: 100 })).not.toThrow();
  });
});
