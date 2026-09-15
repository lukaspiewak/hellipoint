import {
  BUILDINGS,
  canBuild,
  cellsWithinSteps,
  connectedToCore,
  type Command,
  type Sim,
} from '@heliopolis/sim';

/**
 * Deterministyczny, zachłanny bot. NIE ma być dobry — ma być powtarzalny
 * i reprezentować rozsądnego początkującego gracza, żeby rozkłady z runnera
 * mierzyły balans gry, a nie jakość bota.
 *
 * Priorytety, zawsze w tej kolejności:
 *   1. ekstraktor na najbliższym niewyczerpanym złożu w zasięgu sieci
 *   2. panel słoneczny, gdy podaż energii jest napięta
 *   3. bateria, gdy magazyn stoi pusty
 *   4. wieża od strony najbliższego pentagonu
 *   5. pylon rozciągający sieć ku najbliższemu złożu poza zasięgiem
 */
export class ScriptedPolicy {
  constructor(private readonly sim: Sim) {}

  decide(): Command[] {
    const s = this.sim.state;
    const connected = connectedToCore(s);
    const core = s.planet.startCell;

    // Zasięg roboczy: komórki, do których sieć już dociera, plus jeden krok zapasu.
    const reachable = new Set<number>();
    for (let i = 0; i < connected.length; i++) {
      if (!connected[i]) continue;
      const radius = BUILDINGS[s.buildings[i]!.type].connectionRadius;
      for (const c of cellsWithinSteps(s, i, Math.max(1, radius))) reachable.add(c);
    }

    const free = [...reachable].filter((c) => s.buildings[c] === null).sort((a, b) => a - b);
    if (free.length === 0) return [];

    // 1. Ekstraktory na dostępnych złożach.
    for (const c of free) {
      if (s.oreRemaining[c] > 0 && canBuild(s, c, 'EXTRACTOR').ok) {
        return [{ kind: 'BUILD', cellId: c, type: 'EXTRACTOR' }];
      }
    }

    const plain = free.filter((c) => s.oreRemaining[c] === 0);
    if (plain.length === 0) return [];

    // 2/3. Energia: panel, gdy brak zapasu; bateria, gdy zapas stale zerowy.
    if (s.storedEnergy < 50 && canBuild(s, plain[0], 'SOLAR_PANEL').ok) {
      return [{ kind: 'BUILD', cellId: plain[0], type: 'SOLAR_PANEL' }];
    }
    if (s.storedEnergy < 5 && canBuild(s, plain[0], 'BATTERY').ok) {
      return [{ kind: 'BUILD', cellId: plain[0], type: 'BATTERY' }];
    }

    // 4. Obrona: komórka najbliższa CORE spośród wolnych, żeby budować zwartą bazę.
    const nearCore = cellsWithinSteps(s, core, 4).filter((c) => plain.includes(c));
    const spot = nearCore[0] ?? plain[0];
    for (const type of ['LASER_TURRET', 'KINETIC_TURRET', 'BARRICADE'] as const) {
      if (canBuild(s, spot, type).ok) return [{ kind: 'BUILD', cellId: spot, type }];
    }

    // 5. Rozciągnięcie sieci.
    if (canBuild(s, plain[plain.length - 1], 'PYLON').ok) {
      return [{ kind: 'BUILD', cellId: plain[plain.length - 1], type: 'PYLON' }];
    }

    return [];
  }
}
