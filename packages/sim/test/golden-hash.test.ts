import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createPlanet, type Planet } from '../src/world/planet.js';
import { Sim } from '../src/sim/loop.js';
import { type RunConfig } from '../src/sim/rules.js';
import { stateHash } from '../src/sim/hash.js';
import { BUILDINGS, ENEMIES } from '../src/sim/defs.js';
import type { BuildingType } from '../src/sim/state.js';

/**
 * Regresja złotego hasza: najsilniejsza weryfikacja, jaką ta faza wyprodukowała —
 * haszowanie w pełni zbudowanej `Planet` i potwierdzenie identyczności między
 * procesami i konfiguracjami V8 — istniała dotąd wyłącznie jako jednorazowy
 * skrypt w scratchpadzie dwóch recenzentów. Ten test przypina ją na stałe.
 *
 * Przy okazji zabezpiecza subtelniejszy niezmiennik: KOLEJNOŚĆ `Cell.neighbors`
 * jest load-bearing dla późniejszych faz (pathfinding Fazy 1C rozstrzyga remisy
 * odległości po pozycji w tablicy) i dotąd nie była chroniona przez nic — zmiana
 * kolejności sąsiadów przy tej samej topologii zmieni hasz, mimo że żaden z
 * dotychczasowych testów (które sprawdzają zbiory, nie kolejność) by tego nie złapał.
 */

const GOLDEN_SEED = 20260914;

/**
 * Przypięte po uruchomieniu identycznej serializacji + SHA-256 w trzech
 * oddzielnych procesach `node` (zwykłym oraz pod `--experimental-strip-types`)
 * z osobnego jednorazowego skryptu importującego `@heliopolis/sim` po nazwie
 * pakietu — wszystkie trzy zgodne, zanim ta wartość trafiła do repo.
 */
const GOLDEN_SHA256 = 'ce60726814a220ab08a1f966e53a5c9468ebe90e3248f6c49cce7332d0848d30';

/**
 * Serializuje dokładnie te części `Planet`, które nie mogą po cichu dryfować:
 * geometrię każdej komórki, jej typ, UPORZĄDKOWANĄ listę sąsiadów, rozkład
 * rudy i wybraną komórkę startową. Każda liczba (także indeksy i długości)
 * zapisywana jest przez `DataView.setFloat64` — czyli w pełnej precyzji
 * bitowej IEEE 754 — celowo NIE przez `JSON.stringify`: ten ostatni zamienia
 * `NaN`/`Infinity` na nieodróżnialne od siebie `null`, a `-0` na `"0"`, więc
 * dokładnie ten rodzaj cichego dryfu (por. Blocker 4: `undefined` opcja dająca
 * ciche `NaN` w geometrii), który ten test ma łapać, mógłby prześlizgnąć się
 * przez haszowanie oparte na JSON.
 */
function serializePlanetForHash(planet: Planet): Uint8Array {
  const words: number[] = [];
  const pushF64 = (n: number): void => {
    words.push(n);
  };

  pushF64(planet.seed);
  pushF64(planet.radius);
  pushF64(planet.frequency);
  pushF64(planet.startCell);

  pushF64(planet.pentagons.length);
  for (const p of planet.pentagons) pushF64(p);

  pushF64(planet.cells.length);
  for (const cell of planet.cells) {
    pushF64(cell.id);
    pushF64(cell.cellType === 'PENTAGON' ? 1 : 0);
    pushF64(cell.oreCapacity);

    pushF64(cell.center.x);
    pushF64(cell.center.y);
    pushF64(cell.center.z);

    pushF64(cell.normal.x);
    pushF64(cell.normal.y);
    pushF64(cell.normal.z);

    pushF64(cell.corners.length);
    for (const c of cell.corners) {
      pushF64(c.x);
      pushF64(c.y);
      pushF64(c.z);
    }

    // Kolejność CELOWO zachowana, nie sortowana: to właśnie ten porządek
    // pinujemy (por. komentarz na górze pliku).
    pushF64(cell.neighbors.length);
    for (const n of cell.neighbors) pushF64(n);
  }

  const buf = new ArrayBuffer(words.length * 8);
  const view = new DataView(buf);
  for (let i = 0; i < words.length; i++) view.setFloat64(i * 8, words[i], true);
  return new Uint8Array(buf);
}

