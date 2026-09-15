# Faza 1C — Rozgrywka: jednostki, walka, fale, runner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Domknąć rdzeń do przechodzalnego runu i uruchomić headless runner, który przepuszcza tysiące gier i zwraca rozkłady balansowe.

**Architecture:** Sześć systemów dopinanych do `Sim.step()` z Fazy 1B, w stałej kolejności będącej częścią kontraktu determinizmu. Plus pakiet `tools/headless` ze skryptową polityką gry — **bez niej runner jest bezużyteczny**, bo nikt nie stawia budynków i każdy run kończy się identyczną porażką.

**Tech Stack:** TypeScript (strict), Vitest, pnpm workspaces, Node ≥ 22. Zero zależności runtime w `packages/sim`.

**Spec:** [`docs/superpowers/specs/2026-09-14-project-heliopolis-design.md`](../specs/2026-09-14-project-heliopolis-design.md) — §4.4, §5.3, §5.4, §5.6, §8.3, §8.4.

**Wymaga ukończonej Fazy 1B** ([`2026-09-14-faza-1b-symulacja.md`](2026-09-14-faza-1b-symulacja.md), zadania 1–8).

---

## Global Constraints

Wszystkie ograniczenia Fazy 1B obowiązują dalej. Dodatkowo:

**Kolejność systemów w `step()` jest częścią kontraktu determinizmu** i nie wolno jej zmieniać bez aktualizacji testów:
```
komendy → oświetlenie → energia → ekonomia → pola przepływu →
ruch → walka → spalanie → fale i spawn → warunki końca
```

### Rozstrzygnięcia pytań otwartych ze specu

Trzy pytania (§11) musiały zapaść, żeby te zadania dało się rozpisać. Każde jest **założeniem do zweryfikowania headlessem w Fazie 3**, nie decyzją ostateczną — ale jest jawne i zapisane, a nie ukryte w kodzie.

| # | Pytanie | Rozstrzygnięcie | Uzasadnienie |
|---|---|---|---|
| **Q2** | Kadencja ataku wroga | **Ciągły DPS**: `dps × TICK_SECONDS` co tick, bez licznika zamachów | Przy 20 Hz nieodróżnialne od szybkich zamachów, a oszczędza stan na jednostkę — czyli mniej do serializowania w Fazie 5. Zamachy dyskretne dokładamy dopiero, gdy okażą się potrzebne dla czytelności wizualnej |
| **Q3** | Pobór energii przez wieże | **Stały**, niezależny od strzelania | Pobór zależny od strzelania czyni sieć energetyczną nieistotną w spokojnych chwilach i wywraca ją dopiero w środku ataku, kiedy gracz nie ma już czym zareagować. Stały pobór czyni z rozbudowy obrony realną decyzję energetyczną — a to jest sens tego systemu. **Już zaimplementowane** w `power.ts` (Faza 1B Task 6) |
| **Q4** | Efekt EMP Disruptora | **Wyłączenie budynków** w promieniu na czas trwania (`powered = false`), nie drenaż magazynu | Drenaż jest dla gracza niewidoczny — liczba w pasku spada i nic tego nie tłumaczy. Wyłączenie robi widoczną dziurę w obronie, którą fala natychmiast wykorzystuje, więc gracz rozumie, co się właśnie stało i dlaczego |

Po ukończeniu tej fazy: **zaktualizować §11 specu**, przenosząc Q2, Q3 i Q4 z „otwarte" do rozstrzygniętych, z powyższym uzasadnieniem.

---

### Task 1: Ruch jednostek po sferze i ucieczka ze światła

**Files:**
- Create: `packages/sim/src/sim/movement.ts`
- Test: `packages/sim/test/movement.test.ts`

**Interfaces:**
- Consumes: `SimState`, `Unit`, `FlowField`, `ENEMIES`, `TICK_SECONDS`, algebra Vec3, `terminatorSpeedCells`, `cellSpacing`
- Produces:
  - `interface MotionContext { termSpeedCells: number; spacing: number; radius: number }`
  - `function spawnUnit(s: SimState, type: EnemyType, cellId: number): void`
  - `function updateMovement(s: SimState, fields: Record<EnemyType, FlowField>, light: Float32Array, sunDir: Vec3, ctx: MotionContext): void`

Jedna funkcja odpowiada za **cały** ruch, łącznie z ucieczką ze światła — jednostka w oświetlonej komórce porzuca pole przepływu i biegnie wzdłuż wielkiego okręgu **oddalającego ją od słońca**, czyli najkrótszą drogą do cienia. Draft kazał uciekać „do najbliższego pentagonu", co mogło prowadzić głębiej w światło.

Przynależność do komórki aktualizowana **lokalnie** — sprawdzana wyłącznie wśród bieżącej komórki i jej sąsiadów. O(7) zamiast O(1442) na jednostkę na tick.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/movement.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { buildAllFlowFields } from '../src/sim/flowfield.js';
import { spawnUnit, updateMovement, type MotionContext } from '../src/sim/movement.js';
import { cellSpacing, terminatorSpeedCells } from '../src/world/scale.js';
import { BUILDINGS, ENEMIES } from '../src/sim/defs.js';
import { length, scale, sub, normalize, dot } from '../src/math/vec3.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 51 });
const N = planet.cells.length;
const T = 180;

const ctx: MotionContext = {
  termSpeedCells: terminatorSpeedCells(N, T),
  spacing: cellSpacing(planet.radius, N),
  radius: planet.radius,
};

const dark = new Float32Array(N).fill(0);
const sunDir = { x: 1, y: 0, z: 0 };

function withCore() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

/** Komórka oddalona o dokładnie `steps` kroków od komórki startowej. */
function atSteps(steps: number): number {
  const d = multiSourceDistances(planet.cells.map((c) => c.neighbors), [planet.startCell]);
  const hit = d.findIndex((v) => v === steps);
  if (hit < 0) throw new Error(`brak komórki w odległości ${steps}`);
  return hit;
}

describe('spawnUnit', () => {
  it('stawia jednostkę na środku komórki z pełnym HP i zerową ekspozycją', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 42);
    expect(s.units).toHaveLength(1);
    expect(s.units[0]).toMatchObject({ type: 'SWARM', cellId: 42, hp: ENEMIES.SWARM.hp, exposure: 0 });
    expect(s.units[0].pos).toEqual(planet.cells[42].center);
  });

  it('nadaje kolejne, rosnące identyfikatory', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 42);
    spawnUnit(s, 'ARMOR', 43);
    expect(s.units.map((u) => u.id)).toEqual([1, 2]);
  });
});

describe('updateMovement', () => {
  it('utrzymuje jednostki dokładnie na powierzchni planety', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', atSteps(6));
    const fields = buildAllFlowFields(s);
    for (let i = 0; i < 200; i++) updateMovement(s, fields, dark, sunDir, ctx);
    expect(length(s.units[0].pos)).toBeCloseTo(planet.radius, 6);
  });

  it('cellId zmienia się wyłącznie na komórkę sąsiednią', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', atSteps(8));
    const fields = buildAllFlowFields(s);
    let prev = s.units[0].cellId;
    for (let i = 0; i < 400 && s.units.length > 0; i++) {
      updateMovement(s, fields, dark, sunDir, ctx);
      const cur = s.units[0].cellId;
      if (cur !== prev) {
        expect(planet.cells[prev].neighbors).toContain(cur);
        prev = cur;
      }
    }
  });

  it('jednostka dociera do celu w skończonym czasie', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', atSteps(8));
    const fields = buildAllFlowFields(s);
    let reached = false;
    for (let i = 0; i < 3000 && !reached; i++) {
      updateMovement(s, fields, dark, sunDir, ctx);
      const next = fields.SWARM.next[s.units[0].cellId];
      if (next === planet.startCell || s.units[0].cellId === planet.startCell) reached = true;
    }
    expect(reached).toBe(true);
  });

  it('prędkość wynika ze speedFactor razy prędkość terminatora (§6.2)', () => {
    const s = withCore();
    const from = atSteps(8);
    spawnUnit(s, 'ARMOR', from);
    const fields = buildAllFlowFields(s);

    const start = s.units[0].pos;
    const ticks = 100;
    for (let i = 0; i < ticks; i++) updateMovement(s, fields, dark, sunDir, ctx);

    const travelled = arcLength(start, s.units[0].pos, planet.radius);
    const expected = ENEMIES.ARMOR.speedFactor * ctx.termSpeedCells * ctx.spacing * ticks * TICK_SECONDS;
    expect(travelled).toBeCloseTo(expected, 1);
  });

  it('zatrzymuje się przed zabudowaną komórką zamiast przez nią przechodzić', () => {
    const s = withCore();
    const ring = planet.cells[planet.startCell].neighbors;
    for (const n of ring) applyCommand(s, { kind: 'BUILD', cellId: n, type: 'BARRICADE' });

    const outside = atSteps(3);
    spawnUnit(s, 'SWARM', outside);
    const fields = buildAllFlowFields(s);
    for (let i = 0; i < 2000; i++) updateMovement(s, fields, dark, sunDir, ctx);

    // Nie może wejść do środka pierścienia bez rozbicia barykady.
    expect(s.units[0].cellId).not.toBe(planet.startCell);
  });

  it('jednostka w świetle ucieka OD słońca, nie do celu', () => {
    const s = withCore();
    // Wybierz komórkę mocno oświetloną i postaw tam jednostkę.
    let lit = 0;
    for (let i = 0; i < N; i++) {
      if (dot(planet.cells[i].normal, sunDir) > 0.8) { lit = i; break; }
    }
    spawnUnit(s, 'SWARM', lit);

    const light = new Float32Array(N);
    for (let i = 0; i < N; i++) light[i] = Math.max(0, dot(planet.cells[i].normal, sunDir));

    const fields = buildAllFlowFields(s);
    const before = dot(normalize(s.units[0].pos), sunDir);
    for (let i = 0; i < 300; i++) updateMovement(s, fields, light, sunDir, ctx);
    const after = dot(normalize(s.units[0].pos), sunDir);

    expect(after).toBeLessThan(before); // oddaliła się od punktu podsłonecznego

    // Asercja NOŚNA. Sam kierunek nie wystarcza: zmierzona ablacja (gałąź ucieczki
    // wycięta, jednostka tylko podąża polem przepływu) też oddala się od słońca dla
    // tego seeda — o 0,034 zamiast 0,294, bo CORE leży akurat w stronę nieco ciemniejszą.
    // Kierunkowy test przechodziłby więc z USUNIĘTĄ funkcją, którą nazywa.
    // Dotarcie do cienia rozróżnia absolutnie: ucieczka osiąga światło dokładnie 0
    // po 222 tickach, a ablacja siada na CORE i zostaje na 0,4973 również po 600.
    // 300 ticków to 222 plus zapas.
    expect(light[s.units[0].cellId]).toBe(0);
  });

  it('jest deterministyczny', () => {
    const run = () => {
      const s = withCore();
      spawnUnit(s, 'SWARM', atSteps(7));
      spawnUnit(s, 'ARMOR', atSteps(8));
      const fields = buildAllFlowFields(s);
      for (let i = 0; i < 300; i++) updateMovement(s, fields, dark, sunDir, ctx);
      return s.units.map((u) => [u.cellId, u.pos.x, u.pos.y, u.pos.z]);
    };
    expect(run()).toEqual(run());
  });
});

function arcLength(a: { x: number; y: number; z: number }, b: typeof a, radius: number): number {
  const ua = scale(a, 1 / radius);
  const ub = scale(b, 1 / radius);
  void sub;
  return radius * Math.acos(Math.min(1, Math.max(-1, dot(ua, ub))));
}
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/movement.test.ts`
Oczekiwane: FAIL — brak modułu `movement.js`.

- [ ] **Step 3: Zaimplementuj ruch**

`packages/sim/src/sim/movement.ts`:
```ts
import { add, dot, normalize, scale, type Vec3 } from '../math/vec3.js';
import { ENEMIES } from './defs.js';
import type { FlowField } from './flowfield.js';
import { TICK_SECONDS, type EnemyType, type SimState } from './state.js';

export interface MotionContext {
  /** Prędkość terminatora w krokach grafu na sekundę — baza dla speedFactor. */
  termSpeedCells: number;
  /** Odstęp środków sąsiednich komórek w jednostkach świata. */
  spacing: number;
  radius: number;
}

export function spawnUnit(s: SimState, type: EnemyType, cellId: number): void {
  s.units.push({
    id: s.nextUnitId++,
    type,
    cellId,
    pos: s.planet.cells[cellId].center,
    hp: ENEMIES[type].hp,
    exposure: 0,
  });
}

export function updateMovement(
  s: SimState,
  fields: Record<EnemyType, FlowField>,
  light: Float32Array,
  sunDir: Vec3,
  ctx: MotionContext,
): void {
  const cells = s.planet.cells;

  for (const u of s.units) {
    const def = ENEMIES[u.type];
    const speedWorld = def.speedFactor * ctx.termSpeedCells * ctx.spacing;
    const angleStep = (speedWorld * TICK_SECONDS) / ctx.radius;

    let targetDir: Vec3;

    if (light[u.cellId] > 0) {
      // W świetle jednostka porzuca cel i biegnie najkrótszą drogą do cienia,
      // czyli wzdłuż wielkiego okręgu ku punktowi antypodycznemu do słońca (§4.4).
      targetDir = scale(sunDir, -1);
    } else {
      const next = fields[u.type].next[u.cellId];
      // Brak celu, albo następna komórka jest zabudowana — stoimy.
      // Zabudowa nie jest przeszkodą absolutną: zajmie się nią walka (Task 2).
      if (next < 0 || s.buildings[next] !== null) continue;
      targetDir = cells[next].normal;
    }

    const from = scale(u.pos, 1 / ctx.radius);
    const moved = slerpToward(from, targetDir, angleStep);
    u.pos = scale(moved, ctx.radius);
    u.cellId = nearestLocalCell(s, u.cellId, moved);
  }
}

/** Obrót `from` ku `to` wzdłuż wielkiego okręgu o zadany kąt. Oba argumenty jednostkowe. */
function slerpToward(from: Vec3, to: Vec3, angle: number): Vec3 {
  const cosTheta = Math.min(1, Math.max(-1, dot(from, to)));
  const theta = Math.acos(cosTheta);
  if (theta <= angle || theta < 1e-9) return to;

  const t = angle / theta;
  const sinTheta = Math.sin(theta);
  const a = Math.sin((1 - t) * theta) / sinTheta;
  const b = Math.sin(t * theta) / sinTheta;
  return normalize(add(scale(from, a), scale(to, b)));
}

/**
 * Przypisanie do komórki sprawdzane tylko wśród bieżącej i jej sąsiadów.
 * Jednostka nigdy nie pokonuje w jednym ticku więcej niż ułamek komórki,
 * więc pełne przeszukanie 1442 komórek byłoby czystą stratą.
 */
