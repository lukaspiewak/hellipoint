/**
 * Statystyki czasu klatki — funkcje czyste, zero Three.js, zero DOM. Używane w DWÓCH
 * miejscach naraz (Zadanie 5): (1) `apps/client/src/main.ts` (licznik klatek na ekranie,
 * Krok 2 briefu) i (2) `packages/render/test/budget.test.ts` (mediana `writeCellColors`,
 * Krok 1 briefu). Jedno źródło arytmetyki dla obu — inaczej dwie niezależnie napisane
 * implementacje mediany mogłyby dawać RÓŻNE liczby dla tych samych danych, a wtedy "mediana
 * poniżej 1 ms" z testu i "mediana" pokazywana graczowi na ekranie przestałyby znaczyć to samo
 * słowo.
 */

/**
 * Mediana. Kopiuje wejście przed sortowaniem (`[...values].sort`) — NIE mutuje tablicy
 * wywołującego. To ma znaczenie tu bardziej niż gdzie indziej: `main.ts` woła to co klatkę
 * na buforze czasów klatki, który MUSI przetrwać wywołanie nietknięty, żeby kolejna klatka
 * dopisywała do prawdziwej historii, a nie do przesortowanej.
 *
 * Parzysta długość → średnia dwóch środkowych (konwencja standardowa), nie dowolna z nich —
 * inaczej `median([1, 100])` mogłoby wyjść `1` albo `100`, obie fałszywie precyzyjne.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('median: values must be non-empty');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Percentyl `p` (0..100) metodą interpolacji liniowej między dwoma sąsiednimi próbkami
 * posortowanego wejścia (ten sam wzorzec co domyślna metoda `numpy.percentile` — wybór
 * konwencjonalny, nie oryginalny). `percentile(values, 50)` daje DOKŁADNIE to samo co
 * `median(values)` dla dowolnego wejścia (sprawdzone w `frameStats.test.ts`) — dwie funkcje,
 * jedna arytmetyka w środku, żeby "mediana" i "50. percentyl" nigdy nie mogły się rozjechać
 * jak dwa niezależne wzory.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new RangeError('percentile: values must be non-empty');
  }
  if (!(p >= 0 && p <= 100)) {
    throw new RangeError(`percentile: p must be within [0, 100], got ${p}`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Okno kroczące O(1) na `push` — BEZ alokacji per wywołanie (bufor `Float64Array`
 * zaalokowany RAZ, przy tworzeniu). To jest load-bearing tam, gdzie się to woła: `main.ts`
 * wpisuje jedną próbkę do tego bufora W KAŻDEJ klatce pętli renderu (do 60×/s, do
 * nieskończoności czasu działania aplikacji) — implementacja oparta na zwykłej tablicy z
 * `push`/`shift` działałaby poprawnie (koszt `shift` na tablicy liczb to tani `memmove`,
 * nie realokacja), ale to WŁAŚNIE ten rodzaj "tani, więc nikt nie zauważy" kosztu w gorącej
 * pętli, którego reszta tego pakietu (patrz `writeCellColors`, `planetMesh.ts`) konsekwentnie
 * unika przez jawną własność bufora zamiast założenia "to i tak szybkie".
 */
export interface RollingWindow {
  /** Dopisuje próbkę; po przekroczeniu pojemności nadpisuje NAJSTARSZĄ. */
  push(value: number): void;
  /** Liczba próbek faktycznie zebranych dotąd — `capacity` dopiero po zapełnieniu bufora. */
  readonly length: number;
  /**
   * Kopia bieżącej zawartości, w kolejności NAJSTARSZA→NAJNOWSZA. Kopia, nie widok — bezpieczna
   * do przekazania w `median`/`percentile` (które i tak kopiują ponownie przed sortowaniem, ale
   * podwójna kopia tu jest tańsza niż ryzyko, że przyszły wywołujący posortuje/zmutuje wewnętrzny
   * bufor tego okna).
   */
  snapshot(): number[];
}

export function createRollingWindow(capacity: number): RollingWindow {
  if (!(Number.isInteger(capacity) && capacity > 0)) {
    throw new RangeError(`createRollingWindow: capacity must be a positive integer, got ${capacity}`);
  }
  const buffer = new Float64Array(capacity);
  let count = 0;
  let nextIndex = 0;

  return {
    push(value: number): void {
      buffer[nextIndex] = value;
      nextIndex = (nextIndex + 1) % capacity;
      if (count < capacity) count++;
    },
    get length(): number {
      return count;
    },
    snapshot(): number[] {
      const out = new Array<number>(count);
      // Dopóki bufor nie jest pełny, najstarsza próbka leży pod indeksem 0 (nextIndex jeszcze
      // nie zawinął). Po zapełnieniu najstarsza leży dokładnie pod `nextIndex` (miejsce, które
      // `push` nadpisze jako NASTĘPNE) — stąd `start` zależny od tego, czy bufor już zawinął.
      const start = count < capacity ? 0 : nextIndex;
      for (let i = 0; i < count; i++) {
        out[i] = buffer[(start + i) % capacity];
      }
      return out;
    },
  };
}
