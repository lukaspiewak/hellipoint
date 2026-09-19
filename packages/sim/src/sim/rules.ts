import { DEFAULT_SPAWN, type SpawnConfig } from './spawning.js';
import { TICK_SECONDS, type SimState } from './state.js';

export interface RunConfig {
  rotationPeriod: number;
  startingOre: number;
  /**
   * [STROJENIE] Mnożnik nagrody rudy za zabicie, nakładany na `ENEMIES[].oreReward`.
   *
   * **Suwak, a nie stała, bo §11.1 wskazał go jako PRAWDZIWY regulator trudności** —
   * z progiem gdzieś między 0,25× a 0,1×, poniżej którego run umiera, bo gracza nie stać
   * na odbudowę MURU (nie na moduł ewakuacyjny, którego cena okazała się nie być bramką:
   * 300 → 1200 przesuwa zwycięstwo o 281 ticków).
   *
   * Mieszka w `RunConfig`, a nie w `ENEMIES`, z trzech powodów naraz: przemiatanie musi
   * móc zmieniać go per przebieg, procesy potomne partii dostają konfigurację (a nie
   * zmutowany moduł), i `configFingerprint` bierze go wtedy pod uwagę — czyli raport
   * nie da się policzyć na dwóch nastawach, nie zauważając tego.
   *
   * `1` = dzisiejsze wartości z tabeli. Ruda jest ułamkowa (ekstraktor nalicza 0,05/tick),
   * więc mnożnik nie potrzebuje zaokrąglania i nie ma progu, na którym SWARM przestaje
   * płacić cokolwiek.
   */
  killRewardScale: number;
  /**
   * [STROJENIE] Faza słońca na starcie runu, **liczona WZGLĘDEM ŚWITU komórki startowej**,
   * w ułamku pełnego obrotu. `0` = CORE wchodzi w światło dokładnie w ticku zero.
   *
   * ## Dlaczego względem świtu, a nie bezwzględnie
   *
   * Bo bezwzględna faza startu **różni się planeta od planety i to przypadkiem**. Zmierzone
   * przy obrocie 180 s: seed 7 zaczyna w pełnym świetle (0,75 i gasnące), seed 101 ma przed
   * sobą 90 sekund ciemności, seed 33 startuje o świcie. Gracz na seedzie 101 dostawał więc
   * półtorej minuty nocy, zanim słońce w ogóle zaczęło mu pomagać, a gracz na seedzie 7 —
   * pomoc natychmiast. Ta wariancja nie była niczyją decyzją; brała się z generowania planety.
   *
   * Odniesienie do świtu sprawia, że **ta sama liczba znaczy to samo na każdej planecie**,
   * a przemiatanie po tej osi mierzy jedną rzecz, a nie dwie naraz.
   *
   * ## Po co to istnieje
   *
   * Zadanie 3 zmierzyło, że H4 (porażki w cyklu 1) nie rusza się od ŻADNEJ liczby balansowej:
   * `updateSpawning` daje w cyklu 1 pełne natężenie fali w sekundzie zerowej, przeciw bazie
   * złożonej z samego CORE. Faza słońca jest jedyną znalezioną dźwignią, która to rusza —
   * i rusza mocno.
   *
   * ## Zmierzone, i NIE to, czego się spodziewałem
   *
   * Hipoteza brzmiała „start o świcie", bo wtedy słońce broni od razu. **Pomiar ją obalił.**
   * Przy 250 przebiegach wprawnej i 1 000 początkującej na punkt, H4 wg fazy:
   *
   * ```
   *   0      (dzień od razu)   92,2 %      0,625  (68 s nocy)   82,3 %
   *   0,125                    88,5 %      0,6875 (56 s nocy)   67,1 %
   *   0,25   (południe)        85,9 %      0,75   (45 s nocy)   59,8 %  ← minimum
   *   0,5    (zmierzch)        88,2 %      0,8125 (34 s nocy)   66,9 %
   *                                        0,875  (22 s nocy)   77,1 %
   *                                        0,9375 (11 s nocy)   89,8 %
   * ```
   *
   * Minimum jest czyste: obaj sąsiedzi 0,75 dają po ~67 % przy przedziałach ±2,9, więc
   * siedmiopunktowa różnica nie jest wahaniem próbki. Sens wychodzi z zestawienia z czasem
   * zgonu: **mediana porażki początkującej leży w okolicy 50–65 s, a przy fazie 0,75 wschód
   * przychodzi po 45 s** — dokładnie wtedy, gdy gracz przestaje sobie radzić. Świt od razu
   * jest najgorszy, bo stawia bazę NA TERMINATORZE, tuż przy całej nocnej półkuli, która
   * jako jedyna spawnuje (D1), a zanim baza dojedzie w głąb dnia, jest już po wszystkim.
   *
   * To nie jest ukryty mnożnik trudności, tylko czytelna reguła: **zaczynasz w nocy,
   * a pierwszy wschód jest twoją pierwszą ulgą.**
   *
   * Wartość jest okresowa; 0 znaczy „CORE wchodzi w światło w ticku zero".
   */
  sunPhaseAtStart: number;
  /**
   * PUNKT ODNIESIENIA DLA PROGU EWAKUACJI, **NIE** DŁUGOŚĆ RUNU. Nazwa sugeruje limit
   * czasu — takiego nie ma i mieć nie powinno: §5.6 zna dokładnie dwa warunki końca,
   * zwycięstwo przez ewakuację i porażkę przez utratę Core. Run, w którym gracz się nie
   * ewakuuje, biegnie dalej po `cyclesPerRun` — zmierzone: przy `cyclesPerRun: 10`
   * przebieg dochodzi do cyklu 15 i kończy się dopiero utratą CORE.
   *
   * Jedyny konsument tego pola to próg ewakuacji: `ceil(cyclesPerRun × evacUnlockFraction)`
   * daje cykl odblokowania, a `Sim` przelicza go na `SimState.evacUnlockTick`. Faza 3,
   * strojąc to pole, przesuwa MOMENT OTWARCIA EWAKUACJI, nie długość rozgrywki.
   */
  cyclesPerRun: number;
  /** Ułamek runu, po którym Evac staje się dostępny. 0,67 = ostatnia tercja. */
  evacUnlockFraction: number;
  evacEnergyRequired: number;
  evacChargeRate: number;
  evacAlarmSeconds: number;
  spawn: SpawnConfig;
}

