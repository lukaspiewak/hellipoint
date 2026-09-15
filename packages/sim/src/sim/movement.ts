import { add, dot, normalize, scale, type Vec3 } from '../math/vec3.js';
import { cellSpacing, terminatorSpeedCells } from '../world/scale.js';
import type { Planet } from '../world/planet.js';
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

/** Wszystkie typy wroga w stałej kolejności — iteracja NIGDY po `Object.keys`. */
const ENEMY_TYPES: readonly EnemyType[] = ['SWARM', 'ARMOR', 'DISRUPTOR'];

/**
 * `MotionContext` z planety i okresu obrotu. JEDNO miejsce, w którym ten obiekt
 * powstaje — konstruktor `Sim` i wyprowadzenie `minRotationPeriod` niżej MUSZĄ
 * liczyć te trzy liczby tym samym kodem, inaczej straż konstruktora i straż
 * `updateMovement` rozjeżdżają się o ULP-y (zmierzone: 1-2 ULP-y, patrz niżej).
 */
export function motionContext(planet: Planet, rotationPeriod: number): MotionContext {
  const n = planet.cells.length;
  return {
    termSpeedCells: terminatorSpeedCells(n, rotationPeriod),
    spacing: cellSpacing(planet.radius, n),
    radius: planet.radius,
  };
}

/** Kąt pokonywany przez jednostkę w JEDNYM ticku. Jedyne miejsce z tym wzorem. */
export function angularStepPerTick(speedFactor: number, ctx: MotionContext): number {
  const speedWorld = speedFactor * ctx.termSpeedCells * ctx.spacing;
  return (speedWorld * TICK_SECONDS) / ctx.radius;
}

/** Kątowy rozstaw środków sąsiednich komórek — GÓRNA (ostra) granica kroku. */
export function cellAngularSpacing(ctx: MotionContext): number {
  return ctx.spacing / ctx.radius;
}

/**
 * Czy krok NAJSZYBSZEGO wroga mieści się pod kątowym rozstawem komórek, czyli czy
 * `updateMovement` w ogóle da się przeliczyć w tym kontekście. Dokładnie ta sama
 * nierówność, którą egzekwuje straż w pętli niżej — wołana przez konstruktor `Sim`
 * PRZED pierwszym krokiem, żeby konfiguracja nie do przeliczenia nie przechodziła
 * konstrukcji i nie wybuchała dopiero w losowym ticku (zmierzone przed poprawką:
 * `rotationPeriod = 0,05` konstruowało się bez słowa i rzucało w ticku 12).
 */
export function motionIsSimulable(ctx: MotionContext): boolean {
  let fastest = 0;
  for (const type of ENEMY_TYPES) fastest = Math.max(fastest, ENEMIES[type].speedFactor);
  return angularStepPerTick(fastest, ctx) < cellAngularSpacing(ctx);
}

/**
 * Najkrótszy `rotationPeriod`, przy którym symulacja na TEJ planecie daje się
 * przeliczyć. WYPROWADZONY z niezmiennika `angleStep < cellAngularSpacing`, nie dobrany:
 *
 *   angleStep       = sf · termSpeedCells · spacing · TICK / R
 *   termSpeedCells  = 2π / (rotationPeriod · spacing/R)
 *   ⇒ angleStep     = sf · 2π · TICK / rotationPeriod          (spacing i R skracają się)
 *
 * Warunek `angleStep < spacing/R` daje więc
 *
 *   rotationPeriod  >  sf_max · 2π · TICK / (spacing/R)
 *
 * Dla planety domyślnej (N = 1442, R = 100) i sf_max = 2,3 (SWARM) wychodzi
 * **7,203121207399654 s** — zgodne z pomiarem z przeglądu gałęzi (każdy okres ≤ 7,20 s
 * rzucał, 7,21 s przechodził 3000 ticków). Granica NIE zależy od promienia (skraca się),
 * ale zależy od liczby komórek i od `ENEMIES` — stąd liczona z obu, nie zaszyta.
 *
 * Zwracana wartość to najmniejszy double, który straż faktycznie PRZEPUSZCZA, a nie samo
 * wyprowadzenie analityczne: obie strony liczone są w innej kolejności działań, więc
 * różnią się o 1-2 ULP-y (zmierzone dla f ∈ {8, 12, 16} × R ∈ {1, 100, 1000, 12345,678} —
 * zawsze 1 albo 2, nigdy więcej). Bez tego dochodzenia po jednym ULP-ie liczba podana
 * użytkownikowi w komunikacie błędu bywałaby przy ponownej próbie odrzucona DRUGI RAZ.
 */