describe('złoty hasz determinizmu', () => {
  it(`createPlanet({ seed: ${GOLDEN_SEED} }) haszuje się do przypiętej wartości`, () => {
    const planet = createPlanet({ seed: GOLDEN_SEED });
    const bytes = serializePlanetForHash(planet);
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(hash).toBe(GOLDEN_SHA256);
  });

  it('kolejność Cell.neighbors jest częścią przypiętego hasza (nie tylko zbiór)', () => {
    // Ten sam zestaw sąsiadów w INNEJ kolejności musi dać INNY hasz — inaczej
    // powyższy test chroniłby tylko zbiory, nie porządek, i cichy regres
    // sortowania (który zepsułby rozstrzyganie remisów w pathfindingu Fazy 1C)
    // przeszedłby niezauważony.
    const planet = createPlanet({ seed: GOLDEN_SEED });
    const reordered: Planet = {
      ...planet,
      cells: planet.cells.map((c) => ({ ...c, neighbors: [...c.neighbors].reverse() })),
    };
    const originalHash = createHash('sha256').update(serializePlanetForHash(planet)).digest('hex');
    const reorderedHash = createHash('sha256').update(serializePlanetForHash(reordered)).digest('hex');
    expect(reorderedHash).not.toBe(originalHash);
  });
});

// =========================================================================================
// Złoty hasz TRAJEKTORII — nie samej planety
// =========================================================================================

/**
 * ## Czego brakowało, i co to kosztowało
 *
 * Do tej pory złoty hasz przypinał **wyłącznie `createPlanet`**, a test determinizmu
 * porównywał przebieg SAM ZE SOBĄ (dwa `Sim` z tego samego seeda). Obie te rzeczy są
 * potrzebne i żadna nie pilnuje tego, co obie miały pilnować razem: **że zmiana w kodzie
 * symulacji nie przestawia przebiegu**.
 *
 * Zmierzone przez bramkę gałęzi Fazy 2C: pod mutacją trajektorii oba istniejące testy
 * zostawały **zielone (47/47)**. Twierdzenie „Zadanie 5 nie ruszyło determinizmu" było
 * prawdziwe — ale dowodu w zapisanej formie nie było, bo test porównujący przebieg z samym
 * sobą przesuwa się razem z kodem. Tamto twierdzenie zostało potwierdzone dopiero ręcznym
 * zestawieniem z `main`, czyli robotą, której nikt nie powtórzy przy następnej zmianie.
 *
 * Ten test przypina **ciąg haszów stanu co 100 ticków** dla scenariusza, który przechodzi
 * przez ekonomię, sieć, walkę i kaskadę brownoutu. Dowolna zmiana przebiegu go oblewa.
 *
 * **Kiedy wolno zaktualizować `GOLDEN_RUN_SHA256`:** wyłącznie wtedy, gdy zmiana przebiegu
 * jest ZAMIERZONA (strojenie `[STROJENIE]`, nowa mechanika) i zapisana w commicie jako taka.
 * Podmiana tej liczby, żeby „testy przeszły", kasuje jedyny strażnik, jaki ta własność ma.
 */
const GOLDEN_RUN_TICKS = 1200;
const GOLDEN_RUN_SHA256 = 'b6a638a0f3df21e66122cdc645855b7963437bc297836313ee1ae980a02da22c';

/**
 * Konfiguracja przebiegu — **ZAMROŻONY LITERAŁ, nie `DEFAULT_RUN`**.
 *
 * Wartości są dziś takie same jak w `DEFAULT_RUN` i to jest przypadek, nie zależność.
 * `DEFAULT_RUN` jest nastawą GRY i Faza 3 ma ją przestroić — gdyby ten przebieg z niej
 * korzystał, strażnik oblewałby przy **każdej zamierzonej zmianie balansu**, a wtedy ktoś
 * zacząłby odruchowo przepisywać w nim hasz i strażnik przestałby cokolwiek znaczyć.
 * Kopia jest tu celowa: ta konfiguracja ma NIE iść za grą.
 */
