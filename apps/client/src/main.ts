import {
  createRollingWindow,
  createScene,
  median,
  percentile,
  RENDER_VERSION,
  type UnitShadingMode,
} from '@heliopolis/render';
import {
  BUILDINGS,
  createPlanet,
  DEFAULT_RUN,
  lightFieldInto,
  Sim,
  sunDirection,
  TICK_SECONDS,
  type BuildingType,
} from '@heliopolis/sim';
import {
  createSelection,
  focusCoreTarget,
  intentFromPointer,
  isClick,
  playerBuildableTypes,
  pointedCell,
  refusalReason,
  type PointerButton,
} from './input.js';

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
// Logika mieszka w `input.ts` i jest tam WOLNA OD DOM-u (i przetestowana bez przeglądarki,
// `test/input.test.ts`). Tutaj zostaje wyłącznie to, czego bez DOM-u zrobić się nie da:
// odczyt zdarzeń i jedno wywołanie `sim.enqueue`.
const selection = createSelection();
const buildableTypes = playerBuildableTypes();

/** Ostatni komunikat dla gracza — powód odmowy albo potwierdzenie. Zadanie 3 zastąpi to
 *  prawdziwym HUD-em; tutaj to jedna linia w nakładce diagnostycznej. */
let lastMessage = 'lewy: buduj · prawy: rozbierz · 1-9: typ · spacja: wróć do Core';

/** Skąd zaczęło się naciśnięcie — do odróżnienia kliknięcia od obrotu kamery (`isClick`). */
let pressX = 0;
let pressY = 0;
let pressButton: PointerButton | null = null;

function buttonOf(event: PointerEvent): PointerButton | null {
  if (event.button === 0) return 'LEFT';
  if (event.button === 2) return 'RIGHT';
  return null; // środkowy przycisk należy do zoomu `OrbitControls`
}

// Ruch kursora aktualizuje WYBRANĄ KOMÓRKĘ — stan należący do wejścia, nie do HUD
// (`progress.md`, Ruling 1). `pointAt` zwraca, czy wskazanie faktycznie się zmieniło;
// Zadanie 3 powiesi na tej odpowiedzi przemalowanie menu budowy, żeby nie liczyć go na
// każde drgnięcie myszy wewnątrz tej samej komórki.
canvas.addEventListener('pointermove', (event) => {
  selection.pointAt(pointedCell(planet, scene.camera.object, canvas, event.clientX, event.clientY));
});

canvas.addEventListener('pointerdown', (event) => {
  pressButton = buttonOf(event);
  pressX = event.clientX;
  pressY = event.clientY;
});

canvas.addEventListener('pointerup', (event) => {
  const button = pressButton;
  pressButton = null;
  // Przeciągnięcie to obrót kamery (`OrbitControls`), nie kliknięcie — inaczej każdy obrót
  // stawiałby budynek w punkcie, w którym gracz zaczął przeciągać.
  if (button === null || button !== buttonOf(event)) return;
  if (!isClick(pressX, pressY, event.clientX, event.clientY)) return;

  const intent = intentFromPointer(
    planet,
    scene.camera.object,
    canvas,
    { clientX: event.clientX, clientY: event.clientY, button },
    selection.selectedType,
  );
  if (intent === null) {
    lastMessage = 'kliknięcie w tło — poza planetą';
    return;
  }

  // Powód liczony PRZED wysłaniem, wyłącznie po to, żeby gracz zobaczył, dlaczego nic się
  // nie stało. Klient NIE jest bramkarzem: komenda idzie do kolejki niezależnie od tego,
  // co tu wyszło, bo autorytatywna jest symulacja (`applyCommand` sprawdza to samo po
  // swojej stronie). Klient, który filtruje komendy po swojemu, w chwili rozjazdu
  // z serwerem Fazy 5 połyka wejście gracza bez śladu.
  const reason = refusalReason(sim.state, intent);
  lastMessage =
    reason === null
      ? `${intent.kind === 'BUILD' ? `buduję ${intent.type}` : 'rozbieram'} na komórce ${intent.cellId}`
      : `odmowa: ${reason} (komórka ${intent.cellId})`;

  // ↓ JEDYNA droga wejścia gracza do świata. `global-constraints.md`: „Wejście gracza idzie
  // wyłącznie przez kolejkę komend (`Sim.enqueue`), nigdy przez zapis do stanu. To jest
  // warunek Fazy 5 (autorytatywny serwer), nie wygoda." Pilnuje tego strażnik strukturalny
  // czytający ten plik: `input.test.ts`, test 12.
  sim.enqueue(intent);
});

