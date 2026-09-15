import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { BUILDINGS } from '../src/sim/defs.js';
import { stateHash } from '../src/sim/hash.js';
import { currentCycle, DEFAULT_RUN, evacUnlocked, updateRules } from '../src/sim/rules.js';

const planet = createPlanet({ seed: 91 });
const cfg = DEFAULT_RUN;

function withCore() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

/** Zasilony Evac na sąsiedniej komórce — wspólny punkt wyjścia dla testów ładowania. */
function withPoweredEvac(powered = true) {
  const s = withCore();
  const cell = planet.cells[planet.startCell].neighbors[0];
  s.buildings[cell] = {
    cellId: cell, type: 'EVACUATION_MODULE', hp: BUILDINGS.EVACUATION_MODULE.hp, powered,
  };
  return { s, cell };
}

describe('currentCycle', () => {
  it('zaczyna od cyklu 1 i przełącza się co pełny obrót', () => {
    expect(currentCycle(0, 180)).toBe(1);
    expect(currentCycle(179, 180)).toBe(1);
    expect(currentCycle(180, 180)).toBe(2);
    expect(currentCycle(540, 180)).toBe(4);
  });

  /**
   * Powyższy test próbkuje wygodne, okrągłe sekundy. Ten przypina granicę tam, gdzie
   * symulacja naprawdę ją przekracza: między OSTATNIM tickiem cyklu N a PIERWSZYM
   * tickiem N+1, licząc `elapsed` dokładnie tak, jak robi to `Sim.elapsedSeconds`
   * (`tick * TICK_SECONDS`). Zmierzone: 3599 × 0,05 = 179,95000000000002, a
   * 3600 × 0,05 = 180 dokładnie — więc granica NIE jest rozmyta błędem
   * zmiennoprzecinkowym i wolno ją przypiąć co do ticka.
   */
  it('granica wypada między ostatnim tickiem cyklu N a pierwszym tickiem N+1, nie w wygodnym środku', () => {
    const ticksPerCycle = 180 / TICK_SECONDS;
    expect(ticksPerCycle).toBe(3600);

    expect(currentCycle((ticksPerCycle - 1) * TICK_SECONDS, 180)).toBe(1);
    expect(currentCycle(ticksPerCycle * TICK_SECONDS, 180)).toBe(2);
    expect(currentCycle((2 * ticksPerCycle - 1) * TICK_SECONDS, 180)).toBe(2);
    expect(currentCycle(2 * ticksPerCycle * TICK_SECONDS, 180)).toBe(3);
  });

  it('numeracja zależy od okresu obrotu, nie od zaszytej liczby sekund', () => {
    // Ta sama chwila (180 s) to cykl 2 przy obrocie 180 s, ale wciąż cykl 1 przy 300 s
    // i już cykl 4 przy 60 s. Zaszyta stała 180 przechodziłaby test wyżej i oblewa tutaj.
    expect(currentCycle(180, 300)).toBe(1);
    expect(currentCycle(180, 180)).toBe(2);
    expect(currentCycle(180, 60)).toBe(4);
  });
});

