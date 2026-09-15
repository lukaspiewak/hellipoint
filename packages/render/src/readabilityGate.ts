import {
  CanvasTexture,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  WebGLRenderer,
  type BufferAttribute,
  type Texture,
} from 'three';
import type { Planet, Vec3 } from '@heliopolis/sim';
import { lightField } from '@heliopolis/sim';
import { cappedPixelRatio, CLEAR_COLOR, type SceneRenderer } from './scene.js';
import { createCamera, type OrbitCamera } from './camera.js';
import { buildPlanetGeometry, type PlanetGeometry } from './geometry.js';
import { createPlanetMesh, type PlanetMesh } from './planetMesh.js';
import { writeCellColorsSmooth } from './shading.js';
import type { GateTrial } from './terminatorPairs.js';

/**
 * Harness bramki czytelności (Zadanie 5, Krok 4 briefu; kryterium dosłownie z §8.1 specu —
 * patrz `docs/superpowers/specs/2026-09-15-faza-2a-czytelnosc.md`). NIE jest kodem
 * rozgrywki — to instrument, który pozwala CZŁOWIEKOWI wydać werdykt "widzę granicę światła
 * na tej planecie, bez UI, bez najeżdżania, bez nakładki prawdy", i zapisuje ten werdykt.
 * Ja (wykonawca) nie mam prawa przejść tej bramki za człowieka — patrz `ReadabilityGate`
 * niżej: kontroler NIGDY nie ocenia czytelności sam, tylko RAPORTUJE, co faktycznie kliknął
 * człowiek, w porównaniu z `lightField` policzonym z prawdziwej symulacji.
 *
 * ## Jak znacznik NIE zdradza odpowiedzi
 *
 * Każda próba pokazuje DWA znaczniki, po jednym na środku każdej z dwóch sąsiadujących
 * komórek z `GateTrial.pair` (`terminatorPairs.ts` gwarantuje, że jedna z nich jest
 * faktycznie oświetlona, druga faktycznie nie — z prawdziwego `lightField`). Oba znaczniki:
 *
 * - dzielą DOKŁADNIE tę samą geometrię (`Sprite`), tę samą teksturę (`createMarkerTexture`,
 *   jeden obiekt `CanvasTexture` re-użyty przez oba materiały) i ten sam rozmiar — różni je
 *   WYŁĄCZNIE pozycja w świecie. Żadnego rozróżnienia kolorem, kształtem ani podpisem,
 *   dopóki człowiek nie odpowie (`isRevealed() === false`).
 * - są billboardami (`Sprite`, nie siatka zorientowana wg normalnej komórki) — ZAWSZE
 *   zwrócone wprost do kamery, więc człowiek widzi ten sam, niezniekształcony obrazek
 *   niezależnie od kąta orbity K1. Gdyby zamiast tego znacznik leżał płasko na powierzchni
 *   (zorientowany wg normalnej komórki), oglądany z bliska pod kątem stycznym wyglądałby
 *   jak cienka kreska — a to, JAK BARDZO kreska, zależałoby od kąta patrzenia, nie od tego,
 *   co bada bramka.
 * - tekstura jest CELOWO dwutonowa: biały wypełniony okrąg z czarnym obrysem, na
 *   przezroczystym tle. To jest odpowiedź na ryzyko z briefu ("marker widoczny bardziej po
 *   ciemnej stronie mierzy sam siebie, nie terminator"): biały środek wybija się na
 *   ciemnym (nocnym) tle, czarny obrys wybija się na jasnym (dziennym/zmierzchowym) tle —
 *   więc SUMARYCZNA widoczność samego znacznika (czy człowiek w ogóle go zauważy i trafi
 *   weń kursorem) jest w przybliżeniu taka sama niezależnie od tego, pod którym pasmem
 *   światła stoi. Jeden jednolity kolor (np. sam biały, sam czarny, sam neutralny szary)
 *   NIE miałby tej własności: biały byłby bardziej kontrastowy na tle nocy niż na tle dnia
 *   i SAM przez to zdradzałby, po której stronie terminatora stoi, zanim człowiek w ogóle
 *   oceni kolor komórki pod nim.
 * - są uniesione nad powierzchnią komórki wzdłuż jej normalnej
 *   (`MARKER_SURFACE_OFFSET_FACTOR`), NIE leżą dokładnie na niej — patrz `markerPosition`
 *   niżej. Dwa powody, oba konkretne: (1) płaski billboard styczny do kuli w dowolnym
 *   punkcie poza swoim środkiem opada PONIŻEJ krzywizny sfery — bez uniesienia jego brzegi
 *   ucinałaby geometria terenu (z-fighting/klipping zależny od kąta patrzenia, czyli
 *   dokładnie ten sam rodzaj artefaktu zależnego-od-kąta, którego unika wybór Sprite'a); (2)
 *   znacznik nie styka się wtedy bezpośrednio z barwną powierzchnią komórki, więc nie ma
 *   nawet teoretycznego mostka do blendingu krawędzi między kolorem znacznika a kolorem
 *   terenu pod nim (choć wypełnienie jest w pełni nieprzezroczyste, więc to drugie ryzyko
 *   było już zamknięte samym wyborem materiału — uniesienie to dodatkowa, tania rezerwa).
 * - odpowiedź jest wymuszonym wyborem dwuwartościowym (2AFC — kliknij TEN, który Twoim
 *   zdaniem leży na oświetlonej komórce), nie samo-oceną "widzę/nie widzę": to zamienia
 *   subiektywne wrażenie w zero-jedynkowy, weryfikowalny wynik per próba, i chroni przed
 *   obciążeniem typu "chcę, żeby wyszło PASS" — piętnaście trafień z rzędu przez czysty zgad
 *   ma prawdopodobieństwo 0,5¹⁵ ≈ 0,00003.
 *
 * ## Tryb kontrolny (KONTROLA POZYTYWNA)
 *
 * `setMode('smooth')` przełącza cieniowanie CAŁEJ planety (nie samych znaczników) na
 * `writeCellColorsSmooth` — gładki gradient bez progowania, dokładnie to, co bramka Fazy 0
 * zmierzyła jako nieczytelne. Klik w tym trybie NIC nie zapisuje (`handleClick` zwraca
 * `null`) — to jest demonstracja czułości instrumentu, nie część piętnastu ocenianych prób.
 */