function nearestLocalCell(s: SimState, currentId: number, unitDir: Vec3): number {
  const cells = s.planet.cells;
  let best = currentId;
  let bestDot = dot(cells[currentId].normal, unitDir);

  for (const n of cells[currentId].neighbors) {
    const d = dot(cells[n].normal, unitDir);
    // Ścisła nierówność plus porównanie indeksów — remis nie może zależeć
    // od kolejności sąsiadów w tablicy (§7.2).
    if (d > bestDot || (d === bestDot && n < best)) {
      bestDot = d;
      best = n;
    }
  }

  return best;
}
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/movement.test.ts`
Oczekiwane: **9 testów przechodzi.**

```bash
git add packages/sim/src/sim/movement.ts packages/sim/test/movement.test.ts
git commit -m "feat(sim): ruch jednostek po wielkim okręgu z ucieczką ze światła i lokalnym przypisaniem komórki"
```

---

### Task 2: Walka — jednostki, wieże i EMP

**Files:**
- Create: `packages/sim/src/sim/combat.ts`
- Test: `packages/sim/test/combat.test.ts`

**Interfaces:**
- Consumes: `SimState`, `FlowField`, `BUILDINGS`, `ENEMIES`, `TICK_SECONDS`
- Produces:
  - `function cellsWithinSteps(s: SimState, origin: number, steps: number): number[]`
  - `function updateCombat(s: SimState, fields: Record<EnemyType, FlowField>): void`

Realizacja **Q2** (ciągły DPS) i **Q4** (EMP wyłącza budynki). Wybór celu przez wieżę `SINGLE` jest deterministyczny — najniższe `id` w zasięgu, nigdy „pierwszy napotkany w tablicy".

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/combat.test.ts`:
```ts
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
    // Pierwsza wersja stawiała DISRUPTOR-a NA komórce ofiary — odległość 0, czyli
    // w zasięgu dla DOWOLNEGO promienia ≥ 0 — więc EMP_RADIUS_STEPS nie miał żadnego
    // pokrycia. Zmierzone: EMP_RADIUS_STEPS podmienione na 0 zostawiało całą suitę
    // zieloną. Odległość liczy `multiSourceDistances` (niezależny BFS), NIE
    // `cellsWithinSteps` — ta druga jest funkcją badaną i test sprawdzałby ją samą sobą.
    //
    // Test WIĄŻE SIĘ ZE STAŁĄ, nie z jej dzisiejszym literałem, i tak ma być:
    // EMP_RADIUS_STEPS jest oznaczone [STROJENIE], więc Faza 3 będzie je przestrajać
    // headlessem. Test pinujący literał 2 oblewałby przy każdym legalnym przestrojeniu
    // i szybko stałby się szumem. Właściwą regresją jest off-by-one w KODZIE — i ta
    // jest łapana w obie strony: zmierzone, `EMP_RADIUS_STEPS ± 1` w wywołaniu
    // `cellsWithinSteps` oblewa ten test w izolacji, każdy kierunek osobno.
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
    // na samo `def.dps` (20-60× za mocno) zostawiała całą suitę zieloną, mimo że
    // bliźniacza mutacja po stronie jednostka→budynek jest łapana.
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
    // ODLEGŁOŚĆ LICZY `multiSourceDistances`, NIE `cellsWithinSteps`. Pierwsza wersja tego
    // testu wyznaczała „poza zasięgiem" przez `cellsWithinSteps`, czyli sprawdzała funkcję
    // SAMĄ SOBĄ: off-by-one przesuwałby zbiór razem z testem i nic by nie oblało. Zmierzone
    // na seedzie 61: brała komórkę odległą o 24 kroki przy zasięgu 2 — luz 22 kroków, w którym
    // wstrzyknięty `def.range + 1` przechodził CAŁĄ suitą bez śladu.
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
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/combat.test.ts`
Oczekiwane: FAIL — brak modułu `combat.js`.

- [ ] **Step 3: Zaimplementuj walkę**

`packages/sim/src/sim/combat.ts`:
```ts
import { BUILDINGS, ENEMIES } from './defs.js';
import type { FlowField } from './flowfield.js';
import { TICK_SECONDS, type EnemyType, type SimState } from './state.js';

/** [STROJENIE] Promień EMP Disruptora w krokach grafu (N1). */
export const EMP_RADIUS_STEPS = 2;

/** Komórki w promieniu `steps` kroków grafu, łącznie z origin. Zawsze posortowane rosnąco. */
export function cellsWithinSteps(s: SimState, origin: number, steps: number): number[] {
  const cells = s.planet.cells;
  const seen = new Set<number>([origin]);
  let ring = [origin];

  for (let i = 0; i < steps; i++) {
    const next: number[] = [];
    for (const c of ring) {
      for (const n of cells[c].neighbors) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    ring = next;
  }

  // Sortowanie numeryczne: kolejność wyniku nie może zależeć od przebiegu BFS (§7.2).
  return [...seen].sort((a, b) => a - b);
}

export function updateCombat(s: SimState, fields: Record<EnemyType, FlowField>): void {
  unitsAttackBuildings(s, fields);
  turretsAttackUnits(s);
  removeDeadUnits(s);
  removeDeadBuildings(s);
}

/**
 * Q2: obrażenia ciągłe, bez licznika zamachów.
 * Jednostka atakuje budynek w swojej komórce, a jeśli go nie ma — ten,
 * który blokuje jej następny krok.
 */
function unitsAttackBuildings(s: SimState, fields: Record<EnemyType, FlowField>): void {
  for (const u of s.units) {
    if (u.hp <= 0) continue;

    const here = s.buildings[u.cellId];
    const nextId = fields[u.type].next[u.cellId];
    const ahead = nextId >= 0 ? s.buildings[nextId] : null;
    const target = here ?? ahead;
    if (target === null) continue;

    target.hp -= ENEMIES[u.type].dps * TICK_SECONDS;

    // Q4: EMP wyłącza budynki w promieniu, zamiast drenować magazyn.
    // Wyłączenie jest dla gracza widoczne — robi dziurę w obronie, którą fala wykorzystuje.
    if (u.type === 'DISRUPTOR') {
      for (const c of cellsWithinSteps(s, u.cellId, EMP_RADIUS_STEPS)) {
        const b = s.buildings[c];
        if (b !== null) b.powered = false;
      }
    }
  }
}

function turretsAttackUnits(s: SimState): void {
  // Indeks jednostek po komórkach — budowany raz na tick, nie raz na wieżę.
  const byCell = new Map<number, number[]>();
  for (let i = 0; i < s.units.length; i++) {
    const u = s.units[i];
    if (u.hp <= 0) continue;
    const bucket = byCell.get(u.cellId);
    if (bucket === undefined) byCell.set(u.cellId, [i]);
    else bucket.push(i);
  }

  for (let cellId = 0; cellId < s.buildings.length; cellId++) {
    const b = s.buildings[cellId];
    if (b === null || !b.powered) continue;

    const def = BUILDINGS[b.type];
    if (def.range <= 0 || def.dps <= 0) continue;

    const inRange: number[] = [];
    for (const c of cellsWithinSteps(s, cellId, def.range)) {
      const bucket = byCell.get(c);
      if (bucket !== undefined) inRange.push(...bucket);
    }
    if (inRange.length === 0) continue;

    const damage = def.dps * TICK_SECONDS;

    if (def.targeting === 'AOE') {
      for (const i of inRange) s.units[i].hp -= damage;
    } else {
      // Najniższe id — wybór celu nie może zależeć od kolejności w tablicy jednostek.
      let best = inRange[0];
      for (const i of inRange) {
        if (s.units[i].id < s.units[best].id) best = i;
      }
      s.units[best].hp -= damage;
    }
  }
}

function removeDeadUnits(s: SimState): void {
  if (!s.units.some((u) => u.hp <= 0)) return;
  const survivors = [];
  for (const u of s.units) {
    if (u.hp > 0) survivors.push(u);
    else s.ore += ENEMIES[u.type].oreReward;
  }
  s.units = survivors;
}

function removeDeadBuildings(s: SimState): void {
  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b !== null && b.hp <= 0) s.buildings[i] = null;
  }
}
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/combat.test.ts`
Oczekiwane: **12 testów przechodzi.**

```bash
git add packages/sim/src/sim/combat.ts packages/sim/test/combat.test.ts
git commit -m "feat(sim): walka z ciągłym DPS (Q2) i EMP wyłączającym budynki (Q4)"
```

---

### Task 3: Spalanie w świetle — niezmiennik N3 na żywej symulacji

**Files:**
- Create: `packages/sim/src/sim/burning.ts`
- Test: `packages/sim/test/burning.test.ts`

**Interfaces:**
- Consumes: `SimState`, `ENEMIES`, `TICK_SECONDS`
- Produces:
  - `const SHADOW_RECOVERY_RATE = 0.5` — `[STROJENIE]`
  - `function updateBurning(s: SimState, light: Float32Array): void`

Faza 1A dowiodła niezmiennika N3 **na wzorze**. Ten task dowodzi go **na żywej symulacji**: jednostka o `speedFactor < 1` (ARMOR) postawiona w świetle ginie zawsze, niezależnie od tego, jak płytko weszła — bo nie jest w stanie prześcignąć terminatora.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/burning.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { buildAllFlowFields } from '../src/sim/flowfield.js';
import { spawnUnit, updateMovement, type MotionContext } from '../src/sim/movement.js';
import { SHADOW_RECOVERY_RATE, updateBurning } from '../src/sim/burning.js';
import { lightField, sunDirection } from '../src/sim/light.js';
import { cellSpacing, terminatorSpeedCells } from '../src/world/scale.js';
import { BUILDINGS, ENEMIES } from '../src/sim/defs.js';
import { dot, normalize } from '../src/math/vec3.js';

const planet = createPlanet({ seed: 71 });
const N = planet.cells.length;
const T = 180;

const ctx: MotionContext = {
  termSpeedCells: terminatorSpeedCells(N, T),
  spacing: cellSpacing(planet.radius, N),
  radius: planet.radius,
};

const fullLight = new Float32Array(N).fill(1);
const noLight = new Float32Array(N).fill(0);

function withCore() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

