import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { DEFAULT_RUN, type RunConfig } from '@heliopolis/sim';
import { MAX_TICKS, mergeBatches, runBatch, splitRange } from './batch.js';
import { BeginnerPolicy } from './policy.js';
import { SkilledPolicy } from './skilledPolicy.js';
import { OTWARCIA } from './openings.js';
import { formatReport } from './report.js';
import { assessHealth } from './health.js';
import { applyFixed, AXES, isAxisName, parseFixed } from './sweep.js';
import type { PolicyFactory } from './policy.js';
import type { RunResult } from './run.js';

/**
 * # Partia równoległa z wiersza poleceń (Faza 3, Zadanie 2)
 *
 * `node dist/batchCli.js --runs 10000 --policy skilled --workers 8 --out raport.txt`
 *
 * Równoległość jest PROCESOWA, nie wątkowa: proces potomny to ten sam plik z `--slice`,
 * liczący swój kawałek zakresu i oddający wyniki jako JSON. Powód jest prosty — `Sim` jest
 * czysto obliczeniowy i nie dzieli żadnego stanu, więc procesy nie potrzebują niczego
 * poza zakresem seedów, a `worker_threads` dokładałby serializację struktur bez zysku.
 *
 * **Niezmiennik podziału jest testowany osobno** (`batch.test.ts`): sklejone kawałki są
 * identyczne z przebiegiem całości, run po runie. Tutaj zostaje samo okablowanie.
 */

/**
 * Wariant otwarcia dla polityki wprawnej — kryterium H5 („ile RÓŻNYCH otwarć wygrywa").
 *
 * Wybierany OSOBNO od polityki, a nie jako kolejna polityka, bo `assessHealth` weryfikuje
 * populację po `RunResult.policy`: gdyby każdy wariant miał własną nazwę, każda partia
 * wyglądałaby jak obca populacja i strażnik z Zadania 2 krzyczałby na poprawne dane.
 *
 * **Czego to NIE robi: nie wchodzi do `configFingerprint`.** Otwarcie jest własnością
 * POLITYKI, nie nastawy gry — dwie partie na różnych otwarciach mają ten sam odcisk
 * konfiguracji i to jest poprawne. Nazwa wariantu idzie za to do nagłówka raportu, żeby
 * wynik dało się przypisać do pytania, na które odpowiadał.
 */
const openingName = arg('opening', 'laserowe (znana linia)');
const wariant = OTWARCIA.find(([nazwa]) => nazwa === openingName);
if (wariant === undefined) {
  throw new Error(
    `batchCli: nieznane otwarcie „${openingName}" (jest: ${OTWARCIA.map(([n]) => n).join(' | ')})`,
  );
}

const POLICIES: Record<string, PolicyFactory> = {
  beginner: (sim) => new BeginnerPolicy(sim),
  skilled: (sim) => new SkilledPolicy(sim, wariant[1]),
};



function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`batchCli: brakuje argumentu --${name}`);
}

/**
 * TRYB ŁĄCZENIA: `--combine wprawna.json początkująca.json --out raport.txt`.
 *
 * Istnieje, bo **H2 porównuje dwie polityki**, a partia jednej ich nie zmierzy. Bez tego
 * trybu raport bazowy pokazywałby sześć razy „NIEZMIERZONE" przy dwóch policzonych
 * partiach — i wyglądałoby to na wadę narzędzia, a nie na brak jednego kroku.
 */
