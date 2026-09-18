import { createScene, worldToNdc } from '@heliopolis/render';
import {
  createPlanet,
  DEFAULT_RUN,
  lightField,
  sunDirection,
  type PowerReport,
} from '@heliopolis/sim';
import { createHudView, type ElementLike } from './hud.js';
import {
  buildTrials,
  CAUSAL_ANSWERS,
  blindOutage,
  constantAnswerWarning,
  gateReport,
  ANSWER_LABELS,
  type CausalAnswer,
  type CausalTrial,
  type GateMode,
} from './causalScenarios.js';

/**
 * # Bramka czytelności PRZYCZYNOWEJ — strona (Faza 2C, Zadanie 6)
 *
 * Tego pliku NIE DA SIĘ zaimportować w teście: dotyka `document` przy wczytaniu. Wszystko,
 * co da się związać bez przeglądarki (scenariusze, prawda, plan odpowiedzi, wykrywanie
 * odpowiedzi stałej, składanie tabeli wyników) mieszka w `causalScenarios.ts` —
 * ten sam szew, co `main.ts` kontra `client.ts`.
 *
 * ## Protokół i próg — wyprowadzone, nie wybrane
 *
 * **M = 12 osądów, N = 10 do zaliczenia.** Cztery odpowiedzi, plan zrównoważony 3/3/3/3.
 *
 * Próg nie jest procentem wziętym z sufitu. Bramka Fazy 2B wymagała KOMPLETU piętnastu przy
 * pytaniu binarnym — czyli zdanie jej przypadkiem miało szansę 1 na 32 768. Tutaj odpowiedzi
 * są cztery, więc ten sam poziom ochrony przed trafem daje **10 z 12: 1 na 26 300**
 * (dwumian, p = 0,25). Próg jest więc dobrany tak, żeby **traf był tak samo nieprawdopodobny
 * jak w bramce, którą projekt już przyjął**, a nie żeby brzmiał surowo.
 *
 * Dwa błędy są dopuszczone, bo zadanie jest trudniejsze niż „oświetlona czy ciemna": człowiek
 * czytający ekran z trafnością 90 % na pytanie zdaje tę bramkę w 89 % przebiegów, a przy
 * komplecie (12/12) zdałby tylko w 28 % — czyli próg mierzyłby wtedy szczęście osoby, która
 * UMIE czytać, zamiast mierzyć samą umiejętność.
 *
 * ## Drugi próg, ważniejszy: sufit KONTROLI
 *
 * Kontrola pozytywna usuwa dwa kanały przyczyny (linię bilansu i rozróżnienie obręczy), więc
 * pary `POWERED`↔`DEFICIT_COVERED` oraz `SHED`↔`UNLINKED` stają się w niej nierozróżnialne —
 * ale sama obecność awarii dalej jest widoczna. **Sufit kontroli to więc 50 %, nie 25 %**,
 * i ktoś, kto trafnie rozpoznaje parę i zgaduje w jej środku, ma 1 na 52 szansy dobić do 10/12.
 *
 * Dlatego wynik przebiegu ocenianego **nic nie znaczy bez przebiegu kontrolnego**. To nie jest
 * ostrożność na zapas: w Fazie 2B kontrola przeciekała DWUKROTNIE (raz przez `saturate`, raz
 * przez celowanie kamerą w pytaną komórkę) i za każdym razem wyglądało to jak umiejętność.
 */

const PASS_THRESHOLD = 10;
const TRIAL_COUNT = 12;
/** Kotwice przebiegu kontrolnego zaczynają się za kotwicami ocenianego — zestawy rozłączne. */
const CONTROL_OFFSET = TRIAL_COUNT;

function requireElement<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector(selector);
  if (el === null) throw new Error(`causal-gate.html: brak elementu ${selector}`);
  return el as T;
}