describe('evacUnlocked', () => {
  it('otwiera się dopiero w ostatniej tercji runu (§5.6)', () => {
    expect(evacUnlocked(1, cfg)).toBe(false);
    expect(evacUnlocked(Math.ceil(cfg.cyclesPerRun * 0.5), cfg)).toBe(false);
    expect(evacUnlocked(cfg.cyclesPerRun, cfg)).toBe(true);
  });

  /**
   * Test wyżej sprawdza WYŁĄCZNIE `DEFAULT_RUN`, gdzie próg wypada na cyklu 7
   * (`ceil(10 × 0,67)`). Implementacja `cycle >= 7` — zaszyta liczba zamiast ułamka
   * konfiguracji — przeszłaby go co do joty. Ten test odbiera jej tę możliwość:
   * TEN SAM cykl 7 jest odblokowany przy jednej konfiguracji i zablokowany przy
   * drugiej, więc odpowiedź musi wynikać z `cfg`, a nie ze stałej w kodzie.
   */
  it('próg wynika z cyclesPerRun × evacUnlockFraction, a nie z zaszytego numeru cyklu', () => {
    const short = { ...cfg, cyclesPerRun: 4, evacUnlockFraction: 0.5 };   // próg = 2
    const long = { ...cfg, cyclesPerRun: 20, evacUnlockFraction: 0.75 };  // próg = 15

    expect(evacUnlocked(1, short)).toBe(false);
    expect(evacUnlocked(2, short)).toBe(true);
    expect(evacUnlocked(14, long)).toBe(false);
    expect(evacUnlocked(15, long)).toBe(true);

    expect(evacUnlocked(7, short)).toBe(true);
    expect(evacUnlocked(7, long)).toBe(false);
  });

  /**
   * Oba testy wyżej używają konfiguracji, w których iloczyn `cyclesPerRun × fraction`
   * wypada na okrągłej liczbie (2, 15) — więc `Math.ceil` i `Math.floor` dają tam ten
   * sam wynik i podmiana jednego na drugie przechodzi niezauważona (zmierzone: taka
   * mutacja przeżywała cały zestaw). `DEFAULT_RUN` daje iloczyn 6,7 i to jest JEDYNE
   * miejsce, w którym ta różnica jest widoczna: `ceil` otwiera Evac na cyklu 7,
   * `floor` — już na 6, czyli o cały cykl za wcześnie, przed ostatnią tercją z §5.6.
   */
  it('próg zaokrągla się W GÓRĘ: przy 10 cyklach i ułamku 0,67 otwiera się na 7, nie na 6', () => {
    expect(cfg.cyclesPerRun * cfg.evacUnlockFraction).toBeCloseTo(6.7, 9);
    expect(evacUnlocked(6, cfg)).toBe(false);
    expect(evacUnlocked(7, cfg)).toBe(true);
  });
});

