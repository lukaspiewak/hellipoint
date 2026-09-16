import {
  createRollingWindow,
  createScene,
  median,
  percentile,
  RENDER_VERSION,
  type UnitShadingMode,
} from '@heliopolis/render';
import {
  buildAllFlowFields,
  BUILDINGS,
  createPlanet,
  createState,
  DEFAULT_RUN,
  ENEMIES,
  lightFieldInto,
  motionContext,
  spawnUnit,
  sunDirection,
  TICK_SECONDS,
  updateBurning,
  updateMovement,
  type Building,
  type BuildingType,
  type EnemyType,
  type Unit,
} from '@heliopolis/sim';

console.log(`Heliopolis render ${RENDER_VERSION}`);

const canvas = document.querySelector('#app');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('apps/client: brak <canvas id="app"> w index.html');
}

// Zadanie 4 Fazy 2A: pierwsza PRAWDZIWA planeta na ekranie — geometria (Zadanie 2),
// progowane światło (Zadanie 3) i kamera K1 (`@heliopolis/render`'s `camera.ts`) spięte
// przez `createScene`. Seed na sztywno, ten sam co we wszystkich testach/pomiarach Zadań 2-3
// (`geometry.test.ts`, `shading.test.ts`) — to, co widać na ekranie, ma odpowiadać temu,
// co już zmierzone w raportach tych zadań, nie osobnej, niezależnej planecie. Wybór seeda
// dla rozgrywki (roguelite, draft co świt) to Faza 2C, nie ten widok.
const planet = createPlanet({ seed: 20260915 });
const scene = createScene(planet, canvas);

// --- Podgląd budynków (Faza 2B, Zadanie 3) ---------------------------------------------
// TYMCZASOWE RUSZTOWANIE, nie rozgrywka. `Sim` wchodzi do klienta dopiero w Fazie 2C
// (`global-constraints.md`), a bez ani jednego budynku na ekranie nie da się ani obejrzeć
// tego, co to zadanie dowozi, ani zadać pytań 2 i 3 bramki Zadania 5 („czy widać, który
// budynek jest niezasilony"). To jest więc zwykła TABLICA o kształcie `SimState.buildings`,
// budowana tutaj deterministycznie — NIE `SimState`, i nic tego stanu nie mutuje: render go
// wyłącznie czyta. Faza 2C podmieni to na `sim.state.buildings` i nic poza tym blokiem
// nie będzie musiało się zmienić.
//
// Dobór tak, żeby dało się OBEJRZEĆ wszystko, o co pyta to zadanie, w jednej scenie:
// wszystkie dziesięć typów, pełny zakres `hp` i oba stany zasilenia, rozsiane po CAŁEJ
// kuli — czyli w każdej chwili obrotu część z nich stoi na nocy, część na zmierzchu, a
// część na dniu — plus zwarte skupisko wokół komórki startowej, żeby dało się zobaczyć,
// jak sąsiadujące budynki wyglądają obok siebie i obok kraty.
const DEMO_TYPES: readonly BuildingType[] = [
  'CORE', 'BARRICADE', 'PYLON', 'SOLAR_PANEL', 'BATTERY',
  'EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET', 'GEOTHERMAL_CAP', 'EVACUATION_MODULE',
];
const DEMO_HP_FRACTIONS = [1, 0.75, 0.5, 0.25, 0.05];

const demoBuildings: (Building | null)[] = new Array<Building | null>(planet.cells.length).fill(null);
function placeDemo(cellId: number, ordinal: number): void {
  if (demoBuildings[cellId] !== null) return;
  const type = DEMO_TYPES[ordinal % DEMO_TYPES.length];
  demoBuildings[cellId] = {
    cellId,
    type,
    hp: BUILDINGS[type].hp * DEMO_HP_FRACTIONS[ordinal % DEMO_HP_FRACTIONS.length],
    powered: ordinal % 4 !== 0,
  };
}
let demoOrdinal = 0;
// Skupisko: komórka startowa, jej sąsiedzi i sąsiedzi sąsiadów.
const cluster = new Set<number>([planet.startCell]);
for (let ring = 0; ring < 2; ring++) {
  for (const id of [...cluster]) {
    for (const neighbor of planet.cells[id].neighbors) cluster.add(neighbor);
  }
}
for (const id of cluster) placeDemo(id, demoOrdinal++);
// Rozsianie: co jedenasta komórka — 131 sztuk rozłożonych po całej kuli.
for (let id = 0; id < planet.cells.length; id += 11) placeDemo(id, demoOrdinal++);
console.log(`[PODGLĄD] budynków w scenie: ${demoBuildings.filter((b) => b !== null).length}`);