describe('updateBurning', () => {
  it('ekspozycja rośnie w świetle', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    updateBurning(s, fullLight);
    expect(s.units[0].exposure).toBeCloseTo(TICK_SECONDS, 9);
  });

  it('w cieniu ekspozycja nie rośnie i jednostka nie ginie nigdy', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    for (let i = 0; i < 10_000; i++) updateBurning(s, noLight);
    expect(s.units).toHaveLength(1);
    expect(s.units[0].exposure).toBe(0);
  });

  it('jednostka w pełnym świetle ginie po dokładnie burnTime sekund', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    const ticks = Math.ceil(ENEMIES.SWARM.burnTime / TICK_SECONDS);

    for (let i = 0; i < ticks - 1; i++) updateBurning(s, fullLight);
    expect(s.units).toHaveLength(1);

    updateBurning(s, fullLight);
    expect(s.units).toHaveLength(0);
  });

  it('spalona jednostka zostawia rudę (§3 specu — świt to żniwa)', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    const before = s.ore;
    for (let i = 0; i < 1000 && s.units.length > 0; i++) updateBurning(s, fullLight);
    expect(s.ore).toBeCloseTo(before + ENEMIES.SWARM.oreReward, 6);
  });

  it('nalicza rudę wyłącznie za jednostki, które SAMO zabiło — nie za już martwe z zewnątrz', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10); // umrze OD SPALANIA w tym samym wywołaniu
    spawnUnit(s, 'ARMOR', 11); // "obcy trup": hp=0 z zewnątrz (np. walka), NIE od spalania
    s.units[0].exposure = ENEMIES.SWARM.burnTime; // += TICK_SECONDS w środku przebije próg
    s.units[1].hp = 0;
    // ARMOR w pełnym świetle też nabija ekspozycję w tym wywołaniu (0 → 0,05),
    // ale burnTime=8 jest o wiele rzędów wielkości dalej — jego WŁASNA gałąź
    // śmierci nie odpala się w ogóle, więc jedyne źródło jego hp<=0 jest
    // zewnętrzne, tak jak ma być w tym scenariuszu.
    const before = s.ore;

    updateBurning(s, fullLight);

    expect(s.units).toHaveLength(0); // obie usunięte — jedna umarła tu, druga była już martwa
    // TYLKO nagroda SWARM-a (2), NIGDY nagroda ARMOR-a (10) za trupa, którego
    // spalanie nie zabiło. Sprzed poprawki: before+12 (2+10, zamiatacz naliczał
    // za KAŻDĄ jednostkę z hp<=0, patrz task-3-fix-report.md, runda 2).
    expect(s.ore).toBeCloseTo(before + ENEMIES.SWARM.oreReward, 6);
  });

  it('powrót do cienia regeneruje ekspozycję', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    for (let i = 0; i < 20; i++) updateBurning(s, fullLight);
    const peak = s.units[0].exposure;

    for (let i = 0; i < 10; i++) updateBurning(s, noLight);
    // Math.max(0, …) po obu stronach: kod klamruje w miejscu, więc oczekiwanie
    // musi klamrować tak samo, inaczej test pęka przy legalnym przestrojeniu
    // SHADOW_RECOVERY_RATE [STROJENIE] (Faza 3), nie przy regresji w kodzie —
    // zmierzone: przy rate ≥ 2,0 (4× dzisiejszej wartości) `peak - 10*TICK*rate`
    // sam wychodzi ujemny, mimo że kod poprawnie stoi na zerze.
    expect(s.units[0].exposure).toBeCloseTo(
      Math.max(0, peak - 10 * TICK_SECONDS * SHADOW_RECOVERY_RATE),
      6,
    );
  });

  it('regeneracja nie schodzi poniżej zera', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    // Ekspozycja startowa MNIEJSZA niż jeden krok regeneracji
    // (TICK_SECONDS * SHADOW_RECOVERY_RATE) — połowa jednego kroku, liczona ZE
    // STAŁEJ, nie z literału (SHADOW_RECOVERY_RATE jest [STROJENIE], test ma
    // zostać poprawny przy każdej dodatniej wartości). Bez tego jeden tick
    // regeneracji nigdy nie przestrzeliwuje zera z tego konkretnego stanu:
    // `spawnUnit` daje exposure=0, a `else if (u.exposure > 0)` w ogóle nie
    // wchodzi w gałąź regeneracji przy zerze — `Math.max(0, …)`, jedyna rzecz,
    // którą ten test nazywa, nigdy nie była osiągana (zmierzone mutacją:
    // usunięcie samego Math.max przy tym samym starcie od zera zostawiało
    // całą suitę zieloną).
    s.units[0].exposure = (TICK_SECONDS * SHADOW_RECOVERY_RATE) / 2;
    updateBurning(s, noLight);
    expect(s.units[0].exposure).toBe(0);
  });

  it('ARMOR (speedFactor < 1) postawiony w świetle GINIE — niezmiennik N3 na żywo', () => {
    // Pełna pętla: ruch (z ucieczką) + spalanie, przy prawdziwym, ruchomym terminatorze.
    const s = withCore();

    // Jednostka tuż za linią terminatora, czyli najpłycej jak się da.
    const sun0 = sunDirection(0, T);
    let shallow = -1;
    let bestDot = Infinity;
    for (let i = 0; i < N; i++) {
      const d = dot(planet.cells[i].normal, sun0);
      if (d > 0 && d < bestDot) { bestDot = d; shallow = i; }
    }
    spawnUnit(s, 'ARMOR', shallow);
    const fields = buildAllFlowFields(s);

    // Samo "umarła w ogóle" (jedyna asercja tego testu w Rundzie 1) NIE dowodzi
    // PRZYCZYNY: zmierzone (Runda 2) — jednostka ZAMROŻONA (bez wołania w ogóle
    // updateMovement) ginie na ticku 160, realnie uciekająca na 165. `toHaveLength(0)`
    // przechodzi identycznie w obu przypadkach; nie odróżnia "zginęła, bo nie
    // mogła uciec" od "zginęła, bo nikt nawet nie próbował". Śledzimy więc
    // pozycję i wyrównanie ze słońcem, żeby to rozdzielić.
    const startPos = s.units[0].pos;
    let lastPos = startPos;
    let prevAlign = dot(normalize(startPos), sun0);
    let everRetreated = false;
    let deathTick = -1;

    const maxTicks = 250;
    for (let t = 0; t < maxTicks && s.units.length > 0; t++) {
      const sun = sunDirection(t * TICK_SECONDS, T);
      const light = lightField(planet, sun);
      updateMovement(s, fields, light, sun, ctx);
      updateBurning(s, light);

      if (s.units.length > 0) {
        lastPos = s.units[0].pos;
        // Malejące wyrównanie z BIEŻĄCYM słońcem = realnie oddala się od punktu
        // podsłonecznego. Punkt, który się NIE rusza, w tym miejscu planety i w
        // tym oknie czasu tylko coraz bardziej się oświetla wraz z obrotem
        // terminatora (zmierzone: zamrożona jednostka ma `align` rosnące, nigdy
        // malejące) — więc samo `align` w dowolną stronę nie dowodzi niczego,
        // TYLKO spadek dowodzi ruchu przeciw temu naturalnemu wzrostowi.
        const align = dot(normalize(lastPos), sun);
        if (align < prevAlign) everRetreated = true;
        prevAlign = align;
      } else {
        deathTick = t + 1;
      }
    }

    expect(s.units).toHaveLength(0);

    // (1) Treść niezmiennika N3 dla v < v_term, wyrażona liczbą, nie tylko
    // "umarła kiedyś w rozsądnym czasie": ucieczka kupuje ARMOR-owi PRAWIE NIC.
    // Zmierzone: zamrożona ginie dokładnie na ARMOR_BURN_TICKS (czysty budżet
    // spalania w miejscu, 160 = burnTime/TICK_SECONDS), realna z ucieczką na 165
    // — zysk to 5 ticków. Okno [ARMOR_BURN_TICKS, ARMOR_BURN_TICKS + 15] przypina
    // to z marginesem 3× zmierzonego zysku (nie z budżetu pętli 250, który
    // dopuszczał zysk do 90 ticków i przepuszczał 2×-wolniejsze spalanie —
    // Runda 1 tego zadania). Dolna granica jest fizycznym dołem: ekspozycja
    // rośnie najwyżej o TICK_SECONDS na tick, więc szybciej niż w miejscu umrzeć
    // się nie da, niezależnie od ruchu.
    //
    // ZAKRES WAŻNOŚCI OKNA, zmierzony przemiataniem [STROJENIE] speedFactor ARMOR-a:
    //   0,85 → 165   0,90 → 172   0,95 → 274   1,00 → 352   1,05 → przeżywa budżet
    // Margines 15 pokrywa 0,85 i 0,90. Przy 0,95 tick śmierci wyskakuje na 274 i ten
    // test oblewa — NIE z powodu regresji, tylko dlatego, że im bliżej v_term, tym
    // więcej ucieczka realnie kupuje, czyli zmienia się sama wielkość, którą mierzymy.
    // Jeśli Faza 3 przestroi ARMOR-a powyżej ~0,9, przelicz margines z nowego pomiaru
    // zamiast go poszerzać na oko: szerokie okno to dokładnie ten defekt, który Runda 1
    // tego zadania usuwała (budżet 250 dopuszczał zysk 90 ticków i przepuszczał
    // 2×-wolniejsze spalanie). Powyżej 1,0 jednostka przestaje ginąć i właściwym
    // testem staje się ten dla SWARM-a, nie ten.
    const ARMOR_BURN_TICKS = Math.ceil(ENEMIES.ARMOR.burnTime / TICK_SECONDS);
    expect(deathTick).toBeGreaterThanOrEqual(ARMOR_BURN_TICKS);
    expect(deathTick).toBeLessThanOrEqual(ARMOR_BURN_TICKS + 15);

    // (2) Naprawdę PRÓBOWAŁA uciekać, a nie zamarzła: pozycja zmieniła się
    // względem startu, i przez część runu realnie oddalała się od punktu
    // podsłonecznego (patrz komentarz przy `align` wyżej).
    expect(dot(normalize(lastPos), normalize(startPos))).toBeLessThan(1 - 1e-9);
    expect(everRetreated).toBe(true);
  });

  it('SWARM (speedFactor > 1) z tej samej pozycji UCIEKA', () => {
    const s = withCore();
    const sun0 = sunDirection(0, T);
    let shallow = -1;
    let bestDot = Infinity;
    for (let i = 0; i < N; i++) {
      const d = dot(planet.cells[i].normal, sun0);
      if (d > 0 && d < bestDot) { bestDot = d; shallow = i; }
    }
    spawnUnit(s, 'SWARM', shallow);
    const fields = buildAllFlowFields(s);

    const maxTicks = Math.ceil((ENEMIES.SWARM.burnTime * 4) / TICK_SECONDS);
    for (let t = 0; t < maxTicks && s.units.length > 0; t++) {
      const sun = sunDirection(t * TICK_SECONDS, T);
      const light = lightField(planet, sun);
      updateMovement(s, fields, light, sun, ctx);
      updateBurning(s, light);
    }

    expect(s.units).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/burning.test.ts`
Oczekiwane: FAIL — brak modułu `burning.js`.

- [ ] **Step 3: Zaimplementuj spalanie**

`packages/sim/src/sim/burning.ts`:
```ts
import { ENEMIES } from './defs.js';
import { TICK_SECONDS, type SimState } from './state.js';

/**
 * [STROJENIE] Tempo regeneracji ekspozycji w cieniu, jako ułamek tempa nabijania.
 * Poniżej 1,0 — inaczej krótkie wyskoki w światło byłyby całkowicie bezkosztowe
 * i mechanika przestałaby kształtować trasy.
 */
export const SHADOW_RECOVERY_RATE = 0.5;

/**
 * Tolerancja na błąd akumulacji zmiennoprzecinkowej `u.exposure += TICK_SECONDS`.
 * Nie jest to liczba balansowa: TICK_SECONDS (0,05) nie ma dokładnej reprezentacji
 * binarnej, więc suma po dokładnie `burnTime / TICK_SECONDS` krokach ląduje tuż
 * PONIŻEJ `burnTime`, nie w nim — zmierzone: dla SWARM (burnTime=3, 60 kroków)
 * suma wychodzi 2,9999999999999973 (o 2,6645352591003757e-15 za mało), dla ARMOR
 * (burnTime=8, 160 kroków, NAJWIĘKSZY burnTime w ENEMIES) 7,99999999999998
 * (o 2,042810365310288e-14 za mało). Bez tej tolerancji `>=` przegapia dokładną
 * granicę o jeden tick za każdym razem. 1e-9 to ten sam rząd co istniejąca
 * tolerancja `theta < 1e-9` w slerpToward (movement.ts). Margines nad zmierzonym
 * błędem (zmierzone, najgorszy przypadek — ARMOR, największy `burnTime`, czyli
 * najwięcej kroków akumulacji i największy błąd): **~4,895×10⁴×**
 * (1e-9 / 2,042810365310288e-14), nie 1e5–1e6×, jak błędnie podawał wcześniejszy
 * komentarz w tym miejscu. Nadal o wiele rzędów wielkości mniejszy niż jeden
 * tick (0,05 s), więc nie może przyspieszyć śmierci o cały krok.
 */
const EXPOSURE_EPSILON = 1e-9;

/**
 * Ekspozycja na światło i śmierć od słońca (§4.4).
 * Sam RUCH ucieczki realizuje updateMovement — tutaj wyłącznie akumulacja i skutek.
 */
export function updateBurning(s: SimState, light: Float32Array): void {
  let anyDead = false;

  for (const u of s.units) {
    if (light[u.cellId] > 0) {
      u.exposure += TICK_SECONDS;
      if (u.exposure >= ENEMIES[u.type].burnTime - EXPOSURE_EPSILON) {
        u.hp = 0;
        // Ruda naliczana TUTAJ, w miejscu śmierci, nie w zamiataczu niżej: ten
        // system ma naliczać WYŁĄCZNIE za zgony, które sam spowodował. Zamiatacz
        // operujący na `hp <= 0` naliczałby też za jednostki już martwe z innego
        // źródła (np. walki) w tym samym ticku — nieszkodliwe dziś tylko dzięki
        // kolejności systemów (walka biegnie przed spalaniem i zabiera swoich
        // zabitych PRZED wywołaniem updateBurning), założeniu nigdzie w tym pliku
        // nie zapisanemu ani nie sprawdzonemu. Patrz task-3-fix-report.md, runda 2.
        s.ore += ENEMIES[u.type].oreReward;
        anyDead = true;
      }
    } else if (u.exposure > 0) {
      u.exposure = Math.max(0, u.exposure - TICK_SECONDS * SHADOW_RECOVERY_RATE);
    }
  }

  if (!anyDead) return;

  const survivors = [];
  for (const u of s.units) {
    if (u.hp > 0) survivors.push(u);
  }
  s.units = survivors;
}
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/burning.test.ts`
Oczekiwane: **8 testów przechodzi.** Dwa ostatnie są najważniejsze w całej fazie — para ARMOR ginie / SWARM ucieka z **tej samej** pozycji startowej dowodzi, że `speedFactor` względem prędkości terminatora faktycznie rządzi mechaniką świtu, a nie jest ozdobnikiem w konfiguracji.

```bash
git add packages/sim/src/sim/burning.ts packages/sim/test/burning.test.ts
git commit -m "feat(sim): spalanie w świetle z weryfikacją niezmiennika N3 na żywej symulacji"
```

---

### Task 4: Spawn z pentagonów i erupcje zatkanych capów

**Files:**
- Create: `packages/sim/src/sim/spawning.ts`
- Modify: `packages/sim/src/sim/state.ts` (dodanie `pentagons: PentagonState[]`), `packages/sim/src/sim/hash.ts`
- Test: `packages/sim/test/spawning.test.ts`

**Interfaces:**
- Consumes: `SimState`, `Rng`, `STREAM`, `spawnUnit`, `TICK_SECONDS`
- Produces:
  - `interface PentagonState { spawnAccumulator: number; eruptionCooldown: number; eruptionArmed: boolean }` (w `state.ts`)

> **Trzecie pole `eruptionArmed` to poprawka defektu tego planu, nie ozdoba.** Pierwotna,
> dwupolowa wersja **oblewała własny test**: `createState` sadzi `eruptionCooldown: 0`,
> a `updateSpawning` najpierw odejmuje, potem sprawdza `<= 0` — więc w PIERWSZYM ticku po
> zatkaniu `0 − 0,05 <= 0` odpalało erupcję natychmiast, zamiast po `eruptionInterval`.
> Zmierzone na dosłownie przepisanym kodzie z tego planu: test „zatkany pentagon nie wypuszcza
> ciągłego strumienia" dostawał 4 jednostki zamiast 0 w oknie 10 s. Startowe zero jest
> nieodróżnialne od „właśnie odliczyło do zera", a rozróżnić je musi osobny bit — **nie**
> sentinel `Infinity`, bo ten łamie niezmiennik serializowalności `SimState`.
  - `interface SpawnConfig { … }`, `const DEFAULT_SPAWN: SpawnConfig`
  - `function updateSpawning(s, light, rng, cycle, cfg): void`

**Realizacja §5.3.** Zatkany pentagon **nie kasuje** spawnu — przekierowuje go: przestaje wypuszczać ciągły strumień, ale co `eruptionInterval` wykonuje erupcję w swoim miejscu, o sile rosnącej z liczbą capów. Ponieważ cap musi być podpięty do sieci, gracz capuje blisko siebie — i sam ściąga sobie erupcje do bazy.

- [ ] **Step 1: Rozszerz stan o stan pentagonów**

W `packages/sim/src/sim/state.ts` dodaj typ i pole:
```ts
export interface PentagonState {
  /** Ułamkowy licznik jednostek do wypuszczenia — spawn bywa wolniejszy niż 1/tick. */
  spawnAccumulator: number;
  /** Sekundy do najbliższej erupcji. Używane wyłącznie przez zatkane pentagony. */
  eruptionCooldown: number;
  /**
   * Czy `eruptionCooldown` zostało uzbrojone pełnym `eruptionInterval` od (po)nownego
   * zatkania. Bez tej flagi startowe `eruptionCooldown = 0` jest nieodróżnialne od
   * "właśnie odliczyło do zera" — pierwsza erupcja wystrzeliwałaby w TYM SAMYM ticku,
   * w którym stanął cap, zamiast po pełnym interwale (patrz spawning.ts).
   * Resetowana na `false`, gdy pentagon przestaje być zatkany, żeby ponowne zacapowanie
   * liczyło interwał od nowa, a nie kontynuowało stare odliczenie.
   */
  eruptionArmed: boolean;
}
```
W `interface SimState` dodaj pole:
```ts
  /** Równoległe do planet.pentagons, NIE indeksowane cellId. */
  pentagons: PentagonState[];
```
W `createState` dodaj do zwracanego obiektu:
```ts
    pentagons: planet.pentagons.map(() => ({ spawnAccumulator: 0, eruptionCooldown: 0 })),
```

W `packages/sim/src/sim/hash.ts`, przed pętlą po jednostkach, dodaj:
```ts
  for (const p of s.pentagons) {
    h.float(p.spawnAccumulator);
    h.float(p.eruptionCooldown);
    h.int(p.eruptionArmed ? 1 : 0);
  }
```

- [ ] **Step 2: Napisz testy (mają nie przejść)**

`packages/sim/test/spawning.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { DEFAULT_SPAWN, updateSpawning } from '../src/sim/spawning.js';
import { Rng, STREAM } from '../src/math/rng.js';
import { BUILDINGS } from '../src/sim/defs.js';

const planet = createPlanet({ seed: 81 });
const N = planet.cells.length;

const allDark = new Float32Array(N).fill(0);
const allLit = new Float32Array(N).fill(1);

function fresh() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

/**
 * `seed` parametryzowany (domyślnie 999, jak w brief-ie zadania) — potrzebne do testu
 * "RNG zależy od seeda" niżej. Domyślna wartość zachowuje dokładnie zachowanie
 * wszystkich testów, które nie podają go jawnie.
 */
function run(s: ReturnType<typeof fresh>, light: Float32Array, seconds: number, cycle = 1, seed = 999) {
  const rng = new Rng(seed).fork(STREAM.WAVES);
  const ticks = Math.round(seconds / 0.05);
  for (let i = 0; i < ticks; i++) updateSpawning(s, light, rng, cycle, DEFAULT_SPAWN);
}

describe('updateSpawning', () => {
  it('pentagon w cieniu wypuszcza jednostki', () => {
    const s = fresh();
    run(s, allDark, 30);
    expect(s.units.length).toBeGreaterThan(0);
  });

  it('OŚWIETLONY pentagon nie wypuszcza nic (D1)', () => {
    const s = fresh();
    run(s, allLit, 60);
    expect(s.units).toHaveLength(0);
  });

  /**
   * Concern #2 z przeglądu (task-4-fix-report.md): D1 był sprawdzany tylko na
   * skrajnościach (pełne światło / pełny cień) — nigdy na własnej granicy
   * (`light[cellId] > 0`, ostra nierówność). Tu: NAJMNIEJSZA reprezentowalna dodatnia
   * wartość Float32 (2⁻¹⁴⁹, denormal) musi tłumić tak samo jak pełne światło; dokładne
   * zero musi zachowywać się jak zwykły cień (baseline 7 z testu fractional-carry).
   */
  it('D1: nawet najmniejsza dodatnia wartość światła tłumi spawn; dokładne zero — nie', () => {
    const target = planet.pentagons[0];
    const smallestPositiveFloat32 = new Float32Array(new Uint32Array([1]).buffer)[0];

    const almostDark = new Float32Array(N).fill(0);
    almostDark[target] = smallestPositiveFloat32;
    const s1 = fresh();
    run(s1, almostDark, 30);
    expect(s1.units.filter((u) => u.cellId === target)).toHaveLength(0);

    const exactlyDark = new Float32Array(N).fill(0); // target jawnie na dokładne 0
    const s2 = fresh();
    run(s2, exactlyDark, 30);
    expect(s2.units.filter((u) => u.cellId === target)).toHaveLength(7);
  });

  it('wszystkie jednostki pojawiają się na pentagonach, nigdy gdzie indziej', () => {
    const s = fresh();
    run(s, allDark, 30);
    const pentSet = new Set(planet.pentagons);
    for (const u of s.units) expect(pentSet.has(u.cellId)).toBe(true);
  });

  it('zatkany pentagon nie wypuszcza ciągłego strumienia', () => {
    const s = fresh();
    const capped = planet.pentagons[0];
    applyCommand(s, { kind: 'BUILD', cellId: capped, type: 'GEOTHERMAL_CAP' });

    // Krótkie okno, poniżej interwału erupcji — strumień powinien być zerowy.
    run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 0.5);
    expect(s.units.filter((u) => u.cellId === capped)).toHaveLength(0);
  });

  it('zatkany pentagon ERUPTUJE po upływie interwału — cap przekierowuje, nie kasuje (§5.3)', () => {
    const s = fresh();
    const capped = planet.pentagons[0];
    applyCommand(s, { kind: 'BUILD', cellId: capped, type: 'GEOTHERMAL_CAP' });

    run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.5);
    expect(s.units.filter((u) => u.cellId === capped).length).toBeGreaterThan(0);
  });

  /**
   * Hunt z raportu Taska 4: "Cooldown boundary" — test4/5 powyżej sprawdzają okna
   * WYGODNIE wewnątrz/na zewnątrz interwału (0,5× i 1,5×), nigdy dokładnie na granicy.
   * Ten test przypina moment PIERWSZEJ erupcji dokładnie: tick przed interwałem (0
   * jednostek), dokładnie na interwale (4 — `eruptionBurstBase` przy capCount=1) i
   * tick po (wciąż 4 — druga erupcja jest kolejny pełny interwał później, nie tick
   * później). Wartości zmierzone bezpośrednio na żywej implementacji: 20 s / 0,05 s
   * = 400 ticków DOKŁADNIE, zero odległości od granicy w którąkolwiek stronę.
   *
   * Uwaga po przeglądzie (Concern #4, task-4-fix-report.md): ta precyzja jest
   * specyficzna dla TEGO mechanizmu — odliczanie W DÓŁ od stałej `eruptionInterval`,
   * resetowane przez `+=` dopiero PO odpaleniu. Nie uogólniać na strumień ciągły
   * (`spawnAccumulator`, liczony W GÓRĘ od zera przez powtarzane `+=` KAŻDEGO ticku) —
   * ten na WŁASNYCH granicach (`1/rate`) wykazuje deterministyczne opóźnienie o
   * dokładnie jeden tick, zmierzone i przypięte w teście "strumień ciągły: na
   * dokładnej granicy…" niżej. Inny kierunek akumulacji, inny znak błędu zaokrągleń —
   * "brak dryfu" NIE jest właściwością całego systemu spawnu, tylko wynikiem
   * zmierzonym dla TEGO jednego mechanizmu.
   */
  it('erupcja jest przypięta DOKŁADNIE do interwału — tick przed i tick po granicy', () => {
    const measure = (seconds: number) => {
      const s = fresh();
      const capped = planet.pentagons[0];
      applyCommand(s, { kind: 'BUILD', cellId: capped, type: 'GEOTHERMAL_CAP' });
      run(s, allDark, seconds);
      return s.units.filter((u) => u.cellId === capped).length;
    };

    expect(measure(DEFAULT_SPAWN.eruptionInterval - 0.05)).toBe(0);
    expect(measure(DEFAULT_SPAWN.eruptionInterval)).toBe(DEFAULT_SPAWN.eruptionBurstBase);
    expect(measure(DEFAULT_SPAWN.eruptionInterval + 0.05)).toBe(DEFAULT_SPAWN.eruptionBurstBase);
  });

  /**
   * IMPORTANT z przeglądu (task-4-fix-report.md, punkt 1): zegar erupcji należy do
   * PENTAGONU, nie do CAPA. Wcześniejsza wersja zerowała `eruptionArmed` przy
   * odkapowaniu, więc rozbiórka+odbudowa (płaski koszt ok. 38 rudy — 75 kosztu minus
   * 37 zwrotu z DEMOLISH) w kółko odsuwała rosnącą z `capCount` erupcję o pełny
   * interwał, za darmo w nieskończoność — wywracając cały argument §5.3 ("capowanie
   * wszystkich 12 nadal generuje zagrożenie"). Test: doprowadź do stanu tuż PRZED
   * erupcją (398 ticków — zmierzone, brakują 2), rozbierz cap, odczekaj JEDEN tick
   * niezatkany, odbuduj — erupcja MUSI odpalić w PIERWOTNYM terminie (przesuniętym
   * wyłącznie o ten jeden tick przerwy), nie interwał (400 ticków) później.
   */
  it('rozbiórka i odbudowa capa NIE resetują odliczania erupcji — zegar należy do pentagonu, nie do capa', () => {
    const s = fresh();
    const target = planet.pentagons[0];
    applyCommand(s, { kind: 'BUILD', cellId: target, type: 'GEOTHERMAL_CAP' });

    // 19,9 s = 398 ticków: tuż przed erupcją (brakują 2 ticki zatkane — zmierzone).
    run(s, allDark, DEFAULT_SPAWN.eruptionInterval - 0.1);
    expect(s.units.filter((u) => u.cellId === target)).toHaveLength(0);

    applyCommand(s, { kind: 'DEMOLISH', cellId: target });
    run(s, allDark, 0.05); // jeden tick niezatkany — zegar erupcji MUSI zamrozić się
    applyCommand(s, { kind: 'BUILD', cellId: target, type: 'GEOTHERMAL_CAP' });

    // Dokładnie tyle ticków, ile brakowało PRZED rozbiórką (2) — nie interwał (400) więcej.
    run(s, allDark, 0.1);
    expect(s.units.filter((u) => u.cellId === target)).toHaveLength(DEFAULT_SPAWN.eruptionBurstBase);
  });

  /**
   * Concern #3 z przeglądu: ta sama zasada zamrażania co wyżej (punkt 1), ale przez
   * DRUGI wyzwalacz (D1 — światło), nie przez odkapowanie. Uzbrojony w połowie
   * odliczania pentagon trafia w światło na 10 s — DZIESIĘĆ RAZY dłużej niż
   * pozostałe mu 0,5 s do erupcji — a mimo to nic się nie dzieje: D1 zamraża
   * odliczanie, nie tylko strumień ciągły. Po powrocie do cienia wznawia się
   * DOKŁADNIE tam, gdzie stanęło (brakuje wciąż tych samych 10 ticków), nie od
   * pełnego interwału.
   */
  it('zatkany pentagon W ŚWIETLE zamraża odliczanie erupcji (nie zeruje) — wznawia dokładnie tam, gdzie stanęło', () => {
    const s = fresh();
    const target = planet.pentagons[0];
    applyCommand(s, { kind: 'BUILD', cellId: target, type: 'GEOTHERMAL_CAP' });

    // 19,5 s = 390 ticków zatkane w ciemności: zostaje 0,5 s (10 ticków) do erupcji.
    run(s, allDark, DEFAULT_SPAWN.eruptionInterval - 0.5);
    expect(s.units.filter((u) => u.cellId === target)).toHaveLength(0);

    const lit = new Float32Array(N).fill(0);
    lit[target] = 1;
    run(s, lit, 10); // 10 s w świetle — 10× więcej niż zostało do erupcji, a mimo to nic
    expect(s.units.filter((u) => u.cellId === target)).toHaveLength(0);

    // Powrót do ciemności: brakuje DOKŁADNIE tych samych 10 ticków co przed zaświeceniem.
    run(s, allDark, 0.45);
    expect(s.units.filter((u) => u.cellId === target)).toHaveLength(0);
    run(s, allDark, 0.05);
    expect(s.units.filter((u) => u.cellId === target)).toHaveLength(DEFAULT_SPAWN.eruptionBurstBase);
  });

  it('więcej capów ⇒ silniejsze erupcje', () => {
    const measure = (caps: number) => {
      const s = fresh();
      for (let i = 0; i < caps; i++) {
        applyCommand(s, { kind: 'BUILD', cellId: planet.pentagons[i], type: 'GEOTHERMAL_CAP' });
      }
      const target = planet.pentagons[0];
      run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.2);
      return s.units.filter((u) => u.cellId === target).length;
    };
    expect(measure(6)).toBeGreaterThan(measure(1));
  });

  /**
   * Hunt: "więcej capów ⇒ nie mniej jednostek" przeszedłby nawet przy STAŁEJ sile
   * erupcji. Ten test przypina DOKŁADNE liczby wynikające ze wzoru w spawning.ts
   * (`eruptionBurstBase * (1 + eruptionScalePerCap * (capCount - 1))`), zmierzone na
   * żywej implementacji: capCount=1 → 4, capCount=6 → round(4×(1+0,6×5)) = 16.
   * W oknie 1,2× interwału mieści się DOKŁADNIE jedna erupcja (druga byłaby dopiero
   * przy 2× interwału), więc te liczby to CAŁY wynik testu, nie jego dolna granica.
   */
  it('siła erupcji rośnie z liczbą capów wg dokładnego wzoru (nie tylko kierunek)', () => {
    const measure = (caps: number) => {
      const s = fresh();
      for (let i = 0; i < caps; i++) {
        applyCommand(s, { kind: 'BUILD', cellId: planet.pentagons[i], type: 'GEOTHERMAL_CAP' });
      }
      const target = planet.pentagons[0];
      run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.2);
      return s.units.filter((u) => u.cellId === target).length;
    };
    expect(measure(1)).toBe(4);
    expect(measure(6)).toBe(16);
  });

  it('przy WSZYSTKICH 12 zatkanych gra nadal generuje zagrożenie', () => {
    // Dowód, że allCapsOverloadTimeSeconds z draftu jest zbędną łatką:
    // erupcje są ciągłą krzywą, a 12 capów to po prostu jej koniec.
    const s = fresh();
    for (const p of planet.pentagons) {
      applyCommand(s, { kind: 'BUILD', cellId: p, type: 'GEOTHERMAL_CAP' });
    }
    run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.5);
    expect(s.units.length).toBeGreaterThan(0);
  });

  /**
   * Ten sam scenariusz co wyżej, ale z DOKŁADNĄ liczbą: 12 pentagonów × 30 jednostek
   * (round(4×(1+0,6×11)) = round(30,4) = 30) = 360. Test wyżej przeszedłby nawet
   * gdyby pojedyncza jednostka wyciekła z niezwiązanej przyczyny; ten pinuje liczbę,
   * więc regresja w formule burst/capCount pokazałaby się TU, nie tylko w dedykowanym
   * teście "siła erupcji" powyżej (który liczy tylko jeden, wybrany pentagon).
   */
  it('przy WSZYSTKICH 12 zatkanych — dokładna liczba jednostek, nie tylko ">0"', () => {
    const s = fresh();
    for (const p of planet.pentagons) {
      applyCommand(s, { kind: 'BUILD', cellId: p, type: 'GEOTHERMAL_CAP' });
    }
    run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.5);
    expect(s.units.length).toBe(360);
  });

  it('wyższy cykl oznacza więcej wrogów', () => {
    const count = (cycle: number) => {
      const s = fresh();
      run(s, allDark, 30, cycle);
      return s.units.length;
    };
    expect(count(4)).toBeGreaterThan(count(1));
  });

  it('typy wroga odblokowują się wraz z cyklem', () => {
    const typesAt = (cycle: number) => {
      const s = fresh();
      run(s, allDark, 120, cycle);
      return new Set(s.units.map((u) => u.type));
    };
    expect(typesAt(1)).toEqual(new Set(['SWARM']));
    expect(typesAt(9).size).toBeGreaterThan(1);
  });

  it('jest deterministyczny względem seeda', () => {
    const go = () => {
      const s = fresh();
      run(s, allDark, 40);
      return s.units.map((u) => [u.type, u.cellId]);
    };
    expect(go()).toEqual(go());
  });

  /**
   * Hunt: "Czy jakikolwiek test przeszedłby z RNG podbitym do stałej?" Powyższy test
   * porównuje TEN SAM seed z samym sobą — przeszedłby nawet gdyby `pickType`
   * ignorował `rng` i zawsze zwracał ten sam typ (stały RNG jest trywialnie
   * deterministyczny). Ten test dodaje drugą połowę dowodu: RÓŻNE seedy muszą dać
   * RÓŻNY ciąg typów (cykl 9 odblokowuje 3 typy, więc jest co różnicować) — inaczej
   * strumień WAVES w ogóle nie bierze seeda pod uwagę.
   */
  it('strumień WAVES faktycznie zależy od seeda — różne seedy dają różny ciąg typów', () => {
    const typeSequence = (seed: number) => {
      const s = fresh();
      run(s, allDark, 20, 9, seed);
      return s.units.map((u) => u.type);
    };
    const a1 = typeSequence(999);
    const a2 = typeSequence(999);
    const b = typeSequence(1000);

    expect(a1.length).toBeGreaterThan(20); // próbka wystarczająco duża, by rozbieżność nie była przypadkiem
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
  });

  /**
   * Hunt: "Czy jakiś test dowodzi, że ułamek się KUMULUJE, a nie jest zerowany albo
   * podwójnie liczony?" Powyższy test #1 sprawdza tylko `> 0`. Tu: przy
   * `baseRatePerPentagon = 0,25`/s (poniżej 1/tick) pojedynczy, NIEZATKANY pentagon
   * musi wypuścić DOKŁADNIE floor(0,25 × 30) = 7 jednostek w 30 s — zmierzone na
   * żywej implementacji, 30 s dobrane celowo tak, by 0,25×30=7,5 leżało wygodnie
   * (0,5 od granicy) daleko od progu całkowitego, więc błąd zmiennoprzecinkowy
   * akumulacji (rzędu 1e-13 po 600 tickach) nie ma szans przesunąć wyniku.
   */
  it('spawnAccumulator kumuluje ułamek — dokładna liczba jednostek w oknie, nie tylko ">0"', () => {
    const s = fresh();
    const target = planet.pentagons[0];
    run(s, allDark, 30);
    expect(s.units.filter((u) => u.cellId === target)).toHaveLength(7);
  });

  /**
   * Concern #4 z przeglądu (task-4-fix-report.md): zmierzone bezpośrednio na strumieniu
   * ciągłym (nie na erupcji — patrz uwaga przy teście granicy interwału powyżej).
   * `baseRatePerPentagon = 0,25`/s w cyklu 1 ⇒ `1/rate = 4 s` to granica, na której
   * "powinna" pojawić się pierwsza jednostka. W praktyce, DOKŁADNIE na tej granicy
   * brakuje jej — suma powtarzanych `+= rate*TICK_SECONDS` ląduje tuż PONIŻEJ 1,0
   * (ten sam mechanizm co `EXPOSURE_EPSILON` w burning.ts), więc jednostka pojawia się
   * o jeden tick później. Kluczowe: to opóźnienie jest STAŁE, nie narasta — zmierzone
   * też przy 100-krotności granicy (400 s): wciąż brakuje DOKŁADNIE jednej jednostki
   * (99, nie 90 czy 0), nie stu.
   */
  it('strumień ciągły: na dokładnej granicy 1/rate brakuje DOKŁADNIE jednego egzemplarza — stałe, nie narastające', () => {
    const target = planet.pentagons[0];
    const at = (seconds: number) => {
      const s = fresh();
      run(s, allDark, seconds);
      return s.units.filter((u) => u.cellId === target).length;
    };

    // 1/rate = 1/0,25 = 4 s.
    expect(at(4)).toBe(0);
    expect(at(4.05)).toBe(1);

    // 100-krotność tej samej granicy — opóźnienie WCIĄŻ jednym tickiem, nie 100.
    expect(at(400)).toBe(99);
    expect(at(400.05)).toBe(100);
  });
});
```

- [ ] **Step 3: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/spawning.test.ts`
Oczekiwane: FAIL — brak modułu `spawning.js`.

