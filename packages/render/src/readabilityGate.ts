import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
  WebGLRenderer,
  type Texture,
} from 'three';
import type { Planet, Vec3 } from '@heliopolis/sim';
import { lightField } from '@heliopolis/sim';
import { cappedPixelRatio, CLEAR_COLOR, type SceneRenderer } from './scene.js';
import { createCamera, type OrbitCamera } from './camera.js';
import { buildPlanetGeometry, type PlanetGeometry } from './geometry.js';
import { createPlanetMesh, type PlanetMesh } from './planetMesh.js';
import { writeCellColorsSmooth } from './shading.js';
import { buildSmearedGeometry, writeSmearedColors, type SmearedGeometry } from './positiveControl.js';
import type { GateTrial } from './terminatorPairs.js';

/**
 * Harness bramki czytelności terminatora — **wersja Fazy 2B, przeprojektowana, bo poprzednia
 * mierzyła inną zdolność, niż deklarowała** (spec Fazy 2A, §7.3.3).
 *
 * NIE jest kodem rozgrywki. To instrument, który pozwala CZŁOWIEKOWI wydać werdykt na D1
 * („gracz czyta granicę światła wzrokiem, bez UI"), i zapisuje ten werdykt. Kontroler nie
 * ocenia czytelności sam — raportuje, co człowiek faktycznie odpowiedział, w porównaniu z
 * `lightField` policzonym z prawdziwej symulacji.
 *
 * ## Co się zmieniło i dlaczego
 *
 * Bramka 2A pokazywała DWA znaczniki na dwóch SĄSIADUJĄCYCH komórkach i pytała, który leży
 * na oświetlonej. Przeszła 15/15 i wyglądało to na dowód. Nie było: pytanie sprowadzało się
 * do „wskaż jaśniejszą", co jest rozwiązywalne przy DOWOLNEJ monotonicznej palecie — więc
 * bramka przechodziła także przy cieniowaniu ciągłym, zmierzonym w Fazie 0 jako nieczytelne.
 *
 * Obserwacja, na której stoi nowy projekt (oglądane wprost, na żywym renderze): w trybie
 * progowanym granica jest widoczna **jako linia przez całą tarczę**; w trybie ciągłym ta
 * linia **znika całkowicie**, a pary sąsiadów pozostają rozróżnialne. Pytanie GLOBALNE
 * rozróżnia oba tryby, lokalne nie.
 *
 * **Nowe pytanie: JEDEN znacznik, jedna komórka, odpowiedź „oświetlona" albo „ciemna".**
 * Bez drugiej komórki w kadrze nie ma czego z czym porównać — jedyną informacją, która na to
 * pytanie odpowiada, jest położenie granicy na kuli. Ocena pozostaje binarna i bezdyskusyjna
 * (to była zaleta konstrukcji 2A i nie ma powodu jej tracić), a podłoga zgadywania zostaje
 * na 0,5¹⁵ ≈ 0,00003, bo plan prób jest zrównoważony (`buildGateTrials`).
 *
 * ## Trzy tryby, trzy ROZŁĄCZNE plany prób
 *
 * | tryb | geometria | kolor | rola |
 * |---|---|---|---|
 * | `threshold` | osobne wierzchołki (płaskie komórki) | progowany `LIGHT_BANDS` | **jedyny OCENIANY** |
 * | `smooth` | osobne wierzchołki (płaskie komórki) | gradient noc→dzień | porównanie: ile dokłada progowanie |
 * | `control` | **współdzielone wierzchołki** | gradient per wierzchołek | **kontrola pozytywna** — awaria Fazy 0 |
 *
 * Tylko `threshold` liczy się do werdyktu (`answers()`); pozostałe trafiają do osobnego logu
 * (`answersFor`). Każdy tryb ma WŁASNY plan prób, na ROZŁĄCZNYCH komórkach — bo po
 * odsłonięciu prawdy człowiek zna odpowiedź, więc plan kontrolny na tych samych komórkach
 * mierzyłby jego pamięć zamiast czytelności. Rozłączność jest sprawdzana przy konstrukcji,
 * nie zakładana.
 *
 * ## Jak znacznik nie zdradza odpowiedzi
 *
 * Przy JEDNEJ komórce ryzyko jest większe niż przy parze: nie ma drugiego znacznika, na tle
 * którego pierwszy by się kalibrował, więc każda własność znacznika zależna od tła jest
 * wprost odpowiedzią na zadane pytanie. Stąd:
 *
 * - **Znacznik jest PIERŚCIENIEM, nie wypełnionym kołem.** Wypełnione koło 2A zasłaniało
 *   komórkę — przy dwóch znacznikach to nie przeszkadzało (człowiek porównywał tła wokół
 *   nich), przy jednym zasłaniałoby DOKŁADNIE to, o co bramka pyta. Pierścień otacza komórkę
 *   i zostawia jej środek widoczny.
 * - **Pierścień jest dwutonowy** (jasne wypełnienie, ciemny obrys po obu krawędziach): jasna
 *   część wybija się na tle nocy, ciemna na tle dnia, więc SUMARYCZNA widoczność samego
 *   znacznika jest podobna po obu stronach granicy. Jeden jednolity kolor tej własności NIE
 *   MA — biały pierścień byłby bardziej kontrastowy na tle nocy i sam zdradzałby stronę.
 * - **Jest billboardem** (`Sprite`), zawsze zwróconym do kamery — ten sam, niezniekształcony
 *   obrazek pod każdym kątem orbity K1. Znacznik leżący płasko na powierzchni oglądany pod
 *   kątem stycznym wyglądałby jak kreska, a to JAK BARDZO zależałoby od kąta patrzenia.
 * - **Jest uniesiony nad powierzchnię** o `MARKER_SURFACE_OFFSET_FACTOR`, bo płaski billboard
 *   styczny do kuli opada poniżej jej krzywizny i geometria terenu ucinałaby mu brzegi.
 *   Uniesienie kosztuje paralaksę (pod dużym kątem pierścień zdaje się przesunięty względem
 *   swojej komórki), więc jest MAŁE i `setupTrial` celuje kamerę wprost w komórkę, gdzie
 *   kierunek patrzenia pokrywa się z normalną i paralaksa znika.
 */

