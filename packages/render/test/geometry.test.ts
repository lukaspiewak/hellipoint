import { describe, expect, it } from 'vitest';
import { createPlanet, cross, dot, sub } from '@heliopolis/sim';
import type { Vec3 } from '@heliopolis/sim';
import { buildPlanetGeometry, type PlanetGeometry } from '../src/geometry.js';

const planet = createPlanet({ seed: 20260915 });
const geo = buildPlanetGeometry(planet);

// Policzone NIEZALEŻNIE od implementacji, wprost z `planet.cells` (nie z `geo` samego
// siebie) — kotwica, żeby testy sumy/pokrycia/determinizmu nie mogły przejść na pustych
// albo obciętych tablicach tylko dlatego, że porównują wynik implementacji z samym sobą.
const expectedVertexCount = planet.cells.reduce((sum, c) => sum + c.corners.length + 1, 0);
const expectedTriangleCount = planet.cells.reduce((sum, c) => sum + c.corners.length, 0);

function vecAt(arr: Float32Array, vertexIndex: number): Vec3 {
  return { x: arr[vertexIndex * 3], y: arr[vertexIndex * 3 + 1], z: arr[vertexIndex * 3 + 2] };
}

/**
 * Czy trójka pod `vertexIndex` w `arr` (`positions` ALBO `normals` — ten sam układ xyz na
 * wierzchołek) odpowiada DOKŁADNIE `expected` — z poprawnym zaokrągleniem float64→float32
 * (`Math.fround`, dokładnie to co robi zapis do `Float32Array`), więc porównanie jest ścisłe
 * (`===`), nie tolerancyjne. Zamierzenie: żadna tolerancja nie ma szansy zamaskować podmiany
 * na WŁAŚCIWĄ, ale INNĄ komórkę — dwie różne komórki na sferze nie mają współrzędnych
 * bliskich siebie na tyle, żeby jakakolwiek rozsądna tolerancja je pomyliła, ale ścisła
 * równość zamyka to pytanie definitywnie. Dla `normals` to jest jeszcze ważniejsze niż dla
 * `positions`: normalne DWÓCH SĄSIADUJĄCYCH komórek przy frequency 12 różnią się o kilka
 * stopni, więc każda tolerancja "z rozsądku" przepuściłaby podmianę na sąsiada.
 */
function vertexMatches(arr: Float32Array, vertexIndex: number, expected: Vec3): boolean {
  const o = vertexIndex * 3;
  return (
    arr[o] === Math.fround(expected.x) &&
    arr[o + 1] === Math.fround(expected.y) &&
    arr[o + 2] === Math.fround(expected.z)
  );
}

/**
 * Który indeks komórki jest właścicielem każdego wierzchołka, wyprowadzone z
 * `cellVertexStart`/`cellVertexCount` — NIE z założenia, że `indices` jest w tej samej
 * kolejności co `planet.cells` (implementacja może to zmienić; testy 3 i 6 mają wtedy
 * nadal działać).
 */
function ownerCellOf(g: PlanetGeometry, cellCount: number): Int32Array {
  const owner = new Int32Array(g.positions.length / 3).fill(-1);
  for (let i = 0; i < cellCount; i++) {
    const start = g.cellVertexStart[i];
    const end = start + g.cellVertexCount[i];
    for (let v = start; v < end; v++) owner[v] = i;
  }
  return owner;
}

