import { TICK_SECONDS } from '@heliopolis/sim';
import type { RunResult } from './run.js';

/**
 * Raport rozkładów wymagany przez §8.3 specu.
 *
 * `Phase` ma TRZY wartości, a poprzednia wersja obsługiwała dwie: liczyła zwycięstwa
 * i porażki, a runy WCIĄŻ `RUNNING` (obcięte limitem ticków) po cichu wpadały do tej
 * samej worki co porażki — nigdzie nie napisane. Zmierzone: pięć runów, z których
 * ŻADEN się nie skończył, drukowało `runów: 5 / zwycięstw: 0 (0.0%)` i „moment
 * porażki: brak danych", bez jednego słowa o tym, że zero runów w ogóle dobiegło końca.
 * Raport z 1000 runów był sensowny wyłącznie dlatego, że wszystkie 1000 naprawdę
 * przegrało — czego nikt nie asercjował.
 *
 * Rozkłady „porażki" liczą się WYŁĄCZNIE z runów zakończonych porażką (tak było
 * i tak zostaje), więc partia z obciętymi runami opisuje mniej niż całość — stąd
 * ostrzeżenie na SAMEJ GÓRZE, gdzie czytelnik nie ma jak go przeoczyć.
 */
export function formatReport(results: RunResult[]): string {
  const n = results.length;
  const wins = results.filter((r) => r.phase === 'VICTORY').length;
  const defeats = results.filter((r) => r.phase === 'DEFEAT');
  const truncated = results.filter((r) => r.phase === 'RUNNING');

  const lines: string[] = [];
  if (truncated.length > 0) {
    lines.push(
      `!!! UWAGA: ${truncated.length} z ${n} runów (${pct(truncated.length / n)}) NIE ZAKOŃCZYŁO SIĘ —`,
    );
    lines.push('!!! zostały OBCIĘTE limitem ticków i wciąż były w fazie RUNNING.');
    lines.push('!!! Rozkłady porażki niżej opisują wyłącznie runy zakończone, więc są NIEPEŁNE.');
    lines.push('');
  }
  lines.push(`runów: ${n}`);
  lines.push(`  zwycięstw: ${wins} (${pct(wins / n)})`);
  lines.push(`  porażek:   ${defeats.length} (${pct(defeats.length / n)})`);
  lines.push(`  obciętych: ${truncated.length} (${pct(truncated.length / n)})`);
  lines.push('');
  lines.push(`moment porażki [s]  ${quantiles(defeats.map((r) => r.ticks * TICK_SECONDS))}`);
  lines.push(`cykl porażki        ${quantiles(defeats.map((r) => r.cycle))}`);
  lines.push(`szczyt zabudowy     ${quantiles(results.map((r) => r.peakBuildings))}`);
  lines.push(`wydobyta ruda       ${quantiles(results.map((r) => r.oreMined))}`);
  lines.push('');

  const depleted = results.filter((r) => r.firstDepletionTick >= 0);
  lines.push(
    `wyczerpanie 1. złoża: ${pct(depleted.length / n)} runów, ` +
      `czas [s] ${quantiles(depleted.map((r) => r.firstDepletionTick * TICK_SECONDS))}`,
  );

  const sun = results.reduce((a, r) => a + r.killsBySun, 0);
  const turret = results.reduce((a, r) => a + r.killsByTurret, 0);
  const total = sun + turret;
  lines.push(
    `ubite przez słońce: ${total === 0 ? 'n/d' : pct(sun / total)} · ` +
      `przez wieże: ${total === 0 ? 'n/d' : pct(turret / total)}`,
  );

  return lines.join('\n');
}

function pct(v: number): string {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/d';
}

function quantiles(values: number[]): string {
  if (values.length === 0) return 'brak danych';
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return `p10=${fmt(at(0.1))} p50=${fmt(at(0.5))} p90=${fmt(at(0.9))}`;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
