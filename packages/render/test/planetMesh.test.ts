import { describe, expect, it, vi } from 'vitest';
import { BufferAttribute, LineBasicMaterial, LineSegments, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { createPlanet, lightField, sunDirection } from '@heliopolis/sim';
import { buildPlanetGeometry } from '../src/geometry.js';
import { buildCellOutlines, createPlanetMesh, OUTLINE_INSET, OUTLINE_LIFT } from '../src/planetMesh.js';
import { DEFAULT_OUTLINE_PALETTE, DEFAULT_PALETTE } from '../src/shading.js';

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
    expect(planetMesh.mesh.material.vertexColors).toBe(true);
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

// Runda poprawek 1: przegląd zmierzył, że wypatroszenie dispose() do pustej funkcji (we
// wszystkich trzech modułach Zadania 4) zostawiało komplet testów zielonym. Tu — w
// przeciwieństwie do `scene.test.ts`, gdzie `PlanetMesh` nie jest wystawiony — mamy
// bezpośredni dostęp do `planetMesh.mesh.geometry`/`.material` (Three.js `Mesh` wystawia
// je publicznie), więc szpiegujemy PO INSTANCJI, nie po prototypie klasy — ostrzejsze,
// bo dowodzi, że dysponuje się WŁAŚCIWYM obiektem, nie "jakąkolwiek instancją tej klasy".
describe('createPlanetMesh — dispose() zwalnia geometrię i materiał', () => {
  it('woła dispose() na geometrii i materiale TEJ KONKRETNEJ siatki', () => {
    const planetMesh = createPlanetMesh(geo);
    const geometryDisposeSpy = vi.spyOn(planetMesh.mesh.geometry, 'dispose');
    const materialDisposeSpy = vi.spyOn(planetMesh.mesh.material, 'dispose');

    planetMesh.dispose();

    expect(geometryDisposeSpy).toHaveBeenCalledTimes(1);
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('buildCellOutlines — geometria kraty (Faza 2B, Zadanie 2)', () => {
  it('23. każda komórka dostaje ZAMKNIĘTĄ pętlę: 2 wierzchołki na krawędź, zakresy rozłączne i pokrywające bufor dokładnie raz', () => {
    const outlines = buildCellOutlines(geo);

    let expectedVertices = 0;
    let cursor = 0;
    let checkedCells = 0;
    for (let i = 0; i < planet.cells.length; i++) {
      const cornerCount = geo.cellVertexCount[i] - 1;
      // Zakres komórki `i` zaczyna się DOKŁADNIE tam, gdzie skończył się poprzedni —
      // bez dziur (niepokolorowane wierzchołki zostałyby czarne) i bez zakładek
      // (dwie komórki pisałyby po tym samym odcinku, więc jedna z nich nie miałaby obrysu).
      expect(outlines.cellVertexStart[i], `komórka ${i}`).toBe(cursor);
      expect(outlines.cellVertexCount[i], `komórka ${i}`).toBe(cornerCount * 2);
      cursor += cornerCount * 2;
      expectedVertices += cornerCount * 2;
      checkedCells++;
    }

    expect(checkedCells).toBe(1442); // kontrola: pętla przeszła wszystkie komórki
    // Zmierzone przy `frequency 12`: 12 pentagonów × 5 krawędzi + 1430 heksagonów × 6 = 8640
    // odcinków. Liczba wpisana WPROST, nie wyprowadzona z `outlines` — inaczej asercja
    // poruszałaby się razem z tym, co sprawdza.
    expect(expectedVertices).toBe(8640 * 2);
    expect(outlines.positions.length).toBe(8640 * 2 * 3);
    expect(cursor).toBe(outlines.positions.length / 3); // bufor pokryty co do wierzchołka
  });

  it('24. [KLUCZOWY] każdy wierzchołek obrysu leży WEWNĄTRZ swojej komórki i NAD terenem — to jest warunek nietykalności terminatora, nie estetyka', () => {
    // Obrys rysowany dokładnie po krawędziach dawałby na granicy pasm DWIE pokrywające się
    // linie w różnych kolorach: migotanie plus PRZYKRYCIE samej granicy (skok „obrys nocy ↔
    // obrys zmierzchu" to 0,5546 zamiast 0,9005 — 62% tego, co jest dziś). Wciągnięcie do
    // środka zostawia między obrysami sąsiadów pasek ICH wypełnień, więc granica pasm zostaje
    // narysowana pełnym skokiem palety.
    const outlines = buildCellOutlines(geo);
    const radius = planet.radius;

    let checked = 0;
    let minInsetWorld = Number.POSITIVE_INFINITY;
    let minLiftWorld = Number.POSITIVE_INFINITY;
    for (let i = 0; i < planet.cells.length; i++) {
      const start = geo.cellVertexStart[i];
      const cornerCount = geo.cellVertexCount[i] - 1;
      const c = start * 3;
      const center = [geo.positions[c], geo.positions[c + 1], geo.positions[c + 2]];

      for (let k = 0; k < cornerCount; k++) {
        const src = (start + 1 + k) * 3;
        const corner = [geo.positions[src], geo.positions[src + 1], geo.positions[src + 2]];
        // Oczekiwana pozycja policzona TU, niezależnie od implementacji: liniowe wciągnięcie
        // narożnika w stronę środka, potem uniesienie promieniowe.
        const expected = corner.map((v, axis) => (v + (center[axis] - v) * OUTLINE_INSET) * (1 + OUTLINE_LIFT));

        // Narożnik `k` jest pierwszym wierzchołkiem odcinka `k` oraz drugim wierzchołkiem
        // odcinka `k-1` — obie kopie muszą być tą samą pozycją, inaczej pętla się rozspaja.
        const first = (outlines.cellVertexStart[i] + 2 * k) * 3;
        const second = (outlines.cellVertexStart[i] + ((2 * k - 1 + cornerCount * 2) % (cornerCount * 2))) * 3;
        for (let axis = 0; axis < 3; axis++) {
          expect(outlines.positions[first + axis], `komórka ${i}, narożnik ${k}, oś ${axis}`).toBeCloseTo(
            expected[axis],
            3,
          );
          expect(outlines.positions[second + axis], `komórka ${i}, narożnik ${k} (druga kopia)`).toBeCloseTo(
            expected[axis],
            3,
          );
        }

        // WŁASNOŚĆ 1: obrys jest ISTOTNIE wciągnięty — mierzone w jednostkach świata, nie
        // jako „różni się od narożnika". Przy promieniu 100 i średnicy komórki ok. 10 to
        // jest ok. 0,35 jednostki, czyli ok. 3,5% komórki na każdą stronę krawędzi.
        const insetWorld = Math.hypot(
          expected[0] / (1 + OUTLINE_LIFT) - corner[0],
          expected[1] / (1 + OUTLINE_LIFT) - corner[1],
          expected[2] / (1 + OUTLINE_LIFT) - corner[2],
        );
        minInsetWorld = Math.min(minInsetWorld, insetWorld);

        // WŁASNOŚĆ 2: obrys jest NAD terenem. Odcinek narożnik→środek należy do trójkąta
        // wachlarza, więc bez uniesienia linia leżałaby DOKŁADNIE w jego płaszczyźnie i
        // migotała. Uniesienie mierzone jako przyrost odległości od środka planety.
        const lifted = Math.hypot(expected[0], expected[1], expected[2]);
        const flat = lifted / (1 + OUTLINE_LIFT);
        minLiftWorld = Math.min(minLiftWorld, lifted - flat);

        checked++;
      }
    }

    expect(checked).toBe(8640); // kontrola pozytywna: sprawdzone WSZYSTKIE narożniki
    // Wartości BEZWZGLĘDNE w jednostkach świata przy `radius` fixture'y. Gdyby OUTLINE_INSET
    // albo OUTLINE_LIFT spadły do zera, obie oblewają — a asercja „różni się od narożnika"
    // by nie oblała, bo samo uniesienie już daje różnicę.
    expect(radius).toBe(100); // kotwica: poniższe progi są w jednostkach TEJ planety
    expect(minInsetWorld).toBeGreaterThan(0.2);
    expect(minLiftWorld).toBeGreaterThan(0.15);
  });

  it('25. buildCellOutlines rzuca RangeError na niezgodnych długościach i na zdegenerowanej komórce', () => {
    // Kontrola pozytywna: prawdziwa geometria NIE rzuca — dowód, że rzuty niżej biorą się z
    // podanego defektu, a nie z czegokolwiek innego.
    expect(() => buildCellOutlines(geo)).not.toThrow();

    const mismatched = { ...geo, cellVertexCount: geo.cellVertexCount.slice(0, geo.cellVertexCount.length - 1) };
    expect(() => buildCellOutlines(mismatched)).toThrow(RangeError);

    // Komórka o trzech wierzchołkach (środek + 2 narożniki) nie ma zamkniętej pętli do
    // narysowania. Bez strażnika `cellVertexCount` samych zer dałoby po cichu PUSTY bufor —
    // czyli planetę wyglądającą dokładnie tak, jak przed tym zadaniem.
    const degenerate = { ...geo, cellVertexCount: geo.cellVertexCount.slice() };
    degenerate.cellVertexCount[7] = 3;
    let thrown: unknown;
    try {
      buildCellOutlines(degenerate);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as Error).message).toContain('7');
  });
});

describe('createPlanetMesh — krata jako DZIECKO siatki terenu', () => {
  it('26. outline to LineSegments z LineBasicMaterial i vertexColors, dziecko mesh — więc chowa się razem z planetą (kontrola pozytywna bramki)', () => {
    const planetMesh = createPlanetMesh(geo);

    expect(planetMesh.outline).toBeInstanceOf(LineSegments);
    expect(planetMesh.outline.material).toBeInstanceOf(LineBasicMaterial);
    expect(planetMesh.outline.material.vertexColors).toBe(true);

    // Dziecko, nie rodzeństwo. `readabilityGate.ts` chowa planetę w trybie kontroli
    // pozytywnej przez `planetMesh.mesh.visible = false` i NIC nie wie o kracie; `visible`
    // w Three.js jest dziedziczne, więc krata znika razem z nią. Krata widoczna w trybie
    // kontrolnym byłaby wskazówką pokazującą granicę tam, gdzie kontrola ma jej NIE
    // pokazywać — czyli kontrola przestałaby móc oblać.
    expect(planetMesh.mesh.children).toContain(planetMesh.outline);
    expect(planetMesh.outline.parent).toBe(planetMesh.mesh);

    // Atrybut `color` kraty ma długość jej bufora pozycji — inaczej `writeCellColors` rzuci.
    const pos = planetMesh.outline.geometry.getAttribute('position') as BufferAttribute;
    const col = planetMesh.outline.geometry.getAttribute('color') as BufferAttribute;
    expect(col.array.length).toBe(pos.array.length);

    planetMesh.dispose();
  });

  it('27. updateColors maluje kratę paletą OBRYSÓW (nie paletą wypełnień) i nie realokuje jej bufora', () => {
    const planetMesh = createPlanetMesh(geo);
    const col = planetMesh.outline.geometry.getAttribute('color') as BufferAttribute;
    const arrayRef = col.array;
    const versionBefore = col.version;

    planetMesh.updateColors(light);
    planetMesh.updateColors(light);

    expect(col.array).toBe(arrayRef); // dosłownie ta sama referencja
    expect(col.version).toBeGreaterThan(versionBefore);

    const arr = col.array as Float32Array;
    const seen = new Set<string>();
    for (let v = 0; v < arr.length / 3; v++) {
      seen.add(`${arr[v * 3]},${arr[v * 3 + 1]},${arr[v * 3 + 2]}`);
    }
    // Krata niesie DOKŁADNIE kolory palety obrysów — po jednym na pasmo, nic więcej.
    const expectedOutline = new Set(
      DEFAULT_OUTLINE_PALETTE.map((c) => `${Math.fround(c[0])},${Math.fround(c[1])},${Math.fround(c[2])}`),
    );
    expect([...seen].sort()).toEqual([...expectedOutline].sort());
    // …i ŻADNEGO koloru z palety wypełnień. Bez tej asercji pomyłka „pomalowano kratę tą samą
    // paletą co teren" (czyli krata niewidoczna, bo w kolorze własnego wypełnienia) przeszłaby
    // przez wszystko powyżej.
    for (const c of DEFAULT_PALETTE) {
      expect(seen.has(`${Math.fround(c[0])},${Math.fround(c[1])},${Math.fround(c[2])}`)).toBe(false);
    }

    planetMesh.dispose();
  });

  it('28. updateColorsSmooth maluje gładko OBA bufory — bo tryb porównawczy bramki inaczej pokazywałby terminator kratą', () => {
    // To jest test szwu, który przy tym zadaniu powstał: kolor planety mieszka od teraz w
    // DWÓCH buforach, a `readabilityGate.ts` w trybie „smooth" pisał wprost do jednego z nich.
    // Zostawienie kraty progowanej zostawiłoby w tym trybie WIDOCZNY terminator (skok barwy
    // obrysu) — w trybie, którego cała rola polega na pokazaniu renderu BEZ progowania.
    const planetMesh = createPlanetMesh(geo);
    const fill = planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute;
    const outline = planetMesh.outline.geometry.getAttribute('color') as BufferAttribute;

    const distinctCellColors = (attr: BufferAttribute, ranges: Uint32Array): number => {
      const arr = attr.array as Float32Array;
      const seen = new Set<string>();
      for (let i = 0; i < ranges.length; i++) {
        const o = ranges[i] * 3;
        seen.add(`${arr[o]},${arr[o + 1]},${arr[o + 2]}`);
      }
      return seen.size;
    };
    const outlines = buildCellOutlines(geo);

    planetMesh.updateColors(light);
    // Progowanie: DOKŁADNIE tyle różnych kolorów, ile pasm — w obu buforach.
    expect(distinctCellColors(fill, geo.cellVertexStart)).toBe(DEFAULT_PALETTE.length);
    expect(distinctCellColors(outline, outlines.cellVertexStart)).toBe(DEFAULT_OUTLINE_PALETTE.length);

    planetMesh.updateColorsSmooth(light);
    // Gładko: setki różnych kolorów, bo każda komórka ma własne `light`. Próg 100 jest
    // wartością BEZWZGLĘDNĄ — asercja „więcej niż przy progowaniu" przeszłaby dla bufora o
    // czterech kolorach. Zmierzone przy tej fazie słońca: 173 dla OBU buforów (mniej niż 697
    // komórek oświetlonych, bo zapis do Float32Array sklepuje część sąsiednich odcieni do tej
    // samej trójki, a 745 komórek nocy daje przy tym jeden kolor).
    expect(distinctCellColors(fill, geo.cellVertexStart)).toBeGreaterThan(100);
    expect(distinctCellColors(outline, outlines.cellVertexStart)).toBeGreaterThan(100);

    planetMesh.dispose();
  });
});
