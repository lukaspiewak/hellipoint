import { describe, expect, it } from 'vitest';
import { createPlanet, sunDirection, lightField } from '@heliopolis/sim';
import { buildPlanetGeometry, type PlanetGeometry } from '../src/geometry.js';
import {
  DEFAULT_PALETTE,
  LIGHT_BANDS,
  lightBand,
  writeCellColors,
  type Palette,
  type Rgb,
} from '../src/shading.js';

// Ta sama planeta-fixture co `geometry.test.ts` (ten sam seed) — oba pliki testowe w tym
// pakiecie mówią więc o TEJ SAMEJ "prawdziwej planecie", nie o dwóch różnych.
const planet = createPlanet({ seed: 20260915 });
const geo = buildPlanetGeometry(planet);

// `sunDirection(0, 180)` — dokładnie ten punkt w czasie, o który pyta brief (Krok 5: pomiar
// rozkładu pasm). Użyty konsekwentnie we WSZYSTKICH testach niżej, które potrzebują
// prawdziwego światła — nie tylko tam, gdzie brief wymaga tego wprost (test 6) — żeby
// "prawdziwe dane" znaczyło jedno i to samo w całym tym pliku.
const sun = sunDirection(0, 180);
const light = lightField(planet, sun);

/**
 * Porównanie z `out` (Float32Array) wymaga zaokrąglenia oczekiwanej wartości DOKŁADNIE tak,
 * jak robi to sam zapis do Float32Array (`Math.fround`) — bez tego prawie każde porównanie
 * `toBe`/`toEqual` z surową stałą float64 z `DEFAULT_PALETTE` fałszywie by nie przeszło:
 * większość ułamków dziesiętnych (np. 0.03) nie ma dokładnej reprezentacji binarnej ani we
 * float32, ani we float64, a te dwa zaokrąglenia dają RÓŻNE liczby float64 po poszerzeniu.
 * Ten sam problem i to samo rozwiązanie co `vertexMatches` w `geometry.test.ts`.
 */
function froundRgb(c: Rgb): Rgb {
  return [Math.fround(c[0]), Math.fround(c[1]), Math.fround(c[2])];
}

describe('lightBand', () => {
  it('1. jest monotoniczna i schodkowa: przy KAŻDYM progu dwie wartości różniące się o mniej niż 0,01 dają różne pasma', () => {
    for (let i = 0; i < LIGHT_BANDS.length; i++) {
      const t = LIGHT_BANDS[i];
      const justBelow = t - 1e-6;

      // Kontrola pozytywna na sam test: dowód, że para faktycznie różni się o mniej niż
      // 0,01 (i że różnica jest dodatnia, nie przypadkiem zerowa) — inaczej poniższe dwa
      // `expect` mogłyby sprawdzać coś dalekiego od progu, nie "nieciągłość NA progu".
      expect(t - justBelow).toBeLessThan(0.01);
      expect(t - justBelow).toBeGreaterThan(0);

      expect(lightBand(justBelow)).toBe(i);
      expect(lightBand(t)).toBe(i + 1);
    }

    // Monotoniczność globalna: pasmo nigdy nie maleje wraz ze wzrostem light, na gęstej
    // próbce pokrywającej cały zakres — nie tylko w bezpośredniej okolicy progów sprawdzonej
    // wyżej.
    const SAMPLES = 2000;
    let prevBand = lightBand(0);
    for (let i = 1; i < SAMPLES; i++) {
      const band = lightBand(i / (SAMPLES - 1));
      expect(band).toBeGreaterThanOrEqual(prevBand);
      prevBand = band;
    }
  });

  it('2. jest STAŁA w obrębie jednego pasma mimo różnych wejść — asercja, która obala mutację "brak progowania" (lightBand zwraca light bez zmian)', () => {
    const edges = [0, ...LIGHT_BANDS, 1];
    for (let band = 0; band < edges.length - 1; band++) {
      const lo = edges[band];
      const hi = edges[band + 1];
      const quarter = lo + (hi - lo) / 4;
      const mid = lo + (hi - lo) / 2;
      const threeQuarters = lo + (3 * (hi - lo)) / 4;

      // Kontrola pozytywna: trzy wejścia RÓŻNE między sobą — gdyby `lightBand` było
      // identycznością, poniższe trzy `toBe(band)` nie mogłyby przejść (band to mała liczba
      // całkowita 0/1/2…, a quarter/mid/threeQuarters to różne ułamki). Dokładnie o to pytał
      // brief: "czy jakikolwiek test przeszedłby, gdyby lightBand po prostu zwracało light
      // bez zmian?" — ten ma nie przejść.
      expect(quarter).not.toBe(mid);
      expect(mid).not.toBe(threeQuarters);

      expect(lightBand(quarter)).toBe(band);
      expect(lightBand(mid)).toBe(band);
      expect(lightBand(threeQuarters)).toBe(band);
    }
  });

  it('3. dokładne zero daje pasmo najciemniejsze (0), dokładna jedynka pasmo najjaśniejsze (LIGHT_BANDS.length)', () => {
    expect(lightBand(0)).toBe(0);
    expect(lightBand(1)).toBe(LIGHT_BANDS.length);
  });

  it('4. liczba różnych wartości lightBand na 10 000 próbek równa się liczbie pasm — progowanie NAPRAWDĘ progowuje, nie przepuszcza ciągłości', () => {
    const distinct = new Set<number>();
    const SAMPLES = 10_000;
    for (let i = 0; i < SAMPLES; i++) {
      distinct.add(lightBand(i / (SAMPLES - 1)));
    }
    expect(distinct.size).toBe(LIGHT_BANDS.length + 1);
  });
});

