import { describe, expect, it } from 'vitest';
import { add, createPlanet, cross, dot, normalize, scale, type Planet, type Vec3 } from '@heliopolis/sim';
import { pickCell } from '../src/picking.js';
import { buildPlanetGeometry, type PlanetGeometry } from '../src/geometry.js';
import { MAX_DISTANCE_FACTOR, MIN_DISTANCE_FACTOR } from '../src/camera.js';
import { mulberry32 } from './support/mulberry32.js';

// Ta sama planeta dla wszystkich testów tego pliku — seed dowolny, ustalony raz (spójny
// z seedem użytym w briefie Zadania 1).
const planet = createPlanet({ seed: 1 });

// Geometria rysowana przez renderer — testy własności sprawdzają `pickCell` względem TYCH
// SAMYCH buforów, nie względem `planet.cells[i].corners` wprost (patrz `cornersFromGeometry`).
const geometry: PlanetGeometry = buildPlanetGeometry(planet);

function vecAt(positions: Float32Array, vertexIndex: number): Vec3 {
  const o = vertexIndex * 3;
  return { x: positions[o], y: positions[o + 1], z: positions[o + 2] };
}

/**
 * Narożniki komórki `cellId`, odczytane z buforów `PlanetGeometry` (nie z `Planet.cells`
 * wprost) — pierwszy wierzchołek zakresu to `cell.center` (pomijamy go, `k` startuje od 1),
 * kolejne to jej `corners` w kolejności (`buildPlanetGeometry` zapisuje je tak, Test 9 w
 * `geometry.test.ts` sprawdza tożsamość PRZEZ WARTOŚĆ).
 */
function cornersFromGeometry(geo: PlanetGeometry, cellId: number): Vec3[] {
  const start = geo.cellVertexStart[cellId];
  const count = geo.cellVertexCount[cellId];
  const corners: Vec3[] = [];
  for (let k = 1; k < count; k++) corners.push(vecAt(geo.positions, start + k));
  return corners;
}

/**
 * Czy `p` leży wewnątrz wypukłego wielokąta sferycznego rozpiętego na `corners`.
 *
 * Każda krawędź (corners[k], corners[k+1]) to łuk wielkiego koła — przecięcie sfery z
 * płaszczyzną PRZEZ ŚRODEK SFERY rozpiętą na tych dwóch wektorach. `cross(corners[k],
 * corners[k+1])` jest normalną tej płaszczyzny: dla wielokąta WYPUKŁEGO, `p` jest w środku
 * wtedy i tylko wtedy, gdy leży po TEJ SAMEJ stronie każdej z tych płaszczyzn co dowolny
 * inny punkt znany jako wewnętrzny — standardowy test półpłaszczyznowy, przeniesiony z
 * płaskiego wielokąta na sferę.
 *
 * Punktem odniesienia "na pewno wewnątrz" jest CENTROID SAMYCH `corners` (średnia,
 * rzutowana z powrotem na sferę), a NIE `cell.center`/`cell.normal`: (1) niezależność —
 * `.normal` to dokładnie dana, na której stoi ranking w `pickCell`; (2) poprawność —
 * centroid wierzchołków wielokąta WYPUKŁEGO leży w jego wnętrzu z definicji, niezależnie od
 * tego, skąd te wierzchołki pochodzą (ważne w teście "[DOWÓD NIEZALEŻNOŚCI]" niżej, gdzie
 * `corners` są CELOWO cudze).
 */
function insideSphericalPolygon(corners: readonly Vec3[], p: Vec3): boolean {
  const n = corners.length;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const c of corners) {
    cx += c.x;
    cy += c.y;
    cz += c.z;
  }
  const centroid = normalize({ x: cx / n, y: cy / n, z: cz / n });

  for (let k = 0; k < n; k++) {
    const edgeNormal = cross(corners[k], corners[(k + 1) % n]);
    const centroidSide = dot(edgeNormal, centroid);
    const pSide = dot(edgeNormal, p);
    if (Math.sign(pSide) !== Math.sign(centroidSide)) return false;
  }
  return true;
}

