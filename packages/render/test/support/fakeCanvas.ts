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
 *
 * ## Nasłuchy, które NAPRAWDĘ się wykonują — dołożone w rundzie naprawczej 1 Fazy 2C
 *
 * Do tej pory `addEventListener` był pustą funkcją: wystarczało to `OrbitControls`, który
 * tylko REJESTRUJE nasłuchy, i nie wystarcza wejściu gracza, którego cała treść siedzi
 * WEWNĄTRZ nasłuchu. Testowanie samych funkcji, które ten nasłuch woła, zostawia bez
 * strażnika to, czy nasłuch w ogóle jest podpięty i czy robi to, co trzeba — a recenzja
 * zmierzyła dokładnie tę dziurę: usunięcie jedynego `sim.enqueue(...)` zostawiało cały
 * pakiet zielony. Teraz atrapa trzyma rejestr nasłuchów, a `fireOn` je wywołuje.
 *
 * `fireOn` zwraca LICZBĘ wykonanych nasłuchów, nie `void`: test, który wystrzelił zdarzenie
 * w nikogo, ma się o tym dowiedzieć z asercji, a nie przejść na zielono, bo „nic nie
 * rzuciło".
 */
export interface FakeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Rejestr nasłuchów atrapy — klucz symbolowy, żeby nie kolidował z niczym w DOM. */
const LISTENERS = Symbol.for('heliopolis.fakeCanvas.listeners');

type Listener = (event: never) => void;

/**
 * Wywołuje wszystkie nasłuchy zarejestrowane na atrapie dla `type`, w kolejności
 * rejestracji. Zwraca, ile ich było.
 *
 * @throws {TypeError} gdy `target` nie jest atrapą z `createFakeCanvas`/`createFakeEventTarget`
 *   — cicha zerówka dla zwykłego obiektu byłaby nie do odróżnienia od „nasłuch nie został
 *   podpięty", czyli od defektu, którego ta funkcja ma szukać.
 */
export function fireOn(target: unknown, type: string, event: unknown): number {
  const registry = (target as Record<symbol, unknown> | null)?.[LISTENERS];
  if (!(registry instanceof Map)) {
    throw new TypeError('fireOn: target nie jest atrapą z createFakeCanvas/createFakeEventTarget');
  }
  const listeners = (registry as Map<string, Listener[]>).get(type) ?? [];
  for (const listener of [...listeners]) listener(event as never);
  return listeners.length;
}

/**
 * Kształt celu zdarzeń, jaki atrapa faktycznie udaje — struktura, nie DOM-owy `EventTarget`.
 * `EventTarget` z `lib.dom` typuje nasłuch jako `EventListener` (parametr `Event`), przez co
 * nie pasuje do modułów, które deklarują własny, węższy kształt zdarzenia — a właśnie o to
 * chodzi: kod produkcyjny ma czytać ze zdarzenia dokładnie tyle, ile umie podać atrapa.
 */
export interface FakeListenerTarget {
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
}

/** Sam rejestr nasłuchów, bez reszty płótna — atrapa `window` dla zdarzeń klawiatury. */
export function createFakeEventTarget(): FakeListenerTarget {
  const registry = new Map<string, Listener[]>();
  const fake = {
    [LISTENERS]: registry,
    addEventListener(type: string, listener: Listener): void {
      const list = registry.get(type);
      if (list === undefined) registry.set(type, [listener]);
      else list.push(listener);
    },
    removeEventListener(type: string, listener: Listener): void {
      const list = registry.get(type);
      if (list === undefined) return;
      const at = list.indexOf(listener);
      if (at >= 0) list.splice(at, 1);
    },
  };
  return fake as unknown as FakeListenerTarget;
}

