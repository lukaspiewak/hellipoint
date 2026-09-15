import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Planet, Vec3 } from '@heliopolis/sim';
import { createCamera, type OrbitCamera } from './camera.js';
import { buildPlanetGeometry } from './geometry.js';
import { createPlanetMesh } from './planetMesh.js';

/**
 * Scena widoczna na ekranie: planeta (Zadanie 2 + 3) + kamera K1 (ten plik). `render`
 * jest wołany przez pętlę renderu aplikacji (`apps/client`) co klatkę, z bieżącym
 * `light` (np. z `lightField(planet, sunDir)`) i `sunDir`, którego symulacja właśnie
 * użyła do policzenia tego `light` — planeta się nie obraca, orbituje źródło światła
 * (§4.3), więc oba te argumenty osobno niosą informację, którą wywołujący już policzył.
 */
export interface PlanetScene {
  /**
   * Jedna klatka: aktualizuje kamerę (bezwładność orbity K1), przelicza kolory komórek na
   * podstawie `light` i rysuje. `sunDir` jest częścią wymaganego kształtu tego interfejsu
   * (Task 4 brief) — `writeCellColors` w Zadaniu 4 potrzebuje wyłącznie już policzonego
   * `light`, nie kierunku, więc `sunDir` nie jest tu jeszcze zużywany; zarezerwowany na
   * przyszłość (np. wizualny znacznik słońca, Faza 4), a przekazywany już teraz, żeby
   * podpis się nie zmieniał, gdy ta potrzeba się pojawi.
   */
  render(light: Float32Array, sunDir: Vec3): void;
  readonly camera: OrbitCamera;
  /**
   * Przelicza proporcje kamery i `devicePixelRatio` renderera na podstawie bieżących
   * wymiarów `canvas` — wołane automatycznie raz przy tworzeniu sceny i przy każdym
   * zdarzeniu `resize` okna (patrz `createSceneWithRenderer`). Wystawione też WPROST
   * (nie tylko jako prywatny nasłuch), z dwóch powodów: (1) testowalność — Vitest/Node
   * nie ma `window`, więc bez tej metody nic z tej logiki nie dałoby się wywołać z testu;
   * (2) wywołujący, który osadza canvas w panelu zmieniającym rozmiar bez natywnego
   * zdarzenia `resize` okna, może wymusić przeliczenie sam.
   */
  resize(): void;
  /** Zwalnia kamerę, siatkę planety i renderer; odłącza nasłuch resize okna. */
  dispose(): void;
}

// Kolor czyszczenia płótna — [WYGLĄD]. Przeniesiony z Zadania 1 (`index.ts`, które budowało
// pusty canvas dowodzący, że rura Three.js → `<canvas>` działa); teraz żyje przy
// PRAWDZIWEJ scenie, którą to zadanie dostarcza.
const CLEAR_COLOR = 0x0a0e14; // [WYGLĄD]

/**
 * Górny limit `devicePixelRatio` faktycznie przekazywany do renderera — [WYGLĄD].
 * Wyświetlacze retina/HiDPI potrafią zgłaszać 3 i więcej; liczba pikseli do wypełnienia
 * rośnie z KWADRATEM tego czynnika (podwojenie → 4× kosztu), a oko przestaje odróżniać
 * różnicę ostrości powyżej ok. 2× z typowej odległości od ekranu grania. Bez tego limitu
 * (albo bez wołania `setPixelRatio` w ogóle) renderer albo rysuje w rozdzielczości CSS
 * (rozmyte na HiDPI), albo płaci pełną cenę fizycznych pikseli bez potrzeby.
 */
export const MAX_PIXEL_RATIO = 2; // [WYGLĄD]

/**
 * Przycina `devicePixelRatio` do `MAX_PIXEL_RATIO`. Funkcja CZYSTA — testowalna bez
 * `window` (którego Vitest/Node nie ma), w przeciwieństwie do samego odczytu
 * `window.devicePixelRatio`, który jest DOM-owy i zostaje w `resize()` niżej.
 */
export function cappedPixelRatio(devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
}

/**
 * Dokładnie te metody `WebGLRenderer`, których faktycznie używa `createSceneWithRenderer`
 * niżej — wystarczające, żeby przekazać PRAWDZIWY `THREE.WebGLRenderer` (strukturalnie
 * zgodny, patrz `createScene`) ALBO atrapę bez GPU w testach (`scene.test.ts`).
 */
