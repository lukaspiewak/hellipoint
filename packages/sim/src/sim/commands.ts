import { BUILDINGS } from './defs.js';
import type { BuildingType, SimState } from './state.js';

export type Command =
  | { kind: 'BUILD'; cellId: number; type: BuildingType }
  | { kind: 'DEMOLISH'; cellId: number };

/**
 * Powody, dla których `canBuild` może odmówić — **domknięta unia, nie `string`**.
 *
 * Do Fazy 2C, Zadania 4 pole `reason` miało typ `string`, a kompletność słownika komunikatów
 * po stronie klienta pilnował SKAN ŹRÓDŁA tego pliku. Skan padł dwukrotnie: raz na powodzie
 * oddanym stałą zamiast literałem, raz na odwróconej kolejności pól (`{ reason, ok: false }`).
 * Poszerzanie wyrażenia rozpoznającego kształt jest wyścigiem nie do wygrania — ta sama
 * lekcja, co przy strażniku mutacji stanu w Zadaniu 2.
 *
 * Unia przenosi gwarancję ze skanu do **kompilatora**: `Record<RefusalReason, string>`
 * w `apps/client/src/hud.ts` jest wyczerpujący z definicji, więc ósmy powód dopisany bez
 * komunikatu **nie skompiluje się**, niezależnie od tego, jak go zapisano.
 */
export type BuildRefusalReason =
  | 'NO_SUCH_CELL'
  | 'CELL_OCCUPIED'
  | 'NOT_PLAYER_BUILDABLE'
  | 'NO_SUCH_BUILDING_TYPE'
  | 'WRONG_CELL_TYPE'
  | 'INSUFFICIENT_ORE'
  | 'EVAC_LOCKED';

export type BuildCheck = { ok: true } | { ok: false; reason: BuildRefusalReason };

/**
 * Czy `cellId` jest PRAWDZIWYM indeksem komórki, a nie tylko czymś, co tablica przyjmie.
 *
 * `cells[cellId] === undefined` NIE wystarczało i to jest zmierzone: JavaScript zamienia
 * indeks tablicy na string, więc `cells["1"]` to `cells[1]` — istnieje. `{"kind":"BUILD",
 * "cellId":"1"}` prosto z JSON-a budowało się poprawnie i zapisywało `Building.cellId`
 * jako STRING `"1"`. `stateHash` tego nie widział (hashuje indeks tablicy, nie pole —
 * patrz hash.ts), więc defekt nie miał jak się ujawnić: dziś nic w kodzie produkcyjnym
 * nie czyta `Building.cellId`, ale pole istnieje, jest publiczne i pierwszy konsument
 * (renderer Fazy 2, netcode Fazy 5) dostałby string tam, gdzie typ obiecuje `number`.
 */
const isCellId = (s: SimState, cellId: number): boolean =>
  Number.isInteger(cellId) && cellId >= 0 && cellId < s.planet.cells.length;

