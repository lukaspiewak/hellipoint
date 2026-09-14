# Faza 1A — Świat: deterministyczna planeta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Czysta funkcja `createPlanet(seed) → Planet` — deterministyczna siatka dualna 1442 komórek z 12 pentagonami, klastrami rudy i pozycją startową, bez żadnej zależności od renderu.

**Architecture:** Monorepo pnpm. Pakiet `@heliopolis/sim` nie importuje Three.js ani niczego innego — geodezyjną sferę generuje sam, indeksowaną, z topologiczną deduplikacją wierzchołków. To eliminuje weldowanie przez epsilon opisane w §4.1 specu (dotyczyło ono wyłącznie nieindeksowanej geometrii z Three.js) i daje determinizm bez tolerancji zmiennoprzecinkowej.

**Tech Stack:** TypeScript (strict), Vitest, pnpm workspaces, Node ≥ 22. **Zero zależności runtime w `packages/sim`.**

**Spec:** [`docs/superpowers/specs/2026-09-14-project-heliopolis-design.md`](../specs/2026-09-14-project-heliopolis-design.md) — §4.1, §4.2, §4.3, §7.1, §7.2, §8.4.

---

## Global Constraints

- **Zero zależności runtime w `packages/sim`.** Egzekwowane testem (Task 1). To jest fundament D5 — bez tego headless runner i autorytatywny serwer są niemożliwe.
- **Determinizm (§7.2):** identyczny seed ⇒ identyczny wynik. Żadnego `Math.random`, `Date.now`, iteracji zależnej od kolejności alokacji.
- **Jednostki (N1):** wszystkie reguły w krokach grafu. Jednostki świata wyłącznie w geometrii i renderze.
- **Promień nie wpływa na rozgrywkę (N2):** egzekwowane testem (Task 6).
- `frequency = 12` ⇒ `N = 10·12² + 2 = 1442` komórek, z czego **dokładnie 12 pentagonów**.
- Commit po każdym zadaniu. Format: `feat(sim): …`, `test(sim): …`, `chore: …`.

---

### Task 1: Monorepo, toolchain i strażnik zero-zależności

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/sim/package.json`, `packages/sim/tsconfig.json`, `packages/sim/src/index.ts`
- Test: `packages/sim/test/contract.test.ts`

**Interfaces:**
- Consumes: nic
- Produces: działający `pnpm test`, `pnpm typecheck`; pakiet `@heliopolis/sim` importowalny jako `@heliopolis/sim`

- [ ] **Step 1: Utwórz szkielet workspace'u**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "tools/*"
```

`package.json`:
```json
{
  "name": "heliopolis",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b"
  }
}
```

`tsconfig.json` (root) — **wymagany**, bo skrypt `typecheck` to `tsc -b`, a tryb build bez
solution-tsconfigu z referencjami nie ma czego zbudować i cicho nic nie sprawdza:
```json
{
  "files": [],
  "references": [{ "path": "packages/sim" }]
}
```

> Po ukończeniu zadania **zweryfikuj, że typecheck faktycznie coś sprawdza**: wstaw tymczasowo
> plik `packages/sim/src/__probe.ts` z treścią `export const probe: number = "string";`,
> uruchom `pnpm typecheck` i potwierdź błąd `TS2322`, po czym usuń plik razem z `packages/sim/dist`
> i plikami `*.tsbuildinfo`. Zielony typecheck, który niczego nie sprawdza, dawałby fałszywe
> poczucie bezpieczeństwa przez wszystkie kolejne zadania.

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

> **Decyzja zapisana:** `noUncheckedIndexedAccess` celowo **wyłączone**. Kod geometryczny to gęste indeksowanie tablic w pętlach o niezmiennych granicach; flaga wymusiłaby setki asercji `!`, które obniżają czytelność bardziej, niż podnoszą bezpieczeństwo. Rozważyć włączenie dla modułów regułowych w Fazie 1B.

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Utwórz pakiet sim**

`packages/sim/package.json`:
```json
{
  "name": "@heliopolis/sim",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "sideEffects": false
}
```

`packages/sim/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/sim/src/index.ts`:
```ts
export const SIM_VERSION = '0.0.0';
```

- [ ] **Step 3: Napisz test kontraktowy (ma nie przejść)**

`packages/sim/test/contract.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SIM_VERSION } from '../src/index.js';

describe('kontrakt pakietu sim', () => {
  it('eksportuje wersję', () => {
    expect(SIM_VERSION).toBe('0.0.0');
  });

  it('nie ma ŻADNYCH zależności runtime (fundament D5)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it('żaden plik źródłowy nie importuje three ani niczego spoza pakietu', async () => {
    const { globSync } = await import('node:fs');
    const files = globSync('src/**/*.ts', { cwd: new URL('..', import.meta.url).pathname });
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        const isRelative = spec.startsWith('.');
        const isNodeBuiltin = spec.startsWith('node:');
        if (!isRelative && !isNodeBuiltin) offenders.push(`${f}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 4: Zainstaluj zależności i uruchom testy**

```bash
corepack enable
# NIE używaj pnpm@latest: rozwiązuje się do pnpm 12.x, które jest zepsute pod
# corepack 0.34.0 (szuka legacy bin/pnpm.cjs → MODULE_NOT_FOUND).
corepack prepare pnpm@11.17.0 --activate
pnpm --version    # musi wypisać 11.17.0, ZANIM pójdziesz dalej
pnpm add -D -w typescript vitest @types/node
pnpm test
```
Jeśli 11.17.0 jest niedostępne, weź najnowszą wersję, którą `pnpm --version` faktycznie
uruchamia, i zapisz ją w `wersje.txt` w kroku 5. Wersje `typescript`, `vitest` i `@types/node`
celowo NIE są przypięte w tym planie — instalator rozwiązuje bieżące i krok 5 je zapisuje.

Oczekiwane: **3 testy przechodzą**. Jeśli `globSync` nie istnieje w zainstalowanej wersji Node, podmień na `node:fs/promises` + ręczną rekurencję — test ma działać, nie być elegancki.

- [ ] **Step 5: Zapisz rozwiązane wersje i commituj**

```bash
node -p "'node ' + process.version" >> docs/superpowers/plans/wersje.txt
pnpm ls --depth 0 >> docs/superpowers/plans/wersje.txt
git add -A
git commit -m "chore: monorepo pnpm + vitest + strażnik zero-zależności dla @heliopolis/sim"
```

---

### Task 2: Deterministyczny PRNG i algebra wektorów

**Files:**
- Create: `packages/sim/src/math/rng.ts`, `packages/sim/src/math/vec3.ts`
- Test: `packages/sim/test/math.test.ts`

