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
  type OrbitCamera,
} from './camera.js';
export { createPlanetMesh, type PlanetMesh } from './planetMesh.js';
export { createScene, type PlanetScene, type SceneRenderer } from './scene.js';
