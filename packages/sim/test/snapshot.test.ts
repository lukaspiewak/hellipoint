import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { FLOWFIELD_INTERVAL_TICKS, isResumableTick, Sim } from '../src/sim/loop.js';
import { stateHash } from '../src/sim/hash.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';
import type { SimState } from '../src/sim/state.js';
import type { Command } from '../src/sim/commands.js';

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
const CONFIG = {
  ...DEFAULT_RUN,
  startingOre: 400,
  spawn: { ...DEFAULT_RUN.spawn, disruptorFromCycle: 1, armorFromCycle: 1 },
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
