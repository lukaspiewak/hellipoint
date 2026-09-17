import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { BUILDINGS } from '../src/sim/defs.js';
import { OUTAGE_NONE, OUTAGE_SHED, OUTAGE_UNLINKED, updatePower } from '../src/sim/power.js';
import { Sim } from '../src/sim/loop.js';
import { DEFAULT_RUN } from '../src/sim/rules.js';
import { multiSourceDistances } from '../src/world/graph.js';
import { fourFreeHexagonsNear } from './support/fixtures.js';

const planet = createPlanet({ seed: 8 });
const neighbors = planet.cells.map((c) => c.neighbors);
const dist = multiSourceDistances(neighbors, [planet.startCell]);

function nearbyHexes(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < dist.length && out.length < count; i++) {
    if (dist[i] >= 1 && dist[i] <= 2 && planet.cells[i].cellType === 'HEXAGON' && planet.cells[i].oreCapacity === 0) {
      out.push(i);
    }
  }
  if (out.length < count) throw new Error('za mało pustych heksów blisko startu');
  return out;
}

/**
 * Jak `nearbyHexes`, ale zwraca heksy ZE złożem (`oreCapacity > 0`) — jedyne, na których
 * `canBuild` wpuszcza EXTRACTOR (`allowedCells: 'ORE_HEXAGON'` wymaga `oreRemaining > 0`,
 * a świeży stan ma `oreRemaining === oreCapacity`). `nearbyHexes` celowo filtruje odwrotnie
 * (`oreCapacity === 0`), więc nie nadaje się do stawiania ekstraktora.
 */
function nearbyOreHexes(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < dist.length && out.length < count; i++) {
    if (dist[i] >= 1 && dist[i] <= 2 && planet.cells[i].cellType === 'HEXAGON' && planet.cells[i].oreCapacity > 0) {
      out.push(i);
    }
  }
  if (out.length < count) throw new Error('za mało heksów ze złożem blisko startu');
  return out;
}

/**
 * Heksy (dowolny status rudy) w promieniu do 3 kroków od startu — zasięg connectionRadius
 * samego CORE, więc każdy zwrócony heks jest połączony wprost, bez łańcucha PYLON-ów
 * pośredniczących. Szerszy zasięg niż `nearbyHexes`/`nearbyOreHexes` (1-2 kroki), bo do
 * przebicia podaży samego CORE trzeba więcej komórek, niż mieści pierścień o promieniu 2.
 */
function nearbyHexesForPylons(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < dist.length && out.length < count; i++) {
    if (dist[i] >= 1 && dist[i] <= 3 && planet.cells[i].cellType === 'HEXAGON') {
      out.push(i);
    }
  }
  if (out.length < count) throw new Error('za mało heksów w zasięgu CORE na tyle PYLON-ów');
  return out;
}

/**
 * CORE ma `playerBuildable: false` (Important #1, przegląd końcowy Fazy 1B), więc
 * `applyCommand` go już nie postawi. Prawie każdy test w tym pliku potrzebuje go jako
 * scaffolding (`updatePower` liczy się OD CORE przez `connectedToCore`) — stawiamy go
 * tak samo, jak zrobi to `Sim` w Fazie 1C: bezpośrednim zapisem do stanu.
 */
function base() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

const fullLight = new Float32Array(planet.cells.length).fill(1);
const noLight = new Float32Array(planet.cells.length).fill(0);

