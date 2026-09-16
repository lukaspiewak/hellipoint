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
import type { Building, Planet, Unit, Vec3 } from '@heliopolis/sim';
import { lightField, Rng } from '@heliopolis/sim';
import { cappedPixelRatio, CLEAR_COLOR, type SceneRenderer } from './scene.js';
import { createCamera, type OrbitCamera } from './camera.js';
import { buildPlanetGeometry, type PlanetGeometry } from './geometry.js';
import { createPlanetMesh, type PlanetMesh } from './planetMesh.js';
import { buildSmearedGeometry, writeSmearedColors, type SmearedGeometry } from './positiveControl.js';
import { createBuildingLayer, type AlertPulseOffset, type BuildingLayer } from './buildingMesh.js';
import { createUnitLayer, type UnitLayer, type UnitShadingMode } from './unitMesh.js';
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
 * - **Jest uniesiony W STRONĘ KAMERY**, nie wzdłuż normalnej komórki — patrz
 *   `writeMarkerPosition`. Do Zadania 5 unosił się wzdłuż normalnej i było to poprawne
 *   wyłącznie dlatego, że kamera celowała WPROST w komórkę; Krok 1 tego zadania odbiera tamto
 *   założenie (kamera celuje obok), więc uniesienie idzie teraz tam, gdzie paralaksa wynosi
 *   zero z konstrukcji, a nie tam, gdzie znikała przez zbieg protokołu.
 *
 * ## Uszczelnienie kontroli (Faza 2B, Zadanie 5, Krok 1)
 *
 * Do Zadania 5 `setupTrial` celował kamerą WZDŁUŻ NORMALNEJ pytanej komórki, więc komórka
 * zawsze lądowała **na środku tarczy**. W trybie kontrolnym jasność jest monotoniczną,
 * nieprzyciętą funkcją `dot(normal, sunDir)`, a tarcza pokazuje oba końce zakresu — więc
 * bezwzględna jasność środka, czytana zawsze w tym samym miejscu ekranu i przy tej samej
 * geometrii, była CZĘŚCIOWĄ WSKAZÓWKĄ. Wykonawca Zadania 2 dostał w kontroli 12/15 przy
 * oczekiwanych 7,5 i sam wskazał ten mechanizm (spec §12.6).
 *
 * Kamera celuje teraz w punkt ODCHYLONY od pytanej komórki o zasiany, pseudolosowy kąt
 * (`buildCameraOffsets`, `aimDirection`). Dwie rzeczy są w tym istotne i obie są wymogiem,
 * nie szczegółem:
 *
 * 1. **Ten sam offset dla odpowiadającej próby w KAŻDYM trybie** — offsety są indeksowane
 *    NUMEREM PRÓBY, nie komórką (plany są rozłączne co do komórek, więc offset wyprowadzony
 *    z `cellId` różniłby się między trybami). Asymetria protokołu między trybami sama byłaby
 *    confoundem: zmieniałaby trudność zadania z powodu niezwiązanego z cieniowaniem.
 * 2. **Komórka nadal jest widoczna i jednoznacznie wskazana** — odchylenie leży w
 *    `[CAMERA_OFFSET_MIN_DEGREES, CAMERA_OFFSET_MAX_DEGREES]`, czyli głęboko wewnątrz tarczy
 *    (brzeg widocznej półkuli z odległości startowej leży przy 70,5°), a znacznik ma zerową
 *    paralaksę, więc pierścień pokrywa się ze swoją komórką co do piksela.
 */

