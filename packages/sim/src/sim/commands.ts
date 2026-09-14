import { BUILDINGS } from './defs.js';
import type { BuildingType, SimState } from './state.js';

export type Command =
  | { kind: 'BUILD'; cellId: number; type: BuildingType }
  | { kind: 'DEMOLISH'; cellId: number };

export type BuildCheck = { ok: true } | { ok: false; reason: string };

export function canBuild(s: SimState, cellId: number, type: BuildingType): BuildCheck {
  const cell = s.planet.cells[cellId];
  if (cell === undefined) return { ok: false, reason: 'NO_SUCH_CELL' };
  if (s.buildings[cellId] !== null) return { ok: false, reason: 'CELL_OCCUPIED' };

  const def = BUILDINGS[type];
  // CORE jest jedynym `playerBuildable: false` — symulacja go zasiewa bezpośrednim
  // zapisem do stanu, nigdy przez komendę. Sprawdzane PRZED typem komórki/rudą, bo to
  // fakt o samym TYPIE budynku, niezależny od tego, gdzie/za ile ktoś próbuje go postawić:
  // bez tej klauzuli `CORE.costOre = 0` plus brak innej blokady pozwalały postawić
  // dowolną liczbę darmowych CORE na dowolnej pustej komórce (`CELL_OCCUPIED` chroni
  // tylko TĘ SAMĄ komórkę przed drugim CORE, nie planetę przed setnym).
  if (!def.playerBuildable) return { ok: false, reason: 'NOT_PLAYER_BUILDABLE' };

  const typeOk =
    def.allowedCells === 'ANY' ||
    (def.allowedCells === 'HEXAGON' && cell.cellType === 'HEXAGON') ||
    (def.allowedCells === 'PENTAGON' && cell.cellType === 'PENTAGON') ||
    (def.allowedCells === 'ORE_HEXAGON' && cell.cellType === 'HEXAGON' && s.oreRemaining[cellId] > 0);
  if (!typeOk) return { ok: false, reason: 'WRONG_CELL_TYPE' };

  if (s.ore < def.costOre) return { ok: false, reason: 'INSUFFICIENT_ORE' };
  return { ok: true };
}

/**
 * Komendy przychodzą z zewnątrz (a w Fazie 5 — z sieci), więc niedozwolona komenda
 * jest po cichu ignorowana, nigdy nie przerywa symulacji.
 */
export function applyCommand(s: SimState, cmd: Command): void {
  switch (cmd.kind) {
    case 'BUILD': {
      if (!canBuild(s, cmd.cellId, cmd.type).ok) return;
      const def = BUILDINGS[cmd.type];
      s.ore -= def.costOre;
      s.buildings[cmd.cellId] = { cellId: cmd.cellId, type: cmd.type, hp: def.hp, powered: false };
      return;
    }
    case 'DEMOLISH': {
      const b = s.buildings[cmd.cellId];
      // `== null`, nie `===`: cellId poza zakresem (ujemny, za duży, NaN) daje
      // `undefined` z gęstej tablicy, nie `null` — komendy przychodzą z zewnątrz,
      // więc obie wartości muszą być traktowane jak "nic tu nie ma do zburzenia".
      if (b == null || b.type === 'CORE') return;
      s.ore += Math.floor(BUILDINGS[b.type].costOre / 2); // [STROJENIE] zwrot 50 %
      s.buildings[cmd.cellId] = null;
      return;
    }
  }
}
