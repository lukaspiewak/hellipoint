import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { DEFAULT_SPAWN, updateSpawning } from '../src/sim/spawning.js';
import { Rng, STREAM } from '../src/math/rng.js';
import { BUILDINGS } from '../src/sim/defs.js';

const planet = createPlanet({ seed: 81 });
const N = planet.cells.length;

const allDark = new Float32Array(N).fill(0);
const allLit = new Float32Array(N).fill(1);

function fresh() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

/**
 * `seed` parametryzowany (domyślnie 999, jak w brief-ie zadania) — potrzebne do testu
 * "RNG zależy od seeda" niżej. Domyślna wartość zachowuje dokładnie zachowanie
 * wszystkich testów, które nie podają go jawnie.
 */
function run(s: ReturnType<typeof fresh>, light: Float32Array, seconds: number, cycle = 1, seed = 999) {
  const rng = new Rng(seed).fork(STREAM.WAVES);
  const ticks = Math.round(seconds / 0.05);
  for (let i = 0; i < ticks; i++) updateSpawning(s, light, rng, cycle, DEFAULT_SPAWN);
}

describe('updateSpawning', () => {
  it('pentagon w cieniu wypuszcza jednostki', () => {
    const s = fresh();
    run(s, allDark, 30);
    expect(s.units.length).toBeGreaterThan(0);
  });

  it('OŚWIETLONY pentagon nie wypuszcza nic (D1)', () => {
    const s = fresh();
    run(s, allLit, 60);
    expect(s.units).toHaveLength(0);
  });

  it('wszystkie jednostki pojawiają się na pentagonach, nigdy gdzie indziej', () => {
    const s = fresh();
    run(s, allDark, 30);
    const pentSet = new Set(planet.pentagons);
    for (const u of s.units) expect(pentSet.has(u.cellId)).toBe(true);
  });

  it('zatkany pentagon nie wypuszcza ciągłego strumienia', () => {
    const s = fresh();
    const capped = planet.pentagons[0];
    applyCommand(s, { kind: 'BUILD', cellId: capped, type: 'GEOTHERMAL_CAP' });

    // Krótkie okno, poniżej interwału erupcji — strumień powinien być zerowy.
    run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 0.5);
    expect(s.units.filter((u) => u.cellId === capped)).toHaveLength(0);
  });

  it('zatkany pentagon ERUPTUJE po upływie interwału — cap przekierowuje, nie kasuje (§5.3)', () => {
    const s = fresh();
    const capped = planet.pentagons[0];
    applyCommand(s, { kind: 'BUILD', cellId: capped, type: 'GEOTHERMAL_CAP' });

    run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.5);
    expect(s.units.filter((u) => u.cellId === capped).length).toBeGreaterThan(0);
  });

  /**
   * Hunt z raportu Taska 4: "Cooldown boundary" — test4/5 powyżej sprawdzają okna
   * WYGODNIE wewnątrz/na zewnątrz interwału (0,5× i 1,5×), nigdy dokładnie na granicy.
   * Ten test przypina moment PIERWSZEJ erupcji dokładnie: tick przed interwałem (0
   * jednostek), dokładnie na interwale (4 — `eruptionBurstBase` przy capCount=1) i
   * tick po (wciąż 4 — druga erupcja jest kolejny pełny interwał później, nie tick
   * później). Wartości zmierzone bezpośrednio na żywej implementacji (patrz
   * task-4-report.md) — 20 s / 0,05 s = 400 ticków, bez dryfu zmiennoprzecinkowego
   * między testowanymi ticka.
   */
  it('erupcja jest przypięta DOKŁADNIE do interwału — tick przed i tick po granicy', () => {
    const measure = (seconds: number) => {
      const s = fresh();
      const capped = planet.pentagons[0];
      applyCommand(s, { kind: 'BUILD', cellId: capped, type: 'GEOTHERMAL_CAP' });
      run(s, allDark, seconds);
      return s.units.filter((u) => u.cellId === capped).length;
    };

    expect(measure(DEFAULT_SPAWN.eruptionInterval - 0.05)).toBe(0);
    expect(measure(DEFAULT_SPAWN.eruptionInterval)).toBe(DEFAULT_SPAWN.eruptionBurstBase);
    expect(measure(DEFAULT_SPAWN.eruptionInterval + 0.05)).toBe(DEFAULT_SPAWN.eruptionBurstBase);
  });

  it('więcej capów ⇒ silniejsze erupcje', () => {
    const measure = (caps: number) => {
      const s = fresh();
      for (let i = 0; i < caps; i++) {
        applyCommand(s, { kind: 'BUILD', cellId: planet.pentagons[i], type: 'GEOTHERMAL_CAP' });
      }
      const target = planet.pentagons[0];
      run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.2);
      return s.units.filter((u) => u.cellId === target).length;
    };
    expect(measure(6)).toBeGreaterThan(measure(1));
  });

  /**
   * Hunt: "więcej capów ⇒ nie mniej jednostek" przeszedłby nawet przy STAŁEJ sile
   * erupcji. Ten test przypina DOKŁADNE liczby wynikające ze wzoru w spawning.ts
   * (`eruptionBurstBase * (1 + eruptionScalePerCap * (capCount - 1))`), zmierzone na
   * żywej implementacji: capCount=1 → 4, capCount=6 → round(4×(1+0,6×5)) = 16.
   * W oknie 1,2× interwału mieści się DOKŁADNIE jedna erupcja (druga byłaby dopiero
   * przy 2× interwału), więc te liczby to CAŁY wynik testu, nie jego dolna granica.
   */
  it('siła erupcji rośnie z liczbą capów wg dokładnego wzoru (nie tylko kierunek)', () => {
    const measure = (caps: number) => {
      const s = fresh();
      for (let i = 0; i < caps; i++) {
        applyCommand(s, { kind: 'BUILD', cellId: planet.pentagons[i], type: 'GEOTHERMAL_CAP' });
      }
      const target = planet.pentagons[0];
      run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.2);
      return s.units.filter((u) => u.cellId === target).length;
    };
    expect(measure(1)).toBe(4);
    expect(measure(6)).toBe(16);
  });

  it('przy WSZYSTKICH 12 zatkanych gra nadal generuje zagrożenie', () => {
    // Dowód, że allCapsOverloadTimeSeconds z draftu jest zbędną łatką:
    // erupcje są ciągłą krzywą, a 12 capów to po prostu jej koniec.
    const s = fresh();
    for (const p of planet.pentagons) {
      applyCommand(s, { kind: 'BUILD', cellId: p, type: 'GEOTHERMAL_CAP' });
    }
    run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.5);
    expect(s.units.length).toBeGreaterThan(0);
  });

  /**
   * Ten sam scenariusz co wyżej, ale z DOKŁADNĄ liczbą: 12 pentagonów × 30 jednostek
   * (round(4×(1+0,6×11)) = round(30,4) = 30) = 360. Test wyżej przeszedłby nawet
   * gdyby pojedyncza jednostka wyciekła z niezwiązanej przyczyny; ten pinuje liczbę,
   * więc regresja w formule burst/capCount pokazałaby się TU, nie tylko w dedykowanym
   * teście "siła erupcji" powyżej (który liczy tylko jeden, wybrany pentagon).
   */
  it('przy WSZYSTKICH 12 zatkanych — dokładna liczba jednostek, nie tylko ">0"', () => {
    const s = fresh();
    for (const p of planet.pentagons) {
      applyCommand(s, { kind: 'BUILD', cellId: p, type: 'GEOTHERMAL_CAP' });
    }
    run(s, allDark, DEFAULT_SPAWN.eruptionInterval * 1.5);
    expect(s.units.length).toBe(360);
  });

  it('wyższy cykl oznacza więcej wrogów', () => {
    const count = (cycle: number) => {
      const s = fresh();
      run(s, allDark, 30, cycle);
      return s.units.length;
    };
    expect(count(4)).toBeGreaterThan(count(1));
  });

  it('typy wroga odblokowują się wraz z cyklem', () => {
    const typesAt = (cycle: number) => {
      const s = fresh();
      run(s, allDark, 120, cycle);
      return new Set(s.units.map((u) => u.type));
    };
    expect(typesAt(1)).toEqual(new Set(['SWARM']));
    expect(typesAt(9).size).toBeGreaterThan(1);
  });

  it('jest deterministyczny względem seeda', () => {
    const go = () => {
      const s = fresh();
      run(s, allDark, 40);
      return s.units.map((u) => [u.type, u.cellId]);
    };
    expect(go()).toEqual(go());
  });

  /**
   * Hunt: "Czy jakikolwiek test przeszedłby z RNG podbitym do stałej?" Powyższy test
   * porównuje TEN SAM seed z samym sobą — przeszedłby nawet gdyby `pickType`
   * ignorował `rng` i zawsze zwracał ten sam typ (stały RNG jest trywialnie
   * deterministyczny). Ten test dodaje drugą połowę dowodu: RÓŻNE seedy muszą dać
   * RÓŻNY ciąg typów (cykl 9 odblokowuje 3 typy, więc jest co różnicować) — inaczej
   * strumień WAVES w ogóle nie bierze seeda pod uwagę.
   */
  it('strumień WAVES faktycznie zależy od seeda — różne seedy dają różny ciąg typów', () => {
    const typeSequence = (seed: number) => {
      const s = fresh();
      run(s, allDark, 20, 9, seed);
      return s.units.map((u) => u.type);
    };
    const a1 = typeSequence(999);
    const a2 = typeSequence(999);
    const b = typeSequence(1000);

    expect(a1.length).toBeGreaterThan(20); // próbka wystarczająco duża, by rozbieżność nie była przypadkiem
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
  });

  /**
   * Hunt: "Czy jakiś test dowodzi, że ułamek się KUMULUJE, a nie jest zerowany albo
   * podwójnie liczony?" Powyższy test #1 sprawdza tylko `> 0`. Tu: przy
   * `baseRatePerPentagon = 0,25`/s (poniżej 1/tick) pojedynczy, NIEZATKANY pentagon
   * musi wypuścić DOKŁADNIE floor(0,25 × 30) = 7 jednostek w 30 s — zmierzone na
   * żywej implementacji, 30 s dobrane celowo tak, by 0,25×30=7,5 leżało wygodnie
   * (0,5 od granicy) daleko od progu całkowitego, więc błąd zmiennoprzecinkowy
   * akumulacji (rzędu 1e-13 po 600 tickach) nie ma szans przesunąć wyniku.
   */
  it('spawnAccumulator kumuluje ułamek — dokładna liczba jednostek w oknie, nie tylko ">0"', () => {
    const s = fresh();
    const target = planet.pentagons[0];
    run(s, allDark, 30);
    expect(s.units.filter((u) => u.cellId === target)).toHaveLength(7);
  });
});
