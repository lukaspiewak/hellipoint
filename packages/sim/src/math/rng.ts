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
    // TA SAMA straż, co w konstruktorze wyżej (`if (… === 0) this.s[0] = 1`), tylko tutaj
    // ODRZUCA zamiast naprawiać. Powód różnicy: w konstruktorze stan zerowy to skrajnie
    // rzadki przypadek mieszania seeda, który wolno cicho podciągnąć; tutaj jest ZAWSZE
    // uszkodzonym wejściem — przez `fromState` wchodzi stan z migawki, czyli z JSON-a,
    // czyli spoza naszej kontroli. Cichy fix zamieniłby uszkodzony zapis na niezauważalnie
    // INNĄ sekwencję; brak straży (stan sprzed poprawki) daje jeszcze gorzej: xoshiro
    // w stanie zerowym jest punktem stałym i produkuje same zera NA ZAWSZE — zmierzone,
    // pięć pierwszych losowań z `fromState({seed:1, s:[0,0,0,0]})` to `0,0,0,0,0`.
    // W symulacji znaczyłoby to „`pickType` zawsze wybiera pierwszy typ z puli", czyli
    // fale bez ARMOR-ów i DISRUPTOR-ów, bez jednego błędu po drodze.
    //
    // Sprawdzana jest też SAMA OBECNOŚĆ czterech całkowitych słów: bez tego „wszystkie
    // zera" nie ma sensu jako pytanie (`undefined | undefined` to 0, więc śmieci
    // przechodziłyby przez test zerowości), a `Uint32Array.set` i tak po cichu
    // przycinałby ułamki i `undefined` do zera.
    const words = state?.s;
    if (
      !Array.isArray(words) || words.length !== 4 ||
      !words.every((w) => Number.isInteger(w)) ||
      ((words[0] | words[1] | words[2] | words[3]) === 0)
    ) {
      throw new RangeError(
        `Rng.fromState: invalid generator state ${JSON.stringify(state?.s)} — expected four integers, ` +
          'not all zero (xoshiro is a fixed point at all-zero and would emit 0 forever).',
      );
    }
    const rng = new Rng(state.seed);
    rng.s.set(words);
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