- [ ] **Step 4: Zaimplementuj spawn**

`packages/sim/src/sim/spawning.ts`:
```ts
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
 *
 * ZEGAR ERUPCJI NALEŻY DO PENTAGONU, NIE DO CAPA (rozstrzygnięcie z przeglądu Taska 4,
 * patrz task-4-fix-report.md, punkt 1): `eruptionCooldown`/`eruptionArmed` ZAMRAŻAJĄ SIĘ,
 * gdy pentagon przestaje być zatkany — nie zerują się. Dwa niezależne wyzwalacze
 * zamrożenia (światło — strażnik D1 na górze pętli; brak capa — gałąź niżej) realizują
 * TĘ SAMĄ zasadę: ciśnienie siedzi w kominie (pentagonie), nie w pokrywie (capie), więc
 * zdjęcie pokrywy go nie upuszcza. Wcześniejsza wersja zerowała `eruptionArmed` przy
 * odkapowaniu — dawało to darmowy exploit: rozbiórka+odbudowa capa (płaski koszt ok. 38
 * rudy — 75 kosztu minus 37 zwrotu z DEMOLISH) w nieskończoność odsuwała rosnącą z
 * `capCount` erupcję, więc capowanie wszystkich 12 STAWAŁO SIĘ strategią wygrywającą
 * zamiast dowodem na to, że nią nie jest (cały sens §5.3).
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

    // Odkapowany (albo nigdy nie zakapowany) pentagon NIE dotyka eruptionCooldown/
    // eruptionArmed — odliczanie (jeśli już uzbrojone) po prostu ZAMRAŻA SIĘ, tak samo
    // jak robi to D1 dla światła (patrz strażnik na górze pętli). Zegar erupcji należy
    // do PENTAGONU (ciśnienie w kominie), nie do capa (pokrywy): zdjęcie pokrywy nie
    // zeruje ciśnienia, więc rozbiórka+odbudowa capa nie kupuje graczowi ani sekundy —
    // usuwa to realny exploit (poprzednia wersja z `eruptionArmed = false` tutaj
    // resetowała odliczanie do pełnego interwału przy KAŻDYM cyklu rozbiórka-odbudowa,
    // za płaski koszt ~38 rudy/cykl, tłumiąc rosnącą z capCount erupcję za darmo —
    // patrz task-4-fix-report.md, punkt 1).
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
```

