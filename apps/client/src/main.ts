import { RENDER_VERSION, mountEmptyCanvas } from '@heliopolis/render';

console.log(`Heliopolis render ${RENDER_VERSION}`);

const canvas = document.querySelector('#app');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('apps/client: brak <canvas id="app"> w index.html');
}

// Zadanie 1 Fazy 2A: pusty canvas, który dowodzi, że rura działa — bez
// planety, geometrii ani kamery gry (Zadania 2-4). Cała logika Three.js
// żyje w @heliopolis/render; ten plik tylko ją montuje.
mountEmptyCanvas(canvas);
