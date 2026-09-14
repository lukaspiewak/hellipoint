import { BUILDINGS, ENEMIES, type EnemyDef } from './defs.js';
import { MinHeap } from './heap.js';
import type { EnemyType, SimState } from './state.js';

export interface FlowField {
  /** Koszt dotarcia do najbliższego celu. Infinity = brak celu. */
  distance: Float64Array;
  /** Następna komórka na najtańszej ścieżce. -1 = brak. */
  next: Int32Array;
}

type Priority = EnemyDef['targetPriority'];

/**
 * Dijkstra wstecz od celów (D3, §4.5).
 *
 * Komórka zajęta jest PRZECHODNIA — jej koszt wejścia to szacowany czas zniszczenia
 * budynku. Skutki, wszystkie zamierzone:
 *   • ścieżka istnieje zawsze, więc nie trzeba walidować budowania,
 *   • wróg sam omija drogą zabudowę i przegryza się przez tanią,
 *   • HP budynku staje się statystyką pathfindingu,
 *   • w MP nie da się zamurować gracza na głucho.
 */
export function buildFlowField(s: SimState, priority: Priority, attackerDps: number): FlowField {
  // `attackerDps <= 0` niepostrzeżenie robi `entryCost` = Infinity (podział przez 0 przy
  // dodatnim hp), więc CORE otoczony pierścieniem staje się PRAWDZIWIE nieosiągalne —
  // dokładnie porażka D3, którą ten moduł ma wykluczyć, tylko cicha. `Number.isFinite`,
  // NIE `!(x > 0)` — to drugie przepuszcza Infinity (Infinity > 0 jest prawdziwe), co dawałoby
  // odwrotnie zdegenerowany przypadek: każdy mur za darmo. Ten sam idiom co `sunDirection`
  // w light.ts i konstruktor `Sim` w loop.ts.
  if (!Number.isFinite(attackerDps) || attackerDps <= 0) {
    throw new RangeError(`attackerDps must be positive and finite, got ${attackerDps}`);
  }
  const cells = s.planet.cells;
  const distance = new Float64Array(cells.length).fill(Infinity);
  const next = new Int32Array(cells.length).fill(-1);
  const settled = new Uint8Array(cells.length);
  const heap = new MinHeap(256);

  for (let i = 0; i < s.buildings.length; i++) {
    if (isTarget(s, i, priority)) {
      distance[i] = 0;
      heap.push(i, 0);
    }
  }

  for (;;) {
    const cur = heap.pop();
    if (cur === undefined) break;
    if (settled[cur]) continue;
    settled[cur] = 1;

    for (const n of cells[cur].neighbors) {
      if (settled[n]) continue;
      // Wchodzimy DO `n` z (już rozstrzygniętego, bliższego celowi) `cur`,
      // więc koszt wejścia dotyczy komórki `n`, NIE `cur`. `cur` może samo być
      // celem (dystans 0) — jego własny koszt zniszczenia nie ma się nigdzie
      // "przeciekać" do sąsiadów, inaczej HP celu doliczałoby się do odległości
      // KAŻDEJ osiągalnej komórki jako stała, a zabudowana komórka nigdy nie
      // byłaby droższa od pustej pod WŁASNYM indeksem (koszt jej budynku
      // ujawniałby się dopiero na sąsiadach o jeden krok dalej).
      const candidate = distance[cur] + entryCost(s, n, attackerDps);
      if (candidate < distance[n]) {
        distance[n] = candidate;
        next[n] = cur;
        heap.push(n, candidate);
      }
    }
  }

  return { distance, next };
}

export function buildAllFlowFields(s: SimState): Record<EnemyType, FlowField> {
  return {
    SWARM: buildFlowField(s, ENEMIES.SWARM.targetPriority, ENEMIES.SWARM.dps),
    ARMOR: buildFlowField(s, ENEMIES.ARMOR.targetPriority, ENEMIES.ARMOR.dps),
    DISRUPTOR: buildFlowField(s, ENEMIES.DISRUPTOR.targetPriority, ENEMIES.DISRUPTOR.dps),
  };
}

function isTarget(s: SimState, cellId: number, priority: Priority): boolean {
  const b = s.buildings[cellId];
  if (b === null) return false;
  switch (priority) {
    case 'NEAREST_BUILDING': return true;
    case 'CORE': return b.type === 'CORE';
    case 'ENERGY_INFRASTRUCTURE': return BUILDINGS[b.type].energyInfrastructure;
  }
}

/**
 * 1 krok za przejście + szacowany czas rozbicia budynku stojącego na komórce.
 * `Math.max(0, b.hp)`, NIE surowe `b.hp`: Faza 1C odejmuje obrażenia od `hp` w walce,
 * więc między "obrażenia zadane" a "budynek usunięty" `hp` może być przejściowo ujemne.
 * Bez obcięcia ujemny koszt krawędzi łamie założenie Dijkstry o nieujemnych wagach —
 * zmierzone: hp = -500, dps = 50 dawało dystans -9. Ten moduł ma być bezpieczny
 * niezależnie od tego, w jakiej kolejności 1C ureguluje obrażenia i usuwanie budynków.
 */
function entryCost(s: SimState, cellId: number, attackerDps: number): number {
  const b = s.buildings[cellId];
  if (b === null) return 1;
  return 1 + Math.max(0, b.hp) / attackerDps;
}
