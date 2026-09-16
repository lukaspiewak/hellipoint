import {
  buildGateTrials,
  createReadabilityGate,
  createRollingWindow,
  formatGateResultsMarkdown,
  median,
  percentile,
  RENDER_VERSION,
  alertPulse,
  UNIT_BAND_SHADE,
  UNIT_BAND_SHADE_LEGAL,
  type GateMode,
  type GateTrial,
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

/**
 * **Bramka PEŁNEGO OBRAZU — Faza 2B, Zadanie 5.**
 *
 * Bramka z Zadania 1 (`gate.html`) bada SAM TEREN i zostaje nietknięta: to ona jest
 * instrumentem, którym zmierzono 15/15, i nie wolno jej podmienić pod tamtym wynikiem. Ta
 * strona to OSOBNY PRZEBIEG tego samego harnessu, z `fullScene: true` — teren plus krata plus
 * budynki plus jednostki, czyli scena, którą gracz naprawdę zobaczy.
 *
 * ## Pięciu pytań NIE rozstrzyga ani ta strona, ani jej autor
 *
 * Rozstrzyga je człowiek patrzący na ekran. Zadaniem tego pliku jest zbudować przebieg tak,
 * żeby dało się na nie odpowiedzieć uczciwie, i zapisać, co człowiek odpowiedział — nie
 * wyliczyć odpowiedzi. W tej fazie zdarzyło się już, że wykonawca i człowiek dostali w tej
 * samej kontroli różne wyniki (12/15 wobec braku możliwości odpowiedzi) i **obie liczby były
 * prawdziwe, bo mierzyły co innego**: agent czytający piksele to inny instrument niż oko.
 *
 * ## Dwa tryby strony
 *
 * | tryb | co robi | które pytanie |
 * |---|---|---|
 * | PRÓBY | scena ZAMROŻONA w fazie słońca próby, pierścień na jednej komórce, 15 osądów | 1 |
 * | SWOBODNY | słońce orbituje, jednostki idą i płoną, bez pierścienia | 2-5 |
 *
 * Tryb PRÓB jest zamrożony celowo: pytanie 1 brzmi „czy terminator jest nadal czytelny", a
 * jedyną rzeczą, która ma się różnić wobec Zadania 1, jest OBECNOŚĆ PEŁNEJ SCENY. Ruchoma
 * scena dokładałaby drugą zmienną i wynik przestałby być porównywalny z tabelą z §6 specu.
 * Ruch — od którego zależą pytania 3 i 5 — ma tryb swobodny.
 *
 * ## Dlaczego kontrola pozytywna nadal POTRAFI OBLAĆ, choć scena jest pełna
 *
 * Warstwy budynków i jednostek są DZIEĆMI siatki terenu, a `visible` w Three.js jest
 * dziedziczne, więc tryb kontrolny gasi je razem z planetą: w kontroli widać dokładnie tyle
 * samo, co w bramce terenowej — gładką kulę i pierścień. To jest własność, na której stoi
 * ważność całego przebiegu, i ma własny test (33b w `readabilityGate.test.ts`).
 *
 * W trybie OCENIANYM jednostki są widoczne i mogą podpowiadać (jednostka w świetle płonie),
 * i to jest ZAMIERZONE: pytanie 1 dotyczy sceny, którą gracz naprawdę ma przed sobą, ze
 * wszystkim, co ona niesie. Instrumentem mierzącym sam teren pozostaje bramka Zadania 1.
 */

console.log(`Heliopolis render ${RENDER_VERSION} — bramka pełnego obrazu (Faza 2B, Zadanie 5)`);

const canvas = document.querySelector('#gate-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('apps/client/sceneGate.ts: brak <canvas id="gate-canvas"> w scene-gate.html');
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`apps/client/sceneGate.ts: brak elementu "${selector}" w scene-gate.html`);
  }
  return el as T;
}

// --- Plany prób: DOKŁADNIE te same co w bramce Zadania 1 ---------------------------------
// Ta sama planeta, ten sam seed, te same trzy fazy słońca, te same offsety planów — żeby
// wynik pytania 1 dało się zestawić wiersz po wierszu z tabelą z §6 specu. Jedyną różnicą
// wobec tamtego przebiegu jest to, co jest na ekranie POZA terenem.
const planet = createPlanet({ seed: 20260915 });
const rotationPeriod = DEFAULT_RUN.rotationPeriod;
const sunDirs = [0, 1 / 3, 2 / 3].map((fraction) => sunDirection(fraction * rotationPeriod, rotationPeriod));
const CELLS_PER_PHASE = 5;
const plans = {
  threshold: buildGateTrials(planet, sunDirs, CELLS_PER_PHASE, 0),
  smooth: buildGateTrials(planet, sunDirs, CELLS_PER_PHASE, 1),
  control: buildGateTrials(planet, sunDirs, CELLS_PER_PHASE, 2),
};

