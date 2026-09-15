import { describe, expect, it } from 'vitest';
import { createPlanet, type Planet } from '../src/world/planet.js';
import { multiSourceDistances } from '../src/world/graph.js';
import { Sim } from '../src/sim/loop.js';
import { currentCycle, DEFAULT_RUN, evacUnlocked } from '../src/sim/rules.js';
import { stateHash } from '../src/sim/hash.js';
import { readFileSync } from 'node:fs';
import { BUILDINGS, ENEMIES } from '../src/sim/defs.js';
import { ORE_PER_SECOND } from '../src/sim/economy.js';
import { lightField, sunDirection } from '../src/sim/light.js';
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

    // OKNO, nie sam limit. Limit dowodzi tylko, że run się kończy — a to za mało:
    // zmierzone, że PRZEPOŁOWIENIE `dps` wszystkich wrogów wydłuża ten run z 487 do 597
    // ticków i cały zestaw nadal przechodzi. Okno przypina TEMPO.
    //
    // Margines 5 % dobrany z pomiaru wrażliwości (mnożnik `dps` → długość runu seeda 101):
    //   ×0,50 → 597 (+22,6 %)   ×0,75 → 529 (+8,6 %)   ×0,90 → 502 (+3,1 %)
    //   ×1,10 → 473 (−2,9 %)    ×1,25 → 455 (−6,6 %)   ×2,00 → 400 (−17,9 %)
    // ŁAPIE: zmiany przesuwające run o więcej niż ~5 %, czyli przestrojenie `dps` o ćwierć
    // i więcej w obie strony. NIE ŁAPIE: zmian rzędu ±10 % `dps`, które ruszają run o ~3 %.
    // Seed 101 wybrany świadomie — jest najczulszy: przy ×0,5…×2,0 runy seedów 102 i 103
    // zmieniają się tylko o ~3 %, bo ich długość wyznacza droga i tempo spawnu, nie obrażenia.
    expect(ticks).toBeGreaterThan(463); // 487 − 5 %
    expect(ticks).toBeLessThan(511);    // 487 + 5 %
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
    // `?? 0` na końcu przepuszczało CORE **usunięty** ze stanu jako „ma mniej hp niż pełne",
    // więc test o odniesionych obrażeniach przechodziłby dla rdzenia, którego nikt nie tknął,
    // a który tylko zniknął. Ten run KOŃCZY SIĘ utratą CORE (zmierzone: 2034 ticki), więc
    // asercja na stanie końcowym nie ma czego badać — obrażenia trzeba zaobserwować
    // W TRAKCIE, na budynku, który wtedy JESZCZE STAŁ.
    let sawDamagedCore = false;
    let minCoreHp = fullHp;
    while (ticks < PASSIVE_CAP && sim.state.phase === 'RUNNING') {
      sim.step();
      ticks++;
      if (sim.state.units.length > 0) sawUnits = true;
      const b = sim.state.buildings[core];
      if (b !== null) {
        if (b.hp < minCoreHp) minCoreHp = b.hp;
        if (b.hp < fullHp) sawDamagedCore = true;
      }
    }

    expect(ticks).toBeLessThan(PASSIVE_CAP);
    expect(sawUnits).toBe(true);
    expect(sawDamagedCore).toBe(true);
    expect(minCoreHp).toBeLessThan(fullHp);
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
 * (global-constraints.md). Dziesięć systemów daje DZIEWIĘĆ sąsiednich ogniw i każde
 * zostało zmierzone osobno — przestawieniem pary w `loop.ts` i porównaniem `stateHash`
 * oraz liczników po pełnym przebiegu 6000 ticków (z ekstraktorem, wieżami, panelami,
 * baterią i murem, żeby dotknąć wszystkich dziesięciu systemów):
 *
 *   • DWA pilnuje KOMPILATOR (TS2448, użycie `light`/`fields` przed deklaracją),
 *   • CZTERY naprawdę KOMUTUJĄ — hash i liczniki identyczne co do bitu,
 *   • TRZY są obserwowalne i dostają po jednej asercji behawioralnej niżej.
 *
 * Żaden test determinizmu tego nie pilnował i pilnować nie może: porównują przebieg
 * SAM ZE SOBĄ, więc są zielone pod każdą stałą permutacją. Pełna tabela dziewięciu
 * ogniw stoi w doc-comment nad `step()` w loop.ts.
 *
 * **Świadomie nie ma tu testów na cztery komutujące ogniwa.** Test behawioralny na
 * zamianę, która niczego nie zmienia, nie może oblać — byłby dziewiątym defektywnym
 * testem tego projektu. Te cztery pilnuje strukturalnie test czytający `loop.ts`,
 * na końcu tego pliku.
 *
 * Uwaga metodologiczna, bo kosztowała jedno podejście: sonda CAŁORUNOWA jest za słabym
 * narzędziem na te ogniwa. Zamiana energia ↔ ekonomia i walka ↔ spalanie dawała w niej
 * hash identyczny co do bitu — oba ogniwa ujawniają się dopiero w scenariuszu celowanym
 * (tick postawienia ekstraktora; jednostka gasnąca dokładnie w tym ticku). Dlatego
 * poniższe testy budują sytuację wprost, zamiast szukać jej w długim przebiegu.
 */
