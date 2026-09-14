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
  readonly corners: readonly Vec3[];
  /** Dzielone przez referencję z wewnętrznym DualMesh — tylko-do-odczytu, żeby konsument nie mógł go po cichu zmutować. */
  readonly neighbors: readonly number[];
  readonly cellType: CellType;
  /** 0 = brak złoża. Złoża są wyczerpywalne (§5.2), więc to pojemność początkowa. */
  readonly oreCapacity: number;
}

export interface Planet {
  readonly seed: number;
  readonly radius: number;
  readonly frequency: number;
  /** Tylko-do-odczytu: `pentagons`, `startCell` i każdy `Cell.neighbors` to indeksy w tę tablicę — sortowanie/mutacja w miejscu rozsynchronizowałaby je wszystkie. */
  readonly cells: readonly Cell[];
  readonly pentagons: readonly number[];
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
  // Rozwiązywane pole-po-polu, NIE `{ ...DEFAULTS, ...opts }`: `PlanetOptions` ma
  // opcjonalne pola bez `exactOptionalPropertyTypes`, więc jawnie przekazane
  // `{ radius: undefined }` (dokładnie tak woła Faza 2 rendererem/Faza 1C runnerem,
  // przekazując dalej własną, częściowo wypełnioną konfigurację) nadpisałoby
  // wartość z DEFAULTS, dając np. `radius === undefined` i ciche NaN we
  // wszystkich `center`/`corner` zamiast rzucanego błędu.
  const o = {
    seed: opts.seed,
    frequency: opts.frequency ?? DEFAULTS.frequency,
    radius: opts.radius ?? DEFAULTS.radius,
    oreClusters: opts.oreClusters ?? DEFAULTS.oreClusters,
    oreClusterRadius: opts.oreClusterRadius ?? DEFAULTS.oreClusterRadius,
    oreCapacityPerCell: opts.oreCapacityPerCell ?? DEFAULTS.oreCapacityPerCell,
    minStartDistanceFromPentagon: opts.minStartDistanceFromPentagon ?? DEFAULTS.minStartDistanceFromPentagon,
  };
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
      // scale(..., 1) zamiast bezpośredniego przypisania: świeży obiekt zamiast aliasu do
      // wewnętrznego DualMesh, tak jak center i corners obok (por. komentarz przy neighbors).
      normal: scale(dual.centers[i], 1),
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
  o: Required<PlanetOptions>,
): number[] {
  const capacity = new Array<number>(cellTypes.length).fill(0);
  const hexes: number[] = [];
  for (let i = 0; i < cellTypes.length; i++) {
    if (cellTypes[i] === 'HEXAGON') hexes.push(i);
  }

  if (hexes.length === 0) {
    throw new Error(
      `Brak heksagonów do rozmieszczenia rudy: frequency=${o.frequency} daje samą powłokę ` +
        `dwudziestościanu (12 pentagonów, 0 heksagonów) — nie ma gdzie postawić klastra. ` +
        `Zwiększ frequency do co najmniej 2.`,
    );
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
  o: Required<PlanetOptions>,
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
