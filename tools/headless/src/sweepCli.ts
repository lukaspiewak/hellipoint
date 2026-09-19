import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { AXES, formatSweep, isAxisName, parseFixed, sweepPoint, type SweepPoint } from './sweep.js';
import type { RunResult } from './run.js';

/**
 * # Przemiatanie z wiersza poleceń (Faza 3, Zadanie 3)
 *
 * ```
 * node dist/sweepCli.js --axis killRewardScale --values 0.15,0.25,0.35,0.5 \
 *   --skilled 250 --beginner 1000 --out sweep-nagrody.txt
 * ```
 *
 * ## Dwie różne liczebności, i to nie jest niekonsekwencja
 *
 * Zmierzone na tej maszynie (10 rdzeni, 8 procesów): **64 przebiegi wprawnej = 1,1 min**,
 * **200 przebiegów początkującej = 0,2 min**. Wprawna jest ~27× droższa za przebieg, bo
 * wygrywa i gra do końca, a początkująca ginie w cyklu 1. Równa liczebność oznaczałaby
 * płacenie ceny wprawnej za precyzję, której podłoga nie potrzebuje — H4 przy 1 000
 * przebiegów ma już ±1 pp.
 *
 * Rozstrzygnięcie R4 planu każe wyprowadzać wielkości prób Z POMIARU KOSZTU, nie z okrągłych
 * liczb, i to jest dokładnie ten rachunek.
 */

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`sweepCli: brakuje argumentu --${name}`);
};

const axisName = arg('axis');
if (!isAxisName(axisName)) {
  throw new Error(`sweepCli: nieznana oś ${axisName} (jest: ${Object.keys(AXES).join(', ')})`);
}
const axis = AXES[axisName];

const values = arg('values')
  .split(',')
  .map((v) => Number(v.trim()));
if (values.length === 0 || values.some((v) => !Number.isFinite(v))) {
  throw new Error(`sweepCli: --values ${arg('values')} nie jest listą liczb skończonych`);
}

/** `--fix nazwa=wartość`, powtarzalne: osie trzymane na stałe podczas przemiatania innej. */
const fixSpecs: string[] = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--fix' && process.argv[i + 1] !== undefined) fixSpecs.push(process.argv[i + 1]);
}
const fixed = parseFixed(fixSpecs); // rzuca tu, zanim ruszy pierwsza partia

const skilledRuns = Number(arg('skilled', '250'));
const beginnerRuns = Number(arg('beginner', '1000'));
const workers = Number(arg('workers', String(Math.max(1, cpus().length - 2))));
const out = arg('out');
const batchCli = join(dirname(process.argv[1]), 'batchCli.js');

/** Jedna partia jednej polityki na jednej wartości osi — przez `batchCli`, procesami. */
function partia(policy: string, runs: number, value: number, plik: string): RunResult[] {
  execFileSync(
    process.execPath,
    [
      batchCli,
      '--runs', String(runs),
      '--policy', policy,
      '--workers', String(workers),
      '--axis', axisName,
      '--value', String(value),
      '--out', plik,
      ...fixSpecs.flatMap((f) => ['--fix', f]),
    ],
    { stdio: 'inherit' },
  );
  return JSON.parse(readFileSync(`${plik}.json`, 'utf8')) as RunResult[];
}

const started = Date.now();
const punkty: SweepPoint[] = [];
for (const value of values) {
  process.stderr.write(`\n=== ${axisName} = ${value} ===\n`);
  const skilled = partia('skilled', skilledRuns, value, `${out}.${value}.skilled`);
  const beginner = partia('beginner', beginnerRuns, value, `${out}.${value}.beginner`);
  punkty.push(sweepPoint(value, skilled, beginner));
}
const minutes = ((Date.now() - started) / 60_000).toFixed(1);

writeFileSync(
  out,
  [
    formatSweep(axis, punkty, fixed),
    '',
    `czas przemiatania: ${minutes} min, ${workers} procesów, ` +
      `${skilledRuns} przebiegów wprawnej i ${beginnerRuns} początkującej na punkt`,
  ].join('\n') + '\n',
);
process.stderr.write(`\ngotowe w ${minutes} min → ${out}\n`);