describe('writeCellColors', () => {
  it('5. zapisuje jednolity kolor w całym zakresie KAŻDEJ komórki, dla KAŻDEGO jej wierzchołka (nie jednej komórki i nadziei)', () => {
    const out = new Float32Array(geo.positions.length);
    writeCellColors(geo, light, out, DEFAULT_PALETTE);

    let visited = 0;
    for (const cell of planet.cells) {
      const expected = froundRgb(DEFAULT_PALETTE[lightBand(light[cell.id])]);
      const start = geo.cellVertexStart[cell.id];
      const end = start + geo.cellVertexCount[cell.id];
      for (let v = start; v < end; v++) {
        const o = v * 3;
        expect(out[o]).toBe(expected[0]);
        expect(out[o + 1]).toBe(expected[1]);
        expect(out[o + 2]).toBe(expected[2]);
        visited++;
      }
    }
    // Kontrola pozytywna (wzorzec z `geometry.test.ts` #5): bez tej linii pętla wewnętrzna
    // pusta (np. `cellVertexCount` samo zero, albo badana implementacja licząca zakres
    // [start,start) zamiast [start,end)) przechodziłaby formalnie zielono, bo `expect` w jej
    // wnętrzu nigdy by się nie wykonał — dokładnie wzorzec "test dla gałęzi, która nigdy nie
    // działa" z dziewiątki defektów Fazy 1.
    expect(visited).toBe(geo.positions.length / 3);
  });

  it('6. sąsiadujące komórki po dwóch stronach terminatora dostają różne pasma — z PRAWDZIWEGO lightField i PRAWDZIWEGO sunDirection, nie z liczb wpisanych ręcznie', () => {
    let found: { a: number; b: number } | null = null;
    for (const cell of planet.cells) {
      if (found) break;
      const bandA = lightBand(light[cell.id]);
      for (const n of cell.neighbors) {
        if (lightBand(light[n]) !== bandA) {
          found = { a: cell.id, b: n };
          break;
        }
      }
    }

    // Kontrola pozytywna: taka para MUSI istnieć na prawdziwej planecie z prawdziwym
    // sunDirection — inaczej terminator nie miałby żadnej krawędzi komórka-komórka do
    // narysowania, a reszta tego testu sprawdzałaby `null`.
    expect(found).not.toBeNull();
    const { a, b } = found as { a: number; b: number };
    expect(lightBand(light[a])).not.toBe(lightBand(light[b]));

    const out = new Float32Array(geo.positions.length);
    writeCellColors(geo, light, out, DEFAULT_PALETTE);
    const colorAt = (cellId: number): [number, number, number] => {
      const v = geo.cellVertexStart[cellId];
      return [out[v * 3], out[v * 3 + 1], out[v * 3 + 2]];
    };
    expect(colorAt(a)).not.toEqual(colorAt(b));
  });

  it('7. out o złej długości → RangeError nazywający obie długości (wzorzec z updatePower)', () => {
    const correct = new Float32Array(geo.positions.length);
    // Kontrola pozytywna: rozmiar poprawny NIE rzuca — dowód, że rzut niżej jest
    // spowodowany właśnie złą długością `out`, nie jakimkolwiek innym defektem.
    expect(() => writeCellColors(geo, light, correct, DEFAULT_PALETTE)).not.toThrow();

    const wrong = new Float32Array(geo.positions.length - 3);
    let thrown: unknown;
    try {
      writeCellColors(geo, light, wrong, DEFAULT_PALETTE);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    const message = (thrown as Error).message;
    expect(message).toContain(String(wrong.length));
    expect(message).toContain(String(geo.positions.length));
  });

  it('8. palette o złej liczbie pozycji → RangeError nazywający obie długości', () => {
    const out = new Float32Array(geo.positions.length);
    expect(() => writeCellColors(geo, light, out, DEFAULT_PALETTE)).not.toThrow();

    const wrongPalette: Palette = DEFAULT_PALETTE.slice(0, DEFAULT_PALETTE.length - 1);
    let thrown: unknown;
    try {
      writeCellColors(geo, light, out, wrongPalette);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    const message = (thrown as Error).message;
    expect(message).toContain(String(wrongPalette.length));
    expect(message).toContain(String(LIGHT_BANDS.length + 1));
  });

  it('9. DEFAULT_PALETTE ma dokładnie LIGHT_BANDS.length + 1 pozycji — sprawdzenie SAMEJ STAŁEJ, nie tylko strażnicy w writeCellColors', () => {
    expect(DEFAULT_PALETTE.length).toBe(LIGHT_BANDS.length + 1);
  });

  it('10. [dodatek] light o długości niezgodnej z liczbą komórek geo → RangeError nazywający obie długości', () => {
    // Nie ma tego w enumeracji briefu (Krok 1, punkty 1-7 mówią tylko o `out` i `palette`)
    // — dodane, bo to TA SAMA klasa zagrożenia: `light[i]` poza zakresem daje cicho
    // `undefined`, a `lightBand(undefined)` też cicho wraca `0` (żadne porównanie
    // `undefined >= próg` nie jest prawdziwe) — czyli błędna klasyfikacja "noc" bez żadnego
    // wyjątku, zamiast głośnego błędu. Ten sam wzorzec ryzyka co ciche NaN w `updatePower`
    // (`packages/sim/src/sim/power.ts`): cichy zły wynik gorszy niż crash.
    const out = new Float32Array(geo.positions.length);
    expect(() => writeCellColors(geo, light, out, DEFAULT_PALETTE)).not.toThrow();

    const wrongLight = light.slice(0, light.length - 1);
    let thrown: unknown;
    try {
      writeCellColors(geo, wrongLight, out, DEFAULT_PALETTE);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    const message = (thrown as Error).message;
    expect(message).toContain(String(wrongLight.length));
    expect(message).toContain(String(geo.cellVertexStart.length));
  });

  it('11. [dodatek] dwie komórki w różnych pasmach dostają różne kolory, DOKŁADNIE te z palety pod właściwym indeksem — nie jeden kolor globalny na całą planetę', () => {
    // Test 5 sprawdza jednolitość WEWNĄTRZ komórki na prawdziwej (dużej) geometrii — ale
    // "każda komórka ma jednolity kolor" jest prawdą również w zdegenerowanym przypadku, w
    // którym WSZYSTKIE komórki dostają ten sam, jeden globalny kolor (np. implementacja
    // pomyliła się i zawsze czyta `light[0]`). Ten test używa małej, syntetycznej geometrii
    // — 2 komórki, jeden wierzchołek każda — żeby zamknąć tę lukę wprost: dwie komórki z
    // dwóch różnych pasm muszą dostać dwa różne kolory, każdy dokładnie ten, którego
    // oczekuje jego WŁASNE pasmo.
    const geo2: PlanetGeometry = {
      positions: new Float32Array(2 * 3),
      normals: new Float32Array(2 * 3),
      indices: new Uint32Array(0),
      cellVertexStart: Uint32Array.from([0, 1]),
      cellVertexCount: Uint32Array.from([1, 1]),
    };
    const light2 = Float32Array.from([0, 1]); // pasmo najciemniejsze i najjaśniejsze
    const out2 = new Float32Array(geo2.positions.length);

    writeCellColors(geo2, light2, out2, DEFAULT_PALETTE);

    const colorA: Rgb = [out2[0], out2[1], out2[2]];
    const colorB: Rgb = [out2[3], out2[4], out2[5]];

    expect(colorA).toEqual(froundRgb(DEFAULT_PALETTE[0]));
    expect(colorB).toEqual(froundRgb(DEFAULT_PALETTE[LIGHT_BANDS.length]));
    expect(colorA).not.toEqual(colorB);
  });

  it('12. [dodatek] rozkład komórek między pasmami przy sunDirection(0,180): pasmo nocy śmie przekroczyć połowę (fizyka saturate), ŻADNE inne pasmo — nie', () => {
    const counts = new Array<number>(LIGHT_BANDS.length + 1).fill(0);
    for (const v of light) counts[lightBand(v)]++;

    // Kontrola pozytywna: każda komórka policzona dokładnie raz — suma się zgadza.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(planet.cells.length);

    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(0);
      expect(counts[i]).toBeLessThan(planet.cells.length / 2);
    }

    // Przypięte przy `seed: 20260915`, `frequency` domyślne (12): 753 / 256 / 433. Zmierzone
    // i uzasadnione w komentarzu przy `DEFAULT_PALETTE` w shading.ts — ten test jest
    // kanarkiem: gdyby ktoś (Faza 4) przesunął progi tak, że pasmo dzienne przejęłoby
    // większość komórek, powyższa pętla by to złapała; ten dokładny odcisk łapie DOWOLNĄ
    // zmianę progów, nawet drobną.
    expect(counts).toEqual([753, 256, 433]);
  });

  it('13. [dodatek] LIGHT_BANDS: niepusta, ściśle rosnąca, każdy próg ściśle wewnątrz (0,1)', () => {
    // Bez tego: LIGHT_BANDS = [] jest technicznie zgodne z typem `readonly number[]` i —
    // zmierzone w tabeli mutacji raportu — sprawia, że KAŻDY test powyżej w tym pliku
    // przechodzi (jedno pasmo, brak progu do złapania), mimo że cały sens zadania (granica)
    // by zniknął.
    expect(LIGHT_BANDS.length).toBeGreaterThan(0);
    for (const t of LIGHT_BANDS) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    }
    for (let i = 1; i < LIGHT_BANDS.length; i++) {
      expect(LIGHT_BANDS[i]).toBeGreaterThan(LIGHT_BANDS[i - 1]);
    }
  });
});
