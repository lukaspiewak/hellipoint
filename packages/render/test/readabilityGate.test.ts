import { describe, expect, it } from 'vitest';
import { Mesh, Vector3, type BufferAttribute, type Color, type Scene } from 'three';
import { createPlanet, lightField, sunDirection, type Planet } from '@heliopolis/sim';
import {
  createReadabilityGate,
  formatGateResultsMarkdown,
  markerPosition,
  type GateAnswerRecord,
  type ReadabilityGate,
} from '../src/readabilityGate.js';
import { buildGateTrials, findTerminatorPairs, type GateTrial } from '../src/terminatorPairs.js';
import { buildPlanetGeometry } from '../src/geometry.js';
import { DEFAULT_PALETTE, lightBand, writeCellColors } from '../src/shading.js';
import type { SceneRenderer } from '../src/scene.js';
import { createFakeCanvas } from './support/fakeCanvas.js';

const planet = createPlanet({ seed: 20260915 });
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

function createFakeRenderer(): SceneRenderer & {
  renderCalls: number;
  disposeCalls: number;
  lastScene: Scene | null;
} {
  const renderer = {
    renderCalls: 0,
    disposeCalls: 0,
    lastScene: null as Scene | null,
    render(scene: Scene): void {
      renderer.renderCalls++;
      renderer.lastScene = scene;
    },
    setSize(): void {},
    setPixelRatio(): void {},
    setClearColor(): void {},
    dispose(): void {
      renderer.disposeCalls++;
    },
  };
  return renderer;
}

/**
 * Bufor kolorów PLANETY, wyjęty ze sceny, którą harness faktycznie przekazuje rendererowi.
 * Świadomie NIE przez nowe pole w `ReadabilityGate`: scena jest tym, co renderer dostaje do
 * narysowania, więc odczyt z niej sprawdza dokładnie to, co zobaczy człowiek — a nie to, co
 * harness deklaruje o sobie przez dodatkowe API zbudowane pod test.
 */
function planetColorBuffer(gate: ReadabilityGate, renderer: { lastScene: Scene | null }): Float32Array {
  gate.renderFrame();
  const scene = renderer.lastScene;
  if (!scene) throw new Error('test: renderer nie dostał sceny');
  // `Sprite` NIE jest `Mesh` w Three.js (oba dziedziczą po Object3D), więc to trafia w
  // siatkę planety, nigdy w znacznik — sprawdzone asercją na długość bufora u wywołujących.
  const mesh = scene.children.find((o): o is Mesh => o instanceof Mesh);
  if (!mesh) throw new Error('test: brak siatki planety w scenie');
  return (mesh.geometry.getAttribute('color') as BufferAttribute).array as Float32Array;
}

/** Kolor (rgb 0..1) pierwszego wierzchołka komórki `cellId` w buforze kolorów planety. */
function cellColor(colors: Float32Array, cellId: number): [number, number, number] {
  const geo = sharedGeo;
  const o = geo.cellVertexStart[cellId] * 3;
  return [colors[o], colors[o + 1], colors[o + 2]];
}

function colorDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const sharedGeo = buildPlanetGeometry(planet);

const isGreenDominant = (c: Color): boolean => c.g > c.r && c.g > c.b;
const isRedDominant = (c: Color): boolean => c.r > c.g && c.r > c.b;

/** Trzy fazy słońca ewidentnie różne, i para pełnego planu (3×5=15), tak jak wywoła je apps/client. */
function realTrials(pairsPerPhase = 5): GateTrial[] {
  const sunDirs = [sunDirection(0, 180), sunDirection(60, 180), sunDirection(120, 180)];
  return buildGateTrials(planet, sunDirs, pairsPerPhase);
}

/**
 * Piksel canvasu (CSS, jak `event.offsetX/Y`), w który trzeba kliknąć, żeby trafić w
 * `target` — rzutuje jego pozycję świata przez BIEŻĄCĄ kamerę. Wymaga świeżego
 * `matrixWorld` (ten sam wymóg co `Raycaster.setFromCamera` w `readabilityGate.ts` —
 * zweryfikowane empirycznie probe'ą przed napisaniem tego pliku).
 */
