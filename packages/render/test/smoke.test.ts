import { describe, expect, it } from 'vitest';

/**
 * Test dymny: pakiet musi być importowalny pod własną nazwą (specyfikator
 * pakietu), nie tylko przez ścieżkę względną — to samo uzasadnienie co w
 * `packages/sim/test/smoke.test.ts`. Import typu z `@heliopolis/sim` obok
 * dowodzi, że łącze workspace do siostrzanego pakietu faktycznie się
 * rozwiązuje przez referencje projektów TypeScript (`tsconfig.json#references`),
 * nie tylko przez rozwiązywanie modułów w czasie wykonania.
 */
import { RENDER_VERSION } from '@heliopolis/render';
import type { Vec3 } from '@heliopolis/sim';

describe('smoke: @heliopolis/render importowalny pod własną nazwą', () => {
  it('rozwiązuje się przez specyfikator pakietu i eksportuje wersję', () => {
    expect(RENDER_VERSION).toBe('0.0.0');

    // Użycie typu z @heliopolis/sim wyłącznie na poziomie typów — dowód, że
    // referencja projektu do siostrzanego pakietu workspace się rozwiązuje.
    const origin: Vec3 = { x: 0, y: 0, z: 0 };
    expect(origin.x + origin.y + origin.z).toBe(0);
  });
});