export function canBuild(s: SimState, cellId: number, type: BuildingType): BuildCheck {
  if (!isCellId(s, cellId)) return { ok: false, reason: 'NO_SUCH_CELL' };
  const cell = s.planet.cells[cellId];
  if (s.buildings[cellId] !== null) return { ok: false, reason: 'CELL_OCCUPIED' };

  // `type` jest hartowany TAK SAMO jak `cellId` (patrz `isCellId` wyżej), i z tego samego
  // powodu: komendy
  // przychodzą z zewnątrz (w Fazie 5 — z sieci), więc sygnatura TypeScriptu nie jest
  // żadną gwarancją w runtime. Bez tej klauzuli `{kind:'BUILD', type:'DEATH_STAR'}`
  // dawało `BUILDINGS[type] === undefined` i `TypeError: Cannot read properties of
  // undefined (reading 'playerBuildable')` — wyrzucany ze ŚRODKA `Sim.step()`, czyli
  // dokładne przeciwieństwo obietnicy z doc-commentu `applyCommand` niżej („po cichu
  // ignorowana, nigdy nie przerywa symulacji"). Zmierzone przed poprawką.
  //
  // `Object.hasOwn`, nie `BUILDINGS[type] === undefined`: to drugie przepuszcza klucze
  // z PROTOTYPU (`'constructor'`, `'toString'`), dla których odczyt daje funkcję —
  // wartość prawdziwą, więc straż by nie zadziałała, a `def.costOre` wyszłoby `undefined`
  // i `s.ore -= undefined` zamieniłoby rudę w NaN (czyli cichy defekt zamiast głośnego).
  if (!Object.hasOwn(BUILDINGS, type)) return { ok: false, reason: 'NO_SUCH_BUILDING_TYPE' };

  const def = BUILDINGS[type];
  // CORE jest jedynym `playerBuildable: false` — symulacja go zasiewa bezpośrednim
  // zapisem do stanu, nigdy przez komendę. Sprawdzane PRZED typem komórki/rudą, bo to
  // fakt o samym TYPIE budynku, niezależny od tego, gdzie/za ile ktoś próbuje go postawić:
  // bez tej klauzuli `CORE.costOre = 0` plus brak innej blokady pozwalały postawić
  // dowolną liczbę darmowych CORE na dowolnej pustej komórce (`CELL_OCCUPIED` chroni
  // tylko TĘ SAMĄ komórkę przed drugim CORE, nie planetę przed setnym).
  if (!def.playerBuildable) return { ok: false, reason: 'NOT_PLAYER_BUILDABLE' };

  // §5.6: Moduł Ewakuacyjny odblokowuje się dopiero w ostatniej tercji runu. Próg jest
  // policzony raz, w konstruktorze `Sim`, i leży w stanie jako TICK — `canBuild` nie zna
  // ani `rotationPeriod`, ani `RunConfig`, a `SimState` niesie `tick`, więc porównanie
  // jest tu możliwe bez zmiany sygnatury (którą Faza 5 dziedziczy). Sprawdzane obok
  // `playerBuildable`, bo to również fakt o TYPIE budynku, niezależny od komórki i rudy.
  // Bez tej klauzuli reguła ze specu istniała wyłącznie jako funkcja `evacUnlocked`
  // w rules.ts, której nic nie wołało — patrz task-5-report.md, defekt #2.
  if (type === 'EVACUATION_MODULE' && s.tick < s.evacUnlockTick) {
    return { ok: false, reason: 'EVAC_LOCKED' };
  }

  const typeOk =
    def.allowedCells === 'ANY' ||
    (def.allowedCells === 'HEXAGON' && cell.cellType === 'HEXAGON') ||
    (def.allowedCells === 'PENTAGON' && cell.cellType === 'PENTAGON') ||
    (def.allowedCells === 'ORE_HEXAGON' && cell.cellType === 'HEXAGON' && s.oreRemaining[cellId] > 0);
  if (!typeOk) return { ok: false, reason: 'WRONG_CELL_TYPE' };

  if (s.ore < def.costOre) return { ok: false, reason: 'INSUFFICIENT_ORE' };
  return { ok: true };
}

/**
 * Komendy przychodzą z zewnątrz (a w Fazie 5 — z sieci), więc niedozwolona komenda
 * jest po cichu ignorowana, nigdy nie przerywa symulacji.
 *
 * Obietnica dotyczy KAŻDEGO pola komendy: nieznany `kind` wypada ze `switch`, nieznany
 * `type` odcina `Object.hasOwn` w `canBuild`, a `cellId` — `isCellId` (całkowity, w zakresie
 * komórek planety) w obu gałęziach. Przegląd gałęzi domknął dwa ostatnie: `type` przerywał
 * tick `TypeError`-em, a `cellId` jako string `"1"` przechodził przez koercję indeksu
 * tablicy i lądował w `Building.cellId` jako string.
 */
export function applyCommand(s: SimState, cmd: Command): void {
  switch (cmd.kind) {
    case 'BUILD': {
      if (!canBuild(s, cmd.cellId, cmd.type).ok) return;
      const def = BUILDINGS[cmd.type];
      s.ore -= def.costOre;
      s.buildings[cmd.cellId] = { cellId: cmd.cellId, type: cmd.type, hp: def.hp, powered: false };
      return;
    }
    case 'DEMOLISH': {
      // Ta sama straż indeksu, co w `canBuild` — inaczej `"1"` z JSON-a burzyłoby przez
      // koercję tablicy budynek pod indeksem 1, mimo że pole obiecuje `number`.
      if (!isCellId(s, cmd.cellId)) return;
      const b = s.buildings[cmd.cellId];
      // `== null`, nie `===`: komendy przychodzą z zewnątrz, a gęsta tablica może oddać
      // `undefined` tam, gdzie typ obiecuje `null` — obie wartości znaczą "nic tu nie ma
      // do zburzenia".
      if (b == null || b.type === 'CORE') return;
      s.ore += Math.floor(BUILDINGS[b.type].costOre / 2); // [STROJENIE] zwrot 50 %
      s.buildings[cmd.cellId] = null;
      return;
    }
  }
}
