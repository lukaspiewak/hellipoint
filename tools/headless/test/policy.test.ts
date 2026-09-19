import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN, type Sim } from '@heliopolis/sim';
import { simulateRun, type RunResult } from '../src/run.js';
import { formatReport } from '../src/report.js';
import { BeginnerPolicy, type Policy } from '../src/policy.js';
import { SkilledPolicy, SKILLED_OPENING } from '../src/skilledPolicy.js';
import { WINNING_OPENING } from '../../../packages/sim/test/support/openings.js';

/**
 * # Dwie polityki, każda na inne pytanie (Faza 3, Zadanie 1)
 *
 * `BeginnerPolicy` odpowiada „czy początkujący ma szansę?", `SkilledPolicy` — „gdzie jest
 * sufit?". Mieszanie ich to dokładnie ta wada, która unieważniła tabelę ekstraktorów
 * w §11.1 specu: progi bezwzględne zmierzone na słabej polityce **nie są wiążące**.
 *
 * Ten plik jest PRZYRZĄDEM całej Fazy 3. Każdy pomiar balansu zrobiony zanim on przejdzie
 * mierzy bota, nie grę.
 */

/**
 * [STROJENIE w teście] ~1,7× zmierzonej długości zwycięskiego przebiegu (35 483 ticki
 * po strojeniu Zadania 3; wcześniej 24 133).
 *
 * Podniesione razem z balansem i to NIE jest kosmetyka: przy starych 40 000 zwycięski
 * przebieg seeda 33 mieścił się w limicie z 13 % zapasu, a część seedów próbki była już
 * OBCINANA — czyli test liczyłby „przegrane", które w rzeczywistości są niedokończone.
 * Ta sama klasa, co sufit ticków leżący wewnątrz pasma H3 (patrz `MAX_TICKS` w `batch.ts`).
 */
const WIN_CAP = 60_000;

/**
 * Seed odniesienia: wprawna WYGRYWA, początkująca ginie w CYKLU 1.
 *
 * Do Zadania 3 było to 33 — liczba z §11.1. Po strojeniu H1 wynosi ~36 %, więc otwarcie
 * nie wygrywa już wszędzie, a 33 wpadł do tych planet, na których przegrywa. Wybrane
 * pomiarem na seedach 0–59 (wygrywają m.in. 4, 5, 6, 7, 10, 11); piątka niesie OBIE
 * strony kontrastu naraz. Ten sam seed przypina `fullrun.test.ts` jako `WIN_SEED`.
 */
const REF_SEED = 5;

/**
 * Limity czasu WYPROWADZONE Z POMIARU POD OBCIĄŻENIEM, nie z bezczynnej maszyny.
 *
 * Zmierzone bezczynnie (`tools/headless/dist`, pięć seedów): pojedynczy przebieg polityki
 * wprawnej bierze **3,3–6,4 s** — bo to 19–32 tysiące ticków z setkami żywych jednostek.
 * Domyślne 5 s vitesta nie starcza i **oblewało dwa z czterech testów tego pliku**.
 *
 * Współczynnik obciążeniowy zmierzony w Fazie 2C (20 procesów na 10 rdzeniach): **3,2×**.
 * Definicja ukończenia wymaga sześciu przebiegów pakietu pod obciążeniem, więc limit liczony
 * z bezczynnego pomiaru wpisywałby do pakietu test, który oblewa dokładnie wtedy, gdy ma być
 * sprawdzany. To ta sama wada, którą naprawiono w `headless.test.ts` dzień wcześniej.
 *
 * Stąd: najgorszy przebieg 6,4 s × liczba przebiegów × 3,2 × zapas 2.
 */
const ONE_RUN_MS = 60_000; // 1 przebieg: 6,4 × 3,2 × 2 ≈ 41 s, zaokrąglone w górę
const FIVE_RUNS_MS = 240_000; // 5 przebiegów: 32 × 3,2 × 2 ≈ 205 s, zaokrąglone w górę

