# Faza 1B — Rdzeń symulacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przechodzalna gra bez jednej linijki kodu renderującego — deterministyczna symulacja 20 Hz z oświetleniem, pathfindingiem, energią, ekonomią, walką i warunkami końca, plus headless runner, który przepuszcza tysiące runów i zwraca rozkłady balansowe.

**Architecture:** Wszystko w `@heliopolis/sim`, zbudowane na `Planet` z Fazy 1A. Wejście wyłącznie przez kolejkę komend, stan w pełni serializowalny, krok stały i niezależny od czasu ściennego. Ten sam moduł uruchamiany będzie później po stronie serwera jako autorytet (Faza 5) — dlatego zero I/O, zero zegara systemowego, zero `Math.random`.

**Tech Stack:** TypeScript (strict), Vitest, pnpm workspaces, Node ≥ 22. **Zero zależności runtime w `packages/sim`.**

**Spec:** [`docs/superpowers/specs/2026-09-14-project-heliopolis-design.md`](../specs/2026-09-14-project-heliopolis-design.md) — §4.3, §4.4, §4.5, §5.1–§5.6, §6, §7.1, §7.2, §8.3, §8.4.

**Wymaga ukończonej Fazy 1A** ([`2026-09-14-faza-1a-swiat.md`](2026-09-14-faza-1a-swiat.md)).

---

## Dwie rzeczy wyniesione z przeglądu końcowego Fazy 1A

Obie są tanie teraz i drogie później, bo dotyczą kształtu API, wokół którego ta faza zastygnie.

**`Rng` musi dostać snapshot i restore — w Task 1, razem ze stanem.** Dzisiejszy `Rng` trzyma
stan w `private readonly s` i nie da się go ani odczytać, ani odtworzyć. Faza 1C umieszcza
strumień fal na obiekcie `Sim`, a nie w `SimState`, więc `stateHash` go nie obejmuje. Dla testu
determinizmu startującego od ticka 0 to bez znaczenia — i niewidoczne aż do pierwszej rzeczy,
która od ticka 0 nie startuje: zapisu gry, dołączenia klienta, resynchronizacji autorytatywnego
snapshotu w Fazie 5. Wtedy odtworzenie `SimState` restartuje strumień fal od pozycji zero
i rozjeżdża spawny wobec serwera. Dodaj `getState()` i `fromState()` do `Rng`, i **rozstrzygnij
jawnie**, czy generatory symulacji mieszkają w `SimState` — to jest decyzja, nie szczegół.

**`multiSourceDistances` zwraca `Infinity` dla nieosiągalnych, a `JSON.stringify(Infinity)`
daje `null`.** W Fazie 1A nieszkodliwe, bo `Planet` nie przechowuje żadnych odległości. Ale
Task 5 (sieć energetyczna) i Task 8 (pola przepływu) tej fazy wołają tę funkcję, a `SimState`
ma być **w pełni serializowalny**. W momencie, w którym którykolwiek wynik BFS-a zostanie
zapisany do stanu, snapshot i restore po cichu go uszkodzą — `Infinity` wróci jako `null`,
a `null` w arytmetyce da `0`, czyli „osiągalne w zero kroków". Albo wprowadź sentinel `-1`,
albo zapisz jako twardą regułę, że wynik BFS-a nigdy nie wchodzi do `SimState`.

---

## Global Constraints

- **Zero zależności runtime w `packages/sim`** — strażnik z Fazy 1A Task 1 musi zostać zielony.
- **Determinizm (§7.2):** ten sam seed + ta sama kolejka komend ⇒ ten sam hash stanu po N tickach. Egzekwowane testem w Task 1.
- **Stały krok 20 Hz** (`TICK_SECONDS = 0.05`). Żadnych odwołań do `Date.now`, `performance.now`, `Math.random`.
- **Iteracja po encjach tylko po rosnącym indeksie.** Budynki trzymane w tablicy indeksowanej `cellId`, nigdy w `Map` z usuwaniem — kolejność iteracji nie może zależeć od historii wstawień.
- **Wszystkie zasięgi w krokach grafu (N1).** Jednostki świata wyłącznie tam, gdzie liczona jest pozycja na sferze.
- **Prędkości wroga jako krotność prędkości terminatora (§6.2)**, nigdy jako wartości bezwzględne — inaczej niezmiennik N3 rozjedzie się przy zmianie `T` lub `N`.
- **Każda liczba balansowa oznaczona w kodzie komentarzem `// [STROJENIE]`.** Faza 3 wyznaczy je headlessem; do tego czasu są jawnie prowizoryczne.
- Commit po każdym zadaniu.

---

### Task 1: Stan symulacji, snapshot i hash determinizmu

**Files:**
- Create: `packages/sim/src/sim/state.ts`, `packages/sim/src/sim/hash.ts`
- Test: `packages/sim/test/state.test.ts`

**Interfaces:**
- Consumes: `Planet`, `createPlanet` z Fazy 1A
- Produces:
  - `const TICK_SECONDS = 0.05`
  - `type Phase = 'RUNNING' | 'VICTORY' | 'DEFEAT'`
  - `interface Building { cellId: number; type: BuildingType; hp: number; powered: boolean }`
  - `interface Unit { id: number; type: EnemyType; cellId: number; pos: Vec3; hp: number; exposure: number }`
  - `interface SimState { tick, planet, ore, storedEnergy, buildings: (Building|null)[], oreRemaining: number[], units: Unit[], nextUnitId, phase }`
  - `function createState(planet: Planet, startingOre: number): SimState`
  - `function stateHash(s: SimState): string`

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/state.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { stateHash } from '../src/sim/hash.js';

const planet = createPlanet({ seed: 1 });

describe('createState', () => {
  it('startuje z zadaną rudą i pustą planszą', () => {
    const s = createState(planet, 150);
    expect(s.tick).toBe(0);
    expect(s.ore).toBe(150);
    expect(s.phase).toBe('RUNNING');
    expect(s.units).toEqual([]);
    expect(s.buildings.filter((b) => b !== null)).toEqual([]);
  });

  it('kopiuje pojemność złóż do mutowalnego stanu, nie dzieli referencji z planetą', () => {
    const s = createState(planet, 150);
    expect(s.oreRemaining.length).toBe(planet.cells.length);
    s.oreRemaining[planet.startCell] = 999;
    expect(planet.cells[planet.startCell].oreCapacity).not.toBe(999);
  });

  it('krok symulacji to dokładnie 20 Hz', () => {
    expect(TICK_SECONDS).toBe(0.05);
    expect(1 / TICK_SECONDS).toBe(20);
  });
});

