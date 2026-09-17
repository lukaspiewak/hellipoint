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
 *
 * ## `getBoundingClientRect` — dołożone w Fazie 2C, Zadanie 2
 *
 * `screenToRay` (`apps/client/src/input.ts`) liczy współrzędne znormalizowane urządzenia
 * z PROSTOKĄTA NA EKRANIE, nie z `clientWidth`/`clientHeight`: te dwa pola są rozmiarem
 * pudełka układu (content box) i NIE uwzględniają ani przesunięcia płótna względem lewego
 * górnego rogu okna, ani skalowania CSS-em (`transform: scale`, `zoom`) — a jedno i drugie
 * przesuwa piksel, w który gracz faktycznie celuje. Stąd `rect` jest tu parametrem
 * ODDZIELNYM od `width`/`height`, a nie z nich wyliczanym: test, w którym prostokąt jest
 * zawsze zgodny z `clientWidth`, nie umiałby odróżnić poprawnej implementacji od takiej,
 * która czyta `clientWidth` — i przepuściłby dokładnie ten defekt, dla którego brief każe
 * użyć `getBoundingClientRect`.
 *
 * Domyślnie prostokąt POKRYWA SIĘ z `width`/`height` w punkcie (0,0), żeby wołający,
 * którego to nie interesuje (`camera.test.ts`, `scene.test.ts`), niczego nie musiał podawać.
 */
export interface FakeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function createFakeCanvas(
  width = 800,
  height = 600,
  rect?: Partial<FakeRect>,
): HTMLCanvasElement {
  const noopNode = {
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  };
  const left = rect?.left ?? 0;
  const top = rect?.top ?? 0;
  const rectWidth = rect?.width ?? width;
  const rectHeight = rect?.height ?? height;
  // Pełny `DOMRect`, nie same cztery pola: `right`/`bottom`/`x`/`y` są w nim wartościami
  // POCHODNYMI, a nie niezależnymi, i policzenie ich tutaj (zamiast pominięcia) sprawia,
  // że kod produkcyjny czytający którekolwiek z nich dostaje to samo, co dostałby w
  // przeglądarce — atrapa nie ma prawa być spójna tylko dla pól, których akurat użyliśmy.
  const boundingRect = {
    left,
    top,
    width: rectWidth,
    height: rectHeight,
    right: left + rectWidth,
    bottom: top + rectHeight,
    x: left,
    y: top,
    toJSON(): unknown {
      return { left, top, width: rectWidth, height: rectHeight };
    },
  };
  const fake = {
    style: {} as Record<string, string>,
    clientWidth: width,
    clientHeight: height,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
    getRootNode: (): typeof noopNode => noopNode,
    ownerDocument: noopNode,
    getBoundingClientRect: (): typeof boundingRect => boundingRect,
  };
  return fake as unknown as HTMLCanvasElement;
}
