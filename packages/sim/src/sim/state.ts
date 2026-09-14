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
  };
}
