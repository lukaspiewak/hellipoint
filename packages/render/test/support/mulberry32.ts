/**
 * PRNG deterministyczny WYŁĄCZNIE do testów — pierwszy wspólny pomocnik Fazy 2C
 * (`global-constraints.md`, tabela "Pomocnicy testowi"; pierwsze użycie: `picking.test.ts`,
 * Zadanie 1). Umieszczony tutaj, a nie w pliku testowym, bo kolejne zadania fazy też będą
 * chciały powtarzalnych losowych prób.
 *
 * ## Dlaczego nie `Rng` z `@heliopolis/sim`
 *
 * `Rng`/`STREAM` w `packages/sim/src/math/rng.ts` są częścią KONTRAKTU DETERMINIZMU
 * symulacji (patrz `packages/sim/test/determinism.test.ts`, `golden-hash.test.ts`): ich
 * strumień bitów jest zamrożony, bo od niego zależy odtwarzalność rozgrywki między
 * klientami. Test renderu, który losuje promienie do próby, nie ma NIC wspólnego z tym
 * kontraktem — a związanie się z `Rng` uczyniłoby test renderu zakładnikiem każdej
 * przyszłej zmiany w module symulacji (i odwrotnie: żadna zmiana w `Rng` nie mogłaby być
 * pewna, że nie zepsuje testu w zupełnie innym pakiecie). Ta wada wystąpiła w Fazie 2B
 * trzykrotnie (`global-constraints.md`) — `mulberry32` jest lokalny dla `@heliopolis/render`
 * i nie eksportuje się poza `test/support/`.
 *
 * ## Implementacja
 *
 * mulberry32 (domena publiczna) — mały, szybki, statystycznie wystarczający dla próbek
 * testowych (NIE kryptograficzny, NIE do symulacji). Ten sam seed → ta sama sekwencja,
 * co do bitu, na każdej platformie: arytmetyka wyłącznie na Uint32 przez `>>> 0`/`Math.imul`.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
