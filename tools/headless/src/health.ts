import { TICK_SECONDS } from '@heliopolis/sim';
import type { RunResult } from './run.js';
import { BEGINNER_POLICY_NAME } from './policy.js';
import { SKILLED_POLICY_NAME } from './skilledPolicy.js';

/**
 * # Sześć liczb zdrowia (Faza 3, Zadanie 2)
 *
 * Kamień milowy §9 specu brzmi „rozkłady z 10 000 runów są zdrowe". **To nie jest kryterium,
 * dopóki nie ma progów** — rozstrzygnięcie R1 planu nadaje im sześć liczb, a ten moduł
 * zamienia je w kod, żeby werdykt liczyła maszyna, a nie oko patrzące na histogram.
 *
 * ## Trzy stany, nie dwa
 *
 * `ok: null` przy `measured: false` jest tu **odpowiedzią, nie brakiem odpowiedzi**. H5 i H6
 * nie dają się policzyć z jednej partii — pierwsze potrzebuje wyników wielu OTWARĆ
 * (Zadanie 3), drugie wyników z pulą i bez niej (Zadanie 5). Gdyby niezmierzone kryterium
 * raportowało `false`, wyglądałoby jak wada balansu i ktoś zacząłby ją „naprawiać"; gdyby
 * `true` — bramka przepuściłaby fazę na dwóch kryteriach, których nikt nie sprawdził.
 *
 * ## Przedział ufności przy każdej liczbie
 *
 * „85 %" bez „±2,2" obok jest dokładnie tą klasą liczby, która w tym projekcie wracała:
 * ktoś porówna ją potem z 84 % i zobaczy różnicę, której nie ma. Półszerokość liczona
 * z rozkładu dwumianowego — **metodą Wilsona, nie Walda**, bo Wald przy `p = 0` daje
 * dokładnie zero NIEZALEŻNIE OD `n`, czyli drukuje „0,0 % ±0,0" po ośmiu przebiegach.
 * Zero to najgorsza możliwa liczba w tym miejscu: czyta się jak pewność.
 *
 * ## Populacja jest częścią kryterium, nie argumentem wywołania
 *
 * H1 i H3 mierzą politykę WPRAWNĄ, H2 i H4 — POCZĄTKUJĄCĄ. Pierwsza wersja tego modułu
 * liczyła H4 na wprawnej i raportowała `0,0 % OK`, podczas gdy początkująca ginęła w cyklu 1
 * w 94 % przebiegów. Naprawa samego ciała funkcji domyka instancję, nie klasę: tablice
 * nadal przychodziły **pozycyjnie**, więc zamiana dwóch argumentów w wierszu poleceń
 * odtwarzała tę samą wadę bez jednego ostrzeżenia. Dlatego `assessHealth` **czyta
 * `RunResult.policy`** i odmawia liczenia, gdy populacja nie jest tą, którą deklaruje.
 */

export type HealthId = 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6';

/**
 * Progi — **w JEDNYM miejscu**, bo Zadanie 3 będzie je czytać przy strojeniu. Rozsypane po
 * sześciu funkcjach zaczęłyby się rozjeżdżać z dokumentem planu; to ta sama klasa wady,
 * co liczba przepisana w dwóch plikach.
 *
 * Wszystkie pochodzą z tabeli R1 planu. **H1 zatwierdzone przez właściciela projektu.**
 */
export const HEALTH_THRESHOLDS = {
  /** Odsetek zwycięstw polityki WPRAWNEJ. Ani „przechodzi się samo", ani „nie da się". */
  H1: { minPct: 25, maxPct: 60 },
  /**
   * Odsetek zwycięstw polityki POCZĄTKUJĄCEJ: dodatni (gra do nauczenia) i wyraźnie niższy
   * od H1 (umiejętność ma znaczenie). DWA warunki, wiązane osobno.
   */
  H2: { minPct: 2, maxShareOfH1: 0.5 },
  /** Mediana długości runu WYGRANEGO, w minutach. Wprost z filaru D4. */
  H3: { minMinutes: 25, maxMinutes: 35 },
  /**
   * Odsetek porażek w cyklu 1 **polityki POCZĄTKUJĄCEJ** — run kończący się przed pierwszą
   * decyzją nie jest runem. Populacja jest tu częścią progu: mierzone na wprawnej wychodzi
   * trywialne zero i kryterium przestaje cokolwiek znaczyć.
   */
  H4: { maxPct: 15 },
  /** Ile RÓŻNYCH otwarć wygrywa ≥ 20 % seedów. Celuje w główną wadę zmierzoną w §11.1. */
  H5: { minOpenings: 3 },
  /** Zmiana H1 po USUNIĘCIU ulepszenia z puli. Powyżej — to nie wybór, tylko podatek. */
  H6: { maxDeltaPp: 10 },
} as const;