// --- Stałe wizualne znacznika — [WYGLĄD] ------------------------------------------------
const MARKER_TEXTURE_SIZE = 128; // [WYGLĄD] rozdzielczość tekstury znacznika (piksele)
export const MARKER_SCALE_FACTOR = 0.16; // [WYGLĄD] średnica pierścienia = promień planety × ten czynnik (średnica komórki ≈ 0,10 promienia, więc pierścień OTACZA komórkę)
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
 * `[WYGLĄD]` Uniesienie znacznika PONAD to, czego wymaga sama geometria — jako ułamek
 * promienia planety (5,0 jednostki). Musi przykryć trzy rzeczy naraz: krzywiznę kuli pod
 * pierścieniem (`r²/2R` = 0,32), najwyższą bryłę budynku w pełnej scenie Zadania 5
 * (`PYLON`, 3,84) i margines na bufor głębokości.
 */
const MARKER_MIN_LIFT_FACTOR = 0.05; // [WYGLĄD]

/** Promień świata, do którego sięga tarcza znacznika (połowa jej średnicy). */
export function markerRingRadius(planetRadius: number): number {
  return (planetRadius * MARKER_SCALE_FACTOR) / 2;
}

/**
 * Pozycja świata znacznika dla komórki `cellId`, przy kamerze stojącej w `cameraX/Y/Z`:
 * środek komórki uniesiony **W STRONĘ KAMERY**. Pisze trzy składowe do `out` od `offset`
 * (kontrakt jak `writeCellColors`), bo biegnie w pętli renderu, raz na klatkę.
 *
 * ## Dlaczego w stronę kamery, a nie wzdłuż normalnej (zmiana Zadania 5, Krok 1)
 *
 * Billboard `Sprite` ma w Three.js **jedną głębokość widoku dla wszystkich swoich pikseli**
 * (wierzchołki są przesuwane w płaszczyźnie XY kamery, `mvPosition.z` zostaje ten sam), więc
 * „nie jest przycięty przez teren" znaczy: jego głębokość musi być mniejsza niż głębokość
 * kuli na KAŻDYM promieniu przechodzącym przez tarczę. Pod kątem `θ` między kierunkiem
 * patrzenia a normalną komórki powierzchnia po jednej stronie pierścienia podnosi się ku
 * kamerze o `r·sin θ`, więc wymagane uniesienie ROŚNIE z kątem — dlatego jest liczone, a nie
 * stałe.
 *
 * Uniesienie wzdłuż NORMALNEJ kosztowałoby przy tym paralaksę: pierścień zdawałby się
 * przesunięty względem swojej komórki o `uniesienie × tan θ`. Do Zadania 5 nie miało to
 * znaczenia, bo kamera celowała wprost w komórkę (`θ = 0`); Krok 1 tego zadania celuje OBOK,
 * więc paralaksa przestałaby być zerem — a znacznik wskazujący nie tę komórkę, o którą
 * bramka pyta, unieważniłby każdą odpowiedź. Uniesienie wzdłuż kierunku NA KAMERĘ ma
 * paralaksę **zero z konstrukcji**, niezależnie od kąta i od wielkości uniesienia: znacznik
 * leży dokładnie na promieniu widzenia przechodzącym przez środek komórki.
 */
export function writeMarkerPosition(
  planet: Planet,
  cellId: number,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  out: Float64Array,
  offset = 0,
): void {
  const cell = planet.cells[cellId];
  let wx = cameraX - cell.center.x;
  let wy = cameraY - cell.center.y;
  let wz = cameraZ - cell.center.z;
  const length = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (!(length > 0)) {
    // Kamera dokładnie w środku komórki — nie ma z czego zbudować kierunku. Błąd programu
    // (kamera K1 nigdy nie schodzi poniżej `radius × MIN_DISTANCE_FACTOR`), nie stan bramki;
    // cichy `NaN` dałby znacznik zniknięty bez śladu w logu.
    throw new RangeError(`writeMarkerPosition: camera coincides with cell ${cellId}`);
  }
  const inv = 1 / length;
  wx *= inv;
  wy *= inv;
  wz *= inv;
  // `cos θ` między kierunkiem NA KAMERĘ a normalną komórki; `sin θ` z jedynki trygonometrycznej.
  const cos = wx * cell.normal.x + wy * cell.normal.y + wz * cell.normal.z;
  const sinSquared = 1 - cos * cos;
  const sin = sinSquared > 0 ? Math.sqrt(sinSquared) : 0;
  const lift = planet.radius * MARKER_MIN_LIFT_FACTOR + markerRingRadius(planet.radius) * sin;
  out[offset] = cell.center.x + wx * lift;
  out[offset + 1] = cell.center.y + wy * lift;
  out[offset + 2] = cell.center.z + wz * lift;
}