if (process.argv.includes('--combine')) {
  const i = process.argv.indexOf('--combine');
  const skilled = JSON.parse(readFileSync(process.argv[i + 1], 'utf8')) as RunResult[];
  const beginner = JSON.parse(readFileSync(process.argv[i + 2], 'utf8')) as RunResult[];

  // `formatReport` pilnuje jednorodności odcisku WEWNĄTRZ partii (naprawa Z5 z Zadania 1),
  // ale tutaj woła się go dwa razy, na dwóch osobnych partiach — dwa różne odciski
  // przeszłyby bez jednego ostrzeżenia, a H2 porównywałoby wtedy sufit z jednej nastawy
  // z podłogą z drugiej. Zadanie 3 przemiata właśnie nastawy, więc to uderzy tam.
  const odciski = new Set([...skilled, ...beginner].map((r) => r.configFingerprint));
  if (odciski.size > 1) {
    throw new Error(
      `batchCli --combine: partie policzono na RÓŻNYCH konfiguracjach (${[...odciski].join(', ')}). ` +
        'H2 porównywałoby sufit jednej nastawy z podłogą drugiej.',
    );
  }
  const lines = [
    '# Raport bazowy Fazy 3 — dwie polityki, sześć kryteriów zdrowia',
    '',
    '## Polityka WPRAWNA — „gdzie jest sufit?"',
    '',
    formatReport(skilled),
    '',
    '## Polityka POCZĄTKUJĄCA — „czy początkujący ma szansę?"',
    '',
    formatReport(beginner),
    '',
    '## ZDROWIE (progi z R1 planu)',
    '',
  ];
  // H5 („ile RÓŻNYCH otwarć wygrywa ≥20 % seedów") nie da się policzyć z jednej partii —
  // wchodzi liczbą z osobnego pomiaru wariantów otwarcia. Bez niej kryterium zostaje
  // NIEZMIERZONE, co jest uczciwsze niż zero.
  const winningOpenings = process.argv.includes('--winning-openings')
    ? Number(arg('winning-openings'))
    : undefined;
  if (winningOpenings !== undefined && !Number.isInteger(winningOpenings)) {
    throw new Error(`batchCli: --winning-openings ${arg('winning-openings')} nie jest liczbą całkowitą`);
  }
  for (const v of assessHealth({ skilled, beginner, winningOpenings })) {
    const mark = v.ok === null ? 'NIEZMIERZONE' : v.ok ? 'OK  ' : 'BŁĄD';
    lines.push(`${v.id}  ${mark}  ${v.note}`);
  }
  writeFileSync(arg('out'), lines.join('\n') + '\n');
  process.stderr.write(`połączone → ${arg('out')}\n`);
  process.exit(0);
}

/**
 * Konfiguracja partii: `DEFAULT_RUN`, opcjonalnie z nałożoną jedną osią przemiatania.
 *
 * Liczona TU, przed rozwidleniem, i przekazywana dziecku jako te same dwa argumenty —
 * dziecko nakłada oś samo, z tej samej tabeli. Gdyby rodzic serializował gotową
 * konfigurację, a dziecko ją parsowało, powstałby drugi opis tej samej rzeczy; tak
 * jest jeden, a `configFingerprint` i tak wyłapałby rozjazd.
 */
/** Wszystkie `--fix nazwa=wartość` z wiersza poleceń, w kolejności podania. */
function fixArgs(): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--fix' && process.argv[i + 1] !== undefined) out.push(process.argv[i + 1]);
  }
  return out;
}

function konfiguracja(): RunConfig {
  const baza = applyFixed(DEFAULT_RUN, parseFixed(fixArgs()));
  const i = process.argv.indexOf('--axis');
  if (i < 0) return baza;
  const nazwa = process.argv[i + 1];
  if (nazwa === undefined || !isAxisName(nazwa)) {
    throw new Error(`batchCli: nieznana oś ${nazwa} (jest: ${Object.keys(AXES).join(', ')})`);
  }
  const wartosc = Number(arg('value'));
  if (!Number.isFinite(wartosc)) {
    throw new Error(`batchCli: --value ${arg('value')} nie jest liczbą skończoną`);
  }
  return AXES[nazwa].apply(baza, wartosc);
}

const cfg = konfiguracja();

const policyName = arg('policy', 'beginner');
const makePolicy = POLICIES[policyName];
if (makePolicy === undefined) {
  throw new Error(`batchCli: nieznana polityka ${policyName} (jest: ${Object.keys(POLICIES)})`);
}

const sliceArg = process.argv.indexOf('--slice');
if (sliceArg >= 0) {
  // PROCES POTOMNY: policz swój kawałek i oddaj przez stdout jako JSON.
  //
  // Walidacja, bo bez niej `--slice abc:def` dawało `NaN`, pętla `for (seed = NaN; NaN < NaN)`
  // nie wykonywała się ani razu, dziecko zapisywało `[]` i **wychodziło z kodem 0**.
  // Rodzic przyjmował pusty kawałek bez słowa — partia zamówiona na 10 000 runów wracała
  // jako 8 750 z rzetelnie policzonym przedziałem ufności dla złego `n`.
  const [from, to] = process.argv[sliceArg + 1].split(':').map(Number);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    throw new Error(`batchCli: --slice ${process.argv[sliceArg + 1]} nie jest zakresem liczb całkowitych`);
  }
  const results = runBatch({ from, to }, cfg, MAX_TICKS, makePolicy);
  writeFileSync(arg('out'), JSON.stringify(results));
  process.exit(0);
}

