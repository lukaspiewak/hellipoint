import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Vec3 } from '@heliopolis/sim';

/**
 * Kamera K1 Fazy 2A: swobodna orbita wokół STATYCZNEJ planety, rozstrzygnięta pomiarem
 * w bramce Fazy 0 (`docs/superpowers/specs/2026-09-14-faza-0-wyniki.md`) — mediana powrotu
 * do bazy 2868 ms, wobec 4276 ms i 6256 ms dla dwóch odrzuconych modeli, i najciaśniejszy
 * rozrzut z całej trójki. K1 wygrał WBREW przewidywaniu planu, które przypisywało mu
 * ryzyko "gubienia bazy" — nie re-litygować tego wyboru tutaj. Planeta się nie obraca;
 * orbituje źródło światła (`@heliopolis/sim`'s `sunDirection`, spec §4.3). `object` jest
 * PRAWDZIWĄ kamerą Three.js (nie kopią/adapterem) — `scene.ts` renderuje wprost przez nią.
 */
export interface OrbitCamera {
  readonly object: PerspectiveCamera;
  /** Woła `OrbitControls.update()` — musi być wywoływane co klatkę (bezwładność orbity). */
  update(): void;
  /**
   * Ustawia kamerę tak, żeby patrzyła WPROST na `target` (np. środek komórki Core) —
   * kierunek patrzenia pokrywa się z normalną `target`, przy ZACHOWANEJ bieżącej
   * odległości od środka planety (zoom się nie zmienia). To jest matematyka za skrótem
   * „wróć do Core" — element WYMAGANY bramką Fazy 0, ale sam skrót (klawisz, wywołanie
   * z UI) wchodzi dopiero w Fazie 2C. Budowany już teraz, bo dorabianie go do kamery
   * później oznaczałoby przebudowę kamery, nie dopisanie funkcji.
   *
   * `immediate` jest częścią wymaganego kształtu API (Faza 2C go potrzebuje) — w Fazie 2A
   * OBIE wartości dają IDENTYCZNY, natychmiastowy wynik. To świadoma decyzja, nie
   * niedopatrzenie: żadna z czterech wymaganych własności (kierunek, zachowanie
   * odległości, ograniczenie zoomu, determinizm) nie zależy od tego flagi, a zbudowanie
   * osobnej, animowanej ścieżki bez JEDNEGO wymogu, który by ją napędzał i sprawdzał
   * wielokrotnymi klatkami, byłoby dokładnie tym wzorcem, który już czterokrotnie
   * kosztował ten projekt cofniętą pracę: „gałąź, która nigdy nie działa" pod testem.
   * Faza 2C, mając prawdziwy hotkey i człowieka, który go naciska, jest właściwym
   * miejscem na ewentualne wygładzenie przelotu.
   */
  focusOn(target: Vec3, immediate?: boolean): void;
  /** Odłącza `OrbitControls` od `canvas` (event listenery) i zwalnia jego zasoby. */
  dispose(): void;
}

// Pole widzenia — [WYGLĄD].
export const FIELD_OF_VIEW_DEGREES = 50; // [WYGLĄD]

// Granice zoomu jako CZYNNIKI promienia planety (nie stałe światowe) — działają
// identycznie niezależnie od tego, jaki `radius` dostanie `createPlanet`.
/** Jak blisko można podlecieć — nie da się "wejść pod" powierzchnię. [WYGLĄD] */
export const MIN_DISTANCE_FACTOR = 1.3; // [WYGLĄD]
/** Jak daleko można odlecieć — bez minimapy/wskaźników pozaekranowych (Faza 0: poza MVP),
 *  więc dalej niż to planeta gubi się z oczu bez żadnej pomocy nawigacyjnej. [WYGLĄD] */
export const MAX_DISTANCE_FACTOR = 8; // [WYGLĄD]
/** Startowe oddalenie — cała planeta wygodnie w kadrze. [WYGLĄD] */
export const INITIAL_DISTANCE_FACTOR = 3; // [WYGLĄD]
/** Bezwładność swobodnej orbity (K1) — `OrbitControls.dampingFactor`. [WYGLĄD] */
export const DAMPING_FACTOR = 0.08; // [WYGLĄD]