/** Wygodna obudowa `writeMarkerPosition` dla wywołujących poza pętlą renderu (testy). */
export function markerPosition(planet: Planet, cellId: number, camera: Vec3): Vec3 {
  const out = new Float64Array(3);
  writeMarkerPosition(planet, cellId, camera.x, camera.y, camera.z, out, 0);
  return { x: out[0], y: out[1], z: out[2] };
}

// --- Krok 1 Zadania 5: kamera NIE celuje w pytaną komórkę -------------------------------

/**
 * Odchylenie celu kamery od pytanej komórki: kąt od normalnej komórki (`polarRad`) i obrót
 * wokół niej (`azimuthRad`). Jedna para na NUMER PRÓBY — nie na komórkę, patrz komentarz
 * modułu, punkt 1.
 */
export interface CameraOffset {
  readonly polarRad: number;
  readonly azimuthRad: number;
}

/**
 * Dolna granica odchylenia. Musi wystarczyć, żeby pytana komórka przestała leżeć na środku
 * tarczy: przy 14° jej odległość od środka tarczy to `sin 14° × R` = 24 jednostki, czyli
 * **26% widocznego promienia tarczy** (94,3 jednostki z odległości startowej).
 */
export const CAMERA_OFFSET_MIN_DEGREES = 14;
/**
 * Górna granica. Brzeg widocznej półkuli z odległości startowej (`3R`) leży przy
 * `acos(1/3)` = **70,5°**, więc 34° zostawia komórkę głęboko wewnątrz tarczy (56% jej
 * promienia), przy skróceniu perspektywicznym `cos 34°` = 0,83.
 */
export const CAMERA_OFFSET_MAX_DEGREES = 34;
/** Ziarno odchyleń. Stałe, więc przebieg jest ODTWARZALNY dla drugiej sesji człowieka. */
export const CAMERA_OFFSET_SEED = 0x4f464653; // "OFFS"

/**
 * Buduje `count` odchyleń — po jednym na NUMER PRÓBY, wspólnych dla wszystkich trzech
 * trybów. Deterministyczne (`Rng` z `@heliopolis/sim`, ten sam generator co symulacja), więc
 * identyczne na każdej platformie i w każdej sesji.
 *
 * @throws {RangeError} gdy `count` nie jest dodatnią liczbą całkowitą.
 */
export function buildCameraOffsets(count: number, seed: number = CAMERA_OFFSET_SEED): CameraOffset[] {
  if (!(Number.isInteger(count) && count > 0)) {
    throw new RangeError(`buildCameraOffsets: count must be a positive integer, got ${count}`);
  }
  const rng = new Rng(seed);
  const min = (CAMERA_OFFSET_MIN_DEGREES * Math.PI) / 180;
  const max = (CAMERA_OFFSET_MAX_DEGREES * Math.PI) / 180;
  const offsets: CameraOffset[] = [];
  for (let i = 0; i < count; i++) {
    offsets.push({
      polarRad: min + (max - min) * rng.nextFloat(),
      azimuthRad: 2 * Math.PI * rng.nextFloat(),
    });
  }
  return offsets;
}

/**
 * Kierunek (wektor jednostkowy), w który ma patrzeć kamera dla komórki `cellId` odchylonej
 * o `offset`: normalna komórki obrócona o `polarRad` w płaszczyźnie wyznaczonej przez
 * `azimuthRad`. Funkcja czysta.
 *
 * Baza styczna budowana z osi NAJMNIEJ zgodnej z normalną — ten sam wybór i to samo
 * uzasadnienie co w `unitMesh.ts`: jedyny, przy którym odjęcie składowej wzdłuż normalnej
 * nigdy nie daje wektora zerowego.
 */
