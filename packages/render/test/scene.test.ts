import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPlanet, lightField, sunDirection, type Planet } from '@heliopolis/sim';
import { createSceneWithRenderer, type SceneRenderer } from '../src/scene.js';
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

function createFakeRenderer(): SceneRenderer & { renderCalls: number } {
  const renderer = {
    renderCalls: 0,
    render(): void {
      renderer.renderCalls++;
    },
    setSize(): void {},
    setPixelRatio(): void {},
    setClearColor(): void {},
    dispose(): void {},
  };
  return renderer;
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
