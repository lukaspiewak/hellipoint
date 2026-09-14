import { describe, expect, it } from 'vitest';
import { lightAt, lightField, sunDirection } from '../src/sim/light.js';
import { length, vec3 } from '../src/math/vec3.js';
import { createPlanet } from '../src/world/planet.js';

const T = 180;

describe('sunDirection', () => {
  it('jest wektorem jednostkowym w każdej chwili', () => {
    for (const t of [0, 45, 90, 123.4, T, 2 * T]) {
      expect(length(sunDirection(t, T))).toBeCloseTo(1, 12);
    }
  });

  it('ma okres równy okresowi obrotu', () => {
    const a = sunDirection(37, T);
    const b = sunDirection(37 + T, T);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
  });

  it('po pół okresie wskazuje przeciwnie', () => {
    const a = sunDirection(0, T);
    const b = sunDirection(T / 2, T);
    expect(b.x).toBeCloseTo(-a.x, 9);
    expect(b.y).toBeCloseTo(-a.y, 9);
    expect(b.z).toBeCloseTo(-a.z, 9);
  });

  it('wyrzuca błąd dla rotationPeriod <= 0 lub nieskończonego', () => {
    expect(() => sunDirection(0, 0)).toThrow(RangeError);
    expect(() => sunDirection(0, -180)).toThrow(RangeError);
    expect(() => sunDirection(0, NaN)).toThrow(RangeError);
    expect(() => sunDirection(0, Infinity)).toThrow(RangeError);
    expect(() => sunDirection(0, -Infinity)).toThrow(RangeError);
  });

  // Regresja na Important #3 z przeglądu końcowego Fazy 1B: odłożone wcześniej na
  // fałszywej przesłance "nieskończoność da głośny NaN". Zmierzone: nie daje — `lightAt`
  // robi `d > 0 ? d : 0`, a `NaN > 0` jest `false`, więc CAŁA planeta cicho ląduje na
  // dokładnym 0.0 (trwała ciemność, zero komórek z NaN) — bajt w bajt ten sam tryb
  // awarii co `rotationPeriod = 0`, który kosztował tę fazę dwie rundy.
  it('wyrzuca błąd dla elapsedSeconds NaN lub nieskończonego', () => {
    expect(() => sunDirection(NaN, T)).toThrow(RangeError);
    expect(() => sunDirection(Infinity, T)).toThrow(RangeError);
    expect(() => sunDirection(-Infinity, T)).toThrow(RangeError);
  });
});

describe('lightAt', () => {
  const sun = vec3(1, 0, 0);

  it('daje 1 zwrócone prosto w słońce', () => {
    expect(lightAt(vec3(1, 0, 0), sun)).toBeCloseTo(1, 12);
  });

  it('daje 0 na terminatorze', () => {
    expect(lightAt(vec3(0, 0, 1), sun)).toBeCloseTo(0, 12);
  });

  it('daje wartość pośrednią dla kąta pośredniego', () => {
    // Normal at 60° to sun: cos(60°) = 0.5
    expect(lightAt(vec3(0.5, 0, 0.866), sun)).toBeCloseTo(0.5, 12);
  });

  it('obcina stronę nocną do 0, nigdy do wartości ujemnej', () => {
    expect(lightAt(vec3(-1, 0, 0), sun)).toBe(0);
    expect(lightAt(vec3(-0.5, 0, 0.866), sun)).toBe(0);
  });
});

describe('lightField', () => {
  const planet = createPlanet({ seed: 5 });

  it('daje jedną wartość na komórkę, wszystkie w [0,1]', () => {
    const f = lightField(planet, sunDirection(0, T));
    expect(f.length).toBe(planet.cells.length);
    for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('dzieli planetę na mniej więcej równe połowy — brak możliwości globalnej nocy (D1)', () => {
    // Test validates that the lit/dark split is roughly even (~50/50),
    // disproving a "global night phase". Orientation is pinned by lightAt tests.
    const f = lightField(planet, sunDirection(0, T));
    const lit = [...f].filter((v) => v > 0).length;
    expect(lit / f.length).toBeGreaterThan(0.45);
    expect(lit / f.length).toBeLessThan(0.55);
  });

  it('po pół obrocie oświetlone są dokładnie te komórki, które były ciemne', () => {
    const a = lightField(planet, sunDirection(0, T));
    const b = lightField(planet, sunDirection(T / 2, T));
    for (let i = 0; i < a.length; i++) {
      if (a[i] > 0.01) expect(b[i]).toBeLessThan(0.02);
    }
  });
});
