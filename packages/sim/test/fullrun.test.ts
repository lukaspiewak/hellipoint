import { describe, expect, it } from 'vitest';
import { createPlanet, type Planet } from '../src/world/planet.js';
import { multiSourceDistances } from '../src/world/graph.js';
import { Sim } from '../src/sim/loop.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';
import { stateHash } from '../src/sim/hash.js';
import { ENEMIES } from '../src/sim/defs.js';
import { spawnUnit } from '../src/sim/movement.js';
import { TICK_SECONDS, type BuildingType } from '../src/sim/state.js';
import type { Command } from '../src/sim/commands.js';

describe('pełny run', () => {
  it('symulacja bez żadnych komend kończy się porażką w skończonym czasie', () => {
    const sim = new Sim(createPlanet({ seed: 101 }), DEFAULT_RUN);
    let ticks = 0;
    while (sim.state.phase === 'RUNNING' && ticks < 200_000) {
      sim.step();
      ticks++;
    }
    expect(sim.state.phase).toBe('DEFEAT');
    expect(ticks).toBeLessThan(200_000);
  });

  it('pełen run jest deterministyczny na przestrzeni tysięcy ticków', () => {
    const run = () => {
      const sim = new Sim(createPlanet({ seed: 102 }), DEFAULT_RUN);
      for (let i = 0; i < 8000 && sim.state.phase === 'RUNNING'; i++) sim.step();
      return stateHash(sim.state);
    };
    expect(run()).toBe(run());
  });

  it('wrogowie faktycznie się pojawiają i faktycznie atakują CORE', () => {
    const sim = new Sim(createPlanet({ seed: 103 }), DEFAULT_RUN);
    const core = sim.state.planet.startCell;
    const fullHp = sim.state.buildings[core]!.hp;

    let sawUnits = false;
    for (let i = 0; i < 60_000 && sim.state.phase === 'RUNNING'; i++) {
      sim.step();
      if (sim.state.units.length > 0) sawUnits = true;
    }

    expect(sawUnits).toBe(true);
    expect(sim.state.buildings[core]?.hp ?? 0).toBeLessThan(fullHp);
  });
});

/**
 * Test „pełen run jest deterministyczny" wyżej porównuje przebieg SAM ZE SOBĄ. Taki
 * test jest zielony również nad symulacją, która nic nie robi: pusta pętla jest
 * doskonale deterministyczna. Jego wartość zależy więc w całości od tego, czy
 * porównywany przebieg jest BOGATY W ZDARZENIA — a tego nie asercjuje ani on, ani jego
 * nazwa. Ten blok mierzy dokładnie ten sam przebieg (ten sam seed, ten sam limit) i
 * przypina, ile się w nim naprawdę dzieje.
 *
 * Zmierzone dla seeda 102 pod `DEFAULT_RUN`: run kończy się PORAŻKĄ na ticku 1978,
 * a nie na limicie 8000 — czyli „8000" w teście wyżej nigdy nie jest osiągane i
 * porównywane hashe dotyczą stanu po ~1978 tickach. W tym czasie: 144 zrodzone
 * jednostki (64 żywe na końcu), CORE zbity z 1000 hp do zera, ruda 150 → 310
 * (czyli ~80 zaliczonych zabójstw, prawie wyłącznie od słońca).
 */
describe('przebieg porównywany testem determinizmu jest bogaty w zdarzenia', () => {
  it('seed 102 rodzi setki jednostek, traci CORE i nalicza rudę za zabójstwa — nie jest martwą pętlą', () => {
    const sim = new Sim(createPlanet({ seed: 102 }), DEFAULT_RUN);
    const core = sim.state.planet.startCell;
    const startOre = sim.state.ore;

    let ticks = 0;
    let peakUnits = 0;
    while (ticks < 8000 && sim.state.phase === 'RUNNING') {
      sim.step();
      ticks++;
      if (sim.state.units.length > peakUnits) peakUnits = sim.state.units.length;
    }

    // Zmierzone: 144 zrodzonych, szczyt 64 żywych naraz.
    expect(sim.state.nextUnitId - 1).toBeGreaterThan(100);
    expect(peakUnits).toBeGreaterThan(40);
    // Ruda rośnie WYŁĄCZNIE z zabójstw: ten run nie ma ani jednego ekstraktora,
    // bo nie ma ani jednej komendy. Zmierzone: 150 → 310.
    expect(sim.state.ore).toBeGreaterThan(startOre);
    // Budynek NAPRAWDĘ znika ze stanu, nie tylko schodzi do zera hp.
    expect(sim.state.buildings[core]).toBeNull();
    expect(sim.state.phase).toBe('DEFEAT');
    // Pętla kończy się FAZĄ, nie limitem: „8000" nigdy nie jest osiągane (zmierzone: 1978).
    expect(ticks).toBeGreaterThan(1000);
    expect(ticks).toBeLessThan(8000);
  });
});