// --- Stałe wizualne znacznika — [WYGLĄD], żadna nie wpływa na WŁASNOŚĆ "identyczne dla
// obu", tylko na to, jak duży/ostry jest wspólny obrazek. ------------------------------
const MARKER_TEXTURE_SIZE = 128; // [WYGLĄD] rozdzielczość tekstury znacznika (piksele)
const MARKER_SCALE_FACTOR = 0.06; // [WYGLĄD] rozmiar znacznika w świecie = promień planety × ten czynnik
const MARKER_SURFACE_OFFSET_FACTOR = 0.03; // [WYGLĄD] jak wysoko nad powierzchnią unosi się znacznik (patrz uzasadnienie wyżej)
const NEUTRAL_COLOR = 0xffffff; // [WYGLĄD] barwa OBU znaczników, dopóki para nie jest odsłonięta
const REVEAL_LIT_COLOR = 0x2ecc71; // [WYGLĄD] odsłonięcie: znacznik nad faktycznie oświetloną komórką
const REVEAL_DARK_COLOR = 0xe23d3d; // [WYGLĄD] odsłonięcie: znacznik nad faktycznie ciemną komórką

/**
 * Buduje neutralną, dwutonową teksturę znacznika (patrz uzasadnienie w komentarzu modułu).
 * Zwraca `undefined` w środowisku bez DOM (Vitest/Node) — TEN SAM wzorzec straży co
 * `typeof window !== 'undefined'` w `scene.ts`: `SpriteMaterial` akceptuje `map: undefined`
 * (renderuje się wtedy jako jednolity kolor zamiast tekstury), więc harness pozostaje w pełni
 * testowalny bez canvasu/DOM — testy nie sprawdzają WYGLĄDU piksela, tylko pozycję,
 * scoring i przejścia stanu.
 */
function createMarkerTexture(): CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = MARKER_TEXTURE_SIZE;
  canvas.height = MARKER_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const r = MARKER_TEXTURE_SIZE / 2;
  const strokeWidth = MARKER_TEXTURE_SIZE * 0.08;
  ctx.clearRect(0, 0, MARKER_TEXTURE_SIZE, MARKER_TEXTURE_SIZE);
  ctx.beginPath();
  ctx.arc(r, r, r - strokeWidth, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  return new CanvasTexture(canvas);
}

