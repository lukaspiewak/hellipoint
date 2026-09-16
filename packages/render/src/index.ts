/** Wersja pakietu renderującego — odpowiednik `SIM_VERSION` z `@heliopolis/sim`. */
export const RENDER_VERSION = '0.0.0';

// Barierka pakietu: `apps/client` importuje WYŁĄCZNIE stąd, nigdy `three` bezpośrednio
// (Zadanie 1) — więc każdy symbol, którego potrzebuje sklejka aplikacji, musi być
// reeksportowany tutaj. Do Zadania 4 ten plik eksportował tylko `mountEmptyCanvas`
// (dowód Zadania 1, że rura Three.js → `<canvas>` działa, bez planety/kamery/sceny);
// ten plik jest zadaniem, które dostarcza prawdziwą planetę na ekranie, więc
// `mountEmptyCanvas`/`EmptyCanvasHandle` — w pełni zastąpione przez `createScene` —
// zostały usunięte zamiast zostać martwym, nieużywanym eksportem.
export { buildPlanetGeometry, type PlanetGeometry } from './geometry.js';
export {
  DEFAULT_OUTLINE_PALETTE,
  DEFAULT_PALETTE,
  LIGHT_BANDS,
  lightBand,
  writeCellColors,
  writeCellColorsSmooth,
  type CellVertexRanges,
  type Palette,
  type Rgb,
} from './shading.js';
export {
  clampDistance,
  createCamera,
  distanceLimits,
  focusPosition,
  DAMPING_FACTOR,
  FIELD_OF_VIEW_DEGREES,
  INITIAL_DISTANCE_FACTOR,
  MAX_DISTANCE_FACTOR,
  MIN_DISTANCE_FACTOR,
  ORBIT_ROTATE_SPEED,
  ORBIT_ZOOM_SPEED,
  type OrbitCamera,
} from './camera.js';
export {
  alertPulse,
  buildCellBases,
  buildDiscGeometry,
  coreScale,
  createBuildingLayer,
  healthFraction,
  writeCoreColor,
  ALERT_COLOR_DARK,
  ALERT_COLOR_LIGHT,
  ALERT_INNER_FACTOR,
  ALERT_RADIUS_FACTOR,
  ALERT_SPLIT_FACTOR,
  BUILDING_HEIGHT_FACTOR,
  BUILDING_RADIUS_FACTOR,
  BUILDING_SHAPES,
  CORE_COLOR_CRITICAL,
  CORE_COLOR_HEALTHY,
  CORE_RIM_FACTOR,
  CORE_SCALE_MIN,
  ALERT_PULSE_AMPLITUDE_FACTOR,
  ALERT_PULSE_PERIOD_SECONDS,
  SHELL_COLOR,
  SHELL_TAPER,
  SURFACE_LIFT_FACTOR,
  type BuildingLayer,
} from './buildingMesh.js';
export {
  burnCoreScale,
  createUnitLayer,
  exposureFraction,
  unitShade,
  writeUnitCoreColor,
  writeUnitRimColor,
  INITIAL_UNIT_CAPACITY,
  UNIT_BAND_SHADE,
  UNIT_BAND_SHADE_LEGAL,
  UNIT_CORE_COLOR_COOL,
  UNIT_CORE_COLOR_HOT,
  UNIT_CORE_LIFT_FACTOR,
  UNIT_CORE_SCALE_MIN,
  UNIT_LIFT_FACTOR,
  UNIT_RADIUS_FACTOR,
  UNIT_RIM_COLOR,
  UNIT_RIM_FACTOR,
  UNIT_SHAPES,
  type UnitLayer,
  type UnitShadingMode,
} from './unitMesh.js';
export {
  buildCellOutlines,
  createPlanetMesh,
  OUTLINE_INSET,
  OUTLINE_LIFT,
  type CellOutlines,
  type PlanetMesh,
} from './planetMesh.js';
export {
  cappedPixelRatio,
  CLEAR_COLOR,
  createScene,
  MAX_PIXEL_RATIO,
  type PlanetScene,
  type SceneRenderer,
} from './scene.js';
export { createRollingWindow, median, percentile, type RollingWindow } from './frameStats.js';
export {
  buildGateTrials,
  findBoundaryCells,
  findTerminatorPairs,
  selectSpread,
  type BoundaryCells,
  type GateTrial,
  type TerminatorPair,
} from './terminatorPairs.js';
export {
  buildSmearedGeometry,
  writeSmearedColors,
  type SmearedGeometry,
} from './positiveControl.js';
export {
  aimDirection,
  buildCameraOffsets,
  createReadabilityGate,
  formatGateResultsMarkdown,
  markerPosition,
  markerRingRadius,
  writeMarkerPosition,
  CAMERA_OFFSET_MAX_DEGREES,
  CAMERA_OFFSET_MIN_DEGREES,
  CAMERA_OFFSET_SEED,
  GATE_MODES,
  MARKER_SCALE_FACTOR,
  type CameraOffset,
  type GateAnswerRecord,
  type GateMode,
  type GateOptions,
  type GatePlans,
  type GateWorld,
  type ReadabilityGate,
} from './readabilityGate.js';
