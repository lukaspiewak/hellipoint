import { describe, expect, it } from 'vitest';
import {
  burnEscapeDepth,
  cellSpacing,
  terminatorCrossingTime,
  terminatorSpeedCells,
  terminatorSpeedWorld,
} from '../src/world/scale.js';

const N = 1442;
const T = 180;

describe('niezmiennik N2 — promień planety nie wpływa na rozgrywkę', () => {
  it('cellSpacing skaluje się LINIOWO z promieniem', () => {
    expect(cellSpacing(100, N)).toBeCloseTo(2 * cellSpacing(50, N), 10);
    expect(cellSpacing(1000, N)).toBeCloseTo(20 * cellSpacing(50, N), 10);
  });

  it('terminatorSpeedWorld skaluje się LINIOWO z promieniem', () => {
    expect(terminatorSpeedWorld(100, T)).toBeCloseTo(2 * terminatorSpeedWorld(50, T), 10);
    expect(terminatorSpeedWorld(1000, T)).toBeCloseTo(20 * terminatorSpeedWorld(50, T), 10);
  });

  it('przez co ich iloraz — czas pokonania komórki — od promienia NIE zależy', () => {
    const ratio = (r: number) => cellSpacing(r, N) / terminatorSpeedWorld(r, T);
    expect(ratio(50)).toBeCloseTo(ratio(100), 10);
    expect(ratio(100)).toBeCloseTo(ratio(1000), 10);
  });
});

describe('§4.3 — wartości odniesienia dla N=1442, T=180 s', () => {
  it('prędkość terminatora ≈ 0,348 kroku/s', () => {
    expect(terminatorSpeedCells(N, T)).toBeCloseTo(0.34798, 4);
  });

  it('czas przejazdu przez bazę zgadza się z tabelą ze specu', () => {
    expect(terminatorCrossingTime(5, T, N)).toBeCloseTo(14.369, 2);
    expect(terminatorCrossingTime(10, T, N)).toBeCloseTo(28.738, 2);
    expect(terminatorCrossingTime(15, T, N)).toBeCloseTo(43.106, 2);
  });

  it('czas przejazdu jest liniowy w szerokości bazy', () => {
    expect(terminatorCrossingTime(20, T, N)).toBeCloseTo(2 * terminatorCrossingTime(10, T, N), 9);
  });
});

describe('niezmiennik N3 — pas śmierci', () => {
  const term = terminatorSpeedCells(N, T);

  it('jednostka szybsza od terminatora ma dodatnią głębokość ucieczki', () => {
    expect(burnEscapeDepth(3, 0.8, term)).toBeGreaterThan(0);
  });

  it('jednostka WOLNIEJSZA od terminatora nigdy nie ucieka ze światła', () => {
    expect(burnEscapeDepth(8, 0.3, term)).toBeLessThanOrEqual(0);
  });

  it('jednostka o prędkości dokładnie terminatora ma zerową głębokość ucieczki', () => {
    expect(burnEscapeDepth(8, term, term)).toBeCloseTo(0, 12);
  });

  it('dłuższy burnTime oznacza głębszy pas ucieczki', () => {
    expect(burnEscapeDepth(6, 0.8, term)).toBeGreaterThan(burnEscapeDepth(3, 0.8, term));
  });
});
