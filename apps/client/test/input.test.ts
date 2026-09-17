import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createScanner } from 'typescript/unstable/ast/scanner';
import { SyntaxKind } from 'typescript/unstable/ast';
import {
  BUILDINGS,
  canBuild,
  createPlanet,
  DEFAULT_RUN,
  Sim,
  stateHash,
  type BuildingType,
  type Planet,
  type Vec3,
} from '@heliopolis/sim';
import {
  createCamera,
  focusPosition,
  MAX_DISTANCE_FACTOR,
  MIN_DISTANCE_FACTOR,
} from '@heliopolis/render';
import {
  createFakeCanvas,
  createFakeEventTarget,
  fireOn,
} from '../../../packages/render/test/support/fakeCanvas.js';
import { mulberry32 } from '../../../packages/render/test/support/mulberry32.js';
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
  type RayCamera,
} from '../src/input.js';
import { freeHexagonNear } from './support/fixtures.js';

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

  it('12. [NIEZMIENNIK, ŹRÓDŁOWY] klient nie ma do symulacji innej drogi niż sim.enqueue', () => {
    // Test 10 dowodzi, że KOLEJKA nie jest stanem. Nie dowodzi — i nie może — że klient
    // korzysta z kolejki zamiast sięgnąć obok niej: zapis `sim.state.ore = 999` jest dla
    // niego niewidoczny, bo on w ogóle nie patrzy na klienta. To jest ograniczenie
    // nadrzędne Fazy 5 (autorytatywny serwer), więc pilnuje go strażnik STRUKTURALNY,
    // czytający źródło — ten sam idiom, co „kolejność wywołań systemów w źródle step()"
    // w `fullrun.test.ts` i skan importów w `contract.test.ts`.
    for (const file of ['../src/main.ts', '../src/input.ts']) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect({ file, writes: stateWrites(source) }).toEqual({ file, writes: [] });
      // `applyCommand` mutuje `SimState` wprost, z pominięciem kolejki. Symulacja woła go
      // sama w `step()`; klient, który by go zaimportował, obszedłby całe ograniczenie
      // jednym importem, nie zapisując ani razu do `.state`. Szukane w TOKENACH, nie
      // wyrażeniem regularnym po surowym tekście — inaczej wzmianka w komentarzu
      // (a taka w `main.ts` jest, przy uzasadnieniu, dlaczego klient nie jest bramkarzem)
      // podnosi fałszywy alarm, a próba obejścia go regexem prędzej czy później zagłuszy
      // alarm prawdziwy.
      expect({ file, applyCommand: codeIdentifiers(source).has('applyCommand') }).toEqual({
        file,
        applyCommand: false,
      });
    }
    // Kontrola pozytywna SAMEGO strażnika: gdyby nie potrafił rozpoznać zapisu, powyższe
    // przechodziłoby również dla klienta, który stan mutuje. Trzy kształty, w których to
    // realnie wygląda, plus odczyt, który ma zostać przepuszczony.
    // SZEŚĆ dróg obejścia zmierzonych w przeglądzie — pierwsza wersja tego strażnika
    // przepuszczała cztery z nich. Pierwsza pozycja jest najważniejsza: to DOKŁADNIE to,
    // co robi klient z predykcją w Fazie 5 (bierze obiekt ze stanu i go zmienia).
    expect(stateWrites('const b = sim.state.buildings[i]; b.hp = 1;')).toEqual(['b.hp']);
    expect(stateWrites('const { state } = sim; state.ore = 999;')).toEqual(['state.ore']);
    expect(stateWrites('Object.assign(sim.state, { ore: 999 });')).toEqual(['sim.state']);
    expect(stateWrites('++sim.state.ore;')).toEqual(['sim.state.ore']);
    expect(stateWrites('sim.state.ore++;')).toEqual(['sim.state.ore']);
    expect(stateWrites('sim.state.buildings[7] = null;')).toEqual(['sim.state.buildings[…]']);
    // …i trzy, które mają zostać przepuszczone: czysty odczyt, mutacja NIE przez stan,
    // oraz deklaracja nasłuchu, który stan tylko czyta w swoim ciele.
    expect(stateWrites('const ore = sim.state.ore; report(ore);')).toEqual([]);
    expect(stateWrites('const local = []; local.push(1);')).toEqual([]);
    expect(stateWrites('const onUp = (e) => { report(sim.state.ore); };')).toEqual([]);
    // …i ta sama kontrola dla drugiej połowy strażnika: komentarz i literał napisowy NIE
    // są kodem, wywołanie JEST.
    expect(codeIdentifiers('applyCommand(s, cmd);').has('applyCommand')).toBe(true);
    expect(codeIdentifiers('// applyCommand(s, cmd);\nconst x = 1;').has('applyCommand')).toBe(false);
    expect(codeIdentifiers('const s = "applyCommand";').has('applyCommand')).toBe(false);
  });
});

