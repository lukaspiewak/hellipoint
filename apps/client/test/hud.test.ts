import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BROWNOUT_ORDER,
  BUILDINGS,
  canBuild,
  createPlanet,
  DEFAULT_RUN,
  Sim,
  TICK_SECONDS,
  type BuildCheck,
  type BuildingType,
  type BuildRefusalReason,
  type EnemyType,
  type Planet,
  type PowerReport,
  type SimState,
} from '@heliopolis/sim';
import { createCamera, type OrbitCamera, type UnitShadingMode } from '@heliopolis/render';
import {
  createFakeCanvas,
  createFakeDocument,
  createFakeEventTarget,
  describeElement,
  fireOn,
  type FakeElement,
} from '../../../packages/render/test/support/fakeCanvas.js';
import { mulberry32 } from '../../../packages/render/test/support/mulberry32.js';
import {
  describeGcWindows,
  gcMedian,
  gcNoiseLimit,
  measureGcWindows,
} from '../../../packages/render/test/support/gcWindows.js';
import {
  buildMenuRows,
  commandsAccepted,
  createHudView,
  countdownText,
  defeatSummary,
  evacCountdownSeconds,
  outcomeSummary,
  headlineText,
  MAX_MENU_TYPES,
  menuRowText,
  powerLine,
  rateText,
  refusalMessage,
  reportMessage,
  REFUSAL_MESSAGES,
  resourceLine,
  shortfallLine,
  shownAmount,
  shownRateTenths,
  type ElementLike,
  type MenuRow,
  MIN_WINDOW_WIDTH_PX,
  HUD_CHAR_WIDTH_PX,
  HUD_FONT_SIZE_PX,
  HUD_HORIZONTAL_CHROME_PX,
  MAX_HUD_LINE_CHARS,
  NAME_WIDTH,
  COST_WIDTH,
  DRAIN_WIDTH,
} from '../src/hud.js';
import {
  attachInput,
  createSelection,
  playerBuildableTypes,
  refusalReason,
  type RayCamera,
  type Report,
  type RefusalReason,
} from '../src/input.js';
import { wireClient, type Client, type ClientScene } from '../src/client.js';
import {
  buildableNear,
  builtCell,
  fourFreeHexagonsNear,
  freeHexagonNear,
  worldFingerprint,
} from './support/fixtures.js';

// Ta sama planeta-fixture, co w `input.test.ts` i w testach `packages/render` — jedna
// „prawdziwa planeta", o której mówi cała gałąź.
const planet: Planet = createPlanet({ seed: 20260915 });

/** Świeży run z rudą wystarczającą na KAŻDĄ pozycję menu — stan do czytania przez menu. */
function richRun(): { sim: Sim; s: SimState } {
  const sim = new Sim(planet, DEFAULT_RUN);
  const s = sim.state;
  s.ore = 1000; // [STROJENIE] w teście: skarbiec ponad najdroższą pozycją (EVAC, 300)
  return { sim, s };
}

function row(rows: readonly MenuRow[], type: BuildingType): MenuRow {
  const found = rows.find((r) => r.type === type);
  if (found === undefined) throw new Error(`menu nie ma pozycji ${type}`);
  return found;
}

/**
 * Bilans energii SPOCZYNKOWY — sieć bez odbiorców i bez awarii.
 *
 * Jeden obiekt na cały plik, nie świeży przy każdym wywołaniu, i to nie jest oszczędność:
 * test alokacji (21) woła `update` sto tysięcy razy w mierzonym oknie, więc fikstura
 * tworzona w pętli byłaby alokacją PRZYRZĄDU udającą alokację panelu.
 */
const IDLE_POWER: PowerReport = {
  supply: 0,
  demand: 0,
  rawDemand: 0,
  shedTypes: [],
  outage: new Uint8Array(planet.cells.length),
};

/**
 * Bilans z niedoborem: podaż, popyt sprzed kaskady i to, co zgaszono.
 *
 * `demand` (popyt PO kaskadzie) domyślnie tam, gdzie kaskada by go zostawiła, ale podawalny
 * osobno — test 8d musi mieć wartość różną OD OBU pozostałych, żeby dało się rozstrzygnąć,
 * którą z nich panel faktycznie pokazuje.
 */
function powerWith(
  supply: number,
  rawDemand: number,
  shedTypes: BuildingType[],
  demand = Math.min(supply, rawDemand),
): PowerReport {
  return { supply, demand, rawDemand, shedTypes, outage: IDLE_POWER.outage };
}

describe('buildMenuRows — menu podaje POWÓD odmowy, nie tylko jej fakt', () => {
  it('1. pozycja niosąca odmowę niesie też JEJ POWÓD', () => {
    const { s } = richRun();
    // Komórka wyszukana PRZED wyzerowaniem rudy. Brief ma tu kolejność odwrotną, a ona nie
    // działa: `freeHexagonNear` pyta `canBuild(…, 'BARRICADE')`, więc przy zerowej rudzie
    // nie znajduje ŻADNEJ komórki i rzuca `RangeError` zamiast oddać heksagon.
    const cell = freeHexagonNear(s);
    s.ore = 0; // [STROJENIE] w teście: wymuszony brak rudy

    const rows = buildMenuRows(s, cell);
    const laser = row(rows, 'LASER_TURRET');
    expect(laser.affordable).toBe(false);
    expect(laser.check).toEqual({ ok: false, reason: 'INSUFFICIENT_ORE' });

    // DRUGA POŁOWA, bez której pierwsza nie znaczy nic: implementacja odmawiająca ZAWSZE
    // i ZAWSZE tym samym powodem przeszłaby asercje wyżej. Ta sama komórka i ta sama pozycja
    // po dosypaniu rudy ma przejść.
    s.ore = BUILDINGS.LASER_TURRET.costOre;
    expect(row(buildMenuRows(s, cell), 'LASER_TURRET').check).toEqual({ ok: true });
  });

  it('2. GEOTHERMAL_CAP na heksagonie odmawia z powodem WRONG_CELL_TYPE — a na pentagonie staje', () => {
    const { s } = richRun();
    expect(row(buildMenuRows(s, freeHexagonNear(s)), 'GEOTHERMAL_CAP').check).toEqual({
      ok: false,
      reason: 'WRONG_CELL_TYPE',
    });
    // Połowa „ma przejść" — na właściwym rodzaju komórki ta sama pozycja jest do postawienia.
    // Bez niej test przeszedłby dla menu, które o pentagonach nie wie w ogóle.
    const pentagon = buildableNear(s, 'GEOTHERMAL_CAP');
    expect(planet.cells[pentagon].cellType).toBe('PENTAGON');
    expect(row(buildMenuRows(s, pentagon), 'GEOTHERMAL_CAP').check).toEqual({ ok: true });
  });

  it('3. brak wskazania to NIE brak menu: każda pozycja niesie NO_SUCH_CELL, a stać/nie stać liczy się dalej', () => {
    const { s } = richRun();
    const rows = buildMenuRows(s, null);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect({ type: r.type, check: r.check }).toEqual({
        type: r.type,
        check: { ok: false, reason: 'NO_SUCH_CELL' },
      });
    }
    // …i jest to DOKŁADNIE ten powód, którym symulacja odrzuci komendę spoza planety —
    // nie osobny, wymyślony w HUD ósmy powód.
    expect(canBuild(s, -1, 'BARRICADE')).toEqual({ ok: false, reason: 'NO_SUCH_CELL' });

    // `affordable` nie zależy od komórki — inaczej menu bez wskazania wyglądałoby na
    // menu bez pieniędzy i gracz szukałby rudy, której ma pod dostatkiem.
    s.ore = BUILDINGS.PYLON.costOre;
    const poor = buildMenuRows(s, null);
    expect(row(poor, 'PYLON').affordable).toBe(true);
    expect(row(poor, 'LASER_TURRET').affordable).toBe(false);
  });
});

describe('buildMenuRows — skład, kolejność i źródło liczb', () => {
  it('4. pozycje menu to DOKŁADNIE lista skrótów 1-9, w jej kolejności — bez CORE', () => {
    const { s } = richRun();
    const types = buildMenuRows(s, freeHexagonNear(s)).map((r) => r.type);
    // Wiązane z `playerBuildableTypes()`, bo to ONA jest kontraktem klawiszy 1-9
    // (`input.ts`, `onKeyDown`). Menu z inną kolejnością pokazywałoby przy pozycji N klawisz
    // wybierający coś innego — wada niewidoczna w żadnym teście samego menu.
    expect(types).toEqual(playerBuildableTypes());
    // Kontrola na przyrząd: lista NAPRAWDĘ coś odsiewa, a odsiewa dokładnie CORE.
    expect(Object.keys(BUILDINGS).length - types.length).toBe(1);
    expect(types).not.toContain('CORE');
    expect(BUILDINGS.CORE.playerBuildable).toBe(false);
  });

  it('5. [WŁASNOŚĆ] koszty są CZYTANE z BUILDINGS, nie przepisane — zmiana definicji przechodzi do menu', () => {
    const { s } = richRun();
    const cell = freeHexagonNear(s);
    const original = BUILDINGS.BARRICADE.costOre;
    // Własność mierzona na ŹRÓDLE PRAWDY, a nie asercją „koszt równa się 8". Kotwica na
    // dzisiejszą wartość byłaby tu wprost szkodliwa: koszty są `[STROJENIE]` i Faza 3 je
    // przestroi, a pytanie tego zadania brzmi „czy menu idzie za `BUILDINGS`", nie „ile
    // dziś kosztuje barykada".
    try {
      BUILDINGS.BARRICADE.costOre = 137; // [STROJENIE] w teście: wartość nie do pomylenia z niczym
      expect(row(buildMenuRows(s, cell), 'BARRICADE').costOre).toBe(137);

      // …i `affordable` liczy się z TEJ SAMEJ liczby, a nie z zapamiętanej. Para przy samej
      // granicy: 136 ma oblewać, 137 ma przechodzić. To wiąże operator `>=`, nie `>`.
      s.ore = 136;
      expect(row(buildMenuRows(s, cell), 'BARRICADE').affordable).toBe(false);
      s.ore = 137;
      expect(row(buildMenuRows(s, cell), 'BARRICADE').affordable).toBe(true);
    } finally {
      BUILDINGS.BARRICADE.costOre = original;
    }
    expect(BUILDINGS.BARRICADE.costOre).toBe(original); // definicja wróciła na miejsce
  });

  it('6. [WŁASNOŚĆ] „stać mnie" jest liczone NIEZALEŻNIE od powodu odmowy', () => {
    const { s } = richRun();
    // `canBuild` zwraca PIERWSZY powód, więc na komórce zajętej wszystkie pozycje mówią
    // to samo — a gracz i tak musi wiedzieć, którą z nich będzie go stać po rozbiórce.
    const occupied = builtCell(s);
    for (const r of buildMenuRows(s, occupied)) {
      expect({ type: r.type, check: r.check }).toEqual({
        type: r.type,
        check: { ok: false, reason: 'CELL_OCCUPIED' },
      });
      expect({ type: r.type, affordable: r.affordable }).toEqual({ type: r.type, affordable: true });
    }
    // Ta sama komórka, pusty skarbiec: powód odmowy się NIE zmienia (dalej zajęta), a
    // „stać mnie" owszem. Gdyby `affordable` było wyprowadzone z `check`, obie kolumny
    // zmieniałyby się razem i ta para by się nie postawiła.
    s.ore = 0;
    for (const r of buildMenuRows(s, occupied)) {
      expect({ type: r.type, reason: r.check.ok ? null : r.check.reason }).toEqual({
        type: r.type,
        reason: 'CELL_OCCUPIED',
      });
      expect({ type: r.type, affordable: r.affordable }).toEqual({ type: r.type, affordable: false });
    }
  });

  it('7. [PRÓG] pokazana ruda NIGDY nie obiecuje pozycji, której kupić się nie da', () => {
    const { s } = richRun();
    const cell = freeHexagonNear(s);
    // Własność, nie przykład: dla KAŻDEJ pozycji i dla czterech ułamków tuż pod jej kosztem
    // „widzę tyle, ile kosztuje" musi pociągać „stać mnie". Podłoga to spełnia; zaokrąglenie
    // NIE (przy koszcie 8 i rudzie 7,6 pokazałoby 8 przy pozycji, której gra odmówi —
    // czyli dokładnie tę nieczytelność przyczynową, którą to zadanie ma usuwać).
    let tested = 0;
    for (const cost of buildMenuRows(s, cell).map((r) => r.costOre)) {
      for (const delta of [0.6, 0.4, 0.001, 0]) {
        s.ore = cost - delta;
        const affordable = row(buildMenuRows(s, cell), typeWithCost(s, cell, cost)).affordable;
        if (shownAmount(s.ore) >= cost) {
          expect({ cost, delta, affordable }).toEqual({ cost, delta, affordable: true });
        }
        tested++;
      }
    }
    // Kontrola na pętlę: naprawdę się wykonała i naprawdę objęła oba przypadki (ułamek pod
    // kosztem i koszt dokładny). Bez niej „nic nie oblało" mogłoby znaczyć „nic nie badano".
    expect(tested).toBe(buildMenuRows(s, cell).length * 4);
    // Wiersz zasobów podaje CAŁKOWITE. `toContain('ruda 12')` tego NIE wiązało i jest to
    // zmierzone: napis „ruda 12.9" zawiera „ruda 12", więc pominięcie `shownAmount`
    // w `resourceLine` przechodziło 53/53, a na ekranie robiło z tego
    // `ruda 141.66666666666666`. Wiązany jest cały napis plus zakaz ułamka.
    s.ore = 141.66666666666666;
    s.storedEnergy = 12.9;
    // „magazyn", nie „energia": od Zadania 4 obok stoi WIELKOŚĆ NA SEKUNDĘ (produkcja
    // i pobór), więc zapas musi się nazywać tak, żeby gracz nie czytał go jako tempa.
    expect(resourceLine(s)).toBe('ruda 141 · magazyn 12');
    expect(resourceLine(s)).not.toMatch(/\d[.,]\d/);
  });
});

/** Pierwszy typ menu o zadanym koszcie — pomocnik pętli własności wyżej. */
function typeWithCost(s: SimState, cell: number, cost: number): BuildingType {
  const found = buildMenuRows(s, cell).find((r) => r.costOre === cost);
  if (found === undefined) throw new Error(`menu nie ma pozycji za ${cost}`);
  return found.type;
}

