import { TICK_SECONDS, type SimState } from './state.js';

/** [STROJENIE] Zwrot z ekstraktora ma wynosić 60-75 s, nie 30 s jak w drafcie (§5.2). */
export const ORE_PER_SECOND = 1.0;

export function updateEconomy(s: SimState): void {
  const perTick = ORE_PER_SECOND * TICK_SECONDS;

  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b === null || b.type !== 'EXTRACTOR' || !b.powered) continue;

    // Złoża są wyczerpywalne — ostatni tick wydobywa tylko to, co zostało.
    const mined = Math.min(perTick, s.oreRemaining[i]);
    if (mined <= 0) continue;

    s.oreRemaining[i] -= mined;
    s.ore += mined;
  }
}
