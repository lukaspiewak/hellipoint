import { add, dot, normalize, scale, vec3, type Vec3 } from '../math/vec3.js';
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
  // KOPIA, nie referencja. `pos` jest polem MUTOWALNEGO stanu (przepisywanym co tick
  // w pętli niżej), a `cells[].center` należy do NIEMUTOWALNEJ planety, której nikt
  // nie zamraża (zmierzone: `Object.isFrozen(planet)` === false, a `u.pos` było
  // identyczne CO DO REFERENCJI z `cells[cellId].center`). Dziś nic nie pisze po
  // `u.pos` w miejscu — każdy ruch podstawia nowy obiekt — więc defekt jest UŚPIONY,
  // ale jeden zapis `u.pos.x = …` gdziekolwiek w przyszłej fazie przestawiłby środek
  // komórki dla WSZYSTKICH późniejszych odczytów planety (oświetlenie, pola przepływu,
  // zasięgi, render). Kopia kosztuje jeden obiekt na zrodzoną jednostkę.
  const center = s.planet.cells[cellId].center;
  s.units.push({
    id: s.nextUnitId++,
    type,
    cellId,
    pos: vec3(center.x, center.y, center.z),
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
  przepuszczalnoscSwiatla: number,
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

    /** Kierunek do celu z pola przepływu; `null`, gdy trasa się urwała. */
    const celMarszu = (): Vec3 | null => {
      const next = fields[u.type].next[u.cellId];
      return next < 0 ? null : cells[next].normal;
    };

    /**
     * Kierunek marszu — MIESZANKA celu i ucieczki, sterowana poparzeniem.
     *
     * **Liczona ZAWSZE, nie tylko w świetle**, i to jest sedno. Pierwsza wersja tej naprawy
     * trzymała mieszanie pod warunkiem `light[u.cellId] > 0` i wygładziła wyłącznie WEJŚCIE
     * w światło: przy wyjściu jednostka wracała do pościgu natychmiast, czyli drugi raz
     * obracała się o 180° w jednym ticku. Zmierzone wtedy: **21,85 % ticków ze zwrotem
     * ostrzejszym niż 90°**, p90 = 175,6°. Poparzenie opada w cieniu stopniowo
     * (`SHADOW_RECOVERY_RATE`), więc użyte jako parametr daje ciągłość po OBU stronach
     * terminatora — jednostka odwraca się wchodząc i prostuje wychodząc.
     *
     * Zabudowa nie jest tu powodem do stania w miejscu — patrz kontrola ogonowa niżej
     * (naprawa O2). Brak trasy jest: wtedy zostaje sama ucieczka, bo stanie w świetle
     * znaczy śmierć, a w cieniu przy zerowym poparzeniu ucieczka i tak nie ma dokąd wieść.
     */
    const cel = celMarszu();
    const wSwietle = light[u.cellId] > 0;
    if (cel === null && !wSwietle && u.exposure <= 0) continue;
    const targetDir = kierunekMarszu(
      u.exposure,
      ENEMIES[u.type].burnTime,
      cel,
      sunDir,
      wSwietle,
      przepuszczalnoscSwiatla,
    );

    const from = scale(u.pos, 1 / ctx.radius);
    const moved = slerpToward(from, targetDir, angleStep);
    const candidate = nearestLocalCell(s, u.cellId, moved);
    // Zabudowa blokuje tak samo w ucieczce, jak w marszu do celu (D3). Warunek
    // `candidate !== u.cellId` jest konieczny: bez niego jednostka, pod którą ktoś
    // postawi budynek, zamarza na zawsze zamiast z niego zejść.
    //
    // Od naprawy O2 ta kontrola jest JEDYNYM strażnikiem wejścia w mur — wcześniej
    // dublował ją wczesny `continue` w gałęzi wyżej. Walka czyta `next` PO tym wywołaniu
    // (`ahead = buildings[next]`), więc `u.cellId` jednostki stojącej pod murem musi
    // zostać nietknięty; zapewnia to sama odmowa przejścia.
    if (candidate !== u.cellId && s.buildings[candidate] !== null) continue;
    u.pos = scale(moved, ctx.radius);
    u.cellId = candidate;
  }
}