const gate = createReadabilityGate(planet, canvas, plans, { fullScene: true });
if (gate.world === null) {
  throw new Error('apps/client/sceneGate.ts: bramka pełnego obrazu wymaga fullScene: true');
}
const world = gate.world;

/**
 * Komórki, o które bramka pyta — we WSZYSTKICH trzech planach. Nic się na nich nie stawia.
 *
 * To jest decyzja protokolarna, nie ułatwienie: budynek stojący DOKŁADNIE na pytanej komórce
 * zasłania to, o co pytanie dotyczy (barwę terenu wewnątrz pierścienia), więc czyni pytanie
 * nieodpowiadalnym, a nie trudniejszym. **Sąsiedzi pytanych komórek NIE są czyszczone** —
 * scena wokół pierścienia jest pełna, łącznie z budynkami po obu stronach granicy.
 */
const questionedCells = new Set<number>();
for (const plan of [plans.threshold, plans.smooth, plans.control]) {
  for (const trial of plan) questionedCells.add(trial.cellId);
}

// --- Świat podglądu: budynki -------------------------------------------------------------
// TYMCZASOWE RUSZTOWANIE, ten sam wzorzec i to samo uzasadnienie co w `main.ts`: `Sim`
// (pełna pętla, fale, energia, walka) wchodzi do klienta dopiero w Fazie 2C. Dobór taki, żeby
// w kadrze były naraz wszystkie dziesięć typów, pełny zakres `hp` i OBA stany zasilenia, na
// każdym z trzech pasm — inaczej pytania 2 i 3 nie mają czego pokazać.
const DEMO_TYPES: readonly BuildingType[] = [
  'CORE', 'BARRICADE', 'PYLON', 'SOLAR_PANEL', 'BATTERY',
  'EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET', 'GEOTHERMAL_CAP', 'EVACUATION_MODULE',
];
const DEMO_HP_FRACTIONS = [1, 0.75, 0.5, 0.25, 0.05];

const demoBuildings: (Building | null)[] = new Array<Building | null>(planet.cells.length).fill(null);
let demoOrdinal = 0;
function placeDemo(cellId: number): void {
  if (demoBuildings[cellId] !== null) return;
  if (questionedCells.has(cellId)) return; // patrz `questionedCells`
  const ordinal = demoOrdinal++;
  const type = DEMO_TYPES[ordinal % DEMO_TYPES.length];
  demoBuildings[cellId] = {
    cellId,
    type,
    hp: BUILDINGS[type].hp * DEMO_HP_FRACTIONS[ordinal % DEMO_HP_FRACTIONS.length],
    // Co czwarty bez prądu — pytanie 2 wymaga, żeby oba stany stały OBOK SIEBIE, bo „widać,
    // który jest niezasilony" jest pytaniem porównawczym.
    powered: ordinal % 4 !== 0,
  };
}
// Skupisko wokół komórki startowej (sąsiedzi i sąsiedzi sąsiadów) — żeby dało się zobaczyć,
// jak budynki wyglądają obok siebie i obok kraty...
const cluster = new Set<number>([planet.startCell]);
for (let ring = 0; ring < 2; ring++) {
  for (const id of [...cluster]) {
    for (const neighbor of planet.cells[id].neighbors) cluster.add(neighbor);
  }
}
for (const id of cluster) placeDemo(id);
// ...plus rozsianie po całej kuli, żeby w każdej chwili obrotu część stała na nocy, część na
// zmierzchu i część na dniu.
for (let id = 0; id < planet.cells.length; id += 11) placeDemo(id);
const buildingCount = demoBuildings.filter((b) => b !== null).length;

// --- Świat podglądu: jednostki -----------------------------------------------------------
const sim = createState(planet, DEFAULT_RUN.startingOre);
for (let i = 0; i < demoBuildings.length; i++) sim.buildings[i] = demoBuildings[i];
const flowFields = buildAllFlowFields(sim); // budynki się nie zmieniają, więc RAZ
const motion = motionContext(planet, rotationPeriod);

/**
 * Docelowa liczba ŻYWYCH jednostek — **szczyt zmierzony w Fazie 1C w zwycięskim runie**.
 * Utrzymywana dosypywaniem po każdym ticku, bo spalanie zabija: budżet klatki z Kroku 3
 * briefu ma być zmierzony przy tej liczbie, a nie przy tym, ile akurat zostało.
 */
const TARGET_UNITS = 481;
const SPAWN_TYPES: readonly EnemyType[] = ['SWARM', 'DISRUPTOR', 'ARMOR'];
let spawnCursor = 0;

function topUpUnits(): void {
  let guard = 0;
  while (sim.units.length < TARGET_UNITS && guard < TARGET_UNITS * 2) {
    const pentagon = planet.pentagons[spawnCursor % planet.pentagons.length];
    spawnUnit(sim, SPAWN_TYPES[spawnCursor % SPAWN_TYPES.length], pentagon);
    spawnCursor++;
    guard++;
  }
}

