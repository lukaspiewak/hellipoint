/**
 * Deterministyczny PRNG (xoshiro128**).
 * Stan trzymany wyłącznie na uint32 — żadnych liczb zmiennoprzecinkowych w stanie,
 * więc sekwencja jest identyczna na każdej platformie (§7.2 specu).
 */
export class Rng {
  private readonly seed: number;
  private readonly s = new Uint32Array(4);

  constructor(seed: number) {
    this.seed = seed | 0;
    let a = this.seed;
    for (let i = 0; i < 4; i++) {
      a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      this.s[i] = (t ^ (t >>> 15)) >>> 0;
    }
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }

  nextUint32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** [0, 1) */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** [0, maxExclusive) */
  nextInt(maxExclusive: number): number {
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  /**
   * Niezależny strumień dla jednego systemu. Wyprowadzany z ORYGINALNEGO seeda,
   * nie z bieżącego stanu — dzięki temu nie zależy od kolejności ani liczby
   * wywołań u rodzica.
   */
  fork(streamId: number): Rng {
    return new Rng((this.seed ^ Math.imul(streamId + 1, 0x9e3779b9)) | 0);
  }

  /**
   * Migawka pełnego stanu generatora: cztery słowa robocze xoshiro ORAZ seed.
   * Seed jest częścią migawki, nie tylko `s` — `fork()` zależy wyłącznie od
   * seeda (patrz wyżej), więc bez niego generator odtworzony z migawki dawałby
   * INNE poddrzewa strumieni niż oryginał w tym samym punkcie.
   *
   * Zwykła krotka liczb, nie Uint32Array — musi przetrwać JSON.stringify/parse
   * (zapis gry, resynchronizacja klienta/serwera), a TypedArray tego nie gwarantuje.
   */
  getState(): RngState {
    return { seed: this.seed, s: [this.s[0], this.s[1], this.s[2], this.s[3]] };
  }

  /**
   * Odtwarza generator z migawki `getState()`: kontynuuje IDENTYCZNĄ sekwencję
   * od miejsca, w którym migawka została zrobiona. Bez tego, odtworzenie
   * `SimState` po zapisie/resynchronizacji restartowałoby dowolny strumień
   * trzymany poza stanem (np. fale, Faza 1C) od pozycji zero i rozjeżdżało
   * spawny wobec serwera, który nie przestawał liczyć.
   */
  static fromState(state: RngState): Rng {
    const rng = new Rng(state.seed);
    rng.s.set(state.s);
    return rng;
  }
}

export interface RngState {
  readonly seed: number;
  readonly s: readonly [number, number, number, number];
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Jeden strumień na system (§7.2). Nowe systemy dopisywać, nigdy nie zmieniać istniejących wartości. */
export const STREAM = {
  ORE: 1,
  START: 2,
  WAVES: 3,
  DRAFT: 4,
} as const;