describe('buildPlanetGeometry', () => {
  it('1. suma cellVertexCount równa się długości positions podzielonej przez 3', () => {
    let sum = 0;
    for (const c of geo.cellVertexCount) sum += c;
    expect(sum).toBe(geo.positions.length / 3);
    // Kotwica niezależna od implementacji (patrz komentarz przy expectedVertexCount) —
    // zamyka lukę, w której implementacja liczyłaby sumę zgodną samą ze sobą, ale
    // niezgodną z tym, co planeta faktycznie niesie.
    expect(sum).toBe(expectedVertexCount);
    expect(geo.normals.length).toBe(geo.positions.length);
  });

  it('2. zakresy komórek nie zachodzą na siebie i nie zostawiają dziur', () => {
    const ranges = Array.from(geo.cellVertexStart, (start, i) => ({
      start,
      end: start + geo.cellVertexCount[i],
    })).sort((a, b) => a.start - b.start);

    // Kotwica NIEZALEŻNA od `ranges` samego siebie: bez niej wszystkie zakresy [0,0) (np.
    // `cellVertexCount` samo zero) "pokrywałyby" pustą tablicę bez żadnej luki czy
    // zachodzenia — pętla niżej przechodziłaby PUSTA, więc formalnie zielona. Zmierzone
    // (patrz tabela mutacji w raporcie): dokładnie ten przypadek nie łapał się bez tej linii.
    expect(geo.positions.length / 3).toBe(expectedVertexCount);

    expect(ranges[0].start).toBe(0);
    for (let i = 0; i + 1 < ranges.length; i++) {
      // Ani luki (end < next.start), ani zachodzenia (end > next.start) — dokładna
      // równość, nie tylko "wystarczająco blisko". Gdyby KAŻDA komórka zgłaszała ten sam
      // zakres (np. wszystkie start=0), ten test oblewa natychmiast na drugim elemencie —
      // test 1 (suma) by tego nie złapał, bo suma count wciąż wychodzi poprawna.
      expect(ranges[i + 1].start).toBe(ranges[i].end);
    }
    expect(ranges[ranges.length - 1].end).toBe(geo.positions.length / 3);
  });

  it('3. pentagon ma 5 rogów, heks 6 — liczba trójkątów wachlarza zgadza się z liczbą rogów', () => {
    const owner = ownerCellOf(geo, planet.cells.length);
    const triangleCount = new Array<number>(planet.cells.length).fill(0);
    for (let t = 0; t < geo.indices.length / 3; t++) {
      const cellOfTriangle = owner[geo.indices[t * 3]];
      triangleCount[cellOfTriangle]++;
    }

    let pentagons = 0;
    let hexagons = 0;
    for (const cell of planet.cells) {
      const expectedCorners = cell.cellType === 'PENTAGON' ? 5 : 6;
      if (cell.cellType === 'PENTAGON') pentagons++;
      else hexagons++;

      expect(cell.corners.length).toBe(expectedCorners);
      expect(geo.cellVertexCount[cell.id]).toBe(expectedCorners + 1);
      expect(triangleCount[cell.id]).toBe(expectedCorners);
    }

    // Kontrola: fixture faktycznie zawiera obie odmiany, więc powyższe pętle nie
    // sprawdzają tego samego kształtu dwa razy pod dwiema różnymi etykietami.
    expect(pentagons).toBe(12);
    expect(hexagons).toBeGreaterThan(0);
  });

  it('4. każdy wierzchołek leży na sferze o promieniu planety', () => {
    const vertexCount = geo.positions.length / 3;
    expect(vertexCount).toBe(expectedVertexCount); // nie testuj pustej tablicy niżej
    for (let v = 0; v < vertexCount; v++) {
      const p = vecAt(geo.positions, v);
      const len = Math.hypot(p.x, p.y, p.z);
      expect(len).toBeCloseTo(planet.radius, 2);
    }
  });

  it('5. normalna każdej komórki wskazuje na zewnątrz dla KAŻDEGO jej wierzchołka', () => {
    let visited = 0;
    for (const cell of planet.cells) {
      const start = geo.cellVertexStart[cell.id];
      const end = start + geo.cellVertexCount[cell.id];
      for (let v = start; v < end; v++) {
        const p = vecAt(geo.positions, v);
        const n = vecAt(geo.normals, v);
        expect(dot(n, p)).toBeGreaterThan(0);
        visited++;
      }
    }
    // Bez tej linii pętla wewnętrzna PUSTA (np. `cellVertexCount` samo zero, `start === end`
    // dla każdej komórki) przechodzi formalnie zielono, bo `expect` wewnątrz niej nigdy się
    // nie wykonuje — dokładnie wzorzec "test dla gałęzi, która nigdy nie działa" z Fazy 1.
    // Zmierzone (patrz tabela mutacji w raporcie): bez tej linii ten test NIE łapał mutacji H.
    expect(visited).toBe(expectedVertexCount);
  });

  it('6. kolejność wierzchołków daje trójkąty zwrócone na zewnątrz dla KAŻDEGO trójkąta', () => {
    let checked = 0;
    for (let t = 0; t < geo.indices.length / 3; t++) {
      const ia = geo.indices[t * 3];
      const ib = geo.indices[t * 3 + 1];
      const ic = geo.indices[t * 3 + 2];

      const a = vecAt(geo.positions, ia);
      const b = vecAt(geo.positions, ib);
      const c = vecAt(geo.positions, ic);
      const faceNormal = cross(sub(b, a), sub(c, a));
      // Normalna jest identyczna dla wszystkich trzech wierzchołków trójkąta (flat shading
      // per komórka) — ta zapisana przy `a` jest więc reprezentatywna.
      const cellNormal = vecAt(geo.normals, ia);

      expect(dot(faceNormal, cellNormal)).toBeGreaterThan(0);
      checked++;
    }
    // Dokładna liczba, nie tylko ">0": pętla, która po cichu ominęłaby większość
    // trójkątów, wciąż mogłaby "przejść" przy samym sprawdzeniu ">0" na tym, co zostało.
    expect(checked).toBe(expectedTriangleCount);
  });

  it('7. determinizm: dwa niezależne wywołania na tym samym seedzie dają identyczne tablice co do bitu', () => {
    const planetAgain = createPlanet({ seed: 20260915 });
    const geoAgain = buildPlanetGeometry(planetAgain);
    const geoSameObject = buildPlanetGeometry(planet);

    // Kontrola pozytywna: gdyby buildPlanetGeometry zwracało puste tablice, poniższe
    // porównania równości przeszłyby "za darmo" (puste === puste). Kotwiczymy więc NAJPIERW
    // do niezależnie policzonego, NIEZEROWEGO rozmiaru z `planet.cells`.
    expect(geo.positions.length).toBe(expectedVertexCount * 3);
    expect(geoAgain.positions.length).toBe(expectedVertexCount * 3);
    expect(geoSameObject.positions.length).toBe(expectedVertexCount * 3);

    for (const [label, other] of [
      ['świeża planeta z tego samego seeda', geoAgain] as const,
      ['ten sam obiekt Planet, drugie wywołanie', geoSameObject] as const,
    ]) {
      expect(Array.from(other.positions), label).toEqual(Array.from(geo.positions));
      expect(Array.from(other.normals), label).toEqual(Array.from(geo.normals));
      expect(Array.from(other.indices), label).toEqual(Array.from(geo.indices));
      expect(Array.from(other.cellVertexStart), label).toEqual(Array.from(geo.cellVertexStart));
      expect(Array.from(other.cellVertexCount), label).toEqual(Array.from(geo.cellVertexCount));
    }
  });

  it('8. kontrola pozytywna: inna frequency daje inną liczbę wierzchołków i trójkątów', () => {
    // Dowód, że porównania równości powyżej NAPRAWDĘ potrafią zobaczyć różnicę, a nie tylko
    // zawsze zgadzają się przez przypadek (np. przez porównanie z samym sobą). frequency 4
    // ma inną liczbę komórek niż 12 (162 wg `vertexCountFor`, geometria NIE zależy od seeda
    // — tylko od frequency — więc to jedyna oś, na której ten planet faktycznie się różni
    // geometrycznie). `minStartDistanceFromPentagon: 0` bo test dotyczy geometrii, nie
    // komórki startowej — domyślne 4 jest nieosiągalne przy tak małej planecie.
    const smaller = createPlanet({ seed: 20260915, frequency: 4, minStartDistanceFromPentagon: 0 });
    const smallerGeo = buildPlanetGeometry(smaller);

    expect(smaller.cells.length).not.toBe(planet.cells.length);
    expect(smallerGeo.positions.length).not.toBe(geo.positions.length);
    expect(smallerGeo.indices.length).not.toBe(geo.indices.length);
    expect(smallerGeo.positions.length).toBeGreaterThan(0);
  });

  it('9. tożsamość komórka→wierzchołki PRZEZ WARTOŚĆ: cellVertexStart[i] to WŁAŚNIE cells[i].center, kolejne WŁAŚNIE jej corners w kolejności', () => {
    // Testy 1-8 sprawdzają wyłącznie własności SUMARYCZNE (suma, pokrycie, brak
    // nakładania, „każdy wierzchołek leży na sferze" itd.) — zamiana `cellVertexStart`/
    // `cellVertexCount` MIĘDZY DWIEMA komórkami tego samego typu (ten sam rozmiar zakresu)
    // zachowuje każdą z nich, więc żaden z tamtych testów by tego nie złapał. Ten test
    // sprawdza tożsamość PER KOMÓRKA: nie „czy zakresy się sumują", tylko „czy WŁAŚNIE TA
    // komórka dostała WŁASNE dane". Licznik rozbieżności (nie fail-fast na pierwszej), żeby
    // dało się podać dokładną liczbę przy dowodzie zębów w raporcie.
    //
    // NORMALNE, nie tylko pozycje. Przegląd całogałęziowy zmierzył, że test 5 („normalna
    // wskazuje na zewnątrz") sprawdza WYŁĄCZNIE `dot(n, p) > 0` — warunek spełniony także
    // przez `cell.center` wpisany jako normalna (długość 100, nie 1) ORAZ przez normalną
    // SĄSIADA (kilka stopni różnicy na sferze). Obie te mutacje zostawiały 483/483 zielone.
    // To nie jest hipotetyczne: Three.js wyprowadza `intersection.normal` z atrybutu
    // `normal` (raycaster Fazy 2C dostałby normalną sąsiada), a pierwszy materiał z
    // oświetleniem (Faza 2B) cieniowałby każdą komórkę wg cudzej orientacji.
    let mismatches = 0;
    let normalMismatches = 0;
    let nonUnitNormals = 0;
    let fiveCornerCells = 0;
    let checkedVertices = 0;

    for (const cell of planet.cells) {
      if (cell.corners.length === 5) fiveCornerCells++;
      const start = geo.cellVertexStart[cell.id];
      const end = start + geo.cellVertexCount[cell.id];

      if (!vertexMatches(geo.positions, start, cell.center)) mismatches++;
      for (let k = 0; k < cell.corners.length; k++) {
        if (!vertexMatches(geo.positions, start + 1 + k, cell.corners[k])) mismatches++;
      }

      // WSZYSTKIE wierzchołki komórki (środek i każdy narożnik) niosą tę SAMĄ, WŁASNĄ
      // normalną komórki — to jest dosłownie kontrakt `PlanetGeometry.normals`.
      for (let v = start; v < end; v++) {
        if (!vertexMatches(geo.normals, v, cell.normal)) normalMismatches++;
        const n = vecAt(geo.normals, v);
        // Jednostkowa — niezależnie od tożsamości. Sama tożsamość z `cell.normal` nie
        // wystarczy: gdyby `buildDual` zaczęło zwracać normalne nieznormalizowane, render
        // (Faza 2B) i raycaster (2C) dostałyby wektory o złej długości mimo „zgodności".
        if (Math.abs(Math.hypot(n.x, n.y, n.z) - 1) > 1e-6) nonUnitNormals++;
        checkedVertices++;
      }
    }

    // Iteracja obejmuje WSZYSTKIE 1442 komórki z `planet.cells`, w tym wszystkie 12
    // pentagonów — nie tylko heksagony (mutacja D w raporcie użyła id 700, heksu, więc
    // sama tabela mutacji tego nie dowodziła; tu jest to zweryfikowane niezależnie liczbą
    // komórek o dokładnie pięciu rogach, którą `dual.test.ts` już ustalił jako 12).
    expect(fiveCornerCells).toBe(12);
    // Kontrola pozytywna pętli normalnych: odwiedzone WSZYSTKIE wierzchołki, nie zero
    // (pusty zakres dałby `normalMismatches === 0` „za darmo", ten sam wzorzec co test 5).
    expect(checkedVertices).toBe(expectedVertexCount);
    expect(mismatches).toBe(0);
    expect(normalMismatches).toBe(0);
    expect(nonUnitNormals).toBe(0);
  });

  it('10. cellVertexStart ROŚNIE ściśle wraz z id komórki — kolejność, nie tylko pokrycie', () => {
    // Test 2 SORTUJE zakresy przed sprawdzeniem, więc dowolna PERMUTACJA komórek w buforze
    // (np. wypełnianie od ostatniej komórki do pierwszej) przechodzi go zielono: zakresy
    // nadal idealnie kafelkują tablicę, tylko w innej kolejności. Test 9 też przechodzi —
    // każda komórka dostaje WŁASNE dane, po prostu gdzie indziej. Kolejność jest jednak
    // kontraktem: `cellVertexStart[i] < cellVertexStart[i+1]` pozwala raycasterowi Fazy 2C
    // zamienić trafiony indeks wierzchołka na `cellId` wyszukiwaniem binarnym, bez budowy
    // odwrotnej mapy o rozmiarze liczby wierzchołków. Zmierzone przez przegląd
    // całogałęziowy: bez tego testu monotoniczność nie jest sprawdzana NIGDZIE.
    expect(geo.cellVertexStart.length).toBe(planet.cells.length); // nie testuj pustej pętli
    expect(geo.cellVertexStart[0]).toBe(0);
    for (let i = 0; i + 1 < geo.cellVertexStart.length; i++) {
      expect(geo.cellVertexStart[i + 1]).toBeGreaterThan(geo.cellVertexStart[i]);
      // Ściśle: następny start to dokładnie koniec poprzedniego — bez sortowania, więc
      // permutacja nie ma jak się przez to prześlizgnąć.
      expect(geo.cellVertexStart[i + 1]).toBe(geo.cellVertexStart[i] + geo.cellVertexCount[i]);
    }
  });
});
