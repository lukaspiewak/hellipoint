import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material, type Object3D, type Scene } from 'three';
import { BUILDINGS, createPlanet, lightField, sunDirection, type Building, type Planet } from '@heliopolis/sim';
import { cappedPixelRatio, createSceneWithRenderer, MAX_PIXEL_RATIO, type SceneRenderer } from '../src/scene.js';
import { alertPulse, createBuildingLayer, ALERT_PULSE_PERIOD_SECONDS } from '../src/buildingMesh.js';
import { buildPlanetGeometry } from '../src/geometry.js';
import { createFakeCanvas } from './support/fakeCanvas.js';

/**
 * SHA-256 nad każdym polem numerycznym/łańcuchowym `Planet`/`Cell`, po bitach float64
 * (`Float64Array.of(n).buffer`), nie po reprezentacji dziesiętnej — ta sama zasada co
 * `stateHash` w `packages/sim/src/sim/hash.ts` (test determinizmu ma widzieć różnicę na
 * poziomie ULP). Lokalna dla tego pliku testowego — `packages/sim` zostaje bez zależności
 * i bez żadnej wiedzy o tym, że render w ogóle istnieje.
 */
function hashPlanet(planet: Planet): string {
  const h = createHash('sha256');
  const num = (n: number): void => {
    h.update(Buffer.from(Float64Array.of(n).buffer));
  };
  num(planet.seed);
  num(planet.radius);
  num(planet.frequency);
  num(planet.startCell);
  for (const p of planet.pentagons) num(p);
  for (const cell of planet.cells) {
    num(cell.id);
    num(cell.center.x);
    num(cell.center.y);
    num(cell.center.z);
    num(cell.normal.x);
    num(cell.normal.y);
    num(cell.normal.z);
    for (const corner of cell.corners) {
      num(corner.x);
      num(corner.y);
      num(corner.z);
    }
    for (const neighbor of cell.neighbors) num(neighbor);
    h.update(cell.cellType);
    num(cell.oreCapacity);
  }
  return h.digest('hex');
}

function createFakeRenderer(): SceneRenderer & {
  renderCalls: number;
  setPixelRatioCalls: number[];
  disposeCalls: number;
} {
  const renderer = {
    renderCalls: 0,
    setPixelRatioCalls: [] as number[],
    disposeCalls: 0,
    render(): void {
      renderer.renderCalls++;
    },
    setSize(): void {},
    setPixelRatio(ratio: number): void {
      renderer.setPixelRatioCalls.push(ratio);
    },
    setClearColor(): void {},
    dispose(): void {
      renderer.disposeCalls++;
    },
  };
  return renderer;
}

/** Rzutuje na obiekt z zapisywalnymi `clientWidth`/`clientHeight`, do symulacji resize
 *  w teście — omija ewentualne `readonly` w typach DOM, bez zmiany `fakeCanvas.ts` ani
 *  jego innych, już istniejących zastosowań (które nigdy nie mutują wymiarów). */
function resizeFakeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  const mutable = canvas as unknown as { clientWidth: number; clientHeight: number };
  mutable.clientWidth = width;
  mutable.clientHeight = height;
}

describe('hashPlanet — sonda pomiarowa (dowód, że w ogóle widzi zmianę)', () => {
  it('KONTROLA POZYTYWNA: wykrywa realną mutację Planet', () => {
    const planet = createPlanet({ seed: 20260915 });
    const before = hashPlanet(planet);
    // Przebicie `readonly` WYŁĄCZNIE po to, żeby zweryfikować czułość sondy — nigdzie
    // indziej w tym pliku Planet nie jest mutowany naprawdę.
    (planet.cells[0] as { oreCapacity: number }).oreCapacity += 1;
    const after = hashPlanet(planet);
    expect(after).not.toBe(before);
  });

  it('jest stabilny (ten sam wynik) gdy NIC się nie zmieniło', () => {
    const planet = createPlanet({ seed: 20260915 });
    expect(hashPlanet(planet)).toBe(hashPlanet(planet));
  });
});

