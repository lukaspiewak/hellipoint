import { describe, expect, it } from 'vitest';
import { Mesh, Vector3, type BufferAttribute, type Color, type Scene } from 'three';
import { createPlanet, lightField, sunDirection } from '@heliopolis/sim';
import {
  createReadabilityGate,
  formatGateResultsMarkdown,
  markerPosition,
  type GateAnswerRecord,
  type GateMode,
  type GatePlans,
  type ReadabilityGate,
} from '../src/readabilityGate.js';
import { buildGateTrials, type GateTrial } from '../src/terminatorPairs.js';
import { buildPlanetGeometry } from '../src/geometry.js';
import { buildSmearedGeometry } from '../src/positiveControl.js';
import { DEFAULT_PALETTE, lightBand, writeCellColors } from '../src/shading.js';
import type { SceneRenderer } from '../src/scene.js';
import { createFakeCanvas } from './support/fakeCanvas.js';

const planet = createPlanet({ seed: 20260915 });
const sharedGeo = buildPlanetGeometry(planet);
const smearedGeo = buildSmearedGeometry(planet);
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const CELLS_PER_PHASE = 5;

const gateSunDirs = [0, 1 / 3, 2 / 3].map((f) => sunDirection(f * 180, 180));

/** Trzy rozłączne plany, dokładnie jak buduje je `apps/client/src/gate.ts`. */
function realPlans(cellsPerPhase = CELLS_PER_PHASE): GatePlans {
  return {
    threshold: buildGateTrials(planet, gateSunDirs, cellsPerPhase, 0),
    smooth: buildGateTrials(planet, gateSunDirs, cellsPerPhase, 1),
    control: buildGateTrials(planet, gateSunDirs, cellsPerPhase, 2),
  };
}

function createFakeRenderer(): SceneRenderer & { renderCalls: number; disposeCalls: number; lastScene: Scene | null } {
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

function makeGate(plans: GatePlans = realPlans()): {
  gate: ReadabilityGate;
  renderer: ReturnType<typeof createFakeRenderer>;
} {
  const renderer = createFakeRenderer();
  const gate = createReadabilityGate(planet, createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT), plans, () => renderer);
  return { gate, renderer };
}

/**
 * Siatki wyjęte ze SCENY, którą harness faktycznie przekazuje rendererowi — nie przez nowe
 * pole w API zbudowane pod test. Scena jest tym, co renderer dostaje do narysowania, więc
 * odczyt z niej sprawdza dokładnie to, co zobaczy człowiek.
 */
function meshesOf(gate: ReadabilityGate, renderer: { lastScene: Scene | null }): { flat: Mesh; smeared: Mesh } {
  gate.renderFrame();
  const scene = renderer.lastScene;
  if (!scene) throw new Error('test: renderer nie dostał sceny');
  const meshes = scene.children.filter((o): o is Mesh => o instanceof Mesh);
  const flat = meshes.find((m) => m.geometry.getAttribute('position').count === sharedGeo.positions.length / 3);
  const smeared = meshes.find((m) => m.geometry.getAttribute('position').count === smearedGeo.vertexCount);
  if (!flat || !smeared) throw new Error('test: brak którejś z dwóch siatek w scenie');
  return { flat, smeared };
}

function colorsOf(mesh: Mesh): Float32Array {
  return (mesh.geometry.getAttribute('color') as BufferAttribute).array as Float32Array;
}

function cellColorFlat(colors: Float32Array, cellId: number): [number, number, number] {
  const o = sharedGeo.cellVertexStart[cellId] * 3;
  return [colors[o], colors[o + 1], colors[o + 2]];
}

