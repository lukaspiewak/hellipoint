import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { Sim } from '../src/sim/loop.js';
import { stateHash } from '../src/sim/hash.js';
import { TICK_SECONDS } from '../src/sim/state.js';
import { minRotationPeriod } from '../src/sim/movement.js';
import type { Command } from '../src/sim/commands.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';
import { DEFAULT_SPAWN } from '../src/sim/spawning.js';
import { GESTA_FAZA_SLONCA, GESTY_SPAWN, gestyRun } from './support/gestySpawn.js';

/**
 * Pola `rotationPeriod`/`startingOre` wypisane JAWNIE, mimo że `DEFAULT_RUN` ma dziś
 * dokładnie te wartości: reszta `DEFAULT_RUN` jest oznaczona `[STROJENIE]` i Faza 3
 * będzie ją przestawiać headlessem, a te dwie liczby są dobrane pod konkretne asercje
 * tego pliku (1200 ticków = 60 s przy obrocie 180 s; 150 rudy starcza na skrypt
 * PYLON+BARRICADE). Bez jawnego nadpisania przestrojenie `DEFAULT_RUN` po cichu
 * zmieniałoby sens tych testów.
 */
/**
 * Tempo spawnu i faza słońca PRZYPIĘTE — patrz `gestyRun`. Determinizm ma być dowodzony na przebiegu
 * BOGATYM w zdarzenia; kontrolę tego bogactwa niesie `fullrun.test.ts` i musi ona opisywać
 * TĘ SAMĄ konfigurację.
 */
const CONFIG = gestyRun({ ...DEFAULT_RUN, rotationPeriod: 180, startingOre: 150 });

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
   * (przechodzi powyższą straż) ale za krótki, żeby symulacja dała się przeliczyć.
   * Druga warstwa tej samej straży: tu łapiemy DOMENOWO ("za krótki, żeby cokolwiek
   * symulować"), w `sunDirection` — LOKALNIE ("angle wyszedł nieskończony", por.
   * light.test.ts, `rotationPeriod = 1e-320`).
   */
  it('odrzuca rotationPeriod za krótki do przeliczenia', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: TICK_SECONDS / 2, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 1e-320, startingOre: 100 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: TICK_SECONDS / 2, startingOre: 100 })).toThrow(/rotationPeriod/);
  });

  /**
   * PRZEGLĄD GAŁĘZI, Important #1. Poprzednia wersja tego bloku asercjowała
   * `not.toThrow()` dla `rotationPeriod = TICK_SECONDS` i NIGDY nie wykonywała kroku —
   * przypinała więc kontrakt, którego symulacja nie spełnia. Zmierzone: `new Sim(planet,
   * {...DEFAULT_RUN, rotationPeriod: 0.05})` konstruuje się bez słowa, a `.step()` rzuca
   * `RangeError` w ticku 12 (pierwszym niosącym jednostkę) — z komunikatem o `speedFactor`
   * i `MotionContext`, czyli o wszystkim poza polem, które wołający naprawdę ustawił.
   * Zmierzony przemiat: KAŻDY okres ≤ 7,20 s rzucał (w ticku 12/21/85/123/148/150
   * zależnie od seeda), 7,21 s przechodził 3000 ticków czysto.
   *
   * Podłoga jest teraz WYPROWADZONA z niezmiennika `updateMovement` (patrz
   * `minRotationPeriod` w movement.ts) i wynosi dla planety domyślnej
   * 7,203121207399654 s — zgodnie z pomiarem.
   */
  it('odrzuca KAŻDY okres poniżej wyprowadzonej podłogi — łącznie z tym, który konstruował się bez słowa i wywalał dopiero w ticku 12', () => {
    const podloga = minRotationPeriod(planet);
    expect(podloga).toBeCloseTo(7.2031, 4);

    for (const rp of [TICK_SECONDS, 1, 7, 7.19, 7.2, podloga * (1 - 1e-12)]) {
      expect(
        () => new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: rp, startingOre: 100 }),
        `rotationPeriod=${rp} powinien zostać odrzucony przez KONSTRUKTOR`,
      ).toThrow(RangeError);
    }
  });

  /**
   * Odwrotny kierunek dowodu, i ten jest tu ważniejszy: podłoga musi być DOKŁADNIE
   * granicą straży w `updateMovement`, nie ostrożnym marginesem "gdzieś w okolicy".
   * Sama wartość zwracana przez `minRotationPeriod` przechodzi konstrukcję ORAZ realny
   * przebieg — 3000 ticków to ~20× ponad zmierzone miejsce, w którym stary kod wywalał.
   */
  it('okres dokładnie równy podłodze konstruuje się I PRZELICZA — granica nie jest ostrożnym marginesem', () => {
    const podloga = minRotationPeriod(planet);
    const sim = new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: podloga, startingOre: 100 });
    expect(() => { for (let i = 0; i < 3000; i++) sim.step(); }).not.toThrow();
    // Przesłanka: przebieg NAPRAWDĘ niósł jednostki, więc straż ruchu była wołana.
    expect(sim.state.nextUnitId).toBeGreaterThan(1);
  });

  it('komunikat odrzucenia nazywa rotationPeriod, podaną wartość i minimum, które zadziała', () => {
    let msg = '';
    try { new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 0.05, startingOre: 100 }); }
    catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('rotationPeriod');
    expect(msg).toContain('0.05');
    expect(msg).toContain(String(minRotationPeriod(planet)));
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
      // Najkrótszy DOPUSZCZALNY obrót, liczony z planety — nie `TICK_SECONDS`, który
      // przed przeglądem gałęzi był tu podłogą, a symulacji nie dało się przy nim
      // przeliczyć (patrz `minRotationPeriod` w movement.ts).
      { rotationPeriod: minRotationPeriod(planet), cyclesPerRun: 1_000_000 },
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