describe('kolejność systemów w step()', () => {
  /**
   * Ogniwo energia → ekonomia. `updateEconomy` czyta flagę `powered`, którą ustawia
   * `updatePower`; ekstraktor postawiony komendą w tym ticku ma `powered: false` prosto
   * z `applyCommand`. Zmierzone: przy poprawnej kolejności wydobywa w ticku budowy
   * 0,05 rudy (ORE_PER_SECOND × TICK_SECONDS), po zamianie — 0,00, bo ekonomia widzi
   * jeszcze niezasilony budynek.
   */
  it('ekstraktor postawiony w tym ticku już w nim wydobywa — ekonomia widzi flagi energii z TEGO ticka', () => {
    const planet = createPlanet({ seed: 7 });
    const fromCore = multiSourceDistances(planet.cells.map((c) => c.neighbors), [planet.startCell]);
    // Złoże w zasięgu sieci CORE (connectionRadius 3), żeby ekstraktor był ZASILONY —
    // bez tego test mierzyłby brak zasilania, a nie kolejność systemów.
    const oreCell = planet.cells
      .filter((c) => fromCore[c.id] >= 1 && fromCore[c.id] <= 3 && c.cellType === 'HEXAGON' && c.oreCapacity > 0)
      .sort((a, b) => fromCore[a.id] - fromCore[b.id] || a.id - b.id)[0];
    expect(oreCell, 'seed bez złoża w zasięgu sieci — test nie miałby czego mierzyć').toBeDefined();

    const sim = new Sim(planet, { ...DEFAULT_RUN, startingOre: 1000 });
    sim.enqueue({ kind: 'BUILD', cellId: oreCell.id, type: 'EXTRACTOR' });
    sim.step();

    expect(sim.state.buildings[oreCell.id]).toMatchObject({ type: 'EXTRACTOR', powered: true });
    const wydobyte = sim.state.ore - (1000 - BUILDINGS.EXTRACTOR.costOre);
    expect(wydobyte).toBeCloseTo(ORE_PER_SECOND * TICK_SECONDS, 9);
    expect(wydobyte).toBeGreaterThan(0);
  });

  /**
   * Ogniwo ruch → walka. `unitsAttackBuildings` czyta `u.cellId`, które `updateMovement`
   * właśnie zaktualizował. Zmierzone na seedzie 3 (cała okolica d ≤ 3 komórki startowej
   * jest CIEMNA na ticku 0 — w świetle jednostka porzuca cel i ucieka, więc ogniwo w ogóle
   * by się nie ujawniło): jednostka wypuszczona 3 kroki od CORE zadaje pierwsze obrażenia
   * na iteracji 36; po zamianie ruchu z walką — na 37, bo atakuje z komórki sprzed kroku.
   */
  it('jednostka atakuje z komórki, do której właśnie weszła — walka widzi ruch z TEGO ticka', () => {
    const planet = createPlanet({ seed: 3 });
    const fromCore = multiSourceDistances(planet.cells.map((c) => c.neighbors), [planet.startCell]);
    const light0 = lightField(planet, sunDirection(0, DEFAULT_RUN.rotationPeriod));
    const core = planet.startCell;

    // Przesłanka testu, nie założenie: jednostka musi startować w ciemności.
    const start = planet.cells
      .filter((c) => fromCore[c.id] === 3 && c.cellType === 'HEXAGON' && light0[c.id] === 0)
      .sort((a, b) => a.id - b.id)[0];
    expect(start, 'brak ciemnej komórki w odległości 3 — jednostka uciekałaby przed światłem').toBeDefined();

    const sim = new Sim(planet, DEFAULT_RUN);
    const fullHp = sim.state.buildings[core]!.hp;
    spawnUnit(sim.state, 'SWARM', start.id);

    let iteracje = 0;
    while (sim.state.buildings[core]?.hp === fullHp && iteracje < 300) {
      sim.step();
      iteracje++;
    }

    expect(sim.state.buildings[core]!.hp).toBeLessThan(fullHp);
    // Dokładna liczba, nie „mniej niż 300": po zamianie ruchu z walką wychodzi 37.
    expect(iteracje).toBe(36);
  });

  /**
   * Ogniwo walka → spalanie. Oba systemy zabijają jednostki; `updateBurning` jawnie
   * polega na tym, że walka zabrała swoich zabitych WCZEŚNIEJ (patrz komentarz
   * o naliczaniu rudy w burning.ts). Konsekwencja obserwowalna: jednostka, której
   * ekspozycja dobiega końca w tym ticku, zdąży jeszcze zadać swój cios.
   * Zmierzone: barykada 150 → 149,5 (SWARM dps 10 × 0,05); po zamianie zostaje 150,0.
   */
  it('jednostka gasnąca od słońca zadaje jeszcze swój ostatni cios — spalanie biegnie PO walce', () => {
    const planet = createPlanet({ seed: 7 });
    const sim = new Sim(planet, DEFAULT_RUN);
    const light0 = lightField(planet, sunDirection(0, DEFAULT_RUN.rotationPeriod));

    // Komórka OŚWIETLONA (inaczej ekspozycja nie rośnie i jednostka nie zginie w tym ticku).
    const cell = planet.cells.find((c) => light0[c.id] > 0.5 && c.cellType === 'HEXAGON');
    expect(cell, 'brak oświetlonego heksa na ticku 0').toBeDefined();

    const fullHp = BUILDINGS.BARRICADE.hp;
    sim.state.buildings[cell!.id] = { cellId: cell!.id, type: 'BARRICADE', hp: fullHp, powered: false };
    spawnUnit(sim.state, 'SWARM', cell!.id);
    // O jeden tick przed progiem: to `+= TICK_SECONDS` w TYM ticku go przekroczy.
    sim.state.units[0].exposure = ENEMIES.SWARM.burnTime - TICK_SECONDS;

    sim.step();

    expect(sim.state.units.length, 'jednostka miała zginąć od słońca w tym ticku').toBe(0);
    expect(sim.state.buildings[cell!.id]!.hp).toBeCloseTo(fullHp - ENEMIES.SWARM.dps * TICK_SECONDS, 9);
    expect(sim.state.buildings[cell!.id]!.hp).toBeLessThan(fullHp);
  });

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

/**
 * Cztery z dziewięciu ogniw kolejności naprawdę KOMUTUJĄ (zmierzone: zamiana daje hash
 * i liczniki identyczne co do bitu przez cały przebieg), więc test behawioralny na nie
 * nie może oblać — a test, który nie może oblać, jest gorszy niż brak testu. Ten test
 * jest jedynym narzędziem, które je przypina: czyta ŹRÓDŁO `loop.ts` i sprawdza, że
 * dziesięć wywołań systemów występuje w kolejności z global-constraints.md.
 *
 * Precedens jest w repozytorium: `contract.test.ts` również czyta pliki źródłowe (tam
 * lekserem TypeScriptu, bo musi odróżnić import od napisu w komentarzu). Tutaj wystarczy
 * pozycja unikalnych wywołań, więc nie ma po co ciągnąć leksera.
 */
describe('kolejność wywołań systemów w źródle step()', () => {
  const KOLEJNOSC = [
    'applyCommand(',        // 1. komendy
    'sunDirection(',        // 2. oświetlenie
    'lightField(',
    'updatePower(',         // 3. energia
    'updateEconomy(',       // 4. ekonomia
    'buildAllFlowFields(',  // 5. pola przepływu
    'updateMovement(',      // 6. ruch
    'updateCombat(',        // 7. walka
    'updateBurning(',       // 8. spalanie
    'updateSpawning(',      // 9. fale i spawn
    'updateRules(',         // 10. warunki końca
  ] as const;

  it('dziesięć systemów stoi w kolejności z global-constraints.md', () => {
    const src = readFileSync(new URL('../src/sim/loop.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('  step(): void {'));
    // Strażnik na własną niepustość: gdyby `step()` przestało się tak nazywać, `slice`
    // dałby cały plik albo pustkę, a asercje niżej „przeszłyby", nic nie sprawdzając.
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain('this.s.tick++;');

    const pozycje = KOLEJNOSC.map((wywolanie) => {
      const i = body.indexOf(wywolanie);
      expect(i, `wywołanie ${wywolanie} zniknęło ze step()`).toBeGreaterThan(-1);
      // Unikalność: dwa wystąpienia znaczyłyby, że system biegnie dwa razy w ticku,
      // a `indexOf` po cichu mierzyłby tylko pierwsze.
      expect(
        body.indexOf(wywolanie, i + 1),
        `wywołanie ${wywolanie} występuje w step() więcej niż raz`,
      ).toBe(-1);
      return { wywolanie, i };
    });

    for (let k = 1; k < pozycje.length; k++) {
      expect(
        pozycje[k].i,
        `${pozycje[k].wywolanie} stoi PRZED ${pozycje[k - 1].wywolanie} — kolejność systemów jest częścią kontraktu determinizmu`,
      ).toBeGreaterThan(pozycje[k - 1].i);
    }
  });
});
