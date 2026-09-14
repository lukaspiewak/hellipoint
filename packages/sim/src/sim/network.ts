import { BUILDINGS } from './defs.js';
import type { SimState } from './state.js';

/**
 * Propagacja zasilania od CORE w głąb sieci (§5.1).
 * Wariant „zalewowy" z granicą zasięgu na węzeł: budynek przewodzący rozgłasza
 * zasilanie do wszystkich budynków w promieniu swojego connectionRadius (w krokach grafu).
 */
export function connectedToCore(s: SimState): boolean[] {
  const cells = s.planet.cells;
  const connected = new Array<boolean>(cells.length).fill(false);

  const frontier: number[] = [];
  for (let i = 0; i < s.buildings.length; i++) {
    if (s.buildings[i]?.type === 'CORE') {
      connected[i] = true;
      frontier.push(i);
    }
  }

  for (let head = 0; head < frontier.length; head++) {
    const from = frontier[head];
    const radius = BUILDINGS[s.buildings[from]!.type].connectionRadius;
    if (radius <= 0) continue;

    // BFS ograniczony do `radius` kroków od tego węzła.
    const seen = new Set<number>([from]);
    let ring: number[] = [from];
    for (let step = 0; step < radius; step++) {
      const next: number[] = [];
      for (const c of ring) {
        for (const n of cells[c].neighbors) {
          if (seen.has(n)) continue;
          seen.add(n);
          next.push(n);
          if (s.buildings[n] !== null && !connected[n]) {
            connected[n] = true;
            frontier.push(n);
          }
        }
      }
      ring = next;
    }
  }

  return connected;
}
