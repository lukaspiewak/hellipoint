import { describe, expect, it } from 'vitest';
import { Mesh, Vector3, type BufferAttribute, type BufferGeometry, type Color, type Object3D, type Scene } from 'three';
import { createPlanet, lightField, sunDirection } from '@heliopolis/sim';
import {
  aimDirection,
  buildCameraOffsets,
  createReadabilityGate,
  formatGateResultsMarkdown,
  markerPosition,
  markerRingRadius,
  CAMERA_OFFSET_MAX_DEGREES,
  CAMERA_OFFSET_MIN_DEGREES,
  type GateAnswerRecord,
  type GateMode,
  type GatePlans,
  type ReadabilityGate,
} from '../src/readabilityGate.js';
import { buildGateTrials, type GateTrial } from '../src/terminatorPairs.js';
import { buildPlanetGeometry } from '../src/geometry.js';
import { buildSmearedGeometry, writeSmearedColors } from '../src/positiveControl.js';
import { DEFAULT_PALETTE, lightBand, writeCellColors } from '../src/shading.js';
import type { SceneRenderer } from '../src/scene.js';
import { createFakeCanvas } from './support/fakeCanvas.js';

const planet = createPlanet({ seed: 20260915 });
const sharedGeo = buildPlanetGeometry(planet);
const smearedGeo = buildSmearedGeometry(planet);
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const CELLS_PER_PHASE = 5;

const gateSunDirs = [0, 1 / 3, 2 / 3].map((f) => sunDirection(f * 180, 180));

/** Trzy rozłączne plany, dokładnie jak buduje je `apps/client/src/gate.ts`. */
function realPlans(cellsPerPhase = CELLS_PER_PHASE): GatePlans {
  return {
    threshold: buildGateTrials(planet, gateSunDirs, cellsPerPhase, 0),
    smooth: buildGateTrials(planet, gateSunDirs, cellsPerPhase, 1),
    control: buildGateTrials(planet, gateSunDirs, cellsPerPhase, 2),
  };
}

function createFakeRenderer(): SceneRenderer & { renderCalls: number; disposeCalls: number; lastScene: Scene | null } {
  const renderer = {
    renderCalls: 0,
    disposeCalls: 0,
    lastScene: null as Scene | null,
    render(scene: Scene): void {
      renderer.renderCalls++;
      renderer.lastScene = scene;
    },
    setSize(): void {},
    setPixelRatio(): void {},
    setClearColor(): void {},
    dispose(): void {
      renderer.disposeCalls++;
    },
  };
  return renderer;
}

function makeGate(
  plans: GatePlans = realPlans(),
  fullScene = false,
): {
  gate: ReadabilityGate;
  renderer: ReturnType<typeof createFakeRenderer>;
} {
  const renderer = createFakeRenderer();
  const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), plans, {
    makeRenderer: () => renderer,
    fullScene,
  });
  return { gate, renderer };
}

/**
 * Siatki wyjęte ze SCENY, którą harness faktycznie przekazuje rendererowi — nie przez nowe
 * pole w API zbudowane pod test. Scena jest tym, co renderer dostaje do narysowania, więc
 * odczyt z niej sprawdza dokładnie to, co zobaczy człowiek.
 */
function meshesOf(gate: ReadabilityGate, renderer: { lastScene: Scene | null }): { flat: Mesh; smeared: Mesh } {
  gate.renderFrame();
  const scene = renderer.lastScene;
  if (!scene) throw new Error('test: renderer nie dostał sceny');
  const meshes = scene.children.filter((o): o is Mesh => o instanceof Mesh);
  const flat = meshes.find((m) => m.geometry.getAttribute('position').count === sharedGeo.positions.length / 3);
  const smeared = meshes.find((m) => m.geometry.getAttribute('position').count === smearedGeo.vertexCount);
  if (!flat || !smeared) throw new Error('test: brak którejś z dwóch siatek w scenie');
  return { flat, smeared };
}

function colorsOf(mesh: Mesh): Float32Array {
  return (mesh.geometry.getAttribute('color') as BufferAttribute).array as Float32Array;
}

function cellColorFlat(colors: Float32Array, cellId: number): [number, number, number] {
  const o = sharedGeo.cellVertexStart[cellId] * 3;
  return [colors[o], colors[o + 1], colors[o + 2]];
}

