import { describe, expect, it, vi } from 'vitest';
import { createPlanet, cross, dot, normalize, scale, type Vec3 } from '@heliopolis/sim';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  clampDistance,
  createCamera,
  distanceLimits,
  focusPosition,
  FIELD_OF_VIEW_DEGREES,
  INITIAL_DISTANCE_FACTOR,
  MAX_DISTANCE_FACTOR,
  MIN_DISTANCE_FACTOR,
  ORBIT_ROTATE_SPEED,
  ORBIT_ZOOM_SPEED,
} from '../src/camera.js';
import { createFakeCanvas } from './support/fakeCanvas.js';
import { CANVAS_HEIGHT_PX, pixelsPerUnit, silhouetteFrameFraction } from './support/pixelScale.js';

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

describe('kadrowanie WIĄŻE progi czytelności Zadań 3 i 4 — skala px/jednostkę', () => {
  it('[KOTWICA NA PRZYRZĄD] skala wynika z INITIAL_DISTANCE_FACTOR i FIELD_OF_VIEW_DEGREES, i wynosi dziś 3,41 px/j', () => {
    // CAŁA metodologia czytelności Fazy 2B („minimum po populacji, w PIKSELACH") stoi na tej
    // jednej liczbie, a jej przesłankami są DWIE stałe `[WYGLĄD]` z tego pliku. Do przeglądu
    // gałęzi nic ich nie wiązało: `INITIAL_DISTANCE_FACTOR 3 → 4,5` i `FIELD_OF_VIEW_DEGREES
    // 50 → 75` dawały 225/225 zielonych, przy skali fałszywej o 35-39 %. Ta kotwica jest po
    // to, żeby zestrojenie kadrowania w Fazie 4 oblało TUTAJ, z nazwą przyczyny, a nie
    // dopiero jako „obwódka ma 0,73 px" w pliku o budynkach.
    //
    // Ta kotwica NIE zabrania zmiany kadrowania. Mówi tylko: zmieniając je, przelicz progi
    // czytelności obu warstw — bo one opisują ekran, a nie świat.
    // Dwie kotwice o RÓŻNYCH zadaniach i dlatego o różnej ciasnocie — pierwsza wersja tego
    // testu pinowała udział kadru do szóstej cyfry i połówka pary „ma PRZEJŚĆ" to złapała:
    // przy takiej ciasnocie NIC nie przechodzi, czyli kotwica przestaje odróżniać „inny
    // wzór" od „inne kadrowanie", a to jest dokładnie wzorzec, który ta runda usuwa z
    // `unitMesh.test.ts`.
    //
    // (1) udział kadru — kotwica na WZÓR, nie na wartość stałych. Błędne wyprowadzenie różni
    //     się o 6 % (patrz kontrola negatywna niżej), więc luźny próg w zupełności wystarcza.
    expect(silhouetteFrameFraction()).toBeCloseTo(0.758198, 2);
    // (2) skala — kotwica na POMIAR: to przy niej zmierzono wszystkie progi pikselowe Zadań 3
    //     i 4, więc to ona ma oblewać przy zestrojeniu kadrowania. Ona jest tu wiążąca.
    expect(pixelsPerUnit(radius)).toBeCloseTo(3.41, 2);
    expect(radius).toBe(100); // przesłanka kotwicy: to promień planety-fixture, nie dowolny

    // KONTROLA POZYTYWNA NA SAM PRZYRZĄD: skala ma REAGOWAĆ na oba wejścia. Bez tego
    // „3,41" mogłoby pochodzić ze stałej przebranej za rachunek.
    expect(pixelsPerUnit(radius * 2)).toBeCloseTo(pixelsPerUnit(radius) / 2, 9);
    expect(pixelsPerUnit(radius)).toBeCloseTo(
      (silhouetteFrameFraction() * CANVAS_HEIGHT_PX) / (2 * radius),
      9,
    );

    // KONTROLA NEGATYWNA: wyprowadzenie obalone w `f71d499` — naiwne `R/d` zamiast
    // `tan(asin(R/d))` — daje 0,714836 i 3,2168 px/j, czyli dokładnie tę liczbę (3,22), w
    // której policzona jest cała dokumentacja pikselowa sprzed tej rundy. Dzielenie przez
    // odległość SKOŚNĄ od kamery zamiast OSIOWEJ daje ją tak samo. Przypięte tutaj, żeby
    // powrót do niej był zmianą, którą widać w diffie tego testu, a nie cichym regresem.
    // Asercje RELACYJNE, nie przypięte liczby — bo naiwny wzór też zależy od tych samych
    // stałych, więc kotwica na jego dzisiejszą wartość byłaby TRZECIM strażnikiem kadrowania
    // przebranym za kontrolę wzoru (przy dzisiejszych stałych daje 0,714836 i 3,2168 px/j).
    const naiveFraction = 1 / INITIAL_DISTANCE_FACTOR / Math.tan((FIELD_OF_VIEW_DEGREES * Math.PI) / 360);
    expect(naiveFraction).toBeLessThan(silhouetteFrameFraction()); // ZANIŻA, czyli niezachowawczo
    expect(naiveFraction).not.toBeCloseTo(silhouetteFrameFraction(), 2); // i to nie o zaokrąglenie
    expect((naiveFraction * CANVAS_HEIGHT_PX) / (2 * radius)).toBeLessThan(pixelsPerUnit(radius));
  });

  it('pixelsPerUnit rzuca RangeError zamiast oddać cichy NaN', () => {
    // Cichy `NaN` przeniósłby się na KAŻDY próg pikselowy obu plików, a `expect(NaN)`
    // oblewa komunikatem o obwódce, nie o kamerze. Ten sam powód, co strażniki w `camera.ts`.
    expect(() => pixelsPerUnit(0)).toThrow(RangeError);
    expect(() => pixelsPerUnit(-1)).toThrow(RangeError);
    expect(() => pixelsPerUnit(Number.NaN)).toThrow(RangeError);
  });
});

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

  // Czułość sterowania była jedynym parametrem odczucia z kamery bez stałej i bez taga
  // [WYGLĄD] — wynikała milcząco z domyślnych Three.js. Dwie rzeczy warte sprawdzenia, i
  // każda łapie inną regresję.
  it('createCamera USTAWIA czułość obrotu i zoomu z naszych stałych [WYGLĄD]', () => {
    // UWAGA na pułapkę, w którą sam wpadłem pisząc ten test i zmierzyłem to: oczywista
    // wersja — złap instancję `OrbitControls` i sprawdź `controls.rotateSpeed ===
    // ORBIT_ROTATE_SPEED` — jest TAUTOLOGIĄ. Nasze stałe są równe domyślnym biblioteki, więc
    // pole ma tę wartość NIEZALEŻNIE od tego, czy `createCamera` cokolwiek przypisuje.
    // Zmierzone: po usunięciu obu przypisań ze źródła tamta wersja zostawiała 22/22 zielone.
    //
    // Ten wariant sprawdza SAM FAKT PRZYPISANIA, nie wartość końcową: akcesor podstawiony na
    // prototypie przechwytuje każdy zapis (konstruktor `OrbitControls` robi
    // `this.rotateSpeed = 1.0`, czyli zwykłe przypisanie, więc trafia w setter z prototypu
    // zamiast tworzyć własne pole). Konstruktor daje pierwszy zapis, `createCamera` musi dać
    // drugi.
    const proto = OrbitControls.prototype as unknown as Record<string, unknown>;
    const writes: Record<'rotateSpeed' | 'zoomSpeed', number[]> = { rotateSpeed: [], zoomSpeed: [] };
    const original = {
      rotateSpeed: Object.getOwnPropertyDescriptor(proto, 'rotateSpeed'),
      zoomSpeed: Object.getOwnPropertyDescriptor(proto, 'zoomSpeed'),
    };
    for (const key of ['rotateSpeed', 'zoomSpeed'] as const) {
      const slot = `__test_${key}`;
      Object.defineProperty(proto, key, {
        configurable: true,
        get(this: Record<string, unknown>): unknown {
          return this[slot];
        },
        set(this: Record<string, unknown>, value: number): void {
          this[slot] = value;
          writes[key].push(value);
        },
      });
    }

    let camera: ReturnType<typeof createCamera> | null = null;
    try {
      camera = createCamera(createFakeCanvas(), radius);
    } finally {
      for (const key of ['rotateSpeed', 'zoomSpeed'] as const) {
        delete proto[key];
        if (original[key]) Object.defineProperty(proto, key, original[key]);
      }
    }

    // Kontrola pozytywna na sam przyrząd: akcesor NAPRAWDĘ przechwycił zapis konstruktora —
    // bez tego "dwa zapisy" nie dałoby się odróżnić od "przyrząd nic nie widzi".
    expect(writes.rotateSpeed.length).toBeGreaterThan(0);
    expect(writes.zoomSpeed.length).toBeGreaterThan(0);
    // Dwa zapisy: konstruktor biblioteki + nasze jawne przypisanie.
    expect(writes.rotateSpeed.length).toBeGreaterThanOrEqual(2);
    expect(writes.zoomSpeed.length).toBeGreaterThanOrEqual(2);
    expect(writes.rotateSpeed[writes.rotateSpeed.length - 1]).toBe(ORBIT_ROTATE_SPEED);
    expect(writes.zoomSpeed[writes.zoomSpeed.length - 1]).toBe(ORBIT_ZOOM_SPEED);
    camera?.dispose();
  });

  it('[NIEZMIENNIK K1] przesuwanie jest WYŁĄCZONE, a środek orbity zostaje w środku planety', () => {
    // Cały model kamery K1 stoi na tym, że planeta jest wyśrodkowana, a orbitowanie zmienia
    // WYŁĄCZNIE kąt i odległość. `OrbitControls` domyślnie wiąże przesuwanie z PRAWYM
    // przyciskiem i pozwala odsunąć `target` od (0,0,0) — czyli złamać ten niezmiennik.
    // Od Fazy 2C prawy przycisk to rozbiórka, więc przeciągnięcie nim rozbijałoby kadr
    // i jednocześnie wysyłało komendę. Do rundy naprawczej 1 ani `enablePan = false`,
    // ani zerowanie `target` w `focusOn` nie były sprawdzone NICZYM w całym repozytorium:
    // obie mutacje zostawiały pakiet zielony.
    //
    // Sprawdzany jest SAM FAKT PRZYPISANIA (akcesor na prototypie), z tego samego powodu
    // co przy czułości wyżej — `enablePan` ma domyślnie `true`, więc odczyt wartości
    // końcowej byłby tautologią dla mutacji „usuń przypisanie" tylko wtedy, gdyby domyślna
    // była `false`. Tu domyślna jest PRZECIWNA, więc wartość końcowa wystarcza; akcesor
    // dokłada do tego dowód, że to MY ją ustawiamy, a nie biblioteka zmieniła domyślną.
    const proto = OrbitControls.prototype as unknown as Record<string, unknown>;
    const panWrites: boolean[] = [];
    // Instancja `OrbitControls` przechwycona przez akcesor — potrzebna, żeby PO zdjęciu
    // akcesora z prototypu przepisać wartości do pól WŁASNYCH obiektu. Bez tego kamera
    // zostaje z `controls.target === undefined` i `focusOn` wywala się na atrapie
    // przyrządu zamiast na własności, którą test bada.
    let instance: Record<string, unknown> | null = null;
    const targets: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }[] = [];
    const originalPan = Object.getOwnPropertyDescriptor(proto, 'enablePan');
    const originalTarget = Object.getOwnPropertyDescriptor(proto, 'target');
    Object.defineProperty(proto, 'enablePan', {
      configurable: true,
      get(this: Record<string, unknown>): unknown {
        return this.__test_enablePan;
      },
      set(this: Record<string, unknown>, value: boolean): void {
        this.__test_enablePan = value;
        instance = this;
        panWrites.push(value);
      },
    });
    Object.defineProperty(proto, 'target', {
      configurable: true,
      get(this: Record<string, unknown>): unknown {
        return this.__test_target;
      },
      set(this: Record<string, unknown>, value: unknown): void {
        this.__test_target = value;
        instance = this;
        targets.push(value as (typeof targets)[number]);
      },
    });

    let camera: ReturnType<typeof createCamera> | null = null;
    try {
      camera = createCamera(createFakeCanvas(), radius);
    } finally {
      delete proto.enablePan;
      delete proto.target;
      if (originalPan) Object.defineProperty(proto, 'enablePan', originalPan);
      if (originalTarget) Object.defineProperty(proto, 'target', originalTarget);
      const held = instance as Record<string, unknown> | null;
      if (held !== null) {
        held.enablePan = held.__test_enablePan;
        held.target = held.__test_target;
      }
    }

    // Kontrola pozytywna na przyrząd: akcesor NAPRAWDĘ przechwycił zapis konstruktora.
    expect(panWrites.length).toBeGreaterThan(0);
    expect(targets.length).toBeGreaterThan(0);
    // Konstruktor biblioteki pisze `true`, `createCamera` musi dopisać `false` PO nim.
    expect(panWrites[0]).toBe(true);
    expect(panWrites[panWrites.length - 1]).toBe(false);

    // Środek orbity: `focusOn` ma go ZEROWAĆ, a nie tylko zastać w zerze. Odsuwamy go
    // ręcznie — tak, jak zrobiłoby przesuwanie, gdyby ktoś je z powrotem włączył — i
    // sprawdzamy, że skrót „wróć do Core" przywraca niezmiennik.
    const orbitTarget = targets[targets.length - 1];
    expect([orbitTarget.x, orbitTarget.y, orbitTarget.z]).toEqual([0, 0, 0]);
    orbitTarget.set(5, -7, 11);
    camera?.focusOn(target);
    expect([orbitTarget.x, orbitTarget.y, orbitTarget.z]).toEqual([0, 0, 0]);
    camera?.dispose();
  });

  it('nasze stałe czułości są DOKŁADNIE dzisiejszymi domyślnymi Three.js — zmiana w bibliotece ma być widoczna, nie cicha', () => {
    // Cały zamiar wpisania tych stałych to „niczego dziś nie zmieniamy, ale wartość jest
    // nasza i jawna". Ten test pilnuje obu połówek naraz: gdyby ktoś zmienił nasze stałe,
    // oblewa (i słusznie — to zmiana odczucia sterowania, ma być świadoma); gdyby
    // aktualizacja Three.js zmieniła domyślne, też oblewa — i wtedy jest to decyzja do
    // podjęcia (iść za biblioteką czy zostać przy swoim), nie cicha zmiana pod ręką gracza.
    const defaults = new OrbitControls(
      createCamera(createFakeCanvas(), radius).object,
      createFakeCanvas(),
    );
    expect(ORBIT_ROTATE_SPEED).toBe(defaults.rotateSpeed);
    expect(ORBIT_ZOOM_SPEED).toBe(defaults.zoomSpeed);
    defaults.dispose();
  });
});
