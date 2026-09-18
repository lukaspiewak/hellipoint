import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { buildAllFlowFields } from '../src/sim/flowfield.js';
import { spawnUnit } from '../src/sim/movement.js';
import { cellsWithinSteps, EMP_RADIUS_STEPS, updateCombat } from '../src/sim/combat.js';
import { BUILDINGS, ENEMIES } from '../src/sim/defs.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 61 });

function withCore() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

/** Pusty heks w zadanej liczbie kroków od komórki startowej. */
function plainHexAt(steps: number): number {
  const found = cellsWithinSteps(withCore(), planet.startCell, steps).find(
    (i) =>
      planet.cells[i].cellType === 'HEXAGON' &&
      planet.cells[i].oreCapacity === 0 &&
      i !== planet.startCell,
  );
  if (found === undefined) throw new Error(`brak pustego heksa w ${steps} krokach`);
  return found;
}

describe('cellsWithinSteps', () => {
  it('zero kroków to sama komórka', () => {
    expect(cellsWithinSteps(withCore(), planet.startCell, 0)).toEqual([planet.startCell]);
  });

  it('jeden krok to komórka plus jej sąsiedzi', () => {
    const got = cellsWithinSteps(withCore(), planet.startCell, 1);
    expect(got).toHaveLength(1 + planet.cells[planet.startCell].neighbors.length);
  });

  it('zwraca komórki posortowane rosnąco — kolejność nie może zależeć od BFS', () => {
    const got = cellsWithinSteps(withCore(), planet.startCell, 3);
    expect([...got].sort((a, b) => a - b)).toEqual(got);
  });
});

describe('walka: jednostki kontra budynki', () => {
  it('jednostka stojąca przed budynkiem zadaje mu ciągły DPS (Q2)', () => {
    const s = withCore();
    const wall = planet.cells[planet.startCell].neighbors[0];
    applyCommand(s, { kind: 'BUILD', cellId: wall, type: 'BARRICADE' });

    const outside = planet.cells[wall].neighbors.find((n) => s.buildings[n] === null)!;
    spawnUnit(s, 'SWARM', outside);

    const fields = buildAllFlowFields(s);
    const before = s.buildings[wall]!.hp;
    updateCombat(s, fields);
    expect(s.buildings[wall]!.hp).toBeCloseTo(before - ENEMIES.SWARM.dps * TICK_SECONDS, 6);
  });

  it('budynek zbity do zera znika z planszy', () => {
    const s = withCore();
    const wall = planet.cells[planet.startCell].neighbors[0];
    applyCommand(s, { kind: 'BUILD', cellId: wall, type: 'BARRICADE' });
    s.buildings[wall]!.hp = 0.01;

    const outside = planet.cells[wall].neighbors.find((n) => s.buildings[n] === null)!;
    spawnUnit(s, 'SWARM', outside);
    updateCombat(s, buildAllFlowFields(s));
    expect(s.buildings[wall]).toBeNull();
  });

  it('DISRUPTOR wyłącza budynki w promieniu EMP zamiast drenować magazyn (Q4)', () => {
    // Granica przypięta DOKŁADNIE, tym samym lekarstwem co test zasięgu wieży.
    // Pierwsza wersja stawiała DISRUPTOR-a NA komórce ofiary — odległość 0, w
    // zasięgu dla DOWOLNEGO promienia ≥ 0 — więc EMP_RADIUS_STEPS nie miał
    // żadnego pokrycia. Zmierzone: EMP_RADIUS_STEPS podmienione na 0 zostawiało
    // całą suitę zieloną. `multiSourceDistances` (niezależny BFS), NIE
    // `cellsWithinSteps` — ta druga jest funkcją badaną, użycie jej tutaj
    // sprawdzałoby ją samą sobą.
    const s = withCore();
    const origin = plainHexAt(1);
    const dist = multiSourceDistances(planet.cells.map((c) => c.neighbors), [origin]);

    const atRadius = planet.cells.findIndex(
      (c) => dist[c.id] === EMP_RADIUS_STEPS && c.cellType === 'HEXAGON' && s.buildings[c.id] === null,
    );
    const beyondRadius = planet.cells.findIndex(
      (c) => dist[c.id] === EMP_RADIUS_STEPS + 1 && c.cellType === 'HEXAGON' && s.buildings[c.id] === null,
    );
    if (atRadius < 0) throw new Error(`brak pustego heksa dokładnie na granicy EMP (${EMP_RADIUS_STEPS} kroków)`);
    if (beyondRadius < 0) {
      throw new Error(`brak pustego heksa krok za granicą EMP (${EMP_RADIUS_STEPS + 1} kroków)`);
    }

    applyCommand(s, { kind: 'BUILD', cellId: atRadius, type: 'SOLAR_PANEL' });
    applyCommand(s, { kind: 'BUILD', cellId: beyondRadius, type: 'SOLAR_PANEL' });
    s.buildings[atRadius]!.powered = true;
    s.buildings[beyondRadius]!.powered = true;
    // Jawna asercja PRZED walką: obie naprawdę zasilone, nie tylko "ustawione" —
    // inaczej "wyłączony po ataku" niczego by nie dowodził.
    expect(s.buildings[atRadius]!.powered).toBe(true);
    expect(s.buildings[beyondRadius]!.powered).toBe(true);

    spawnUnit(s, 'DISRUPTOR', origin);
    updateCombat(s, buildAllFlowFields(s));

    expect(s.buildings[atRadius]!.powered).toBe(false);
    expect(s.buildings[beyondRadius]!.powered).toBe(true);
  });
});