// =========================================================================================
// DZIEWIĘĆ powodów — dziewięć komunikatów. WŁASNOŚĆ, nie dziewięć przypadków.
//
// Zadanie 3 wiązało SIEDEM (te z `canBuild`) i zapisało granicę: `refusalReason` ma jeszcze
// dwa własne, dotyczące rozbiórki, których `canBuild` nie zna. Dopóki meldunek był gotowym
// napisem, tamte dwa i tak trafiały na ekran surowe. Krok 0 Zadania 4 to zmienia, więc
// własność obejmuje teraz OBA źródła powodów.
// =========================================================================================





/**
 * Powody, które `canBuild` NAPRAWDĘ zwraca — każdy sprowokowany osobnym wejściem.
 *
 * Istnieje po to, żeby odczyt ze źródła nie był jedyną nogą tego testu. Skan sam w sobie
 * jest kruchy (katalog wad tej fazy ma „skan kształtu zamiast pomiaru własności" na drugim
 * miejscu), więc jest tu zestawiony z zachowaniem: wyrażenie, które przestanie łapać powód,
 * wyjdzie na jaw jako powód WIDZIANY, a nie zadeklarowany.
 */
function observedReasons(): Set<RefusalReason> {
  const { s } = richRun();
  const seen = new Set<RefusalReason>();
  const collect = (check: BuildCheck): void => {
    if (!check.ok) seen.add(check.reason);
  };
  const hex = freeHexagonNear(s);
  collect(canBuild(s, -1, 'BARRICADE'));
  collect(canBuild(s, builtCell(s), 'BARRICADE'));
  collect(canBuild(s, hex, 'CORE'));
  collect(canBuild(s, hex, 'GWIAZDA_ŚMIERCI' as BuildingType));
  collect(canBuild(s, hex, 'GEOTHERMAL_CAP'));
  collect(canBuild(s, hex, 'EVACUATION_MODULE'));
  // Powody ROZBIÓRKI — te, których `canBuild` nie zna, bo jej nie dotyczy. Prowokowane
  // przez `refusalReason`, czyli przez tę samą funkcję, z której korzysta wejście gracza.
  for (const intent of [
    { kind: 'DEMOLISH', cellId: hex } as const,
    { kind: 'DEMOLISH', cellId: planet.startCell } as const,
  ]) {
    const reason = refusalReason(s, intent);
    if (reason !== null) seen.add(reason);
  }
  s.ore = 0;
  collect(canBuild(s, hex, 'LASER_TURRET'));
  return seen;
}

describe('menu niesie POBÓR ENERGII — brakująca dana łańcucha Q3', () => {
  it('7b. [PARA] pobór jest CZYTANY z BUILDINGS i dociera NA PANEL, a budynek bez poboru nie kłamie zerem', () => {
    // Przegląd zmierzył, że z ekranu nie dało się dojść do SPRAWCY brownoutu, bo brakowało
    // jednej danej: gracz widział „z 48,0/s potrzebnych" i nie miał gdzie przeczytać, że
    // jeden laser bierze 12/s. `energyDrain` nie miał ANI JEDNEGO wyjścia na ekran, więc
    // krok „to lasery zjadły prąd" nie był wnioskiem, tylko eksperymentem.
    const { s } = richRun();
    const cell = freeHexagonNear(s);

    // POŁOWA „CZYTANE, NIE PRZEPISANE" — ta sama forma, co dla kosztu w teście 5: własność
    // mierzona na ŹRÓDLE PRAWDY, nie asercją „laser bierze 12".
    const original = BUILDINGS.LASER_TURRET.energyDrain;
    try {
      BUILDINGS.LASER_TURRET.energyDrain = 37; // [STROJENIE] w teście: wartość nie do pomylenia
      expect(row(buildMenuRows(s, cell), 'LASER_TURRET').energyDrain).toBe(37);
      const panel = makePanel();
      panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null);
      expect(rowText(panel, 'LASER_TURRET')).toContain(rateText(shownRateTenths(37)));
    } finally {
      BUILDINGS.LASER_TURRET.energyDrain = original;
    }

    // POŁOWA „NA PANELU" przy wartości produkcyjnej — bez niej kolumna mogłaby istnieć
    // w `MenuRow` i nigdy nie dotrzeć na ekran.
    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null);
    expect(rowText(panel, 'LASER_TURRET')).toContain(rateText(shownRateTenths(BUILDINGS.LASER_TURRET.energyDrain)));
    expect(rowText(panel, 'PYLON')).toContain(rateText(shownRateTenths(BUILDINGS.PYLON.energyDrain)));

    // POŁOWA „NIE KŁAMIE ZEREM": budynek bez poboru zostawia puste miejsce, a nie „0,0/s" —
    // zero jest tu szumem w kolumnie, w której gracz szuka winowajcy.
    expect(BUILDINGS.BARRICADE.energyDrain).toBe(0); // kontrola na fiksturę
    expect(rowText(panel, 'BARRICADE')).not.toContain('/s');
    // …a kolumna zostaje NA MIEJSCU, więc zdania odmowy dalej się wyrównują: wiersz bez
    // poboru jest tak samo długi jak wiersz z poborem, aż do zdania odmowy.
    // Wyrównanie mierzone na stanie, w którym OBA wiersze NIOSĄ zdanie odmowy — bo inaczej
    // asercja pustoszeje. Pierwsza wersja porównywała `indexOf` na wierszach dla komórki
    // BUDOWALNEJ, gdzie zdania nie ma: obie strony dawały `-1`, więc `-1 === -1` przechodziło
    // niezależnie od tego, czy kolumna trzyma szerokość. Znalazł to ponowny przegląd Zadania 4
    // sondą wypisującą oba indeksy.
    panel.view.update(s, IDLE_POWER, null, 'BARRICADE', null);
    const withDrain = allText(panel.rows()[playerBuildableTypes().indexOf('LASER_TURRET')]);
    const without = allText(panel.rows()[playerBuildableTypes().indexOf('BARRICADE')]);
    const at = withDrain.indexOf('wskaż');
    // Strażnik na samą asercję: gdyby zdanie odmowy zniknęło z obu wierszy, `-1 === -1`
    // znów przeszłoby bez związania czegokolwiek.
    expect(at).toBeGreaterThan(0);
    expect(at).toBe(without.indexOf('wskaż'));
    panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null);

    // Łapka (jedyny element łapiący wskaźnik) NIE urosła o tę kolumnę — inaczej naprawa
    // trafialności z Zadania 3 zapłaciłaby za tę daną szerokością dziury w sterowaniu.
    expect(allText(panel.picks()[playerBuildableTypes().indexOf('LASER_TURRET')])).not.toContain('/s');
  });
});

describe('refusalMessage — każdy powód odmowy mówi po ludzku', () => {
  it('8. [WŁASNOŚĆ] KAŻDY powód z commands.ts ma komunikat po polsku, nieniosący identyfikatora', () => {
    // **Źródłem prawdy jest TYP, nie skan źródła** (runda naprawcza 1 Zadania 4).
    //
    // Do tej rundy zbiór powodów budował lekser czytający `commands.ts` i `input.ts`.
    // Padł dwukrotnie: raz na powodzie oddanym stałą zamiast literałem, raz na odwróconej
    // kolejności pól (`{ reason, ok: false }`). Poszerzanie wyrażenia rozpoznającego
    // kształt jest wyścigiem nie do wygrania — ta sama lekcja, co przy strażniku mutacji
    // stanu w Zadaniu 2, gdzie odpowiedzią było SKASOWANIE skanu.
    //
    // `REFUSAL_MESSAGES` ma typ `Record<RefusalReason, string>`, więc jego klucze to
    // DOKŁADNIE unia: brak wpisu nie kompiluje się, nadmiarowy też nie (nadmiar pola
    // w literale obiektu). Czyli `Object.keys` jest tu wyczerpujące z gwarancji
    // kompilatora, a nie z jakości wyrażenia regularnego.
    const declared = new Set(Object.keys(REFUSAL_MESSAGES) as RefusalReason[]);
    const observed = observedReasons();

    // Kontrola na przyrząd — bez niej pusta pętla przeszłaby na zielono. DZIEWIĘĆ, nie
    // siedem: Krok 0 Zadania 4 wprowadził powody rozbiórki na tę samą drogę, co powody
    // budowy, więc własność obejmuje je od tej pory obie.
    expect(declared.size).toBeGreaterThanOrEqual(9);
    expect(observed.size).toBeGreaterThanOrEqual(9);
    // …i są wśród nich DOKŁADNIE te dwa, których Zadanie 3 nie umiało objąć. Asercja
    // z nazwy, nie tylko po liczbie: podniesiona granica byłaby spełniona także przez dwa
    // powody dowolne inne.
    for (const reason of ['NOTHING_TO_DEMOLISH', 'CORE_INDESTRUCTIBLE'] as const) {
      expect({ reason, declared: declared.has(reason), observed: observed.has(reason) }).toEqual({
        reason, declared: true, observed: true,
      });
    }
    // Ta połowa pilnuje, że UNIA NIE ODKLEIŁA SIĘ OD ZACHOWANIA: każdy powód, który
    // `canBuild`/`refusalReason` naprawdę zwracają, musi być w słowniku. Kompilator
    // gwarantuje, że słownik pokrywa unię — ale nie gwarantuje, że unia pokrywa to, co
    // kod faktycznie produkuje (powód dopisany do `if`-a i zwrócony bez rozszerzenia typu
    // dałby błąd kompilacji dopiero w miejscu zwrotu, a nie tutaj). To jest druga noga.
    //
    // Zawieranie, a nie równość zbiorów: powód zadeklarowany, którego ta próbka nie
    // prowokuje, ma dalej mieć komunikat (pętla niżej go obejmuje) — ale nie ma powodu
    // wymuszać na kolejnym zadaniu dopisania tu fikstury tylko po to, żeby test się zgodził.
    for (const reason of observed) {
      expect({ reason, wŹródle: declared.has(reason) }).toEqual({ reason, wŹródle: true });
    }

    for (const reason of declared) {
      const message = refusalMessage(reason);
      expect({ reason, empty: message.length === 0 }).toEqual({ reason, empty: false });
      expect({ reason, message }).not.toEqual({ reason, message: reason });
      // Klucz tego testu: komunikat nie może ZAWIERAĆ identyfikatora. To odcina naraz dwie
      // rzeczy — identyfikator w przebraniu („odmowa: INSUFFICIENT_ORE") i napis zastępczy
      // z `refusalMessage`, którym moduł ratuje pętlę renderu przed nieznanym powodem.
      // Bez tej asercji brak wpisu w słowniku PRZECHODZI, bo napis zastępczy jest niepusty
      // i różny od identyfikatora — czyli test z briefu byłby prawdziwy z konstrukcji.
      expect({ reason, carriesId: message.includes(reason) }).toEqual({ reason, carriesId: false });
    }

    // Dziewięć powodów ma dać dziewięć RÓŻNYCH zdań. Jeden komunikat skopiowany pod
    // wszystkie klucze spełniłby każdą asercję wyżej i nie powiedziałby graczowi niczego.
    const messages = [...declared].map((r) => refusalMessage(r));
    expect(new Set(messages).size).toBe(declared.size);
  });

  /**
   * Tytuł do rundy naprawczej 2 brzmiał „słownik WOLNO mieć nadmiarowy" — czyli twierdził
   * coś, czego **zabrania i kompilator (`Record<RefusalReason, string>`), i ostatnia asercja
   * tego samego testu**. Był resztką po czasach skanu źródła, gdy nadmiarowy wpis faktycznie
   * był dopuszczalny (N15).
   *
   * Co ten test naprawdę pilnuje: gałęzi zastępczej dla powodu, który przyszedł SPOZA typu.
   * Wewnątrz kodu taki powód nie może już powstać, ale może przyjść z zewnątrz (Faza 5:
   * komenda z sieci, starszy zapis) — i wtedy pętla renderu nie ma prawa paść.
   *
   * Liczności słownika ten test już NIE sprawdza: `Record<RefusalReason, string>` daje
   * komplet przy kompilacji, a asercja „co najmniej 9" była kotwicą na dzisiejszą liczbę
   * powodów przebraną za próg.
   */
  it('9. powód spoza typu (sieć, stary zapis) nie wywala gry — napis zastępczy krzyczy identyfikatorem', () => {
    // Powód spoza słownika nie rzuca (pętla renderu gracza nie ma prawa paść, bo
    // `packages/sim` dostał ósmy powód) — ale wynik NIESIE identyfikator, więc wada jest
    // widoczna i na ekranie, i w teście wyżej.
    // Rzutowanie jest tu UZASADNIONE, nie wygodne: po zamknięciu `RefusalReason` w unię
    // powód spoza niej nie może już powstać w kodzie — ale MOŻE przyjść z zewnątrz
    // (Faza 5: komenda z sieci, starszy zapis). Dokładnie ten przypadek broni gałąź
    // zastępcza, więc test musi go udawać, a typ nie ma jak go wyrazić.
    const unknown = refusalMessage('CZWARTY_KSIĘŻYC' as RefusalReason);
    expect(unknown).toContain('CZWARTY_KSIĘŻYC');
    expect(Object.keys(REFUSAL_MESSAGES)).not.toContain('CZWARTY_KSIĘŻYC');
  });
});

// =========================================================================================
// Krok 0: JEDNO źródło zdań (Faza 2C, Zadanie 4)
//
// Zadanie 3 zgłosiło rozjazd i świadomie go nie naprawiło: panel mówił „komórka zajęta —
// najpierw rozbierz", a nakładka diagnostyczna obok, o TYM SAMYM kliknięciu, pokazywała
// surowe `odmowa: CELL_OCCUPIED`. Przyczyną były dwa źródła napisów, nie dwa złe napisy.
// =========================================================================================