/**
 * Kolejność systemów w `step()` jest CZĘŚCIĄ KONTRAKTU DETERMINIZMU
 * (global-constraints.md): komendy → oświetlenie → energia → ekonomia → pola przepływu →
 * ruch → walka → spalanie → fale i spawn → warunki końca. Żaden test determinizmu jej nie
 * pilnuje — wszystkie porównują przebieg SAM ZE SOBĄ, więc są zielone przy DOWOLNEJ
 * kolejności, byle stałej. Zmierzone: przestawienie `updateRules` przed ruch i walkę
 * oblewało w całym zestawie dokładnie JEDEN test — i to przypadkiem, bo zmieniało hash
 * bronionego runu, a nie dlatego, że cokolwiek nazywało kolejność.
 *
 * Ten test przypina OSTATNIE ogniwo łańcucha przez obserwowalny skutek: CORE dobity
 * w walce danego ticka musi zakończyć run W TYM SAMYM ticku. Gdyby warunki końca biegły
 * przed walką, faza zostałaby na RUNNING przez jeszcze jeden pełny tick — jeden tick,
 * w którym gra jest formalnie przegrana, a komendy wciąż się wykonują.
 */
describe('kolejność systemów w step()', () => {
  it('warunki końca widzą świat PO walce tego samego ticka, nie sprzed niego', () => {
    const planet = createPlanet({ seed: 103 });
    const sim = new Sim(planet, DEFAULT_RUN);
    const core = planet.startCell;

    // CORE słabszy niż obrażenia jednej jednostki na tick, więc pierwsze starcie
    // zdejmuje go ze stanu, a nie tylko obniża hp.
    sim.state.buildings[core]!.hp = (ENEMIES.SWARM.dps * TICK_SECONDS) / 2;
    spawnUnit(sim.state, 'SWARM', core);

    let ticks = 0;
    while (sim.state.buildings[core] !== null && ticks < 50) {
      sim.step();
      ticks++;
    }

    expect(sim.state.buildings[core]).toBeNull();
    // Kluczowa asercja: NIE po kolejnym `step()`, tylko po tym, w którym CORE zniknął.
    expect(sim.state.phase).toBe('DEFEAT');
  });
});

/**
 * Plan zabudowy wyrażony parami (pierścień wokół CORE, typ budynku). Komórki dobierane
 * z PLANETY, nie zaszyte indeksami — stały indeks mógłby trafić na pentagon albo złoże,
 * przez co komenda byłaby po cichu ignorowana (`applyCommand` nie zgłasza błędów) i test
 * przechodziłby, nie postawiwszy niczego. Ten sam wzorzec co w determinism.test.ts.
 *
 * Pule: `hexK` — zwykłe heksy bez rudy w odległości K kroków grafu od komórki startowej;
 * `pylon`/`pent` — najbliższy pentagon i heks, który go domyka do sieci CORE (w promieniu
 * ≤ 3 od CORE i ≤ 3 od pentagonu, czyli w zasięgu łańcucha CORE → PYLON → CAP).
 */
type Pool = 'hex1' | 'hex2' | 'hex3' | 'pylon' | 'pent';

function pickCells(planet: Planet, spec: ReadonlyArray<readonly [Pool, BuildingType]>) {
  const neighbors = planet.cells.map((c) => c.neighbors);
  const fromCore = multiSourceDistances(neighbors, [planet.startCell]);
  const pent = [...planet.pentagons].sort((a, b) => fromCore[a] - fromCore[b] || a - b)[0];
  const fromPent = multiSourceDistances(neighbors, [pent]);

  const plainHexRing = (k: number) =>
    planet.cells
      .filter((c) => fromCore[c.id] === k && c.cellType === 'HEXAGON' && c.oreCapacity === 0)
      .map((c) => c.id)
      .sort((a, b) => a - b);

  const pools: Record<Pool, number[]> = {
    hex1: plainHexRing(1),
    hex2: plainHexRing(2),
    hex3: plainHexRing(3),
    pent: [pent],
    pylon: planet.cells
      .filter(
        (c) =>
          fromCore[c.id] >= 1 && fromCore[c.id] <= 3 && fromPent[c.id] <= 3 &&
          c.cellType === 'HEXAGON' && c.oreCapacity === 0,
      )
      .map((c) => c.id)
      .sort((a, b) => fromPent[a] - fromPent[b] || a - b),
  };

  const taken: Partial<Record<Pool, number>> = {};
  return spec.map(([pool, type]) => {
    const i = taken[pool] ?? 0;
    taken[pool] = i + 1;
    const cellId = pools[pool][i];
    // Głośno, nie po cichu: wyczerpana pula dałaby `undefined` jako cellId, komenda
    // byłaby zignorowana i test „przeszedłby", nie zbudowawszy obrony.
    if (cellId === undefined) throw new Error(`pula ${pool} wyczerpana przy ${type}`);
    return { kind: 'BUILD', cellId, type } as Command;
  });
}

