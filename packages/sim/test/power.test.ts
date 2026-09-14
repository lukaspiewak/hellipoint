import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { BUILDINGS } from '../src/sim/defs.js';
import { updatePower } from '../src/sim/power.js';
import { multiSourceDistances } from '../src/world/graph.js';

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