// PROCES GŁÓWNY: podziel, rozdaj, poczekaj, sklej.
const runs = Number(arg('runs'));
const workers = Number(arg('workers', String(Math.max(1, cpus().length - 2))));
const out = arg('out');
const slices = splitRange({ from: 0, to: runs }, workers);

const started = Date.now();
process.stderr.write(`partia: ${runs} runów, polityka ${policyName}, ${workers} procesów\n`);

const done = await Promise.all(
  slices.map(
    (slice, i) =>
      new Promise<RunResult[]>((resolve, reject) => {
        const file = `${out}.slice${i}.json`;
        const osArg = process.argv.indexOf('--axis');
        const child = fork(process.argv[1], [
          '--slice', `${slice.from}:${slice.to}`,
          '--policy', policyName,
          '--out', file,
          // Oś idzie dalej tymi samymi dwoma argumentami. Pominięcie ich tutaj dałoby
          // partię policzoną na DEFAULT_RUN mimo `--axis` — czyli przemiatanie, w którym
          // wszystkie punkty są tym samym punktem, a tabela wygląda wiarygodnie.
          ...(osArg >= 0 ? ['--axis', process.argv[osArg + 1], '--value', arg('value')] : []),
          // Trzymane osie idą tą samą drogą i z tego samego powodu: pominięte tutaj
          // dałyby partię policzoną na DEFAULT_RUN mimo `--fix`.
          ...fixArgs().flatMap((f) => ['--fix', f]),
          // Wariant otwarcia tą samą drogą i z tego samego powodu: pominięty tutaj dałby
          // partię liczoną ZNANĄ LINIĄ mimo `--opening`, czyli pięć „różnych" otwarć
          // o identycznych wynikach i tabelę wyglądającą wiarygodnie.
          '--opening', openingName,
        ], { stdio: 'inherit' });
        child.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`batchCli: proces ${i} (${slice.from}:${slice.to}) wyszedł z ${code}`));
            return;
          }
          resolve(JSON.parse(readFileSync(file, 'utf8')) as RunResult[]);
        });
      }),
  ),
);

const results = mergeBatches(done);

// `mergeBatches` łapie ZAKŁADKI (ten sam seed dwa razy), nie łapie LUK. Lukę widać dopiero
// tutaj, gdzie znana jest zamówiona liczba runów — i musi być widać GŁOŚNO, bo partia
// niepełna daje liczby wyglądające całkowicie prawdopodobnie.
if (results.length !== runs) {
  throw new Error(
    `batchCli: zamówiono ${runs} runów, wróciło ${results.length}. Partia niepełna — ` +
      'raport z niej byłby prawdopodobnie wyglądającą liczbą policzoną na złym n.',
  );
}
const brak = results.findIndex((r, i) => r.seed !== i);
if (brak >= 0) {
  throw new Error(
    `batchCli: na pozycji ${brak} stoi seed ${results[brak].seed}, a miał ${brak} — ` +
      'zbiór seedów nie jest ciągły, mimo poprawnej liczby wyników.',
  );
}

const minutes = ((Date.now() - started) / 60_000).toFixed(1);

const lines = [
  `otwarcie: ${openingName}`,
  '',
  formatReport(results),
  '',
  `czas partii: ${minutes} min na ${workers} procesach`,
  '',
  'ZDROWIE (progi z R1 planu Fazy 3):',
];
// Partia jednej polityki nie zmierzy H2 — zostawiamy to raportowi łączonemu.
for (const v of assessHealth(
  policyName === 'skilled' ? { skilled: results, beginner: [] } : { skilled: [], beginner: results },
)) {
  const mark = v.ok === null ? 'NIEZMIERZONE' : v.ok ? 'OK' : 'BŁĄD';
  lines.push(`  ${v.id} ${mark.padEnd(12)} ${v.note}`);
}
writeFileSync(out, lines.join('\n') + '\n');
// SUROWE WYNIKI obok raportu — bez nich tryb łączenia musiałby liczyć partię od nowa.
writeFileSync(`${out}.json`, JSON.stringify(results));
process.stderr.write(`gotowe w ${minutes} min → ${out}\n`);