export function aimDirection(planet: Planet, cellId: number, offset: CameraOffset): Vec3 {
  const n = planet.cells[cellId].normal;
  let ax = 0;
  let ay = 0;
  let az = 0;
  const absX = Math.abs(n.x);
  const absY = Math.abs(n.y);
  const absZ = Math.abs(n.z);
  if (absX <= absY && absX <= absZ) ax = 1;
  else if (absY <= absZ) ay = 1;
  else az = 1;
  const along = ax * n.x + ay * n.y + az * n.z;
  let t1x = ax - along * n.x;
  let t1y = ay - along * n.y;
  let t1z = az - along * n.z;
  const inv = 1 / Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
  t1x *= inv;
  t1y *= inv;
  t1z *= inv;
  const t2x = n.y * t1z - n.z * t1y;
  const t2y = n.z * t1x - n.x * t1z;
  const t2z = n.x * t1y - n.y * t1x;
  const cosP = Math.cos(offset.polarRad);
  const sinP = Math.sin(offset.polarRad);
  const cosA = Math.cos(offset.azimuthRad);
  const sinA = Math.sin(offset.azimuthRad);
  return {
    x: n.x * cosP + (t1x * cosA + t2x * sinA) * sinP,
    y: n.y * cosP + (t1y * cosA + t2y * sinA) * sinP,
    z: n.z * cosP + (t1z * cosA + t2z * sinA) * sinP,
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

/**
 * Warstwy pełnej sceny gry wstawione do bramki (Zadanie 5, Krok 2). `null`, gdy bramka
 * biegnie w konfiguracji Zadania 1 — czyli SAM TEREN.
 *
 * ## Dlaczego to jest OSOBNY PRZEBIEG, a nie rozluźnienie bramki terenowej
 *
 * Zadania 3 i 4 rozstrzygnęły, że budynków i jednostek w scenie bramki NIE MA, i argument
 * dla jednostek jest mocny: pole jednostek rysowałoby granicę dnia i nocy NIEZALEŻNIE od
 * terenu (jednostka pali się albo nie), więc w trybie ocenianym byłoby wprost podpowiedzią.
 * Bramka Zadania 1 zostaje więc NIETKNIĘTA jako instrument mierzący sam teren; pełną scenę
 * bada osobne uruchomienie tego samego harnessu z `fullScene: true`, na osobnej stronie
 * (`apps/client/scene-gate.html`), i jego wynik zapisuje się osobno.
 *
 * Kontrola pozytywna nadal POTRAFI OBLAĆ także w pełnej scenie, i to nie przez przypadek:
 * obie warstwy są DZIEĆMI siatki terenu, a `visible` w Three.js jest dziedziczne, więc tryb
 * kontrolny gasi je razem z planetą. Pilnuje tego test 33, sprawdzany w OBU konfiguracjach.
 */
export interface GateWorld {
  /**
   * Przepisuje warstwę budynków. Drugi argument to GOTOWE WYCHYLENIE PROMIENIA w jednostkach
   * świata (`AlertPulseOffset`), **nie sekundy** — inaczej niż w `PlanetScene.updateBuildings`,
   * która bierze sekundy i przelicza je sama. Bramka musi móc wymusić spoczynek niezależnie
   * od zegara (faza prób jest zamrożona), więc fazę liczy jej własny harness.
   *
   * Typ `AlertPulseOffset` jest tu po to, żeby te dwie drogi dało się rozróżnić KOMPILATOREM:
   * przed tą marką oba podpisy brzmiały `number | undefined`, a podanie sekund w to miejsce
   * rzucało `RangeError`-em dopiero po 0,13 s, na losowej klatce. Wartość bierze się z
   * `alertPulse(radius, seconds)`; spoczynek to `alertPulse(radius, 0)`, czyli dokładne zero.
   */
  updateBuildings(buildings: readonly (Building | null)[], alertPulseOffset?: AlertPulseOffset): void;
  updateUnits(units: readonly Unit[], light: Float32Array): void;
  /**
   * Przemalowuje teren i kratę DOWOLNYM polem oświetlenia — dla fazy SWOBODNEJ bramki pełnego
   * obrazu (pytania 2-5), w której słońce orbituje, zamiast stać w fazie próby.
   *
   * @throws {RangeError} gdy tryb nie jest `'threshold'`. Faza swobodna ma pokazywać RENDER
   *   GRY; przemalowanie nim siatki w trybie porównawczym albo kontrolnym dałoby scenę, która
   *   nie jest ani jednym, ani drugim — a kontrola pozytywna przestałaby znaczyć to, co
   *   znaczy. Głośny błąd zamiast cichego rozjazdu, ten sam wzorzec co strażniki długości
   *   pola oświetlenia.
   */
  paintTerrain(light: Float32Array): void;
  setUnitShading(mode: UnitShadingMode): void;
  /** Podmienia czynniki jasności pasm jednostki — pytanie 4 bramki (0,8464). */
  setUnitShadingBands(bands: readonly number[]): void;
  /** Wystawione dla testowalności — ten sam wzorzec co `PlanetMesh.mesh`. */
  readonly buildings: BuildingLayer;
  readonly units: UnitLayer;
}

export interface GateOptions {
  /**
   * Ten sam szew testowalności co `createSceneWithRenderer` (`scene.ts`): domyślnie
   * prawdziwy `WebGLRenderer`, w testach atrapa bez GPU.
   */
  readonly makeRenderer?: (canvas: HTMLCanvasElement) => SceneRenderer;
  /** `true` → pełna scena gry (teren + krata + budynki + jednostki). Patrz `GateWorld`. */
  readonly fullScene?: boolean;
}

export interface ReadabilityGate {
  /** Liczba prób w planie KAŻDEGO trybu (wszystkie plany mają tę samą długość). */
  readonly totalTrials: number;
  /** Warstwy pełnej sceny, albo `null` w konfiguracji Zadania 1 (sam teren). */
  readonly world: GateWorld | null;
  /** Odchylenie celu kamery dla próby `ordinal` — wspólne dla wszystkich trybów. */
  cameraOffset(ordinal: number): CameraOffset;
  /**
   * Chowa pierścień na czas fazy SWOBODNEJ bramki pełnego obrazu — wtedy żadna próba nie
   * trwa, a pierścień zostawiony na ekranie wskazywałby komórkę, o którą nikt nie pyta.
   * Stan PRZEŻYWA przejście do kolejnej próby (inaczej `setupTrial` przywracałby pierścień
   * po pierwszym ruchu panelu).
   */
  setMarkerHidden(hidden: boolean): void;
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
  options: GateOptions = {},
): ReadabilityGate {
  validatePlans(plans);
  const makeRenderer =
    options.makeRenderer ?? ((c: HTMLCanvasElement): SceneRenderer => new WebGLRenderer({ canvas: c, antialias: true }));

  const geo: PlanetGeometry = buildPlanetGeometry(planet);
  const planetMesh: PlanetMesh = createPlanetMesh(geo);
  const camera = createCamera(canvas, planet.radius);

  /**
   * Warstwy pełnej sceny wieszane jako DZIECI siatki terenu — dokładnie tak, jak robi to
   * `createSceneWithRenderer`, i z tego samego powodu: `visible` jest dziedziczne, więc tryb
   * kontroli pozytywnej gasi je razem z planetą, nie wiedząc o ich istnieniu.
   */
  let world: GateWorld | null = null;
  let buildingLayer: BuildingLayer | null = null;
  let unitLayer: UnitLayer | null = null;
  if (options.fullScene === true) {
    buildingLayer = createBuildingLayer(planet, geo);
    unitLayer = createUnitLayer(planet);
    planetMesh.mesh.add(buildingLayer.object);
    planetMesh.mesh.add(unitLayer.object);
    const buildings = buildingLayer;
    const units = unitLayer;
    world = {
      buildings,
      units,
      updateBuildings: (list, alertPulseOffset) => buildings.update(list, alertPulseOffset),
      updateUnits: (list, light) => units.update(list, light),
      setUnitShading: (next) => units.setShadingMode(next),
      setUnitShadingBands: (bands) => units.setShadingBands(bands),
      paintTerrain: (light) => {
        if (mode !== 'threshold') {
          throw new RangeError(`GateWorld.paintTerrain: only valid in mode "threshold", current mode is "${mode}"`);
        }
        planetMesh.updateColors(light);
      },
    };
  }

  // Jeden offset na NUMER PRÓBY, wspólny dla wszystkich trybów — patrz komentarz modułu.
  const cameraOffsets = buildCameraOffsets(plans.threshold.length);
  /** Bufor pozycji znacznika, zaalokowany RAZ — `renderFrame` przelicza ją co klatkę. */
  const markerScratch = new Float64Array(3);

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
  let markerHidden = false;
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

    if (mode === 'threshold') {
      planetMesh.updateColors(lightField(planet, plan.trials[plan.index].sunDir));
    } else if (mode === 'smooth') {
      // Przez `PlanetMesh`, nie wprost do atrybutu `color` tej siatki (tak było do Fazy 2B,
      // Zadanie 2): od dołożenia obrysów komórek kolor planety mieszka w DWÓCH buforach i
      // sięgnięcie po jeden zostawiłoby kratę progowaną w trybie, który ma pokazywać render
      // BEZ progowania — patrz `PlanetMesh.updateColorsSmooth`.
      planetMesh.updateColorsSmooth(lightField(planet, plan.trials[plan.index].sunDir));
    } else {
      // `sunDir` PRZED przycięciem, nie `light` — patrz `writeSmearedColors`: `lightField`
      // spłaszcza całą półkulę nocną do jednej wartości, a krawędź tej jednolitej łaty JEST
      // terminatorem. Przekazanie tu gotowego pola przywróciłoby przeciek kontroli.
      writeSmearedColors(smearedGeo, plan.trials[plan.index].sunDir, smearedColors);
      (smearedGeometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    }
  }

  /**
   * Przesuwa znacznik na promień widzenia przechodzący przez komórkę bieżącej próby. Wołane
   * CO KLATKĘ (kamera może się obracać), bez ani jednej alokacji — patrz `markerScratch`.
   */
  function placeMarker(): void {
    const plan = active();
    if (!marker.visible || plan.index >= plan.trials.length) return;
    const c = camera.object.position;
    writeMarkerPosition(planet, plan.trials[plan.index].cellId, c.x, c.y, c.z, markerScratch, 0);
    marker.position.set(markerScratch[0], markerScratch[1], markerScratch[2]);
  }

  /** Ustawia znacznik na komórce bieżącej próby, resetuje barwę, przemalowuje, celuje kamerę. */
  function setupTrial(): void {
    const plan = active();
    // Po wyczerpaniu planu znacznik ZNIKA. Zostawiony na ostatniej komórce sugerowałby, że
    // bramka wciąż o coś pyta — a gorzej: jego barwa niosłaby odsłoniętą prawdę o komórce,
    // o którą nikt już nie pyta.
    marker.visible = !markerHidden && plan.index < plan.trials.length;
    if (!marker.visible) {
      applyPhaseColoring();
      return;
    }
    const s = planet.radius * MARKER_SCALE_FACTOR;
    marker.scale.set(s, s, 1);
    marker.material.color.setHex(NEUTRAL_COLOR);
    applyPhaseColoring();
    // Kamera celuje OBOK pytanej komórki — o odchylenie przypisane NUMEROWI PRÓBY, więc
    // identyczne dla odpowiadającej próby w każdym trybie (Krok 1 Zadania 5).
    const aim = aimDirection(planet, plan.trials[plan.index].cellId, cameraOffsets[plan.index]);
    camera.focusOn({ x: aim.x * planet.radius, y: aim.y * planet.radius, z: aim.z * planet.radius }, true);
    // PO ustawieniu kamery: pozycja znacznika zależy od tego, gdzie kamera stoi.
    placeMarker();
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
    world,
    camera,
    marker,

    cameraOffset(ordinal: number): CameraOffset {
      if (!(Number.isInteger(ordinal) && ordinal >= 0 && ordinal < cameraOffsets.length)) {
        throw new RangeError(`cameraOffset: ordinal must be an integer in [0, ${cameraOffsets.length}), got ${ordinal}`);
      }
      return cameraOffsets[ordinal];
    },

    setMarkerHidden(hidden: boolean): void {
      markerHidden = hidden;
      setupTrial();
      if (active().revealed) revealTruth();
    },

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
      // PO `camera.update()`: bezwładność orbity K1 dosuwa kamerę jeszcze przez kilka klatek
      // po puszczeniu myszy, a znacznik ma leżeć na promieniu widzenia TEJ klatki.
      placeMarker();
      renderer.render(threeScene, camera.object);
    },

    resize,

    dispose(): void {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', resize);
      }
      camera.dispose();
      planetMesh.dispose();
      buildingLayer?.dispose();
      unitLayer?.dispose();
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
  // ODPOWIEDŹ STAŁA — ulepszenie osprzętu zapisane jako ruling po Zadaniu 1 i zrobione tutaj,
  // bo Zadanie 5 wyprodukowało dokładnie ten przypadek dwa razy z rzędu.
  //
  // Plan jest zrównoważony (`ceil(n/2)` jasnych), więc **stała odpowiedź daje dokładnie tyle,
  // ile jest komórek tej strony** — przy piętnastu próbach 8/15. Gołe „8/15" w dokumencie
  // wygląda jak czysty przypadek i za pół roku zostanie tak odczytane; informację niesie
  // WZORZEC, nie wynik. Zdanie stąd wprost mówi, że człowiek nie rozróżniał wcale i zaczął
  // obstawiać — czego z samej liczby odtworzyć nie sposób.
  const answeredSides = new Set(answers.map((a) => a.answeredLit));
  const constantAnswer = answers.length > 1 && answeredSides.size === 1;
  const verdict = complete
    ? correctCount === totalTrials
      ? 'PASS'
      : `FAIL (${correctCount}/${totalTrials})`
    : `NIEKOMPLETNE — rozstrzygnięto ${answers.length} z ${totalTrials} prób, werdykt NIE zapada`;
  const evaluated =
    mode === 'threshold'
      ? ''
      : `\n\nUWAGA: to jest log trybu "${mode}", który NIE JEST oceniany. Werdykt bramki zapada wyłącznie z trybu "threshold".`;
  const constantNote = constantAnswer
    ? `\n\nODPOWIEDŹ STAŁA: wszystkie ${answers.length} odpowiedzi brzmiały "${
        answers[0].answeredLit ? 'oświetlona' : 'ciemna'
      }". Plan jest ZRÓWNOWAŻONY, więc stała odpowiedź daje ten wynik BEZ PATRZENIA NA EKRAN — to nie jest poziom przypadku, tylko brak rozróżniania. Informację niesie wzorzec, nie liczba.`
    : '';
  return [
    header,
    ...rows,
    '',
    `Tryb: ${mode}`,
    `Wynik: ${correctCount}/${totalTrials} — ${verdict}${evaluated}${constantNote}`,
  ].join('\n');
}
