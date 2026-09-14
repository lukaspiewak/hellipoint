import { describe, expect, it } from 'vitest';
import { BROWNOUT_ORDER, BUILDINGS, ENEMIES, evaluateEnergyOutput } from '../src/sim/defs.js';

describe('evaluateEnergyOutput', () => {
  it('NONE nie produkuje nic', () => {
    expect(evaluateEnergyOutput({ kind: 'NONE' }, 1)).toBe(0);
  });

  it('CONSTANT ignoruje oświetlenie', () => {
    expect(evaluateEnergyOutput({ kind: 'CONSTANT', rate: 25 }, 0)).toBe(25);
    expect(evaluateEnergyOutput({ kind: 'CONSTANT', rate: 25 }, 1)).toBe(25);
  });

  it('SOLAR jest CIĄGŁY, nie binarny (§5.1)', () => {
    const out = { kind: 'SOLAR', peakRate: 40 } as const;
    expect(evaluateEnergyOutput(out, 1)).toBe(40);
    expect(evaluateEnergyOutput(out, 0.5)).toBe(20);
    expect(evaluateEnergyOutput(out, 0)).toBe(0);
  });
});

describe('BUILDINGS', () => {
  it('zawiera wszystkie 10 typów ze specu, w tym nowy BARRICADE', () => {
    expect(Object.keys(BUILDINGS).sort()).toEqual([
      'BARRICADE', 'BATTERY', 'CORE', 'EVACUATION_MODULE', 'EXTRACTOR',
      'GEOTHERMAL_CAP', 'KINETIC_TURRET', 'LASER_TURRET', 'PYLON', 'SOLAR_PANEL',
    ]);
  });

  it('BARRICADE jest czysto-HP: nie pobiera energii i jej nie produkuje', () => {
    expect(BUILDINGS.BARRICADE.energyDrain).toBe(0);
    expect(BUILDINGS.BARRICADE.energyOutput.kind).toBe('NONE');
  });

  it('GEOTHERMAL_CAP wolno stawiać wyłącznie na pentagonie', () => {
    expect(BUILDINGS.GEOTHERMAL_CAP.allowedCells).toBe('PENTAGON');
  });

  it('EXTRACTOR wolno stawiać wyłącznie na złożu', () => {
    expect(BUILDINGS.EXTRACTOR.allowedCells).toBe('ORE_HEXAGON');
  });

  it('wszystkie zasięgi są małymi liczbami — to kroki grafu, nie metry (N1)', () => {
    for (const def of Object.values(BUILDINGS)) {
      expect(def.range).toBeLessThanOrEqual(6);
      expect(def.connectionRadius).toBeLessThanOrEqual(6);
    }
  });

  it('energyInfrastructure przypisania są poprawne', () => {
    const infrastructure = (Object.entries(BUILDINGS)
      .filter(([_, def]) => def.energyInfrastructure)
      .map(([type]) => type)
      .sort());
    expect(infrastructure).toEqual([
      'BATTERY', 'CORE', 'EVACUATION_MODULE', 'GEOTHERMAL_CAP', 'PYLON', 'SOLAR_PANEL',
    ]);
  });

  it('spójność zakresu i celowania: range > 0 => targeting !== NONE', () => {
    for (const def of Object.values(BUILDINGS)) {
      if (def.range > 0) {
        expect(def.targeting).not.toBe('NONE');
      }
    }
  });

  it('spójność uszkodzenia i zakresu: dps > 0 => range > 0', () => {
    for (const def of Object.values(BUILDINGS)) {
      if (def.dps > 0) {
        expect(def.range).toBeGreaterThan(0);
      }
    }
  });
});

describe('BROWNOUT_ORDER', () => {
  it('gasi ekstraktory PRZED obroną — draft miał to odwrotnie (§5.1)', () => {
    expect(BROWNOUT_ORDER).toEqual(['EXTRACTOR', 'KINETIC_TURRET', 'LASER_TURRET']);
  });

  it('nie zawiera PYLON ani BARRICADE', () => {
    expect(BROWNOUT_ORDER).not.toContain('PYLON');
    expect(BROWNOUT_ORDER).not.toContain('BARRICADE');
  });

  it('każdy wpis odpowiada budynkowi, który faktycznie pobiera energię', () => {
    for (const t of BROWNOUT_ORDER) expect(BUILDINGS[t].energyDrain).toBeGreaterThan(0);
  });
});

describe('ENEMIES', () => {
  it('prędkości są krotnością prędkości terminatora, nie wartościami bezwzględnymi (§6.2)', () => {
    for (const def of Object.values(ENEMIES)) {
      expect(def.speedFactor).toBeGreaterThan(0);
      expect(def.speedFactor).toBeLessThan(10);
    }
  });

  it('ARMOR jest WOLNIEJSZY od terminatora — nigdy nie ucieka ze światła (§4.4)', () => {
    expect(ENEMIES.ARMOR.speedFactor).toBeLessThan(1);
  });

  it('SWARM i DISRUPTOR są szybsze od terminatora', () => {
    expect(ENEMIES.SWARM.speedFactor).toBeGreaterThan(1);
    expect(ENEMIES.DISRUPTOR.speedFactor).toBeGreaterThan(1);
  });

  it('każdy typ ma inny priorytet celu', () => {
    const priorities = Object.values(ENEMIES).map((e) => e.targetPriority);
    expect(new Set(priorities).size).toBe(3);
  });

  it('targetPriority przypisania są poprawne', () => {
    expect(ENEMIES.SWARM.targetPriority).toBe('NEAREST_BUILDING');
    expect(ENEMIES.ARMOR.targetPriority).toBe('CORE');
    expect(ENEMIES.DISRUPTOR.targetPriority).toBe('ENERGY_INFRASTRUCTURE');
  });
});