/**
 * Czułość sterowania kamerą K1 — `[WYGLĄD]`, tak samo jak bezwładność wyżej.
 *
 * Obie wartości są DOKŁADNIE domyślnymi `OrbitControls` (1.0), więc ich wpisanie tutaj
 * NICZEGO nie zmienia w zachowaniu — i to jest cały zamiar. Do tej pory czułość orbity i
 * zoomu była jedynym parametrem odczucia z kamery, który nie miał ani stałej, ani taga
 * `[WYGLĄD]`: wynikał milcząco z domyślnych biblioteki, więc (a) nie dało się go znaleźć
 * greppując `[WYGLĄD]`, jak każe dyscyplina tej gałęzi, i (b) zmiana domyślnych w
 * kolejnej wersji Three.js po cichu zmieniłaby odczucie sterowania, bez śladu w diffie.
 * Teraz wartość jest nasza i jawna; Faza 4 stroi ją tutaj, obok pola widzenia i
 * bezwładności, nie szukając jej w źródle biblioteki.
 */
export const ORBIT_ROTATE_SPEED = 1.0; // [WYGLĄD] czułość obrotu (przeciągnięcie myszą)
export const ORBIT_ZOOM_SPEED = 1.0; // [WYGLĄD] czułość przybliżania (kółko myszy)

const NEAR_FACTOR = 0.01; // [WYGLĄD] płaszczyzna bliska, jako czynnik promienia
const FAR_MARGIN_FACTOR = 2; // [WYGLĄD] margines za MAX_DISTANCE_FACTOR, żeby nie obcinać dalekiej płaszczyzny

/**
 * Dolna/górna granica odległości kamery od środka planety, jako wartości świata (nie
 * czynniki) — `radius * MIN_DISTANCE_FACTOR` / `radius * MAX_DISTANCE_FACTOR`. Wydzielone
 * z `clampDistance`, żeby dało się osobno sprawdzić SAME granice (nie tylko efekt
 * przycinania) — patrz `camera.test.ts`, bo stała może zdegenerować się w sposób
 * wewnętrznie spójny (ten sam wzorzec co `LIGHT_BANDS = []` w Zadaniu 3).
 */
export function distanceLimits(radius: number): { readonly min: number; readonly max: number } {
  if (!(radius > 0)) {
    throw new RangeError(`distanceLimits: radius must be positive and finite, got ${radius}`);
  }
  return { min: radius * MIN_DISTANCE_FACTOR, max: radius * MAX_DISTANCE_FACTOR };
}

/**
 * Przycina `distance` do `[radius × MIN_DISTANCE_FACTOR, radius × MAX_DISTANCE_FACTOR]`.
 * Funkcja CZYSTA — to jest matematyka za "zoom ograniczony z obu stron", testowalna bez
 * Three.js/canvasu/przeglądarki. Używana przez `focusPosition` (żeby zachowanie odległości
 * nigdy nie wyniosło kamery poza dozwolony zakres) i przez `createCamera` (żeby
 * `OrbitControls.minDistance/maxDistance` — a więc i zoom myszą/dotykiem — egzekwowały
 * TE SAME liczby).
 */
export function clampDistance(distance: number, radius: number): number {
  const { min, max } = distanceLimits(radius);
  return Math.min(Math.max(distance, min), max);
}

/**
 * Matematyka `focusOn`, jako funkcja czysta: dokąd powinna trafić kamera, żeby patrzeć
 * WPROST na `target`, zachowując odległość, z jaką aktualnie stoi (`currentPosition`,
 * odległość liczona od środka planety — (0,0,0)). Wynik leży dokładnie na promieniu
 * przechodzącym przez `target` (kierunek identyczny co do normalizacji), w odległości
 * `clampDistance(|currentPosition|, radius)` — więc odległość jest ZACHOWANA, ale też
 * przycięta do tego samego zakresu co zwykły zoom (start poza zakresem nie może dać
 * wyniku poza zakresem).
 *
 * @throws {RangeError} gdy `target` jest wektorem zerowym — nie ma z niego kierunku.
 *   W praktyce nie zdarza się to dla prawdziwej komórki planety (środek zawsze leży NA
 *   sferze o promieniu > 0), ale strażnik jest tu z tego samego powodu co w
 *   `sunDirection`/`writeCellColors`: cichy `NaN` (z dzielenia przez zero) byłby dużo
 *   gorszy niż głośny błąd przy konstrukcji.
 */