describe('pickCell — przecięcie promienia ze sferą i podstawowe kontrakty', () => {
  it('1. promień w środek planety trafia w komórkę zwróconą do źródła promienia', () => {
    const target = planet.cells[500];
    const n = target.normal;
    const origin = { x: n.x * planet.radius * 3, y: n.y * planet.radius * 3, z: n.z * planet.radius * 3 };
    const direction = { x: -n.x, y: -n.y, z: -n.z };
    expect(pickCell(planet, origin, direction)).toBe(500);
  });

  it('2. promień mijający planetę bokiem (disc<0) daje null', () => {
    const origin = { x: 0, y: 0, z: planet.radius * 3 };
    const direction = { x: 1, y: 0, z: 0 };
    expect(pickCell(planet, origin, direction)).toBeNull();
  });

  it('3. kierunek zerowy rzuca RangeError, nie liczy w ciszy 0/0', () => {
    const origin = { x: 0, y: 0, z: planet.radius * 3 };
    expect(() => pickCell(planet, origin, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
  });

  // Runda naprawcza 1 (task-1-review.md, Z3): Test 2 wchodzi WYŁĄCZNIE gałęzią `disc<0`
  // (promień mija bokiem) — strażnik `t<0` (sfera przecięta przez PROSTĄ promienia, ale oba
  // przecięcia leżą ZA kamerą) nie miał żadnego testu. Konstrukcja: `origin` na zewnątrz,
  // `direction` skierowany DALEJ od planety (ten sam zwrot co `origin` sam w sobie, nie w
  // jego stronę) — prosta promienia PRZECINA sferę (disc>=0), ale ruch do przodu nigdy tam
  // nie dociera.
  it('4. promień skierowany OD planety (disc≥0, ale t<0) daje null, nie komórkę po drugiej stronie', () => {
    const origin = { x: 0, y: 0, z: planet.radius * 3 };
    const direction = { x: 0, y: 0, z: 1 }; // od planety, nie w jej stronę
    expect(pickCell(planet, origin, direction)).toBeNull();
  });

  // Z6/rozstrzygnięcie koordynatora (punkt 5): `origin` wewnątrz planety to błąd
  // WOŁAJĄCEGO (kamera nigdy tam nie jest — `MIN_DISTANCE_FACTOR` w `camera.ts`) — rzuca,
  // nie zwraca cichego `null` ("promień minął", co jest nieprawdą: promień z wnętrza
  // trafia ZAWSZE).
  it('5. origin wewnątrz planety rzuca RangeError — nie ciche "promień minął"', () => {
    const direction = { x: 0, y: 0, z: -1 };
    expect(() => pickCell(planet, { x: 0, y: 0, z: 0 }, direction)).toThrow(RangeError);
    expect(() => pickCell(planet, { x: 0, y: 0, z: planet.radius * 0.999 }, direction)).toThrow(RangeError);
  });

  // Granica strażnika (5) jest DOKŁADNIE na powierzchni, nie na `MIN_DISTANCE_FACTOR` — ale
  // realny zakres zoomu (`camera.ts`) nigdy nie schodzi poniżej `MIN_DISTANCE_FACTOR × R`,
  // więc oba są tu potwierdzone jako "działa".
  it('6. origin dokładnie na powierzchni albo w realnym zakresie zoomu (MIN_DISTANCE_FACTOR×R) działa, nie rzuca', () => {
    const direction = { x: 0, y: 0, z: -1 };
    const onSurface = { x: 0, y: 0, z: planet.radius };
    const atZoomLimit = { x: 0, y: 0, z: planet.radius * MIN_DISTANCE_FACTOR };
    expect(() => pickCell(planet, onSurface, direction)).not.toThrow();
    expect(pickCell(planet, onSurface, direction)).not.toBeNull();
    expect(() => pickCell(planet, atZoomLimit, direction)).not.toThrow();
    expect(pickCell(planet, atZoomLimit, direction)).not.toBeNull();
  });

  // Z2/rozstrzygnięcie koordynatora (punkt 4): wejście NIEFINITNE (na odróżnienie od
  // kierunku zerowego, punkt 3) to NIE błąd wołającego — to przejściowy stan przeglądarki
  // (`aspect = 0/0` na pierwszej klatce płótna o zerowym rozmiarze). Strażnik ma być
  // JAWNY (sześć `Number.isFinite`), nie przypadkowym efektem `NaN > -Infinity === false`,
  // który wcześniej dawał `-1` — ani komórkę, ani `null`, ani wyjątek.
  it('7. wejście niefinitne (NaN/Infinity w origin, direction, albo promień planety) daje null — nigdy -1', () => {
    const validOrigin = { x: 0, y: 0, z: planet.radius * 3 };
    const validDirection = { x: 0, y: 0, z: -1 };
    const nonFiniteCases: Array<{ origin: Vec3; direction: Vec3 }> = [
      { origin: validOrigin, direction: { x: Infinity, y: 0, z: -1 } },
      { origin: validOrigin, direction: { x: 0, y: 0, z: -Infinity } },
      { origin: validOrigin, direction: { x: NaN, y: 0, z: -1 } },
      { origin: { x: NaN, y: 0, z: planet.radius * 3 }, direction: validDirection },
      { origin: { x: 0, y: 0, z: Infinity }, direction: validDirection },
    ];
    for (const { origin, direction } of nonFiniteCases) {
      expect(pickCell(planet, origin, direction)).toBeNull();
    }

    // `planet.radius` niefinitny NIE przechodzi przez TEN strażnik (sprawdza tylko origin/
    // direction) — broni go wartownik `best<0 → null` na końcu funkcji (patrz komentarz w
    // `picking.ts`): `disc`/`t`/`hx..hz` stają się NaN, każdy `dot` w pętli jest NaN, `dot >
    // bestDot` nigdy prawdą, `best` zostaje na -1, funkcja zwraca `null` zamiast wartownika.
    const nanRadiusPlanet: Planet = { ...planet, radius: NaN };
    expect(pickCell(nanRadiusPlanet, validOrigin, validDirection)).toBeNull();
  });

  // Kontrakt obronny stojący za wartownikiem `best<0 → null` (patrz komentarz w
  // `picking.ts`): dla poprawnej, niepustej planety ta gałąź jest NIEOSIĄGALNA (pierwsza
  // iteracja pętli zawsze ma `dot` finitne, więc `dot > -Infinity` jest zawsze prawdą) —
  // jedyny sposób ją odwiedzić to planeta bez komórek. `createPlanet` nigdy takiej nie
  // produkuje, ale sygnatura przyjmuje dowolny `Planet`-kształtny obiekt.
  it('8. planeta bez komórek daje null, nie -1 (które wyglądałoby jak poprawny indeks)', () => {
    const emptyPlanet: Planet = { ...planet, cells: [] };
    expect(pickCell(emptyPlanet, { x: 0, y: 0, z: planet.radius * 3 }, { x: 0, y: 0, z: -1 })).toBeNull();
  });

  // Z1/naprawa: kierunek w tej grze przychodzi z odrzutowania NDC, więc NIGDY nie jest
  // czysto jednostkowy. `pickCell` normalizuje wewnątrz siebie (`Math.hypot`) — sprawdzone
  // tu WPROST, nie tylko jako efekt uboczny losowych próbek niżej: wynik musi być identyczny
  // dla kierunku ×250 (duży, jak z odrzutowania przy dużej odległości) i ×0.003 (mały).
  it('9. kierunek nieznormalizowany (×250 i ×0.003) daje ten sam wynik co jednostkowy', () => {
    const target = planet.cells[500];
    const n = target.normal;
    const origin = { x: n.x * planet.radius * 3, y: n.y * planet.radius * 3, z: n.z * planet.radius * 3 };
    const unit = { x: -n.x, y: -n.y, z: -n.z };
    const big = { x: unit.x * 250, y: unit.y * 250, z: unit.z * 250 };
    const small = { x: unit.x * 0.003, y: unit.y * 0.003, z: unit.z * 0.003 };
    expect(pickCell(planet, origin, big)).toBe(500);
    expect(pickCell(planet, origin, small)).toBe(500);
  });
});

describe('pickCell — przelot deterministyczny po wszystkich komórkach', () => {
  // Z4/naprawa: 2000 losowych próbek (jakiegokolwiek rozkładu) NIE gwarantuje odwiedzenia
  // każdego indeksu — zmierzone w recenzji: 375/1442 komórek (26%), w tym OSTATNIA, nigdy
  // nie były odpowiedzią. Błąd o jeden w granicy pętli (`i < len` → `i < len-1`) był
  // dlatego niewidoczny. To jest jedyny sposób, żeby uczynić GRANICĘ pętli widoczną: nie
  // "dość dużo losowych", tylko KAŻDY indeks po imieniu. 1442 wywołania, milisekundy.
  it('10. każda z 1442 komórek jest osiągalna: promień wzdłuż -cells[i].normal wraca DOKŁADNIE i', () => {
    let checked = 0;
    for (let i = 0; i < planet.cells.length; i++) {
      const n = planet.cells[i].normal;
      const origin = { x: n.x * planet.radius * 3, y: n.y * planet.radius * 3, z: n.z * planet.radius * 3 };
      const direction = { x: -n.x, y: -n.y, z: -n.z };
      expect(pickCell(planet, origin, direction)).toBe(i);
      checked++;
    }
    expect(checked).toBe(planet.cells.length);
    // Kotwica NIEZALEŻNA od `planet.cells.length` samej siebie (por. `expectedVertexCount`
    // w `geometry.test.ts`) — bez niej pusta pętla (np. gdyby `cells` zamieniono na `[]`
    // wcześniej w pliku) "sprawdzałaby" zero komórek i zaliczała formalnie zielono.
    expect(checked).toBe(1442);
  });
});

// =========================================================================================
// Własność Voronoi na promieniach SKOŚNYCH — runda naprawcza 1
// =========================================================================================
//
// Z1/naprawa (task-1-review.md, znalezisko najpoważniejsze): wszystkie promienie w
// poprzedniej wersji tego pliku były OSIOWE — `origin = 4R·n`, `direction = -n` — więc
// PRZECHODZIŁY DOKŁADNIE PRZEZ ŚRODEK planety. Dla tej rodziny punkt trafienia jest równy
// `R·n` Z KONSTRUKCJI WEJŚCIA (żadna geometria nie jest w to zaangażowana: równanie
// kwadratowe przecięcia degeneruje się trywialnie), a wyrocznia porównywała właśnie z `n`.
// Zmierzone przez recenzenta: na siatce 81×81 promieni ekranowych w planetę trafia 2885, i
// DOKŁADNIE JEDEN z nich jest osiowy. Usunięcie normalizacji kierunku albo podstawienie
// błędnego wzoru na punkt trafienia dawało 6/6 zielone MIMO 72-99% złych realnych kliknięć.
//
// Naprawa: kamera `origin` i punkt trafienia są losowane NIEZALEŻNIE. `origin` to losowa
// pozycja w realistycznym zakresie zoomu (`MIN_DISTANCE_FACTOR`..`MAX_DISTANCE_FACTOR` ×
// promień, jak `camera.ts`). Kierunek to "prosto w środek" ODCHYLONY o losowy kąt (0 do
// prawie kąta horyzontu) w losowym azymucie — czyli promień OGÓLNEGO położenia, nie
// przechodzący przez środek poza miarą zero. Punkt trafienia NIE jest zakładany: liczy go
// `raySphereNearPoint` — świeży, niezależny solver (patrz niżej), nie import z `picking.ts`.
// Kierunek dodatkowo skalowany losowym czynnikiem (0,1-250) — nigdy jednostkowy — bo tak
// przychodzi z odrzutowania NDC (patrz Test 9).

/**
 * Niezależne (od `picking.ts`) przecięcie promienia ze sferą o promieniu `radius`
 * wyśrodkowaną w (0,0,0) — bliższy pierwiastek. Napisane od nowa w TYM pliku (nie import z
 * `picking.ts`), żeby błąd we WŁAŚCIWEJ implementacji nie mógł "zgodzić się sam ze sobą" w
 * wyroczni — dokładnie zarzut Z1: poprzednia wersja porównywała `pickCell` z punktem
 * ZAŁOŻONYM z konstrukcji wejścia, nie WYLICZONYM z przecięcia.
 */
function raySphereNearPoint(origin: Vec3, direction: Vec3, radius: number): Vec3 | null {
  const dLen = Math.hypot(direction.x, direction.y, direction.z);
  const dx = direction.x / dLen;
  const dy = direction.y / dLen;
  const dz = direction.z / dLen;
  const b = origin.x * dx + origin.y * dy + origin.z * dz;
  const c = origin.x * origin.x + origin.y * origin.y + origin.z * origin.z - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  return { x: origin.x + dx * t, y: origin.y + dy * t, z: origin.z + dz * t };
}

/** Baza styczna dowolna, ale deterministyczna — jak `tangentBasis` w `dual.ts`. */
function orthonormalBasis(d0: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  const helper: Vec3 = Math.abs(d0.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const tangent = normalize(cross(d0, helper));
  const bitangent = cross(d0, tangent);
  return { tangent, bitangent };
}

const SAMPLE_COUNT = 2000;
interface ObliqueSample {
  readonly origin: Vec3;
  readonly direction: Vec3; // CELOWO nieznormalizowany
  readonly trueHit: Vec3; // wyliczony z `raySphereNearPoint`, NIE założony; promień = planet.radius
  /** `trueHit` znormalizowany — do rankingu po iloczynie skalarnym z `.normal` (jednostkowym),
   *  żeby marginesy były w tej samej skali co przy porównaniu dwóch wektorów jednostkowych
   *  (inaczej margines wychodzi ×promień razy za duży — złapane Testem 13 przy pierwszym
   *  uruchomieniu tej wersji, patrz raport). */
  readonly trueHitDir: Vec3;
}
const samples: ObliqueSample[] = (() => {
  const rng = mulberry32(12345);
  const out: ObliqueSample[] = [];
  let attempts = 0;
  while (out.length < SAMPLE_COUNT) {
    attempts++;
    if (attempts > SAMPLE_COUNT * 10) {
      throw new Error(`Za mało trafień: ${out.length}/${SAMPLE_COUNT} po ${attempts} próbach.`);
    }
    // Losowa pozycja kamery: kierunek jednostajny na sferze, odległość w realnym zakresie
    // zoomu (`camera.ts`).
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const cameraDir: Vec3 = { x: r * Math.cos(phi), y: u, z: r * Math.sin(phi) };
    const distFactor = MIN_DISTANCE_FACTOR + rng() * (MAX_DISTANCE_FACTOR - MIN_DISTANCE_FACTOR);
    const origin: Vec3 = scale(cameraDir, planet.radius * distFactor);

    // Kierunek: "prosto w środek" odchylony o losowy kąt theta (0..prawie-horyzont) w
    // losowym azymucie — NIE zawsze 0 (to była wada Z1). `Math.sqrt(rng())` waży w stronę
    // większych theta (powierzchnia widocznej czapy rośnie z sin(theta)), żeby próbki nie
    // gęstniały sztucznie w samym środku ekranu.
    const horizonAngle = Math.asin(1 / distFactor); // kąt widziany z origin, promień=1 wzgl. distFactor
    const theta = Math.sqrt(rng()) * horizonAngle * 0.97; // 0,97: margines od stycznej — Test 4/ME to osobny przypadek
    const azimuth = rng() * Math.PI * 2;
    const d0: Vec3 = { x: -cameraDir.x, y: -cameraDir.y, z: -cameraDir.z };
    const { tangent, bitangent } = orthonormalBasis(d0);
    const perturbed: Vec3 = add(
      scale(d0, Math.cos(theta)),
      scale(add(scale(tangent, Math.cos(azimuth)), scale(bitangent, Math.sin(azimuth))), Math.sin(theta)),
    );
    const directionUnit = normalize(perturbed);

    // CELOWO nieznormalizowany (patrz Test 9): czynnik skali losowy w szerokim zakresie.
    const magnitude = 0.1 + rng() * 250;
    const direction: Vec3 = scale(directionUnit, magnitude);

    const trueHit = raySphereNearPoint(origin, direction, planet.radius);
    if (trueHit === null) continue; // theta<horyzont powinno zawsze trafiać; asercja niżej to potwierdza
    out.push({ origin, direction, trueHit, trueHitDir: normalize(trueHit) });
  }
  return out;
})();

describe('pickCell — własność Voronoi na promieniach SKOŚNYCH (kamera i punkt trafienia niezależne)', () => {
  it('11. konstrukcja próbek jest naprawdę skośna, nie osiowa (kontrola pozytywna)', () => {
    // Bez tej kontroli cała naprawa Z1 mogłaby po cichu wrócić do przypadku osiowego
    // (theta≈0 dla każdej próbki) i nikt by tego nie zauważył. Kąt padania (theta) musi
    // pokrywać szeroki zakres, nie klastrować się przy zerze.
    expect(samples.length).toBe(SAMPLE_COUNT);
    let sawSmallAngle = false;
    let sawLargeAngle = false;
    let sawUnnormalized = false;
    for (const s of samples) {
      const dLen = Math.hypot(s.direction.x, s.direction.y, s.direction.z);
      const dirUnit = scale(s.direction, 1 / dLen);
      const toHit = normalize(s.trueHit);
      const cosAngleAtHit = -dot(dirUnit, toHit); // kąt między kierunkiem a normalną w punkcie trafienia
      if (cosAngleAtHit < 0.999) sawSmallAngle = true; // odchylenie > ok. 2.5°
      if (cosAngleAtHit < 0.9) sawLargeAngle = true; // odchylenie > ok. 25°
      if (Math.abs(dLen - 1) > 0.01) sawUnnormalized = true;
    }
    expect(sawSmallAngle).toBe(true);
    expect(sawLargeAngle).toBe(true);
    expect(sawUnnormalized).toBe(true);
  });

  it('12. [WŁASNOŚĆ] trafiona komórka jest tą o najbliższym środku do PRAWDZIWEGO (wyliczonego) punktu trafienia', () => {
    let checked = 0;
    for (const { origin, direction, trueHitDir } of samples) {
      const hit = pickCell(planet, origin, direction);
      expect(hit).not.toBeNull();

      let bestDot = -Infinity;
      let bestId = -1;
      for (let i = 0; i < planet.cells.length; i++) {
        const c = planet.cells[i].normal;
        const d = c.x * trueHitDir.x + c.y * trueHitDir.y + c.z * trueHitDir.z;
        if (d > bestDot) {
          bestDot = d;
          bestId = i;
        }
      }
      expect(hit).toBe(bestId);
      checked++;
    }
    expect(checked).toBe(SAMPLE_COUNT);
  });

  it('13. [WŁASNOŚĆ, niezależnie od "najbliższy środek"] prawdziwy punkt trafienia leży w wielokącie zwróconej komórki, liczonym z buforów buildPlanetGeometry', () => {
    // ZMIERZONE (nie zgadywane — patrz `picking.ts`, docstring, i raport Zadania 1): ta
    // własność NIE trzyma się dla WSZYSTKICH próbek. `dual.ts` buduje `corners` jako
    // centroidy trójkątów siatki geodezyjnej, nie jako cyrkumcentry — granica narysowanego
    // wieloboku jest BLISKĄ, ale nie tożsamą co do bitu, aproksymacją prawdziwego diagramu
    // Voronoi generatorów `normal`.
    //
    // Runda naprawcza 1 (ocena recenzenta): PRZYPIĘTA liczba (`toBe(25)`) była artefaktem
    // ziarna próbek, nie własnością planety — ośmiu ziaren dawało 18..27, próba 500..20000
    // dawała 1,00%..1,52%, i test oblewał RÓWNIEŻ w kierunku poprawy (naprawa `dual.ts`
    // zgasiłaby niezgodności do zera, a `toBe(N)` zgłosiłoby to jako regresję). Zamiast
    // równości: STOPA związana górnym ograniczeniem z realnym zapasem (zmierzone maksimum
    // pod nowym, skośnym próbkowaniem: 2,10% na kilkunastu ziarnach — 0,03 zostawia ~1,4×
    // zapasu), a KAŻDA rozbieżność nadal scharakteryzowana (musi być wobec bezpośredniego
    // sąsiada, margines poniżej 1e-3 W SKALI JEDNOSTKOWEJ — stąd `trueHitDir`, nie
    // `trueHit`, w rankingu niżej: `trueHit` ma promień planety, więc porównanie na jego
    // skali dawałoby marginesy ×promień za duże) — te dwie własności są niezmienione
    // względem poprzedniej rundy i dalej niosą ciężar dowodu. Istnienie zjawiska jako
    // takiego ma WŁASNY, deterministyczny test niżej (nie zależy od tego, czy losowanie
    // "trafi" na sporną krawędź).
    let checked = 0;
    let mismatches = 0;
    for (const { origin, direction, trueHit, trueHitDir } of samples) {
      const hit = pickCell(planet, origin, direction);
      expect(hit).not.toBeNull();
      const hitId = hit as number;

      const corners = cornersFromGeometry(geometry, hitId);
      if (!insideSphericalPolygon(corners, trueHit)) {
        mismatches++;
        let bestId = -1;
        let bestDot = -Infinity;
        let secondId = -1;
        let secondDot = -Infinity;
        for (let i = 0; i < planet.cells.length; i++) {
          const d = dot(planet.cells[i].normal, trueHitDir);
          if (d > bestDot) {
            secondDot = bestDot;
            secondId = bestId;
            bestDot = d;
            bestId = i;
          } else if (d > secondDot) {
            secondDot = d;
            secondId = i;
          }
        }
        // Charakteryzacja obowiązkowa: KAŻDA rozbieżność musi być wobec bezpośredniego
        // sąsiada, na włos od granicy — nigdy wobec odległej, niepowiązanej komórki (co
        // wskazywałoby na prawdziwy błąd `pickCell`, nie na przybliżenie `dual.ts`). Nie
        // porównujemy z `hitId` (byłaby to asercja wyjścia `pickCell` z samym sobą — Z7 z
        // poprzedniej rundy) — porównujemy z NIEZALEŻNIE (w tej samej pętli, ale osobno)
        // policzonym `bestId`.
        expect(planet.cells[hitId].neighbors).toContain(secondId);
        expect(bestDot - secondDot).toBeLessThan(1e-3);
      }
      checked++;
    }
    expect(checked).toBe(SAMPLE_COUNT);
    // Górne ograniczenie STOPY, nie przypięta liczba — patrz komentarz wyżej.
    expect(mismatches / SAMPLE_COUNT).toBeLessThan(0.03);
  });

  it('14. [DOWÓD NIEZALEŻNOŚCI] gdy corners przestają zgadzać się z normal, test wielokątem to widzi, druga pętla po .normal — nie', () => {
    // Nie mutacja `picking.ts` — mutacja PLANETY, symulująca hipotetyczny (znacznie
    // większy niż zmierzony powyżej) błąd w `dual.ts`, w którym granica wielokąta komórki
    // (`corners`) rozjeżdża się z jej środkiem Voronoi (`normal`). `pickCell` czyta
    // WYŁĄCZNIE `.normal`, więc taki błąd nie zmienia jego odpowiedzi — pytanie brzmi,
    // KTÓRA z dwóch wyroczni powyżej by go wykryła.
    const targetId = 500;
    const target = planet.cells[targetId];

    // Punkt trafienia CELOWO przesunięty od `target.normal` (mieszanka 90/10 z sąsiadem,
    // znormalizowana) — NIE `target.normal` wprost. Gdyby `n === target.normal`, `n` byłby
    // RÓWNOLEGŁY do `target.center` (ten sam kierunek, inna skala): każda kontrola "ta sama
    // strona co centroid" wypadałaby zgodnie z definicji, niezależnie od tego, jakie
    // `corners` by podstawić — degenerat, nie test.
    const neighborNormal = planet.cells[target.neighbors[0]].normal;
    const nudge = 0.1;
    const n = normalize(add(scale(target.normal, 1 - nudge), scale(neighborNormal, nudge)));
    const origin = { x: n.x * planet.radius * 3, y: n.y * planet.radius * 3, z: n.z * planet.radius * 3 };
    const direction = { x: -n.x, y: -n.y, z: -n.z };

    const hit = pickCell(planet, origin, direction);
    expect(hit).toBe(targetId); // `.normal` komórki 500 nietknięte — pickCell nie widzi korupcji
    // Kontrola: prawdziwy (nieskorumpowany) wielokąt 500 rzeczywiście zawiera `n` — inaczej
    // poniższe "wielokąt to widzi" nie miałoby żadnej wartości dowodowej.
    expect(insideSphericalPolygon(cornersFromGeometry(geometry, targetId), n)).toBe(true);

    // Komórka najdalsza od `target` po `.normal` (praktycznie antypoda) — dawca "obcych"
    // corners, o których wiadomo geometrycznie, że NIE mogą zawierać punktu trafienia w
    // `target`.
    let foreignId = -1;
    let worstDot = Infinity;
    for (let i = 0; i < planet.cells.length; i++) {
      const d = dot(planet.cells[i].normal, target.normal);
      if (d < worstDot) {
        worstDot = d;
        foreignId = i;
      }
    }
    expect(foreignId).toBeGreaterThanOrEqual(0);

    const corrupted: Planet = {
      ...planet,
      cells: planet.cells.map((cell, i) =>
        i === targetId ? { ...cell, corners: planet.cells[foreignId].corners } : cell,
      ),
    };
    const corruptedGeometry = buildPlanetGeometry(corrupted);

    // Wyrocznia wielokątowa: ZAUWAŻA. Prawdziwy punkt trafienia nie leży w podstawionym,
    // odległym wielokącie.
    expect(insideSphericalPolygon(cornersFromGeometry(corruptedGeometry, targetId), n)).toBe(false);

    // Druga pętla po `.normal`: NIE MA JAK zauważyć — liczy wyłącznie po `.normal`, którego
    // korupcja nie dotknęła, więc zgadza się z `pickCell` tak samo, jakby nic się nie stało.
    let bestDot = -Infinity;
    let bestId = -1;
    for (let i = 0; i < corrupted.cells.length; i++) {
      const c = corrupted.cells[i].normal;
      const d = c.x * n.x + c.y * n.y + c.z * n.z;
      if (d > bestDot) {
        bestDot = d;
        bestId = i;
      }
    }
    expect(bestId).toBe(targetId); // ślepe na dokładnie tę korupcję
  });

  it('15. [ISTNIENIE, DETERMINISTYCZNE] dla pewnej pary sąsiadów punkt na granicy ich normal leży poza narysowanym wielokątem bliższego', () => {
    // Recenzent: "losowanie 'znajdzie jakąś' [sporną krawędź] jest tym samym rodzajem
    // kruchości co pin, tylko słabszym" — więc istnienie zjawiska z Testu 13 dostaje
    // WŁASNY test, który go NIE losuje. Przegląd DETERMINISTYCZNY (kolejność `planet.cells`
    // i `neighbors` jest stała dla danego seeda) wszystkich par sąsiadów: punkt DOKŁADNIE
    // na granicy "najbliższy środek" między ich `.normal` (średnia znormalizowana — z
    // definicji równoodległa w sensie iloczynu skalarnego), przesunięty o znikomą wartość
    // w stronę `a` (rozstrzyga remis na korzyść `a`), sprawdzony przeciw NARYSOWANEMU
    // wielokątowi `a`. Przerywa na PIERWSZYM znalezisku — nie zależy od tego, KTÓRA para to
    // jest, tylko że JAKAŚ istnieje.
    let found: [number, number] | null = null;
    outer: for (let a = 0; a < planet.cells.length; a++) {
      for (const b of planet.cells[a].neighbors) {
        if (b <= a) continue; // każda para nieuporządkowana raz
        const mid = normalize(add(planet.cells[a].normal, planet.cells[b].normal));
        const eps = 1e-4;
        const p = normalize(add(scale(mid, 1 - eps), scale(planet.cells[a].normal, eps)));
        // sanity: `p` musi faktycznie być (nieznacznie) bliżej `a` niż `b` po `.normal` —
        // inaczej poniższe "poza wielokątem a" nie dowodziłoby rozbieżności z `pickCell`.
        if (dot(p, planet.cells[a].normal) <= dot(p, planet.cells[b].normal)) continue;
        if (!insideSphericalPolygon(cornersFromGeometry(geometry, a), p)) {
          found = [a, b];
          break outer;
        }
      }
    }
    expect(found).not.toBeNull();
  });
});
