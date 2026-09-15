import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, type SimState } from '../src/sim/state.js';
import { applyCommand, canBuild, type Command } from '../src/sim/commands.js';
import { BUILDINGS } from '../src/sim/defs.js';
import { Sim } from '../src/sim/loop.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';

const planet = createPlanet({ seed: 3 });
const anyOreCell = planet.cells.find((c) => c.oreCapacity > 0)!.id;
const anyPentagon = planet.pentagons[0];
const plainHex = planet.cells.find(
  (c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell,
)!.id;

/**
 * CORE ma `playerBuildable: false` (Important #1, przegląd końcowy Fazy 1B) — `applyCommand`
 * już go nie postawi. Testy, którym CORE jest potrzebny jako scaffolding (np. żeby sprawdzić,
 * że DEMOLISH go nie rusza), stawiają go tak, jak zrobi to `Sim` w Fazie 1C: bezpośrednim
 * zapisem do stanu, nie przez komendę.
 */
function placeCore(s: SimState, cellId: number): void {
  s.buildings[cellId] = { cellId, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false };
}

describe('canBuild', () => {
  it('pozwala postawić pylon na pustym heksie przy wystarczającej rudzie', () => {
    const s = createState(planet, 100);
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: true });
  });

  it('odmawia przy niewystarczającej rudzie', () => {
    const s = createState(planet, 1);
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: false, reason: 'INSUFFICIENT_ORE' });
  });

  it('odmawia na zajętej komórce', () => {
    const s = createState(planet, 500);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: false, reason: 'CELL_OCCUPIED' });
  });

  it('wpuszcza GEOTHERMAL_CAP wyłącznie na pentagon', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyPentagon, 'GEOTHERMAL_CAP')).toEqual({ ok: true });
    expect(canBuild(s, plainHex, 'GEOTHERMAL_CAP')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });

  it('wpuszcza EXTRACTOR wyłącznie na złoże', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyOreCell, 'EXTRACTOR')).toEqual({ ok: true });
    expect(canBuild(s, plainHex, 'EXTRACTOR')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });

  it('nie wpuszcza zwykłych budynków na pentagon', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyPentagon, 'PYLON')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });

  // Regresja na Important #1 z przeglądu końcowego Fazy 1B: `CORE.costOre === 0` i brak
  // innej blokady pozwalały postawić dowolną liczbę darmowych CORE na dowolnej pustej
  // komórce — `CELL_OCCUPIED` chroni wyłącznie TĘ SAMĄ komórkę przed drugim CORE, nie
  // planetę przed setnym. Zmierzone na tej planecie przed poprawką: 1430 CORE, 0 rudy
  // wydanej, 14300 energii/s podaży. Oba warunki poniżej muszą być SPEŁNIONE naraz
  // (pusta, poprawna komórka + pełna ruda), żeby dowieść, że to WYŁĄCZNIE
  // `playerBuildable`, a nie przypadkowo WRONG_CELL_TYPE/INSUFFICIENT_ORE, odrzuca CORE.
  it('odmawia budowy CORE przez gracza, nawet na pustej prawidłowej komórce z pełną rudą', () => {
    const s = createState(planet, 1_000_000);
    expect(canBuild(s, plainHex, 'CORE')).toEqual({ ok: false, reason: 'NOT_PLAYER_BUILDABLE' });
  });

  it('pozostałe dziewięć typów budynków wciąż wolno budować — CORE jest jedynym wyjątkiem', () => {
    const s = createState(planet, 1_000_000);
    const otherTypes = [
      'BARRICADE', 'PYLON', 'SOLAR_PANEL', 'BATTERY', 'EXTRACTOR',
      'KINETIC_TURRET', 'LASER_TURRET', 'GEOTHERMAL_CAP', 'EVACUATION_MODULE',
    ] as const;
    for (const type of otherTypes) {
      const cellId = type === 'GEOTHERMAL_CAP' ? anyPentagon : type === 'EXTRACTOR' ? anyOreCell : plainHex;
      expect(canBuild(s, cellId, type)).toEqual({ ok: true });
    }
  });
});

