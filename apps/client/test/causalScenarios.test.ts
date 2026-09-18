import { describe, expect, it } from 'vitest';
import {
  createPlanet,
  OUTAGE_NONE,
  OUTAGE_SHED,
  OUTAGE_UNLINKED,
  TICK_SECONDS,
} from '@heliopolis/sim';
import {
  blindOutage,
  buildTrials,
  CAUSAL_ANSWERS,
  constantAnswerWarning,
  gateReport,
  readTruth,
  type CausalAnswer,
} from '../src/causalScenarios.js';

const planet = createPlanet({ seed: 20260915 });

/**
 * Zestawy budowane RAZ na plik: każdy scenariusz przepuszcza stan przez setki ticków
 * `updatePower`, a `buildTrials` robi to dwanaście razy. Budowanie ich w każdym teście
 * zamieniłoby ten plik w najwolniejszy w repozytorium bez żadnego zysku — stany są
 * zamrożone i żaden test ich nie zmienia.
 */
const graded = buildTrials(planet, 0);
const control = buildTrials(planet, 12);

describe('1. [BRAMKA] plan odpowiedzi jest zrównoważony i rozłączny', () => {
  it('1a. dwanaście osądów, po trzy na każdą z czterech odpowiedzi', () => {
    expect(graded).toHaveLength(12);
    for (const answer of CAUSAL_ANSWERS) {
      expect(graded.filter((t) => t.truth === answer), `osądów o prawdzie ${answer}`).toHaveLength(
        3,
      );
    }
  });

  /**
   * Bez tego kontrola mogłaby zdradzać przebieg oceniany: gracz, który zobaczy ten sam układ
   * drugi raz, odpowie z pamięci, a nie z ekranu — i kontrola pokaże wynik powyżej losowania
   * z powodu, który nie ma nic wspólnego z tym, co mierzy. Ta sama zasada, co rozłączne
   * komórki w bramce Fazy 2B.
   */
  it('1b. przebieg kontrolny stoi na ROZŁĄCZNYCH układach', () => {
    const gradedCells = new Set(graded.map((t) => t.cellId));
    const controlCells = new Set(control.map((t) => t.cellId));
    for (const cell of controlCells) expect(gradedCells.has(cell)).toBe(false);
    // Kontrola na fiksturę: rozłączność bez treści jest darmowa, gdy zbiory są puste.
    expect(controlCells.size).toBe(12);
  });

  it('1c. kontrola też jest zrównoważona — inaczej mierzyłaby inne zadanie', () => {
    for (const answer of CAUSAL_ANSWERS) {
      expect(control.filter((t) => t.truth === answer)).toHaveLength(3);
    }
  });
});

