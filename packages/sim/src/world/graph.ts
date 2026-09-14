/**
 * BFS wieloźródłowy: dla każdej komórki odległość w krokach grafu
 * do najbliższego źródła. Nieosiągalne dostają Infinity.
 *
 * `neighbors` i `sources` przyjmują tablice tylko-do-odczytu: ta funkcja wyłącznie
 * czyta sąsiedztwo i listę źródeł (np. bezpośrednio `Planet.cells`/`Planet.pentagons`,
 * dzielone przez referencję z wewnętrznym DualMesh) i nigdy ich nie mutuje.
 */
export function multiSourceDistances(
  neighbors: readonly (readonly number[])[],
  sources: readonly number[],
): number[] {
  const dist = new Array<number>(neighbors.length).fill(Infinity);
  const queue: number[] = [];

  for (const s of sources) {
    if (dist[s] !== 0) {
      dist[s] = 0;
      queue.push(s);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const n of neighbors[cur]) {
      if (dist[n] === Infinity) {
        dist[n] = dist[cur] + 1;
        queue.push(n);
      }
    }
  }

  return dist;
}