/**
 * Pola `SpawnConfig` wpływają do `SimState` tą samą drogą, co `cyclesPerRun`
 * i `evacAlarmSeconds`: `rate` (z `baseRatePerPentagon` i `growthPerCycle`) trafia
 * do `pentagons[].spawnAccumulator`, `eruptionInterval` wprost do
 * `pentagons[].eruptionCooldown`. Wartość zdegenerowana nie wywala się głośno —
 * `for (k = 0; k < NaN; k++)` to zero iteracji, a `cycle >= NaN` to `false` — więc
 * headless runner Fazy 3 dostałby ciche śmieci w rozkładach balansowych.
 */
describe('RunConfig.spawn — walidacja pól SpawnConfig', () => {
  const planet = createPlanet({ seed: 1 });
  const build = (patch: Partial<typeof DEFAULT_SPAWN>) =>
    () => new Sim(planet, { ...DEFAULT_RUN, spawn: { ...DEFAULT_SPAWN, ...patch } });

  it('baseRatePerPentagon musi być skończony i dodatni', () => {
    expect(build({ baseRatePerPentagon: 0 })).toThrow(/baseRatePerPentagon.*0/);
    expect(build({ baseRatePerPentagon: -1 })).toThrow(RangeError);
    expect(build({ baseRatePerPentagon: NaN })).toThrow(RangeError);
    expect(build({ baseRatePerPentagon: Infinity })).toThrow(RangeError);
  });

  it('growthPerCycle musi być skończony i >= 1 — poniżej 1 fale SŁABNĄ z cyklu na cykl', () => {
    expect(build({ growthPerCycle: 0.9 })).toThrow(/growthPerCycle.*0\.9/);
    expect(build({ growthPerCycle: 0 })).toThrow(RangeError);
    expect(build({ growthPerCycle: NaN })).toThrow(RangeError);
    expect(build({ growthPerCycle: Infinity })).toThrow(RangeError);
    // Dokładnie 1 legalne: tempo stałe, punkt odniesienia dla headlessa.
    expect(build({ growthPerCycle: 1 })).not.toThrow();
  });

  it('eruptionInterval ma podłogę jednego ticka — krótszy erupuje w KAŻDYM ticku', () => {
    expect(build({ eruptionInterval: 0 })).toThrow(/eruptionInterval/);
    expect(build({ eruptionInterval: TICK_SECONDS / 2 })).toThrow(/eruptionInterval/);
    expect(build({ eruptionInterval: -20 })).toThrow(RangeError);
    expect(build({ eruptionInterval: NaN })).toThrow(RangeError);
    expect(build({ eruptionInterval: Infinity })).toThrow(RangeError);
    // Granica inclusive, tak samo jak przy `rotationPeriod`.
    expect(build({ eruptionInterval: TICK_SECONDS })).not.toThrow();
  });

  it('eruptionBurstBase musi być skończony i >= 1, ale NIE musi być całkowity', () => {
    expect(build({ eruptionBurstBase: 0 })).toThrow(/eruptionBurstBase.*0/);
    expect(build({ eruptionBurstBase: 0.5 })).toThrow(RangeError);
    expect(build({ eruptionBurstBase: NaN })).toThrow(RangeError);
    expect(build({ eruptionBurstBase: Infinity })).toThrow(RangeError);
    // `updateSpawning` zaokrągla dopiero ILOCZYN, więc ułamkowa baza >= 1 jest sensowna.
    expect(build({ eruptionBurstBase: 4.5 })).not.toThrow();
  });

  it('eruptionScalePerCap musi być skończony i NIEUJEMNY — zero tylko wyłącza skalowanie', () => {
    expect(build({ eruptionScalePerCap: -0.1 })).toThrow(/eruptionScalePerCap.*-0\.1/);
    expect(build({ eruptionScalePerCap: NaN })).toThrow(RangeError);
    expect(build({ eruptionScalePerCap: Infinity })).toThrow(RangeError);
    // 0 legalne: erupcje nadal wybuchają, po prostu nie rosną z liczbą capów.
    expect(build({ eruptionScalePerCap: 0 })).not.toThrow();
  });

  it('disruptorFromCycle i armorFromCycle muszą być całkowite >= 1', () => {
    for (const pole of ['disruptorFromCycle', 'armorFromCycle'] as const) {
      expect(build({ [pole]: 0 }), pole).toThrow(new RegExp(`${pole}.*0`));
      expect(build({ [pole]: -1 }), pole).toThrow(RangeError);
      expect(build({ [pole]: 2.5 }), pole).toThrow(RangeError);
      expect(build({ [pole]: NaN }), pole).toThrow(RangeError);
      expect(build({ [pole]: Infinity }), pole).toThrow(RangeError);
      expect(build({ [pole]: 1 }), pole).not.toThrow();
    }
  });
});

