import { describe, expect, it } from 'vitest';
import { Rng, STREAM } from '../src/math/rng.js';
import { cross, dot, length, normalize, sub, vec3 } from '../src/math/vec3.js';

describe('Rng', () => {
  it('ten sam seed daje tę samą sekwencję', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 50 }, () => a.nextUint32());
    const seqB = Array.from({ length: 50 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it('różne seedy dają różne sekwencje', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it('nextFloat mieści się w [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextFloat ma sensowną średnią (test dymu na rozkład)', () => {
    const r = new Rng(99);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) sum += r.nextFloat();
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it('fork jest niezależny od tego, jak daleko zaawansował rodzic', () => {
    const parentEarly = new Rng(42);
    const forkEarly = parentEarly.fork(STREAM.ORE).nextUint32();

    const parentLate = new Rng(42);
    for (let i = 0; i < 1000; i++) parentLate.nextUint32();
    const forkLate = parentLate.fork(STREAM.ORE).nextUint32();

    expect(forkEarly).toBe(forkLate);
  });

  it('różne strumienie są różne', () => {
    const p = new Rng(42);
    expect(p.fork(STREAM.ORE).nextUint32()).not.toBe(p.fork(STREAM.START).nextUint32());
  });
});

describe('vec3', () => {
  it('normalize daje długość 1', () => {
    expect(length(normalize(vec3(3, 4, 12)))).toBeCloseTo(1, 12);
  });

  it('cross jest prostopadły do obu argumentów', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(-4, 5, 6);
    const c = cross(a, b);
    expect(dot(c, a)).toBeCloseTo(0, 10);
    expect(dot(c, b)).toBeCloseTo(0, 10);
  });

  it('sub odwraca add', () => {
    const a = vec3(1, 2, 3);
    expect(sub(a, a)).toEqual(vec3(0, 0, 0));
  });
});
