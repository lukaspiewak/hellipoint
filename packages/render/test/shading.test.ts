import { describe, expect, it } from 'vitest';
import { createPlanet, sunDirection, lightField } from '@heliopolis/sim';
import { buildPlanetGeometry, type PlanetGeometry } from '../src/geometry.js';
import { BufferAttribute } from 'three';
import { buildCellOutlines, createPlanetMesh } from '../src/planetMesh.js';
import {
  DEFAULT_OUTLINE_PALETTE,
  DEFAULT_PALETTE,
  LIGHT_BANDS,
  lightBand,
  writeCellColors,
  writeCellColorsSmooth,
  type Palette,
  type Rgb,
} from '../src/shading.js';
import { findTerminatorPairs, selectSpread } from '../src/terminatorPairs.js';

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
      // Porównanie w `lightBand` jest ŚCISŁE (`light > próg`), więc skok leży TUŻ NAD progiem,
      // nie NA nim — patrz uzasadnienie przy `lightBand` w `shading.ts`. Dla progu zerowego
      // to jest cała istota zmiany Fazy 2B: `lightBand(0) === 0` znaczy „noc to dokładnie
      // `light === 0`", czyli dokładnie to, co dla symulacji.
      const justAbove = t + 1e-6;

      // Kontrola pozytywna na sam test: dowód, że para faktycznie różni się o mniej niż
      // 0,01 (i że różnica jest dodatnia, nie przypadkiem zerowa) — inaczej poniższe dwa
      // `expect` mogłyby sprawdzać coś dalekiego od progu, nie "nieciągłość NA progu".
      expect(justAbove - t).toBeLessThan(0.01);
      expect(justAbove - t).toBeGreaterThan(0);

      expect(lightBand(t)).toBe(i);
      expect(lightBand(justAbove)).toBe(i + 1);
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
    let sampledBands = 0;
    for (let band = 0; band < edges.length - 1; band++) {
      const lo = edges[band];
      const hi = edges[band + 1];
      // Pasmo 0 jest po obniżeniu pierwszego progu do zera JEDNOPUNKTOWE (`light === 0`), więc
      // nie da się z niego wziąć trzech różnych wejść. Sprawdzane jest osobno, niżej.
      if (!(hi > lo)) continue;
      const quarter = lo + (hi - lo) / 4;
      const mid = lo + (hi - lo) / 2;
      const threeQuarters = lo + (3 * (hi - lo)) / 4;

      // Kontrola pozytywna: trzy wejścia RÓŻNE między sobą — gdyby `lightBand` było
      // identycznością, poniższe trzy `toBe(band)` nie mogłyby przejść (band to mała liczba
      // całkowita 0/1/2…, a quarter/mid/threeQuarters to różne ułamki). Dokładnie o to pytał
      // brief Fazy 2A: "czy jakikolwiek test przeszedłby, gdyby lightBand po prostu zwracało
      // light bez zmian?" — ten ma nie przejść.
      expect(quarter).not.toBe(mid);
      expect(mid).not.toBe(threeQuarters);

      expect(lightBand(quarter)).toBe(band);
      expect(lightBand(mid)).toBe(band);
      expect(lightBand(threeQuarters)).toBe(band);
      sampledBands++;
    }
    // Kontrola pozytywna na sam test: pętla faktycznie coś sprawdziła. Bez tego zdegenerowana
    // tablica progów (np. same zera) dałaby zero iteracji i zielony test o niczym. Liczba jest
    // zarazem kotwicą na „pierwszy próg wynosi zero": pasm o DODATNIEJ szerokości jest tyle,
    // ile progów, dokładnie wtedy, gdy pasmo 0 jest jednopunktowe.
    expect(sampledBands).toBe(LIGHT_BANDS.length);

    // Pasmo 0 — jednopunktowe, i to jest jego cała treść: TYLKO dokładne zero.
    expect(lightBand(0)).toBe(0);
    expect(lightBand(Number.MIN_VALUE)).toBe(1);
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

    // Przypięte przy `seed: 20260915`, `frequency` domyślne (12): 745 / 264 / 433 — zmierzone
    // PO obniżeniu `LIGHT_BANDS[0]` do zera (Faza 2B, Zadanie 1, Krok 3; wcześniej było
    // 753 / 256 / 433). Osiem komórek przeszło z nocy do zmierzchu: dokładnie te, które w tej
    // fazie wpadały w szczelinę `0 < light < 0,05`. Ten test jest kanarkiem: łapie DOWOLNĄ
    // zmianę progów, nawet drobną.
    expect(counts).toEqual([745, 264, 433]);
  });

  it('13. [dodatek] LIGHT_BANDS: niepusta, ściśle rosnąca, progi w [0,1); pierwszy DOKŁADNIE zero', () => {
    // Bez tego: LIGHT_BANDS = [] jest technicznie zgodne z typem `readonly number[]` i —
    // zmierzone w tabeli mutacji raportu Fazy 2A — sprawia, że KAŻDY test powyżej w tym pliku
    // przechodzi (jedno pasmo, brak progu do złapania), mimo że cały sens zadania (granica)
    // by zniknął.
    expect(LIGHT_BANDS.length).toBeGreaterThan(0);
    for (const t of LIGHT_BANDS) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
    for (let i = 1; i < LIGHT_BANDS.length; i++) {
      expect(LIGHT_BANDS[i]).toBeGreaterThan(LIGHT_BANDS[i - 1]);
    }
    // Pierwszy próg jest DECYZJĄ, nie strojeniem (patrz `shading.ts`): tylko przy zerze pasmo
    // nocy znaczy to samo, co noc symulacji. Test #18 mierzy skutek; ten pilnuje przyczyny,
    // żeby podniesienie progu oblało GŁOŚNO i w miejscu, gdzie zapisana jest decyzja.
    expect(LIGHT_BANDS[0]).toBe(0);
  });
});