// --- Stałe wizualne znacznika — [WYGLĄD] ------------------------------------------------
const MARKER_TEXTURE_SIZE = 128; // [WYGLĄD] rozdzielczość tekstury znacznika (piksele)
const MARKER_SCALE_FACTOR = 0.16; // [WYGLĄD] średnica pierścienia = promień planety × ten czynnik (średnica komórki ≈ 0,10 promienia, więc pierścień OTACZA komórkę)
const MARKER_SURFACE_OFFSET_FACTOR = 0.012; // [WYGLĄD] jak wysoko nad powierzchnią unosi się znacznik (patrz paralaksa wyżej)
const NEUTRAL_COLOR = 0xffffff; // [WYGLĄD] barwa znacznika, dopóki próba nie jest odsłonięta
const REVEAL_LIT_COLOR = 0x2ecc71; // [WYGLĄD] odsłonięcie: komórka faktycznie oświetlona
const REVEAL_DARK_COLOR = 0xe23d3d; // [WYGLĄD] odsłonięcie: komórka faktycznie ciemna

// --- Dwutonowość pierścienia: to NIE jest zwykła estetyka -------------------------------
// Te stałe niosą własność „znacznik nie zdradza, po której stronie granicy stoi"
// (uzasadnienie w komentarzu modułu). Faza 4 może chcieć je stroić i ma wtedy przeczytać,
// że stroi coś, na czym stoi WAŻNOŚĆ bramki, nie sam ładny wygląd.
const MARKER_FILL_COLOR = '#ffffff'; // [WYGLĄD] jasna część pierścienia — kontrast z nocą
const MARKER_STROKE_COLOR = '#000000'; // [WYGLĄD] ciemne obrysy pierścienia — kontrast z dniem
const MARKER_RING_WIDTH_FACTOR = 0.1; // [WYGLĄD] grubość jasnej części, jako ułamek MARKER_TEXTURE_SIZE
const MARKER_STROKE_WIDTH_FACTOR = 0.035; // [WYGLĄD] grubość każdego z dwóch ciemnych obrysów