describe('updatePower', () => {
  // Regresja na Important #2 z przeglądu końcowego Fazy 1B: bez tej straży `light[i]`
  // poza końcem tablicy dawało `undefined`, a `peakRate * undefined` NaN, który przez
  // Math.max/Math.min zatruwał `storedEnergy` NA ZAWSZE — żaden kolejny poprawny tick
  // tego nie leczył, a serializacja zamieniała NaN w null, czyli w arytmetyce w 0.
  it('rzuca RangeError, gdy `light.length` różni się od `s.buildings.length`, nazywając obie długości', () => {
    const s = base();
    const tooShort = new Float32Array(planet.cells.length - 1);
    expect(() => updatePower(s, tooShort)).toThrow(RangeError);
    expect(() => updatePower(s, tooShort)).toThrow(new RegExp(String(tooShort.length)));
    expect(() => updatePower(s, tooShort)).toThrow(new RegExp(String(s.buildings.length)));

    const tooLong = new Float32Array(planet.cells.length + 1);
    expect(() => updatePower(s, tooLong)).toThrow(RangeError);
  });

  it('CORE sam produkuje 10/s i zasila się sam', () => {
    const s = base();
    const r = updatePower(s, noLight);
    expect(r.supply).toBeCloseTo(10, 9);
    expect(r.demand).toBeCloseTo(0, 9);
    expect(s.buildings[planet.startCell]!.powered).toBe(true);
  });

  it('SOLAR produkuje proporcjonalnie do oświetlenia, nie skokowo', () => {
    const s = base();
    const [cell] = nearbyHexes(1);
    applyCommand(s, { kind: 'BUILD', cellId: cell, type: 'SOLAR_PANEL' });

    const half = new Float32Array(planet.cells.length).fill(0);
    half[cell] = 0.5;
    expect(updatePower(s, half).supply).toBeCloseTo(10 + 20, 6);
    expect(updatePower(s, noLight).supply).toBeCloseTo(10, 6);
  });

  it('niepodłączony budynek nie produkuje i nie pobiera', () => {
    const s = base();
    // Dwa różne odcięte heksy: jeden pod producenta, drugi pod odbiorcę — sama
    // SOLAR_PANEL (drain 0) dowodzi tylko połowy kontraktu (odcięty producent nie
    // dolicza się do podaży); KINETIC_TURRET (drain 3) dowodzi drugiej połowy
    // (odcięty odbiorca nie dolicza się do popytu ani nie zostaje zasilony).
    const [orphanProducer, orphanConsumer] = planet.cells
      .filter((c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && dist[c.id] > 8)
      .map((c) => c.id);
    applyCommand(s, { kind: 'BUILD', cellId: orphanProducer, type: 'SOLAR_PANEL' });
    applyCommand(s, { kind: 'BUILD', cellId: orphanConsumer, type: 'KINETIC_TURRET' });

    const r = updatePower(s, fullLight);
    expect(r.supply).toBeCloseTo(10, 6);
    expect(r.demand).toBeCloseTo(0, 6);
    expect(s.buildings[orphanProducer]!.powered).toBe(false);
    expect(s.buildings[orphanConsumer]!.powered).toBe(false);
  });

  it('nadwyżka ładuje magazyn, ale nie ponad pojemność', () => {
    const s = base();
    const coreStorage = 200;
    // Tuż pod pojemnością: CORE bez odbiorców daje +0,5/s nadwyżki (10 · 0,05), więc
    // jeden tick bez obcięcia wylądowałby na 200,15 — WYRAŹNIE ponad pojemność, nie
    // tylko "gdzieś niżej niż nigdy nieosiągnięty sufit" (100 ticków od zera dawało
    // 50 — dziesięciokrotnie za mało, by w ogóle dotknąć sufitu).
    s.storedEnergy = coreStorage - 0.15;
    updatePower(s, noLight);
    expect(s.storedEnergy).toBe(coreStorage);

    // Dalsza nadwyżka nie podnosi go wyżej — pozostaje przypięty do sufitu, nie tylko
    // go dotknął przypadkiem w jednym ticku.
    updatePower(s, noLight);
    expect(s.storedEnergy).toBe(coreStorage);
  });

  it('przy niedoborze gasi EKSTRAKTORY przed obroną (§5.1)', () => {
    const s = base();
    const [a] = nearbyOreHexes(1);
    const [b, c, d] = nearbyHexes(3);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'KINETIC_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'LASER_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: d, type: 'SOLAR_PANEL' });
    s.storedEnergy = 0;

    // Podaż: CORE 10 + panel 40·0,1 = 14/s. Popyt: 5+3+12 = 20/s.
    // Zgaszenie ekstraktora daje 15 (wciąż za mało), plus kinetyka daje 12 ≤ 14 — laser przeżywa.
    const dimLight = new Float32Array(planet.cells.length).fill(0);
    dimLight[d] = 0.1;

    const r = updatePower(s, dimLight);
    expect(r.shedTypes).toContain('EXTRACTOR');
    expect(r.shedTypes).toContain('KINETIC_TURRET');
    expect(s.buildings[c]!.powered).toBe(true); // obrona laserowa gaśnie ostatnia
  });

  it('gasi lasery dopiero jako ostatnie', () => {
    const s = base();
    const [a] = nearbyOreHexes(1);
    const [b, c] = nearbyHexes(2);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'KINETIC_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'LASER_TURRET' });
    s.storedEnergy = 0;

    // Odetnij całą produkcję poza CORE i zobacz, co gaśnie.
    const r = updatePower(s, noLight);
    const order = ['EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET'];
    for (let i = 1; i < r.shedTypes.length; i++) {
      expect(order.indexOf(r.shedTypes[i])).toBeGreaterThan(order.indexOf(r.shedTypes[i - 1]));
    }
  });

  it('magazyn pokrywa chwilowy niedobór zamiast natychmiast gasić', () => {
    const s = base();
    const [a, b, c] = nearbyOreHexes(3);
    applyCommand(s, { kind: 'BUILD', cellId: a, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: b, type: 'EXTRACTOR' });
    applyCommand(s, { kind: 'BUILD', cellId: c, type: 'EXTRACTOR' });
    s.storedEnergy = 100;

    // Popyt 15/s przy podaży 10/s — realny niedobór, ale magazyn go pokrywa.
    const before = s.storedEnergy;
    const r = updatePower(s, noLight);
    expect(r.shedTypes).toEqual([]);
    expect(s.storedEnergy).toBeLessThan(before);
    expect(s.storedEnergy).toBeCloseTo(before + (10 - 15) * TICK_SECONDS, 6);
  });

  it('PYLON liczy się do popytu, ale nigdy nie jest gaszony — magazyn ląduje na zerze, nie poniżej (§5.1)', () => {
    const s = base();
    // 30 PYLON-ów × 0,5/s = 15/s popytu wyłącznie z infrastruktury sieci, wobec 10/s
    // z samego CORE — trwały niedobór 5/s. PYLON jest poza BROWNOUT_ORDER (rozspójniłby
    // sieć), więc nic tu nigdy nie gaśnie: deficyt może tylko drenować magazyn.
    const pylonCells = nearbyHexesForPylons(30);
    for (const cellId of pylonCells) {
      applyCommand(s, { kind: 'BUILD', cellId, type: 'PYLON' });
    }
    s.storedEnergy = 0;

    const r = updatePower(s, noLight);
    expect(r.demand).toBeCloseTo(15, 9); // popyt PYLON-ów NAPRAWDĘ policzony, nie pominięty
    expect(r.shedTypes).toEqual([]);
    expect(r.shedTypes).not.toContain('PYLON'); // ani teraz, ani przy dalszym drenażu niżej
    expect(s.storedEnergy).toBe(0); // od razu na zerze, nie poniżej

    // Bez obcięcia 50 kolejnych ticków (× -0,25/s netto) zjechałoby wyraźnie na minus.
    for (let i = 0; i < 50; i++) {
      const r2 = updatePower(s, noLight);
      expect(r2.shedTypes).toEqual([]);
    }
    expect(s.storedEnergy).toBe(0);
  });
});