/**
 * „Linijka" spalania: 3 typy × 5 poziomów ekspozycji w równych odstępach na jednym okręgu,
 * NIE symulowana — żeby przy pytaniach 3 i 4 dało się porównać całą rampę obok siebie, na
 * każdym paśmie po kolei, w miarę jak przechodzi po niej terminator. Ten sam przyrząd co w
 * `main.ts` (Zadanie 4) i celowo ta sama geometria: to on był podstawą tamtego werdyktu.
 */
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

// --- Migawka do trybu PRÓB ---------------------------------------------------------------
// Tryb prób rysuje ZAMROŻONY świat (patrz komentarz modułu), więc potrzebuje jednego,
// deterministycznego zestawu jednostek. Rozbieg liczony raz, przy starcie: ta sama liczba
// ticków przy każdym otwarciu strony, więc drugi przebieg człowieka pokazuje tę samą scenę.
const PREROLL_TICKS = 900;
const prerollLight = new Float32Array(planet.cells.length);
for (let t = 0; t < PREROLL_TICKS; t++) {
  const sunDir = sunDirection(t * TICK_SECONDS, rotationPeriod);
  lightFieldInto(planet, sunDir, prerollLight);
  if (t % 3 === 0) topUpUnits();
  updateMovement(sim, flowFields, prerollLight, sunDir, motion);
  updateBurning(sim, prerollLight);
}
topUpUnits();
// Jednostki stojące na komórce, o którą bramka pyta — z tego samego powodu co budynki.
const frozenUnits: Unit[] = rulerUnits
  .concat(sim.units)
  .filter((u) => !questionedCells.has(u.cellId))
  .map((u) => ({ ...u, pos: { ...u.pos } }));
console.log(
  `[BRAMKA] scena: ${buildingCount} budynków, ${frozenUnits.length} jednostek zamrożonych, cel ${TARGET_UNITS} żywych w trybie swobodnym`,
);

// --- Panel -------------------------------------------------------------------------------

type Phase = 'trials' | 'free';
let phase: Phase = 'trials';

const statusEl = requireElement<HTMLDivElement>('#status');
const promptEl = requireElement<HTMLDivElement>('#prompt');
const tallyEl = requireElement<HTMLDivElement>('#tally');
const litBtn = requireElement<HTMLButtonElement>('#answer-lit');
const darkBtn = requireElement<HTMLButtonElement>('#answer-dark');
const nextBtn = requireElement<HTMLButtonElement>('#next-btn');
const modeEls = {
  threshold: requireElement<HTMLButtonElement>('#mode-threshold'),
  smooth: requireElement<HTMLButtonElement>('#mode-smooth'),
  control: requireElement<HTMLButtonElement>('#mode-control'),
};
const modeNoteEl = requireElement<HTMLDivElement>('#mode-note');
const phaseTrialsBtn = requireElement<HTMLButtonElement>('#phase-trials');
const phaseFreeBtn = requireElement<HTMLButtonElement>('#phase-free');
const trialsPanel = requireElement<HTMLDivElement>('#trials-panel');
const freePanel = requireElement<HTMLDivElement>('#free-panel');
const hudEl = requireElement<HTMLDivElement>('#hud');
const exportEl = requireElement<HTMLTextAreaElement>('#export');
const machineEl = requireElement<HTMLInputElement>('#machine');

const MODE_NOTE: Record<GateMode, string> = {
  threshold:
    'TRYB OCENIANY. Progowane cieniowanie terenu + krata + budynki + jednostki — to jest render gry. Tylko odpowiedzi z tego trybu liczą się do pytania 1.',
  smooth:
    'TRYB PORÓWNAWCZY (nieoceniany). Gradient zamiast progów na terenie i kracie; budynki i jednostki bez zmian.',
  control:
    'KONTROLA POZYTYWNA (nieoceniana). Wierzchołki WSPÓŁDZIELONE, kolor interpolowany po powierzchni, a planeta schowana razem z kratą, budynkami i jednostkami — czyli DOKŁADNIE ta sama kontrola, co w bramce terenowej. Jeśli TUTAJ potrafisz odpowiadać poprawnie znacznie powyżej 50%, bramka nie umie oblać i jej wynik nic nie znaczy. Zapisz to.',
};

// --- Sterowanie trybem cieniowania jednostek (pytanie 4) ---------------------------------