export function minRotationPeriod(planet: Planet): number {
  const spacingAngle = cellAngularSpacing(motionContext(planet, 1));
  let fastest = 0;
  for (const type of ENEMY_TYPES) fastest = Math.max(fastest, ENEMIES[type].speedFactor);

  let period = (fastest * 2 * Math.PI * TICK_SECONDS) / spacingAngle;
  // Granica strukturalna, nie balansowa: 64 kroki to ~30× zmierzonego maksimum (2).
  for (let i = 0; i < 64 && !motionIsSimulable(motionContext(planet, period)); i++) {
    period = nextUpDouble(period);
  }
  return period;
}

/** Następny reprezentowalny double powyżej `x` (x skończony i dodatni). */
function nextUpDouble(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  if (lo === 0xffffffff) {
    view.setUint32(0, hi + 1);
    view.setUint32(4, 0);
  } else {
    view.setUint32(4, lo + 1);
  }
  return view.getFloat64(0);
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
  // Niezmiennik, na którym stoi nearestLocalCell (patrz jej doc-comment niżej):
  // przeszukuje WYŁĄCZNIE {bieżąca komórka} ∪ sąsiedzi, więc jest poprawna tylko
  // dopóki jednostka pokonuje w jednym ticku kąt MNIEJSZY niż kątowy rozstaw
  // komórek — inaczej przeskoczyłaby sąsiada, którego funkcja w ogóle nie widzi,
  // i cellId cicho rozjechałby się z prawdziwą pozycją (zmierzone w przeglądzie:
  // przy sztucznie podbitej prędkości rozjazd sięgał 15 kroków grafu, bez
  // żadnego wyjątku). speedFactor jest [STROJENIE] (Faza 3 dostroi go
  // headlessem) — margines dziś jest ~25× (zmierzone w raporcie Taska 1), ale
  // bez twardej straży przyszłe strojenie mogłoby go po cichu przekroczyć.
  //
  // Ta straż jest DRUGĄ linią: konstruktor `Sim` sprawdza dokładnie tę samą
  // nierówność (`motionIsSimulable`) i odrzuca konfigurację, zanim ruszy pierwszy
  // tick. Zostaje tutaj, bo `updateMovement` jest eksportowane i wołane w testach
  // z ręcznie złożonym `MotionContext`, który żadnego konstruktora nie widział.
  const spacingAngle = cellAngularSpacing(ctx);

  for (const u of s.units) {
    const def = ENEMIES[u.type];
    const angleStep = angularStepPerTick(def.speedFactor, ctx);

    if (angleStep >= spacingAngle) {
      throw new RangeError(
        `updateMovement: jednostka ${u.type} (speedFactor=${def.speedFactor}) pokonuje ` +
          `${angleStep} rad/tick — nie mniej niż kątowy rozstaw komórek (${spacingAngle} rad). ` +
          'nearestLocalCell przeszukuje tylko bieżącą komórkę i jej sąsiadów, więc taki krok cicho ' +
          'rozjeżdża cellId z prawdziwą pozycją. Obniż speedFactor tego typu w ENEMIES (defs.ts) albo ' +
          'zmień MotionContext (termSpeedCells/spacing/radius).',
      );
    }

    let targetDir: Vec3;

    if (light[u.cellId] > 0) {
      // W świetle jednostka porzuca cel i biegnie najkrótszą drogą do cienia,
      // czyli wzdłuż wielkiego okręgu ku punktowi antypodycznemu do słońca (§4.4).
      targetDir = scale(sunDir, -1);
    } else {
      const next = fields[u.type].next[u.cellId];
      // Brak celu, albo następna komórka jest zabudowana — stoimy.
      // Zabudowa nie jest przeszkodą absolutną: zajmie się nią walka (Task 2).
      // Ten wczesny `continue` musi zostać — Task 2 czyta `next` już PO tym
      // wywołaniu (`ahead = buildings[next]`), żeby wybrać cel walki.
      if (next < 0 || s.buildings[next] !== null) continue;
      targetDir = cells[next].normal;
    }

    const from = scale(u.pos, 1 / ctx.radius);
    const moved = slerpToward(from, targetDir, angleStep);
    const candidate = nearestLocalCell(s, u.cellId, moved);
    // Zabudowa blokuje tak samo w ucieczce, jak w marszu do celu (D3). Warunek
    // `candidate !== u.cellId` jest konieczny: bez niego jednostka, pod którą ktoś
    // postawi budynek, zamarza na zawsze zamiast z niego zejść.
    if (candidate !== u.cellId && s.buildings[candidate] !== null) continue;
    u.pos = scale(moved, ctx.radius);
    u.cellId = candidate;
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