describe('reportMessage — meldunek strukturalny staje się zdaniem w JEDNYM miejscu', () => {
  it('8b. [WŁASNOŚĆ] odmowa w nakładce mówi DOKŁADNIE to, co panel — i nie niesie identyfikatora', () => {
    // To jest rozjazd z `task-3-report.md` §7.1, zmierzony na obu wyjściach naraz: napis
    // nakładki musi ZAWIERAĆ to samo zdanie, które panel stawia przy pozycji menu.
    const { s } = richRun();
    const occupied = builtCell(s);
    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, occupied, 'BARRICADE', null);

    const intent = { kind: 'BUILD', cellId: occupied, type: 'BARRICADE' } as const;
    const reason = refusalReason(s, intent);
    expect(reason).toBe('CELL_OCCUPIED');
    const overlay = reportMessage({ kind: 'REFUSED', intent, reason: reason! });

    // POŁOWA PIERWSZA: nakładka i panel niosą TO SAMO zdanie.
    expect(overlay).toContain(refusalMessage('CELL_OCCUPIED'));
    expect(panel.text()).toContain(refusalMessage('CELL_OCCUPIED'));
    // POŁOWA DRUGA, i to ona była zepsuta: identyfikator NIE trafia na ekran ŻADNYM z dwóch
    // wyjść. Napis `odmowa: CELL_OCCUPIED` (kształt sprzed tej zmiany) oblewa tutaj.
    expect(overlay).not.toContain('CELL_OCCUPIED');
    expect(panel.text()).not.toContain('CELL_OCCUPIED');
    // …a komórka, której dotyczy, jest nadal w meldunku — bez niej gracz nie wie, o co chodzi.
    expect(overlay).toContain(String(occupied));
  });

  it('8c. [WŁASNOŚĆ] KAŻDY rodzaj meldunku daje zdanie po polsku, bez surowego identyfikatora powodu', () => {
    // Pętla po WSZYSTKICH dziewięciu powodach plus po każdym pozostałym rodzaju meldunku.
    // Rodzaj bez gałęzi w `reportMessage` jest dziś błędem kompilacji (unia wyczerpana), ale
    // gałąź zwracająca identyfikator — już nie, i to ona jest tu badana.
    const reports: Report[] = [
      { kind: 'QUEUED', intent: { kind: 'BUILD', cellId: 7, type: 'LASER_TURRET' } },
      { kind: 'QUEUED', intent: { kind: 'DEMOLISH', cellId: 7 } },
      { kind: 'MISSED' },
      { kind: 'FOCUS_CORE', cellId: planet.startCell },
      { kind: 'TYPE_CHOSEN', type: 'PYLON' },
      { kind: 'SHADING', mode: 'threshold' },
      ...(Object.keys(REFUSAL_MESSAGES) as RefusalReason[]).map(
        (reason): Report => ({ kind: 'REFUSED', intent: { kind: 'BUILD', cellId: 7, type: 'PYLON' }, reason }),
      ),
    ];
    const seen = new Set<string>();
    for (const report of reports) {
      const message = reportMessage(report);
      expect({ report: report.kind, empty: message.length === 0 }).toEqual({ report: report.kind, empty: false });
      if (report.kind === 'REFUSED') {
        expect({ reason: report.reason, carriesId: message.includes(report.reason) }).toEqual({
          reason: report.reason, carriesId: false,
        });
      }
      seen.add(message);
    }
    // Każdy meldunek mówi coś INNEGO — jedno zdanie pod wszystkie rodzaje spełniłoby
    // asercje wyżej i nie powiedziałoby graczowi niczego.
    expect(seen.size).toBe(reports.length);
    // Koszt w meldunku o wyborze typu jest CZYTANY z `BUILDINGS`, nie przepisany — ta sama
    // tabela, co w menu.
    expect(reportMessage({ kind: 'TYPE_CHOSEN', type: 'PYLON' })).toContain(String(BUILDINGS.PYLON.costOre));
    // Nazwy budynków zostają angielskimi identyfikatorami (decyzja Fazy 4) — i to jest
    // ZGODNE z menu oraz ze skrótami 1-9, gdzie gracz widzi dokładnie te same napisy.
    expect(reportMessage({ kind: 'TYPE_CHOSEN', type: 'PYLON' })).toContain('PYLON');
  });
});

// =========================================================================================
// Krok 5: BILANS — liczba, po której da się odkryć łańcuch Q3
// =========================================================================================

describe('bilans energii — HUD mówi, CZEGO brakuje i CO przez to zgasło', () => {
  it('8d. [PRÓG] linia bilansu niesie WSZYSTKIE TRZY wielkości i bierze popyt SPRZED kaskady', () => {
    // `demand` (po kaskadzie) na ekranie byłoby liczbą bezużyteczną: kaskada gasi DOPÓKI
    // popyt nie zejdzie do podaży, więc deficyt znikałby dokładnie wtedy, gdy zaczyna boleć.
    // Test podaje raport, w którym obie wartości RÓŻNIĄ SIĘ, i sprawdza, którą widać.
    // `demand` różne OD OBU pozostałych — inaczej „nie widać popytu po kaskadzie" byłoby
    // prawdziwe z konstrukcji, bo pokrywałoby się z podażą.
    const power = powerWith(10, 48, ['EXTRACTOR'], 7.3);
    expect(power.demand).not.toBe(power.rawDemand);
    expect(power.demand).not.toBe(power.supply);
    const line = powerLine(power);
    expect(line).toContain(rateText(shownRateTenths(10)));
    expect(line).toContain(rateText(shownRateTenths(48)));
    expect(line).not.toContain(rateText(shownRateTenths(power.demand)));

    // Trzecia wielkość — MAGAZYN — stoi w wierszu zasobów, bo tam stała od Zadania 3.
    // Jedna liczba ma jedno miejsce (`client.ts`): duplikat w dwóch zaokrągleniach był
    // defektem, który Zadanie 3 usuwało.
    const { s } = richRun();
    s.storedEnergy = 47.9;
    expect(resourceLine(s)).toContain('magazyn 47');
  });

  it('8e. [PARA] „brakuje X/s — zgaszono: …" pojawia się z niedoborem i znika bez niego', () => {
    // Kryterium briefu, nie technika: gracz ma widzieć PRZYCZYNĘ („brakuje 38/s, zgaszono
    // kopalnie"), a nie sam skutek („kopalnie nie działają").
    const shed = shortfallLine(powerWith(10, 48, ['EXTRACTOR', 'KINETIC_TURRET']));
    expect(shed).toContain(rateText(shownRateTenths(38))); // LICZBA niedoboru
    expect(shed).toContain('EXTRACTOR'); // CO zgasło
    expect(shed).toContain('KINETIC_TURRET');
    // KOLEJNOŚĆ gaszenia jest treścią: to ona mówi, że kopalnie padają PIERWSZE, czyli
    // dlaczego po brownoucie nie ma z czego odbudować obrony.
    expect(shed.indexOf('EXTRACTOR')).toBeLessThan(shed.indexOf('KINETIC_TURRET'));
    // …ale kolejność GASZENIA nie jest kolejnością CZYTANIA: pierwszy w zdaniu jest
    // NIEDOBÓR (przyczyna), a lista stoi za spójnikiem następstwa. Bez tego zdanie stawiało
    // na początku OFIARĘ i podpowiadało „dobuduj kopalnie" — dokładnie odwrotnie, niż trzeba.
    expect(shed.indexOf('brakuje')).toBeLessThan(shed.indexOf('więc gasną'));
    expect(shed.indexOf('więc gasną')).toBeLessThan(shed.indexOf('EXTRACTOR'));
    // Para: zdanie bez niedoboru (kaskada od samego odcięcia produkcji) nadal NIE zaczyna
    // się od ofiary — zaczyna się od spójnika następstwa.
    expect(shortfallLine(powerWith(10, 10, ['EXTRACTOR']))).toMatch(/^więc gasną: EXTRACTOR$/);

    // POŁOWA „MA ZNIKNĄĆ": sieć z nadwyżką nie mówi nic. Bez niej ostrzeżenie mogłoby stać
    // na ekranie zawsze i nie znaczyć nic.
    expect(shortfallLine(powerWith(48, 10, []))).toBe('');
    expect(shortfallLine(powerWith(10, 10, []))).toBe('');

    // TRZECI STAN: niedobór jest, ale magazyn go jeszcze pokrywa — ostrzeżenie PRZED faktem.
    const draining = shortfallLine(powerWith(10, 48, []));
    expect(draining).toContain(rateText(shownRateTenths(38)));
    expect(draining).toContain('magazyn');
    expect(draining).not.toContain('zgaszono');

    // Liczba niedoboru zgadza się z RÓŻNICĄ liczb pokazanych w linii bilansu — inaczej
    // panel potrafiłby pokazać „10,0/s z 48,0/s — brakuje 37,9/s", czyli zdanie, które samo
    // siebie nie zgadza się o dziesiątą.
    const power = powerWith(9.97, 48.02, ['EXTRACTOR']);
    const shownSupply = shownRateTenths(power.supply);
    const shownDemand = shownRateTenths(power.rawDemand);
    expect(shortfallLine(power)).toContain(rateText(shownDemand - shownSupply));
  });

  it('8f. [ŁAŃCUCH Q3] cztery lasery gaszą kopalnie, a panel to MÓWI — z prawdziwej symulacji', () => {
    // Serce zadania, na prawdziwym `Sim`, nie na ręcznej fiksturze: `LASER_TURRET.energyDrain`
    // 12 × 4 = 48/s przy produkcji CORE 10/s, a `BROWNOUT_ORDER` gasi EKSTRAKTOR pierwszy.
    // Gracz autoryzował WIĘCEJ obrony i dostał MNIEJ — dopóki tego nie widać, nie ma jak tego
    // odkryć (Faza 1C: cztery lasery 10 224 tiki, dwa lasery 13 323).
    const sim = new Sim(planet, DEFAULT_RUN);
    const s = sim.state;
    s.ore = 10_000; // [STROJENIE] w teście: skarbiec ponad ekstraktorem i czterema laserami
    sim.enqueue({ kind: 'BUILD', cellId: buildableNear(s, 'EXTRACTOR'), type: 'EXTRACTOR' });
    sim.step();
    for (const cellId of fourFreeHexagonsNear(s)) {
      sim.enqueue({ kind: 'BUILD', cellId, type: 'LASER_TURRET' });
    }
    sim.step();
    s.storedEnergy = 0; // magazyn wyczerpany: kaskada musi zadziałać
    sim.step();

    const power = sim.lastPower;
    expect(power.shedTypes, 'kopalnie gasną PIERWSZE').toContain('EXTRACTOR');

    const panel = makePanel();
    expect(panel.view.update(s, power, null, 'BARRICADE', null)).toBe(true);
    const text = panel.text();

    // 1. LICZBA, której brakuje — bez niej gracz widzi skutek, nie przyczynę.
    expect(text).toContain(rateText(shownRateTenths(power.rawDemand) - shownRateTenths(power.supply)));
    // 2. CO zgasło — i to jako NASTĘPSTWO niedoboru, nie jako nagłówek. Spójnik jest tu
    //    asercją, a nie ozdobą: bez niego pierwszym nazwanym typem jest OFIARA i najprostszy
    //    wniosek gracza brzmi „dobuduj kopalnie", czyli odwrotnie, niż trzeba.
    expect(text).toContain('więc gasną');
    expect(text).toContain('EXTRACTOR');
    expect(text.indexOf('brakuje')).toBeLessThan(text.indexOf('EXTRACTOR'));
    // 3. …oraz OBIE strony bilansu, żeby dało się zobaczyć, że to POBÓR urósł, a nie
    //    produkcja spadła. To jest zdanie, które odróżnia „dobuduj panele" od „rozbierz laser".
    expect(text).toContain(rateText(shownRateTenths(power.supply)));
    expect(text).toContain(rateText(shownRateTenths(power.rawDemand)));
    expect(power.rawDemand).toBeGreaterThan(4 * BUILDINGS.LASER_TURRET.energyDrain);
    // 4. …i POBÓR POJEDYNCZEGO lasera — druga z dwóch liczb, z których gracz wylicza
    //    sprawcę (4 × 12 = 48). Bez niej krok „to lasery" nie jest czytaniem, tylko
    //    eksperymentem: rozbierz jeden i zobacz, czy popyt spadnie.
    expect(text).toContain(rateText(shownRateTenths(BUILDINGS.LASER_TURRET.energyDrain)));

    console.log(`[Q3] panel mówi: ${panel.text().split('\\n').join(' | ')}`);
  });

  it('8g. [BRAMKA] zmiana bilansu przemalowuje panel — a bilans bez zmiany nie', () => {
    // Bramka świeżości porównuje DZIESIĄTE, czyli dokładnie to, co idzie na ekran. Gdyby
    // porównywała surowe `supply`, panel przemalowywałby się w KAŻDEJ klatce (podaż pełznie
    // razem ze światłem), czyli alokowałby dziewięć obiektów menu sześćdziesiąt razy na
    // sekundę — dokładnie to, czego zabrania `global-constraints.md`.
    const { s } = richRun();
    const panel = makePanel();
    const cell = freeHexagonNear(s);
    expect(panel.view.update(s, powerWith(10, 20, []), cell, 'BARRICADE', null)).toBe(true);
    expect(panel.view.update(s, powerWith(10, 20, []), cell, 'BARRICADE', null)).toBe(false);

    // Zmiana PONIŻEJ rozdzielczości wyświetlania nie przemalowuje — bo nie zmienia znaku.
    expect(panel.view.update(s, powerWith(10.001, 20, []), cell, 'BARRICADE', null)).toBe(false);
    // …a zmiana widoczna na ekranie — przemalowuje. Para przy samej granicy dziesiątej.
    expect(panel.view.update(s, powerWith(10.06, 20, []), cell, 'BARRICADE', null)).toBe(true);

    // ## DRUGA POŁOWA BRAMKI: sam POPYT, przy nieruchomej podaży (naprawa F5)
    //
    // Usunięcie `demandTenths` z bramki przechodziło 686/686, bo ten test ruszał wyłącznie
    // podażą i listą zgaszonych. Kiedy to boli: w trakcie brownoutu magazyn stoi na zerze,
    // ekstraktory są zgaszone, więc podłoga rudy i podłoga magazynu się NIE zmieniają —
    // a gdy wróg zniszczy jeden laser, `rawDemand` spada 48 → 36 i nic innego w bramce nie
    // drgnie. Panel pokazywałby dalej „z 48,0/s potrzebnych" DOKŁADNIE w chwili, w której
    // ta liczba ma znaczenie.
    expect(panel.view.update(s, powerWith(10.06, 36, ['EXTRACTOR']), cell, 'BARRICADE', null)).toBe(true);
    expect(panel.view.update(s, powerWith(10.06, 36, ['EXTRACTOR']), cell, 'BARRICADE', null)).toBe(false);
    // Para przy samej granicy dziesiątej, tak jak dla podaży wyżej.
    expect(panel.view.update(s, powerWith(10.06, 36.001, ['EXTRACTOR']), cell, 'BARRICADE', null)).toBe(false);
    expect(panel.view.update(s, powerWith(10.06, 36.06, ['EXTRACTOR']), cell, 'BARRICADE', null)).toBe(true);
    // …i pokazana liczba NAPRAWDĘ poszła za popytem, a nie tylko bramka drgnęła.
    expect(panel.text()).toContain(rateText(shownRateTenths(36.06)));

    // Sama LISTA zgaszonych typów jest osobnym kanałem: te same liczby, inny skutek.
    expect(panel.view.update(s, powerWith(10.06, 20, ['EXTRACTOR']), cell, 'BARRICADE', null)).toBe(true);
    expect(panel.view.update(s, powerWith(10.06, 20, ['EXTRACTOR']), cell, 'BARRICADE', null)).toBe(false);
    // …łącznie z KOLEJNOŚCIĄ, której maska bitowa by nie uniosła.
    expect(
      panel.view.update(s, powerWith(10.06, 20, ['KINETIC_TURRET', 'EXTRACTOR']), cell, 'BARRICADE', null),
    ).toBe(true);
    expect(panel.text()).toContain('KINETIC_TURRET, EXTRACTOR');
  });
});