export interface HealthVerdict {
  readonly id: HealthId;
  /** Czy partia w ogóle niosła dane potrzebne do policzenia tego kryterium. */
  readonly measured: boolean;
  /** Zmierzona wartość w jednostce kryterium (procenty, minuty, sztuki). `null` gdy brak danych. */
  readonly value: number | null;
  /** `null` znaczy „nie zmierzone", nie „nie wiadomo" — patrz doc-comment modułu. */
  readonly ok: boolean | null;
  /**
   * Półszerokość 95 % przedziału ufności **w jednostce `value`** — punkty procentowe dla
   * H1/H2/H4, minuty dla H3. `null` znaczy „nie da się policzyć", nie „zero".
   *
   * Jednostka idzie za wartością, bo inaczej kolumna raportu kłamie: „20,2 min" obok
   * „76,0 % ±0,8" bez własnego przedziału czyta się jak liczba równie dokładna.
   */
  readonly ciHalfWidth: number | null;
  /** Zdanie dla człowieka: co zmierzono i wobec jakiego progu. Raport ma być czytelny bez kodu. */
  readonly note: string;
}

export interface HealthInput {
  readonly skilled: readonly RunResult[];
  readonly beginner: readonly RunResult[];
  /** Liczba różnych otwarć wygrywających ≥ 20 % seedów — wchodzi z Zadania 3. */
  readonly winningOpenings?: number;
  /** Największa zmiana H1 po usunięciu pojedynczego ulepszenia — wchodzi z Zadania 5. */
  readonly maxUpgradeDeltaPp?: number;
}

const wins = (runs: readonly RunResult[]): number =>
  runs.filter((r) => r.phase === 'VICTORY').length;

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : (100 * part) / whole);

const Z = 1.96;

/**
 * Półszerokość 95 % przedziału ufności dla proporcji, w punktach procentowych — **Wilson**.
 *
 * Wald (`z·√(p(1−p)/n)`) był tu pierwszy i ma jedną wadę, która akurat w tym projekcie
 * uderza w najczulsze miejsce: **przy `p = 0` albo `p = 1` daje dokładnie zero, i to
 * niezależnie od `n`**. H2 w raporcie bazowym to dokładnie `p = 0`, więc maszyna wypisała
 * „0,0 % ±0,0" — liczbę czytającą się jak pewność, a nie jak brak zwycięstw. Przy ośmiu
 * przebiegach wypisałaby to samo, choć prawdziwa granica leży wtedy koło 31 %.
 *
 * Wilson nie ma tej zapaści, bo `z²` wchodzi do licznika: przy `p = 0` i `n = 8` daje
 * ±16,2 pp, przy `p = 0` i `n = 10 000` — ±0,02 pp. W środku pasma zgadza się z Waldem
 * do trzeciego miejsca (p = 0,5, n = 1 000: 3,09 wobec 3,10).
 *
 * **Granica, którą trzeba znać:** przedział Wilsona nie jest symetryczny wokół `p`, więc
 * zapis „p ± h" jest przybliżeniem jego środka. Przy `p` skrajnym czyta się to jak przedział
 * sięgający poniżej zera — i taki odczyt jest tu pożądany, bo mówi „ta liczba nie niesie
 * jeszcze informacji", czyli dokładnie to, co `±0,0` ukrywało.
 */
export function ciHalfWidthPp(p: number, n: number): number {
  if (n === 0) return 0;
  return (Z / (n + Z * Z)) * Math.sqrt(n * p * (1 - p) + (Z * Z) / 4) * 100;
}

