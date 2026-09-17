import type { Planet, Vec3 } from '@heliopolis/sim';

/**
 * Zamienia promień z kamery (Faza 2C, Zadanie 1: fundament sterowania) na indeks komórki
 * pod kursorem — albo `null`, gdy promień mija planetę.
 *
 * ## Dlaczego wystarczy przeciąć promień ze sferą i wziąć najbliższy środek
 *
 * Wielościan Goldberga jest **diagramem Voronoi swoich środków komórek**: komórka i to z
 * definicji zbiór punktów sfery bliższych `cells[i].normal` niż normalnej JAKIEJKOLWIEK
 * innej komórki (`global-constraints.md`, "Kluczowy fakt geometryczny dla Zadania 1"). Nie
 * ma więc potrzeby raycastować po trójkątach wachlarza z `buildPlanetGeometry` ani dotykać
 * Three.js w tym module — "przetnij promień ze sferą, weź najbliższy środek" jest DOKŁADNIE
 * to, co ten diagram definiuje.
 *
 * Iloczyn skalarny `dot(normal, hitPoint)` wystarcza zamiast liczenia odległości euklidesowej,
 * bo wszystkie `normal` leżą na sferze jednostkowej: większy iloczyn = mniejszy kąt do punktu
 * trafienia = bliżej po powierzchni sfery — ranking jest identyczny jak przy odległości.
 *
 * **Zastrzeżenie zmierzone w `picking.test.ts`, nie tylko domniemane:** granica WYRYSOWANEGO
 * wieloboku komórki (`buildPlanetGeometry`, ostatecznie `corners` z `dual.ts` — CENTROIDY
 * trójkątów siatki geodezyjnej, nie cyrkumcentry) pokrywa się z granicą prawdziwego diagramu
 * Voronoi generatorów `normal` z dokładnością bliską, ale NIE tożsamą co do bitu: ułamek
 * procenta losowych punktów ląduje w rąbku o szerokości kątowej rzędu 0,001-0,02°, zawsze
 * przy granicy z NAJBLIŻSZYM sąsiadem, gdzie ta funkcja i "wewnątrz narysowanego wieloboku"
 * dają różną odpowiedź. Margines jest dużo poniżej jednego piksela ekranu (`pixelScale.ts`:
 * 3,41 px/jednostkę) — gracz nigdy tego nie zobaczy, a zwrócona komórka jest zawsze
 * BEZPOŚREDNIM sąsiadem tej "poprawnej" — ale to znaczy, że kontrakt tej funkcji to ściśle
 * "najbliższy generator", nie dosłownie "wewnątrz wieloboku, który rysuje renderer". Naprawa
 * (gdyby była pożądana) leżałaby w konstrukcji `corners` w `packages/sim/src/world/dual.ts`,
 * poza zakresem tego modułu. Zmierzona stopa i dowód istnienia: `picking.test.ts`, testy
 * "[WŁASNOŚĆ, niezależnie...]" i "[ISTNIENIE, DETERMINISTYCZNE]".
 *
 * ## Założenie: planeta stoi w (0,0,0)
 *
 * `createPlanet` zawsze buduje komórki wokół początku układu, a kamera (`camera.ts`,
 * `createCamera`/`positiveControl.ts`) nigdy jej stamtąd nie rusza — to niezmiennik całego
 * renderu, nie tylko tego modułu. Stąd przecięcie ze sferą liczy się bez odejmowania
 * żadnego środka planety od `origin`.
 *
 * ## Bliższe przecięcie, nie dalsze
 *
 * Z dwóch punktów przecięcia promienia ze sferą bierzemy BLIŻSZY kamerze
 * (`t = -b - sqrt(disc)`): gracz wskazuje komórkę na PRZEDNIEJ półkuli, tej zwróconej do
 * niego, nie tę po drugiej stronie planety. Dalsze przecięcie odpowiadałoby antypodzie —
 * patrz tabela mutacji w raporcie Zadania 1.
 *
 * ## Trzy sposoby zawołać to źle — i co każdy z nich robi (runda naprawcza 1, `task-1-review.md`)
 *
 * 1. **`direction` długości zero** (dokładnie `{0,0,0}`) — błąd WOŁAJĄCEGO (nie da się
 *    wskazać "donikąd"). Rzuca `RangeError`.
 * 2. **`origin`/`direction` niefinitne** (jakikolwiek składnik `NaN` lub `±Infinity`, albo
 *    `planet.radius` niefinitny) — NIE błąd wołającego: to przejściowy stan przeglądarki
 *    (np. `aspect = 0/0` z płótna o zerowym rozmiarze na pierwszej klatce ukrytej karty,
 *    zanim `resize` zdąży zadziałać), nie błąd programisty. Zwraca `null` — jawnie
 *    (`Number.isFinite` na sześciu składowych), nie jako przypadkowy efekt uboczny
 *    porównania `NaN > bestDot` (to dawało `-1`, które nie jest ani komórką, ani `null`).
 * 3. **`origin` wewnątrz planety** (`|origin| < radius`) — błąd WOŁAJĄCEGO: kamera nigdy tam
 *    nie jest (`MIN_DISTANCE_FACTOR = 1,3` w `camera.ts`), więc legalny promień zawsze
 *    zaczyna się na zewnątrz albo dokładnie na powierzchni. Rzuca `RangeError` — inaczej niż
 *    (2), bo tu winny jest kod wołający, nie środowisko.
 *
 * Rozróżnienie (2) kontra (3) jest CELOWE, nie przeoczeniem: różni je to, KTO zawinił.
 */