interface ShadingPreset {
  readonly label: string;
  readonly mode: UnitShadingMode;
  readonly bands: readonly number[];
  readonly note: string;
}
const SHADING_PRESETS: readonly ShadingPreset[] = [
  {
    label: 'brak (produkcja)',
    mode: 'flat',
    bands: UNIT_BAND_SHADE_LEGAL,
    note: 'Jednostka nie zależy od światła wcale — wariant, który dziś idzie na ekran.',
  },
  {
    label: 'gładkie 0,8464 (legalne)',
    mode: 'smooth',
    bands: UNIT_BAND_SHADE_LEGAL,
    note:
      'Maksymalne przyciemnienie mieszczące się w progu 3:1 wobec każdego tła. Zmienia rdzeń o 18/255 sRGB. TO jest wariant, którego nie obejrzał ani wykonawca Zadania 4, ani przegląd — pytanie 4 dotyczy dokładnie jego.',
  },
  {
    label: 'progowe 0,8464 (legalne)',
    mode: 'threshold',
    bands: UNIT_BAND_SHADE_LEGAL,
    note:
      'To samo przyciemnienie, ale SCHODKOWO — jak teren. Zadanie 4 odrzuciło ten wariant za stroboskopowanie do 20 zmian pasma na sekundę u jednostek na terminatorze; popatrz na jednostki przechodzące przez granicę.',
  },
  {
    label: 'gładkie 0,55 (POZA budżetem)',
    mode: 'smooth',
    bands: UNIT_BAND_SHADE,
    note:
      'Odniesienie, nie kandydat: czynnik 0,55 łamie próg 3:1 wobec obrysu nocy. To przy NIM zapadła obserwacja wzrokowa Zadania 4 — zmiana rdzenia o 59/255, ponad trzykrotnie większa niż legalna.',
  },
];
let shadingIndex = 0;
const shadingNoteEl = requireElement<HTMLDivElement>('#shading-note');
const shadingButtons = SHADING_PRESETS.map((preset, index) => {
  const button = document.createElement('button');
  button.textContent = `${index + 1}. ${preset.label}`;
  button.addEventListener('click', () => applyShading(index));
  requireElement<HTMLDivElement>('#shading-buttons').appendChild(button);
  return button;
});
function applyShading(index: number): void {
  shadingIndex = index;
  const preset = SHADING_PRESETS[index];
  world.setUnitShadingBands(preset.bands);
  world.setUnitShading(preset.mode);
  shadingButtons.forEach((b, i) => b.classList.toggle('active', i === index));
  shadingNoteEl.textContent = preset.note;
}

// --- Sterowanie pulsem pierścienia alarmu (pytanie 5) ------------------------------------

// Puls jest od rundy naprawczej 2 DOMYŚLNYM wyglądem gry, więc bramka startuje z nim
// włączonym; przełącznik służy teraz do porównania „z pulsem ⇄ bez", a nie do jego szukania.
let pulseOn = true;
const pulseBtn = requireElement<HTMLButtonElement>('#pulse-toggle');
function refreshPulseButton(): void {
  pulseBtn.classList.toggle('active', pulseOn);
  pulseBtn.textContent = pulseOn ? 'Puls: WŁĄCZONY (produkcja)' : 'Puls: wyłączony (do porównania)';
}
pulseBtn.addEventListener('click', () => {
  pulseOn = !pulseOn;
  refreshPulseButton();
});
refreshPulseButton();

// --- Słońce: zatrzymanie i tempo (pytania 2 i 4) ------------------------------------------
//
// Pytanie 4 wymaga porównania DWÓCH wariantów cieniowania na TYM SAMYM tle: przy ruchomym
// słońcu tło zmienia się między jednym a drugim spojrzeniem i porównanie przestaje być
// porównaniem. Zatrzymanie dotyczy WYŁĄCZNIE słońca — jednostki idą i płoną dalej, bo
// pytanie 3 potrzebuje ruchu.
//
// Tempo: runda naprawcza 1. Człowiek napisał „nie ma ruchu słońca", choć słońce orbitowało —
// przy `DEFAULT_RUN.rotationPeriod` = 180 s ruch przez kilka sekund jest niedostrzegalny, a
// pytanie 2 wymaga obejrzenia budynku na WSZYSTKICH TRZECH pasmach. Dwie naprawy naraz i obie
// są o tym, żeby nie trzeba było zgadywać: (1) odczyt stanu obrotu w procentach, (2) jawne
// przyspieszenie — **opisane w panelu i w eksporcie**, bo przyspieszony obrót NIE jest tempem
// gry i wynik zapisany bez tej informacji byłby wynikiem o czymś innym.
let sunPaused = false;
let sunFrozenAtSeconds = 0;
/** [WYGLĄD] Mnożnik przyspieszenia — 180 s obrotu / 8 = 22,5 s, czyli pasmo zmienia się w kilka sekund. */
const SUN_FAST_MULTIPLIER = 8; // [WYGLĄD]
let sunMultiplier = 1;
/** Czas słońca liczony WŁASNYM akumulatorem, nie `elapsed × mnożnik` — inaczej zmiana tempa
 *  teleportowałaby słońce, bo przeskalowałaby całą przeszłość, a nie dalszy bieg. */
let sunSeconds = 0;
let lastSunSampleAt = performance.now();

