import {
  buildGateTrials,
  createReadabilityGate,
  formatGateResultsMarkdown,
  RENDER_VERSION,
  type GateMode,
} from '@heliopolis/render';
import { createPlanet, DEFAULT_RUN, sunDirection } from '@heliopolis/sim';

console.log(`Heliopolis render ${RENDER_VERSION} — bramka czytelności (Zadanie 5)`);

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
const nextBtn = requireElement<HTMLButtonElement>('#next-btn');
const modeBtn = requireElement<HTMLButtonElement>('#mode-toggle');
const finalEl = requireElement<HTMLDivElement>('#final');
const verdictEl = requireElement<HTMLDivElement>('#verdict');
const exportEl = requireElement<HTMLTextAreaElement>('#export');

// Ta sama planeta (ten sam seed) co `main.ts` — bramka czytelności ocenia TĘ konkretną
// planetę, nie osobną, syntetyczną. Trzy fazy słońca równomiernie rozłożone po pełnym
// obrocie (0°, 120°, 240°) — "trzy różne fazy słońca" z §8.1/briefu Kroku 4 — z
// `DEFAULT_RUN.rotationPeriod`, tym samym okresem, którego używa normalny widok (`main.ts`).
const planet = createPlanet({ seed: 20260915 });
const rotationPeriod = DEFAULT_RUN.rotationPeriod;
const sunDirs = [0, 1 / 3, 2 / 3].map((fraction) => sunDirection(fraction * rotationPeriod, rotationPeriod));

const PAIRS_PER_PHASE = 5; // §8.1 / brief Krok 4: pięć par na fazę
const trials = buildGateTrials(planet, sunDirs, PAIRS_PER_PHASE);

const gate = createReadabilityGate(planet, canvas, trials);

canvas.addEventListener('click', (event) => {
  gate.handleClick(event.offsetX, event.offsetY);
  refreshUI();
});

nextBtn.addEventListener('click', () => {
  gate.advance();
  refreshUI();
});

modeBtn.addEventListener('click', () => {
  const next: GateMode = gate.mode() === 'threshold' ? 'smooth' : 'threshold';
  gate.setMode(next);
  refreshUI();
});

/**
 * Jedyne miejsce, które czyta stan `gate` i przepisuje go do DOM — wołane po KAŻDEJ akcji
 * (klik na canvasie, "Dalej", przełącznik trybu), żeby panel nigdy nie pokazał stanu
 * sprzed ostatniej interakcji człowieka.
 */
function refreshUI(): void {
  const controlMode = gate.mode() !== 'threshold';
  modeBtn.textContent =
    gate.mode() === 'threshold' ? 'Pokaż kontrolę pozytywną (cieniowanie ciągłe)' : 'Wróć do progowania (tryb oceniany)';

  if (gate.isFinished()) {
    statusEl.textContent = `Zakończono — ${trials.length}/${trials.length} prób rozstrzygniętych.`;
    promptEl.textContent = '';
    nextBtn.disabled = true;

    const answers = gate.answers();
    const correctCount = answers.filter((a) => a.correct).length;
    const pass = correctCount === answers.length && answers.length === trials.length;
    tallyEl.textContent = `Wynik końcowy: ${correctCount}/${answers.length} poprawnych.`;
    finalEl.hidden = false;
    verdictEl.textContent = pass
      ? `WERDYKT: PASS (${correctCount}/${answers.length})`
      : `WERDYKT: FAIL (${correctCount}/${answers.length}) — patrz dokument wyników, co to zmienia`;
    exportEl.value = formatGateResultsMarkdown(answers, trials.length);
    return;
  }

  const trial = trials[gate.currentTrialIndex()];
  const pairInPhase = (gate.currentTrialIndex() % PAIRS_PER_PHASE) + 1;
  statusEl.textContent = `Faza ${trial.phaseIndex + 1}/3 · Para ${pairInPhase}/${PAIRS_PER_PHASE} · Próba ${
    gate.currentTrialIndex() + 1
  }/${trials.length}`;

  const answered = gate.answers().length;
  const correctSoFar = gate.answers().filter((a) => a.correct).length;
  tallyEl.textContent = answered > 0 ? `Wynik dotąd: ${correctSoFar}/${answered} poprawnych.` : '';

  if (controlMode) {
    promptEl.textContent =
      'TRYB KONTROLNY (cieniowanie ciągłe, bez progowania) — kliknięcia się NIE liczą. Wróć do progowania, żeby kontynuować ocenianą próbę.';
    nextBtn.disabled = true;
  } else if (!gate.isRevealed()) {
    promptEl.textContent = 'Kliknij znacznik, który Twoim zdaniem leży na OŚWIETLONEJ komórce.';
    nextBtn.disabled = true;
  } else {
    const last = gate.answers()[gate.answers().length - 1];
    promptEl.textContent = last.correct
      ? 'Poprawnie! Zielony znacznik = faktycznie oświetlona komórka, czerwony = faktycznie ciemna.'
      : 'Niepoprawnie. Zielony znacznik = faktycznie oświetlona komórka, czerwony = faktycznie ciemna.';
    nextBtn.disabled = false;
  }
}

refreshUI();

function loop(): void {
  gate.renderFrame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