/**
 * Odgrywa run z ustaloną kolejką zabudowy: co tick próbuje postawić NAJBLIŻSZY
 * niezrealizowany budynek z planu i przechodzi do następnego dopiero, gdy ten stanie.
 * `applyCommand` ignoruje komendę bez pokrycia w rudzie, więc plan realizuje się sam w
 * tempie ekonomii — bez zegara, bez losowości, w pełni deterministycznie.
 */
function playPlan(seed: number, spec: ReadonlyArray<readonly [Pool, BuildingType]>, maxTicks: number) {
  const planet = createPlanet({ seed });
  const sim = new Sim(planet, DEFAULT_RUN);
  const orders = pickCells(planet, spec);

  let placed = 0;
  let ticks = 0;
  while (sim.state.phase === 'RUNNING' && ticks < maxTicks) {
    const next = orders[placed];
    if (next !== undefined) sim.enqueue(next);
    sim.step();
    ticks++;
    if (next !== undefined && next.kind === 'BUILD' && sim.state.buildings[next.cellId]?.type === next.type) {
      placed++;
    }
  }
  return { sim, ticks, placed, total: orders.length };
}

/**
 * Otwarcie dobrane pod DZISIEJSZE liczby `[STROJENIE]` (defs.ts, spawning.ts, rules.ts):
 * tani mur z barykad (0 poboru energii), jeden GEOTHERMAL_CAP domknięty pylonem — bo bez
 * niego CORE daje 10 energii/s, a sam Evac chce 25/s — mieszana obrona (1 laser + 2
 * kinetyki mieszczą się w budżecie energii tam, gdzie 3 lasery już nie), magazyn, panele,
 * druga linia barykad i dopiero na końcu Moduł Ewakuacyjny.
 *
 * Gdyby ten test oblał po przestrojeniu balansu w Fazie 3 — to NIE jest regresja pętli,
 * tylko sygnał, że przy nowych liczbach to konkretne otwarcie przestało wygrywać.
 * Wtedy trzeba wyprowadzić nowe otwarcie headlessem, a nie osłabiać asercje.
 */
const WINNING_OPENING: ReadonlyArray<readonly [Pool, BuildingType]> = [
  ['hex1', 'BARRICADE'], ['hex1', 'BARRICADE'], ['hex1', 'BARRICADE'],
  ['hex1', 'BARRICADE'], ['hex1', 'BARRICADE'],
  ['pylon', 'PYLON'], ['pent', 'GEOTHERMAL_CAP'],
  ['hex2', 'LASER_TURRET'], ['hex2', 'KINETIC_TURRET'], ['hex2', 'KINETIC_TURRET'],
  ['hex2', 'BATTERY'], ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex3', 'BARRICADE'], ['hex3', 'BARRICADE'], ['hex3', 'BARRICADE'],
  ['hex3', 'BARRICADE'], ['hex3', 'BARRICADE'], ['hex3', 'BARRICADE'],
  ['hex3', 'BARRICADE'], ['hex3', 'BARRICADE'], ['hex3', 'BARRICADE'],
  ['hex3', 'BARRICADE'], ['hex3', 'BARRICADE'], ['hex3', 'BARRICADE'],
  ['hex2', 'EVACUATION_MODULE'],
];

/**
 * Deliverable całego Taska 5 brzmi: run da się rozegrać OD STARTU DO ZWYCIĘSTWA
 * albo porażki, bez renderera. Trzy testy „pełnego runu" wyżej dowodzą wyłącznie
 * połowy porażkowej — we WSZYSTKICH trzech faza kończy się na `DEFEAT`, a `VICTORY`
 * nie pada w nich ani razu. Ten blok domyka drugą połowę: pełna ścieżka zwycięstwa
 * biegnie przez `Sim.step()`, na domyślnym balansie, przeciw realnie atakującym falom.
 */