function screenPointFor(gate: ReadabilityGate, target: Vector3): { x: number; y: number } {
  gate.camera.object.updateMatrixWorld(true);
  const ndc = target.clone().project(gate.camera.object);
  return {
    x: ((ndc.x + 1) / 2) * CANVAS_WIDTH,
    y: ((1 - ndc.y) / 2) * CANVAS_HEIGHT,
  };
}

function pixelDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('createReadabilityGate — konstrukcja nie mutuje Planet', () => {
  it('1. budowa harnessu (geometria + siatka + kamera + znaczniki) zostawia Planet bit w bit identyczny', () => {
    const before = JSON.stringify(planet);
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    expect(JSON.stringify(planet)).toBe(before);
    gate.dispose();
  });

  it('2. rzuca RangeError, gdy plan prób jest pusty', () => {
    expect(() =>
      createReadabilityGate(planet, createFakeCanvas(), [], () => createFakeRenderer()),
    ).toThrow(RangeError);
  });
});

describe('markerPosition — funkcja czysta', () => {
  it('3. wynik leży wzdłuż normalnej komórki, w niewielkiej dodatniej odległości od jej środka', () => {
    for (const cellId of [0, 733, planet.cells.length - 1]) {
      const cell = planet.cells[cellId];
      const pos = markerPosition(planet, cellId);
      const delta = new Vector3(pos.x - cell.center.x, pos.y - cell.center.y, pos.z - cell.center.z);
      const dist = delta.length();

      expect(dist).toBeGreaterThan(0);
      expect(dist).toBeLessThan(planet.radius * 0.1); // dużo mniej niż promień — "tuż nad", nie "gdzieś w kosmosie"

      const normal = new Vector3(cell.normal.x, cell.normal.y, cell.normal.z);
      const cosAngle = delta.clone().normalize().dot(normal);
      expect(cosAngle).toBeGreaterThan(0.999); // równoległe do normalnej, nie w bok
    }
  });
});

describe('createReadabilityGate — stan neutralny PRZED odsłonięciem (żaden marker nie zdradza odpowiedzi)', () => {
  it('4. oba znaczniki startują z DOKŁADNIE tą samą barwą materiału', () => {
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    expect(gate.markerLit.material.color.equals(gate.markerDark.material.color)).toBe(true);
    gate.dispose();
  });

  it('5. oba znaczniki dzielą DOKŁADNIE ten sam obiekt tekstury (ta sama referencja `.map`)', () => {
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    expect(gate.markerLit.material.map).toBe(gate.markerDark.material.map);
    gate.dispose();
  });

  it('6. oba znaczniki mają DOKŁADNIE ten sam rozmiar (scale)', () => {
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    expect(gate.markerLit.scale.x).toBe(gate.markerDark.scale.x);
    expect(gate.markerLit.scale.x).toBeGreaterThan(0);
    gate.dispose();
  });

  it('7. pozycje znaczników po starcie odpowiadają markerPosition() dla pary PIERWSZEJ próby', () => {
    const trials = realTrials();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () =>
      createFakeRenderer(),
    );
    const expectedLit = markerPosition(planet, trials[0].pair.litCellId);
    const expectedDark = markerPosition(planet, trials[0].pair.darkCellId);
    expect(gate.markerLit.position.x).toBeCloseTo(expectedLit.x, 6);
    expect(gate.markerLit.position.y).toBeCloseTo(expectedLit.y, 6);
    expect(gate.markerLit.position.z).toBeCloseTo(expectedLit.z, 6);
    expect(gate.markerDark.position.x).toBeCloseTo(expectedDark.x, 6);
    gate.dispose();
  });
});

