import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  canBuild,
  createPlanet,
  DEFAULT_RUN,
  Sim,
  stateHash,
  type BuildingType,
  type Planet,
  sunDirection,
  type Vec3,
} from '@heliopolis/sim';
import {
  createCamera,
  focusPosition,
  MAX_DISTANCE_FACTOR,
  MIN_DISTANCE_FACTOR,
  type OrbitCamera,
  type UnitShadingMode,
} from '@heliopolis/render';
import {
  createFakeCanvas,
  createFakeElement,
  createFakeEventTarget,
  fireOn,
} from '../../../packages/render/test/support/fakeCanvas.js';
import { mulberry32 } from '../../../packages/render/test/support/mulberry32.js';
import { wireClient, type Client, type ClientScene } from '../src/client.js';
import {
  attachInput,
  CLICK_SLOP_PX,
  createSelection,
  focusCoreTarget,
  intentFromPointer,
  isClick,
  playerBuildableTypes,
  pointedCell,
  refusalReason,
  screenToRay,
  type ListenerTarget,
  type RayCamera,
  type Report,
} from '../src/input.js';
import { freeHexagonNear, worldFingerprint } from './support/fixtures.js';

// Ta sama planeta-fixture, co w testach `packages/render` (ten sam seed) — jedna
// „prawdziwa planeta", o której mówi cała gałąź.
const planet: Planet = createPlanet({ seed: 20260915 });
const radius = planet.radius;

/**
 * Prawdziwa `PerspectiveCamera` — ta sama, którą dostaje aplikacja, wyjęta z `createCamera`
 * przez `.object`. `apps/client` nie importuje `three` (barierka pakietu,
 * `packages/render/src/index.ts`), więc `new PerspectiveCamera(...)` z briefu jest tu
 * zapisane jedyną drogą, która tej barierki nie przebija — a że `createCamera` buduje
 * kamerę z `FIELD_OF_VIEW_DEGREES` i `aspect = 1`, każdy test, któremu zależy na innych
 * wartościach, ustawia je JAWNIE (i woła `updateProjectionMatrix`), zamiast je odziedziczyć.
 */
function makeCamera(canvas: HTMLCanvasElement): RayCamera {
  return createCamera(canvas, radius).object;
}

