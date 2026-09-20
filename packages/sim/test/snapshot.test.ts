import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { FLOWFIELD_INTERVAL_TICKS, isResumableTick, Sim } from '../src/sim/loop.js';
import { stateHash } from '../src/sim/hash.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';
import { createState, type SimState } from '../src/sim/state.js';
import type { Command } from '../src/sim/commands.js';
import { GESTA_FAZA_SLONCA, GESTY_SPAWN, gestyRun } from './support/gestySpawn.js';

/**
 * PRZEGLĄD GAŁĘZI, Important #2: „`SimState` NIE jest wznawialną migawką".
 *
 * Zmierzone przed poprawką: round-trip `sim.state` przez JSON i wczytanie do świeżego
 * `Sim` dawało zgodny `stateHash` W CHWILI WCZYTANIA, a potem rozjazd — populacje
 * różne po kilkuset tickach. Dwie przyczyny, obie POZA stanem:
 *
 *  1. pozycja `waveRng` — odtworzony generator startował od zera, więc `pickType`
 *     losowało inne typy wrogów. `Rng.getState`/`fromState` istniały, były
 *     eksportowane, ich doc-comment opisywał dokładnie ten tryb awarii — i NIC ich
 *     nie wołało. Naprawa: pozycja leży w `SimState.waveRng`, jest hashowana
 *     i wczytywana w konstruktorze.
 *  2. faza cache'u pól przepływu — warunek `this.fields === null || tick % 4 === 0`
 *     kazał wznowionemu `Sim`-owi przeliczyć pola w ticku wczytania, a nie w tym,
 *     w którym robił to oryginał. Naprawa: harmonogram jest funkcją SAMEGO `tick`,
 *     a migawki poza granicą są ODRZUCANE głośno (patrz ostatni blok).
 *
 * WIDOCZNOŚĆ. Przy `DEFAULT_RUN` pula spawnu w cyklu 1 ma jeden element (`['SWARM']`),
 * więc `rng.nextInt(1)` zawsze daje 0 i pozycja generatora NIE WPŁYWA na wynik aż do
 * cyklu 3 (tick 7200). Test, który tego nie obchodzi, byłby zielony nad NIENAPRAWIONYM
 * kodem — zmierzone wprost: przy `DEFAULT_RUN` i zapisie w ticku 200 wznowienie bez
 * przywróconej pozycji generatora jest identyczne przez 400 ticków. Stąd
 * `disruptorFromCycle`/`armorFromCycle` = 1: pula ma trzy typy od pierwszego ticka,
 * więc KAŻDE losowanie jest obserwowalne.
 */
const SEED = 5;

/** Pula trzech typów od cyklu 1 — inaczej pozycja generatora jest niewidoczna. */
/**
 * **Tempo spawnu PRZYPIĘTE, nie odziedziczone po `DEFAULT_RUN`.**
 *
 * Ten test dowodzi czegoś o wznawianiu migawki, a nie o balansie — i żeby dowodził, run
 * musi być GĘSTY: przy rzadkim strumieniu „hash identyczny przez 400 ticków" jest prawdą
 * o dwóch prawie pustych stanach. Zmierzone, gdy Zadanie 3 obniżyło `baseRatePerPentagon`
 * z 0,25 na 0,05: w 400 tickach rodziła się **jedna** jednostka i przesłanka „przebieg
 * naprawdę coś robił" oblewała — kontrola pozytywna zadziałała dokładnie tak, jak miała.
 *
 * Wniosek nie brzmi „poluzować przesłankę", tylko **odpiąć fiksturę od nastawy gry**.
 * Ta sama decyzja i to samo uzasadnienie, co przy `GOLDEN_RUN_CONFIG` w `golden-hash.test.ts`:
 * fikstura, która idzie za balansem, przestaje opisywać to, co opisywała.
 */
const CONFIG = {
  ...gestyRun(DEFAULT_RUN),
  startingOre: 400,
  spawn: { ...GESTY_SPAWN, disruptorFromCycle: 1, armorFromCycle: 1 },
};

/**
 * Skrypt budowy przywiązany do ticku, a nie do polityki: zabudowa MUSI zmieniać się
 * w trakcie przebiegu, inaczej pola przepływu są stałe i ich faza nie ma czego zepsuć
 * (dokładnie ten powód sprawiał, że pierwsza wersja pomiaru nic nie widziała).
 * Komendy celowo lądują na tickach NIEBĘDĄCYCH wielokrotnością 4.
 */