describe('createReadabilityGate — handleClick: scoring i odsłonięcie', () => {
  it('8. klik trafiający we znacznik NAD faktycznie oświetloną komórką -> correct:true, isRevealed() staje się true', () => {
    const trials = realTrials();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () =>
      createFakeRenderer(),
    );
    expect(gate.isRevealed()).toBe(false);

    const p = screenPointFor(gate, gate.markerLit.position);
    const record = gate.handleClick(p.x, p.y);

    expect(record).not.toBeNull();
    expect((record as GateAnswerRecord).correct).toBe(true);
    expect((record as GateAnswerRecord).clickedCellId).toBe(trials[0].pair.litCellId);
    expect(gate.isRevealed()).toBe(true);
    gate.dispose();
  });

  it('9. klik trafiający we znacznik NAD faktycznie ciemną komórką -> correct:false, clickedCellId to darkCellId', () => {
    const trials = realTrials();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () =>
      createFakeRenderer(),
    );
    const p = screenPointFor(gate, gate.markerDark.position);
    const record = gate.handleClick(p.x, p.y);

    expect(record).not.toBeNull();
    expect((record as GateAnswerRecord).correct).toBe(false);
    expect((record as GateAnswerRecord).clickedCellId).toBe(trials[0].pair.darkCellId);
    gate.dispose();
  });

  it('10. odsłonięcie zmienia barwy znaczników (przestają być identyczne) — a PRZED kliknięciem były identyczne (test 4)', () => {
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    const p = screenPointFor(gate, gate.markerLit.position);
    gate.handleClick(p.x, p.y);
    expect(gate.markerLit.material.color.equals(gate.markerDark.material.color)).toBe(false);
    gate.dispose();
  });

  it('11. klik OBOK obu znaczników (daleki róg ekranu) zwraca null i NIE zapisuje odpowiedzi', () => {
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    // focusOn wyśrodkowuje parę na ekranie (patrz setupTrial) — róg canvasu powinien więc
    // leżeć daleko od obu. Nie ZAKŁADAMY tego: liczymy oba rzuty i SPRAWDZAMY (kontrola
    // pozytywna na sam test), że wybrany róg jest naprawdę odległy o >200px od każdego,
    // zanim wyciągniemy wniosek z braku trafienia.
    const litPoint = screenPointFor(gate, gate.markerLit.position);
    const darkPoint = screenPointFor(gate, gate.markerDark.position);
    const corner = { x: 2, y: 2 };
    expect(pixelDistance(corner, litPoint)).toBeGreaterThan(200);
    expect(pixelDistance(corner, darkPoint)).toBeGreaterThan(200);

    const record = gate.handleClick(corner.x, corner.y);
    expect(record).toBeNull();
    expect(gate.answers().length).toBe(0);
    expect(gate.isRevealed()).toBe(false);
    gate.dispose();
  });

  it('12. drugi klik na TĘ SAMĄ, już odsłoniętą próbę zwraca null i NIE dopisuje drugiej odpowiedzi', () => {
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    const p = screenPointFor(gate, gate.markerLit.position);
    gate.handleClick(p.x, p.y);
    expect(gate.answers().length).toBe(1);

    const second = gate.handleClick(p.x, p.y);
    expect(second).toBeNull();
    expect(gate.answers().length).toBe(1);
    gate.dispose();
  });

  it('13. [KONTROLA POZYTYWNA trybu kontrolnego] w trybie "smooth" klik NIE zapisuje odpowiedzi, nawet trafiając idealnie we znacznik', () => {
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    gate.setMode('smooth');
    expect(gate.mode()).toBe('smooth');

    const p = screenPointFor(gate, gate.markerLit.position);
    const record = gate.handleClick(p.x, p.y);

    expect(record).toBeNull();
    expect(gate.answers().length).toBe(0);
    expect(gate.isRevealed()).toBe(false);
    gate.dispose();
  });

  it('14. setMode nie rusza pozycji znaczników ani stanu odsłonięcia — tylko przemalowuje planetę', () => {
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      createFakeRenderer(),
    );
    const before = gate.markerLit.position.clone();
    gate.setMode('smooth');
    gate.setMode('threshold');
    expect(gate.markerLit.position.equals(before)).toBe(true);
    expect(gate.isRevealed()).toBe(false);
    gate.dispose();
  });
});