const sunBtn = requireElement<HTMLButtonElement>('#sun-toggle');
const sunSpeedBtn = requireElement<HTMLButtonElement>('#sun-speed');
const sunReadoutEl = requireElement<HTMLDivElement>('#sun-readout');
const burnReadoutEl = requireElement<HTMLDivElement>('#burn-readout');
sunBtn.addEventListener('click', () => {
  sunPaused = !sunPaused;
  sunBtn.classList.toggle('active', sunPaused);
  sunBtn.textContent = sunPaused ? 'Słońce: ZATRZYMANE' : 'Słońce: orbituje';
});
sunSpeedBtn.addEventListener('click', () => {
  sunMultiplier = sunMultiplier === 1 ? SUN_FAST_MULTIPLIER : 1;
  sunSpeedBtn.classList.toggle('active', sunMultiplier !== 1);
  sunSpeedBtn.textContent =
    sunMultiplier === 1 ? 'Tempo: ×1 (gra)' : `Tempo: ×${SUN_FAST_MULTIPLIER} — NIE jest to tempo gry`;
  refreshExport();
});

/**
 * Wychylenie promienia pierścienia w tej klatce: 0 przy wyłączonym pulsie **oraz zawsze w
 * fazie PRÓB**. Faza prób ma być zamrożona — jedyną rzeczą różniącą ją od bramki terenowej
 * jest OBECNOŚĆ pełnej sceny, nie to, czy ktoś zostawił włączony przełącznik pytania 5.
 */
function alertPulseAt(seconds: number): number {
  if (!pulseOn || phase !== 'free') return 0;
  // Ta sama funkcja czysta, co w głównej aplikacji — nie druga kopia wzoru, bo dwa wzory
  // rozjechałyby się przy pierwszym strojeniu okresu.
  return alertPulse(planet.radius, seconds);
}

// --- Pięć pytań --------------------------------------------------------------------------

type Verdict = 'TAK' | 'NIE' | 'NIE DA SIĘ ROZSTRZYGNĄĆ';
const VERDICTS: readonly Verdict[] = ['TAK', 'NIE', 'NIE DA SIĘ ROZSTRZYGNĄĆ'];

interface Question {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  verdict: Verdict | null;
  note: string;
}
const QUESTIONS: Question[] = [
  {
    id: 1,
    title: 'Czy terminator nadal jest czytelny przy pełnej scenie?',
    body:
      'Odpowiadasz na nie PRZEBIEGIEM PRÓB (przycisk „Próby” wyżej), nie tutaj — piętnaście osądów w trybie ocenianym, tak samo jak w bramce terenowej. Tu zapisz werdykt zbiorczy. REGRESJA WOBEC ZADANIA 1 (15/15) JEST NAJGROŹNIEJSZYM MOŻLIWYM WYNIKIEM TEJ FAZY i ma zostać zapisana, nie obejdzona.',
    verdict: null,
    note: '',
  },
  {
    id: 2,
    title: 'Czy widać, który budynek jest niezasilony — bez najeżdżania kursorem?',
    body:
      'Co czwarty budynek w tej scenie jest bez prądu i dostaje bursztynowo-czarny pierścień wokół podstawy. Sprawdź na WSZYSTKICH TRZECH PASMACH i na obu skalach. Terminator przechodzi po budynku sam — odczyt „obrót: …%” wyżej pokazuje, ile z obrotu minęło; jeśli czekanie 180 s jest za długie, włącz „Tempo ×8” (jest odnotowywane w eksporcie).',
    verdict: null,
    note: '',
  },
  {
    id: 3,
    title: 'Czy widać, że jednostka się pali — ZANIM zginie?',
    body:
      'Jednostki GINĄ naprawdę — licznik „spalonych przez słońce” wyżej rośnie przy każdej śmierci, a populacja jest dosypywana do 481, więc na ekranie są ciągle nowe. Szukaj: kurczący się jasny rdzeń, rosnąca ciemna obwódka, barwa rdzenia z fioletu w rozżarzenie, potem zniknięcie. Odniesienie: „linijka” koło komórki startowej (3 typy × 5 poziomów ekspozycji) jest NIERUCHOMA i NIE podlega spalaniu, więc pokazuje całą rampę naraz, łącznie ze stanem tuż przed śmiercią.',
    verdict: null,
    note: '',
  },
  {
    id: 4,
    title: 'Czy widać cieniowanie jednostki czynnikiem 0,8464?',
    body:
      'UWAGA: klawisze 1/2/3 w GŁÓWNEJ APLIKACJI (/) dają czynnik 0,55, czyli wariant POZA budżetem kontrastu — odpowiedź udzielona stamtąd NIE JEST odpowiedzią na to pytanie. Użyj presetów na TEJ stronie: przełącz „brak (produkcja)” ⇄ „gładkie 0,8464 (legalne)” i patrz na te same jednostki, na wszystkich trzech pasmach; najłatwiej przy ZATRZYMANYM słońcu. JEŚLI RÓŻNICY NIE WIDAĆ — argument Zadania 4 domyka się i `flat` zostaje bez zastrzeżeń. JEŚLI WIDAĆ — to jest ustalenie do Fazy 4, a nie powód do zmiany teraz.',
    verdict: null,
    note: '',
  },
  {
    id: 5,
    title: 'Czy widać, że pierścień alarmu pulsuje?',
    body:
      'Przełącznik „Puls: brak (produkcja)” wyżej — kliknij, żeby włączyć maksymalny LEGALNY puls. Amplituda to CAŁY zapas, jaki został między pierścieniem (3,0300) a krawędzią najmniejszej komórki (3,1720): 0,13 jednostki, czyli 0,44 piksela z widoku domyślnego, przy progu widoczności 1 px. Większej nie ma — sufitem jest rozmiar komórki, nie dobór wartości. JEŚLI PULSU NIE WIDAĆ, to jest wynik: pierścień zostaje bez pulsu. „Nie znalazłem przełącznika” to NIE jest odpowiedź na to pytanie.',
    verdict: null,
    note: '',
  },
];

