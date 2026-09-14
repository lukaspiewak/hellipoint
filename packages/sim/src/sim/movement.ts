import { add, dot, normalize, scale, type Vec3 } from '../math/vec3.js';
import { ENEMIES } from './defs.js';
import type { FlowField } from './flowfield.js';
import { TICK_SECONDS, type EnemyType, type SimState } from './state.js';

export interface MotionContext {
  /** Prędkość terminatora w krokach grafu na sekundę — baza dla speedFactor. */
  termSpeedCells: number;
  /** Odstęp środków sąsiednich komórek w jednostkach świata. */
  spacing: number;
  radius: number;
}

export function spawnUnit(s: SimState, type: EnemyType, cellId: number): void {
  s.units.push({
    id: s.nextUnitId++,
    type,
    cellId,
    pos: s.planet.cells[cellId].center,
    hp: ENEMIES[type].hp,
    exposure: 0,
  });
}

export function updateMovement(
  s: SimState,
  fields: Record<EnemyType, FlowField>,
  light: Float32Array,
  sunDir: Vec3,
  ctx: MotionContext,
): void {
  const cells = s.planet.cells;
  // Niezmiennik, na którym stoi nearestLocalCell (patrz jej doc-comment niżej):
  // przeszukuje WYŁĄCZNIE {bieżąca komórka} ∪ sąsiedzi, więc jest poprawna tylko
  // dopóki jednostka pokonuje w jednym ticku kąt MNIEJSZY niż kątowy rozstaw
  // komórek — inaczej przeskoczyłaby sąsiada, którego funkcja w ogóle nie widzi,
  // i cellId cicho rozjechałby się z prawdziwą pozycją (zmierzone w przeglądzie:
  // przy sztucznie podbitej prędkości rozjazd sięgał 15 kroków grafu, bez
  // żadnego wyjątku). speedFactor jest [STROJENIE] (Faza 3 dostroi go
  // headlessem) — margines dziś jest ~25× (zmierzone w raporcie Taska 1), ale
  // bez twardej straży przyszłe strojenie mogłoby go po cichu przekroczyć.
  const cellAngularSpacing = ctx.spacing / ctx.radius;

  for (const u of s.units) {
    const def = ENEMIES[u.type];
    const speedWorld = def.speedFactor * ctx.termSpeedCells * ctx.spacing;
    const angleStep = (speedWorld * TICK_SECONDS) / ctx.radius;

    if (angleStep >= cellAngularSpacing) {
      throw new RangeError(
        `updateMovement: jednostka ${u.type} (speedFactor=${def.speedFactor}) pokonuje ` +
          `${angleStep} rad/tick — nie mniej niż kątowy rozstaw komórek (${cellAngularSpacing} rad). ` +
          'nearestLocalCell przeszukuje tylko bieżącą komórkę i jej sąsiadów, więc taki krok cicho ' +
          'rozjeżdża cellId z prawdziwą pozycją. Obniż speedFactor tego typu w ENEMIES (defs.ts) albo ' +
          'zmień MotionContext (termSpeedCells/spacing/radius).',
      );
    }

    let targetDir: Vec3;

    if (light[u.cellId] > 0) {
      // W świetle jednostka porzuca cel i biegnie najkrótszą drogą do cienia,
      // czyli wzdłuż wielkiego okręgu ku punktowi antypodycznemu do słońca (§4.4).
      targetDir = scale(sunDir, -1);
    } else {
      const next = fields[u.type].next[u.cellId];
      // Brak celu, albo następna komórka jest zabudowana — stoimy.
      // Zabudowa nie jest przeszkodą absolutną: zajmie się nią walka (Task 2).
      // Ten wczesny `continue` musi zostać — Task 2 czyta `next` już PO tym
      // wywołaniu (`ahead = buildings[next]`), żeby wybrać cel walki.
      if (next < 0 || s.buildings[next] !== null) continue;
      targetDir = cells[next].normal;
    }

    const from = scale(u.pos, 1 / ctx.radius);
    const moved = slerpToward(from, targetDir, angleStep);
    const candidate = nearestLocalCell(s, u.cellId, moved);
    // Zabudowa blokuje tak samo w ucieczce, jak w marszu do celu (D3). Warunek
    // `candidate !== u.cellId` jest konieczny: bez niego jednostka, pod którą ktoś
    // postawi budynek, zamarza na zawsze zamiast z niego zejść.
    if (candidate !== u.cellId && s.buildings[candidate] !== null) continue;
    u.pos = scale(moved, ctx.radius);
    u.cellId = candidate;
  }
}

/** Obrót `from` ku `to` wzdłuż wielkiego okręgu o zadany kąt. Oba argumenty jednostkowe. */
function slerpToward(from: Vec3, to: Vec3, angle: number): Vec3 {
  const cosTheta = Math.min(1, Math.max(-1, dot(from, to)));
  const theta = Math.acos(cosTheta);
  if (theta <= angle || theta < 1e-9) return to;

  const t = angle / theta;
  const sinTheta = Math.sin(theta);
  const a = Math.sin((1 - t) * theta) / sinTheta;
  const b = Math.sin(t * theta) / sinTheta;
  return normalize(add(scale(from, a), scale(to, b)));
}

/**
 * Przypisanie do komórki sprawdzane tylko wśród bieżącej i jej sąsiadów.
 * Jednostka nigdy nie pokonuje w jednym ticku więcej niż ułamek komórki,
 * więc pełne przeszukanie 1442 komórek byłoby czystą stratą.
 */
function nearestLocalCell(s: SimState, currentId: number, unitDir: Vec3): number {
  const cells = s.planet.cells;
  let best = currentId;
  let bestDot = dot(cells[currentId].normal, unitDir);

  for (const n of cells[currentId].neighbors) {
    const d = dot(cells[n].normal, unitDir);
    // Ścisła nierówność plus porównanie indeksów — remis nie może zależeć
    // od kolejności sąsiadów w tablicy (§7.2).
    if (d > bestDot || (d === bestDot && n < best)) {
      bestDot = d;
      best = n;
    }
  }

  return best;
}