function scriptFor(planet: ReturnType<typeof createPlanet>): Array<[number, Command]> {
  const buildable = planet.cells
    .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell)
    .map((c) => c.id);
  const ring = planet.cells[planet.startCell].neighbors;
  return [
    [41, { kind: 'BUILD', cellId: ring[0], type: 'BARRICADE' }],
    [101, { kind: 'BUILD', cellId: ring[1], type: 'BARRICADE' }],
    [161, { kind: 'BUILD', cellId: ring[2], type: 'LASER_TURRET' }],
    [201, { kind: 'BUILD', cellId: buildable[0], type: 'PYLON' }],
    [241, { kind: 'BUILD', cellId: ring[3], type: 'BARRICADE' }],
    [301, { kind: 'DEMOLISH', cellId: ring[0] }],
    [401, { kind: 'BUILD', cellId: ring[0], type: 'BARRICADE' }],
    [501, { kind: 'BUILD', cellId: buildable[1], type: 'SOLAR_PANEL' }],
  ];
}

function advance(sim: Sim, script: Array<[number, Command]>, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    for (const [at, cmd] of script) if (at === sim.state.tick) sim.enqueue(cmd);
    sim.step();
  }
}

/** Migawka tak, jak zrobi ją Faza 5: przez JSON, z planetą odtwarzaną z seeda. */
function snapshotThroughJson(sim: Sim): SimState {
  return JSON.parse(JSON.stringify({ ...sim.state, planet: undefined })) as SimState;
}

describe('SimState jako wznawialna migawka', () => {
  it.each([0, 100, 200, 400])(
    'zapis w ticku %i, wznowienie do świeżego Sim — hash identyczny CO DO BITU przez 400 kolejnych ticków',
    (saveTick) => {
      const planet = createPlanet({ seed: SEED });
      const script = scriptFor(planet);
      const original = new Sim(planet, CONFIG);
      advance(original, script, saveTick);
      expect(original.state.phase).toBe('RUNNING');

      const restored = new Sim(createPlanet({ seed: SEED }), CONFIG, snapshotThroughJson(original));
      expect(stateHash(restored.state)).toBe(stateHash(original.state));

      for (let i = 1; i <= 400; i++) {
        advance(original, script, 1);
        advance(restored, script, 1);
        expect(
          stateHash(restored.state),
          `rozjazd po ${i} tickach od wznowienia (tick ${original.state.tick})`,
        ).toBe(stateHash(original.state));
      }

      // Przesłanka: przebieg NAPRAWDĘ coś robił, więc identyczność hasza o czymś świadczy.
      expect(original.state.nextUnitId).toBeGreaterThan(10);
      expect(original.state.buildings.filter((b) => b !== null).length).toBeGreaterThan(1);
    },
  );

  /**
   * Asercja na PRZYCZYNĘ #1 z osobna. Powyższy test jest end-to-endowy i zzielenieje
   * także wtedy, gdy pozycja generatora przypadkiem się zgodzi; ten mówi wprost, że
   * migawka NIESIE pozycję i że pozycja ta naprawdę się przesuwa (a nie jest stałą
   * przepisywaną w kółko, co zahashowałoby się identycznie i niczego nie dowodziło).
   */
  it('migawka niesie POZYCJĘ generatora fal, nie tylko jego seed', () => {
    const sim = new Sim(createPlanet({ seed: SEED }), CONFIG);
    const start = JSON.stringify(sim.state.waveRng);
    for (let i = 0; i < 200; i++) sim.step();

    expect(JSON.stringify(sim.state.waveRng)).not.toBe(start);
    expect(sim.state.waveRng.seed).toBe(JSON.parse(start).seed); // seed stały, `s` przesunięte

    const restored = new Sim(createPlanet({ seed: SEED }), CONFIG, snapshotThroughJson(sim));
    expect(restored.state.waveRng).toEqual(sim.state.waveRng);
  });

  /**
   * Asercja na PRZYCZYNĘ #2. Faza cache'u pól przepływu leży POZA `SimState` i nie da
   * się jej odtworzyć z zapisu (pole jest funkcją `buildings` w ticku BUDOWY, a migawka
   * niesie `buildings` w ticku ZAPISU). Zamiast rozjeżdżać się po cichu — zmierzone:
   * 15 z 241 przemiecionych ticków zapisu rozjeżdżało hash po 1 ticku, dokładnie te,
   * w których zabudowa zmieniła się w oknie — konstruktor odrzuca taką migawkę.
   */
  it('odrzuca migawkę spoza granicy przeliczania pól przepływu, zamiast cicho się rozjechać', () => {
    const planet = createPlanet({ seed: SEED });
    const sim = new Sim(planet, CONFIG);
    advance(sim, scriptFor(planet), 401);
    expect(isResumableTick(sim.state.tick)).toBe(false);

    const snap = snapshotThroughJson(sim);
    expect(() => new Sim(createPlanet({ seed: SEED }), CONFIG, snap)).toThrow(RangeError);
    expect(() => new Sim(createPlanet({ seed: SEED }), CONFIG, snap)).toThrow(/401/);
    expect(() => new Sim(createPlanet({ seed: SEED }), CONFIG, snap)).toThrow(/isResumableTick/);
  });

  it('isResumableTick nazywa dokładnie te ticki, które konstruktor przyjmuje', () => {
    expect(FLOWFIELD_INTERVAL_TICKS).toBeGreaterThan(1); // przesłanka: granica coś odsiewa
    for (let t = 0; t < 12; t++) {
      expect(isResumableTick(t), `tick ${t}`).toBe(t % FLOWFIELD_INTERVAL_TICKS === 0);
    }
    expect(isResumableTick(-4)).toBe(false);
    expect(isResumableTick(4.5)).toBe(false);
    expect(isResumableTick(NaN)).toBe(false);
  });

  /**
   * Wznowienie NIE wskrzesza CORE. Konstruktor zasiewa go na `planet.startCell` przy
   * świeżym runie — gdyby robił to również przy wznowieniu, każde wczytanie zapisu po
   * przegranej przywracałoby rdzeń z pełnym hp i odwracało warunek końca z §5.6.
   */
  it('wznowienie po przegranej nie wskrzesza zniszczonego CORE', () => {
    const planet = createPlanet({ seed: 102 });
    const sim = new Sim(planet, DEFAULT_RUN);
    while (sim.state.phase === 'RUNNING' && sim.state.tick < 6000) sim.step();
    expect(sim.state.phase).toBe('DEFEAT');
    expect(sim.state.buildings[planet.startCell]).toBeNull();

    // Przegrana wypada w dowolnym ticku, więc dociągamy do najbliższej granicy migawki —
    // po `DEFEAT` `step()` i tak wychodzi od razu, stan się nie zmienia.
    while (!isResumableTick(sim.state.tick)) sim.state.tick++;

    const restored = new Sim(createPlanet({ seed: 102 }), DEFAULT_RUN, snapshotThroughJson(sim));
    expect(restored.state.buildings[planet.startCell]).toBeNull();
    expect(restored.state.phase).toBe('DEFEAT');
    expect(stateHash(restored.state)).toBe(stateHash(sim.state));
  });
});