describe('updateRules', () => {
  it('utrata CORE kończy run porażką', () => {
    const s = withCore();
    s.buildings[planet.startCell] = null;
    updateRules(s, cfg);
    expect(s.phase).toBe('DEFEAT');
  });

  /**
   * Test wyżej burzy CORE — czyli JEDYNY budynek w stanie — więc przeszedłby również
   * wtedy, gdyby porażką kończyła się utrata dowolnego budynku albo opustoszenie
   * planszy. Ten oddziela przyczynę od skutku: budynek ginie, run trwa; ginie CORE,
   * run się kończy.
   */
  it('porażka jest przypięta do utraty CORE, a nie do utraty JAKIEGOKOLWIEK budynku ani do opustoszenia planszy', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    const barricade = {
      cellId: cell, type: 'BARRICADE' as const, hp: BUILDINGS.BARRICADE.hp, powered: false,
    };
    s.buildings[cell] = barricade;

    updateRules(s, cfg);
    expect(s.phase).toBe('RUNNING');

    // (a) ginie budynek INNY niż CORE — run trwa dalej.
    s.buildings[cell] = null;
    updateRules(s, cfg);
    expect(s.phase).toBe('RUNNING');

    // (b) ginie CORE, ale plansza NIE jest pusta — i to i tak wystarcza do porażki.
    //     Barykada MUSI tu stać: bez niej krok (b) zostawia planszę pustą, a wtedy test
    //     przechodzi również dla warunku „porażka, gdy nie został ŻADEN budynek".
    //     Zmierzone: mutacja `b?.type === 'CORE'` → `b !== null` przeżywała cały zestaw
    //     testów, dopóki ta linia tu nie stanęła.
    s.buildings[cell] = barricade;
    s.buildings[planet.startCell] = null;
    updateRules(s, cfg);
    expect(s.phase).toBe('DEFEAT');
  });

  it('po zakończeniu stan już się nie zmienia', () => {
    const s = withCore();
    s.buildings[planet.startCell] = null;
    updateRules(s, cfg);
    s.ore = 12345;
    updateRules(s, cfg);
    expect(s.phase).toBe('DEFEAT');
  });

  /**
   * Test wyżej asercjuje WYŁĄCZNIE `phase` w stanie, w którym CORE i tak nie istnieje —
   * więc bez strażnicy `if (s.phase !== 'RUNNING') return;` reguły przeliczyłyby się od
   * nowa i ustawiły DEFEAT po raz drugi, a test i tak byłby zielony (zmierzone: usunięcie
   * tej strażnicy przeżywało cały zestaw). Tutaj run jest zakończony ZWYCIĘSTWEM, a stan
   * zawiera wszystko, czego reguły potrzebują, żeby dalej pracować: żywy CORE, zasilony
   * Evac i pełny magazyn. Porównanie po `stateHash` obejmuje KAŻDE hashowane pole naraz,
   * nie tylko `phase` — czyli sprawdza to, co obiecuje nazwa: że nie zmienia się NIC.
   */
  it('po zakończeniu runu reguły nie ruszają NICZEGO, nie tylko fazy', () => {
    const { s } = withPoweredEvac();
    s.storedEnergy = 500;
    s.phase = 'VICTORY';
    const before = stateHash(s);

    updateRules(s, cfg);

    expect(s.phase).toBe('VICTORY');
    expect(s.evacCharge).toBe(0);
    expect(s.storedEnergy).toBe(500);
    expect(stateHash(s)).toBe(before);
  });

  it('zasilony Evac ładuje się z magazynu', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: true };
    s.storedEnergy = 500;

    updateRules(s, cfg);
    expect(s.evacCharge).toBeCloseTo(cfg.evacChargeRate * TICK_SECONDS, 6);
    expect(s.storedEnergy).toBeCloseTo(500 - cfg.evacChargeRate * TICK_SECONDS, 6);
  });

  it('bez zasilania Evac się nie ładuje', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: false };
    s.storedEnergy = 500;
    updateRules(s, cfg);
    expect(s.evacCharge).toBe(0);
  });

  /**
   * Test „zasilony Evac ładuje się z magazynu" trzyma w magazynie 500 przy poborze 1,25
   * na tick — czyli z ogromnym zapasem, więc ograniczenie `Math.min(…, storedEnergy)`
   * nigdy tam nie działa i jego usunięcie przeszłoby niezauważone. Tutaj w magazynie
   * jest MNIEJ niż jeden pełny pobór: bez ograniczenia `storedEnergy` zszedłby pod zero
   * (a `SimState` przenosi tę wartość przez JSON do Fazy 5), a ładunek urósłby o więcej,
   * niż w magazynie było.
   */
  it('pobór nie może przekroczyć zawartości magazynu — magazyn nie schodzi poniżej zera', () => {
    const { s } = withPoweredEvac();
    const perTick = cfg.evacChargeRate * TICK_SECONDS;
    expect(perTick).toBeGreaterThan(0.3); // przesłanka testu: 0,3 to MNIEJ niż jeden pobór
    s.storedEnergy = 0.3;

    updateRules(s, cfg);

    expect(s.evacCharge).toBeCloseTo(0.3, 9);
    expect(s.storedEnergy).toBe(0);
  });

  it('pełne naładowanie uruchamia alarm, a przetrwanie alarmu daje zwycięstwo', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: true };
    s.evacCharge = cfg.evacEnergyRequired;

    updateRules(s, cfg);
    expect(s.evacAlarmRemaining).toBeGreaterThan(0);
    expect(s.phase).toBe('RUNNING');

    // Bez `+ 1`: po naprawie ALARM_EPSILON w rules.ts odliczanie mieści się w nominalnej
    // liczbie ticków. Zapas maskowałby regresję wydłużającą alarm o krok.
    const ticks = Math.ceil(cfg.evacAlarmSeconds / TICK_SECONDS);
    for (let i = 0; i < ticks; i++) updateRules(s, cfg);
    expect(s.phase).toBe('VICTORY');
  });

  /**
   * Test wyżej stwierdza tylko, że po DOSTATECZNIE wielu tickach (1201, czyli o jeden
   * więcej niż trzeba) jest zwycięstwo — przeszedłby też, gdyby alarm wygrywał
   * natychmiast, po jednym ticku albo po połowie czasu. Ten MIERZY długość alarmu
   * w tickach i przypina ją obustronnie.
   *
   * Przed naprawą było ich 1201, nie 1200: `evacAlarmRemaining -= 0.05` powtórzone 1200
   * razy od 60 zostawia 1,2706086183200682e-12 zamiast zera, bo 0,05 nie ma dokładnej
   * reprezentacji binarnej — alarm trwał 60,05 s zamiast 60 s. Domknięte stałą
   * `ALARM_EPSILON` w rules.ts, odpowiednikiem `EXPOSURE_EPSILON` z burning.ts.
   *
   * Asercja jest teraz DOKŁADNA (`toBe`), nie tolerancyjna: każdy tick w którąkolwiek
   * stronę to błąd. Sprawdzone dla czterech długości alarmu, w tym najgorszej zmierzonej
   * w zakresie 1–600 s (128 s, reszta 5,14e-12) — wszystkie trafiają w nominał co do ticka.
   */
  it('alarm odlicza pełne evacAlarmSeconds mierzone w tickach, nie kończy się wcześniej', () => {
    const { s } = withPoweredEvac();
    s.evacCharge = cfg.evacEnergyRequired;

    updateRules(s, cfg); // tick uzbrojenia — sam jeszcze nie odlicza
    expect(s.evacAlarmRemaining).toBe(cfg.evacAlarmSeconds);
    expect(s.phase).toBe('RUNNING');

    let ticks = 0;
    while (s.phase === 'RUNNING' && ticks < 5000) {
      updateRules(s, cfg);
      ticks++;
    }

    expect(s.phase).toBe('VICTORY');
    expect(ticks).toBe(cfg.evacAlarmSeconds / TICK_SECONDS);
    expect(ticks).toBe(1200);
  });

  /**
   * Tolerancja ma działać dla KAŻDEJ długości alarmu, nie tylko dla domyślnych 60 s —
   * reszta akumulacji nie jest ani monotoniczna, ani zawsze dodatnia. 128 s to najgorszy
   * DODATNI przypadek zmierzony w zakresie 1–600 s (reszta 5,135961100855013e-12);
   * 30 s to przypadek, w którym reszta wychodzi UJEMNA (−2,92e-13) i problemu nigdy
   * nie było — oba muszą trafiać w nominał co do ticka.
   */
  it('odliczanie trafia w nominał co do ticka także poza domyślnymi 60 s', () => {
    for (const seconds of [5, 30, 128, 300]) {
      const local = { ...cfg, evacAlarmSeconds: seconds };
      const { s } = withPoweredEvac();
      s.evacCharge = local.evacEnergyRequired;
      updateRules(s, local);

      let ticks = 0;
      while (s.phase === 'RUNNING' && ticks < 20_000) {
        updateRules(s, local);
        ticks++;
      }
      expect(s.phase, `alarm ${seconds}s nie zakończył się`).toBe('VICTORY');
      expect(ticks, `alarm ${seconds}s trwał ${ticks} ticków`).toBe(Math.round(seconds / TICK_SECONDS));
    }
  });

  it('zniszczony Evac zeruje ładunek, ale NIE kończy runu (§5.6)', () => {
    const s = withCore();
    const cell = planet.cells[planet.startCell].neighbors[0];
    s.buildings[cell] = { cellId: cell, type: 'EVACUATION_MODULE', hp: 2000, powered: true };
    s.evacCharge = cfg.evacEnergyRequired;
    updateRules(s, cfg);
    expect(s.evacAlarmRemaining).toBeGreaterThan(0);

    s.buildings[cell] = null;
    updateRules(s, cfg);

    expect(s.phase).toBe('RUNNING');
    expect(s.evacCharge).toBe(0);
    expect(s.evacAlarmRemaining).toBe(-1);
  });

  /**
   * `evacAlarmRemaining = -1` to sentinel „alarm nieaktywny", a nie liczba sekund —
   * i MUSI nim pozostać `-1`, nie `Infinity`/`null`. `JSON.stringify` zamienia
   * `Infinity` na `null`, a `null` w arytmetyce zachowuje się jak `0`, czyli po
   * round-tripie zapisu „brak alarmu" stałoby się „alarm właśnie minął" —
   * natychmiastowym zwycięstwem po wczytaniu gry (§ niezmiennik serializowalności
   * w state.ts). Ten test pilnuje SAMEJ wartości sentinela, nie tylko tego, że run trwa.
   */
  it('sentinel braku alarmu przeżywa round-trip JSON jako -1, nigdy jako Infinity', () => {
    const { s } = withPoweredEvac();
    updateRules(s, cfg);
    expect(s.evacAlarmRemaining).toBe(-1);
    expect(Number.isFinite(s.evacAlarmRemaining)).toBe(true);
    expect(JSON.parse(JSON.stringify(s)).evacAlarmRemaining).toBe(-1);
  });
});
