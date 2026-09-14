import { describe, expect, it } from 'vitest';

/**
 * Test dymu: pakiet musi być importowalny pod własną nazwą, nie tylko przez
 * ścieżkę względną. Reszta testów w tym katalogu importuje z '../src/...' —
 * co przechodzi nawet wtedy, gdy `package.json#main`/`#types` jest zepsute
 * (tak jak było, gdy wskazywało na `./src/index.ts`: `.js`-owe specyfikatory
 * w źródłach nie mapują się na `.ts` poza kompilatorem TypeScriptowym). Ten
 * plik celowo importuje przez SPECYFIKATOR PAKIETU, tak jak zrobi to
 * headless runner Fazy 1C (`node --experimental-strip-types`) i renderer
 * Fazy 2 — żeby regresja `main`/`types` (albo brakujący link w node_modules)
 * została złapana tutaj, a nie dopiero w innym pakiecie.
 */
import { createPlanet, SIM_VERSION } from '@heliopolis/sim';

describe('smoke: @heliopolis/sim importowalny pod własną nazwą', () => {
  it('rozwiązuje się przez specyfikator pakietu i eksportuje działające API', () => {
    expect(SIM_VERSION).toBe('0.0.0');

    const planet = createPlanet({ seed: 20260914 });
    expect(planet.cells.length).toBe(1442);
    expect(planet.pentagons.length).toBe(12);
  });
});
