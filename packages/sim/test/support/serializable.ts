/**
 * # SKANER NIEZMIENNIKA SERIALIZOWALNOŚCI — strukturalny, nie po kluczach
 *
 * Doc-comment `SimState` (state.ts) zakazuje trzymania w stanie `Infinity`/`NaN`,
 * `TypedArray` i `Map`/`Set`. Strażnikiem tego zakazu był dotąd test round-tripu JSON
 * porównujący `stateHash` PRZED i PO — ten widzi jednak WYŁĄCZNIE pola, które
 * `stateHash` czyta — oraz test kompletności `stateHash`, który startuje od
 * `Object.keys(state)`, czyli od kluczy NAJWYŻSZEGO POZIOMU.
 *
 * Obie te osie zostawiały tę samą dziurę: pole dołożone do `Unit`, `Building` albo
 * `PentagonState`. ZMIERZONE, zanim ten plik powstał: `Unit.pathDistance = Infinity`
 * (z literałami uzupełnionymi dokładnie tak, jak żąda kompilator) przechodziło
 * **744/744 testów przy czystym `tsc`**, a `JSON.parse(JSON.stringify(state))` zamieniało
 * je na `null` w 24 z 24 jednostek. Pathfinding Fazy 3 celuje wprost w tę dziurę:
 * odległość ścieżki na jednostce to pierwsza rzecz, którą się dopisuje, a doc-comment
 * `SimState` sam wskazuje wyjście BFS/Dijkstry jako źródło `Infinity`.
 *
 * Ten skaner chodzi po WARTOŚCIACH, nie po spisie pól — więc nie trzeba go aktualizować
 * przy każdym nowym polu. To jest cała jego wartość: lista, o której ktoś musi pamiętać,
 * jest dokładnie tym, co zawiodło.
 *
 * ## Czego NIE zgłasza i dlaczego
 *
 * - **`-0`.** Zmierzone: `stateHash` koduje liczby przez `DataView.setFloat64`, więc
 *   `stateHash(0) !== stateHash(-0)` — istniejący test round-tripu łapie `-0` w każdym
 *   HASZOWANYM polu. Poza tym `JSON` zamienia `-0` na `0`, a te dwie wartości są
 *   nierozróżnialne w arytmetyce tej symulacji (różni je wyłącznie znak `1/x`).
 *   Geometria legalnie produkuje `-0` i zgłaszanie go dałoby szum, nie sygnał.
 * - **Referencja współdzielona** (ten sam obiekt w dwóch miejscach). `JSON.stringify`
 *   radzi sobie z nią, duplikując obiekt — to nie jest cicha strata danych. Zgłaszany
 *   jest wyłącznie prawdziwy CYKL (obiekt będący własnym przodkiem), bo na nim
 *   `JSON.stringify` rzuca wyjątkiem.
 */

export type RodzajNaruszenia =
  | 'Infinity'
  | 'NaN'
  | 'TypedArray'
  | 'Map'
  | 'Set'
  | 'Date'
  | 'undefined'
  | 'bigint'
  | 'function'
  | 'symbol'
  | 'prototyp'
  | 'cykl';

export interface Naruszenie {
  rodzaj: RodzajNaruszenia;
  /** Pełna ścieżka do wartości, np. `state.units[3].pathDistance`. */
  sciezka: string;
  szczegol?: string;
}

export interface WynikSkanu {
  naruszenia: Naruszenie[];
  /**
   * Liczba odwiedzonych węzłów. Istnieje po to, żeby wywołujący mógł udowodnić, że skan
   * NIE był pusty: zero naruszeń na dwóch węzłach to nie jest wynik. Bez tego licznika
   * skaner puszczony na `createState` (puste `buildings`, zero jednostek) wyglądałby
   * dokładnie tak samo jak skan bogatego stanu.
   */
  wezlow: number;
}

/**
 * Chodzi po całym drzewie `korzen` i zwraca każdą wartość, której `JSON.parse(JSON
 * .stringify(...))` nie odtworzy wiernie.
 */
export function skanujSerializowalnosc(korzen: unknown, nazwaKorzenia = 'state'): WynikSkanu {
  const naruszenia: Naruszenie[] = [];
  // Odwiedzone: żeby graf skierowany acykliczny nie rozdmuchał skanu wykładniczo.
  // NIE służy do wykrywania cykli — patrz `przodkowie`.
  const odwiedzone = new WeakSet<object>();
  // Przodkowie NA BIEŻĄCEJ ŚCIEŻCE: tylko to jest cykl. Zbiór globalny myliłby
  // współdzieloną referencję (legalną) z cyklem (na którym `JSON.stringify` rzuca).
  const przodkowie = new Set<object>();
  let wezlow = 0;

  const zglos = (rodzaj: RodzajNaruszenia, sciezka: string, szczegol?: string): void => {
    naruszenia.push(szczegol === undefined ? { rodzaj, sciezka } : { rodzaj, sciezka, szczegol });
  };

  const idz = (v: unknown, sciezka: string): void => {
    wezlow++;

    if (typeof v === 'number') {
      if (Number.isNaN(v)) zglos('NaN', sciezka);
      else if (!Number.isFinite(v)) zglos('Infinity', sciezka, v > 0 ? 'Infinity' : '-Infinity');
      return;
    }
    // `undefined` znika z obiektu, a w TABLICY staje się `null` — w obu przypadkach po cichu.
    if (v === undefined) return zglos('undefined', sciezka);
    if (typeof v === 'bigint') return zglos('bigint', sciezka);
    if (typeof v === 'function') return zglos('function', sciezka);
    if (typeof v === 'symbol') return zglos('symbol', sciezka);
    if (v === null || typeof v !== 'object') return;

    if (przodkowie.has(v)) return zglos('cykl', sciezka);
    if (odwiedzone.has(v)) return;
    odwiedzone.add(v);

    if (ArrayBuffer.isView(v)) return zglos('TypedArray', sciezka, v.constructor.name);
    if (v instanceof Map) return zglos('Map', sciezka);
    if (v instanceof Set) return zglos('Set', sciezka);
    if (v instanceof Date) return zglos('Date', sciezka);

    przodkowie.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) idz(v[i], `${sciezka}[${i}]`);
    } else {
      // Instancja klasy przeżywa round-trip jako GOŁY obiekt: własne pola zostają,
      // prototyp (czyli metody) znika bez śladu. Zgłaszane, ale dopiero PO zejściu
      // w pola — żeby jeden taki obiekt nie zasłonił naruszeń pod sobą.
      const proto: unknown = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        zglos('prototyp', sciezka, (v.constructor as { name?: string } | undefined)?.name);
      }
      for (const [k, x] of Object.entries(v)) idz(x, `${sciezka}.${k}`);
    }
    przodkowie.delete(v);
  };

  idz(korzen, nazwaKorzenia);
  return { naruszenia, wezlow };
}
