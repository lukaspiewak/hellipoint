import { createScene, RENDER_VERSION } from '@heliopolis/render';
import { createPlanet, DEFAULT_RUN, lightField, sunDirection } from '@heliopolis/sim';

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

// Planeta jest statyczna; orbituje źródło światła (spec §4.3) — więc pętla renderu liczy
// upływ czasu WŁASNYM zegarem (nie zależy od żadnego `SimState`, którego tu jeszcze nie
// ma — wchodzi w Fazie 2C razem z `Sim.enqueue`, patrz `global-constraints.md`) i przelicza
// `sunDirection`/`lightField` co klatkę na jego podstawie.
const startTime = performance.now();
function tick(): void {
  const elapsedSeconds = (performance.now() - startTime) / 1000;
  const sunDir = sunDirection(elapsedSeconds, DEFAULT_RUN.rotationPeriod);
  const light = lightField(planet, sunDir);
  scene.render(light, sunDir);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
