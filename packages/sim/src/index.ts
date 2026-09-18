export const SIM_VERSION = '0.0.0';

export { Rng, STREAM } from './math/rng.js';
export * from './math/vec3.js';

export { buildGeodesic, vertexCountFor, type GeodesicMesh } from './world/geodesic.js';
export { buildDual, type CellType, type DualMesh } from './world/dual.js';
export { areaCv, spacingCv } from './world/uniformity.js';
export { multiSourceDistances } from './world/graph.js';
export {
  burnEscapeDepth,
  cellSpacing,
  terminatorCrossingTime,
  terminatorSpeedCells,
  terminatorSpeedWorld,
} from './world/scale.js';
export { createPlanet, type Cell, type Planet, type PlanetOptions } from './world/planet.js';

export { type RngState } from './math/rng.js';
export { TICK_SECONDS, createState } from './sim/state.js';
export type { Building, BuildingType, EnemyType, Phase, SimState, Unit } from './sim/state.js';
export { stateHash } from './sim/hash.js';
export { BUILDINGS, BROWNOUT_ORDER, ENEMIES, evaluateEnergyOutput } from './sim/defs.js';
export type { BuildingDef, EnemyDef, EnergyOutput } from './sim/defs.js';
export { applyCommand, canBuild } from './sim/commands.js';
export type { BuildCheck, BuildRefusalReason, Command } from './sim/commands.js';
export { lightAt, lightField, lightFieldInto, sunDirection } from './sim/light.js';
export { connectedToCore } from './sim/network.js';
export { OUTAGE_NONE, OUTAGE_SHED, OUTAGE_UNLINKED, updatePower } from './sim/power.js';
export type { PowerReport } from './sim/power.js';
export { ORE_PER_SECOND, updateEconomy } from './sim/economy.js';
export { buildAllFlowFields, buildFlowField } from './sim/flowfield.js';
export type { FlowField } from './sim/flowfield.js';
export {
  minRotationPeriod,
  motionContext,
  spawnUnit,
  updateMovement,
} from './sim/movement.js';
export type { MotionContext } from './sim/movement.js';
export { cellsWithinSteps, updateCombat } from './sim/combat.js';
export { updateBurning } from './sim/burning.js';
export { DEFAULT_SPAWN, updateSpawning } from './sim/spawning.js';
export type { SpawnConfig } from './sim/spawning.js';
export { DEFAULT_RUN, currentCycle, evacUnlocked, updateRules } from './sim/rules.js';
export type { RunConfig } from './sim/rules.js';
export { FLOWFIELD_INTERVAL_TICKS, isResumableTick, Sim } from './sim/loop.js';