function createMarkerSprite(texture: Texture | undefined): Sprite {
  const material = new SpriteMaterial({
    // `map` pominięty CAŁKOWICIE (nie `map: undefined`) w środowisku bez DOM — Three.js
    // ostrzega w konsoli ("parameter 'map' has value of undefined"), gdy klucz jest OBECNY,
    // ale pusty; pominięcie klucza zamiast przypisania mu `undefined` daje ten sam efekt
    // (materiał bez tekstury) bez hałasu w logach testów.
    ...(texture ? { map: texture } : {}),
    color: NEUTRAL_COLOR,
    transparent: true,
    depthTest: true,
    depthWrite: false, // standard dla billboardów przezroczystych — patrz uzasadnienie w komentarzu modułu
  });
  return new Sprite(material);
}

/**
 * Pozycja świata znacznika dla komórki `cellId`: środek komórki, uniesiony wzdłuż jej
 * normalnej o `radius × MARKER_SURFACE_OFFSET_FACTOR`. Funkcja czysta — testowalna bez
 * Three.js mimo że mieszka w pliku, który go używa (jedyny konsument to `setupTrial` niżej).
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

export type GateMode = 'threshold' | 'smooth';

/** Wynik jednej ROZSTRZYGNIĘTEJ próby (po kliknięciu) — patrz `ReadabilityGate.answers()`. */
export interface GateAnswerRecord {
  /** Numer próby w CAŁYM planie (0-bazowany, 0..totalTrials-1) — kolejność zadawania, nie fazy. */
  readonly trialOrdinal: number;
  readonly phaseIndex: number;
  readonly litCellId: number;
  readonly darkCellId: number;
  /** Który cellId faktycznie kliknął człowiek. */
  readonly clickedCellId: number;
  /** `clickedCellId === litCellId` — poprawna odpowiedź to trafienie w znacznik NAD oświetloną komórką. */
  readonly correct: boolean;
}

export interface ReadabilityGate {
  readonly totalTrials: number;
  currentTrialIndex(): number;
  /** `true`, gdy WSZYSTKIE próby zostały już rozstrzygnięte (kliknięte) i odsłonięte. */
  isFinished(): boolean;
  /** `true`, gdy bieżąca próba została już kliknięta (prawda odsłonięta na znacznikach). */
  isRevealed(): boolean;
  /** `null` po zakończeniu (`isFinished()`). */
  currentTrial(): GateTrial | null;
  mode(): GateMode;
  /** Przełącza cieniowanie CAŁEJ planety; nie rusza znaczników ani stanu odsłonięcia bieżącej próby. */
  setMode(mode: GateMode): void;
  /**
   * Skoruje klik na WSPÓŁRZĘDNYCH CANVASU (piksele CSS — `event.offsetX`/`offsetY`).
   * Zwraca `null`, gdy: tryb ≠ `'threshold'` (klik w kontroli pozytywnej się nie liczy),
   * bieżąca próba jest już odsłonięta, gate jest już skończony, albo klik nie trafił w
   * ŻADEN z dwóch znaczników bieżącej pary. W przeciwnym razie zapisuje odpowiedź, odsłania
   * prawdę na znacznikach (zielony = faktycznie oświetlony, czerwony = faktycznie ciemny —
   * NIEZALEŻNIE od tego, co kliknięto) i zwraca zapis.
   */
  handleClick(canvasX: number, canvasY: number): GateAnswerRecord | null;
  /**
   * Przechodzi do kolejnej próby. Wymaga, żeby bieżąca była już odsłonięta — inaczej nic nie
   * robi i zwraca `false` (ten sam kod wyniku co "koniec planu prób"; UI ma nie wołać tego
   * przed odsłonięciem, więc rozróżnienie nie jest tu potrzebne wywołującemu).
   */
  advance(): boolean;
  /** Pełny, niemutowalny log odpowiedzi udzielonych dotąd (kopia — patrz `Cell.neighbors` w `@heliopolis/sim` po ten sam wzorzec). */
  answers(): readonly GateAnswerRecord[];
  /** Aktualizuje bezwładność orbity kamery i rysuje jedną klatkę — do wołania co rAF przez hosta. */
  renderFrame(): void;
  /** Przelicza proporcje kamery i devicePixelRatio na podstawie wymiarów canvasu — patrz `PlanetScene.resize`. */
  resize(): void;
  dispose(): void;

  // Wystawione dla testowalności — patrz `PlanetScene.camera`/`PlanetMesh.mesh` po ten sam
  // wzorzec (obiekty Three.js jako część publicznego kształtu, gdy to jedyny sposób, by test
  // sprawdził rzeczywisty stan sceny, nie tylko wywołanie funkcji).
  readonly camera: OrbitCamera;
  readonly markerLit: Sprite;
  readonly markerDark: Sprite;
}

