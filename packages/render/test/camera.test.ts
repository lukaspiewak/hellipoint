import { describe, expect, it, vi } from 'vitest';
import { createPlanet, cross, dot, normalize, scale, type Vec3 } from '@heliopolis/sim';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  clampDistance,
  createCamera,
  distanceLimits,
  focusPosition,
  MAX_DISTANCE_FACTOR,
  MIN_DISTANCE_FACTOR,
} from '../src/camera.js';
import { createFakeCanvas } from './support/fakeCanvas.js';

// Ta sama planeta-fixture co geometry.test.ts/shading.test.ts (ten sam seed) — jedna
// "prawdziwa planeta", o której mówią wszystkie pliki testowe tego pakietu.
const planet = createPlanet({ seed: 20260915 });
const radius = planet.radius;

// Dowolna, nieszczególna komórka (nie 0, nie środek listy, nie pentagon) — cel testów
// focusOn ma być OGÓLNY wektor 3D, nie przypadek szczególny (oś, biegun).
const target: Vec3 = planet.cells[733].center;
const targetDirection = normalize(target);

/**
 * Jednostkowy wektor PROSTOPADŁY do `direction` — konstrukcja iloczynem wektorowym
 * z osią odniesienia (Y, albo X gdyby `direction` leżało zbyt blisko Y). Iloczyn
 * wektorowy dwóch wektorów nierównoległych jest z DEFINICJI prostopadły do obu —
 * `dot(orthogonalUnit(d), d) === 0` co do zaokrąglenia float, nie w przybliżeniu.
 */
function orthogonalUnit(direction: Vec3): Vec3 {
  const reference: Vec3 = Math.abs(direction.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(direction, reference));
}

// Odległość startowa współdzielona przez start1/start2 — MUSI być ta sama dla obu,
// bo test determinizmu (4) porównuje wyniki dwóch startów wprost, a focusOn ma
// zachowywać odległość (2): różne odległości startowe dałyby różne wyniki z
// zupełnie poprawnego focusOn, nie tylko z zepsutego.
const sharedDistance = radius * 2.7;

// Dwie pozycje startowe MAKSYMALNIE niekorzystne względem `target`, skonstruowane
// analitycznie (nie "losowo"), tak żeby żaden przypadek nie mógł ich pomylić z
// kamerą "już mniej więcej" patrzącą we właściwą stronę:
//   - antypodalna: dot(start, target) == -1 (patrzy dokładnie w przeciwną stronę)
//   - ortogonalna: dot(start, target) == 0  (patrzy o 90° w bok)
// Obie leżą poza jakimkolwiek oknem, w którym luźny próg w rodzaju `dot > 0,9`
// mógłby przepuścić focusOn, który nic nie robi — a to jest dokładnie ryzyko, o które
// pyta brief ("czy testy focusOn przeszłyby, gdyby focusOn nic nie robiło").
// Reużywane w teście determinizmu (4): to samo dwa starty, ta sama `sharedDistance`.
const antipodalStart: Vec3 = scale(targetDirection, -sharedDistance);
const orthogonalStart: Vec3 = scale(orthogonalUnit(targetDirection), sharedDistance);

describe('distanceLimits / clampDistance — matematyka zoomu (funkcje czyste)', () => {
  it('MIN_DISTANCE_FACTOR i MAX_DISTANCE_FACTOR mają sensowne, absolutne wartości', () => {
    // Nie tylko relacja wobec samych siebie (patrz M8 z Zadania 3: stała może się
    // zdegenerować w sposób wewnętrznie spójny) — sprawdzenie WPROST, że dolny limit
    // trzyma kamerę NAD powierzchnią (>1) i że górny jest od niego wyraźnie dalej.
    expect(MIN_DISTANCE_FACTOR).toBeGreaterThan(1);
    expect(MAX_DISTANCE_FACTOR).toBeGreaterThan(MIN_DISTANCE_FACTOR);
    expect(Number.isFinite(MAX_DISTANCE_FACTOR)).toBe(true);
  });

  it('distanceLimits(radius) zwraca dokładnie radius × czynniki', () => {
    const limits = distanceLimits(radius);
    expect(limits.min).toBeCloseTo(radius * MIN_DISTANCE_FACTOR, 9);
    expect(limits.max).toBeCloseTo(radius * MAX_DISTANCE_FACTOR, 9);
  });

  it('clampDistance przycina wartość PONIŻEJ minimum do DOKŁADNIE minimum', () => {
    const result = clampDistance(radius * 0.01, radius);
    expect(result).toBeCloseTo(radius * MIN_DISTANCE_FACTOR, 9);
  });

  it('clampDistance przycina wartość POWYŻEJ maksimum do DOKŁADNIE maksimum', () => {
    const result = clampDistance(radius * 1000, radius);
    expect(result).toBeCloseTo(radius * MAX_DISTANCE_FACTOR, 9);
  });

  it('clampDistance NIE rusza wartości już wewnątrz zakresu (nie jest stałym przycinaniem)', () => {
    const inRange = radius * 4;
    expect(clampDistance(inRange, radius)).toBeCloseTo(inRange, 9);
  });

  it('rzuca RangeError dla nieprawidłowego (niedodatniego) promienia', () => {
    expect(() => distanceLimits(0)).toThrow(RangeError);
    expect(() => clampDistance(radius, -5)).toThrow(RangeError);
  });
});

