import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createPlanet, type Planet } from '../src/world/planet.js';

/**
 * Regresja złotego hasza: najsilniejsza weryfikacja, jaką ta faza wyprodukowała —
 * haszowanie w pełni zbudowanej `Planet` i potwierdzenie identyczności między
 * procesami i konfiguracjami V8 — istniała dotąd wyłącznie jako jednorazowy
 * skrypt w scratchpadzie dwóch recenzentów. Ten test przypina ją na stałe.
 *
 * Przy okazji zabezpiecza subtelniejszy niezmiennik: KOLEJNOŚĆ `Cell.neighbors`
 * jest load-bearing dla późniejszych faz (pathfinding Fazy 1C rozstrzyga remisy
 * odległości po pozycji w tablicy) i dotąd nie była chroniona przez nic — zmiana
 * kolejności sąsiadów przy tej samej topologii zmieni hasz, mimo że żaden z
 * dotychczasowych testów (które sprawdzają zbiory, nie kolejność) by tego nie złapał.
 */

const GOLDEN_SEED = 20260914;

/**
 * Przypięte po uruchomieniu identycznej serializacji + SHA-256 w trzech
 * oddzielnych procesach `node` (zwykłym oraz pod `--experimental-strip-types`)
 * z osobnego jednorazowego skryptu importującego `@heliopolis/sim` po nazwie
 * pakietu — wszystkie trzy zgodne, zanim ta wartość trafiła do repo.
 */
const GOLDEN_SHA256 = 'ce60726814a220ab08a1f966e53a5c9468ebe90e3248f6c49cce7332d0848d30';

/**
 * Serializuje dokładnie te części `Planet`, które nie mogą po cichu dryfować:
 * geometrię każdej komórki, jej typ, UPORZĄDKOWANĄ listę sąsiadów, rozkład
 * rudy i wybraną komórkę startową. Każda liczba (także indeksy i długości)
 * zapisywana jest przez `DataView.setFloat64` — czyli w pełnej precyzji
 * bitowej IEEE 754 — celowo NIE przez `JSON.stringify`: ten ostatni zamienia
 * `NaN`/`Infinity` na nieodróżnialne od siebie `null`, a `-0` na `"0"`, więc
 * dokładnie ten rodzaj cichego dryfu (por. Blocker 4: `undefined` opcja dająca
 * ciche `NaN` w geometrii), który ten test ma łapać, mógłby prześlizgnąć się
 * przez haszowanie oparte na JSON.
 */
function serializePlanetForHash(planet: Planet): Uint8Array {
  const words: number[] = [];
  const pushF64 = (n: number): void => {
    words.push(n);
  };

  pushF64(planet.seed);
  pushF64(planet.radius);
  pushF64(planet.frequency);
  pushF64(planet.startCell);

  pushF64(planet.pentagons.length);
  for (const p of planet.pentagons) pushF64(p);

  pushF64(planet.cells.length);
  for (const cell of planet.cells) {
    pushF64(cell.id);
    pushF64(cell.cellType === 'PENTAGON' ? 1 : 0);
    pushF64(cell.oreCapacity);

    pushF64(cell.center.x);
    pushF64(cell.center.y);
    pushF64(cell.center.z);

    pushF64(cell.normal.x);
    pushF64(cell.normal.y);
    pushF64(cell.normal.z);

    pushF64(cell.corners.length);
    for (const c of cell.corners) {
      pushF64(c.x);
      pushF64(c.y);
      pushF64(c.z);
    }

    // Kolejność CELOWO zachowana, nie sortowana: to właśnie ten porządek
    // pinujemy (por. komentarz na górze pliku).
    pushF64(cell.neighbors.length);
    for (const n of cell.neighbors) pushF64(n);
  }

  const buf = new ArrayBuffer(words.length * 8);
  const view = new DataView(buf);
  for (let i = 0; i < words.length; i++) view.setFloat64(i * 8, words[i], true);
  return new Uint8Array(buf);
}

describe('złoty hasz determinizmu', () => {
  it(`createPlanet({ seed: ${GOLDEN_SEED} }) haszuje się do przypiętej wartości`, () => {
    const planet = createPlanet({ seed: GOLDEN_SEED });
    const bytes = serializePlanetForHash(planet);
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(hash).toBe(GOLDEN_SHA256);
  });

  it('kolejność Cell.neighbors jest częścią przypiętego hasza (nie tylko zbiór)', () => {
    // Ten sam zestaw sąsiadów w INNEJ kolejności musi dać INNY hasz — inaczej
    // powyższy test chroniłby tylko zbiory, nie porządek, i cichy regres
    // sortowania (który zepsułby rozstrzyganie remisów w pathfindingu Fazy 1C)
    // przeszedłby niezauważony.
    const planet = createPlanet({ seed: GOLDEN_SEED });
    const reordered: Planet = {
      ...planet,
      cells: planet.cells.map((c) => ({ ...c, neighbors: [...c.neighbors].reverse() })),
    };
    const originalHash = createHash('sha256').update(serializePlanetForHash(planet)).digest('hex');
    const reorderedHash = createHash('sha256').update(serializePlanetForHash(reordered)).digest('hex');
    expect(reorderedHash).not.toBe(originalHash);
  });
});
