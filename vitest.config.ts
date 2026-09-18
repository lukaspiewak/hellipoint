import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `apps/*` dołożone w Fazie 2C, Zadanie 2 — pierwszy pakiet testowy w `apps/client`.
    // JEDEN wzorzec, nie osobna konfiguracja per workspace: liczba testów całego repo ma
    // dalej wychodzić z jednego `pnpm test`, inaczej „N testów w M plikach" z raportów
    // zadań przestaje być porównywalne między fazami.
    include: [
      'packages/*/test/**/*.test.ts',
      'tools/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
    ],
  },
  resolve: {
    /**
     * Pakiety warsztatowe rozwiązywane do ŹRÓDŁA, nie do `dist`.
     *
     * Testy w `packages/*` sięgają po `../src/*` względną ścieżką i zawsze badały źródło.
     * Testy w `apps/client` (Faza 2C, Zadanie 2) tak nie mogą — aplikacja importuje
     * pakiety po NAZWIE, przez ich barierkę (`packages/render/src/index.ts`), i test ma
     * sprawdzać dokładnie tę drogę. Bez tego aliasu nazwa rozwiązuje się przez
     * `package.json` do `dist/`, czyli do artefaktu poprzedniego `tsc -b`: zielony test
     * znaczyłby wtedy „ostatni build był poprawny", a nie „kod w repozytorium jest
     * poprawny" — to jest ta sama wada, co liczba, która przeżyła swoje wejście, tyle że
     * na poziomie budowania. ZMIERZONE: mutacja w `packages/render/src/camera.ts` bez
     * przebudowy nie zmieniała ANI JEDNEGO wyniku testu `apps/client`.
     *
     * Barierka zostaje zachowana: alias wskazuje na `src/index.ts`, czyli na ten sam plik
     * reeksportów, który widzi aplikacja — symbol nieeksportowany stamtąd nadal nie
     * zaimportuje się w teście.
     */
    alias: {
      '@heliopolis/sim': fileURLToPath(new URL('./packages/sim/src/index.ts', import.meta.url)),
      '@heliopolis/render': fileURLToPath(new URL('./packages/render/src/index.ts', import.meta.url)),
    },
  },
});