describe('1. [PRZYRZĄD] dwie polityki dają RÓŻNE wyniki na tym samym seedzie', () => {
  it('1a. SkilledPolicy wygrywa na seedzie odniesienia, BeginnerPolicy na tym samym ginie w cyklu 1', () => {
    const skilled = simulateRun(REF_SEED, DEFAULT_RUN, WIN_CAP, (sim) => new SkilledPolicy(sim));
    const beginner = simulateRun(REF_SEED, DEFAULT_RUN, WIN_CAP, (sim) => new BeginnerPolicy(sim));

    expect(skilled.phase).toBe('VICTORY');
    expect(beginner.phase).toBe('DEFEAT');
    expect(beginner.cycle).toBe(1);
  }, ONE_RUN_MS);

  /**
   * Bot wygrywający wyłącznie na seedzie 33 jest **przepisaną odpowiedzią, nie polityką** —
   * `WINNING_OPENING` powstało przez przemiatanie właśnie na tym seedzie.
   *
   * Próg `>= 2` z pięciu jest NISKI CELOWO: przy dzisiejszym balansie (0 zwycięstw na 1000
   * runów bota początkującego) nie wiadomo, ile seedów w ogóle jest wygrywalnych. Ten test
   * pilnuje jednej rzeczy — że to nie jest odpowiedź na jeden seed. **Zadanie 3 ma podnieść
   * ten próg** i zapisać go razem ze zmierzonym odsetkiem.
   *
   * **ZMIERZONE po naprawie Z1 (odstęp decyzji 1, nie 20): wygrywa WSZYSTKIE PIĘĆ.**
   * ## Liczby PRZED strojeniem Zadania 3 i PO nim
   *
   * Przed: 40 seedów → **34 zwycięstwa (85 %)**, mediana 23 801 ticków = 19,8 min. Czyli
   * H1 (25–60 %) złamane od GÓRY, H3 (25–35 min) od DOŁU — dla wprawnego gra była za łatwa
   * i za krótka, przy zerowym odsetku zwycięstw początkującego.
   *
   * (Zapis sprzed naprawy Z1 mówił w tym miejscu „2 z 5, nawet najlepsza linia przegrywa
   * większość seedów" i był **odwrotnością prawdy** — przegrywała przepustnica, nie linia.)
   *
   * Po strojeniu (`killRewardScale` 0,5, `baseRatePerPentagon` 0,05): 40 seedów → **9
   * zwycięstw (22,5 %)**, mediana 32 414 ticków = **27,0 min**. Czterdzieści seedów niesie
   * ±13 pp, więc 22,5 % jest zgodne z pomiarem decyzyjnym na 1 000 przebiegów: **H1 = 35,5 %
   * ±3,0** i **H3 = 27,3 min ±0,3**, oba w paśmie. Tamten pomiar jest wiążący, ten jest
   * tanim strażnikiem przyrządu.
   *
   * **Ten test NIE jest pomiarem sufitu** — pięć seedów niesie ±22 pp. Jest asercją,
   * że wprawna i początkująca to naprawdę DWA różne przyrządy, na tych samych planetach.
   */
  it('1b. na tej samej próbce wprawna wygrywa, a początkująca nie wygrywa NIGDY', () => {
    const seeds = [33, 101, 202, 303, 404];
    const wygrane = (make: (sim: Sim) => Policy) =>
      seeds.filter(
        (seed) => simulateRun(seed, DEFAULT_RUN, WIN_CAP, make).phase === 'VICTORY',
      );
    const wprawna = wygrane((sim) => new SkilledPolicy(sim));
    const poczatkujaca = wygrane((sim) => new BeginnerPolicy(sim));
    // eslint-disable-next-line no-console
    console.log(`[PRZYRZĄD] wprawna ${wprawna.length}/5 ${wprawna}, początkująca ${poczatkujaca.length}/5`);

    // Przypięte co do seeda: na tej próbce wygrywa sam 303. Sama liczba „1 z 5" byłaby
    // zielona także wtedy, gdyby wygrywała INNA planeta, czyli gdyby polityka przestała
    // być tą samą polityką. Próbka jest arbitralna i stara — wiążącym pomiarem sufitu
    // jest 1 000 przebiegów, nie te pięć.
    expect(wprawna).toEqual([303]);
    expect(poczatkujaca, 'podłoga: H2 = 0,0 % na 1 000 przebiegów').toEqual([]);
  }, FIVE_RUNS_MS);

  /**
   * **Liczba referencyjna — najmocniejszy strażnik tego przyrządu.**
   *
   * §11.1 specu podaje, że zwycięskie otwarcie kończy seed 33 na ticku **24 133**. Ta liczba
   * powstała w Fazie 1C na `playPlan`, które decyduje w KAŻDYM ticku. Odtworzenie jej co do
   * ticka dowodzi, że polityka wprawna jest **tą samą polityką**, a nie jej osłabioną wersją.
   *
   * To ona wyłapała wadę Z1: z przepustnicą 20 ticków wychodziło 24 340 i trzy z pięciu
   * seedów przegrywały. Różnica 207 ticków wyglądała niewinnie — a odpowiadała spadkowi
   * sufitu z **85 % na 39 %** zwycięstw.
   *
   * **Gdy ta liczba przestanie się zgadzać po zmianie BALANSU (Faza 3, Zadanie 3), to jest
   * oczekiwane** — przepnij ją razem z resztą strojenia. Gdy przestanie się zgadzać BEZ
   * zmiany balansu, przyrząd się popsuł i pomiary z niego są nieważne.
   */
  it('1e. seed odniesienia kończy na ticku 32 769 — liczba przepięta ze strojeniem Zadania 3', () => {
    const r = simulateRun(REF_SEED, DEFAULT_RUN, WIN_CAP, (sim) => new SkilledPolicy(sim));
    expect(r.phase).toBe('VICTORY');
    // 24 133 na seedzie 33 przy balansie sprzed Zadania 3; dziś 32 769 na seedzie
    // odniesienia. Zmieniły się i nastawa, i planeta — powód zmiany seeda stoi przy
    // `REF_SEED`. Przepięte zgodnie z instrukcją
    // w doc-commencie wyżej — zmiana PO strojeniu jest oczekiwana, BEZ strojenia znaczy
    // zepsuty przyrząd. `fullrun.test.ts` przypina tę samą liczbę z drugiej strony,
    // przez `playPlan`, więc rozjazd polityki z otwarciem oblewa w dwóch miejscach.
    expect(r.ticks).toBe(32_769);
  }, ONE_RUN_MS);

  /**
   * Naprawa Z2: polityka musi być grywalna na KAŻDEJ planecie, nie na łatwiejszym podzbiorze.
   *
   * Pierwsza wersja rzucała wyjątkiem na **17,3 % planet** (173 z seedów 0–999) — partia
   * 10 000 runów z Zadania 2 padłaby na **seedzie 0**. „Złap i pomiń" byłoby gorsze niż
   * wyjątek, bo przekrzywiłoby próbkę ku planetom o większych pierścieniach i nigdzie
   * tego nie napisało.
   */
  it('1f. SkilledPolicy nie wywala się na ŻADNEJ z trzydziestu planet', () => {
    for (let seed = 0; seed < 30; seed++) {
      expect(
        () => simulateRun(seed, DEFAULT_RUN, 300, (sim) => new SkilledPolicy(sim)),
        `seed ${seed}`,
      ).not.toThrow();
    }
  }, FIVE_RUNS_MS);

  /**
   * Fabryka jest OPCJONALNA i domyślnie daje politykę początkującą — bez tego wszystkie
   * dotychczasowe pomiary (raport z 1000 runów, `pnpm bench`) zmieniłyby po cichu znaczenie.
   */
  it('1c. domyślna polityka to dalej POCZĄTKUJĄCA — stare pomiary nie zmieniają znaczenia', () => {
    const domyslna = simulateRun(REF_SEED, DEFAULT_RUN, WIN_CAP);
    const jawna = simulateRun(REF_SEED, DEFAULT_RUN, WIN_CAP, (sim) => new BeginnerPolicy(sim));
    expect(domyslna.policy).toBe('beginner');
    expect(domyslna.ticks).toBe(jawna.ticks);
    expect(domyslna.phase).toBe(jawna.phase);
  }, ONE_RUN_MS);

  /**
   * Nazwa polityki w KAŻDYM wyniku, nie tylko w nagłówku raportu. Dwie liczby z dwóch
   * polityk wyglądają identycznie; bez nazwy przy wierszu nie da się ich potem rozdzielić.
   */
  it('1d. wynik niesie nazwę polityki, na której powstał', () => {
    expect(simulateRun(REF_SEED, DEFAULT_RUN, WIN_CAP, (sim) => new SkilledPolicy(sim)).policy).toBe(
      'skilled',
    );
  }, ONE_RUN_MS);
});