// =========================================================================================
// Faza 2C, Zadanie 4 — BILANS, którego gra nie umiała pokazać
//
// `demand` jest liczone PO kaskadzie gaszenia (doc-comment przy polu mówił to wprost od
// Fazy 1B), więc UI pokazujący „potrzebowano X/s, było Y/s" nie miał skąd wziąć X. Q3:
// cztery lasery to 48/s przy produkcji CORE 10/s — i to jest liczba, po której gracz może
// zobaczyć, że czwarta wieża OSŁABIŁA obronę.
// =========================================================================================

const LASER_DRAIN = BUILDINGS.LASER_TURRET.energyDrain;
const FOUR_LASERS = 4 * LASER_DRAIN;

/** Świeży run z rudą na cztery lasery — dokładnie scenariusz Q3 z Fazy 1C. */
function fourLaserRun(): Sim {
  const sim = new Sim(planet, DEFAULT_RUN);
  const s = sim.state;
  s.ore = 10_000; // [STROJENIE] w teście: skarbiec ponad czterema laserami (4 × 100)
  for (const cellId of fourFreeHexagonsNear(s)) {
    sim.enqueue({ kind: 'BUILD', cellId, type: 'LASER_TURRET' });
  }
  sim.step();
  return sim;
}

describe('rawDemand — zapotrzebowanie SPRZED kaskady', () => {
  it('1. rawDemand niesie zapotrzebowanie PRZED gaszeniem, demand — po nim', () => {
    const sim = fourLaserRun();
    sim.state.storedEnergy = 0; // wyczerpany magazyn: kaskada musi zadziałać
    sim.step();

    const p = sim.lastPower;
    expect(p.rawDemand).toBeGreaterThanOrEqual(FOUR_LASERS);
    expect(p.demand).toBeLessThan(p.rawDemand); // coś zgaszono
    expect(p.shedTypes.length).toBeGreaterThan(0);
  });

  it('2. [PARA] rawDemand RÓWNA SIĘ demand dokładnie wtedy, gdy nic nie zgaszono', () => {
    // Bez tej połowy „rawDemand > demand" spełniałaby też implementacja dokładająca do
    // rawDemand cokolwiek (stałą, podwojenie, popyt niepodłączonych) — a wtedy liczba na
    // ekranie nie byłaby zapotrzebowaniem, tylko ozdobą rosnącą razem z nim.
    const sim = fourLaserRun();
    const s = sim.state;

    // POŁOWA „NIC NIE ZGASZONO": magazyn pokrywa niedobór, więc kaskada nie rusza.
    s.storedEnergy = 10_000;
    sim.step();
    const covered = sim.lastPower;
    expect(covered.shedTypes).toEqual([]);
    expect(covered.rawDemand).toBe(covered.demand);
    // …i jest to DOKŁADNIE suma poborów podłączonych odbiorców, nie „coś większego".
    expect(covered.rawDemand).toBeCloseTo(FOUR_LASERS, 9);

    // POŁOWA „ZGASZONO": ta sama zabudowa, pusty magazyn — rawDemand ANI DRGNIE, a demand spada.
    s.storedEnergy = 0;
    sim.step();
    const shed = sim.lastPower;
    expect(shed.rawDemand).toBeCloseTo(covered.rawDemand, 9);
    expect(shed.demand).toBeLessThan(shed.rawDemand);
  });

  it('3. niedobór z Q3 jest ODCZYTYWALNY z raportu: 48/s żądane przy 10/s produkcji', () => {
    // Łańcuch przyczynowy Q3 w liczbach, nie w prozie: gracz autoryzował cztery lasery,
    // a dostał deficyt 38/s. Test wiąże OBIE strony odejmowania, bo to ich RÓŻNICA jest
    // zdaniem, które HUD ma powiedzieć.
    //
    // Obie liczby są tu WYPROWADZONE z `defs.ts` (`[STROJENIE]`), a obok stoi KOTWICA na
    // wartości, którymi Faza 1C zmierzyła Q3 (10 224 tiki na czterech laserach kontra
    // 13 323 na dwóch). Kotwica jest po to, żeby przestrojenie poboru lasera w Fazie 3
    // oblało tutaj GŁOŚNO — łańcuch przyczynowy Q3 trzeba będzie wtedy zmierzyć na nowo,
    // a nie odziedziczyć po liczbach, których już nie ma.
    const coreOutput = BUILDINGS.CORE.energyOutput;
    const coreRate = coreOutput.kind === 'CONSTANT' ? coreOutput.rate : Number.NaN;
    expect({ coreRate, laser: LASER_DRAIN }).toEqual({ coreRate: 10, laser: 12 }); // kotwica Q3

    const sim = fourLaserRun();
    sim.state.storedEnergy = 0;
    sim.step();
    const p = sim.lastPower;

    expect(p.supply).toBeCloseTo(coreRate, 9);
    expect(p.rawDemand).toBeCloseTo(FOUR_LASERS, 9);
    expect(p.rawDemand - p.supply).toBeCloseTo(FOUR_LASERS - coreRate, 9);
  });
});

