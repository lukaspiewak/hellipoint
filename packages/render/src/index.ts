import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

/** Wersja pakietu renderującego — odpowiednik `SIM_VERSION` z `@heliopolis/sim`. */
export const RENDER_VERSION = '0.0.0';

// Kolor czyszczenia płótna, dopóki nic jeszcze na nim nie jest rysowane
// (scenę dodają Zadania 2-4).
const CLEAR_COLOR = 0x0a0e14; // [WYGLĄD]

export interface EmptyCanvasHandle {
  /** Zatrzymuje pętlę renderującą i zwalnia kontekst WebGL. */
  dispose: () => void;
}

/**
 * Zadanie 1 Fazy 2A: dowodzi, że rura Three.js → `<canvas>` działa. Montuje
 * pusty, ciągle renderowany canvas (jeden kolor tła, klatka po klatce) — bez
 * planety, geometrii ani kamery gry; to Zadania 2-4. Cała zależność od
 * `three` żyje w tym pakiecie — `apps/client` nie importuje `three`
 * bezpośrednio.
 */
export function mountEmptyCanvas(canvas: HTMLCanvasElement): EmptyCanvasHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(CLEAR_COLOR, 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);

  const resize = (): void => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  let frameHandle = requestAnimationFrame(function tick() {
    renderer.render(scene, camera);
    frameHandle = requestAnimationFrame(tick);
  });

  return {
    dispose: (): void => {
      cancelAnimationFrame(frameHandle);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