describe('applyCommand', () => {
  it('BUILD pobiera rudę i stawia budynek z pełnym HP', () => {
    const s = createState(planet, 100);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    expect(s.ore).toBe(85);
    expect(s.buildings[plainHex]).toMatchObject({ type: 'PYLON', hp: 80, powered: false });
  });

  it('BUILD niedozwolony jest po cichu ignorowany, nie rzuca — komendy przychodzą z sieci', () => {
    const s = createState(planet, 1);
    expect(() => applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' })).not.toThrow();
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(1);
  });

  it('BUILD CORE jest po cichu ignorowany niezależnie od rudy — gracz (i sieć) nie stawia CORE wcale', () => {
    const s = createState(planet, 1_000_000);
    expect(() => applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'CORE' })).not.toThrow();
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(1_000_000);
  });

  it('DEMOLISH usuwa budynek i zwraca połowę kosztu', () => {
    const s = createState(planet, 100);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    applyCommand(s, { kind: 'DEMOLISH', cellId: plainHex });
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(85 + 7);
  });

  it('DEMOLISH nie rusza CORE', () => {
    const s = createState(planet, 100);
    placeCore(s, planet.startCell);
    applyCommand(s, { kind: 'DEMOLISH', cellId: planet.startCell });
    expect(s.buildings[planet.startCell]).not.toBeNull();
  });

  it('DEMOLISH z cellId poza zakresem (ujemny, za duży, NaN) jest po cichu ignorowany, nie rzuca — komendy przychodzą z sieci', () => {
    const s = createState(planet, 100);
    for (const badCellId of [-1, planet.cells.length + 999, NaN]) {
      expect(() => applyCommand(s, { kind: 'DEMOLISH', cellId: badCellId })).not.toThrow();
    }
    expect(s.ore).toBe(100);
  });
});

/**
 * §5.6: Moduł Ewakuacyjny odblokowuje się dopiero w ostatniej tercji runu. Przed rundą
 * poprawek reguła istniała WYŁĄCZNIE jako funkcja `evacUnlocked` w rules.ts, której nic
 * nie wołało — `canBuild` przyjmował Evac w cyklu 1 (patrz task-5-report.md, defekt #2).
 * Próg jest liczony raz, w konstruktorze `Sim`, i leży w stanie jako TICK, więc `canBuild`
 * może go sprawdzić, nie znając ani `rotationPeriod`, ani `RunConfig`.
 */
describe('bramka ewakuacji w canBuild (§5.6)', () => {
  it('odmawia postawienia EVACUATION_MODULE przed progiem, z powodem EVAC_LOCKED', () => {
    const s = createState(planet, 100000);
    s.evacUnlockTick = 21600;
    s.tick = 0;
    expect(canBuild(s, plainHex, 'EVACUATION_MODULE')).toEqual({ ok: false, reason: 'EVAC_LOCKED' });
  });

  /**
   * Granica przypięta co do ticka, nie w wygodnym środku: OSTATNI tick przed progiem
   * odmawia, PIERWSZY tick progu przyjmuje. Bez obu połówek `>=` przechodzi tak samo
   * jak `>` (albo jak stała odmowa).
   */
  it('granica jest ostra: tick przed progiem odmawia, tick progu przyjmuje', () => {
    const s = createState(planet, 100000);
    s.evacUnlockTick = 21600;

    s.tick = 21599;
    expect(canBuild(s, plainHex, 'EVACUATION_MODULE')).toEqual({ ok: false, reason: 'EVAC_LOCKED' });

    s.tick = 21600;
    expect(canBuild(s, plainHex, 'EVACUATION_MODULE')).toEqual({ ok: true });
  });

  it('bramka dotyczy WYŁĄCZNIE Evaca — inne budynki wolno stawiać od pierwszego ticka', () => {
    const s = createState(planet, 100000);
    s.evacUnlockTick = 21600;
    s.tick = 0;
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: true });
    expect(canBuild(s, anyPentagon, 'GEOTHERMAL_CAP')).toEqual({ ok: true });
    expect(canBuild(s, anyOreCell, 'EXTRACTOR')).toEqual({ ok: true });
  });

  it('applyCommand po cichu ignoruje BUILD Evaca przed progiem — komórka zostaje pusta', () => {
    const s = createState(planet, 100000);
    s.evacUnlockTick = 21600;
    s.tick = 21599;
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'EVACUATION_MODULE' });
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(100000); // ruda NIE pobrana za odrzuconą komendę

    s.tick = 21600;
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'EVACUATION_MODULE' });
    expect(s.buildings[plainHex]).toMatchObject({ type: 'EVACUATION_MODULE' });
    expect(s.ore).toBe(100000 - BUILDINGS.EVACUATION_MODULE.costOre);
  });
});

