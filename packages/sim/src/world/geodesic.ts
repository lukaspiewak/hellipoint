import { add, normalize, scale, type Vec3 } from '../math/vec3.js';

export interface GeodesicMesh {
  /** Pozycje na sferze JEDNOSTKOWEJ. Skalowanie do promienia planety następuje później. */
  vertices: Vec3[];
  /** Trójkąty jako trójki indeksów, nawinięte na zewnątrz. */
  faces: [number, number, number][];
}

export const vertexCountFor = (frequency: number): number => 10 * frequency * frequency + 2;

const PHI = (1 + Math.sqrt(5)) / 2;

const BASE_VERTICES: Vec3[] = [
  { x: -1, y: PHI, z: 0 }, { x: 1, y: PHI, z: 0 }, { x: -1, y: -PHI, z: 0 }, { x: 1, y: -PHI, z: 0 },
  { x: 0, y: -1, z: PHI }, { x: 0, y: 1, z: PHI }, { x: 0, y: -1, z: -PHI }, { x: 0, y: 1, z: -PHI },
  { x: PHI, y: 0, z: -1 }, { x: PHI, y: 0, z: 1 }, { x: -PHI, y: 0, z: -1 }, { x: -PHI, y: 0, z: 1 },
].map(normalize);

const BASE_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/**
 * Sfera geodezyjna o zadanej częstotliwości: każda ściana dwudziestościanu
 * dzielona jest na n² trójkątów przez siatkę barycentryczną.
 */
export function buildGeodesic(frequency: number): GeodesicMesh {
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new Error(`frequency musi być dodatnią liczbą całkowitą, otrzymano ${frequency}`);
  }

  const n = frequency;
  const vertices: Vec3[] = [];
  const byKey = new Map<string, number>();
  const faces: [number, number, number][] = [];

  const put = (key: string, p: Vec3): number => {
    const hit = byKey.get(key);
    if (hit !== undefined) return hit;
    const id = vertices.length;
    vertices.push(normalize(p));
    byKey.set(key, id);
    return id;
  };

  for (const [ia, ib, ic] of BASE_FACES) {
    const a = BASE_VERTICES[ia], b = BASE_VERTICES[ib], c = BASE_VERTICES[ic];

    // grid[i][j] — wagi barycentryczne: k/n przy a, i/n przy b, j/n przy c, gdzie k = n-i-j
    const grid: number[][] = [];
    for (let i = 0; i <= n; i++) {
      grid[i] = [];
      for (let j = 0; j <= n - i; j++) {
        const k = n - i - j;
        const p = add(add(scale(a, k / n), scale(b, i / n)), scale(c, j / n));
        grid[i][j] = put(pointKey(ia, ib, ic, i, j, k, n), p);
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        faces.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]]);
        if (j < n - i - 1) {
          faces.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]);
        }
      }
    }
  }

  return { vertices, faces };
}

/**
 * Tożsamość topologiczna punktu siatki. Narożniki i punkty krawędziowe są wspólne
 * dla sąsiadujących ścian i muszą dostać ten sam klucz niezależnie od tego,
 * która ściana je wygenerowała.
 */
function pointKey(ia: number, ib: number, ic: number, i: number, j: number, k: number, n: number): string {
  if (k === n) return `v${ia}`;
  if (i === n) return `v${ib}`;
  if (j === n) return `v${ic}`;
  if (j === 0) return edgeKey(ia, ib, i, n); // krawędź a-b, parametr liczony od a
  if (i === 0) return edgeKey(ia, ic, j, n); // krawędź a-c, parametr liczony od a
  if (k === 0) return edgeKey(ib, ic, j, n); // krawędź b-c, parametr liczony od b
  return `f${ia}_${ib}_${ic}_${i}_${j}`;
}

/** Kanonizacja krawędzi: zawsze mniejszy indeks pierwszy, parametr przeliczony względem niego. */
function edgeKey(u: number, v: number, tFromU: number, n: number): string {
  return u < v ? `e${u}_${v}_${tFromU}` : `e${v}_${u}_${n - tFromU}`;
}