// [STROJENIE] — cała tabela do wyznaczenia headlessem w Fazie 3.
export const DEFAULT_RUN: RunConfig = {
  rotationPeriod: 180,
  /**
   * [STROJENIE] **Zostaje 150 — bo przemiatanie pokazało, że ta oś jest MARTWA.**
   *
   * Zmierzone (Faza 3, Zadanie 3, 250 przebiegów wprawnej i 1 000 początkującej na punkt,
   * przy `killRewardScale` 0,35): 150 → 300 → 600 → 900 → 1500 daje H4 kolejno
   * 95,5 / 90,0 / **98,8** / 92,5 / 86,2 %. Dziesięciokrotny wzrost kupuje 9 punktów przy
   * progu <15 %, a przebieg **nie jest monotoniczny** — przy 600 wychodzi GORZEJ niż przy
   * 150, i to daleko poza przedziałami (±1,9 wobec ±0,7). H1 nasyca się po 300.
   *
   * Rozstrzyga jedna liczba: `moment porażki p10` stoi na **~31 s we wszystkich pięciu
   * punktach**, podczas gdy początkująca buduje coraz więcej (szczyt zabudowy p50: 9 → 26).
   * Stać ją, buduje, ginie w tej samej sekundzie. To nie jest brak zasobów.
   *
   * Rekomendacja §11.1 („podnieść rudę startową") jest tym pomiarem OBALONA.
   */
  startingOre: 150,
  /**
   * [STROJENIE] **0,5 — wybrane razem z `baseRatePerPentagon`, nie osobno.**
   *
   * Stoi na pomiarze 1 000 przebiegów wprawnej przy tempie spawnu 0,05:
   * **H1 = 35,5 % ±3,0 (próg 25–60) i H3 = 27,3 min ±0,3 (próg 25–35)** — pierwsza nastawa
   * w całej fazie, w której oba kryteria sufitu są spełnione naraz.
   *
   * Dlaczego wyżej niż zgrubne 0,35 z przemiatania samej tej osi: przy rzadszym spawnie
   * wprawna **ubożeje**, bo nie wydobywa ani jednej rudy (p10=p50=p90=0 w każdym pomiarze)
   * i finansuje się wyłącznie nagrodami. Dochód to stawka × liczba zabitych, więc obniżenie
   * liczby trzeba odrobić stawką. Zmierzone przy 0,05: stawka 0,5 → H1 38 %, 0,8 → 71 %,
   * 1,2 → 87 %, 1,8 → 94 %.
   */
  killRewardScale: 0.5,
  /**
   * [STROJENIE] 45 sekund nocy, potem wschód — **minimum H4 zmierzone na dziesięciu fazach**
   * (59,8 % wobec 85–92 % przy starcie w dzień). Tabela i uzasadnienie przy polu w
   * `RunConfig` wyżej.
   */
  sunPhaseAtStart: 0.75,
  cyclesPerRun: 10,       // 10 × 180 s = 30 min, zgodnie z D4
  evacUnlockFraction: 0.67,
  evacEnergyRequired: 1000,
  evacChargeRate: 25,
  evacAlarmSeconds: 60,
  spawn: DEFAULT_SPAWN,
};