describe('outage — DLACZEGO budynek nie ma prądu', () => {
  /**
   * Stan, w którym OBIE przyczyny stoją obok siebie: jeden laser zgaszony kaskadą
   * (podłączony, ale zabrakło mocy) i jeden odcięty od sieci (poza zasięgiem CORE).
   *
   * Zwraca obie komórki, bo cała trudność tego przypadku polega na tym, że po stronie
   * `powered` są NIE DO ODRÓŻNIENIA — i dokładnie to test sprawdza najpierw.
   */
  function twoCauses(): { s: ReturnType<typeof base>; shedCell: number; orphanCell: number } {
    const s = base();
    const [near] = nearbyHexes(1);
    const orphan = planet.cells.find(
      (c) => c.cellType === 'HEXAGON' && c.oreCapacity === 0 && dist[c.id] > 8,
    );
    if (orphan === undefined) throw new Error('fixture: brak odciętego heksagonu');
    applyCommand(s, { kind: 'BUILD', cellId: near, type: 'LASER_TURRET' });
    applyCommand(s, { kind: 'BUILD', cellId: orphan.id, type: 'LASER_TURRET' });
    s.storedEnergy = 0;
    return { s, shedCell: near, orphanCell: orphan.id };
  }

  it('4. dwa budynki bez prądu Z DWÓCH RÓŻNYCH POWODÓW są nie do odróżnienia po `powered`', () => {
    const { s, shedCell, orphanCell } = twoCauses();
    const r = updatePower(s, noLight);

    // To jest dokładnie stan z briefu: „dziś oba mają powered === false i wyglądają identycznie".
    expect(s.buildings[shedCell]!.powered).toBe(false);
    expect(s.buildings[orphanCell]!.powered).toBe(false);

    // …a raport je ROZRÓŻNIA. Mutacja „zrównaj kodowanie obu" (jedna wartość dla obu gałęzi)
    // oblewa tutaj i nigdzie indziej.
    expect(r.outage[shedCell]).toBe(OUTAGE_SHED);
    expect(r.outage[orphanCell]).toBe(OUTAGE_UNLINKED);
    expect(OUTAGE_SHED).not.toBe(OUTAGE_UNLINKED);

    // …a `rawDemand` liczy WYŁĄCZNIE odbiorcę podłączonego — jeden laser, nie dwa. Budynek
    // poza siecią nie żąda od niej niczego, więc doliczenie go kazałoby graczowi dobudowywać
    // produkcję na pobór, którego dobudowanie produkcji nie zaspokoi (naprawiłby go PYLON).
    // Zmierzone: bez tej asercji mutacja „rawDemand liczy też odciętych" przechodziła 18/18.
    expect(r.rawDemand).toBeCloseTo(LASER_DRAIN, 9);
  });

  it('5. budynek zasilony i komórka pusta znaczą to samo: BRAK awarii', () => {
    const { s, shedCell } = twoCauses();
    // CORE zasila się sam — i nie ma być zgłaszany jako awaria.
    const r = updatePower(s, noLight);
    expect(s.buildings[planet.startCell]!.powered).toBe(true);
    expect(r.outage[planet.startCell]).toBe(OUTAGE_NONE);
    // Komórka bez budynku — zero, a nie śmieć po poprzednim ticku.
    const empty = s.buildings.findIndex((b, i) => b === null && i !== shedCell);
    expect(r.outage[empty]).toBe(OUTAGE_NONE);
  });

  it('6. [ŚWIEŻOŚĆ] wpis znika w ticku, w którym prąd wraca — bufor nie jest sumą historii', () => {
    // Bufor jest współdzielony między tickami (patrz `Sim`), więc bez czyszczenia pokazywałby
    // awarię jeszcze długo po tym, jak gracz ją naprawił — i był to jedyny stan, w którym
    // gracz nie ma jak sprawdzić, czy jego reakcja zadziałała.
    const { s, shedCell } = twoCauses();
    const buffer = new Uint8Array(s.buildings.length);
    expect(updatePower(s, noLight, buffer).outage[shedCell]).toBe(OUTAGE_SHED);

    s.storedEnergy = 100_000; // magazyn pokrywa wszystko — nic nie gaśnie
    expect(updatePower(s, noLight, buffer).outage[shedCell]).toBe(OUTAGE_NONE);
    expect(s.buildings[shedCell]!.powered).toBe(true);
  });

  it('7. bufor podany z zewnątrz musi mieć długość tablicy budynków — inaczej RangeError', () => {
    // Ta sama straż i to samo uzasadnienie, co dla `light`: cichy zapis poza końcem
    // `Uint8Array` jest ignorowany, więc awaria ostatnich komórek po prostu nigdy nie
    // dotarłaby na ekran, bez jednego śladu w logach.
    const s = base();
    expect(() => updatePower(s, noLight, new Uint8Array(s.buildings.length - 1))).toThrow(RangeError);
    expect(() => updatePower(s, noLight, new Uint8Array(s.buildings.length + 1))).toThrow(RangeError);
    expect(() => updatePower(s, noLight, new Uint8Array(s.buildings.length))).not.toThrow();
  });
});

