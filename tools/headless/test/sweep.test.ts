import { describe, expect, it } from 'vitest';
import { BUILDINGS, DEFAULT_RUN } from '@heliopolis/sim';
import {
  applyFixed,
  AXES,
  formatSweep,
  isAxisName,
  parseFixed,
  sweepPoint,
  type AxisName,
} from '../src/sweep.js';
import { BEGINNER_POLICY_NAME } from '../src/policy.js';
import { SKILLED_POLICY_NAME } from '../src/skilledPolicy.js';
import { OTWARCIA, skladOtwarcia } from '../src/openings.js';
import type { RunResult } from '../src/run.js';

/**
 * # Przemiatanie osi (Faza 3, Zadanie 3)
 *
 * Oś jest **daną**, a nie gałęzią `switch`, więc daje się sprawdzić bez uruchomienia
 * choćby jednego przebiegu. Wiązane są tu dwie rzeczy: że oś rusza DOKŁADNIE to pole,
 * które nazywa, i że tabela odróżnia punkt w progu od punktu poza nim.
 */

const run = (over: Partial<RunResult> = {}): RunResult => ({
  seed: 0, phase: 'DEFEAT', ticks: 1_000, cycle: 3, peakBuildings: 10, oreMined: 0,
  killsBySun: 0, killsByTurret: 0, firstDepletionTick: -1, coreDamager: null,
  policy: SKILLED_POLICY_NAME, configFingerprint: 'aaaaaaaa', ...over,
});
const batch = (n: number, wins: number, policy = SKILLED_POLICY_NAME): RunResult[] =>
  Array.from({ length: n }, (_, i) =>
    run(i < wins ? { phase: 'VICTORY', ticks: 36_000, cycle: 7, policy } : { policy }),
  );

describe('1. [OŚ] każda oś rusza dokładnie to pole, które nazywa', () => {
  /**
   * Oś zmieniająca dwa pola naraz dałaby przemiatanie, w którym nie wiadomo, co właściwie
   * poruszyło wynikiem — a cała wartość tabeli polega na tym, że wiadomo.
   */
  it('1a. [PARA] nałożenie osi zmienia JEDNO pole i zostawia resztę nietkniętą', () => {
    const czytaj: Record<AxisName, (c: typeof DEFAULT_RUN) => number> = {
      killRewardScale: (c) => c.killRewardScale,
      startingOre: (c) => c.startingOre,
      growthPerCycle: (c) => c.spawn.growthPerCycle,
      baseRatePerPentagon: (c) => c.spawn.baseRatePerPentagon,
      sunPhaseAtStart: (c) => c.sunPhaseAtStart,
    };
    for (const nazwa of Object.keys(AXES) as AxisName[]) {
      const os = AXES[nazwa];
      const przed = czytaj[nazwa](DEFAULT_RUN);

      // Połówka „ma przejść": oś nałożona WARTOŚCIĄ DZISIEJSZĄ jest tożsamością. To jest
      // asercja o reszcie konfiguracji — oś dotykająca drugiego pola oblewa tutaj, nawet
      // gdy swoje własne ustawia poprawnie.
      expect(os.apply(DEFAULT_RUN, przed), `${nazwa}: tożsamość`).toEqual(DEFAULT_RUN);

      // Połówka „ma oblać przy zepsutej osi": inna wartość zmienia to i tylko to pole.
      const po = os.apply(DEFAULT_RUN, przed + 7);
      expect(czytaj[nazwa](po), `${nazwa}: własne pole`).toBe(przed + 7);
      for (const inna of Object.keys(AXES) as AxisName[]) {
        if (inna === nazwa) continue;
        expect(czytaj[inna](po), `${nazwa} ruszyła cudze pole ${inna}`).toBe(
          czytaj[inna](DEFAULT_RUN),
        );
      }
    }
  });

  it('1b. `apply` nie MUTUJE konfiguracji wejściowej — partie dzielą jedną bazę', () => {
    const baza = JSON.parse(JSON.stringify(DEFAULT_RUN)) as typeof DEFAULT_RUN;
    for (const nazwa of Object.keys(AXES) as AxisName[]) AXES[nazwa].apply(DEFAULT_RUN, 999);
    expect(DEFAULT_RUN).toEqual(baza);
  });

  it('1c. nazwa spoza listy nie jest osią — lista jest ZAMKNIĘTA', () => {
    expect(isAxisName('killRewardScale')).toBe(true);
    expect(isAxisName('evacEnergyRequired'), '§11.1: cena ewakuacji NIE jest bramką').toBe(false);
    expect(isAxisName('toString'), 'dziedziczone pola nie są osiami').toBe(false);
  });
});