describe('focusPosition — matematyka focusOn (funkcja czysta, zero Three.js)', () => {
  // Brief, Krok 1, punkt 1: dot(normalize(camera.position), normalize(target)) > 0,999.
  it('kierunek wyniku pokrywa się z normalną komórki, z pozycji antypodalnej', () => {
    const result = focusPosition(antipodalStart, target, radius);
    expect(dot(normalize(result), targetDirection)).toBeGreaterThan(0.999);
  });

  it('kierunek wyniku pokrywa się z normalną komórki, z pozycji ortogonalnej', () => {
    const result = focusPosition(orthogonalStart, target, radius);
    expect(dot(normalize(result), targetDirection)).toBeGreaterThan(0.999);
  });

  // Brief, punkt 2: focusOn zachowuje odległość (zoom nie skacze przy powrocie do bazy).
  // Odległość startowa CELOWO inna niż `sharedDistance` powyżej i inna niż jakikolwiek
  // "okrągły" domyślny dystans z camera.ts (np. INITIAL_DISTANCE_FACTOR) — gdyby
  // focusOn po cichu resetował zoom do jakiejś wbudowanej wartości domyślnej zamiast
  // zachowywać bieżącą, ten test by to złapał (wynik wyszedłby równy tamtej stałej,
  // nie `startDistance`).
  //
  // UWAGA (znalezione własnym poluchem mutacyjnym, patrz task-4-report.md): start
  // musi być w NIEWŁAŚCIWYM kierunku (tu: antypodalnym), więc żeby test przeszedł,
  // wynik MUSI faktycznie zmienić kierunek. Pierwsza wersja tego testu startowała z
  // kierunku ortogonalnego o długości `startDistance` i sprawdzała WYŁĄCZNIE długość
  // wyniku — `focusPosition` zamienione na `return currentPosition` (kompletny no-op)
  // przechodziło ten test, bo start już miał żądaną długość z konstrukcji. Test
  // sprawdza teraz OBA warunki naraz: kierunek MUSI się zgadzać z `target` (czego no-op
  // nie da) I odległość musi zostać zachowana (czego reset-do-domyślnej nie da).
  it('zachowuje odległość od środka planety (zoom nie skacze), przy jednoczesnej zmianie kierunku', () => {
    const startDistance = radius * 4.65;
    const start = scale(targetDirection, -startDistance); // antypodalny — no-op da dot ≈ -1
    const result = focusPosition(start, target, radius);
    expect(dot(normalize(result), targetDirection)).toBeGreaterThan(0.999);
    expect(Math.hypot(result.x, result.y, result.z)).toBeCloseTo(startDistance, 6);
  });

  // Brief, punkt 4: dwie różne pozycje startowe → ten sam wynik końcowy.
  it('determinizm: ta sama komórka z dwóch różnych startów (tej samej odległości) daje TEN SAM wynik', () => {
    const fromAntipodal = focusPosition(antipodalStart, target, radius);
    const fromOrthogonal = focusPosition(orthogonalStart, target, radius);
    expect(fromAntipodal.x).toBeCloseTo(fromOrthogonal.x, 9);
    expect(fromAntipodal.y).toBeCloseTo(fromOrthogonal.y, 9);
    expect(fromAntipodal.z).toBeCloseTo(fromOrthogonal.z, 9);
  });

  it('odległość wyniku jest przycięta do zakresu, nawet gdy start był poza nim', () => {
    const tooClose = scale(orthogonalUnit(targetDirection), radius * 0.001);
    const result = focusPosition(tooClose, target, radius);
    expect(Math.hypot(result.x, result.y, result.z)).toBeCloseTo(radius * MIN_DISTANCE_FACTOR, 6);
  });

  it('rzuca RangeError dla zerowego wektora celu', () => {
    expect(() => focusPosition(antipodalStart, { x: 0, y: 0, z: 0 }, radius)).toThrow(RangeError);
  });
});