describe('Sim.lastPower — raport ticku, POZA stanem', () => {
  it('8. raport jest z OSTATNIEGO ticku i nie leży w SimState', () => {
    const sim = fourLaserRun();
    const s = sim.state;
    s.storedEnergy = 0;
    sim.step();
    const shed = sim.lastPower.shedTypes.length;
    expect(shed).toBeGreaterThan(0);

    // POZA STANEM: żadne pole `SimState` nie niesie raportu, więc migawka Fazy 5 i `stateHash`
    // nie rosną o wielkość, która jest czystą funkcją ticka. Sprawdzane po KLUCZACH stanu,
    // a nie przez „wiem, że nie dodałem" — dopisanie pola byłoby widoczne tutaj.
    expect(Object.keys(s)).not.toContain('lastPower');
    for (const key of Object.keys(s)) {
      expect({ key, jest: (s as unknown as Record<string, unknown>)[key] === sim.lastPower }).toEqual({
        key,
        jest: false,
      });
    }

    // ŚWIEŻOŚĆ: raport idzie za tickiem. Magazyn napełniony ⇒ następny tick nic nie gasi.
    s.storedEnergy = 100_000;
    sim.step();
    expect(sim.lastPower.shedTypes).toEqual([]);
  });

  it('9. przed pierwszym krokiem raport istnieje i jest pusty, zamiast być nullem', () => {
    // Pętla renderu czyta `lastPower` na KAŻDEJ klatce, także pierwszej — przed pierwszym
    // `step()`. `null` byłby tam gałęzią w kodzie rysującym, czyli miejscem, w którym
    // rozruch wygląda inaczej niż gra.
    const sim = new Sim(planet, DEFAULT_RUN);
    const p = sim.lastPower;
    expect(p.supply).toBe(0);
    expect(p.demand).toBe(0);
    expect(p.rawDemand).toBe(0);
    expect(p.shedTypes).toEqual([]);
    expect(p.outage.length).toBe(planet.cells.length);
    expect([...p.outage].every((v) => v === OUTAGE_NONE)).toBe(true);
  });
});
