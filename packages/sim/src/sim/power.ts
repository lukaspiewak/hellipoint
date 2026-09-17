import { BROWNOUT_ORDER, BUILDINGS, evaluateEnergyOutput } from './defs.js';
import { connectedToCore } from './network.js';
import { TICK_SECONDS, type BuildingType, type SimState } from './state.js';

/** Budynek ma prąd (albo komórki nie ma / jest pusta). */
export const OUTAGE_NONE = 0;
/**
 * Budynek ZGASZONY KASKADĄ: jest w sieci, ale zabrakło mocy (`BROWNOUT_ORDER`).
 * Reakcja gracza: dobuduj produkcję albo rozbierz odbiornik.
 */
export const OUTAGE_SHED = 1;
/**
 * Budynek ODCIĘTY OD SIECI: nie ma drogi do CORE (`connectedToCore`).
 * Reakcja gracza: napraw pylon. To jest Q4 — DISRUPTOR zjadł siedem pylonów między
 * cyklem 2 a 3, odłączając capy.
 */
export const OUTAGE_UNLINKED = 2;

export interface PowerReport {
  supply: number;
  /**
   * Popyt PO kaskadzie gaszenia, nie surowe zapotrzebowanie sprzed niej: akumulowany
   * dla wszystkich podłączonych odbiorców, a potem pomniejszany w miejscu przy każdym
   * zgaszeniu. UI pokazujący „potrzebowano X/s, było Y/s" chce `rawDemand` — to pole
   * jest drugą połową tej pary i mówi, ile sieć NAPRAWDĘ pobrała po gaszeniu.
   */
  demand: number;
  /**
   * Popyt PRZED kaskadą — suma poborów wszystkich PODŁĄCZONYCH odbiorców, niezależnie od
   * tego, czy przeżyły ten tick.
   *
   * To jest liczba, o którą prosił doc-comment przy `demand` od Fazy 1B i której nie było:
   * bez niej „brakuje 38/s" nie da się napisać, bo po kaskadzie popyt jest już równy podaży
   * (kaskada gasi DOPÓKI nie jest) i deficyt z ekranu znika dokładnie w chwili, w której
   * zaczyna boleć.
   *
   * Liczony dla odbiorców PODŁĄCZONYCH, nie dla wszystkich: budynek poza siecią nie żąda
   * od niej niczego (patrz `OUTAGE_UNLINKED`), więc doliczenie go kazałoby graczowi
   * dobudowywać produkcję na pobór, którego dobudowanie produkcji nie zaspokoi.
   */
  rawDemand: number;
  /** Typy, które faktycznie zgaszono w tym ticku, w kolejności gaszenia. */
  shedTypes: BuildingType[];
  /**
   * DLACZEGO budynek nie ma prądu, per komórka: `OUTAGE_NONE` / `OUTAGE_SHED` /
   * `OUTAGE_UNLINKED`.
   *
   * Istnieje, bo `powered === false` zlewa DWIE różne przyczyny wymagające DWÓCH różnych
   * reakcji gracza („dobuduj produkcję" kontra „napraw pylon"), a render nie ma jak ich
   * rozróżnić: `connectedToCore` to przeszukiwanie całej planety, więc liczone w pętli
   * renderu byłoby tą samą pracą sześćdziesiąt razy na sekundę zamiast dwadzieścia.
   *
   * **Bufor należy do WOŁAJĄCEGO i jest ważny do następnego wywołania.** `Sim` podaje
   * swój, żeby tick nie alokował 1442 bajtów; wołający, który nie poda żadnego, dostaje
   * świeży (tak robią testy). Czyszczony na wejściu w całości — inaczej byłby sumą
   * historii awarii, a nie zdjęciem tego ticku.
   */
  outage: Uint8Array;
}

/**
 * @param outageOut bufor na przyczyny braku prądu (patrz `PowerReport.outage`). Pominięty —
 *   alokowany świeży. **Musi mieć długość `s.buildings.length`**: `Uint8Array` IGNORUJE
 *   zapis poza końcem, więc krótszy bufor po prostu gubiłby awarie ostatnich komórek,
 *   bez jednego śladu — ta sama klasa cichej awarii, co `light` o złej długości niżej.
 */
export function updatePower(s: SimState, light: Float32Array, outageOut?: Uint8Array): PowerReport {
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
  if (outageOut !== undefined && outageOut.length !== s.buildings.length) {
    throw new RangeError(
      `updatePower: outage.length (${outageOut.length}) must equal s.buildings.length (${s.buildings.length})`,
    );
  }
  const outage = outageOut ?? new Uint8Array(s.buildings.length);
  // Zdjęcie TEGO ticku, nie suma historii: bufor jest współdzielony między tickami, więc bez
  // czyszczenia awaria zostawałaby na ekranie po naprawie — czyli dokładnie wtedy, gdy gracz
  // sprawdza, czy jego reakcja zadziałała.
  outage.fill(OUTAGE_NONE);
  const connected = connectedToCore(s);

  let supply = 0;
  let capacity = 0;
  const consumers: number[] = [];

  for (let i = 0; i < s.buildings.length; i++) {
    const b = s.buildings[i];
    if (b === null) continue;

    if (!connected[i]) {
      b.powered = false;
      outage[i] = OUTAGE_UNLINKED;
      continue;
    }

    const def = BUILDINGS[b.type];
    supply += evaluateEnergyOutput(def.energyOutput, light[i]);
    capacity += def.energyStorage;
    if (def.energyDrain > 0) consumers.push(i);
    b.powered = true;
  }

  // Popyt liczony RAZ, a potem rozwidlony na dwie wartości: `rawDemand` zostaje taki, jaki
  // był SPRZED kaskady, `demand` jest pomniejszany w miejscu przy każdym zgaszeniu. Zapis
  // `const rawDemand = demand` PO kaskadzie dałby dwie równe liczby — i to jest mutacja,
  // którą łapie test 1 (`demand < rawDemand`).
  let rawDemand = 0;
  for (const i of consumers) rawDemand += BUILDINGS[s.buildings[i]!.type].energyDrain;
  let demand = rawDemand;

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
        outage[i] = OUTAGE_SHED;
        demand -= BUILDINGS[type].energyDrain;
        if (!shedTypes.includes(type)) shedTypes.push(type);
        if (demand <= available) break;
      }
    }
  }

  const net = (supply - demand) * TICK_SECONDS;
  s.storedEnergy = Math.max(0, Math.min(capacity, s.storedEnergy + net));

  return { supply, demand, rawDemand, shedTypes, outage };
}