// --- Podgląd jednostek (Faza 2B, Zadanie 4) ---------------------------------------------
// TYMCZASOWE RUSZTOWANIE, dokładnie jak blok budynków wyżej: `Sim` (pełna pętla, fale,
// energia, walka) wchodzi do klienta dopiero w Fazie 2C (`global-constraints.md`). Tutaj
// biegną wyłącznie DWA systemy symulacji — `updateMovement` i `updateBurning` — na stanie
// zbudowanym `createState`, bo bez PRAWDZIWEGO ruchu i PRAWDZIWEJ akumulacji ekspozycji nie
// da się odpowiedzieć na Krok 3 briefu („czy pasma na jednostce migoczą przy przechodzeniu
// między komórkami") ani zobaczyć tego, co Krok 2 ma pokazać (ARMOR wchodzący w światło
// jest skazany, SWARM ucieknie). Render tego stanu wyłącznie CZYTA.
const sim = createState(planet, DEFAULT_RUN.startingOre);
for (let i = 0; i < demoBuildings.length; i++) sim.buildings[i] = demoBuildings[i];
const flowFields = buildAllFlowFields(sim); // budynki się nie zmieniają, więc RAZ
const motion = motionContext(planet, DEFAULT_RUN.rotationPeriod);

// „Linijka" spalania: 3 typy × 5 poziomów ekspozycji, ustawione w RÓWNYCH odstępach na
// jednym wielkim okręgu i NIE symulowane — żeby dało się porównać całą rampę obok siebie,
// na każdym paśmie po kolei, w miarę jak przechodzi po niej terminator. Pozycje liczone
// wprost na okręgu (nie na środkach komórek), bo cała ta warstwa rysuje jednostki tam,
// gdzie NAPRAWDĘ są, a nie na komórkach.
const RULER_TYPES: readonly EnemyType[] = ['SWARM', 'DISRUPTOR', 'ARMOR'];
const RULER_LEVELS = [0, 0.25, 0.5, 0.75, 1];
function nearestCell(x: number, y: number, z: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < planet.cells.length; i++) {
    const n = planet.cells[i].normal;
    const d = n.x * x + n.y * y + n.z * z;
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}
const rulerUnits: Unit[] = [];
RULER_TYPES.forEach((type, row) => {
  RULER_LEVELS.forEach((level, column) => {
    // Wiersz = typ (przesunięty w „szerokości"), kolumna = ekspozycja (wzdłuż okręgu).
    // Wyśrodkowana na +Z, czyli dokładnie tam, gdzie patrzy kamera startowa
    // (`createCamera` stawia ją w `(0, 0, 3R)`) — linijka ma być widoczna od razu, a nie
    // na limbie, gdzie każda płaska tarcza jest skrócona perspektywicznie do kreski.
    const lat = (row - 1) * 0.11;
    const lon = (column - 2) * 0.11;
    const x = Math.cos(lat) * Math.sin(lon);
    const y = Math.sin(lat);
    const z = Math.cos(lat) * Math.cos(lon);
    rulerUnits.push({
      id: -(row * 10 + column + 1),
      type,
      cellId: nearestCell(x, y, z),
      pos: { x: x * planet.radius, y: y * planet.radius, z: z * planet.radius },
      hp: ENEMIES[type].hp,
      exposure: ENEMIES[type].burnTime * level,
    });
  });
});

// Strumień jednostek z pentagonów — tyle, żeby w każdej chwili część z nich szła przez
// terminator w obie strony.
const SPAWN_EVERY_TICKS = 3;
const SPAWN_TYPES: readonly EnemyType[] = ['SWARM', 'DISRUPTOR', 'ARMOR'];
let spawnCursor = 0;
let simTick = 0;
let simAccumulator = 0;

// Przełącznik trybu cieniowania (Krok 3 briefu) — klawisze 1/2/3. Narzędzie deweloperskie
// tego zadania, nie element rozgrywki: pytanie „progowo czy nie" rozstrzyga się przez
// PRZEŁĄCZANIE tam i z powrotem na tej samej scenie, a nie przez dwa osobne uruchomienia.
const SHADING_KEYS: Readonly<Record<string, UnitShadingMode>> = { '1': 'flat', '2': 'threshold', '3': 'smooth' };
let shadingMode: UnitShadingMode = 'flat';
window.addEventListener('keydown', (event) => {
  const next = SHADING_KEYS[event.key];
  if (next === undefined) return;
  shadingMode = next;
  scene.setUnitShading(next);
  console.log(`[PODGLĄD] cieniowanie jednostek: ${next}`);
});

