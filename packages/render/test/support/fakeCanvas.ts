/**
 * Minimalna atrapa `HTMLCanvasElement` na potrzeby testów w Vitest/Node, gdzie DOM
 * NIE istnieje (`vitest.config.ts` nie ustawia `environment: 'jsdom'` — i celowo nie
 * powinien, patrz `camera.test.ts`/`scene.test.ts`). To NIE jest emulacja przeglądarki —
 * to dokładnie tyle metod i pól, ile faktycznie odczytują (a) `OrbitControls.connect()`/
 * `.dispose()` (Three.js, `three/examples/jsm/controls/OrbitControls.js`) i (b)
 * `resize()` w `scene.ts`. Zweryfikowane czytaniem źródła `OrbitControls.js`: `connect()`
 * woła `domElement.addEventListener(...)` (pointerdown/pointercancel/contextmenu/wheel),
 * `domElement.getRootNode().addEventListener('keydown', ...)` i ustawia
 * `domElement.style.touchAction`; `disconnect()` (wołane przez `dispose()`) dokłada
 * `domElement.ownerDocument.removeEventListener(...)`. Konstruktor `OrbitControls` NIE
 * dotyka `document`/`window` w ogóle, dopóki `domElement !== null` — a `createCamera`
 * zawsze przekazuje canvas, więc `connect()`/`disconnect()` faktycznie się wykonują i
 * potrzebują dokładnie tych metod, nie więcej.
 *
 * Rzucanie tego jako `unknown as HTMLCanvasElement` jest świadome: typecheck nie
 * porównuje kształtu `fake` z pełnym `HTMLCanvasElement` (setki pól, których nikt tu
 * nie potrzebuje) — testy dowodzą wystarczalności przez to, że faktycznie się
 * wykonują bez wyjątku, nie przez zgodność typów.
 */
export function createFakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const noopNode = {
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  };
  const fake = {
    style: {} as Record<string, string>,
    clientWidth: width,
    clientHeight: height,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
    getRootNode: (): typeof noopNode => noopNode,
    ownerDocument: noopNode,
  };
  return fake as unknown as HTMLCanvasElement;
}