export function pickCell(planet: Planet, origin: Vec3, direction: Vec3): number | null {
  if (
    !Number.isFinite(origin.x) ||
    !Number.isFinite(origin.y) ||
    !Number.isFinite(origin.z) ||
    !Number.isFinite(direction.x) ||
    !Number.isFinite(direction.y) ||
    !Number.isFinite(direction.z)
  ) {
    return null; // wejście niefinitne — przejściowy stan przeglądarki, nie błąd wołającego
  }

  const dLen = Math.hypot(direction.x, direction.y, direction.z);
  if (dLen === 0) {
    throw new RangeError(`pickCell: direction must be non-zero, got length ${dLen}`);
  }
  const dx = direction.x / dLen;
  const dy = direction.y / dLen;
  const dz = direction.z / dLen;

  // Planeta stoi w (0,0,0) — patrz sekcja powyżej.
  const originLenSq = origin.x * origin.x + origin.y * origin.y + origin.z * origin.z;
  const radiusSq = planet.radius * planet.radius;
  if (originLenSq < radiusSq) {
    throw new RangeError(
      `pickCell: origin must be outside the planet (|origin|=${Math.sqrt(originLenSq)}, radius=${planet.radius}) — the camera never goes below MIN_DISTANCE_FACTOR × radius (camera.ts)`,
    );
  }

  const b = origin.x * dx + origin.y * dy + origin.z * dz;
  const c = originLenSq - radiusSq;
  const disc = b * b - c;
  if (disc < 0) return null; // promień mija sferę
  const t = -b - Math.sqrt(disc); // bliższe przecięcie — patrz sekcja powyżej
  if (t < 0) return null; // sfera jest za kamerą

  const hx = origin.x + dx * t;
  const hy = origin.y + dy * t;
  const hz = origin.z + dz * t;

  // Najbliższy środek do punktu trafienia = komórka Voronoi, w której leży ten punkt
  // (patrz uzasadnienie w komentarzu funkcji). Liniowe przejście po wszystkich komórkach:
  // 1442 iteracje na kliknięcie, poza pętlą renderu — budżet klatki go nie dotyczy.
  let best = -1;
  let bestDot = -Infinity;
  for (let i = 0; i < planet.cells.length; i++) {
    const n = planet.cells[i].normal;
    const dot = n.x * hx + n.y * hy + n.z * hz;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  // Wartownik `best === -1` powinien być nieosiągalny dla poprawnej, niepustej planety i
  // finitnych origin/direction (sprawdzonych wyżej): pierwsza iteracja zawsze ma `dot`
  // finitne (bo hx/hy/hz i `.normal` są finitne) i finitne `dot > -Infinity` jest zawsze
  // prawdą, więc `best` dostaje wartość na i=0. Jedyny sposób, żeby tu wylądować, to
  // `planet.cells.length === 0` — nie zdarza się z `createPlanet`, ale sygnatura przyjmuje
  // dowolny `Planet`-kształtny obiekt, więc zwracamy `null` zamiast nonsensownego `-1`
  // (`planet.cells[-1]` to `undefined`, nie wyjątek — cichy błąd gorszy niż `null`).
  return best < 0 ? null : best;
}