describe('fazy runu — czego canBuild nie widzi', () => {
  it('10. [PARA] commandsAccepted zgadza się z tym, co Sim.step NAPRAWDĘ robi z kolejką', () => {
    // POŁOWA POZYTYWNA: w RUNNING komenda się wykonuje.
    const running = new Sim(planet, DEFAULT_RUN);
    const cellA = freeHexagonNear(running.state);
    expect(commandsAccepted(running.state)).toBe(true);
    running.enqueue({ kind: 'BUILD', cellId: cellA, type: 'BARRICADE' });
    running.step();
    expect(running.state.buildings[cellA]?.type).toBe('BARRICADE');

    // POŁOWA NEGATYWNA: po końcu runu `step()` kasuje kolejkę w całości (`loop.ts`), więc
    // sterowanie przestaje działać, a `canBuild` nadal mówi „można". To jest jedyny powód,
    // dla którego panel w ogóle czyta `phase`.
    // OBIE fazy końca, nie jedna: `loop.ts` kasuje kolejkę dla każdej `phase !== 'RUNNING'`,
    // więc test mierzący wyłącznie `DEFEAT` przepuszcza `phase !== 'DEFEAT'` — implementację,
    // która po zwycięstwie obiecuje graczowi sterowanie, którego już nie ma.
    for (const phase of ['DEFEAT', 'VICTORY'] as const) {
      const over = new Sim(planet, DEFAULT_RUN);
      const cellB = freeHexagonNear(over.state);
      over.state.phase = phase; // [STROJENIE] w teście: wymuszony koniec runu
      expect({ phase, accepted: commandsAccepted(over.state) }).toEqual({ phase, accepted: false });
      // …a `canBuild` o tym nie wie i wiedzieć nie ma — gdyby wiedziała, ten test mierzyłby
      // dwie kopie tej samej reguły.
      expect(canBuild(over.state, cellB, 'BARRICADE')).toEqual({ ok: true });
      over.enqueue({ kind: 'BUILD', cellId: cellB, type: 'BARRICADE' });
      over.step();
      expect({ phase, built: over.state.buildings[cellB] }).toEqual({ phase, built: null });
    }
  });

  it('11. [PARA] EVAC_LOCKED znika DOKŁADNIE na ticku odblokowania', () => {
    const { s } = richRun();
    const cell = freeHexagonNear(s);
    // Kontrola: bramka jest NAPRAWDĘ zamknięta na starcie, inaczej para niżej mierzyłaby nic.
    expect(s.evacUnlockTick).toBeGreaterThan(0);
    expect(s.tick).toBe(0);
    expect(row(buildMenuRows(s, cell), 'EVACUATION_MODULE').check).toEqual({
      ok: false,
      reason: 'EVAC_LOCKED',
    });
    s.tick = s.evacUnlockTick - 1;
    expect(row(buildMenuRows(s, cell), 'EVACUATION_MODULE').check).toEqual({
      ok: false,
      reason: 'EVAC_LOCKED',
    });
    s.tick = s.evacUnlockTick;
    expect(row(buildMenuRows(s, cell), 'EVACUATION_MODULE').check).toEqual({ ok: true });
  });
});

// =========================================================================================
// Panel na ekranie — co pokazuje, czego NIE pokazuje i kiedy się przemalowuje
// =========================================================================================

/**
 * Cała treść poddrzewa, REKURENCYJNIE — tak, jak `textContent` składa ją w prawdziwym DOM-ie,
 * a atrapa (zwykłe pole) nie.
 *
 * Runda naprawcza 1: poprzednia wersja sklejała `textContent` BEZPOŚREDNICH dzieci korzenia,
 * więc każda asercja o treści panelu była strażnikiem **jednego poziomu zagnieżdżenia**.
 * Zmierzone w przeglądzie: żywy odczyt `hp 333 · BEZ PRĄDU` w elemencie zagnieżdżonym
 * przechodził, a ten sam dopisek w bezpośrednim dziecku oblewał. Po podziale wiersza na
 * „łapkę" i „powód" (naprawa trafialności wskaźnikiem) CAŁA treść menu leży o poziom głębiej,
 * więc płaski odczyt nie widziałby już nic.
 */
function allText(element: FakeElement): string {
  return (element.textContent ?? '') + element.children.map(allText).join('');
}

interface Panel {
  root: FakeElement;
  view: ReturnType<typeof createHudView>;
  chosen: BuildingType[];
  /** Wiersze menu (pojemniki). */
  rows(): FakeElement[];
  /** „Łapki" — JEDYNE elementy panelu, które łapią wskaźnik. */
  picks(): FakeElement[];
  text(): string;
  /** Zrzut STRUKTURY: tag, klasa, kontrakt wskaźnika i treść na każdej głębokości. */
  dump(): string;
}

function panelOf(root: FakeElement, view: ReturnType<typeof createHudView>, chosen: BuildingType[]): Panel {
  const rows = (): FakeElement[] => root.children.filter((c) => c.className.startsWith('hud-row'));
  return {
    root,
    view,
    chosen,
    rows,
    picks: () => rows().map((r) => r.children[0]),
    text: () => allText(root),
    dump: () => describeElement(root),
  };
}

function makePanel(): Panel {
  const root = createFakeDocument().createElement('div');
  const chosen: BuildingType[] = [];
  const view = createHudView(root as unknown as ElementLike, (type) => chosen.push(type));
  return panelOf(root, view, chosen);
}

function rowText(panel: Panel, type: BuildingType): string {
  const index = playerBuildableTypes().indexOf(type);
  return allText(panel.rows()[index]);
}