/**
 * Tyle z `HTMLElement`, ile odczytuje i zapisuje HUD (`apps/client/src/hud.ts`,
 * `ElementLike`) — plus `children` do wglądu testu.
 *
 * Dołożone w Fazie 2C, Zadanie 3: panel zasobów i budowy jest PIERWSZYM UI w projekcie,
 * a `vitest.config.ts` nie ustawia `environment: 'jsdom'` (i nie powinien — patrz
 * `camera.test.ts`). Tu, a nie w drugim module atrap: rejestr nasłuchów jest ten sam, co
 * płótna i `createFakeEventTarget`, więc `fireOn` działa na pozycji menu dokładnie tak samo
 * jak na płótnie — a nie każdy rodzaj atrapy ma własne, rozjeżdżające się `fireOn`.
 *
 * `children` NIE jest DOM-owym `HTMLCollection` i nie ma nim być: to zwykła tablica
 * w kolejności `appendChild`, po to, żeby test mógł zapytać „co panel faktycznie zbudował"
 * bez przeglądarki. Kod produkcyjny tego pola nie widzi — `ElementLike` go nie deklaruje.
 */
export interface FakeElement {
  textContent: string | null;
  className: string;
  readonly ownerDocument: FakeDocument;
  appendChild(child: FakeElement): void;
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
  readonly children: FakeElement[];
  readonly tagName: string;
}

/** Tyle z `Document`, ile potrzebuje HUD: fabryka elementów. */
export interface FakeDocument {
  createElement(tag: string): FakeElement;
}

/**
 * Atrapa dokumentu — każda `createElement` daje element wskazujący z powrotem NA TEN
 * dokument. Tożsamość jest tu istotna: `createHudView` bierze fabrykę z `root.ownerDocument`,
 * więc test, w którym element i dokument nie są spokrewnione, mierzyłby inny szew niż
 * przeglądarka.
 */
export function createFakeDocument(): FakeDocument {
  const doc: FakeDocument = {
    createElement(tag: string): FakeElement {
      const events = createFakeEventTarget() as unknown as {
        [LISTENERS]: Map<string, Listener[]>;
        addEventListener: (type: string, listener: Listener) => void;
        removeEventListener: (type: string, listener: Listener) => void;
      };
      const children: FakeElement[] = [];
      const element = {
        tagName: tag.toUpperCase(),
        textContent: null as string | null,
        className: '',
        ownerDocument: doc,
        children,
        [LISTENERS]: events[LISTENERS],
        addEventListener: events.addEventListener,
        removeEventListener: events.removeEventListener,
        appendChild(child: FakeElement): void {
          children.push(child);
        },
      };
      return element as unknown as FakeElement;
    },
  };
  return doc;
}

/** Skrót: świeży dokument i jego korzeń, czyli dokładnie to, co dostaje `createHudView`. */
export function createFakeElement(tag = 'div'): FakeElement {
  return createFakeDocument().createElement(tag);
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
  // Rejestr nasłuchów wspólny z `createFakeEventTarget` — dzięki temu `fireOn` działa
  // na płótnie tak samo jak na atrapie `window`, a `OrbitControls` (który tu też
  // rejestruje) niczego nie zauważa: jego nasłuchy po prostu leżą w tej samej mapie
  // i nikt ich nie wystrzeliwuje, dopóki test o to nie poprosi.
  const events = createFakeEventTarget() as unknown as {
    [LISTENERS]: Map<string, Listener[]>;
    addEventListener: (type: string, listener: Listener) => void;
    removeEventListener: (type: string, listener: Listener) => void;
  };
  const fake = {
    style: {} as Record<string, string>,
    clientWidth: width,
    clientHeight: height,
    [LISTENERS]: events[LISTENERS],
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
    getRootNode: (): typeof noopNode => noopNode,
    ownerDocument: noopNode,
    getBoundingClientRect: (): typeof boundingRect => boundingRect,
    // Wołane przez `OrbitControls.onPointerDown`/`onPointerUp`. Potrzebne dopiero od chwili,
    // w której test WYSTRZELIWUJE zdarzenia wskaźnika w to samo płótno, do którego podpięte
    // są kontrolki orbity — czyli od rundy naprawczej 2, gdzie chodzi o to, żeby
    // współistnienie `OrbitControls` z `attachInput` było ZMIERZONE, a nie założone.
    setPointerCapture: (): void => {},
    releasePointerCapture: (): void => {},
    hasPointerCapture: (): boolean => false,
  };
  return fake as unknown as HTMLCanvasElement;
}