export interface SceneRenderer {
  render(scene: Scene, camera: PerspectiveCamera): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  setClearColor(color: number, alpha?: number): void;
  dispose(): void;
}

/**
 * `createScene` z wstrzykiwanym rendererem zamiast budowanego na sztywno wewnątrz.
 *
 * Jedyny powód istnienia tej funkcji: `THREE.WebGLRenderer` wymaga prawdziwego kontekstu
 * WebGL, którego nie da się mieć w Vitest/Node (brak DOM, brak GPU) bez ciężkiej,
 * natywnej zależności (np. `headless-gl`) — a ta klasa ryzyka jest dokładnie tym, co
 * ten projekt każe trzymać poza testem, nie naginać przez słabszą asercję. Test
 * "render() nie mutuje Planet" (`scene.test.ts`) potrzebuje PRAWDZIWEJ `createScene`'owej
 * logiki (kamera, siatka, aktualizacja kolorów) bez PRAWDZIWEGO rysowania na GPU — stąd
 * ten szew. `createScene` (publiczne, wymagane API) niżej to jedyne, czego potrzebuje
 * `apps/client`; ta funkcja to dodatkowy, wewnętrzny hak testowalności, nie część
 * kontraktu z briefu.
 */
export function createSceneWithRenderer(
  planet: Planet,
  canvas: HTMLCanvasElement,
  makeRenderer: (canvas: HTMLCanvasElement) => SceneRenderer,
): PlanetScene {
  const geo = buildPlanetGeometry(planet);
  const planetMesh = createPlanetMesh(geo);
  const camera = createCamera(canvas, planet.radius);

  const threeScene = new Scene();
  threeScene.add(planetMesh.mesh);

  const renderer = makeRenderer(canvas);
  renderer.setClearColor(CLEAR_COLOR, 1);

  // Ten sam wzorzec resize co Zadanie 1 (`index.ts`/`mountEmptyCanvas`): `clientWidth`/
  // `clientHeight` canvasu, z awaryjnym `window.innerWidth`/`innerHeight`. `typeof window
  // !== 'undefined'` chroni WYŁĄCZNIE samo doczepienie nasłuchu (i jego alternatywę) —
  // nieistotne dla własności, które sprawdza `scene.test.ts` — a pozwala tej samej,
  // prawdziwej funkcji `resize` wykonać się bez wyjątku w Node/Vitest (brak `window`),
  // czyli dokładnie "trzymać logikę DOM poza asercją", nie "osłabiać asercję".
  //
  // `setPixelRatio` żyje TUTAJ (nie jako osobne wywołanie tylko przy konstrukcji), żeby
  // jedno miejsce pokrywało oba wymagane momenty: przy tworzeniu sceny (`resize()` wołane
  // niżej, raz) i przy każdej zmianie rozmiaru okna (przez nasłuch) — bez duplikowania
  // tej samej linii w dwóch miejscach.
  const resize = (): void => {
    const width = canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1);
    const height = canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1);
    const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    renderer.setPixelRatio(cappedPixelRatio(devicePixelRatio));
    renderer.setSize(width, height, false);
    camera.object.aspect = width / height;
    camera.object.updateProjectionMatrix();
  };
  resize();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', resize);
  }

  return {
    camera,
    resize,
    render(light: Float32Array, sunDir: Vec3): void {
      void sunDir; // patrz komentarz przy `PlanetScene.render` wyżej
      camera.update();
      planetMesh.updateColors(light);
      renderer.render(threeScene, camera.object);
    },
    dispose(): void {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', resize);
      }
      camera.dispose();
      planetMesh.dispose();
      renderer.dispose();
    },
  };
}

/**
 * Buduje scenę widocznego świata: planeta (Zadania 2-3) + kamera K1 (ten plik) + prawdziwy
 * `THREE.WebGLRenderer` rysujący na `canvas`. To jest jedyna funkcja, której potrzebuje
 * `apps/client` — cała reszta modułu to wewnętrzne okablowanie.
 */
export function createScene(planet: Planet, canvas: HTMLCanvasElement): PlanetScene {
  return createSceneWithRenderer(planet, canvas, (c) => new WebGLRenderer({ canvas: c, antialias: true }));
}