/**
 * # Mnożnik nagród za zabicie — walidacja (Faza 3, Zadanie 3)
 *
 * `killRewardScale` jest suwakiem, którym Zadanie 3 stroi trudność: §11.1 wskazał stopę
 * nagród jako PRAWDZIWY regulator, z progiem między 0,25× a 0,1×. Mieszka w `RunConfig`,
 * a nie w `ENEMIES`, żeby przemiatanie mogło zmieniać go per przebieg i żeby widział go
 * `configFingerprint`.
 *
 * Tu stoi wyłącznie walidacja konstruktora — że suwak naprawdę DOCIERA do rudy, wiąże
 * `fullrun.test.ts`, bo do zabicia kogokolwiek potrzebna jest obrona, a bez niej CORE
 * pada w ~1000 ticków, zanim słońce kogokolwiek dopadnie (zmierzone: przy każdej stopie
 * spawnu od 0,25 do 0,02 wychodzi `killsBySun = 0`).
 */
describe('RunConfig.killRewardScale — walidacja w konstruktorze Sim', () => {
  const planet = createPlanet({ seed: 7 });

  it('odrzuca wartość zdegenerowaną — NaN rozlałby się po rudzie i uciszył `canBuild`', () => {
    for (const zly of [NaN, Infinity, -Infinity, -0.5]) {
      expect(
        () => new Sim(planet, { ...DEFAULT_RUN, killRewardScale: zly }),
        `killRewardScale=${zly}`,
      ).toThrow(RangeError);
    }
  });

  it('akceptuje 0 — stawka zerowa jest legalną nastawą przemiatania, nie błędem', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, killRewardScale: 0 })).not.toThrow();
  });

  it('komunikat nazywa pole i wartość', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, killRewardScale: -5 })).toThrow(
      /killRewardScale.*-5/,
    );
  });
});

/**
 * # Wielkości POCHODNE też mają straż (bramka gałęzi Fazy 3, znalezisko #2)
 *
 * `Number.isFinite(pole)` nie wystarcza, gdy pole wchodzi do iloczynu: `killRewardScale`
 * równe `1e308` przechodzi walidację, a przemnożone przez nagrodę daje `Infinity`
 * w `SimState.ore` — i łamie niezmiennik serializowalności wprost, bo `JSON.stringify`
 * zamienia nieskończoność na `null`. Migawka Fazy 5 wróciłaby wtedy z inną rudą niż
 * zapisano, a `stateHash` przestałby się zgadzać.
 *
 * Ta sama nauka stoi już w `spawning.ts` (`assertReleasable` na wielkości pochodnej,
 * nie na polu) — nowe pola Fazy 3 dostały drugie piętro dopiero tutaj.
 */
describe('RunConfig — straż na wielkościach POCHODNYCH, nie tylko na polach', () => {
  const planet = createPlanet({ seed: 7 });

  it('[PARA] killRewardScale przepełniający iloczyn z nagrodą jest odrzucany', () => {
    expect(() => new Sim(planet, { ...DEFAULT_RUN, killRewardScale: 1e308 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, killRewardScale: 1e308 })).toThrow(/overflow/);
    // Połówka „ma przejść": wartość duża, ale nieprzepełniająca, zostaje legalna.
    expect(() => new Sim(planet, { ...DEFAULT_RUN, killRewardScale: 1e300 })).not.toThrow();
  });

  it('[PARA] sunPhaseAtStart przepełniający iloczyn z okresem obrotu — w KONSTRUKTORZE', () => {
    // Bez tej straży `sunDirection` rzuca dopiero ze `step()`. Ten sam układ uznano
    // za wadę przy `rotationPeriod` i przeniesiono do konstruktora.
    expect(() => new Sim(planet, { ...DEFAULT_RUN, sunPhaseAtStart: 1e307 })).toThrow(RangeError);
    expect(() => new Sim(planet, { ...DEFAULT_RUN, sunPhaseAtStart: 1e300 })).not.toThrow();
  });

  it('KONTROLA: DEFAULT_RUN nie wywołuje żadnej z tych straży', () => {
    expect(() => new Sim(planet, DEFAULT_RUN)).not.toThrow();
  });
});
