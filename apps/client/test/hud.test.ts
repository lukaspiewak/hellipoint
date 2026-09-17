import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  canBuild,
  createPlanet,
  DEFAULT_RUN,
  Sim,
  type BuildCheck,
  type BuildingType,
  type Planet,
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
  refusalMessage,
  REFUSAL_MESSAGES,
  resourceLine,
  shownAmount,
  type ElementLike,
  type MenuRow,
} from '../src/hud.js';
import { attachInput, createSelection, playerBuildableTypes, type RayCamera } from '../src/input.js';
import { wireClient, type Client, type ClientScene } from '../src/client.js';
import { buildableNear, builtCell, freeHexagonNear, worldFingerprint } from './support/fixtures.js';

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
    expect(resourceLine(s)).toBe('ruda 141 · energia 12');
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
// Siedem powodów — siedem komunikatów. WŁASNOŚĆ, nie siedem przypadków.
// =========================================================================================

/**
 * Źródło `canBuild` — miejsce, w którym powstaje SIEDEM powodów odmowy budowy, czyli
 * dokładnie te, które opisuje słownik tego zadania.
 *
 * Nie jest to jedyne miejsce w repozytorium, gdzie powstaje jakikolwiek powód: `input.ts`
 * (`refusalReason`, gałąź `DEMOLISH`) ma własne `NOTHING_TO_DEMOLISH` i `CORE_INDESTRUCTIBLE`,
 * których `canBuild` nie zna, bo rozbiórki nie dotyczy. Rozszerzenie słownika o te dwa
 * należy do zmiany kształtu meldunków (Zadanie 4) i tutaj świadomie go NIE ma — patrz
 * `task-3-report.md`, §7.1.
 */
const COMMANDS_SOURCE = readFileSync(
  new URL('../../../packages/sim/src/sim/commands.ts', import.meta.url),
  'utf8',
);

/**
 * Powody ZADEKLAROWANE w `commands.ts`, wyjęte z literałów `reason: '…'`.
 *
 * **Granica skanu, domknięta GŁOŚNO, a nie po cichu:** rozpoznaje wyłącznie literał. Powód
 * podany stałą (`reason: EIGHTH`) byłby dla niego niewidzialny i test przeszedłby mimo
 * braku komunikatu — zmierzone w przeglądzie rundy 1 jako 53/53 zielone. Zamiast udawać,
 * że skan to rozumie, rzuca: odejście od stylu domowego `commands.ts` ma zatrzymać test
 * z komunikatem, co poszerzyć, a nie przepuścić powód bez opisu.
 */
function declaredReasons(): Set<string> {
  // Zakotwiczone w `ok: false,` — czyli w WARTOŚCI odmowy, a nie w deklaracji typu
  // (`{ ok: false; reason: string }` ma średnik, więc tu nie wpada).
  const wartosci = [...COMMANDS_SOURCE.matchAll(/ok:\s*false,\s*reason:\s*([^,}\n]+)/g)]
    .map((m) => m[1].trim());
  const nieliteraly = wartosci.filter((v) => !/^'[A-Z_]+'$/.test(v));
  if (nieliteraly.length > 0) {
    throw new Error(
      `declaredReasons: w commands.ts jest powód podany INACZEJ niż literałem — ` +
        `${JSON.stringify(nieliteraly)}. Ten skan rozumie wyłącznie literały, więc taki ` +
        'powód przeszedłby bez komunikatu. Poszerz skan albo wróć do literału.',
    );
  }
  return new Set(wartosci.map((v) => v.slice(1, -1)));
}

/**
 * Powody, które `canBuild` NAPRAWDĘ zwraca — każdy sprowokowany osobnym wejściem.
 *
 * Istnieje po to, żeby odczyt ze źródła nie był jedyną nogą tego testu. Skan sam w sobie
 * jest kruchy (katalog wad tej fazy ma „skan kształtu zamiast pomiaru własności" na drugim
 * miejscu), więc jest tu zestawiony z zachowaniem: wyrażenie, które przestanie łapać powód,
 * wyjdzie na jaw jako powód WIDZIANY, a nie zadeklarowany.
 */
function observedReasons(): Set<string> {
  const { s } = richRun();
  const seen = new Set<string>();
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
  s.ore = 0;
  collect(canBuild(s, hex, 'LASER_TURRET'));
  return seen;
}