function cellColorSmeared(colors: Float32Array, cellId: number): [number, number, number] {
  return [colors[cellId * 3], colors[cellId * 3 + 1], colors[cellId * 3 + 2]];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const NIGHT = DEFAULT_PALETTE[0].map(Math.fround);
const isGreenDominant = (c: Color): boolean => c.g > c.r && c.g > c.b;
const isRedDominant = (c: Color): boolean => c.r > c.g && c.r > c.b;
const isNeutral = (c: Color): boolean => c.r === c.g && c.g === c.b;

/** Przechodzi cały plan aktywnego trybu, odpowiadając wg `strategy`. Zwraca log tego trybu. */
function runPlan(gate: ReadabilityGate, strategy: (trial: GateTrial) => boolean): readonly GateAnswerRecord[] {
  const mode = gate.mode();
  let guard = 0;
  while (!gate.isFinished() && guard <= gate.totalTrials) {
    const trial = gate.currentTrial();
    if (!trial) break;
    gate.answer(strategy(trial));
    gate.advance();
    guard++;
  }
  return gate.answersFor(mode);
}

describe('createReadabilityGate — konstrukcja i walidacja planów', () => {
  it('1. budowa harnessu zostawia Planet bit w bit identyczny', () => {
    const before = JSON.stringify(planet);
    const { gate } = makeGate();
    expect(JSON.stringify(planet)).toBe(before);
    gate.dispose();
  });

  it('2. rzuca RangeError, gdy którykolwiek plan jest pusty', () => {
    const plans = realPlans();
    for (const mode of ['threshold', 'smooth', 'control'] as const) {
      expect(() =>
        createReadabilityGate(planet, createFakeCanvas(), { ...plans, [mode]: [] }, () => createFakeRenderer()),
      ).toThrow(RangeError);
    }
    // Kontrola pozytywna: komplet niepustych planów NIE rzuca.
    const { gate } = makeGate(plans);
    gate.dispose();
  });

  it('3. rzuca RangeError, gdy plany mają różne długości — "piętnaście prób" musi znaczyć jedno', () => {
    const plans = realPlans();
    expect(() =>
      createReadabilityGate(planet, createFakeCanvas(), { ...plans, control: plans.control.slice(0, 14) }, () =>
        createFakeRenderer(),
      ),
    ).toThrow(RangeError);
  });

  it('4. [WŁASNOŚĆ KRYTYCZNA DLA KONTROLI] rzuca RangeError, gdy dwa plany dzielą komórkę w tej samej fazie', () => {
    // Plan kontrolny na komórce już odsłoniętej w planie ocenianym mierzyłby PAMIĘĆ
    // człowieka, nie czytelność renderu — czyli kontrola przestałaby móc oblać dokładnie
    // tam, gdzie cała jej wartość polega na tym, że może.
    const plans = realPlans();
    expect(() =>
      createReadabilityGate(planet, createFakeCanvas(), { ...plans, control: plans.threshold }, () =>
        createFakeRenderer(),
      ),
    ).toThrow(RangeError);

    // Kontrola pozytywna: plany z `buildGateTrials` o trzech różnych offsetach NIE rzucają —
    // więc powyższy rzut jest o rozłączność, nie o cokolwiek innego w walidacji.
    const { gate } = makeGate(plans);
    expect(gate.totalTrials).toBe(15);
    gate.dispose();
  });
});

describe('markerPosition — funkcja czysta', () => {
  it('5. wynik leży wzdłuż normalnej komórki, w niewielkiej dodatniej odległości od jej środka', () => {
    for (const cellId of [0, 733, planet.cells.length - 1]) {
      const cell = planet.cells[cellId];
      const pos = markerPosition(planet, cellId);
      const delta = new Vector3(pos.x - cell.center.x, pos.y - cell.center.y, pos.z - cell.center.z);
      expect(delta.length()).toBeGreaterThan(0);
      expect(delta.length()).toBeLessThan(planet.radius * 0.05);
      const normal = new Vector3(cell.normal.x, cell.normal.y, cell.normal.z);
      expect(delta.clone().normalize().dot(normal)).toBeGreaterThan(0.999);
    }
  });
});

describe('createReadabilityGate — znacznik nie zdradza odpowiedzi', () => {
  it('6. PRZED odpowiedzią znacznik ma tę samą, neutralną barwę i ten sam rozmiar w KAŻDEJ z 15 prób — także tych o komórkach ciemnych', () => {
    // Przy JEDNYM znaczniku (zamiast pary z Fazy 2A) każda jego własność zależna od tego, co
    // jest pod nim, byłaby wprost odpowiedzią na zadane pytanie.
    const { gate } = makeGate();
    let litTrials = 0;
    let darkTrials = 0;
    const scales = new Set<number>();
    for (let i = 0; i < gate.totalTrials; i++) {
      const trial = gate.currentTrial() as GateTrial;
      expect(isNeutral(gate.marker.material.color), `próba ${i + 1}`).toBe(true);
      expect(isGreenDominant(gate.marker.material.color)).toBe(false);
      expect(isRedDominant(gate.marker.material.color)).toBe(false);
      scales.add(gate.marker.scale.x);
      if (trial.lit) litTrials++;
      else darkTrials++;
      gate.answer(true);
      gate.advance();
    }
    // Kontrola pozytywna na sam test: obie klasy prób FAKTYCZNIE wystąpiły — inaczej
    // „neutralny w każdej próbie" byłoby prawdą trywialnie, dla planu z jedną stroną granicy.
    expect(litTrials).toBeGreaterThan(0);
    expect(darkTrials).toBeGreaterThan(0);
    expect(scales.size).toBe(1); // jeden rozmiar dla wszystkich prób
    expect([...scales][0]).toBeGreaterThan(0);
    gate.dispose();
  });

  it('7. znacznik stoi na komórce BIEŻĄCEJ próby aktywnego planu, a po wyczerpaniu planu znika', () => {
    const plans = realPlans();
    const { gate } = makeGate(plans);
    for (let i = 0; i < gate.totalTrials; i++) {
      const expected = markerPosition(planet, plans.threshold[i].cellId);
      expect(gate.marker.visible).toBe(true);
      expect(gate.marker.position.x).toBeCloseTo(expected.x, 6);
      expect(gate.marker.position.y).toBeCloseTo(expected.y, 6);
      expect(gate.marker.position.z).toBeCloseTo(expected.z, 6);
      gate.answer(true);
      gate.advance();
    }
    expect(gate.isFinished()).toBe(true);
    expect(gate.marker.visible).toBe(false); // nie zostaje na ostatniej komórce z odsłoniętą prawdą
    gate.dispose();
  });
});

describe('createReadabilityGate — answer(): scoring i odsłonięcie', () => {
  it('8. odpowiedź zgodna z prawdą symulacji daje correct:true, niezgodna false — obie gałęzie', () => {
    const plans = realPlans();
    for (const truthful of [true, false]) {
      const { gate } = makeGate(plans);
      const trial = gate.currentTrial() as GateTrial;
      const record = gate.answer(truthful ? trial.lit : !trial.lit) as GateAnswerRecord;
      expect(record).not.toBeNull();
      expect(record.correct).toBe(truthful);
      expect(record.cellId).toBe(trial.cellId);
      expect(record.actuallyLit).toBe(trial.lit);
      expect(record.answeredLit).toBe(truthful ? trial.lit : !trial.lit);
      expect(record.mode).toBe('threshold');
      expect(gate.isRevealed()).toBe(true);
      gate.dispose();
    }
  });

  it('9. odsłonięcie pokazuje PRAWDĘ, nie informację zwrotną: zielony ⟺ komórka faktycznie oświetlona, niezależnie od odpowiedzi', () => {
    // Zamiana obu kolorów odsłonięcia miejscami nie rusza `correct`, więc tabela nadal
    // drukowałaby PASS, a człowiek uczyłby się MIĘDZY próbami odwrotnej zasady.
    const plans = realPlans();
    let litSeen = 0;
    let darkSeen = 0;
    for (const answeredLit of [true, false]) {
      const { gate } = makeGate(plans);
      for (let i = 0; i < gate.totalTrials; i++) {
        const trial = gate.currentTrial() as GateTrial;
        expect(isNeutral(gate.marker.material.color)).toBe(true);
        gate.answer(answeredLit);
        expect(isGreenDominant(gate.marker.material.color), `próba ${i + 1}, odpowiedź ${answeredLit}`).toBe(trial.lit);
        expect(isRedDominant(gate.marker.material.color), `próba ${i + 1}, odpowiedź ${answeredLit}`).toBe(!trial.lit);
        if (trial.lit) litSeen++;
        else darkSeen++;
        gate.advance();
      }
      gate.dispose();
    }
    expect(litSeen).toBeGreaterThan(0); // kontrola: obie barwy odsłonięcia faktycznie wystąpiły
    expect(darkSeen).toBeGreaterThan(0);
  });

  it('10. druga odpowiedź na tę samą, już odsłoniętą próbę zwraca null i NIE dopisuje wpisu', () => {
    const { gate } = makeGate();
    expect(gate.answer(true)).not.toBeNull();
    expect(gate.answers().length).toBe(1);
    expect(gate.answer(false)).toBeNull();
    expect(gate.answers().length).toBe(1);
    gate.dispose();
  });

  it('11. advance() PRZED odsłonięciem nie robi nic; PO odsłonięciu przechodzi dalej i zeruje odsłonięcie', () => {
    const { gate } = makeGate();
    expect(gate.advance()).toBe(false);
    expect(gate.currentTrialIndex()).toBe(0);
    gate.answer(true);
    expect(gate.advance()).toBe(true);
    expect(gate.currentTrialIndex()).toBe(1);
    expect(gate.isRevealed()).toBe(false);
    gate.dispose();
  });

  it('12. [przebieg pełny] odpowiadanie zgodnie z prawdą daje komplet; advance() po ostatniej próbie zwraca false', () => {
    const { gate } = makeGate();
    let lastAdvance = true;
    for (let i = 0; i < gate.totalTrials; i++) {
      const trial = gate.currentTrial() as GateTrial;
      gate.answer(trial.lit);
      lastAdvance = gate.advance();
    }
    expect(lastAdvance).toBe(false);
    expect(gate.isFinished()).toBe(true);
    expect(gate.answers().length).toBe(15);
    expect(gate.answers().every((a) => a.correct)).toBe(true);
    gate.dispose();
  });

  it('13. [PODŁOGA ZGADYWANIA] stała odpowiedź "oświetlona" daje DOKŁADNIE 8/15, stała "ciemna" 7/15 — komplet nie jest osiągalny bez patrzenia', () => {
    // To jest liczba, na której stoi sens werdyktu „PASS wymaga kompletu piętnastu". Bramka
    // Fazy 2A miała tę własność z innego powodu (wymuszony wybór dwóch alternatyw); tutaj
    // niesie ją przeplot jasna/ciemna w `buildGateTrials` i trzeba jej pilnować osobno.
    const alwaysLit = makeGate();
    expect(runPlan(alwaysLit.gate, () => true).filter((a) => a.correct).length).toBe(8);
    alwaysLit.gate.dispose();

    const alwaysDark = makeGate();
    expect(runPlan(alwaysDark.gate, () => false).filter((a) => a.correct).length).toBe(7);
    alwaysDark.gate.dispose();
  });
});

describe('createReadabilityGate — tryby: rozdział logów i przemalowanie', () => {
  it('14. odpowiedzi z trybów NIEOCENIANYCH nie trafiają do answers() — werdykt nie może się nimi zanieczyścić', () => {
    const { gate } = makeGate();
    for (const mode of ['smooth', 'control'] as const) {
      gate.setMode(mode);
      gate.answer(true);
      gate.advance();
      expect(gate.answersFor(mode).length).toBe(1);
    }
    expect(gate.answers()).toEqual([]); // ani jednego wpisu w logu ocenianym
    gate.setMode('threshold');
    gate.answer(true);
    expect(gate.answers().length).toBe(1);
    expect(gate.answers()[0].mode).toBe('threshold');
    gate.dispose();
  });

  it('15. każdy tryb ma WŁASNY kursor: przełączenie tam i z powrotem nie gubi postępu ocenianego planu', () => {
    const { gate } = makeGate();
    gate.answer(true);
    gate.advance();
    expect(gate.currentTrialIndex()).toBe(1);
    gate.setMode('control');
    expect(gate.currentTrialIndex()).toBe(0); // własny kursor planu kontrolnego
    gate.setMode('threshold');
    expect(gate.currentTrialIndex()).toBe(1);
    expect(gate.answers().length).toBe(1);
    gate.dispose();
  });

  it('16. tryb kontrolny pokazuje siatkę ze WSPÓŁDZIELONYMI wierzchołkami, pozostałe — siatkę gry; zawsze dokładnie jedna jest widoczna', () => {
    const { gate, renderer } = makeGate();
    const { flat, smeared } = meshesOf(gate, renderer);
    const visibility: Record<string, [boolean, boolean]> = {};
    for (const mode of ['threshold', 'smooth', 'control'] as const) {
      gate.setMode(mode);
      gate.renderFrame();
      visibility[mode] = [flat.visible, smeared.visible];
      expect(flat.visible !== smeared.visible, `tryb ${mode}`).toBe(true);
    }
    expect(visibility).toEqual({
      threshold: [true, false],
      smooth: [true, false],
      control: [false, true],
    });
    gate.dispose();
  });

  it('17. KAŻDA próba maluje planetę światłem SWOJEJ fazy — bufor kolorów zgadza się co do bitu z policzonym niezależnie', () => {
    // Usunięcie przemalowania zostawiało w Fazie 2A CAŁĄ gałąź zieloną, a człowiek oglądałby
    // próby 6-15 w świetle fazy 1 — najdroższy możliwy tryb awarii tego pliku: on wyprodukował
    // werdykt na D1.
    const plans = realPlans();
    const { gate, renderer } = makeGate(plans);
    const colors = colorsOf(meshesOf(gate, renderer).flat);

    const bufferForTrial = (i: number): Float32Array => {
      const buf = new Float32Array(sharedGeo.positions.length);
      writeCellColors(sharedGeo, lightField(planet, plans.threshold[i].sunDir), buf, DEFAULT_PALETTE);
      return buf;
    };
    // KONTROLA POZYTYWNA na sam test: fazy dają RÓŻNE bufory, inaczej porównanie niżej
    // przechodziłoby także dla harnessu, który maluje raz i nigdy nie odświeża.
    expect(Array.from(bufferForTrial(0))).not.toEqual(Array.from(bufferForTrial(5)));
    expect(Array.from(bufferForTrial(5))).not.toEqual(Array.from(bufferForTrial(10)));

    let checked = 0;
    for (let i = 0; i < plans.threshold.length; i++) {
      expect(gate.currentTrialIndex()).toBe(i);
      const expected = bufferForTrial(i);
      let mismatches = 0;
      for (let k = 0; k < expected.length; k++) if (colors[k] !== expected[k]) mismatches++;
      expect(mismatches, `próba ${i + 1} (faza ${plans.threshold[i].phaseIndex + 1})`).toBe(0);
      checked++;
      gate.answer(true);
      gate.advance();
    }
    expect(checked).toBe(plans.threshold.length);
    gate.dispose();
  });
});

describe('createReadabilityGate — co WIDAĆ pod znacznikiem: tryb oceniany kontra kontrola pozytywna', () => {
  it('18. [SEDNO BRAMKI] w trybie progowanym komórka oświetlona jest odległa o PEŁNY skok palety od barwy nocy, a ciemna leży na niej dokładnie', () => {
    const plans = realPlans();
    const { gate, renderer } = makeGate(plans);
    const colors = colorsOf(meshesOf(gate, renderer).flat);

    let litChecked = 0;
    let darkChecked = 0;
    let minLitDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < plans.threshold.length; i++) {
      const trial = plans.threshold[i];
      const d = distance(cellColorFlat(colors, trial.cellId), NIGHT);
      if (trial.lit) {
        expect(d, `próba ${i + 1}, komórka ${trial.cellId}`).toBeGreaterThan(0.5);
        minLitDistance = Math.min(minLitDistance, d);
        litChecked++;
      } else {
        expect(d, `próba ${i + 1}, komórka ${trial.cellId}`).toBe(0);
        darkChecked++;
      }
      gate.answer(true);
      gate.advance();
    }
    expect(litChecked).toBe(8);
    expect(darkChecked).toBe(7);
    console.log(`[BRAMKA] tryb progowany: najmniejsza odległość komórki oświetlonej od nocy = ${minLitDistance.toFixed(4)}`);
    gate.dispose();
  });

  it('19. [KONTROLA POZYTYWNA] w trybie kontrolnym ta sama miara zapada się o rząd wielkości — barwa komórki przestaje odpowiadać na pytanie bramki', () => {
    // To jest liczbowy odpowiednik tego, co człowiek ma zobaczyć: w trybie ocenianym barwa
    // pod pierścieniem odpowiada na pytanie wprost; w kontroli nie niesie już tej informacji.
    // Gdyby ta liczba była porównywalna z trybem progowanym, kontrola NIE odtwarzałaby awarii
    // Fazy 0 i wynik bramki nic by nie znaczył.
    const plans = realPlans();
    const { gate, renderer } = makeGate(plans);
    gate.setMode('control');
    const colors = colorsOf(meshesOf(gate, renderer).smeared);

    let maxLitDistance = 0;
    let litChecked = 0;
    for (let i = 0; i < plans.control.length; i++) {
      const trial = plans.control[i];
      const d = distance(cellColorSmeared(colors, trial.cellId), NIGHT);
      if (trial.lit) {
        maxLitDistance = Math.max(maxLitDistance, d);
        litChecked++;
      } else {
        expect(d, `próba ${i + 1} (ciemna)`).toBe(0);
      }
      gate.answer(true);
      gate.advance();
    }
    expect(litChecked).toBe(8);
    console.log(`[KONTROLA] tryb kontrolny: NAJWIĘKSZA odległość komórki oświetlonej od nocy = ${maxLitDistance.toFixed(4)}`);
    // Zmierzone: kontrola ≤ 0,16 wobec 0,90 w trybie ocenianym, czyli co najmniej 5× mniej.
    expect(maxLitDistance).toBeLessThan(0.2);
    expect(maxLitDistance).toBeGreaterThan(0); // i nie jest zerem — kontrola coś rysuje, nie jest czarna
  });

  it('20. w trybie kontrolnym kolor jest zapisywany PER WIERZCHOŁEK siatki współdzielonej, więc granica nie ma ani jednej nieciągłości', () => {
    const { gate, renderer } = makeGate();
    gate.setMode('control');
    const { smeared } = meshesOf(gate, renderer);
    const colors = colorsOf(smeared);
    expect(colors.length).toBe(smearedGeo.vertexCount * 3);

    const trial = gate.currentTrial() as GateTrial;
    const light = lightField(planet, trial.sunDir);
    let maxNeighborStep = 0;
    for (const cell of planet.cells) {
      for (const n of cell.neighbors) {
        if (n <= cell.id) continue;
        maxNeighborStep = Math.max(
          maxNeighborStep,
          distance(cellColorSmeared(colors, cell.id), cellColorSmeared(colors, n)),
        );
      }
    }
    // Kontrola pozytywna: w tym samym świetle render gry MA pełny skok na granicy — więc
    // mała liczba wyżej jest własnością kontroli, nie tej fazy słońca.
    const pair = planet.cells.find((c) => c.neighbors.some((n) => (light[n] > 0) !== (light[c.id] > 0)));
    expect(pair).toBeDefined();
    const flatBuf = new Float32Array(sharedGeo.positions.length);
    writeCellColors(sharedGeo, light, flatBuf, DEFAULT_PALETTE);
    const other = (pair as { id: number; neighbors: readonly number[] }).neighbors.find(
      (n) => (light[n] > 0) !== (light[(pair as { id: number }).id] > 0),
    ) as number;
    const flatStep = distance(
      cellColorFlat(flatBuf, (pair as { id: number }).id),
      cellColorFlat(flatBuf, other),
    );
    expect(flatStep).toBeGreaterThan(0.5);
    expect(maxNeighborStep).toBeLessThan(flatStep / 5);
    gate.dispose();
  });
});