/**
 * Buduje neutralną, dwutonową teksturę PIERŚCIENIA (patrz uzasadnienie w komentarzu modułu):
 * jasna obręcz z ciemnym obrysem po obu jej krawędziach, środek i zewnętrze przezroczyste.
 *
 * Zwraca `undefined` w środowisku bez DOM (Vitest/Node) — ten sam wzorzec straży co
 * `typeof window !== 'undefined'` w `scene.ts`. Harness pozostaje w pełni testowalny bez
 * canvasu: testy nie sprawdzają WYGLĄDU piksela, tylko pozycję, scoring i przejścia stanu.
 */
function createMarkerTexture(): CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = MARKER_TEXTURE_SIZE;
  canvas.height = MARKER_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const c = MARKER_TEXTURE_SIZE / 2;
  const ringWidth = MARKER_TEXTURE_SIZE * MARKER_RING_WIDTH_FACTOR;
  const strokeWidth = MARKER_TEXTURE_SIZE * MARKER_STROKE_WIDTH_FACTOR;
  // Promień środka obręczy tak dobrany, żeby OBA obrysy zmieściły się w teksturze.
  const ringRadius = c - ringWidth / 2 - strokeWidth;

  ctx.clearRect(0, 0, MARKER_TEXTURE_SIZE, MARKER_TEXTURE_SIZE);
  ctx.strokeStyle = MARKER_FILL_COLOR;
  ctx.lineWidth = ringWidth;
  ctx.beginPath();
  ctx.arc(c, c, ringRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = MARKER_STROKE_COLOR;
  ctx.lineWidth = strokeWidth;
  for (const r of [ringRadius - ringWidth / 2 - strokeWidth / 2, ringRadius + ringWidth / 2 + strokeWidth / 2]) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  return new CanvasTexture(canvas);
}

function createMarkerSprite(texture: Texture | undefined): Sprite {
  const material = new SpriteMaterial({
    // `map` pominięty CAŁKOWICIE (nie `map: undefined`) w środowisku bez DOM — Three.js
    // ostrzega w konsoli, gdy klucz jest OBECNY, ale pusty.
    ...(texture ? { map: texture } : {}),
    color: NEUTRAL_COLOR,
    transparent: true,
    depthTest: true,
    depthWrite: false, // standard dla billboardów przezroczystych
  });
  return new Sprite(material);
}

/**
 * Pozycja świata znacznika dla komórki `cellId`: środek komórki, uniesiony wzdłuż jej
 * normalnej o `radius × MARKER_SURFACE_OFFSET_FACTOR`. Funkcja czysta — testowalna bez
 * Three.js mimo że mieszka w pliku, który go używa.
 */
export function markerPosition(planet: Planet, cellId: number): Vec3 {
  const cell = planet.cells[cellId];
  const offset = planet.radius * MARKER_SURFACE_OFFSET_FACTOR;
  return {
    x: cell.center.x + cell.normal.x * offset,
    y: cell.center.y + cell.normal.y * offset,
    z: cell.center.z + cell.normal.z * offset,
  };
}

/** `threshold` to jedyny tryb OCENIANY — patrz tabela w komentarzu modułu. */
export type GateMode = 'threshold' | 'smooth' | 'control';

export const GATE_MODES: readonly GateMode[] = ['threshold', 'smooth', 'control'];

/** Plany prób: po jednym na tryb, na ROZŁĄCZNYCH komórkach (sprawdzane w konstruktorze). */
export type GatePlans = Readonly<Record<GateMode, readonly GateTrial[]>>;

/** Wynik jednej ROZSTRZYGNIĘTEJ próby. */
export interface GateAnswerRecord {
  /** Tryb, w którym padła odpowiedź. Tylko `'threshold'` liczy się do werdyktu. */
  readonly mode: GateMode;
  /** Numer próby w planie SWOJEGO trybu (0-bazowany). */
  readonly trialOrdinal: number;
  readonly phaseIndex: number;
  readonly cellId: number;
  /** Prawda z symulacji (`light[cellId] > 0`). */
  readonly actuallyLit: boolean;
  /** Co odpowiedział człowiek. */
  readonly answeredLit: boolean;
  readonly correct: boolean;
}