describe('2. [OŚ] tabela odróżnia punkt w progu od punktu poza nim', () => {
  const punkt = (v: number, wins: number) =>
    sweepPoint(v, batch(1_000, wins), batch(1_000, 100, BEGINNER_POLICY_NAME));

  it('2a. [PARA] wykrzyknik przy H1 stoi tylko poza pasmem 25–60 %', () => {
    const tabela = formatSweep(AXES.killRewardScale, [punkt(0.25, 400), punkt(1, 850)]);
    const [wH1, wH2] = tabela.split('\n').filter((l) => l.startsWith('    0.25') || l.startsWith('       1'));
    expect(wH1, '40 % jest w paśmie').toContain('40.0');
    expect(wH1).not.toMatch(/40\.0\s*±[\d.]+!/);
    expect(wH2, '85 % jest poza').toMatch(/85\.0\s*±[\d.]+!/);
  });

  it('2b. nagłówek niesie nazwę osi i JEDNOSTKĘ — tabela ma się czytać bez kodu', () => {
    const tabela = formatSweep(AXES.startingOre, [punkt(150, 400)]);
    expect(tabela).toContain('startingOre');
    expect(tabela).toContain('rudy na starcie');
  });

  it('2c. punkt niesie liczebność OBU populacji — n=1000/1000, nie samo 1000', () => {
    expect(formatSweep(AXES.killRewardScale, [punkt(0.25, 400)])).toContain('n=1000/1000');
  });

  it('2d. kryterium niezmierzone daje kreskę, nie zero', () => {
    const pusty = sweepPoint(0.25, [], []);
    expect(formatSweep(AXES.killRewardScale, [pusty])).toMatch(/—\s+—\s+—\s+—/);
  });
});

describe('3. [OŚ] osie TRZYMANE na stałe podczas przemiatania innej', () => {
  /**
   * Istnieją, bo osie się przenikają: stopa nagród rusza wyłącznie sufit (zmierzone —
   * H2 i H4 identyczne co do dziesiątej przy stawkach 0,2…0,7), więc podłogę trzeba
   * przemiatać inną osią, ale na stawce WYBRANEJ, nie dzisiejszej.
   */
  it('3a. [PARA] `nazwa=wartość` parsuje się, śmieć rzuca GŁOŚNO', () => {
    expect(parseFixed(['killRewardScale=0.35'])).toEqual([
      { name: 'killRewardScale', value: 0.35 },
    ]);
    expect(() => parseFixed(['evacEnergyRequired=1000'])).toThrow(/nieznana oś/);
    expect(() => parseFixed(['killRewardScale=dużo'])).toThrow(/nie jest liczbą/);
    expect(() => parseFixed(['killRewardScale'])).toThrow(/nie jest liczbą/);
  });

  it('3b. trzymane osie NAKŁADAJĄ SIĘ, a przemiatana idzie na wierzch', () => {
    const baza = applyFixed(DEFAULT_RUN, parseFixed(['killRewardScale=0.35', 'startingOre=600']));
    expect(baza.killRewardScale).toBe(0.35);
    expect(baza.startingOre).toBe(600);
    // Oś przemiatana nakłada się na TRZYMANE, nie na DEFAULT_RUN — inaczej przemiatanie
    // rudy startowej wracałoby po cichu na dzisiejszą stawkę nagród.
    const punkt = AXES.startingOre.apply(baza, 900);
    expect(punkt.startingOre).toBe(900);
    expect(punkt.killRewardScale, 'trzymana stawka MUSI przeżyć').toBe(0.35);
  });

  it('3c. tabela mówi, co było trzymane — bez tego liczby nikt nie odtworzy', () => {
    const punkt = sweepPoint(600, batch(100, 40), batch(100, 10, BEGINNER_POLICY_NAME));
    const z = formatSweep(AXES.startingOre, [punkt], parseFixed(['killRewardScale=0.35']));
    expect(z).toContain('trzymane: killRewardScale=0.35');
    const bez = formatSweep(AXES.startingOre, [punkt]);
    expect(bez, 'brak trzymanych też ma być NAPISANY, nie przemilczany').toContain(
      'trzymane: nic',
    );
  });
});

