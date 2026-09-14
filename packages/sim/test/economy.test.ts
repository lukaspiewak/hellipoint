import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { ORE_PER_SECOND, updateEconomy } from '../src/sim/economy.js';

const planet = createPlanet({ seed: 31 });
const oreCell = planet.cells.find((c) => c.oreCapacity > 0)!.id;

function withExtractor(powered: boolean) {
  const s = createState(planet, 0);
  s.buildings[oreCell] = { cellId: oreCell, type: 'EXTRACTOR', hp: 120, powered };
  return s;
}

describe('updateEconomy', () => {
  it('zasilany ekstraktor wydobywa rudę', () => {
    const s = withExtractor(true);
    updateEconomy(s);
    expect(s.ore).toBeCloseTo(ORE_PER_SECOND * TICK_SECONDS, 9);
  });

  it('niezasilany ekstraktor nie wydobywa nic', () => {
    const s = withExtractor(false);
    updateEconomy(s);
    expect(s.ore).toBe(0);
  });

  it('wydobycie uszczupla złoże', () => {
    const s = withExtractor(true);
    const before = s.oreRemaining[oreCell];
    updateEconomy(s);
    expect(s.oreRemaining[oreCell]).toBeCloseTo(before - ORE_PER_SECOND * TICK_SECONDS, 9);
  });

  it('wyczerpane złoże przestaje dawać rudę — to jest silnik presji (§5.2)', () => {
    const s = withExtractor(true);
    s.oreRemaining[oreCell] = 0;
    updateEconomy(s);
    expect(s.ore).toBe(0);
  });

  it('ostatni tick wydobycia nie przekracza tego, co zostało w złożu', () => {
    const s = withExtractor(true);
    const crumb = ORE_PER_SECOND * TICK_SECONDS * 0.3;
    s.oreRemaining[oreCell] = crumb;
    updateEconomy(s);
    expect(s.ore).toBeCloseTo(crumb, 9);
    expect(s.oreRemaining[oreCell]).toBe(0);
  });

  it('złoże ma skończoną pojemność — po dostatecznie długim czasie się kończy', () => {
    const s = withExtractor(true);
    const capacity = s.oreRemaining[oreCell];
    const ticks = Math.ceil(capacity / (ORE_PER_SECOND * TICK_SECONDS)) + 10;
    for (let i = 0; i < ticks; i++) updateEconomy(s);
    expect(s.oreRemaining[oreCell]).toBe(0);
    expect(s.ore).toBeCloseTo(capacity, 6);
  });

  it('typ gmachu — tylko EXTRACTOR wydobywa, inne typy mają wstęp zamknięty', () => {
    const s = createState(planet, 0);

    // Trzy żyzne komórki — różne składy.
    const fertileCells = planet.cells.filter((c) => c.oreCapacity > 0).slice(0, 3);
    const extractorCell = fertileCells[0].id;
    const pylonCell = fertileCells[1].id;
    const extractor2Cell = fertileCells[2].id;

    // Zmienne początkowe.
    const extractorCapacity = s.oreRemaining[extractorCell];
    const pylonCapacity = s.oreRemaining[pylonCell];
    const extractor2Capacity = s.oreRemaining[extractor2Cell];

    // EXTRACTOR na pierwszej, PYLON na drugiej (typem chroniony), drugi EXTRACTOR na trzeciej.
    s.buildings[extractorCell] = { cellId: extractorCell, type: 'EXTRACTOR', hp: 120, powered: true };
    s.buildings[pylonCell] = { cellId: pylonCell, type: 'PYLON', hp: 80, powered: true };
    s.buildings[extractor2Cell] = { cellId: extractor2Cell, type: 'EXTRACTOR', hp: 120, powered: true };

    const perTick = ORE_PER_SECOND * TICK_SECONDS;
    updateEconomy(s);

    // Oba ekstraktory wydobyły po perTick.
    expect(s.ore).toBeCloseTo(perTick * 2, 9);

    // Każdy EXTRACTOR uszczuplił swoje złoże.
    expect(s.oreRemaining[extractorCell]).toBeCloseTo(extractorCapacity - perTick, 9);
    expect(s.oreRemaining[extractor2Cell]).toBeCloseTo(extractor2Capacity - perTick, 9);

    // PYLON na typem zablokowany — jego złoże nietknięte.
    expect(s.oreRemaining[pylonCell]).toBe(pylonCapacity);
  });
});