/**
 * Tolerancja na błąd akumulacji zmiennoprzecinkowej `evacAlarmRemaining -= TICK_SECONDS`.
 * NIE jest to liczba balansowa (stąd brak `[STROJENIE]`) — to ten sam problem i ta sama
 * decyzja, co `EXPOSURE_EPSILON` w burning.ts, tylko odchylenie idzie w drugą stronę:
 * tam `+=` ląduje tuż PONIŻEJ progu, tutaj `-=` zatrzymuje się tuż NAD zerem.
 *
 * Zmierzone: `0,05` nie ma dokładnej reprezentacji binarnej, więc odjęcie go 1200 razy
 * od 60 zostawia **1,2706086183200682e-12** zamiast zera — bez tolerancji odliczanie
 * potrzebuje 1201 ticków, a alarm trwa 60,05 s zamiast 60 s. Reszta nie jest monotoniczna
 * ani zawsze dodatnia (dla 30 s wychodzi −2,92e-13, czyli tam problem nie występuje);
 * przeskanowane co sekundę w zakresie 1–600 s, najgorsza DODATNIA reszta to
 * **5,135961100855013e-12** (dla 128 s).
 *
 * Stąd 1e-9: margines nad zmierzonym najgorszym przypadkiem **~195×**, a jednocześnie
 * 5×10⁷ razy mniej niż jeden tick (0,05 s), więc nie jest w stanie skrócić alarmu
 * o cały krok. Ten sam rząd wielkości, co `EXPOSURE_EPSILON` (1e-9) i `theta < 1e-9`
 * w `slerpToward` (movement.ts) — pakiet ma jedną skalę dla tej klasy błędu.
 */
const ALARM_EPSILON = 1e-9;

/** Cykle numerowane od 1. */
export const currentCycle = (elapsed: number, rotationPeriod: number): number =>
  Math.floor(elapsed / rotationPeriod) + 1;

export const evacUnlocked = (cycle: number, cfg: RunConfig): boolean =>
  cycle >= Math.ceil(cfg.cyclesPerRun * cfg.evacUnlockFraction);

export function updateRules(s: SimState, cfg: RunConfig): void {
  if (s.phase !== 'RUNNING') return;

  // Przegrana: utrata CORE. Jedyny warunek (§5.6).
  if (!s.buildings.some((b) => b?.type === 'CORE')) {
    s.phase = 'DEFEAT';
    return;
  }

  const evac = s.buildings.find((b) => b?.type === 'EVACUATION_MODULE') ?? null;

  if (evac === null) {
    // Zniszczony Evac kosztuje ładunek i alarm, ale NIE kończy runu — da się go odbudować.
    s.evacCharge = 0;
    s.evacAlarmRemaining = -1;
    return;
  }

  if (s.evacAlarmRemaining >= 0) {
    s.evacAlarmRemaining -= TICK_SECONDS;
    if (s.evacAlarmRemaining <= ALARM_EPSILON) s.phase = 'VICTORY';
    return;
  }

  if (evac.powered && s.evacCharge < cfg.evacEnergyRequired) {
    const draw = Math.min(cfg.evacChargeRate * TICK_SECONDS, s.storedEnergy);
    s.evacCharge += draw;
    s.storedEnergy -= draw;
  }

  if (s.evacCharge >= cfg.evacEnergyRequired) {
    s.evacAlarmRemaining = cfg.evacAlarmSeconds;
  }
}