- [ ] **Step 5: Uruchom testy i commituj**

Run: `pnpm test`
Oczekiwane: wszystko zielone, łącznie z testami determinizmu z Fazy 1B (stan urósł, więc hash się zmienił, ale jego **stabilność** musi się utrzymać).

```bash
git add packages/sim/src/sim packages/sim/test/spawning.test.ts
git commit -m "feat(sim): spawn z zaciemnionych pentagonów i erupcje zatkanych capów (§5.3)"
```

---

### Task 5: Cykle, ewakuacja i warunki końca — pełny run

**Files:**
- Create: `packages/sim/src/sim/rules.ts`
- Modify: `packages/sim/src/sim/state.ts`, `packages/sim/src/sim/hash.ts`, `packages/sim/src/sim/loop.ts`, `packages/sim/src/index.ts`
- Modify (bramka §5.6, patrz niżej): `packages/sim/src/sim/commands.ts`

> **Bramka ewakuacji, dopisana po przeglądzie.** Pierwotna wersja tego zadania produkowała
> `evacUnlocked(cycle, cfg)` i **nie wołała jej nigdzie** — `grep` po `src/` znajdował wyłącznie
> definicję i eksport. §5.6 mówi „odblokowany w ostatniej tercji runu", a nic tego nie pilnowało:
> test zwycięstwa stawiał `EVACUATION_MODULE` w cyklu 2 i nikt nie protestował.
>
> Egzekwowane teraz przez `SimState.evacUnlockTick`: `Sim` liczy próg RAZ w konstruktorze
> z `RunConfig` i zapisuje jako **tick**, a `canBuild` odrzuca `EVACUATION_MODULE` przed progiem
> z powodem `'EVAC_LOCKED'`. Tick, nie cykl, i to jest sedno: `canBuild` nie zna ani
> `rotationPeriod`, ani `RunConfig`, a `SimState` niesie `tick` — przeliczenie w jednym miejscu
> usuwa tę zależność zamiast propagować ją przez sygnatury. `evacUnlocked(cycle, cfg)` zostaje
> nietknięta jako forma czytelna dla UI Fazy 2.
>
> Zmierzone w pełnym runie: bramka odrzuciła BUILD **5410 razy** (ostatni na ticku 20 749),
> a moduł stanął na ticku 22 134, czyli 534 ticki po progu 21 600 — dowód, że działała
> w trakcie runu, nie tylko w teście jednostkowym.
- Modify (migracja wywołań, patrz Krok 0): `packages/sim/test/determinism.test.ts`, `packages/sim/test/state.test.ts`
- Test: `packages/sim/test/rules.test.ts`, `packages/sim/test/fullrun.test.ts`

> **Krok 0 — migracja istniejących wywołań `new Sim(...)`. Zrób to PRZED pisaniem testów,
> inaczej `tsc` nie przejdzie i nie odróżnisz swojego czerwonego od cudzego.**
>
> Faza 1B ma **21 wywołań `new Sim(planet, config)`** — 20 w `determinism.test.ts`, 1 w
> `state.test.ts` — i wszystkie podają `SimConfig`, czyli `{ rotationPeriod, startingOre }`.
> To zadanie zmienia drugi parametr na `RunConfig` z ośmioma **wymaganymi** polami, więc
> każde z tych 21 wywołań przestaje się kompilować.
>
> **Rozstrzygnięcie: `RunConfig` ZASTĘPUJE `SimConfig`, a wywołania migrują jawnie.**
> Sprawdzone: `SimConfig` nie ma żadnego konsumenta poza `loop.ts`, który to zadanie i tak
> podmienia w całości — więc nie zostawiamy dwóch typów konfiguracji ani dziedziczenia między
> nimi. Usuń `export interface SimConfig`, zostaw sam `RunConfig`, i **popraw treść komunikatów
> `RangeError` w konstruktorze z `SimConfig.…` na `RunConfig.…`** (są asercjowane po fragmencie
> tekstu — sprawdź, czy testy walidacji dopasowują się do nowego brzmienia).
>
> Nie robimy za to pól opcjonalnych scalanych po cichu z `DEFAULT_RUN` w konstruktorze. Powód:
> reszta planu przekazuje `cfg: RunConfig` do `updateRules` i `evacUnlocked` jako komplet, więc
> konfiguracja częściowa i tak musiałaby być materializowana w `Sim` — zostałby nam typ o dwóch
> kształtach, inny przy konstrukcji niż wszędzie indziej, i każda kolejna faza musiałaby o tym
> pamiętać. Jednorazowy koszt 21 mechanicznych edycji jest tańszy niż stała dwuznaczność.
>
> Wzorzec migracji — dopisz rozwinięcie, zostaw nadpisane pole:
> ```ts
> // było:  new Sim(planet, { rotationPeriod: 0, startingOre: 100 })
> // jest:  new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 0, startingOre: 100 })
> ```
> **Dziesięć z tych wywołań (`determinism.test.ts`) to testy walidacji konstruktora** —
> sprawdzają, że `rotationPeriod` i `startingOre` są odrzucane dla zera, wartości ujemnych,
> `NaN` i nieskończoności, plus podłoga `rotationPeriod < TICK_SECONDS`. **Mają przetrwać
> migrację co do jednego i dalej oblewać, gdy straż zniknie.** Po migracji usuń jedną strażnicę
> z `loop.ts`, potwierdź, że odpowiedni test oblewa, i przywróć ją — dopiero wtedy wiesz,
> że migracja niczego nie wykastrowała. Zaraportuj, którą strażnicę usunąłeś i który test oblał.

**Interfaces:**
- Consumes: wszystko powyższe
- Produces:
  - `interface RunConfig { rotationPeriod; startingOre; cyclesPerRun; evacUnlockFraction; evacEnergyRequired; evacChargeRate; evacAlarmSeconds; spawn: SpawnConfig }`
  - `function currentCycle(elapsed: number, rotationPeriod: number): number`
  - `function evacUnlocked(cycle: number, cfg: RunConfig): boolean`
  - `function updateRules(s: SimState, cfg: RunConfig): void`
  - `Sim` przyjmuje `RunConfig` i uruchamia komplet systemów

- [ ] **Step 1: Rozszerz stan o ewakuację**

W `state.ts`, w `interface SimState`:
```ts
  evacCharge: number;
  /**
   * Sekundy do końca alarmu. -1 = alarm nieaktywny.
   * Sentinel `-1`, a NIE `Infinity`/`null`: patrz niezmiennik serializowalności wyżej —
   * `JSON.stringify` zamienia `Infinity` na `null`, a `null` w arytmetyce zachowuje się
   * jak `0`, więc „alarm nieaktywny" po round-tripie stałoby się „alarm właśnie minął",
   * czyli natychmiastowym zwycięstwem po wczytaniu zapisu.
   */
  evacAlarmRemaining: number;
  /**
   * Pierwszy tick, w którym wolno postawić EVACUATION_MODULE (§5.6: „odblokowany
   * w ostatniej tercji runu"). Liczony RAZ, w konstruktorze `Sim`, z `RunConfig`
   * (`cyclesPerRun`, `evacUnlockFraction`, `rotationPeriod`) i zapisywany tutaj.
   *
   * Dlaczego TICK, a nie numer cyklu: bramkę egzekwuje `canBuild`, a ta zna wyłącznie
   * `SimState` — nie zna ani `rotationPeriod`, ani `RunConfig`. Przeliczenie na tick
   * w jednym miejscu, przy konstrukcji, usuwa tę zależność zamiast propagować ją przez
   * sygnatury `canBuild`/`applyCommand`, na których stoi Faza 5. `evacUnlocked(cycle, cfg)`
   * w rules.ts zostaje jako forma czytelna dla UI Fazy 2 i jest z tym polem zgodna.
   *
   * `createState` daje tu 0 (odblokowane od razu): stan zbudowany bez `Sim` nie zna
   * konfiguracji, a wartość permisywna zachowuje zachowanie wszystkich pomocników
   * testowych Fazy 1B, które piszą budynki wprost do stanu.
   */
  evacUnlockTick: number;
```
W `createState`: `evacCharge: 0, evacAlarmRemaining: -1,`

W `hash.ts`, obok `h.float(s.storedEnergy)`:
```ts
  h.float(s.evacCharge);
  h.float(s.evacAlarmRemaining);
```

- [ ] **Step 2: Napisz testy (mają nie przejść)**