/**
 * PRZEGLĄD GAŁĘZI, Important #5. Doc-comment `applyCommand` obiecuje, że niedozwolona
 * komenda „jest po cichu ignorowana, nigdy nie przerywa symulacji". `cellId` był
 * zahartowany (`cells[cellId] === undefined`, `b == null`), `type` — NIE: zmierzone,
 * `{kind:'BUILD', type:'DEATH_STAR'}` dawało `TypeError: Cannot read properties of
 * undefined (reading 'playerBuildable')` wyrzucany ze ŚRODKA `Sim.step()`, czyli
 * z połowy ticka, po już zastosowanych wcześniejszych komendach.
 *
 * Komendy pochodzą z zewnątrz (Faza 5: z sieci), więc sygnatura TypeScriptu nie jest
 * gwarancją w runtime — stąd `as never` w testach: symulują dokładnie to, co przyjdzie
 * po drucie, a czego kompilator nigdy nie zobaczy.
 */
describe('hartowanie komend spoza TypeScriptu (obietnica „nigdy nie przerywa symulacji")', () => {
  it('canBuild odrzuca nieznany typ budynku z powodem, zamiast rzucać TypeError', () => {
    const s = createState(planet, 100000);
    expect(canBuild(s, plainHex, 'DEATH_STAR' as never)).toEqual({
      ok: false,
      reason: 'NO_SUCH_BUILDING_TYPE',
    });
  });

  /**
   * Klucze z PROTOTYPU, nie tylko nieznane nazwy: `BUILDINGS['constructor']` zwraca
   * funkcję (wartość prawdziwą!), więc straż oparta na `=== undefined` przepuściłaby
   * je dalej, a `s.ore -= def.costOre` dałoby `NaN` — cichy defekt zamiast głośnego.
   */
  it('odrzuca też klucze dziedziczone z prototypu Object', () => {
    const s = createState(planet, 100000);
    for (const klucz of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(canBuild(s, plainHex, klucz as never), klucz).toEqual({
        ok: false,
        reason: 'NO_SUCH_BUILDING_TYPE',
      });
    }
  });

  it('applyCommand z nieznanym typem nie rzuca, nic nie stawia i nie rusza rudy', () => {
    const s = createState(planet, 100000);
    expect(() => applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'DEATH_STAR' as never })).not.toThrow();
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(100000);
  });

  it('applyCommand z nieznanym kind też nie rzuca i nic nie zmienia', () => {
    const s = createState(planet, 100000);
    expect(() => applyCommand(s, { kind: 'SELF_DESTRUCT', cellId: plainHex } as never)).not.toThrow();
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(100000);
  });

  /**
   * Asercja NOŚNA: nie „funkcja nie rzuca", tylko „TICK SIĘ NIE ROZPADA". Wcześniejsza
   * wersja defektu wyrzucała wyjątek ze środka `step()`, po zastosowaniu poprzednich
   * komend z tej samej kolejki — więc świat zostawał w stanie POŁOWICZNIE przeliczonym.
   * Tu: zła komenda leży w kolejce PRZED dobrą, a po ticku ma zadziałać dobra.
   */
  it('zła komenda w kolejce nie przerywa ticka — kolejna, poprawna, wykonuje się normalnie', () => {
    const sim = new Sim(planet, { ...DEFAULT_RUN, startingOre: 100000 });
    sim.enqueue({ kind: 'BUILD', cellId: plainHex, type: 'DEATH_STAR' as never });
    sim.enqueue({ kind: 'BUILD', cellId: plainHex, type: 'PYLON' });

    expect(() => sim.step()).not.toThrow();
    expect(sim.state.buildings[plainHex]).toMatchObject({ type: 'PYLON' });
    expect(sim.state.phase).toBe('RUNNING');
    expect(sim.state.tick).toBe(1);
  });
});