export interface ReadabilityGate {
  /** Liczba prób w planie KAŻDEGO trybu (wszystkie plany mają tę samą długość). */
  readonly totalTrials: number;
  mode(): GateMode;
  /** Przełącza tryb: podmienia cieniowanie CAŁEJ planety i plan prób na plan tego trybu. */
  setMode(mode: GateMode): void;
  /** Indeks bieżącej próby w planie AKTYWNEGO trybu. */
  currentTrialIndex(): number;
  /** `null` po wyczerpaniu planu aktywnego trybu. */
  currentTrial(): GateTrial | null;
  /** `true`, gdy bieżąca próba aktywnego trybu została już rozstrzygnięta (prawda odsłonięta). */
  isRevealed(): boolean;
  /** `true`, gdy plan aktywnego trybu jest wyczerpany. */
  isFinished(): boolean;
  /**
   * Zapisuje odpowiedź człowieka na bieżącą próbę („czy zaznaczona komórka jest oświetlona").
   * Zwraca `null`, gdy próba jest już odsłonięta albo plan aktywnego trybu wyczerpany.
   * Odsłania prawdę na znaczniku (zielony = faktycznie oświetlona, czerwony = faktycznie
   * ciemna) NIEZALEŻNIE od tego, co odpowiedziano.
   */
  answer(answeredLit: boolean): GateAnswerRecord | null;
  /** Przechodzi do kolejnej próby aktywnego trybu. Wymaga odsłonięcia bieżącej. */
  advance(): boolean;
  /** Log OCENIANY — wyłącznie odpowiedzi z trybu `'threshold'`. Kopia. */
  answers(): readonly GateAnswerRecord[];
  /** Log wybranego trybu. Kopia. */
  answersFor(mode: GateMode): readonly GateAnswerRecord[];
  renderFrame(): void;
  resize(): void;
  dispose(): void;

  // Wystawione dla testowalności — ten sam wzorzec co `PlanetScene.camera`/`PlanetMesh.mesh`.
  readonly camera: OrbitCamera;
  readonly marker: Sprite;
}

interface PlanState {
  readonly trials: readonly GateTrial[];
  index: number;
  revealed: boolean;
  readonly answers: GateAnswerRecord[];
}

/**
 * Buduje harness bramki czytelności dla trzech planów prób (`plans`, zwykle z trzech wywołań
 * `buildGateTrials` różniącymi się `offset`).
 *
 * `makeRenderer` — ten sam szew testowalności co `createSceneWithRenderer` (`scene.ts`):
 * domyślnie prawdziwy `WebGLRenderer`, w testach atrapa bez GPU.
 *
 * @throws {RangeError} gdy którykolwiek plan jest pusty — bramka bez próby nie ma czego mierzyć.
 * @throws {RangeError} gdy plany mają różne długości — `totalTrials` musi znaczyć jedno.
 * @throws {RangeError} gdy dwa plany dzielą choć jedną parę (faza, komórka). To nie jest
 *   pedanteria: plan kontrolny na komórce już odsłoniętej w planie ocenianym mierzyłby
 *   PAMIĘĆ człowieka, nie czytelność renderu — czyli kontrola pozytywna przestałaby móc oblać
 *   dokładnie w tym jednym miejscu, w którym cała jej wartość polega na tym, że może.
 */