`packages/sim/test/rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { BUILDINGS } from '../src/sim/defs.js';
import { stateHash } from '../src/sim/hash.js';
import { currentCycle, DEFAULT_RUN, evacUnlocked, updateRules } from '../src/sim/rules.js';

const planet = createPlanet({ seed: 91 });
const cfg = DEFAULT_RUN;

function withCore() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

/** Zasilony Evac na sąsiedniej komórce — wspólny punkt wyjścia dla testów ładowania. */
function withPoweredEvac(powered = true) {
  const s = withCore();
  const cell = planet.cells[planet.startCell].neighbors[0];
  s.buildings[cell] = {
    cellId: cell, type: 'EVACUATION_MODULE', hp: BUILDINGS.EVACUATION_MODULE.hp, powered,
  };
  return { s, cell };
}

describe('currentCycle', () => {
  it('zaczyna od cyklu 1 i przełącza się co pełny obrót', () => {
    expect(currentCycle(0, 180)).toBe(1);
    expect(currentCycle(179, 180)).toBe(1);
    expect(currentCycle(180, 180)).toBe(2);
    expect(currentCycle(540, 180)).toBe(4);
  });

  /**
   * Powyższy test próbkuje wygodne, okrągłe sekundy. Ten przypina granicę tam, gdzie
   * symulacja naprawdę ją przekracza: między OSTATNIM tickiem cyklu N a PIERWSZYM
   * tickiem N+1, licząc `elapsed` dokładnie tak, jak robi to `Sim.elapsedSeconds`
   * (`tick * TICK_SECONDS`). Zmierzone: 3599 × 0,05 = 179,95000000000002, a
   * 3600 × 0,05 = 180 dokładnie — więc granica NIE jest rozmyta błędem
   * zmiennoprzecinkowym i wolno ją przypiąć co do ticka.
   */
  it('granica wypada między ostatnim tickiem cyklu N a pierwszym tickiem N+1, nie w wygodnym środku', () => {
    const ticksPerCycle = 180 / TICK_SECONDS;
    expect(ticksPerCycle).toBe(3600);

    expect(currentCycle((ticksPerCycle - 1) * TICK_SECONDS, 180)).toBe(1);
    expect(currentCycle(ticksPerCycle * TICK_SECONDS, 180)).toBe(2);
    expect(currentCycle((2 * ticksPerCycle - 1) * TICK_SECONDS, 180)).toBe(2);
    expect(currentCycle(2 * ticksPerCycle * TICK_SECONDS, 180)).toBe(3);
  });

  it('numeracja zależy od okresu obrotu, nie od zaszytej liczby sekund', () => {
    // Ta sama chwila (180 s) to cykl 2 przy obrocie 180 s, ale wciąż cykl 1 przy 300 s
    // i już cykl 4 przy 60 s. Zaszyta stała 180 przechodziłaby test wyżej i oblewa tutaj.
    expect(currentCycle(180, 300)).toBe(1);
    expect(currentCycle(180, 180)).toBe(2);
    expect(currentCycle(180, 60)).toBe(4);
  });
});

describe('evacUnlocked', () => {
  it('otwiera się dopiero w ostatniej tercji runu (§5.6)', () => {
    expect(evacUnlocked(1, cfg)).toBe(false);
    expect(evacUnlocked(Math.ceil(cfg.cyclesPerRun * 0.5), cfg)).toBe(false);
    expect(evacUnlocked(cfg.cyclesPerRun, cfg)).toBe(true);
  });

  /**
   * Test wyżej sprawdza WYŁĄCZNIE `DEFAULT_RUN`, gdzie próg wypada na cyklu 7
   * (`ceil(10 × 0,67)`). Implementacja `cycle >= 7` — zaszyta liczba zamiast ułamka
   * konfiguracji — przeszłaby go co do joty. Ten test odbiera jej tę możliwość:
   * TEN SAM cykl 7 jest odblokowany przy jednej konfiguracji i zablokowany przy
   * drugiej, więc odpowiedź musi wynikać z `cfg`, a nie ze stałej w kodzie.
   */
  it('próg wynika z cyclesPerRun × evacUnlockFraction, a nie z zaszytego numeru cyklu', () => {
    const short = { ...cfg, cyclesPerRun: 4, evacUnlockFraction: 0.5 };   // próg = 2
    const long = { ...cfg, cyclesPerRun: 20, evacUnlockFraction: 0.75 };  // próg = 15

    expect(evacUnlocked(1, short)).toBe(false);
    expect(evacUnlocked(2, short)).toBe(true);
    expect(evacUnlocked(14, long)).toBe(false);
    expect(evacUnlocked(15, long)).toBe(true);

    expect(evacUnlocked(7, short)).toBe(true);
    expect(evacUnlocked(7, long)).toBe(false);
  });

  /**
   * Oba testy wyżej używają konfiguracji, w których iloczyn `cyclesPerRun × fraction`
   * wypada na okrągłej liczbie (2, 15) — więc `Math.ceil` i `Math.floor` dają tam ten
   * sam wynik i podmiana jednego na drugie przechodzi niezauważona (zmierzone: taka
   * mutacja przeżywała cały zestaw). `DEFAULT_RUN` daje iloczyn 6,7 i to jest JEDYNE
   * miejsce, w którym ta różnica jest widoczna: `ceil` otwiera Evac na cyklu 7,
   * `floor` — już na 6, czyli o cały cykl za wcześnie, przed ostatnią tercją z §5.6.
   */
  it('próg zaokrągla się W GÓRĘ: przy 10 cyklach i ułamku 0,67 otwiera się na 7, nie na 6', () => {
    expect(cfg.cyclesPerRun * cfg.evacUnlockFraction).toBeCloseTo(6.7, 9);
    expect(evacUnlocked(6, cfg)).toBe(false);
    expect(evacUnlocked(7, cfg)).toBe(true);
  });
});

describe('updateRules', () => {
  it('utrata CORE kończy run porażką', () => {
    const s = withCore();
    s.buildings[planet.startCell] = null;
    updateRules(s, cfg);
    expect(s.phase).toBe('DEFEAT');
  });

  /**
   * Test wyżej burzy CORE — czyli JEDYNY budynek w stanie — więc przeszedłby również
   * wtedy, gdyby porażką kończyła się utrata dowolnego budynku albo opustoszenie
   * planszy. Ten oddziela przyczynę od skutku: budynek ginie, run trwa; ginie CORE,
   * run się kończy.
   */
  it('porażka jest przypięta do utraty CORE, a nie do utraty JAKIEGOKOLWIEK budynku ani do opustoszenia planszy', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    const barricade = {
      cellId: cell, type: 'BARRICADE' as const, hp: BUILDINGS.BARRICADE.hp, powered: false,
    };
    s.buildings[cell] = barricade;

    updateRules(s, cfg);
    expect(s.phase).toBe('RUNNING');

    // (a) ginie budynek INNY niż CORE — run trwa dalej.
    s.buildings[cell] = null;
    updateRules(s, cfg);
    expect(s.phase).toBe('RUNNING');

    // (b) ginie CORE, ale plansza NIE jest pusta — i to i tak wystarcza do porażki.
    //     Barykada MUSI tu stać: bez niej krok (b) zostawia planszę pustą, a wtedy test
    //     przechodzi również dla warunku „porażka, gdy nie został ŻADEN budynek".
    //     Zmierzone: mutacja `b?.type === 'CORE'` → `b !== null` przeżywała cały zestaw
    //     testów, dopóki ta linia tu nie stanęła.
    s.buildings[cell] = barricade;
    s.buildings[planet.startCell] = null;
    updateRules(s, cfg);
    expect(s.phase).toBe('DEFEAT');
  });

  it('po zakończeniu stan już się nie zmienia', () => {
    const s = withCore();
    s.buildings[planet.startCell] = null;
    updateRules(s, cfg);
    s.ore = 12345;
    updateRules(s, cfg);
    expect(s.phase).toBe('DEFEAT');
  });

  /**
   * Test wyżej asercjuje WYŁĄCZNIE `phase` w stanie, w którym CORE i tak nie istnieje —
   * więc bez strażnicy `if (s.phase !== 'RUNNING') return;` reguły przeliczyłyby się od
   * nowa i ustawiły DEFEAT po raz drugi, a test i tak byłby zielony (zmierzone: usunięcie
   * tej strażnicy przeżywało cały zestaw). Tutaj run jest zakończony ZWYCIĘSTWEM, a stan
   * zawiera wszystko, czego reguły potrzebują, żeby dalej pracować: żywy CORE, zasilony
   * Evac i pełny magazyn. Porównanie po `stateHash` obejmuje KAŻDE hashowane pole naraz,
   * nie tylko `phase` — czyli sprawdza to, co obiecuje nazwa: że nie zmienia się NIC.
   */
  it('po zakończeniu runu reguły nie ruszają NICZEGO, nie tylko fazy', () => {
    const { s } = withPoweredEvac();
    s.storedEnergy = 500;
    s.phase = 'VICTORY';
    const before = stateHash(s);

    updateRules(s, cfg);

    expect(s.phase).toBe('VICTORY');
    expect(s.evacCharge).toBe(0);
    expect(s.storedEnergy).toBe(500);
    expect(stateHash(s)).toBe(before);
  });

  it('zasilony Evac ładuje się z magazynu', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: true };
    s.storedEnergy = 500;

    updateRules(s, cfg);
    expect(s.evacCharge).toBeCloseTo(cfg.evacChargeRate * TICK_SECONDS, 6);
    expect(s.storedEnergy).toBeCloseTo(500 - cfg.evacChargeRate * TICK_SECONDS, 6);
  });

  it('bez zasilania Evac się nie ładuje', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: false };
    s.storedEnergy = 500;
    updateRules(s, cfg);
    expect(s.evacCharge).toBe(0);
  });

  /**
   * Test „zasilony Evac ładuje się z magazynu" trzyma w magazynie 500 przy poborze 1,25
   * na tick — czyli z ogromnym zapasem, więc ograniczenie `Math.min(…, storedEnergy)`
   * nigdy tam nie działa i jego usunięcie przeszłoby niezauważone. Tutaj w magazynie
   * jest MNIEJ niż jeden pełny pobór: bez ograniczenia `storedEnergy` zszedłby pod zero
   * (a `SimState` przenosi tę wartość przez JSON do Fazy 5), a ładunek urósłby o więcej,
   * niż w magazynie było.
   */
  it('pobór nie może przekroczyć zawartości magazynu — magazyn nie schodzi poniżej zera', () => {
    const { s } = withPoweredEvac();
    const perTick = cfg.evacChargeRate * TICK_SECONDS;
    expect(perTick).toBeGreaterThan(0.3); // przesłanka testu: 0,3 to MNIEJ niż jeden pobór
    s.storedEnergy = 0.3;

    updateRules(s, cfg);

    expect(s.evacCharge).toBeCloseTo(0.3, 9);
    expect(s.storedEnergy).toBe(0);
  });

  it('pełne naładowanie uruchamia alarm, a przetrwanie alarmu daje zwycięstwo', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: true };
    s.evacCharge = cfg.evacEnergyRequired;

    updateRules(s, cfg);
    expect(s.evacAlarmRemaining).toBeGreaterThan(0);
    expect(s.phase).toBe('RUNNING');

    // Bez `+ 1`: po naprawie ALARM_EPSILON w rules.ts odliczanie mieści się w nominalnej
    // liczbie ticków. Zapas maskowałby regresję wydłużającą alarm o krok.
    const ticks = Math.ceil(cfg.evacAlarmSeconds / TICK_SECONDS);
    for (let i = 0; i < ticks; i++) updateRules(s, cfg);
    expect(s.phase).toBe('VICTORY');
  });

  /**
   * Test wyżej stwierdza tylko, że po DOSTATECZNIE wielu tickach (1201, czyli o jeden
   * więcej niż trzeba) jest zwycięstwo — przeszedłby też, gdyby alarm wygrywał
   * natychmiast, po jednym ticku albo po połowie czasu. Ten MIERZY długość alarmu
   * w tickach i przypina ją obustronnie.
   *
   * Przed naprawą było ich 1201, nie 1200: `evacAlarmRemaining -= 0.05` powtórzone 1200
   * razy od 60 zostawia 1,2706086183200682e-12 zamiast zera, bo 0,05 nie ma dokładnej
   * reprezentacji binarnej — alarm trwał 60,05 s zamiast 60 s. Domknięte stałą
   * `ALARM_EPSILON` w rules.ts, odpowiednikiem `EXPOSURE_EPSILON` z burning.ts.
   *
   * Asercja jest teraz DOKŁADNA (`toBe`), nie tolerancyjna: każdy tick w którąkolwiek
   * stronę to błąd. Sprawdzone dla czterech długości alarmu, w tym najgorszej zmierzonej
   * w zakresie 1–600 s (128 s, reszta 5,14e-12) — wszystkie trafiają w nominał co do ticka.
   */
  it('alarm odlicza pełne evacAlarmSeconds mierzone w tickach, nie kończy się wcześniej', () => {
    const { s } = withPoweredEvac();
    s.evacCharge = cfg.evacEnergyRequired;

    updateRules(s, cfg); // tick uzbrojenia — sam jeszcze nie odlicza
    expect(s.evacAlarmRemaining).toBe(cfg.evacAlarmSeconds);
    expect(s.phase).toBe('RUNNING');

    let ticks = 0;
    while (s.phase === 'RUNNING' && ticks < 5000) {
      updateRules(s, cfg);
      ticks++;
    }

    expect(s.phase).toBe('VICTORY');
    expect(ticks).toBe(cfg.evacAlarmSeconds / TICK_SECONDS);
    expect(ticks).toBe(1200);
  });

  /**
   * Tolerancja ma działać dla KAŻDEJ długości alarmu, nie tylko dla domyślnych 60 s —
   * reszta akumulacji nie jest ani monotoniczna, ani zawsze dodatnia. 128 s to najgorszy
   * DODATNI przypadek zmierzony w zakresie 1–600 s (reszta 5,135961100855013e-12);
   * 30 s to przypadek, w którym reszta wychodzi UJEMNA (−2,92e-13) i problemu nigdy
   * nie było — oba muszą trafiać w nominał co do ticka.
   */
  it('odliczanie trafia w nominał co do ticka także poza domyślnymi 60 s', () => {
    for (const seconds of [5, 30, 128, 300]) {
      const local = { ...cfg, evacAlarmSeconds: seconds };
      const { s } = withPoweredEvac();
      s.evacCharge = local.evacEnergyRequired;
      updateRules(s, local);

      let ticks = 0;
      while (s.phase === 'RUNNING' && ticks < 20_000) {
        updateRules(s, local);
        ticks++;
      }
      expect(s.phase, `alarm ${seconds}s nie zakończył się`).toBe('VICTORY');
      expect(ticks, `alarm ${seconds}s trwał ${ticks} ticków`).toBe(Math.round(seconds / TICK_SECONDS));
    }
  });

  it('zniszczony Evac zeruje ładunek, ale NIE kończy runu (§5.6)', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: true };
    s.evacCharge = cfg.evacEnergyRequired;
    updateRules(s, cfg);
    expect(s.evacAlarmRemaining).toBeGreaterThan(0);

    s.buildings[cell] = null;
    updateRules(s, cfg);

    expect(s.phase).toBe('RUNNING');
    expect(s.evacCharge).toBe(0);
    expect(s.evacAlarmRemaining).toBe(-1);
  });

  /**
   * `evacAlarmRemaining = -1` to sentinel „alarm nieaktywny", a nie liczba sekund —
   * i MUSI nim pozostać `-1`, nie `Infinity`/`null`. `JSON.stringify` zamienia
   * `Infinity` na `null`, a `null` w arytmetyce zachowuje się jak `0`, czyli po
   * round-tripie zapisu „brak alarmu" stałoby się „alarm właśnie minął" —
   * natychmiastowym zwycięstwem po wczytaniu gry (§ niezmiennik serializowalności
   * w state.ts). Ten test pilnuje SAMEJ wartości sentinela, nie tylko tego, że run trwa.
   */
  it('sentinel braku alarmu przeżywa round-trip JSON jako -1, nigdy jako Infinity', () => {
    const { s } = withPoweredEvac();
    updateRules(s, cfg);
    expect(s.evacAlarmRemaining).toBe(-1);
    expect(Number.isFinite(s.evacAlarmRemaining)).toBe(true);
    expect(JSON.parse(JSON.stringify(s)).evacAlarmRemaining).toBe(-1);
  });
});
```

`packages/sim/test/fullrun.test.ts`:
```ts
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
```

- [ ] **Step 3: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/rules.test.ts packages/sim/test/fullrun.test.ts`
Oczekiwane: FAIL — brak `rules.js` i brak `DEFAULT_RUN`.

- [ ] **Step 4: Zaimplementuj reguły**

`packages/sim/src/sim/rules.ts`:
```ts
import { DEFAULT_SPAWN, type SpawnConfig } from './spawning.js';
import { TICK_SECONDS, type SimState } from './state.js';

export interface RunConfig {
  rotationPeriod: number;
  startingOre: number;
  /**
   * PUNKT ODNIESIENIA DLA PROGU EWAKUACJI, **NIE** DŁUGOŚĆ RUNU. Nazwa sugeruje limit
   * czasu — takiego nie ma i mieć nie powinno: §5.6 zna dokładnie dwa warunki końca,
   * zwycięstwo przez ewakuację i porażkę przez utratę Core. Run, w którym gracz się nie
   * ewakuuje, biegnie dalej po `cyclesPerRun` — zmierzone: przy `cyclesPerRun: 10`
   * przebieg dochodzi do cyklu 15 i kończy się dopiero utratą CORE.
   *
   * Jedyny konsument tego pola to próg ewakuacji: `ceil(cyclesPerRun × evacUnlockFraction)`
   * daje cykl odblokowania, a `Sim` przelicza go na `SimState.evacUnlockTick`. Faza 3,
   * strojąc to pole, przesuwa MOMENT OTWARCIA EWAKUACJI, nie długość rozgrywki.
   */
  cyclesPerRun: number;
  /** Ułamek runu, po którym Evac staje się dostępny. 0,67 = ostatnia tercja. */
  evacUnlockFraction: number;
  evacEnergyRequired: number;
  evacChargeRate: number;
  evacAlarmSeconds: number;
  spawn: SpawnConfig;
}

// [STROJENIE] — cała tabela do wyznaczenia headlessem w Fazie 3.
export const DEFAULT_RUN: RunConfig = {
  rotationPeriod: 180,
  startingOre: 150,
  cyclesPerRun: 10,       // 10 × 180 s = 30 min, zgodnie z D4
  evacUnlockFraction: 0.67,
  evacEnergyRequired: 1000,
  evacChargeRate: 25,
  evacAlarmSeconds: 60,
  spawn: DEFAULT_SPAWN,
};

/**
 * Tolerancja na błąd akumulacji zmiennoprzecinkowej `evacAlarmRemaining -= TICK_SECONDS`.
 * NIE jest to liczba balansowa (stąd brak `[STROJENIE]`) — to ten sam problem i ta sama
 * decyzja, co `EXPOSURE_EPSILON` w burning.ts, tylko odchylenie idzie w drugą stronę:
 * tam `+=` ląduje tuż PONIŻEJ progu, tutaj `-=` zatrzymuje się tuż NAD zerem.
 *
 * Zmierzone: `0,05` nie ma dokładnej reprezentacji binarnej, więc odjęcie go 1200 razy
 * od 60 zostawia **1,2706086183200682e-12** zamiast zera — bez tolerancji odliczanie
 * potrzebuje 1201 ticków, a alarm trwa 60,05 s zamiast 60 s. Reszta nie jest monotoniczna
 * ani zawsze dodatnia (dla 30 s wychodzi −2,92e-13, czyli tam problem nie występuje);
 * przeskanowane co sekundę w zakresie 1–600 s, najgorsza DODATNIA reszta to
 * **5,135961100855013e-12** (dla 128 s).
 *
 * Stąd 1e-9: margines nad zmierzonym najgorszym przypadkiem **~195×**, a jednocześnie
 * 5×10⁷ razy mniej niż jeden tick (0,05 s), więc nie jest w stanie skrócić alarmu
 * o cały krok. Ten sam rząd wielkości, co `EXPOSURE_EPSILON` (1e-9) i `theta < 1e-9`
 * w `slerpToward` (movement.ts) — pakiet ma jedną skalę dla tej klasy błędu.
 */
const ALARM_EPSILON = 1e-9;

/** Cykle numerowane od 1. */
export const currentCycle = (elapsed: number, rotationPeriod: number): number =>
  Math.floor(elapsed / rotationPeriod) + 1;

export const evacUnlocked = (cycle: number, cfg: RunConfig): boolean =>
  cycle >= Math.ceil(cfg.cyclesPerRun * cfg.evacUnlockFraction);

export function updateRules(s: SimState, cfg: RunConfig): void {
  if (s.phase !== 'RUNNING') return;

  // Przegrana: utrata CORE. Jedyny warunek (§5.6).
  if (!s.buildings.some((b) => b?.type === 'CORE')) {
    s.phase = 'DEFEAT';
    return;
  }

  const evac = s.buildings.find((b) => b?.type === 'EVACUATION_MODULE') ?? null;

  if (evac === null) {
    // Zniszczony Evac kosztuje ładunek i alarm, ale NIE kończy runu — da się go odbudować.
    s.evacCharge = 0;
    s.evacAlarmRemaining = -1;
    return;
  }

  if (s.evacAlarmRemaining >= 0) {
    s.evacAlarmRemaining -= TICK_SECONDS;
    if (s.evacAlarmRemaining <= ALARM_EPSILON) s.phase = 'VICTORY';
    return;
  }

  if (evac.powered && s.evacCharge < cfg.evacEnergyRequired) {
    const draw = Math.min(cfg.evacChargeRate * TICK_SECONDS, s.storedEnergy);
    s.evacCharge += draw;
    s.storedEnergy -= draw;
  }

  if (s.evacCharge >= cfg.evacEnergyRequired) {
    s.evacAlarmRemaining = cfg.evacAlarmSeconds;
  }
}
```

- [ ] **Step 5: Domknij pętlę**

Zastąp `packages/sim/src/sim/loop.ts` pełną wersją:
```ts
import { cellSpacing, terminatorSpeedCells } from '../world/scale.js';
import { Rng, STREAM } from '../math/rng.js';
import type { Planet } from '../world/planet.js';
import { updateBurning } from './burning.js';
import { updateCombat } from './combat.js';
import { applyCommand, type Command } from './commands.js';
import { BUILDINGS } from './defs.js';
import { updateEconomy } from './economy.js';
import { buildAllFlowFields } from './flowfield.js';
import { lightField, sunDirection } from './light.js';
import type { MotionContext } from './movement.js';
import { updateMovement } from './movement.js';
import { updatePower } from './power.js';
import { currentCycle, updateRules, type RunConfig } from './rules.js';
import { updateSpawning } from './spawning.js';
import { createState, TICK_SECONDS, type SimState } from './state.js';

/** [STROJENIE] Co ile ticków przeliczane są pola przepływu. 4 ticki = 5 Hz (§4.5). */
const FLOWFIELD_INTERVAL_TICKS = 4;

export class Sim {
  readonly config: RunConfig;
  private readonly s: SimState;
  private readonly pending: Command[] = [];
  private readonly motion: MotionContext;
  private readonly waveRng: Rng;
  private fields = null as ReturnType<typeof buildAllFlowFields> | null;