const questionsEl = requireElement<HTMLDivElement>('#questions');
for (const question of QUESTIONS) {
  const wrapper = document.createElement('div');
  wrapper.className = 'question';
  const heading = document.createElement('div');
  heading.className = 'question-title';
  heading.textContent = `${question.id}. ${question.title}`;
  const body = document.createElement('div');
  body.className = 'question-body';
  body.textContent = question.body;
  const buttons = document.createElement('div');
  const made: HTMLButtonElement[] = [];
  for (const verdict of VERDICTS) {
    const button = document.createElement('button');
    button.textContent = verdict;
    button.addEventListener('click', () => {
      question.verdict = verdict;
      made.forEach((b) => b.classList.toggle('active', b === button));
      refreshExport();
    });
    made.push(button);
    buttons.appendChild(button);
  }
  const note = document.createElement('textarea');
  note.className = 'question-note';
  note.placeholder = 'Uwagi (co konkretnie było widać albo czego nie było, na którym paśmie, przy której skali)…';
  note.addEventListener('input', () => {
    question.note = note.value;
    refreshExport();
  });
  wrapper.append(heading, body, buttons, note);
  questionsEl.appendChild(wrapper);
}

// --- Obsługa przebiegu prób ---------------------------------------------------------------

litBtn.addEventListener('click', () => {
  gate.answer(true);
  refreshUI();
});
darkBtn.addEventListener('click', () => {
  gate.answer(false);
  refreshUI();
});
nextBtn.addEventListener('click', () => {
  gate.advance();
  refreshUI();
});
for (const mode of ['threshold', 'smooth', 'control'] as const) {
  modeEls[mode].addEventListener('click', () => {
    gate.setMode(mode);
    refreshUI();
  });
}
phaseTrialsBtn.addEventListener('click', () => setPhase('trials'));
phaseFreeBtn.addEventListener('click', () => setPhase('free'));
machineEl.addEventListener('input', refreshExport);

function setPhase(next: Phase): void {
  phase = next;
  if (next === 'free') {
    // Faza swobodna pokazuje RENDER GRY — więc zawsze tryb progowany. Pierścień znika: nie
    // trwa żadna próba, a zostawiony wskazywałby komórkę, o którą nikt nie pyta.
    gate.setMode('threshold');
  }
  gate.setMarkerHidden(next === 'free');
  phaseTrialsBtn.classList.toggle('active', next === 'trials');
  phaseFreeBtn.classList.toggle('active', next === 'free');
  trialsPanel.hidden = next !== 'trials';
  freePanel.hidden = next !== 'free';
  refreshUI();
}

window.addEventListener('keydown', (event) => {
  const index = Number(event.key) - 1;
  if (phase === 'free' && index >= 0 && index < SHADING_PRESETS.length) applyShading(index);
});

function refreshUI(): void {
  const mode = gate.mode();
  for (const m of ['threshold', 'smooth', 'control'] as const) {
    modeEls[m].classList.toggle('active', m === mode);
  }
  modeNoteEl.textContent = MODE_NOTE[mode];
  modeNoteEl.className = mode === 'threshold' ? 'note evaluated' : mode === 'control' ? 'note control' : 'note';

  const answered = gate.answersFor(mode);
  const correctSoFar = answered.filter((a) => a.correct).length;
  tallyEl.textContent = answered.length > 0 ? `Wynik w tym trybie: ${correctSoFar}/${answered.length} poprawnych.` : '';

  if (phase === 'free') {
    statusEl.textContent = 'Tryb SWOBODNY — słońce orbituje, jednostki idą i płoną. Pierścień prób jest ukryty.';
    promptEl.textContent = '';
    refreshExport();
    return;
  }

  if (gate.isFinished()) {
    statusEl.textContent = `Tryb "${mode}" zakończony — ${gate.totalTrials}/${gate.totalTrials} prób rozstrzygniętych.`;
    promptEl.textContent = '';
    litBtn.disabled = true;
    darkBtn.disabled = true;
    nextBtn.disabled = true;
    refreshExport();
    return;
  }

  const trial = gate.currentTrial();
  if (!trial) return;
  const cellInPhase = (gate.currentTrialIndex() % CELLS_PER_PHASE) + 1;
  statusEl.textContent = `Tryb ${mode} · Faza ${trial.phaseIndex + 1}/3 · Komórka ${cellInPhase}/${CELLS_PER_PHASE} · Próba ${
    gate.currentTrialIndex() + 1
  }/${gate.totalTrials}`;

  if (!gate.isRevealed()) {
    promptEl.textContent =
      'Czy komórka WEWNĄTRZ pierścienia leży po stronie OŚWIETLONEJ, czy po stronie NOCY? Możesz obracać i przybliżać kamerę przed odpowiedzią.';
    litBtn.disabled = false;
    darkBtn.disabled = false;
    nextBtn.disabled = true;
  } else {
    const last = answered[answered.length - 1];
    promptEl.textContent = `${last.correct ? 'Poprawnie.' : 'Niepoprawnie.'} Pierścień pokazuje teraz PRAWDĘ: zielony = komórka oświetlona, czerwony = komórka ciemna.`;
    litBtn.disabled = true;
    darkBtn.disabled = true;
    nextBtn.disabled = false;
  }
  refreshExport();
}

