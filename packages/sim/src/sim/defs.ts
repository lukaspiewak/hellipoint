import type { BuildingType, EnemyType } from './state.js';

/**
 * Jednolity schemat produkcji energii (§6 specu).
 * Draft miał trzy różne nazwy pól na to samo pojęcie — tutaj jest jedno pole
 * i jedna funkcja ewaluacji przyjmująca kontekst oświetlenia.
 */
export type EnergyOutput =
  | { kind: 'NONE' }
  | { kind: 'CONSTANT'; rate: number }
  | { kind: 'SOLAR'; peakRate: number };

/** `light` to saturate(dot(normal, sunDir)) ∈ [0, 1]. */
export function evaluateEnergyOutput(out: EnergyOutput, light: number): number {
  switch (out.kind) {
    case 'NONE': return 0;
    case 'CONSTANT': return out.rate;
    case 'SOLAR': return out.peakRate * light;
  }
}

export type CellRequirement = 'ANY' | 'HEXAGON' | 'PENTAGON' | 'ORE_HEXAGON';

export interface BuildingDef {
  hp: number;
  costOre: number;
  /** Jednostki energii na sekundę. 0 = nie pobiera. */
  energyDrain: number;
  energyOutput: EnergyOutput;
  energyStorage: number;
  allowedCells: CellRequirement;
  /** Kroki grafu. 0 = nie przenosi energii (N1). */
  connectionRadius: number;
  /** Kroki grafu. 0 = nie strzela (N1). */
  range: number;
  dps: number;
  targeting: 'NONE' | 'SINGLE' | 'AOE';
  /** Czy budynek liczy się jako cel dla DISRUPTOR-a (§4.5). */
  energyInfrastructure: boolean;
  /**
   * Czy `canBuild`/`applyCommand` (czyli KOMENDY — z sieci w Fazie 5) wolno w ogóle
   * postawić ten typ. `false` wyłącznie dla CORE: symulacja sama go zasiewa przy
   * starcie (bezpośrednim zapisem do `SimState`, nie przez komendę), gracz nigdy.
   * Bez tej flagi `CORE.costOre = 0` plus brak innej blokady w `canBuild` pozwalały
   * postawić dowolną liczbę darmowych CORE na dowolnej pustej komórce — `CELL_OCCUPIED`
   * chroni tylko TĘ SAMĄ komórkę przed drugim CORE, nie planetę przed setnym.
   * Nazwa celowo `playerBuildable`, nie `unique`: nie chodzi o "co najwyżej jeden",
   * tylko o to, że gracz (i każda komenda z sieci) nie stawia go wcale.
   */
  playerBuildable: boolean;
}

// Wszystkie liczby poniżej: [STROJENIE] — wyznaczy je headless runner w Fazie 3.
export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  CORE: {
    hp: 1000, costOre: 0, energyDrain: 0, energyOutput: { kind: 'CONSTANT', rate: 10 },
    energyStorage: 200, allowedCells: 'HEXAGON', connectionRadius: 3, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true, playerBuildable: false,
  },
  BARRICADE: {
    // Tani blok czysto-HP. Bez niego mechanika blokowania (D3) nie ma czym operować,
    // bo najtańszym blokerem byłby PYLON, który jest jednocześnie szkieletem sieci.
    hp: 150, costOre: 8, energyDrain: 0, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 0, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: false, playerBuildable: true,
  },
  PYLON: {
    hp: 80, costOre: 15, energyDrain: 0.5, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 3, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true, playerBuildable: true,
  },
  SOLAR_PANEL: {
    // peakRate podniesiony wobec draftu: średnia z saturate(cos) po obrocie
    // to 1/π ≈ 0,318, a nie 0,5 (§5.1).
    hp: 100, costOre: 25, energyDrain: 0, energyOutput: { kind: 'SOLAR', peakRate: 40 },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 1, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true, playerBuildable: true,
  },
  BATTERY: {
    hp: 150, costOre: 40, energyDrain: 0, energyOutput: { kind: 'NONE' },
    energyStorage: 600, allowedCells: 'HEXAGON', connectionRadius: 2, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true, playerBuildable: true,
  },
  EXTRACTOR: {
    hp: 120, costOre: 30, energyDrain: 5, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'ORE_HEXAGON', connectionRadius: 1, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: false, playerBuildable: true,
  },
  KINETIC_TURRET: {
    hp: 200, costOre: 50, energyDrain: 3, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 1, range: 2,
    dps: 25, targeting: 'SINGLE', energyInfrastructure: false, playerBuildable: true,
  },
  LASER_TURRET: {
    hp: 250, costOre: 100, energyDrain: 12, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 1, range: 3,
    dps: 60, targeting: 'AOE', energyInfrastructure: false, playerBuildable: true,
  },
  GEOTHERMAL_CAP: {
    hp: 300, costOre: 75, energyDrain: 0, energyOutput: { kind: 'CONSTANT', rate: 25 },
    energyStorage: 0, allowedCells: 'PENTAGON', connectionRadius: 2, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true, playerBuildable: true,
  },
  EVACUATION_MODULE: {
    hp: 2000, costOre: 300, energyDrain: 0, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 2, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true, playerBuildable: true,
  },
};

/**
 * Kolejność gaszenia przy niedoborze energii (§5.1).
 * OBRONA GAŚNIE OSTATNIA — draft miał to odwrotnie, co dawało spiralę śmierci.
 * PYLON pominięty celowo: wyłączenie go rozspójniłoby sieć, czyli pogłębiło niedobór.
 */
export const BROWNOUT_ORDER: BuildingType[] = ['EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET'];

export interface EnemyDef {
  hp: number;
  /**
   * KROTNOŚĆ prędkości terminatora, nie wartość bezwzględna (§6.2).
   * < 1 oznacza, że jednostka nigdy nie ucieknie ze światła (niezmiennik N3).
   */
  speedFactor: number;
  dps: number;
  /** Sekundy ekspozycji na światło do śmierci (§4.4). */
  burnTime: number;
  oreReward: number;
  targetPriority: 'NEAREST_BUILDING' | 'CORE' | 'ENERGY_INFRASTRUCTURE';
}

// [STROJENIE]
export const ENEMIES: Record<EnemyType, EnemyDef> = {
  SWARM: {
    hp: 30, speedFactor: 2.3, dps: 10, burnTime: 3, oreReward: 2,
    targetPriority: 'NEAREST_BUILDING',
  },
  ARMOR: {
    // speedFactor < 1: broń wyłącznie nocna, musi zdążyć do Core przed świtem.
    hp: 250, speedFactor: 0.85, dps: 50, burnTime: 8, oreReward: 10,
    targetPriority: 'CORE',
  },
  DISRUPTOR: {
    hp: 80, speedFactor: 1.6, dps: 20, burnTime: 4, oreReward: 5,
    targetPriority: 'ENERGY_INFRASTRUCTURE',
  },
};