describe('4. [H5] warianty otwarcia są NAPRAWDĘ różne', () => {
  /**
   * Kryterium H5 pyta o RÓŻNORODNOŚĆ STRATEGII, nie o liczbę permutacji: §11.1 zmierzył,
   * że gra „dopuszcza dokładnie jedną linię", i to jest wada, którą H5 ma łapać. Pięć
   * przetasowań tej samej listy dałoby „pięć otwarć" i zero informacji — a co gorsza,
   * kryterium wyszłoby SPEŁNIONE i wada zostałaby zamknięta jako nieistniejąca.
   */
  it('4a. każde otwarcie ma skład, którego nie ma żadne inne', () => {
    const sklady = OTWARCIA.map(([nazwa, o]) => [nazwa, skladOtwarcia(o)] as const);
    for (const [nazwaA, a] of sklady) {
      for (const [nazwaB, b] of sklady) {
        if (nazwaA === nazwaB) continue;
        const rozne = [...a].some((t) => !b.has(t)) || [...b].some((t) => !a.has(t));
        expect(rozne, `„${nazwaA}" i „${nazwaB}" mają identyczny skład budynków`).toBe(true);
      }
    }
  });

  it('4b. nazwy są unikalne — `--opening` wybiera po nazwie', () => {
    expect(new Set(OTWARCIA.map(([n]) => n)).size).toBe(OTWARCIA.length);
  });

  it('4c. każde otwarcie kończy się modułem ewakuacyjnym — bez niego run nie może wygrać', () => {
    for (const [nazwa, o] of OTWARCIA) {
      expect(o.some(([, t]) => t === 'EVACUATION_MODULE'), `„${nazwa}" bez Evaca`).toBe(true);
    }
  });

  it('4d. każde otwarcie ma ŹRÓDŁO ENERGII i coś, co strzela', () => {
    // Kontrola na fiksturę: wariant bez panelu albo bez wieży przegrywałby z powodu,
    // który nie ma nic wspólnego z testowaną hipotezą, a wyglądałby jak jej obalenie.
    for (const [nazwa, o] of OTWARCIA) {
      const s = skladOtwarcia(o);
      expect(s.has('SOLAR_PANEL'), `„${nazwa}" bez źródła energii`).toBe(true);
      expect(
        s.has('LASER_TURRET') || s.has('KINETIC_TURRET'),
        `„${nazwa}" bez wieży`,
      ).toBe(true);
    }
  });
});

describe('5. [H5] otwarcie musi mieć z czego wystartować', () => {
  /**
   * ## Reguła, którą próbowałem napisać — i którą obalił własny test
   *
   * Trzy z pięciu pierwszych szkiców zakleszczały się: polityka nie przeskakuje pozycji,
   * na którą jej nie stać, więc otwarcie żądające czegoś drogiego przed pierwszym dochodem
   * staje NA ZAWSZE. W raporcie widać to jako `szczyt zabudowy p10 = p50 = p90`.
   *
   * Napisałem na to sito statyczne: „pobór nie przekracza wydajności CORE przed pierwszym
   * panelem". **Połówka „ma przejść" oblała natychmiast** — znana linia prosi o dwa lasery
   * (pobór 24 przy wydajności 10) i mimo to jako JEDYNA wygrywa. Przeżywa, bo CORE ma
   * magazyn 200, a brownout zrzuca obciążenie w kolejności (`BROWNOUT_ORDER`), więc deficyt
   * jest kryty z zapasu dokładnie tak długo, żeby zdążyły stanąć panele.
   *
   * Czyli warunek jest DYNAMICZNY („dochód rusza, zanim skończy się ruda i zapas"), a nie
   * statyczny, i sito, które go udaje, odrzuciłoby jedyną działającą linię. Zostaje tu
   * jedyna reguła, która jest naprawdę statyczna; resztę łapie pomiar, po `szczycie
   * zabudowy` niezmiennym między planetami.
   */
  it('5a. na PIERWSZĄ pozycję kolejki stać bez ani jednego zabójstwa', () => {
    for (const [nazwa, o] of OTWARCIA) {
      expect(BUILDINGS[o[0][1]].costOre, `„${nazwa}": nie stać na pierwszą pozycję`)
        .toBeLessThanOrEqual(DEFAULT_RUN.startingOre);
    }
  });

  it('5b. [PARA] i to sito naprawdę coś odrzuca', () => {
    // Bez tej połówki reguła wyżej mogłaby być spełniona przez każdy możliwy budynek.
    const zaDrogie = BUILDINGS.EVACUATION_MODULE.costOre;
    expect(zaDrogie).toBeGreaterThan(DEFAULT_RUN.startingOre);
  });
});