  constructor(planet: Planet, config: RunConfig) {
    // `!(x > 0)` NIE łapie Infinity (Infinity > 0 jest prawdziwe) — stąd Number.isFinite.
    // Walidacja tu, a nie w scale.ts, chroni WSZYSTKICH konsumentów rotationPeriod naraz:
    // terminatorSpeedWorld/terminatorSpeedCells/terminatorCrossingTime dzielą przez nie
    // bez żadnej straży i po cichu dają Infinity/0 zamiast rzucić błąd.
    if (!Number.isFinite(config.rotationPeriod) || config.rotationPeriod <= 0) {
      throw new RangeError(`RunConfig.rotationPeriod must be finite and positive, got ${config.rotationPeriod}`);
    }
    // Druga warstwa tej samej straży, na poziomie DOMENY zamiast arytmetyki: finite i
    // dodatni nie wystarczy, jeśli okres jest krótszy niż jeden tick — Słońce robiłoby
    // wtedy pełny obrót WEWNĄTRZ pojedynczego kroku symulacji, co nie jest cyklem
    // dzień/noc w żadnym sensownym znaczeniu (a przy skrajnych wartościach, np. 1e-320,
    // to właśnie ten zakres, w którym `angle` w `sunDirection` przepełnia się do
    // Infinity — patrz light.ts). Granica inclusive: dokładnie jeden tick jest ostatnią
    // wartością, przy której obrót JEST rozłożony na (przynajmniej) jeden krok.
    if (config.rotationPeriod < TICK_SECONDS) {
      throw new RangeError(
        `RunConfig.rotationPeriod must be at least one tick (${TICK_SECONDS}s), got ${config.rotationPeriod} — a shorter period completes a full day/night cycle inside a single tick and is not a simulable cycle`,
      );
    }
    if (!Number.isFinite(config.startingOre) || config.startingOre < 0) {
      throw new RangeError(`RunConfig.startingOre must be finite and non-negative, got ${config.startingOre}`);
    }
    // Pozostałe sześć pól `RunConfig`, tym samym idiomem `Number.isFinite`. DWA z nich
    // wpływają wprost do `SimState`: `cyclesPerRun` → `evacUnlockTick`, `evacAlarmSeconds`
    // → `evacAlarmRemaining`. Bez tych straży `NaN`/`Infinity` z konfiguracji ląduje
    // w stanie, a `JSON.stringify` zamienia je na `null` — i po wczytaniu zapisu w Fazie 5
    // `s.tick < null` jest fałszem NA ZAWSZE (bramka §5.6 odwraca się w „zawsze otwarta"),
    // a `null >= 0` i `null - 0.05 <= ALARM_EPSILON` są jednocześnie prawdziwe, więc
    // PIERWSZY tick po wczytaniu ogłasza zwycięstwo. Dokładnie tryb awarii z komentarza
    // niezmiennika w state.ts, tyle że wchodzący przez konfigurację, nie przez sentinel.
    if (!Number.isInteger(config.cyclesPerRun) || config.cyclesPerRun < 1) {
      throw new RangeError(
        `RunConfig.cyclesPerRun must be an integer >= 1, got ${config.cyclesPerRun}`,
      );
    }
    // Ułamek, nie „cokolwiek dodatniego": > 1 znaczyłoby próg poza zadeklarowaną długością
    // runu, a 0 — Evac dostępny od pierwszego ticka (dopuszczalne, np. run jednocyklowy).
    if (
      !Number.isFinite(config.evacUnlockFraction) ||
      config.evacUnlockFraction < 0 || config.evacUnlockFraction > 1
    ) {
      throw new RangeError(
        `RunConfig.evacUnlockFraction must be a finite fraction in [0, 1], got ${config.evacUnlockFraction}`,
      );
    }
    // Te trzy ostro dodatnie, nie nieujemne: zero po cichu USUWA mechanikę, którą §5.6
    // nazywa z osobna (ładowanie, tempo ładowania, przetrwanie alarmu), zamiast ją
    // wyłącznie przestroić. Brak straży dawałby zwycięstwo w ticku postawienia modułu.
    if (!Number.isFinite(config.evacEnergyRequired) || config.evacEnergyRequired <= 0) {
      throw new RangeError(
        `RunConfig.evacEnergyRequired must be finite and positive, got ${config.evacEnergyRequired}`,
      );
    }
    if (!Number.isFinite(config.evacChargeRate) || config.evacChargeRate <= 0) {
      throw new RangeError(
        `RunConfig.evacChargeRate must be finite and positive, got ${config.evacChargeRate}`,
      );
    }
    if (!Number.isFinite(config.evacAlarmSeconds) || config.evacAlarmSeconds <= 0) {
      throw new RangeError(
        `RunConfig.evacAlarmSeconds must be finite and positive, got ${config.evacAlarmSeconds}`,
      );
    }
    if (typeof config.spawn !== 'object' || config.spawn === null) {
      throw new RangeError(`RunConfig.spawn must be a SpawnConfig object, got ${config.spawn}`);
    }
    // Pola `SpawnConfig`. Ta sama droga do `SimState`, co dwa pola wyżej: `rate` z dwóch
    // pierwszych wpływa do `pentagons[].spawnAccumulator`, `eruptionInterval` wprost do
    // `pentagons[].eruptionCooldown`. Wartość zdegenerowana NIE wywala się głośno —
    // `for (k = 0; k < NaN; k++)` to zero iteracji, a `cycle >= NaN` to `false`, więc typ
    // wroga po prostu nigdy się nie pojawia. Faza 3 buduje te konfiguracje programowo dla
    // tysięcy runów i dostałaby ciche śmieci w rozkładach, na których opiera strojenie.
    const spawn = config.spawn;
    if (!Number.isFinite(spawn.baseRatePerPentagon) || spawn.baseRatePerPentagon <= 0) {
      throw new RangeError(
        `RunConfig.spawn.baseRatePerPentagon must be finite and positive, got ${spawn.baseRatePerPentagon}`,
      );
    }
    // `>= 1`, nie „dodatni": mnożnik poniżej 1 znaczyłby, że fale SŁABNĄ z każdym cyklem,
    // co odwraca model narastającego ciśnienia z §5.3. Dokładnie 1 jest legalne — daje
    // tempo stałe, użyteczne jako punkt odniesienia w headlessie Fazy 3.
    if (!Number.isFinite(spawn.growthPerCycle) || spawn.growthPerCycle < 1) {
      throw new RangeError(
        `RunConfig.spawn.growthPerCycle must be finite and at least 1, got ${spawn.growthPerCycle}`,
      );
    }
    // Podłoga jednego ticka, tym samym rozumowaniem co `rotationPeriod` wyżej. Interwał
    // krótszy niż tick znaczy erupcję w KAŻDYM ticku, a `eruptionCooldown` ucieka w minus
    // bez ograniczenia, bo `-= TICK_SECONDS` przeważa nad `+= eruptionInterval`.
    // Zmierzone dla interwału 0,01 s: po 200 tys. ticków cooldown wynosi −8000.
    if (!Number.isFinite(spawn.eruptionInterval) || spawn.eruptionInterval < TICK_SECONDS) {
      throw new RangeError(
        `RunConfig.spawn.eruptionInterval must be at least one tick (${TICK_SECONDS}s), got ${spawn.eruptionInterval} — a shorter interval erupts every tick and drives eruptionCooldown negative without bound`,
      );
    }
    // `>= 1`: erupcja ma wypuścić co najmniej jedną jednostkę. NIE wymagamy całkowitości —
    // `updateSpawning` i tak zaokrągla dopiero ILOCZYN (`eruptionBurstBase × skala`), więc
    // ułamkowa baza jest sensownym pokrętłem strojenia, a nie błędem konfiguracji.
    if (!Number.isFinite(spawn.eruptionBurstBase) || spawn.eruptionBurstBase < 1) {
      throw new RangeError(
        `RunConfig.spawn.eruptionBurstBase must be finite and at least 1, got ${spawn.eruptionBurstBase}`,
      );
    }
    // `>= 0`, w odróżnieniu od pól ewakuacji: zero NIE usuwa tu mechaniki, tylko jej
    // skalowanie — erupcje nadal wybuchają, po prostu nie rosną z liczbą capów. Ujemny
    // odwracałby §5.3 (capowanie ZMNIEJSZałoby erupcje) i mógłby dać ujemny `burst`.
    if (!Number.isFinite(spawn.eruptionScalePerCap) || spawn.eruptionScalePerCap < 0) {
      throw new RangeError(
        `RunConfig.spawn.eruptionScalePerCap must be finite and non-negative, got ${spawn.eruptionScalePerCap}`,
      );
    }
    // Progi cyklu: całkowite >= 1, bo `cycle` jest całkowity i numerowany od 1. `isInteger`
    // odcina przy okazji NaN/Infinity, których `cycle >= x` nie odróżniłoby od „nigdy".
    for (const pole of ['disruptorFromCycle', 'armorFromCycle'] as const) {
      if (!Number.isInteger(spawn[pole]) || spawn[pole] < 1) {
        throw new RangeError(
          `RunConfig.spawn.${pole} must be an integer >= 1, got ${spawn[pole]}`,
        );
      }
    }

    this.config = config;
    this.s = createState(planet, config.startingOre);
    this.waveRng = new Rng(planet.seed).fork(STREAM.WAVES);

    // §5.6: Evac odblokowany dopiero w ostatniej tercji runu. Próg liczony TUTAJ, bo tu
    // — i tylko tu — konfiguracja jest znana, a zapisywany do stanu jako TICK, bo
    // egzekwuje go `canBuild`, która widzi wyłącznie `SimState` (patrz doc-comment
    // `evacUnlockTick` w state.ts). Cykl N zaczyna się po (N-1) pełnych obrotach, stąd
    // `unlockCycle - 1`. `Math.max(0, …)` na wypadek `evacUnlockFraction <= 0`, gdzie
    // `unlockCycle` wychodzi 0 i iloczyn byłby ujemny.
    const unlockCycle = Math.ceil(config.cyclesPerRun * config.evacUnlockFraction);
    const unlockTick = Math.max(
      0,
      Math.ceil(((unlockCycle - 1) * config.rotationPeriod) / TICK_SECONDS),
    );
    // Straż na WYNIKU, nie tylko na wejściach — ten sam idiom i to samo uzasadnienie, co
    // przy `angle` w `sunDirection` (light.ts): każde wejście z osobna może przejść
    // walidację, a iloczyn i tak przepełnić się do Infinity. Zmierzone: `rotationPeriod`
    // rzędu 1e308 jest skończony i większy od ticka, więc przechodzi obie straże wyżej,
    // ale `(unlockCycle − 1) × 1e308` to już Infinity — czyli nieskończoność w `SimState`
    // mimo poprawnej konfiguracji. Straż należy tam, gdzie wartość faktycznie staje się zła.
    if (!Number.isFinite(unlockTick)) {
      throw new RangeError(
        `RunConfig: evacUnlockTick overflowed to a non-finite value — cyclesPerRun=${config.cyclesPerRun}, evacUnlockFraction=${config.evacUnlockFraction}, rotationPeriod=${config.rotationPeriod}`,
      );
    }
    this.s.evacUnlockTick = unlockTick;

    const n = planet.cells.length;
    this.motion = {
      termSpeedCells: terminatorSpeedCells(n, config.rotationPeriod),
      spacing: cellSpacing(planet.radius, n),
      radius: planet.radius,
    };

    // CORE na komórce startowej: punkt wyjścia runu, nie decyzja gracza — więc bez kosztu
    // i WPROST do stanu, nie przez `applyCommand`. `canBuild` odrzuca CORE niezależnie od
    // komórki (`playerBuildable: false`), bo inaczej gracz mnożyłby go za darmo — zmierzone
    // przed wprowadzeniem tej flagi: 50 rdzeni przy zerowej rudzie, bo `CORE.costOre = 0`,
    // a `CELL_OCCUPIED` chroni tylko TĘ SAMĄ komórkę przed drugim CORE, nie planetę przed
    // setnym. Przy warunku przegranej `!buildings.some(b => b?.type === 'CORE')` (§5.6)
    // dawałoby to darmową nieśmiertelność. Ten sam zapis stosują pomocniki testowe Fazy 1B.
    this.s.buildings[planet.startCell] = {
      cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
    };
  }

  get state(): SimState { return this.s; }
  get elapsedSeconds(): number { return this.s.tick * TICK_SECONDS; }
  get cycle(): number { return currentCycle(this.elapsedSeconds, this.config.rotationPeriod); }

  enqueue(cmd: Command): void { this.pending.push(cmd); }