function cellColorSmeared(colors: Float32Array, cellId: number): [number, number, number] {
  return [colors[cellId * 3], colors[cellId * 3 + 1], colors[cellId * 3 + 2]];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const NIGHT = DEFAULT_PALETTE[0].map(Math.fround);
const isGreenDominant = (c: Color): boolean => c.g > c.r && c.g > c.b;
const isRedDominant = (c: Color): boolean => c.r > c.g && c.r > c.b;
const isNeutral = (c: Color): boolean => c.r === c.g && c.g === c.b;

/** Przechodzi cały plan aktywnego trybu, odpowiadając wg `strategy`. Zwraca log tego trybu. */
function runPlan(gate: ReadabilityGate, strategy: (trial: GateTrial) => boolean): readonly GateAnswerRecord[] {
  const mode = gate.mode();
  let guard = 0;
  while (!gate.isFinished() && guard <= gate.totalTrials) {
    const trial = gate.currentTrial();
    if (!trial) break;
    gate.answer(strategy(trial));
    gate.advance();
    guard++;
  }
  return gate.answersFor(mode);
}

describe('createReadabilityGate — konstrukcja i walidacja planów', () => {
  it('1. budowa harnessu zostawia Planet bit w bit identyczny', () => {
    const before = JSON.stringify(planet);
    const { gate } = makeGate();
    expect(JSON.stringify(planet)).toBe(before);
    gate.dispose();
  });

  it('2. rzuca RangeError, gdy którykolwiek plan jest pusty', () => {
    const plans = realPlans();
    for (const mode of ['threshold', 'smooth', 'control'] as const) {
      expect(() =>
        createReadabilityGate(planet, createFakeCanvas(), { ...plans, [mode]: [] }, { makeRenderer: () => createFakeRenderer() }),
      ).toThrow(RangeError);
    }
    // Kontrola pozytywna: komplet niepustych planów NIE rzuca.
    const { gate } = makeGate(plans);
    gate.dispose();
  });

  it('3. rzuca RangeError, gdy plany mają różne długości — "piętnaście prób" musi znaczyć jedno', () => {
    const plans = realPlans();
    expect(() =>
      createReadabilityGate(planet, createFakeCanvas(), { ...plans, control: plans.control.slice(0, 14) }, { makeRenderer: () => createFakeRenderer() }),
    ).toThrow(RangeError);
  });

  it('4. [WŁASNOŚĆ KRYTYCZNA DLA KONTROLI] rzuca RangeError, gdy dwa plany dzielą komórkę w tej samej fazie', () => {
    // Plan kontrolny na komórce już odsłoniętej w planie ocenianym mierzyłby PAMIĘĆ
    // człowieka, nie czytelność renderu — czyli kontrola przestałaby móc oblać dokładnie
    // tam, gdzie cała jej wartość polega na tym, że może.
    const plans = realPlans();
    expect(() =>
      createReadabilityGate(planet, createFakeCanvas(), { ...plans, control: plans.threshold }, { makeRenderer: () => createFakeRenderer() }),
    ).toThrow(RangeError);

    // Kontrola pozytywna: plany z `buildGateTrials` o trzech różnych offsetach NIE rzucają —
    // więc powyższy rzut jest o rozłączność, nie o cokolwiek innego w walidacji.
    const { gate } = makeGate(plans);
    expect(gate.totalTrials).toBe(15);
    gate.dispose();
  });
});

describe('markerPosition — funkcja czysta', () => {
  it('5. [ZEROWA PARALAKSA] znacznik leży DOKŁADNIE na promieniu widzenia przechodzącym przez środek komórki, pod każdym kątem', () => {
    // Własność, którą Krok 1 Zadania 5 czyni KONIECZNĄ: kamera nie celuje już w pytaną
    // komórkę, więc uniesienie wzdłuż normalnej (tak było do tego zadania) przesuwałoby
    // pierścień względem jego komórki o `uniesienie × tan θ`. Pierścień wskazujący nie tę
    // komórkę, o którą bramka pyta, unieważnia odpowiedź — a ta wada byłaby NIEWIDOCZNA dla
    // każdego testu porównującego znacznik z samą tylko komórką.
    //
    // Mierzone jako współliniowość kamera–znacznik–środek komórki, czyli dokładnie to, co
    // znaczy „rzutuje się w to samo miejsce ekranu", niezależnie od rzutowania.
    for (const cellId of [0, 733, planet.cells.length - 1]) {
      const cell = planet.cells[cellId];
      const centre = new Vector3(cell.center.x, cell.center.y, cell.center.z);
      const normal = new Vector3(cell.normal.x, cell.normal.y, cell.normal.z);
      // Kamery odchylone od normalnej o 0°, 20° i 60° — od przypadku zdegenerowanego
      // (dawne zachowanie) po skrajny, do jakiego człowiek może doorbitować.
      const lifts: number[] = [];
      for (const degrees of [0, 20, 60]) {
        const offset = { polarRad: (degrees * Math.PI) / 180, azimuthRad: 1.1 };
        const aim = aimDirection(planet, cellId, offset);
        const camera = new Vector3(aim.x, aim.y, aim.z).multiplyScalar(planet.radius * 3);
        const pos = markerPosition(planet, cellId, camera);
        const marker = new Vector3(pos.x, pos.y, pos.z);

        // WSPÓŁLINIOWOŚĆ: znacznik leży na odcinku kamera → środek komórki.
        const toCamera = camera.clone().sub(centre).normalize();
        const toMarker = marker.clone().sub(centre);
        expect(toMarker.length(), `${degrees}°`).toBeGreaterThan(0);
        expect(toMarker.clone().normalize().dot(toCamera), `${degrees}°`).toBeCloseTo(1, 9);

        // UNIESIENIE ROŚNIE Z KĄTEM: pod kątem stycznym powierzchnia po jednej stronie
        // pierścienia podnosi się ku kamerze, więc stałe uniesienie dałoby obcięty znacznik.
        // Tu sprawdzana jest MONOTONICZNOŚĆ i sensowne granice; czy uniesienie WYSTARCZA,
        // mierzy test 5b — niezależnym przyrządem (przecięcie promienia z kulą), a nie
        // powtórzeniem wzoru z modułu, które byłoby prawdziwe z konstrukcji.
        lifts.push(toMarker.length());
        expect(toMarker.length(), `${degrees}°`).toBeGreaterThan(0);
        expect(toMarker.length(), `${degrees}°`).toBeLessThan(planet.radius * 0.2);

        // KONTROLA POZYTYWNA NA SAM POMIAR: przy 0° znacznik pokrywa się z dawnym
        // zachowaniem (wzdłuż normalnej), przy 60° JUŻ NIE — inaczej „współliniowość"
        // byłaby prawdziwa trywialnie, bo obie definicje dawałyby to samo.
        const alongNormal = toMarker.clone().normalize().dot(normal);
        // Przy 20° radialnych kierunek NA KAMERĘ tworzy z normalną 29,4° (kamera stoi w
        // skończonej odległości `3R`, więc kąt przy komórce jest większy od radialnego), przy
        // 60° — 79,1°. Próg 0,95 (18°) odcina oba od przypadku „to jednak normalna".
        if (degrees === 0) expect(alongNormal).toBeCloseTo(1, 9);
        else expect(alongNormal).toBeLessThan(0.95);
      }
      expect(lifts[1], `komórka ${cellId}`).toBeGreaterThan(lifts[0]);
      expect(lifts[2], `komórka ${cellId}`).toBeGreaterThan(lifts[1]);
    }
  });

  it('5b. [PRZYCINANIE] cała tarcza znacznika jest bliżej kamery niż kula — dla KAŻDEJ komórki prób i każdego kąta patrzenia do 45°', () => {
    // `Sprite` w Three.js ma JEDNĄ głębokość widoku dla wszystkich swoich pikseli
    // (wierzchołki przesuwane w płaszczyźnie XY kamery, `mvPosition.z` ten sam), więc
    // „nie jest przycięty" znaczy: głębokość znacznika mniejsza niż głębokość kuli na
    // KAŻDYM promieniu przechodzącym przez tarczę. Awaria tego rodzaju jest widoczna
    // WYŁĄCZNIE na GPU — dokładnie ta klasa, która w tej fazie dwa razy przeszła zielony
    // pakiet (pierścień alarmu nawinięty odwrotnie, pasy obręczy poniżej piksela).
    //
    // Przyrząd jest NIEZALEŻNY od wzoru w module: przecina promień kamera → punkt obręczy
    // z kulą i porównuje głębokości. Powtórzenie wzoru z `writeMarkerPosition` byłoby
    // asercją prawdziwą z konstrukcji — pierwszą pozycją z katalogu wad tej fazy.
    const plans = realPlans();
    const ringRadius = markerRingRadius(planet.radius);
    const RING_SAMPLES = 64;

    /** Najciaśniejszy zapas głębokości obręczy; `lift` podany ⇒ znacznik liczony po staremu. */
    const clearanceAt = (cellId: number, degrees: number, legacyNormalLift?: number): number => {
      const offset = { polarRad: (degrees * Math.PI) / 180, azimuthRad: 0.7 };
      const aim = aimDirection(planet, cellId, offset);
      const camera = new Vector3(aim.x, aim.y, aim.z).multiplyScalar(planet.radius * 3);
      const cell = planet.cells[cellId];
      const marker =
        legacyNormalLift === undefined
          ? (() => {
              const p = markerPosition(planet, cellId, camera);
              return new Vector3(p.x, p.y, p.z);
            })()
          : new Vector3(cell.center.x, cell.center.y, cell.center.z).add(
              new Vector3(cell.normal.x, cell.normal.y, cell.normal.z).multiplyScalar(legacyNormalLift),
            );
      // Oś patrzenia K1: kamera zawsze patrzy w środek planety (`controls.target`).
      const forward = camera.clone().negate().normalize();
      const markerDepth = marker.clone().sub(camera).dot(forward);
      // Dwie osie prostopadłe do osi patrzenia — w nich leży kwadrat billboardu.
      const up = Math.abs(forward.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
      const right = new Vector3().crossVectors(forward, up).normalize();
      const realUp = new Vector3().crossVectors(right, forward).normalize();

      let worst = Infinity;
      for (let s = 0; s < RING_SAMPLES; s++) {
        const a = (s / RING_SAMPLES) * Math.PI * 2;
        const p = marker
          .clone()
          .add(right.clone().multiplyScalar(Math.cos(a) * ringRadius))
          .add(realUp.clone().multiplyScalar(Math.sin(a) * ringRadius));
        // Przecięcie promienia kamera → p z kulą o promieniu `planet.radius`.
        const d = p.clone().sub(camera).normalize();
        const b = 2 * camera.dot(d);
        const c = camera.lengthSq() - planet.radius * planet.radius;
        const disc = b * b - 4 * c;
        if (disc <= 0) continue; // ten promień mija kulę — nie ma czego przyciąć
        const t = (-b - Math.sqrt(disc)) / 2;
        const surface = camera.clone().add(d.clone().multiplyScalar(t));
        worst = Math.min(worst, surface.clone().sub(camera).dot(forward) - markerDepth);
      }
      return worst;
    };

    // Kąty patrzenia od 0° (kamera wprost na komórkę) przez cały zakres prób
    // (`CAMERA_OFFSET_MAX_DEGREES` = 34°) po 45°, czyli 11° SWOBODNEGO doorbitowania ponad
    // najdalszą próbę. Zmierzone tym samym przyrządem: obręcz zostaje cała do ok. 49°, a
    // dalej zaczyna wchodzić pod horyzont komórki — co zapisuję jako liczbę, bo dociągnięcie
    // tego do limbu (70,5°) wymagałoby uniesienia ok. 25 jednostek, czyli znacznika
    // puchnącego o połowę przy maksymalnym przybliżeniu.
    let worstClearance = Infinity;
    for (const trial of plans.threshold) {
      for (const degrees of [0, 14, 24, 34, 45]) {
        worstClearance = Math.min(worstClearance, clearanceAt(trial.cellId, degrees));
      }
    }
    expect(worstClearance, `najciaśniejszy zapas głębokości znacznika: ${worstClearance.toFixed(4)}`).toBeGreaterThan(
      0.5,
    );

    // KONTROLA POZYTYWNA NA SAM PRZYRZĄD — i zarazem powód, dla którego Krok 1 musiał ruszyć
    // sposób unoszenia znacznika: uniesienie wzdłuż NORMALNEJ o 0,012 promienia (wartość
    // sprzed tego zadania) przy kącie z zakresu prób daje zapas UJEMNY, czyli obręcz
    // przyciętą przez teren. Bez tej połówki „zapas dodatni" mógłby wyjść z przyrządu, który
    // nigdy nie zwraca liczby ujemnej.
    const legacy = clearanceAt(plans.threshold[0].cellId, 24, planet.radius * 0.012);
    expect(legacy, `dawne uniesienie wzdłuż normalnej: ${legacy.toFixed(4)}`).toBeLessThan(0);
  });
});

describe('Krok 1 Zadania 5: kamera NIE celuje w pytaną komórkę', () => {
  it('5c. [SEDNO USZCZELNIENIA] odchylenie celu kamery jest w zadanym zakresie, ZMIENNE, deterministyczne — i IDENTYCZNE dla odpowiadającej próby w każdym trybie', () => {
    const { gate } = makeGate();
    const min = (CAMERA_OFFSET_MIN_DEGREES * Math.PI) / 180;
    const max = (CAMERA_OFFSET_MAX_DEGREES * Math.PI) / 180;

    // 1. ZAKRES: komórka schodzi ze środka tarczy, ale zostaje głęboko wewnątrz niej.
    const polars = new Set<number>();
    const azimuths = new Set<number>();
    for (let i = 0; i < gate.totalTrials; i++) {
      const o = gate.cameraOffset(i);
      expect(o.polarRad, `próba ${i + 1}`).toBeGreaterThanOrEqual(min);
      expect(o.polarRad, `próba ${i + 1}`).toBeLessThanOrEqual(max);
      polars.add(o.polarRad);
      azimuths.add(o.azimuthRad);
    }
    // 2. ZMIENNOŚĆ: gdyby offset był stały, człowiek nauczyłby się „komórka jest zawsze na
    //    prawo od środka" i odzyskał odniesienie, które to uszczelnienie odbiera.
    expect(polars.size).toBe(gate.totalTrials);
    expect(azimuths.size).toBe(gate.totalTrials);

    // 3. DETERMINIZM: druga sesja tego samego człowieka ma dostać ten sam przebieg.
    const { gate: twin } = makeGate();
    for (let i = 0; i < gate.totalTrials; i++) {
      expect(twin.cameraOffset(i)).toEqual(gate.cameraOffset(i));
    }
    twin.dispose();

    // 4. WŁASNOŚĆ, DLA KTÓREJ TO ISTNIEJE: kamera faktycznie NIE patrzy wzdłuż normalnej
    //    pytanej komórki, a KĄT jest ten sam dla odpowiadającej próby w KAŻDYM trybie.
    //    Asymetria protokołu między trybami byłaby confoundem sama w sobie: zmieniałaby
    //    trudność zadania z powodu niezwiązanego z cieniowaniem.
    const plans = realPlans();
    const anglesPerMode: Record<GateMode, number[]> = { threshold: [], smooth: [], control: [] };
    for (const mode of ['threshold', 'smooth', 'control'] as const) {
      gate.setMode(mode);
      for (let i = 0; i < gate.totalTrials; i++) {
        const cell = planet.cells[plans[mode][i].cellId];
        const normal = new Vector3(cell.normal.x, cell.normal.y, cell.normal.z);
        const view = gate.camera.object.position.clone().normalize();
        anglesPerMode[mode].push(Math.acos(Math.min(1, view.dot(normal))));
        gate.answer(true);
        gate.advance();
      }
    }
    for (let i = 0; i < gate.totalTrials; i++) {
      expect(anglesPerMode.threshold[i], `próba ${i + 1}`).toBeGreaterThanOrEqual(min - 1e-9);
      expect(anglesPerMode.smooth[i]).toBeCloseTo(anglesPerMode.threshold[i], 9);
      expect(anglesPerMode.control[i]).toBeCloseTo(anglesPerMode.threshold[i], 9);
    }
    gate.dispose();
  });

  it('5d. [PARA MUTACJI] odchylenie 0° kładzie komórkę na środku tarczy, a każde odchylenie z zakresu — poza nim', () => {
    // Połówka „ma przejść" jest tu ważniejsza od połówki „ma oblać": mierzy, że test 5c
    // orzeka o POŁOŻENIU NA EKRANIE, a nie o samych liczbach w `CameraOffset`.
    const cellId = 733;
    const screenOffset = (degrees: number, id: number = cellId): number => {
      const aim = aimDirection(planet, id, { polarRad: (degrees * Math.PI) / 180, azimuthRad: 0.7 });
      const view = new Vector3(aim.x, aim.y, aim.z);
      // Odległość rzutu komórki od środka tarczy, w jednostkach świata: R·sin(kąt).
      //
      // `|view × normal| · R`, a NIE `sin(acos(view·normal)) · R` — dla wektorów
      // jednostkowych obie postacie są tą samą wielkością, ale druga ma podłogę szumu
      // własnego, która przewraca próg niżej. `acos` blisko jedynki podnosi błąd do
      // pierwiastka: iloczyn skalarny obarczony kilkoma ULP daje kąt rzędu 1,5·10⁻⁸ rad,
      // czyli offset do **2,581·10⁻⁶** — pięć tysięcy razy ponad tolerancję `toBeCloseTo(0, 9)`.
      //
      // ZMIERZONE na wszystkich 1442 komórkach tej planety (przegląd rundy 1): starym
      // przyrządem **814 z nich** dawało iloczyn różny od 1.0 i niezerowy offset — test był
      // zielony WYŁĄCZNIE dlatego, że wpisana na sztywno `cellId = 733` trafia na komórkę,
      // dla której iloczyn wychodzi dokładnie 1.0. Zmiana komórki, seeda albo jednego
      // zaokrąglenia w `buildDual` (otwarte pytanie Fazy 1A) czerwieniłaby go bez żadnego
      // defektu. Postać z iloczynem wektorowym daje dla wszystkich 1442 dokładnie 0, bo
      // `|a × a| = 0` wychodzi z odejmowania identycznych iloczynów, nie z `acos`.
      //
      // Przy okazji znika druga usterka tamtej postaci: `Math.min(1, …)` przycinał iloczyn
      // tylko z GÓRY, więc para bliska antypodom dawałaby `acos` poza dziedziną, czyli `NaN`.
      const n = planet.cells[id].normal;
      return view.clone().cross(new Vector3(n.x, n.y, n.z)).length() * planet.radius;
    };
    // Widoczny promień tarczy z odległości startowej `3R`: `R × sqrt(1 − 1/9)` = 94,3.
    const discRadius = planet.radius * Math.sqrt(1 - 1 / 9);
    expect(screenOffset(0)).toBeCloseTo(0, 9); // tuż PRZED: dawne zachowanie, komórka na środku
    // …i to samo dla KAŻDEJ komórki, nie tylko dla wpisanej na sztywno. Wybrana komórka
    // przestaje być częścią przesłanki testu: gdyby próg zależał od tego, na którą się
    // trafi (a przy starym przyrządzie zależał — 814 z 1442 dawało niezerowy offset),
    // ten przebieg by to pokazał.
    let worstZeroOffset = 0;
    for (let id = 0; id < planet.cells.length; id++) {
      worstZeroOffset = Math.max(worstZeroOffset, screenOffset(0, id));
    }
    // TOLERANCJA, nie równość bitowa. Dzisiejszy `aimDirection` przy polar 0 zwraca
    // normalną co do bitu, więc `toBe(0)` przechodzi — ale kotwiczyłoby test na TOŻSAMOŚCI
    // ALGEBRAICZNEJ, której nikt nie obiecywał: neutralny znaczeniowo refaktor (normalizacja
    // wyniku `aimDirection`) daje 7,85·10⁻¹⁵ i czerwieniłby ten test bez żadnego defektu.
    // 5·10⁻¹⁰ to ta sama tolerancja, którą miała linia zastąpiona w rundzie 1 — i leży
    // 160 000× nad tym szumem, a jednocześnie 5000× pod błędem starego przyrządu
    // (`sin(acos(x))`, do 2,581·10⁻⁶), który ten test miał przestać przepuszczać.
    expect(worstZeroOffset).toBeCloseTo(0, 9);
    expect(screenOffset(CAMERA_OFFSET_MIN_DEGREES) / discRadius).toBeGreaterThan(0.25);
    expect(screenOffset(CAMERA_OFFSET_MAX_DEGREES) / discRadius).toBeLessThan(0.62); // wciąż daleko od limbu
  });
});

describe('createReadabilityGate — znacznik nie zdradza odpowiedzi', () => {
  it('6. PRZED odpowiedzią znacznik ma tę samą, neutralną barwę i ten sam rozmiar w KAŻDEJ z 15 prób — także tych o komórkach ciemnych', () => {
    // Przy JEDNYM znaczniku (zamiast pary z Fazy 2A) każda jego własność zależna od tego, co
    // jest pod nim, byłaby wprost odpowiedzią na zadane pytanie.
    const { gate } = makeGate();
    let litTrials = 0;
    let darkTrials = 0;
    const scales = new Set<number>();
    for (let i = 0; i < gate.totalTrials; i++) {
      const trial = gate.currentTrial() as GateTrial;
      expect(isNeutral(gate.marker.material.color), `próba ${i + 1}`).toBe(true);
      expect(isGreenDominant(gate.marker.material.color)).toBe(false);
      expect(isRedDominant(gate.marker.material.color)).toBe(false);
      scales.add(gate.marker.scale.x);
      if (trial.lit) litTrials++;
      else darkTrials++;
      gate.answer(true);
      gate.advance();
    }
    // Kontrola pozytywna na sam test: obie klasy prób FAKTYCZNIE wystąpiły — inaczej
    // „neutralny w każdej próbie" byłoby prawdą trywialnie, dla planu z jedną stroną granicy.
    expect(litTrials).toBeGreaterThan(0);
    expect(darkTrials).toBeGreaterThan(0);
    expect(scales.size).toBe(1); // jeden rozmiar dla wszystkich prób
    expect([...scales][0]).toBeGreaterThan(0);
    gate.dispose();
  });

  it('7. znacznik stoi na komórce BIEŻĄCEJ próby aktywnego planu, a po wyczerpaniu planu znika', () => {
    const plans = realPlans();
    const { gate } = makeGate(plans);
    for (let i = 0; i < gate.totalTrials; i++) {
      const expected = markerPosition(planet, plans.threshold[i].cellId, gate.camera.object.position);
      expect(gate.marker.visible).toBe(true);
      expect(gate.marker.position.x).toBeCloseTo(expected.x, 6);
      expect(gate.marker.position.y).toBeCloseTo(expected.y, 6);
      expect(gate.marker.position.z).toBeCloseTo(expected.z, 6);
      gate.answer(true);
      gate.advance();
    }
    expect(gate.isFinished()).toBe(true);
    expect(gate.marker.visible).toBe(false); // nie zostaje na ostatniej komórce z odsłoniętą prawdą
    gate.dispose();
  });
});

describe('createReadabilityGate — answer(): scoring i odsłonięcie', () => {
  it('8. odpowiedź zgodna z prawdą symulacji daje correct:true, niezgodna false — obie gałęzie', () => {
    const plans = realPlans();
    for (const truthful of [true, false]) {
      const { gate } = makeGate(plans);
      const trial = gate.currentTrial() as GateTrial;
      const record = gate.answer(truthful ? trial.lit : !trial.lit) as GateAnswerRecord;
      expect(record).not.toBeNull();
      expect(record.correct).toBe(truthful);
      expect(record.cellId).toBe(trial.cellId);
      expect(record.actuallyLit).toBe(trial.lit);
      expect(record.answeredLit).toBe(truthful ? trial.lit : !trial.lit);
      expect(record.mode).toBe('threshold');
      expect(gate.isRevealed()).toBe(true);
      gate.dispose();
    }
  });

  it('9. odsłonięcie pokazuje PRAWDĘ, nie informację zwrotną: zielony ⟺ komórka faktycznie oświetlona, niezależnie od odpowiedzi', () => {
    // Zamiana obu kolorów odsłonięcia miejscami nie rusza `correct`, więc tabela nadal
    // drukowałaby PASS, a człowiek uczyłby się MIĘDZY próbami odwrotnej zasady.
    const plans = realPlans();
    let litSeen = 0;
    let darkSeen = 0;
    for (const answeredLit of [true, false]) {
      const { gate } = makeGate(plans);
      for (let i = 0; i < gate.totalTrials; i++) {
        const trial = gate.currentTrial() as GateTrial;
        expect(isNeutral(gate.marker.material.color)).toBe(true);
        gate.answer(answeredLit);
        expect(isGreenDominant(gate.marker.material.color), `próba ${i + 1}, odpowiedź ${answeredLit}`).toBe(trial.lit);
        expect(isRedDominant(gate.marker.material.color), `próba ${i + 1}, odpowiedź ${answeredLit}`).toBe(!trial.lit);
        if (trial.lit) litSeen++;
        else darkSeen++;
        gate.advance();
      }
      gate.dispose();
    }
    expect(litSeen).toBeGreaterThan(0); // kontrola: obie barwy odsłonięcia faktycznie wystąpiły
    expect(darkSeen).toBeGreaterThan(0);
  });

  it('10. druga odpowiedź na tę samą, już odsłoniętą próbę zwraca null i NIE dopisuje wpisu', () => {
    const { gate } = makeGate();
    expect(gate.answer(true)).not.toBeNull();
    expect(gate.answers().length).toBe(1);
    expect(gate.answer(false)).toBeNull();
    expect(gate.answers().length).toBe(1);
    gate.dispose();
  });

  it('11. advance() PRZED odsłonięciem nie robi nic; PO odsłonięciu przechodzi dalej i zeruje odsłonięcie', () => {
    const { gate } = makeGate();
    expect(gate.advance()).toBe(false);
    expect(gate.currentTrialIndex()).toBe(0);
    gate.answer(true);
    expect(gate.advance()).toBe(true);
    expect(gate.currentTrialIndex()).toBe(1);
    expect(gate.isRevealed()).toBe(false);
    gate.dispose();
  });

  it('12. [przebieg pełny] odpowiadanie zgodnie z prawdą daje komplet; advance() po ostatniej próbie zwraca false', () => {
    const { gate } = makeGate();
    let lastAdvance = true;
    for (let i = 0; i < gate.totalTrials; i++) {
      const trial = gate.currentTrial() as GateTrial;
      gate.answer(trial.lit);
      lastAdvance = gate.advance();
    }
    expect(lastAdvance).toBe(false);
    expect(gate.isFinished()).toBe(true);
    expect(gate.answers().length).toBe(15);
    expect(gate.answers().every((a) => a.correct)).toBe(true);
    gate.dispose();
  });

  it('13. [PODŁOGA ZGADYWANIA] stała odpowiedź "oświetlona" daje DOKŁADNIE 8/15, stała "ciemna" 7/15 — komplet nie jest osiągalny bez patrzenia', () => {
    // To jest liczba, na której stoi sens werdyktu „PASS wymaga kompletu piętnastu". Bramka
    // Fazy 2A miała tę własność z innego powodu (wymuszony wybór dwóch alternatyw); tutaj
    // niesie ją przeplot jasna/ciemna w `buildGateTrials` i trzeba jej pilnować osobno.
    const alwaysLit = makeGate();
    expect(runPlan(alwaysLit.gate, () => true).filter((a) => a.correct).length).toBe(8);
    alwaysLit.gate.dispose();

    const alwaysDark = makeGate();
    expect(runPlan(alwaysDark.gate, () => false).filter((a) => a.correct).length).toBe(7);
    alwaysDark.gate.dispose();
  });
});

describe('createReadabilityGate — tryby: rozdział logów i przemalowanie', () => {
  it('14. odpowiedzi z trybów NIEOCENIANYCH nie trafiają do answers() — werdykt nie może się nimi zanieczyścić', () => {
    const { gate } = makeGate();
    for (const mode of ['smooth', 'control'] as const) {
      gate.setMode(mode);
      gate.answer(true);
      gate.advance();
      expect(gate.answersFor(mode).length).toBe(1);
    }
    expect(gate.answers()).toEqual([]); // ani jednego wpisu w logu ocenianym
    gate.setMode('threshold');
    gate.answer(true);
    expect(gate.answers().length).toBe(1);
    expect(gate.answers()[0].mode).toBe('threshold');
    gate.dispose();
  });

  it('15. każdy tryb ma WŁASNY kursor: przełączenie tam i z powrotem nie gubi postępu ocenianego planu', () => {
    const { gate } = makeGate();
    gate.answer(true);
    gate.advance();
    expect(gate.currentTrialIndex()).toBe(1);
    gate.setMode('control');
    expect(gate.currentTrialIndex()).toBe(0); // własny kursor planu kontrolnego
    gate.setMode('threshold');
    expect(gate.currentTrialIndex()).toBe(1);
    expect(gate.answers().length).toBe(1);
    gate.dispose();
  });

  it('16. tryb kontrolny pokazuje siatkę ze WSPÓŁDZIELONYMI wierzchołkami, pozostałe — siatkę gry; zawsze dokładnie jedna jest widoczna', () => {
    const { gate, renderer } = makeGate();
    const { flat, smeared } = meshesOf(gate, renderer);
    const visibility: Record<string, [boolean, boolean]> = {};
    for (const mode of ['threshold', 'smooth', 'control'] as const) {
      gate.setMode(mode);
      gate.renderFrame();
      visibility[mode] = [flat.visible, smeared.visible];
      expect(flat.visible !== smeared.visible, `tryb ${mode}`).toBe(true);
    }
    expect(visibility).toEqual({
      threshold: [true, false],
      smooth: [true, false],
      control: [false, true],
    });
    gate.dispose();
  });

  it('17. KAŻDA próba maluje planetę światłem SWOJEJ fazy — bufor kolorów zgadza się co do bitu z policzonym niezależnie', () => {
    // Usunięcie przemalowania zostawiało w Fazie 2A CAŁĄ gałąź zieloną, a człowiek oglądałby
    // próby 6-15 w świetle fazy 1 — najdroższy możliwy tryb awarii tego pliku: on wyprodukował
    // werdykt na D1.
    const plans = realPlans();
    const { gate, renderer } = makeGate(plans);
    const colors = colorsOf(meshesOf(gate, renderer).flat);

    const bufferForTrial = (i: number): Float32Array => {
      const buf = new Float32Array(sharedGeo.positions.length);
      writeCellColors(sharedGeo, lightField(planet, plans.threshold[i].sunDir), buf, DEFAULT_PALETTE);
      return buf;
    };
    // KONTROLA POZYTYWNA na sam test: fazy dają RÓŻNE bufory, inaczej porównanie niżej
    // przechodziłoby także dla harnessu, który maluje raz i nigdy nie odświeża.
    expect(Array.from(bufferForTrial(0))).not.toEqual(Array.from(bufferForTrial(5)));
    expect(Array.from(bufferForTrial(5))).not.toEqual(Array.from(bufferForTrial(10)));

    let checked = 0;
    for (let i = 0; i < plans.threshold.length; i++) {
      expect(gate.currentTrialIndex()).toBe(i);
      const expected = bufferForTrial(i);
      let mismatches = 0;
      for (let k = 0; k < expected.length; k++) if (colors[k] !== expected[k]) mismatches++;
      expect(mismatches, `próba ${i + 1} (faza ${plans.threshold[i].phaseIndex + 1})`).toBe(0);
      checked++;
      gate.answer(true);
      gate.advance();
    }
    expect(checked).toBe(plans.threshold.length);
    gate.dispose();
  });
});

describe('createReadabilityGate — co WIDAĆ pod znacznikiem: tryb oceniany kontra kontrola pozytywna', () => {
  it('18. [SEDNO BRAMKI] w trybie progowanym komórka oświetlona jest odległa o PEŁNY skok palety od barwy nocy, a ciemna leży na niej dokładnie', () => {
    const plans = realPlans();
    const { gate, renderer } = makeGate(plans);
    const colors = colorsOf(meshesOf(gate, renderer).flat);

    let litChecked = 0;
    let darkChecked = 0;
    let minLitDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < plans.threshold.length; i++) {
      const trial = plans.threshold[i];
      const d = distance(cellColorFlat(colors, trial.cellId), NIGHT);
      if (trial.lit) {
        expect(d, `próba ${i + 1}, komórka ${trial.cellId}`).toBeGreaterThan(0.5);
        minLitDistance = Math.min(minLitDistance, d);
        litChecked++;
      } else {
        expect(d, `próba ${i + 1}, komórka ${trial.cellId}`).toBe(0);
        darkChecked++;
      }
      gate.answer(true);
      gate.advance();
    }
    expect(litChecked).toBe(8);
    expect(darkChecked).toBe(7);
    console.log(`[BRAMKA] tryb progowany: najmniejsza odległość komórki oświetlonej od nocy = ${minLitDistance.toFixed(4)}`);
    gate.dispose();
  });

  it('19. [KONTROLA POZYTYWNA] przy KAŻDEJ komórce, o którą pyta kontrola, otoczenie wygląda tak samo jak gdziekolwiek indziej — brak cechy szczególnej na granicy', () => {
    // Poprzednia wersja tego testu mierzyła „odległość komórki oświetlonej od barwy nocy" i
    // wymagała, żeby była mała. To była ZŁA WŁASNOŚĆ i przez nią kontrola przeciekała:
    // „blisko barwy nocy" było prawdą dlatego, że `saturate` ścinał całą noc do jednej
    // wartości — czyli dokładnie z powodu defektu, a nie mimo niego.
    //
    // Właściwa własność brzmi: **terminator nie ma żadnej cechy szczególnej**. Mierzona jako
    // największy skok barwny między zaznaczoną komórką a jej sąsiadami — w trybie ocenianym
    // to pełny skok palety, w kontroli tyle samo, ile gdziekolwiek indziej na kuli.
    const plans = realPlans();
    const { gate, renderer } = makeGate(plans);
    const meshes = meshesOf(gate, renderer);

    const maxStepTo = (read: (id: number) => readonly number[], cellId: number): number => {
      let max = 0;
      for (const n of planet.cells[cellId].neighbors) max = Math.max(max, distance(read(cellId), read(n)));
      return max;
    };

    // (a) tryb OCENIANY: przy każdej komórce planu ocenianego jest pełny skok palety.
    const flatColors = colorsOf(meshes.flat);
    let minEvaluatedStep = Number.POSITIVE_INFINITY;
    for (let i = 0; i < plans.threshold.length; i++) {
      minEvaluatedStep = Math.min(
        minEvaluatedStep,
        maxStepTo((id) => cellColorFlat(flatColors, id), plans.threshold[i].cellId),
      );
      gate.answer(true);
      gate.advance();
    }

    // (b) tryb KONTROLNY: mierzone NA TYM SAMYM buforze, w którym stoi dana próba. Bufor
    //     kolorów jest przemalowywany przy każdej próbie, więc porównanie „komórka pytania"
    //     z „najwięcej gdziekolwiek" wolno robić WYŁĄCZNIE w obrębie jednej fazy. Pierwsza
    //     wersja tego testu porównywała komórkę z fazy 1 z maksimum policzonym po ostatnim
    //     przemalowaniu (faza 3) i dostawała wynik niemożliwy — komórkę „bardziej skrajną"
    //     niż maksimum po wszystkich komórkach, wśród których ona sama się znajduje.
    gate.setMode('control');
    const smearedColors = colorsOf(meshes.smeared);
    const readSmeared = (id: number): readonly number[] => cellColorSmeared(smearedColors, id);

    let maxControlStepAtTrials = 0;
    let maxControlStepAnywhere = 0;
    let minComparableFraction = 1;
    let checked = 0;
    for (let i = 0; i < plans.control.length; i++) {
      const atCell = maxStepTo(readSmeared, plans.control[i].cellId);
      const allSteps = planet.cells.map((c) => maxStepTo(readSmeared, c.id));
      const anywhere = Math.max(...allSteps);
      // Ile komórek NA CAŁEJ KULI ma skok porównywalny z tą, o którą bramka pyta. To jest
      // miara „komórka pytania nie jest wyróżniona": gdyby terminator niósł cechę szczególną,
      // ułamek byłby rzędu samego pierścienia granicznego, a nie kilkunastu procent kuli.
      const comparable = allSteps.filter((s) => s >= atCell * 0.9).length / allSteps.length;

      expect(atCell, `próba ${i + 1}`).toBeLessThanOrEqual(anywhere);
      expect(anywhere, `próba ${i + 1}`).toBeLessThan(0.1); // zmierzone: 0,0758–0,0783
      maxControlStepAtTrials = Math.max(maxControlStepAtTrials, atCell);
      maxControlStepAnywhere = Math.max(maxControlStepAnywhere, anywhere);
      minComparableFraction = Math.min(minComparableFraction, comparable);
      checked++;
      gate.answer(true);
      gate.advance();
    }
    expect(checked).toBe(plans.control.length);

    console.log(
      `[KONTROLA] skok przy komórce pytania — oceniany: ${minEvaluatedStep.toFixed(4)}, kontrolny: ${maxControlStepAtTrials.toFixed(4)} (max na kuli ${maxControlStepAnywhere.toFixed(4)}; komórek o porównywalnym skoku: ≥ ${(minComparableFraction * 100).toFixed(1)}%)`,
    );

    expect(minEvaluatedStep).toBeCloseTo(0.9005, 3); // pełny skok palety przy KAŻDEJ ocenianej komórce
    expect(maxControlStepAtTrials).toBeGreaterThan(0); // kontrola coś rysuje, nie jest jednolicie czarna
    // SEDNO, dwie strony tej samej własności:
    // (1) nigdzie w kontroli nie ma nieciągłości porównywalnej ze skokiem pasma;
    expect(maxControlStepAnywhere).toBeLessThan(minEvaluatedStep / 10);
    // (2) komórka pytania nie jest wyróżniona — co najmniej co dziesiąta komórka kuli ma
    //     skok porównywalny z jej własnym (zmierzone: najmniej 14,0%).
    expect(minComparableFraction).toBeGreaterThan(0.1);
  });

  it('20. w trybie kontrolnym kolor jest zapisywany PER WIERZCHOŁEK siatki współdzielonej, więc granica nie ma ani jednej nieciągłości', () => {
    const { gate, renderer } = makeGate();
    gate.setMode('control');
    const { smeared } = meshesOf(gate, renderer);
    const colors = colorsOf(smeared);
    expect(colors.length).toBe(smearedGeo.vertexCount * 3);

    const trial = gate.currentTrial() as GateTrial;
    const light = lightField(planet, trial.sunDir);
    let maxNeighborStep = 0;
    for (const cell of planet.cells) {
      for (const n of cell.neighbors) {
        if (n <= cell.id) continue;
        maxNeighborStep = Math.max(
          maxNeighborStep,
          distance(cellColorSmeared(colors, cell.id), cellColorSmeared(colors, n)),
        );
      }
    }
    // Kontrola pozytywna: w tym samym świetle render gry MA pełny skok na granicy — więc
    // mała liczba wyżej jest własnością kontroli, nie tej fazy słońca.
    const pair = planet.cells.find((c) => c.neighbors.some((n) => (light[n] > 0) !== (light[c.id] > 0)));
    expect(pair).toBeDefined();
    const flatBuf = new Float32Array(sharedGeo.positions.length);
    writeCellColors(sharedGeo, light, flatBuf, DEFAULT_PALETTE);
    const other = (pair as { id: number; neighbors: readonly number[] }).neighbors.find(
      (n) => (light[n] > 0) !== (light[(pair as { id: number }).id] > 0),
    ) as number;
    const flatStep = distance(
      cellColorFlat(flatBuf, (pair as { id: number }).id),
      cellColorFlat(flatBuf, other),
    );
    expect(flatStep).toBeGreaterThan(0.5);
    expect(maxNeighborStep).toBeLessThan(flatStep / 5);
    gate.dispose();
  });
});

describe('createReadabilityGate — renderFrame/resize/dispose', () => {
  it('21. renderFrame() faktycznie woła renderer.render()', () => {
    const { gate, renderer } = makeGate();
    const before = renderer.renderCalls;
    gate.renderFrame();
    gate.renderFrame();
    expect(renderer.renderCalls).toBe(before + 2);
    gate.dispose();
  });

  it('22. dispose() nie rzuca i zwalnia renderer', () => {
    const { gate, renderer } = makeGate();
    expect(() => gate.dispose()).not.toThrow();
    expect(renderer.disposeCalls).toBe(1);
  });

  it('23. resize() przelicza proporcje kamery', () => {
    const canvas = createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const gate = createReadabilityGate(planet, canvas, realPlans(), { makeRenderer: () => createFakeRenderer() });
    const mutable = canvas as unknown as { clientWidth: number; clientHeight: number };
    mutable.clientWidth = 1024;
    mutable.clientHeight = 768;
    expect(() => gate.resize()).not.toThrow();
    expect(gate.camera.object.aspect).toBeCloseTo(1024 / 768, 9);
    gate.dispose();
  });
});

describe('formatGateResultsMarkdown', () => {
  const make = (n: number, wrongAt: number[] = [], mode: GateMode = 'threshold'): GateAnswerRecord[] =>
    Array.from({ length: n }, (_, i) => {
      const actuallyLit = i % 2 === 0;
      const wrong = wrongAt.includes(i);
      return {
        mode,
        trialOrdinal: i,
        phaseIndex: Math.floor(i / 5),
        cellId: 100 + i,
        actuallyLit,
        answeredLit: wrong ? !actuallyLit : actuallyLit,
        correct: !wrong,
      };
    });

  it('24. komplet poprawnych z KOMPLETU prób → "PASS" i licznik n/n', () => {
    const md = formatGateResultsMarkdown(make(15), 15);
    expect(md).toContain('PASS');
    expect(md).toContain('Wynik: 15/15');
  });

  it('24b. [RULING Z ZADANIA 1] log ODPOWIEDZI STAŁEJ mówi to wprost, zamiast pokazywać liczbę wyglądającą na przypadek', () => {
    // Plan jest zrównoważony, więc stała odpowiedź daje DOKŁADNIE tyle, ile jest komórek tej
    // strony — przy piętnastu próbach 8/15. Gołe „8/15" w dokumencie decyzyjnym za pół roku
    // zostanie odczytane jako czysty przypadek, a to jest inna rzecz: brak rozróżniania.
    // Zapisane jako ruling po werdykcie Zadania 1 i zrobione tu, bo Zadanie 5 wyprodukowało
    // ten przypadek dwa razy z rzędu (oba przebiegi kontroli).
    const alwaysLit = make(15).map((a) => ({ ...a, answeredLit: true, correct: a.actuallyLit }));
    const md = formatGateResultsMarkdown(alwaysLit, 15);
    expect(md).toContain('ODPOWIEDŹ STAŁA');
    expect(md).toContain('oświetlona');
    // KONTROLA POZYTYWNA NA SAM POMIAR: log, w którym odpowiedzi są MIESZANE, tej adnotacji
    // NIE dostaje — inaczej „wykrywa stałą odpowiedź" znaczyłoby „drukuje ją zawsze".
    expect(formatGateResultsMarkdown(make(15), 15)).not.toContain('ODPOWIEDŹ STAŁA');
    // ...i ten sam wynik liczbowy da się osiągnąć BEZ stałej odpowiedzi — więc adnotacja
    // zależy od WZORCA, a nie od liczby poprawnych.
    const mixed = make(15).map((a, i) =>
      i < 8 ? a : { ...a, answeredLit: !a.actuallyLit, correct: false },
    );
    expect(new Set(mixed.map((a) => a.answeredLit)).size, 'przypadek kontrolny nie jest mieszany').toBe(2);
    const mixedSameScore = formatGateResultsMarkdown(mixed, 15);
    expect(mixedSameScore).toContain('Wynik: 8/15');
    expect(mixedSameScore).not.toContain('ODPOWIEDŹ STAŁA');
  });

  it('25. choć jedna błędna → "FAIL (n/m)", NIE "PASS"', () => {
    const md = formatGateResultsMarkdown(make(15, [7]), 15);
    expect(md).toContain('FAIL (14/15)');
    expect(md).not.toContain('PASS');
  });

  it('26. tabela ma jeden wiersz danych na odpowiedź (plus nagłówek i separator)', () => {
    const lines = formatGateResultsMarkdown(make(3), 15)
      .split('\n')
      .filter((l) => l.startsWith('|'));
    expect(lines.length).toBe(2 + 3);
  });

  it('27. log NIEPEŁNEGO przebiegu NIE może orzec PASS — trzy poprawne z piętnastu to nie 3/3', () => {
    const md = formatGateResultsMarkdown(make(3), 15);
    expect(md).not.toContain('PASS');
    expect(md).toContain('NIEKOMPLETNE');
    expect(md).toContain('3 z 15');
    expect(md).toContain('Wynik: 3/15'); // mianownik to LICZBA PRÓB, nie liczba odpowiedzi
    expect(formatGateResultsMarkdown(make(14), 15)).not.toContain('PASS'); // komplet trafień, ale niepełny
  });

  it('28. log trybu NIEOCENIANEGO jest wyraźnie oznaczony — tabela z kontroli nie może udawać werdyktu', () => {
    const md = formatGateResultsMarkdown(make(15, [], 'control'), 15);
    expect(md).toContain('Tryb: control');
    expect(md).toContain('NIE JEST oceniany');
    // Kontrola pozytywna: ta sama tabela w trybie ocenianym tej adnotacji NIE ma.
    expect(formatGateResultsMarkdown(make(15), 15)).not.toContain('NIE JEST oceniany');
  });

  it('29. rzuca RangeError dla bezsensownej liczby prób, nadmiaru odpowiedzi i logu z pomieszanych trybów', () => {
    expect(() => formatGateResultsMarkdown(make(3), 0)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(3), -1)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(3), 2.5)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(16), 15)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown([...make(2), ...make(2, [], 'control')], 15)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(15), 15)).not.toThrow();
  });

  it('30. tabela niesie PRAWDĘ i ODPOWIEDŹ osobno — z samego "OK/BŁĄD" nie da się odtworzyć, po której stronie granicy leżała komórka', () => {
    const md = formatGateResultsMarkdown(make(2, [1]), 15);
    expect(md).toContain('| 1 | 1 | 100 | oświetlona | oświetlona | OK |');
    expect(md).toContain('| 2 | 1 | 101 | ciemna | oświetlona | BŁĄD |');
  });
});

