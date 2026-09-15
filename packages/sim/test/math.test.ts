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

  it('nextInt mieści się w [0, maxExclusive) dla kilku wartości maxExclusive', () => {
    const r = new Rng(2026);
    // 6 (typ. liczba sąsiadów), 12 (frequency), 1430 (liczba heksagonów przy frequency 12) —
    // wartości realnie używane przez createPlanet do wyboru z tablic.
    for (const max of [2, 6, 12, 1430]) {
      for (let i = 0; i < 5_000; i++) {
        const v = r.nextInt(max);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(max);
      }
    }
  });

  it('nextInt z maxExclusive=1 zawsze daje 0 (przypadek brzegowy używany przez wybór komórki startowej)', () => {
    const r = new Rng(2027);
    for (let i = 0; i < 1000; i++) {
      expect(r.nextInt(1)).toBe(0);
    }
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

  it('getState/fromState: generator przywrócony z migawki kontynuuje IDENTYCZNĄ sekwencję', () => {
    const original = new Rng(2024);
    // Kilka wywołań PRZED migawką — migawka ma łapać bieżący stan generatora,
    // nie tylko seed, więc test musiałby wykryć implementację, która o tym zapomina.
    for (let i = 0; i < 7; i++) original.nextUint32();

    const snapshot = original.getState();
    const continuedFromOriginal = Array.from({ length: 20 }, () => original.nextUint32());

    const restored = Rng.fromState(snapshot);
    const continuedFromRestored = Array.from({ length: 20 }, () => restored.nextUint32());

    expect(continuedFromRestored).toEqual(continuedFromOriginal);
  });

  it('stan przetrwa JSON.stringify/JSON.parse — to jest cały sens tego kształtu', () => {
    const original = new Rng(777);
    for (let i = 0; i < 3; i++) original.nextUint32();

    const roundTripped = JSON.parse(JSON.stringify(original.getState()));
    const restored = Rng.fromState(roundTripped);

    const expected = Array.from({ length: 10 }, () => original.nextUint32());
    const actual = Array.from({ length: 10 }, () => restored.nextUint32());
    expect(actual).toEqual(expected);
  });

  it('fork() na przywróconym generatorze zgadza się z fork() na oryginale w tym samym punkcie', () => {
    const original = new Rng(55);
    for (let i = 0; i < 12; i++) original.nextUint32();

    const restored = Rng.fromState(original.getState());

    expect(restored.fork(STREAM.WAVES).nextUint32()).toBe(original.fork(STREAM.WAVES).nextUint32());
  });

  /**
   * RUNDA ZAMYKAJĄCA, #3. Konstruktor `Rng` ma straż na stan złożony z samych zer
   * (`if (… === 0) this.s[0] = 1`) — `fromState` jej NIE miał, a to właśnie przez
   * `fromState` wchodzi teraz stan z migawki, czyli z JSON-a, czyli spoza naszej kontroli.
   * Zmierzone: `Rng.fromState({seed:1, s:[0,0,0,0]})` produkowało `0,0,0,0,0` — xoshiro
   * jest w stanie zerowym punktem stałym i emituje zera NA ZAWSZE. W symulacji znaczyłoby
   * to „`pickType` zawsze bierze pierwszy typ z puli", czyli fale bez ARMOR-ów
   * i DISRUPTOR-ów, bez jednego błędu po drodze.
   */
  it('fromState odrzuca stan złożony z samych zer — xoshiro emitowałby wtedy zera na zawsze', () => {
    expect(() => Rng.fromState({ seed: 1, s: [0, 0, 0, 0] })).toThrow(RangeError);
    expect(() => Rng.fromState({ seed: 1, s: [0, 0, 0, 0] })).toThrow(/zero/);
    // Przesłanka: sam KONSTRUKTOR nie da się namówić na stan zerowy dla żadnego seeda —
    // czyli zerowa migawka NIE MOŻE pochodzić z prawidłowego zapisu, jest uszkodzeniem.
    for (const seed of [0, 1, -1, 12345, 2 ** 31]) {
      const w = new Rng(seed).getState().s;
      expect((w[0] | w[1] | w[2] | w[3]) === 0, `seed ${seed}`).toBe(false);
    }
    // Jedno niezerowe słowo wystarczy — straż jest o STANIE, nie o poszczególnych słowach.
    expect(() => Rng.fromState({ seed: 1, s: [0, 0, 0, 7] })).not.toThrow();
  });

  it('fromState odrzuca migawkę bez czterech całkowitych słów, zamiast po cichu przyciąć', () => {
    // Bez tej połowy „wszystkie zera" nie ma sensu jako pytanie: `undefined | undefined`
    // to 0, a `Uint32Array.set` i tak po cichu przycina ułamki i `undefined` do zera —
    // czyli śmieci zamieniałyby się w prawidłowo wyglądający generator.
    const zle = [
      { seed: 1, s: [1, 2, 3] },
      { seed: 1, s: [1, 2, 3, 4, 5] },
      { seed: 1, s: [1, 2, 3, 1.5] },
      { seed: 1, s: null },
      { seed: 1, s: '1,2,3,4' },
      {},
    ];
    for (const stan of zle) {
      expect(() => Rng.fromState(stan as never), JSON.stringify(stan)).toThrow(RangeError);
    }
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