describe('createReadabilityGate — advance()', () => {
  it('15. advance() PRZED odsłonięciem nie robi nic i zwraca false', () => {
    const trials = realTrials();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () =>
      createFakeRenderer(),
    );
    expect(gate.advance()).toBe(false);
    expect(gate.currentTrialIndex()).toBe(0);
    gate.dispose();
  });

  it('16. advance() PO odsłonięciu przechodzi do kolejnej próby: nowa para, reset barwy do neutralnej, isRevealed() wraca na false', () => {
    const trials = realTrials();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () =>
      createFakeRenderer(),
    );
    const p = screenPointFor(gate, gate.markerLit.position);
    gate.handleClick(p.x, p.y);

    const advanced = gate.advance();
    expect(advanced).toBe(true);
    expect(gate.currentTrialIndex()).toBe(1);
    expect(gate.isRevealed()).toBe(false);
    expect(gate.markerLit.material.color.equals(gate.markerDark.material.color)).toBe(true);

    const expectedLit = markerPosition(planet, trials[1].pair.litCellId);
    expect(gate.markerLit.position.x).toBeCloseTo(expectedLit.x, 6);
    gate.dispose();
  });

  it('17. [przebieg pełny] piętnaście trafień z rzędu (zawsze w znacznik "jasny") kończy plan: isFinished() true, 15 poprawnych odpowiedzi', () => {
    const trials = realTrials();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () =>
      createFakeRenderer(),
    );

    let guard = 0;
    while (!gate.isFinished() && guard < trials.length + 1) {
      const p = screenPointFor(gate, gate.markerLit.position);
      const record = gate.handleClick(p.x, p.y);
      expect(record).not.toBeNull();
      expect((record as GateAnswerRecord).correct).toBe(true);
      gate.advance();
      guard++;
    }

    expect(gate.isFinished()).toBe(true);
    expect(gate.answers().length).toBe(trials.length);
    expect(gate.answers().every((a) => a.correct)).toBe(true);
    gate.dispose();
  });

  it('18. advance() po OSTATNIEJ próbie zwraca false (koniec planu, nie ma dokąd iść)', () => {
    const trials = realTrials(5); // 3 fazy x 5 = 15
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () =>
      createFakeRenderer(),
    );
    for (let i = 0; i < trials.length; i++) {
      const p = screenPointFor(gate, gate.markerLit.position);
      gate.handleClick(p.x, p.y);
      const result = gate.advance();
      if (i < trials.length - 1) {
        expect(result).toBe(true);
      } else {
        expect(result).toBe(false); // ostatnia próba: nie ma kolejnej
      }
    }
    expect(gate.isFinished()).toBe(true);
    gate.dispose();
  });
});

