import {
  createRollingWindow,
  createScene,
  median,
  percentile,
  RENDER_VERSION,
} from '@heliopolis/render';
import {
  createPlanet,
  DEFAULT_RUN,
  lightFieldInto,
  Sim,
  sunDirection,
  TICK_SECONDS,
} from '@heliopolis/sim';
import { attachInput, createSelection, type ListenerTarget } from './input.js';

console.log(`Heliopolis render ${RENDER_VERSION}`);

const canvas = document.querySelector('#app');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('apps/client: brak <canvas id="app"> w index.html');
}

// Seed na sztywno, ten sam co we wszystkich testach i pomiarach gałęzi
// (`geometry.test.ts`, `shading.test.ts`, `input.test.ts`) — to, co widać na ekranie, ma
// odpowiadać temu, co już zmierzone, a nie osobnej, niezależnej planecie. Wybór seeda dla
// rozgrywki (roguelite, draft co świt) to osobne wymaganie, poza tą fazą.
const planet = createPlanet({ seed: 20260915 });
const scene = createScene(planet, canvas);

// --- Prawdziwa symulacja (Faza 2C, Zadanie 2) -------------------------------------------
// Do Fazy 2B stało tu RUSZTOWANIE: zwykła tablica o kształcie `SimState.buildings` plus
// dwa wybrane systemy (`updateMovement`, `updateBurning`) puszczone na stanie z
// `createState`. Było to świadomie tymczasowe — `Sim` (pełna pętla: komendy, energia,
// ekonomia, walka, fale, warunki końca) wchodzi do klienta dopiero w tej fazie
// (`global-constraints.md`). Teraz wchodzi, a razem z nim jedyna droga, którą wolno
// wejściu gracza dotrzeć do świata: `sim.enqueue`.
const sim = new Sim(planet, DEFAULT_RUN);

// --- Wejście gracza ----------------------------------------------------------------------
// CAŁA logika wejścia — łącznie z treścią nasłuchów — mieszka w `input.ts` i jest WOLNA od
// DOM-u, więc daje się przetestować bez przeglądarki (`test/input.test.ts`). Tutaj zostaje
// wyłącznie to, czego bez DOM-u zrobić się nie da: znalezienie płótna, `window` jako
// źródła zdarzeń klawiatury, pętla renderu i tekst nakładki.
//
// To nie jest kosmetyka. Dopóki treść nasłuchów siedziała TUTAJ, ograniczenie nadrzędne
// fazy nie miało strażnika w obie strony — `main.ts` nie da się zaimportować w teście
// (DOM na poziomie modułu), więc usunięcie jedynej linii `sim.enqueue(...)` zostawiało
// cały pakiet zielony. Po przeniesieniu obie połowy są mierzone własnością: hasz stanu
// nietknięty przez obsługę zdarzenia, świat zmieniony po `step()`.
const selection = createSelection();

/** Ostatni komunikat dla gracza — powód odmowy albo potwierdzenie. Zadanie 3 zastąpi to
 *  prawdziwym HUD-em; tutaj to jedna linia w nakładce diagnostycznej. */
let lastMessage = 'lewy: buduj · prawy: rozbierz · 1-9: typ · spacja: wróć do Core';
let shadingMode: 'flat' | 'threshold' | 'smooth' = 'flat';

const input = attachInput({
  planet,
  camera: scene.camera.object,
  canvas,
  // `window` jako źródło zdarzeń klawiatury. Rzutowanie strukturalne, bo `ListenerTarget`
  // opisuje tylko te dwie metody — wejście nie ma prawa sięgnąć po nic więcej z `window`.
  keys: window as unknown as ListenerTarget,
  sim,
  selection,
  focusOn: (target) => scene.camera.focusOn(target),
  report: (message) => {
    lastMessage = message;
  },
  setUnitShading: (mode) => {
    shadingMode = mode;
    scene.setUnitShading(mode);
  },
});