describe('HudView — panel zasobów i budowy', () => {
  it('12. panel niesie POLSKI powód, a surowy identyfikator na ekran NIE trafia', () => {
    const { s } = richRun();
    const panel = makePanel();
    expect(panel.view.update(s, IDLE_POWER, freeHexagonNear(s), 'BARRICADE', null)).toBe(true);

    const geothermal = rowText(panel, 'GEOTHERMAL_CAP');
    expect(geothermal).toContain(refusalMessage('WRONG_CELL_TYPE'));
    // …a to jest połowa, o którą naprawdę chodzi: identyfikator zostaje w kodzie.
    expect(geothermal).not.toContain('WRONG_CELL_TYPE');
    expect(panel.text()).not.toMatch(/\b[A-Z]+_[A-Z_]*(CELL|TYPE|ORE|LOCKED|OCCUPIED)\b/);

    // Pozycja możliwa do postawienia nie niesie ŻADNEGO powodu — inaczej „powód odmowy"
    // byłby ozdobą, a nie informacją.
    expect(rowText(panel, 'BARRICADE')).not.toContain(refusalMessage('WRONG_CELL_TYPE'));
    // Liczby, których świat unieść nie może: koszt przy pozycji i zasoby w nagłówku.
    expect(rowText(panel, 'LASER_TURRET')).toContain(String(BUILDINGS.LASER_TURRET.costOre));
    expect(panel.text()).toContain(resourceLine(s));
  });

  it('13. [GRANICA ZAKRESU] panel NIE zależy ani od `powered`, ani od punktów życia', () => {
    // To jest asercja o granicy zakresu, i dlatego jest własnością, a nie szukaniem słów
    // w napisie: Faza 2B kosztowała trzy rundy naprawcze, żeby oba te kanały działały
    // w samym świecie (pierścień alarmu, pole rdzenia). Panel powtarzający je unieważniłby
    // tamtą pracę i filar D1 („gracz odczytuje stan wzrokiem, bez UI").
    const { s } = richRun();
    const cell = builtCell(s);
    const building = s.buildings[cell];
    if (building === null) throw new Error('fixture: komórka miała być zabudowana');

    const panel = makePanel();
    expect(panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null)).toBe(true);
    const before = panel.dump();

    building.hp = Math.floor(building.hp / 3);
    building.powered = !building.powered;
    // POŁOWA PIERWSZA: nic z tego nie każe panelowi się przemalować.
    expect(panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null)).toBe(false);

    // POŁOWA DRUGA, i to ona niesie tu ciężar: ŚWIEŻY panel, malowany od zera na stanie
    // z innym `hp` i innym `powered`, ma dać wyjście identyczne CO DO ZNAKU.
    //
    // Porównywany jest ZRZUT STRUKTURY (`describeElement`), nie sklejony tekst jednego
    // poziomu — i to jest naprawa rundy 1. Poprzednia wersja porównywała `textContent`
    // bezpośrednich dzieci korzenia, więc granica zakresu była pilnowana na jednym poziomie
    // zagnieżdżenia: zmierzone w przeglądzie, że duplikat przemycony w `className`
    // przechodził, a ten sam odczyt `hp` w elemencie zagnieżdżonym przechodził również.
    // Zrzut obejmuje klasę, treść i kontrakt wskaźnika na KAŻDEJ głębokości, więc obie
    // drogi przemytu wpadają pod jednego strażnika zamiast pod dwie łatki.
    const fresh = makePanel();
    expect(fresh.view.update(s, IDLE_POWER, cell, 'BARRICADE', null)).toBe(true);
    expect(fresh.dump()).toBe(before);

    // Kontrola pozytywna na przyrząd: panel NAPRAWDĘ reaguje na to, co MA nieść — bez niej
    // „dwa zrzuty są równe" mogłoby znaczyć „zrzut jest stały", a nie „hp nie przecieka".
    s.ore -= 1;
    const moved = makePanel();
    expect(moved.view.update(s, IDLE_POWER, cell, 'BARRICADE', null)).toBe(true);
    expect(moved.dump()).not.toBe(before);
  });

  it('13b. [KANAŁ] „nie stać mnie" jest widoczne NA PANELU także wtedy, gdy powód odmowy jest inny', () => {
    // Na komórce zajętej wszystkie dziewięć pozycji mówi to samo zdanie, więc różnicę między
    // „kupię po rozbiórce" a „i tak mnie nie stać" niesie WYŁĄCZNIE klasa wiersza. Zmierzone
    // w przeglądzie rundy 1: zredukowanie `className` wierszy do stałej `'hud-row'` zostawiało
    // 53/53 zielone — znikał jedyny kanał tej informacji i nie widział tego żaden test.
    const { s } = richRun();
    const occupied = builtCell(s);

    s.ore = 1000;
    const bogaty = makePanel();
    bogaty.view.update(s, IDLE_POWER, occupied, 'BARRICADE', null);
    s.ore = 0;
    const biedny = makePanel();
    biedny.view.update(s, IDLE_POWER, occupied, 'BARRICADE', null);

    // TREŚĆ wierszy menu jest identyczna — i to jest cała trudność tego przypadku. (Wiersz
    // zasobów oczywiście się różni; on nie mówi, KTÓREJ pozycji brakuje na koncie.)
    expect(biedny.rows().map(allText)).toEqual(bogaty.rows().map(allText));
    // …więc wiersze MUSZĄ się różnić strukturalnie, inaczej ta informacja nie dociera nigdzie.
    expect(biedny.rows().map((r) => describeElement(r))).not.toEqual(
      bogaty.rows().map((r) => describeElement(r)),
    );
  });

  it('13c. [TRAFIALNOŚĆ] panel przepuszcza wskaźnik wszędzie poza wąskimi „łapkami" pozycji', () => {
    // Panel jest RODZEŃSTWEM płótna, a całe wejście wisi na płótnie — więc każdy element
    // panelu, który łapie wskaźnik, jest dziurą w sterowaniu. Zmierzone na żywej stronie
    // przed naprawą: **38,8 % wskazywalnej tarczy planety przy 800×482** (i 0,8 % przy
    // 1600×900) nie przyjmowało ani wskazania, ani budowy, ani obrotu kamery.
    //
    // Pikseli ten test nie widzi (jsdom nie liczy układu) — wiąże KONTRAKT: co w panelu
    // deklaruje się jako łapiące wskaźnik. Bez tego naprawa nie miałaby strażnika w ogóle.
    const { s } = richRun();
    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, freeHexagonNear(s), 'BARRICADE', null);

    const wszystkie: FakeElement[] = [];
    const zbierz = (e: FakeElement): void => {
      wszystkie.push(e);
      e.children.forEach(zbierz);
    };
    zbierz(panel.root);

    expect(panel.root.style.pointerEvents).toBe('none');
    const lapiace = wszystkie.filter((e) => e.style.pointerEvents === 'auto');
    // Dokładnie jedna łapka na pozycję menu — ani jednej więcej.
    expect(lapiace).toEqual(panel.picks());
    expect(lapiace.length).toBe(playerBuildableTypes().length);
    // Wszystko w wierszu POZA łapką przepuszcza wskaźnik — zdanie odmowy jest szerokie
    // i leży na planecie, a kolumna poboru (runda naprawcza 1) jest do czytania, nie do
    // klikania. Pętla po WSZYSTKICH dzieciach poza pierwszym, nie po jednym wskazanym
    // indeksie: dołożenie kolejnej kolumny ma przejść przez ten test, a nie obok niego.
    for (const wiersz of panel.rows()) {
      expect(wiersz.children.length).toBeGreaterThan(1);
      for (const dziecko of wiersz.children.slice(1)) {
        expect({ klasa: dziecko.className, pe: dziecko.style.pointerEvents }).toEqual({
          klasa: dziecko.className,
          pe: '',
        });
      }
    }
    // Łapka niesie numer, nazwę i koszt; powód odmowy leży POZA nią, bo jest szeroki.
    expect(allText(panel.picks()[0])).toContain('BARRICADE');
    expect(allText(panel.picks()[0])).not.toContain(refusalMessage('WRONG_CELL_TYPE'));
  });

  it('13d. prawy przycisk nad panelem nie otwiera menu przeglądarki', () => {
    // Prawy przycisk rozbiera (`input.ts`), a `preventDefault` na `contextmenu` jest
    // zarejestrowany NA PŁÓTNIE — nad panelem by go nie było. Nad „łapką" (jedynym
    // elementem, który łapie wskaźnik) gracz dostałby natywne menu przeglądarki.
    const { s } = richRun();
    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, freeHexagonNear(s), 'BARRICADE', null);
    let prevented = 0;
    // Zdarzenie z „łapki" bąbelkuje do korzenia — `pointer-events` rozstrzyga TRAFIANIE,
    // nie propagację — więc nasłuch na korzeniu je łapie.
    expect(fireOn(panel.root, 'contextmenu', { preventDefault: () => prevented++ })).toBe(1);
    expect(prevented).toBe(1);
  });

  it('14. [BRAMKA] panel przemalowuje się, gdy zmienia się to, co pokazuje — i tylko wtedy', () => {
    const { s } = richRun();
    const panel = makePanel();
    const cell = freeHexagonNear(s);
    const other = planet.cells[cell].neighbors[0];

    expect(panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null)).toBe(true); // pierwsze malowanie
    expect(panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null)).toBe(false); // nic się nie ruszyło

    // Każdy kanał z osobna, i każdy w parze „zmiana → true, powtórka → false". Kanał, który
    // przestanie wchodzić do bramki, zostawia panel NIEAKTUALNY — a to wada widoczna dopiero
    // na ekranie, czyli najdroższa możliwa.
    const kanaly: [string, () => void][] = [
      ['wskazana komórka', () => undefined],
      ['wybrany typ', () => undefined],
      ['ruda', () => { s.ore -= 1; }],
      ['energia', () => { s.storedEnergy += 1; }],
      ['faza', () => { s.phase = 'DEFEAT'; }],
      ['tick odblokowania Evac', () => { s.tick = s.evacUnlockTick; }],
    ];
    expect(panel.view.update(s, IDLE_POWER, other, 'BARRICADE', null)).toBe(true); // wskazana komórka
    expect(panel.view.update(s, IDLE_POWER, other, 'BARRICADE', null)).toBe(false);
    expect(panel.view.update(s, IDLE_POWER, other, 'PYLON', null)).toBe(true); // wybrany typ
    expect(panel.view.update(s, IDLE_POWER, other, 'PYLON', null)).toBe(false);
    for (const [nazwa, zmien] of kanaly.slice(2)) {
      zmien();
      expect({ nazwa, przemalowane: panel.view.update(s, IDLE_POWER, other, 'PYLON', null) }).toEqual({
        nazwa,
        przemalowane: true,
      });
      expect({ nazwa, przemalowane: panel.view.update(s, IDLE_POWER, other, 'PYLON', null) }).toEqual({
        nazwa,
        przemalowane: false,
      });
    }

    // Zabudowanie wskazanej komórki też jest zmianą — bez tego menu dalej pokazywałoby
    // „można budować" na komórce, na której właśnie coś stanęło.
    s.buildings[other] = { cellId: other, type: 'BARRICADE', hp: 1, powered: false };
    expect(panel.view.update(s, IDLE_POWER, other, 'PYLON', null)).toBe(true);
  });

  it('14b. [BRAMKA] wyczerpanie złoża pod kursorem przemalowuje menu', () => {
    // `EXTRACTOR` wymaga `ORE_HEXAGON`, czyli heksagonu Z RESZTĄ ZŁOŻA — a złoża są
    // wyczerpywalne (§5.2). Bez tego kanału w bramce menu pokazywałoby „można" na złożu,
    // które właśnie skończyło się pod wieżą wydobywczą.
    const { s } = richRun();
    const panel = makePanel();
    const deposit = buildableNear(s, 'EXTRACTOR');
    expect(s.oreRemaining[deposit]).toBeGreaterThan(0);
    expect(panel.view.update(s, IDLE_POWER, deposit, 'BARRICADE', null)).toBe(true);
    const before = rowText(panel, 'EXTRACTOR');
    expect(before).not.toContain(refusalMessage('WRONG_CELL_TYPE'));

    s.oreRemaining[deposit] = 0;
    expect(panel.view.update(s, IDLE_POWER, deposit, 'BARRICADE', null)).toBe(true);
    expect(rowText(panel, 'EXTRACTOR')).toContain(refusalMessage('WRONG_CELL_TYPE'));
  });

  it('14c. [BRAMKA] dostępność pozycji jest osobnym kanałem, nie skutkiem ubocznym pokazanej rudy', () => {
    // Dziś koszty są całkowite, więc każda zmiana dostępności zmienia też podłogę rudy —
    // i dlatego kanał `affordMask` wygląda na zbędny. Wygląda tak WYŁĄCZNIE przy kosztach
    // całkowitych: `costOre` jest `[STROJENIE]`, a Faza 3 stroi te liczby headlessem.
    // Ten test ustawia koszt ułamkowy i sprawdza kanał tam, gdzie zaczyna być jedyny.
    const { s } = richRun();
    const panel = makePanel();
    const cell = freeHexagonNear(s);
    const original = BUILDINGS.BARRICADE.costOre;
    try {
      BUILDINGS.BARRICADE.costOre = 7.5; // [STROJENIE] w teście: koszt ułamkowy
      s.ore = 7.2;
      expect(panel.view.update(s, IDLE_POWER, cell, 'PYLON', null)).toBe(true);
      expect(row(buildMenuRows(s, cell), 'BARRICADE').affordable).toBe(false);

      // Ta sama PODŁOGA rudy (7), a dostępność się zmieniła. Jedynym kanałem, który to widzi,
      // jest maska dostępności.
      s.ore = 7.7;
      expect(shownAmount(7.2)).toBe(shownAmount(7.7));
      expect(row(buildMenuRows(s, cell), 'BARRICADE').affordable).toBe(true);
      expect(panel.view.update(s, IDLE_POWER, cell, 'PYLON', null)).toBe(true);
    } finally {
      BUILDINGS.BARRICADE.costOre = original;
    }
    expect(BUILDINGS.BARRICADE.costOre).toBe(original);
  });

  it('15. [PARA] koniec runu jest widoczny: panel mówi, że komendy nie są przyjmowane', () => {
    const { s } = richRun();
    const panel = makePanel();
    const cell = freeHexagonNear(s);
    panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null);
    expect(panel.text()).not.toContain('nie są przyjmowane');
    s.phase = 'DEFEAT';
    panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null);
    expect(panel.text()).toContain('nie są przyjmowane');
    expect(panel.text()).toContain('DEFEAT');
    // …a numer wskazanej komórki NIE znika razem z runem. Zmierzone na ekranie: pierwsza
    // wersja podmieniała całą linię nagłówka na ostrzeżenie, więc po `DEFEAT` menu dalej
    // liczyło powody odmowy dla komórki, której numeru już nie było widać.
    expect(panel.text()).toContain(`komórka: ${cell}`);
  });

  it('16. kliknięcie w pozycję menu wybiera JEJ typ — każdą pozycję z osobna', () => {
    const { s } = richRun();
    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, freeHexagonNear(s), 'BARRICADE', null);
    const types = playerBuildableTypes();
    const picks = panel.picks();
    expect(picks.length).toBe(types.length);
    for (let i = 0; i < picks.length; i++) {
      expect(fireOn(picks[i], 'click', {})).toBeGreaterThan(0);
    }
    // Każdy wiersz musi oddać SWÓJ typ. Nasłuch domykający jedną, wspólną zmienną pętli
    // oddałby dziewięć razy ten sam (klasyczna wada `var`/współdzielonego domknięcia),
    // a test sprawdzający jedno kliknięcie by tego nie zobaczył.
    expect(panel.chosen).toEqual(types);
  });

  it('16b. [KONTRAKT KLAWISZY] numer przy pozycji to klawisz, który JĄ wybiera', () => {
    // Panel obiecujący zły klawisz jest gorszy od panelu bez numerów, bo gracz wciska to,
    // co przeczytał. Zmierzone w przeglądzie rundy 1: `${i + 1}` → `${i}` zostawiało 53/53
    // zielone. Wiązane jest ZACHOWANIE klawiatury (`attachInput`), nie druga kopia wzoru.
    const { s } = richRun();
    const panel = makePanel();
    const cell = freeHexagonNear(s);
    const selection = createSelection();
    const keys = createFakeEventTarget();
    const canvas = createFakeCanvas(CANVAS_RECT.width, CANVAS_RECT.height, CANVAS_RECT);
    const handle = attachInput({
      planet,
      camera: createCamera(canvas, planet.radius).object,
      canvas,
      keys,
      sim: new Sim(planet, DEFAULT_RUN),
      selection,
      focusOn: () => {},
      report: () => {},
      setUnitShading: () => {},
    });

    for (let n = 1; n <= playerBuildableTypes().length; n++) {
      fireOn(keys, 'keydown', {
        code: `Digit${n}`, key: '', shiftKey: false, preventDefault: () => {},
      });
      panel.view.update(s, IDLE_POWER, cell, selection.selectedType, null);
      // Pozycja, którą panel oznaczył jako wybraną, ma być tą, której napis zaczyna się od
      // wciśniętej cyfry.
      const wybrany = panel.rows().filter((r) => r.className.includes('hud-row--selected'));
      expect({ n, ile: wybrany.length }).toEqual({ n, ile: 1 });
      expect({ n, napis: allText(wybrany[0]).startsWith(`${n} `) }).toEqual({ n, napis: true });
      expect({ n, typ: allText(wybrany[0]).includes(selection.selectedType) }).toEqual({
        n, typ: true,
      });
    }
    handle.detach();
  });
});

// =========================================================================================
// Spięcie — panel na ekranie gracza, pod tym samym strażnikiem świata co reszta wejścia
// =========================================================================================

const CANVAS_RECT = { left: 0, top: 0, width: 800, height: 600 };
const CENTER_X = CANVAS_RECT.left + CANVAS_RECT.width / 2;
const CENTER_Y = CANVAS_RECT.top + CANVAS_RECT.height / 2;

interface Rig {
  client: Client;
  camera: RayCamera;
  canvas: HTMLCanvasElement;
  keys: ReturnType<typeof createFakeEventTarget>;
  sim: Sim;
  root: FakeElement;
  /** Co spięcie podało warstwie budynków — po to, żeby dało się zmierzyć, że COŚ podało. */
  buildingCalls: { outage?: Uint8Array; pulseSeconds?: number }[];
  rows(): FakeElement[];
  picks(): FakeElement[];
  text(): string;
  dump(): string;
  advance(ms: number): void;
}

