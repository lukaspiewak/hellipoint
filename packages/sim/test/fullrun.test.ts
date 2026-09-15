import { describe, expect, it } from 'vitest';
import { createPlanet, type Planet } from '../src/world/planet.js';
import { multiSourceDistances } from '../src/world/graph.js';
import { Sim } from '../src/sim/loop.js';
import { currentCycle, DEFAULT_RUN, evacUnlocked } from '../src/sim/rules.js';
import { stateHash } from '../src/sim/hash.js';
import { ENEMIES } from '../src/sim/defs.js';
import { spawnUnit } from '../src/sim/movement.js';
import { TICK_SECONDS, type BuildingType } from '../src/sim/state.js';
import type { Command } from '../src/sim/commands.js';

/**
 * Limit pętli dla runów BEZ komend. Zmierzone długości pod `DEFAULT_RUN`: seed 101 —
 * 487 ticków, seed 102 — 1978, seed 103 — 2034. 6000 to ~3× najdłuższego z nich.
 *
 * Nie jest to kosmetyka. Przy poprzednim limicie 200 000 regresja usuwająca wywołanie
 * `updateRules` ze `step()` NIE OBLEWAŁA — wieszała cały zestaw: żaden run się nie kończył,
 * liczba jednostek rosła z `growthPerCycle` na cykl, a pętla `while` jest SYNCHRONICZNA,
 * więc timeout vitesta nie ma jej jak przerwać (zmierzone: zabite po 150 s bez
 * podsumowania). Przy 6000 ta sama regresja oblewa w kilka sekund — stąd też jawne
 * `expect(ticks).toBeLessThan(PASSIVE_CAP)` w każdym z tych testów: limit ma być
 * niedosiężny, a nie cicho osiągany.
 */
const PASSIVE_CAP = 6000;