/**
 * Półszerokość 95 % przedziału ufności MEDIANY, w jednostce próbki — statystyki pozycyjne.
 *
 * Mediana nie jest proporcją, ale to nie znaczy, że nie ma przedziału: rangi ograniczające
 * bierze się z dwumianu (`n/2 ± z·√n/2`), a granicami są **wartości z posortowanej próbki**
 * pod tymi rangami. Żadnego założenia o kształcie rozkładu — a rozkład długości runu jest
 * skośny, więc każde założenie byłoby tu zmyślone.
 *
 * Zwraca `null`, gdy rangi wypadają poza próbkę — wtedy przedział obejmuje ją całą
 * i liczba nic nie mówi.
 */
export function medianCiHalfWidth(values: readonly number[]): number | null {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const spread = (Z * Math.sqrt(n)) / 2;
  const lo = Math.floor(n / 2 - spread);
  const hi = Math.ceil(n / 2 + spread);
  if (lo < 0 || hi >= n) return null;
  return (sorted[hi] - sorted[lo]) / 2;
}

/**
 * Półszerokość do wydruku — **nigdy „0.0" dla liczby niezerowej**.
 *
 * Przy n = 10 000 i p = 0 Wilson daje 0,019 pp, co po zaokrągleniu do dziesiątych wygląda
 * dokładnie jak zapaść Walda, którą ten moduł właśnie usunął. Liczba prawdziwa nie powinna
 * być nieodróżnialna od liczby fałszywej, więc poniżej 0,05 pp drukujemy dwa miejsca.
 */
function ci(halfWidth: number): string {
  return halfWidth > 0 && halfWidth < 0.05 ? halfWidth.toFixed(2) : halfWidth.toFixed(1);
}

function unmeasured(id: HealthId, why: string): HealthVerdict {
  return { id, measured: false, value: null, ok: null, ciHalfWidth: null, note: why };
}

/** Mediana — na kopii, bo `sort` mutuje, a wejście jest cudze. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Rzucane, gdy tablica przebiegów nie jest populacją, za którą się podaje.
 *
 * **Głośno, nie cicho** — CLAUDE.md §4: wada dająca prawdopodobnie wyglądający wynik zamiast
 * błędu przeżywa dłużej niż wyjątek. Raport policzony na zamienionych populacjach wygląda
 * jak raport; wyjątek wygląda jak wyjątek.
 */
export class PopulationMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PopulationMismatch';
  }
}

/**
 * Sprawdza, że WSZYSTKIE przebiegi pochodzą z polityki o nazwie `expected`.
 *
 * Tu leży naprawa **klasy**, a nie instancji wady H4. Samo policzenie H4 na `beginner`
 * nic nie gwarantuje, dopóki to, co wpada do `beginner`, jest wybierane kolejnością
 * argumentów: zamiana dwóch ścieżek w `--combine` dawała raport, w którym **H4 zgłaszało
 * OK**, bo liczyło politykę wprawną, która nigdy nie ginie w cyklu 1.
 *
 * `RunResult.policy` istnieje dokładnie po to i ma własny doc-comment mówiący „przy KAŻDYM
 * wyniku, nie tylko w nagłówku raportu". Kontrola ma **czytać** to, co sprawdza.
 */