/**
 * RUNDA ZAMYKAJĄCA, #2. `cells[cellId] === undefined` NIE hartowało `cellId`, mimo że
 * komentarz dodany w tej właśnie fali tak twierdził: JavaScript zamienia indeks tablicy
 * na string, więc `cells["1"]` to `cells[1]` — istnieje. Zmierzone: komenda prosto
 * z JSON-a, `{"kind":"BUILD","cellId":"1","type":"BARRICADE"}`, budowała się poprawnie
 * i zapisywała `Building.cellId` jako STRING `"1"`. `stateHash` tego nie widział, bo
 * haszuje INDEKS tablicy, nie pole (patrz hash.ts) — więc defekt nie miał jak się ujawnić
 * ani w round-tripie, ani w determinizmie.
 */
describe('cellId komendy jest prawdziwym indeksem komórki, nie czymkolwiek, co tablica przyjmie', () => {
  it('BUILD ze stringowym cellId jest odrzucony — nie zapisuje stringa do Building.cellId', () => {
    const s = createState(planet, 100000);
    expect(canBuild(s, '1' as never, 'BARRICADE')).toEqual({ ok: false, reason: 'NO_SUCH_CELL' });

    applyCommand(s, JSON.parse('{"kind":"BUILD","cellId":"1","type":"BARRICADE"}') as Command);
    expect(s.buildings[1]).toBeNull();
    expect(s.ore).toBe(100000);
  });

  it('DEMOLISH ze stringowym cellId nie burzy budynku przez koercję indeksu', () => {
    const s = createState(planet, 100000);
    applyCommand(s, { kind: 'BUILD', cellId: 1, type: 'BARRICADE' });
    expect(s.buildings[1]).not.toBeNull();

    applyCommand(s, JSON.parse('{"kind":"DEMOLISH","cellId":"1"}') as Command);
    expect(s.buildings[1]).toMatchObject({ type: 'BARRICADE' });
  });

  it('odrzuca też ułamki, wartości spoza zakresu i NaN — w obu gałęziach', () => {
    const s = createState(planet, 100000);
    for (const zly of [1.5, -1, planet.cells.length, NaN, Infinity, null, undefined, {}]) {
      expect(canBuild(s, zly as never, 'BARRICADE'), String(zly)).toEqual({
        ok: false,
        reason: 'NO_SUCH_CELL',
      });
      expect(() => applyCommand(s, { kind: 'DEMOLISH', cellId: zly as never }), String(zly)).not.toThrow();
    }
    expect(s.buildings.every((b) => b === null)).toBe(true);
  });

  it('cellId zapisany w Building jest liczbą równą indeksowi tablicy', () => {
    const s = createState(planet, 100000);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'BARRICADE' });
    expect(typeof s.buildings[plainHex]?.cellId).toBe('number');
    expect(s.buildings[plainHex]?.cellId).toBe(plainHex);
  });
});