describe('createCamera / OrbitCamera.focusOn — to samo spięte z prawdziwym OrbitControls (bez przeglądarki)', () => {
  // `createFakeCanvas` daje `OrbitControls` dokładnie tyle DOM, ile faktycznie czyta
  // (patrz komentarz w support/fakeCanvas.ts) — więc to ćwiczy PRAWDZIWY, zaimplementowany
  // `focusOn`, a nie tylko `focusPosition` w izolacji. To jest odpowiedź na pytanie z
  // huntu: "czy testy focusOn przeszłyby, gdyby focusOn nic nie robiło" — z pozycji
  // antypodalnej/ortogonalnej, no-op zostawiłby dot ≈ -1 albo ≈ 0, więc próg 0,999 misses
  // it clearly.
  interface PositionSnapshot {
    x: number;
    y: number;
    z: number;
  }

  function focusFrom(start: Vec3): PositionSnapshot {
    const camera = createCamera(createFakeCanvas(), radius);
    camera.object.position.set(start.x, start.y, start.z);
    camera.focusOn(target);
    const { x, y, z } = camera.object.position;
    camera.dispose();
    return { x, y, z };
  }

  it('focusOn z pozycji antypodalnej trafia w komórkę (dot > 0,999)', () => {
    const result = focusFrom(antipodalStart);
    expect(dot(normalize(result), targetDirection)).toBeGreaterThan(0.999);
  });

  it('focusOn z pozycji ortogonalnej trafia w komórkę (dot > 0,999)', () => {
    const result = focusFrom(orthogonalStart);
    expect(dot(normalize(result), targetDirection)).toBeGreaterThan(0.999);
  });

  // UWAGA (poluch mutacyjny, patrz task-4-report.md): start MUSI być w niewłaściwym
  // kierunku (antypodalnym), inaczej sam czek długości przechodzi nawet dla focusOn,
  // które nic nie robi — bo start już ma żądaną długość z konstrukcji. Sprawdzone oba
  // warunki naraz z tego samego powodu co w teście czystej funkcji wyżej.
  it('focusOn na prawdziwej kamerze zachowuje odległość, przy jednoczesnej zmianie kierunku', () => {
    const camera = createCamera(createFakeCanvas(), radius);
    camera.object.position.set(antipodalStart.x, antipodalStart.y, antipodalStart.z);
    camera.focusOn(target);
    expect(dot(normalize(camera.object.position), targetDirection)).toBeGreaterThan(0.999);
    expect(camera.object.position.length()).toBeCloseTo(sharedDistance, 4);
    camera.dispose();
  });

  it('focusOn jest deterministyczny między dwiema NIEZALEŻNYMI kamerami z różnych startów', () => {
    const fromAntipodal = focusFrom(antipodalStart);
    const fromOrthogonal = focusFrom(orthogonalStart);
    expect(fromAntipodal.x).toBeCloseTo(fromOrthogonal.x, 3);
    expect(fromAntipodal.y).toBeCloseTo(fromOrthogonal.y, 3);
    expect(fromAntipodal.z).toBeCloseTo(fromOrthogonal.z, 3);
  });

  it('zoom jest ograniczony z obu stron: przybliżenie poza limit zostaje przycięte', () => {
    const camera = createCamera(createFakeCanvas(), radius);
    camera.object.position.set(0, 0, radius * 0.001);
    camera.update();
    expect(camera.object.position.length()).toBeCloseTo(radius * MIN_DISTANCE_FACTOR, 3);
    camera.dispose();
  });

  it('zoom jest ograniczony z obu stron: oddalenie poza limit zostaje przycięte', () => {
    const camera = createCamera(createFakeCanvas(), radius);
    camera.object.position.set(0, 0, radius * 10000);
    camera.update();
    expect(camera.object.position.length()).toBeCloseTo(radius * MAX_DISTANCE_FACTOR, 3);
    camera.dispose();
  });

  it('dispose() nie rzuca (OrbitControls poprawnie odłączony od atrapy canvasu)', () => {
    const camera = createCamera(createFakeCanvas(), radius);
    expect(() => camera.dispose()).not.toThrow();
  });

  // Runda poprawek 1: przegląd zmierzył, że wypatroszenie dispose() (we wszystkich trzech
  // modułach Zadania 4) do pustej funkcji zostawiało komplet testów zielonym — "nie rzuca"
  // wyżej przechodzi identycznie, czy dispose() coś robi, czy nic. Ten test sprawdza SKUTEK
  // (czy `OrbitControls.dispose` faktycznie się wykonał), szpiegując na prototypie klasy —
  // `controls` jest lokalną zmienną w domknięciu `createCamera`, więc nie da się złapać jej
  // PO INSTANCJI z zewnątrz.
  it('dispose() faktycznie woła OrbitControls.dispose() (nie tylko nie rzuca)', () => {
    const disposeSpy = vi.spyOn(OrbitControls.prototype, 'dispose');
    const camera = createCamera(createFakeCanvas(), radius);

    camera.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    disposeSpy.mockRestore();
  });
});
