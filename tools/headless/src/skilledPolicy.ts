import {
  multiSourceDistances,
  type BuildingType,
  type Command,
  type Planet,
  type Sim,
} from '@heliopolis/sim';
import type { Policy } from './policy.js';

/**
 * # Polityka WPRAWNA — „gdzie jest sufit?" (Faza 3, Zadanie 1)
 *
 * ## Czym się różni od `BeginnerPolicy` i dlaczego obie są potrzebne
 *
 * `BeginnerPolicy` jest zachłanna i lokalna: kupuje pierwszą przystępną rzecz z listy
 * priorytetów. Odpowiada na pytanie „czy początkujący ma szansę?" i **ma zostać słaba** —
 * gdyby ją wzmocnić, rozkłady przestałyby mówić cokolwiek o krzywej uczenia.
 *
 * Ta polityka odpowiada na pytanie odwrotne: **ile w ogóle da się z tego balansu wycisnąć.**
 * §11.1 specu zawiera zastrzeżenie, którego nie da się obejść: progi bezwzględne zmierzone
 * na słabej polityce **nie są wiążące** (tabela ekstraktorów). Bez tej klasy każdy pomiar
 * Fazy 3 mierzyłby bota, nie grę.
 *
 * ## Skąd bierze się jej siła — DWIE rzeczy, obie zmierzone w Fazie 2C
 *
 * 1. **Kolejność zakupów** z `WINNING_OPENING` (`fullrun.test.ts`), wyznaczona przemiataniem
 *    headlessem. Nie jest wymyślona i **nie wolno jej przepisywać „na oko"**.
 * 2. **ODBUDOWA przed rozbudową.** To jest ta połowa, bez której kolejka przegrywa: wersja
 *    jednorazowa (lista wykonana raz i zapomniana) kończyła run porażką w cyklu 3
 *    z 2880 rudy NIETKNIĘTEJ w banku — mur znikał między cyklem 2 a 3, panele padały od
 *    DISRUPTOR-ów, podaż siadała do 10/s przy popycie 24/s i wieże gasły kaskadą.
 *    W zwycięskim przebiegu odbudów jest **2320**.
 *
 * ## Granica, którą trzeba znać
 *
 * To **nie jest gracz optymalny** — to najlepsza znana dziś linia. Gdy Zadanie 3 przestroi
 * balans, ta kolejka może przestać wygrywać i **wtedy trzeba wyznaczyć nową przemiataniem,
 * a nie osłabiać asercje**. Dokładnie ten sam zapis stoi przy `WINNING_OPENING`.
 */

/** Pierścienie grafowe wokół CORE, z których kolejka bierze komórki. */
export type Pool = 'hex1' | 'hex2' | 'hex3' | 'hex4';

/**
 * Najdalszy pierścień, do którego wolno przelać zabudowę, gdy bliższe są pełne.
 *
 * Osiem, bo spawny stoją 6–8 kroków od bazy (D2) — dalej mur przestaje być murem BAZY.
 * [STROJENIE], ale nie balansowe: to granica grywalności polityki, nie pokrętło trudności.
 */
const MAX_SPILL_RING = 8;

const times = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value);

/**
 * `[STROJENIE]` Kolejka zabudowy — kopia `WINNING_OPENING` z `fullrun.test.ts`.
 *
 * Kopia, a nie import: `fullrun.test.ts` jest plikiem TESTOWYM `packages/sim`, a narzędzie
 * nie importuje testów cudzego pakietu. Rozjazd tych dwóch list wyłapuje test 1a (obie
 * muszą wygrywać na seedzie 33), więc kopia nie jest cicha.
 */
export const SKILLED_OPENING: ReadonlyArray<readonly [Pool, BuildingType]> = [
  ['hex1', 'LASER_TURRET'], ['hex1', 'LASER_TURRET'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex1', 'BATTERY'], ['hex1', 'BATTERY'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex2', 'BATTERY'], ['hex2', 'BATTERY'], ['hex2', 'BATTERY'],
  ...times(13, ['hex3', 'BARRICADE'] as const),
  ...times(17, ['hex4', 'BARRICADE'] as const),
  ['hex2', 'EVACUATION_MODULE'],
];

/**
 * Zamienia kolejkę „pula + typ" na konkretne komórki tej planety.
 *
 * Wyczerpana pula rzuca GŁOŚNO: `undefined` jako `cellId` dałoby komendę ignorowaną przez
 * `applyCommand`, a polityka „grałaby" dalej, nie zbudowawszy obrony — i wyglądałoby to
 * na wynik balansu.
 */
