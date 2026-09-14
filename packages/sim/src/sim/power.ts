import { BROWNOUT_ORDER, BUILDINGS, evaluateEnergyOutput } from './defs.js';
import { connectedToCore } from './network.js';
import { TICK_SECONDS, type BuildingType, type SimState } from './state.js';

export interface PowerReport {
  supply: number;
  /**
   * Popyt PO kaskadzie gaszenia, nie surowe zapotrzebowanie sprzed niej: akumulowany
   * dla wszystkich podłączonych odbiorców, a potem pomniejszany w miejscu przy każdym
   * zgaszeniu. UI pokazujący „potrzebowano X/s, było Y/s" chce wartości SPRZED kaskady —
   * to pole jej nie niesie.
   */
  demand: number;
  /** Typy, które faktycznie zgaszono w tym ticku, w kolejności gaszenia. */
  shedTypes: BuildingType[];
}

export function updatePower(s: SimState, light: Float32Array): PowerReport {
  // Bez tej straży `light[i]` poza końcem tablicy daje `undefined`, `peakRate * undefined`
  // daje `NaN`, a `Math.max(0, Math.min(capacity, NaN))` to NaN — jedno takie wywołanie
  // zatruwa `storedEnergy` NA ZAWSZE (Math.min/Math.max propagują NaN), więc żaden
  // KOLEJNY poprawny tick tego już nie wyleczy. Serializuje się potem jako `null`, a
  // `null` w arytmetyce to `0` — czyli cichy, trwały spadek do zera bez śladu błędu.
  if (light.length !== s.buildings.length) {
    throw new RangeError(
      `updatePower: light.length (${light.length}) must equal s.buildings.length (${s.buildings.length})`,
    );
  }
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
