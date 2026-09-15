import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material } from 'three';
import { createPlanet, lightField, sunDirection, type Planet } from '@heliopolis/sim';
import { cappedPixelRatio, createSceneWithRenderer, MAX_PIXEL_RATIO, type SceneRenderer } from '../src/scene.js';
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
    expect(geometryDisposeSpy).toHaveBeenCalledTimes(1);
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1);
    expect(fakeRenderer.disposeCalls).toBe(1);

    geometryDisposeSpy.mockRestore();
    materialDisposeSpy.mockRestore();
  });
});