// --- Licznik klatek (Zadanie 5, Krok 2 briefu) -----------------------------------------
// Budżet z `global-constraints.md` (8 ms na CAŁY render przy 1442 komórkach) mówi o czasie
// PRACY per klatka, nie o odstępie między wywołaniami rAF (ten drugi to głównie odświeżanie
// monitora, ok. 16,6 ms przy 60 Hz, NIEZALEŻNIE od tego, jak szybko faktycznie skończyła się
// praca) — więc mierzone jest dokładnie to, co Faza 0 mierzyła w P4 (§4 wyników): znacznik
// czasu na wejściu do ciała tick(), drugi na wyjściu (PO renderze), różnica to czas CPU tej
// klatki — aktualizacja słońca, `lightField`, aktualizacja kamery (bezwładność orbity K1),
// przepisanie kolorów komórek i samo `renderer.render()`.
const FRAME_WINDOW = 1000;
const frameTimes = createRollingWindow(FRAME_WINDOW);
/** Osobne okno na czas rusztowania symulacji (Zadanie 4) — patrz komentarz w `tick`. */
const simTimes = createRollingWindow(FRAME_WINDOW);
let totalFrames = 0;
let loggedBudgetOnce = false;

// Nakładka DOM budowana w JS, nie w index.html: to jest narzędzie deweloperskie tego
// zadania, nie element rozgrywki (Faza 0: wskaźniki/HUD poza zakresem MVP dotyczą UI GRACZA,
// nie licznika diagnostycznego) — trzymanie go tutaj, obok logiki, która go wypełnia,
// zamiast w osobnym pliku HTML, którego trzeba by pilnować w dwóch miejscach naraz.
const hud = document.createElement('div');
hud.style.cssText =
  'position:fixed;top:8px;left:8px;padding:4px 8px;background:rgba(0,0,0,0.55);' +
  'color:#e8f0ff;font:12px/1.4 monospace;white-space:pre;pointer-events:none;z-index:10;';
hud.textContent = 'klatka: zbieranie danych…';
document.body.appendChild(hud);

// Planeta jest statyczna; orbituje źródło światła (spec §4.3) — więc pętla renderu liczy
// upływ czasu WŁASNYM zegarem (nie zależy od żadnego `SimState`, którego tu jeszcze nie
// ma — wchodzi w Fazie 2C razem z `Sim.enqueue`, patrz `global-constraints.md`) i przelicza
// `sunDirection`/`lightField` co klatkę na jego podstawie.
const startTime = performance.now();
let lastFrameAt = startTime;

// Bufor oświetlenia zaalokowany RAZ, poza pętlą — nie co klatkę. `lightField` zwraca
// świeżą `Float32Array(1442)` (5768 B) przy każdym wywołaniu, czyli ok. 346 kB/s przy
// 60 Hz, rzucane pod nogi odśmiecaczowi WEWNĄTRZ tej samej pętli, której czas raportuje
// licznik klatek wyżej. To ta sama dyscyplina, którą reszta tej gałęzi stosuje wszędzie
// indziej — `writeCellColors` (`shading.ts`), bufor `colors` (`planetMesh.ts`), okno
// kroczące (`frameStats.ts`) — i nie było powodu, żeby akurat tu jej nie stosować.
// Zmierzone w `packages/sim/test/light.test.ts`: 2000 wywołań `lightFieldInto` daje zero
// cykli odśmiecania, 2000 wywołań `lightField` — kilka.
const light = new Float32Array(planet.cells.length);