describe('2. [BRAMKA] prawda jest WYPROWADZONA z symulacji, nie zadeklarowana', () => {
  /**
   * `buildTrials` woła `assertTruth` na każdym scenariuszu, więc sam fakt, że powyższe
   * zestawy się zbudowały, jest już tym sprawdzeniem. Ten test wiąże to WPROST, żeby
   * usunięcie straży nie przeszło bez śladu.
   */
  it('2a. każdy osąd zgadza się z odczytem z PowerReport', () => {
    for (const trial of [...graded, ...control]) {
      expect(readTruth(trial.power, trial.cellId), trial.id).toBe(trial.truth);
    }
  });

  it('2b. Q3 (kaskada) naprawdę gasi budynek KODEM kaskady, nie odcięcia', () => {
    const shed = graded.filter((t) => t.truth === 'SHED');
    expect(shed.length).toBeGreaterThan(0);
    for (const trial of shed) {
      expect(trial.power.outage[trial.cellId], trial.id).toBe(OUTAGE_SHED);
      // …a przyczyna jest widoczna w liczbach, nie tylko w kodzie: popyt PRZED kaskadą
      // przekracza produkcję. To jest ta liczba, którą HUD stawia na ekranie.
      expect(trial.power.rawDemand).toBeGreaterThan(trial.power.supply);
    }
  });

  it('2c. Q4 (odcięcie) gasi budynek, choć sieć ma NADWYŻKĘ — to jest cała treść pary', () => {
    const unlinked = graded.filter((t) => t.truth === 'UNLINKED');
    expect(unlinked.length).toBeGreaterThan(0);
    for (const trial of unlinked) {
      expect(trial.power.outage[trial.cellId], trial.id).toBe(OUTAGE_UNLINKED);
      // Gdyby tu brakowało mocy, gracz miałby DWIE prawdziwe przyczyny naraz i pytanie
      // przestałoby mieć jedną odpowiedź. Scenariusz musi izolować odcięcie.
      expect(trial.power.rawDemand, trial.id).toBeLessThanOrEqual(trial.power.supply);
    }
  });

  it('2d. [PARA] ten sam układ z pełnym i pustym magazynem daje RÓŻNE prawdy', () => {
    // To jest sedno „jednego kroku wstecz": dwa lasery przy CORE to niedobór, ale dopóki
    // magazyn go pokrywa, nic nie gaśnie. Gdyby bramka tego nie rozdzielała, mierzyłaby
    // „czy coś nie działa", a nie „dlaczego".
    const covered = graded.find((t) => t.truth === 'DEFICIT_COVERED');
    const shed = graded.find((t) => t.truth === 'SHED');
    expect(covered).toBeDefined();
    expect(shed).toBeDefined();
    expect(covered!.power.rawDemand).toBeGreaterThan(covered!.power.supply);
    expect(shed!.power.rawDemand).toBeGreaterThan(shed!.power.supply);
    // Ta sama nierówność po obu stronach — a prawdy różne. Rozstrzyga MAGAZYN, i to
    // dokładnie tym warunkiem, którego używa `updatePower`: czy produkcja POWIĘKSZONA
    // o chwilową moc magazynu pokrywa popyt.
    //
    // Nie `storedEnergy === 0`: w scenariuszu kaskady magazyn nie siada na zerze, tylko
    // oscyluje tuż nad nim (zmierzone 0,2 jednostki), bo kaskada gasi dokładnie tyle
    // odbiorników, ile trzeba. Asercja na zero mierzyłaby przypadkowy stan pływaka,
    // a nie własność.
    const reach = (t: typeof covered) => t!.power.supply + t!.state.storedEnergy / TICK_SECONDS;
    expect(reach(covered)).toBeGreaterThanOrEqual(covered!.power.rawDemand);
    expect(reach(shed)).toBeLessThan(shed!.power.rawDemand);
  });
});

describe('3. [BRAMKA] panel wykrywa odpowiedź stałą', () => {
  it('3a. dwanaście razy to samo jest zgłoszone', () => {
    const constant = new Array<CausalAnswer>(12).fill('SHED');
    const warning = constantAnswerWarning(constant);
    expect(warning).not.toBeNull();
    expect(warning).toContain('12 z 12');
  });

  it('3b. [PARA] plan zrównoważony NIE jest zgłaszany', () => {
    const balanced: CausalAnswer[] = [];
    for (let i = 0; i < 12; i++) balanced.push(CAUSAL_ANSWERS[i % 4]);
    expect(constantAnswerWarning(balanced)).toBeNull();
  });

  it('3c. granica: 60% tej samej odpowiedzi zgłasza, 50% nie', () => {
    // Wypełniacz NIE MOŻE zawierać badanej odpowiedzi — pierwsza wersja brała
    // `CAUSAL_ANSWERS[i % 3]`, co dokładało kolejne „SHED" i robiło z przypadku „50%"
    // przypadek 70%. Test mierzył wtedy własny wypełniacz, nie próg.
    const filler = CAUSAL_ANSWERS.filter((a) => a !== 'SHED');
    const skewed = (share: number): CausalAnswer[] => {
      const out: CausalAnswer[] = [];
      for (let i = 0; i < 10; i++) {
        out.push(i < share * 10 ? 'SHED' : filler[i % filler.length]);
      }
      return out;
    };
    expect(constantAnswerWarning(skewed(0.6))).not.toBeNull();
    expect(constantAnswerWarning(skewed(0.5))).toBeNull();
  });
});

