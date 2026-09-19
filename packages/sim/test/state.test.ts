import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/math/vec3.js';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS, type SimState } from '../src/sim/state.js';
import { BUILDINGS } from '../src/sim/defs.js';
import { stateHash } from '../src/sim/hash.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';
import { Sim } from '../src/sim/loop.js';
import type { Command } from '../src/sim/commands.js';
import { skanujSerializowalnosc } from './support/serializable.js';

const planet = createPlanet({ seed: 1 });

/**
 * Stan z jednym budynkiem (domyślnie na indeksie 0) i jedną jednostką — wspólny
 * punkt odniesienia dla testów wrażliwości hasha na pola budynków/jednostek,
 * których `createState` sam z siebie nigdy nie populuje. `buildingIndex`
 * parametryzowany, żeby test pozycyjności (§cellId) mógł postawić IDENTYCZNY
 * budynek pod innym indeksem bez ręcznego powielania jego pól.
 */
function withBuildingAndUnit(buildingIndex = 0) {
  const s = createState(planet, 150);
  s.buildings[buildingIndex] = { cellId: 0, type: 'PYLON', hp: 80, powered: false };
  s.units.push({ id: 1, type: 'SWARM', cellId: 0, pos: vec3(1, 2, 3), hp: 30, exposure: 0.25 });
  return s;
}

describe('createState', () => {
  it('startuje z zadaną rudą i pustą planszą', () => {
    const s = createState(planet, 150);
    expect(s.tick).toBe(0);
    expect(s.ore).toBe(150);
    expect(s.phase).toBe('RUNNING');
    expect(s.units).toEqual([]);
    expect(s.buildings.filter((b) => b !== null)).toEqual([]);
  });

  it('kopiuje pojemność złóż do mutowalnego stanu, nie dzieli referencji z planetą', () => {
    const s = createState(planet, 150);
    expect(s.oreRemaining.length).toBe(planet.cells.length);
    s.oreRemaining[planet.startCell] = 999;
    expect(planet.cells[planet.startCell].oreCapacity).not.toBe(999);
  });

  it('krok symulacji to dokładnie 20 Hz', () => {
    expect(TICK_SECONDS).toBe(0.05);
    expect(1 / TICK_SECONDS).toBe(20);
  });
});