export function focusPosition(currentPosition: Vec3, target: Vec3, radius: number): Vec3 {
  const targetLength = Math.hypot(target.x, target.y, target.z);
  if (!(targetLength > 0)) {
    throw new RangeError(`focusPosition: target must be a non-zero vector, got length ${targetLength}`);
  }
  const currentDistance = Math.hypot(currentPosition.x, currentPosition.y, currentPosition.z);
  const distance = clampDistance(currentDistance, radius);
  const s = distance / targetLength;
  return { x: target.x * s, y: target.y * s, z: target.z * s };
}

// Wektory robocze `cameraRay` — zaalokowane RAZ, na poziomie modułu. `cameraRay` jest
// wołane z obsługi `pointermove`, czyli potencjalnie częściej niż raz na klatkę; dyscyplina
// „brak alokacji w pętli renderu" (`global-constraints.md`) obowiązuje tu tak samo, jak
// w `writeCellColors` czy w buforze `colors` z `planetMesh.ts`. Funkcja jest synchroniczna
// i nie oddaje sterowania w środku, więc współdzielenie tych dwóch wektorów między
// wywołaniami jest bezpieczne; zwracany wynik to ŚWIEŻE, zwykłe obiekty `Vec3`, żeby
// wołający nie dostał uchwytu do bufora, który zmieni mu się pod ręką przy następnym ruchu.
const rayOriginScratch = new Vector3();
const rayDirectionScratch = new Vector3();

/**
 * Promień świata odpowiadający punktowi `(ndcX, ndcY)` we WSPÓŁRZĘDNYCH ZNORMALIZOWANYCH
 * URZĄDZENIA (oba w `[-1, 1]`, `+Y` do GÓRY ekranu) — czyli odwrotność rzutowania, które
 * ta sama kamera stosuje przy rysowaniu. Wynik karmi `pickCell` (`picking.ts`).
 *
 * Mieszka w `camera.ts`, a nie w `apps/client`, z dwóch powodów. (1) To jest matematyka
 * TEJ kamery — `projectionMatrixInverse` i `matrixWorld` są jej polami, a odwrotność
 * rzutowania należy tam, gdzie samo rzutowanie. (2) `apps/client` z założenia NIE importuje
 * `three` bezpośrednio (barierka pakietu, patrz `index.ts`), a `Vector3.unproject` jest
 * jedyną drogą do `projectionMatrixInverse`; zamiana tego na własną arytmetykę macierzową
 * po stronie klienta byłaby przepisaniem biblioteki po to, żeby ominąć barierkę.
 *
 * Podział odpowiedzialności z `screenToRay` (`apps/client/src/input.ts`) jest ostry:
 * TAM mieszka piksel → NDC (bo wymaga `getBoundingClientRect`, czyli DOM-u), TUTAJ
 * NDC → promień świata (bo wymaga kamery). Klient nie zna macierzy, kamera nie zna płótna.
 *
 * `ndcZ = 0.5` (nie `-1`, czyli płaszczyzna bliska) jest tym, czego używa
 * `THREE.Raycaster.setFromCamera`: dla rzutu perspektywicznego KAŻDY `ndcZ` z przedziału
 * daje punkt na tym samym promieniu, więc wartość nie wpływa na kierunek, a 0,5 trzyma
 * odejmowanie z dala od płaszczyzny bliskiej, gdzie różnica dwóch bliskich liczb traci
 * cyfry znaczące.
 *
 * **Zwracany kierunek jest ZNORMALIZOWANY.** `pickCell` normalizuje po swojej stronie
 * (przyjmuje kierunek dowolnej długości), więc nie jest to wymóg konsumenta — ale
 * kierunek jednostkowy pozwala wołającemu czytać `dot` jako cosinus kąta bez dodatkowych
 * zabiegów, a parametr `t` przecięcia jako odległość w jednostkach świata.
 *
 * **Wejście niefinitne NIE rzuca** — ten sam kontrakt i to samo uzasadnienie, co w
 * `pickCell`: płótno o zerowym rozmiarze na pierwszej klatce ukrytej karty daje
 * `camera.aspect = 0/0`, a przez to `NaN` w `projectionMatrix`. `NaN` przechodzi tędy na
 * wylot do `Vec3` i `pickCell` zamienia go na `null` (brak podświetlenia przez jedną
 * klatkę), zamiast wywalać pętlę renderu wyjątkiem.
 */
