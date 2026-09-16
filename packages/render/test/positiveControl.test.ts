import { describe, expect, it } from 'vitest';
import { createPlanet, lightField, sunDirection } from '@heliopolis/sim';
import { buildSmearedGeometry, writeSmearedColors } from '../src/positiveControl.js';
import { buildPlanetGeometry } from '../src/geometry.js';
import { DEFAULT_PALETTE, writeCellColors } from '../src/shading.js';

const planet = createPlanet({ seed: 20260915 });
const smeared = buildSmearedGeometry(planet);
const flat = buildPlanetGeometry(planet);
const sun = sunDirection(0, 180);
const light = lightField(planet, sun);
/** Trzy fazy, dokładnie te, o które pyta bramka (`apps/client/src/gate.ts`). */
const gateSunDirs = [0, 1 / 3, 2 / 3].map((f) => sunDirection(f * 180, 180));

const TRIANGLE_COUNT = smeared.indices.length / 3;

function triangleAt(i: number): [number, number, number] {
  return [smeared.indices[i * 3], smeared.indices[i * 3 + 1], smeared.indices[i * 3 + 2]];
}

describe('buildSmearedGeometry — geometria kontroli pozytywnej', () => {
  it('1. DOKŁADNIE jeden wierzchołek na komórkę, w jej środku, z jej normalną', () => {
    expect(smeared.vertexCount).toBe(planet.cells.length);
    expect(smeared.positions.length).toBe(planet.cells.length * 3);
    let checked = 0;
    for (const cell of planet.cells) {
      const o = cell.id * 3;
      expect(smeared.positions[o]).toBeCloseTo(cell.center.x, 4);
      expect(smeared.positions[o + 1]).toBeCloseTo(cell.center.y, 4);
      expect(smeared.positions[o + 2]).toBeCloseTo(cell.center.z, 4);
      expect(smeared.normals[o]).toBeCloseTo(cell.normal.x, 5);
      checked++;
    }
    expect(checked).toBe(planet.cells.length);
  });

  it('2. liczba trójkątów zgadza się ze wzorem Eulera dla triangulacji sfery (F = 2V − 4): żaden nie zgubiony, żaden zdublowany', () => {
    // Najtańszy możliwy dowód poprawności wyszukiwania trójkątów. Gubienie DAŁOBY dziury
    // (widoczne jako czarne plamy, które same z siebie zdradzają położenie), a dublowanie
    // dałoby trójkąty w obu nawinięciach naraz.
    expect(TRIANGLE_COUNT).toBe(2 * smeared.vertexCount - 4);
    expect(TRIANGLE_COUNT).toBe(2880);

    // …i domknięcie: V − E + F = 2, z krawędziami policzonymi z FAKTYCZNIE zapisanych trójkątów.
    const edges = new Set<string>();
    for (let t = 0; t < TRIANGLE_COUNT; t++) {
      const [a, b, c] = triangleAt(t);
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        edges.add(`${Math.min(u, v)}-${Math.max(u, v)}`);
      }
    }
    expect(smeared.vertexCount - edges.size + TRIANGLE_COUNT).toBe(2);
  });

  it('3. trójkąt istnieje wtedy i tylko wtedy, gdy trzy komórki są wzajemnymi sąsiadami — każda trójka DOKŁADNIE raz', () => {
    const keys = new Set<string>();
    for (let t = 0; t < TRIANGLE_COUNT; t++) {
      const tri = triangleAt(t).sort((x, y) => x - y);
      const [a, b, c] = tri;
      expect(planet.cells[a].neighbors).toContain(b);
      expect(planet.cells[b].neighbors).toContain(c);
      expect(planet.cells[a].neighbors).toContain(c);
      keys.add(tri.join('-'));
    }
    expect(keys.size).toBe(TRIANGLE_COUNT);
  });

  it('4. WSZYSTKIE trójkąty są nawinięte NA ZEWNĄTRZ — bo MeshBasicMaterial rysuje tylko przednie ściany, a odwrócony trójkąt to DZIURA w kontroli', () => {
    let outward = 0;
    let inward = 0;
    let rawOrderInward = 0;
    for (let t = 0; t < TRIANGLE_COUNT; t++) {
      const [a, b, c] = triangleAt(t);
      expect(signOfWinding(a, b, c)).toBeGreaterThan(0);
      outward++;
      // Kontrola pozytywna przyrządu: ta sama miara na trójkącie ODWRÓCONYM musi dać znak
      // przeciwny. Bez tego „wszystkie dodatnie" mogłoby znaczyć „miara zawsze dodatnia".
      if (signOfWinding(a, c, b) < 0) inward++;
      // Ile trójkątów wyszłoby do wewnątrz BEZ poprawki nawinięcia: kolejność surowa to
      // rosnące id (i < a < b), więc odtwarzamy ją sortowaniem. To jest liczba, którą
      // `positiveControl.ts` cytuje w komentarzu — mierzona, nie zgadywana.
      const [x, y, z] = [a, b, c].sort((p, q) => p - q);
      if (signOfWinding(x, y, z) < 0) rawOrderInward++;
    }
    expect(outward).toBe(TRIANGLE_COUNT);
    expect(inward).toBe(TRIANGLE_COUNT);
    console.log(`[KONTROLA] trójkątów wymagających odwrócenia nawinięcia: ${rawOrderInward} z ${TRIANGLE_COUNT}`);
    expect(rawOrderInward).toBeGreaterThan(0); // poprawka nawinięcia NIE jest martwym kodem
  });

  it('5. wierzchołki są WSPÓŁDZIELONE — każdy należy do wielu trójkątów (to jest cała przyczyna rozmazania)', () => {
    const uses = new Uint32Array(smeared.vertexCount);
    for (const idx of smeared.indices) uses[idx]++;
    let min = Infinity;
    let max = 0;
    for (const u of uses) {
      min = Math.min(min, u);
      max = Math.max(max, u);
    }
    expect(min).toBe(5); // pentagon
    expect(max).toBe(6); // heksagon
    // Kontrola pozytywna przez PORÓWNANIE z geometrią gry: tam żaden wierzchołek nie jest
    // dzielony między komórki, i to jest różnica, o którą w tym module chodzi.
    const flatUses = new Map<number, number>();
    for (const idx of flat.indices) flatUses.set(idx, (flatUses.get(idx) ?? 0) + 1);
    const flatVerticesSharedAcrossCells = [...flatUses.keys()].filter((v) => {
      const owners = new Set<number>();
      for (let c = 0; c < flat.cellVertexStart.length; c++) {
        const start = flat.cellVertexStart[c];
        if (v >= start && v < start + flat.cellVertexCount[c]) owners.add(c);
      }
      return owners.size > 1;
    });
    expect(flatVerticesSharedAcrossCells).toEqual([]);
  });
});

