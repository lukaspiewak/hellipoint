import { createPlanet, DEFAULT_RUN, Sim, type Phase, type RunConfig } from '@heliopolis/sim';
import { ScriptedPolicy } from './policy.js';
import { formatReport } from './report.js';

export interface RunResult {
  seed: number;
  phase: Phase;
  ticks: number;
  cycle: number;
  peakBuildings: number;
  oreMined: number;
  killsBySun: number;
  killsByTurret: number;
  /** Tick wyczerpania pierwszego złoża. -1 = nie wyczerpano żadnego. */
  firstDepletionTick: number;
}

/**
 * [STROJENIE] Bot podejmuje decyzję co sekundę, nie co tick — inaczej stawiałby budynki
 * szybciej, niż zarabia. 20 ticków = 1 s przy `TICK_SECONDS = 0,05`; sam ODSTĘP jest
 * pokrętłem zachowania bota (Faza 3 może go zmienić), nie stałą wynikającą z czegokolwiek.
 */
const DECISION_INTERVAL_TICKS = 20;

export function simulateRun(seed: number, cfg: RunConfig, maxTicks: number): RunResult {
  const planet = createPlanet({ seed });
  const sim = new Sim(planet, cfg);
  const policy = new ScriptedPolicy(sim);

  const capacities = planet.cells.map((c) => c.oreCapacity);
  let peakBuildings = 0;
  let firstDepletionTick = -1;
  let ticks = 0;

  while (sim.state.phase === 'RUNNING' && ticks < maxTicks) {
    if (ticks % DECISION_INTERVAL_TICKS === 0) {
      for (const cmd of policy.decide()) sim.enqueue(cmd);
    }

    sim.step();
    ticks++;

    const built = sim.state.buildings.reduce<number>((n, b) => n + (b === null ? 0 : 1), 0);
    if (built > peakBuildings) peakBuildings = built;

    if (firstDepletionTick < 0) {
      for (let i = 0; i < capacities.length; i++) {
        if (capacities[i] > 0 && sim.state.oreRemaining[i] === 0) {
          firstDepletionTick = ticks;
          break;
        }
      }
    }
  }

  const oreMined = capacities.reduce((sum, cap, i) => sum + (cap - sim.state.oreRemaining[i]), 0);

  return {
    seed,
    phase: sim.state.phase,
    ticks,
    cycle: sim.cycle,
    peakBuildings,
    oreMined,
    // Liczniki rzeczywiste z SimState, NIE przybliżenie z liczby jednostek w świetle —
    // patrz doc-comment `killsBySun` w packages/sim/src/sim/state.ts dla zmierzonego
    // błędu przybliżenia (30-38% na 300 przebiegach) i uzasadnienia zamiany.
    killsBySun: sim.state.killsBySun,
    killsByTurret: sim.state.killsByTurret,
    firstDepletionTick,
  };
}

// Wejście CLI: `pnpm bench [liczbaRunów] [pierwszySeed]` (tsc -b, potem `node dist/run.js`).
// Defekt brief-u: oryginalny skrypt `node --experimental-strip-types src/run.ts` nie działa
// na Node 22.22 — silnik nie przepisuje specyfikatorów `./policy.js`/`./report.js` na
// sąsiadujące pliki `.ts` (zmierzone bezpośrednio: `ERR_MODULE_NOT_FOUND` na dokładnie tym
// wzorcu, w izolowanym powtórzeniu poza tym pakietem). Naprawa: budować przez `tsc -b`
// i uruchamiać skompilowany `dist/run.js`, tak jak reszta monorepo (`pretest`/`build` w
// root `package.json`) — stąd sprawdzenie obu rozszerzeń tutaj, nie tylko `.ts`.
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  const count = Number(process.argv[2] ?? 1000);
  const first = Number(process.argv[3] ?? 0);
  const results: RunResult[] = [];
  for (let i = 0; i < count; i++) results.push(simulateRun(first + i, DEFAULT_RUN, 100_000));
  console.log(formatReport(results));
}