describe('stateHash', () => {
  it('identyczne stany dają identyczny hash', () => {
    expect(stateHash(createState(planet, 150))).toBe(stateHash(createState(planet, 150)));
  });

  it('zmiana JAKIEJKOLWIEK wartości zmienia hash', () => {
    const base = createState(planet, 150);
    const h = stateHash(base);

    const a = createState(planet, 150); a.ore = 151;
    const b = createState(planet, 150); b.tick = 1;
    const c = createState(planet, 150); c.storedEnergy = 0.0001;
    const d = createState(planet, 150); d.oreRemaining[0] += 1;

    for (const variant of [a, b, c, d]) {
      expect(stateHash(variant)).not.toBe(h);
    }
  });

  it('wykrywa różnicę zmiennoprzecinkową poniżej progu widoczności', () => {
    const a = createState(planet, 150); a.storedEnergy = 1;
    const b = createState(planet, 150); b.storedEnergy = 1 + Number.EPSILON;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  // `createState` zawsze zwraca puste `buildings`/`units`, więc bez poniższych
  // pętle po budynkach i jednostkach w hash.ts nigdy by się nie wykonały w całym
  // pakiecie testów — regresja w którejkolwiek z nich przeszłaby niezauważona.

  it('budynek: zmiana `type` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.buildings[0]!.type = 'BARRICADE';
    expect(stateHash(variant)).not.toBe(h);
  });

  it('budynek: zmiana `hp` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.buildings[0]!.hp += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('budynek: zmiana `powered` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.buildings[0]!.powered = true;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('budynek: `cellId` jest niesiony POZYCYJNIE przez indeks tablicy, nie przez pole — ten sam budynek pod innym indeksem zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit(0));
    const moved = withBuildingAndUnit(1);
    expect(stateHash(moved)).not.toBe(h);
  });

  it('jednostka: zmiana `id` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].id += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `type` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].type = 'ARMOR';
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `cellId` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].cellId += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `pos.x` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    const p = variant.units[0].pos;
    variant.units[0].pos = vec3(p.x + 1, p.y, p.z);
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `pos.y` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    const p = variant.units[0].pos;
    variant.units[0].pos = vec3(p.x, p.y + 1, p.z);
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `pos.z` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    const p = variant.units[0].pos;
    variant.units[0].pos = vec3(p.x, p.y, p.z + 1);
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `hp` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].hp += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('jednostka: zmiana `exposure` zmienia hash', () => {
    const h = stateHash(withBuildingAndUnit());
    const variant = withBuildingAndUnit();
    variant.units[0].exposure += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('zmiana `nextUnitId` zmienia hash', () => {
    const h = stateHash(createState(planet, 150));
    const variant = createState(planet, 150);
    variant.nextUnitId += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('zmiana `phase` zmienia hash', () => {
    const h = stateHash(createState(planet, 150));
    const variant = createState(planet, 150);
    variant.phase = 'VICTORY';
    expect(stateHash(variant)).not.toBe(h);
  });

  // `createState` zawsze populuje `pentagons` (jeden wpis na pentagon planety, patrz
  // `PentagonState` w state.ts, Task 4), więc — analogicznie do budynków/jednostek
  // wyżej — bez poniższych pętla po pentagonach w hash.ts nigdy by się nie wykonała
  // w całym pakiecie testów, a regresja w którymkolwiek z jej trzech pól przeszłaby
  // niezauważona.

  it('pentagon: zmiana `spawnAccumulator` zmienia hash', () => {
    const h = stateHash(createState(planet, 150));
    const variant = createState(planet, 150);
    variant.pentagons[0].spawnAccumulator += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('pentagon: zmiana `eruptionCooldown` zmienia hash', () => {
    const h = stateHash(createState(planet, 150));
    const variant = createState(planet, 150);
    variant.pentagons[0].eruptionCooldown += 1;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('pentagon: zmiana `eruptionArmed` zmienia hash', () => {
    const h = stateHash(createState(planet, 150));
    const variant = createState(planet, 150);
    variant.pentagons[0].eruptionArmed = true;
    expect(stateHash(variant)).not.toBe(h);
  });

  it('pentagon: pozycja w tablicy ma znaczenie — ta sama zmiana pod innym indeksem daje inny hash', () => {
    const a = createState(planet, 150);
    a.pentagons[0].spawnAccumulator = 0.5;
    const b = createState(planet, 150);
    b.pentagons[1].spawnAccumulator = 0.5;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});

/**
 * Residual z przeglądu końcowego Fazy 1B: wszystkie testy `stateHash` powyżej hashują
 * RĘCZNIE WYBRANE pola — regresja w polu, którego nikt nie dodał tutaj ręcznie,
 * przechodziłaby niezauważona. Doc-comment `SimState` w `state.ts` nazywa
 * `state.test.ts` strażnikiem niezmiennika serializowalności, ale ten strażnik
 * (test round-trip JSON niżej) porównuje `stateHash` PRZED i PO — czyli widzi TYLKO
 * pola, które `stateHash` faktycznie czyta. Ustaw nowe pole na `Infinity`, `Map`
 * albo `Float64Array`, i round-trip pozostanie zielony. (Dla pól ZAGNIEŻDŻONYCH domyka to
 * dziś skaner strukturalny — patrz dwa bloki `skaner serializowalności` na końcu pliku;
 * blok poniżej zostaje osią dla kluczy najwyższego poziomu.)
 *
 * Ten blok odwraca kierunek dowodu: startuje od `Object.keys(state)` — czyli od tego,
 * co `SimState` FAKTYCZNIE ma w danej chwili — zamiast od listy pól, o których ktoś
 * pamiętał. Pola świadomie NIE hashowane idą na `UNHASHED_FIELDS` poniżej, z
 * uzasadnieniem. Kto doda nowe pole do `SimState`, musi je albo zahashować w
 * `hash.ts`, albo świadomie dopisać do `UNHASHED_FIELDS` — inaczej `perturb()` poniżej
 * przestaje się kompilować (`HashedField` jest wyczerpujący `switch` bez `default`:
 * TS2366, "Function lacks ending return statement", gdy nowy klucz `SimState` nie ma
 * przypadku) ORAZ, niezależnie od typów, test runtime'owy poniżej nie znajdzie dla
 * niego perturbacji i się wysypie.
 */
const UNHASHED_FIELDS = [
  // Niemutowalna w trakcie działania symulacji (patrz doc-comment `SimState.planet`
  // w state.ts) i hashowana OSOBNO, przez `golden-hash.test.ts` — nie przez
  // `stateHash`, który dotyczy wyłącznie mutowalnej części stanu.
  'planet',
] as const;
type UnhashedField = (typeof UNHASHED_FIELDS)[number];
type HashedField = Exclude<keyof SimState, UnhashedField>;

/**
 * Perturbuje jedno pole `SimState` w sposób, który MUSI zmienić `stateHash`, jeśli to
 * pole faktycznie bierze w nim udział. Celowo NIE generyczne ("zmutuj cokolwiek
 * napotkasz w obiekcie"): `Building.cellId` jest CELOWO niehashowany (niesiony
 * pozycyjnie przez indeks tablicy — patrz test wyżej), więc "zmutuj pierwsze pole
 * napotkanego obiektu" dawałoby fałszywe negatywy dla `buildings`. Stąd jawna,
 * przemyślana perturbacja dla każdego pola z osobna, nie jedna generyczna sztuczka.
 */
function perturb(s: SimState, key: HashedField): SimState {
  const clone = structuredClone(s);
  switch (key) {
    case 'tick': clone.tick += 1; return clone;
    case 'ore': clone.ore += 1; return clone;
    case 'storedEnergy': clone.storedEnergy += 1; return clone;
    case 'phase': clone.phase = clone.phase === 'RUNNING' ? 'VICTORY' : 'RUNNING'; return clone;
    case 'nextUnitId': clone.nextUnitId += 1; return clone;
    case 'oreRemaining': clone.oreRemaining[0] += 1; return clone;
    case 'buildings': clone.buildings[0]!.hp += 1; return clone;
    case 'units': clone.units[0].hp += 1; return clone;
    case 'pentagons': clone.pentagons[0].spawnAccumulator += 1; return clone;
    case 'evacCharge': clone.evacCharge += 1; return clone;
    // Bazowe `-1` (alarm nieaktywny) → `0`, czyli wartość, przy której alarm
    // JEST aktywny i właśnie dobiegł końca. Perturbacja celowo przekracza granicę
    // sentinela, a nie tylko zmienia liczbę o oczko w obrębie tej samej semantyki.
    case 'evacAlarmRemaining': clone.evacAlarmRemaining += 1; return clone;
    case 'evacUnlockTick': clone.evacUnlockTick += 1; return clone;
    case 'killsBySun': clone.killsBySun += 1; return clone;
    case 'killsByTurret': clone.killsByTurret += 1; return clone;
    // Przestawione SŁOWO ROBOCZE, nie seed: seed jest w migawce po to, żeby `fork()`
    // dawał te same poddrzewa, ale to `s` niesie POZYCJĘ w strumieniu — czyli dokładnie
    // to, czego brak psuł wznawianie. Perturbacja musi ruszyć tę połowę, inaczej test
    // przechodziłby nad haszem, który czyta wyłącznie seed.
    case 'waveRng': clone.waveRng = {
      seed: clone.waveRng.seed,
      s: [clone.waveRng.s[0] + 1, clone.waveRng.s[1], clone.waveRng.s[2], clone.waveRng.s[3]],
    }; return clone;
  }
}

describe('kompletność stateHash — każde pole SimState jest albo hashowane, albo świadomie niehashowane', () => {
  it('perturbacja KAŻDEGO nie-allowlistowanego pola zmienia stateHash', () => {
    const base = withBuildingAndUnit();
    const h = stateHash(base);
    const keys = Object.keys(base) as (keyof SimState)[];

    let checked = 0;
    for (const key of keys) {
      if ((UNHASHED_FIELDS as readonly string[]).includes(key)) continue;
      const variant = perturb(base, key as HashedField);
      expect(
        stateHash(variant),
        `pole '${key}': perturbacja nie zmieniła stateHash — czy na pewno jest czytane w hash.ts?`,
      ).not.toBe(h);
      checked++;
    }
    // Nie tylko pętla nad `keys`: gdyby `keys` samo z siebie było puste albo gdyby
    // filtr `includes` po cichu odsiał więcej niż allowlistę, powyższa pętla
    // przeszłaby "sukcesem", nic nie sprawdzając. To liczy, ile pól NAPRAWDĘ przeszło
    // przez asercję, i porównuje z oczekiwaną liczbą.
    expect(checked).toBe(keys.length - UNHASHED_FIELDS.length);
  });
});

/**
 * Regresja na Important #4 z przeglądu końcowego Fazy 1B: plan wymagał albo sentinela
 * `-1` zamiast `Infinity`, albo spisanej twardej reguły "wyjście BFS/Dijkstry nigdy nie
 * wchodzi do SimState". Nie wdrożono ŻADNEGO — kod jest dziś czysty (ten test przechodzi
 * bez zmian w produkcyjnym kodzie), ale nic tego nie asercjowało, a Faza 1C to właśnie
 * moment, w którym `SimState` rośnie (jednostki, fale, `evacCharge`, `RngState`) i w
 * którym pola przepływu zaczynają wyglądać na warte cache'owania. Ten test zamienia
 * założenie w strażnika: tani dziś, bo nic nie naprawia, ale łapie regresję jutro.
 */
describe('niezmiennik serializowalności (round-trip JSON)', () => {
  it('stateHash(JSON.parse(JSON.stringify(state))) === stateHash(state) po kilkuset tickach ze zbudowanymi budynkami', () => {
    const sim = new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: 5000 });

    // KOREKTA (przegląd gałęzi, Important #5): poprzednia wersja tego komentarza
    // twierdziła, że „`Sim` sam z siebie NIGDY nie zasiewa CORE". To już NIEPRAWDA —
    // konstruktor `Sim` zasiewa CORE na `planet.startCell` bezpośrednim zapisem do
    // stanu (loop.ts, patrz `this.s.buildings[planet.startCell] = …`), dokładnie tak,
    // jak robi to linia niżej. Komentarz pochodził z Fazy 1B, gdy `Sim` jeszcze tego
    // nie robił, i nie został zaktualizowany, gdy 1C to dodała.
    //
    // Zapis ZOSTAJE mimo to i jest celowy: jest idempotentny (ten sam typ, to samo
    // pełne hp, ta sama komórka), a czyni ten test niezależnym od tego, czy zasiew
    // w konstruktorze kiedykolwiek zniknie — bez CORE `connectedToCore` (network.ts)
    // nie łączy NIC, `storedEnergy` zostaje na 0 przez wszystkie 400 ticków i round-trip
    // „przechodzi", nie sprawdzając niczego ciekawego. Ten sam wzorzec zasiewu co
    // w commands.test.ts/flowfield.test.ts/network.test.ts/power.test.ts.
    sim.state.buildings[planet.startCell] = {
      cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
    };

    // Komórki wybierane z planety, nie zaszyte na sztywno — patrz uzasadnienie w
    // determinism.test.ts. Kilka BUILD/DEMOLISH, żeby `buildings`/`ore`/`storedEnergy`
    // faktycznie się zapełniły: `createState` sam z siebie daje puste `buildings`, co
    // sprawiłoby, że round-trip pustego stanu "przechodzi" nic nie sprawdzając.
    //
    // Zmierzone (naprawa residuali Fazy 1B), nie założone: filtr niżej wybiera komórki
    // WYŁĄCZNIE wg typu (HEXAGON, bez rudy, nie startCell), nie wg odległości od
    // `planet.startCell` — dla seeda planety użytego w tym teście żaden z trzech
    // wybranych budynków nie leży w zasięgu sieci CORE (`connectionRadius = 3`), więc
    // PYLON/SOLAR_PANEL/BARRICADE NIGDY nie dostają `powered: true` w tym przebiegu.
    // `storedEnergy` mimo to rośnie — wyłącznie z własnej produkcji CORE (CONSTANT,
    // `rate = 10`/s), bo CORE jest jedynym podłączonym elementem sieci — aż do limitu
    // `BUILDINGS.CORE.energyStorage` (200 przy dzisiejszym stroju w defs.ts). To
    // realnie ćwiczy dokładnie to, czego brakowało: `storedEnergy` niezerowe i
    // zmieniające się przez cały przebieg (zamiast stałego 0) oraz przynajmniej jeden
    // budynek z `powered: true` (CORE) obok kilku z `powered: false` — nie WSZYSTKIE
    // `false` jak poprzednio. Asercje niżej sprawdzają dokładnie te dwie rzeczy, żeby
    // ten komentarz sam nie stał się kolejną prozą, która obiecuje więcej niż kod
    // sprawdza.
    const buildable = planet.cells
      .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell)
      .map((c) => c.id);
    const script: Array<[number, Command]> = [
      [5, { kind: 'BUILD', cellId: buildable[0], type: 'PYLON' }],
      [10, { kind: 'BUILD', cellId: buildable[1], type: 'SOLAR_PANEL' }],
      [60, { kind: 'BUILD', cellId: buildable[2], type: 'BARRICADE' }],
      [150, { kind: 'DEMOLISH', cellId: buildable[0] }],
    ];
    for (let t = 0; t < 400; t++) {
      for (const [at, cmd] of script) if (at === t) sim.enqueue(cmd);
      sim.step();
    }

    expect(sim.state.storedEnergy).toBeGreaterThan(0);
    expect(sim.state.buildings[planet.startCell]?.powered).toBe(true);

    const before = stateHash(sim.state);
    const roundTripped = JSON.parse(JSON.stringify(sim.state));
    expect(stateHash(roundTripped)).toBe(before);
  });
});

/**
 * Domknięcie osi, której dwa strażniki wyżej nie obejmują: pola ZAGNIEŻDŻONE.
 *
 * Test kompletności `stateHash` startuje od `Object.keys(state)`, a round-trip porównuje
 * hasze — obie osie kończą się na kluczach najwyższego poziomu. Zmierzone przed napisaniem
 * tego bloku: `Unit.pathDistance = Infinity` przechodziło 744/744 przy czystym `tsc`,
 * a round-trip zamieniał je na `null` w 24 z 24 jednostek. Uzasadnienie skanera i lista
 * rzeczy, których świadomie NIE zgłasza: `support/serializable.ts`.
 */
describe('skaner serializowalności — sam przyrząd', () => {
  /** Stan-nośnik: skaner ma znajdować rzeczy ZAGNIEŻDŻONE, nie pola korzenia. */
  function nosnik(): SimState {
    return withBuildingAndUnit();
  }

  /**
   * PARY, nie pojedyncze przypadki. Każdy zakazany kształt ma obok siebie legalnego
   * sąsiada, który MA PRZEJŚĆ — połówka „ma przejść" wykrywała w tym projekcie wadę
   * siedem razy, zawsze wtedy, gdy pierwsza połówka pokazywała komplet czerwonych.
   */
  const pary: Array<{
    nazwa: string;
    rodzaj: string;
    zakazane: unknown;
    legalne: unknown;
  }> = [
    { nazwa: 'Infinity', rodzaj: 'Infinity', zakazane: Infinity, legalne: Number.MAX_VALUE },
    { nazwa: '-Infinity', rodzaj: 'Infinity', zakazane: -Infinity, legalne: -Number.MAX_VALUE },
    { nazwa: 'NaN', rodzaj: 'NaN', zakazane: NaN, legalne: 0 },
    { nazwa: 'TypedArray', rodzaj: 'TypedArray', zakazane: new Float64Array([1, 2]), legalne: [1, 2] },
    { nazwa: 'Map', rodzaj: 'Map', zakazane: new Map([['a', 1]]), legalne: { a: 1 } },
    { nazwa: 'Set', rodzaj: 'Set', zakazane: new Set([1]), legalne: [1] },
    { nazwa: 'Date', rodzaj: 'Date', zakazane: new Date(0), legalne: '1970-01-01' },
    { nazwa: 'undefined', rodzaj: 'undefined', zakazane: undefined, legalne: -1 },
    { nazwa: 'bigint', rodzaj: 'bigint', zakazane: 10n, legalne: 10 },
    { nazwa: 'funkcja', rodzaj: 'function', zakazane: () => 1, legalne: 'f' },
  ];

  for (const { nazwa, rodzaj, zakazane, legalne } of pary) {
    it(`${nazwa}: zakazany w polu zagnieżdżonym — ZGŁASZANY, ze ścieżką`, () => {
      const s = nosnik();
      (s.units[0] as unknown as Record<string, unknown>).nowePole = zakazane;
      const { naruszenia } = skanujSerializowalnosc(s);
      expect(naruszenia.map((n) => n.rodzaj)).toContain(rodzaj);
      expect(naruszenia.find((n) => n.rodzaj === rodzaj)?.sciezka).toBe('state.units[0].nowePole');
    });

    it(`${nazwa}: legalny sąsiad w tym samym miejscu — NIE zgłaszany`, () => {
      const s = nosnik();
      (s.units[0] as unknown as Record<string, unknown>).nowePole = legalne;
      expect(skanujSerializowalnosc(s).naruszenia).toEqual([]);
    });
  }

  it('cykl jest zgłaszany, a współdzielona referencja NIE — `JSON.stringify` rzuca tylko na tym pierwszym', () => {
    const zCyklem = nosnik();
    const gniazdo = zCyklem.units[0] as unknown as Record<string, unknown>;
    gniazdo.wstecz = zCyklem;
    expect(skanujSerializowalnosc(zCyklem).naruszenia.map((n) => n.rodzaj)).toContain('cykl');
    expect(() => JSON.stringify(zCyklem)).toThrow();

    const zeWspoldzieleniem = nosnik();
    const wspolny = { x: 1 };
    const rec = zeWspoldzieleniem.units[0] as unknown as Record<string, unknown>;
    rec.a = wspolny;
    rec.b = wspolny;
    expect(skanujSerializowalnosc(zeWspoldzieleniem).naruszenia).toEqual([]);
    expect(() => JSON.stringify(zeWspoldzieleniem)).not.toThrow();
  });

  it('instancja klasy jest zgłaszana JAKO PROTOTYP, a naruszenia POD NIĄ nie giną', () => {
    class Cos { constructor(public gdzies: number) {} }
    const s = nosnik();
    (s.units[0] as unknown as Record<string, unknown>).obiekt = new Cos(Infinity);
    const rodzaje = skanujSerializowalnosc(s).naruszenia.map((n) => n.rodzaj);
    expect(rodzaje).toContain('prototyp');
    expect(rodzaje).toContain('Infinity');
  });

  it('czysty stan-nośnik nie daje ŻADNEGO naruszenia — inaczej wszystkie pary wyżej byłyby bez wartości', () => {
    expect(skanujSerializowalnosc(nosnik()).naruszenia).toEqual([]);
  });
});

describe('skaner serializowalności — na ROZEGRANYM stanie', () => {
  /**
   * Fikstura dobrana POMIAREM, nie na oko. Pierwsza próba (samo CORE, bez obrony)
   * kończyła się PORAŻKĄ na ticku 587 z ZEREM budynków — skan przechodziłby wtedy
   * nad pustą tablicą `buildings` i byłby zielony z niewiedzy, dokładnie tak jak
   * „przebieg pod obciążeniem", w którym obciążenie nie ugryzło. Wieże utrzymują
   * CORE przy życiu, więc stan ma jednocześnie budynki, jednostki i przebytą walkę.
   */
  function rozegranyStan(): SimState {
    const sim = new Sim(planet, { ...DEFAULT_RUN, rotationPeriod: 180, startingOre: 5000 });
    sim.state.buildings[planet.startCell] = {
      cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
    };
    const wolne = planet.cells
      .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && c.id !== planet.startCell)
      .map((c) => c.id);
    const przyCore = planet.cells[planet.startCell].neighbors;
    const script: Array<[number, Command]> = [
      [5, { kind: 'BUILD', cellId: wolne[0], type: 'PYLON' }],
      [10, { kind: 'BUILD', cellId: wolne[1], type: 'SOLAR_PANEL' }],
      [20, { kind: 'BUILD', cellId: przyCore[0], type: 'KINETIC_TURRET' }],
      [25, { kind: 'BUILD', cellId: przyCore[1], type: 'KINETIC_TURRET' }],
      [30, { kind: 'BUILD', cellId: przyCore[2], type: 'LASER_TURRET' }],
      [60, { kind: 'BUILD', cellId: wolne[2], type: 'BARRICADE' }],
      [150, { kind: 'DEMOLISH', cellId: wolne[0] }],
    ];
    for (let t = 0; t < 1200; t++) {
      for (const [at, cmd] of script) if (at === t) sim.enqueue(cmd);
      sim.step();
    }
    return sim.state;
  }

  it('fikstura jest BOGATA — bez tego zielony skan niżej nic nie znaczy', () => {
    const s = rozegranyStan();
    const budynki = s.buildings.filter((b) => b !== null);
    expect(s.phase).toBe('RUNNING');
    expect(s.units.length).toBeGreaterThan(0);
    expect(budynki.length).toBeGreaterThanOrEqual(3);
    // OBIE gałęzie `powered`: stan, w którym wszystko jest zasilone, nie ćwiczy `false`.
    expect(budynki.some((b) => b!.powered)).toBe(true);
    expect(budynki.some((b) => !b!.powered)).toBe(true);
    expect(s.killsByTurret).toBeGreaterThan(0);
    // Sentinel „alarm nieaktywny" MUSI być obecny — to jedyna wartość, na której skaner
    // mógłby dać fałszywy alarm, bo jest umownym zamiennikiem `Infinity`/`null`.
    expect(s.evacAlarmRemaining).toBe(-1);
    expect(s.pentagons.some((p) => p.spawnAccumulator > 0)).toBe(true);
  });

  it('rozegrany stan nie zawiera NICZEGO, czego round-trip JSON by nie odtworzył', () => {
    const { naruszenia, wezlow } = skanujSerializowalnosc(rozegranyStan());
    expect(naruszenia).toEqual([]);
    // Skan na dwóch węzłach też dałby pustą listę. Ta liczba odróżnia „nic nie ma"
    // od „nic nie sprawdzono".
    expect(wezlow).toBeGreaterThan(10_000);
  });

  it('KONTROLA POZYTYWNA: skan tej konkretnej fikstury sięga do jednostek i budynków', () => {
    const zJednostka = rozegranyStan();
    (zJednostka.units[0] as unknown as Record<string, unknown>).podrzucone = Infinity;
    expect(skanujSerializowalnosc(zJednostka).naruszenia).toHaveLength(1);

    const zBudynkiem = rozegranyStan();
    const idx = zBudynkiem.buildings.findIndex((b) => b !== null);
    (zBudynkiem.buildings[idx] as unknown as Record<string, unknown>).podrzucone = NaN;
    expect(skanujSerializowalnosc(zBudynkiem).naruszenia).toHaveLength(1);

    const zPentagonem = rozegranyStan();
    (zPentagonem.pentagons[0] as unknown as Record<string, unknown>).podrzucone = new Map();
    expect(skanujSerializowalnosc(zPentagonem).naruszenia).toHaveLength(1);
  });
});
