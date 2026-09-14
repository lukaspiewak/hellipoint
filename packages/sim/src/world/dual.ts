import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../math/vec3.js';
import type { GeodesicMesh } from './geodesic.js';

export type CellType = 'HEXAGON' | 'PENTAGON';

export interface DualMesh {
  /** Środek komórki = pozycja wierzchołka geodezyjnego, na sferze jednostkowej. */
  centers: Vec3[];
  /** Narożniki wielokąta, uporządkowane kątowo wokół normalnej komórki. */
  corners: Vec3[][];
  /** Sąsiedzi współbieżni z corners: neighbors[k] leży za krawędzią corners[k]→corners[k+1]. */
  neighbors: number[][];
  cellTypes: CellType[];
}

export function buildDual(mesh: GeodesicMesh): DualMesh {
  const vertexCount = mesh.vertices.length;

  // Ściany incydentne do każdego wierzchołka.
  const incident: number[][] = Array.from({ length: vertexCount }, () => []);
  for (let f = 0; f < mesh.faces.length; f++) {
    const [a, b, c] = mesh.faces[f];
    incident[a].push(f);
    incident[b].push(f);
    incident[c].push(f);
  }

  const faceCentroids: Vec3[] = mesh.faces.map(([a, b, c]) =>
    normalize(scale(add(add(mesh.vertices[a], mesh.vertices[b]), mesh.vertices[c]), 1 / 3)),
  );

  const centers: Vec3[] = mesh.vertices.slice();
  const corners: Vec3[][] = [];
  const neighbors: number[][] = [];
  const cellTypes: CellType[] = [];

  for (let v = 0; v < vertexCount; v++) {
    const normal = mesh.vertices[v];
    const { tangent, bitangent } = tangentBasis(normal);

    // Uporządkuj ściany incydentne kątowo wokół normalnej — daje wielokąt komórki.
    const ordered = incident[v]
      .map((f) => {
        const d = sub(faceCentroids[f], normal);
        return { f, angle: Math.atan2(dot(d, bitangent), dot(d, tangent)) };
      })
      .sort((p, q) => (p.angle === q.angle ? p.f - q.f : p.angle - q.angle))
      .map((p) => p.f);

    corners[v] = ordered.map((f) => faceCentroids[f]);

    // Sąsiad między kolejnymi narożnikami to wierzchołek dzielony przez obie ściany
    // (poza samym v) — czyli druga końcówka wspólnej krawędzi.
    const ns: number[] = [];
    for (let k = 0; k < ordered.length; k++) {
      const f1 = mesh.faces[ordered[k]];
      const f2 = mesh.faces[ordered[(k + 1) % ordered.length]];
      const shared = f1.filter((x) => x !== v && f2.includes(x));
      if (shared.length !== 1) {
        throw new Error(`Komórka ${v}: ściany ${ordered[k]} i ${ordered[(k + 1) % ordered.length]} dzielą ${shared.length} wierzchołków zamiast 1`);
      }
      ns.push(shared[0]);
    }

    neighbors[v] = ns;
    cellTypes[v] = ns.length === 5 ? 'PENTAGON' : 'HEXAGON';
  }

  return { centers, corners, neighbors, cellTypes };
}

/** Dowolna, ale DETERMINISTYCZNA baza styczna do wektora jednostkowego. */
function tangentBasis(n: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  // Wybierz oś najmniej równoległą do n, żeby uniknąć degeneracji.
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const helper = ax <= ay && ax <= az
    ? { x: 1, y: 0, z: 0 }
    : ay <= az
      ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 };
  const tangent = normalize(cross(n, helper));
  const bitangent = cross(n, tangent);
  return { tangent, bitangent };
}
