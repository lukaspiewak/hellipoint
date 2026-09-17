import { createScene, RENDER_VERSION } from '@heliopolis/render';
import { DEFAULT_RUN, Sim } from '@heliopolis/sim';
import { wireClient, type ListenerTargetLike } from './client.js';

/**
 * ROZRUCH — i nic więcej.
 *
 * Tego pliku NIE DA SIĘ zaimportować w teście: dotyka `document` i `window` już przy
 * wczytaniu modułu. Dlatego nie wolno mu mieć logiki — każda linia, która tu zostaje,
 * jest linią bez pokrycia.
 *
 * Runda naprawcza 2 wyniosła stąd spięcie do `wireClient` (`client.ts`), bo zmierzone
 * w przeglądzie zostało to samo, co runda 1 naprawiła piętro niżej: `focusOn: () => {}`
 * kasowało spację, `keys: canvas` kasowało całą klawiaturę, usunięcie
 * `refreshPointedCell()` cofało naprawę świeżości wskazania, a `(sim.state).ore = 999`
 * przechodziło przez skan źródła na jednej parze nawiasów — **każda z tych mutacji
 * zostawiała cały pakiet zielony**.
 *
 * Dlatego rozruch nie dostaje ani `Planet`, ani `Sim` — tylko SEED i dwie fabryki.
 * Nie ma tu uchwytu, przez który dałoby się dotknąć stanu albo planety; żeby to zrobić,
 * trzeba by najpierw wprowadzić nową zmienną, a to widać gołym okiem w pliku, który cały
 * mieści się na ekranie. Jeśli kolejne zadanie chce tu dopisać warunek albo obliczenie —
 * miejsce jest w `client.ts`, nie tutaj.
 */
console.log(`Heliopolis render ${RENDER_VERSION}`);

const canvas = document.querySelector('#app');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('apps/client: brak <canvas id="app"> w index.html');
}

const hud = document.createElement('div');
hud.style.cssText =
  'position:fixed;top:8px;left:8px;padding:4px 8px;background:rgba(0,0,0,0.55);' +
  'color:#e8f0ff;font:12px/1.4 monospace;white-space:pre;pointer-events:none;z-index:10;';
document.body.appendChild(hud);

const client = wireClient({
  // Seed na sztywno, ten sam co we wszystkich testach i pomiarach gałęzi — to, co widać
  // na ekranie, ma odpowiadać temu, co już zmierzone, a nie osobnej planecie.
  seed: 20260915,
  makeScene: createScene,
  makeSim: (planet, run) => new Sim(planet, run),
  canvas,
  // `window`, nie płótno: `<canvas>` bez `tabindex` nigdy nie dostaje ogniskowej.
  // `wireClient` odrzuca tu płótno głośnym błędem — patrz straż w `client.ts`.
  keys: window as unknown as ListenerTargetLike,
  run: DEFAULT_RUN,
  now: () => performance.now(),
  log: (message) => console.log(message),
});

// Prostokąt płótna jest buforowany (odczyt `getBoundingClientRect` co klatkę wymusza
// w przeglądarce przeliczenie układu) — `resize` to jedyny moment, w którym bufor
// trzeba unieważnić.
window.addEventListener('resize', () => client.invalidateCanvasRect());

function tick(): void {
  hud.textContent = client.frame();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