describe('stateHash', () => {
  it('identyczne stany dają identyczny hash', () => {
    expect(stateHash(createState(planet, 150))).toBe(stateHash(createState(planet, 150)));
  });

  it('zmiana JAKIEJKOLWIEK wartości zmienia hash', () => {
    const base = createState(planet, 150);
    const h = stateHash(base);

    const a = createState(planet, 150); a.ore = 151;
    const b = createState(planet, 150); b.tick = 1;
    const c = createState(planet, 150); c.storedEnergy = 0.0001;
    const d = createState(planet, 150); d.oreRemaining[0] += 1;

    for (const variant of [a, b, c, d]) {
      expect(stateHash(variant)).not.toBe(h);
    }
  });

  it('wykrywa różnicę zmiennoprzecinkową poniżej progu widoczności', () => {
    const a = createState(planet, 150); a.storedEnergy = 1;
    const b = createState(planet, 150); b.storedEnergy = 1 + Number.EPSILON;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/state.test.ts`
Oczekiwane: FAIL — brak modułów.

- [ ] **Step 3: Zaimplementuj stan**

`packages/sim/src/sim/state.ts`:
```ts
import type { Vec3 } from '../math/vec3.js';
import type { Planet } from '../world/planet.js';

/** Stały krok symulacji: 20 Hz. Nigdy nie wiązać z czasem ściennym (§7.2). */
export const TICK_SECONDS = 0.05;

export type Phase = 'RUNNING' | 'VICTORY' | 'DEFEAT';

export type BuildingType =
  | 'CORE' | 'BARRICADE' | 'PYLON' | 'SOLAR_PANEL' | 'BATTERY'
  | 'EXTRACTOR' | 'KINETIC_TURRET' | 'LASER_TURRET'
  | 'GEOTHERMAL_CAP' | 'EVACUATION_MODULE';

export type EnemyType = 'SWARM' | 'ARMOR' | 'DISRUPTOR';

export interface Building {
  cellId: number;
  type: BuildingType;
  hp: number;
  /** Ustawiane co tick przez system energii (Task 6). */
  powered: boolean;
}

export interface Unit {
  id: number;
  type: EnemyType;
  /** Komórka, w której jednostka aktualnie się znajduje. Aktualizowana lokalnie (Task 9). */
  cellId: number;
  pos: Vec3;
  hp: number;
  /** Skumulowany czas w świetle, w sekundach (§4.4). */
  exposure: number;
}

export interface SimState {
  tick: number;
  /** Niemutowalna. Wszystko, co się zmienia, żyje obok niej. */
  planet: Planet;
  ore: number;
  storedEnergy: number;
  /** Indeksowane cellId. Tablica, NIE Map — kolejność iteracji nie może zależeć od historii wstawień. */
  buildings: (Building | null)[];
  oreRemaining: number[];
  units: Unit[];
  nextUnitId: number;
  phase: Phase;
}

export function createState(planet: Planet, startingOre: number): SimState {
  return {
    tick: 0,
    planet,
    ore: startingOre,
    storedEnergy: 0,
    buildings: new Array<Building | null>(planet.cells.length).fill(null),
    oreRemaining: planet.cells.map((c) => c.oreCapacity),
    units: [],
    nextUnitId: 1,
    phase: 'RUNNING',
  };
}
```

- [ ] **Step 4: Zaimplementuj hash**

`packages/sim/src/sim/hash.ts`:
```ts
import type { SimState } from './state.js';

/**
 * FNV-1a nad kanoniczną serializacją stanu mutowalnego.
 * Liczby zmiennoprzecinkowe hashowane po bitach, nie po reprezentacji dziesiętnej —
 * test determinizmu ma wykrywać różnice na poziomie ULP, nie dopiero na drugim miejscu po przecinku.
 */
export function stateHash(s: SimState): string {
  const h = new Fnv();

  h.int(s.tick);
  h.float(s.ore);
  h.float(s.storedEnergy);
  h.str(s.phase);
  h.int(s.nextUnitId);

  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b === null) continue;
    h.int(i);
    h.str(b.type);
    h.float(b.hp);
    h.int(b.powered ? 1 : 0);
  }

  for (let i = 0; i < s.oreRemaining.length; i++) {
    if (s.oreRemaining[i] === 0) continue;
    h.int(i);
    h.float(s.oreRemaining[i]);
  }

  for (const u of s.units) {
    h.int(u.id);
    h.str(u.type);
    h.int(u.cellId);
    h.float(u.pos.x); h.float(u.pos.y); h.float(u.pos.z);
    h.float(u.hp);
    h.float(u.exposure);
  }

  return h.digest();
}

class Fnv {
  private hash = 0x811c9dc5;
  private readonly buf = new DataView(new ArrayBuffer(8));

  private byte(b: number): void {
    this.hash ^= b & 0xff;
    this.hash = Math.imul(this.hash, 0x01000193) >>> 0;
  }

  int(v: number): void {
    this.buf.setInt32(0, v | 0);
    for (let i = 0; i < 4; i++) this.byte(this.buf.getUint8(i));
  }

  float(v: number): void {
    this.buf.setFloat64(0, v);
    for (let i = 0; i < 8; i++) this.byte(this.buf.getUint8(i));
  }

  str(v: string): void {
    for (let i = 0; i < v.length; i++) this.byte(v.charCodeAt(i));
    this.byte(0);
  }

  digest(): string {
    return (this.hash >>> 0).toString(16).padStart(8, '0');
  }
}
```

- [ ] **Step 5: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/state.test.ts`
Oczekiwane: **6 testów przechodzi.**

```bash
git add packages/sim/src/sim packages/sim/test/state.test.ts
git commit -m "feat(sim): kształt stanu symulacji + hash FNV-1a do testów determinizmu"
```

---

### Task 2: Baza danych obiektów

**Files:**
- Create: `packages/sim/src/sim/defs.ts`
- Test: `packages/sim/test/defs.test.ts`

**Interfaces:**
- Consumes: `BuildingType`, `EnemyType` ze `./state.js`
- Produces:
  - `type EnergyOutput = { kind: 'NONE' } | { kind: 'CONSTANT'; rate: number } | { kind: 'SOLAR'; peakRate: number }`
  - `function evaluateEnergyOutput(out: EnergyOutput, light: number): number`
  - `interface BuildingDef { … }`, `const BUILDINGS: Record<BuildingType, BuildingDef>`
  - `interface EnemyDef { … }`, `const ENEMIES: Record<EnemyType, EnemyDef>`
  - `const BROWNOUT_ORDER: BuildingType[]`

Spec §6 wymaga **jednolitego schematu produkcji energii** — draft używał trzech różnych nazw pól na to samo pojęcie. Tutaj jest jedno pole `energyOutput` i jedna funkcja ewaluacji przyjmująca kontekst oświetlenia.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/defs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BROWNOUT_ORDER, BUILDINGS, ENEMIES, evaluateEnergyOutput } from '../src/sim/defs.js';

describe('evaluateEnergyOutput', () => {
  it('NONE nie produkuje nic', () => {
    expect(evaluateEnergyOutput({ kind: 'NONE' }, 1)).toBe(0);
  });

  it('CONSTANT ignoruje oświetlenie', () => {
    expect(evaluateEnergyOutput({ kind: 'CONSTANT', rate: 25 }, 0)).toBe(25);
    expect(evaluateEnergyOutput({ kind: 'CONSTANT', rate: 25 }, 1)).toBe(25);
  });

  it('SOLAR jest CIĄGŁY, nie binarny (§5.1)', () => {
    const out = { kind: 'SOLAR', peakRate: 40 } as const;
    expect(evaluateEnergyOutput(out, 1)).toBe(40);
    expect(evaluateEnergyOutput(out, 0.5)).toBe(20);
    expect(evaluateEnergyOutput(out, 0)).toBe(0);
  });
});

describe('BUILDINGS', () => {
  it('zawiera wszystkie 10 typów ze specu, w tym nowy BARRICADE', () => {
    expect(Object.keys(BUILDINGS).sort()).toEqual([
      'BARRICADE', 'BATTERY', 'CORE', 'EVACUATION_MODULE', 'EXTRACTOR',
      'GEOTHERMAL_CAP', 'KINETIC_TURRET', 'LASER_TURRET', 'PYLON', 'SOLAR_PANEL',
    ]);
  });

  it('BARRICADE jest czysto-HP: nie pobiera energii i jej nie produkuje', () => {
    expect(BUILDINGS.BARRICADE.energyDrain).toBe(0);
    expect(BUILDINGS.BARRICADE.energyOutput.kind).toBe('NONE');
  });

  it('GEOTHERMAL_CAP wolno stawiać wyłącznie na pentagonie', () => {
    expect(BUILDINGS.GEOTHERMAL_CAP.allowedCells).toBe('PENTAGON');
  });

  it('EXTRACTOR wolno stawiać wyłącznie na złożu', () => {
    expect(BUILDINGS.EXTRACTOR.allowedCells).toBe('ORE_HEXAGON');
  });

  it('wszystkie zasięgi są małymi liczbami — to kroki grafu, nie metry (N1)', () => {
    for (const def of Object.values(BUILDINGS)) {
      expect(def.range).toBeLessThanOrEqual(6);
      expect(def.connectionRadius).toBeLessThanOrEqual(6);
    }
  });
});

describe('BROWNOUT_ORDER', () => {
  it('gasi ekstraktory PRZED obroną — draft miał to odwrotnie (§5.1)', () => {
    expect(BROWNOUT_ORDER).toEqual(['EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET']);
  });

  it('nie zawiera PYLON ani BARRICADE', () => {
    expect(BROWNOUT_ORDER).not.toContain('PYLON');
    expect(BROWNOUT_ORDER).not.toContain('BARRICADE');
  });

  it('każdy wpis odpowiada budynkowi, który faktycznie pobiera energię', () => {
    for (const t of BROWNOUT_ORDER) expect(BUILDINGS[t].energyDrain).toBeGreaterThan(0);
  });
});

describe('ENEMIES', () => {
  it('prędkości są krotnością prędkości terminatora, nie wartościami bezwzględnymi (§6.2)', () => {
    for (const def of Object.values(ENEMIES)) {
      expect(def.speedFactor).toBeGreaterThan(0);
      expect(def.speedFactor).toBeLessThan(10);
    }
  });

  it('ARMOR jest WOLNIEJSZY od terminatora — nigdy nie ucieka ze światła (§4.4)', () => {
    expect(ENEMIES.ARMOR.speedFactor).toBeLessThan(1);
  });

  it('SWARM i DISRUPTOR są szybsze od terminatora', () => {
    expect(ENEMIES.SWARM.speedFactor).toBeGreaterThan(1);
    expect(ENEMIES.DISRUPTOR.speedFactor).toBeGreaterThan(1);
  });

  it('każdy typ ma inny priorytet celu', () => {
    const priorities = Object.values(ENEMIES).map((e) => e.targetPriority);
    expect(new Set(priorities).size).toBe(3);
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/defs.test.ts`
Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj bazę danych**

`packages/sim/src/sim/defs.ts`:
```ts
import type { BuildingType, EnemyType } from './state.js';

/**
 * Jednolity schemat produkcji energii (§6 specu).
 * Draft miał trzy różne nazwy pól na to samo pojęcie — tutaj jest jedno pole
 * i jedna funkcja ewaluacji przyjmująca kontekst oświetlenia.
 */
export type EnergyOutput =
  | { kind: 'NONE' }
  | { kind: 'CONSTANT'; rate: number }
  | { kind: 'SOLAR'; peakRate: number };

/** `light` to saturate(dot(normal, sunDir)) ∈ [0, 1]. */
export function evaluateEnergyOutput(out: EnergyOutput, light: number): number {
  switch (out.kind) {
    case 'NONE': return 0;
    case 'CONSTANT': return out.rate;
    case 'SOLAR': return out.peakRate * light;
  }
}

export type CellRequirement = 'ANY' | 'HEXAGON' | 'PENTAGON' | 'ORE_HEXAGON';

export interface BuildingDef {
  hp: number;
  costOre: number;
  /** Jednostki energii na sekundę. 0 = nie pobiera. */
  energyDrain: number;
  energyOutput: EnergyOutput;
  energyStorage: number;
  allowedCells: CellRequirement;
  /** Kroki grafu. 0 = nie przenosi energii (N1). */
  connectionRadius: number;
  /** Kroki grafu. 0 = nie strzela (N1). */
  range: number;
  dps: number;
  targeting: 'NONE' | 'SINGLE' | 'AOE';
  /** Czy budynek liczy się jako cel dla DISRUPTOR-a (§4.5). */
  energyInfrastructure: boolean;
}

// Wszystkie liczby poniżej: [STROJENIE] — wyznaczy je headless runner w Fazie 3.
export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  CORE: {
    hp: 1000, costOre: 0, energyDrain: 0, energyOutput: { kind: 'CONSTANT', rate: 10 },
    energyStorage: 200, allowedCells: 'HEXAGON', connectionRadius: 3, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true,
  },
  BARRICADE: {
    // Tani blok czysto-HP. Bez niego mechanika blokowania (D3) nie ma czym operować,
    // bo najtańszym blokerem byłby PYLON, który jest jednocześnie szkieletem sieci.
    hp: 150, costOre: 8, energyDrain: 0, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 0, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: false,
  },
  PYLON: {
    hp: 80, costOre: 15, energyDrain: 0.5, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 3, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true,
  },
  SOLAR_PANEL: {
    // peakRate podniesiony wobec draftu: średnia z saturate(cos) po obrocie
    // to 1/π ≈ 0,318, a nie 0,5 (§5.1).
    hp: 100, costOre: 25, energyDrain: 0, energyOutput: { kind: 'SOLAR', peakRate: 40 },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 1, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true,
  },
  BATTERY: {
    hp: 150, costOre: 40, energyDrain: 0, energyOutput: { kind: 'NONE' },
    energyStorage: 600, allowedCells: 'HEXAGON', connectionRadius: 2, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true,
  },
  EXTRACTOR: {
    hp: 120, costOre: 30, energyDrain: 5, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'ORE_HEXAGON', connectionRadius: 1, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: false,
  },
  KINETIC_TURRET: {
    hp: 200, costOre: 50, energyDrain: 3, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 1, range: 2,
    dps: 25, targeting: 'SINGLE', energyInfrastructure: false,
  },
  LASER_TURRET: {
    hp: 250, costOre: 100, energyDrain: 12, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 1, range: 3,
    dps: 60, targeting: 'AOE', energyInfrastructure: false,
  },
  GEOTHERMAL_CAP: {
    hp: 300, costOre: 75, energyDrain: 0, energyOutput: { kind: 'CONSTANT', rate: 25 },
    energyStorage: 0, allowedCells: 'PENTAGON', connectionRadius: 2, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true,
  },
  EVACUATION_MODULE: {
    hp: 2000, costOre: 300, energyDrain: 0, energyOutput: { kind: 'NONE' },
    energyStorage: 0, allowedCells: 'HEXAGON', connectionRadius: 2, range: 0,
    dps: 0, targeting: 'NONE', energyInfrastructure: true,
  },
};

/**
 * Kolejność gaszenia przy niedoborze energii (§5.1).
 * OBRONA GAŚNIE OSTATNIA — draft miał to odwrotnie, co dawało spiralę śmierci.
 * PYLON pominięty celowo: wyłączenie go rozspójniłoby sieć, czyli pogłębiło niedobór.
 */
export const BROWNOUT_ORDER: BuildingType[] = ['EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET'];

export interface EnemyDef {
  hp: number;
  /**
   * KROTNOŚĆ prędkości terminatora, nie wartość bezwzględna (§6.2).
   * < 1 oznacza, że jednostka nigdy nie ucieknie ze światła (niezmiennik N3).
   */
  speedFactor: number;
  dps: number;
  /** Sekundy ekspozycji na światło do śmierci (§4.4). */
  burnTime: number;
  oreReward: number;
  targetPriority: 'NEAREST_BUILDING' | 'CORE' | 'ENERGY_INFRASTRUCTURE';
}

// [STROJENIE]
export const ENEMIES: Record<EnemyType, EnemyDef> = {
  SWARM: {
    hp: 30, speedFactor: 2.3, dps: 10, burnTime: 3, oreReward: 2,
    targetPriority: 'NEAREST_BUILDING',
  },
  ARMOR: {
    // speedFactor < 1: broń wyłącznie nocna, musi zdążyć do Core przed świtem.
    hp: 250, speedFactor: 0.85, dps: 50, burnTime: 8, oreReward: 10,
    targetPriority: 'CORE',
  },
  DISRUPTOR: {
    hp: 80, speedFactor: 1.6, dps: 20, burnTime: 4, oreReward: 5,
    targetPriority: 'ENERGY_INFRASTRUCTURE',
  },
};
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/defs.test.ts`
Oczekiwane: **14 testów przechodzi.**

```bash
git add packages/sim/src/sim/defs.ts packages/sim/test/defs.test.ts
git commit -m "feat(sim): baza danych obiektów z jednolitym schematem energii i poprawioną kaskadą brownoutu"
```

---

### Task 3: Oświetlenie

**Files:**
- Create: `packages/sim/src/sim/light.ts`
- Test: `packages/sim/test/light.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `dot`, `Planet`
- Produces:
  - `function sunDirection(elapsedSeconds: number, rotationPeriod: number): Vec3`
  - `function lightAt(normal: Vec3, sunDir: Vec3): number` — ∈ [0, 1]
  - `function lightField(planet: Planet, sunDir: Vec3): Float32Array`

Planeta jest **statyczna**, orbituje światło (§4.3). Stan oświetlenia nie jest polem komórki — jest funkcją, liczoną na żądanie, więc nie może się zdesynchronizować.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/light.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { lightAt, lightField, sunDirection } from '../src/sim/light.js';
import { length, vec3 } from '../src/math/vec3.js';
import { createPlanet } from '../src/world/planet.js';

const T = 180;

describe('sunDirection', () => {
  it('jest wektorem jednostkowym w każdej chwili', () => {
    for (const t of [0, 45, 90, 123.4, T, 2 * T]) {
      expect(length(sunDirection(t, T))).toBeCloseTo(1, 12);
    }
  });

  it('ma okres równy okresowi obrotu', () => {
    const a = sunDirection(37, T);
    const b = sunDirection(37 + T, T);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
  });

  it('po pół okresie wskazuje przeciwnie', () => {
    const a = sunDirection(0, T);
    const b = sunDirection(T / 2, T);
    expect(b.x).toBeCloseTo(-a.x, 9);
    expect(b.z).toBeCloseTo(-a.z, 9);
  });
});

describe('lightAt', () => {
  const sun = vec3(1, 0, 0);

  it('daje 1 zwrócone prosto w słońce', () => {
    expect(lightAt(vec3(1, 0, 0), sun)).toBeCloseTo(1, 12);
  });

  it('daje 0 na terminatorze', () => {
    expect(lightAt(vec3(0, 0, 1), sun)).toBeCloseTo(0, 12);
  });

  it('obcina stronę nocną do 0, nigdy do wartości ujemnej', () => {
    expect(lightAt(vec3(-1, 0, 0), sun)).toBe(0);
    expect(lightAt(vec3(-0.5, 0, 0.866), sun)).toBe(0);
  });
});

describe('lightField', () => {
  const planet = createPlanet({ seed: 5 });

  it('daje jedną wartość na komórkę, wszystkie w [0,1]', () => {
    const f = lightField(planet, sunDirection(0, T));
    expect(f.length).toBe(planet.cells.length);
    for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('oświetla mniej więcej połowę planety — na kuli nie ma globalnej nocy (D1)', () => {
    const f = lightField(planet, sunDirection(0, T));
    const lit = [...f].filter((v) => v > 0).length;
    expect(lit / f.length).toBeGreaterThan(0.45);
    expect(lit / f.length).toBeLessThan(0.55);
  });

  it('po pół obrocie oświetlone są dokładnie te komórki, które były ciemne', () => {
    const a = lightField(planet, sunDirection(0, T));
    const b = lightField(planet, sunDirection(T / 2, T));
    for (let i = 0; i < a.length; i++) {
      if (a[i] > 0.01) expect(b[i]).toBeLessThan(0.02);
    }
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/light.test.ts`
Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj oświetlenie**

`packages/sim/src/sim/light.ts`:
```ts
import { dot, type Vec3 } from '../math/vec3.js';
import type { Planet } from '../world/planet.js';

/**
 * Planeta jest statyczna, orbituje źródło światła (§4.3).
 * Matematycznie tożsame z obrotem planety, ale kamera nie gubi bazy,
 * a pozycje komórek są stałe w przestrzeni świata — co upraszcza serializację.
 */
export function sunDirection(elapsedSeconds: number, rotationPeriod: number): Vec3 {
  const angle = (2 * Math.PI * elapsedSeconds) / rotationPeriod;
  return { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
}

/** saturate(dot(normal, sunDir)) — ciągłe, nie binarne (§5.1). */
export function lightAt(normal: Vec3, sunDir: Vec3): number {
  const d = dot(normal, sunDir);
  return d > 0 ? d : 0;
}

/** Oświetlenie wszystkich komórek naraz. Liczone raz na tick i przekazywane systemom. */
export function lightField(planet: Planet, sunDir: Vec3): Float32Array {
  const out = new Float32Array(planet.cells.length);
  for (let i = 0; i < planet.cells.length; i++) {
    out[i] = lightAt(planet.cells[i].normal, sunDir);
  }
  return out;
}
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/light.test.ts`
Oczekiwane: **9 testów przechodzi.** Test „oświetla mniej więcej połowę planety" jest formalnym potwierdzeniem D1 — globalna faza dnia i nocy z draftu była geometrycznie niemożliwa.

```bash
git add packages/sim/src/sim/light.ts packages/sim/test/light.test.ts
git commit -m "feat(sim): oświetlenie lokalne per komórka z orbitującym słońcem"
```

---

### Task 4: Komendy, walidacja budowania i pętla stałego kroku

**Files:**
- Create: `packages/sim/src/sim/commands.ts`, `packages/sim/src/sim/loop.ts`
- Test: `packages/sim/test/commands.test.ts`, `packages/sim/test/determinism.test.ts`

**Interfaces:**
- Consumes: `SimState`, `BUILDINGS`, `TICK_SECONDS`, `stateHash`
- Produces:
  - `type Command = { kind: 'BUILD'; cellId: number; type: BuildingType } | { kind: 'DEMOLISH'; cellId: number }`
  - `function canBuild(s: SimState, cellId: number, type: BuildingType): { ok: true } | { ok: false; reason: string }`
  - `function applyCommand(s: SimState, cmd: Command): void`
  - `interface SimConfig { rotationPeriod: number; startingOre: number }`
  - `class Sim { constructor(planet: Planet, config: SimConfig); enqueue(cmd: Command): void; step(): void; get state(): SimState; get elapsedSeconds(): number }`

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/commands.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand, canBuild } from '../src/sim/commands.js';

const planet = createPlanet({ seed: 3 });
const anyOreCell = planet.cells.find((c) => c.oreCapacity > 0)!.id;
const anyPentagon = planet.pentagons[0];
const plainHex = planet.cells.find(
  (c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell,
)!.id;

describe('canBuild', () => {
  it('pozwala postawić pylon na pustym heksie przy wystarczającej rudzie', () => {
    const s = createState(planet, 100);
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: true });
  });

  it('odmawia przy niewystarczającej rudzie', () => {
    const s = createState(planet, 1);
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: false, reason: 'INSUFFICIENT_ORE' });
  });

  it('odmawia na zajętej komórce', () => {
    const s = createState(planet, 500);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    expect(canBuild(s, plainHex, 'PYLON')).toEqual({ ok: false, reason: 'CELL_OCCUPIED' });
  });

  it('wpuszcza GEOTHERMAL_CAP wyłącznie na pentagon', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyPentagon, 'GEOTHERMAL_CAP')).toEqual({ ok: true });
    expect(canBuild(s, plainHex, 'GEOTHERMAL_CAP')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });

  it('wpuszcza EXTRACTOR wyłącznie na złoże', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyOreCell, 'EXTRACTOR')).toEqual({ ok: true });
    expect(canBuild(s, plainHex, 'EXTRACTOR')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });

  it('nie wpuszcza zwykłych budynków na pentagon', () => {
    const s = createState(planet, 500);
    expect(canBuild(s, anyPentagon, 'PYLON')).toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
  });
});

describe('applyCommand', () => {
  it('BUILD pobiera rudę i stawia budynek z pełnym HP', () => {
    const s = createState(planet, 100);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    expect(s.ore).toBe(85);
    expect(s.buildings[plainHex]).toMatchObject({ type: 'PYLON', hp: 80, powered: false });
  });

  it('BUILD niedozwolony jest po cichu ignorowany, nie rzuca — komendy przychodzą z sieci', () => {
    const s = createState(planet, 1);
    expect(() => applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' })).not.toThrow();
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(1);
  });

  it('DEMOLISH usuwa budynek i zwraca połowę kosztu', () => {
    const s = createState(planet, 100);
    applyCommand(s, { kind: 'BUILD', cellId: plainHex, type: 'PYLON' });
    applyCommand(s, { kind: 'DEMOLISH', cellId: plainHex });
    expect(s.buildings[plainHex]).toBeNull();
    expect(s.ore).toBe(85 + 7);
  });

  it('DEMOLISH nie rusza CORE', () => {
    const s = createState(planet, 100);
    applyCommand(s, { kind: 'BUILD', cellId: planet.startCell, type: 'CORE' });
    applyCommand(s, { kind: 'DEMOLISH', cellId: planet.startCell });
    expect(s.buildings[planet.startCell]).not.toBeNull();
  });
});
```

`packages/sim/test/determinism.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { Sim } from '../src/sim/loop.js';
import { stateHash } from '../src/sim/hash.js';
import type { Command } from '../src/sim/commands.js';

const CONFIG = { rotationPeriod: 180, startingOre: 150 };

function runScripted(seed: number, ticks: number): string {
  const planet = createPlanet({ seed });
  const sim = new Sim(planet, CONFIG);

  // Komórki wybierane z planety, NIE zaszyte na sztywno: stały indeks mógłby trafić
  // na pentagon albo złoże, przez co komenda byłaby po cichu ignorowana
  // i test determinizmu przechodziłby, nie sprawdzając niczego.
  const buildable = planet.cells
    .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell)
    .map((c) => c.id);
  const [c1, c2] = [buildable[0], buildable[1]];

  const script: Array<[number, Command]> = [
    [10, { kind: 'BUILD', cellId: c1, type: 'PYLON' }],
    [25, { kind: 'BUILD', cellId: c2, type: 'BARRICADE' }],
    [40, { kind: 'DEMOLISH', cellId: c1 }],
  ];
  for (let t = 0; t < ticks; t++) {
    for (const [at, cmd] of script) if (at === t) sim.enqueue(cmd);
    sim.step();
  }
  return stateHash(sim.state);
}

describe('determinizm (§7.2)', () => {
  it('ten sam seed + ta sama kolejka komend ⇒ ten sam hash po 1200 tickach', () => {
    expect(runScripted(2026, 1200)).toBe(runScripted(2026, 1200));
  });

  it('inny seed ⇒ inny hash', () => {
    expect(runScripted(2026, 600)).not.toBe(runScripted(2027, 600));
  });

  it('czas symulacji wynika wyłącznie z liczby ticków, nie z zegara', () => {
    const sim = new Sim(createPlanet({ seed: 1 }), CONFIG);
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.elapsedSeconds).toBeCloseTo(1, 12);
    expect(sim.state.tick).toBe(20);
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/commands.test.ts packages/sim/test/determinism.test.ts`
Oczekiwane: FAIL — brak modułów.

- [ ] **Step 3: Zaimplementuj komendy**

`packages/sim/src/sim/commands.ts`:
```ts
import { BUILDINGS } from './defs.js';
import type { BuildingType, SimState } from './state.js';

export type Command =
  | { kind: 'BUILD'; cellId: number; type: BuildingType }
  | { kind: 'DEMOLISH'; cellId: number };

export type BuildCheck = { ok: true } | { ok: false; reason: string };

export function canBuild(s: SimState, cellId: number, type: BuildingType): BuildCheck {
  const cell = s.planet.cells[cellId];
  if (cell === undefined) return { ok: false, reason: 'NO_SUCH_CELL' };
  if (s.buildings[cellId] !== null) return { ok: false, reason: 'CELL_OCCUPIED' };

  const def = BUILDINGS[type];
  const typeOk =
    def.allowedCells === 'ANY' ||
    (def.allowedCells === 'HEXAGON' && cell.cellType === 'HEXAGON') ||
    (def.allowedCells === 'PENTAGON' && cell.cellType === 'PENTAGON') ||
    (def.allowedCells === 'ORE_HEXAGON' && cell.cellType === 'HEXAGON' && s.oreRemaining[cellId] > 0);
  if (!typeOk) return { ok: false, reason: 'WRONG_CELL_TYPE' };

  if (s.ore < def.costOre) return { ok: false, reason: 'INSUFFICIENT_ORE' };
  return { ok: true };
}

/**
 * Komendy przychodzą z zewnątrz (a w Fazie 5 — z sieci), więc niedozwolona komenda
 * jest po cichu ignorowana, nigdy nie przerywa symulacji.
 */
export function applyCommand(s: SimState, cmd: Command): void {
  switch (cmd.kind) {
    case 'BUILD': {
      if (!canBuild(s, cmd.cellId, cmd.type).ok) return;
      const def = BUILDINGS[cmd.type];
      s.ore -= def.costOre;
      s.buildings[cmd.cellId] = { cellId: cmd.cellId, type: cmd.type, hp: def.hp, powered: false };
      return;
    }
    case 'DEMOLISH': {
      const b = s.buildings[cmd.cellId];
      if (b === null || b.type === 'CORE') return;
      s.ore += Math.floor(BUILDINGS[b.type].costOre / 2); // [STROJENIE] zwrot 50 %
      s.buildings[cmd.cellId] = null;
      return;
    }
  }
}
```

- [ ] **Step 4: Zaimplementuj pętlę**

`packages/sim/src/sim/loop.ts`:
```ts
import type { Planet } from '../world/planet.js';
import { applyCommand, type Command } from './commands.js';
import { lightField, sunDirection } from './light.js';
import { createState, TICK_SECONDS, type SimState } from './state.js';

export interface SimConfig {
  rotationPeriod: number;
  startingOre: number;
}

/**
 * Pętla o stałym kroku 20 Hz, całkowicie niezależna od czasu ściennego.
 * Kolejne zadania tego planu dopinają swoje systemy do metody step()
 * w miejscu oznaczonym komentarzem — kolejność systemów jest częścią kontraktu
 * determinizmu i nie wolno jej zmieniać bez aktualizacji testów.
 */
export class Sim {
  readonly config: SimConfig;
  private readonly s: SimState;
  private readonly pending: Command[] = [];

  constructor(planet: Planet, config: SimConfig) {
    this.config = config;
    this.s = createState(planet, config.startingOre);
  }

  get state(): SimState { return this.s; }

  get elapsedSeconds(): number { return this.s.tick * TICK_SECONDS; }

  enqueue(cmd: Command): void { this.pending.push(cmd); }

  step(): void {
    if (this.s.phase !== 'RUNNING') return;

    // 1. Komendy — zawsze pierwsze, żeby tick widział świat już zmieniony.
    for (const cmd of this.pending) applyCommand(this.s, cmd);
    this.pending.length = 0;

    // 2. Oświetlenie — liczone raz i podawane pozostałym systemom.
    const sun = sunDirection(this.elapsedSeconds, this.config.rotationPeriod);
    const light = lightField(this.s.planet, sun);
    void light; // systemy dopinane w Task 5-13

    // TUTAJ dopinane są kolejne systemy, w tej kolejności:
    //   energia → ekonomia → pola przepływu → jednostki → walka → spalanie → fale → warunki końca

    this.s.tick++;
  }
}
```

- [ ] **Step 5: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/commands.test.ts packages/sim/test/determinism.test.ts`
Oczekiwane: **12 testów przechodzi.**

```bash
git add packages/sim/src/sim/commands.ts packages/sim/src/sim/loop.ts packages/sim/test/commands.test.ts packages/sim/test/determinism.test.ts
git commit -m "feat(sim): kolejka komend, walidacja budowania i pętla stałego kroku 20 Hz"
```

---

### Task 5: Sieć energetyczna — komponenty połączeń

**Files:**
- Create: `packages/sim/src/sim/network.ts`
- Test: `packages/sim/test/network.test.ts`

**Interfaces:**
- Consumes: `SimState`, `BUILDINGS`, `multiSourceDistances`
- Produces:
  - `function connectedToCore(s: SimState): boolean[]` — indeksowane cellId

Budynek jest zasilany, jeśli istnieje ścieżka przez budynki o `connectionRadius > 0` do CORE. Zasięg liczony w krokach grafu (N1).

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/network.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { connectedToCore } from '../src/sim/network.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 11 });
const neighbors = planet.cells.map((c) => c.neighbors);

const fromStart = multiSourceDistances(neighbors, [planet.startCell]);

const isPlainHex = (i: number) =>
  planet.cells[i].cellType === 'HEXAGON' && planet.cells[i].oreCapacity === 0;

/** Pusty heks oddalony o dokładnie `steps` kroków od komórki startowej. */
function cellAtDistance(steps: number): number {
  for (let i = 0; i < fromStart.length; i++) {
    if (fromStart[i] === steps && isPlainHex(i)) return i;
  }
  throw new Error(`brak pustego heksa w odległości ${steps} od startu`);
}

/**
 * Pusty heks oddalony o `steps` kroków od `from` ORAZ o więcej niż `minFromStart`
 * kroków od komórki startowej. Bez drugiego warunku „daleki" kandydat mógłby
 * wylądować po przeciwnej stronie planety niż pylon-pośrednik i test łańcucha
 * sprawdzałby coś innego, niż zakłada.
 */
function cellNear(from: number, steps: number, minFromStart: number): number {
  const d = multiSourceDistances(neighbors, [from]);
  for (let i = 0; i < d.length; i++) {
    if (d[i] === steps && fromStart[i] > minFromStart && isPlainHex(i)) return i;
  }
  throw new Error(`brak heksa ${steps} kroków od ${from} i dalej niż ${minFromStart} od startu`);
}

function withCore() {
  const s = createState(planet, 5000);
  applyCommand(s, { kind: 'BUILD', cellId: planet.startCell, type: 'CORE' });
  return s;
}

describe('connectedToCore', () => {
  it('CORE jest połączony sam ze sobą', () => {
    expect(connectedToCore(withCore())[planet.startCell]).toBe(true);
  });

  it('budynek w zasięgu CORE jest połączony', () => {
    const s = withCore();
    const near = cellAtDistance(2); // connectionRadius CORE = 3
    applyCommand(s, { kind: 'BUILD', cellId: near, type: 'BATTERY' });
    expect(connectedToCore(s)[near]).toBe(true);
  });

  it('budynek poza zasięgiem NIE jest połączony', () => {
    const s = withCore();
    const far = cellAtDistance(7);
    applyCommand(s, { kind: 'BUILD', cellId: far, type: 'BATTERY' });
    expect(connectedToCore(s)[far]).toBe(false);
  });

  it('pylon przedłuża sieć', () => {
    const s = withCore();
    const mid = cellAtDistance(3);
    const far = cellNear(mid, 3, 3);
    applyCommand(s, { kind: 'BUILD', cellId: mid, type: 'PYLON' });
    applyCommand(s, { kind: 'BUILD', cellId: far, type: 'BATTERY' });
    expect(connectedToCore(s)[far]).toBe(true);
  });

  it('BARRICADE nie przewodzi — connectionRadius = 0', () => {
    const s = withCore();
    const mid = cellAtDistance(3);
    const far = cellNear(mid, 3, 3);
    applyCommand(s, { kind: 'BUILD', cellId: mid, type: 'BARRICADE' });
    applyCommand(s, { kind: 'BUILD', cellId: far, type: 'BATTERY' });
    expect(connectedToCore(s)[far]).toBe(false);
  });

  it('zniszczenie pylonu rozspójnia sieć, odbudowa ją spaja', () => {
    const s = withCore();
    const mid = cellAtDistance(3);
    const far = cellNear(mid, 3, 3);
    applyCommand(s, { kind: 'BUILD', cellId: mid, type: 'PYLON' });
    applyCommand(s, { kind: 'BUILD', cellId: far, type: 'BATTERY' });
    expect(connectedToCore(s)[far]).toBe(true);

    s.buildings[mid] = null;
    expect(connectedToCore(s)[far]).toBe(false);

    applyCommand(s, { kind: 'BUILD', cellId: mid, type: 'PYLON' });
    expect(connectedToCore(s)[far]).toBe(true);
  });

  it('bez CORE nic nie jest połączone', () => {
    const s = createState(planet, 5000);
    applyCommand(s, { kind: 'BUILD', cellId: cellAtDistance(1), type: 'BATTERY' });
    expect(connectedToCore(s).some((v) => v)).toBe(false);
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/network.test.ts`
Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj sieć**

`packages/sim/src/sim/network.ts`:
```ts
import { BUILDINGS } from './defs.js';
import type { SimState } from './state.js';

/**
 * Propagacja zasilania od CORE w głąb sieci (§5.1).
 * Wariant „zalewowy" z granicą zasięgu na węzeł: budynek przewodzący rozgłasza
 * zasilanie do wszystkich budynków w promieniu swojego connectionRadius (w krokach grafu).
 */
export function connectedToCore(s: SimState): boolean[] {
  const cells = s.planet.cells;
  const connected = new Array<boolean>(cells.length).fill(false);

  const frontier: number[] = [];
  for (let i = 0; i < s.buildings.length; i++) {
    if (s.buildings[i]?.type === 'CORE') {
      connected[i] = true;
      frontier.push(i);
    }
  }

  for (let head = 0; head < frontier.length; head++) {
    const from = frontier[head];
    const radius = BUILDINGS[s.buildings[from]!.type].connectionRadius;
    if (radius <= 0) continue;

    // BFS ograniczony do `radius` kroków od tego węzła.
    const seen = new Set<number>([from]);
    let ring: number[] = [from];
    for (let step = 0; step < radius; step++) {
      const next: number[] = [];
      for (const c of ring) {
        for (const n of cells[c].neighbors) {
          if (seen.has(n)) continue;
          seen.add(n);
          next.push(n);
          if (s.buildings[n] !== null && !connected[n]) {
            connected[n] = true;
            frontier.push(n);
          }
        }
      }
      ring = next;
    }
  }

  return connected;
}
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/network.test.ts`
Oczekiwane: **7 testów przechodzi.**

> **Notatka wydajnościowa:** ta implementacja jest O(budynki × promień²) na wywołanie i przy kilkuset budynkach jest w zupełności wystarczająca. Optymalizacja do inkrementalnego union-find (§5.1 specu) należy do Fazy 3 i musi zostać wprowadzona **pod tymi samymi testami** — jeśli je przejdzie, jest poprawna.

```bash
git add packages/sim/src/sim/network.ts packages/sim/test/network.test.ts
git commit -m "feat(sim): propagacja zasilania od CORE z zasięgiem w krokach grafu"
```

---

### Task 6: Bilans energii i kaskada brownoutu

**Files:**
- Create: `packages/sim/src/sim/power.ts`
- Modify: `packages/sim/src/sim/loop.ts`
- Test: `packages/sim/test/power.test.ts`

**Interfaces:**
- Consumes: `connectedToCore`, `BUILDINGS`, `BROWNOUT_ORDER`, `evaluateEnergyOutput`, `TICK_SECONDS`
- Produces:
  - `interface PowerReport { supply: number; demand: number; shedTypes: BuildingType[] }`
  - `function updatePower(s: SimState, light: Float32Array): PowerReport`

`updatePower` ustawia `powered` na każdym budynku i aktualizuje `storedEnergy`.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/power.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { updatePower } from '../src/sim/power.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 21 });
const neighbors = planet.cells.map((c) => c.neighbors);
const dist = multiSourceDistances(neighbors, [planet.startCell]);

function nearbyHexes(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < dist.length && out.length < count; i++) {
    if (dist[i] >= 1 && dist[i] <= 2 && planet.cells[i].cellType === 'HEXAGON' && planet.cells[i].oreCapacity === 0) {
      out.push(i);
    }
  }
  if (out.length < count) throw new Error('za mało pustych heksów blisko startu');
  return out;
}

function base() {
  const s = createState(planet, 100000);
  applyCommand(s, { kind: 'BUILD', cellId: planet.startCell, type: 'CORE' });
  return s;
}

const fullLight = new Float32Array(planet.cells.length).fill(1);
const noLight = new Float32Array(planet.cells.length).fill(0);

describe('updatePower', () => {
  it('CORE sam produkuje 10/s i zasila się sam', () => {
    const s = base();
    const r = updatePower(s, noLight);
    expect(r.supply).toBeCloseTo(10, 9);
    expect(r.demand).toBeCloseTo(0, 9);
    expect(s.buildings[planet.startCell]!.powered).toBe(true);
  });

  it('SOLAR produkuje proporcjonalnie do oświetlenia, nie skokowo', () => {
    const s = base();
    const [cell] = nearbyHexes(1);
    applyCommand(s, { kind: 'BUILD', cellId: cell, type: 'SOLAR_PANEL' });

    const half = new Float32Array(planet.cells.length).fill(0);
    half[cell] = 0.5;
    expect(updatePower(s, half).supply).toBeCloseTo(10 + 20, 6);
    expect(updatePower(s, noLight).supply).toBeCloseTo(10, 6);
  });

  it('niepodłączony budynek nie produkuje i nie pobiera', () => {
    const s = base();
    const orphan = planet.cells.find(
      (c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && dist[c.id] > 8,
    )!.id;
    applyCommand(s, { kind: 'BUILD', cellId: orphan, type: 'SOLAR_PANEL' });
    expect(updatePower(s, fullLight).supply).toBeCloseTo(10, 6);
    expect(s.buildings[orphan]!.powered).toBe(false);
  });

  it('nadwyżka ładuje magazyn, ale nie ponad pojemność', () => {
    const s = base();
    s.storedEnergy = 0;
    for (let i = 0; i < 100; i++) updatePower(s, noLight);
    const coreStorage = 200;
    expect(s.storedEnergy).toBeLessThanOrEqual(coreStorage);
    expect(s.storedEnergy).toBeGreaterThan(0);
  });

  it('przy niedoborze gasi EKSTRAKTORY przed obroną (§5.1)', () => {
    const s = base();
    const [a, b, c, d] = nearbyHexes(4);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'KINETIC_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'LASER_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: d, type: 'SOLAR_PANEL' });
    s.storedEnergy = 0;

    // Podaż: CORE 10 + panel 40·0,1 = 14/s. Popyt: 5+3+12 = 20/s.
    // Zgaszenie ekstraktora daje 15 (wciąż za mało), plus kinetyka daje 12 ≤ 14 — laser przeżywa.
    const dimLight = new Float32Array(planet.cells.length).fill(0);
    dimLight[d] = 0.1;

    const r = updatePower(s, dimLight);
    expect(r.shedTypes).toContain('EXTRACTOR');
    expect(r.shedTypes).toContain('KINETIC_TURRET');
    expect(s.buildings[c]!.powered).toBe(true); // obrona laserowa gaśnie ostatnia
  });

  it('gasi lasery dopiero jako ostatnie', () => {
    const s = base();
    const [a, b, c] = nearbyHexes(3);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'KINETIC_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'LASER_TURRET' });
    s.storedEnergy = 0;

    // Odetnij całą produkcję poza CORE i zobacz, co gaśnie.
    const r = updatePower(s, noLight);
    const order = ['EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET'];
    for (let i = 1; i < r.shedTypes.length; i++) {
      expect(order.indexOf(r.shedTypes[i])).toBeGreaterThan(order.indexOf(r.shedTypes[i - 1]));
    }
  });

  it('magazyn pokrywa chwilowy niedobór zamiast natychmiast gasić', () => {
    const s = base();
    const [a, b, c] = nearbyHexes(3);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'EXTRACTOR' });
    s.storedEnergy = 100;

    // Popyt 15/s przy podaży 10/s — realny niedobór, ale magazyn go pokrywa.
    const before = s.storedEnergy;
    const r = updatePower(s, noLight);
    expect(r.shedTypes).toEqual([]);
    expect(s.storedEnergy).toBeLessThan(before);
    expect(s.storedEnergy).toBeCloseTo(before + (10 - 15) * TICK_SECONDS, 6);
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/power.test.ts`
Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj bilans energii**

`packages/sim/src/sim/power.ts`:
```ts
import { BROWNOUT_ORDER, BUILDINGS, evaluateEnergyOutput } from './defs.js';
import { connectedToCore } from './network.js';
import { TICK_SECONDS, type BuildingType, type SimState } from './state.js';

export interface PowerReport {
  supply: number;
  demand: number;
  /** Typy, które faktycznie zgaszono w tym ticku, w kolejności gaszenia. */
  shedTypes: BuildingType[];
}

export function updatePower(s: SimState, light: Float32Array): PowerReport {
  const connected = connectedToCore(s);

  let supply = 0;
  let capacity = 0;
  const consumers: number[] = [];

  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b === null) continue;

    if (!connected[i]) {
      b.powered = false;
      continue;
    }

    const def = BUILDINGS[b.type];
    supply += evaluateEnergyOutput(def.energyOutput, light[i]);
    capacity += def.energyStorage;
    if (def.energyDrain > 0) consumers.push(i);
    b.powered = true;
  }

  let demand = 0;
  for (const i of consumers) demand += BUILDINGS[s.buildings[i]!.type].energyDrain;

  // Magazyn pokrywa niedobór, dopóki starcza. Dopiero potem gaszenie.
  const shedTypes: BuildingType[] = [];
  const available = supply + s.storedEnergy / TICK_SECONDS;

  if (demand > available) {
    for (const type of BROWNOUT_ORDER) {
      if (demand <= available) break;
      for (const i of consumers) {
        const b = s.buildings[i]!;
        if (b.type !== type || !b.powered) continue;
        b.powered = false;
        demand -= BUILDINGS[type].energyDrain;
        if (!shedTypes.includes(type)) shedTypes.push(type);
        if (demand <= available) break;
      }
    }
  }

  const net = (supply - demand) * TICK_SECONDS;
  s.storedEnergy = Math.max(0, Math.min(capacity, s.storedEnergy + net));

  return { supply, demand, shedTypes };
}
```

- [ ] **Step 4: Dopnij system do pętli**

W `packages/sim/src/sim/loop.ts`, w metodzie `step()`, zastąp linię `void light;` wywołaniem:
```ts
    // 3. Energia — musi być przed ekonomią i walką, bo ustawia flagi `powered`.
    updatePower(this.s, light);
```
oraz dodaj na górze pliku:
```ts
import { updatePower } from './power.js';
```

- [ ] **Step 5: Uruchom testy i commituj**

Run: `pnpm test`
Oczekiwane: **wszystkie testy przechodzą**, w tym testy determinizmu z Task 4.

```bash
git add packages/sim/src/sim/power.ts packages/sim/src/sim/loop.ts packages/sim/test/power.test.ts
git commit -m "feat(sim): bilans energii z magazynem i kaskadą brownoutu gaszącą obronę ostatnią"
```

---

### Task 7: Ekonomia — ekstraktory i wyczerpywanie złóż

**Files:**
- Create: `packages/sim/src/sim/economy.ts`
- Modify: `packages/sim/src/sim/loop.ts`
- Test: `packages/sim/test/economy.test.ts`

**Interfaces:**
- Consumes: `SimState`, `TICK_SECONDS`
- Produces:
  - `const ORE_PER_SECOND = 1.0` — `[STROJENIE]`
  - `function updateEconomy(s: SimState): void`

Złoża są **wyczerpywalne** (§5.2). To jest główny motor presji: wyczerpanie złoża wymusza ekspansję, ekspansja rozciąga sieć, rozciągnięta sieć wymaga obrony większego obwodu.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/economy.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { ORE_PER_SECOND, updateEconomy } from '../src/sim/economy.js';

const planet = createPlanet({ seed: 31 });
const oreCell = planet.cells.find((c) => c.oreCapacity > 0)!.id;

function withExtractor(powered: boolean) {
  const s = createState(planet, 0);
  s.buildings[oreCell] = { cellId: oreCell, type: 'EXTRACTOR', hp: 120, powered };
  return s;
}

describe('updateEconomy', () => {
  it('zasilany ekstraktor wydobywa rudę', () => {
    const s = withExtractor(true);
    updateEconomy(s);
    expect(s.ore).toBeCloseTo(ORE_PER_SECOND * TICK_SECONDS, 9);
  });

  it('niezasilany ekstraktor nie wydobywa nic', () => {
    const s = withExtractor(false);
    updateEconomy(s);
    expect(s.ore).toBe(0);
  });

  it('wydobycie uszczupla złoże', () => {
    const s = withExtractor(true);
    const before = s.oreRemaining[oreCell];
    updateEconomy(s);
    expect(s.oreRemaining[oreCell]).toBeCloseTo(before - ORE_PER_SECOND * TICK_SECONDS, 9);
  });

  it('wyczerpane złoże przestaje dawać rudę — to jest silnik presji (§5.2)', () => {
    const s = withExtractor(true);
    s.oreRemaining[oreCell] = 0;
    updateEconomy(s);
    expect(s.ore).toBe(0);
  });

  it('ostatni tick wydobycia nie przekracza tego, co zostało w złożu', () => {
    const s = withExtractor(true);
    const crumb = ORE_PER_SECOND * TICK_SECONDS * 0.3;
    s.oreRemaining[oreCell] = crumb;
    updateEconomy(s);
    expect(s.ore).toBeCloseTo(crumb, 9);
    expect(s.oreRemaining[oreCell]).toBe(0);
  });

  it('złoże ma skończoną pojemność — po dostatecznie długim czasie się kończy', () => {
    const s = withExtractor(true);
    const capacity = s.oreRemaining[oreCell];
    const ticks = Math.ceil(capacity / (ORE_PER_SECOND * TICK_SECONDS)) + 10;
    for (let i = 0; i < ticks; i++) updateEconomy(s);
    expect(s.oreRemaining[oreCell]).toBe(0);
    expect(s.ore).toBeCloseTo(capacity, 6);
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/economy.test.ts`
Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj ekonomię**

`packages/sim/src/sim/economy.ts`:
```ts
import { TICK_SECONDS, type SimState } from './state.js';

/** [STROJENIE] Zwrot z ekstraktora ma wynosić 60-75 s, nie 30 s jak w drafcie (§5.2). */
export const ORE_PER_SECOND = 1.0;

export function updateEconomy(s: SimState): void {
  const perTick = ORE_PER_SECOND * TICK_SECONDS;

  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b === null || b.type !== 'EXTRACTOR' || !b.powered) continue;

    // Złoża są wyczerpywalne — ostatni tick wydobywa tylko to, co zostało.
    const mined = Math.min(perTick, s.oreRemaining[i]);
    if (mined <= 0) continue;

    s.oreRemaining[i] -= mined;
    s.ore += mined;
  }
}
```

- [ ] **Step 4: Dopnij do pętli**

W `loop.ts`, po `updatePower(...)`:
```ts
    // 4. Ekonomia — po energii, bo wydobycie zależy od flagi `powered`.
    updateEconomy(this.s);
```
plus import `import { updateEconomy } from './economy.js';`

- [ ] **Step 5: Uruchom testy i commituj**

Run: `pnpm test`
Oczekiwane: wszystko zielone.

```bash
git add packages/sim/src/sim/economy.ts packages/sim/src/sim/loop.ts packages/sim/test/economy.test.ts
git commit -m "feat(sim): ekonomia z wyczerpywalnymi złożami jako silnikiem presji ekspansyjnej"
```

---

### Task 8: Pola przepływu z jednolitą funkcją kosztu

**Files:**
- Create: `packages/sim/src/sim/heap.ts`, `packages/sim/src/sim/flowfield.ts`
- Test: `packages/sim/test/flowfield.test.ts`

**Interfaces:**
- Consumes: `SimState`, `BUILDINGS`, `ENEMIES`
- Produces:
  - `class MinHeap { push(node: number, cost: number): void; pop(): number | undefined; get size(): number }`
  - `interface FlowField { distance: Float64Array; next: Int32Array }`
  - `function buildFlowField(s: SimState, priority: EnemyDef['targetPriority'], attackerDps: number): FlowField`
  - `function buildAllFlowFields(s: SimState): Record<EnemyType, FlowField>`

**To jest realizacja D3.** Komórka zajęta jest przechodnia, ale jej koszt wejścia odpowiada czasowi potrzebnemu na zniszczenie budynku. Dzięki temu ścieżka **zawsze istnieje** — zero walidacji przy budowaniu, zero przypadków brzegowych — a wróg sam omija drogą zabudowę i przegryza się przez tanią. `attackerDps` to DPS **typu wroga liczącego pole**, więc te same fortyfikacje kierunkują różne typy wroga różnymi trasami.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/flowfield.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { buildAllFlowFields, buildFlowField } from '../src/sim/flowfield.js';
import { MinHeap } from '../src/sim/heap.js';
import { ENEMIES } from '../src/sim/defs.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 41 });
const neighbors = planet.cells.map((c) => c.neighbors);

describe('MinHeap', () => {
  it('zwraca elementy w kolejności rosnącego kosztu', () => {
    const h = new MinHeap(16);
    for (const [n, c] of [[1, 5], [2, 1], [3, 9], [4, 3]] as const) h.push(n, c);
    expect([h.pop(), h.pop(), h.pop(), h.pop()]).toEqual([2, 4, 1, 3]);
    expect(h.pop()).toBeUndefined();
  });

  it('rośnie ponad pojemność początkową', () => {
    const h = new MinHeap(2);
    for (let i = 10; i > 0; i--) h.push(i, i);
    expect(h.size).toBe(10);
    expect(h.pop()).toBe(1);
  });
});

function withCore() {
  const s = createState(planet, 100000);
  applyCommand(s, { kind: 'BUILD', cellId: planet.startCell, type: 'CORE' });
  return s;
}

describe('buildFlowField', () => {
  it('cel ma odległość 0, wszystko inne większą', () => {
    const f = buildFlowField(withCore(), 'CORE', ENEMIES.ARMOR.dps);
    expect(f.distance[planet.startCell]).toBe(0);
    for (let i = 0; i < f.distance.length; i++) {
      if (i !== planet.startCell) expect(f.distance[i]).toBeGreaterThan(0);
    }
  });

  it('na pustej planecie odwzorowuje odległość grafową', () => {
    const f = buildFlowField(withCore(), 'CORE', ENEMIES.ARMOR.dps);
    const bfs = multiSourceDistances(neighbors, [planet.startCell]);
    for (let i = 0; i < f.distance.length; i++) {
      expect(f.distance[i]).toBeCloseTo(bfs[i], 9);
    }
  });

  it('podążanie za `next` zawsze dochodzi do celu — ścieżka ISTNIEJE zawsze (D3)', () => {
    const s = withCore();
    // Otocz CORE pierścieniem barykad — w twardym blokowaniu byłoby to nieprzejściowe.
    for (const n of planet.cells[planet.startCell].neighbors) {
      applyCommand(s, { kind: 'BUILD', cellId: n, type: 'BARRICADE' });
    }
    const f = buildFlowField(s, 'CORE', ENEMIES.ARMOR.dps);

    for (const start of [100, 500, 900, 1300]) {
      let cur = start;
      let hops = 0;
      while (cur !== planet.startCell && hops < 5000) {
        cur = f.next[cur];
        expect(cur).toBeGreaterThanOrEqual(0);
        hops++;
      }
      expect(cur).toBe(planet.startCell);
    }
  });

  it('zabudowana komórka jest droższa od pustej', () => {
    const empty = buildFlowField(withCore(), 'CORE', ENEMIES.ARMOR.dps);
    const s = withCore();
    const target = planet.cells[planet.startCell].neighbors[0];
    applyCommand(s, { kind: 'BUILD', cellId: target, type: 'BARRICADE' });
    const walled = buildFlowField(s, 'CORE', ENEMIES.ARMOR.dps);
    expect(walled.distance[target]).toBeGreaterThan(empty.distance[target]);
  });

  it('wróg o wyższym DPS wycenia ten sam mur taniej', () => {
    const s = withCore();
    const target = planet.cells[planet.startCell].neighbors[0];
    applyCommand(s, { kind: 'BUILD', cellId: target, type: 'BARRICADE' });

    const weak = buildFlowField(s, 'CORE', 10);
    const strong = buildFlowField(s, 'CORE', 100);
    expect(strong.distance[target]).toBeLessThan(weak.distance[target]);
  });

  it('DISRUPTOR celuje w infrastrukturę energetyczną, nie w barykady', () => {
    const s = withCore();
    const ring = planet.cells[planet.startCell].neighbors;
    applyCommand(s, { kind: 'BUILD', cellId: ring[0], type: 'BARRICADE' });

    const f = buildFlowField(s, 'ENERGY_INFRASTRUCTURE', ENEMIES.DISRUPTOR.dps);
    expect(f.distance[planet.startCell]).toBe(0); // CORE jest infrastrukturą
    expect(f.distance[ring[0]]).toBeGreaterThan(0); // barykada nie jest
  });

  it('bez żadnego celu wszystkie odległości są nieskończone', () => {
    const f = buildFlowField(createState(planet, 0), 'CORE', 50);
    for (const d of f.distance) expect(d).toBe(Infinity);
  });
});

describe('buildAllFlowFields', () => {
  it('daje jedno pole na typ wroga', () => {
    const fields = buildAllFlowFields(withCore());
    expect(Object.keys(fields).sort()).toEqual(['ARMOR', 'DISRUPTOR', 'SWARM']);
  });

  it('jest deterministyczne', () => {
    const a = buildAllFlowFields(withCore());
    const b = buildAllFlowFields(withCore());
    expect([...a.SWARM.next]).toEqual([...b.SWARM.next]);
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/flowfield.test.ts`
Oczekiwane: FAIL — brak modułów.

- [ ] **Step 3: Zaimplementuj kopiec**

`packages/sim/src/sim/heap.ts`:
```ts
/** Kopiec binarny na parach (węzeł, koszt). Bez zależności, bez alokacji na push. */
export class MinHeap {
  private nodes: Int32Array;
  private costs: Float64Array;
  private count = 0;

  constructor(capacity = 64) {
    this.nodes = new Int32Array(Math.max(1, capacity));
    this.costs = new Float64Array(Math.max(1, capacity));
  }

  get size(): number { return this.count; }

  push(node: number, cost: number): void {
    if (this.count === this.nodes.length) this.grow();
    let i = this.count++;
    this.nodes[i] = node;
    this.costs[i] = cost;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= this.costs[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number | undefined {
    if (this.count === 0) return undefined;
    const top = this.nodes[0];
    this.count--;
    if (this.count > 0) {
      this.nodes[0] = this.nodes[this.count];
      this.costs[0] = this.costs[this.count];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let best = i;
        if (l < this.count && this.costs[l] < this.costs[best]) best = l;
        if (r < this.count && this.costs[r] < this.costs[best]) best = r;
        if (best === i) break;
        this.swap(best, i);
        i = best;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const n = this.nodes[a]; this.nodes[a] = this.nodes[b]; this.nodes[b] = n;
    const c = this.costs[a]; this.costs[a] = this.costs[b]; this.costs[b] = c;
  }

  private grow(): void {
    const nodes = new Int32Array(this.nodes.length * 2);
    const costs = new Float64Array(this.costs.length * 2);
    nodes.set(this.nodes);
    costs.set(this.costs);
    this.nodes = nodes;
    this.costs = costs;
  }
}
```

- [ ] **Step 4: Zaimplementuj pola przepływu**

`packages/sim/src/sim/flowfield.ts`:
```ts
import { BUILDINGS, ENEMIES, type EnemyDef } from './defs.js';
import { MinHeap } from './heap.js';
import type { EnemyType, SimState } from './state.js';

export interface FlowField {
  /** Koszt dotarcia do najbliższego celu. Infinity = brak celu. */
  distance: Float64Array;
  /** Następna komórka na najtańszej ścieżce. -1 = brak. */
  next: Int32Array;
}

type Priority = EnemyDef['targetPriority'];

/**
 * Dijkstra wstecz od celów (D3, §4.5).
 *
 * Komórka zajęta jest PRZECHODNIA — jej koszt wejścia to szacowany czas zniszczenia
 * budynku. Skutki, wszystkie zamierzone:
 *   • ścieżka istnieje zawsze, więc nie trzeba walidować budowania,
 *   • wróg sam omija drogą zabudowę i przegryza się przez tanią,
 *   • HP budynku staje się statystyką pathfindingu,
 *   • w MP nie da się zamurować gracza na głucho.
 */
export function buildFlowField(s: SimState, priority: Priority, attackerDps: number): FlowField {
  const cells = s.planet.cells;
  const distance = new Float64Array(cells.length).fill(Infinity);
  const next = new Int32Array(cells.length).fill(-1);
  const settled = new Uint8Array(cells.length);
  const heap = new MinHeap(256);

  for (let i = 0; i < s.buildings.length; i++) {
    if (isTarget(s, i, priority)) {
      distance[i] = 0;
      heap.push(i, 0);
    }
  }

  for (;;) {
    const cur = heap.pop();
    if (cur === undefined) break;
    if (settled[cur]) continue;
    settled[cur] = 1;

    // Wchodzimy DO `cur` z sąsiada, więc koszt wejścia dotyczy komórki `cur`.
    const stepCost = entryCost(s, cur, attackerDps);
    for (const n of cells[cur].neighbors) {
      if (settled[n]) continue;
      const candidate = distance[cur] + stepCost;
      if (candidate < distance[n]) {
        distance[n] = candidate;
        next[n] = cur;
        heap.push(n, candidate);
      }
    }
  }

  return { distance, next };
}

export function buildAllFlowFields(s: SimState): Record<EnemyType, FlowField> {
  return {
    SWARM: buildFlowField(s, ENEMIES.SWARM.targetPriority, ENEMIES.SWARM.dps),
    ARMOR: buildFlowField(s, ENEMIES.ARMOR.targetPriority, ENEMIES.ARMOR.dps),
    DISRUPTOR: buildFlowField(s, ENEMIES.DISRUPTOR.targetPriority, ENEMIES.DISRUPTOR.dps),
  };
}

function isTarget(s: SimState, cellId: number, priority: Priority): boolean {
  const b = s.buildings[cellId];
  if (b === null) return false;
  switch (priority) {
    case 'NEAREST_BUILDING': return true;
    case 'CORE': return b.type === 'CORE';
    case 'ENERGY_INFRASTRUCTURE': return BUILDINGS[b.type].energyInfrastructure;
  }
}

/** 1 krok za przejście + szacowany czas rozbicia budynku stojącego na komórce. */
function entryCost(s: SimState, cellId: number, attackerDps: number): number {
  const b = s.buildings[cellId];
  if (b === null) return 1;
  return 1 + b.hp / attackerDps;
}
```

- [ ] **Step 5: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/flowfield.test.ts`
Oczekiwane: **11 testów przechodzi.** Test „ścieżka istnieje zawsze" jest dowodem, że D3 działa: CORE otoczony pełnym pierścieniem barykad nadal jest osiągalny, a przy twardym blokowaniu byłby nieosiągalny i flow field by się wywrócił.

```bash
git add packages/sim/src/sim/heap.ts packages/sim/src/sim/flowfield.ts packages/sim/test/flowfield.test.ts
git commit -m "feat(sim): pola przepływu z jednolitą funkcją kosztu — blokowanie z przegryzaniem (D3)"
```

---

## Definicja ukończenia Fazy 1B

- [ ] `pnpm test` zielony, `pnpm typecheck` bez błędów, strażnik zero-zależności nadal przechodzi
- [ ] Test determinizmu: ten sam seed + ta sama kolejka komend ⇒ ten sam hash po 1200 tickach
- [ ] Bilans energii z magazynem i kaskadą brownoutu gaszącą obronę **ostatnią**
- [ ] Złoża są wyczerpywalne i faktycznie się kończą
- [ ] D3 zweryfikowane testem: CORE otoczony pełnym pierścieniem barykad **nadal jest osiągalny**, a wróg o wyższym DPS wycenia ten sam mur taniej
- [ ] D1 zweryfikowane testem: oświetlona jest zawsze ~połowa planety, nigdy całość ani nic
- [ ] Wszystkie liczby balansowe oznaczone `// [STROJENIE]`

**Następny plan:** [Faza 1C — Rozgrywka](2026-09-14-faza-1c-rozgrywka.md) — ruch jednostek, walka, spalanie, spawn, warunki końca i headless runner.

---

## Dlaczego Faza 1 jest w trzech planach

Faza 1A daje czystą funkcję `seed → Planet`. Faza 1B daje symulację, która ją ożywia, ale jeszcze bez wrogów. Faza 1C domyka rozgrywkę i uruchamia runner balansowy.

Każda z tych trzech części daje **działające, testowalne oprogramowanie osobno** i każda ma własną bramkę przeglądu. Jeden plan na 21 zadań nie dałby się przejrzeć, a granice między nimi są naturalne, nie arbitralne.