const canvas = requireElement<HTMLCanvasElement>('#gate-canvas');
const hudRoot = requireElement<HTMLDivElement>('#hud');
const crosshair = requireElement<HTMLDivElement>('#crosshair');
const statusEl = requireElement<HTMLDivElement>('#status');
const questionEl = requireElement<HTMLDivElement>('#question');
const answersEl = requireElement<HTMLDivElement>('#answers');
const tallyEl = requireElement<HTMLDivElement>('#tally');
const warningEl = requireElement<HTMLDivElement>('#warning');
const modeNoteEl = requireElement<HTMLDivElement>('#mode-note');
const gradedBtn = requireElement<HTMLButtonElement>('#mode-graded');
const controlBtn = requireElement<HTMLButtonElement>('#mode-control');
const restartBtn = requireElement<HTMLButtonElement>('#restart');
const resultRow = requireElement<HTMLDivElement>('#result-row');
const resultEl = requireElement<HTMLTextAreaElement>('#result');
const gatePanel = requireElement<HTMLDivElement>('#gate');
const occlusionEl = requireElement<HTMLDivElement>('#occlusion');

const planet = createPlanet({ seed: 20260915 });
const scene = createScene(planet, canvas);
const hud = createHudView(hudRoot as unknown as ElementLike, () => {
  /* Bramka nie buduje — wybór typu jest tu bez znaczenia, a panel wymaga uchwytu. */
});

const SUN_FRACTION = 0.15;
const sunDir = sunDirection(SUN_FRACTION * DEFAULT_RUN.rotationPeriod, DEFAULT_RUN.rotationPeriod);
const light = lightField(planet, sunDir);

const trialSets: Readonly<Record<GateMode, CausalTrial[]>> = {
  graded: buildTrials(planet, 0),
  control: buildTrials(planet, CONTROL_OFFSET),
};

let mode: GateMode = 'graded';
let index = 0;
let given: CausalAnswer[] = [];

function currentTrials(): CausalTrial[] {
  return trialSets[mode];
}

function showTrial(): void {
  const trials = currentTrials();
  if (index >= trials.length) {
    finish();
    return;
  }
  const trial = trials[index];
  const outage = mode === 'control' ? blindOutage(trial.power.outage) : trial.power.outage;
  const report: PowerReport = { ...trial.power, outage };

  // Panel gry — PRAWDZIWY `createHudView`, nie makieta. Bramka pyta o ten ekran.
  hud.update(trial.state, report, trial.cellId, 'BARRICADE', null);
  hudRoot.classList.toggle('hud-blind', mode === 'control');

  scene.updateBuildings(trial.state.buildings, outage, 0);
  scene.updateUnits([], light);
  const centre = planet.cells[trial.cellId].center;
  scene.camera.focusOn(centre, true);

  statusEl.textContent =
    `${mode === 'graded' ? 'Przebieg oceniany' : 'KONTROLA POZYTYWNA'} · ` +
    `osąd ${index + 1} z ${trials.length}`;
  questionEl.textContent =
    'Budynek w celowniku nie pracuje tak, jak powinien — albo pracuje. Co jest tego PRZYCZYNĄ?';
  renderTally();
  render();
}

function renderTally(): void {
  const trials = currentTrials();
  const correct = given.filter((a, i) => a === trials[i].truth).length;
  tallyEl.textContent = `trafnych: ${correct} z ${given.length} (próg: ${PASS_THRESHOLD} z ${TRIAL_COUNT})`;
  warningEl.textContent = constantAnswerWarning(given) ?? '';
}

function answer(choice: CausalAnswer): void {
  if (index >= currentTrials().length) return;
  given.push(choice);
  index++;
  showTrial();
}

function finish(): void {
  const trials = currentTrials();
  crosshair.hidden = true;
  questionEl.textContent = 'Przebieg zakończony.';
  answersEl.replaceChildren();
  resultRow.hidden = false;
  resultEl.value = gateReport(mode, trials, given, PASS_THRESHOLD);
  renderTally();
}

function buildAnswerButtons(): void {
  answersEl.replaceChildren();
  for (const option of CAUSAL_ANSWERS) {
    const btn = document.createElement('button');
    btn.textContent = ANSWER_LABELS[option];
    btn.addEventListener('click', () => answer(option));
    answersEl.appendChild(btn);
  }
}