// --- Licznik klatek (Faza 2B, Zadanie 5) -------------------------------------------------
// Budżet z `global-constraints.md` (8 ms na CAŁY render przy 1442 komórkach) mówi o czasie
// PRACY per klatka, nie o odstępie między wywołaniami rAF (ten drugi to głównie odświeżanie
// monitora, ok. 16,6 ms przy 60 Hz, NIEZALEŻNIE od tego, jak szybko faktycznie skończyła się
// praca) — więc mierzone jest dokładnie to, co Faza 0 mierzyła w P4 (§4 wyników): znacznik
// czasu na wejściu do ciała tick(), drugi na wyjściu (PO renderze), różnica to czas CPU tej
// klatki. Czas symulacji jest mierzony OSOBNO i odejmowany: budżet 8 ms dotyczy RENDERU,
// a `sim.step()` ma w Fazie 3 dostać własny.
const FRAME_WINDOW = 1000;
const frameTimes = createRollingWindow(FRAME_WINDOW);
const simTimes = createRollingWindow(FRAME_WINDOW);
let totalFrames = 0;
let loggedBudgetOnce = false;

// Nakładka DOM budowana w JS, nie w index.html: to jest narzędzie deweloperskie, nie
// element rozgrywki (prawdziwy HUD gracza to Zadanie 3 tej fazy) — trzymanie go tutaj,
// obok logiki, która go wypełnia, zamiast w osobnym pliku HTML do pilnowania w dwóch
// miejscach naraz.
const hud = document.createElement('div');
hud.style.cssText =
  'position:fixed;top:8px;left:8px;padding:4px 8px;background:rgba(0,0,0,0.55);' +
  'color:#e8f0ff;font:12px/1.4 monospace;white-space:pre;pointer-events:none;z-index:10;';
hud.textContent = 'klatka: zbieranie danych…';
document.body.appendChild(hud);

// Bufor oświetlenia zaalokowany RAZ, poza pętlą — nie co klatkę. `lightField` zwraca
// świeżą `Float32Array(1442)` (5768 B) przy każdym wywołaniu, czyli ok. 346 kB/s przy
// 60 Hz, rzucane pod nogi odśmiecaczowi WEWNĄTRZ tej samej pętli, której czas raportuje
// licznik klatek wyżej.
const light = new Float32Array(planet.cells.length);

/**
 * Najdłuższa przerwa między klatkami, jaką akumulator w ogóle przyjmuje. `[STROJENIE]` —
 * po powrocie z karty w tle (przeglądarka wstrzymuje `requestAnimationFrame`) różnica
 * czasu potrafi wynieść minuty, a bez tego sufitu symulacja próbowałaby je nadrobić
 * w jednej klatce. Powyżej tej wartości czas jest PO CICHU GUBIONY — to jest świadomy
 * handel „zgubić czas zamiast zamrozić kartę", a nie przeoczenie.
 */
const MAX_FRAME_GAP_MS = 250; // [STROJENIE]

/**
 * Ile kroków symulacji wolno wykonać w JEDNEJ klatce. `[STROJENIE]` — druga połowa tej
 * samej ochrony: bez niej akumulator po długiej przerwie nakręca spiralę (im dłużej trwa
 * nadrabianie, tym większa następna zaległość). Faza 3, dając `sim.step()` własny budżet,
 * będzie tej liczby szukać greppem po tagu.
 */
const MAX_STEPS_PER_FRAME = 5; // [STROJENIE]

let lastFrameAt = performance.now();
let simAccumulator = 0;