/**
 * Kto uszkodził CORE — przesłanka ekranu przegranej z Zadania 5.
 *
 * Wartość WYCHODZI Z FUNKCJI, a nie ląduje w `SimState`, i to jest rozstrzygnięcie:
 * nic w logice symulacji tego nie czyta, więc w stanie byłaby wielkością, którą migawka
 * Fazy 5 musiałaby serializować, a `stateHash` — pilnować. Ten sam precedens co
 * `Sim.lastPower`. Raport z ticku nie jest stanem.
 */
describe('walka: kto uszkodził CORE', () => {
  it('updateCombat zwraca typ, który w tym ticku uderzył w CORE', () => {
    const s = withCore();
    const outside = planet.cells[planet.startCell].neighbors.find((n) => s.buildings[n] === null)!;
    spawnUnit(s, 'ARMOR', outside);
    expect(updateCombat(s, buildAllFlowFields(s))).toBe('ARMOR');
  });

  it('zwraca null, gdy oberwał INNY budynek niż CORE', () => {
    // Ta sama fikstura, co „jednostka stojąca przed budynkiem zadaje mu ciągły DPS":
    // cel jest tam zmierzony jako barykada, więc tutaj wiadomo, że CORE nie obrywa.
    const s = withCore();
    const wall = planet.cells[planet.startCell].neighbors[0];
    applyCommand(s, { kind: 'BUILD', cellId: wall, type: 'BARRICADE' });
    const outside = planet.cells[wall].neighbors.find((n) => s.buildings[n] === null)!;
    spawnUnit(s, 'SWARM', outside);

    const before = s.buildings[wall]!.hp;
    expect(updateCombat(s, buildAllFlowFields(s))).toBeNull();
    // Kontrola na fiksturę: bez TEGO „null" znaczyłoby „nikt nie atakował", a nie
    // „atakował kogoś innego" — czyli test przechodziłby najgłośniej, gdy nic nie mierzy.
    expect(s.buildings[wall]!.hp).toBeLessThan(before);
  });

  it('zwraca null, gdy na planszy nie ma jednostek', () => {
    expect(updateCombat(withCore(), buildAllFlowFields(withCore()))).toBeNull();
  });
});