function tick(): void {
  const frameStart = performance.now();

  const elapsedSeconds = (frameStart - startTime) / 1000;
  const sunDir = sunDirection(elapsedSeconds, DEFAULT_RUN.rotationPeriod);
  lightFieldInto(planet, sunDir, light);
  // Co klatkę, mimo że `demoBuildings` się nie zmienia i warstwa jest statyczna wobec
  // zegara: to jest dokładnie ten koszt, który w prawdziwej rozgrywce (Faza 2C) będzie
  // płacony co klatkę i ma się mieścić w budżecie 8 ms. Licznik klatek go obejmuje.
  scene.updateBuildings(demoBuildings);

  // Symulacja w STAŁYM kroku (`TICK_SECONDS`), nie w kroku klatki — §7.2: nic w symulacji
  // nie wolno wiązać z czasem ściennym. Sufit na liczbę kroków w jednej klatce chroni przed
  // spiralą po przełączeniu karty w tle (przeglądarka wstrzymuje rAF, akumulator rośnie).
  //
  // Czas TEGO bloku jest mierzony OSOBNO i ODEJMOWANY od czasu klatki niżej. Budżet 8 ms
  // z `global-constraints.md` dotyczy RENDERU, a ten blok to rusztowanie symulacji, którego
  // w Fazie 2A w kliencie nie było — wliczenie go uczyniłoby licznik nieporównywalnym z
  // liczbami Zadań 2-3 i zawyżałoby koszt renderu jednostek o pracę, która należy do
  // symulacji (i która w Fazie 2C dostanie własny budżet).
  const simStart = performance.now();
  simAccumulator += Math.min(frameStart - lastFrameAt, 250) / 1000;
  lastFrameAt = frameStart;
  let steps = 0;
  while (simAccumulator >= TICK_SECONDS && steps < 5) {
    simAccumulator -= TICK_SECONDS;
    steps++;
    simTick++;
    if (simTick % SPAWN_EVERY_TICKS === 0) {
      const pentagon = planet.pentagons[spawnCursor % planet.pentagons.length];
      spawnUnit(sim, SPAWN_TYPES[spawnCursor % SPAWN_TYPES.length], pentagon);
      spawnCursor++;
    }
    updateMovement(sim, flowFields, light, sunDir, motion);
    updateBurning(sim, light);
  }
  // Konkatenacja rusztowania z linijką — jedyna alokacja w tej pętli i należy do
  // rusztowania, nie do renderu, więc mieści się w mierzonym osobno czasie symulacji.
  const unitsToDraw = rulerUnits.concat(sim.units);
  const simMs = performance.now() - simStart;
  simTimes.push(simMs);

  scene.updateUnits(unitsToDraw, light);
  scene.render(light, sunDir);

  const frameMs = performance.now() - frameStart - simMs;
  frameTimes.push(frameMs);
  totalFrames++;

  // Odświeżanie HUD co 10 klatek — nie co klatkę: sam odczyt tekstu DOM ma swój koszt, a
  // ma nie stać się zauważalną częścią tego, co mierzy (patrz `frameStats.ts`, uzasadnienie
  // przy `createRollingWindow` o tej samej zasadzie).
  if (totalFrames % 10 === 0) {
    const samples = frameTimes.snapshot();
    const med = median(samples);
    const p95 = percentile(samples, 95);
    const simSamples = simTimes.snapshot();
    hud.textContent =
      `render: mediana ${med.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms (n=${samples.length}) — budżet 8 ms\n` +
      `rusztowanie symulacji (poza budżetem): mediana ${median(simSamples).toFixed(3)} ms\n` +
      `jednostek: ${sim.units.length + rulerUnits.length} (żywych z symulacji ${sim.units.length}) · ` +
      `cieniowanie [1/2/3]: ${shadingMode}`;
  }

  // Wypisanie do konsoli PO 1000 klatkach (Krok 2 briefu) — RAZ, nie za każdym kolejnym
  // tysiącem: to jest migawka "pierwsze 1000 klatek", porównywalna z `budget.test.ts`
  // (ten sam próg 1000 pomiarów), nie ciągły spam do logu przez cały czas działania aplikacji.
  if (!loggedBudgetOnce && totalFrames >= FRAME_WINDOW) {
    loggedBudgetOnce = true;
    const samples = frameTimes.snapshot();
    const med = median(samples);
    const p95 = percentile(samples, 95);
    const simSamples = simTimes.snapshot();
    console.log(
      `[BUDGET] pierwsze ${FRAME_WINDOW} klatek renderu: mediana=${med.toFixed(3)} ms, p95=${p95.toFixed(3)} ms (budżet: 8 ms)` +
        ` — przy ${sim.units.length + rulerUnits.length} jednostkach; rusztowanie symulacji OSOBNO:` +
        ` mediana=${median(simSamples).toFixed(3)} ms, p95=${percentile(simSamples, 95).toFixed(3)} ms`,
    );
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