describe('createReadabilityGate — przemalowanie planety na KAŻDĄ próbę (bramka nie może kłamać)', () => {
  it('26. każda próba maluje planetę światłem SWOJEJ fazy — bufor kolorów zgadza się co do bitu z policzonym niezależnie', () => {
    // Zmierzone przez przegląd całogałęziowy: usunięcie `applyPhaseColoring()` z `setupTrial`
    // zostawiało CAŁĄ gałąź zieloną (485/485). Człowiek oglądałby wtedy próby 6-15 w świetle
    // FAZY 1, harness dalej skorowałby każdy rzut monetą i wydrukował werdykt. To jest
    // najdroższy z możliwych trybów awarii tego pliku: on wyprodukował werdykt na D1.
    const trials = realTrials();
    const renderer = createFakeRenderer();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () => renderer);

    const colors = planetColorBuffer(gate, renderer);
    expect(colors.length).toBe(sharedGeo.positions.length); // trafiliśmy w siatkę planety, nie w znacznik

    const expected = new Float32Array(sharedGeo.positions.length);
    // KONTROLA POZYTYWNA na sam test: fazy muszą dawać RÓŻNE bufory, inaczej porównanie
    // niżej przechodziłoby także dla harnessu, który maluje raz i nigdy nie odświeża.
    const bufferForPhase = (i: number): Float32Array => {
      const buf = new Float32Array(sharedGeo.positions.length);
      writeCellColors(sharedGeo, lightField(planet, trials[i].sunDir), buf, DEFAULT_PALETTE);
      return buf;
    };
    expect(Array.from(bufferForPhase(0))).not.toEqual(Array.from(bufferForPhase(5)));
    expect(Array.from(bufferForPhase(5))).not.toEqual(Array.from(bufferForPhase(10)));

    let checked = 0;
    for (let i = 0; i < trials.length; i++) {
      expect(gate.currentTrialIndex()).toBe(i);
      writeCellColors(sharedGeo, lightField(planet, trials[i].sunDir), expected, DEFAULT_PALETTE);

      // Licznik rozbieżności zamiast toEqual na 30246 elementach: szybciej i daje LICZBĘ
      // do raportu zamiast samego "różne".
      let mismatches = 0;
      for (let k = 0; k < expected.length; k++) {
        if (colors[k] !== expected[k]) mismatches++;
      }
      expect(mismatches, `próba ${i + 1} (faza ${trials[i].phaseIndex + 1})`).toBe(0);
      checked++;

      const p = screenPointFor(gate, gate.markerLit.position);
      gate.handleClick(p.x, p.y);
      gate.advance();
      // `colors` to TEN SAM obiekt Float32Array przez cały czas życia siatki (atrybut
      // `color` nie jest podmieniany) — `planetColorBuffer` odczytany raz wystarcza.
    }
    expect(checked).toBe(trials.length);
    gate.dispose();
  });

  it('27. w KAŻDEJ z 15 prób obie oznaczone komórki są pomalowane RÓŻNYMI kolorami — człowiek ma co rozróżniać', () => {
    // Własność, którą bramka MIERZY, sprowadzona do liczby: gdyby przemalowanie wypadło,
    // dla prób 6-15 obie komórki pary wpadłyby w to samo pasmo i odległość barwna wyniosłaby
    // DOKŁADNIE 0,0000 — dwa nierozróżnialne znaczniki, a harness i tak liczyłby punkty.
    const trials = realTrials();
    const renderer = createFakeRenderer();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), trials, () => renderer);
    const colors = planetColorBuffer(gate, renderer);

    let checked = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < trials.length; i++) {
      const d = colorDistance(
        cellColor(colors, trials[i].pair.litCellId),
        cellColor(colors, trials[i].pair.darkCellId),
      );
      expect(d, `próba ${i + 1} (faza ${trials[i].phaseIndex + 1})`).toBeGreaterThan(0);
      minDistance = Math.min(minDistance, d);
      checked++;

      const p = screenPointFor(gate, gate.markerLit.position);
      gate.handleClick(p.x, p.y);
      gate.advance();
    }
    expect(checked).toBe(trials.length); // kontrola: pętla przeszła wszystkie próby, nie zero
    // Przy DEFAULT_PALETTE granica noc↔(półmrok|dzień) to pełny skok palety — nie "trochę
    // większe od zera". Przypięte, żeby drobne strojenie progów nie przeszło niezauważone.
    expect(minDistance).toBeGreaterThan(0.5);
    gate.dispose();
  });

  it('28. odsłonięcie pokazuje PRAWDĘ, nie informację zwrotną: zielony ZAWSZE nad oświetloną, czerwony ZAWSZE nad ciemną', () => {
    // Test 10 sprawdzał wyłącznie, że barwy PRZESTAJĄ być identyczne — zmierzone: zamiana
    // obu kolorów odsłonięcia miejscami zostawiała 485/485 zielone. Odwrócone odsłonięcie
    // nie rusza `correct`, więc tabela wyniku nadal drukowałaby PASS, a człowiek uczyłby
    // się MIĘDZY próbami odwrotnej zasady — dokładnie odwrotnie do §5.2 punktu 6.
    for (const clickTarget of ['lit', 'dark'] as const) {
      const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
        createFakeRenderer(),
      );
      // Przed odsłonięciem żaden znacznik nie jest ani zielony, ani czerwony (neutralna biel)
      // — inaczej asercje niżej mogłyby być spełnione "od zawsze", bez związku z klikiem.
      expect(isGreenDominant(gate.markerLit.material.color)).toBe(false);
      expect(isRedDominant(gate.markerDark.material.color)).toBe(false);

      const target = clickTarget === 'lit' ? gate.markerLit : gate.markerDark;
      const p = screenPointFor(gate, target.position);
      const record = gate.handleClick(p.x, p.y);
      expect(record).not.toBeNull();
      expect((record as GateAnswerRecord).correct).toBe(clickTarget === 'lit');

      // Kluczowe: to NIE zależy od tego, co kliknięto — w obu przebiegach ten sam wynik.
      expect(isGreenDominant(gate.markerLit.material.color), `klik w ${clickTarget}`).toBe(true);
      expect(isRedDominant(gate.markerDark.material.color), `klik w ${clickTarget}`).toBe(true);
      gate.dispose();
    }
  });
});

