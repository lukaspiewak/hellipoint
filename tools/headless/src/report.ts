import { TICK_SECONDS } from '@heliopolis/sim';
import type { RunResult } from './run.js';

/** Raport rozkładów wymagany przez §8.3 specu. */
export function formatReport(results: RunResult[]): string {
  const n = results.length;
  const wins = results.filter((r) => r.phase === 'VICTORY').length;
  const defeats = results.filter((r) => r.phase === 'DEFEAT');

  const lines: string[] = [];
  lines.push(`runów: ${n}`);
  lines.push(`zwycięstw: ${wins} (${pct(wins / n)})`);
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