/**
 * RUNDA ZAMYKAJĄCA, #1 i #4. Konstruktor z migawką powstał w tej samej fali poprawek
 * i walidował `RunConfig` piętnastoma strażami, a `SimState` — jedną (granica ticku).
 * Poniżej straże na te tryby awarii, które są CICHE: konstruują się, biegną i dają
 * fałszywy świat. Uszkodzenia, które wywalają się głośno same z siebie, zostają
 * niewalidowane świadomie (patrz `assertResumableSnapshot` w loop.ts).
 */
describe('straże migawki', () => {
  const cut = (sim: Sim): SimState => snapshotThroughJson(sim);

  function simAt(seed: number, ticks: number, opts: { frequency?: number; radius?: number } = {}): Sim {
    const planet = createPlanet({ seed, ...opts });
    const sim = new Sim(planet, CONFIG);
    for (let i = 0; i < ticks; i++) sim.step();
    return sim;
  }

  /**
   * Zmierzone przed strażą: migawka z planety o TYM SAMYM rozmiarze, ale innym seedzie,
   * przechodziła `isResumableTick`, konstruowała się i biegła 400 ticków czysto — a CORE
   * lądował na komórce 801 przy `startCell` 503, 215 komórek raportowało rudę mimo
   * `oreCapacity === 0`, i `canBuild(…, 'EXTRACTOR')` zwracał `{ok:true}` na komórce
   * bez złoża. Mechanizm wykrycia jest darmowy: `waveRng.seed` to niezmienna funkcja
   * `planet.seed` (5 -> 2027808481, 102 -> 2027808386) i leży w każdej migawce.
   */
  it('odrzuca migawkę z INNEJ planety — inny seed', () => {
    const snap = cut(simAt(SEED, 200));
    const inna = createPlanet({ seed: 102 });
    expect(inna.cells.length).toBe(createPlanet({ seed: SEED }).cells.length); // ten sam rozmiar

    expect(() => new Sim(inna, CONFIG, snap)).toThrow(RangeError);
    expect(() => new Sim(inna, CONFIG, snap)).toThrow(/does not belong to this planet/);
    expect(() => new Sim(inna, CONFIG, snap)).toThrow(/waveRng\.seed/);
  });

  it('odcisk palca planety jest niezmienną funkcją seeda — czyli w ogóle nadaje się na straż', () => {
    const odcisk = (seed: number) => createState(createPlanet({ seed }), 0).waveRng.seed;
    expect(odcisk(5)).toBe(2027808481);
    expect(odcisk(102)).toBe(2027808386);
    expect(odcisk(5)).toBe(odcisk(5)); // stabilny
    expect(new Set([0, 1, 5, 7, 102].map(odcisk)).size).toBe(5); // rozróżnia
  });

  /**
   * Sam seed nie łapie planety zbudowanej z tego samego seeda, ale innymi opcjami —
   * `waveRng` zależy WYŁĄCZNIE od `planet.seed`. Stąd druga połowa straży: długości
   * tablic indeksowanych komórką. Zmierzone przed nią: inny `radius` przechodził,
   * a inna liczba komórek umierała surowym `TypeError` w środku `flowfield.js`.
   */
  it('odrzuca migawkę z planety o tym samym seedzie, ale innej liczbie komórek', () => {
    const snap = cut(simAt(SEED, 200));
    const mniejsza = createPlanet({ seed: SEED, frequency: 8 });
    expect(mniejsza.cells.length).not.toBe(snap.buildings.length); // przesłanka

    expect(() => new Sim(mniejsza, CONFIG, snap)).toThrow(/buildings\.length/);
    expect(() => new Sim(mniejsza, CONFIG, snap)).toThrow(RangeError);
  });

  it('odrzuca migawkę ze skróconą tablicą indeksowaną komórką', () => {
    const planet = createPlanet({ seed: SEED });
    for (const pole of ['buildings', 'oreRemaining'] as const) {
      const snap = cut(simAt(SEED, 200));
      snap[pole].length = 10;
      expect(() => new Sim(planet, CONFIG, snap), pole).toThrow(new RegExp(`${pole}\\.length=10`));
    }
  });

  /**
   * NAJGORSZY ze zmierzonych trybów cichych: `phase = 42` konstruowało się, przyjmowało
   * `step()` i NIGDY nie symulowało — 20 kroków, `tick` stał na 200 — bo każda ścieżka
   * porównuje z `'RUNNING'`. Run „działał", tylko świat był zamrożony.
   */
  it('odrzuca migawkę z phase spoza trzech legalnych wartości', () => {
    const planet = createPlanet({ seed: SEED });
    for (const zla of [42, 'GOING', '', null, undefined]) {
      const snap = cut(simAt(SEED, 200));
      (snap as { phase: unknown }).phase = zla;
      expect(() => new Sim(planet, CONFIG, snap), String(zla)).toThrow(/invalid phase/);
    }
    // Wszystkie TRZY legalne przechodzą — straż odsiewa, nie zatrzaskuje.
    for (const dobra of ['RUNNING', 'VICTORY', 'DEFEAT'] as const) {
      const snap = cut(simAt(SEED, 200));
      snap.phase = dobra;
      expect(() => new Sim(planet, CONFIG, snap), dobra).not.toThrow();
    }
  });

  it('odrzuca tick ujemny, ułamkowy i nie-liczbowy osobnym komunikatem niż granica migawki', () => {
    const planet = createPlanet({ seed: SEED });
    for (const zly of [-4, 4.5, '8', NaN]) {
      const snap = cut(simAt(SEED, 200));
      (snap as { tick: unknown }).tick = zly;
      expect(() => new Sim(planet, CONFIG, snap), String(zly)).toThrow(/invalid tick/);
    }
    // Tick poprawny, ale poza granicą — INNY komunikat, bo to inna wada.
    const snap = cut(simAt(SEED, 200));
    snap.tick = 401;
    expect(() => new Sim(planet, CONFIG, snap)).toThrow(/cannot be resumed bit-identically/);
  });

  it('migawka z uszkodzonym waveRng trafia w komunikat straży, nie w surowy TypeError', () => {
    const planet = createPlanet({ seed: SEED });
    const snap = cut(simAt(SEED, 200));
    (snap as { waveRng: unknown }).waveRng = null;
    expect(() => new Sim(planet, CONFIG, snap)).toThrow(RangeError);
    expect(() => new Sim(planet, CONFIG, snap)).toThrow(/does not belong to this planet/);
  });

  /**
   * Straż nie może być tak ciasna, żeby odrzucała PRAWIDŁOWĄ migawkę — bez tego
   * wszystkie testy wyżej byłyby spełnione przez `throw` w pierwszej linii.
   */
  it('prawidłowa migawka nadal przechodzi wszystkie cztery straże', () => {
    const sim = simAt(SEED, 200);
    const restored = new Sim(createPlanet({ seed: SEED }), CONFIG, cut(sim));
    expect(stateHash(restored.state)).toBe(stateHash(sim.state));
  });
});
