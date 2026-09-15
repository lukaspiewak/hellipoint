import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// `import.meta.url`, nie `__dirname` — ten plik jest ESM (`"type": "module"` w
// package.json), gdzie `__dirname` nie istnieje jako global. Ten sam wzorzec co
// `packages/sim/test/contract.test.ts`.
const rootDir = fileURLToPath(new URL('.', import.meta.url));

// Zadanie 1 Fazy 2A: serwer deweloperski dla pustego canvasu, który dowodzi,
// że rura Three.js działa. Port ustawiony na sztywno (zamiast auto-wyboru
// Vite), żeby polecenie z README/raportu zadania było zawsze prawdziwe.
export default defineConfig({
  // Port 5173 (domyślny Vite) bywa zajęty przez inne worktree na tej samej
  // maszynie (np. faza-0-spike) — 5180 zamiast tego, sztywno.
  server: { port: 5180, strictPort: true },
  // Zadanie 5: `gate.html` (harness bramki czytelności) to DRUGA strona tej samej
  // aplikacji Vite. `vite dev` serwuje dowolny .html w katalogu bez tego wpisu — ale
  // `vite build` domyślnie widzi WYŁĄCZNIE `index.html`, więc bez jawnego wejścia
  // `pnpm --filter @heliopolis/client build` po cichu zgubiłby stronę bramki.
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        gate: resolve(rootDir, 'gate.html'),
      },
    },
  },
});