/** dot(cross(B−A, C−A), środek trójkąta) — dodatni znaczy „ściana zwrócona na zewnątrz kuli". */
function signOfWinding(a: number, b: number, c: number): number {
  const p = (i: number): [number, number, number] => [
    smeared.positions[i * 3],
    smeared.positions[i * 3 + 1],
    smeared.positions[i * 3 + 2],
  ];
  const [ax, ay, az] = p(a);
  const [bx, by, bz] = p(b);
  const [cx, cy, cz] = p(c);
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const mx = (ax + bx + cx) / 3;
  const my = (ay + by + cy) / 3;
  const mz = (az + bz + cz) / 3;
  return nx * mx + ny * my + nz * mz;
}

/** Kolor (rgb, float32) wierzchołka `cellId` w buforze siatki kontrolnej. */
function smearedColorOf(buf: Float32Array, cellId: number): [number, number, number] {
  return [buf[cellId * 3], buf[cellId * 3 + 1], buf[cellId * 3 + 2]];
}

const sameColor = (a: readonly number[], b: readonly number[]): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Liczba komórek, których kolor jest NIEODRÓŻNIALNY od koloru WSZYSTKICH ich sąsiadów —
 * czyli liczba komórek leżących we wnętrzu jednolitej łaty. To jest miara, która złapała
 * przeciek kontroli: `saturate` robi z całej półkuli nocnej jedną taką łatę, a **krawędź
 * jednolitej łaty jest widoczna jako linia**, choćby interpolacja rozmyła ją lokalnie.
 */
function uniformWithAllNeighbours(colors: Float32Array, readColor: (buf: Float32Array, id: number) => number[]): number {
  let count = 0;
  for (const cell of planet.cells) {
    if (cell.neighbors.every((n) => sameColor(readColor(colors, cell.id), readColor(colors, n)))) count++;
  }
  return count;
}

