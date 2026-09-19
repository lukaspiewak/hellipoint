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
type Pool = 'hex1' | 'hex2' | 'hex3' | 'hex4';

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

  const pools: Record<Pool, number[]> = {
    hex1: plainHexRing(1),
    hex2: plainHexRing(2),
    hex3: plainHexRing(3),
    hex4: plainHexRing(4),
  };

  const taken: Partial<Record<Pool, number>> = {};
  return SKILLED_OPENING.map(([pool, type]) => {
    const i = taken[pool] ?? 0;
    taken[pool] = i + 1;
    const cellId = pools[pool][i];
    if (cellId === undefined) {
      throw new Error(
        `SkilledPolicy: pula ${pool} wyczerpana przy ${type} (planeta seed ${planet.seed}). ` +
          'Kolejka zakłada pierścienie o pewnej minimalnej liczbie czystych heksów — ' +
          'ta planeta ich nie ma.',
      );
    }
    return { kind: 'BUILD', cellId, type } as Command;
  });
}

export class SkilledPolicy implements Policy {
  readonly name = 'skilled';

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
