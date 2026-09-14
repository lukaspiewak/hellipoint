import { BUILDINGS, ENEMIES } from './defs.js';
import type { FlowField } from './flowfield.js';
import { TICK_SECONDS, type EnemyType, type SimState } from './state.js';

/** [STROJENIE] Promień EMP Disruptora w krokach grafu (N1). */
export const EMP_RADIUS_STEPS = 2;

/** Komórki w promieniu `steps` kroków grafu, łącznie z origin. Zawsze posortowane rosnąco. */
export function cellsWithinSteps(s: SimState, origin: number, steps: number): number[] {
  const cells = s.planet.cells;
  const seen = new Set<number>([origin]);
  let ring = [origin];

  for (let i = 0; i < steps; i++) {
    const next: number[] = [];
    for (const c of ring) {
      for (const n of cells[c].neighbors) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    ring = next;
  }

  // Sortowanie numeryczne: kolejność wyniku nie może zależeć od przebiegu BFS (§7.2).
  return [...seen].sort((a, b) => a - b);
}

export function updateCombat(s: SimState, fields: Record<EnemyType, FlowField>): void {
  unitsAttackBuildings(s, fields);
  turretsAttackUnits(s);
  removeDeadUnits(s);
  removeDeadBuildings(s);
}

/**
 * Q2: obrażenia ciągłe, bez licznika zamachów.
 * Jednostka atakuje budynek w swojej komórce, a jeśli go nie ma — ten,
 * który blokuje jej następny krok.
 */
function unitsAttackBuildings(s: SimState, fields: Record<EnemyType, FlowField>): void {
  for (const u of s.units) {
    if (u.hp <= 0) continue;

    const here = s.buildings[u.cellId];
    const nextId = fields[u.type].next[u.cellId];
    const ahead = nextId >= 0 ? s.buildings[nextId] : null;
    const target = here ?? ahead;
    if (target === null) continue;

    target.hp -= ENEMIES[u.type].dps * TICK_SECONDS;

    // Q4: EMP wyłącza budynki w promieniu, zamiast drenować magazyn.
    // Wyłączenie jest dla gracza widoczne — robi dziurę w obronie, którą fala wykorzystuje.
    if (u.type === 'DISRUPTOR') {
      for (const c of cellsWithinSteps(s, u.cellId, EMP_RADIUS_STEPS)) {
        const b = s.buildings[c];
        if (b !== null) b.powered = false;
      }
    }
  }
}

function turretsAttackUnits(s: SimState): void {
  // Indeks jednostek po komórkach — budowany raz na tick, nie raz na wieżę.
  const byCell = new Map<number, number[]>();
  for (let i = 0; i < s.units.length; i++) {
    const u = s.units[i];
    if (u.hp <= 0) continue;
    const bucket = byCell.get(u.cellId);
    if (bucket === undefined) byCell.set(u.cellId, [i]);
    else bucket.push(i);
  }

  for (let cellId = 0; cellId < s.buildings.length; cellId++) {
    const b = s.buildings[cellId];
    if (b === null || !b.powered) continue;

    const def = BUILDINGS[b.type];
    if (def.range <= 0 || def.dps <= 0) continue;

    const inRange: number[] = [];
    for (const c of cellsWithinSteps(s, cellId, def.range)) {
      const bucket = byCell.get(c);
      if (bucket !== undefined) inRange.push(...bucket);
    }
    if (inRange.length === 0) continue;

    const damage = def.dps * TICK_SECONDS;

    if (def.targeting === 'AOE') {
      for (const i of inRange) s.units[i].hp -= damage;
    } else {
      // Najniższe id — wybór celu nie może zależeć od kolejności w tablicy jednostek.
      let best = inRange[0];
      for (const i of inRange) {
        if (s.units[i].id < s.units[best].id) best = i;
      }
      s.units[best].hp -= damage;
    }
  }
}

function removeDeadUnits(s: SimState): void {
  if (!s.units.some((u) => u.hp <= 0)) return;
  const survivors = [];
  for (const u of s.units) {
    if (u.hp > 0) survivors.push(u);
    else s.ore += ENEMIES[u.type].oreReward;
  }
  s.units = survivors;
}

function removeDeadBuildings(s: SimState): void {
  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b !== null && b.hp <= 0) s.buildings[i] = null;
  }
}
