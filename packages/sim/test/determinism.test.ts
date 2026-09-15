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

/**
 * Sześć pozostałych pól `RunConfig` nie miało żadnej walidacji, a DWA z nich wpływają
 * wprost do `SimState`: `cyclesPerRun` → `evacUnlockTick`, `evacAlarmSeconds` →
 * `evacAlarmRemaining`. Zmierzone przed poprawką: `cyclesPerRun: NaN` dawało
 * `evacUnlockTick = NaN`, a `evacAlarmSeconds: Infinity` — `evacAlarmRemaining = Infinity`.
 * `JSON.stringify` zamienia obie wartości na `null`, więc po wczytaniu zapisu w Fazie 5
 * `s.tick < null` jest fałszem na zawsze (bramka §5.6 odwraca się w „zawsze otwarta"),
 * a `null >= 0` i `null - 0,05 <= ALARM_EPSILON` są jednocześnie prawdziwe — pierwszy
 * tick po wczytaniu ogłasza ZWYCIĘSTWO.
 */
describe('RunConfig — walidacja pozostałych sześciu pól', () => {
  const planet = createPlanet({ seed: 1 });
  const build = (patch: Partial<typeof DEFAULT_RUN>) =>
    () => new Sim(planet, { ...DEFAULT_RUN, ...patch });

  it('cyclesPerRun musi być całkowity i >= 1', () => {
    expect(build({ cyclesPerRun: 0 })).toThrow(/cyclesPerRun.*0/);
    expect(build({ cyclesPerRun: -3 })).toThrow(/cyclesPerRun.*-3/);
    expect(build({ cyclesPerRun: NaN })).toThrow(RangeError);
    expect(build({ cyclesPerRun: Infinity })).toThrow(RangeError);
    expect(build({ cyclesPerRun: 2.5 })).toThrow(/cyclesPerRun.*2\.5/);
    expect(build({ cyclesPerRun: 1 })).not.toThrow();
  });

  it('evacUnlockFraction musi być skończonym ułamkiem z [0, 1]', () => {
    expect(build({ evacUnlockFraction: -0.1 })).toThrow(/evacUnlockFraction.*-0\.1/);
    expect(build({ evacUnlockFraction: 1.5 })).toThrow(/evacUnlockFraction.*1\.5/);
    expect(build({ evacUnlockFraction: NaN })).toThrow(RangeError);
    expect(build({ evacUnlockFraction: Infinity })).toThrow(RangeError);
    // Obie granice INCLUSIVE: 0 = Evac od pierwszego ticka, 1 = dopiero w ostatnim cyklu.
    expect(build({ evacUnlockFraction: 0 })).not.toThrow();
    expect(build({ evacUnlockFraction: 1 })).not.toThrow();
  });

  it('evacEnergyRequired musi być skończony i DODATNI — zero usuwa ładowanie', () => {
    expect(build({ evacEnergyRequired: 0 })).toThrow(/evacEnergyRequired.*0/);
    expect(build({ evacEnergyRequired: -1 })).toThrow(RangeError);
    expect(build({ evacEnergyRequired: NaN })).toThrow(RangeError);
    expect(build({ evacEnergyRequired: Infinity })).toThrow(RangeError);
  });

  it('evacChargeRate musi być skończony i DODATNI — zero blokuje zwycięstwo na zawsze', () => {
    expect(build({ evacChargeRate: 0 })).toThrow(/evacChargeRate.*0/);
    expect(build({ evacChargeRate: -5 })).toThrow(RangeError);
    expect(build({ evacChargeRate: NaN })).toThrow(RangeError);
    expect(build({ evacChargeRate: Infinity })).toThrow(RangeError);
  });

  it('evacAlarmSeconds musi być skończony i DODATNI — zero usuwa alarm z warunku wygranej', () => {
    expect(build({ evacAlarmSeconds: 0 })).toThrow(/evacAlarmSeconds.*0/);
    expect(build({ evacAlarmSeconds: -60 })).toThrow(RangeError);
    expect(build({ evacAlarmSeconds: NaN })).toThrow(RangeError);
    expect(build({ evacAlarmSeconds: Infinity })).toThrow(RangeError);
  });

  it('spawn musi być obiektem SpawnConfig, nie null ani liczbą', () => {
    expect(build({ spawn: null as never })).toThrow(/spawn/);
    expect(build({ spawn: undefined as never })).toThrow(/spawn/);
    expect(build({ spawn: 7 as never })).toThrow(/spawn/);
  });

  /**
   * Straż na WYNIKU, nie tylko na wejściach — ten sam idiom, co przy `angle`
   * w `sunDirection` (light.ts). `rotationPeriod = 1e308` jest skończony i większy od
   * ticka, więc przechodzi obie straże okresu obrotu, ale iloczyn `(cykl − 1) × 1e308`
   * przepełnia się do Infinity. Bez tej straży poprawna konfiguracja wstawiałaby
   * nieskończoność do `SimState`.
   */
  it('odrzuca konfigurację, w której sam próg PRZEPEŁNIA się do nieskończoności', () => {
    expect(build({ rotationPeriod: 1e308 })).toThrow(/evacUnlockTick.*non-finite/);
  });

  /**
   * Odwrotny kierunek dowodu: nie „te wartości są odrzucane", tylko „żadna PRZYJĘTA
   * konfiguracja nie wstawia do stanu nieskończoności ani NaN". Skrajne, ale legalne
   * kombinacje — najkrótszy dopuszczalny obrót, próg na obu granicach ułamka, alarm
   * mikroskopijny i ogromny.
   */
  it('żadna konfiguracja przechodząca walidację nie daje nieskończoności ani NaN w SimState', () => {
    const skrajne = [
      { cyclesPerRun: 1, evacUnlockFraction: 0 },
      { cyclesPerRun: 1, evacUnlockFraction: 1 },
      { cyclesPerRun: 1_000_000, evacUnlockFraction: 1 },
      { rotationPeriod: TICK_SECONDS, cyclesPerRun: 1_000_000 },
      { rotationPeriod: 1e6, evacAlarmSeconds: 1e-6 },
      { evacAlarmSeconds: 1e6, evacEnergyRequired: 1e-9, evacChargeRate: 1e9 },
    ];
    for (const patch of skrajne) {
      const sim = new Sim(planet, { ...DEFAULT_RUN, ...patch });
      const opis = JSON.stringify(patch);
      expect(Number.isFinite(sim.state.evacUnlockTick), `evacUnlockTick dla ${opis}`).toBe(true);
      expect(Number.isFinite(sim.state.evacAlarmRemaining), `evacAlarmRemaining dla ${opis}`).toBe(true);
      expect(sim.state.evacUnlockTick, `evacUnlockTick dla ${opis}`).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * Clamp `Math.max(0, …)` przy `evacUnlockTick`: przy `evacUnlockFraction = 0`
   * cykl odblokowania wychodzi 0, więc `(0 − 1) × rotationPeriod` jest UJEMNE. Ten sam
   * wzorzec, co podłoga regeneracji ekspozycji w burning.ts — bez clampa do stanu
   * trafiłby ujemny tick, a `s.tick < -3600` byłoby fałszem „przypadkiem", nie z zasady.
   */
  it('clamp trzyma próg na zerze tam, gdzie surowe wyliczenie jest UJEMNE', () => {
    const sim = new Sim(planet, { ...DEFAULT_RUN, evacUnlockFraction: 0 });
    const cyklOdblokowania = Math.ceil(DEFAULT_RUN.cyclesPerRun * 0);
    expect(cyklOdblokowania).toBe(0); // przesłanka: surowo (0 − 1) × 180 / 0,05 = −3600
    expect(sim.state.evacUnlockTick).toBe(0);
  });
});