describe('2. [RAPORT] partia nazywa politykę, a mieszana krzyczy', () => {
  const runFor = (policy: string): RunResult =>
    ({ ...simulateRun(1, DEFAULT_RUN, 2_000), policy }) as RunResult;

  it('2a. raport z jednej polityki podaje jej nazwę', () => {
    expect(formatReport([runFor('beginner'), runFor('beginner')])).toContain('polityka: beginner');
  });

  /**
   * **To jest cały powód, dla którego `policy` siedzi w `RunResult`.** Partia złożona
   * z dwóch polityk nie opisuje żadnej z nich, a wygląda dokładnie jak poprawna: dwie
   * liczby z dwóch botów są nierozróżnialne. §11.1 ma gotowy koszt tej pomyłki.
   */
  /**
   * **To samo dla KONFIGURACJI** (naprawa Z5). Raport krzyczał na mieszanie polityk i był
   * ślepy na mieszanie nastaw — mimo że Zadanie 3 polega właśnie na przemiataniu nastaw.
   * Partia z dwóch `startingOre` dawała spokojny raport bez słowa ostrzeżenia.
   */
  it('2c. [PARA] partia z dwóch KONFIGURACJI krzyczy, z jednej — nie', () => {
    const inna = { ...DEFAULT_RUN, startingOre: DEFAULT_RUN.startingOre + 1 };
    const mieszana = formatReport([
      simulateRun(1, DEFAULT_RUN, 2_000),
      simulateRun(1, inna, 2_000),
    ]);
    expect(mieszana).toContain('MIESZA');
    expect(mieszana).toContain('konfiguracje');

    const jednolita = formatReport([
      simulateRun(1, DEFAULT_RUN, 2_000),
      simulateRun(2, DEFAULT_RUN, 2_000),
    ]);
    expect(jednolita).not.toContain('MIESZA');
    expect(jednolita).toContain('konfiguracja: ');
  });

  it('2d. odcisk konfiguracji odróżnia nastawy, a nie seedy', () => {
    const a = simulateRun(1, DEFAULT_RUN, 500).configFingerprint;
    const b = simulateRun(999, DEFAULT_RUN, 500).configFingerprint;
    const c = simulateRun(1, { ...DEFAULT_RUN, startingOre: 151 }, 500).configFingerprint;
    expect(a, 'ten sam config, inny seed → ten sam odcisk').toBe(b);
    expect(a, 'inny config → inny odcisk').not.toBe(c);
  });

  it('2b. [PARA] partia z dwóch polityk krzyczy, z jednej — nie', () => {
    const mieszana = formatReport([runFor('beginner'), runFor('skilled')]);
    expect(mieszana).toContain('MIESZA');
    expect(mieszana).toContain('beginner');
    expect(mieszana).toContain('skilled');

    expect(formatReport([runFor('skilled'), runFor('skilled')])).not.toContain('MIESZA');
  });
});