  /**
   * Kolejność systemów jest CZĘŚCIĄ KONTRAKTU DETERMINIZMU (global-constraints.md).
   *
   * **Czego NIE pilnują testy determinizmu.** Wcześniejsza wersja tego komentarza
   * odsyłała do nich — niesłusznie. Porównują one przebieg SAM ZE SOBĄ, więc są zielone
   * pod KAŻDĄ stałą permutacją tych dziesięciu wywołań. Zmierzone osobno dla wszystkich
   * dziewięciu par sąsiednich (10 systemów = 9 ogniw), pełny przebieg 6000 ticków
   * z ekstraktorem, wieżami, panelami i murem, porównanie po `stateHash` i licznikach:
   *
   * | ogniwo | czym przypięte |
   * |---|---|
   * | komendy ↔ oświetlenie | **KOMUTUJE** — `lightField` nie czyta stanu mutowalnego |
   * | oświetlenie ↔ energia | **KOMPILATOR** — TS2448, `light` użyte przed deklaracją |
   * | energia ↔ ekonomia | test `ekstraktor postawiony w tym ticku już w nim wydobywa` |
   * | ekonomia ↔ pola przepływu | **KOMUTUJE** — pola czytają `buildings`, ekonomia pisze `ore` |
   * | pola przepływu ↔ ruch | **KOMPILATOR** — TS2448, `fields` użyte przed deklaracją |
   * | ruch ↔ walka | test `jednostka atakuje z komórki, do której właśnie weszła` |
   * | walka ↔ spalanie | test `jednostka gasnąca od słońca zadaje jeszcze swój ostatni cios` |
   * | spalanie ↔ fale | **KOMUTUJE** — spawn wypuszcza wyłącznie w ciemność (D1), więc
   *   `updateBurning` i tak nic by z nowymi jednostkami nie zrobił (`exposure = 0`) |
   * | fale ↔ warunki końca | **KOMUTUJE** — reguły nie czytają `units` ani `pentagons` |
   *
   * Cztery ogniwa KOMUTUJĄ i jest to **zmierzone, nie domniemane**: zamiana daje hash
   * i liczniki identyczne co do bitu przez cały przebieg. Test behawioralny na takie
   * ogniwo byłby testem, który nie może oblać — dokładnie rodzaj defektu, który ten
   * projekt tropi. NIE PISZ ICH. Same wywołania w zadeklarowanej kolejności pilnuje
   * strukturalnie `kolejność wywołań systemów w źródle step()` (fullrun.test.ts),
   * czytający ten plik.
   */
  step(): void {
    if (this.s.phase !== 'RUNNING') {
      // Kolejka opróżniana TAKŻE tutaj, nie tylko w ścieżce RUNNING niżej. Dwa powody,
      // oba realne w Fazie 5, gdzie klient może wysyłać komendy po końcu meczu:
      //  • kolejka nie rośnie bez ograniczeń (zmierzone przed poprawką: 1000 komend
      //    wysłanych, 1000 wciąż rezydujących),
      //  • komenda zakolejkowana po końcu runu nie może przeleżeć do chwili, w której
      //    faza wróciłaby do RUNNING, i wykonać się z opóźnieniem.
      this.pending.length = 0;
      return;
    }

    // 1. Komendy — zawsze pierwsze, żeby tick widział świat już zmieniony.
    for (const cmd of this.pending) applyCommand(this.s, cmd);
    this.pending.length = 0;

    // 2. Oświetlenie — liczone raz i podawane pozostałym systemom.
    const sun = sunDirection(this.elapsedSeconds, this.config.rotationPeriod);
    const light = lightField(this.s.planet, sun);

    // 3. Energia — musi być przed ekonomią i walką, bo ustawia flagi `powered`.
    updatePower(this.s, light);

    // 4. Ekonomia — po energii, bo wydobycie zależy od flagi `powered`.
    updateEconomy(this.s);

    // 5. Pola przepływu — przeliczane rzadziej niż co tick, zabudowa zmienia się wolno (§4.5).
    // Lokalna `const`, nie `this.fields` z `!`: zawężenie typu z tego `if` nie przenosi się
    // na pole klasy w kolejnych wywołaniach, a `!` uciszyłoby kompilator zamiast rozwiązać
    // problem.
    if (this.fields === null || this.s.tick % FLOWFIELD_INTERVAL_TICKS === 0) {
      this.fields = buildAllFlowFields(this.s);
    }
    const fields = this.fields;

    // 6. Ruch.
    updateMovement(this.s, fields, light, sun, this.motion);

    // 7. Walka — po ruchu, bo jednostka atakuje z komórki, do której właśnie weszła.
    updateCombat(this.s, fields);

    // 8. Spalanie — po walce, bo `updateBurning` nalicza rudę wyłącznie za własne ofiary
    //    i polega na tym, że walka zabrała swoich zabitych wcześniej (patrz burning.ts).
    updateBurning(this.s, light);

    // 9. Fale i spawn.
    updateSpawning(this.s, light, this.waveRng, this.cycle, this.config.spawn);

    // 10. Warunki końca — ostatnie, żeby widziały świat po wszystkich zmianach ticka.
    updateRules(this.s, this.config);

    this.s.tick++;
  }
}
```

> **Uwaga — poprawione po przeglądzie końcowym Fazy 1B.** Wcześniejsza wersja tej notatki
> twierdziła, że „`canBuild` odrzuci drugi CORE przez `CELL_OCCUPIED`, więc zachowanie pozostaje
> poprawne". **To było fałszywe.** `CELL_OCCUPIED` odrzuca drugi CORE wyłącznie NA TEJ SAMEJ
> KOMÓRCE; każdy inny pusty heks przyjmował kolejny za darmo, bo `CORE.costOre = 0`. Zmierzone
> na skompilowanym module: **50 rdzeni przy zerowej rudzie, 500 energii na sekundę.** Przy
> warunku przegranej `!s.buildings.some(b => b?.type === 'CORE')` z §5.6 dawałoby to graczowi
> darmową nieśmiertelność, a w Fazie 5 — niezautentykowanemu graczowi nieskończoną energię
> i nieskończony zasięg sieci.
>
> Faza 1B zamyka to polem `playerBuildable` w `BuildingDef`: `canBuild` odrzuca CORE niezależnie
> od komórki i zasobów. **Konsekwencja dla tego zadania: `Sim` NIE MOŻE stawiać CORE przez
> `applyCommand`** — musi zapisać go wprost do stanu przy konstrukcji.

- [ ] **Step 6: Wystaw publiczne API**

Dopisz do `packages/sim/src/index.ts`:
```ts
export { type RngState } from './math/rng.js';
export { TICK_SECONDS, createState } from './sim/state.js';
export type { Building, BuildingType, EnemyType, Phase, SimState, Unit } from './sim/state.js';
export { stateHash } from './sim/hash.js';
export { BUILDINGS, BROWNOUT_ORDER, ENEMIES, evaluateEnergyOutput } from './sim/defs.js';
export type { BuildingDef, EnemyDef, EnergyOutput } from './sim/defs.js';
export { applyCommand, canBuild } from './sim/commands.js';
export type { Command } from './sim/commands.js';
export { lightAt, lightField, sunDirection } from './sim/light.js';
export { connectedToCore } from './sim/network.js';
export { updatePower } from './sim/power.js';
export { ORE_PER_SECOND, updateEconomy } from './sim/economy.js';
export { buildAllFlowFields, buildFlowField } from './sim/flowfield.js';
export type { FlowField } from './sim/flowfield.js';
export { spawnUnit, updateMovement } from './sim/movement.js';
export type { MotionContext } from './sim/movement.js';
export { cellsWithinSteps, updateCombat } from './sim/combat.js';
export { updateBurning } from './sim/burning.js';
export { DEFAULT_SPAWN, updateSpawning } from './sim/spawning.js';
export type { SpawnConfig } from './sim/spawning.js';
export { DEFAULT_RUN, currentCycle, evacUnlocked, updateRules } from './sim/rules.js';
export type { RunConfig } from './sim/rules.js';
export { Sim } from './sim/loop.js';
```

- [ ] **Step 7: Uruchom pełny zestaw i commituj**

Run: `pnpm test && pnpm typecheck`
Oczekiwane: wszystko zielone.

```bash
git add -A
git commit -m "feat(sim): cykle, ewakuacja, warunki końca i domknięta pętla systemów"
```

---

### Task 6: Headless runner i skryptowa polityka

**Files:**
- Create: `tools/headless/package.json`, `tools/headless/tsconfig.json`
- Create: `tools/headless/src/policy.ts`, `tools/headless/src/report.ts`, `tools/headless/src/run.ts`
- Test: `tools/headless/test/headless.test.ts`

**Interfaces:**
- Consumes: całe `@heliopolis/sim`
- Produces:
  - `class ScriptedPolicy { constructor(sim: Sim); decide(): Command[] }`
  - `interface RunResult { seed, phase, ticks, cycle, peakBuildings, oreMined, killsByTurret, killsBySun, firstDepletionTick }`
  - `function simulateRun(seed: number, cfg: RunConfig, maxTicks: number): RunResult`
  - `function formatReport(results: RunResult[]): string`

**Bez polityki runner jest bezużyteczny** — nikt nie stawia budynków, więc każdy run kończy się identyczną porażką i raport nie niesie żadnej informacji o balansie.

- [ ] **Step 1: Utwórz pakiet**

`tools/headless/package.json`:
```json
{
  "name": "@heliopolis/headless",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "bench": "node --experimental-strip-types src/run.ts" },
  "dependencies": { "@heliopolis/sim": "workspace:*" }
}
```

`tools/headless/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

Uruchom `pnpm install`, żeby dowiązać workspace.

- [ ] **Step 2: Napisz testy (mają nie przejść)**

`tools/headless/test/headless.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN } from '@heliopolis/sim';
import { simulateRun } from '../src/run.js';
import { formatReport } from '../src/report.js';

describe('simulateRun', () => {
  it('każdy run kończy się w skończonej liczbie ticków', () => {
    const r = simulateRun(1, DEFAULT_RUN, 100_000);
    expect(r.phase).not.toBe('RUNNING');
    expect(r.ticks).toBeLessThan(100_000);
  });

  it('polityka faktycznie coś buduje — test antyregresyjny na martwego bota', () => {
    const r = simulateRun(1, DEFAULT_RUN, 100_000);
    expect(r.peakBuildings).toBeGreaterThan(5);
    expect(r.oreMined).toBeGreaterThan(0);
  });

  it('ten sam seed daje identyczny wynik', () => {
    expect(simulateRun(7, DEFAULT_RUN, 50_000)).toEqual(simulateRun(7, DEFAULT_RUN, 50_000));
  });

  it('różne seedy dają różne przebiegi', () => {
    const a = simulateRun(11, DEFAULT_RUN, 50_000);
    const b = simulateRun(12, DEFAULT_RUN, 50_000);
    expect(a).not.toEqual(b);
  });
});

describe('formatReport', () => {
  it('partia 20 runów na tych samych seedach daje identyczny raport', () => {
    const batch = () =>
      formatReport(Array.from({ length: 20 }, (_, i) => simulateRun(i, DEFAULT_RUN, 50_000)));
    expect(batch()).toBe(batch());
  });

  it('raport zawiera pozycje wymagane przez §8.3 specu', () => {
    const text = formatReport(
      Array.from({ length: 5 }, (_, i) => simulateRun(i, DEFAULT_RUN, 50_000)),
    );
    for (const key of ['zwycięstw', 'porażki', 'wyczerpanie', 'słońce', 'wieże']) {
      expect(text).toContain(key);
    }
  });
});
```

- [ ] **Step 3: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run tools/headless/test/headless.test.ts`
Oczekiwane: FAIL — brak modułów.

- [ ] **Step 4: Zaimplementuj politykę**

`tools/headless/src/policy.ts`:
```ts
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
```

- [ ] **Step 5: Zaimplementuj runner i raport**

`tools/headless/src/run.ts`:
```ts
import {
  createPlanet,
  DEFAULT_RUN,
  lightAt,
  Sim,
  sunDirection,
  type Phase,
  type RunConfig,
} from '@heliopolis/sim';
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

/** Bot podejmuje decyzję co sekundę, nie co tick — inaczej stawiałby budynki szybciej, niż zarabia. */
const DECISION_INTERVAL_TICKS = 20;

export function simulateRun(seed: number, cfg: RunConfig, maxTicks: number): RunResult {
  const planet = createPlanet({ seed });
  const sim = new Sim(planet, cfg);
  const policy = new ScriptedPolicy(sim);

  const capacities = planet.cells.map((c) => c.oreCapacity);
  let peakBuildings = 0;
  let firstDepletionTick = -1;
  let prevUnits = 0;
  let killsBySun = 0;
  let killsByTurret = 0;
  let ticks = 0;

  while (sim.state.phase === 'RUNNING' && ticks < maxTicks) {
    if (ticks % DECISION_INTERVAL_TICKS === 0) {
      for (const cmd of policy.decide()) sim.enqueue(cmd);
    }

    const litBefore = countLitUnits(sim, cfg);
    sim.step();
    ticks++;

    const now = sim.state.units.length;
    const died = Math.max(0, prevUnits - now);
    // Przybliżenie: ubytek wśród jednostek stojących w świetle przypisujemy słońcu.
    const sunShare = Math.min(died, litBefore);
    killsBySun += sunShare;
    killsByTurret += died - sunShare;
    prevUnits = now;

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
    killsBySun,
    killsByTurret,
    firstDepletionTick,
  };
}

/**
 * Jednostki stojące w świetle na początku ticka. Liczone po jednostkach, nie po komórkach —
 * pełne lightField to 1442 obliczenia na tick, a jednostek jest rząd wielkości mniej.
 */
function countLitUnits(sim: Sim, cfg: RunConfig): number {
  const sun = sunDirection(sim.elapsedSeconds, cfg.rotationPeriod);
  const cells = sim.state.planet.cells;
  let n = 0;
  for (const u of sim.state.units) {
    if (lightAt(cells[u.cellId].normal, sun) > 0) n++;
  }
  return n;
}

// Wejście CLI: node --experimental-strip-types src/run.ts [liczbaRunów] [pierwszySeed]
if (process.argv[1]?.endsWith('run.ts')) {
  const count = Number(process.argv[2] ?? 1000);
  const first = Number(process.argv[3] ?? 0);
  const results: RunResult[] = [];
  for (let i = 0; i < count; i++) results.push(simulateRun(first + i, DEFAULT_RUN, 100_000));
  console.log(formatReport(results));
}
```

`tools/headless/src/report.ts`:
```ts
import { TICK_SECONDS } from '@heliopolis/sim';
import type { RunResult } from './run.js';

/** Raport rozkładów wymagany przez §8.3 specu. */
export function formatReport(results: RunResult[]): string {
  const n = results.length;
  const wins = results.filter((r) => r.phase === 'VICTORY').length;
  const defeats = results.filter((r) => r.phase === 'DEFEAT');

  const lines: string[] = [];
  lines.push(`runów: ${n}`);
  lines.push(`zwycięstw: ${wins} (${pct(wins / n)})`);
  lines.push('');
  lines.push(`moment porażki [s]  ${quantiles(defeats.map((r) => r.ticks * TICK_SECONDS))}`);
  lines.push(`cykl porażki        ${quantiles(defeats.map((r) => r.cycle))}`);
  lines.push(`szczyt zabudowy     ${quantiles(results.map((r) => r.peakBuildings))}`);
  lines.push(`wydobyta ruda       ${quantiles(results.map((r) => r.oreMined))}`);
  lines.push('');

  const depleted = results.filter((r) => r.firstDepletionTick >= 0);
  lines.push(
    `wyczerpanie 1. złoża: ${pct(depleted.length / n)} runów, ` +
      `czas [s] ${quantiles(depleted.map((r) => r.firstDepletionTick * TICK_SECONDS))}`,
  );

  const sun = results.reduce((a, r) => a + r.killsBySun, 0);
  const turret = results.reduce((a, r) => a + r.killsByTurret, 0);
  const total = sun + turret;
  lines.push(
    `ubite przez słońce: ${total === 0 ? 'n/d' : pct(sun / total)} · ` +
      `przez wieże: ${total === 0 ? 'n/d' : pct(turret / total)}`,
  );

  return lines.join('\n');
}

function pct(v: number): string {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/d';
}

function quantiles(values: number[]): string {
  if (values.length === 0) return 'brak danych';
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return `p10=${fmt(at(0.1))} p50=${fmt(at(0.5))} p90=${fmt(at(0.9))}`;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
```

- [ ] **Step 6: Uruchom testy, wykonaj pierwszą partię i commituj**

```bash
pnpm test
pnpm --filter @heliopolis/headless bench 1000 0
```

Pierwszy raport zapisz do `docs/superpowers/plans/pierwszy-raport-balansu.txt`. Nie ma być dobry — ma **istnieć** i być powtarzalny. To on wyznacza pracę Fazy 3.

> **Zakres słowa „powtarzalny" — przeczytaj, zanim oprzesz coś na tym raporcie.** Powtarzalny
> znaczy tu: **ten sam proces i ta sama maszyna**, dwa przebiegi z tymi samymi seedami dają
> identyczne liczby. Mocniejszego twierdzenia — że ten sam seed da te same liczby na cudzym
> komputerze albo w CI — **ten plan NIE stawia** i Faza 3 nie może go założyć bez sprawdzenia.
> Powód jest zapisany w komentarzu nad `lightField` w `packages/sim/src/sim/light.ts`:
> `Math.cos`/`Math.sin` to przybliżenia zależne od silnika JS, a ECMAScript nie gwarantuje
> wyniku co do bitu między platformami. Tłumienie przez `Float32Array` większość rozbieżności
> zjada, ale **nie wszystkie** — zmierzona resztka jest w tamtym komentarzu. Dlatego test
> determinizmu w Tasku 5 porównuje dwa przebiegi w jednym procesie (`expect(run()).toBe(run())`),
> a nie przypięty literał hasza. Nie zamieniaj go na literał bez rozstrzygnięcia tej kwestii.

```bash
git add -A
git commit -m "feat(headless): runner balansowy ze skryptową polityką i raportem rozkładów (§8.3)"
```

---

## Definicja ukończenia Fazy 1

- [ ] `pnpm test` zielony, `pnpm typecheck` bez błędów, strażnik zero-zależności nadal przechodzi
- [ ] Determinizm potwierdzony na pełnym runie przez 8000 ticków, nie tylko na modułach
- [ ] Run przechodzi się bez renderu od startu do porażki albo zwycięstwa
- [ ] Headless runner wykonuje 1000 runów i wypisuje raport rozkładów powtarzalny **w tym samym procesie i na tej samej maszynie** (zakres tego słowa — patrz ramka w Tasku 6)
- [ ] Niezmiennik N3 zweryfikowany na żywej symulacji: ARMOR ginie, SWARM ucieka z tej samej pozycji
- [ ] D3 zweryfikowane: CORE w pełnym pierścieniu barykad pozostaje osiągalny
- [ ] D1 zweryfikowane: oświetlony pentagon nie spawnuje, oświetlona jest zawsze ~połowa planety
- [ ] §5.3 zweryfikowane: 12 zatkanych capów nadal generuje zagrożenie — `allCapsOverloadTimeSeconds` jest zbędne
- [ ] Wszystkie liczby balansowe oznaczone `// [STROJENIE]`
- [ ] **Q2, Q3 i Q4 przeniesione w §11 specu z „otwarte" do rozstrzygniętych**, z uzasadnieniem z sekcji Global Constraints tego planu
- [ ] `docs/superpowers/plans/pierwszy-raport-balansu.txt` istnieje i jest powtarzalny w powyższym zakresie

**Następna faza:** Faza 2 — warstwa renderu i sterowania. Plan powstaje **po** Fazie 0, bo to jej wynik rozstrzyga model kamery (Q1).

---

## Czego ta faza świadomie NIE obejmuje

- **§5.5 (pętla roguelite, draft 1 z 3 co świt)** — należy do Fazy 3. Faza 1 buduje symulację, na której da się zmierzyć balans; sama pętla meta nie ma czego mierzyć, dopóki ta symulacja nie działa.
- **Optymalizacja sieci energetycznej do inkrementalnego union-find** (§5.1) — Faza 3. Obecna implementacja jest poprawna i wystarczająco szybka; przepisanie musi przejść pod tymi samymi testami.
- **Cache zasięgów wież** — Faza 3. `cellsWithinSteps` przelicza BFS co tick; przy zasięgu ≤ 3 to ≤ 37 komórek na wieżę i nie jest to wąskie gardło.
- **Zaćmienia (Q8)** — Faza 4 albo cięcie.