describe('refusalMessage — każdy powód odmowy mówi po ludzku', () => {
  it('8. [WŁASNOŚĆ] KAŻDY powód z commands.ts ma komunikat po polsku, nieniosący identyfikatora', () => {
    const declared = declaredReasons();
    const observed = observedReasons();

    // Kontrola na przyrząd — bez niej pusta pętla przeszłaby na zielono.
    expect(declared.size).toBeGreaterThanOrEqual(7);
    expect(observed.size).toBeGreaterThanOrEqual(7);
    // Ta połowa pilnuje SAMEGO SKANU: każdy powód, który `canBuild` naprawdę zwraca, musi
    // dać się w źródle znaleźć. Gdyby wyrażenie przestało łapać którykolwiek, wyjdzie to tu,
    // a nie dopiero wtedy, gdy graczowi pokaże się napis zastępczy.
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

    // Siedem powodów ma dać siedem RÓŻNYCH zdań. Jeden komunikat skopiowany pod wszystkie
    // klucze spełniłby każdą asercję wyżej i nie powiedziałby graczowi niczego.
    const messages = [...declared].map((r) => refusalMessage(r));
    expect(new Set(messages).size).toBe(declared.size);
  });

  it('9. słownik WOLNO mieć nadmiarowy, a napis zastępczy krzyczy identyfikatorem zamiast wywalać grę', () => {
    // Druga połowa pary z kroku 6 briefu: wpis dla nieistniejącego powodu nikomu nie szkodzi.
    expect(Object.keys(REFUSAL_MESSAGES).length).toBeGreaterThanOrEqual(declaredReasons().size);
    // Powód spoza słownika nie rzuca (pętla renderu gracza nie ma prawa paść, bo
    // `packages/sim` dostał ósmy powód) — ale wynik NIESIE identyfikator, więc wada jest
    // widoczna i na ekranie, i w teście wyżej.
    const unknown = refusalMessage('CZWARTY_KSIĘŻYC');
    expect(unknown).toContain('CZWARTY_KSIĘŻYC');
    expect(declaredReasons().has('CZWARTY_KSIĘŻYC')).toBe(false);
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
    expect(panel.view.update(s, freeHexagonNear(s), 'BARRICADE')).toBe(true);

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
    expect(panel.view.update(s, cell, 'BARRICADE')).toBe(true);
    const before = panel.dump();

    building.hp = Math.floor(building.hp / 3);
    building.powered = !building.powered;
    // POŁOWA PIERWSZA: nic z tego nie każe panelowi się przemalować.
    expect(panel.view.update(s, cell, 'BARRICADE')).toBe(false);

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
    expect(fresh.view.update(s, cell, 'BARRICADE')).toBe(true);
    expect(fresh.dump()).toBe(before);

    // Kontrola pozytywna na przyrząd: panel NAPRAWDĘ reaguje na to, co MA nieść — bez niej
    // „dwa zrzuty są równe" mogłoby znaczyć „zrzut jest stały", a nie „hp nie przecieka".
    s.ore -= 1;
    const moved = makePanel();
    expect(moved.view.update(s, cell, 'BARRICADE')).toBe(true);
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
    bogaty.view.update(s, occupied, 'BARRICADE');
    s.ore = 0;
    const biedny = makePanel();
    biedny.view.update(s, occupied, 'BARRICADE');

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
    panel.view.update(s, freeHexagonNear(s), 'BARRICADE');

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
    // Zdanie z powodem odmowy jest SZEROKIE i leży na planecie — nie wolno mu łapać.
    for (const wiersz of panel.rows()) {
      expect({ klasa: wiersz.className, pe: wiersz.children[1].style.pointerEvents }).toEqual({
        klasa: wiersz.className,
        pe: '',
      });
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
    panel.view.update(s, freeHexagonNear(s), 'BARRICADE');
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

    expect(panel.view.update(s, cell, 'BARRICADE')).toBe(true); // pierwsze malowanie
    expect(panel.view.update(s, cell, 'BARRICADE')).toBe(false); // nic się nie ruszyło

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
    expect(panel.view.update(s, other, 'BARRICADE')).toBe(true); // wskazana komórka
    expect(panel.view.update(s, other, 'BARRICADE')).toBe(false);
    expect(panel.view.update(s, other, 'PYLON')).toBe(true); // wybrany typ
    expect(panel.view.update(s, other, 'PYLON')).toBe(false);
    for (const [nazwa, zmien] of kanaly.slice(2)) {
      zmien();
      expect({ nazwa, przemalowane: panel.view.update(s, other, 'PYLON') }).toEqual({
        nazwa,
        przemalowane: true,
      });
      expect({ nazwa, przemalowane: panel.view.update(s, other, 'PYLON') }).toEqual({
        nazwa,
        przemalowane: false,
      });
    }

    // Zabudowanie wskazanej komórki też jest zmianą — bez tego menu dalej pokazywałoby
    // „można budować" na komórce, na której właśnie coś stanęło.
    s.buildings[other] = { cellId: other, type: 'BARRICADE', hp: 1, powered: false };
    expect(panel.view.update(s, other, 'PYLON')).toBe(true);
  });

  it('14b. [BRAMKA] wyczerpanie złoża pod kursorem przemalowuje menu', () => {
    // `EXTRACTOR` wymaga `ORE_HEXAGON`, czyli heksagonu Z RESZTĄ ZŁOŻA — a złoża są
    // wyczerpywalne (§5.2). Bez tego kanału w bramce menu pokazywałoby „można" na złożu,
    // które właśnie skończyło się pod wieżą wydobywczą.
    const { s } = richRun();
    const panel = makePanel();
    const deposit = buildableNear(s, 'EXTRACTOR');
    expect(s.oreRemaining[deposit]).toBeGreaterThan(0);
    expect(panel.view.update(s, deposit, 'BARRICADE')).toBe(true);
    const before = rowText(panel, 'EXTRACTOR');
    expect(before).not.toContain(refusalMessage('WRONG_CELL_TYPE'));

    s.oreRemaining[deposit] = 0;
    expect(panel.view.update(s, deposit, 'BARRICADE')).toBe(true);
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
      expect(panel.view.update(s, cell, 'PYLON')).toBe(true);
      expect(row(buildMenuRows(s, cell), 'BARRICADE').affordable).toBe(false);

      // Ta sama PODŁOGA rudy (7), a dostępność się zmieniła. Jedynym kanałem, który to widzi,
      // jest maska dostępności.
      s.ore = 7.7;
      expect(shownAmount(7.2)).toBe(shownAmount(7.7));
      expect(row(buildMenuRows(s, cell), 'BARRICADE').affordable).toBe(true);
      expect(panel.view.update(s, cell, 'PYLON')).toBe(true);
    } finally {
      BUILDINGS.BARRICADE.costOre = original;
    }
    expect(BUILDINGS.BARRICADE.costOre).toBe(original);
  });

  it('15. [PARA] koniec runu jest widoczny: panel mówi, że komendy nie są przyjmowane', () => {
    const { s } = richRun();
    const panel = makePanel();
    const cell = freeHexagonNear(s);
    panel.view.update(s, cell, 'BARRICADE');
    expect(panel.text()).not.toContain('nie są przyjmowane');
    s.phase = 'DEFEAT';
    panel.view.update(s, cell, 'BARRICADE');
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
    panel.view.update(s, freeHexagonNear(s), 'BARRICADE');
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
      panel.view.update(s, cell, selection.selectedType);
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
  const scene: ClientScene = {
    camera: orbit,
    updateBuildings: () => {},
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
      ['hud.update', () => void rig.client.hud.update(rig.sim.state, cell, 'PYLON')],
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
      const repainted = panel.view.update(sim.state, selection.selectedCell, selection.selectedType);
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
        ponownie: panel.view.update(sim.state, selection.selectedCell, selection.selectedType),
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
      panel.view.update(s, cell, 'BARRICADE'); // pierwsze malowanie poza pomiarem
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
            sink += panel.view.update(s, cell, 'BARRICADE') ? 1 : 0;
          }
        },
        // Kontrolą jest DOKŁADNIE ten defekt, przed którym broni bramka: ta sama praca plus
        // przeliczenie menu na każdą klatkę. Lepszego odniesienia nie ma — to nie jest
        // sztuczna alokacja dobrana pod przyrząd, tylko wersja bez bramki.
        control: () => {
          for (let i = 0; i < ITERATIONS; i++) {
            sink += panel.view.update(s, cell, 'BARRICADE') ? 1 : 0;
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