/** Gotowy blok Markdown do wklejenia w dokument wyników — jedyny artefakt tej strony. */
function refreshExport(): void {
  const lines: string[] = [];
  lines.push('### Bramka pełnego obrazu — przebieg człowieka');
  lines.push('');
  lines.push(`Maszyna: ${machineEl.value.trim() || '(wpisz w panelu)'}`);
  lines.push(
    `Scena: ${buildingCount} budynków, ${TARGET_UNITS} jednostek żywych (tryb swobodny), ${frozenUnits.length} jednostek (tryb prób).`,
  );
  lines.push(`Budżet klatki: ${lastBudgetLine || '(przełącz na tryb swobodny i odczekaj 1000 klatek)'}`);
  // Tempo obrotu w eksporcie, bo wynik oglądany przy ×8 jest wynikiem o czymś innym niż
  // wynik oglądany w tempie gry — a z samej odpowiedzi „TAK/NIE" tego nie odtworzysz.
  lines.push(
    `Tempo obrotu podczas oglądania: ×${sunMultiplier}` +
      (sunMultiplier === 1 ? ' (tempo gry)' : ` — PRZYSPIESZONE, w grze pełny obrót trwa ${rotationPeriod} s`),
  );
  lines.push('');
  for (const mode of ['threshold', 'smooth', 'control'] as const) {
    const answers = gate.answersFor(mode);
    if (answers.length === 0) continue;
    lines.push(`#### Pytanie 1 — tryb "${mode}"`);
    lines.push('');
    lines.push(formatGateResultsMarkdown(answers, gate.totalTrials));
    lines.push('');
  }
  lines.push('#### Pięć pytań');
  lines.push('');
  lines.push('| # | Pytanie | Werdykt człowieka | Uwagi |');
  lines.push('|---|---|---|---|');
  for (const q of QUESTIONS) {
    const note = q.note.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
    lines.push(`| ${q.id} | ${q.title} | ${q.verdict ?? '— (nie rozstrzygnięto)'} | ${note || '—'} |`);
  }
  exportEl.value = lines.join('\n');
}

// --- Pętla renderu ------------------------------------------------------------------------

const FRAME_WINDOW = 1000;
const frameTimes = createRollingWindow(FRAME_WINDOW);
const simTimes = createRollingWindow(FRAME_WINDOW);
let totalFrames = 0;
let lastBudgetLine = '';

const light = new Float32Array(planet.cells.length); // bufor zaalokowany RAZ, poza pętlą
/** Bufor sklejki „linijka + żywe jednostki", zaalokowany RAZ — patrz komentarz w `tick`. */
const drawBuffer: Unit[] = [];
const startTime = performance.now();
let lastFrameAt = startTime;
let simAccumulator = 0;
let simTick = 0;

function currentTrialSun(): GateTrial | null {
  return gate.currentTrial();
}

