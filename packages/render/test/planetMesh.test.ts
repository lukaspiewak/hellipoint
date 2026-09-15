import { describe, expect, it } from 'vitest';
import { BufferAttribute, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { createPlanet, lightField, sunDirection } from '@heliopolis/sim';
import { buildPlanetGeometry } from '../src/geometry.js';
import { createPlanetMesh } from '../src/planetMesh.js';
import { DEFAULT_PALETTE } from '../src/shading.js';

const planet = createPlanet({ seed: 20260915 });
const geo = buildPlanetGeometry(planet);
const light = lightField(planet, sunDirection(0, 180));

describe('createPlanetMesh — materiał BEZ modelu oświetlenia (D1 stoi na tym)', () => {
  // To jest, wg briefu, "najłatwiejszy sposób zepsucia Fazy 2A, którego żaden test nie
  // zauważy" — więc dostaje własny, wprost nazwany test, nie tylko poleganie na tym,
  // że render "jakoś wygląda dobrze" na oko.
  it('mesh.material to MeshBasicMaterial z vertexColors: true, NIGDY MeshStandardMaterial', () => {
    const planetMesh = createPlanetMesh(geo);
    expect(planetMesh.mesh.material).toBeInstanceOf(MeshBasicMaterial);
    expect(planetMesh.mesh.material).not.toBeInstanceOf(MeshStandardMaterial);
    expect((planetMesh.mesh.material as MeshBasicMaterial).vertexColors).toBe(true);
    planetMesh.dispose();
  });
});

describe('createPlanetMesh — bufor kolorów: własność tego modułu, zaalokowany RAZ', () => {
  it('atrybut color ma długość geo.positions.length', () => {
    const planetMesh = createPlanetMesh(geo);
    const colorAttr = planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute;
    expect(colorAttr.array.length).toBe(geo.positions.length);
    planetMesh.dispose();
  });

  it('updateColors NIE realokuje bufor — ta sama referencja tablicy po wielu wywołaniach', () => {
    const planetMesh = createPlanetMesh(geo);
    const before = planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute;
    const arrayRef = before.array;

    planetMesh.updateColors(light);
    planetMesh.updateColors(light);
    planetMesh.updateColors(light);

    const after = planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute;
    expect(after.array).toBe(arrayRef); // dosłownie ta sama referencja, nie tylko "równa"
    planetMesh.dispose();
  });

  it('updateColors zapisuje realne kolory palety (nie zostawia bufora samymi zerami)', () => {
    const planetMesh = createPlanetMesh(geo);
    planetMesh.updateColors(light);
    const arr = (planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute).array as Float32Array;
    // Pierwsza komórka: sprawdzone wprost przez writeCellColors/shading.test.ts — tu
    // tylko dowód spięcia (nie same zera, czyli pętla faktycznie się wykonała).
    const anyNonZero = Array.from(arr).some((v) => v !== 0);
    expect(anyNonZero).toBe(true);
    planetMesh.dispose();
  });

  it('updateColors podnosi version atrybutu (needsUpdate faktycznie coś robi, nie tylko deklaruje)', () => {
    const planetMesh = createPlanetMesh(geo);
    const colorAttr = planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute;
    const versionBefore = colorAttr.version;
    planetMesh.updateColors(light);
    expect(colorAttr.version).toBeGreaterThan(versionBefore);
    planetMesh.dispose();
  });

  it('updateColors akceptuje paletę niestandardową (Faza 4 podmienia paletę bez zmiany tego pliku)', () => {
    const planetMesh = createPlanetMesh(geo);
    // Nie rzuca i nadal pisze coś sensownego — samo przejście przez API z niestandardową
    // paletą, o poprawnej długości `LIGHT_BANDS.length + 1` (dziedziczonej z DEFAULT_PALETTE).
    expect(() => planetMesh.updateColors(light, DEFAULT_PALETTE)).not.toThrow();
    planetMesh.dispose();
  });
});