function ordersFor(planet: Planet): Command[] {
  const fromCore = multiSourceDistances(
    planet.cells.map((c) => c.neighbors),
    [planet.startCell],
  );
  const plainHexRing = (k: number): number[] =>
    planet.cells
      .filter((c) => fromCore[c.id] === k && c.cellType === 'HEXAGON' && c.oreCapacity === 0)
      .map((c) => c.id)
      .sort((a, b) => a - b);

  const pools: Record<number, number[]> = {
    1: plainHexRing(1),
    2: plainHexRing(2),
    3: plainHexRing(3),
    4: plainHexRing(4),
  };

  /**
   * **PRZELEW DO DALSZEGO PIERŚCIENIA, nie wyjątek.** Naprawa znaleziska Z2.
   *
   * Pierwsza wersja rzucała, gdy pula się wyczerpała — i robiła to na **17,3 % planet**
   * (173 z seedów 0–999), bo pierścienie hex3/hex4 bywają za małe. Partia 10 000 runów
   * z Zadania 2 padłaby **na seedzie 0**, zanim zebrałaby jeden wynik.
   *
   * Dlaczego przelew, a nie „złap i pomiń tę planetę": pominięcie **przekrzywia próbkę**
   * ku planetom o większych pierścieniach, czyli mierzy łatwiejszy podzbiór i nigdzie tego
   * nie pisze. To jest ta sama klasa co kontrola pozytywna, która przecieka. Przelew trzyma
   * politykę grywalną na KAŻDEJ planecie: gdy pierścień k nie ma już wolnego heksa,
   * budynek idzie na k+1, potem k+2. Kosztuje to trochę zwartości bazy — i o to właśnie
   * chodzi, bo ciaśniejsza planeta MA być trudniejsza, a nie wypadać z pomiaru.
   *
   * Wyjątek zostaje na przypadek, w którym zabrakło heksów we WSZYSTKICH pierścieniach do
   * ósmego włącznie — to nie jest już ciasna planeta, tylko zepsuta.
   */
  const taken: Partial<Record<number, number>> = {};
  const ringOf: Record<Pool, number> = { hex1: 1, hex2: 2, hex3: 3, hex4: 4 };

  return SKILLED_OPENING.map(([pool, type]) => {
    for (let k = ringOf[pool]; k <= MAX_SPILL_RING; k++) {
      const ring = pools[k] ?? (pools[k] = plainHexRing(k));
      const i = taken[k] ?? 0;
      if (i < ring.length) {
        taken[k] = i + 1;
        return { kind: 'BUILD', cellId: ring[i], type } as Command;
      }
    }
    throw new Error(
      `SkilledPolicy: brak wolnego heksa w pierścieniach ${ringOf[pool]}..${MAX_SPILL_RING} ` +
        `od CORE przy ${type} (planeta seed ${planet.seed}). To nie jest ciasna planeta, ` +
        'tylko zepsuta — osiem pierścieni wokół CORE nie mieści kolejki otwarcia.',
    );
  });
}

/** Nazwa, pod którą polityka wprawna podpisuje każdy wynik. Patrz `BEGINNER_POLICY_NAME`. */
export const SKILLED_POLICY_NAME = 'skilled';

export class SkilledPolicy implements Policy {
  readonly name = SKILLED_POLICY_NAME;

  /**
   * Decyzja W KAŻDYM TICKU — tak jak `playPlan`, z którego ta polityka pochodzi.
   *
   * Nie jest to „łaskawsze ustawienie", tylko warunek odtworzenia referencji: przy odstępie 1
   * seed 33 kończy na ticku **24 133**, co do ticka zgodnie z §11.1; przy 20 — na 24 340
   * i trzy z pięciu seedów piątki przegrywają. Sufit mierzony dławioną polityką nie jest
   * sufitem (Z1).
   */
  readonly decisionIntervalTicks = 1;

  private readonly orders: Command[];

  constructor(private readonly sim: Sim) {
    // RAZ, nie co tick: komórki są funkcją samej planety, a `decide()` biegnie 20 razy
    // na sekundę symulacji przez dziesiątki tysięcy ticków.
    this.orders = ordersFor(sim.state.planet);
  }

  decide(): Command[] {
    // Pierwsza pozycja kolejki, której komórka jest PUSTA — to jedno zdanie robi i budowę,
    // i odbudowę. Rozdzielenie ich na dwie pętle dawałoby tę samą odpowiedź i dwa miejsca,
    // w których można się rozjechać.
    for (const order of this.orders) {
      if (order.kind === 'BUILD' && this.sim.state.buildings[order.cellId] === null) {
        return [order];
      }
    }
    return [];
  }
}