describe('stan wyboru i skrót „wróć do Core"', () => {
  it('13. [SKRÓT] po powrocie do Core komórka startowa leży dokładnie pod środkiem kadru — z 200 losowych ustawień kamery', () => {
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

  it('14. wybór jest stanem WEJŚCIA: dwie instancje nie dzielą pamięci, a zwracana flaga mówi o faktycznej zmianie', () => {
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

  it('15. [PRÓG] luz kliknięcia wisi między dwoma faktami W PIKSELACH, nie między sobą a sobą', () => {
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

  it('16. lista typów do budowania jest związana z bramką symulacji, nie z ręczną kopią', () => {
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

  it('17. powód odmowy zgadza się z tym, co symulacja NAPRAWDĘ robi z komendą', () => {
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
    expect(refusalReason(sim.state, { kind: 'DEMOLISH', cellId: -1 })).toBe('NO_SUCH_CELL');
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
  messages: string[];
  focused: Vec3[];
  shading: string[];
  handle: ReturnType<typeof attachInput>;
  rect: { left: number; top: number; width: number; height: number };
}

const CANVAS_RECT = { left: 0, top: 0, width: 800, height: 600 };

function makeWiring(): Wiring {
  // DWA osobne płótna. `OrbitControls` rejestruje własne nasłuchy wskaźnika, a `fireOn`
  // wywołuje WSZYSTKIE zarejestrowane dla danego typu — wystrzelenie w to samo płótno
  // uruchomiłoby też jego obsługę, która czyta pola `PointerEvent`, których ta atrapa
  // nie udaje (`pointerId`, `setPointerCapture`). W przeglądarce oba nasłuchy siedzą
  // na jednym elemencie i nie przeszkadzają sobie, bo żaden nie zatrzymuje propagacji.
  const camera = createCamera(createFakeCanvas(), radius).object;
  const canvas = createFakeCanvas(CANVAS_RECT.width, CANVAS_RECT.height, CANVAS_RECT);
  camera.aspect = CANVAS_RECT.width / CANVAS_RECT.height;
  camera.updateProjectionMatrix();
  const keys = createFakeEventTarget();
  const sim = new Sim(planet, DEFAULT_RUN);
  const selection = createSelection();
  const messages: string[] = [];
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
    report: (message) => messages.push(message),
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
  it('18. [NIEZMIENNIK, OBIE POŁOWY] kliknięcie nie rusza stanu, a po step() świat zmienia się dokładnie tak, jak zapowiedziała komenda', () => {
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
    expect(w.messages.at(-1)).toBe(`buduję BARRICADE na komórce ${target}`);

    // POŁOWA POZYTYWNA: komenda naprawdę dotarła. Bez `enqueue` stan po `step()` byłby
    // taki, jakby gracz nie kliknął — a żadna asercja o niemutowaniu tego nie widzi.
    w.sim.step();
    expect(w.sim.state.buildings[target]?.type).toBe('BARRICADE');
    expect(stateHash(w.sim.state)).not.toBe(before);
  });

  it('19. [PRÓG, W PIKSELACH] drgnienie ręki o 3 px to wciąż kliknięcie, przeciągnięcie o 10 px to już obrót kamery', () => {
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

  it('20. prawy przycisk rozbiera tę samą komórkę, którą lewy zabudował — przez te same nasłuchy', () => {
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
    expect(w.messages.at(-1)).toBe(`rozbieram na komórce ${target}`);

    // Rozbiórka CORE jest odmawiana z podanym powodem, a świat zostaje nietknięty.
    aimAt(w.camera, planet.startCell);
    gesture(w, [CENTER_X, CENTER_Y], [CENTER_X, CENTER_Y], 2);
    w.sim.step();
    expect(w.sim.state.buildings[planet.startCell]?.type).toBe('CORE');
    expect(w.messages.some((m) => m.includes('CORE_INDESTRUCTIBLE'))).toBe(true);
  });

  it('21. klawiatura: spacja woła powrót do Core, cyfry wybierają typ, Shift+cyfra przełącza cieniowanie', () => {
    const w = makeWiring();

    expect(pressKey(w, 'Space')).toBe(1); // `preventDefault` — spacja nie przewija strony
    expect(w.focused).toEqual([planet.cells[planet.startCell].center]);
    expect(w.messages.at(-1)).toBe(`powrót do Core (komórka ${planet.startCell})`);

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

  it('22. [ŚWIEŻOŚĆ] wskazana komórka nadąża za kamerą dojeżdżającą bezwładnością, nie tylko za kursorem', () => {
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

  it('23. detach() odpina wszystkie nasłuchy — po nim kliknięcie nie kolejkuje niczego', () => {
    const w = makeWiring();
    const target = freeHexagonNear(w.sim.state);
    aimAt(w.camera, target);
    w.handle.detach();

    expect(gesture(w, [CENTER_X, CENTER_Y], [CENTER_X, CENTER_Y])).toBe(0);
    w.sim.step();
    expect(w.sim.state.buildings[target]).toBeNull();
  });

  it('24. kolejność typów budowania jest kontraktem skrótów 1-9, nie luźnym opisem', () => {
    const offered = playerBuildableTypes();
    // Kolejność deklaracji w `defs.ts` JEST mapowaniem klawiszy — `.reverse()` w liście
    // po cichu przemapowałby wszystkie dziewięć skrótów. Porównanie z `Object.keys` nie
    // jest tautologią: wiąże obietnicę z doc-commentu z INNYM plikiem (`defs.ts`), który
    // to zamówienie realizuje, a nie z tą samą funkcją.
    expect(offered).toEqual(Object.keys(BUILDINGS).filter((t) => BUILDINGS[t as BuildingType].playerBuildable));
    expect(offered[0]).toBe('BARRICADE'); // pierwszy klawisz = najtańszy budynek startowy
    // Dziesiąty typ byłby nieosiągalny z klawiatury (`Digit1`–`Digit9`) i nikt by tego
    // nie zauważył, bo lista sama by się rozrosła.
    expect(offered.length).toBeLessThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------------------
// Strażnik strukturalny dla Testu 12
// ---------------------------------------------------------------------------------------

/** Operatory, po których lewa strona przestaje być odczytem. */
const ASSIGNMENT_TOKENS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.PlusPlusToken,
  SyntaxKind.MinusMinusToken,
]);

/** Metody, które zmieniają tablicę/mapę w miejscu — zapis bez znaku `=`. */
const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
  'set', 'delete', 'clear', 'add',
]);

/**
 * Tokeny źródła, z komentarzami pominiętymi jako trivia i literałami napisowymi jako
 * pojedynczymi, nierozkładalnymi tokenami.
 *
 * Obsługa `reScanTemplateToken` jest PRZENIESIONA Z `packages/sim/test/contract.test.ts`
 * razem z powodem: lekser, dojechawszy do `}` domykającego `${…}`, wraca do trybu KODU
 * i bez tego jawnego przełączenia leksuje resztę literału szablonowego jako kod, a
 * domykający backtick otwiera fantomowy literał biegnący do następnego backticka w pliku.
 * ZMIERZONE tutaj, nie przepisane z opisu: bez tej obsługi `main.ts` — pełen szablonów
 * z podstawieniami w komunikatach HUD — oddawał identyfikator z KOMENTARZA jako kod
 * i strażnik podnosił fałszywy alarm. Fałszywy alarm jest łagodną połową tej wady:
 * przy innej parzystości backticków ta sama luka ZAGŁUSZA alarm prawdziwy.
 */
function tokenize(sourceText: string): { kind: SyntaxKind; text: string }[] {
  const scanner = createScanner(/* skipTrivia */ true, undefined, sourceText);
  const tokens: { kind: SyntaxKind; text: string }[] = [];
  let templateDepth = 0;
  let token = scanner.scan();
  while (token !== SyntaxKind.EndOfFile) {
    if (token === SyntaxKind.TemplateHead) {
      templateDepth++;
    } else if (token === SyntaxKind.CloseBraceToken && templateDepth > 0) {
      token = scanner.reScanTemplateToken(/* isTaggedTemplate */ false);
      if (token === SyntaxKind.TemplateTail) templateDepth--;
    }
    tokens.push({ kind: token, text: scanner.getTokenText() });
    token = scanner.scan();
  }
  return tokens;
}

/** Identyfikatory WYSTĘPUJĄCE W KODZIE — bez tych z komentarzy i z literałów napisowych. */
function codeIdentifiers(sourceText: string): Set<string> {
  return new Set(
    tokenize(sourceText)
      .filter((t) => t.kind === SyntaxKind.Identifier)
      .map((t) => t.text),
  );
}

/**
 * Wszystkie ZAPISY przechodzące przez `.state` w podanym źródle, w formie czytelnych
 * ścieżek (`sim.state.ore`, `b.hp`). Pusta tablica = plik wyłącznie czyta.
 *
 * ## Co się zmieniło w rundzie naprawczej 1 — i dlaczego to jest tylko strażnik POMOCNICZY
 *
 * Pierwsza wersja rozpoznawała zapis wyłącznie BEZPOŚREDNIO po łańcuchu zaczynającym się
 * dosłownie od `<ident>.state`, więc przepuszczała cztery z pięciu realnych dróg obejścia
 * (zmierzone w przeglądzie: alias, destrukturyzacja, `Object.assign`, przyrostek
 * przedrostkowy). Teraz śledzi SKAŻENIE: identyfikator, do którego przypisano cokolwiek
 * przechodzącego przez `.state`, sam staje się korzeniem łańcucha.
 *
 * **Ale to i tak jest gonienie kształtu składniowego** i tak jest tu traktowane. Właściwym
 * strażnikiem ograniczenia nadrzędnego są testy 18-20: mierzą WŁASNOŚĆ (`stateHash` przed
 * obsługą zdarzenia i po niej, plus zmiana świata po `step()`), więc łapią każdy zapis
 * niezależnie od tego, jak go zapisano. Ten skan zostaje wyłącznie dla `main.ts`, którego
 * **nie da się uruchomić w teście** (dotyka `document`/`window` przy imporcie) — i to
 * jest jego znana, zapisana granica, a nie obietnica kompletności.
 *
 * Świadome PRZESZACOWANIE: skażenie nie zna typów, więc `const ore = sim.state.ore;`
 * skaża `ore`, choć to liczba i nie da się przez nią nic zmutować. Fałszywy alarm na
 * `ore = 0` byłby ceną, którą wolę zapłacić od fałszywej ciszy; dziś żaden plik klienta
 * takiego aliasu nie tworzy.
 */
function stateWrites(sourceText: string): string[] {
  const tokens = tokenize(sourceText);
  const writes: string[] = [];
  const tainted = new Set<string>();

  const isIdent = (k: number): boolean => tokens[k]?.kind === SyntaxKind.Identifier;
  /** Czy w tokenach [from, to) zaczyna się gdziekolwiek łańcuch przez stan. */
  const containsStateChain = (from: number, to: number): boolean => {
    for (let k = from; k < to && k < tokens.length; k++) {
      if (isIdent(k) && tokens[k].text === 'state' && tokens[k - 1]?.kind === SyntaxKind.DotToken) return true;
      if (isIdent(k) && tainted.has(tokens[k].text) && tokens[k - 1]?.kind !== SyntaxKind.DotToken) return true;
    }
    return false;
  };
  /** Indeks pierwszego `;` na głębokości 0, licząc od `from`. */
  const statementEnd = (from: number): number => {
    let depth = 0;
    for (let k = from; k < tokens.length; k++) {
      const kind = tokens[k].kind;
      if (kind === SyntaxKind.OpenParenToken || kind === SyntaxKind.OpenBracketToken || kind === SyntaxKind.OpenBraceToken) depth++;
      else if (kind === SyntaxKind.CloseParenToken || kind === SyntaxKind.CloseBracketToken || kind === SyntaxKind.CloseBraceToken) depth--;
      else if (kind === SyntaxKind.SemicolonToken && depth <= 0) return k;
    }
    return tokens.length;
  };

  for (let i = 0; i < tokens.length; i++) {
    const kind = tokens[i].kind;

    // --- Skażenie przez deklarację -------------------------------------------------------
    if (kind === SyntaxKind.ConstKeyword || kind === SyntaxKind.LetKeyword || kind === SyntaxKind.VarKeyword) {
      const end = statementEnd(i);
      // Deklaracja FUNKCJI nie skaża nazwy: `const onPointerUp = (e) => { … sim.state … }`
      // czyta stan w swoim ciele, ale sama nazwa nie jest uchwytem do stanu. Bez tego
      // wyjątku każdy nasłuch w `input.ts` był skażony, a jego własna deklaracja
      // wyglądała jak zapis (zmierzone: dwa fałszywe alarmy).
      const definesFunction = tokens
        .slice(i, end)
        .some((t) => t.kind === SyntaxKind.EqualsGreaterThanToken || t.kind === SyntaxKind.FunctionKeyword);
      if (isIdent(i + 1) && tokens[i + 2]?.kind === SyntaxKind.EqualsToken) {
        if (!definesFunction && containsStateChain(i + 3, end)) tainted.add(tokens[i + 1].text);
        i += 2; // pomiń zadeklarowaną nazwę — inaczej `const x = …` czyta się jako zapis do `x`
        continue;
      } else if (tokens[i + 1]?.kind === SyntaxKind.OpenBraceToken) {
        // Destrukturyzacja: zbieramy nazwy do `}`.
        const names: string[] = [];
        let k = i + 2;
        while (k < tokens.length && tokens[k].kind !== SyntaxKind.CloseBraceToken) {
          if (isIdent(k) && tokens[k - 1]?.kind !== SyntaxKind.DotToken) names.push(tokens[k].text);
          k++;
        }
        // `const { state } = sim` skaża, nawet gdy po prawej nie ma słowa `state`.
        if (names.includes('state') || containsStateChain(k + 2, end)) {
          for (const name of names) tainted.add(name);
        }
        i = k; // pomiń całą listę nazw z destrukturyzacji, z tego samego powodu
      }
      continue;
    }

    // --- Object.assign(<łańcuch>, …) -----------------------------------------------------
    if (
      isIdent(i) && tokens[i].text === 'assign' &&
      tokens[i - 1]?.kind === SyntaxKind.DotToken && isIdent(i - 2) && tokens[i - 2].text === 'Object' &&
      tokens[i + 1]?.kind === SyntaxKind.OpenParenToken
    ) {
      const argStart = i + 2;
      if (containsStateChain(argStart, argStart + 4)) {
        writes.push(chainPath(tokens, argStart).path);
      }
      continue;
    }

    // --- Korzeń łańcucha: `<coś>.state` albo identyfikator skażony ------------------------
    let root = -1;
    if (isIdent(i) && tokens[i].text === 'state' && tokens[i - 1]?.kind === SyntaxKind.DotToken && isIdent(i - 2)) {
      root = i - 2;
    } else if (isIdent(i) && tainted.has(tokens[i].text) && tokens[i - 1]?.kind !== SyntaxKind.DotToken) {
      root = i;
    }
    if (root < 0) continue;

    const { path, end: j, lastMember } = chainPath(tokens, root);
    const next = tokens[j]?.kind;
    const prefixed =
      tokens[root - 1]?.kind === SyntaxKind.PlusPlusToken || tokens[root - 1]?.kind === SyntaxKind.MinusMinusToken;
    if (prefixed) writes.push(path);
    else if (next !== undefined && ASSIGNMENT_TOKENS.has(next)) writes.push(path);
    else if (next === SyntaxKind.OpenParenToken && MUTATING_METHODS.has(lastMember)) writes.push(path);
    i = j - 1;
  }
  return writes;
}

/** Ścieżka dostępu zaczynająca się w `root`: `.nazwa` i `[…]`, aż do pierwszego innego tokenu. */
function chainPath(
  tokens: { kind: SyntaxKind; text: string }[],
  root: number,
): { path: string; end: number; lastMember: string } {
  let path = tokens[root].text;
  let lastMember = tokens[root].text;
  let j = root + 1;
  for (;;) {
    if (tokens[j]?.kind === SyntaxKind.DotToken && tokens[j + 1]?.kind === SyntaxKind.Identifier) {
      lastMember = tokens[j + 1].text;
      path += `.${lastMember}`;
      j += 2;
      continue;
    }
    if (tokens[j]?.kind === SyntaxKind.OpenBracketToken) {
      let depth = 1;
      j++;
      while (j < tokens.length && depth > 0) {
        if (tokens[j].kind === SyntaxKind.OpenBracketToken) depth++;
        if (tokens[j].kind === SyntaxKind.CloseBracketToken) depth--;
        j++;
      }
      lastMember = '';
      path += '[…]';
      continue;
    }
    break;
  }
  return { path, end: j, lastMember };
}