// ---------------------------------------------------------------------------------------
// Wyrocznia NIEZALEŻNA od `screenToRay`/`cameraRay`
//
// `cameraRay` odwraca rzut macierzą `projectionMatrixInverse` Three.js. Ta funkcja liczy
// to samo z DEFINICJI rzutu perspektywicznego: kierunek w układzie kamery to
// `(ndcX·aspect·tan(fov/2), ndcY·tan(fov/2), −1)`, a do świata przenosi go baza kamery
// odczytana WPROST z kolumn `matrixWorld`. Dwa różne wyprowadzenia tej samej wielkości —
// w odróżnieniu od porównania wyjścia funkcji z wyjściem tej samej funkcji, które w
// katalogu wad tej fazy stoi na pierwszym miejscu.
// ---------------------------------------------------------------------------------------
function analyticDirection(camera: RayCamera, ndcX: number, ndcY: number): Vec3 {
  const e = camera.matrixWorld.elements; // kolumnami: right, up, back, position
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
  const px = ndcX * camera.aspect * tanHalfFov;
  const py = ndcY * tanHalfFov;
  // Kamera patrzy wzdłuż −Z SWOJEGO układu, stąd minus przy trzeciej kolumnie.
  const x = e[0] * px + e[4] * py - e[8];
  const y = e[1] * px + e[5] * py - e[9];
  const z = e[2] * px + e[6] * py - e[10];
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * Kąt między dwoma kierunkami, liczony `atan2(|a×b|, a·b)`, a NIE `acos(a·b)`.
 *
 * To nie jest kosmetyka — na tym stoją progi testów 2 i 3. `acos` w okolicy jedynki
 * podnosi błąd do kwadratu: iloczyn skalarny obarczony błędem kilku ULP (4,4·10⁻¹⁶) daje
 * kąt sqrt(2·4,4·10⁻¹⁶) ≈ 3·10⁻⁸ rad. ZMIERZONE: z `acos` najgorsza próbka wychodziła
 * 2,98·10⁻⁸ rad niezależnie od tego, jak dokładne jest `screenToRay` — czyli próg poniżej
 * 10⁻⁸ byłby nie do przejścia dla KAŻDEJ implementacji, a próg powyżej mierzyłby precyzję
 * `acos`, a nie kodu. Postać z iloczynem wektorowym jest dokładna także dla kątów bliskich
 * zeru, bo `|a×b|` maleje liniowo razem z kątem, zamiast chować się pod jedynką.
 */
function angleBetween(a: Vec3, b: Vec3): number {
  const cross = {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
  return Math.atan2(Math.hypot(cross.x, cross.y, cross.z), a.x * b.x + a.y * b.y + a.z * b.z);
}

/** Punkt na sferze jednostkowej, rozłożony równomiernie (z = 2u−1 daje równe pasy pola). */
function randomUnit(rand: () => number): Vec3 {
  const z = 2 * rand() - 1;
  const phi = 2 * Math.PI * rand();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: r * Math.cos(phi), y: r * Math.sin(phi), z };
}

/**
 * Stawia kamerę w losowym miejscu orbity, na losowej odległości Z DOZWOLONEGO ZAKRESU
 * ZOOMU i z losowym PRZECHYŁEM (`up` losowe, nie domyślne `(0,1,0)`).
 *
 * Przechył jest tu celowo: bez niego wszystkie promienie leżałyby w płaszczyznach
 * zawierających oś Y świata, czyli test badałby jedną, szczególną rodzinę orientacji —
 * ten sam rodzaj zawężenia, który w Zadaniu 1 tej fazy zrobił z 2000 „losowych" promieni
 * jeden przypadek osiowy.
 */
function placeCamera(camera: RayCamera, rand: () => number): void {
  const direction = randomUnit(rand);
  const distance = radius * (MIN_DISTANCE_FACTOR + rand() * (MAX_DISTANCE_FACTOR - MIN_DISTANCE_FACTOR));
  camera.position.set(direction.x * distance, direction.y * distance, direction.z * distance);
  let up = randomUnit(rand);
  // `lookAt` degeneruje się, gdy `up` jest (prawie) równoległe do osi patrzenia — losujemy
  // dalej, zamiast przyjąć wynik, którego sama Three.js nie definiuje.
  while (Math.abs(up.x * direction.x + up.y * direction.y + up.z * direction.z) > 0.9) {
    up = randomUnit(rand);
  }
  camera.up.set(up.x, up.y, up.z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
}

/**
 * Niezależny solver „promień → komórka": świeże przecięcie ze sferą i świeży przegląd
 * środków. Celowo NIE importuje `pickCell` — porównanie `pointedCell` z `pickCell` byłoby
 * porównaniem funkcji z samą sobą przez jedno opakowanie.
 */
function solveCell(origin: Vec3, direction: Vec3): number | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  const d = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  const b = origin.x * d.x + origin.y * d.y + origin.z * d.z;
  const c = origin.x * origin.x + origin.y * origin.y + origin.z * origin.z - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  const hit = { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t };
  let best = -1;
  let bestDot = -Infinity;
  for (let i = 0; i < planet.cells.length; i++) {
    const n = planet.cells[i].normal;
    const dot = n.x * hit.x + n.y * hit.y + n.z * hit.z;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

describe('screenToRay — piksel okna na promień świata', () => {
  it('1. kliknięcie w środek kadru daje promień wzdłuż osi patrzenia kamery', () => {
    const canvas = createFakeCanvas(800, 600);
    const camera = makeCamera(canvas);
    camera.aspect = 800 / 600;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, 300);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const ray = screenToRay(camera, canvas, 400, 300);

    expect(ray.direction.z).toBeLessThan(-0.999); // patrzy w −Z, czyli w planetę
    expect(Math.abs(ray.direction.x)).toBeLessThan(1e-6);
    expect(Math.abs(ray.direction.y)).toBeLessThan(1e-6);
  });

  it('2. [WŁASNOŚĆ] kierunek zgadza się z niezależnie wyprowadzoną geometrią rzutu — 2000 kliknięć rozsianych po CAŁYM kadrze, przy losowym zoomie, obrocie i przechyle', () => {
    const rand = mulberry32(0x2c0202);
    const width = 1280;
    const height = 720;
    const canvas = createFakeCanvas(width, height, { left: 64, top: 96, width, height });
    const camera = makeCamera(canvas);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    let worstAngle = 0;
    let worstOriginError = 0;
    // Ile z próbek leży POZA poziomą i pionową osią kadru — czyli ile z nich mogłoby
    // wykryć błąd perspektywy, którego środek kadru nie pokazuje. Asercja niżej pilnuje,
    // żeby próbka nie zdegenerowała się po cichu do wąskiego paska ekranu.
    let offAxis = 0;
    for (let i = 0; i < 2000; i++) {
      placeCamera(camera, rand);
      const clientX = 64 + rand() * width;
      const clientY = 96 + rand() * height;
      const ndcX = ((clientX - 64) / width) * 2 - 1;
      const ndcY = -(((clientY - 96) / height) * 2 - 1);
      if (Math.abs(ndcX) > 0.05 && Math.abs(ndcY) > 0.05) offAxis++;

      const ray = screenToRay(camera, canvas, clientX, clientY);
      worstAngle = Math.max(worstAngle, angleBetween(ray.direction, analyticDirection(camera, ndcX, ndcY)));
      worstOriginError = Math.max(
        worstOriginError,
        Math.hypot(
          ray.origin.x - camera.position.x,
          ray.origin.y - camera.position.y,
          ray.origin.z - camera.position.z,
        ),
      );
      // Kierunek jest jednostkowy — na tym stoi czytanie `dot` jako cosinusa kąta
      // w teście 4 i w każdym wołającym, który liczy odległość wzdłuż promienia.
      expect(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z)).toBeCloseTo(1, 12);
    }

    expect(offAxis).toBeGreaterThan(1700);
    // Próg wyprowadzony z POMIARU, nie zgadnięty: najgorsza z 2000 próbek daje
    // **1,77·10⁻¹⁴ rad**. Obie drogi liczą to samo w innej kolejności działań, więc
    // różnica jest wyłącznie kumulacją zaokrągleń podwójnej precyzji. 10⁻¹² to margines
    // 56× nad zmierzonym maksimum, a JEDNOCZEŚNIE 1,2·10⁻⁹ piksela kadru
    // (0,001212 rad/px przy 720 px i polu widzenia 50°) — czyli próg, który nie jest
    // w stanie przepuścić błędu widocznego dla gracza nawet o rzędy wielkości.
    expect(worstAngle).toBeLessThan(1e-12);
    // Początek promienia to POZYCJA KAMERY — skopiowana z `matrixWorld`, nie policzona,
    // więc równość jest BITOWA, a nie przybliżona (zmierzone: dokładnie 0 na wszystkich
    // 2000 próbkach). Próg „mniejsze niż epsilon" przepuściłby implementację, która
    // początek promienia wylicza (np. z punktu na płaszczyźnie bliskiej) — a wtedy
    // przecięcie ze sferą byłoby liczone z punktu, w którym kamery nie ma.
    expect(worstOriginError).toBe(0);
  });

  it('3. [WŁASNOŚĆ] NDC liczone z getBoundingClientRect, nie z clientWidth — płótno przesunięte i przeskalowane CSS-em', () => {
    // Płótno ma 800×600 pikseli układu, ale na ekranie leży w prostokącie 1000×500,
    // przesuniętym o (137, 41) — dokładnie sytuacja `transform: scale` plus panel obok
    // (`scene-gate.html`). `clientWidth` NIE wie ani o skali, ani o przesunięciu.
    const rect = { left: 137, top: 41, width: 1000, height: 500 };
    const canvas = createFakeCanvas(800, 600, rect);
    const camera = makeCamera(canvas);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();

    const rand = mulberry32(0x2c0203);
    let worstAngle = 0;
    let worstClientWidthAngle = Infinity;
    for (let i = 0; i < 500; i++) {
      placeCamera(camera, rand);
      const clientX = rect.left + rand() * rect.width;
      const clientY = rect.top + rand() * rect.height;
      const ray = screenToRay(camera, canvas, clientX, clientY);

      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      worstAngle = Math.max(worstAngle, angleBetween(ray.direction, analyticDirection(camera, ndcX, ndcY)));

      // KONTROLA POZYTYWNA SAMEGO TESTU: gdyby `screenToRay` liczyło NDC z `clientWidth`
      // i bez odjęcia `rect.left`/`rect.top` — czyli dokładnie tak, jak wygląda
      // implementacja „na skróty" — o ile pomyliłby się kierunek? Bez tej asercji test
      // wyżej przechodziłby również dla płótna, którego prostokąt zawsze pokrywa się
      // z `clientWidth`, i nie mierzyłby niczego, o co brief prosi.
      const naiveX = (clientX / canvas.clientWidth) * 2 - 1;
      const naiveY = -((clientY / canvas.clientHeight) * 2 - 1);
      worstClientWidthAngle = Math.min(
        worstClientWidthAngle,
        angleBetween(ray.direction, analyticDirection(camera, naiveX, naiveY)),
      );
    }

    expect(worstAngle).toBeLessThan(1e-12); // zmierzone maksimum: 1,11·10⁻¹⁴ rad
    // NAJMNIEJSZY błąd wersji „na skróty" w całej próbce — zmierzone **0,194 rad**, czyli
    // nawet w najlepszym dla niej przypadku 13 rzędów wielkości nad progiem wyżej.
    // Wyrażone w pikselach kadru (0,001745 rad/px przy 500 px i polu widzenia 50°) to
    // 111 pikseli pudła; próg 0,1 rad to 57 pikseli — nie „gdzieś obok", tylko inny budynek.
    expect(worstClientWidthAngle).toBeGreaterThan(0.1);
  });

  it('4. [PRÓG] kąt promienia krawędzi kadru względem osi patrzenia równa się połowie pola widzenia (pion) i atan(tan(fov/2)·aspect) (poziom)', () => {
    const rect = { left: 0, top: 0, width: 1600, height: 900 };
    const canvas = createFakeCanvas(rect.width, rect.height, rect);
    const camera = makeCamera(canvas);
    // Pole widzenia USTAWIONE JAWNIE na wartość inną niż `FIELD_OF_VIEW_DEGREES` (50°),
    // żeby próg nie był zbudowany ze stałej, którą testuje: relacja geometryczna ma
    // zachodzić dla DOWOLNEGO pola widzenia, nie akurat dla tego, z którym kamera powstała.
    camera.fov = 37;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, radius * 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const center = screenToRay(camera, canvas, rect.width / 2, rect.height / 2);
    const topEdge = screenToRay(camera, canvas, rect.width / 2, 0);
    const rightEdge = screenToRay(camera, canvas, rect.width, rect.height / 2);

    const halfFov = (37 * Math.PI) / 360;
    expect(angleBetween(center.direction, topEdge.direction)).toBeCloseTo(halfFov, 12);
    expect(angleBetween(center.direction, rightEdge.direction)).toBeCloseTo(
      Math.atan(Math.tan(halfFov) * (rect.width / rect.height)),
      12,
    );
    // ZNAK, nie tylko wielkość: górna krawędź kadru musi dawać promień idący w GÓRĘ
    // świata (tu `up` = +Y), a prawa — w prawo. Test na sam kąt przeszedłby dla obu
    // odwróconych znaków NDC naraz, a to jest defekt, który gracz widzi natychmiast.
    expect(topEdge.direction.y).toBeGreaterThan(0);
    expect(rightEdge.direction.x).toBeGreaterThan(0);
  });

  it('5. promień liczony jest z BIEŻĄCEJ pozycji kamery, nie z pozycji sprzed ostatniej klatki', () => {
    // `OrbitControls.update()` zapisuje nową pozycję wprost do `camera.position`;
    // `matrixWorld` przelicza dopiero renderer, przy następnym `render()`. Kliknięcie
    // przychodzi MIĘDZY klatkami — a tu odtworzony jest dokładnie ten moment: pozycja
    // zmieniona, `updateMatrixWorld` jeszcze NIEwołane przez nikogo z zewnątrz.
    const rect = { left: 0, top: 0, width: 800, height: 600 };
    const canvas = createFakeCanvas(rect.width, rect.height, rect);
    const camera = makeCamera(canvas);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, radius * 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(screenToRay(camera, canvas, 400, 300).origin.z).toBeCloseTo(radius * 3, 9);

    // Ruch kamery bez odświeżenia macierzy — tak, jak robi to `OrbitControls`.
    camera.position.set(radius * 4, 0, 0);
    camera.lookAt(0, 0, 0);
    const ray = screenToRay(camera, canvas, 400, 300);

    expect(ray.origin.x).toBeCloseTo(radius * 4, 9);
    expect(ray.origin.z).toBeCloseTo(0, 9);
    // I kierunek też: bez odświeżenia macierzy promień szedłby wzdłuż STAREJ osi patrzenia.
    expect(ray.direction.x).toBeCloseTo(-1, 9);
  });

  it('6. płótno o zerowym rozmiarze nie wywala pętli renderu — daje null, nie wyjątek', () => {
    // `aspect = 0/0` na pierwszej klatce ukrytej karty robi przeglądarka, nie programista
    // (patrz kontrakt `pickCell`): wyjątek w pętli renderu byłby gorszy od braku wskazania.
    const canvas = createFakeCanvas(0, 0, { left: 0, top: 0, width: 0, height: 0 });
    const camera = makeCamera(canvas);
    camera.aspect = 0 / 0;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, radius * 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    expect(() => screenToRay(camera, canvas, 0, 0)).not.toThrow();
    expect(Number.isFinite(screenToRay(camera, canvas, 0, 0).direction.x)).toBe(false);
    expect(pointedCell(planet, camera, canvas, 0, 0)).toBeNull();
    expect(
      intentFromPointer(planet, camera, canvas, { clientX: 0, clientY: 0, button: 'LEFT' }, 'BARRICADE'),
    ).toBeNull();
  });
});

describe('intentFromPointer — kliknięcie na zamiar', () => {
  it('7. [WŁASNOŚĆ] wskazuje komórkę, którą wskazuje niezależny solver — 1500 kliknięć, losowy zoom, obrót i przechył', () => {
    const rand = mulberry32(0x2c0206);
    const rect = { left: 23, top: 71, width: 1024, height: 768 };
    const canvas = createFakeCanvas(rect.width, rect.height, rect);
    const camera = makeCamera(canvas);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();

    let hits = 0;
    let misses = 0;
    let disagreements = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 1500; i++) {
      placeCamera(camera, rand);
      const clientX = rect.left + rand() * rect.width;
      const clientY = rect.top + rand() * rect.height;
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

      const expected = solveCell(
        { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        analyticDirection(camera, ndcX, ndcY),
      );
      const actual = pointedCell(planet, camera, canvas, clientX, clientY);
      if (actual !== expected) disagreements++;
      if (expected === null) misses++;
      else {
        hits++;
        seen.add(expected);
      }
    }

    expect(disagreements).toBe(0);
    // Próbka ma być REPREZENTATYWNA dla tego, co robi gracz: i trafienia w planetę,
    // i kliknięcia w tło, i to rozsiane po wielu różnych komórkach — a nie jedna komórka
    // 1500 razy. Bez tych trzech asercji test przechodziłby również dla próbki, która
    // zdegenerowała się do samych chybień (`null === null` dla obu stron).
    //
    // Progi to WYMAGANIE na próbkę („obie gałęzie i setki różnych komórek"), postawione
    // grubo poniżej zmierzonych wartości, a nie kotwica na dzisiejszy wynik: zmiana
    // ziarna albo zakresu zoomu ma je przesuwać o dziesiątki, nie wywracać testu.
    expect(hits).toBeGreaterThan(200);
    expect(misses).toBeGreaterThan(200);
    expect(seen.size).toBeGreaterThan(200);
  });

  it('8. lewy przycisk buduje WYBRANY typ, prawy rozbiera — ta sama komórka, dwa zamiary', () => {
    const rect = { left: 0, top: 0, width: 900, height: 900 };
    const canvas = createFakeCanvas(rect.width, rect.height, rect);
    const camera = makeCamera(canvas);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, radius * 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const aim = { clientX: 512, clientY: 388 };
    const cellId = pointedCell(planet, camera, canvas, aim.clientX, aim.clientY);
    expect(cellId).not.toBeNull();

    const built = intentFromPointer(planet, camera, canvas, { ...aim, button: 'LEFT' }, 'LASER_TURRET');
    expect(built).toEqual({ kind: 'BUILD', cellId, type: 'LASER_TURRET' });
    // Typ pochodzi z ARGUMENTU, nie ze stałej w środku — drugi typ na tym samym pikselu.
    const other = intentFromPointer(planet, camera, canvas, { ...aim, button: 'LEFT' }, 'SOLAR_PANEL');
    expect(other).toEqual({ kind: 'BUILD', cellId, type: 'SOLAR_PANEL' });

    const demolished = intentFromPointer(planet, camera, canvas, { ...aim, button: 'RIGHT' }, 'LASER_TURRET');
    expect(demolished).toEqual({ kind: 'DEMOLISH', cellId });
    expect(demolished).not.toHaveProperty('type');
  });

  it('9. [PRÓG] granica wskazania leży dokładnie na sylwetce planety: piksel wewnątrz daje komórkę, piksel na zewnątrz — null', () => {
    const rect = { left: 0, top: 0, width: 1200, height: 800 };
    const canvas = createFakeCanvas(rect.width, rect.height, rect);
    const camera = makeCamera(canvas);
    camera.fov = 50;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    const distance = radius * 3;
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const centerY = rect.height / 2;
    const pick = (x: number): number | null => pointedCell(planet, camera, canvas, x, centerY);

    // Gdzie sylwetka POWINNA być, policzone z geometrii, a nie znalezione tą samą funkcją:
    // promień styczny do sfery tworzy z osią patrzenia kąt asin(R/d), a NDC punktu o kącie θ
    // w poziomej osi kadru to tan(θ)/(aspect·tan(fov/2)).
    const grazingAngle = Math.asin(radius / distance);
    const ndcEdge = Math.tan(grazingAngle) / ((rect.width / rect.height) * Math.tan((50 * Math.PI) / 360));
    const expectedEdgePx = ((ndcEdge + 1) / 2) * rect.width;

    // Gdzie sylwetka JEST według `pointedCell` — bisekcja między środkiem (trafia)
    // a prawą krawędzią kadru (mija).
    let inside = rect.width / 2;
    let outside = rect.width;
    expect(pick(inside)).not.toBeNull();
    expect(pick(outside)).toBeNull();
    for (let i = 0; i < 60; i++) {
      const mid = (inside + outside) / 2;
      if (pick(mid) === null) outside = mid;
      else inside = mid;
    }

    expect(inside).toBeCloseTo(expectedEdgePx, 6);
    // Para przy samej granicy, wyrażona tak, jak ją widzi gracz: pół piksela w środku
    // i pół piksela na zewnątrz. Sylwetka planety przy tym oddaleniu ma 638 px średnicy,
    // więc pół piksela to 0,08 % promienia — granica, nie „gdzieś w okolicy".
    expect(pick(expectedEdgePx - 0.5)).not.toBeNull();
    expect(pick(expectedEdgePx + 0.5)).toBeNull();
  });
});

describe('niezmiennik: klient NIE mutuje stanu symulacji', () => {
  it('10. [NIEZMIENNIK] obsługa wejścia nie zmienia SimState — zmienia go dopiero step()', () => {
    const sim = new Sim(createPlanet({ seed: 1 }), { ...DEFAULT_RUN, startingOre: 150 });
    const before = stateHash(sim.state);
    sim.enqueue({ kind: 'BUILD', cellId: freeHexagonNear(sim.state), type: 'BARRICADE' });
    expect(stateHash(sim.state)).toBe(before); // kolejka NIE jest stanem
    sim.step();
    expect(stateHash(sim.state)).not.toBe(before);
  });

  it('11. [NIEZMIENNIK] cała ścieżka wejścia — wskazanie, zamiar, powód odmowy, wybór — zostawia hasz stanu nietknięty', () => {
    const sim = new Sim(planet, DEFAULT_RUN);
    const rect = { left: 11, top: 13, width: 800, height: 600 };
    const canvas = createFakeCanvas(rect.width, rect.height, rect);
    const camera = makeCamera(canvas);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();

    const rand = mulberry32(0x2c0210);
    const selection = createSelection();
    const before = stateHash(sim.state);
    let intents = 0;
    let refusals = 0;
    for (let i = 0; i < 400; i++) {
      placeCamera(camera, rand);
      const clientX = rect.left + rand() * rect.width;
      const clientY = rect.top + rand() * rect.height;
      selection.pointAt(pointedCell(planet, camera, canvas, clientX, clientY));
      const button = rand() < 0.5 ? 'LEFT' : 'RIGHT';
      const intent = intentFromPointer(
        planet,
        camera,
        canvas,
        { clientX, clientY, button },
        selection.selectedType,
      );
      if (intent === null) continue;
      intents++;
      if (refusalReason(sim.state, intent) !== null) refusals++;
    }

    // Próbka ma naprawdę przejść przez obie gałęzie — inaczej „hasz się nie zmienił"
    // byłoby prawdą o pętli, która nic nie zrobiła.
    expect(intents).toBeGreaterThan(100);
    expect(refusals).toBeGreaterThan(10);
    expect(stateHash(sim.state)).toBe(before);
  });

  it('12. [NIEZMIENNIK] KAŻDY nasłuch zostawia świat nietknięty — nie tylko ścieżka kliknięcia', () => {
    // Runda 1 miała tu SKAN ŹRÓDŁA. Został skasowany w całości: padał na jednej parze
    // zbędnych nawiasów (`(sim.state).ore = 999`), na `sim['state']` i na zapisie przez
    // parametr pomocnika, a poszerzanie wyrażenia rozpoznającego kształt to wyścig bez
    // mety. Zamiast tego własność — mierzona tam, gdzie test WYKONUJE kod.
    //
    // I mierzona na WSZYSTKICH nasłuchach, nie na jednym: w rundzie 1 hasz sprawdzała
    // wyłącznie ścieżka `pointerdown`→`pointerup`, więc zapis wstawiony do `onPointerMove`
    // albo `onContextMenu` przechodził 24/24.
    const w = makeWiring();
    const target = freeHexagonNear(w.sim.state);
    aimAt(w.camera, target);
    const before = worldFingerprint(w.sim.state);

    const pointer = { clientX: CENTER_X, clientY: CENTER_Y, button: 0 };
    const key = (code: string, shiftKey = false): unknown => ({
      code, key: '', shiftKey, preventDefault: () => {},
    });
    const paths: [string, () => number][] = [
      ['pointermove', () => fireOn(w.canvas, 'pointermove', pointer)],
      ['pointerdown', () => fireOn(w.canvas, 'pointerdown', pointer)],
      ['pointerup', () => fireOn(w.canvas, 'pointerup', pointer)],
      ['pointerup (prawy)', () => fireOn(w.canvas, 'pointerup', { ...pointer, button: 2 })],
      ['contextmenu', () => fireOn(w.canvas, 'contextmenu', key('') as never)],
      ['keydown Space', () => fireOn(w.keys, 'keydown', key('Space'))],
      ['keydown Digit6', () => fireOn(w.keys, 'keydown', key('Digit6'))],
      ['keydown Shift+Digit2', () => fireOn(w.keys, 'keydown', key('Digit2', true))],
      ['refreshPointedCell', () => (w.handle.refreshPointedCell(), 1)],
    ];
    for (const [name, fire] of paths) {
      expect({ name, listeners: fire() }).toEqual({ name, listeners: expect.any(Number) });
      expect({ name, world: worldFingerprint(w.sim.state) }).toEqual({ name, world: before });
    }
    // Kontrola pozytywna na sam przyrząd: odcisk NAPRAWDĘ reaguje na zmianę świata —
    // inaczej dziewięć zielonych porównań wyżej nie znaczyłoby nic.
    w.sim.step();
    expect(worldFingerprint(w.sim.state)).not.toBe(before);
  });

  it('13. [NIEZMIENNIK] odcisk świata obejmuje PLANETĘ, nie tylko SimState', () => {
    // `global-constraints.md` wymienia `Planet` z nazwy („Render NIGDY nie mutuje SimState
    // ani Planet"), a `stateHash` planety nie dotyka w ogóle — zmierzone w przeglądzie:
    // `planet.cells[0].center.x += 1e-9` w nasłuchu zostawiało 24/24 zielone.
    const sim = new Sim(planet, DEFAULT_RUN);
    const before = worldFingerprint(sim.state);
    const cell = planet.cells[0].center;
    const originalX = cell.x;
    try {
      // Zaburzenie o jeden ULP w skali promienia — mniej niż tysięczna piksela na ekranie.
      (cell as { x: number }).x = originalX + 1e-9;
      expect(worldFingerprint(sim.state)).not.toBe(before);
    } finally {
      (cell as { x: number }).x = originalX;
    }
    expect(worldFingerprint(sim.state)).toBe(before);
  });
});

describe('stan wyboru i skrót „wróć do Core"', () => {
  it('14. [SKRÓT] po powrocie do Core komórka startowa leży dokładnie pod środkiem kadru — z 200 losowych ustawień kamery', () => {
    const rect = { left: 0, top: 0, width: 1280, height: 720 };
    const canvas = createFakeCanvas(rect.width, rect.height, rect);
    const camera = makeCamera(canvas);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();

    const core = focusCoreTarget(planet);
    // `toEqual`, nie `toBe`: kontraktem jest WARTOŚĆ (środek komórki startowej), nie to,
    // że zwracany jest ten sam obiekt. Porównanie referencji byłoby tu mocniejsze tylko
    // pozornie — za to przepuszczałoby każdy błąd geometryczny bez śladu, bo test 13
    // przestałby wtedy mierzyć cokolwiek poza tożsamością wskaźnika (zmierzone: pod
    // `toBe` mutacja obracająca cel o 0,0° — czyli NIC nie zmieniająca — oblewała tak
    // samo jak obrót o 3°, więc para mutacji nie dałaby się w ogóle postawić).
    expect(core).toEqual(planet.cells[planet.startCell].center);

    const rand = mulberry32(0x2c0212);
    for (let i = 0; i < 200; i++) {
      placeCamera(camera, rand);
      const destination = focusPosition(camera.position, core, radius);
      camera.position.set(destination.x, destination.y, destination.z);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      expect(pointedCell(planet, camera, canvas, rect.width / 2, rect.height / 2)).toBe(planet.startCell);
    }
  });

  it('15. wybór jest stanem WEJŚCIA: dwie instancje nie dzielą pamięci, a zwracana flaga mówi o faktycznej zmianie', () => {
    const a = createSelection();
    const b = createSelection('LASER_TURRET');

    expect(a.selectedCell).toBeNull();
    expect(a.selectedType).toBe('BARRICADE');
    expect(b.selectedType).toBe('LASER_TURRET');

    expect(a.pointAt(42)).toBe(true);
    expect(a.pointAt(42)).toBe(false); // ruch myszy WEWNĄTRZ tej samej komórki
    expect(a.pointAt(null)).toBe(true); // zjechanie z planety to zmiana
    expect(a.pointAt(null)).toBe(false);
    expect(a.chooseType('PYLON')).toBe(true);
    expect(a.chooseType('PYLON')).toBe(false);

    // Gdyby wybór mieszkał w zmiennych modułowych, `b` widziałoby zmiany zrobione na `a`
    // — i kolejność wykonania testów zaczęłaby decydować o wyniku.
    expect(b.selectedCell).toBeNull();
    expect(b.selectedType).toBe('LASER_TURRET');
  });

  it('16. [PRÓG] luz kliknięcia wisi między dwoma faktami W PIKSELACH, nie między sobą a sobą', () => {
    // Pierwsza wersja tego testu budowała parę graniczną ZE STAŁEJ, którą testuje
    // (`100 + CLICK_SLOP_PX`), więc mierzyła operator `<=` w `isClick`, a nie wartość 4:
    // luz 0,25 px — czyli „gra nie buduje NIKOMU" — przechodził 17/17. Teraz obie granice
    // są absolutne i całkowite, przez co `(100 + c) − 100 ≠ c` nie ma jak podstawić
    // artefaktu zaokrąglenia w miejsce prawdziwego progu.
    //
    // OD DOŁU: drgnienie ręki przy klikaniu sięga ~2-3 px — kliknięcie, które przejechało
    // 3 px, ma dalej być kliknięciem (luz 2 px oblewa, luz 3 px przechodzi).
    expect(isClick(0, 0, 0, 0)).toBe(true);
    expect(isClick(0, 0, 3, 0)).toBe(true);
    expect(isClick(0, 0, 0, -3)).toBe(true);
    // OD GÓRY: krok kraty to 34,2 px przy domyślnym oddaleniu, więc przeciągnięcie o 10 px
    // ma już BYĆ obrotem kamery (luz 9 px przechodzi, luz 10 px oblewa).
    expect(isClick(0, 0, 10, 0)).toBe(false);
    expect(isClick(0, 0, 0, 10)).toBe(false);
    // KSZTAŁT: kryterium jest ODLEGŁOŚCIĄ, nie największą składową ani sumą osi —
    // przekątna 7/7 to 9,9 px, czyli przeciągnięcie, mimo że żadna oś nie sięga 10.
    expect(isClick(0, 0, 7, 7)).toBe(false);
    // I OSOBNO, jawnie: granica jest WŁĄCZNA. Ta jedna asercja jest z natury
    // samozwrotna (odnosi się do stałej), więc nie zastępuje dwóch granic wyżej —
    // pilnuje wyłącznie tego, żeby `<=` nie zmieniło się w `<`.
    expect(isClick(0, 0, CLICK_SLOP_PX, 0)).toBe(true);
  });

  it('17. lista typów do budowania jest związana z bramką symulacji, nie z ręczną kopią', () => {
    const offered = playerBuildableTypes();
    const sim = new Sim(planet, DEFAULT_RUN);
    const free = freeHexagonNear(sim.state);

    expect(offered).not.toContain('CORE');
    expect(offered.length).toBe(Object.keys(BUILDINGS).length - 1);
    // Wiązanie z `canBuild`, a nie z `BUILDINGS[t].playerBuildable`: to drugie byłoby
    // przepisaniem definicji, z której lista powstała. Tu sprawdzane jest, że symulacja
    // faktycznie NIE odrzuca oferowanego typu z powodu `NOT_PLAYER_BUILDABLE` — i że
    // odrzuca jedyny typ, którego lista nie oferuje.
    for (const type of offered) {
      expect(canBuild(sim.state, free, type)).not.toEqual({ ok: false, reason: 'NOT_PLAYER_BUILDABLE' });
    }
    expect(canBuild(sim.state, free, 'CORE')).toEqual({ ok: false, reason: 'NOT_PLAYER_BUILDABLE' });
  });

  it('18. powód odmowy zgadza się z tym, co symulacja NAPRAWDĘ robi z komendą', () => {
    const sim = new Sim(planet, DEFAULT_RUN);
    const free = freeHexagonNear(sim.state);

    // Przypadek przyjęty: brak powodu ⇒ komenda coś zmienia.
    const accepted = { kind: 'BUILD', cellId: free, type: 'BARRICADE' } as const;
    expect(refusalReason(sim.state, accepted)).toBeNull();
    const beforeAccepted = stateHash(sim.state);
    sim.enqueue(accepted);
    sim.step();
    expect(stateHash(sim.state)).not.toBe(beforeAccepted);
    expect(sim.state.buildings[free]?.type).toBe('BARRICADE');

    // Trzy przypadki odrzucone. Dla każdego: powód jest podany I komenda naprawdę nic nie
    // robi (poza tym, co tick zmieniłby sam z siebie — stąd porównanie ZABUDOWY, a nie
    // hasza całego stanu, w którym tyka zegar, ruda i fale).
    //
    // `CORE` stawiany na INNEJ, jeszcze wolnej komórce niż zajęta wyżej: `canBuild`
    // sprawdza `CELL_OCCUPIED` PRZED `playerBuildable`, więc na zajętej komórce wyszedłby
    // powód prawdziwy, ale nie ten, o który tu chodzi — a test przepuściłby implementację,
    // która o `NOT_PLAYER_BUILDABLE` w ogóle nie wie.
    const stillFree = freeHexagonNear(sim.state);
    expect(stillFree).not.toBe(free);
    const refusals = [
      { intent: { kind: 'BUILD', cellId: free, type: 'BARRICADE' } as const, reason: 'CELL_OCCUPIED' },
      { intent: { kind: 'BUILD', cellId: stillFree, type: 'CORE' } as const, reason: 'NOT_PLAYER_BUILDABLE' },
      { intent: { kind: 'DEMOLISH', cellId: planet.startCell } as const, reason: 'CORE_INDESTRUCTIBLE' },
    ];
    for (const { intent, reason } of refusals) {
      expect(refusalReason(sim.state, intent)).toBe(reason);
      const buildingsBefore = sim.state.buildings.map((b) => (b === null ? null : `${b.type}`)).join(',');
      sim.enqueue(intent);
      sim.step();
      expect(sim.state.buildings.map((b) => (b === null ? null : `${b.type}`)).join(',')).toBe(buildingsBefore);
    }

    // Czwarty powód, którego `canBuild` nie zna, bo dotyczy rozbiórki pustej komórki:
    // `applyCommand` wychodzi z niej po cichu, więc bez tej gałęzi gracz nie miałby jak
    // odróżnić „nie ma czego burzyć" od zepsutego przycisku.
    const empty = freeHexagonNear(sim.state);
    expect(refusalReason(sim.state, { kind: 'DEMOLISH', cellId: empty })).toBe('NOTHING_TO_DEMOLISH');
    // Granica sprawdzana z OBU stron, nie tylko `-1`: podniesienie jej o 1000 zostawiało
    // 24/24 zielone, bo test dotykał wyłącznie dolnego końca. `planet.cells.length` to
    // pierwszy indeks POZA planetą — ta sama granica, którą stosuje `isCellId`.
    expect(refusalReason(sim.state, { kind: 'DEMOLISH', cellId: -1 })).toBe('NO_SUCH_CELL');
    expect(refusalReason(sim.state, { kind: 'DEMOLISH', cellId: planet.cells.length })).toBe('NO_SUCH_CELL');
    expect(refusalReason(sim.state, { kind: 'DEMOLISH', cellId: planet.cells.length - 1 })).not.toBe('NO_SUCH_CELL');
    expect(refusalReason(sim.state, { kind: 'BUILD', cellId: planet.cells.length, type: 'BARRICADE' })).toBe('NO_SUCH_CELL');
  });
});

// =========================================================================================
// Spięcie wejścia — WŁAŚCIWY strażnik ograniczenia nadrzędnego (runda naprawcza 1)
//
// Do tej rundy treść nasłuchów siedziała w `main.ts`, którego nie da się zaimportować
// w teście (DOM na poziomie modułu). Skutek zmierzony w przeglądzie: usunięcie jedynej
// linii `sim.enqueue(intent)` zostawiało 623/623 zielone, a cztery z pięciu dróg obejścia
// zakazu mutowania stanu przechodziły 17/17. Teraz cała droga od ZDARZENIA do KOLEJKI
// mieszka w `attachInput`, a poniższe testy mierzą obie połowy jako WŁASNOŚĆ:
//   • negatywną — `stateHash` przed obsługą zdarzenia i po niej musi być identyczny,
//   • pozytywną — po `sim.step()` świat musi się zmienić dokładnie tak, jak zapowiadała
//     komenda (tego żadna asercja o niemutowaniu złapać nie może).
// =========================================================================================

interface Wiring {
  camera: RayCamera;
  canvas: HTMLCanvasElement;
  keys: ReturnType<typeof createFakeEventTarget>;
  sim: Sim;
  selection: ReturnType<typeof createSelection>;
  messages: Report[];
  focused: Vec3[];
  shading: string[];
  handle: ReturnType<typeof attachInput>;
  rect: { left: number; top: number; width: number; height: number };
}

const CANVAS_RECT = { left: 0, top: 0, width: 800, height: 600 };

function makeWiring(): Wiring {
  // JEDNO płótno — to samo, do którego podpięte są `OrbitControls`, dokładnie jak
  // w przeglądarce. Runda 1 używała dwóch, więc współistnienie obu zestawów nasłuchów
  // było ZAŁOŻONE, nie zmierzone: `fireOn` wywołuje wszystkie nasłuchy danego typu, więc
  // każde zdarzenie testu przechodzi teraz najpierw przez obsługę orbity. Atrapa dostała
  // w tej rundzie `setPointerCapture`/`releasePointerCapture`, bo tego (i tylko tego)
  // `OrbitControls` dokłada ponad pola, które zdarzenia testu już niosły.
  const canvas = createFakeCanvas(CANVAS_RECT.width, CANVAS_RECT.height, CANVAS_RECT);
  const camera = createCamera(canvas, radius).object;
  camera.aspect = CANVAS_RECT.width / CANVAS_RECT.height;
  camera.updateProjectionMatrix();
  const keys = createFakeEventTarget();
  const sim = new Sim(planet, DEFAULT_RUN);
  const selection = createSelection();
  const messages: Report[] = [];
  const focused: Vec3[] = [];
  const shading: string[] = [];
  const handle = attachInput({
    planet,
    camera,
    canvas,
    keys,
    sim,
    selection,
    focusOn: (target) => focused.push(target),
    report: (report) => messages.push(report),
    setUnitShading: (mode) => shading.push(mode),
  });
  return { camera, canvas, keys, sim, selection, messages, focused, shading, handle, rect: CANVAS_RECT };
}

/** Ustawia kamerę tak, żeby `cellId` wypadła DOKŁADNIE w środku kadru. */
function aimAt(camera: RayCamera, cellId: number): void {
  const c = planet.cells[cellId].center;
  const scale = (radius * 3) / Math.hypot(c.x, c.y, c.z);
  camera.position.set(c.x * scale, c.y * scale, c.z * scale);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
}

const CENTER_X = CANVAS_RECT.left + CANVAS_RECT.width / 2;
const CENTER_Y = CANVAS_RECT.top + CANVAS_RECT.height / 2;

/** Pełny gest: wciśnięcie i puszczenie. Zwraca, ilu nasłuchów faktycznie dotknęło. */
function gesture(
  w: Wiring,
  down: [number, number],
  up: [number, number],
  button = 0,
): number {
  const a = fireOn(w.canvas, 'pointerdown', { clientX: down[0], clientY: down[1], button });
  const b = fireOn(w.canvas, 'pointerup', { clientX: up[0], clientY: up[1], button });
  return Math.min(a, b);
}

function pressKey(w: Wiring, code: string, key = '', shiftKey = false): number {
  let prevented = 0;
  const fired = fireOn(w.keys, 'keydown', {
    code,
    key,
    shiftKey,
    preventDefault: () => {
      prevented++;
    },
  });
  expect(fired).toBeGreaterThan(0);
  return prevented;
}

describe('attachInput — cała droga od zdarzenia do kolejki', () => {
  it('19. [NIEZMIENNIK, OBIE POŁOWY] kliknięcie nie rusza stanu, a po step() świat zmienia się dokładnie tak, jak zapowiedziała komenda', () => {
    const w = makeWiring();
    const target = freeHexagonNear(w.sim.state);
    aimAt(w.camera, target);

    const before = stateHash(w.sim.state);
    // Nasłuch musi być NAPRAWDĘ podpięty — `fireOn` zwraca liczbę wykonanych nasłuchów,
    // więc „zdarzenie poszło w nikogo" jest osobnym, widocznym błędem, a nie cichą zielenią.
    expect(gesture(w, [CENTER_X, CENTER_Y], [CENTER_X, CENTER_Y])).toBeGreaterThan(0);

    // POŁOWA NEGATYWNA: obsługa zdarzenia nie ruszyła stanu ani o bit. Łapie KAŻDY zapis,
    // niezależnie od tego, jak zapisany — przez alias, destrukturyzację, `Object.assign`
    // czy mutację obiektu wyjętego ze stanu.
    expect(stateHash(w.sim.state)).toBe(before);
    expect(w.sim.state.buildings[target]).toBeNull(); // komenda leży w KOLEJCE, nie w świecie
    // Meldunek STRUKTURALNY, nie napis (Krok 0 Zadania 4): wiązany jest fakt, nie
    // interpunkcja. Zdanie dla gracza składa jedno miejsce — `reportMessage` w `hud.ts` —
    // i to samo, z którego bierze zdania panel; pilnuje tego test 22 w `hud.test.ts`.
    expect(w.messages.at(-1)).toEqual({
      kind: 'QUEUED',
      intent: { kind: 'BUILD', cellId: target, type: 'BARRICADE' },
    });

    // POŁOWA POZYTYWNA: komenda naprawdę dotarła. Bez `enqueue` stan po `step()` byłby
    // taki, jakby gracz nie kliknął — a żadna asercja o niemutowaniu tego nie widzi.
    w.sim.step();
    expect(w.sim.state.buildings[target]?.type).toBe('BARRICADE');
    expect(stateHash(w.sim.state)).not.toBe(before);
  });

  it('20. [PRÓG, W PIKSELACH] drgnienie ręki o 3 px to wciąż kliknięcie, przeciągnięcie o 10 px to już obrót kamery', () => {
    // Oba progi wyrażone w PIKSELACH, nie przez `CLICK_SLOP_PX` — para zbudowana ze stałej,
    // którą testuje, mierzyła granicę `<=` w `isClick`, a nie wartość 4: luz 0,25 px
    // (czyli „gra nie buduje nikomu") przechodził 17/17. Liczby całkowite, żeby
    // `(100 + c) − 100` nie wprowadzało artefaktu zaokrąglenia zamiast prawdziwego progu.
    const drift = (dx: number, dy: number): boolean => {
      const w = makeWiring();
      const target = freeHexagonNear(w.sim.state);
      aimAt(w.camera, target);
      gesture(w, [CENTER_X, CENTER_Y], [CENTER_X + dx, CENTER_Y + dy]);
      w.sim.step();
      return w.sim.state.buildings[target] !== null;
    };

    expect(drift(0, 0)).toBe(true); // nieruchome kliknięcie
    expect(drift(3, 0)).toBe(true); // drgnienie ręki — dolna granica luzu
    expect(drift(0, -3)).toBe(true); // po drugiej osi i w drugą stronę
    expect(drift(10, 0)).toBe(false); // obrót kamery — górna granica
    expect(drift(7, 7)).toBe(false); // przekątna: kryterium jest ODLEGŁOŚCIĄ, nie sumą osi
    expect(isClick(0, 0, 3, 0)).toBe(true);
    expect(isClick(0, 0, 10, 0)).toBe(false);
  });

  it('21. prawy przycisk rozbiera tę samą komórkę, którą lewy zabudował — przez te same nasłuchy', () => {
    const w = makeWiring();
    const target = freeHexagonNear(w.sim.state);
    aimAt(w.camera, target);

    gesture(w, [CENTER_X, CENTER_Y], [CENTER_X, CENTER_Y], 0);
    w.sim.step();
    expect(w.sim.state.buildings[target]?.type).toBe('BARRICADE');

    const hashBeforeDemolish = stateHash(w.sim.state);
    expect(gesture(w, [CENTER_X, CENTER_Y], [CENTER_X, CENTER_Y], 2)).toBeGreaterThan(0);
    expect(stateHash(w.sim.state)).toBe(hashBeforeDemolish); // dalej: kolejka, nie stan
    w.sim.step();
    expect(w.sim.state.buildings[target]).toBeNull();
    expect(w.messages.at(-1)).toEqual({ kind: 'QUEUED', intent: { kind: 'DEMOLISH', cellId: target } });

    // Kliknięcie POZA sylwetką planety: żadnej komendy, ale komunikat jest — inaczej
    // gracz nie odróżnia „chybiłem" od „sterowanie nie działa". Gałąź nie była dotąd
    // wykonywana przez żaden test.
    const worldBefore = worldFingerprint(w.sim.state);
    gesture(w, [CANVAS_RECT.left + 3, CANVAS_RECT.top + 3], [CANVAS_RECT.left + 3, CANVAS_RECT.top + 3], 0);
    expect(w.messages.at(-1)).toEqual({ kind: 'MISSED' });
    w.sim.step();
    expect(worldFingerprint(w.sim.state)).not.toBe(worldBefore); // tick sam z siebie tyka
    expect(w.sim.state.buildings.filter((b) => b !== null).length).toBe(1); // …ale nic nie przybyło

    // Rozbiórka CORE jest odmawiana z podanym powodem, a świat zostaje nietknięty.
    aimAt(w.camera, planet.startCell);
    gesture(w, [CENTER_X, CENTER_Y], [CENTER_X, CENTER_Y], 2);
    w.sim.step();
    expect(w.sim.state.buildings[planet.startCell]?.type).toBe('CORE');
    expect(w.messages.at(-1)).toEqual({
      kind: 'REFUSED',
      intent: { kind: 'DEMOLISH', cellId: planet.startCell },
      reason: 'CORE_INDESTRUCTIBLE',
    });
  });

  it('22. klawiatura: spacja woła powrót do Core, cyfry wybierają typ, Shift+cyfra przełącza cieniowanie', () => {
    const w = makeWiring();

    expect(pressKey(w, 'Space')).toBe(1); // `preventDefault` — spacja nie przewija strony
    expect(w.focused).toEqual([planet.cells[planet.startCell].center]);
    expect(w.messages.at(-1)).toEqual({ kind: 'FOCUS_CORE', cellId: planet.startCell });

    expect(pressKey(w, 'Digit6')).toBe(1);
    expect(w.selection.selectedType).toBe('KINETIC_TURRET');

    expect(pressKey(w, 'Digit2', '', true)).toBe(1);
    expect(w.shading).toEqual(['threshold']);
    expect(w.selection.selectedType).toBe('KINETIC_TURRET'); // Shift NIE zmienia typu

    // Zapasowy odczyt z `key`, gdy `code` jest pusty — zmierzone przy zdalnym sterowaniu
    // przeglądarką, zgłaszane też przez zdalne pulpity i część metod wprowadzania.
    expect(pressKey(w, '', '1')).toBe(1);
    expect(w.selection.selectedType).toBe('BARRICADE');
    expect(pressKey(w, '', ' ')).toBe(1);
    expect(w.focused.length).toBe(2);

    // Klawisz spoza mapy nie robi nic i nie połyka zdarzenia.
    expect(pressKey(w, 'KeyQ', 'q')).toBe(0);
  });

  it('23. [ŚWIEŻOŚĆ] wskazana komórka nadąża za kamerą dojeżdżającą bezwładnością, nie tylko za kursorem', () => {
    // Defekt z przeglądu, zmierzony na ekranie: HUD pokazywał 874, kliknięcie w TEN SAM
    // piksel budowało na 885, bo wybór przeliczał się wyłącznie na `pointermove`, a
    // `OrbitControls` (DAMPING_FACTOR 0,08) rusza kamerą jeszcze ~1 s po zatrzymaniu myszy.
    const w = makeWiring();
    const first = freeHexagonNear(w.sim.state);
    aimAt(w.camera, first);
    expect(fireOn(w.canvas, 'pointermove', { clientX: CENTER_X, clientY: CENTER_Y, button: -1 })).toBeGreaterThan(0);

    expect(w.handle.refreshPointedCell()).toBe(true);
    expect(w.selection.selectedCell).toBe(first);
    // Nic się nie ruszyło — przeliczenie ma wyjść bez pracy (i bez alokacji w pętli renderu).
    expect(w.handle.refreshPointedCell()).toBe(false);

    // Kamera jedzie dalej BEZ ani jednego zdarzenia kursora: dokładnie to robi bezwładność.
    let moved: number | null = null;
    for (let i = 0; i < planet.cells.length && moved === null; i++) {
      const candidate = planet.cells[first].neighbors[0];
      aimAt(w.camera, candidate);
      moved = candidate;
    }
    expect(moved).not.toBe(first);
    expect(w.handle.refreshPointedCell()).toBe(true);
    expect(w.selection.selectedCell).toBe(moved);

    // …i to, co pokazuje wybór, jest tym, co postawi kliknięcie w TEN SAM piksel.
    const shown = w.selection.selectedCell;
    gesture(w, [CENTER_X, CENTER_Y], [CENTER_X, CENTER_Y]);
    w.sim.step();
    expect(w.sim.state.buildings[shown as number]).not.toBeNull();
  });

  it('24. detach() odpina wszystkie nasłuchy — po nim kliknięcie nie kolejkuje niczego', () => {
    const w = makeWiring();
    const target = freeHexagonNear(w.sim.state);
    aimAt(w.camera, target);
    w.handle.detach();

    expect(gesture(w, [CENTER_X, CENTER_Y], [CENTER_X, CENTER_Y])).toBe(0);
    w.sim.step();
    expect(w.sim.state.buildings[target]).toBeNull();
  });

  it('25. kolejność typów budowania jest kontraktem skrótów 1-9, nie luźnym opisem', () => {
    const offered = playerBuildableTypes();
    // Kolejność deklaracji w `defs.ts` JEST mapowaniem klawiszy — `.reverse()` w liście
    // po cichu przemapowałby wszystkie dziewięć skrótów. Porównanie z `Object.keys` nie
    // jest tautologią: wiąże obietnicę z doc-commentu z INNYM plikiem (`defs.ts`), który
    // to zamówienie realizuje, a nie z tą samą funkcją.
    // WŁASNOŚĆ kolejności, nie przepisana treść funkcji: indeksy oferowanych typów
    // w `BUILDINGS` mają rosnąć ściśle monotonicznie. `.reverse()` to łamie, a asercja nie
    // powtarza `filter(playerBuildable)`, więc nie jest porównaniem funkcji z samą sobą.
    const declaration = Object.keys(BUILDINGS) as BuildingType[];
    const positions = offered.map((t) => declaration.indexOf(t));
    expect(positions.every((v, i) => i === 0 || v > positions[i - 1])).toBe(true);
    expect(positions.every((v) => v >= 0)).toBe(true); // każdy oferowany typ NAPRAWDĘ istnieje
    expect(offered[0]).toBe('BARRICADE'); // pierwszy klawisz = najtańszy budynek startowy
    // Dziesiąty typ byłby nieosiągalny z klawiatury (`Digit1`–`Digit9`) i nikt by tego
    // nie zauważył, bo lista sama by się rozrosła.
    expect(offered.length).toBeLessThanOrEqual(9);
  });
});

// =========================================================================================
// Spięcie aplikacji (`wireClient`) — runda naprawcza 2
//
// Runda 1 wyniosła z `main.ts` treść NASŁUCHÓW, ale zostało tam SPIĘCIE i wróciły w nim te
// same dziury piętro wyżej. Zmierzone w przeglądzie, każda przy 631/631 zielonych:
// `focusOn: () => {}` (kasuje spację), `keys: canvas` (kasuje CAŁĄ klawiaturę),
// `setUnitShading` bez wywołania sceny, usunięcie `input.refreshPointedCell()` (cofa
// naprawę świeżości z tej samej rundy). Teraz spięcie jest w `wireClient`, więc wszystkie
// cztery są wykonywane przez test.
// =========================================================================================

interface FakeScene extends ClientScene {
  readonly rendered: number[];
  readonly shading: UnitShadingMode[];
}

function makeClientRig(): {
  client: Client;
  camera: RayCamera;
  orbit: OrbitCamera;
  canvas: HTMLCanvasElement;
  keys: ReturnType<typeof createFakeEventTarget>;
  sim: Sim;
  scene: FakeScene;
  advance(ms: number): void;
} {
  const canvas = createFakeCanvas(CANVAS_RECT.width, CANVAS_RECT.height, CANVAS_RECT);
  // PRAWDZIWA kamera z `createCamera` — razem z prawdziwym `focusOn`. Wyprowadzenie
  // `focusOn` ze sceny wewnątrz `wireClient` jest połową naprawy; drugą połową jest to,
  // że test sprawdza SKUTEK na tej kamerze, a nie fakt wywołania atrapy.
  const orbit = createCamera(createFakeCanvas(), radius);
  const camera = orbit.object;
  camera.aspect = CANVAS_RECT.width / CANVAS_RECT.height;
  camera.updateProjectionMatrix();
  const keys = createFakeEventTarget();
  const rendered: number[] = [];
  const shading: UnitShadingMode[] = [];
  const scene: FakeScene = {
    camera: orbit,
    rendered,
    shading,
    updateBuildings: () => {},
    updateUnits: () => {},
    setUnitShading: (mode) => shading.push(mode),
    render: () => rendered.push(rendered.length),
  };
  let clock = 0;
  // `Sim` budowany z PLANETY, którą stworzył `wireClient` — nie z modułowej `planet`
  // o tym samym seedzie. Wartości są identyczne, ale OBIEKTY różne, a `worldFingerprint`
  // czyta planetę przez `state.planet`: na dwóch instancjach mutacja planety wewnątrz
  // `frame()` byłaby niewidoczna (zmierzone — przechodziła 29/29).
  let sim!: Sim;
  const client = wireClient({
    // Ten sam seed, co produkcja — to, co mierzy test, jest tą samą planetą, którą
    // widzi gracz.
    seed: 20260915,
    makeScene: () => scene,
    makeSim: (wiredPlanet, run) => {
      sim = new Sim(wiredPlanet, run);
      return sim;
    },
    canvas,
    keys,
    // Panel zasobów i budowy (Zadanie 3) — atrapa elementu z `fakeCanvas.ts`. Rig tego pliku
    // go nie bada (ma własny plik, `hud.test.ts`), ale `wireClient` bez niego się nie spina,
    // i tak ma być: HUD opcjonalny znaczyłby, że usunięcie go z rozruchu jest niewidoczne.
    hudRoot: createFakeElement(),
    run: DEFAULT_RUN,
    now: () => clock,
    log: () => {},
  });
  return {
    client, camera, orbit, canvas, keys, sim, scene,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('wireClient — spięcie aplikacji, bez rozruchu DOM', () => {
  it('26. [ŚWIEŻOŚĆ] klatka przelicza wskazanie z ostatniego piksela, nawet gdy kursor stoi', () => {
    // N6 z przeglądu: usunięcie `input.refreshPointedCell()` ze spięcia zostawiało
    // 631/631 zielone i cofało naprawę świeżości z rundy 1 (HUD 874, budowa 885).
    const rig = makeClientRig();
    const first = freeHexagonNear(rig.sim.state);
    aimAt(rig.camera, first);
    fireOn(rig.canvas, 'pointermove', { clientX: CENTER_X, clientY: CENTER_Y, button: -1 });

    rig.advance(16);
    rig.client.frame();
    expect(rig.client.selection.selectedCell).toBe(first);

    // Kamera jedzie dalej BEZ zdarzenia kursora — dokładnie to robi bezwładność orbity.
    const next = planet.cells[first].neighbors[0];
    aimAt(rig.camera, next);
    rig.advance(16);
    rig.client.frame();
    expect(rig.client.selection.selectedCell).toBe(next);
    expect(rig.scene.rendered.length).toBe(2); // klatka NAPRAWDĘ się wykonała
  });

  it('27. [SKRÓT] spacja rusza PRAWDZIWĄ kamerą, a Shift+cyfra dociera do sceny', () => {
    // M1 i M2 z przeglądu: `focusOn: () => {}` i `setUnitShading` bez wywołania sceny
    // zostawiały 631/631 zielone. Oba wywołania zwrotne są teraz wyprowadzane ze `scene`
    // wewnątrz `wireClient`, więc nie da się ich podstawić — a test mierzy SKUTEK.
    const rig = makeClientRig();
    const far = planet.cells[planet.startCell].neighbors[2];
    aimAt(rig.camera, far);
    const before = { x: rig.camera.position.x, y: rig.camera.position.y, z: rig.camera.position.z };

    fireOn(rig.keys, 'keydown', { code: 'Space', key: '', shiftKey: false, preventDefault: () => {} });

    const moved = Math.hypot(
      rig.camera.position.x - before.x,
      rig.camera.position.y - before.y,
      rig.camera.position.z - before.z,
    );
    expect(moved).toBeGreaterThan(radius * 0.01);
    // …i to nie jest dowolny ruch: po skrócie komórka startowa leży pod środkiem kadru.
    rig.advance(16);
    rig.client.frame();
    fireOn(rig.canvas, 'pointermove', { clientX: CENTER_X, clientY: CENTER_Y, button: -1 });
    rig.advance(16);
    rig.client.frame();
    expect(rig.client.selection.selectedCell).toBe(planet.startCell);

    fireOn(rig.keys, 'keydown', { code: 'Digit3', key: '', shiftKey: true, preventDefault: () => {} });
    expect(rig.scene.shading).toEqual(['smooth']);
  });

  it('28. klatka nie mutuje świata — zmienia go wyłącznie sim.step() wewnątrz niej', () => {
    const rig = makeClientRig();
    const before = worldFingerprint(rig.sim.state);
    // Klatka KRÓTSZA niż tick: akumulator nie uzbiera się na krok, więc świat ma zostać
    // nietknięty mimo pełnego przebiegu renderu, oświetlenia i wskazania.
    rig.advance(10);
    rig.client.frame();
    // Odcisk obejmuje PLANETĘ klienta, nie tylko `SimState` — i to planetę, którą
    // `wireClient` zbudował sam (patrz `makeClientRig`), nie modułową kopię.
    expect(worldFingerprint(rig.sim.state)).toBe(before);
    expect(rig.scene.rendered.length).toBe(1);

    // Klatka DŁUŻSZA niż tick: świat zmienia się, ale wyłącznie przez `step()`.
    rig.advance(200);
    rig.client.frame();
    expect(worldFingerprint(rig.sim.state)).not.toBe(before);
  });

  it('30. [NIEZMIENNIK] samo SPIĘCIE nie rusza świata — odcisk brany PRZED wireClient', () => {
    // LUKA ZNALEZIONA W RUNDZIE 3, i jest nią MIEJSCE, nie droga: test 28 bierze odcisk
    // świata PO powrocie z `wireClient`, więc zapis wykonany w czasie spięcia jest już
    // w linii bazowej. Zmierzone: `(sim.state).ore = 999;` wstawione zaraz po
    // `deps.makeSim(...)` przechodziło 29/29, choć ta sama linia w pętli klatki oblewa.
    //
    // Klient dosypujący sobie rudy przy starcie to dokładnie to oszustwo, przed którym
    // ograniczenie nadrzędne ma bronić w Fazie 5. Dlatego linia bazowa musi pochodzić
    // ze świata, który NIGDY nie dotknął spięcia.
    const SEED = 20260915;
    const reference = new Sim(createPlanet({ seed: SEED }), DEFAULT_RUN);
    const before = worldFingerprint(reference.state);

    // Kontrola pozytywna na sam przyrząd: odcisk NAPRAWDĘ rozróżnia światy — bez niej
    // „dwa odciski są równe" mogłoby znaczyć „odcisk jest stały", a nie „świat nietknięty".
    expect(worldFingerprint(new Sim(createPlanet({ seed: SEED + 1 }), DEFAULT_RUN).state)).not.toBe(before);

    // `makeClientRig` buduje symulację TĄ SAMĄ fabryką i tym samym seedem, wewnątrz
    // `wireClient` — i nie wykonuje ani jednej klatki ani zdarzenia.
    const rig = makeClientRig();
    expect(worldFingerprint(rig.sim.state)).toBe(before);
  });

  it('29. płótno podane jako źródło klawiatury jest GŁOŚNYM błędem rozruchu, nie cichą utratą sterowania', () => {
    // `keys: canvas` (zmierzone: 631/631 zielone) kasuje CAŁĄ klawiaturę, bo <canvas>
    // bez `tabindex` nigdy nie dostaje ogniskowej. Testem zachowania tego nie widać —
    // atrapa zdarzenia dostarcza — więc straż musi być przy rozruchu.
    const canvas = createFakeCanvas();
    const orbit = createCamera(createFakeCanvas(), radius);
    const scene: ClientScene = {
      camera: orbit,
      updateBuildings: () => {},
      updateUnits: () => {},
      setUnitShading: () => {},
      render: () => {},
    };
    const sim = new Sim(planet, DEFAULT_RUN);
    const deps = {
      seed: 20260915,
      makeScene: () => scene,
      makeSim: () => sim,
      canvas,
      hudRoot: createFakeElement(),
      run: DEFAULT_RUN, now: () => 0, log: () => {},
    };
    expect(() => wireClient({ ...deps, keys: canvas as unknown as ListenerTarget })).toThrow(RangeError);
    // …a poprawne źródło przechodzi — bez tej połowy straż mogłaby odrzucać wszystko.
    expect(() => wireClient({ ...deps, keys: createFakeEventTarget() })).not.toThrow();
  });

  /**
   * 30. **Słońce renderu musi być słońcem symulacji.**
   *
   * Od Zadania 3 Fazy 3 run zaczyna się o ŚWICIE komórki startowej, więc faza słońca ma
   * przesunięcie zależne od planety (`Sim.sunOffsetSeconds`). Dopóki render wołał
   * `sunDirection(t, period)` na własną rękę, dostawał fazę bez przesunięcia — i rysowałby
   * noc tam, gdzie symulacja liczy dzień. **Wrogowie płonący w cieniu to wynik
   * prawdopodobnie wyglądający, nie błąd**, więc nic by tego nie zgłosiło.
   *
   * Test łapie to przez SKUTEK, nie przez zaglądanie do wywołań: porównuje kierunek, który
   * dostała scena, z tym, który liczy symulacja — i osobno sprawdza, że naiwne wywołanie
   * dałoby INNĄ liczbę. Bez tej drugiej połowy test przechodziłby też na planecie, której
   * świt wypada w zerze, czyli tam, gdzie obie drogi się zgadzają przypadkiem.
   */
  it('30. słońce podane scenie jest słońcem SYMULACJI, nie własnym wywołaniem renderu', () => {
    const canvas = createFakeCanvas();
    const orbit = createCamera(createFakeCanvas(), radius);
    let sceneSun: Vec3 | null = null;
    const scene: ClientScene = {
      camera: orbit,
      updateBuildings: () => {},
      updateUnits: () => {},
      setUnitShading: () => {},
      render: (_light, sunDir) => {
        sceneSun = sunDir;
      },
    };
    let sim!: Sim;
    let clock = 0;
    const client = wireClient({
      seed: 20260915,
      makeScene: () => scene,
      makeSim: (wiredPlanet, run) => {
        sim = new Sim(wiredPlanet, run);
        return sim;
      },
      canvas,
      keys: createFakeEventTarget(),
      hudRoot: createFakeElement(),
      run: DEFAULT_RUN,
      now: () => clock,
      log: () => {},
    });

    clock = 1_000;
    client.frame();
    expect(sceneSun, 'scena musi dostać słońce w ogóle').not.toBeNull();

    const t = sim.elapsedSeconds;
    // PRZESŁANKA: ta planeta ma niezerowe przesunięcie świtu, więc obie drogi NIE mogą
    // dać tej samej liczby przypadkiem. Bez tego cały test byłby tautologią.
    expect(Math.abs(sim.sunOffsetSeconds) % DEFAULT_RUN.rotationPeriod).toBeGreaterThan(1);

    const zSymulacji = sim.sunAt(t);
    const naiwne = sunDirection(t, DEFAULT_RUN.rotationPeriod);
    expect(sceneSun!.x).toBeCloseTo(zSymulacji.x, 6);
    expect(sceneSun!.z).toBeCloseTo(zSymulacji.z, 6);
    // Połówka „ma oblać przy regresji": gdyby render wrócił do własnego `sunDirection`,
    // scena dostałaby TĘ liczbę.
    expect(Math.abs(sceneSun!.x - naiwne.x) + Math.abs(sceneSun!.z - naiwne.z)).toBeGreaterThan(0.01);
  });
});