function makeRig(): Rig {
  const canvas = createFakeCanvas(CANVAS_RECT.width, CANVAS_RECT.height, CANVAS_RECT);
  const orbit: OrbitCamera = createCamera(createFakeCanvas(), planet.radius);
  const camera = orbit.object;
  camera.aspect = CANVAS_RECT.width / CANVAS_RECT.height;
  camera.updateProjectionMatrix();
  const keys = createFakeEventTarget();
  const shading: UnitShadingMode[] = [];
  const buildingCalls: { outage?: Uint8Array; pulseSeconds?: number }[] = [];
  const scene: ClientScene = {
    camera: orbit,
    updateBuildings: (_list, outage, pulseSeconds) => buildingCalls.push({ outage, pulseSeconds }),
    updateUnits: () => {},
    setUnitShading: (mode) => shading.push(mode),
    render: () => {},
  };
  const root = createFakeDocument().createElement('div');
  let clock = 0;
  let sim!: Sim;
  const client = wireClient({
    seed: planet.seed,
    makeScene: () => scene,
    makeSim: (wiredPlanet, run) => {
      sim = new Sim(wiredPlanet, run);
      return sim;
    },
    canvas,
    keys,
    hudRoot: root as unknown as ElementLike,
    run: DEFAULT_RUN,
    now: () => clock,
    log: () => {},
  });
  const rows = (): FakeElement[] => root.children.filter((c) => c.className.startsWith('hud-row'));
  return {
    client,
    camera,
    canvas,
    keys,
    sim,
    root,
    buildingCalls,
    rows,
    picks: () => rows().map((r) => r.children[0]),
    text: () => allText(root),
    dump: () => describeElement(root),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/**
 * Tyle klatek, żeby nakładka diagnostyczna na pewno się odświeżyła.
 *
 * `wireClient` przelicza jej tekst co dziesiątą klatkę (sam zapis do DOM ma koszt i nie ma
 * stać się częścią tego, co mierzy licznik) — więc test czytający meldunek po jednej klatce
 * dostaje napis startowy i wygląda to na wadę wiadomości, którą nie jest.
 */
function framesUntilOverlay(rig: Rig, count = 10): string {
  let text = '';
  for (let i = 0; i < count; i++) {
    rig.advance(16);
    text = rig.client.frame();
  }
  return text;
}

/** Ustawia kamerę tak, żeby `cellId` wypadła DOKŁADNIE w środku kadru. */
function aimAt(camera: RayCamera, cellId: number): void {
  const c = planet.cells[cellId].center;
  const scale = (planet.radius * 3) / Math.hypot(c.x, c.y, c.z);
  camera.position.set(c.x * scale, c.y * scale, c.z * scale);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
}

describe('wireClient — panel na ekranie gracza', () => {
  it('17. [POZYTYWNA] klatka NAPRAWDĘ odświeża panel wskazaną komórką i rudą', () => {
    // Bez tej połowy usunięcie `hud.update(...)` ze spięcia zostawiłoby cały pakiet zielony
    // — dokładnie ten tryb awarii, który w rundach naprawczych Zadania 2 wystąpił pięć razy.
    const rig = makeRig();
    const cell = freeHexagonNear(rig.sim.state);
    aimAt(rig.camera, cell);
    fireOn(rig.canvas, 'pointermove', { clientX: CENTER_X, clientY: CENTER_Y, button: -1 });
    rig.advance(16);
    rig.client.frame();

    expect(rig.rows().length).toBe(playerBuildableTypes().length);
    expect(rig.text()).toContain(`komórka: ${cell}`);
    expect(rig.text()).toContain(resourceLine(rig.sim.state));

    // …i idzie ZA wskazaniem, a nie zatrzymuje się na pierwszym. Sąsiad jest innego rodzaju
    // wyłącznie przypadkiem, więc wiązana jest sama liczba komórki.
    const next = planet.cells[cell].neighbors[0];
    aimAt(rig.camera, next);
    rig.advance(16);
    rig.client.frame();
    expect(rig.text()).toContain(`komórka: ${next}`);
  });

  it('18. [NIEZMIENNIK] ścieżki panelu zostawiają świat nietknięty — i nie są drugą drogą do kolejki', () => {
    const rig = makeRig();
    const cell = freeHexagonNear(rig.sim.state);
    aimAt(rig.camera, cell);
    fireOn(rig.canvas, 'pointermove', { clientX: CENTER_X, clientY: CENTER_Y, button: -1 });
    rig.advance(16);
    rig.client.frame();

    const before = worldFingerprint(rig.sim.state);
    const buildingsBefore = rig.sim.state.buildings.map((b) => b?.type ?? null).join(',');
    const paths: [string, () => void][] = [
      ['hud.update', () => void rig.client.hud.update(rig.sim.state, rig.sim.lastPower, cell, 'PYLON', null)],
      ['klik w pozycję menu', () => void fireOn(rig.picks()[3], 'click', {})],
      ['klik w pozycję już wybraną', () => void fireOn(rig.picks()[3], 'click', {})],
    ];
    for (const [name, fire] of paths) {
      fire();
      expect({ name, world: worldFingerprint(rig.sim.state) }).toEqual({ name, world: before });
    }
    // Kliknięcie w MENU nie może niczego zakolejkować — do świata prowadzi wyłącznie
    // kliknięcie w planetę. Sam nietknięty odcisk tego nie dowodzi: kolejka NIE JEST stanem,
    // więc komenda w niej siedząca zostawia hasz bez zmian aż do `step()`.
    rig.sim.step();
    expect(rig.sim.state.buildings.map((b) => b?.type ?? null).join(',')).toBe(buildingsBefore);
    // Kontrola pozytywna na przyrząd: odcisk NAPRAWDĘ reaguje na zmianę świata.
    expect(worldFingerprint(rig.sim.state)).not.toBe(before);
  });

  it('19. kliknięcie w menu wybiera typ, a meldunek leci tylko przy FAKTYCZNEJ zmianie', () => {
    const rig = makeRig();
    aimAt(rig.camera, freeHexagonNear(rig.sim.state));
    rig.advance(16);
    rig.client.frame();

    const types = playerBuildableTypes();
    fireOn(rig.picks()[5], 'click', {});
    expect(rig.client.selection.selectedType).toBe(types[5]);
    expect(framesUntilOverlay(rig)).toContain(`wybrany typ: ${types[5]}`);

    // PIERWSZY konsument odpowiedzi `chooseType`: powtórne kliknięcie w tę samą pozycję nie
    // zmienia typu, więc nie ma o czym meldować. Bez czytania tej odpowiedzi linijka gracza
    // powtarzałaby to, co i tak widzi podświetlone.
    fireOn(rig.keys, 'keydown', { code: 'Space', key: '', shiftKey: false, preventDefault: () => {} });
    expect(framesUntilOverlay(rig)).toContain('powrót do Core');
    fireOn(rig.picks()[5], 'click', {});
    expect(framesUntilOverlay(rig)).toContain('powrót do Core');
    expect(rig.client.selection.selectedType).toBe(types[5]);
  });

  it('18b. [POZYTYWNA] bilans z symulacji dociera NA PANEL, a przyczyna awarii DO ŚWIATA', () => {
    // Obie połowy Zadania 4 w jednym miejscu — i obie są dokładnie tym rodzajem przekazania,
    // którego brak zostawiał w tym projekcie cały pakiet zielony (runda 2 Zadania 2: usunięcie
    // `sim.enqueue` → 631/631). Mierzone na PRAWDZIWYM `Sim` wewnątrz spięcia:
    //   • panel pokazuje niedobór, którego nikt mu nie podał ręcznie,
    //   • warstwa budynków dostaje TĘ SAMĄ tablicę przyczyn, którą wystawia symulacja.
    const rig = makeRig();
    const s = rig.sim.state;
    s.ore = 10_000; // [STROJENIE] w teście: skarbiec ponad czterema laserami
    // Klatka „na rozbiegu": bez niej pierwszy `frame()` robi zero kroków (akumulator pusty).
    rig.advance(16);
    rig.client.frame();
    for (const cellId of fourFreeHexagonsNear(s)) {
      rig.sim.enqueue({ kind: 'BUILD', cellId, type: 'LASER_TURRET' });
    }
    // Dość czasu na kilka kroków symulacji — komendy wykonują się w `sim.step()`, nie w `frame()`.
    for (let i = 0; i < 6; i++) {
      rig.advance(60);
      rig.client.frame();
    }
    s.storedEnergy = 0;
    rig.advance(60);
    rig.client.frame();

    const power = rig.sim.lastPower;
    expect(power.shedTypes.length, 'fikstura: kaskada NAPRAWDĘ zadziałała').toBeGreaterThan(0);
    expect(rig.text()).toContain('więc gasną');
    expect(rig.text()).toContain(
      rateText(shownRateTenths(power.rawDemand) - shownRateTenths(power.supply)),
    );

    // DO ŚWIATA: warstwa dostała tablicę przyczyn TOŻSAMĄ z tą z symulacji (nie kopię i nie
    // `undefined`). Bez tego obręcz alarmu wyglądałaby tak samo dla brownoutu i dla odcięcia
    // od sieci, a żadna asercja o panelu by tego nie zobaczyła.
    expect(rig.buildingCalls.at(-1)!.outage).toBe(power.outage);
    expect(rig.buildingCalls.at(-1)!.pulseSeconds).toBeGreaterThan(0);
  });

  it('19b. [POZYTYWNA] wybrany typ dociera ze spięcia NA PANEL, a nie tylko do `Selection`', () => {
    // Zmierzone w przeglądzie rundy 1: podstawienie w `client.ts` stałej zamiast
    // `selection.selectedType` zostawiało 53/53 zielone — testy pytały `Selection`, a nie
    // panel, więc spięcie mogło podawać panelowi cokolwiek.
    const rig = makeRig();
    aimAt(rig.camera, freeHexagonNear(rig.sim.state));
    rig.advance(16);
    rig.client.frame();
    const types = playerBuildableTypes();

    // Dwa RÓŻNE typy, bo stała trafiłaby w jeden z nich przypadkiem.
    for (const index of [2, 7]) {
      fireOn(rig.picks()[index], 'click', {});
      rig.advance(16);
      rig.client.frame();
      const wybrane = rig.rows().filter((r) => r.className.includes('hud-row--selected'));
      expect({ index, ile: wybrane.length }).toEqual({ index, ile: 1 });
      expect({ index, typ: allText(wybrane[0]).includes(types[index]) }).toEqual({
        index, typ: true,
      });
    }
  });

  it('20b. detach() odpina TAKŻE panel — po nim kliknięcie w pozycję menu nic nie wybiera', () => {
    // Zmierzone w przeglądzie rundy 1: usunięcie `hud.detach()` ze spięcia zostawiało 53/53
    // zielone. `detach` istnieje po to, żeby po odpięciu klienta nic nie zostało przy życiu —
    // w Fazie 5 (przełączanie meczów) martwy nasłuch trzymałby stary `Selection`.
    const rig = makeRig();
    aimAt(rig.camera, freeHexagonNear(rig.sim.state));
    rig.advance(16);
    rig.client.frame();
    const types = playerBuildableTypes();

    // Kontrola: PRZED odpięciem kliknięcie działa — inaczej „po odpięciu nic się nie dzieje"
    // znaczyłoby tyle, co „nigdy się nic nie działo".
    expect(fireOn(rig.picks()[4], 'click', {})).toBe(1);
    expect(rig.client.selection.selectedType).toBe(types[4]);

    rig.client.detach();
    expect(fireOn(rig.picks()[6], 'click', {})).toBe(0);
    expect(rig.client.selection.selectedType).toBe(types[4]);
  });

  it('20. [ŚWIEŻOŚĆ] każda zmiana wskazania dociera na panel — 300 ustawień kamery', () => {
    // Własność wiążąca DWIE odpowiedzi, których nikt wcześniej nie czytał:
    // `refreshPointedCell()` mówi, że wskazanie się zmieniło, a `update()` — że panel to
    // pokazał. Gdyby bramka panelu pomijała wskazaną komórkę, ta implikacja padłaby.
    const canvas = createFakeCanvas(CANVAS_RECT.width, CANVAS_RECT.height, CANVAS_RECT);
    const camera = createCamera(canvas, planet.radius).object;
    camera.aspect = CANVAS_RECT.width / CANVAS_RECT.height;
    camera.updateProjectionMatrix();
    const sim = new Sim(planet, DEFAULT_RUN);
    const selection = createSelection();
    const panel = makePanel();
    const handle = attachInput({
      planet,
      camera,
      canvas,
      keys: createFakeEventTarget(),
      sim,
      selection,
      focusOn: () => {},
      report: () => {},
      setUnitShading: () => {},
    });
    fireOn(canvas, 'pointermove', { clientX: CENTER_X, clientY: CENTER_Y, button: -1 });

    const rand = mulberry32(0x2c0301);
    let changes = 0;
    let stills = 0;
    for (let i = 0; i < 300; i++) {
      // Co druga iteracja NIE rusza kamery — inaczej „bez ruchu panel stoi" nie zdarzyłoby
      // się ani razu (losowa komórka z 1442 prawie nigdy nie trafia w poprzednią), a kontrola
      // na próbkę mierzyłaby wyłącznie gałąź „zmieniło się".
      if (i % 2 === 0) aimAt(camera, Math.floor(rand() * planet.cells.length));
      const moved = handle.refreshPointedCell();
      const repainted = panel.view.update(sim.state, IDLE_POWER, selection.selectedCell, selection.selectedType, null);
      if (moved) {
        changes++;
        expect({ i, moved, repainted }).toEqual({ i, moved: true, repainted: true });
      }
      // POŁOWA „MA PRZEJŚĆ": bez ruchu kamery i bez zmiany stanu panel ma zostać w miejscu.
      // Bez niej implikacja wyżej przechodziłaby dla panelu przemalowującego się ZAWSZE —
      // czyli dla tego, który alokuje w pętli renderu.
      expect({ i, ponownie: handle.refreshPointedCell() }).toEqual({ i, ponownie: false });
      expect({
        i,
        ponownie: panel.view.update(sim.state, IDLE_POWER, selection.selectedCell, selection.selectedType, null),
      }).toEqual({ i, ponownie: false });
      if (!moved) stills++;
    }
    // Kontrola na próbkę: obie gałęzie NAPRAWDĘ wystąpiły, i to porównywalnie licznie.
    expect(changes).toBeGreaterThan(100);
    expect(stills).toBeGreaterThan(100);
    handle.detach();
  });

  it(
    '21. [ALOKACJA] panel w bezruchu nie alokuje w pętli renderu',
    () => {
      // `global-constraints.md`: „Brak alokacji w pętli renderu." `buildMenuRows` tworzy
      // dziewięć obiektów i tablicę, a `update` woła się CO KLATKĘ — bramka świeżości jest
      // jedyną rzeczą, która trzyma to poniżej progu. Przyrząd wspólny
      // (`support/gcWindows.ts`), kształt trzech asercji ten sam, co w `budget.test.ts`.
      const { s } = richRun();
      const panel = makePanel();
      const cell = freeHexagonNear(s);
      panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null); // pierwsze malowanie poza pomiarem
      // Sto tysięcy, nie cztery: przy 4000 iteracjach KONTROLA (czyli wersja bez bramki,
      // alokująca dziesięć obiektów na klatkę) wypadała 0/0/0 — 40 tys. drobnych obiektów
      // nie wypełnia młodej generacji, więc `GCProfiler` nie miał czego policzyć i asercja
      // czułości oblewała na PRZYRZĄDZIE, nie na kodzie. Dokładnie ta wada stoi w katalogu
      // tej fazy jako „awaria przyrządu, nie kodu".
      const ITERATIONS = 100_000;
      let sink = 0;

      const windows = measureGcWindows({
        empty: () => {
          for (let i = 0; i < ITERATIONS; i++) sink += i;
        },
        measured: () => {
          for (let i = 0; i < ITERATIONS; i++) {
            sink += panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null) ? 1 : 0;
          }
        },
        // Kontrolą jest DOKŁADNIE ten defekt, przed którym broni bramka: ta sama praca plus
        // przeliczenie menu na każdą klatkę. Lepszego odniesienia nie ma — to nie jest
        // sztuczna alokacja dobrana pod przyrząd, tylko wersja bez bramki.
        control: () => {
          for (let i = 0; i < ITERATIONS; i++) {
            sink += panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null) ? 1 : 0;
            sink += buildMenuRows(s, cell).length;
          }
        },
      });

      console.log(
        `[BUDGET] cykle GC na ${ITERATIONS} wywołań HudView.update, kontrola +buildMenuRows/wyw. — ${describeGcWindows(windows)}`,
      );
      expect(Math.min(...windows.empty), 'przyrząd nie potrafi zwrócić zera').toBe(0);
      expect(
        gcMedian(windows.control),
        'kontrola alokująca nie odstaje od mierzonej pętli',
      ).toBeGreaterThan(gcMedian(windows.measured));
      expect(Math.max(...windows.measured), 'HudView.update alokuje').toBeLessThanOrEqual(
        gcNoiseLimit(windows),
      );
      expect(sink).not.toBe(0);
    },
    // Ten sam limit i to samo uzasadnienie, co w `budget.test.ts`: sześć przeplatanych okien
    // odśmiecania, a Vitest uruchamia pliki RÓWNOLEGLE, więc czas zależy od obciążenia.
    30_000,
  );
});