describe('createReadabilityGate — tryb kontrolny też musi śledzić fazę', () => {
  it('32. KAŻDA próba kontrolna maluje siatkę współdzieloną światłem SWOJEJ fazy — co do bitu', () => {
    // Odpowiednik testu 17 dla siatki kontrolnej. Bez niego „kontrola maluje raz i nigdy nie
    // odświeża" przechodziłoby zielono: pomiary czułości (test 19) są odporne na fazę, bo
    // mierzą rozkład skoków, a ten wygląda podobnie w każdej fazie. Człowiek oglądałby wtedy
    // próby kontrolne 6–15 w świetle fazy 1 — dokładnie ten tryb awarii, który w Fazie 2A
    // przeżył cały przegląd, tylko przeniesiony na drugą siatkę.
    const plans = realPlans();
    const { gate, renderer } = makeGate(plans);
    gate.setMode('control');
    const colors = colorsOf(meshesOf(gate, renderer).smeared);
    expect(colors.length).toBe(smearedGeo.vertexCount * 3);

    const expected = new Float32Array(smearedGeo.vertexCount * 3);
    const bufferForTrial = (i: number): Float32Array => {
      const buf = new Float32Array(smearedGeo.vertexCount * 3);
      writeSmearedColors(smearedGeo, plans.control[i].sunDir, buf, DEFAULT_PALETTE);
      return buf;
    };
    // KONTROLA POZYTYWNA na sam test: fazy dają RÓŻNE bufory. Bez tego porównanie niżej
    // przechodziłoby także dla harnessu, który maluje kontrolę raz i nigdy nie odświeża.
    expect(Array.from(bufferForTrial(0))).not.toEqual(Array.from(bufferForTrial(5)));
    expect(Array.from(bufferForTrial(5))).not.toEqual(Array.from(bufferForTrial(10)));

    let checked = 0;
    for (let i = 0; i < plans.control.length; i++) {
      writeSmearedColors(smearedGeo, plans.control[i].sunDir, expected, DEFAULT_PALETTE);
      let mismatches = 0;
      for (let k = 0; k < expected.length; k++) if (colors[k] !== expected[k]) mismatches++;
      expect(mismatches, `próba kontrolna ${i + 1} (faza ${plans.control[i].phaseIndex + 1})`).toBe(0);
      checked++;
      gate.answer(true);
      gate.advance();
    }
    expect(checked).toBe(plans.control.length);
    gate.dispose();
  });
});

