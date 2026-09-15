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
  DEFAULT_PALETTE,
  LIGHT_BANDS,
  lightBand,
  writeCellColors,
  writeCellColorsSmooth,
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
export { createPlanetMesh, type PlanetMesh } from './planetMesh.js';
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
  createReadabilityGate,
  formatGateResultsMarkdown,
  markerPosition,
  GATE_MODES,
  type GateAnswerRecord,
  type GateMode,
  type GatePlans,
  type ReadabilityGate,
} from './readabilityGate.js';