describe('createReadabilityGate — renderFrame/resize/dispose', () => {
  it('19. renderFrame() faktycznie woła renderer.render()', () => {
    const fakeRenderer = createFakeRenderer();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      fakeRenderer,
    );
    gate.renderFrame();
    gate.renderFrame();
    expect(fakeRenderer.renderCalls).toBe(2);
    gate.dispose();
  });

  it('20. dispose() nie rzuca i faktycznie zwalnia renderer', () => {
    const fakeRenderer = createFakeRenderer();
    const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), realTrials(), () =>
      fakeRenderer,
    );
    expect(() => gate.dispose()).not.toThrow();
    expect(fakeRenderer.disposeCalls).toBe(1);
  });

  it('21. resize() nie rzuca po zmianie wymiarów canvasu', () => {
    const canvas = createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const gate = createReadabilityGate(planet, canvas, realTrials(), () => createFakeRenderer());
    const mutable = canvas as unknown as { clientWidth: number; clientHeight: number };
    mutable.clientWidth = 1024;
    mutable.clientHeight = 768;
    expect(() => gate.resize()).not.toThrow();
    expect(gate.camera.object.aspect).toBeCloseTo(1024 / 768, 9);
    gate.dispose();
  });
});

describe('findTerminatorPairs + buildGateTrials — integracja z prawdziwym planem trzech faz', () => {
  it('22. dla trzech różnych faz słońca istnieje co najmniej 5 par granicznych KAŻDA (buildGateTrials nie rzuca)', () => {
    // Nie testuje samej liczby (to już robi terminatorPairs.test.ts) — testuje, że KONKRETNIE
    // te trzy fazy, których użyje apps/client/src/gate.ts, faktycznie mają dość materiału.
    expect(() => realTrials(5)).not.toThrow();
    const trials = realTrials(5);
    expect(trials.length).toBe(15);
  });
});

describe('formatGateResultsMarkdown', () => {
  const make = (n: number, wrongAt: number[] = []): GateAnswerRecord[] =>
    Array.from({ length: n }, (_, i) => ({
      trialOrdinal: i,
      phaseIndex: Math.floor(i / 5),
      litCellId: i,
      darkCellId: 1000 + i,
      clickedCellId: wrongAt.includes(i) ? 1000 + i : i,
      correct: !wrongAt.includes(i),
    }));

  it('23. wszystkie poprawne z KOMPLETU prób -> zawiera "PASS" i poprawny licznik n/n', () => {
    const md = formatGateResultsMarkdown(make(15), 15);
    expect(md).toContain('PASS');
    expect(md).toContain('Wynik: 15/15');
  });

  it('24. choć jedna błędna -> "FAIL (n/m)", NIE "PASS"', () => {
    const md = formatGateResultsMarkdown(make(15, [7]), 15);
    expect(md).toContain('FAIL (14/15)');
    expect(md).not.toContain('PASS');
  });

  it('25. tabela ma jeden wiersz danych na odpowiedź (plus nagłówek i separator)', () => {
    const md = formatGateResultsMarkdown(make(3), 15);
    const lines = md.split('\n').filter((l) => l.startsWith('|'));
    expect(lines.length).toBe(2 + 3); // nagłówek + separator + 3 wiersze
  });

  it('29. log NIEPEŁNEGO przebiegu NIE może orzec PASS — trzy poprawne z piętnastu to nie 3/3', () => {
    // Zmierzone: poprzednia wersja liczyła werdykt wyłącznie z długości `answers`, więc log
    // trzech odpowiedzi drukował "Wynik: 3/3 — PASS". Ścieżka UI do tego nie dopuszczała, ale
    // to jest publiczne API pakietu, a jego wyjście jest ARTEFAKTEM, który człowiek wkleja do
    // dokumentu wyników (§7.2) — dokument dostawałby wtedy PASS za jedną piątą bramki.
    const md = formatGateResultsMarkdown(make(3), 15);
    expect(md).not.toContain('PASS');
    expect(md).toContain('NIEKOMPLETNE');
    expect(md).toContain('3 z 15');
    expect(md).toContain('Wynik: 3/15'); // mianownik to LICZBA PRÓB, nie liczba odpowiedzi

    // Nawet komplet trafień, ale niepełny — najbardziej zwodniczy przypadek: same "OK"
    // w tabeli, a mimo to żadnego werdyktu.
    expect(formatGateResultsMarkdown(make(14), 15)).not.toContain('PASS');
  });

  it('30. rzuca RangeError dla bezsensownej liczby prób i dla większej liczby odpowiedzi niż prób', () => {
    expect(() => formatGateResultsMarkdown(make(3), 0)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(3), -1)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(3), 2.5)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(16), 15)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(15), 15)).not.toThrow();
  });
});
