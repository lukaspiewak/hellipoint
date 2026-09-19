import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN } from '@heliopolis/sim';
import { AXES, formatSweep, isAxisName, sweepPoint, type AxisName } from '../src/sweep.js';
import { BEGINNER_POLICY_NAME } from '../src/policy.js';
import { SKILLED_POLICY_NAME } from '../src/skilledPolicy.js';
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