/**
 * Buduje harness bramki czytelności dla PEŁNEGO planu prób (`trials`, zwykle z
 * `buildGateTrials`). `makeRenderer` — ten sam szew testowalności co
 * `createSceneWithRenderer` (`scene.ts`): domyślnie prawdziwy `WebGLRenderer`, w testach
 * atrapa bez GPU.
 *
 * @throws {RangeError} gdy `trials` jest puste — bramka bez ani jednej próby nie ma czego mierzyć.
 */
export function createReadabilityGate(
  planet: Planet,
  canvas: HTMLCanvasElement,
  trials: readonly GateTrial[],
  makeRenderer: (canvas: HTMLCanvasElement) => SceneRenderer = (c) =>
    new WebGLRenderer({ canvas: c, antialias: true }),
): ReadabilityGate {
  if (trials.length === 0) {
    throw new RangeError('createReadabilityGate: trials must be non-empty');
  }

  const geo: PlanetGeometry = buildPlanetGeometry(planet);
  const planetMesh: PlanetMesh = createPlanetMesh(geo);
  const camera = createCamera(canvas, planet.radius);

  const threeScene = new Scene();
  threeScene.add(planetMesh.mesh);

  const sharedTexture = createMarkerTexture();
  const markerLit = createMarkerSprite(sharedTexture);
  const markerDark = createMarkerSprite(sharedTexture);
  threeScene.add(markerLit, markerDark);

  const renderer = makeRenderer(canvas);
  renderer.setClearColor(CLEAR_COLOR, 1);

  const raycaster = new Raycaster();
  const ndc = new Vector2();

  let mode: GateMode = 'threshold';
  let trialIndex = 0;
  let revealed = false;
  const answers: GateAnswerRecord[] = [];

  function currentLight(): Float32Array {
    return lightField(planet, trials[trialIndex].sunDir);
  }

  /** Przemalowuje CAŁĄ planetę wg bieżącego `mode`, dla światła BIEŻĄCEJ próby. Nie rusza znaczników. */
  function applyPhaseColoring(): void {
    const light = currentLight();
    if (mode === 'threshold') {
      planetMesh.updateColors(light);
    } else {
      const colorAttr = planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute;
      writeCellColorsSmooth(geo, light, colorAttr.array as Float32Array);
      colorAttr.needsUpdate = true;
    }
  }

  function resetMarkerTint(): void {
    markerLit.material.color.setHex(NEUTRAL_COLOR);
    markerDark.material.color.setHex(NEUTRAL_COLOR);
  }

  /** Umieszcza znaczniki na parze bieżącej próby, resetuje ich barwę do neutralnej, przelicza cieniowanie i celuje kamerę na środek pary. */
  function setupTrial(index: number): void {
    const trial = trials[index];
    const litPos = markerPosition(planet, trial.pair.litCellId);
    const darkPos = markerPosition(planet, trial.pair.darkCellId);

    markerLit.position.set(litPos.x, litPos.y, litPos.z);
    markerDark.position.set(darkPos.x, darkPos.y, darkPos.z);
    const s = planet.radius * MARKER_SCALE_FACTOR;
    markerLit.scale.set(s, s, 1);
    markerDark.scale.set(s, s, 1);

    resetMarkerTint();
    revealed = false;
    applyPhaseColoring();

    const mid: Vec3 = {
      x: (litPos.x + darkPos.x) / 2,
      y: (litPos.y + darkPos.y) / 2,
      z: (litPos.z + darkPos.z) / 2,
    };
    camera.focusOn(mid, true);
  }

  setupTrial(trialIndex);

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
    totalTrials: trials.length,
    camera,
    markerLit,
    markerDark,

    currentTrialIndex: (): number => trialIndex,
    isFinished: (): boolean => trialIndex >= trials.length,
    isRevealed: (): boolean => revealed,
    currentTrial: (): GateTrial | null => (trialIndex < trials.length ? trials[trialIndex] : null),
    mode: (): GateMode => mode,

    setMode(next: GateMode): void {
      mode = next;
      if (trialIndex < trials.length) applyPhaseColoring();
    },

    handleClick(canvasX: number, canvasY: number): GateAnswerRecord | null {
      if (mode !== 'threshold') return null;
      if (revealed) return null;
      if (trialIndex >= trials.length) return null;

      // Kamera mogła się poruszyć (orbita, focusOn) bez ani jednego wywołania renderFrame()
      // od tego czasu — Raycaster czyta matrixWorld kamery i znaczników, a Three.js NIE
      // przelicza go automatycznie przy samym position.set()/quaternion. Zmierzone WPROST
      // (probe uruchomiona przed napisaniem tego pliku, w Node, poza tym repo): bez tej linii
      // klik natychmiast po focusOn/orbicie, przed pierwszą klatką renderu, trafia w ZERO
      // obiektów. `renderFrame` i tak by to naprawił NASTĘPNYM razem, ale wtedy klik "o jedną
      // klatkę za wcześnie" cicho by nic nie zrobił — myląco identyczne z "kliknąłeś obok".
      camera.object.updateMatrixWorld(true);
      threeScene.updateMatrixWorld(true);

      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      ndc.set((canvasX / width) * 2 - 1, -(canvasY / height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera.object);

      const hits = raycaster.intersectObjects([markerLit, markerDark], false);
      if (hits.length === 0) return null;

      const clickedLit = hits[0].object === markerLit;
      const trial = trials[trialIndex];
      const record: GateAnswerRecord = {
        trialOrdinal: trialIndex,
        phaseIndex: trial.phaseIndex,
        litCellId: trial.pair.litCellId,
        darkCellId: trial.pair.darkCellId,
        clickedCellId: clickedLit ? trial.pair.litCellId : trial.pair.darkCellId,
        correct: clickedLit,
      };
      answers.push(record);
      revealed = true;

      // Odsłonięcie PRAWDY, nie informacji zwrotnej: zielony zawsze oznacza "to jest ta
      // faktycznie oświetlona", czerwony zawsze "faktycznie ciemna" — niezależnie od tego,
      // co człowiek kliknął. Gdyby kolor zależał od trafienia/pudła, człowiek widziałby
      // "dobrze/źle", nie "oto gdzie faktycznie biegnie granica" — a to drugie jest tym, co
      // ma sprawdzić.
      markerLit.material.color.setHex(REVEAL_LIT_COLOR);
      markerDark.material.color.setHex(REVEAL_DARK_COLOR);

      return record;
    },

    advance(): boolean {
      if (trialIndex >= trials.length) return false;
      if (!revealed) return false;
      trialIndex++;
      if (trialIndex < trials.length) {
        setupTrial(trialIndex);
        return true;
      }
      return false;
    },

    answers: (): readonly GateAnswerRecord[] => answers.slice(),

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
      markerLit.material.dispose();
      markerDark.material.dispose();
      sharedTexture?.dispose();
      renderer.dispose();
    },
  };
}