**Interfaces:**
- Consumes: nic
- Produces:
  - `class Rng { constructor(seed: number); nextUint32(): number; nextFloat(): number; nextInt(maxExclusive: number): number; fork(streamId: number): Rng }`
  - `const STREAM: { ORE: 1; START: 2; WAVES: 3; DRAFT: 4 }`
  - `interface Vec3 { readonly x: number; readonly y: number; readonly z: number }`
  - `vec3(x,y,z)`, `add(a,b)`, `sub(a,b)`, `scale(a,s)`, `dot(a,b)`, `cross(a,b)`, `length(a)`, `normalize(a)`

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/math.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Rng, STREAM } from '../src/math/rng.js';
import { cross, dot, length, normalize, sub, vec3 } from '../src/math/vec3.js';

describe('Rng', () => {
  it('ten sam seed daje tę samą sekwencję', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 50 }, () => a.nextUint32());
    const seqB = Array.from({ length: 50 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it('różne seedy dają różne sekwencje', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it('nextFloat mieści się w [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextFloat ma sensowną średnią (test dymu na rozkład)', () => {
    const r = new Rng(99);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) sum += r.nextFloat();
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it('fork jest niezależny od tego, jak daleko zaawansował rodzic', () => {
    const parentEarly = new Rng(42);
    const forkEarly = parentEarly.fork(STREAM.ORE).nextUint32();

    const parentLate = new Rng(42);
    for (let i = 0; i < 1000; i++) parentLate.nextUint32();
    const forkLate = parentLate.fork(STREAM.ORE).nextUint32();

    expect(forkEarly).toBe(forkLate);
  });

  it('różne strumienie są różne', () => {
    const p = new Rng(42);
    expect(p.fork(STREAM.ORE).nextUint32()).not.toBe(p.fork(STREAM.START).nextUint32());
  });
});

describe('vec3', () => {
  it('normalize daje długość 1', () => {
    expect(length(normalize(vec3(3, 4, 12)))).toBeCloseTo(1, 12);
  });

  it('cross jest prostopadły do obu argumentów', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(-4, 5, 6);
    const c = cross(a, b);
    expect(dot(c, a)).toBeCloseTo(0, 10);
    expect(dot(c, b)).toBeCloseTo(0, 10);
  });

  it('sub odwraca add', () => {
    const a = vec3(1, 2, 3);
    expect(sub(a, a)).toEqual(vec3(0, 0, 0));
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/math.test.ts`
Oczekiwane: FAIL — `Cannot find module '../src/math/rng.js'`.

- [ ] **Step 3: Zaimplementuj Rng**

`packages/sim/src/math/rng.ts`:
```ts
/**
 * Deterministyczny PRNG (xoshiro128**).
 * Stan trzymany wyłącznie na uint32 — żadnych liczb zmiennoprzecinkowych w stanie,
 * więc sekwencja jest identyczna na każdej platformie (§7.2 specu).
 */
export class Rng {
  private readonly seed: number;
  private readonly s = new Uint32Array(4);

  constructor(seed: number) {
    this.seed = seed | 0;
    let a = this.seed;
    for (let i = 0; i < 4; i++) {
      a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      this.s[i] = (t ^ (t >>> 15)) >>> 0;
    }
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }

  nextUint32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** [0, 1) */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** [0, maxExclusive) */
  nextInt(maxExclusive: number): number {
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  /**
   * Niezależny strumień dla jednego systemu. Wyprowadzany z ORYGINALNEGO seeda,
   * nie z bieżącego stanu — dzięki temu nie zależy od kolejności ani liczby
   * wywołań u rodzica.
   */
  fork(streamId: number): Rng {
    return new Rng((this.seed ^ Math.imul(streamId + 1, 0x9e3779b9)) | 0);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Jeden strumień na system (§7.2). Nowe systemy dopisywać, nigdy nie zmieniać istniejących wartości. */
export const STREAM = {
  ORE: 1,
  START: 2,
  WAVES: 3,
  DRAFT: 4,
} as const;
```

- [ ] **Step 4: Zaimplementuj vec3**

`packages/sim/src/math/vec3.ts`:
```ts
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  return len === 0 ? a : scale(a, 1 / len);
};
```

- [ ] **Step 5: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/math.test.ts`
Oczekiwane: **9 testów przechodzi.**

```bash
git add packages/sim/src/math packages/sim/test/math.test.ts
git commit -m "feat(sim): deterministyczny PRNG xoshiro128** ze strumieniami per system + algebra Vec3"
```

---

### Task 3: Geodezyjna sfera z topologiczną deduplikacją

**Files:**
- Create: `packages/sim/src/world/geodesic.ts`
- Test: `packages/sim/test/geodesic.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `add`, `normalize`, `scale`, `dot`, `cross`, `sub` z `../math/vec3.js`
- Produces:
  - `interface GeodesicMesh { vertices: Vec3[]; faces: [number, number, number][] }`
  - `function buildGeodesic(frequency: number): GeodesicMesh`
  - `function vertexCountFor(frequency: number): number`

**Kluczowa decyzja:** deduplikacja wierzchołków jest **topologiczna, nie geometryczna**. Każdy generowany punkt dostaje klucz wyprowadzony z jego pozycji w siatce barycentrycznej (narożnik / krawędź / wnętrze ściany), a nie z jego współrzędnych. Zero epsilonów, zero zależności od kolejności zmiennoprzecinkowej.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/geodesic.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildGeodesic, vertexCountFor } from '../src/world/geodesic.js';
import { cross, dot, length, sub } from '../src/math/vec3.js';

describe('buildGeodesic', () => {
  it('liczba wierzchołków spełnia 10·n²+2 dla n = 1..8', () => {
    for (let n = 1; n <= 8; n++) {
      expect(buildGeodesic(n).vertices.length).toBe(10 * n * n + 2);
      expect(vertexCountFor(n)).toBe(10 * n * n + 2);
    }
  });

  it('częstotliwość 1 to goły dwudziestościan', () => {
    const m = buildGeodesic(1);
    expect(m.vertices.length).toBe(12);
    expect(m.faces.length).toBe(20);
  });

  it('częstotliwość 12 daje docelowe 1442 komórki', () => {
    const m = buildGeodesic(12);
    expect(m.vertices.length).toBe(1442);
    expect(m.faces.length).toBe(20 * 144);
  });

  it('spełnia wzór Eulera V - E + F = 2', () => {
    const m = buildGeodesic(12);
    const edges = new Set<string>();
    for (const [a, b, c] of m.faces) {
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        edges.add(u < v ? `${u}_${v}` : `${v}_${u}`);
      }
    }
    expect(m.vertices.length - edges.size + m.faces.length).toBe(2);
  });

  it('wszystkie wierzchołki leżą na sferze jednostkowej', () => {
    for (const v of buildGeodesic(6).vertices) {
      expect(length(v)).toBeCloseTo(1, 12);
    }
  });

  it('wszystkie ściany są nawinięte na zewnątrz', () => {
    const m = buildGeodesic(5);
    for (const [ia, ib, ic] of m.faces) {
      const a = m.vertices[ia], b = m.vertices[ib], c = m.vertices[ic];
      const n = cross(sub(b, a), sub(c, a));
      expect(dot(n, a)).toBeGreaterThan(0);
    }
  });

  it('jest deterministyczny', () => {
    expect(buildGeodesic(4)).toEqual(buildGeodesic(4));
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/geodesic.test.ts`
Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj generator**

`packages/sim/src/world/geodesic.ts`:
```ts
import { add, normalize, scale, type Vec3 } from '../math/vec3.js';

export interface GeodesicMesh {
  /** Pozycje na sferze JEDNOSTKOWEJ. Skalowanie do promienia planety następuje później. */
  vertices: Vec3[];
  /** Trójkąty jako trójki indeksów, nawinięte na zewnątrz. */
  faces: [number, number, number][];
}

export const vertexCountFor = (frequency: number): number => 10 * frequency * frequency + 2;

const PHI = (1 + Math.sqrt(5)) / 2;

const BASE_VERTICES: Vec3[] = [
  { x: -1, y: PHI, z: 0 }, { x: 1, y: PHI, z: 0 }, { x: -1, y: -PHI, z: 0 }, { x: 1, y: -PHI, z: 0 },
  { x: 0, y: -1, z: PHI }, { x: 0, y: 1, z: PHI }, { x: 0, y: -1, z: -PHI }, { x: 0, y: 1, z: -PHI },
  { x: PHI, y: 0, z: -1 }, { x: PHI, y: 0, z: 1 }, { x: -PHI, y: 0, z: -1 }, { x: -PHI, y: 0, z: 1 },
].map(normalize);

const BASE_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/**
 * Sfera geodezyjna o zadanej częstotliwości: każda ściana dwudziestościanu
 * dzielona jest na n² trójkątów przez siatkę barycentryczną.
 */
export function buildGeodesic(frequency: number): GeodesicMesh {
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new Error(`frequency musi być dodatnią liczbą całkowitą, otrzymano ${frequency}`);
  }

  const n = frequency;
  const vertices: Vec3[] = [];
  const byKey = new Map<string, number>();
  const faces: [number, number, number][] = [];

  const put = (key: string, p: Vec3): number => {
    const hit = byKey.get(key);
    if (hit !== undefined) return hit;
    const id = vertices.length;
    vertices.push(normalize(p));
    byKey.set(key, id);
    return id;
  };

  for (const [ia, ib, ic] of BASE_FACES) {
    const a = BASE_VERTICES[ia], b = BASE_VERTICES[ib], c = BASE_VERTICES[ic];

    // grid[i][j] — wagi barycentryczne: k/n przy a, i/n przy b, j/n przy c, gdzie k = n-i-j
    const grid: number[][] = [];
    for (let i = 0; i <= n; i++) {
      grid[i] = [];
      for (let j = 0; j <= n - i; j++) {
        const k = n - i - j;
        const p = add(add(scale(a, k / n), scale(b, i / n)), scale(c, j / n));
        grid[i][j] = put(pointKey(ia, ib, ic, i, j, k, n), p);
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        faces.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]]);
        if (j < n - i - 1) {
          faces.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]);
        }
      }
    }
  }

  return { vertices, faces };
}

/**
 * Tożsamość topologiczna punktu siatki. Narożniki i punkty krawędziowe są wspólne
 * dla sąsiadujących ścian i muszą dostać ten sam klucz niezależnie od tego,
 * która ściana je wygenerowała.
 */
function pointKey(ia: number, ib: number, ic: number, i: number, j: number, k: number, n: number): string {
  if (k === n) return `v${ia}`;
  if (i === n) return `v${ib}`;
  if (j === n) return `v${ic}`;
  if (j === 0) return edgeKey(ia, ib, i, n); // krawędź a-b, parametr liczony od a
  if (i === 0) return edgeKey(ia, ic, j, n); // krawędź a-c, parametr liczony od a
  if (k === 0) return edgeKey(ib, ic, j, n); // krawędź b-c, parametr liczony od b
  return `f${ia}_${ib}_${ic}_${i}_${j}`;
}

/** Kanonizacja krawędzi: zawsze mniejszy indeks pierwszy, parametr przeliczony względem niego. */
function edgeKey(u: number, v: number, tFromU: number, n: number): string {
  return u < v ? `e${u}_${v}_${tFromU}` : `e${v}_${u}_${n - tFromU}`;
}
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/geodesic.test.ts`
Oczekiwane: **7 testów przechodzi.** Test Eulera i test liczby wierzchołków razem dowodzą, że deduplikacja zadziałała — gdyby klucze się rozjechały, wierzchołków byłoby więcej, a Euler by nie wyszedł.

```bash
git add packages/sim/src/world/geodesic.ts packages/sim/test/geodesic.test.ts
git commit -m "feat(sim): sfera geodezyjna z topologiczną deduplikacją wierzchołków (bez weldowania epsilonem)"
```

---

### Task 4: Siatka dualna, klasyfikacja komórek i graf sąsiedztwa

**Files:**
- Create: `packages/sim/src/world/dual.ts`
- Test: `packages/sim/test/dual.test.ts`

**Interfaces:**
- Consumes: `GeodesicMesh` z `./geodesic.js`; `Vec3`, `add`, `cross`, `dot`, `normalize`, `scale`, `sub` z `../math/vec3.js`
- Produces:
  - `type CellType = 'HEXAGON' | 'PENTAGON'`
  - `interface DualMesh { centers: Vec3[]; corners: Vec3[][]; neighbors: number[][]; cellTypes: CellType[] }`
  - `function buildDual(mesh: GeodesicMesh): DualMesh`

`corners[i]` i `neighbors[i]` są **współbieżnie uporządkowane**: sąsiad `neighbors[i][k]` leży za krawędzią między `corners[i][k]` a `corners[i][(k+1) % len]`.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/dual.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { add, normalize, scale, type Vec3 } from '../src/math/vec3.js';
import { buildGeodesic } from '../src/world/geodesic.js';
import { buildDual } from '../src/world/dual.js';

const dual12 = buildDual(buildGeodesic(12));

describe('buildDual', () => {
  it('daje jedną komórkę na wierzchołek geodezyjny', () => {
    expect(dual12.centers.length).toBe(1442);
  });

  it('ma DOKŁADNIE 12 pentagonów, reszta to heksagony', () => {
    const pent = dual12.cellTypes.filter((t) => t === 'PENTAGON').length;
    const hex = dual12.cellTypes.filter((t) => t === 'HEXAGON').length;
    expect(pent).toBe(12);
    expect(hex).toBe(1430);
  });

  it('każda komórka ma 5 albo 6 sąsiadów, zgodnie ze swoim typem', () => {
    for (let i = 0; i < dual12.centers.length; i++) {
      const expected = dual12.cellTypes[i] === 'PENTAGON' ? 5 : 6;
      expect(dual12.neighbors[i].length).toBe(expected);
    }
  });

  it('liczba narożników zgadza się z liczbą sąsiadów', () => {
    for (let i = 0; i < dual12.centers.length; i++) {
      expect(dual12.corners[i].length).toBe(dual12.neighbors[i].length);
    }
  });

  it('sąsiedztwo jest symetryczne', () => {
    for (let i = 0; i < dual12.centers.length; i++) {
      for (const n of dual12.neighbors[i]) {
        expect(dual12.neighbors[n]).toContain(i);
      }
    }
  });

  it('żadna komórka nie jest swoim własnym sąsiadem i nie ma duplikatów', () => {
    for (let i = 0; i < dual12.centers.length; i++) {
      const ns = dual12.neighbors[i];
      expect(ns).not.toContain(i);
      expect(new Set(ns).size).toBe(ns.length);
    }
  });

  it('12 pentagonów to wierzchołki wyjściowego dwudziestościanu — są maksymalnie rozproszone', () => {
    const pentIds = dual12.cellTypes
      .map((t, i) => (t === 'PENTAGON' ? i : -1))
      .filter((i) => i >= 0);
    // Żadne dwa pentagony nie sąsiadują ze sobą przy tej częstotliwości.
    for (const p of pentIds) {
      for (const n of dual12.neighbors[p]) {
        expect(dual12.cellTypes[n]).toBe('HEXAGON');
      }
    }
  });

  it('jest deterministyczny', () => {
    expect(buildDual(buildGeodesic(4))).toEqual(buildDual(buildGeodesic(4)));
  });

  it('narożniki i sąsiedzi są współbieżnie uporządkowane: sąsiad k leży za krawędzią między narożnikami k i k+1', () => {
    // Test at multiple frequencies to catch regressions early
    const frequencies = [1, 4, 12];
    let totalEdgeChecks = 0;

    for (const freq of frequencies) {
      const mesh = buildGeodesic(freq);
      const dual = buildDual(mesh);

      // Precompute face centroids using the same formula as buildDual
      const faceCentroids: Vec3[] = mesh.faces.map(([a, b, c]) =>
        normalize(scale(add(add(mesh.vertices[a], mesh.vertices[b]), mesh.vertices[c]), 1 / 3)),
      );

      // For each cell
      for (let v = 0; v < dual.centers.length; v++) {
        const corners = dual.corners[v];
        const neighbors = dual.neighbors[v];

        // For each edge in the cell
        for (let k = 0; k < neighbors.length; k++) {
          const neighbor = neighbors[k];
          const cornerCurrent = corners[k];
          const cornerNext = corners[(k + 1) % corners.length];

          // Find the two faces that share edge (v, neighbor)
          const sharedFaces: number[] = [];
          for (let f = 0; f < mesh.faces.length; f++) {
            const [a, b, c] = mesh.faces[f];
            if (
              ((a === v || b === v || c === v) && (a === neighbor || b === neighbor || c === neighbor))
            ) {
              sharedFaces.push(f);
            }
          }

          // There must be exactly 2 faces sharing this edge
          expect(sharedFaces).toHaveLength(2);

          // Get the centroids of the two shared faces
          const centroid1 = faceCentroids[sharedFaces[0]];
          const centroid2 = faceCentroids[sharedFaces[1]];

          // The two centroids should match the two adjacent corners (in either order)
          const eps = 1e-9;
          const match1 = (
            Math.abs(centroid1.x - cornerCurrent.x) < eps &&
            Math.abs(centroid1.y - cornerCurrent.y) < eps &&
            Math.abs(centroid1.z - cornerCurrent.z) < eps &&
            Math.abs(centroid2.x - cornerNext.x) < eps &&
            Math.abs(centroid2.y - cornerNext.y) < eps &&
            Math.abs(centroid2.z - cornerNext.z) < eps
          );

          const match2 = (
            Math.abs(centroid2.x - cornerCurrent.x) < eps &&
            Math.abs(centroid2.y - cornerCurrent.y) < eps &&
            Math.abs(centroid2.z - cornerCurrent.z) < eps &&
            Math.abs(centroid1.x - cornerNext.x) < eps &&
            Math.abs(centroid1.y - cornerNext.y) < eps &&
            Math.abs(centroid1.z - cornerNext.z) < eps
          );

          expect(match1 || match2).toBe(true);
          totalEdgeChecks++;
        }
      }
    }

    // Log edge checks performed for regression tracking
    expect(totalEdgeChecks).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/dual.test.ts`
Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj konwersję**

`packages/sim/src/world/dual.ts`:
```ts
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../math/vec3.js';
import type { GeodesicMesh } from './geodesic.js';

export type CellType = 'HEXAGON' | 'PENTAGON';

export interface DualMesh {
  /** Środek komórki = pozycja wierzchołka geodezyjnego, na sferze jednostkowej. */
  centers: Vec3[];
  /** Narożniki wielokąta, uporządkowane kątowo wokół normalnej komórki. */
  corners: Vec3[][];
  /** Sąsiedzi współbieżni z corners: neighbors[k] leży za krawędzią corners[k]→corners[k+1]. */
  neighbors: number[][];
  cellTypes: CellType[];
}

export function buildDual(mesh: GeodesicMesh): DualMesh {
  const vertexCount = mesh.vertices.length;

  // Ściany incydentne do każdego wierzchołka.
  const incident: number[][] = Array.from({ length: vertexCount }, () => []);
  for (let f = 0; f < mesh.faces.length; f++) {
    const [a, b, c] = mesh.faces[f];
    incident[a].push(f);
    incident[b].push(f);
    incident[c].push(f);
  }

  const faceCentroids: Vec3[] = mesh.faces.map(([a, b, c]) =>
    normalize(scale(add(add(mesh.vertices[a], mesh.vertices[b]), mesh.vertices[c]), 1 / 3)),
  );

  const centers: Vec3[] = mesh.vertices.slice();
  const corners: Vec3[][] = [];
  const neighbors: number[][] = [];
  const cellTypes: CellType[] = [];

  for (let v = 0; v < vertexCount; v++) {
    const normal = mesh.vertices[v];
    const { tangent, bitangent } = tangentBasis(normal);

    // Uporządkuj ściany incydentne kątowo wokół normalnej — daje wielokąt komórki.
    const ordered = incident[v]
      .map((f) => {
        const d = sub(faceCentroids[f], normal);
        return { f, angle: Math.atan2(dot(d, bitangent), dot(d, tangent)) };
      })
      .sort((p, q) => (p.angle === q.angle ? p.f - q.f : p.angle - q.angle))
      .map((p) => p.f);

    corners[v] = ordered.map((f) => faceCentroids[f]);

    // Sąsiad między kolejnymi narożnikami to wierzchołek dzielony przez obie ściany
    // (poza samym v) — czyli druga końcówka wspólnej krawędzi.
    const ns: number[] = [];
    for (let k = 0; k < ordered.length; k++) {
      const f1 = mesh.faces[ordered[k]];
      const f2 = mesh.faces[ordered[(k + 1) % ordered.length]];
      const shared = f1.filter((x) => x !== v && f2.includes(x));
      if (shared.length !== 1) {
        throw new Error(`Komórka ${v}: ściany ${ordered[k]} i ${ordered[(k + 1) % ordered.length]} dzielą ${shared.length} wierzchołków zamiast 1`);
      }
      ns.push(shared[0]);
    }

    neighbors[v] = ns;
    cellTypes[v] = ns.length === 5 ? 'PENTAGON' : 'HEXAGON';
  }

  return { centers, corners, neighbors, cellTypes };
}

/** Dowolna, ale DETERMINISTYCZNA baza styczna do wektora jednostkowego. */
function tangentBasis(n: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  // Wybierz oś najmniej równoległą do n, żeby uniknąć degeneracji.
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const helper = ax <= ay && ax <= az
    ? { x: 1, y: 0, z: 0 }
    : ay <= az
      ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 };
  const tangent = normalize(cross(n, helper));
  const bitangent = cross(n, tangent);
  return { tangent, bitangent };
}
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/dual.test.ts`
Oczekiwane: **9 testów przechodzi.** Test „dokładnie 12 pentagonów" jest najważniejszy — to twarda konsekwencja geometrii bryły i fundament całej warstwy map control (§2 specu).

Ostatni test jest strażnikiem regresji dla niezmiennika współindeksowania z nagłówka tego
zadania. Liczy centroidy i przyległość ścian **niezależnie od `dual.ts`** — inaczej sprawdzałby
implementację samą ze sobą. Przy obrocie `neighbors` o dowolny offset względem `corners` wywala
się na pierwszym `k`, bo pary kolejnych indeksów w cyklu długości ≥5 są parami różne jako zbiory.
Bez niego kontrakt, który Task 7 konsumuje pozycyjnie, nie miałby w repozytorium żadnej ochrony.

```bash
git add packages/sim/src/world/dual.ts packages/sim/test/dual.test.ts
git commit -m "feat(sim): siatka dualna Goldberga, klasyfikacja komórek i graf sąsiedztwa"
```

---

### Task 5: Metryka jednorodności siatki i udokumentowany wynik negatywny

**Files:**
- Create: `packages/sim/src/world/uniformity.ts`
- Test: `packages/sim/test/uniformity.test.ts`

**Interfaces:**
- Consumes: `DualMesh` z `./dual.js`; `cross`, `length`, `sub` z `../math/vec3.js`
- Produces:
  - `function spacingCv(dual: DualMesh): number`
  - `function areaCv(dual: DualMesh): number`

**To zadanie zmieniło zakres w trakcie Fazy 1A.** Pierwotnie miało implementować relaksację
laplasjanową, bo spec zakładał, że zredukuje ona rozrzut pól komórek z ~20 % do ~5 %. Pomiar
to obalił: przy frequency 12 rozrzut wyjściowy wynosi `spacingCv = 0,0716` i `areaCv = 0,1330`,
a wygładzanie go **nie zmniejsza** — po 1 iteracji 0,0704, po 3 iteracjach 0,0706, po 10
iteracjach 0,0718 (gorzej niż wyjściowo), po 200 iteracjach 0,0717. Sfera geodezyjna już leży
w punkcie stałym tego operatora.

Zadaniem jest więc **zmierzyć i utrwalić** rzeczywistą jednorodność, a nie próbować jej poprawiać.
Wynik negatywny zostaje w kodzie jako komentarz, żeby nikt nie zaimplementował relaksacji po raz
drugi, nie wiedząc, że została już sprawdzona.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/uniformity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildGeodesic } from '../src/world/geodesic.js';
import { buildDual } from '../src/world/dual.js';
import { areaCv, spacingCv } from '../src/world/uniformity.js';

const dual12 = buildDual(buildGeodesic(12));

describe('spacingCv', () => {
  it('przypina zmierzony rozrzut odstępów przy frequency 12', () => {
    expect(spacingCv(dual12)).toBeCloseTo(0.0716, 3);
  });

  it('jest dodatni i skończony', () => {
    const v = spacingCv(dual12);
    expect(v).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
  });

  it('jest deterministyczny', () => {
    expect(spacingCv(buildDual(buildGeodesic(4)))).toBe(spacingCv(buildDual(buildGeodesic(4))));
  });

  it('siatka idealnie regularna miałaby zerowy rozrzut — dwudziestościan bazowy jest taki', () => {
    // Przy frequency 1 wszystkie krawędzie dwudziestościanu są równe z konstrukcji,
    // więc rozrzut musi być numerycznie zerowy. To kalibruje samą metrykę:
    // gdyby liczyła coś innego niż odległości środek-sąsiad, tu by nie wyszło zero.
    expect(spacingCv(buildDual(buildGeodesic(1)))).toBeCloseTo(0, 9);
  });
});

describe('areaCv', () => {
  it('przypina zmierzony rozrzut pól przy frequency 12', () => {
    expect(areaCv(dual12)).toBeCloseTo(0.1330, 3);
  });

  it('rozrzut pól jest większy niż rozrzut odstępów — pole skaluje się kwadratowo', () => {
    expect(areaCv(dual12)).toBeGreaterThan(spacingCv(dual12));
  });

  it('jest deterministyczny', () => {
    expect(areaCv(buildDual(buildGeodesic(4)))).toBe(areaCv(buildDual(buildGeodesic(4))));
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/uniformity.test.ts`
Oczekiwane: FAIL — brak modułu `uniformity.js`.

- [ ] **Step 3: Zaimplementuj metryki**

`packages/sim/src/world/uniformity.ts`:
```ts
import { cross, length, sub } from '../math/vec3.js';
import type { DualMesh } from './dual.js';

/**
 * WYNIK NEGATYWNY — NIE IMPLEMENTUJ RELAKSACJI PONOWNIE.
 *
 * Spec pierwotnie zakładał 2-3 iteracje wygładzania laplasjanowego, mające zredukować
 * rozrzut pól komórek z ~20 % do ~5 %. Zmierzone przy frequency 12:
 *
 *   iteracje:      0        1        3       10      200
 *   spacingCv:  0,0716   0,0704   0,0706   0,0718   0,0717
 *   areaCv:     0,1330   0,1327   0,1328   0,1338   0,1335
 *
 * Sfera geodezyjna już leży w punkcie stałym operatora laplasjanowego, więc iterowanie
 * niczego nie poprawia, a powyżej ~3 iteracji dryfuje numerycznie na gorsze.
 * Lloyd na siatce dualnej to algebraicznie `normalize(3v + Σsąsiedzi)`, czyli tłumiona
 * wersja tego samego operatora — jeszcze słabsza.
 *
 * Rozrzut jest akceptowalny: reguły gry idą w krokach grafu (N1), więc rozgrywki nie
 * dotyczy wcale. Gdyby warstwa wizualna uznała inaczej, właściwym narzędziem jest
 * relaksacja sprężynowa wyrównująca DŁUGOŚCI KRAWĘDZI, nie operator centroidowy.
 */

/** Współczynnik zmienności odległości środek–sąsiad. Frequency 12: 0,0716. */
export function spacingCv(dual: DualMesh): number {
  const samples: number[] = [];
  for (let v = 0; v < dual.centers.length; v++) {
    for (const n of dual.neighbors[v]) {
      if (n > v) samples.push(length(sub(dual.centers[n], dual.centers[v])));
    }
  }
  return coefficientOfVariation(samples);
}

/** Współczynnik zmienności pól komórek. Frequency 12: 0,1330. */
export function areaCv(dual: DualMesh): number {
  const areas: number[] = [];
  for (let v = 0; v < dual.centers.length; v++) {
    const center = dual.centers[v];
    const corners = dual.corners[v];
    let area = 0;
    for (let i = 0; i < corners.length; i++) {
      const p = sub(corners[i], center);
      const q = sub(corners[(i + 1) % corners.length], center);
      area += length(cross(p, q)) / 2;
    }
    areas.push(area);
  }
  return coefficientOfVariation(areas);
}

function coefficientOfVariation(samples: number[]): number {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance) / mean;
}
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/uniformity.test.ts`
Oczekiwane: **7 testów przechodzi.**

Test przy frequency 1 jest kalibracją samej metryki: krawędzie dwudziestościanu bazowego są równe
z konstrukcji, więc rozrzut musi tam wyjść numerycznie zerowy. Gdyby `spacingCv` liczyło cokolwiek
innego niż odległości środek–sąsiad, ten test by to wykrył.

```bash
git add packages/sim/src/world/uniformity.ts packages/sim/test/uniformity.test.ts
git commit -m "feat(sim): metryki jednorodności siatki + udokumentowany wynik negatywny relaksacji"
```

---

### Task 6: Moduł skali — niezmienniki N1, N2, N3

**Files:**
- Create: `packages/sim/src/world/scale.ts`
- Test: `packages/sim/test/scale.test.ts`

**Interfaces:**
- Consumes: nic
- Produces:
  - `function cellSpacing(radius: number, cellCount: number): number`
  - `function terminatorSpeedWorld(radius: number, rotationPeriod: number): number`
  - `function terminatorSpeedCells(cellCount: number, rotationPeriod: number): number`
  - `function terminatorCrossingTime(baseWidthCells: number, rotationPeriod: number, cellCount: number): number`
  - `function burnEscapeDepth(burnTime: number, speedCells: number, termSpeedCells: number): number`

To jest najważniejszy moduł tej fazy pod względem balansu: koduje wyprowadzenia z §4.3 i §4.4 specu jako pojedyncze źródło prawdy. Draft trafił w sensowne wartości przypadkiem i cicha zmiana `rotationPeriod` wyzerowałaby mechanikę świtu — te testy to wykryją.

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/scale.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  burnEscapeDepth,
  cellSpacing,
  terminatorCrossingTime,
  terminatorSpeedCells,
  terminatorSpeedWorld,
} from '../src/world/scale.js';

const N = 1442;
const T = 180;

describe('niezmiennik N2 — promień planety nie wpływa na rozgrywkę', () => {
  it('cellSpacing skaluje się LINIOWO z promieniem', () => {
    expect(cellSpacing(100, N)).toBeCloseTo(2 * cellSpacing(50, N), 10);
    expect(cellSpacing(1000, N)).toBeCloseTo(20 * cellSpacing(50, N), 10);
  });

  it('terminatorSpeedWorld skaluje się LINIOWO z promieniem', () => {
    expect(terminatorSpeedWorld(100, T)).toBeCloseTo(2 * terminatorSpeedWorld(50, T), 10);
    expect(terminatorSpeedWorld(1000, T)).toBeCloseTo(20 * terminatorSpeedWorld(50, T), 10);
  });

  it('przez co ich iloraz — czas pokonania komórki — od promienia NIE zależy', () => {
    const ratio = (r: number) => cellSpacing(r, N) / terminatorSpeedWorld(r, T);
    expect(ratio(50)).toBeCloseTo(ratio(100), 10);
    expect(ratio(100)).toBeCloseTo(ratio(1000), 10);
  });
});

describe('§4.3 — wartości odniesienia dla N=1442, T=180 s', () => {
  it('prędkość terminatora ≈ 0,348 kroku/s', () => {
    expect(terminatorSpeedCells(N, T)).toBeCloseTo(0.34798, 4);
  });

  it('czas przejazdu przez bazę zgadza się z tabelą ze specu', () => {
    expect(terminatorCrossingTime(5, T, N)).toBeCloseTo(14.369, 2);
    expect(terminatorCrossingTime(10, T, N)).toBeCloseTo(28.738, 2);
    expect(terminatorCrossingTime(15, T, N)).toBeCloseTo(43.106, 2);
  });

  it('czas przejazdu jest liniowy w szerokości bazy', () => {
    expect(terminatorCrossingTime(20, T, N)).toBeCloseTo(2 * terminatorCrossingTime(10, T, N), 9);
  });
});

describe('niezmiennik N3 — pas śmierci', () => {
  const term = terminatorSpeedCells(N, T);

  it('jednostka szybsza od terminatora ma dodatnią głębokość ucieczki', () => {
    expect(burnEscapeDepth(3, 0.8, term)).toBeGreaterThan(0);
  });

  it('jednostka WOLNIEJSZA od terminatora nigdy nie ucieka ze światła', () => {
    expect(burnEscapeDepth(8, 0.3, term)).toBeLessThanOrEqual(0);
  });

  it('jednostka o prędkości dokładnie terminatora ma zerową głębokość ucieczki', () => {
    expect(burnEscapeDepth(8, term, term)).toBeCloseTo(0, 12);
  });

  it('dłuższy burnTime oznacza głębszy pas ucieczki', () => {
    expect(burnEscapeDepth(6, 0.8, term)).toBeGreaterThan(burnEscapeDepth(3, 0.8, term));
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/scale.test.ts`
Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj moduł skali**

`packages/sim/src/world/scale.ts`:
```ts
/**
 * Wyprowadzenia skali z §4.3 i §4.4 specu. JEDYNE źródło prawdy dla tych wzorów —
 * nic w symulacji nie powinno liczyć ich samodzielnie.
 */

/** Pole regularnego sześciokąta o odstępie środków d wynosi (√3/2)·d². */
const HEX_AREA_FACTOR = Math.sqrt(3) / 2;

/** Bezwymiarowy stosunek odstępu komórek do promienia planety: d = R · k(N). */
const spacingRatio = (cellCount: number): number =>
  Math.sqrt((4 * Math.PI) / (HEX_AREA_FACTOR * cellCount));

/** Odległość środek–środek sąsiednich komórek, w jednostkach świata. */
export const cellSpacing = (radius: number, cellCount: number): number =>
  radius * spacingRatio(cellCount);

/** Prędkość terminatora po powierzchni, w jednostkach świata na sekundę. */
export const terminatorSpeedWorld = (radius: number, rotationPeriod: number): number =>
  (2 * Math.PI * radius) / rotationPeriod;

/**
 * Prędkość terminatora w krokach grafu na sekundę.
 * Promień skraca się — to jest formalny dowód niezmiennika N2.
 */
export const terminatorSpeedCells = (cellCount: number, rotationPeriod: number): number =>
  (2 * Math.PI) / (rotationPeriod * spacingRatio(cellCount));

/** Czas, w jakim terminator przechodzi przez bazę szeroką na baseWidthCells kroków. */
export const terminatorCrossingTime = (
  baseWidthCells: number,
  rotationPeriod: number,
  cellCount: number,
): number => (baseWidthCells * rotationPeriod * spacingRatio(cellCount)) / (2 * Math.PI);

/**
 * Niezmiennik N3: maksymalna głębokość wewnątrz oświetlonego obszaru,
 * z której jednostka zdąży uciec do cienia, w krokach grafu.
 * Wynik ≤ 0 oznacza, że jednostka NIGDY nie ucieka ze światła.
 */
export const burnEscapeDepth = (
  burnTime: number,
  speedCells: number,
  termSpeedCells: number,
): number => burnTime * (speedCells - termSpeedCells);
```

- [ ] **Step 4: Uruchom testy i commituj**

Run: `pnpm vitest run packages/sim/test/scale.test.ts`
Oczekiwane: **10 testów przechodzi.** Trzy pierwsze działają razem: dwie osobno zweryfikowane
liniowości sprawiają, że skracanie się promienia w teście ilorazowym jest ich dowiedzioną
konsekwencją, a nie zbiegiem okoliczności.

```bash
git add packages/sim/src/world/scale.ts packages/sim/test/scale.test.ts
git commit -m "feat(sim): moduł skali kodujący niezmienniki N1/N2/N3 jako jedyne źródło prawdy"
```

---

### Task 7: createPlanet — klastry rudy, pozycja startowa, publiczne API

**Files:**
- Create: `packages/sim/src/world/graph.ts`, `packages/sim/src/world/planet.ts`
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/test/planet.test.ts`

**Interfaces:**
- Consumes: `buildGeodesic`, `buildDual`, `Rng`, `STREAM`, `scale`
- Produces:
  - `function multiSourceDistances(neighbors: number[][], sources: number[]): number[]`
  - `interface Cell { id, center, normal, corners, neighbors, cellType, oreCapacity }`
  - `interface Planet { seed, radius, frequency, cells, pentagons, startCell }`
  - `interface PlanetOptions { seed, frequency?, radius?, oreClusters?, oreClusterRadius?, oreCapacityPerCell?, minStartDistanceFromPentagon? }`
  - `function createPlanet(opts: PlanetOptions): Planet`

- [ ] **Step 1: Napisz testy (mają nie przejść)**

`packages/sim/test/planet.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { multiSourceDistances } from '../src/world/graph.js';
import { length } from '../src/math/vec3.js';

const planet = createPlanet({ seed: 20260914 });

describe('multiSourceDistances', () => {
  it('liczy odległość grafową od najbliższego źródła', () => {
    //  0 -- 1 -- 2 -- 3
    const neighbors = [[1], [0, 2], [1, 3], [2]];
    expect(multiSourceDistances(neighbors, [0])).toEqual([0, 1, 2, 3]);
    expect(multiSourceDistances(neighbors, [0, 3])).toEqual([0, 1, 1, 0]);
  });

  it('oznacza nieosiągalne jako Infinity', () => {
    expect(multiSourceDistances([[], []], [0])).toEqual([0, Infinity]);
  });
});

describe('createPlanet', () => {
  it('daje 1442 komórki z 12 pentagonami', () => {
    expect(planet.cells.length).toBe(1442);
    expect(planet.pentagons.length).toBe(12);
    for (const p of planet.pentagons) expect(planet.cells[p].cellType).toBe('PENTAGON');
  });

  it('skaluje komórki do promienia planety', () => {
    for (const c of planet.cells) expect(length(c.center)).toBeCloseTo(planet.radius, 9);
  });

  it('jest w pełni deterministyczna względem seeda', () => {
    expect(createPlanet({ seed: 20260914 })).toEqual(planet);
  });

  it('inny seed daje inny rozkład rudy', () => {
    const other = createPlanet({ seed: 777 });
    const oreA = planet.cells.filter((c) => c.oreCapacity > 0).map((c) => c.id);
    const oreB = other.cells.filter((c) => c.oreCapacity > 0).map((c) => c.id);
    expect(oreA).not.toEqual(oreB);
  });

  it('ruda leży wyłącznie na heksagonach', () => {
    for (const c of planet.cells) {
      if (c.oreCapacity > 0) expect(c.cellType).toBe('HEXAGON');
    }
  });

  it('ruda tworzy klastry, a nie pojedyncze rozsypane komórki', () => {
    const ore = planet.cells.filter((c) => c.oreCapacity > 0);
    expect(ore.length).toBeGreaterThan(30);
    // Pojedyncza izolowana komórka jest teoretycznie możliwa, gdy sąsiedzi przy pentagonie
    // zostaną pominięte — ale ruda ma być zasadniczo klastrowa, nie rozsypana.
    const isolated = ore.filter(
      (c) => !c.neighbors.some((n) => planet.cells[n].oreCapacity > 0),
    );
    expect(isolated.length / ore.length).toBeLessThan(0.02);
  });

  it('komórka startowa to heksagon bez rudy, odsunięty od pentagonów', () => {
    const start = planet.cells[planet.startCell];
    expect(start.cellType).toBe('HEXAGON');
    expect(start.oreCapacity).toBe(0);

    const distances = multiSourceDistances(
      planet.cells.map((c) => c.neighbors),
      planet.pentagons,
    );
    expect(distances[planet.startCell]).toBeGreaterThanOrEqual(4);
  });

  it('odrzuca wymagania niemożliwe do spełnienia zamiast po cichu je obniżać', () => {
    expect(() => createPlanet({ seed: 1, minStartDistanceFromPentagon: 99 })).toThrow(
      /komórkę startową/,
    );
  });
});
```

- [ ] **Step 2: Uruchom testy i potwierdź porażkę**

Run: `pnpm vitest run packages/sim/test/planet.test.ts`
Oczekiwane: FAIL — brak modułów.

- [ ] **Step 3: Zaimplementuj przeszukiwanie grafu**

`packages/sim/src/world/graph.ts`:
```ts
/**
 * BFS wieloźródłowy: dla każdej komórki odległość w krokach grafu
 * do najbliższego źródła. Nieosiągalne dostają Infinity.
 */
export function multiSourceDistances(neighbors: number[][], sources: number[]): number[] {
  const dist = new Array<number>(neighbors.length).fill(Infinity);
  const queue: number[] = [];

  for (const s of sources) {
    if (dist[s] !== 0) {
      dist[s] = 0;
      queue.push(s);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const n of neighbors[cur]) {
      if (dist[n] === Infinity) {
        dist[n] = dist[cur] + 1;
        queue.push(n);
      }
    }
  }

  return dist;
}
```

- [ ] **Step 4: Zaimplementuj createPlanet**

`packages/sim/src/world/planet.ts`:
```ts
import { Rng, STREAM } from '../math/rng.js';
import { scale, type Vec3 } from '../math/vec3.js';
import { buildDual, type CellType } from './dual.js';
import { buildGeodesic } from './geodesic.js';
import { multiSourceDistances } from './graph.js';

export interface Cell {
  readonly id: number;
  /** Na sferze o promieniu planety. */
  readonly center: Vec3;
  /** Jednostkowa — równa center/radius. Wydzielona, bo oświetlenie liczy się z niej co tick. */
  readonly normal: Vec3;
  readonly corners: Vec3[];
  readonly neighbors: number[];
  readonly cellType: CellType;
  /** 0 = brak złoża. Złoża są wyczerpywalne (§5.2), więc to pojemność początkowa. */
  readonly oreCapacity: number;
}

export interface Planet {
  readonly seed: number;
  readonly radius: number;
  readonly frequency: number;
  readonly cells: Cell[];
  readonly pentagons: number[];
  readonly startCell: number;
}

export interface PlanetOptions {
  seed: number;
  /** 12 ⇒ 1442 komórki (D2). */
  frequency?: number;
  /** Wyłącznie estetyka — niezmiennik N2. */
  radius?: number;
  oreClusters?: number;
  oreClusterRadius?: number;
  oreCapacityPerCell?: number;
  minStartDistanceFromPentagon?: number;
}

const DEFAULTS = {
  frequency: 12,
  radius: 100,
  oreClusters: 14,
  oreClusterRadius: 2,
  oreCapacityPerCell: 400,
  minStartDistanceFromPentagon: 4,
} as const;

export function createPlanet(opts: PlanetOptions): Planet {
  const o = { ...DEFAULTS, ...opts };
  // Bez relaksacji — Task 5 zmierzył, że laplasjan na tej konstrukcji nic nie poprawia.
  const dual = buildDual(buildGeodesic(o.frequency));
  const rng = new Rng(o.seed);

  const cellCount = dual.centers.length;
  const neighbors = dual.neighbors;
  const pentagons = dual.cellTypes
    .map((t, i) => (t === 'PENTAGON' ? i : -1))
    .filter((i) => i >= 0);

  const oreCapacity = placeOre(rng.fork(STREAM.ORE), dual.cellTypes, neighbors, o);
  const distFromPentagon = multiSourceDistances(neighbors, pentagons);
  const startCell = pickStart(rng.fork(STREAM.START), dual.cellTypes, oreCapacity, distFromPentagon, o);

  const cells: Cell[] = [];
  for (let i = 0; i < cellCount; i++) {
    cells.push({
      id: i,
      center: scale(dual.centers[i], o.radius),
      normal: dual.centers[i],
      corners: dual.corners[i].map((c) => scale(c, o.radius)),
      neighbors: neighbors[i],
      cellType: dual.cellTypes[i],
      oreCapacity: oreCapacity[i],
    });
  }

  return {
    seed: o.seed,
    radius: o.radius,
    frequency: o.frequency,
    cells,
    pentagons,
    startCell,
  };
}

/**
 * Ruda w klastrach, nie rozsypana losowo (§5.2): pojedyncze heksy dałyby zbieractwo,
 * pola złóż dają decyzję o kierunku ekspansji.
 */
function placeOre(
  rng: Rng,
  cellTypes: CellType[],
  neighbors: number[][],
  o: typeof DEFAULTS & PlanetOptions,
): number[] {
  const capacity = new Array<number>(cellTypes.length).fill(0);
  const hexes: number[] = [];
  for (let i = 0; i < cellTypes.length; i++) {
    if (cellTypes[i] === 'HEXAGON') hexes.push(i);
  }

  for (let c = 0; c < o.oreClusters; c++) {
    const seedCell = hexes[rng.nextInt(hexes.length)];
    const dist = multiSourceDistances(neighbors, [seedCell]);
    for (let i = 0; i < capacity.length; i++) {
      if (cellTypes[i] !== 'HEXAGON' || dist[i] > o.oreClusterRadius) continue;
      // Pojemność maleje ku obrzeżom klastra — środek pola jest wart bronienia.
      const falloff = 1 - dist[i] / (o.oreClusterRadius + 1);
      capacity[i] = Math.max(capacity[i], Math.round(o.oreCapacityPerCell * falloff));
    }
  }

  return capacity;
}

function pickStart(
  rng: Rng,
  cellTypes: CellType[],
  oreCapacity: number[],
  distFromPentagon: number[],
  o: typeof DEFAULTS & PlanetOptions,
): number {
  const candidates: number[] = [];
  for (let i = 0; i < cellTypes.length; i++) {
    if (
      cellTypes[i] === 'HEXAGON' &&
      oreCapacity[i] === 0 &&
      distFromPentagon[i] >= o.minStartDistanceFromPentagon
    ) {
      candidates.push(i);
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      `Brak kandydata na komórkę startową: minStartDistanceFromPentagon=${o.minStartDistanceFromPentagon} ` +
        `jest nieosiągalne przy frequency=${o.frequency}. Obniż wymaganie albo zwiększ częstotliwość.`,
    );
  }

  return candidates[rng.nextInt(candidates.length)];
}
```

- [ ] **Step 5: Wystaw publiczne API**

`packages/sim/src/index.ts`:
```ts
export const SIM_VERSION = '0.0.0';

export { Rng, STREAM } from './math/rng.js';
export * from './math/vec3.js';

export { buildGeodesic, vertexCountFor, type GeodesicMesh } from './world/geodesic.js';
export { buildDual, type CellType, type DualMesh } from './world/dual.js';
export { areaCv, spacingCv } from './world/uniformity.js';
export { multiSourceDistances } from './world/graph.js';
export {
  burnEscapeDepth,
  cellSpacing,
  terminatorCrossingTime,
  terminatorSpeedCells,
  terminatorSpeedWorld,
} from './world/scale.js';
export { createPlanet, type Cell, type Planet, type PlanetOptions } from './world/planet.js';
```

- [ ] **Step 6: Uruchom pełny zestaw testów i commituj**

Run: `pnpm test && pnpm typecheck`
Oczekiwane: **wszystkie testy przechodzą**, w tym strażnik zero-zależności z Task 1.

```bash
git add -A
git commit -m "feat(sim): createPlanet — klastry rudy, deterministyczna pozycja startowa, publiczne API"
```

---

## Definicja ukończenia Fazy 1A

- [ ] `pnpm test` zielony, `pnpm typecheck` bez błędów
- [ ] `createPlanet({ seed })` zwraca 1442 komórki, dokładnie 12 pentagonów, klastry rudy i prawidłową komórkę startową
- [ ] Determinizm potwierdzony testem: ten sam seed ⇒ identyczna planeta
- [ ] Strażnik zero-zależności przechodzi — `packages/sim` nie importuje niczego spoza siebie
- [ ] Niezmienniki N1/N2/N3 zakodowane w `scale.ts` i pokryte testami
- [ ] Zmierzone `spacingCv` i `areaCv` przypięte testami; wynik negatywny relaksacji udokumentowany w kodzie
- [ ] Rozwiązane wersje narzędzi zapisane w `docs/superpowers/plans/wersje.txt`

**Następny plan:** Faza 1B — rdzeń symulacji (`2026-09-14-faza-1b-symulacja.md`).