describe('createSceneWithRenderer — render() nie mutuje Planet (global-constraints.md)', () => {
  it('render() wywołany wielokrotnie zostawia Planet bit w bit identyczny', () => {
    const planet = createPlanet({ seed: 20260915 });
    const before = hashPlanet(planet);

    const fakeRenderer = createFakeRenderer();
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => fakeRenderer);

    const sunDir = sunDirection(42, 180);
    const light = lightField(planet, sunDir);
    for (let i = 0; i < 5; i++) {
      scene.render(light, sunDir);
    }

    // Dowód, że render() NAPRAWDĘ się wykonał 5 razy (nie zero) — bez tego hash
    // przed/po byłby zielony nawet gdyby pętla wyżej z jakiegoś powodu nic nie zrobiła.
    expect(fakeRenderer.renderCalls).toBe(5);

    const after = hashPlanet(planet);
    expect(after).toBe(before);

    scene.dispose();
  });

  it('konstrukcja sceny (buildPlanetGeometry + createPlanetMesh + createCamera) TEŻ nie mutuje Planet', () => {
    const planet = createPlanet({ seed: 20260915 });
    const before = hashPlanet(planet);
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => createFakeRenderer());
    expect(hashPlanet(planet)).toBe(before);
    scene.dispose();
  });
});

describe('createSceneWithRenderer — render() faktycznie porusza kamerą i rysuje', () => {
  it('render() woła camera.update() i przekazuje renderer.render(scene, camera.object)', () => {
    const planet = createPlanet({ seed: 20260915 });
    const fakeRenderer = createFakeRenderer();
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => fakeRenderer);

    const updateSpy = vi.spyOn(scene.camera, 'update');
    scene.render(lightField(planet, sunDirection(0, 180)), sunDirection(0, 180));

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(fakeRenderer.renderCalls).toBe(1);

    scene.dispose();
  });

  it('dispose() nie rzuca', () => {
    const planet = createPlanet({ seed: 20260915 });
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => createFakeRenderer());
    expect(() => scene.dispose()).not.toThrow();
  });
});

// Runda poprawek 1: przegląd zmierzył, że zaszycie `camera.object.aspect = 1` na sztywno
// zostawiało KOMPLET testów zielonym — skutkiem w przeglądarce byłaby planeta renderowana
// jako widoczna elipsa w każdym niekwadratowym oknie. Poniższe testy kotwiczą PROPORCJĘ do
// niezależnie policzonego `width / height`, nie do stałej.
describe('createSceneWithRenderer — proporcje kamery liczone z wymiarów canvasu', () => {
  it('aspect przy tworzeniu równa się szerokości/wysokości canvasu, NIE stałej', () => {
    const planet = createPlanet({ seed: 20260915 });
    const canvas = createFakeCanvas(1024, 768);
    const scene = createSceneWithRenderer(planet, canvas, () => createFakeRenderer());

    expect(scene.camera.object.aspect).toBeCloseTo(1024 / 768, 9);
    // Kotwica niezależna od implementacji: gdyby aspect był zaszyty na 1, ten test by
    // to złapał, bo 1024/768 ≈ 1,333 ≠ 1.
    expect(scene.camera.object.aspect).not.toBeCloseTo(1, 2);

    scene.dispose();
  });

  it('resize() przelicza aspect po zmianie wymiarów canvasu', () => {
    const planet = createPlanet({ seed: 20260915 });
    const canvas = createFakeCanvas(800, 600);
    const scene = createSceneWithRenderer(planet, canvas, () => createFakeRenderer());
    const initialAspect = scene.camera.object.aspect;

    resizeFakeCanvas(canvas, 500, 1000); // odwrotna proporcja (węższe niż wyższe)
    scene.resize();

    expect(scene.camera.object.aspect).toBeCloseTo(500 / 1000, 9);
    expect(scene.camera.object.aspect).not.toBeCloseTo(initialAspect, 2);

    scene.dispose();
  });
});

describe('cappedPixelRatio — matematyka limitu (funkcja czysta)', () => {
  it('nie rusza wartości poniżej lub równej MAX_PIXEL_RATIO', () => {
    expect(cappedPixelRatio(1)).toBe(1);
    expect(cappedPixelRatio(MAX_PIXEL_RATIO)).toBe(MAX_PIXEL_RATIO);
  });

  it('przycina wartości powyżej MAX_PIXEL_RATIO do DOKŁADNIE MAX_PIXEL_RATIO', () => {
    expect(cappedPixelRatio(3)).toBe(MAX_PIXEL_RATIO);
    expect(cappedPixelRatio(10)).toBe(MAX_PIXEL_RATIO);
  });
});