describe('createReadabilityGate — renderFrame/resize/dispose', () => {
  it('21. renderFrame() faktycznie woła renderer.render()', () => {
    const { gate, renderer } = makeGate();
    const before = renderer.renderCalls;
    gate.renderFrame();
    gate.renderFrame();
    expect(renderer.renderCalls).toBe(before + 2);
    gate.dispose();
  });

  it('22. dispose() nie rzuca i zwalnia renderer', () => {
    const { gate, renderer } = makeGate();
    expect(() => gate.dispose()).not.toThrow();
    expect(renderer.disposeCalls).toBe(1);
  });

  it('23. resize() przelicza proporcje kamery', () => {
    const canvas = createFakeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const gate = createReadabilityGate(planet, canvas, realPlans(), () => createFakeRenderer());
    const mutable = canvas as unknown as { clientWidth: number; clientHeight: number };
    mutable.clientWidth = 1024;
    mutable.clientHeight = 768;
    expect(() => gate.resize()).not.toThrow();
    expect(gate.camera.object.aspect).toBeCloseTo(1024 / 768, 9);
    gate.dispose();
  });
});

describe('formatGateResultsMarkdown', () => {
  const make = (n: number, wrongAt: number[] = [], mode: GateMode = 'threshold'): GateAnswerRecord[] =>
    Array.from({ length: n }, (_, i) => {
      const actuallyLit = i % 2 === 0;
      const wrong = wrongAt.includes(i);
      return {
        mode,
        trialOrdinal: i,
        phaseIndex: Math.floor(i / 5),
        cellId: 100 + i,
        actuallyLit,
        answeredLit: wrong ? !actuallyLit : actuallyLit,
        correct: !wrong,
      };
    });

  it('24. komplet poprawnych z KOMPLETU prób → "PASS" i licznik n/n', () => {
    const md = formatGateResultsMarkdown(make(15), 15);
    expect(md).toContain('PASS');
    expect(md).toContain('Wynik: 15/15');
  });

  it('25. choć jedna błędna → "FAIL (n/m)", NIE "PASS"', () => {
    const md = formatGateResultsMarkdown(make(15, [7]), 15);
    expect(md).toContain('FAIL (14/15)');
    expect(md).not.toContain('PASS');
  });

  it('26. tabela ma jeden wiersz danych na odpowiedź (plus nagłówek i separator)', () => {
    const lines = formatGateResultsMarkdown(make(3), 15)
      .split('\n')
      .filter((l) => l.startsWith('|'));
    expect(lines.length).toBe(2 + 3);
  });

  it('27. log NIEPEŁNEGO przebiegu NIE może orzec PASS — trzy poprawne z piętnastu to nie 3/3', () => {
    const md = formatGateResultsMarkdown(make(3), 15);
    expect(md).not.toContain('PASS');
    expect(md).toContain('NIEKOMPLETNE');
    expect(md).toContain('3 z 15');
    expect(md).toContain('Wynik: 3/15'); // mianownik to LICZBA PRÓB, nie liczba odpowiedzi
    expect(formatGateResultsMarkdown(make(14), 15)).not.toContain('PASS'); // komplet trafień, ale niepełny
  });

  it('28. log trybu NIEOCENIANEGO jest wyraźnie oznaczony — tabela z kontroli nie może udawać werdyktu', () => {
    const md = formatGateResultsMarkdown(make(15, [], 'control'), 15);
    expect(md).toContain('Tryb: control');
    expect(md).toContain('NIE JEST oceniany');
    // Kontrola pozytywna: ta sama tabela w trybie ocenianym tej adnotacji NIE ma.
    expect(formatGateResultsMarkdown(make(15), 15)).not.toContain('NIE JEST oceniany');
  });

  it('29. rzuca RangeError dla bezsensownej liczby prób, nadmiaru odpowiedzi i logu z pomieszanych trybów', () => {
    expect(() => formatGateResultsMarkdown(make(3), 0)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(3), -1)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(3), 2.5)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(16), 15)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown([...make(2), ...make(2, [], 'control')], 15)).toThrow(RangeError);
    expect(() => formatGateResultsMarkdown(make(15), 15)).not.toThrow();
  });

  it('30. tabela niesie PRAWDĘ i ODPOWIEDŹ osobno — z samego "OK/BŁĄD" nie da się odtworzyć, po której stronie granicy leżała komórka', () => {
    const md = formatGateResultsMarkdown(make(2, [1]), 15);
    expect(md).toContain('| 1 | 1 | 100 | oświetlona | oświetlona | OK |');
    expect(md).toContain('| 2 | 1 | 101 | ciemna | oświetlona | BŁĄD |');
  });
});

describe('spójność renderu z symulacją na komórkach, o które pyta bramka', () => {
  it('31. dla KAŻDEJ komórki KAŻDEJ próby: pasmo 0 renderu ⟺ symulacja uznaje komórkę za nieoświetloną', () => {
    // Bramka pokazuje człowiekowi kolor renderu, a scoruje prawdą symulacji. Gdyby te dwie
    // granice się rozjechały (jak przy `LIGHT_BANDS[0] = 0,05` w Fazie 2A — 8 do 38 komórek
    // różnicy), człowiek odpowiadałby poprawnie „co widzę" i dostawał BŁĄD.
    const plans = realPlans();
    let checked = 0;
    for (const mode of ['threshold', 'smooth', 'control'] as const) {
      for (const trial of plans[mode]) {
        const light = lightField(planet, trial.sunDir);
        expect(lightBand(light[trial.cellId]) === 0, `komórka ${trial.cellId}`).toBe(!trial.lit);
        checked++;
      }
    }
    expect(checked).toBe(45);
  });
});
