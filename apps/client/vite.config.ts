import { defineConfig } from 'vite';

// Zadanie 1 Fazy 2A: serwer deweloperski dla pustego canvasu, który dowodzi,
// że rura Three.js działa. Port ustawiony na sztywno (zamiast auto-wyboru
// Vite), żeby polecenie z README/raportu zadania było zawsze prawdziwe.
export default defineConfig({
  // Port 5173 (domyślny Vite) bywa zajęty przez inne worktree na tej samej
  // maszynie (np. faza-0-spike) — 5180 zamiast tego, sztywno.
  server: { port: 5180, strictPort: true },
});