// Prawy przycisk to rozbiórka — menu kontekstowe przeglądarki musi zejść z drogi.
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

// Przełącznik trybu cieniowania jednostek — narzędzie DIAGNOSTYCZNE z Fazy 2B, Zadanie 4
// (pytanie „progowo czy gładko" rozstrzyga się przełączaniem na tej samej scenie).
// Przeniesione na `Shift`+cyfra, bo same cyfry są teraz wyborem typu budynku; czytane
// przez `event.code`, nie `event.key`, bo `Shift+1` to `!` na klawiaturze amerykańskiej
// i `!` na polskiej — kod klawisza jest jedyną wartością niezależną od układu.
const SHADING_KEYS: Readonly<Record<string, UnitShadingMode>> = {
  Digit1: 'flat',
  Digit2: 'threshold',
  Digit3: 'smooth',
};
let shadingMode: UnitShadingMode = 'flat';

/**
 * Który KLAWISZ naciśnięto, w postaci niezależnej od układu klawiatury.
 *
 * `event.code` jest wartością właściwą (`Digit3` to trzeci klawisz górnego rzędu niezależnie
 * od tego, czy trzeba do niego Shifta, jak na AZERTY) — ale NIE ZAWSZE JEST OBECNY. Zmierzone
 * na tej gałęzi przy sterowaniu przeglądarką zdalnie: zdarzenie dociera z `code === ''`
 * i samym `key`. To samo zgłaszają zdalne pulpity i część metod wprowadzania. Stąd
 * `code` jako źródło pierwsze, `key` jako zapasowe — zamiast sterowania, które po cichu
 * przestaje działać na części konfiguracji.
 */
function keyCode(event: KeyboardEvent): string {
  if (event.code !== '') return event.code;
  if (event.key === ' ' || event.key === 'Spacebar') return 'Space';
  return /^[0-9]$/.test(event.key) ? `Digit${event.key}` : event.key;
}

window.addEventListener('keydown', (event) => {
  const code = keyCode(event);
  if (event.shiftKey) {
    const next = SHADING_KEYS[code];
    if (next === undefined) return;
    shadingMode = next;
    scene.setUnitShading(next);
    lastMessage = `cieniowanie jednostek: ${next}`;
    event.preventDefault();
    return;
  }

  // Skrót „wróć do Core" — wymaganie bramki Fazy 0
  // (`docs/superpowers/specs/2026-09-14-faza-0-wyniki.md`): kamera K1 wygrała pomiar mimo
  // przewidywanego ryzyka gubienia bazy, ale POD WARUNKIEM istnienia tego skrótu.
  // Matematyka (zachowanie odległości + przycięcie do zakresu zoomu) siedzi w
  // `focusPosition`/`focusOn` od Fazy 2A — tutaj jest tylko klawisz i cel.
  if (code === 'Space') {
    scene.camera.focusOn(focusCoreTarget(planet));
    lastMessage = `powrót do Core (komórka ${planet.startCell})`;
    event.preventDefault();
    return;
  }

  const digit = /^Digit([1-9])$/.exec(code);
  if (digit !== null) {
    const type: BuildingType | undefined = buildableTypes[Number(digit[1]) - 1];
    if (type === undefined) return;
    selection.chooseType(type);
    lastMessage = `wybrany typ: ${type} (${BUILDINGS[type].costOre} rudy)`;
    event.preventDefault();
  }
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

let lastFrameAt = performance.now();
let simAccumulator = 0;

function tick(): void {
  const frameStart = performance.now();

  // Symulacja w STAŁYM kroku (`TICK_SECONDS`), nie w kroku klatki — §7.2: nic w symulacji
  // nie wolno wiązać z czasem ściennym. Sufit na liczbę kroków w jednej klatce chroni przed
  // spiralą po przełączeniu karty w tle (przeglądarka wstrzymuje rAF, akumulator rośnie).
  const simStart = performance.now();
  simAccumulator += Math.min(frameStart - lastFrameAt, 250) / 1000;
  lastFrameAt = frameStart;
  let steps = 0;
  while (simAccumulator >= TICK_SECONDS && steps < 5) {
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