function tick(): void {
  const frameStart = performance.now();
  const elapsedSeconds = (frameStart - startTime) / 1000;

  let simMs = 0;
  let unitsToDraw: readonly Unit[];
  let sunDir;

  if (phase === 'trials') {
    // ZAMROŻONE: faza słońca bieżącej próby, migawka jednostek. Po wyczerpaniu planu
    // zostaje ostatnia znana faza, żeby scena nie znikła z ekranu.
    const trial = currentTrialSun();
    sunDir = trial ? trial.sunDir : sunDirection(0, rotationPeriod);
    lightFieldInto(planet, sunDir, light);
    unitsToDraw = frozenUnits;
  } else {
    // Własny akumulator czasu słońca — patrz `sunSeconds`.
    const deltaSeconds = Math.min(frameStart - lastSunSampleAt, 250) / 1000;
    lastSunSampleAt = frameStart;
    if (!sunPaused) sunSeconds += deltaSeconds * sunMultiplier;
    sunFrozenAtSeconds = sunSeconds;
    sunDir = sunDirection(sunSeconds, rotationPeriod);
    lightFieldInto(planet, sunDir, light);
    // Symulacja w STAŁYM kroku (§7.2), z sufitem na liczbę kroków w jednej klatce —
    // mierzona OSOBNO i odejmowana od czasu klatki: budżet 8 ms dotyczy RENDERU.
    const simStart = performance.now();
    simAccumulator += Math.min(frameStart - lastFrameAt, 250) / 1000;
    let steps = 0;
    while (simAccumulator >= TICK_SECONDS && steps < 5) {
      simAccumulator -= TICK_SECONDS;
      steps++;
      simTick++;
      updateMovement(sim, flowFields, light, sunDir, motion);
      updateBurning(sim, light);
      topUpUnits(); // utrzymanie szczytu z Fazy 1C — patrz `TARGET_UNITS`
    }
    // „Linijka" spalania jest rysowana TAKŻE w trybie swobodnym — runda naprawcza 1.
    // Pierwsza wersja rysowała tu samo `sim.units`, więc odniesienia (rampa 3×5, w tym stan
    // tuż przed śmiercią) na ekranie po prostu NIE BYŁO, choć panel o niej pisał. Pytanie 3
    // brzmi „czy widać, że się pali, ZANIM zginie" — bez rampy nie ma z czym porównać.
    //
    // Sklejka idzie do bufora zaalokowanego RAZ i mieści się w mierzonym OSOBNO czasie
    // rusztowania, nie w budżecie renderu — ten sam podział co w `main.ts`.
    drawBuffer.length = rulerUnits.length + sim.units.length;
    for (let i = 0; i < rulerUnits.length; i++) drawBuffer[i] = rulerUnits[i];
    for (let i = 0; i < sim.units.length; i++) drawBuffer[rulerUnits.length + i] = sim.units[i];
    simMs = performance.now() - simStart;
    simTimes.push(simMs);
    unitsToDraw = drawBuffer;
    // Teren i krata idą za orbitującym słońcem — w trybie prób maluje je sam harness,
    // światłem BIEŻĄCEJ próby (`applyPhaseColoring`).
    world.paintTerrain(light);
  }
  lastFrameAt = frameStart;

  world.updateBuildings(demoBuildings, alertPulseAt(elapsedSeconds));
  world.updateUnits(unitsToDraw, light);
  gate.renderFrame();

  const frameMs = performance.now() - frameStart - simMs;
  frameTimes.push(frameMs);
  totalFrames++;

  if (totalFrames % 10 === 0) {
    const samples = frameTimes.snapshot();
    const med = median(samples);
    const p95 = percentile(samples, 95);
    // `simTimes` bywa PUSTE — w trybie prób symulacja w ogóle nie biegnie, a `median`
    // słusznie rzuca dla pustego wejścia (`frameStats.ts`). Pusto znaczy „nie mierzone", nie
    // „zero", więc HUD ma to napisać, a nie wymyślić liczbę.
    const simSamples = simTimes.snapshot();
    const simLine =
      simSamples.length > 0 ? `mediana ${median(simSamples).toFixed(3)} ms · tick ${simTick}` : 'nie biegnie (tryb prób)';
    hudEl.textContent =
      `render: mediana ${med.toFixed(3)} ms · p95 ${p95.toFixed(3)} ms (n=${samples.length}) — budżet 8 ms\n` +
      `jednostek rysowanych: ${unitsToDraw.length} · budynków: ${buildingCount}\n` +
      `rusztowanie symulacji (poza budżetem): ${simLine}\n` +
      `cieniowanie [1-4]: ${SHADING_PRESETS[shadingIndex].label} · puls: ${pulseOn ? 'legalny' : 'brak'}`;

    // Odczyty stanu — runda naprawcza 1: człowiek ma WIDZIEĆ, że słońce się rusza i że
    // jednostki giną, zamiast wnioskować to z braku zmian na ekranie.
    if (phase === 'free') {
      const turns = sunSeconds / rotationPeriod;
      const fraction = turns - Math.floor(turns);
      const bar = '█'.repeat(Math.round(fraction * 20)).padEnd(20, '·');
      sunReadoutEl.textContent =
        `obrót ${(fraction * 100).toFixed(1)}% [${bar}] ` +
        `${sunPaused ? 'ZATRZYMANE' : `pełny obrót ${(rotationPeriod / sunMultiplier).toFixed(0)} s`}`;
      burnReadoutEl.textContent =
        `spalonych przez słońce: ${sim.killsBySun} · żywych ${sim.units.length}/${TARGET_UNITS} · linijka ${rulerUnits.length}`;
    }
    if (samples.length >= FRAME_WINDOW) {
      lastBudgetLine = `mediana ${med.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms przy ${unitsToDraw.length} jednostkach i ${buildingCount} budynkach (budżet 8 ms, n=${samples.length})`;
    }
  }

  requestAnimationFrame(tick);
}

applyShading(0);
setPhase('trials');
refreshUI();
requestAnimationFrame(tick);
