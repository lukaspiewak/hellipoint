import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { formatPorownanie, type Miara, type Wariant } from './compare.js';
import { OTWARCIA } from './openings.js';
import type { RunResult } from './run.js';

/**
 * # Porównanie wariantów z wiersza poleceń (Faza 3, narzędzia balansu)
 *
 * Dwa tryby, bo dwa razy to samo pytanie w innym opakowaniu.
 *
 * **Otwarcia** — „które strategie w ogóle wygrywają":
 * ```
 * node dist/compareCli.js --openings --runs 250 --out porownanie.txt
 * ```
 *
 * **Gotowe partie** — „czy ta zmiana balansu coś dała":
 * ```
 * node dist/compareCli.js --variants "przed=stary.json" "po=nowy.json" --out diff.txt
 * ```
 *
 * Tryb drugi nie uruchamia niczego: bierze wyniki, które już leżą na dysku. Dzięki temu
 * porównanie „przed → po" nie wymaga przeliczania „przed" od nowa za każdym razem —
 * a właśnie to robiłem w Zadaniu 3 ręcznie, zestawiając dwa raporty wzrokiem.
 */

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`compareCli: brakuje argumentu --${name}`);
};

const wczytaj = (sciezka: string): RunResult[] =>
  JSON.parse(readFileSync(sciezka, 'utf8')) as RunResult[];

const out = arg('out');
const workers = Number(arg('workers', String(Math.max(1, cpus().length - 2))));
const batchCli = join(dirname(process.argv[1]), 'batchCli.js');

let warianty: Wariant[];

if (process.argv.includes('--openings')) {
  const runs = Number(arg('runs', '250'));
  warianty = OTWARCIA.map(([nazwa, _]) => {
    process.stderr.write(`\n=== ${nazwa} ===\n`);
    const plik = `${out}.${nazwa.replace(/[^a-z0-9]+/gi, '_')}`;
    execFileSync(
      process.execPath,
      [
        batchCli,
        '--runs', String(runs),
        '--policy', 'skilled',
        '--workers', String(workers),
        '--opening', nazwa,
        '--out', plik,
      ],
      { stdio: 'inherit' },
    );
    return { nazwa, wyniki: wczytaj(`${plik}.json`) };
  });
} else {
  // `nazwa=ścieżka`, powtarzalne. PIERWSZY jest odniesieniem — kolejność ma znaczenie
  // i dlatego argumenty są pozycyjne, a nie mapą.
  const i = process.argv.indexOf('--variants');
  if (i < 0) throw new Error('compareCli: podaj --openings albo --variants nazwa=plik.json …');
  // Zbieranie kończy się na PIERWSZEJ kolejnej fladze, a nie odfiltrowuje flag: wersja
  // z `filter` wciągała wartość `--out` jako wariant, bo ścieżka nie zaczyna się od „--".
  const spec: string[] = [];
  for (let k = i + 1; k < process.argv.length && !process.argv[k].startsWith('--'); k++) {
    spec.push(process.argv[k]);
  }
  if (spec.length < 2) throw new Error('compareCli: --variants wymaga co najmniej dwóch wariantów');
  warianty = spec.map((s) => {
    const rozdzial = s.indexOf('=');
    if (rozdzial < 0) throw new Error(`compareCli: „${s}" nie ma postaci nazwa=plik.json`);
    return { nazwa: s.slice(0, rozdzial), wyniki: wczytaj(s.slice(rozdzial + 1)) };
  });
}

// `--metric cykl1` porównuje odsetek runów ginących w cyklu 1 zamiast zwycięstw — bo
// zmiana, która NIC nie robi zwycięstwom, może ruszyć podłogę i odwrotnie. Dokładnie tak
// zachowała się zmiana wieży: zwycięstwa początkującej bez zmian (0 %), a cykl 1 spadł o 22 pp.
const miara = (arg('metric', 'zwyciestwa') === 'cykl1' ? 'cykl1' : 'zwyciestwa') as Miara;
writeFileSync(out, formatPorownanie(warianty, miara) + '\n');
process.stderr.write(`\nporównanie → ${out}\n`);