describe('walka: wieże kontra jednostki', () => {
  function turretAndUnit(type: 'KINETIC_TURRET' | 'LASER_TURRET', unitSteps: number) {
    const s = withCore();
    const turret = plainHexAt(1);
    applyCommand(s, { kind: 'BUILD', cellId: turret, type });
    s.buildings[turret]!.powered = true;

    const targets = cellsWithinSteps(s, turret, unitSteps).filter(
      (c) => cellsWithinSteps(s, turret, unitSteps - 1).indexOf(c) < 0,
    );
    for (const c of targets.slice(0, 3)) spawnUnit(s, 'SWARM', c);
    return { s, turret };
  }

  it('zasilona wieża zadaje obrażenia jednostce w zasięgu', () => {
    const { s } = turretAndUnit('KINETIC_TURRET', 1);
    const before = s.units[0].hp;
    updateCombat(s, buildAllFlowFields(s));
    expect(s.units[0].hp).toBeLessThan(before);
    // Wielkość przypięta liczbowo, nie tylko kierunek. Bez tego żaden test w tym
    // pliku nie sprawdzał WIELKOŚCI obrażeń wieża→jednostka (tylko kierunek i
    // skutek terminalny „zginęła") — zmierzone: podmiana `def.dps * TICK_SECONDS`
    // na samo `def.dps` (20-60× za mocno) zostawiała całą suitę zieloną.
    // KINETIC_TURRET, nie AOE: jednostka musi PRZEŻYĆ tego ticka, inaczej
    // usunięcie zjada różnicę i znowu nic nie mierzymy.
    expect(s.units[0].hp).toBeCloseTo(before - BUILDINGS.KINETIC_TURRET.dps * TICK_SECONDS, 6);
  });

  it('NIEZASILONA wieża nie strzela — brownout ma realne skutki', () => {
    const { s, turret } = turretAndUnit('KINETIC_TURRET', 1);
    s.buildings[turret]!.powered = false;
    const before = s.units.map((u) => u.hp);
    updateCombat(s, buildAllFlowFields(s));
    expect(s.units.map((u) => u.hp)).toEqual(before);
  });

  it('SINGLE trafia dokładnie jedną jednostkę, AOE trafia wszystkie', () => {
    const single = turretAndUnit('KINETIC_TURRET', 1);
    updateCombat(single.s, buildAllFlowFields(single.s));
    expect(single.s.units.filter((u) => u.hp < ENEMIES.SWARM.hp)).toHaveLength(1);

    const aoe = turretAndUnit('LASER_TURRET', 1);
    updateCombat(aoe.s, buildAllFlowFields(aoe.s));
    expect(aoe.s.units.every((u) => u.hp < ENEMIES.SWARM.hp)).toBe(true);
  });

  it('SINGLE wybiera cel deterministycznie — najniższe id', () => {
    const { s } = turretAndUnit('KINETIC_TURRET', 1);
    updateCombat(s, buildAllFlowFields(s));
    const hit = s.units.filter((u) => u.hp < ENEMIES.SWARM.hp);
    expect(hit[0].id).toBe(Math.min(...s.units.map((u) => u.id)));
  });

  it('wieża nie sięga poza swój zasięg', () => {
    // Granica przypięta DOKŁADNIE: jednostka na `range` kroków (musi zostać trafiona)
    // i, w OSOBNYM stanie, jednostka na `range + 1` kroków (nie może). Osobne stany są
    // konieczne: KINETIC_TURRET celuje SINGLE, więc w jednym stanie z obiema jednostkami
    // wieża zawsze strzela do bliższej (niższe id) i „za granicą" nigdy nie zostałaby
    // nawet sprawdzona, niezależnie od tego, czy realnie jest w zasięgu.
    //
    // Zmierzone na tym seedzie: pierwsza wersja tego testu („dowolna komórka spoza
    // zasięgu", `planet.cells.findIndex` po ID zamiast po odległości) brała komórkę
    // odległą o 24 kroki przy zasięgu 2 — luz 22 kroków, w którym off-by-one
    // w `def.range` (np. `range + 1`) przechodził CAŁYM zielonym zestawem testów bez
    // wyjątku. `multiSourceDistances` (niezależny BFS z Fazy 1A, ten sam wzorzec co
    // `atSteps` w movement.test.ts) liczy odległość NIEZALEŻNIE od `cellsWithinSteps`,
    // więc test nie sprawdza samego siebie.
    const range = BUILDINGS.KINETIC_TURRET.range;

    function turretState() {
      const s = withCore();
      const turret = plainHexAt(1);
      applyCommand(s, { kind: 'BUILD', cellId: turret, type: 'KINETIC_TURRET' });
      s.buildings[turret]!.powered = true;
      const dist = multiSourceDistances(planet.cells.map((c) => c.neighbors), [turret]);
      return { s, dist };
    }

    const near = turretState();
    const atRange = planet.cells.findIndex((c) => near.dist[c.id] === range && near.s.buildings[c.id] === null);
    if (atRange < 0) throw new Error(`brak pustej komórki dokładnie na granicy zasięgu (${range} kroków)`);
    spawnUnit(near.s, 'SWARM', atRange);
    updateCombat(near.s, buildAllFlowFields(near.s));
    expect(near.s.units[0].hp).toBeLessThan(ENEMIES.SWARM.hp);

    const far = turretState();
    const beyondRange = planet.cells.findIndex((c) => far.dist[c.id] === range + 1 && far.s.buildings[c.id] === null);
    if (beyondRange < 0) throw new Error(`brak pustej komórki krok za granicą zasięgu (${range + 1} kroków)`);
    spawnUnit(far.s, 'SWARM', beyondRange);
    updateCombat(far.s, buildAllFlowFields(far.s));
    expect(far.s.units[0].hp).toBe(ENEMIES.SWARM.hp);
  });

  it('zabita jednostka znika i zostawia rudę', () => {
    const { s } = turretAndUnit('LASER_TURRET', 1);
    for (const u of s.units) u.hp = 0.01;
    const oreBefore = s.ore;
    const killed = s.units.length;

    updateCombat(s, buildAllFlowFields(s));
    expect(s.units).toHaveLength(0);
    expect(s.ore).toBeCloseTo(oreBefore + killed * ENEMIES.SWARM.oreReward, 6);
  });

  it('zabita przez wieżę jednostka liczy się w killsByTurret, NIE w killsBySun', () => {
    // Headless (Task 6) tunuje balans na tych dwóch licznikach zamiast na przybliżeniu
    // z liczby jednostek w świetle (zmierzony błąd przybliżenia: 30-38%, patrz
    // doc-comment `killsBySun` w state.ts) — muszą więc realnie rozróżniać źródło zgonu.
    const { s } = turretAndUnit('LASER_TURRET', 1);
    for (const u of s.units) u.hp = 0.01;
    const killed = s.units.length;

    updateCombat(s, buildAllFlowFields(s));
    expect(s.killsByTurret).toBe(killed);
    expect(s.killsBySun).toBe(0);
  });
});