describe('writeCellColorsSmooth — tryb gładki na PRAWDZIWYCH parach terminatora (Zadanie 5)', () => {
  it('14. na PRAWDZIWYCH parach terminatora tryb gładki daje różnicę WYRAŹNIE niezerową, zawsze w tę samą stronę — i dlatego NIE jest kontrolą', () => {
    // Ten test był wcześniej napisany na fixture SYNTETYCZNEJ `light = [0.499, 0.501]` z
    // komentarzem, że to miejsce "NAJWIĘKSZEGO skoku (pasmo 0 -> 1)" progowania. Zmierzone —
    // obie te liczby leżą w paśmie 2 (progi to [0,05, 0,4]), więc `writeCellColors` daje tam
    // odległość barwną DOKŁADNIE 0,0000, a nie największy skok; największy skok (pasmo 0->1)
    // wynosi 0,9005 i występuje gdzie indziej. `dot == 0` znaczy `light == 0`, nie 0,5.
    // Asercja `|Δ| < 0,01` była przy tym spełniona Z KONSTRUKCJI: interpolacja liniowa ×
    // odstęp wejścia 0,002 × rozpiętość palety ≤ 0,95 daje najwyżej 0,0019.
    //
    // Przepisane na PRAWDZIWE `lightField` i PRAWDZIWE pary sąsiadów przez terminator — te
    // same, które bramka pokazuje człowiekowi. Liczby są takie, jakie wyszły; stara asercja
    // na tych danych OBLEWA.
    //
    // To jest zarazem zapis ustalenia z §7.3.1 specu: `writeCellColorsSmooth` zmienia
    // MAPOWANIE palety, nie INTERPOLACJĘ — nadal maluje każdą komórkę jednym płaskim
    // kolorem, bo geometria Zadania 2 daje każdej własne wierzchołki. Tryb awarii Fazy 0
    // (kolor interpolowany PO POWIERZCHNI, między współdzielonymi wierzchołkami) jest przez
    // tę architekturę nieodtwarzalny z konstrukcji. Dlatego ta funkcja NIE jest kontrolą
    // pozytywną bramki — i ten test mierzy dokładnie to, dlaczego nie jest.
    const smooth = new Float32Array(geo.positions.length);
    const thresholded = new Float32Array(geo.positions.length);
    writeCellColorsSmooth(geo, light, smooth, DEFAULT_PALETTE);
    writeCellColors(geo, light, thresholded, DEFAULT_PALETTE);

    const colorOf = (buf: Float32Array, cellId: number): Rgb => {
      const o = geo.cellVertexStart[cellId] * 3;
      return [buf[o], buf[o + 1], buf[o + 2]];
    };
    const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // Luminancja wg współczynników sRGB — "która komórka wygląda jaśniej", nie "która ma
    // większą sumę składowych": przy dwóch różnych odcieniach (granat vs ciepła biel) suma
    // składowych i wrażenie jasności mogą się rozjechać.
    const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

    // Pary z `findTerminatorPairs` — DOKŁADNIE te, których używa harness bramki, a nie
    // osobno wymyślone na potrzeby tego testu.
    const pairs = selectSpread(findTerminatorPairs(planet.cells, light), 5);
    expect(pairs.length).toBe(5); // kontrola pozytywna: pętla niżej ma na czym pracować

    let checked = 0;
    let minPerChannel = Number.POSITIVE_INFINITY;
    let maxPerChannel = 0;
    let minRatio = Number.POSITIVE_INFINITY;

    for (const pair of pairs) {
      const litSmooth = colorOf(smooth, pair.litCellId);
      const darkSmooth = colorOf(smooth, pair.darkCellId);
      const litThresh = colorOf(thresholded, pair.litCellId);
      const darkThresh = colorOf(thresholded, pair.darkCellId);

      // (1) W trybie gładkim różnica jest NIEZEROWA i zawsze w tę samą stronę: komórka,
      //     którą symulacja oświetla, jest jaśniejsza. To jest cała przyczyna, dla której
      //     ten tryb nie potrafi wyprodukować odpowiedzi "nie widzę" przy wymuszonym
      //     wyborze dwóch alternatyw — wystarczy wskazać jaśniejszą.
      expect(luminance(litSmooth), `para (${pair.litCellId}, ${pair.darkCellId})`).toBeGreaterThan(
        luminance(darkSmooth),
      );

      // (2) Rozmiar różnicy — zmierzony, nie założony. Na tych parach różnica na kanał
      //     mieści się w 0,030..0,081, czyli KILKAKROTNIE POWYŻEJ progu 0,01, którego
      //     wymagała poprzednia wersja tego testu na fixture syntetycznej (tam wychodziło
      //     0,0012..0,0019 — i wychodziło tak z konstrukcji, nie z własności funkcji).
      for (let i = 0; i < 3; i++) {
        const d = Math.abs(litSmooth[i] - darkSmooth[i]);
        minPerChannel = Math.min(minPerChannel, d);
        maxPerChannel = Math.max(maxPerChannel, d);
      }

      // (3) Progowanie na TEJ SAMEJ parze daje pełny skok palety — zawsze ten sam, bo to
      //     skok między dwoma stałymi kolorami, niezależny od tego, jak blisko progu leży
      //     konkretna komórka. Progowanie więc kontrast PODBIJA; nie ono go TWORZY.
      const smoothDistance = distance(litSmooth, darkSmooth);
      const thresholdDistance = distance(litThresh, darkThresh);
      expect(thresholdDistance).toBeCloseTo(
        distance(froundRgb(DEFAULT_PALETTE[0]), froundRgb(DEFAULT_PALETTE[1])),
        5,
      );
      minRatio = Math.min(minRatio, thresholdDistance / smoothDistance);
      checked++;
    }

    expect(checked).toBe(pairs.length); // pętla przeszła wszystkie pary, nie zero
    // Przypięte zakresy — szerokie na tyle, żeby nie łamały się na zmianie palety o włos,
    // wąskie na tyle, żeby złapać powrót do fixture, która "spełnia asercję z konstrukcji".
    expect(minPerChannel).toBeGreaterThan(0.02);
    expect(maxPerChannel).toBeLessThan(0.15);
    expect(minRatio).toBeGreaterThan(5); // zmierzone: 7,4..12,7 razy
  });

  it('15. light=0 daje DOKŁADNIE palette[0], light=1 daje DOKŁADNIE palette[ostatni] — końce gradientu są końcami palety', () => {
    const geo2: PlanetGeometry = {
      positions: new Float32Array(2 * 3),
      normals: new Float32Array(2 * 3),
      indices: new Uint32Array(0),
      cellVertexStart: Uint32Array.from([0, 1]),
      cellVertexCount: Uint32Array.from([1, 1]),
    };
    const light2 = Float32Array.from([0, 1]);
    const out2 = new Float32Array(geo2.positions.length);

    writeCellColorsSmooth(geo2, light2, out2, DEFAULT_PALETTE);

    expect([out2[0], out2[1], out2[2]]).toEqual(froundRgb(DEFAULT_PALETTE[0]));
    expect([out2[3], out2[4], out2[5]]).toEqual(froundRgb(DEFAULT_PALETTE[DEFAULT_PALETTE.length - 1]));
  });

  it('16. light=0,5 daje DOKŁADNIE punkt środkowy między palette[0] a palette[ostatni] (dowód interpolacji LINIOWEJ, nie np. progowej w przebraniu)', () => {
    const geo2: PlanetGeometry = {
      positions: new Float32Array(1 * 3),
      normals: new Float32Array(1 * 3),
      indices: new Uint32Array(0),
      cellVertexStart: Uint32Array.from([0]),
      cellVertexCount: Uint32Array.from([1]),
    };
    const out2 = new Float32Array(3);
    writeCellColorsSmooth(geo2, Float32Array.from([0.5]), out2, DEFAULT_PALETTE);

    const night = DEFAULT_PALETTE[0];
    const day = DEFAULT_PALETTE[DEFAULT_PALETTE.length - 1];
    const expectedMid: Rgb = [(night[0] + day[0]) / 2, (night[1] + day[1]) / 2, (night[2] + day[2]) / 2];
    for (let i = 0; i < 3; i++) {
      expect(out2[i]).toBeCloseTo(expectedMid[i], 5);
    }
  });


  it('17. rzuca RangeError dla out/light o złej długości — ten sam wzorzec strażników co writeCellColors', () => {
    const out = new Float32Array(geo.positions.length);
    expect(() => writeCellColorsSmooth(geo, light, out, DEFAULT_PALETTE)).not.toThrow();

    expect(() => writeCellColorsSmooth(geo, light, new Float32Array(geo.positions.length - 3), DEFAULT_PALETTE)).toThrow(
      RangeError,
    );
    expect(() => writeCellColorsSmooth(geo, light.slice(0, light.length - 1), out, DEFAULT_PALETTE)).toThrow(
      RangeError,
    );
    expect(() => writeCellColorsSmooth(geo, light, out, [])).toThrow(RangeError);
    expect(() => writeCellColorsSmooth(geo, light, out, [DEFAULT_PALETTE[0]])).toThrow(RangeError);
  });
});