const GOLDEN_RUN_CONFIG: RunConfig = {
  rotationPeriod: 180,
  startingOre: 100_000,
  cyclesPerRun: 10,
  evacUnlockFraction: 0.67,
  evacEnergyRequired: 1000,
  evacChargeRate: 25,
  evacAlarmSeconds: 60,
  spawn: {
    baseRatePerPentagon: 0.25,
    growthPerCycle: 1.35,
    eruptionInterval: 20,
    eruptionBurstBase: 4,
    eruptionScalePerCap: 0.6,
    disruptorFromCycle: 3,
    armorFromCycle: 5,
  },
};

/**
 * Odcisk palca TABEL BALANSU: `BUILDINGS`, `ENEMIES` i zamrożona konfiguracja.
 *
 * ## Po co, skoro konfiguracja jest już zamrożona
 *
 * Bo zamrozić da się tylko ją. `BUILDINGS` i `ENEMIES` są importowane wprost w ośmiu
 * modułach symulacji, bez szwu do wstrzyknięcia, a `defs.ts` mówi wprost: „wszystkie liczby
 * poniżej wyznaczy headless runner w Fazie 3". Trajektoria **zostaje więc sprzężona
 * z tabelami balansu** i nic tego dziś nie rozetnie (rozcięcie to decyzja architektoniczna
 * Fazy 3, nie poprawka przy okazji).
 *
 * Skoro sprzężenia nie da się usunąć, ma być **WIDOCZNE**: obie liczby są przypięte obok
 * siebie, a która oblała, mówi CO się stało.
 *
 * | co oblało | co to znaczy |
 * |---|---|
 * | odcisk balansu | ktoś zmienił `BUILDINGS`/`ENEMIES` — **oczekiwane w Fazie 3**; przepnij OBIE liczby w jednym commicie i napisz w nim, że zmiana balansu jest zamierzona |
 * | sama trajektoria, przy nietkniętym odcisku | **REGRESJA SILNIKA**: przebieg się zmienił, choć żadna liczba balansu nie drgnęła. Nie przepinaj — szukaj przyczyny |
 *
 * Odcisk liczy się z `JSON.stringify`, więc zależy też od KOLEJNOŚCI pól w `defs.ts`.
 * Przestawienie pól bez zmiany wartości zgłosi „balans się zmienił" — kierunek zachowawczy
 * (każe spojrzeć), nie przeoczenie.
 */
const GOLDEN_BALANCE_SHA256 = '1f9b4bbb941c2f5d4c4b11dbd2145969efb3a1a9f9d6ff1948fee2b2088e9998';

function balanceFingerprint(): string {
  return createHash('sha256')
    .update(JSON.stringify([BUILDINGS, ENEMIES, GOLDEN_RUN_CONFIG]))
    .digest('hex');
}

/**
 * Skrypt budowy — stały, nie losowy, i dobrany tak, żeby przebieg **dotykał wszystkich
 * systemów**: ekonomii (EXTRACTOR), sieci (PYLON), walki (wieże) i kaskady (cztery lasery
 * przy produkcji 10/s wymuszają brownout, gdy magazyn siądzie).
 */
const GOLDEN_RUN_SCRIPT: readonly (readonly [number, BuildingType])[] = [
  [0, 'BARRICADE'],
  [1, 'PYLON'],
  [2, 'KINETIC_TURRET'],
  [3, 'LASER_TURRET'],
  [4, 'LASER_TURRET'],
  [5, 'LASER_TURRET'],
  [6, 'LASER_TURRET'],
];

/**
 * Hasz stanu z **KAŻDEGO** ticku, zwinięty w jeden ciąg.
 *
 * Pierwsza wersja próbkowała co 100 ticków i **przepuszczała różnice jednotickowe**.
 * Zmierzone: przestawienie `removeDeadUnits` przed `turretsAttackUnits` zostawia zabite
 * jednostki w `s.units` przez JEDEN tick i o tyle samo opóźnia `killsByTurret` — czyli
 * zmienia stan tylko w ticku zabójstwa. Przy dwunastu próbkach na 1200 ticków i 67
 * zabójstwach szansa, że którekolwiek trafi w próbkę, to około pół. **Mutacja przeszła
 * 4/4**, a strażnik wyglądał na działający, bo łapał wcześniejszą mutację arytmetyczną
 * (mnożnik obrażeń), której skutek KUMULUJE się przez cały przebieg.
 *
 * Różnica między tymi dwiema mutacjami jest tu sednem: **próbkowanie łapie tylko to, co
 * trwa dłużej niż odstęp między próbkami.** Każdy tick kosztuje 1200 wywołań `stateHash`
 * zamiast dwunastu — ułamek sekundy, i to jest cała cena za zdjęcie tego założenia.
 */