export function createReadabilityGate(
  planet: Planet,
  canvas: HTMLCanvasElement,
  plans: GatePlans,
  makeRenderer: (canvas: HTMLCanvasElement) => SceneRenderer = (c) =>
    new WebGLRenderer({ canvas: c, antialias: true }),
): ReadabilityGate {
  validatePlans(plans);

  const geo: PlanetGeometry = buildPlanetGeometry(planet);
  const planetMesh: PlanetMesh = createPlanetMesh(geo);
  const camera = createCamera(canvas, planet.radius);

  // Siatka kontroli pozytywnej: WSPÓŁDZIELONE wierzchołki, budowana RAZ obok normalnej.
  // Obie żyją w scenie przez cały czas; `setMode` przełącza tylko `visible`, więc zmiana
  // trybu nie alokuje niczego i nie przebudowuje sceny.
  const smearedGeo: SmearedGeometry = buildSmearedGeometry(planet);
  const smearedColors = new Float32Array(smearedGeo.vertexCount * 3);
  const smearedGeometry = new BufferGeometry();
  smearedGeometry.setAttribute('position', new BufferAttribute(smearedGeo.positions, 3));
  smearedGeometry.setAttribute('normal', new BufferAttribute(smearedGeo.normals, 3));
  smearedGeometry.setAttribute('color', new BufferAttribute(smearedColors, 3));
  smearedGeometry.setIndex(new BufferAttribute(smearedGeo.indices, 1));
  const smearedMaterial = new MeshBasicMaterial({ vertexColors: true });
  const smearedMesh = new Mesh(smearedGeometry, smearedMaterial);
  smearedMesh.visible = false;

  const threeScene = new Scene();
  threeScene.add(planetMesh.mesh);
  threeScene.add(smearedMesh);

  const sharedTexture = createMarkerTexture();
  const marker = createMarkerSprite(sharedTexture);
  threeScene.add(marker);

  const renderer = makeRenderer(canvas);
  renderer.setClearColor(CLEAR_COLOR, 1);

  let mode: GateMode = 'threshold';
  const state: Record<GateMode, PlanState> = {
    threshold: { trials: plans.threshold, index: 0, revealed: false, answers: [] },
    smooth: { trials: plans.smooth, index: 0, revealed: false, answers: [] },
    control: { trials: plans.control, index: 0, revealed: false, answers: [] },
  };
  const active = (): PlanState => state[mode];

  /** Przemalowuje CAŁĄ planetę wg bieżącego `mode`, dla światła BIEŻĄCEJ próby tego trybu. */
  function applyPhaseColoring(): void {
    // Widoczność siatek przełączana ZAWSZE, także gdy plan jest już wyczerpany — inaczej
    // przejście na tryb o skończonym planie zostawiłoby na ekranie siatkę poprzedniego trybu.
    smearedMesh.visible = mode === 'control';
    planetMesh.mesh.visible = mode !== 'control';

    const plan = active();
    if (plan.index >= plan.trials.length) return;
    const light = lightField(planet, plan.trials[plan.index].sunDir);

    if (mode === 'threshold') {
      planetMesh.updateColors(light);
    } else if (mode === 'smooth') {
      const colorAttr = planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute;
      writeCellColorsSmooth(geo, light, colorAttr.array as Float32Array);
      colorAttr.needsUpdate = true;
    } else {
      writeSmearedColors(smearedGeo, light, smearedColors);
      (smearedGeometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    }
  }

  /** Ustawia znacznik na komórce bieżącej próby, resetuje barwę, przemalowuje, celuje kamerę. */
  function setupTrial(): void {
    const plan = active();
    // Po wyczerpaniu planu znacznik ZNIKA. Zostawiony na ostatniej komórce sugerowałby, że
    // bramka wciąż o coś pyta — a gorzej: jego barwa niosłaby odsłoniętą prawdę o komórce,
    // o którą nikt już nie pyta.
    marker.visible = plan.index < plan.trials.length;
    if (!marker.visible) {
      applyPhaseColoring();
      return;
    }
    const pos = markerPosition(planet, plan.trials[plan.index].cellId);
    marker.position.set(pos.x, pos.y, pos.z);
    const s = planet.radius * MARKER_SCALE_FACTOR;
    marker.scale.set(s, s, 1);
    marker.material.color.setHex(NEUTRAL_COLOR);
    applyPhaseColoring();
    camera.focusOn(pos, true);
  }

  setupTrial();

  function resize(): void {
    const width = canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1);
    const height = canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1);
    const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    renderer.setPixelRatio(cappedPixelRatio(devicePixelRatio));
    renderer.setSize(width, height, false);
    camera.object.aspect = width / height;
    camera.object.updateProjectionMatrix();
  }
  resize();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', resize);
  }

  return {
    totalTrials: plans.threshold.length,
    camera,
    marker,

    mode: (): GateMode => mode,
    currentTrialIndex: (): number => active().index,
    isFinished: (): boolean => active().index >= active().trials.length,
    isRevealed: (): boolean => active().revealed,
    currentTrial: (): GateTrial | null => {
      const plan = active();
      return plan.index < plan.trials.length ? plan.trials[plan.index] : null;
    },

    setMode(next: GateMode): void {
      if (next === mode) return;
      mode = next;
      // Znacznik i cieniowanie MUSZĄ przeskoczyć na próbę nowego planu — plany są rozłączne,
      // więc zostawienie znacznika na komórce poprzedniego trybu pokazywałoby człowiekowi
      // komórkę, o którą bramka w tym trybie nie pyta.
      setupTrial();
      // `setupTrial` resetuje barwę znacznika na neutralną — a próba nowego trybu mogła być
      // już wcześniej odsłonięta. Przywróć odsłonięcie, żeby powrót do trybu nie „cofał"
      // udzielonej odpowiedzi wizualnie.
      if (active().revealed) revealTruth();
    },

    answer(answeredLit: boolean): GateAnswerRecord | null {
      const plan = active();
      if (plan.revealed) return null;
      if (plan.index >= plan.trials.length) return null;

      const trial = plan.trials[plan.index];
      const record: GateAnswerRecord = {
        mode,
        trialOrdinal: plan.index,
        phaseIndex: trial.phaseIndex,
        cellId: trial.cellId,
        actuallyLit: trial.lit,
        answeredLit,
        correct: answeredLit === trial.lit,
      };
      plan.answers.push(record);
      plan.revealed = true;

      // Odsłonięcie PRAWDY, nie informacji zwrotnej: zielony zawsze znaczy „ta komórka jest
      // faktycznie oświetlona", czerwony „faktycznie ciemna" — niezależnie od odpowiedzi.
      // Gdyby kolor zależał od trafienia, człowiek widziałby „dobrze/źle", nie „oto gdzie
      // faktycznie biegnie granica" — a to drugie jest tym, co ma sprawdzić.
      revealTruth();
      return record;
    },

    advance(): boolean {
      const plan = active();
      if (plan.index >= plan.trials.length) return false;
      if (!plan.revealed) return false;
      plan.index++;
      plan.revealed = false;
      setupTrial();
      return plan.index < plan.trials.length;
    },

    answers: (): readonly GateAnswerRecord[] => state.threshold.answers.slice(),
    answersFor: (m: GateMode): readonly GateAnswerRecord[] => state[m].answers.slice(),

    renderFrame(): void {
      camera.update();
      renderer.render(threeScene, camera.object);
    },

    resize,

    dispose(): void {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', resize);
      }
      camera.dispose();
      planetMesh.dispose();
      smearedGeometry.dispose();
      smearedMaterial.dispose();
      marker.material.dispose();
      sharedTexture?.dispose();
      renderer.dispose();
    },
  };

  function revealTruth(): void {
    const plan = active();
    if (plan.index >= plan.trials.length) return;
    marker.material.color.setHex(plan.trials[plan.index].lit ? REVEAL_LIT_COLOR : REVEAL_DARK_COLOR);
  }
}