describe('writeSmearedColors — kolor, który NAPRAWDĘ rozmazuje się po powierzchni', () => {
  it('11. [KOREKTA RUNDY 1 — WŁASNOŚĆ, KTÓRA PRZECIEKAŁA] ZERO komórek jednolitych z całym sąsiedztwem, w KAŻDEJ z trzech faz', () => {
    // Pierwsza wersja kontroli używała `saturate(dot)` i NIE OBLAŁA: właściciel projektu
    // dostał w niej 14/15. Przyczyna nie leży w interpolacji, tylko w przycięciu: `saturate`
    // ścina całą półkulę nocną do jednej wartości, więc noc jest JEDNĄ JEDNOLITĄ ŁATĄ, a
    // krawędź tej łaty JEST terminatorem. Rozmycie po powierzchni zaciera ją lokalnie o mniej
    // więcej komórkę — z bliska widać tylko rozmazanie, ale z widoku całej tarczy krawędź
    // obszaru jednolitego jest doskonale widoczna.
    //
    // Asercja jest BEZWZGLĘDNA (`toBe(0)`), nie relacyjna wobec żadnej stałej z kodu — żeby
    // nie mogła poruszyć się razem z tym, co sprawdza.
    const out = new Float32Array(smeared.vertexCount * 3);
    let checkedPhases = 0;
    for (const [i, sunDir] of gateSunDirs.entries()) {
      writeSmearedColors(smeared, sunDir, out, DEFAULT_PALETTE);
      expect(uniformWithAllNeighbours(out, smearedColorOf), `faza ${i + 1}`).toBe(0);
      checkedPhases++;
    }
    expect(checkedPhases).toBe(3);

    // KONTROLA POZYTYWNA na sam przyrząd: ten sam licznik, ta sama paleta, ta sama siatka —
    // ale kolor liczony STARYM odwzorowaniem `saturate(dot)`. Musi dać liczbę rzędu setek,
    // inaczej „zero" wyżej znaczyłoby tyle, co wyłączony miernik.
    const saturated = new Float32Array(smeared.vertexCount * 3);
    const night = DEFAULT_PALETTE[0];
    const day = DEFAULT_PALETTE[DEFAULT_PALETTE.length - 1];
    const phase0Light = lightField(planet, gateSunDirs[0]);
    for (let c = 0; c < smeared.vertexCount; c++) {
      const t = phase0Light[c];
      saturated[c * 3] = night[0] + (day[0] - night[0]) * t;
      saturated[c * 3 + 1] = night[1] + (day[1] - night[1]) * t;
      saturated[c * 3 + 2] = night[2] + (day[2] - night[2]) * t;
    }
    const leaking = uniformWithAllNeighbours(saturated, smearedColorOf);
    console.log(`[KONTROLA] komórek jednolitych z całym sąsiedztwem — saturate(dot): ${leaking}, (dot+1)/2: 0`);
    expect(leaking).toBe(673); // zmierzone przy seed 20260915, frequency 12, faza t/T = 0

    // …i drugi biegun skali: w renderze GRY (progowanym) jednolitych jest jeszcze więcej,
    // bo tam całe pasma są jednym kolorem. Progowanie ma tak robić — to jego zadanie; nie ma
    // tak robić KONTROLA.
    const gameColors = new Float32Array(flat.positions.length);
    writeCellColors(flat, phase0Light, gameColors, DEFAULT_PALETTE);
    const gameUniform = uniformWithAllNeighbours(gameColors, (buf, id) => {
      const o = flat.cellVertexStart[id] * 3;
      return [buf[o], buf[o + 1], buf[o + 2]];
    });
    expect(gameUniform).toBeGreaterThan(leaking);
  });

  it('12. terminator NIE jest wyróżniony skokiem: krok barwny przez granicę jest tego samego rzędu, co typowy krok w dowolnym miejscu kuli', () => {
    // Druga połowa przecieku, subtelniejsza niż jednolita łata: `saturate` daje ZAŁAMANIE
    // POCHODNEJ dokładnie na terminatorze (zero po stronie nocnej, dodatnia po oświetlonej).
    // Kolor jest ciągły, ale gradient skacze — a oko czyta nieciągłość gradientu jako
    // krawędź. Miara: ile razy większy jest ŚREDNI krok barwny na krawędziach przez granicę
    // od średniego kroku na wszystkich krawędziach.
    const out = new Float32Array(smeared.vertexCount * 3);
    writeSmearedColors(smeared, gateSunDirs[0], out, DEFAULT_PALETTE);
    const phase0Light = lightField(planet, gateSunDirs[0]);

    const ratio = (colors: Float32Array): number => {
      let sumAll = 0;
      let nAll = 0;
      let sumBoundary = 0;
      let nBoundary = 0;
      for (const cell of planet.cells) {
        for (const n of cell.neighbors) {
          if (n <= cell.id) continue;
          const a = smearedColorOf(colors, cell.id);
          const b = smearedColorOf(colors, n);
          const step = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          sumAll += step;
          nAll++;
          if ((phase0Light[cell.id] > 0) !== (phase0Light[n] > 0)) {
            sumBoundary += step;
            nBoundary++;
          }
        }
      }
      expect(nBoundary).toBeGreaterThan(0); // kontrola: krawędzie graniczne faktycznie istnieją
      return sumBoundary / nBoundary / (sumAll / nAll);
    };

    const fixed = ratio(out);
    // KONTROLA POZYTYWNA: ten sam iloraz dla STAREGO odwzorowania musi być wyraźnie większy.
    const saturated = new Float32Array(smeared.vertexCount * 3);
    const night = DEFAULT_PALETTE[0];
    const day = DEFAULT_PALETTE[DEFAULT_PALETTE.length - 1];
    for (let c = 0; c < smeared.vertexCount; c++) {
      const t = phase0Light[c];
      saturated[c * 3] = night[0] + (day[0] - night[0]) * t;
      saturated[c * 3 + 1] = night[1] + (day[1] - night[1]) * t;
      saturated[c * 3 + 2] = night[2] + (day[2] - night[2]) * t;
    }
    const leaking = ratio(saturated);
    console.log(`[KONTROLA] krok przez granicę / krok typowy — (dot+1)/2: ${fixed.toFixed(2)}×, saturate(dot): ${leaking.toFixed(2)}×`);

    // Zmierzone: 1,56× po poprawce, 2,78× przed nią. Reszta ponad 1,0 jest NIEUSUWALNA —
    // `dot = cos θ` ma maksymalne nachylenie dokładnie przy θ = 90°, więc terminator jest
    // izolinią o największym gradiencie dla KAŻDEGO gładkiego, monotonicznego odwzorowania
    // `dot`. To jest własność geometrii kuli, nie palety, i jest zapisana jako granica tej
    // konstrukcji, a nie jako defekt do naprawienia.
    expect(fixed).toBeLessThan(1.8);
    expect(leaking).toBeGreaterThan(2.5);
    expect(fixed).toBeLessThan(leaking);
  });

  it('6. [WŁASNOŚĆ, DLA KTÓREJ TEN MODUŁ ISTNIEJE] trójkąty przy granicy mają wierzchołki o RÓŻNYCH kolorach, a w geometrii gry — NIGDY', () => {
    // Interpolacja po powierzchni bierze się WYŁĄCZNIE stąd, że trójkąt ma wierzchołki o
    // różnych kolorach: GPU rozciąga wtedy gradient po jego wnętrzu i granica przestaje być
    // nieciągłością (C⁰), a staje się rampą. Odwrotnie w renderze gry: każdy trójkąt ma trzy
    // IDENTYCZNE kolory, więc każda krawędź między komórkami jest pełnym skokiem.
    //
    // To jest dokładnie ta różnica, której `writeCellColorsSmooth` z Fazy 2A NIE robiła —
    // zmieniała mapowanie palety, zostawiając komórki płaskimi, i dlatego nie mogła oblać.
    const smearedColors = new Float32Array(smeared.vertexCount * 3);
    writeSmearedColors(smeared, sun, smearedColors, DEFAULT_PALETTE);

    const colorOf = (buf: Float32Array, v: number): [number, number, number] => [
      buf[v * 3],
      buf[v * 3 + 1],
      buf[v * 3 + 2],
    ];
    const same = (a: readonly number[], b: readonly number[]): boolean =>
      a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

    let nonUniform = 0;
    for (let t = 0; t < TRIANGLE_COUNT; t++) {
      const [a, b, c] = triangleAt(t);
      const ca = colorOf(smearedColors, a);
      const cb = colorOf(smearedColors, b);
      const cc = colorOf(smearedColors, c);
      if (!same(ca, cb) || !same(cb, cc)) nonUniform++;
    }
    console.log(`[KONTROLA] trójkątów z niejednolitym kolorem wierzchołków: ${nonUniform} z ${TRIANGLE_COUNT}`);
    expect(nonUniform).toBeGreaterThan(TRIANGLE_COUNT / 4);

    // Kontrola: w geometrii GRY, tym samym światłem i tą samą paletą, ani jeden trójkąt nie
    // ma niejednolitych kolorów — więc liczba wyżej jest własnością TEJ geometrii, nie tego,
    // że „kolory bywają różne".
    const flatColors = new Float32Array(flat.positions.length);
    writeCellColors(flat, light, flatColors, DEFAULT_PALETTE);
    let flatNonUniform = 0;
    for (let t = 0; t < flat.indices.length / 3; t++) {
      const a = flat.indices[t * 3];
      const b = flat.indices[t * 3 + 1];
      const c = flat.indices[t * 3 + 2];
      if (!same(colorOf(flatColors, a), colorOf(flatColors, b)) || !same(colorOf(flatColors, b), colorOf(flatColors, c))) {
        flatNonUniform++;
      }
    }
    expect(flatNonUniform).toBe(0);
  });

  it('7. granica przestaje być nieciągłością: NAJWIĘKSZY skok koloru między sąsiadującymi wierzchołkami jest rzędy wielkości mniejszy niż skok pasma w renderze gry', () => {
    // Liczba, którą bramka faktycznie bada: w renderze gry para komórek po dwóch stronach
    // granicy różni się o pełny skok palety (0,90). W kontroli największa różnica MIĘDZY
    // DOWOLNYMI sąsiadującymi wierzchołkami jest mikroskopijna, bo kolor idzie rampą.
    const smearedColors = new Float32Array(smeared.vertexCount * 3);
    writeSmearedColors(smeared, sun, smearedColors, DEFAULT_PALETTE);
    const dist = (u: number, v: number): number =>
      Math.hypot(
        smearedColors[u * 3] - smearedColors[v * 3],
        smearedColors[u * 3 + 1] - smearedColors[v * 3 + 1],
        smearedColors[u * 3 + 2] - smearedColors[v * 3 + 2],
      );

    let maxStep = 0;
    let checked = 0;
    for (const cell of planet.cells) {
      for (const n of cell.neighbors) {
        if (n <= cell.id) continue;
        maxStep = Math.max(maxStep, dist(cell.id, n));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);

    const flatColors = new Float32Array(flat.positions.length);
    writeCellColors(flat, light, flatColors, DEFAULT_PALETTE);
    const flatColorOf = (cellId: number): [number, number, number] => {
      const o = flat.cellVertexStart[cellId] * 3;
      return [flatColors[o], flatColors[o + 1], flatColors[o + 2]];
    };
    let flatMaxStep = 0;
    for (const cell of planet.cells) {
      for (const n of cell.neighbors) {
        if (n <= cell.id) continue;
        const a = flatColorOf(cell.id);
        const b = flatColorOf(n);
        flatMaxStep = Math.max(flatMaxStep, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    }
    console.log(`[KONTROLA] największy skok sąsiadów — kontrola: ${maxStep.toFixed(4)}, render gry: ${flatMaxStep.toFixed(4)}`);
    expect(flatMaxStep).toBeGreaterThan(0.5); // render gry: pełny skok palety
    expect(maxStep).toBeLessThan(flatMaxStep / 5);
  });

  it('8. antypoda słońca dostaje DOKŁADNIE palette[0], punkt podsłoneczny DOKŁADNIE palette[ostatni], a terminator ŚRODEK palety', () => {
    // Rampa rozciąga CAŁE [-1, 1] iloczynu skalarnego na [0, 1] palety — to jest różnica
    // wobec `saturate`, które zwijało całą połowę zakresu do jednego punktu. Trzeci punkt
    // (dot = 0, czyli terminator) jest tu najważniejszy: ma wypaść DOKŁADNIE w środku palety,
    // nieodróżnialnie od każdej innej izolinii.
    const geo2 = {
      positions: new Float32Array(9),
      normals: Float32Array.from([-1, 0, 0, 1, 0, 0, 0, 1, 0]), // antypoda, punkt podsłoneczny, terminator
      indices: new Uint32Array(0),
      vertexCount: 3,
    };
    const out = new Float32Array(9);
    writeSmearedColors(geo2, { x: 1, y: 0, z: 0 }, out, DEFAULT_PALETTE);

    const night = DEFAULT_PALETTE[0];
    const day = DEFAULT_PALETTE[DEFAULT_PALETTE.length - 1];
    expect([out[0], out[1], out[2]]).toEqual(night.map(Math.fround));
    expect([out[3], out[4], out[5]]).toEqual(day.map(Math.fround));
    for (let i = 0; i < 3; i++) {
      expect(out[6 + i]).toBeCloseTo((night[i] + day[i]) / 2, 5);
    }
    // Kontrola pozytywna na sam test: trzy punkty dają TRZY różne kolory — gdyby funkcja
    // zwracała stałą, `toBeCloseTo` na środku palety przeszłoby dla palety o środku równym
    // tej stałej.
    expect([out[0], out[1], out[2]]).not.toEqual([out[6], out[7], out[8]]);
    expect([out[3], out[4], out[5]]).not.toEqual([out[6], out[7], out[8]]);

    // `sunDir` jest NORMALIZOWANY: ten sam kierunek o innej długości daje identyczny wynik.
    // Bez normalizacji `dot` skalowałby się z długością wektora, a `(dot + 1) / 2` wyszłoby
    // poza [0, 1] — kolory ekstrapolowałyby poza paletę, ciszej niż rzucony błąd.
    // `sunDirection` zwraca wektor jednostkowy, więc w normalnym użyciu nikt by tego nie
    // zauważył; to jest dokładnie ten rodzaj cichej zależności, którą trzeba przypiąć.
    const scaled = new Float32Array(9);
    writeSmearedColors(geo2, { x: 5, y: 0, z: 0 }, scaled, DEFAULT_PALETTE);
    expect(Array.from(scaled)).toEqual(Array.from(out));
  });

  it('9. rzuca RangeError dla złego out, złej palety i — przede wszystkim — dla zdegenerowanego sunDir', () => {
    const out = new Float32Array(smeared.vertexCount * 3);
    expect(() => writeSmearedColors(smeared, sun, out, DEFAULT_PALETTE)).not.toThrow();
    expect(() => writeSmearedColors(smeared, sun, new Float32Array(out.length - 3), DEFAULT_PALETTE)).toThrow(RangeError);
    expect(() => writeSmearedColors(smeared, sun, out, [])).toThrow(RangeError);
    expect(() => writeSmearedColors(smeared, sun, out, [DEFAULT_PALETTE[0]])).toThrow(RangeError);

    // Strażnik `sunDir` jest tu WAŻNIEJSZY niż pozostałe i dlatego ma własne uzasadnienie:
    // wektor zerowy albo NaN dałby `dot === 0` w każdej komórce, czyli kulę w JEDNYM płaskim
    // kolorze. Kontrola wyglądałaby wtedy na działającą („granicy nie widać!"), będąc w
    // istocie wyłączoną — fałszowałaby wynik dokładnie w stronę „kontrola oblała".
    expect(() => writeSmearedColors(smeared, { x: 0, y: 0, z: 0 }, out, DEFAULT_PALETTE)).toThrow(RangeError);
    expect(() => writeSmearedColors(smeared, { x: NaN, y: 0, z: 0 }, out, DEFAULT_PALETTE)).toThrow(RangeError);
    expect(() => writeSmearedColors(smeared, { x: Infinity, y: 0, z: 0 }, out, DEFAULT_PALETTE)).toThrow(RangeError);
  });

  it('10. nie mutuje Planet ani nie alokuje bufora wyjściowego (pisze do bufora wywołującego)', () => {
    const before = JSON.stringify(planet);
    const out = new Float32Array(smeared.vertexCount * 3);
    writeSmearedColors(smeared, sun, out, DEFAULT_PALETTE);
    expect(JSON.stringify(planet)).toBe(before);
    // Kontrola pozytywna: bufor FAKTYCZNIE został zapisany — inaczej „nie mutuje" byłoby
    // prawdą także dla funkcji, która nie robi nic.
    expect(out.some((v) => v !== 0)).toBe(true);
  });
});