describe('createSceneWithRenderer — setPixelRatio faktycznie wołany (nie tylko zaślepiony w atrapie)', () => {
  it('wołany przy tworzeniu sceny', () => {
    const planet = createPlanet({ seed: 20260915 });
    const fakeRenderer = createFakeRenderer();
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => fakeRenderer);

    expect(fakeRenderer.setPixelRatioCalls.length).toBeGreaterThanOrEqual(1);
    expect(fakeRenderer.setPixelRatioCalls[0]).toBeLessThanOrEqual(MAX_PIXEL_RATIO);

    scene.dispose();
  });

  it('wołany PONOWNIE przy resize()', () => {
    const planet = createPlanet({ seed: 20260915 });
    const fakeRenderer = createFakeRenderer();
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => fakeRenderer);
    const callsAfterConstruction = fakeRenderer.setPixelRatioCalls.length;

    scene.resize();

    expect(fakeRenderer.setPixelRatioCalls.length).toBeGreaterThan(callsAfterConstruction);

    scene.dispose();
  });
});

// Runda poprawek 1: przegląd zmierzył, że wypatroszenie WSZYSTKICH TRZECH dispose() do
// pustych funkcji (camera.ts, planetMesh.ts, scene.ts) zostawiało 31/31 testów zielonych.
// `PlanetMesh` nie jest wystawiony na `PlanetScene`, więc nie da się złapać jego
// geometrii/materiału PO INSTANCJI (jak dla `scene.camera` niżej) — szpiegujemy więc na
// poziomie prototypu klasy Three.js, którą `planetMesh.ts` faktycznie tworzy. To działa,
// bo `MeshBasicMaterial` NIE nadpisuje `dispose` (dziedziczy z `Material.prototype`,
// zweryfikowane w źródle `three` przed napisaniem tego testu) — szpiegowanie właściwej
// klasy bazowej jest tu load-bearing, nie kosmetyczne.
describe('createSceneWithRenderer — dispose() zwalnia WSZYSTKO, co posiada', () => {
  it('woła dispose() na kamerze (OrbitControls), geometrii, materiale i rendererze', () => {
    const planet = createPlanet({ seed: 20260915 });
    const fakeRenderer = createFakeRenderer();
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => fakeRenderer);

    const cameraDisposeSpy = vi.spyOn(scene.camera, 'dispose');
    const geometryDisposeSpy = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const materialDisposeSpy = vi.spyOn(Material.prototype, 'dispose');

    scene.dispose();

    expect(cameraDisposeSpy).toHaveBeenCalledTimes(1);
    // SIEDEM geometrii i SIEDEM materiałów od Fazy 2B, Zadanie 4: teren
    // (`MeshBasicMaterial`), obrysy komórek (`LineBasicMaterial`, dziecko siatki terenu),
    // trzy warstwy budynków — bryła, rdzeń i pierścień alarmu (`buildingMesh.ts`) — oraz
    // dwie warstwy jednostek: tarcza i rdzeń (`unitMesh.ts`). Liczba jest tu wpisana wprost,
    // a nie wyprowadzona z czegokolwiek w kodzie produkcyjnym — dołożenie kolejnego zasobu
    // bez dołożenia mu `dispose()` ma ten test OBLAĆ, a nie przesunąć wraz z nim. (Do
    // Zadania 3 stały tu dwójki, do Zadania 4 piątki.)
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(7);
    expect(materialDisposeSpy).toHaveBeenCalledTimes(7);
    expect(fakeRenderer.disposeCalls).toBe(1);

    geometryDisposeSpy.mockRestore();
    materialDisposeSpy.mockRestore();
  });
});

/**
 * Snapshot WSZYSTKICH buforów macierzy instancji w scenie, w kolejności obchodzenia drzewa.
 * Bez wymieniania typów z nazwy — „warstwa instancjonowana" to tutaj „obiekt z
 * `instanceMatrix`", tak samo jak „rysowalny" w teście 33 to „obiekt z geometrią". Dzięki temu
 * test nie zaczyna nagle przepuszczać dołożonej warstwy tylko dlatego, że ma inną klasę.
 */
function instanceMatrixSnapshot(root: Scene | null): { object: Object3D; matrices: number[] }[] {
  if (!root) throw new Error('test: renderer nie dostał sceny');
  const out: { object: Object3D; matrices: number[] }[] = [];
  root.traverse((object) => {
    const attribute = (object as { instanceMatrix?: { array: ArrayLike<number> } }).instanceMatrix;
    if (attribute) out.push({ object, matrices: Array.from(attribute.array) });
  });
  return out;
}