/** Patrz `@throws` przy `createReadabilityGate` — wydzielone, żeby dało się je przeczytać. */
function validatePlans(plans: GatePlans): void {
  const seen = new Map<string, GateMode>();
  let expectedLength: number | null = null;
  for (const mode of GATE_MODES) {
    const trials = plans[mode];
    if (trials.length === 0) {
      throw new RangeError(`createReadabilityGate: plan "${mode}" must be non-empty`);
    }
    if (expectedLength === null) {
      expectedLength = trials.length;
    } else if (trials.length !== expectedLength) {
      throw new RangeError(
        `createReadabilityGate: every plan must have the same length — "${mode}" has ${trials.length}, expected ${expectedLength}`,
      );
    }
    for (const trial of trials) {
      const key = `${trial.phaseIndex}:${trial.cellId}`;
      const owner = seen.get(key);
      if (owner !== undefined) {
        throw new RangeError(
          `createReadabilityGate: plans "${owner}" and "${mode}" share cell ${trial.cellId} in phase ${trial.phaseIndex} — plans must be disjoint`,
        );
      }
      seen.set(key, mode);
    }
  }
}

/**
 * Formatuje log odpowiedzi jako tabelę Markdown gotową do wklejenia w dokument wyników.
 * Funkcja czysta: dane in, Markdown out — testowalna bez Three.js/DOM.
 *
 * Werdykt jest MECHANICZNY, nie oceną kontrolera: PASS wtedy i tylko wtedy, gdy udzielono
 * KOMPLETU `totalTrials` odpowiedzi i WSZYSTKIE są poprawne. To, co człowiek odpowiedział,
 * jest jedynym wejściem — kontroler nie ocenia czytelności, tylko zlicza fakty, które
 * człowiek już ustalił własną odpowiedzią.
 *
 * `totalTrials` jest WYMAGANY, nie domyślny: domyślne `answers.length` sprawiałoby, że log
 * trzech odpowiedzi drukuje „Wynik: 3/3 — PASS", a wyjście tej funkcji jest ARTEFAKTEM,
 * który człowiek wkleja do dokumentu wyników.
 *
 * @throws {RangeError} gdy `totalTrials` nie jest dodatnią liczbą całkowitą, albo gdy
 *   odpowiedzi jest WIĘCEJ niż prób.
 * @throws {RangeError} gdy log zawiera odpowiedź z trybu innego niż jeden — tabela z
 *   pomieszanych trybów drukowałaby jeden werdykt dla dwóch różnych pytań.
 */