describe('granica renderu kontra granica symulacji (Faza 2B, Zadanie 1, Krok 3)', () => {
  it('18. [KROK 3 FAZY 2B] pasmo 0 renderu pokrywa się DOKŁADNIE z nocą symulacji — zero rozjazdu na 1442 komórkach × 12 fazach obrotu', () => {
    // Powód istnienia tego testu, zmierzony w Fazie 2A: przy `LIGHT_BANDS[0] = 0,05` granica
    // renderowana i granica symulowana rozjeżdżały się o 8 do 38 komórek w każdej fazie
    // (średnio 30,8), zawsze o dokładnie jeden krok grafu. Spawn i spalanie są BINARNE, więc
    // istniał jednokomórkowy pierścień, w którym gracz widzi noc, a jednostki się palą i
    // pentagony nie spawnują. Przy progu zerowym obie granice pokrywają się z KONSTRUKCJI.
    //
    // Predykat symulacji jest tu wpisany DOSŁOWNIE (`light > 0` — ten sam, co w `spawning.ts`,
    // `burning.ts` i `movement.ts`), nie wyprowadzony z `LIGHT_BANDS`. Gdyby oba brzegi
    // porównania pochodziły ze stałej, którą test sprawdza, asercja poruszałaby się razem z nią
    // i nie mogłaby oblać — kształt defektu, który ta gałąź już popełniła.
    const PHASES = 12;
    let totalDisagreements = 0;
    let checkedCells = 0;
    let litSomewhere = 0;
    let darkSomewhere = 0;
    for (let k = 0; k < PHASES; k++) {
      const phaseLight = lightField(planet, sunDirection((k / PHASES) * 180, 180));
      let disagreements = 0;
      for (let i = 0; i < phaseLight.length; i++) {
        const simulationSaysLit = phaseLight[i] > 0;
        const renderSaysLit = lightBand(phaseLight[i]) >= 1;
        if (simulationSaysLit !== renderSaysLit) disagreements++;
        if (simulationSaysLit) litSomewhere++;
        else darkSomewhere++;
        checkedCells++;
      }
      expect(disagreements, `faza ${k}/${PHASES}`).toBe(0);
      totalDisagreements += disagreements;
    }
    expect(checkedCells).toBe(planet.cells.length * PHASES);
    expect(totalDisagreements).toBe(0);

    // KONTROLA POZYTYWNA na sam pomiar. „Zero rozjazdu" nic nie znaczy, jeśli obie strony
    // porównania są zawsze takie same z byle powodu (np. wszystkie komórki oświetlone, albo
    // `lightBand` zdegenerowane do stałej). Dwa dowody, że przyrząd widzi obie odpowiedzi:
    expect(litSomewhere).toBeGreaterThan(0);
    expect(darkSomewhere).toBeGreaterThan(0);
    // …i że TEN SAM licznik daje NIEZEROWY odczyt dla progu, który faktycznie rozjeżdża
    // granice — czyli dla progu sprzed tej zmiany.
    const bandWithOldThreshold = (l: number): number => (l >= 0.05 ? 1 : 0);
    let oldDisagreements = 0;
    const referenceLight = lightField(planet, sunDirection(0, 180));
    for (let i = 0; i < referenceLight.length; i++) {
      if (referenceLight[i] > 0 !== bandWithOldThreshold(referenceLight[i]) >= 1) oldDisagreements++;
    }
    expect(oldDisagreements).toBe(8); // zmierzone w Fazie 2A dla sunDirection(0, 180)
  });
});

