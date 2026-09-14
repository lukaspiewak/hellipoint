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