function setMode(next: GateMode): void {
  mode = next;
  index = 0;
  given = [];
  resultRow.hidden = true;
  crosshair.hidden = false;
  gradedBtn.classList.toggle('mode-on', next === 'graded');
  controlBtn.classList.toggle('mode-on', next === 'control');
  modeNoteEl.textContent =
    next === 'graded'
      ? 'Pełny ekran gry. Wynik tego przebiegu znaczy coś DOPIERO w parze z kontrolą.'
      : 'Linia bilansu ukryta, obręcz alarmu bez rozróżnienia przyczyny. Sufit tego trybu to ' +
        '50% — jeśli odpowiadasz tu wyraźnie wyżej, bramka nie umie oblać i jej wynik nic nie znaczy.';
  buildAnswerButtons();
  showTrial();
}

/**
 * Celownik nad pytanym budynkiem — rzut punktu świata na ekran, co klatkę.
 *
 * Rzut idzie przez `worldToNdc` z `@heliopolis/render`, a nie przez `Vector3.project`
 * wołane tutaj: `apps/client` **nie importuje `three` bezpośrednio** (barierka pakietu,
 * patrz `packages/render/src/index.ts`), a odwrotność tego rachunku (`cameraRay`) już
 * tam mieszka. Piksel↔NDC zostaje po stronie klienta, bo wymaga `getBoundingClientRect`;
 * NDC↔świat po stronie kamery, bo wymaga jej macierzy. Ten sam podział, co przy wskazywaniu.
 */
function placeCrosshair(): void {
  const trials = currentTrials();
  if (index >= trials.length) return;
  const ndc = worldToNdc(scene.camera.object, planet.cells[trials[index].cellId].center);
  const rect = canvas.getBoundingClientRect();
  const x = rect.left + ((ndc.x + 1) / 2) * rect.width;
  const y = rect.top + ((1 - ndc.y) / 2) * rect.height;
  crosshair.style.left = `${x}px`;
  crosshair.style.top = `${y}px`;
  // `z > 1` znaczy „za daleką płaszczyzną albo za kamerą" — celownik na drugiej półkuli
  // wskazywałby miejsce, w którym nic nie ma. Kamera i tak patrzy wprost na tę komórkę.
  crosshair.hidden = ndc.z > 1;
  guardOcclusion(x, y);
}

/**
 * **Strażnik przesłonięcia — bramka ma ZAUWAŻYĆ, że mierzy zasłonięty ekran.**
 *
 * Kamera stawia pytany budynek w środku płótna, a oba panele (gry i bramki) są do krawędzi
 * przyklejone — więc przy dość małym oknie środek wchodzi pod panel gry i pytanie staje się
 * nieodpowiadalne. Bez tego ostrzeżenia wynik wyglądałby jak brak umiejętności.
 *
 * To nie jest ostrożność na zapas. W Fazie 2B kontrolki schowane pod krawędzią przewijania
 * **unieważniły cztery z pięciu pomiarów bramki**, a w Zadaniu 3 tej fazy panel połykał
 * 38,7 % wskazywalnej tarczy — obie wady wyszły dopiero po fakcie, bo instrument nie miał
 * jak zgłosić, że jest zasłonięty. Ten ma.
 */
function guardOcclusion(x: number, y: number): void {
  if (crosshair.hidden) return;
  const hits = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const blockedBy = hits(hudRoot) ? 'panel gry' : hits(gatePanel) ? 'panel bramki' : null;
  occlusionEl.textContent =
    blockedBy === null
      ? ''
      : `PYTANY BUDYNEK JEST ZASŁONIĘTY (${blockedBy}). Powiększ okno — przy tym rozmiarze ` +
        'ten osąd nie mierzy czytelności, tylko układ panelu. Wynik przebiegu jest nieważny.';
}

function render(): void {
  scene.render(light, sunDir);
  placeCrosshair();
}

gradedBtn.addEventListener('click', () => setMode('graded'));
controlBtn.addEventListener('click', () => setMode('control'));
restartBtn.addEventListener('click', () => setMode(mode));

function frame(): void {
  render();
  requestAnimationFrame(frame);
}

setMode('graded');
requestAnimationFrame(frame);
