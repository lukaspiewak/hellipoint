import type { Planet, Vec3 } from '@heliopolis/sim';

/**
 * Płaska geometria całej planety, gotowa do wrzucenia w `THREE.BufferGeometry` (Zadanie 4)
 * i do pisania kolorów po zakresie komórki (Zadanie 3). Jedyny most między symulacją
 * (`Planet`/`Cell`) a pikselami — i, docelowo, kliknięciem myszy z powrotem na `cellId`
 * (raycasting, Faza 2C). Zero Three.js w sygnaturze i w implementacji tego modułu:
 * testowalne bez WebGL, przeglądarki i GPU.
 */
export interface PlanetGeometry {
  /** xyz na wierzchołek, world space, na sferze o promieniu `planet.radius`. */
  positions: Float32Array;
  /**
   * Płaska normalna PER KOMÓRKA: każdy wierzchołek komórki i (środek i wszystkie jej
   * narożniki) niesie IDENTYCZNĄ `cell.normal`, nie uśrednioną z sąsiadami. Ten sam wybór
   * co brak współdzielenia wierzchołków — patrz komentarz przy `buildPlanetGeometry`.
   */
  normals: Float32Array;
  /** Trójkąty wachlarza wokół środka każdej komórki. Indeksy w `positions`/`normals`. */
  indices: Uint32Array;
  /** Indeks WIERZCHOŁKA (nie floata) pierwszej pozycji komórki i w `positions`/`normals`. */
  cellVertexStart: Uint32Array;
  /** Liczba wierzchołków komórki i: `corners.length + 1` (środek + każdy narożnik). */
  cellVertexCount: Uint32Array;
}

/**
 * Buduje geometrię planety, w której KAŻDA komórka ma WŁASNE wierzchołki — środek i jej
 * narożniki, powielone, nigdy współdzielone z sąsiadem.
 *
 * To jest sedno filaru D1 (spec §11.1; wynik bramki Fazy 0): przy współdzielonych
 * wierzchołkach GPU interpoluje kolor wzdłuż wspólnej krawędzi, co odtwarza dokładnie ten
 * gładki gradient `saturate(dot)`, zmierzony w Fazie 0 jako NIECZYTELNY jako granica
 * dnia/nocy. Osobne wierzchołki dają płaskie, jednolite wieloboki — granicę czytelną gołym
 * okiem, biegnącą po krawędziach heksów, dokładnie tam gdzie liczy ją symulacja (progowanie
 * to Zadanie 3 — ten moduł tylko daje geometrię do pokolorowania).
 *
 * Kolejność wierzchołków w trójkącie wachlarza — (środek, corners[k], corners[k+1]), w
 * kolejności jaką faktycznie zwraca `Cell.corners` — daje trójkąt zwrócony NA ZEWNĄTRZ.
 * To ZMIERZONE, nie założone: dla wszystkich 1442 komórek i wszystkich 8640 par
 * sąsiadujących narożników przy `frequency 12`, dot(cross(corner[k]-center,
 * corner[k+1]-center), cell.normal) wyszło DODATNIE w każdym przypadku (0 wyjątków;
 * wartość minimalna ~16.8 dla radius=100 — daleko od szumu zaokrągleń float32). Powód:
 * `buildDual` sortuje narożniki kątowo wokół normalnej rosnąco w bazie (tangent, bitangent)
 * takiej, że `cross(tangent, bitangent) === normal` — czyli w kierunku przeciwnym do
 * wskazówek zegara jak widziane z zewnątrz sfery — co algebraicznie i empirycznie daje
 * wachlarz zwrócony na zewnątrz bez żadnego przestawiania z naszej strony. Test 6 w
 * `geometry.test.ts` sprawdza to na FAKTYCZNIE zapisanych wierzchołkach, nie na tym
 * wyprowadzeniu — gdyby `buildDual` kiedyś zmieniło konwencję, test ma to złapać.
 *
 * Zmierzone przy `frequency 12` (1442 komórki: 12 pentagonów + 1430 heksagonów):
 * **10082 wierzchołki** (12×6 + 1430×7) → 30246 floatów w `positions` i w `normals`;
 * **8640 trójkątów** (12×5 + 1430×6) → 25920 indeksów. Faza 4 pyta o te liczby przy
 * optymalizacji budżetu 8 ms/klatkę (`global-constraints.md`).
 */
export function buildPlanetGeometry(planet: Planet): PlanetGeometry {
  const cells = planet.cells;
  const cellCount = cells.length;

  // Rozmiar buforów trzeba znać z góry — Float32Array/Uint32Array się nie rozszerzają.
  let totalVertices = 0;
  let totalTriangles = 0;
  for (const cell of cells) {
    totalVertices += cell.corners.length + 1;
    totalTriangles += cell.corners.length;
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalTriangles * 3);
  const cellVertexStart = new Uint32Array(cellCount);
  const cellVertexCount = new Uint32Array(cellCount);

  let vertexCursor = 0;
  let indexCursor = 0;

  for (let i = 0; i < cellCount; i++) {
    const cell = cells[i];
    const cornerCount = cell.corners.length;
    const vertexCount = cornerCount + 1;
    const centerIdx = vertexCursor;

    cellVertexStart[i] = vertexCursor;
    cellVertexCount[i] = vertexCount;

    writeVertex(positions, normals, centerIdx, cell.center, cell.normal);
    for (let k = 0; k < cornerCount; k++) {
      writeVertex(positions, normals, vertexCursor + 1 + k, cell.corners[k], cell.normal);
    }

    // Wachlarz: (środek, corners[k], corners[k+1]) — patrz uzasadnienie winding powyżej.
    for (let k = 0; k < cornerCount; k++) {
      const cur = vertexCursor + 1 + k;
      const next = vertexCursor + 1 + ((k + 1) % cornerCount);
      indices[indexCursor++] = centerIdx;
      indices[indexCursor++] = cur;
      indices[indexCursor++] = next;
    }

    vertexCursor += vertexCount;
  }

  return { positions, normals, indices, cellVertexStart, cellVertexCount };
}

function writeVertex(
  positions: Float32Array,
  normals: Float32Array,
  vertexIndex: number,
  position: Vec3,
  normal: Vec3,
): void {
  const o = vertexIndex * 3;
  positions[o] = position.x;
  positions[o + 1] = position.y;
  positions[o + 2] = position.z;
  normals[o] = normal.x;
  normals[o + 1] = normal.y;
  normals[o + 2] = normal.z;
}