function goldenRunHashes(): string[] {
  const planet = createPlanet({ seed: GOLDEN_SEED });
  const sim = new Sim(planet, GOLDEN_RUN_CONFIG);
  const free = planet.cells[planet.startCell].neighbors.filter(
    (c) => planet.cells[c].cellType === 'HEXAGON',
  );
  for (const [slot, type] of GOLDEN_RUN_SCRIPT) {
    const cellId = free[slot % free.length];
    if (BUILDINGS[type].allowedCells === 'HEXAGON') {
      sim.enqueue({ kind: 'BUILD', cellId, type });
    }
  }
  const hashes: string[] = [];
  for (let t = 0; t < GOLDEN_RUN_TICKS; t++) {
    sim.step();
    hashes.push(stateHash(sim.state));
  }
  return hashes;
}

describe('złoty hasz TRAJEKTORII', () => {
  it('scenariusz 1200 ticków haszuje się do przypiętej wartości', () => {
    const digest = createHash('sha256').update(goldenRunHashes().join('|')).digest('hex');
    // eslint-disable-next-line no-console
    console.log(`[ZŁOTY PRZEBIEG] trajektoria=${digest} balans=${balanceFingerprint()}`);
    // KOLEJNOŚĆ MA ZNACZENIE: odcisk balansu PRZED trajektorią. Gdy zmieniono liczby,
    // pierwsza asercja oblewa i od razu nazywa powód; gdyby stała druga, komunikat mówiłby
    // „przebieg się rozjechał" i wyglądał jak regresja silnika.
    expect(balanceFingerprint(), 'odcisk tabel balansu (BUILDINGS/ENEMIES/konfiguracja)').toBe(
      GOLDEN_BALANCE_SHA256,
    );
    expect(digest, 'hasz trajektorii przy NIEZMIENIONYM balansie').toBe(GOLDEN_RUN_SHA256);
  });

  /**
   * Kontrola na fiksturę: przebieg musi być BOGATY. Ciąg identycznych haszów znaczyłby,
   * że nic się nie dzieje, a test przypinałby stan spoczynku — przechodziłby wtedy także
   * po wyłączeniu połowy systemów.
   */
  /**
   * Kontrola na fiksturę: przebieg musi być BOGATY. Ciąg identycznych haszów znaczyłby,
   * że nic się nie dzieje, a test przypinałby stan spoczynku.
   *
   * Sprawdzana jest też WALKA, a nie sama ekonomia: hasz zmienia się co tick choćby od
   * narastającej rudy, więc „wszystkie hasze różne" przeszłoby także na pustej planecie.
   * Zmierzone w tym scenariuszu: 84 zrodzone jednostki, szczyt 29 żywych naraz,
   * **67 ubitych przez wieże**.
   */
  it('przebieg naprawdę się zmienia — i naprawdę jest w nim walka', () => {
    const hashes = goldenRunHashes();
    expect(hashes).toHaveLength(GOLDEN_RUN_TICKS);
    expect(new Set(hashes).size).toBe(hashes.length);

    const planet = createPlanet({ seed: GOLDEN_SEED });
    const sim = new Sim(planet, GOLDEN_RUN_CONFIG);
    const free = planet.cells[planet.startCell].neighbors.filter(
      (c) => planet.cells[c].cellType === 'HEXAGON',
    );
    for (const [slot, type] of GOLDEN_RUN_SCRIPT) {
      sim.enqueue({ kind: 'BUILD', cellId: free[slot % free.length], type });
    }
    for (let t = 0; t < GOLDEN_RUN_TICKS; t++) sim.step();
    expect(sim.state.killsByTurret, 'wieże muszą realnie strzelać').toBeGreaterThan(20);
    expect(sim.state.nextUnitId - 1, 'fale muszą realnie spawnować').toBeGreaterThan(50);
  });
});