export function cameraRay(
  camera: PerspectiveCamera,
  ndcX: number,
  ndcY: number,
): { origin: Vec3; direction: Vec3 } {
  // Kliknięcie przychodzi MIĘDZY klatkami, a `OrbitControls.update()` zapisuje nową
  // pozycję wprost do `camera.position` — `matrixWorld` przeliczy dopiero renderer, przy
  // następnym `render()`. Bez tej linii promień byłby liczony z pozycji sprzed ostatniego
  // ruchu kamery, czyli gracz celowałby tam, gdzie planeta była klatkę wcześniej.
  camera.updateMatrixWorld();
  rayOriginScratch.setFromMatrixPosition(camera.matrixWorld);
  rayDirectionScratch.set(ndcX, ndcY, 0.5).unproject(camera).sub(rayOriginScratch);
  // Dzielenie WPROST, bez `Vector3.normalize()`: ta metoda dzieli przez `length() || 1`,
  // więc dla wejścia niefinitnego albo zdegenerowanego po cichu podstawia 1 i oddaje
  // wektor, który wygląda na poprawny. Tutaj `NaN` ma dojść do `pickCell` jako `NaN`
  // (który zwróci `null`), a nie jako fałszywy kierunek.
  const length = Math.hypot(rayDirectionScratch.x, rayDirectionScratch.y, rayDirectionScratch.z);
  return {
    origin: { x: rayOriginScratch.x, y: rayOriginScratch.y, z: rayOriginScratch.z },
    direction: {
      x: rayDirectionScratch.x / length,
      y: rayDirectionScratch.y / length,
      z: rayDirectionScratch.z / length,
    },
  };
}

/**
 * Buduje kamerę K1: `THREE.PerspectiveCamera` + `OrbitControls` (traktowany jako
 * biblioteka — matematyka warta testowania to `distanceLimits`/`clampDistance`/
 * `focusPosition` powyżej, nie wnętrze `OrbitControls`). Planeta jest zawsze wyśrodkowana
 * w `(0,0,0)` (tak konstruuje ją `@heliopolis/sim`), więc `controls.target` zostaje tam
 * na stałe — orbitowanie nigdy nie zmienia PUNKTU, na który kamera patrzy, tylko kąt
 * i (w granicach) odległość.
 */
export function createCamera(canvas: HTMLCanvasElement, radius: number): OrbitCamera {
  if (!(radius > 0)) {
    throw new RangeError(`createCamera: radius must be positive and finite, got ${radius}`);
  }
  const { min, max } = distanceLimits(radius);

  const object = new PerspectiveCamera(FIELD_OF_VIEW_DEGREES, 1, radius * NEAR_FACTOR, max * FAR_MARGIN_FACTOR);
  const initialDistance = clampDistance(radius * INITIAL_DISTANCE_FACTOR, radius);
  object.position.set(0, 0, initialDistance);
  object.lookAt(0, 0, 0);

  const controls = new OrbitControls(object, canvas);
  controls.target.set(0, 0, 0);
  // Przesuwanie WYŁĄCZONE (Faza 2C, Zadanie 2). Domyślnie `OrbitControls` przypisuje je
  // do prawego przycisku i pozwala odsunąć `controls.target` od `(0,0,0)` — a cały model
  // kamery K1 stoi na tym, że planeta jest wyśrodkowana i orbitowanie zmienia wyłącznie
  // kąt i odległość (patrz komentarz funkcji wyżej; `focusOn` też zeruje `target`).
  // Przesunięcie było więc od zawsze jedyną drogą do złamania tego niezmiennika, tylko
  // nikt jej nie używał. Zadanie 2 czyni ją SZKODLIWĄ: prawy przycisk to teraz rozbiórka,
  // więc przeciągnięcie nim jednocześnie rozbijałoby kadr i wysyłało komendę.
  controls.enablePan = false;
  controls.minDistance = min;
  controls.maxDistance = max;
  controls.enableDamping = true;
  controls.dampingFactor = DAMPING_FACTOR;
  controls.rotateSpeed = ORBIT_ROTATE_SPEED;
  controls.zoomSpeed = ORBIT_ZOOM_SPEED;
  controls.update();

  return {
    object,
    update(): void {
      controls.update();
    },
    focusOn(target: Vec3, immediate?: boolean): void {
      // `immediate` celowo nieużywany w Fazie 2A — patrz komentarz przy `OrbitCamera.focusOn`
      // powyżej: obie wartości dają dziś identyczny, natychmiastowy wynik.
      void immediate;
      const dest = focusPosition(object.position, target, radius);
      object.position.set(dest.x, dest.y, dest.z);
      controls.target.set(0, 0, 0);
      controls.update();
    },
    dispose(): void {
      controls.dispose();
    },
  };
}
