import { describe, expect, it } from 'vitest';
import { createRollingWindow, median, percentile } from '../src/frameStats.js';

describe('median', () => {
  it('1. nieparzysta długość: zwraca DOKŁADNIE środkowy element po posortowaniu', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('2. parzysta długość: zwraca średnią dwóch środkowych, nie dowolną z nich', () => {
    // Kontrola pozytywna na sam test: dwie skrajnie różne wartości — gdyby implementacja
    // zwracała jedną z nich zamiast średniej, ten test by to złapał (1 !== 100, 100 !== 1).
    expect(median([1, 100])).toBe(50.5);
    expect(median([100, 1])).toBe(50.5); // kolejność wejścia nie ma znaczenia
  });

  it('3. jeden element: zwraca ten element', () => {
    expect(median([42])).toBe(42);
  });

  it('4. NIE mutuje tablicy wejściowej (main.ts woła to co klatkę na własnym buforze historii)', () => {
    const input = [5, 3, 1, 4, 2];
    const copy = [...input];
    median(input);
    expect(input).toEqual(copy);
  });

  it('5. rzuca RangeError dla pustej tablicy', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('percentile', () => {
  it('6. p=0 daje minimum, p=100 daje maksimum', () => {
    const values = [7, 2, 9, 4, 1];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 100)).toBe(9);
  });

  it('7. p=50 równa się DOKŁADNIE median() dla tych samych danych — nieparzyste i parzyste długości', () => {
    // Load-bearing: main.ts pokazuje graczowi "mediana" liczoną przez median() i "p95" liczone
    // przez percentile() — gdyby te dwie funkcje miały niespójną arytmetykę wewnątrz, słowo
    // "mediana" na ekranie i w budget.test.ts mogłoby znaczyć dwie różne liczby.
    const odd = [9, 1, 5, 3, 7];
    const even = [8, 1, 5, 3, 7, 2];
    expect(percentile(odd, 50)).toBe(median(odd));
    expect(percentile(even, 50)).toBe(median(even));
  });

  it('8. interpoluje liniowo między dwoma sąsiednimi próbkami, gdy ranga nie jest liczbą całkowitą', () => {
    // 4 próbki => ranga dla p=75 to 0,75*(4-1) = 2,25 => interpolacja między sorted[2] i sorted[3].
    const values = [10, 20, 30, 40];
    // sorted = [10,20,30,40]; rank=2.25 -> 30 + 0.25*(40-30) = 32.5
    expect(percentile(values, 75)).toBeCloseTo(32.5, 9);
  });

  it('9. NIE mutuje tablicy wejściowej', () => {
    const input = [9, 1, 5, 3, 7];
    const copy = [...input];
    percentile(input, 95);
    expect(input).toEqual(copy);
  });

  it('10. rzuca RangeError dla pustej tablicy i dla p poza [0,100]', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], -1)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], 101)).toThrow(RangeError);
  });
});

describe('createRollingWindow', () => {
  it('11. rzuca RangeError dla pojemności niedodatniej albo niecałkowitej', () => {
    expect(() => createRollingWindow(0)).toThrow(RangeError);
    expect(() => createRollingWindow(-3)).toThrow(RangeError);
    expect(() => createRollingWindow(2.5)).toThrow(RangeError);
  });

  it('12. przed zapełnieniem: length rośnie z każdym push, snapshot zwraca DOKŁADNIE to, co wpisano, w kolejności wpisywania', () => {
    const win = createRollingWindow(5);
    expect(win.length).toBe(0);
    win.push(10);
    win.push(20);
    win.push(30);
    expect(win.length).toBe(3);
    expect(win.snapshot()).toEqual([10, 20, 30]);
  });

  it('13. po przekroczeniu pojemności: nadpisuje NAJSTARSZĄ próbkę, length zostaje przy capacity', () => {
    const win = createRollingWindow(3);
    win.push(1);
    win.push(2);
    win.push(3);
    win.push(4); // nadpisuje "1"
    expect(win.length).toBe(3);
    expect(win.snapshot()).toEqual([2, 3, 4]);

    win.push(5); // nadpisuje "2"
    expect(win.snapshot()).toEqual([3, 4, 5]);
  });

  it('14. [kontrola pozytywna testu 13] okno o pojemności 1 trzyma WYŁĄCZNIE ostatnią próbkę', () => {
    // Gdyby "nadpisywanie najstarszej" było w rzeczywistości "ignorowaniem nowych" (defekt,
    // który test 13 mógłby przeoczyć przy niefortunnym doborze liczb), ten przypadek graniczny
    // by to obnażył: snapshot musi śledzić NAJNOWSZĄ wartość, nie pierwszą.
    const win = createRollingWindow(1);
    win.push(1);
    win.push(2);
    win.push(3);
    expect(win.snapshot()).toEqual([3]);
  });

  it('15. snapshot() zwraca KOPIĘ — dopisanie do zwróconej tablicy nie zmienia stanu okna', () => {
    const win = createRollingWindow(3);
    win.push(1);
    win.push(2);
    const snap = win.snapshot();
    snap.push(999);
    expect(win.snapshot()).toEqual([1, 2]);
  });
});