describe('krata komórek a terminator (Faza 2B, Zadanie 2)', () => {
  /**
   * Kodowanie liniowe → sRGB (ta sama krzywa, którą stosuje Three.js na wyjściu — zmierzone
   * na pikselach płótna, patrz komentarz przy `Rgb` w `shading.ts`). Potrzebne, bo „jak
   * bardzo te dwa kolory różnią się DLA OKA" nie jest odległością w przestrzeni liniowej:
   * ta sama różnica liniowa 0,1 jest wielkim skokiem przy 0,03 i ledwie widoczna przy 0,9.
   */
  const encodeSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const toSrgb = (c: Rgb): Rgb => [encodeSrgb(c[0]), encodeSrgb(c[1]), encodeSrgb(c[2])];
  const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('19. DEFAULT_OUTLINE_PALETTE ma dokładnie LIGHT_BANDS.length + 1 pozycji — ta sama kotwica na SAMĄ STAŁĄ co test 9 dla palety wypełnień', () => {
    expect(DEFAULT_OUTLINE_PALETTE.length).toBe(LIGHT_BANDS.length + 1);
  });

  it('20. [KLUCZOWY] odległość barw przez terminator wynosi DOKŁADNIE 0,9005 na KAŻDEJ prawdziwej parze sąsiadów, w 12 fazach obrotu — wartość BEZWZGLĘDNA, nie „różnią się"', () => {
    // To jest test, który pilnuje CAŁEGO zadania. Krata komórek weszła jako osobna geometria
    // linii właśnie dlatego, że wypełnienia komórek zostają wtedy co do bitu takie, jakie
    // były — a więc ta liczba też. Wariant „subtelne zróżnicowanie w obrębie pasma" musiałby
    // ją OBNIŻYĆ z definicji: gdyby odcienie pasma jaśniejszego schodziły choć trochę w dół,
    // najciemniejszy z nich stykałby się z pasmem ciemniejszym słabszym skokiem niż 0,9005.
    //
    // Asercja jest na WARTOŚĆ BEZWZGLĘDNĄ, zmierzoną przed zmianą (0,9005), a nie na
    // „odległość obu kolorów palety" — bo ta druga poruszałaby się razem z paletą i nie
    // mogłaby oblać dla palety, która zaciera granicę. To ten sam kształt defektu, który ta
    // faza ma już na koncie trzykrotnie.
    const PHASES = 12;
    const out = new Float32Array(geo.positions.length);
    const colorAt = (cellId: number): Rgb => {
      const o = geo.cellVertexStart[cellId] * 3;
      return [out[o], out[o + 1], out[o + 2]];
    };

    let d1Pairs = 0;
    let d1Min = Number.POSITIVE_INFINITY;
    let d1Max = 0;
    let innerPairs = 0;
    let innerMin = Number.POSITIVE_INFINITY;
    let innerMax = 0;

    for (let k = 0; k < PHASES; k++) {
      const phaseLight = lightField(planet, sunDirection((k / PHASES) * 180, 180));
      writeCellColors(geo, phaseLight, out, DEFAULT_PALETTE);
      for (const cell of planet.cells) {
        const bandA = lightBand(phaseLight[cell.id]);
        for (const n of cell.neighbors) {
          if (n <= cell.id) continue; // każda para raz
          const bandB = lightBand(phaseLight[n]);
          if (bandA === bandB) continue;
          const d = distance(colorAt(cell.id), colorAt(n));
          if (Math.min(bandA, bandB) === 0) {
            d1Pairs++;
            d1Min = Math.min(d1Min, d);
            d1Max = Math.max(d1Max, d);
          } else {
            innerPairs++;
            innerMin = Math.min(innerMin, d);
            innerMax = Math.max(innerMax, d);
          }
        }
      }
    }

    // KONTROLA POZYTYWNA: pętla miała na czym pracować, i to po OBU rodzajach granicy.
    // Bez tego `Infinity`/`0` przeszłoby przez asercje niżej, gdyby żadna para się nie
    // znalazła (np. `lightBand` zdegenerowane do stałej — wtedy granic nie ma wcale).
    expect(d1Pairs).toBe(1636); // zmierzone: 12 faz × prawdziwe sąsiedztwa
    expect(innerPairs).toBe(1508);

    // WŁASNOŚĆ. Granica D1 (noc ↔ oświetlone) — ta, na której stoi spawn, spalanie i cała
    // ekonomia dnia i nocy. Jedna wartość, bo progowanie daje skok między dwoma STAŁYMI
    // kolorami, niezależnie od tego, jak blisko progu leży konkretna komórka.
    expect(d1Min).toBeCloseTo(0.9005, 4);
    expect(d1Max).toBeCloseTo(0.9005, 4);
    // Granica wewnętrzna strony oświetlonej (zmierzch ↔ dzień) — słabsza, i to jest znane.
    expect(innerMin).toBeCloseTo(0.7767, 4);
    expect(innerMax).toBeCloseTo(0.7767, 4);
  });

  it('21. [KLUCZOWY] obrys jest WIDOCZNY na swoim paśmie, ale WYRAŹNIE słabszy niż skok przez terminator — i najbliżej barwy WŁASNEGO pasma', () => {
    // Trzy własności palety obrysów, wszystkie na wartościach BEZWZGLĘDNYCH, wszystkie
    // mierzone w sRGB — bo to jest przestrzeń, w której liczby odpowiadają temu, co widzi
    // oko (patrz `encodeSrgb` wyżej i komentarz przy `Rgb` w `shading.ts`).
    const fill = DEFAULT_PALETTE.map(toSrgb);
    const outline = DEFAULT_OUTLINE_PALETTE.map(toSrgb);
    const terminatorStep = distance(fill[0], fill[1]);

    // Kontrola pozytywna na sam pomiar: skok przez terminator W TEJ SAMEJ przestrzeni i tym
    // samym przyrządem, którym mierzone są kroki obrysu. Bez tego progi niżej byłyby trzema
    // liczbami bez skali.
    expect(terminatorStep).toBeCloseTo(0.8598, 4);

    // Skok OBRYS↔OBRYS przez granicę pasm — liczba, którą uzasadniony jest `OUTLINE_INSET`
    // (patrz `planetMesh.ts`) i która trafiła do specu fazy, a do rundy naprawczej 1 nie była
    // przypięta niczym (i była tam zapisana błędnie jako 0,5546). To jest kontrast, jaki
    // miałby terminator, gdyby obrysy leżały NA wspólnej krawędzi i ją przykrywały — czyli
    // jedyne uzasadnienie liczbowe wciągnięcia. Wartości bezwzględne, w obu przestrzeniach.
    const outlineStepAcross = distance(DEFAULT_OUTLINE_PALETTE[0], DEFAULT_OUTLINE_PALETTE[1]);
    const fillStepAcross = distance(DEFAULT_PALETTE[0], DEFAULT_PALETTE[1]);
    expect(fillStepAcross).toBeCloseTo(0.9005, 4); // kontrola: odniesienie to TA SAMA liczba, co w teście 20
    expect(outlineStepAcross).toBeCloseTo(0.5918, 4);
    expect(outlineStepAcross / fillStepAcross).toBeCloseTo(0.657, 3);
    expect(distance(outline[0], outline[1])).toBeCloseTo(0.5632, 4); // ta sama rzecz w sRGB

    // Marginesy „obrys jest bliżej WŁASNEGO pasma niż najbliższego obcego", zmierzone i
    // wpisane wprost (runda naprawcza 1 — komentarz przy `DEFAULT_OUTLINE_PALETTE` je podawał,
    // ale żadna asercja ich nie trzymała; asercja (3) niżej wynika w większości par z
    // nierówności trójkąta i asercji (2), więc sama ich nie zastępuje).
    const EXPECTED_MARGINS = [3.03, 3.52, 1.67]; // zmierzone: 3,0268 / 3,5248 / 1,6709

    let checked = 0;
    for (let band = 0; band < DEFAULT_PALETTE.length; band++) {
      const step = distance(outline[band], fill[band]);
      const label = `pasmo ${band}`;

      // (1) Krata jest WIDOCZNA: linia, która nie odróżnia się od swojego wypełnienia, nie
      //     jest kratą. Zmierzone: 0,226 / 0,200 / 0,214.
      expect(step, label).toBeGreaterThan(0.12);

      // (2) Krata NIE KONKURUJE z terminatorem. Gdyby obrysy były równie kontrastowe co
      //     granica dnia i nocy, tarcza z daleka zamieniłaby się w siatkę, w której granica
      //     jest jedną z tysięcy linii — czyli dokładnie to, przed czym ostrzega brief.
      //     Próg 0,2866 to jedna trzecia zmierzonego skoku terminatora, wpisana jako liczba,
      //     żeby nie poruszał się razem z paletą.
      expect(step, label).toBeLessThan(0.2866);

      // (3) Obrys jest NAJBLIŻEJ wypełnienia WŁASNEGO pasma. Obrys dryfujący w stronę barwy
      //     pasma sąsiedniego czytałby się jak wąski pasek TAMTEGO pasma — czyli rysowałby
      //     nieistniejącą granicę wewnątrz jednolitego obszaru.
      let nearestOther = Number.POSITIVE_INFINITY;
      for (let other = 0; other < fill.length; other++) {
        if (other === band) continue;
        const toOther = distance(outline[band], fill[other]);
        expect(toOther, `${label} kontra wypełnienie ${other}`).toBeGreaterThan(step);
        nearestOther = Math.min(nearestOther, toOther);
      }
      // (4) Margines przypięty LICZBĄ, nie tylko nierównością: o ile dalej obrysowi do
      //     najbliższego obcego wypełnienia niż do własnego. Najciaśniejszy ma dzień (1,67×),
      //     bo to jego sąsiedztwo z pasmem zmierzchu jest w tej palecie najsłabsze.
      expect(nearestOther / step, `${label} margines`).toBeGreaterThan(EXPECTED_MARGINS[band] - 0.02);
      expect(nearestOther / step, `${label} margines`).toBeLessThan(EXPECTED_MARGINS[band] + 0.02);
      checked++;
    }
    expect(checked).toBe(DEFAULT_PALETTE.length); // pętla przeszła wszystkie pasma, nie zero

  });

  it('23. [PRZYPIĘCIE] kontrasty WCAG palety — czyli SAMA LUMINANCJA, bez odcienia — to 5,38 / 1,79 / 9,62, i wychodzą tak tylko przy potraktowaniu jej wartości jako LINIOWYCH', () => {
    // Dwa powody istnienia tego testu, oba z przeglądu rundy naprawczej 1:
    //
    // (1) Te trzy liczby siedzą w `global-constraints.md` jako podstawa doboru barw budynków
    //     (Zadanie 3) i jednostek (Zadanie 4) — a NIC ich nie pilnowało. Zmiana palety
    //     przesunęłaby je bez jednego czerwonego testu. Komentarz przy `Rgb` w `shading.ts`
    //     odsyłał do testu 21, który liczy odległość euklidesową w sRGB, a nie kontrast WCAG.
    //
    // (2) Sam FAKT, że paleta jest liniowa, jest ustaleniem empirycznym (odczyt `gl.readPixels`
    //     z żywego płótna) i już raz kosztował błąd: brief fazy podawał 5,6 / 2,90 / 16,2,
    //     bo liczył kontrast, traktując te same trójki jako sRGB. Test liczy OBIEMA drogami i
    //     przypina obie, więc następna osoba zobaczy, która jest która, zamiast wybierać.
    //
    // CZEGO TEN TEST NIE ZŁAPIE, i to nie jest jego wada (runda naprawcza 2). Kontrast WCAG
    // Z DEFINICJI zależy wyłącznie od luminancji, więc obrót ODCIENIA zachowujący luminancję
    // (np. zamiana pasma zmierzchu z ciepłego pomarańczu na zimny błękit o tej samej jasności)
    // zostawia wszystkie sześć liczb niżej bez zmian. Ten test przypina JASNOŚCI palety i
    // przestrzeń barw, i tyle. Przed zmianą palety zachowującą luminancję bronią testy
    // **19/20/21**, które mierzą odległość EUKLIDESOWĄ (a więc widzą odcień): 20 przypina skok
    // przez terminator na 0,9005, 21 kroki obrysów i marginesy, 19 długość palety obrysów.
    // ŻADEN z nich sam nie wystarcza: 20 i 21 są ślepe na przesunięcie zachowujące odległości,
    // a ten — na przesunięcie zachowujące luminancję. Zmiana palety musi przejść przez oba
    // sita naraz.
    const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const contrast = (a: Rgb, b: Rgb): number => {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    // Odwrotność `encodeSrgb` z testu 21: gdyby paleta BYŁA zapisana w sRGB, kontrast WCAG
    // liczyłoby się dopiero po jej zdekodowaniu do przestrzeni liniowej.
    const decodeSrgb = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const asIfSrgb = (c: Rgb): Rgb => [decodeSrgb(c[0]), decodeSrgb(c[1]), decodeSrgb(c[2])];

    const [night, dawn, day] = DEFAULT_PALETTE;

    // WŁASNOŚĆ. Wartości bezwzględne, zmierzone; paleta jest LINIOWA, więc idą do wzoru wprost.
    expect(contrast(night, dawn)).toBeCloseTo(5.38, 2);
    expect(contrast(dawn, day)).toBeCloseTo(1.79, 2);
    expect(contrast(night, day)).toBeCloseTo(9.62, 2);

    // Granica D1 — jedyna, która niesie spawn, spalanie i ekonomię dnia i nocy — przechodzi
    // próg 3:1 z zapasem. Granica wewnętrzna (zmierzch↔dzień) go NIE przechodzi i to jest
    // znane: stąd wniosek Zadania 2, że zróżnicowanie odcieni po stronie oświetlonej jest
    // znacznie bardziej ryzykowne niż przy nocy.
    expect(contrast(night, dawn)).toBeGreaterThan(3);
    expect(contrast(dawn, day)).toBeLessThan(3);

    // FAKT O PRZESTRZENI BARW. Ta sama paleta potraktowana jako sRGB daje ISTOTNIE INNE
    // liczby — dokładnie te, które podał brief fazy. Gdyby obie drogi dawały to samo, test
    // powyżej nie mówiłby nic o przestrzeni i można by go spełnić przypadkiem.
    expect(contrast(asIfSrgb(night), asIfSrgb(dawn))).toBeCloseTo(5.6, 1);
    expect(contrast(asIfSrgb(dawn), asIfSrgb(day))).toBeCloseTo(2.9, 1);
    expect(contrast(asIfSrgb(night), asIfSrgb(day))).toBeCloseTo(16.24, 2);
    // Kontrola pozytywna na sam rozdział: najsłabszy bok palety wychodzi w złej interpretacji
    // o ponad 60% LEPIEJ, niż jest naprawdę — czyli pomyłka przestrzeni nie jest kosmetyczna.
    expect(contrast(asIfSrgb(dawn), asIfSrgb(day)) / contrast(dawn, day)).toBeGreaterThan(1.6);
  });

  it('22. obrys KAŻDEJ komórki niesie DOKŁADNIE to pasmo, co jej wypełnienie — przez PlanetMesh.updateColors, 1442 komórki × 12 faz', () => {
    // Mierzone przez `PlanetMesh.updateColors`, a NIE przez dwa własne wywołania
    // `writeCellColors` — bo dwa wywołania tej samej czystej funkcji z tym samym `light`
    // zgadzają się z definicji i taki test sprawdzałby własność swojego WEJŚCIA, nie kodu.
    // Ryzyko jest w OKABLOWANIU: to `createPlanetMesh` decyduje, czy oba bufory dostają to
    // samo `light` w tej samej klatce. Kolejne fazy przelatują tu przez JEDNĄ siatkę, więc
    // pominięcie odświeżenia obrysu (krata sprzed klatki, przy odwróconym już słońcu) oblewa.
    const planetMesh = createPlanetMesh(geo);
    const outlines = buildCellOutlines(geo);
    const fillAttr = planetMesh.mesh.geometry.getAttribute('color') as BufferAttribute;
    const outlineAttr = planetMesh.outline.geometry.getAttribute('color') as BufferAttribute;

    const indexOf = (palette: Palette, c: Rgb): number =>
      palette.findIndex((p) => {
        const q = froundRgb(p);
        return q[0] === c[0] && q[1] === c[1] && q[2] === c[2];
      });

    const PHASES = 12;
    let checked = 0;
    const bandsSeen = new Set<number>();
    for (let k = 0; k < PHASES; k++) {
      planetMesh.updateColors(lightField(planet, sunDirection((k / PHASES) * 180, 180)));
      const fillArr = fillAttr.array as Float32Array;
      const outlineArr = outlineAttr.array as Float32Array;
      for (let i = 0; i < planet.cells.length; i++) {
        const f = geo.cellVertexStart[i] * 3;
        const o = outlines.cellVertexStart[i] * 3;
        const fillBand = indexOf(DEFAULT_PALETTE, [fillArr[f], fillArr[f + 1], fillArr[f + 2]]);
        const outlineBand = indexOf(DEFAULT_OUTLINE_PALETTE, [outlineArr[o], outlineArr[o + 1], outlineArr[o + 2]]);
        // Kontrola: oba kolory MUSZĄ pochodzić ze swojej palety. `-1` znaczyłoby, że któryś
        // bufor niesie kolor spoza palety (np. został niezapisany, czyli same zera) — i bez
        // tej pary asercji `-1 === -1` przeszłoby jako „zgodne pasma".
        expect(fillBand, `komórka ${i}, faza ${k}`).toBeGreaterThanOrEqual(0);
        expect(outlineBand, `komórka ${i}, faza ${k}`).toBeGreaterThanOrEqual(0);
        expect(outlineBand, `komórka ${i}, faza ${k}`).toBe(fillBand);
        bandsSeen.add(fillBand);
        checked++;
      }
    }
    expect(checked).toBe(planet.cells.length * PHASES);
    // KONTROLA POZYTYWNA: przyrząd widział WSZYSTKIE pasma, nie jedno powtórzone 17 tysięcy
    // razy — „zawsze zgodne" nic nie znaczy, gdy porównuje się dwa razy to samo pasmo 0.
    expect(bandsSeen.size).toBe(DEFAULT_PALETTE.length);
    planetMesh.dispose();
  });
});
