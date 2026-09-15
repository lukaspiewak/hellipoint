import type { Rng } from '../math/rng.js';
import { spawnUnit } from './movement.js';
import { TICK_SECONDS, type EnemyType, type SimState } from './state.js';

export interface SpawnConfig {
  /** Jednostek na sekundę z jednego otwartego, zaciemnionego pentagonu w cyklu 1. */
  baseRatePerPentagon: number;
  /** Mnożnik tempa na każdy kolejny cykl. */
  growthPerCycle: number;
  /** Sekundy między erupcjami zatkanego pentagonu. */
  eruptionInterval: number;
  /** Liczba jednostek w erupcji przy jednym capie. */
  eruptionBurstBase: number;
  /** Przyrost siły erupcji na każdy postawiony cap. */
  eruptionScalePerCap: number;
  disruptorFromCycle: number;
  armorFromCycle: number;
}

// [STROJENIE] — cała ta tabela należy do Fazy 3 i headlessa.
export const DEFAULT_SPAWN: SpawnConfig = {
  baseRatePerPentagon: 0.25,
  growthPerCycle: 1.35,
  eruptionInterval: 20,
  eruptionBurstBase: 4,
  eruptionScalePerCap: 0.6,
  disruptorFromCycle: 3,
  armorFromCycle: 5,
};

/**
 * Realizacja §5.3: zatkanie pentagonu NIE kasuje spawnu — przekierowuje go. Otwarty,
 * zaciemniony pentagon wypuszcza ciągły ułamkowy strumień (`spawnAccumulator`).
 * Zatkany (GEOTHERMAL_CAP) przestaje to robić i zamiast tego erupuje w miejscu co
 * `eruptionInterval`, z siłą rosnącą wraz z LICZBĄ WSZYSTKICH capów na planecie — więc
 * capowanie wszystkich 12 nie usuwa zagrożenia, tylko przenosi je pod bazę gracza
 * (cap musi być podpięty do sieci, więc gracz capuje blisko siebie).
 *
 * Residual względem wersji z brief-u: `eruptionCooldown` startuje w `createState` na 0,
 * co bez `eruptionArmed` czyni je nieodróżnialnym od "właśnie odliczyło do zera" —
 * pierwsza erupcja wystrzeliwałaby w TYM SAMYM ticku, w którym stanął cap, zamiast po
 * pełnym interwale (złapane przez test "zatkany pentagon nie wypuszcza ciągłego
 * strumienia" w krótkim oknie poniżej interwału — patrz task-4-report.md). `eruptionArmed`
 * zapewnia, że pierwsze uzbrojenie liczników PO (po)nownym zatkaniu ustawia pełny
 * interwał zamiast fałszywie "przeterminowanego" zera.
 */
export function updateSpawning(
  s: SimState,
  light: Float32Array,
  rng: Rng,
  cycle: number,
  cfg: SpawnConfig,
): void {
  const capCount = countCaps(s);
  const rate = cfg.baseRatePerPentagon * Math.pow(cfg.growthPerCycle, cycle - 1);

  for (let i = 0; i < s.planet.pentagons.length; i++) {
    const cellId = s.planet.pentagons[i];
    const ps = s.pentagons[i];

    // D1: pentagon w świetle jest martwy, niezależnie od wszystkiego innego —
    // odliczanie erupcji też stoi w miejscu, nie tylko strumień ciągły.
    if (light[cellId] > 0) continue;

    const capped = s.buildings[cellId]?.type === 'GEOTHERMAL_CAP';

    if (capped) {
      // §5.3: cap PRZEKIEROWUJE spawn zamiast go kasować.
      // Strumień ustaje, ale ciśnienie wraca jako okresowa erupcja w tym samym miejscu,
      // rosnąca z liczbą capów — czyli gracz sam ściąga sobie bombę pod dom.
      if (!ps.eruptionArmed) {
        // Świeże zatkanie: uzbrój pełnym interwałem, NIE erupuj w tym ticku.
        ps.eruptionCooldown = cfg.eruptionInterval;
        ps.eruptionArmed = true;
      }

      ps.eruptionCooldown -= TICK_SECONDS;
      if (ps.eruptionCooldown <= 0) {
        ps.eruptionCooldown += cfg.eruptionInterval;
        const burst = Math.round(
          cfg.eruptionBurstBase * (1 + cfg.eruptionScalePerCap * (capCount - 1)),
        );
        for (let k = 0; k < burst; k++) {
          spawnUnit(s, pickType(rng, cycle, cfg), cellId);
        }
      }
      continue;
    }

    // Odkapowany (albo nigdy nie zakapowany) pentagon zapomina odliczanie erupcji —
    // ponowne zacapowanie w przyszłości ma liczyć pełny interwał od nowa, nie
    // kontynuować stare, zamrożone odliczenie.
    ps.eruptionArmed = false;

    ps.spawnAccumulator += rate * TICK_SECONDS;
    while (ps.spawnAccumulator >= 1) {
      ps.spawnAccumulator -= 1;
      spawnUnit(s, pickType(rng, cycle, cfg), cellId);
    }
  }
}

function countCaps(s: SimState): number {
  let n = 0;
  for (const cellId of s.planet.pentagons) {
    if (s.buildings[cellId]?.type === 'GEOTHERMAL_CAP') n++;
  }
  return n;
}

function pickType(rng: Rng, cycle: number, cfg: SpawnConfig): EnemyType {
  const pool: EnemyType[] = ['SWARM'];
  if (cycle >= cfg.disruptorFromCycle) pool.push('DISRUPTOR');
  if (cycle >= cfg.armorFromCycle) pool.push('ARMOR');
  return pool[rng.nextInt(pool.length)];
}
