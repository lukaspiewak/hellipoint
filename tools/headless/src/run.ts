import {
  createPlanet,
  DEFAULT_RUN,
  Sim,
  type EnemyType,
  type Phase,
  type RunConfig,
} from '@heliopolis/sim';
import { createHash } from 'node:crypto';
import { BeginnerPolicy, type PolicyFactory } from './policy.js';
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
  /**
   * Typ wroga, który ostatni uszkodził CORE (Faza 2C, Zadanie 5). `null`, gdy CORE nie
   * oberwał ani razu — czyli przy zwycięstwie i przy przebiegu uciętym `maxTicks`.
   * Czytany z `Sim`, nie ze stanu: to raport z ticku, nie wielkość, od której coś zależy.
   */
  coreDamager: EnemyType | null;
  /**
   * Nazwa polityki, na której ten wynik powstał (Faza 3, Zadanie 1).
   *
   * Przy KAŻDYM wyniku, nie tylko w nagłówku raportu: dwa wiersze z dwóch polityk wyglądają
   * identycznie, a §11.1 ma gotowy przykład, co kosztuje ich pomylenie — tabela ekstraktorów
   * powstała na słabszej polityce i jej progi bezwzględne nie są wiążące.
   */
  policy: string;
  /**
   * Odcisk `RunConfig`, na którym ten przebieg powstał (Faza 3, naprawa Z5).
   *
   * Raport krzyczał na mieszanie POLITYK, a był ślepy na mieszanie KONFIGURACJI — i to
   * mimo że Zadanie 3 polega właśnie na przemiataniu konfiguracji. Partia z dwóch różnych
   * `startingOre` dawała spokojny raport bez jednego słowa ostrzeżenia, a jej rozkłady
   * nie opisywały żadnej z tych dwóch nastaw.
   *
   * Odcisk, nie cała konfiguracja: do raportu trafia osiem znaków, a nie osiemnaście pól.
   * Do NAZWANIA nastawy służy etykieta partii, którą nadaje przemiatanie — odcisk ma
   * wyłącznie wykrywać, że w jednej partii są dwie.
   */
  configFingerprint: string;
}

/**
 * Osiem znaków odcisku `RunConfig` — tyle, żeby dwie różne nastawy w jednej partii rzucały
 * się w oczy, i za mało, żeby ktoś próbował z tego odczytać samą nastawę.
 *
 * `JSON.stringify` zależy od kolejności pól, więc przestawienie ich w `DEFAULT_RUN` zgłosi
 * „inna konfiguracja" bez zmiany wartości. Kierunek zachowawczy: każe spojrzeć.
 */
export function configFingerprint(cfg: RunConfig): string {
  return createHash('sha256').update(JSON.stringify(cfg)).digest('hex').slice(0, 8);
}

/**
 * Odstęp decyzji NIE jest już stałą tego pliku — czyta się go z polityki
 * (`Policy.decisionIntervalTicks`). Przegląd Zadania 1 Fazy 3 (Z1) zmierzył, ile kosztowała
 * jedna wspólna wartość: `SkilledPolicy` dławiona odstępem 20 wygrywała 39 % grywalnych
 * seedów zamiast 78 %, czyli przyrząd zaniżał sufit o połowę.
 */

/**
 * Jeden przebieg.
 *
 * `makePolicy` jest OPCJONALNE i domyślnie daje politykę początkującą — bez tego wszystkie
 * dotychczasowe pomiary (raport z 1000 runów, `pnpm bench`) po cichu zmieniłyby znaczenie.
 * Fabryka, a nie gotowa polityka, bo polityka potrzebuje `Sim`, który powstaje tutaj.
 */
export function simulateRun(
  seed: number,
  cfg: RunConfig,
  maxTicks: number,
  makePolicy: PolicyFactory = (sim) => new BeginnerPolicy(sim),
): RunResult {
  const planet = createPlanet({ seed });
  const sim = new Sim(planet, cfg);
  const policy = makePolicy(sim);

  const capacities = planet.cells.map((c) => c.oreCapacity);
  let peakBuildings = 0;
  let firstDepletionTick = -1;
  let ticks = 0;

  while (sim.state.phase === 'RUNNING' && ticks < maxTicks) {
    if (ticks % policy.decisionIntervalTicks === 0) {
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
    coreDamager: sim.lastCoreDamager,
    policy: policy.name,
    configFingerprint: configFingerprint(cfg),
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
