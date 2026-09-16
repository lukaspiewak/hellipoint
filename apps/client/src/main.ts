import { createRollingWindow, createScene, median, percentile, RENDER_VERSION } from '@heliopolis/render';
import {
  BUILDINGS,
  createPlanet,
  DEFAULT_RUN,
  lightFieldInto,
  sunDirection,
  type Building,
  type BuildingType,
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
  // Co klatkę, mimo że `demoBuildings` się nie zmienia: pierścień alarmu wokół budynków
  // niezasilonych PULSUJE, więc jego macierz zależy od czasu (patrz `alertPulseScale`) —
  // a przy okazji to jest dokładnie ten koszt, który ma się mieścić w budżecie 8 ms.
  scene.updateBuildings(demoBuildings, elapsedSeconds);
  scene.render(light, sunDir);

  const frameMs = performance.now() - frameStart;
  frameTimes.push(frameMs);
  totalFrames++;

  // Odświeżanie HUD co 10 klatek — nie co klatkę: sam odczyt tekstu DOM ma swój koszt, a
  // ma nie stać się zauważalną częścią tego, co mierzy (patrz `frameStats.ts`, uzasadnienie
  // przy `createRollingWindow` o tej samej zasadzie).
  if (totalFrames % 10 === 0) {
    const samples = frameTimes.snapshot();
    const med = median(samples);
    const p95 = percentile(samples, 95);
    hud.textContent = `klatka: mediana ${med.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms (n=${samples.length}) — budżet 8 ms`;
  }

  // Wypisanie do konsoli PO 1000 klatkach (Krok 2 briefu) — RAZ, nie za każdym kolejnym
  // tysiącem: to jest migawka "pierwsze 1000 klatek", porównywalna z `budget.test.ts`
  // (ten sam próg 1000 pomiarów), nie ciągły spam do logu przez cały czas działania aplikacji.
  if (!loggedBudgetOnce && totalFrames >= FRAME_WINDOW) {
    loggedBudgetOnce = true;
    const samples = frameTimes.snapshot();
    const med = median(samples);
    const p95 = percentile(samples, 95);
    console.log(
      `[BUDGET] pierwsze ${FRAME_WINDOW} klatek renderu: mediana=${med.toFixed(3)} ms, p95=${p95.toFixed(3)} ms (budżet: 8 ms)`,
    );
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