/**
 * Formatuje log odpowiedzi jako tabelę Markdown gotową do wklejenia w dokument wyników
 * (`docs/superpowers/specs/2026-09-15-faza-2a-czytelnosc.md`) — ten sam pomysł co "eksport
 * markdown w dokładnie tym formacie" ze spike'u Fazy 0 (`docs/superpowers/specs/
 * 2026-09-14-faza-0-wyniki.md`, §3). Funkcja czysta: string in (dane), string out
 * (Markdown) — testowalna bez Three.js/DOM.
 *
 * Werdykt jest MECHANICZNY, nie moją oceną: PASS wtedy i tylko wtedy, gdy WSZYSTKIE
 * dostarczone odpowiedzi są poprawne (§8.1: "PASS wymaga kompletu piętnastu"). To, CO
 * człowiek kliknął, jest jedynym wejściem tej funkcji — ja nie oceniam czytelności, tylko
 * zliczam fakty, które człowiek już ustalił własnym kliknięciem.
 */
export function formatGateResultsMarkdown(answers: readonly GateAnswerRecord[]): string {
  const header = '| # | Faza | Komórka jasna | Komórka ciemna | Kliknięto | Wynik |\n|---|---|---|---|---|---|';
  const rows = answers.map(
    (a) =>
      `| ${a.trialOrdinal + 1} | ${a.phaseIndex + 1} | ${a.litCellId} | ${a.darkCellId} | ${a.clickedCellId} | ${
        a.correct ? 'OK' : 'BŁĄD'
      } |`,
  );
  const correctCount = answers.filter((a) => a.correct).length;
  const verdict =
    answers.length > 0 && correctCount === answers.length ? 'PASS' : `FAIL (${correctCount}/${answers.length})`;
  return [header, ...rows, '', `Wynik: ${correctCount}/${answers.length} — ${verdict}`].join('\n');
}