// ---------------------------------------------------------------------------------------
// 31. Układ panelu — związany LICZBĄ ZNAKÓW, bo silnika układu w pakiecie nie ma
// ---------------------------------------------------------------------------------------
describe('31. [UKŁAD] żaden wiersz panelu nie zawija się w minimalnym oknie', () => {
  /**
   * `jsdom` nie liczy układu i nigdy nie policzy — to jest zapisana granica całej Fazy 2C
   * i wada tej klasy uderzyła już TRZY razy (bramka 2B unieważniona przy 480 px, powód
   * odmowy schowany za paskiem przewijania, panel zasłaniający 38,7% tarczy).
   *
   * Ale panel jest MONOSPACE'OWY, więc szerokość wiersza to czysta funkcja liczby znaków —
   * a liczyć znaki `jsdom` umie. Ten test zamienia nieosiągalny pomiar w osiągalny, przy
   * jednym jawnym założeniu: `HUD_CHAR_WIDTH_PX` zmierzone na żywej stronie.
   *
   * Najgorsze przypadki są WYPROWADZANE z kodu (najdłuższa nazwa typu, najdłuższy komunikat
   * odmowy, komplet `BROWNOUT_ORDER`), nie przepisane — inaczej test byłby kotwicą na
   * dzisiejszą treść, czyli wzorcem, który w tej fazie wystąpił już czterokrotnie.
   */
  const AMOUNT_CAP = 99_999; // [STROJENIE w teście] pięć cyfr; szczyt zmierzony w Fazie 1C to 2345
  const RATE_TENTHS_CAP = 99_999; // → „9999,9/s"; szczyt realny to ok. 310/s (12 capów + CORE)
  // [STROJENIE w teście] Najdłuższe możliwe odliczanie do ewakuacji: „99:59". Realne przy
  // `DEFAULT_RUN` to 1080 s, czyli „18:00" — cap bierze pięcioznakowy najgorszy przypadek,
  // żeby budżet nie zależał od dzisiejszej długości runu.
  const EVAC_SECONDS_CAP = 5_999;

  /**
   * Powody, które może nieść WIERSZ MENU — czyli wyłącznie te z `canBuild`.
   *
   * `REFUSAL_MESSAGES` jest kluczowany SUMĄ powodów budowy i rozbiórki, a rozbiórka melduje
   * się nakładką, nie wierszem menu. Pierwsza wersja tego pomocnika brała najdłuższy
   * komunikat z całej sumy i **nie skompilowała się** — domknięta unia z `6a81067` nie
   * pozwoliła wstawić `CORE_INDESTRUCTIBLE` do `MenuRow.check`. To jest ta gwarancja przy
   * pracy, nie jej opis.
   *
   * `Record<BuildRefusalReason, true>` wymusza komplet przy kompilacji: ósmy powód budowy
   * nie skompiluje tego pliku, dopóki go tu nie będzie.
   */
  const BUILD_REASONS: Readonly<Record<BuildRefusalReason, true>> = {
    NO_SUCH_CELL: true,
    CELL_OCCUPIED: true,
    NOT_PLAYER_BUILDABLE: true,
    NO_SUCH_BUILDING_TYPE: true,
    WRONG_CELL_TYPE: true,
    INSUFFICIENT_ORE: true,
    EVAC_LOCKED: true,
  };

  function longestRefusalReason(): BuildRefusalReason {
    let worst: BuildRefusalReason = 'NO_SUCH_CELL';
    for (const reason of Object.keys(BUILD_REASONS) as BuildRefusalReason[]) {
      if (refusalMessage(reason).length > refusalMessage(worst).length) worst = reason;
    }
    return worst;
  }

  /**
   * **Składany PRAWDZIWĄ funkcją panelu** (`menuRowText`), nie przepisaną sklejką.
   *
   * Poprzednia wersja przepisywała układ wiersza i przez to nie widziała jego wzrostu:
   * poszerzenie odstępu przed zdaniem odmowy o 12 znaków zostawiało mierzone 89 znaków
   * nietknięte, przy całym pliku zielonym (N9). Przepisany był też prefiks — literał `9 `,
   * czyli DWA znaki, choć `MAX_MENU_TYPES` dopuszcza 31 pozycji, a od dziesiątej prefiks
   * ma trzy. Najgorszy przypadek bierze więc OSTATNI możliwy numer pozycji.
   */
  function worstMenuRow(): string {
    let worstType: BuildingType = 'CORE';
    let worstCost = 0;
    for (const [type, def] of Object.entries(BUILDINGS)) {
      if (type.length >= worstType.length) worstType = type as BuildingType;
      if (def.costOre > worstCost) worstCost = def.costOre;
    }
    // Najgorszy wiersz szukany po WSZYSTKICH powodach budowy, a nie po najdłuższym
    // KOMUNIKACIE: od Zadania 5 `EVAC_LOCKED` dostaje doklejone odliczanie, więc powód
    // z krótszym zdaniem może dać dłuższy wiersz. Wybieranie po komunikacie było prawdą
    // do tej zmiany i przestałoby nią być po cichu — dokładnie ta klasa, którą zamknęła
    // runda naprawcza 2 (N9).
    let worst = '';
    for (const reason of Object.keys(BUILD_REASONS) as BuildRefusalReason[]) {
      const row: MenuRow = {
        type: worstType,
        costOre: worstCost,
        energyDrain: RATE_TENTHS_CAP / 10,
        affordable: false,
        check: { ok: false, reason },
      };
      const text = menuRowText(MAX_MENU_TYPES - 1, row, EVAC_SECONDS_CAP);
      if (text.length > worst.length) worst = text;
    }
    return worst;
  }

  /**
   * **Składane PRAWDZIWYMI funkcjami panelu, nie przepisanym literałem.**
   *
   * Pierwsza wersja tego pomocnika budowała zdanie sama (`… więc gasną: …`) i przez to nie
   * widziała, gdy zdanie rosło: mutacja wydłużająca je o 39 znaków oblała trzy inne testy,
   * a ten przeszedł. To był dokładnie wzorzec „wyjście porównane z przepisaną kopią",
   * czwarty w tej fazie — tyle że tym razem we WŁASNYM teście.
   *
   * Najgorszy przypadek: komplet `BROWNOUT_ORDER` (najdłuższa lista), niedobór różny od zera
   * (żeby zdanie niosło obie połowy) i czterocyfrowe natężenia po obu stronach bilansu.
   */
  function worstBalanceLine(): string {
    const power: PowerReport = {
      supply: 0,
      demand: 0,
      rawDemand: RATE_TENTHS_CAP / 10,
      shedTypes: [...BROWNOUT_ORDER],
      outage: new Uint8Array(0),
    };
    // `supply` tak dobrane, żeby `rateText` wypisało czterocyfrową liczbę PO OBU stronach
    // bilansu ORAZ czterocyfrowy niedobór — najgorszy skład, jaki ta linia może przyjąć.
    power.supply = RATE_TENTHS_CAP / 10 - RATE_TENTHS_CAP / 10;
    return `${powerLine(power)} · ${shortfallLine(power)}`;
  }

  /**
   * **Obie połowy prawdziwymi funkcjami**: `resourceLine` i `headlineText`.
   *
   * Poprzednia wersja przepisywała nagłówek literałem — wydłużenie realnego ostrzeżenia
   * o końcu runu o 68 znaków dawało linię 165-znakową przy budżecie 111, a ten test dalej
   * mierzył 97 i przechodził (N9). Najgorszy przypadek to najdłuższy numer komórki,
   * capowane zapasy i faza, w której ostrzeżenie jest widoczne.
   */
  function worstResourceLine(): string {
    const { s } = richRun();
    s.ore = AMOUNT_CAP;
    s.storedEnergy = AMOUNT_CAP;
    s.phase = 'DEFEAT';
    return resourceLine(s) + headlineText(s, planet.cells.length - 1);
  }

  it('31a. budżet znaków jest WYPROWADZONY z minimalnej szerokości okna, nie przepisany', () => {
    expect(MAX_HUD_LINE_CHARS).toBe(
      Math.floor((MIN_WINDOW_WIDTH_PX - HUD_HORIZONTAL_CHROME_PX) / HUD_CHAR_WIDTH_PX),
    );
    // Gdyby ktoś podniósł szerokość znaku (inny krój w index.html), budżet MUSI zmaleć.
    expect(MAX_HUD_LINE_CHARS).toBeLessThan(MIN_WINDOW_WIDTH_PX / HUD_CHAR_WIDTH_PX);
  });

  it('31b. najdłuższy możliwy wiersz menu mieści się w budżecie', () => {
    const row = worstMenuRow();
    // eslint-disable-next-line no-console
    console.log(`[UKŁAD] najdłuższy wiersz menu: ${row.length} znaków z ${MAX_HUD_LINE_CHARS}`);
    expect(row.length).toBeLessThanOrEqual(MAX_HUD_LINE_CHARS);
  });

  it('31c. najdłuższa możliwa linia bilansu mieści się w budżecie', () => {
    const line = worstBalanceLine();
    // eslint-disable-next-line no-console
    console.log(`[UKŁAD] najdłuższa linia bilansu: ${line.length} znaków z ${MAX_HUD_LINE_CHARS}`);
    expect(line.length).toBeLessThanOrEqual(MAX_HUD_LINE_CHARS);
  });

  /**
   * Zakończenie runu jest OSOBNYM wierszem (Zadanie 5), więc ma własny budżet. Najgorszy
   * przypadek szukany po WSZYSTKICH zakończeniach, jakie ta funkcja umie wypisać —
   * z najdłuższą nazwą typu wroga, nie z dzisiaj wybraną.
   */
  it('31e. najdłuższe możliwe zdanie o zakończeniu runu mieści się w budżecie', () => {
    const { s } = richRun();
    let worst = '';
    for (const phase of ['VICTORY', 'DEFEAT'] as const) {
      s.phase = phase;
      for (const damager of [null, 'SWARM', 'ARMOR', 'DISRUPTOR'] as const) {
        const line = outcomeSummary(s, damager);
        if (line.length > worst.length) worst = line;
      }
    }
    // Kontrola na fiksturę: pusty najgorszy przypadek mieściłby się zawsze.
    expect(worst.length).toBeGreaterThan(0);
    expect(worst.length).toBeLessThanOrEqual(MAX_HUD_LINE_CHARS);
  });

  it('31d. najdłuższa możliwa linia zasobów mieści się w budżecie', () => {
    const line = worstResourceLine();
    // eslint-disable-next-line no-console
    console.log(`[UKŁAD] najdłuższa linia zasobów: ${line.length} znaków z ${MAX_HUD_LINE_CHARS}`);
    expect(line.length).toBeLessThanOrEqual(MAX_HUD_LINE_CHARS);
  });
});

// ---------------------------------------------------------------------------------------
// 32. Separatory — segmenty w jednym wierszu nie mogą się zlewać
// ---------------------------------------------------------------------------------------
describe('32. [SEPARATOR] segmenty składane w jeden wiersz są rozdzielone', () => {
  /**
   * Trzy wiersze panelu składają się z KILKU segmentów w osobnych elementach (bilans +
   * zdanie o skutku; zasoby + nagłówek + ostrzeżenie o końcu runu). Rozdziela je `' · '`
   * dopisywane przy składaniu — i nie miało żadnego testu: ponowny przegląd Zadania 4
   * pokazał, że jego usunięcie daje `…potrzebnychbrakuje 38,0/s…` i przechodzi 690/690,
   * bo atrapa DOM-u nie ma układu, a treść segmentów z osobna pozostaje poprawna.
   *
   * Własność jest tu prostsza niż kotwica na same słowa: **złożony wiersz nie może być
   * zwykłą konkatenacją swoich segmentów.** Jeśli jest — separator zniknął. Asercja nie
   * wymienia ani separatora, ani sąsiadujących wyrazów, więc przeżyje zmianę jednego
   * i drugiego.
   */
  const SHED_POWER: PowerReport = {
    supply: 10,
    demand: 10,
    rawDemand: 48,
    shedTypes: ['EXTRACTOR', 'LASER_TURRET'],
    outage: new Uint8Array(0),
  };

  it('32a. bilans i zdanie o skutku nie zlewają się w jeden ciąg', () => {
    const { s } = richRun();
    const panel = makePanel();
    panel.view.update(s, SHED_POWER, freeHexagonNear(s), 'BARRICADE', null);

    const glued = powerLine(SHED_POWER) + shortfallLine(SHED_POWER);
    // Kontrola na fiksturę: oba segmenty MUSZĄ być niepuste, inaczej test nic nie mierzy.
    expect(powerLine(SHED_POWER).length).toBeGreaterThan(0);
    expect(shortfallLine(SHED_POWER).length).toBeGreaterThan(0);
    expect(panel.text()).not.toContain(glued);
    // …a oba segmenty z osobna na panelu są — czyli brak sklejki nie bierze się z ich braku.
    expect(panel.text()).toContain(powerLine(SHED_POWER));
    expect(panel.text()).toContain(shortfallLine(SHED_POWER));
  });

  it('32b. zasoby i nagłówek z numerem komórki nie zlewają się w jeden ciąg', () => {
    const { s } = richRun();
    const panel = makePanel();
    const cell = freeHexagonNear(s);
    panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null);

    expect(panel.text()).not.toContain(`${resourceLine(s)}komórka:`);
    expect(panel.text()).toContain(resourceLine(s));
    expect(panel.text()).toContain(`komórka: ${cell}`);
  });

  /**
   * TRZECIE złączenie tego samego wiersza — nagłówek ↔ ostrzeżenie o końcu runu. Zawężony
   * przegląd rundy naprawczej zmierzył, że jako jedyne z trzech nie miało testu: usunięcie
   * ` · ` dawało na ekranie `komórka: 731komendy nie są przyjmowane`, przy 699/699 zielonych
   * (N11). Ten sam tryb awarii, ten sam wiersz, ten sam commit, co dwa złączenia obok.
   *
   * Asercja **nie wymienia ani separatora, ani sąsiadujących słów**: bierze nagłówek runu
   * TRWAJĄCEGO jako przedrostek i sprawdza, że ogon dołożony po końcu runu nie zaczyna się
   * od znaku niebiałego. Przeżyje zmianę separatora i zmianę treści ostrzeżenia.
   */
  it('32c. ostrzeżenie o końcu runu nie zlewa się z numerem komórki', () => {
    const { s } = richRun();
    const cell = freeHexagonNear(s);
    const running = headlineText(s, cell);
    s.phase = 'DEFEAT';
    const finished = headlineText(s, cell);

    // Kontrola na fiksturę: ostrzeżenie faktycznie doszło, a wskazanie zostało.
    expect(finished.startsWith(running)).toBe(true);
    const tail = finished.slice(running.length);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail).not.toMatch(/^\S/);

    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, cell, 'BARRICADE', null);
    expect(panel.text()).toContain(finished);
  });
});

