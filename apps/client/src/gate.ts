import {
  buildGateTrials,
  createReadabilityGate,
  formatGateResultsMarkdown,
  RENDER_VERSION,
  type GateMode,
} from '@heliopolis/render';
import { createPlanet, DEFAULT_RUN, sunDirection } from '@heliopolis/sim';

console.log(`Heliopolis render ${RENDER_VERSION} — bramka czytelności (Faza 2B, Zadanie 1)`);

const canvas = document.querySelector('#gate-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('apps/client/gate.ts: brak <canvas id="gate-canvas"> w gate.html');
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`apps/client/gate.ts: brak elementu "${selector}" w gate.html`);
  }
  return el as T;
}

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
const finalEl = requireElement<HTMLDivElement>('#final');
const verdictEl = requireElement<HTMLDivElement>('#verdict');
const exportEl = requireElement<HTMLTextAreaElement>('#export');

// Ta sama planeta (ten sam seed) co `main.ts` — bramka ocenia TĘ konkretną planetę, nie
// osobną, syntetyczną. Trzy fazy słońca równomiernie rozłożone po pełnym obrocie (0°, 120°,
// 240°), z `DEFAULT_RUN.rotationPeriod` — tym samym okresem, którego używa normalny widok.
const planet = createPlanet({ seed: 20260915 });
const rotationPeriod = DEFAULT_RUN.rotationPeriod;
const sunDirs = [0, 1 / 3, 2 / 3].map((fraction) => sunDirection(fraction * rotationPeriod, rotationPeriod));

const CELLS_PER_PHASE = 5; // trzy fazy × pięć komórek = piętnaście osądów

// Trzy ROZŁĄCZNE plany, po jednym na tryb — patrz `selectSpread` i strażnik rozłączności w
// `createReadabilityGate`. Gdyby tryb kontrolny pytał o komórki już odsłonięte w trybie
// ocenianym, mierzyłby pamięć człowieka, nie czytelność renderu.
const gate = createReadabilityGate(planet, canvas, {
  threshold: buildGateTrials(planet, sunDirs, CELLS_PER_PHASE, 0),
  smooth: buildGateTrials(planet, sunDirs, CELLS_PER_PHASE, 1),
  control: buildGateTrials(planet, sunDirs, CELLS_PER_PHASE, 2),
});

const MODE_NOTE: Record<GateMode, string> = {
  threshold:
    'TRYB OCENIANY. Cieniowanie progowane, płaskie komórki — to jest render gry. Tylko odpowiedzi z tego trybu liczą się do werdyktu.',
  smooth:
    'TRYB PORÓWNAWCZY (nieoceniany). Płaskie komórki, ale gradient zamiast progów — pokazuje, ile kontrastu dokłada samo progowanie. To NIE jest kontrola pozytywna.',
  control:
    'KONTROLA POZYTYWNA (nieoceniana). Wierzchołki WSPÓŁDZIELONE, kolor interpolowany po powierzchni — dosłownie render, który Faza 0 zmierzyła jako nieczytelny. Jeśli TUTAJ potrafisz odpowiadać poprawnie, bramka nie umie oblać i jej wynik nic nie znaczy. Zapisz to.',
};

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

/**
 * Jedyne miejsce, które czyta stan `gate` i przepisuje go do DOM — wołane po KAŻDEJ akcji,
 * żeby panel nigdy nie pokazał stanu sprzed ostatniej interakcji człowieka.
 */
function refreshUI(): void {
  const mode = gate.mode();
  for (const m of ['threshold', 'smooth', 'control'] as const) {
    modeEls[m].classList.toggle('active', m === mode);
  }
  modeNoteEl.textContent = MODE_NOTE[mode];
  modeNoteEl.className = mode === 'threshold' ? 'note evaluated' : mode === 'control' ? 'note control' : 'note';

  const answered = gate.answersFor(mode);
  const correctSoFar = answered.filter((a) => a.correct).length;
  tallyEl.textContent =
    answered.length > 0 ? `Wynik w tym trybie: ${correctSoFar}/${answered.length} poprawnych.` : '';

  if (gate.isFinished()) {
    statusEl.textContent = `Tryb "${mode}" zakończony — ${gate.totalTrials}/${gate.totalTrials} prób rozstrzygniętych.`;
    promptEl.textContent = '';
    litBtn.disabled = true;
    darkBtn.disabled = true;
    nextBtn.disabled = true;

    finalEl.hidden = false;
    const complete = answered.length === gate.totalTrials;
    const pass = complete && correctSoFar === gate.totalTrials;
    verdictEl.textContent =
      mode === 'threshold'
        ? pass
          ? `WERDYKT (do zatwierdzenia przez człowieka): PASS ${correctSoFar}/${gate.totalTrials}`
          : `WERDYKT (do zatwierdzenia przez człowieka): FAIL ${correctSoFar}/${gate.totalTrials}`
        : `Tryb "${mode}" NIE jest oceniany — ${correctSoFar}/${gate.totalTrials}. Wklej tę tabelę do §5 dokumentu wyników.`;
    exportEl.value = formatGateResultsMarkdown(answered, gate.totalTrials);
    return;
  }

  const trial = gate.currentTrial();
  if (!trial) return;
  const cellInPhase = (gate.currentTrialIndex() % CELLS_PER_PHASE) + 1;
  statusEl.textContent = `Tryb ${mode} · Faza ${trial.phaseIndex + 1}/3 · Komórka ${cellInPhase}/${CELLS_PER_PHASE} · Próba ${
    gate.currentTrialIndex() + 1
  }/${gate.totalTrials}`;
  finalEl.hidden = true;

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
}

refreshUI();

function loop(): void {
  gate.renderFrame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