describe('3. [KOPIA] kolejka otwarcia bota zgadza się z kolejką referencyjną', () => {
  /**
   * **Ten test istnieje, bo poprzednio kopii nie pilnowało NIC**, choć komentarz przy niej
   * twierdził, że „rozjazd wyłapie test 1a". Zmierzone w przeglądzie Zadania 1: zmiana
   * jednej pozycji (17 → 18 barykad w hex4) zostawiała `fullrun` 16/16 zielone
   * I `policy.test.ts` 6/6 zielone — w obie strony.
   *
   * Kopia musi istnieć, bo produkcyjny kod narzędzia nie może importować pliku testowego
   * cudzego pakietu. Skoro musi, to ma być **głośna**: jedno porównanie, jedno miejsce.
   */
  it('3a. SKILLED_OPENING jest identyczna z WINNING_OPENING, pozycja po pozycji', () => {
    expect(SKILLED_OPENING).toEqual(WINNING_OPENING);
  });

  /**
   * Kontrola na fiksturę: porównanie dwóch PUSTYCH list też byłoby „identyczne".
   *
   * Liczby POLICZONE, nie przypomniane: 11 pozycji energetyczno-obronnych + 13 barykad
   * w hex3 + 17 w hex4 + moduł ewakuacyjny = **42**, z czego **30 barykad**. Pierwsza
   * wersja tego testu miała tu 37 — liczbę z pamięci, nie z listy, i oblała natychmiast.
   */
  it('3b. obie listy są NIEPUSTE i mają kształt, którego test pilnuje', () => {
    expect(SKILLED_OPENING.length).toBe(42);
    expect(SKILLED_OPENING.filter(([, type]) => type === 'BARRICADE')).toHaveLength(30);
  });
});
