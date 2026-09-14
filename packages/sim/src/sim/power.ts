import { BROWNOUT_ORDER, BUILDINGS, evaluateEnergyOutput } from './defs.js';
import { connectedToCore } from './network.js';
import { TICK_SECONDS, type BuildingType, type SimState } from './state.js';

export interface PowerReport {
  supply: number;
  demand: number;
  /** Typy, które faktycznie zgaszono w tym ticku, w kolejności gaszenia. */
  shedTypes: BuildingType[];
}

export function updatePower(s: SimState, light: Float32Array): PowerReport {
  const connected = connectedToCore(s);

  let supply = 0;
  let capacity = 0;
  const consumers: number[] = [];

  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b === null) continue;

    if (!connected[i]) {
      b.powered = false;
      continue;
    }

    const def = BUILDINGS[b.type];
    supply += evaluateEnergyOutput(def.energyOutput, light[i]);
    capacity += def.energyStorage;
    if (def.energyDrain > 0) consumers.push(i);
    b.powered = true;
  }

  let demand = 0;
  for (const i of consumers) demand += BUILDINGS[s.buildings[i]!.type].energyDrain;

  // Magazyn pokrywa niedobór, dopóki starcza. Dopiero potem gaszenie.
  const shedTypes: BuildingType[] = [];
  const available = supply + s.storedEnergy / TICK_SECONDS;

  if (demand > available) {
    for (const type of BROWNOUT_ORDER) {
      if (demand <= available) break;
      for (const i of consumers) {
        const b = s.buildings[i]!;
        if (b.type !== type || !b.powered) continue;
        b.powered = false;
        demand -= BUILDINGS[type].energyDrain;
        if (!shedTypes.includes(type)) shedTypes.push(type);
        if (demand <= available) break;
      }
    }
  }

  const net = (supply - demand) * TICK_SECONDS;
  s.storedEnergy = Math.max(0, Math.min(capacity, s.storedEnergy + net));

  return { supply, demand, shedTypes };
}