describe('pełny run', () => {
  it('symulacja bez żadnych komend kończy się porażką w skończonym czasie', () => {
    const sim = new Sim(createPlanet({ seed: 101 }), DEFAULT_RUN);
    let ticks = 0;
    while (sim.state.phase === 'RUNNING' && ticks < PASSIVE_CAP) {
      sim.step();
      ticks++;
    }
    expect(sim.state.phase).toBe('DEFEAT');
    expect(ticks).toBeLessThan(PASSIVE_CAP);
  });

  it('pełen run jest deterministyczny na przestrzeni tysięcy ticków', () => {
    const run = () => {
      const sim = new Sim(createPlanet({ seed: 102 }), DEFAULT_RUN);
      let ticks = 0;
      while (ticks < PASSIVE_CAP && sim.state.phase === 'RUNNING') { sim.step(); ticks++; }
      // Run ma skończyć się FAZĄ, nie limitem — inaczej ten test porównuje dwa uciecia
      // pętli, a regresja „runy przestały się kończyc" wisi zamiast oblewac.
      expect(ticks).toBeLessThan(PASSIVE_CAP);
      return stateHash(sim.state);
    };
    expect(run()).toBe(run());
  });

  it('wrogowie faktycznie się pojawiają i faktycznie atakują CORE', () => {
    const sim = new Sim(createPlanet({ seed: 103 }), DEFAULT_RUN);
    const core = sim.state.planet.startCell;
    const fullHp = sim.state.buildings[core]!.hp;

    let sawUnits = false;
    let ticks = 0;
    while (ticks < PASSIVE_CAP && sim.state.phase === 'RUNNING') {
      sim.step();
      ticks++;
      if (sim.state.units.length > 0) sawUnits = true;
    }

    expect(ticks).toBeLessThan(PASSIVE_CAP);
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
    while (ticks < PASSIVE_CAP && sim.state.phase === 'RUNNING') {
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
    expect(ticks).toBeLessThan(PASSIVE_CAP);
  });
});

/**
 * Próg ewakuacji liczony jest RAZ, w konstruktorze `Sim`, i zapisywany do stanu jako tick —
 * `canBuild` (która go egzekwuje) nie zna ani `rotationPeriod`, ani `RunConfig`. Testy
 * bramki samej w sobie są w commands.test.ts; tutaj chodzi o to, czy `Sim` wylicza go
 * z KONFIGURACJI, a nie z zaszytej liczby, i czy tick zgadza się z cyklem, który nazywa.
 */
describe('próg ewakuacji wyliczany przez Sim', () => {
  it('tick progu wynika z cyclesPerRun × evacUnlockFraction × rotationPeriod, nie z zaszytej stałej', () => {
    const planet = createPlanet({ seed: 7 });
    const ticksPerCycle = DEFAULT_RUN.rotationPeriod / TICK_SECONDS;

    // DEFAULT_RUN: ceil(10 × 0,67) = 7 → próg na początku cyklu 7, czyli po 6 obrotach.
    const domyslny = new Sim(planet, DEFAULT_RUN);
    expect(domyslny.state.evacUnlockTick).toBe(6 * ticksPerCycle);
    expect(domyslny.state.evacUnlockTick).toBe(21600);

    // Inne cyclesPerRun ⇒ inny próg. Gdyby 21600 było zaszyte, ta asercja by oblała.
    const krotki = new Sim(planet, { ...DEFAULT_RUN, cyclesPerRun: 4, evacUnlockFraction: 0.5 });
    expect(krotki.state.evacUnlockTick).toBe(1 * ticksPerCycle); // ceil(4 × 0,5) = 2 → po 1 obrocie
    expect(krotki.state.evacUnlockTick).toBe(3600);

    // Inny okres obrotu przy tym samym cyklu ⇒ inny tick: przeliczenie naprawdę używa
    // rotationPeriod, a nie stałych 180 s.
    const szybki = new Sim(planet, { ...DEFAULT_RUN, cyclesPerRun: 4, evacUnlockFraction: 0.5, rotationPeriod: 60 });
    expect(szybki.state.evacUnlockTick).toBe(60 / TICK_SECONDS);

    // Run jednocyklowy: próg 0, czyli Evac dostępny od pierwszego ticka.
    const jeden = new Sim(planet, { ...DEFAULT_RUN, cyclesPerRun: 1 });
    expect(jeden.state.evacUnlockTick).toBe(0);
  });

  it('tick progu to DOKŁADNIE pierwszy tick cyklu odblokowującego — nie tick wcześniej, nie później', () => {
    const sim = new Sim(createPlanet({ seed: 7 }), DEFAULT_RUN);
    const prog = sim.state.evacUnlockTick;
    const cyklOdblokowania = Math.ceil(DEFAULT_RUN.cyclesPerRun * DEFAULT_RUN.evacUnlockFraction);

    expect(currentCycle(prog * TICK_SECONDS, DEFAULT_RUN.rotationPeriod)).toBe(cyklOdblokowania);
    expect(currentCycle((prog - 1) * TICK_SECONDS, DEFAULT_RUN.rotationPeriod)).toBe(cyklOdblokowania - 1);
    // Zgodność z formą przeznaczoną dla UI Fazy 2: obie muszą mówić to samo o tej granicy.
    expect(evacUnlocked(currentCycle(prog * TICK_SECONDS, DEFAULT_RUN.rotationPeriod), DEFAULT_RUN)).toBe(true);
    expect(evacUnlocked(currentCycle((prog - 1) * TICK_SECONDS, DEFAULT_RUN.rotationPeriod), DEFAULT_RUN)).toBe(false);
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
 * `hexK` — zwykłe heksy bez rudy w odległości K kroków grafu od komórki startowej.
 */
type Pool = 'hex1' | 'hex2' | 'hex3' | 'hex4';

function pickCells(planet: Planet, spec: ReadonlyArray<readonly [Pool, BuildingType]>) {
  const fromCore = multiSourceDistances(planet.cells.map((c) => c.neighbors), [planet.startCell]);
  const plainHexRing = (k: number) =>
    planet.cells
      .filter((c) => fromCore[c.id] === k && c.cellType === 'HEXAGON' && c.oreCapacity === 0)
      .map((c) => c.id)
      .sort((a, b) => a - b);

  const pools: Record<Pool, number[]> = {
    hex1: plainHexRing(1), hex2: plainHexRing(2),
    hex3: plainHexRing(3), hex4: plainHexRing(4),
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
 * Polityka ODBUDOWUJĄCA: co tick wybiera pierwszą pozycję planu, której komórka jest pusta,
 * i wysyła dla niej BUILD. Iteracja po rosnącym indeksie planu, bez losowości, bez zegara.
 *
 * Wersja jednorazowa (lista wykonana raz i zapomniana) NIE wystarcza i to jest zmierzone:
 * mur barykad znikał w całości między cyklem 2 a 3, panele słoneczne ginęły od DISRUPTOR-ów
 * (`targetPriority: 'ENERGY_INFRASTRUCTURE'`), podaż spadała do 10/s przy popycie 24/s,
 * wieże gasły w kaskadzie brownoutu i run kończył się porażką w cyklu 3 — **z 2880 rudy
 * nietkniętej w banku**. Odbudowa zamienia tę rudę z powrotem w obronę; w zwycięskim
 * przebiegu odbudów jest ponad dwa tysiące.
 */
function playPlan(
  seed: number,
  spec: ReadonlyArray<readonly [Pool, BuildingType]>,
  maxTicks: number,
  cfg = DEFAULT_RUN,
) {
  const planet = createPlanet({ seed });
  const sim = new Sim(planet, cfg);
  const orders = pickCells(planet, spec);

  let ticks = 0;
  let rebuilds = 0;
  let evacBuiltTick = -1;
  let peakUnits = 0;
  const standing = new Map<number, 'nigdy' | 'stoi' | 'zburzony'>(
    orders.map((o) => [o.kind === 'BUILD' ? o.cellId : -1, 'nigdy' as const]),
  );

  while (sim.state.phase === 'RUNNING' && ticks < maxTicks) {
    for (const o of orders) {
      if (o.kind === 'BUILD' && sim.state.buildings[o.cellId] === null) {
        sim.enqueue(o);
        break;
      }
    }
    sim.step();
    ticks++;

    for (const o of orders) {
      if (o.kind !== 'BUILD') continue;
      const present = sim.state.buildings[o.cellId]?.type === o.type;
      if (present) {
        if (standing.get(o.cellId) === 'zburzony') rebuilds++;
        standing.set(o.cellId, 'stoi');
      } else if (standing.get(o.cellId) === 'stoi') {
        standing.set(o.cellId, 'zburzony');
      }
    }
    if (evacBuiltTick < 0 && sim.state.buildings.some((b) => b?.type === 'EVACUATION_MODULE')) {
      evacBuiltTick = ticks;
    }
    if (sim.state.units.length > peakUnits) peakUnits = sim.state.units.length;
  }
  return { sim, ticks, rebuilds, evacBuiltTick, peakUnits };
}

const times = <T,>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

/**
 * Otwarcie dobrane pod DZISIEJSZE liczby `[STROJENIE]` (defs.ts, spawning.ts, rules.ts).
 * Dwie rzeczy w nim są wnioskiem ze zmierzonych porażek, nie stylem:
 *
 *  • **Zero łańcuchów pylonów do dalekich pentagonów.** GEOTHERMAL_CAP daje 25/s stałej
 *    podaży, ale łańcuch do niego biegnie przez otwarty teren i jest nie do obrony:
 *    DISRUPTOR-y (`ENERGY_INFRASTRUCTURE`) zjadały wszystkie 7 pylonów między cyklem 2
 *    a 3, capy odłączały się od sieci i podaż spadała do 10/s CORE-a. Cała energia
 *    mieszka WEWNĄTRZ pierścienia bronionego przez wieże.
 *  • **Mniej wież, nie więcej.** Warianty z 3 i 4 laserami padały WCZEŚNIEJ niż z 2
 *    (zmierzone: 9275 i 10224 ticka wobec 13323), bo popyt przekraczał podaż i brownout
 *    gasił obronę w kółko. Dwa lasery (24/s) mieszczą się w budżecie, jaki utrzymają
 *    cztery panele i pięć baterii przez noc.
 *
 * Gdyby ten test oblał po przestrojeniu balansu w Fazie 3 — to NIE jest regresja pętli,
 * tylko sygnał, że przy nowych liczbach to konkretne otwarcie przestało wygrywać.
 * Wtedy trzeba wyprowadzić nowe otwarcie headlessem, a nie osłabiać asercje.
 */
const WINNING_OPENING: ReadonlyArray<readonly [Pool, BuildingType]> = [
  ['hex1', 'LASER_TURRET'], ['hex1', 'LASER_TURRET'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex1', 'BATTERY'], ['hex1', 'BATTERY'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex2', 'BATTERY'], ['hex2', 'BATTERY'], ['hex2', 'BATTERY'],
  ...times(13, ['hex3', 'BARRICADE'] as const),
  ...times(17, ['hex4', 'BARRICADE'] as const),
  ['hex2', 'EVACUATION_MODULE'],
];

/** [STROJENIE-niezależne] ~1,65× zmierzonej długości zwycięskiego przebiegu (24 133 ticki). */
const WIN_CAP = 40_000;

/**
 * Deliverable całego Taska 5 brzmi: run da się rozegrać OD STARTU DO ZWYCIĘSTWA
 * albo porażki, bez renderera. Trzy testy „pełnego runu" wyżej dowodzą wyłącznie
 * połowy porażkowej — we WSZYSTKICH trzech faza kończy się na `DEFEAT`, a `VICTORY`
 * nie pada w nich ani razu. Ten blok domyka drugą połowę: pełna ścieżka zwycięstwa
 * biegnie przez `Sim.step()`, na domyślnym balansie, przeciw realnie atakującym falom,
 * i z egzekwowaną bramką §5.6 — czyli Evac stanąć może dopiero w cyklu 7.
 */
describe('broniony run dochodzi do ZWYCIĘSTWA', () => {
  it('kolejka zabudowy z odbudową prowadzi run od startu do VICTORY, a dwa jego przebiegi są identyczne co do bitu', () => {
    const a = playPlan(33, WINNING_OPENING, WIN_CAP);
    const core = a.sim.state.planet.startCell;

    expect(a.sim.state.phase).toBe('VICTORY');
    expect(a.ticks).toBeLessThan(WIN_CAP);

    // Bramka §5.6 NAPRAWDĘ działała w trakcie runu, nie tylko w teście jednostkowym:
    // plan prosi o Evac od pierwszego ticka, a moduł staje dopiero po progu.
    // Zmierzone: próg 21 600, Evac postawiony na ticku 22 134.
    expect(a.evacBuiltTick).toBeGreaterThanOrEqual(a.sim.state.evacUnlockTick);
    expect(a.sim.cycle).toBeGreaterThanOrEqual(
      Math.ceil(DEFAULT_RUN.cyclesPerRun * DEFAULT_RUN.evacUnlockFraction),
    );

    // Zwycięstwo WYWALCZONE, nie odczekane w pustce (zmierzone: 5044 zrodzone jednostki,
    // szczyt 481 żywych naraz, 375 wciąż żywych na końcu, 2320 odbudów muru).
    expect(a.sim.state.nextUnitId - 1).toBeGreaterThan(3000);
    expect(a.peakUnits).toBeGreaterThan(200);
    expect(a.sim.state.units.length).toBeGreaterThan(100);
    // Mur był realnie rozbijany i realnie odbudowywany — bez tego „obrona" mogłaby
    // po prostu stać nietknięta i test nie odróżniłby oblężenia od spokoju.
    expect(a.rebuilds).toBeGreaterThan(500);
    // CORE przeżył — to jest warunek zwycięstwa, nie skutek uboczny.
    expect(a.sim.state.buildings[core]).not.toBeNull();
    // Ewakuacja doszła do końca: ładunek pełny, alarm odliczony do zera.
    expect(a.sim.state.evacCharge).toBeGreaterThanOrEqual(DEFAULT_RUN.evacEnergyRequired);
    // `toBeCloseTo(0, 9)`, nie `<= 0`: zwycięstwo pada, gdy licznik zejdzie do zera
    // Z DOKŁADNOŚCIĄ `ALARM_EPSILON` (rules.ts), więc zostaje na nim reszta rzędu 1e-12.
    // Asercja `<= 0` żądałaby dokładnego zera, którego arytmetyka float nie daje.
    expect(a.sim.state.evacAlarmRemaining).toBeCloseTo(0, 9);

    // Determinizm nad przebiegiem, który TRWA i w którym coś się dzieje — 24 tysiące
    // ticków z walką, spalaniem, siedmioma cyklami, wszystkimi trzema typami wroga
    // i przejściem fazy do VICTORY, a nie 1978 ticków zakończonych porażką jak
    // w teście z seedem 102.
    const b = playPlan(33, WINNING_OPENING, WIN_CAP);
    expect(b.ticks).toBe(a.ticks);
    expect(stateHash(b.sim.state)).toBe(stateHash(a.sim.state));
  // Jawny limit czasu: dwa przebiegi po ~24 tysiące ticków przy setkach żywych jednostek
  // zajmują razem ok. 9 s, a domyślne 5 s vitesta dotyczy CAŁEGO testu. Wartość jest
  // z dużym zapasem nad pomiarem i ma łapać zapętlenie, nie wolniejszą maszynę.
  }, 60_000);
});

/**
 * Test wyżej wygrywa na dzisiejszym balansie i jest przez to wrażliwy na przestrojenie
 * `[STROJENIE]` w Fazie 3. Ten sprawdza tę samą ścieżkę — budowa → zasilanie → ładowanie
 * → alarm → VICTORY, całość przez `Sim.step()` — ale skraca run KONFIGURACJĄ, nie
 * osłabieniem asercji: `RunConfig` istnieje właśnie po to, żeby dało się rozegrać krótszy
 * run. `cyclesPerRun: 1` daje próg ewakuacji na ticku 0 (ostatnia tercja runu
 * jednocyklowego zaczyna się w cyklu 1), więc bramka §5.6 jest tu spełniona, a nie
 * obchodzona. Dzięki temu maszyneria warunków końca ma strażnika niezależnego od tego,
 * czy któreś otwarcie akurat wygrywa przy danym stroju liczb.
 */
describe('zwycięstwo jest osiągalne przez samą pętlę, niezależnie od stroju balansu', () => {
  it('zbudowany i zasilony Evac doprowadza run do VICTORY bez ani jednej ingerencji w stan', () => {
    const planet = createPlanet({ seed: 103 });
    const cfg = {
      ...DEFAULT_RUN,
      cyclesPerRun: 1,         // [STROJENIE] run jednocyklowy ⇒ próg ewakuacji na ticku 0
      startingOre: 400,        // [STROJENIE] stać na Evac od razu
      evacEnergyRequired: 100, // [STROJENIE] 1/10 domyślnej — skraca ładowanie do ~10 s
      evacAlarmSeconds: 5,     // [STROJENIE] 1/12 domyślnego — skraca alarm do 100 ticków
    };
    const sim = new Sim(planet, cfg);
    expect(sim.state.evacUnlockTick).toBe(0); // przesłanka testu, nie założenie

    const [target] = planet.cells
      .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell)
      .map((c) => c.id)
      .filter((id) => planet.cells[planet.startCell].neighbors.includes(id));

    sim.enqueue({ kind: 'BUILD', cellId: target, type: 'EVACUATION_MODULE' });

    const CAP = 1500; // ~4,5× zmierzonej długości (zwycięstwo pada ok. ticka 330)
    let ticks = 0;
    let sawUnits = false;
    let sawCharging = false;
    let sawAlarm = false;
    while (sim.state.phase === 'RUNNING' && ticks < CAP) {
      sim.step();
      ticks++;
      if (sim.state.units.length > 0) sawUnits = true;
      if (sim.state.evacCharge > 0 && sim.state.evacCharge < cfg.evacEnergyRequired) sawCharging = true;
      if (sim.state.evacAlarmRemaining > 0) sawAlarm = true;
    }

    expect(ticks).toBeLessThan(CAP);
    // Moduł stanął KOMENDĄ, przez `applyCommand` — nie zapisem do stanu.
    expect(sim.state.buildings[target]).toMatchObject({ type: 'EVACUATION_MODULE', powered: true });
    // Każdy etap ścieżki faktycznie się wydarzył, a nie tylko jej koniec.
    expect(sawCharging).toBe(true);
    expect(sawAlarm).toBe(true);
    expect(sawUnits).toBe(true);
    expect(sim.state.evacAlarmRemaining).toBeCloseTo(0, 9);
    expect(sim.state.phase).toBe('VICTORY');
  });
});
