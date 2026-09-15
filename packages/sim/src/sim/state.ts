import type { Vec3 } from '../math/vec3.js';
import type { Planet } from '../world/planet.js';

/** Stały krok symulacji: 20 Hz. Nigdy nie wiązać z czasem ściennym (§7.2). */
export const TICK_SECONDS = 0.05;

export type Phase = 'RUNNING' | 'VICTORY' | 'DEFEAT';

export type BuildingType =
  | 'CORE' | 'BARRICADE' | 'PYLON' | 'SOLAR_PANEL' | 'BATTERY'
  | 'EXTRACTOR' | 'KINETIC_TURRET' | 'LASER_TURRET'
  | 'GEOTHERMAL_CAP' | 'EVACUATION_MODULE';

export type EnemyType = 'SWARM' | 'ARMOR' | 'DISRUPTOR';

/**
 * Stan pentagonu, równoległy do `planet.pentagons` (patrz pole `pentagons` niżej) —
 * NIE indeksowany `cellId`. Populowany przez `updateSpawning` (spawning.ts, Task 4).
 */
export interface PentagonState {
  /** Ułamkowy licznik jednostek do wypuszczenia — spawn bywa wolniejszy niż 1/tick. */
  spawnAccumulator: number;
  /** Sekundy do najbliższej erupcji. Używane wyłącznie przez zatkane pentagony. */
  eruptionCooldown: number;
  /**
   * Czy `eruptionCooldown` zostało uzbrojone pełnym `eruptionInterval` od PIERWSZEGO
   * zatkania. Bez tej flagi startowe `eruptionCooldown = 0` jest nieodróżnialne od
   * "właśnie odliczyło do zera" — pierwsza erupcja wystrzeliwałaby w TYM SAMYM ticku,
   * w którym stanął cap, zamiast po pełnym interwale (patrz spawning.ts).
   * CELOWO nie resetowana, gdy pentagon przestaje być zatkany — odliczanie ZAMRAŻA SIĘ
   * (jak dla światła, D1), nie zeruje: zegar erupcji należy do pentagonu (ciśnienie w
   * kominie), nie do capa (pokrywy). Reset dawał darmowy exploit — rozbiórka+odbudowa
   * capa w kółko odsuwała rosnącą z `capCount` erupcję za płaski koszt (patrz
   * task-4-fix-report.md, punkt 1).
   */
  eruptionArmed: boolean;
}

export interface Building {
  cellId: number;
  type: BuildingType;
  hp: number;
  /** Ustawiane co tick przez system energii (Task 6). */
  powered: boolean;
}

export interface Unit {
  id: number;
  type: EnemyType;
  /** Komórka, w której jednostka aktualnie się znajduje. Aktualizowana lokalnie (Task 9). */
  cellId: number;
  pos: Vec3;
  hp: number;
  /** Skumulowany czas w świetle, w sekundach (§4.4). */
  exposure: number;
}

/**
 * NIEZMIENNIK SERIALIZOWALNOŚCI (§7.2, plan Fazy 1B pkt. „granica serializowalności"):
 * `SimState` (i wszystko w nim zagnieżdżone, teraz i w przyszłych fazach) musi przejść
 * bez strat przez `JSON.parse(JSON.stringify(...))`. Konkretnie nigdy nie wolno tu
 * trzymać:
 *   - `Infinity` / `-Infinity` / `NaN` — `JSON.stringify` zamienia WSZYSTKIE TRZY na
 *     `null`, nieodróżnialnie od siebie, a `null` w arytmetyce zachowuje się jak `0`
 *     (`null + 5 === 5`) — czyli "nieosiągalne"/"brak celu" po cichu staje się
 *     "osiągalne w zero kroków", bez żadnego błędu w miejscu, gdzie to się stało;
 *   - `TypedArray` (`Float64Array`, `Int32Array`, ...) — serializuje się jako zwykły
 *     obiekt `{ "0": ..., "1": ... }`, nie jako tablica, i round-trip go nie odtwarza;
 *   - `Map` / `Set` — serializują się jako `{}`, tracąc całą zawartość po cichu;
 *   - surowe wyjście BFS/Dijkstry (np. `FlowField.distance`/`FlowField.next` z
 *     `flowfield.ts`, cokolwiek z `network.ts`) — te struktury z ZAŁOŻENIA niosą
 *     `Infinity` dla „brak celu"/„nieosiągalny" i mają być PRZELICZANE co tick z
 *     `SimState`, nie trzymane w nim jako pole. To dotyczy też pól, które Faza 1C
 *     dopiero doda (`units`, fale, `evacCharge`, `RngState`) i wszystkiego, co
 *     kiedykolwiek uzna się za warte cache'owania.
 * Strażnik: `state.test.ts` uruchamia skryptowaną symulację przez kilkaset ticków i
 * asercjuje, że `stateHash` PRZED i PO round-tripie JSON są identyczne — ale ten
 * strażnik widzi WYŁĄCZNIE pola, które `stateHash` faktycznie czyta, więc KAŻDE nowe
 * pole `SimState` musi zostać zahashowane w `hash.ts` (albo świadomie dopisane do
 * `UNHASHED_FIELDS` w `state.test.ts`) — inaczej test kompletności `stateHash` tamże
 * przestaje się kompilować lub nie przechodzi w runtime.
 */
export interface SimState {
  tick: number;
  /** Niemutowalna. Wszystko, co się zmienia, żyje obok niej. */
  planet: Planet;
  ore: number;
  storedEnergy: number;
  /** Indeksowane cellId. Tablica, NIE Map — kolejność iteracji nie może zależeć od historii wstawień. */
  buildings: (Building | null)[];
  oreRemaining: number[];
  units: Unit[];
  nextUnitId: number;
  phase: Phase;
  /** Równoległe do planet.pentagons, NIE indeksowane cellId. */
  pentagons: PentagonState[];
}

export function createState(planet: Planet, startingOre: number): SimState {
  return {
    tick: 0,
    planet,
    ore: startingOre,
    storedEnergy: 0,
    buildings: new Array<Building | null>(planet.cells.length).fill(null),
    oreRemaining: planet.cells.map((c) => c.oreCapacity),
    units: [],
    nextUnitId: 1,
    phase: 'RUNNING',
    pentagons: planet.pentagons.map(() => ({
      spawnAccumulator: 0,
      eruptionCooldown: 0,
      eruptionArmed: false,
    })),
  };
}