describe('broniony run dochodzi do ZWYCIĘSTWA', () => {
  it('kolejka zabudowy prowadzi run od startu do VICTORY, a dwa jego przebiegi są identyczne co do bitu', () => {
    const a = playPlan(33, WINNING_OPENING, 80_000);
    const core = a.sim.state.planet.startCell;

    expect(a.sim.state.phase).toBe('VICTORY');
    expect(a.placed).toBe(a.total);

    // Zwycięstwo WYWALCZONE, nie odczekane w pustce (zmierzone: 576 zrodzonych
    // jednostek, 29 wciąż żywych na końcu, CORE zbity z 1000 do 278 hp, cykl 2).
    expect(a.sim.state.nextUnitId - 1).toBeGreaterThan(300);
    expect(a.sim.state.units.length).toBeGreaterThan(0);
    expect(a.sim.state.buildings[core]!.hp).toBeLessThan(500);
    expect(a.sim.state.buildings[core]!.hp).toBeGreaterThan(0);
    // Ewakuacja doszła do końca: ładunek pełny, alarm odliczony do zera.
    expect(a.sim.state.evacCharge).toBeGreaterThanOrEqual(DEFAULT_RUN.evacEnergyRequired);
    expect(a.sim.state.evacAlarmRemaining).toBeLessThanOrEqual(0);
    // Run przekroczył granicę cyklu — `currentCycle` nie stoi na 1 jak w runach porażkowych.
    expect(a.sim.cycle).toBeGreaterThan(1);
    expect(a.ticks * TICK_SECONDS).toBeGreaterThan(DEFAULT_RUN.rotationPeriod);

    // Determinizm nad przebiegiem, który TRWA i w którym coś się dzieje — tysiące ticków
    // z walką, spalaniem, erupcjami zatkanego pentagonu i przejściem fazy do VICTORY,
    // a nie 1978 ticków zakończonych porażką jak w teście z seedem 102.
    const b = playPlan(33, WINNING_OPENING, 80_000);
    expect(b.ticks).toBe(a.ticks);
    expect(stateHash(b.sim.state)).toBe(stateHash(a.sim.state));
  });
});

/**
 * Test wyżej wygrywa na dzisiejszym balansie i jest przez to wrażliwy na przestrojenie
 * `[STROJENIE]` w Fazie 3. Ten sprawdza tę samą ścieżkę — budowa → zasilanie → ładowanie
 * → alarm → VICTORY, całość przez `Sim.step()` — ale skraca ewakuację KONFIGURACJĄ,
 * nie osłabieniem asercji: `RunConfig` istnieje właśnie po to, żeby dało się rozegrać
 * krótszy run. Dzięki temu maszyneria warunków końca ma strażnika niezależnego od tego,
 * czy któreś otwarcie akurat wygrywa przy danym stroju liczb.
 */
describe('zwycięstwo jest osiągalne przez samą pętlę, niezależnie od stroju balansu', () => {
  it('zbudowany i zasilony Evac doprowadza run do VICTORY bez ani jednej ingerencji w stan', () => {
    const planet = createPlanet({ seed: 103 });
    const cfg = {
      ...DEFAULT_RUN,
      startingOre: 400,        // [STROJENIE] tylko na potrzeby tego testu: stać na Evac od razu
      evacEnergyRequired: 100, // [STROJENIE] 1/10 domyślnej — skraca ładowanie do ~10 s
      evacAlarmSeconds: 5,     // [STROJENIE] 1/12 domyślnego — skraca alarm do ~5 s
    };
    const sim = new Sim(planet, cfg);
    const [target] = planet.cells
      .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell)
      .map((c) => c.id)
      .filter((id) => planet.cells[planet.startCell].neighbors.includes(id));

    sim.enqueue({ kind: 'BUILD', cellId: target, type: 'EVACUATION_MODULE' });

    let ticks = 0;
    let sawUnits = false;
    let sawCharging = false;
    let sawAlarm = false;
    while (sim.state.phase === 'RUNNING' && ticks < 20_000) {
      sim.step();
      ticks++;
      if (sim.state.units.length > 0) sawUnits = true;
      if (sim.state.evacCharge > 0 && sim.state.evacCharge < cfg.evacEnergyRequired) sawCharging = true;
      if (sim.state.evacAlarmRemaining > 0) sawAlarm = true;
    }

    // Moduł stanął KOMENDĄ, przez `applyCommand` — nie zapisem do stanu.
    expect(sim.state.buildings[target]).toMatchObject({ type: 'EVACUATION_MODULE', powered: true });
    // Każdy etap ścieżki faktycznie się wydarzył, a nie tylko jej koniec.
    expect(sawCharging).toBe(true);
    expect(sawAlarm).toBe(true);
    expect(sawUnits).toBe(true);
    expect(sim.state.evacAlarmRemaining).toBeLessThanOrEqual(0);
    expect(sim.state.phase).toBe('VICTORY');
  });
});