describe('4. [BRAMKA] blok wyników jest arytmetyką, nie werdyktem', () => {
  const answersWith = (correct: number): CausalAnswer[] =>
    graded.map((t, i) =>
      i < correct ? t.truth : CAUSAL_ANSWERS.find((a) => a !== t.truth)!,
    );

  it('4a. liczy trafienia i wypisuje tabelę osąd po osądzie', () => {
    const report = gateReport('graded', graded, answersWith(10), 10);
    expect(report).toContain('**10 z 12**');
    for (const trial of graded) expect(report).toContain(trial.id);
  });

  /**
   * Para NA PROGU, nie gdzieś obok niego. Sam test „10 daje OSIĄGNIĘTY" przechodzi też przy
   * porównaniu `>=` przesuniętym o jeden w dowolną stronę — dopiero druga połowa go wiąże.
   */
  it('4b. [PARA] 10 z 12 osiąga próg, 9 z 12 już nie', () => {
    expect(gateReport('graded', graded, answersWith(10), 10)).toContain('PRÓG OSIĄGNIĘTY');
    expect(gateReport('graded', graded, answersWith(9), 10)).toContain('PRÓG NIEOSIĄGNIĘTY');
  });

  it('4c. ostrzeżenie o odpowiedzi stałej trafia DO BLOKU, nie tylko na ekran', () => {
    const constant = new Array<CausalAnswer>(12).fill('SHED');
    expect(gateReport('graded', graded, constant, 10)).toContain('UWAGA');
    expect(gateReport('graded', graded, answersWith(12), 10)).not.toContain('UWAGA');
  });

  /**
   * Bramka jest PRZYRZĄDEM. Werdykt stawia właściciel projektu — tak samo jak w pięciu
   * poprzednich bramkach. Panel piszący „ZALICZONE" odbierałby człowiekowi rozstrzygnięcie
   * i zamieniał pomiar w ocenę.
   */
  it('4d. blok NIE stawia werdyktu i mówi, do kogo on należy', () => {
    const report = gateReport('graded', graded, answersWith(12), 10);
    expect(report).toContain('Werdykt wpisuje właściciel projektu');
    expect(report).not.toMatch(/\bZALICZON|\bODRZUCON|\bPASS\b|\bFAIL\b/);
  });

  it('4e. przebieg kontrolny jest w bloku NAZWANY — inaczej wyniki się zlewają', () => {
    expect(gateReport('control', control, answersWith(6), 10)).toContain('KONTROLA POZYTYWNA');
    expect(gateReport('graded', graded, answersWith(6), 10)).toContain('OCENIANY');
  });
});

describe('5. [KONTROLA] oślepianie świata zbija dwie przyczyny w jedną', () => {
  /**
   * Drugi z dwóch kanałów, które usuwa kontrola pozytywna (pierwszym jest ukrycie linii
   * bilansu i magazynu w arkuszu). Bez tego para `SHED`↔`UNLINKED` zostawałaby rozróżnialna
   * w świecie, a kontrola mierzyłaby czytelność zamiast jej braku.
   */
  it('5a. kod kaskady i kod odcięcia stają się TYM SAMYM kodem', () => {
    const source = new Uint8Array([OUTAGE_NONE, OUTAGE_SHED, OUTAGE_UNLINKED]);
    const blind = blindOutage(source);
    expect(blind[1]).toBe(blind[2]);
  });

  /**
   * **Połówka „ma przejść", i to ona niesie tu treść.** Gdyby oślepianie zbijało także
   * `OUTAGE_NONE`, wszystkie budynki dostałyby obręcz alarmu, pytanie przestałoby być
   * odpowiadalne, a sufit kontroli spadłby do 25% z powodu, który nie ma nic wspólnego
   * z czytelnością przyczynową — czyli kontrola „umiałaby oblać" z niewłaściwego powodu.
   */
  it('5b. [PARA] budynek DZIAŁAJĄCY zostaje odróżnialny od zepsutego', () => {
    const blind = blindOutage(new Uint8Array([OUTAGE_NONE, OUTAGE_SHED, OUTAGE_UNLINKED]));
    expect(blind[0]).toBe(OUTAGE_NONE);
    expect(blind[0]).not.toBe(blind[1]);
  });

  it('5c. oślepianie nie rusza oryginału — scenariusz zostaje nietknięty', () => {
    const source = new Uint8Array([OUTAGE_UNLINKED, OUTAGE_SHED]);
    blindOutage(source);
    expect([...source]).toEqual([OUTAGE_UNLINKED, OUTAGE_SHED]);
  });

  it('5d. na PRAWDZIWYCH scenariuszach kontrola zbija obie przyczyny', () => {
    const shed = graded.find((t) => t.truth === 'SHED')!;
    const unlinked = graded.find((t) => t.truth === 'UNLINKED')!;
    expect(blindOutage(shed.power.outage)[shed.cellId]).toBe(
      blindOutage(unlinked.power.outage)[unlinked.cellId],
    );
    // Kontrola na fiksturę: w przebiegu OCENIANYM te dwa kody są różne — inaczej test
    // wyżej przechodziłby dlatego, że nie ma czego zbijać.
    expect(shed.power.outage[shed.cellId]).not.toBe(unlinked.power.outage[unlinked.cellId]);
  });
});