export function formatGateResultsMarkdown(answers: readonly GateAnswerRecord[], totalTrials: number): string {
  if (!(Number.isInteger(totalTrials) && totalTrials > 0)) {
    throw new RangeError(`formatGateResultsMarkdown: totalTrials must be a positive integer, got ${totalTrials}`);
  }
  if (answers.length > totalTrials) {
    throw new RangeError(
      `formatGateResultsMarkdown: got ${answers.length} answers for ${totalTrials} trials — more answers than trials`,
    );
  }
  const modes = new Set(answers.map((a) => a.mode));
  if (modes.size > 1) {
    throw new RangeError(
      `formatGateResultsMarkdown: answers mix modes (${[...modes].join(', ')}) — one table, one mode`,
    );
  }
  const mode = answers.length > 0 ? answers[0].mode : 'threshold';

  const header =
    '| # | Faza | Komórka | Prawda | Odpowiedź | Wynik |\n|---|---|---|---|---|---|';
  const side = (lit: boolean): string => (lit ? 'oświetlona' : 'ciemna');
  const rows = answers.map(
    (a) =>
      `| ${a.trialOrdinal + 1} | ${a.phaseIndex + 1} | ${a.cellId} | ${side(a.actuallyLit)} | ${side(
        a.answeredLit,
      )} | ${a.correct ? 'OK' : 'BŁĄD'} |`,
  );
  const correctCount = answers.filter((a) => a.correct).length;
  const complete = answers.length === totalTrials;
  const verdict = complete
    ? correctCount === totalTrials
      ? 'PASS'
      : `FAIL (${correctCount}/${totalTrials})`
    : `NIEKOMPLETNE — rozstrzygnięto ${answers.length} z ${totalTrials} prób, werdykt NIE zapada`;
  const evaluated =
    mode === 'threshold'
      ? ''
      : `\n\nUWAGA: to jest log trybu "${mode}", który NIE JEST oceniany. Werdykt bramki zapada wyłącznie z trybu "threshold".`;
  return [header, ...rows, '', `Tryb: ${mode}`, `Wynik: ${correctCount}/${totalTrials} — ${verdict}${evaluated}`].join(
    '\n',
  );
}
