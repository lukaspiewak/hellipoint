import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, type SimState } from '../src/sim/state.js';
import { applyCommand, canBuild } from '../src/sim/commands.js';
import { BUILDINGS } from '../src/sim/defs.js';

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