/**
 * Kierunek marszu jednostki STOJĄCEJ W ŚWIETLE — mieszanka celu i ucieczki.
 *
 * ## Co to zmienia i dlaczego
 *
 * Do tej pory jednostka w świetle **porzucała cel natychmiast** i biegła ku punktowi
 * antypodycznemu do słońca. Dawało to dwie rzeczy, obie zgłoszone przez gracza w sesji 1
 * testów: wrogowie **odbijali się od terminatora jak od ściany** (zmierzone: głębokość
 * wejścia ZAWSZE dokładnie 1 krok, przez 20 000 ticków ani razu głębiej), a obrót o 180°
 * następował w jednym ticku, więc ruch czytał się szarpnięciem.
 *
 * Co ważniejsze, **ściana nie jest tym, co opisuje spec**. §4.4 definiuje PAS ŚMIERCI
 * `D = burnTime · (v − v_term)` — „maksymalną głębokość, z której wróg zdąży uciec" —
 * czyli światło jako RYZYKO, nie jako granicę nie do przejścia. Przy głębokości zawsze ≤ 1
 * ten wzór nie opisywał niczego, co zachodzi w grze, a test N3 sprawdzał wyłącznie jego
 * arytmetykę, nigdy zachowania.
 *
 * ## Jak
 *
 * Kierunek jest interpolowany **proporcjonalnie do POPARZENIA**, które stan już niesie
 * (`Unit.exposure`, naliczane w `burning.ts`): świeżo wszedłszy w światło jednostka wciąż
 * idzie do celu, a zawraca tym mocniej, im dłużej się piecze. Pełny odwrót przy
 * `PROG_ZAWROTU · burnTime`, czyli z drugą połową budżetu poparzenia na drogę powrotną.
 *
 * **Zero nowych pól w `SimState`** — i to nie jest oszczędność dla samej oszczędności:
 * każde nowe pole przechodzi przez niezmiennik serializowalności, kompletność `stateHash`
 * i skaner strukturalny, a `exposure` już tam jest i już jest haszowane.
 *
 * Ciągłość mieszania daje przy okazji **płynny obrót zamiast skoku o 180°** — ta sama
 * zmiana odpowiada więc na oba zgłoszenia gracza naraz.
 *
 * @param cel Kierunek do celu z pola przepływu, albo `null`, gdy trasa się urwała —
 *   wtedy zostaje sama ucieczka, bo stanie w świetle znaczy śmierć.
 */
export function kierunekMarszu(
  exposure: number,
  burnTime: number,
  cel: Vec3 | null,
  sunDir: Vec3,
  wSwietle: boolean,
  przepuszczalnosc: number,
): Vec3 {
  const ucieczka = scale(sunDir, -1);
  // Bez trasy zostaje sama ucieczka — także w cieniu przy zerowym poparzeniu, bo `cel`
  // jest wtedy `null` i nie ma czego mieszać. Poprzednia wersja miała tu `cel ?? ucieczka`,
  // czyli gałąź nieosiągalną: w tym miejscu `cel` jest z definicji `null`.
  if (cel === null) return ucieczka;
  const prog = przepuszczalnosc * burnTime;
  // `prog <= 0` to ŚCIANA: zawracaj natychmiast, ale tylko stojąc w świetle. To jest
  // zachowanie sprzed tej zmiany, zachowane co do bitu jako wartość domyślna gry.
  const t = prog <= 0 ? (wSwietle ? 1 : 0) : Math.min(1, Math.max(0, exposure / prog));
  if (t <= 0) return cel;
  if (t >= 1) return ucieczka;
  return slerpFraction(cel, ucieczka, t);
}

/**
 * Interpolacja sferyczna między dwoma kierunkami jednostkowymi, ułamkiem `t` kąta.
 *
 * Osobna od `slerpToward`, bo tamta bierze KĄT BEZWZGLĘDNY (krok ruchu), a tutaj potrzebny
 * jest UŁAMEK kąta między kierunkami. Wyrażenie jednego przez drugie wymagałoby liczenia
 * `acos` po stronie wołającego i dawało dwa miejsca z tą samą trygonometrią.
 */
function slerpFraction(a: Vec3, b: Vec3, t: number): Vec3 {
  const cosTheta = Math.min(1, Math.max(-1, dot(a, b)));
  const theta = Math.acos(cosTheta);
  // Kierunki (prawie) zgodne albo (prawie) przeciwne: interpolacja liniowa jest tu
  // numerycznie bezpieczniejsza, a przy theta ≈ 0 i tak nie ma czego obracać.
  if (theta < 1e-9) return a;
  if (Math.PI - theta < 1e-9) return t < 0.5 ? a : b;
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return normalize(add(scale(a, wa), scale(b, wb)));
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
