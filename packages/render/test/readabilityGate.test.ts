import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createPlanet, lightField, sunDirection, type Planet } from '@heliopolis/sim';
import {
  createReadabilityGate,
  formatGateResultsMarkdown,
  markerPosition,
  type GateAnswerRecord,
  type ReadabilityGate,
} from '../src/readabilityGate.js';
import { buildGateTrials, findTerminatorPairs, type GateTrial } from '../src/terminatorPairs.js';
import { lightBand } from '../src/shading.js';
import type { SceneRenderer } from '../src/scene.js';
import { createFakeCanvas } from './support/fakeCanvas.js';

const planet = createPlanet({ seed: 20260915 });
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

function createFakeRenderer(): SceneRenderer & { renderCalls: number; disposeCalls: number } {
  const renderer = {
    renderCalls: 0,
    disposeCalls: 0,
    render(): void {
      renderer.renderCalls++;
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

  it('23. wszystkie poprawne -> zawiera "PASS" i poprawny licznik n/n', () => {
    const md = formatGateResultsMarkdown(make(15));
    expect(md).toContain('PASS');
    expect(md).toContain('Wynik: 15/15');
  });

  it('24. choć jedna błędna -> "FAIL (n/m)", NIE "PASS"', () => {
    const md = formatGateResultsMarkdown(make(15, [7]));
    expect(md).toContain('FAIL (14/15)');
    expect(md).not.toContain('PASS');
  });

  it('25. tabela ma jeden wiersz danych na odpowiedź (plus nagłówek i separator)', () => {
    const md = formatGateResultsMarkdown(make(3));
    const lines = md.split('\n').filter((l) => l.startsWith('|'));
    expect(lines.length).toBe(2 + 3); // nagłówek + separator + 3 wiersze
  });
});