describe('spójność renderu z symulacją na komórkach, o które pyta bramka', () => {
  it('31. dla KAŻDEJ komórki KAŻDEJ próby: pasmo 0 renderu ⟺ symulacja uznaje komórkę za nieoświetloną', () => {
    // Bramka pokazuje człowiekowi kolor renderu, a scoruje prawdą symulacji. Gdyby te dwie
    // granice się rozjechały (jak przy `LIGHT_BANDS[0] = 0,05` w Fazie 2A — 8 do 38 komórek
    // różnicy), człowiek odpowiadałby poprawnie „co widzę" i dostawał BŁĄD.
    const plans = realPlans();
    let checked = 0;
    for (const mode of ['threshold', 'smooth', 'control'] as const) {
      for (const trial of plans[mode]) {
        const light = lightField(planet, trial.sunDir);
        expect(lightBand(light[trial.cellId]) === 0, `komórka ${trial.cellId}`).toBe(!trial.lit);
        checked++;
      }
    }
    expect(checked).toBe(45);
  });
});

/**
 * Wszystko, co scena NARYSUJE, wraz z FAKTYCZNĄ widocznością (z dziedziczeniem po rodzicach).
 *
 * Celowo BEZ `instanceof`: „rysowalny" to tutaj „ma geometrię", co obejmuje `Mesh`,
 * `LineSegments`, `Points` i `Sprite` naraz — i obejmie też to, czego jeszcze nie ma.
 * Poprzednia wersja pomocnika (`scene.children.filter(o => o instanceof Mesh)`) nie widziała
 * kraty w ogóle: `LineSegments` nie jest `Mesh`, a obrys jest DZIECKIEM siatki terenu, nie
 * dzieckiem sceny. Testy bramki były więc ślepe na połowę tego, co bramka pokazuje.
 */