describe('createSceneWithRenderer — PULS pierścienia alarmu dochodzi z zegara do warstwy (ustalenie U2)', () => {
  it('scena gry przekazuje warstwie budynków NIEZEROWE wychylenie, równe DOKŁADNIE alertPulse(radius, t)', () => {
    // Jedyna zmiana kodu, którą wyprodukował werdykt człowieka U2 („puls WŁĄCZONY domyślnie,
    // TAKŻE w grze"), nie miała ŻADNEGO testu: podmiana ciała `updateBuildings` na
    // `buildings.update(list, 0)` dawała 588/588 zielonych, a `× 0,05` (puls dwudziestokrotnie
    // cichszy) tak samo. Gorzej: test 24 w `buildingMesh.test.ts` pilnuje własności
    // PRZECIWNEJ („bez wychylenia macierze identyczne co do bitu"), więc pakiet czytał się
    // tak, jakby chroniony był wariant WYŁĄCZONY. Ten test jest drugą stroną tamtej pary.
    //
    // Wiązane są tu trzy rzeczy naraz, i dopiero razem wykluczają obie mutacje:
    //   (1) wychylenie JEST niezerowe,
    //   (2) jest DOKŁADNIE tym, co daje `alertPulse` — czyli scena przelicza SEKUNDY, a nie
    //       przekazuje ich dalej surowych ani nie tłumi amplitudy,
    //   (3) rusza się DOKŁADNIE jedna warstwa sceny (puls nie przecieka na teren/jednostki).
    const planet = createPlanet({ seed: 20260915 });
    let lastScene: Scene | null = null;
    const renderer: SceneRenderer = {
      render: (scene: Scene): void => {
        lastScene = scene;
      },
      setSize: (): void => {},
      setPixelRatio: (): void => {},
      setClearColor: (): void => {},
      dispose: (): void => {},
    };
    const scene = createSceneWithRenderer(planet, createFakeCanvas(), () => renderer);

    // Pierścień alarmu istnieje WYŁĄCZNIE dla `powered === false`, więc bez niezasilonych
    // budynków ten test mierzyłby pustą warstwę i przechodził dla każdej implementacji.
    const list: (Building | null)[] = new Array<Building | null>(planet.cells.length).fill(null);
    for (let i = 0; i < 40; i++) {
      const cellId = i * 7;
      list[cellId] = { cellId, type: 'KINETIC_TURRET', hp: BUILDINGS.KINETIC_TURRET.hp, powered: false };
    }

    scene.updateBuildings(list);
    scene.render(new Float32Array(planet.cells.length), { x: 1, y: 0, z: 0 });
    const resting = instanceMatrixSnapshot(lastScene);
    expect(resting.length).toBeGreaterThan(0); // kontrola na sam przyrząd: jest co porównywać

    // SZCZYT pulsu — pół okresu od zera, czyli miejsce, w którym `alertPulse` sięga
    // maksymalnej legalnej amplitudy. Kontrola pozytywna na sam pomiar: to NIE jest zero.
    const peakSeconds = ALERT_PULSE_PERIOD_SECONDS / 2;
    const offset = alertPulse(planet.radius, peakSeconds);
    expect(offset).toBeGreaterThan(0);

    scene.updateBuildings(list, peakSeconds);
    const pulsed = instanceMatrixSnapshot(lastScene);
    expect(pulsed.length).toBe(resting.length);

    const changed = pulsed.filter((entry, i) => JSON.stringify(entry.matrices) !== JSON.stringify(resting[i].matrices));
    expect(changed.length, 'puls ma ruszyć DOKŁADNIE jedną warstwę sceny').toBe(1);

    // Warstwa odniesienia: ta sama konstrukcja i ten sam CIĄG wywołań, ale z wychyleniem
    // podanym wprost. Gdyby scena podała inne wychylenie (zero, stłumione, albo surowe
    // sekundy), macierze by się rozeszły — a przy sekundach `update` rzuciłby RangeError-em,
    // bo 0,8 leży daleko ponad sufitem 0,13.
    const reference = createBuildingLayer(planet, buildPlanetGeometry(planet));
    reference.update(list);
    reference.update(list, offset);
    expect(changed[0].matrices).toEqual(Array.from(reference.alert.instanceMatrix.array));
    reference.dispose();

    // PARA, połówka „ma PRZEJŚĆ": jawne zero jest tym samym, co brak zegara — co do bitu.
    // Bez tej połówki test przechodziłby także dla sceny, która ignoruje argument i pulsuje
    // ZAWSZE, czyli dla wywołującego bez zegara (zrzut klatki) nie byłaby deterministyczna.
    scene.updateBuildings(list, 0);
    const explicitZero = instanceMatrixSnapshot(lastScene);
    expect(explicitZero.map((e) => e.matrices)).toEqual(resting.map((e) => e.matrices));

    scene.dispose();
  });
});