function tick(): void {
  const frameStart = performance.now();

  // Symulacja w STAŁYM kroku (`TICK_SECONDS`), nie w kroku klatki — §7.2: nic w symulacji
  // nie wolno wiązać z czasem ściennym. Sufit na liczbę kroków w jednej klatce chroni przed
  // spiralą po przełączeniu karty w tle (przeglądarka wstrzymuje rAF, akumulator rośnie).
  const simStart = performance.now();
  simAccumulator += Math.min(frameStart - lastFrameAt, MAX_FRAME_GAP_MS) / 1000;
  lastFrameAt = frameStart;
  let steps = 0;
  while (simAccumulator >= TICK_SECONDS && steps < MAX_STEPS_PER_FRAME) {
    simAccumulator -= TICK_SECONDS;
    steps++;
    sim.step();
  }
  const simMs = performance.now() - simStart;
  simTimes.push(simMs);

  // Zegar RENDERU jest zegarem SYMULACJI, nie ściennym — inaczej terminator na ekranie
  // byłby gdzie indziej niż terminator, którym symulacja właśnie paliła jednostki, a
  // czytelność terminatora jest w tej gałęzi ograniczeniem nadrzędnym. `simAccumulator`
  // dokłada ułamek ticka jeszcze nierozliczonego, żeby słońce szło gładko przy 60 Hz,
  // zamiast przeskakiwać 20 razy na sekundę o 0,1° (0,6 px przy domyślnym oddaleniu).
  const renderSeconds = sim.elapsedSeconds + simAccumulator;
  const sunDir = sunDirection(renderSeconds, DEFAULT_RUN.rotationPeriod);
  lightFieldInto(planet, sunDir, light);

  // Wskazana komórka przeliczana CO KLATKĘ z ostatniego znanego piksela kursora, nie tylko
  // na `pointermove`: `OrbitControls` ma bezwładność, więc kamera jedzie jeszcze około
  // sekundy po tym, jak gracz przestał ruszać myszą, i przez cały ten czas ten sam piksel
  // wskazuje kolejne komórki. Wychodzi bez pracy, gdy ani kursor, ani kamera nie drgnęły.
  input.refreshPointedCell();

  // Render CZYTA stan symulacji i nigdy go nie zapisuje (`global-constraints.md`).
  scene.updateBuildings(sim.state.buildings, renderSeconds);
  scene.updateUnits(sim.state.units, light);
  scene.render(light, sunDir);

  const frameMs = performance.now() - frameStart - simMs;
  frameTimes.push(frameMs);
  totalFrames++;

  // Odświeżanie HUD co 10 klatek — nie co klatkę: sam zapis tekstu DOM ma swój koszt, a ma
  // nie stać się zauważalną częścią tego, co mierzy.
  if (totalFrames % 10 === 0) {
    const samples = frameTimes.snapshot();
    const cell = selection.selectedCell;
    hud.textContent =
      `render: mediana ${median(samples).toFixed(3)} ms · p95 ${percentile(samples, 95).toFixed(3)} ms ` +
      `(n=${samples.length}) — budżet 8 ms\n` +
      `symulacja (osobny budżet): mediana ${median(simTimes.snapshot()).toFixed(3)} ms · ` +
      `tick ${sim.state.tick} · cykl ${sim.cycle} · ${sim.state.phase}\n` +
      `ruda ${sim.state.ore.toFixed(0)} · jednostek ${sim.state.units.length} · ` +
      `typ [1-9]: ${selection.selectedType} · wskazana komórka: ${cell === null ? '—' : cell}\n` +
      `${lastMessage}   (cieniowanie Shift+1/2/3: ${shadingMode})`;
  }

  // Wypisanie do konsoli PO 1000 klatkach — RAZ, nie za każdym kolejnym tysiącem: to jest
  // migawka „pierwsze 1000 klatek", porównywalna z `budget.test.ts` (ten sam próg 1000
  // pomiarów), nie ciągły spam do logu przez cały czas działania aplikacji.
  if (!loggedBudgetOnce && totalFrames >= FRAME_WINDOW) {
    loggedBudgetOnce = true;
    const samples = frameTimes.snapshot();
    const simSamples = simTimes.snapshot();
    console.log(
      `[BUDGET] pierwsze ${FRAME_WINDOW} klatek renderu: mediana=${median(samples).toFixed(3)} ms, ` +
        `p95=${percentile(samples, 95).toFixed(3)} ms (budżet: 8 ms) — przy ${sim.state.units.length} ` +
        `jednostkach; symulacja OSOBNO: mediana=${median(simSamples).toFixed(3)} ms, ` +
        `p95=${percentile(simSamples, 95).toFixed(3)} ms`,
    );
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