// ---------------------------------------------------------------------------------------
// 33. Stałe układu a ARKUSZ — dwie kopie tej samej liczby muszą się zgadzać
// ---------------------------------------------------------------------------------------
describe('33. [UKŁAD] liczby układu w kodzie zgadzają się z arkuszem', () => {
  /**
   * **Czym to jest, a czym nie jest.** To NIE jest skan kształtu kodu — klasa, którą ta faza
   * usuwała trzykrotnie. Tu czytana jest DEKLARACJA: ta sama liczba stoi w dwóch miejscach
   * (arkusz `index.html` i stała w `hud.ts`), bo przeglądarka czyta pierwsze, a budżet znaków
   * wypada z drugiego. Test pilnuje, że się nie rozjadą. Nie orzeka o zachowaniu kodu.
   *
   * Zawężony przegląd rundy naprawczej Zadania 4 zmierzył, czego brak kosztował:
   * - **N10**: `HUD_CHAR_WIDTH_PX` opisywał czcionkę z arkusza i nie był z nią związany
   *   niczym poza zdaniem w komentarzu. `font: 12px` → `18px` przechodziło 699/699,
   *   a `HUD_CHAR_WIDTH_PX = 3.0` przechodziło 43/43 — asercja mająca tego pilnować
   *   porównywała stałą z wyrażeniem zawierającym tę samą stałą.
   * - **N14**: `MIN_WINDOW_HEIGHT_PX` nie miał ANI JEDNEGO konsumenta, a `MIN_WINDOW_WIDTH_PX`
   *   nie był nigdzie wyegzekwowany — panel kurczył się bez dna, choć cały budżet znaków
   *   stoi na założeniu, że nie schodzi poniżej deklarowanego minimum.
   */
  const css = readFileSync(new URL('../hud.css', import.meta.url), 'utf8');

  /** Reguła `#hud` — żeby liczby z innych reguł nie wchodziły w rachunek. */
  function hudRule(): string {
    const at = css.indexOf('#hud {');
    expect(at, 'reguła #hud w arkuszu').toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  }

  /**
   * Arkusz jest WSPÓLNY dla gry i dla bramki czytelności przyczynowej (Zadanie 6) — bramka
   * pytająca o ekran gry musi pokazywać TEN SAM ekran. Obie strony muszą go faktycznie
   * wciągać: plik bez odbiorcy przestałby cokolwiek znaczyć, a testy niżej dalej by go
   * czytały i orzekały o wyglądzie, którego nikt nie widzi.
   */
  it('33z. obie strony wciągają wspólny arkusz panelu', () => {
    for (const page of ['../index.html', '../causal-gate.html']) {
      const html = readFileSync(new URL(page, import.meta.url), 'utf8');
      expect(html, page).toContain('hud.css');
    }
  });

  function numberFrom(pattern: RegExp, what: string): number {
    const m = pattern.exec(hudRule());
    expect(m, `${what} w regule #hud`).not.toBeNull();
    return Number(m![1]);
  }

  it('33a. rozmiar czcionki w arkuszu zgadza się z HUD_FONT_SIZE_PX', () => {
    expect(numberFrom(/font:\s*(\d+(?:\.\d+)?)px\//, 'font')).toBe(HUD_FONT_SIZE_PX);
  });

  /**
   * **Czego tu NIE ma i dlaczego.** Runda naprawcza 2 miała tu dwa testy czytające
   * `max-width: calc(max(100vw, 840px) - 16px)` i orzekające, że arkusz „EGZEKWUJE"
   * minimalne okno. Pomiar w przeglądarce pokazał, że nie egzekwuje niczego: `max-width`
   * jest sufitem, panel jest shrink-to-fit ograniczonym DOSTĘPNYM miejscem, a przy oknie
   * 840×600 szerokość i zawijanie są identyczne z tą regułą i bez niej (666 px, zero
   * zawinięć). Testy zniknęły razem z regułą — test pilnujący zapisu, który nic nie robi,
   * jest gorszy niż brak testu, bo obiecuje gwarancję.
   *
   * `MIN_WINDOW_WIDTH_PX` został WARUNKIEM WSTĘPNYM budżetu i tak jest opisany w `hud.ts`.
   * Sprawdzenie go wymaga silnika układu; tutaj wiązane jest to, co bez układu wiązać można.
   */

  /**
   * Krój MONOSPACE'OWY jest przesłanką całej metody: gdyby panel dostał font proporcjonalny,
   * „szerokość wiersza = liczba znaków × stała" przestałoby być prawdą i budżet z testów 31
   * mierzyłby wielkość bez związku z ekranem. Z deklaracji to widać, więc jest wiązane.
   *
   * **Czego ten blok NIE wiąże i nie ma jak związać:** samego `HUD_CHAR_ADVANCE_RATIO`.
   * To liczba ZMIERZONA w przeglądarce (szerokość znaku jako ułamek rozmiaru czcionki), a w
   * Vitest nie ma silnika układu, więc `= 0.3` przejdzie tu wszystko. Wiązane są jej dwie
   * przesłanki — rozmiar czcionki i to, że krój jest monospace'owy — i na tym kończy się
   * zasięg tego pakietu. Sprawdzenie samego ułamka wymaga przeglądarki.
   */
  it('33f. krój panelu jest monospace\'owy — przesłanka całego budżetu znaków', () => {
    const font = /font:[^;]*;/.exec(hudRule());
    expect(font, 'deklaracja font w regule #hud').not.toBeNull();
    expect(font![0]).toMatch(/monospace\s*;$/);
  });

  /**
   * **Kontrola pozytywna bramki musi zasłaniać KAŻDY kanał energetyczny panelu.**
   *
   * Zmierzone na żywej bramce (Zadanie 6): przy ukrytej samej linii bilansu kontrola
   * PRZECIEKAŁA — `magazyn` w wierszu zasobów dalej identyfikował przyczynę, bo cztery
   * układy miały cztery różne zapasy (13 / 199 / 0 / 19). Kontrola mierzyła wtedy czytelność
   * jednego kanału zamiast jej braku, a jej sufit był 12/12, nie 6/12. To trzeci raz, kiedy
   * kontrola pozytywna w tym projekcie przeciekła — dwa poprzednie były w Fazie 2B.
   *
   * Test wiąże LISTĘ zasłanianych elementów, nie sam fakt istnienia reguły: dołożenie do
   * panelu kolejnej liczby energetycznej bez dopisania jej tutaj przechodzi, ale wtedy
   * przejdzie też ten test — i to jest granica, którą trzeba znać. Wiązane jest to, co da
   * się związać bez silnika układu.
   */
  it('33e. tryb kontroli zasłania OBA kanały energetyczne: bilans i magazyn', () => {
    const rule = /#hud\.hud-blind([^{]*)\{([^}]*)\}/.exec(css);
    expect(rule, 'reguła trybu kontroli w arkuszu').not.toBeNull();
    const selectors = `#hud.hud-blind${rule![1]}`;
    expect(selectors).toContain('.hud-line--power');
    expect(selectors).toContain('.hud-storage');
    expect(rule![2]).toContain('display: none');
  });

  it('33d. obramowanie poziome w arkuszu zgadza się z HUD_HORIZONTAL_CHROME_PX', () => {
    // Budżet znaków liczy SZEROKOŚĆ TREŚCI: okno minus marginesy (odjęte w `calc`) minus
    // wyściółka (`padding`, po obu stronach). Suma obu musi być tym, co odejmuje `hud.ts`.
    const margins = numberFrom(/max-width:\s*calc\(100vw\s*-\s*(\d+)px\)/, 'margines');
    const padding = numberFrom(/padding:\s*\d+px\s+(\d+)px/, 'padding');
    expect(margins + padding * 2).toBe(HUD_HORIZONTAL_CHROME_PX);
  });
});

// ---------------------------------------------------------------------------------------
// 34. Ewakuacja: odliczanie do odblokowania
// ---------------------------------------------------------------------------------------
describe('34. [EWAKUACJA] do odblokowania Modułu widać, ile zostało', () => {
  it('34a. przed evacUnlockTick menu odmawia z EVAC_LOCKED i podaje, ile zostało', () => {
    const { s } = richRun();
    const rows = buildMenuRows(s, freeHexagonNear(s));
    expect(row(rows, 'EVACUATION_MODULE').check).toEqual({ ok: false, reason: 'EVAC_LOCKED' });
    expect(evacCountdownSeconds(s)).toBeGreaterThan(0);
  });

  /**
   * **Para wiążąca odliczanie z TĄ SAMĄ bramką, którą egzekwuje `canBuild`.**
   *
   * Sam test 34a przechodzi przy dowolnym dodatnim odliczaniu — także przy takim, które
   * dobija do zera w innym ticku niż odblokowanie. Wtedy ekran mówiłby „odblokowane"
   * przy menu dalej odmawiającym, albo odwrotnie: dokładnie ten rozjazd, przed którym
   * broni czytanie `evacUnlockTick` zamiast `RunConfig`. Para wiąże go po OBU stronach
   * przejścia, o jeden tick.
   */
  it('34b. [PARA] tick przed odblokowaniem odlicza i odmawia, tick odblokowania — zeruje i przyjmuje', () => {
    const { s } = richRun();
    const cell = freeHexagonNear(s);

    s.tick = s.evacUnlockTick - 1;
    expect(evacCountdownSeconds(s)).toBeGreaterThan(0);
    expect(row(buildMenuRows(s, cell), 'EVACUATION_MODULE').check).toEqual({
      ok: false,
      reason: 'EVAC_LOCKED',
    });

    s.tick = s.evacUnlockTick;
    expect(evacCountdownSeconds(s)).toBe(0);
    expect(row(buildMenuRows(s, cell), 'EVACUATION_MODULE').check).toEqual({ ok: true });
  });

  it('34c. po odblokowaniu odliczanie zostaje na zerze, nie schodzi poniżej', () => {
    const { s } = richRun();
    s.tick = s.evacUnlockTick + 10_000;
    expect(evacCountdownSeconds(s)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// 35. Trzy fazy mają trzy zakończenia, a przegrana ma PRZYCZYNĘ
// ---------------------------------------------------------------------------------------
describe('35. [KONIEC RUNU] ekran mówi, jak run się skończył i dlaczego', () => {
  /**
   * **Dlaczego surowy `ARMOR` WOLNO tu pokazać**, choć Zadanie 3 zabroniło surowych
   * identyfikatorów na ekranie (test 12): tamten zakaz dotyczy **kodów powodów**
   * (`CELL_OCCUPIED` → „komórka zajęta"), a nie NAZW BYTÓW. Nazwy budynków stoją w menu
   * surowe od Zadania 3 (`BARRICADE`, `LASER_TURRET`) i typ wroga jest tym samym rodzajem
   * napisu. Rozróżnienie, nie wyjątek: kod powodu opisuje REGUŁĘ, której gracz nie widzi,
   * a nazwa bytu wskazuje rzecz, którą widzi na planecie.
   */
  function panelInPhase(phase: SimState['phase'], damager: EnemyType | null) {
    const { s } = richRun();
    s.phase = phase;
    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, freeHexagonNear(s), 'BARRICADE', damager);
    return panel;
  }

  it('35a. w trakcie runu panel NIE niesie zdania o zakończeniu', () => {
    const { s } = richRun();
    expect(outcomeSummary(s, null)).toBe('');
    expect(outcomeSummary(s, 'ARMOR')).toBe('');
  });

  it('35b. ekran porażki nazywa typ, który zniszczył Core', () => {
    expect(defeatSummary('ARMOR')).toContain('ARMOR');
    expect(panelInPhase('DEFEAT', 'ARMOR').text()).toContain('ARMOR');
  });

  it('35c. [PARA] każdy typ wroga dojeżdża na ekran — nie tylko ten z testu', () => {
    // Bez tego „zawiera ARMOR" spełniałaby też funkcja zwracająca stałe zdanie o ARMOR-ze.
    for (const type of ['SWARM', 'ARMOR', 'DISRUPTOR'] as const) {
      expect(panelInPhase('DEFEAT', type).text()).toContain(type);
    }
  });

  it('35d. przegrana bez znanego sprawcy NIE zgaduje typu', () => {
    const text = panelInPhase('DEFEAT', null).text();
    for (const type of ['SWARM', 'ARMOR', 'DISRUPTOR'] as const) {
      expect(text).not.toContain(type);
    }
    // …ale sam fakt przegranej pada — milczenie byłoby gorsze niż „nie wiadomo".
    // Niepustość osobno, z tego samego powodu co w 35e: `toContain('')` nic nie mierzy.
    expect(defeatSummary(null).length).toBeGreaterThan(0);
    expect(text).toContain(defeatSummary(null));
  });

  /**
   * `toContain(x)` jest **zawsze prawdziwe dla pustego `x`**, więc pierwsza wersja tego
   * testu przechodziła przy `outcomeSummary` zwracającym `''` dla `VICTORY` — zmierzone
   * mutacją: 59/59 zielonych przy zwycięstwie bez ani jednego znaku na ekranie. Niepustość
   * jest tu asercją OSOBNĄ i stoi PRZED porównaniem, nie założeniem.
   */
  it('35e. zwycięstwo ma własne, NIEPUSTE zdanie, różne od przegranej', () => {
    const { s } = richRun();
    s.phase = 'VICTORY';
    const line = outcomeSummary(s, null);
    expect(line.length, 'zwycięstwo bez zdania to ekran, który milczy').toBeGreaterThan(0);
    expect(line).not.toBe(defeatSummary(null));
    expect(panelInPhase('VICTORY', null).text()).toContain(line);
  });

  it('35f. odliczanie do ewakuacji stoi PRZY powodzie odmowy, nie osobno', () => {
    const { s } = richRun();
    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, freeHexagonNear(s), 'BARRICADE', null);
    const evacRow = rowText(panel, 'EVACUATION_MODULE');
    expect(evacRow).toContain(refusalMessage('EVAC_LOCKED'));
    expect(evacRow).toContain(countdownText(evacCountdownSeconds(s)));
  });

  it('35g. [PARA] odliczanie na ekranie idzie za stanem, a nie stoi', () => {
    const { s } = richRun();
    const panel = makePanel();
    panel.view.update(s, IDLE_POWER, freeHexagonNear(s), 'BARRICADE', null);
    const before = rowText(panel, 'EVACUATION_MODULE');

    s.tick += 60 / TICK_SECONDS; // minuta symulacji
    panel.view.update(s, IDLE_POWER, freeHexagonNear(s), 'BARRICADE', null);
    const after = rowText(panel, 'EVACUATION_MODULE');

    expect(after).not.toBe(before);
    expect(after).toContain(countdownText(evacCountdownSeconds(s)));
  });
});
