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
  - `interface PentagonState { spawnAccumulator: number; eruptionCooldown: number }` (w `state.ts`)
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

function run(s: ReturnType<typeof fresh>, light: Float32Array, seconds: number, cycle = 1) {
  const rng = new Rng(999).fork(STREAM.WAVES);
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

    // D1: pentagon w świetle jest martwy, niezależnie od wszystkiego innego.
    if (light[cellId] > 0) continue;

    const capped = s.buildings[cellId]?.type === 'GEOTHERMAL_CAP';

    if (capped) {
      // §5.3: cap PRZEKIEROWUJE spawn zamiast go kasować.
      // Strumień ustaje, ale ciśnienie wraca jako okresowa erupcja w tym samym miejscu,
      // rosnąca z liczbą capów — czyli gracz sam ściąga sobie bombę pod dom.
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
  /** Zgromadzona energia w Module Ewakuacyjnym. Zerowana przy jego zniszczeniu (§5.6). */
  evacCharge: number;
  /** Sekundy do końca alarmu. -1 = alarm nieaktywny. */
  evacAlarmRemaining: number;
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

describe('currentCycle', () => {
  it('zaczyna od cyklu 1 i przełącza się co pełny obrót', () => {
    expect(currentCycle(0, 180)).toBe(1);
    expect(currentCycle(179, 180)).toBe(1);
    expect(currentCycle(180, 180)).toBe(2);
    expect(currentCycle(540, 180)).toBe(4);
  });
});

describe('evacUnlocked', () => {
  it('otwiera się dopiero w ostatniej tercji runu (§5.6)', () => {
    expect(evacUnlocked(1, cfg)).toBe(false);
    expect(evacUnlocked(Math.ceil(cfg.cyclesPerRun * 0.5), cfg)).toBe(false);
    expect(evacUnlocked(cfg.cyclesPerRun, cfg)).toBe(true);
  });
});

describe('updateRules', () => {
  it('utrata CORE kończy run porażką', () => {
    const s = withCore();
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

  it('pełne naładowanie uruchamia alarm, a przetrwanie alarmu daje zwycięstwo', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: true };
    s.evacCharge = cfg.evacEnergyRequired;

    updateRules(s, cfg);
    expect(s.evacAlarmRemaining).toBeGreaterThan(0);
    expect(s.phase).toBe('RUNNING');

    const ticks = Math.ceil(cfg.evacAlarmSeconds / TICK_SECONDS) + 1;
    for (let i = 0; i < ticks; i++) updateRules(s, cfg);
    expect(s.phase).toBe('VICTORY');
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
});
```

`packages/sim/test/fullrun.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { Sim } from '../src/sim/loop.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';
import { stateHash } from '../src/sim/hash.js';

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
    if (s.evacAlarmRemaining <= 0) s.phase = 'VICTORY';
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
    this.config = config;
    this.s = createState(planet, config.startingOre);
    this.waveRng = new Rng(planet.seed).fork(STREAM.WAVES);

    const n = planet.cells.length;
    this.motion = {
      termSpeedCells: terminatorSpeedCells(n, config.rotationPeriod),
      spacing: cellSpacing(planet.radius, n),
      radius: planet.radius,
    };

    // CORE na komórce startowej: punkt wyjścia runu, nie decyzja gracza — więc bez kosztu
    // i WPROST do stanu, nie przez `applyCommand`. `canBuild` odrzuca CORE niezależnie od
    // komórki (`playerBuildable: false`), bo inaczej gracz mnożyłby go za darmo — patrz
    // notatka pod tym blokiem. Ten sam zapis stosują pomocniki testowe Fazy 1B.
    this.s.buildings[planet.startCell] = {
      cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
    };
  }

  get state(): SimState { return this.s; }
  get elapsedSeconds(): number { return this.s.tick * TICK_SECONDS; }
  get cycle(): number { return currentCycle(this.elapsedSeconds, this.config.rotationPeriod); }

  enqueue(cmd: Command): void { this.pending.push(cmd); }

  /**
   * Kolejność systemów jest CZĘŚCIĄ KONTRAKTU DETERMINIZMU.
   * Zmiana kolejności zmienia wynik gry przy tym samym seedzie — nie wolno jej ruszać
   * bez aktualizacji testów determinizmu.
   */
  step(): void {
    if (this.s.phase !== 'RUNNING') {
      // Kolejka opróżniana TAKŻE tutaj. Komenda zakolejkowana po końcu runu nie może
      // przeleżeć do chwili, w której stan wróciłby do RUNNING, i wykonać się z opóźnieniem.
      this.pending.length = 0;
      return;
    }

    for (const cmd of this.pending) applyCommand(this.s, cmd);
    this.pending.length = 0;

    const sun = sunDirection(this.elapsedSeconds, this.config.rotationPeriod);
    const light = lightField(this.s.planet, sun);

    updatePower(this.s, light);
    updateEconomy(this.s);

    // Pola przepływu przeliczane rzadziej niż co tick — zabudowa zmienia się wolno (§4.5).
    if (this.fields === null || this.s.tick % FLOWFIELD_INTERVAL_TICKS === 0) {
      this.fields = buildAllFlowFields(this.s);
    }

    updateMovement(this.s, this.fields, light, sun, this.motion);
    updateCombat(this.s, this.fields);
    updateBurning(this.s, light);
    updateSpawning(this.s, light, this.waveRng, this.cycle, this.config.spawn);
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
