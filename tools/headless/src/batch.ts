import { TICK_SECONDS, type RunConfig } from '@heliopolis/sim';
import { HEALTH_THRESHOLDS } from './health.js';
import { simulateRun, type RunResult } from './run.js';
import type { PolicyFactory } from './policy.js';

/**
 * # Partie przebiegów i ich dzielenie (Faza 3, Zadanie 2)
 *
 * ## Dlaczego to jest osobny moduł, a nie pętla w miejscu
 *
 * Bo 10 000 przebiegów polityką wprawną to **8,5 godziny na jednym rdzeniu** (zmierzone:
 * 3 065 ms/run). Rozstrzygnięcie R4 planu czyni zrównoleglenie warunkiem wstępnym tego
 * zadania — a zrównoleglenie sprowadza się do **podziału zakresu seedów na kawałki**,
 * bo przebiegi są niezależne i deterministyczne per seed.
 *
 * ## Niezmiennik, który to wszystko trzyma
 *
 * **Podział zakresu i sklejenie kawałków daje wynik IDENTYCZNY z przebiegiem całości —
 * run po runie, w tej samej kolejności.** To jest jedyna własność, której zrównoleglenie
 * może nie mieć, i jedyna, która czyni je bezpiecznym. Testowana jest ona, a nie mechanika
 * procesów: proces jest szczegółem, niezmiennik jest kontraktem.
 *
 * **Kolejność jest częścią kontraktu, nie estetyką.** Partia wracająca w kolejności
 * ZAKOŃCZENIA procesów dawałaby przy każdym uruchomieniu inny plik raportu przy tych samych
 * danych — i nikt nie wiedziałby, czy zmienił się balans, czy harmonogram systemu.
 */

/**
 * Sufit ticków przebiegu — **wyprowadzony z górnej granicy H3**, nie wpisany ręcznie.
 *
 * Pierwsza wersja miała 40 000 „bo to ~1,65× zmierzonej długości zwycięskiego przebiegu".
 * Liczba wzięta z DZISIEJSZEGO balansu, podczas gdy H3 celuje w 25–35 min, czyli
 * 30 000–42 000 ticków (plan, R1). **Sufit leżał WEWNĄTRZ pasma własnego kryterium:**
 * run trwający 36 minut kończyłby w fazie `RUNNING`, wypadał ze zwycięstw i obniżał H1,
 * a werdykt brzmiałby „H3 za krótko, H1 za nisko" — czyli kazałby stroić w stronę
 * PRZECIWNĄ do prawdy. To jest klasa z CLAUDE.md §1: granica, której arytmetyka nie osiąga.
 *
 * Mnożnik 2× nad górną granicą zostawia zapas na ogon rozkładu: przy medianie w paśmie
 * runy dłuższe od sufitu są ogonem, nie centrum, więc mediana zostaje policzalna.
 *
 * Mieszka TU, a nie w `batchCli.ts`, bo czyta ją także test szwu procesowego — a sufit
 * przepisany w dwóch plikach rozjechałby się dokładnie wtedy, gdy Zadanie 3 ruszy H3.
 */
export const MAX_TICKS = Math.ceil((2 * HEALTH_THRESHOLDS.H3.maxMinutes * 60) / TICK_SECONDS);

/** Zakres seedów `[from, to)` — półotwarty, tak jak wszystko inne w tym repozytorium. */
export interface SeedRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Przebiegi dla zakresu seedów, **w kolejności rosnących seedów**.
 *
 * Sekwencyjna z założenia: równoległość powstaje przez uruchomienie wielu procesów, każdy
 * na swoim kawałku (patrz `splitRange`), a nie przez wątki wewnątrz tej funkcji. Dzięki temu
 * ta funkcja zostaje czysta i testowalna, a harmonogram jest sprawą powłoki.
 */
export function runBatch(
  range: SeedRange,
  cfg: RunConfig,
  maxTicks: number,
  makePolicy?: PolicyFactory,
): RunResult[] {
  const out: RunResult[] = [];
  for (let seed = range.from; seed < range.to; seed++) {
    out.push(simulateRun(seed, cfg, maxTicks, makePolicy));
  }
  return out;
}

/**
 * Dzieli zakres na `parts` kawałków **bez luk i bez zakładek**.
 *
 * Reszta z dzielenia idzie do PIERWSZYCH kawałków, po jednym — nie do ostatniego. Przy
 * 10 000 seedach na 8 procesów daje to kawałki 1250 (równo), a przy 10 001 — siedem po 1250
 * i jeden 1251, zamiast siedmiu po 1250 i jednego 1251 na końcu, który kończyłby się
 * najpóźniej i przedłużał całość o własną resztę.
 */
export function splitRange(range: SeedRange, parts: number): SeedRange[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new RangeError(`splitRange: parts musi być dodatnią liczbą całkowitą, jest ${parts}`);
  }
  const total = range.to - range.from;
  if (total < 0) {
    throw new RangeError(`splitRange: zakres [${range.from}, ${range.to}) jest pusty od tyłu`);
  }
  const base = Math.floor(total / parts);
  const remainder = total % parts;

  const out: SeedRange[] = [];
  let cursor = range.from;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < remainder ? 1 : 0);
    out.push({ from: cursor, to: cursor + size });
    cursor += size;
  }
  return out;
}

/**
 * Skleja kawałki w jedną partię, **w kolejności seedów**.
 *
 * Sortowanie po `seed`, a nie zaufanie kolejności wejścia: kawałki wracają z procesów
 * w kolejności, w jakiej te skończyły, a ta zależy od obciążenia maszyny. Sortowanie
 * czyni wynik niezależnym od harmonogramu — czyli powtarzalnym.
 *
 * @throws {RangeError} gdy dwa kawałki niosą ten sam seed — to znaczy, że podział miał
 *   zakładkę, a partia policzyłaby część przebiegów dwa razy i po cichu przekrzywiła rozkład.
 */
export function mergeBatches(parts: readonly (readonly RunResult[])[]): RunResult[] {
  const all = parts.flat();
  const seen = new Set<number>();
  for (const r of all) {
    if (seen.has(r.seed)) {
      throw new RangeError(
        `mergeBatches: seed ${r.seed} występuje w dwóch kawałkach — podział miał zakładkę, ` +
          'a partia policzyłaby te przebiegi dwa razy.',
      );
    }
    seen.add(r.seed);
  }
  return all.sort((a, b) => a.seed - b.seed);
}