function drawablesOf(scene: Scene): { object: Object3D; effectivelyVisible: boolean }[] {
  const out: { object: Object3D; effectivelyVisible: boolean }[] = [];
  scene.traverse((object) => {
    if (!('geometry' in object)) return;
    let visible = true;
    for (let node: Object3D | null = object; node; node = node.parent) {
      if (!node.visible) {
        visible = false;
        break;
      }
    }
    out.push({ object, effectivelyVisible: visible });
  });
  return out;
}

function visibleDrawables(gate: ReadabilityGate, renderer: { lastScene: Scene | null }): Set<Object3D> {
  gate.renderFrame();
  const scene = renderer.lastScene;
  if (!scene) throw new Error('test: renderer nie dostał sceny');
  return new Set(drawablesOf(scene).filter((d) => d.effectivelyVisible).map((d) => d.object));
}

describe('bramka a krata komórek (Faza 2B, Zadanie 2 — runda naprawcza 1)', () => {
  it('32. tryb „smooth" bramki maluje gładko TAKŻE kratę — mierzone na scenie, którą dostaje renderer', () => {
    // Przegląd przywrócił w `readabilityGate.ts` kod sprzed naprawy szwu (zapis wprost do
    // atrybutu `color` siatki terenu, z pominięciem `PlanetMesh`) i dostał 167/167 zielonych.
    // Test 28 w `planetMesh.test.ts` dowodzi, że `updateColorsSmooth` pisze OBA bufory — nic
    // nie dowodziło, że bramka tę metodę WOŁA. Tutaj mierzone jest to drugie: przez scenę.
    //
    // Czemu to jest ważne: tryb „smooth" ma pokazywać render BEZ progowania. Krata nadal
    // progowana rysowałaby w nim terminator jako skok barwy obrysu — czyli tryb pokazywałby
    // granicę, której z założenia pokazywać nie ma, a porównanie „ile dokłada progowanie"
    // (spec §7.3.1) przestałoby cokolwiek znaczyć.
    const { gate, renderer } = makeGate();
    gate.renderFrame();
    const scene = renderer.lastScene;
    if (!scene) throw new Error('test: renderer nie dostał sceny');

    // Krata znaleziona po LICZBIE WIERZCHOŁKÓW, nie po typie — 8640 odcinków × 2 wierzchołki.
    const outlineVertexCount = 8640 * 2;
    const outline = drawablesOf(scene)
      .map((d) => d.object as Object3D & { geometry: BufferGeometry })
      .find((o) => o.geometry.getAttribute('position')?.count === outlineVertexCount);
    expect(outline, 'brak geometrii kraty w scenie bramki').toBeDefined();
    const outlineColors = (outline!.geometry.getAttribute('color') as BufferAttribute).array as Float32Array;

    const distinctOutlineColors = (): number => {
      const seen = new Set<string>();
      for (let v = 0; v < outlineColors.length / 3; v++) {
        seen.add(`${outlineColors[v * 3]},${outlineColors[v * 3 + 1]},${outlineColors[v * 3 + 2]}`);
      }
      return seen.size;
    };

    gate.setMode('threshold');
    gate.renderFrame();
    // Progowanie: DOKŁADNIE tyle barw kraty, ile pasm. Kontrola pozytywna na pomiar —
    // gdyby bufor kraty był w ogóle nieodświeżany, byłaby tu jedynka (same zera).
    expect(distinctOutlineColors()).toBe(3);

    gate.setMode('smooth');
    gate.renderFrame();
    // Gładko: setki barw, bo każda komórka ma własne `light`. Próg 100 jest wartością
    // BEZWZGLĘDNĄ; asercja „więcej niż przy progowaniu" przeszłaby dla bufora o czterech.
    expect(distinctOutlineColors()).toBeGreaterThan(100);

    // I z powrotem — przełączenie trybu naprawdę przemalowuje kratę w obie strony.
    gate.setMode('threshold');
    gate.renderFrame();
    expect(distinctOutlineColors()).toBe(3);

    gate.dispose();
  });

  it('33. [NIEZMIENNIK] w trybie kontroli pozytywnej NIC z renderu gry nie jest widoczne — sprawdzane na całym drzewie sceny, bez wymieniania typów', () => {
    // To jest straż zastawiona na Zadanie 5, nie na dziś. Mechanizm ukrywania jest DZIEDZICZNY
    // (`planetMesh.mesh.visible = false` chowa też kratę, bo jest jej dzieckiem) i to jest dobra
    // decyzja — ale nic w bramce jej nie wymuszało. Gdy Zadanie 5 doda do sceny bramki budynki
    // i jednostki jako RODZEŃSTWO siatki terenu, zostaną widoczne w trybie kontrolnym, kontrola
    // pozytywna przestanie móc oblać, a test 16 nadal zaraportuje `[false, true]`, bo patrzy
    // wyłącznie na dwie siatki, które zna z nazwy.
    //
    // Dlatego ten test nie wymienia ŻADNEGO typu ani żadnej siatki: przechodzi całe drzewo,
    // liczy faktyczną widoczność z dziedziczeniem i orzeka o ZBIORACH.
    const { gate, renderer } = makeGate();

    gate.setMode('threshold');
    const inThreshold = visibleDrawables(gate, renderer);
    gate.setMode('control');
    const inControl = visibleDrawables(gate, renderer);

    // KONTROLE POZYTYWNE na sam pomiar: oba zbiory niepuste, a tryb oceniany pokazuje coś
    // PONAD znacznik (inaczej „rozłączność" byłaby prawdziwa z pustki).
    expect(inThreshold.size).toBeGreaterThan(1);
    expect(inControl.size).toBeGreaterThan(0);
    expect(inThreshold.has(gate.marker)).toBe(true);

    // WŁASNOŚĆ 1: jedyną rzeczą widoczną w OBU trybach jest znacznik. Cokolwiek innego, co
    // przetrwa przełączenie na kontrolę, pokazuje człowiekowi stan komórek w trybie, który ma
    // go NIE pokazywać — czyli odbiera kontroli zdolność do oblania.
    const inBoth = [...inControl].filter((o) => inThreshold.has(o));
    expect(inBoth).toEqual([gate.marker]);

    // WŁASNOŚĆ 2: w kontroli widać DOKŁADNIE dwie rzeczy — siatkę kontrolną i znacznik.
    // Liczba wpisana wprost, bo dołożenie czegokolwiek widocznego (także czegoś widocznego
    // WYŁĄCZNIE w kontroli, czego własność 1 by nie złapała) ma ten test oblać, a nie
    // przesunąć wraz z nim.
    expect(inControl.size).toBe(2);

    // WŁASNOŚĆ 3: w trybie ocenianym widać dokładnie trzy — teren, kratę i znacznik. Pilnuje
    // to drugiej strony tej samej monety: kraty, która w grze ZNIKA, a powinna być widoczna.
    expect(inThreshold.size).toBe(3);

    gate.dispose();
  });

  it('33b. [NIEZMIENNIK] to samo w PEŁNEJ SCENIE bramki Zadania 5 — budynki i jednostki też gasną razem z planetą', () => {
    // Zapadka z testu 33 była zastawiona dokładnie na to zadanie i **zadziałała**: gdyby
    // `fullScene` wieszał warstwy jako RODZEŃSTWO siatki terenu, jednostki zostałyby widoczne
    // w trybie kontrolnym — a jednostka pokazuje, po której stronie terminatora stoi (pali się
    // albo nie), więc rysowałaby granicę NIEZALEŻNIE od terenu i kontrola pozytywna
    // przestałaby móc oblać. To jest jedyny powód, dla którego pełna scena w ogóle może
    // dzielić harness z bramką terenową.
    //
    // Test 33 zostaje NIETKNIĘTY i nadal orzeka o konfiguracji Zadania 1 (sam teren): to ta
    // konfiguracja jest instrumentem, którym zmierzono 15/15, i nie wolno jej podmienić pod
    // tamtym wynikiem. Tutaj są własne, osobno przypięte liczby dla drugiej konfiguracji.
    const { gate, renderer } = makeGate(realPlans(), true);
    expect(gate.world, 'fullScene: true musi dać warstwy świata').not.toBeNull();

    gate.setMode('threshold');
    const inThreshold = visibleDrawables(gate, renderer);
    gate.setMode('control');
    const inControl = visibleDrawables(gate, renderer);

    expect(inThreshold.size).toBeGreaterThan(1);
    expect(inControl.size).toBeGreaterThan(0);
    expect(inThreshold.has(gate.marker)).toBe(true);

    // WŁASNOŚĆ 1: jedyną rzeczą widoczną w OBU trybach jest znacznik.
    const inBoth = [...inControl].filter((o) => inThreshold.has(o));
    expect(inBoth).toEqual([gate.marker]);

    // WŁASNOŚĆ 2: w kontroli nadal DOKŁADNIE dwie rzeczy — siatka kontrolna i znacznik.
    // Ta liczba jest identyczna jak w teście 33 i to jest jej treść: pełna scena nie dokłada
    // do kontroli ANI JEDNEGO widocznego obiektu.
    expect(inControl.size).toBe(2);

    // WŁASNOŚĆ 3: w trybie ocenianym widać dziewięć — teren, krata, CZTERY warstwy budynku
    // (bryła, rdzeń, przerywana obręcz alarmu, wycinki ją domykające), dwie warstwy jednostki
    // (tarcza, rdzeń) i znacznik. Liczba WPISANA WPROST, nie „co najmniej": dołożenie
    // czegokolwiek do pełnej sceny ma przejść przez ten test, bo dokładnie tego dotyczy
    // własność 1. (Ósma warstwa doszła w Zadaniu 4 Fazy 2C — patrz `buildingMesh.ts`.)
    expect(inThreshold.size).toBe(9);

    // KONTROLA POZYTYWNA NA SAM POMIAR: te same warstwy, które gasną, muszą być tymi, które
    // bramka faktycznie wystawia — inaczej „9" mogłoby pochodzić z dziewięciu innych obiektów.
    const world = gate.world!;
    for (const object of [
      world.buildings.shell,
      world.buildings.core,
      world.buildings.alert,
      world.buildings.link,
      world.units.body,
      world.units.core,
    ]) {
      expect(inThreshold.has(object), 'warstwa pełnej sceny nie jest widoczna w trybie ocenianym').toBe(true);
      expect(inControl.has(object), 'warstwa pełnej sceny PRZETRWAŁA przełączenie na kontrolę').toBe(false);
    }

    gate.dispose();
  });

  it('34. faza SWOBODNA: pierścień znika i NIE wraca przy kolejnej próbie, a teren daje się przemalować dowolnym światłem — ale tylko w trybie ocenianym', () => {
    // Faza swobodna bramki pełnego obrazu (pytania 2-5) nie zadaje żadnej próby, więc
    // pierścień wskazywałby komórkę, o którą nikt nie pyta. Ukrycie musi PRZEŻYĆ `setupTrial`
    // — inaczej wróciłby przy pierwszym ruchu panelu, a tego nie złapałby żaden test
    // patrzący tylko na stan bezpośrednio po wywołaniu.
    const { gate, renderer } = makeGate(realPlans(), true);
    const world = gate.world!;
    expect(gate.marker.visible).toBe(true);

    gate.setMarkerHidden(true);
    expect(gate.marker.visible).toBe(false);
    gate.answer(true);
    gate.advance();
    expect(gate.marker.visible, 'ukrycie nie przeżyło przejścia do kolejnej próby').toBe(false);
    expect(visibleDrawables(gate, renderer).has(gate.marker)).toBe(false);

    gate.setMarkerHidden(false);
    expect(gate.marker.visible).toBe(true);

    // `paintTerrain` maluje teren PODANYM polem, a nie polem próby: faza swobodna ma
    // orbitujące słońce. Mierzone na barwach, nie na fakcie wywołania.
    const nightEverywhere = new Float32Array(planet.cells.length);
    const dayEverywhere = new Float32Array(planet.cells.length).fill(1);
    const { flat } = meshesOf(gate, renderer);
    world.paintTerrain(nightEverywhere);
    const night = cellColorFlat(colorsOf(flat), 0);
    world.paintTerrain(dayEverywhere);
    const day = cellColorFlat(colorsOf(flat), 0);
    expect(distance(night, day), 'paintTerrain nie zmienia barw terenu').toBeGreaterThan(0.5);
    expect(night).toEqual(NIGHT);

    // ...i WYŁĄCZNIE w trybie ocenianym: tryb porównawczy i kontrolny mają pokazywać to, co
    // pokazują, a nie render gry przemalowany cudzym światłem — inaczej kontrola pozytywna
    // przestaje znaczyć to, co znaczy. Głośny błąd zamiast cichego rozjazdu.
    for (const mode of ['smooth', 'control'] as const) {
      gate.setMode(mode);
      expect(() => world.paintTerrain(dayEverywhere), mode).toThrow(RangeError);
    }
    gate.setMode('threshold');
    expect(() => world.paintTerrain(dayEverywhere)).not.toThrow();

    gate.dispose();
  });
});