function requirePolicy(runs: readonly RunResult[], expected: string, role: string): void {
  const obce = new Set(runs.map((r) => r.policy).filter((name) => name !== expected));
  if (obce.size === 0) return;
  throw new PopulationMismatch(
    `${role} miała być przebiegami polityki „${expected}", a niesie ${[...obce]
      .map((n) => `„${n}"`)
      .join(', ')}. Najczęstsza przyczyna: zamienione ścieżki w --combine. ` +
      'H2 i H4 liczone na wprawnej wychodzą trywialnie dobre i raport wygląda zdrowo.',
  );
}

export function assessHealth(input: HealthInput): HealthVerdict[] {
  const { skilled, beginner, winningOpenings, maxUpgradeDeltaPp } = input;
  const t = HEALTH_THRESHOLDS;

  // Zanim policzymy cokolwiek: czy to na pewno te populacje. Pusta tablica przechodzi —
  // „brak danych" ma zostać trzecim stanem kryterium, a nie wyjątkiem narzędzia.
  requirePolicy(skilled, SKILLED_POLICY_NAME, 'Populacja WPRAWNA (H1, H3)');
  requirePolicy(beginner, BEGINNER_POLICY_NAME, 'Populacja POCZĄTKUJĄCA (H2, H4)');

  // --- H1: sufit ---------------------------------------------------------------------
  let h1: HealthVerdict;
  let h1Pct = 0;
  if (skilled.length === 0) {
    h1 = unmeasured('H1', 'brak przebiegów polityki wprawnej');
  } else {
    h1Pct = pct(wins(skilled), skilled.length);
    const ci_ = ciHalfWidthPp(h1Pct / 100, skilled.length);
    h1 = {
      id: 'H1',
      measured: true,
      value: h1Pct,
      ok: h1Pct >= t.H1.minPct && h1Pct <= t.H1.maxPct,
      ciHalfWidth: ci_,
      note:
        `zwycięstw polityki wprawnej: ${h1Pct.toFixed(1)}% ±${ci(ci_)} ` +
        `(n=${skilled.length} runów), próg ${t.H1.minPct}–${t.H1.maxPct}%`,
    };
  }

  // --- H2: czy początkujący ma szansę, i czy umiejętność coś znaczy ----------------
  let h2: HealthVerdict;
  if (beginner.length === 0) {
    h2 = unmeasured('H2', 'brak przebiegów polityki początkującej');
  } else if (!h1.measured) {
    h2 = unmeasured('H2', 'H2 odnosi się do H1, a H1 nie zostało zmierzone');
  } else {
    const h2Pct = pct(wins(beginner), beginner.length);
    const ci_ = ciHalfWidthPp(h2Pct / 100, beginner.length);
    const ceiling = h1Pct * t.H2.maxShareOfH1;
    h2 = {
      id: 'H2',
      measured: true,
      value: h2Pct,
      // DWA warunki, oba wiązane: gra do nauczenia ORAZ umiejętność ma znaczenie.
      // Nierówności OSTRE, bo plan pisze „> 2 % i < H1/2" — kod przepuszczający dokładnie
      // próg byłby wierszem raportu przeczącym własnej nocie.
      ok: h2Pct > t.H2.minPct && h2Pct < ceiling,
      ciHalfWidth: ci_,
      note:
        `zwycięstw polityki początkującej: ${h2Pct.toFixed(1)}% ±${ci(ci_)} ` +
        `(n=${beginner.length} runów), próg >${t.H2.minPct}% i <${ceiling.toFixed(1)}% ` +
        `(połowa H1 = ${h1Pct.toFixed(1)}%)`,
    };
  }

  // --- H3: czy run trwa tyle, ile obiecuje D4 --------------------------------------
  const won = skilled.filter((r) => r.phase === 'VICTORY');
  const h3: HealthVerdict =
    won.length === 0
      ? unmeasured('H3', 'żaden przebieg polityki wprawnej nie zakończył się zwycięstwem')
      : (() => {
          const toMinutes = (ticks: number) => (ticks * TICK_SECONDS) / 60;
          const minutes = toMinutes(median(won.map((r) => r.ticks)));
          // Mediana nie jest proporcją, ale przedział ma: rangi z dwumianu, granice
          // z posortowanej próbki. `null` tylko wtedy, gdy próbka jest za mała, żeby
          // rangi w nią wpadły — nigdy zero, bo zero czyta się jak pewność.
          const ciTicks = medianCiHalfWidth(won.map((r) => r.ticks));
          const ci_ = ciTicks === null ? null : toMinutes(ciTicks);
          return {
            id: 'H3' as const,
            measured: true,
            value: minutes,
            ok: minutes >= t.H3.minMinutes && minutes <= t.H3.maxMinutes,
            ciHalfWidth: ci_,
            note:
              `mediana runu wygranego POLITYKI WPRAWNEJ: ${minutes.toFixed(1)} min ` +
              `${ci_ === null ? '(przedział: próbka za mała)' : `±${ci(ci_)}`} ` +
              `(n=${won.length} zwycięstw), próg ${t.H3.minMinutes}–${t.H3.maxMinutes} min`,
          };
        })();

  // --- H4: czy run w ogóle się zaczyna ---------------------------------------------
  //
  // **Mierzone na polityce POCZĄTKUJĄCEJ, nie wprawnej** — i to jest naprawa wady, którą
  // zobaczyłem dopiero w raporcie bazowym, nie w kodzie.
  //
  // Uzasadnienie H4 w planie brzmi „dziś jest ~100 % (§11.1)", a ta setka to bot
  // POCZĄTKUJĄCY: ginie w cyklu 1 w 10 000 na 10 000 przebiegów. Liczone na polityce
  // wprawnej wychodziło **0,0 % i raportowało OK** — czyli kryterium napisane po to, żeby
  // złapać dokładnie tę wadę, przepuszczało ją, bo patrzyło nie na tę populację.
  //
  // Sens H4 jest o PODŁODZE doświadczenia: „run kończący się przed pierwszą decyzją nie
  // jest runem". Podłogę wyznacza gracz niewprawny, nie ten, który zna zwycięską linię.
  //
  // **Mianownikiem są WSZYSTKIE runy początkującej, nie same porażki.** Plan uzasadnia H4
  // zdaniem „run kończący się przed pierwszą decyzją NIE JEST RUNEM" — to jest udział
  // w próbach gracza, nie udział wśród przegranych. Dziś oba mianowniki są równe, bo
  // początkująca nie wygrywa ani razu; różnica obudzi się dokładnie w Zadaniu 3, którego
  // celem jest sprawić, żeby zaczęła wygrywać. Przy 1 000 runów, 400 zwycięstwach i 100
  // śmierciach w cyklu 1: udział wśród porażek to 16,7 % (BŁĄD), udział w runach 10,0 % (OK).
  const h4: HealthVerdict =
    beginner.length === 0
      ? unmeasured('H4', 'brak przebiegów polityki początkującej')
      : (() => {
          const cycle1 = beginner.filter((r) => r.phase === 'DEFEAT' && r.cycle === 1).length;
          const share = pct(cycle1, beginner.length);
          const ci_ = ciHalfWidthPp(share / 100, beginner.length);
          return {
            id: 'H4' as const,
            measured: true,
            value: share,
            // Nierówność OSTRA — plan i nota piszą „< 15 %". `<=` przepuszczałoby wiersz
            // „15.0% ... próg <15%  OK", który sam sobie przeczy.
            ok: share < t.H4.maxPct,
            ciHalfWidth: ci_,
            note:
              `runów POLITYKI POCZĄTKUJĄCEJ ginących w cyklu 1: ${share.toFixed(1)}% ` +
              `±${ci(ci_)} (n=${beginner.length} runów), próg <${t.H4.maxPct}%`,
          };
        })();

  // --- H5 i H6: wchodzą z Zadań 3 i 5 ------------------------------------------------
  const h5: HealthVerdict =
    winningOpenings === undefined
      ? unmeasured('H5', 'wymaga wyników wielu OTWARĆ — Zadanie 3')
      : {
          id: 'H5',
          measured: true,
          value: winningOpenings,
          ok: winningOpenings >= t.H5.minOpenings,
          ciHalfWidth: null,
          note: `otwarć wygrywających ≥20% seedów: ${winningOpenings}, próg ≥${t.H5.minOpenings}`,
        };

  const h6: HealthVerdict =
    maxUpgradeDeltaPp === undefined
      ? unmeasured('H6', 'wymaga wyników z pulą i bez niej — Zadanie 5')
      : {
          id: 'H6',
          measured: true,
          value: maxUpgradeDeltaPp,
          ok: maxUpgradeDeltaPp < t.H6.maxDeltaPp,
          ciHalfWidth: null,
          note:
            `największa zmiana H1 po usunięciu ulepszenia: ${maxUpgradeDeltaPp.toFixed(1)} pp, ` +
            `próg <${t.H6.maxDeltaPp} pp`,
        };

  return [h1, h2, h3, h4, h5, h6];
}
