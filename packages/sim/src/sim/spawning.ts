import type { Rng } from '../math/rng.js';
import { spawnUnit } from './movement.js';
import { TICK_SECONDS, type EnemyType, type SimState } from './state.js';

export interface SpawnConfig {
  /** Jednostek na sekundę z jednego otwartego, zaciemnionego pentagonu w cyklu 1. */
  baseRatePerPentagon: number;
  /** Mnożnik tempa na każdy kolejny cykl. */
  growthPerCycle: number;
  /** Sekundy między erupcjami zatkanego pentagonu. */
  eruptionInterval: number;
  /** Liczba jednostek w erupcji przy jednym capie. */
  eruptionBurstBase: number;
  /** Przyrost siły erupcji na każdy postawiony cap. */
  eruptionScalePerCap: number;
  disruptorFromCycle: number;
  armorFromCycle: number;
}

// [STROJENIE] — cała ta tabela należy do Fazy 3 i headlessa.
export const DEFAULT_SPAWN: SpawnConfig = {
  /**
   * [STROJENIE] **0,05 — jedyna zmierzona nastawa, przy której H3 wchodzi w pasmo.**
   *
   * Zmierzone (Faza 3, Zadanie 3, 250 przebiegów na punkt przy `killRewardScale` 0,35):
   * 0,05 → mediana runu wygranego **32,1 min**, a 0,10 / 0,15 / 0,25 / 0,40 → 24,4 / 21,2 /
   * 20,6 / 20,4 min. Żadna inna oś nie ruszyła H3 z okolic 20,5 min ani o minutę.
   *
   * H1 jest w tej osi **niemonotoniczne** (16,0 / 30,0 / 40,8 / 46,4 / 34,4 %) ze szczytem
   * przy dawnych 0,25 i spadkiem po obu stronach: przy wysokim tempie z presji, przy niskim
   * z **ubóstwa** — mniej wrogów to mniej nagród, a wprawna nie ma innego dochodu. Spadek
   * po lewej odrabia `killRewardScale` 0,5; potwierdzone na 1 000 przebiegach:
   * H1 = 35,5 % ±3,0 i H3 = 27,3 min ±0,3, oba w paśmie.
   */
  baseRatePerPentagon: 0.05,
  growthPerCycle: 1.35,
  eruptionInterval: 20,
  eruptionBurstBase: 4,
  eruptionScalePerCap: 0.6,
  disruptorFromCycle: 3,
  armorFromCycle: 5,
};

/**
 * Realizacja §5.3: zatkanie pentagonu NIE kasuje spawnu — przekierowuje go. Otwarty,
 * zaciemniony pentagon wypuszcza ciągły ułamkowy strumień (`spawnAccumulator`).
 * Zatkany (GEOTHERMAL_CAP) przestaje to robić i zamiast tego erupuje w miejscu co
 * `eruptionInterval`, z siłą rosnącą wraz z LICZBĄ WSZYSTKICH capów na planecie — więc
 * capowanie wszystkich 12 nie usuwa zagrożenia, tylko przenosi je pod bazę gracza
 * (cap musi być podpięty do sieci, więc gracz capuje blisko siebie).
 *
 * Residual względem wersji z brief-u: `eruptionCooldown` startuje w `createState` na 0,
 * co bez `eruptionArmed` czyni je nieodróżnialnym od "właśnie odliczyło do zera" —
 * pierwsza erupcja wystrzeliwałaby w TYM SAMYM ticku, w którym stanął cap, zamiast po
 * pełnym interwale (złapane przez test "zatkany pentagon nie wypuszcza ciągłego
 * strumienia" w krótkim oknie poniżej interwału — patrz task-4-report.md). `eruptionArmed`
 * zapewnia, że pierwsze uzbrojenie liczników PO (po)nownym zatkaniu ustawia pełny
 * interwał zamiast fałszywie "przeterminowanego" zera.
 *
 * ZEGAR ERUPCJI NALEŻY DO PENTAGONU, NIE DO CAPA (rozstrzygnięcie z przeglądu Taska 4,
 * patrz task-4-fix-report.md, punkt 1): `eruptionCooldown`/`eruptionArmed` ZAMRAŻAJĄ SIĘ,
 * gdy pentagon przestaje być zatkany — nie zerują się. Dwa niezależne wyzwalacze
 * zamrożenia (światło — strażnik D1 na górze pętli; brak capa — gałąź niżej) realizują
 * TĘ SAMĄ zasadę: ciśnienie siedzi w kominie (pentagonie), nie w pokrywie (capie), więc
 * zdjęcie pokrywy go nie upuszcza. Wcześniejsza wersja zerowała `eruptionArmed` przy
 * odkapowaniu — dawało to darmowy exploit: rozbiórka+odbudowa capa (płaski koszt ok. 38
 * rudy — 75 kosztu minus 37 zwrotu z DEMOLISH) w nieskończoność odsuwała rosnącą z
 * `capCount` erupcję, więc capowanie wszystkich 12 STAWAŁO SIĘ strategią wygrywającą
 * zamiast dowodem na to, że nią nie jest (cały sens §5.3).
 */
export function updateSpawning(
  s: SimState,
  light: Float32Array,
  rng: Rng,
  cycle: number,
  cfg: SpawnConfig,
): void {
  const capCount = countCaps(s);
  const rate = cfg.baseRatePerPentagon * Math.pow(cfg.growthPerCycle, cycle - 1);
  assertReleasable(s, rate * TICK_SECONDS, 'spawn rate', {
    cycle,
    baseRatePerPentagon: cfg.baseRatePerPentagon,
    growthPerCycle: cfg.growthPerCycle,
  });

  for (let i = 0; i < s.planet.pentagons.length; i++) {
    const cellId = s.planet.pentagons[i];
    const ps = s.pentagons[i];

    // D1: pentagon w świetle jest martwy, niezależnie od wszystkiego innego —
    // odliczanie erupcji też stoi w miejscu, nie tylko strumień ciągły.
    if (light[cellId] > 0) continue;

    const capped = s.buildings[cellId]?.type === 'GEOTHERMAL_CAP';

    if (capped) {
      // §5.3: cap PRZEKIEROWUJE spawn zamiast go kasować.
      // Strumień ustaje, ale ciśnienie wraca jako okresowa erupcja w tym samym miejscu,
      // rosnąca z liczbą capów — czyli gracz sam ściąga sobie bombę pod dom.
      if (!ps.eruptionArmed) {
        // Świeże zatkanie: uzbrój pełnym interwałem, NIE erupuj w tym ticku.
        ps.eruptionCooldown = cfg.eruptionInterval;
        ps.eruptionArmed = true;
      }

      ps.eruptionCooldown -= TICK_SECONDS;
      if (ps.eruptionCooldown <= 0) {
        ps.eruptionCooldown += cfg.eruptionInterval;
        const burst = Math.round(
          cfg.eruptionBurstBase * (1 + cfg.eruptionScalePerCap * (capCount - 1)),
        );
        assertReleasable(s, burst, 'eruption burst', {
          eruptionBurstBase: cfg.eruptionBurstBase,
          eruptionScalePerCap: cfg.eruptionScalePerCap,
          capCount,
        });
        for (let k = 0; k < burst; k++) {
          spawnUnit(s, pickType(rng, cycle, cfg), cellId);
        }
      }
      continue;
    }

    // Odkapowany (albo nigdy nie zakapowany) pentagon NIE dotyka eruptionCooldown/
    // eruptionArmed — odliczanie (jeśli już uzbrojone) po prostu ZAMRAŻA SIĘ, tak samo
    // jak robi to D1 dla światła (patrz strażnik na górze pętli). Zegar erupcji należy
    // do PENTAGONU (ciśnienie w kominie), nie do capa (pokrywy): zdjęcie pokrywy nie
    // zeruje ciśnienia, więc rozbiórka+odbudowa capa nie kupuje graczowi ani sekundy —
    // usuwa to realny exploit (poprzednia wersja z `eruptionArmed = false` tutaj
    // resetowała odliczanie do pełnego interwału przy KAŻDYM cyklu rozbiórka-odbudowa,
    // za płaski koszt ~38 rudy/cykl, tłumiąc rosnącą z capCount erupcję za darmo —
    // patrz task-4-fix-report.md, punkt 1).
    ps.spawnAccumulator += rate * TICK_SECONDS;
    while (ps.spawnAccumulator >= 1) {
      ps.spawnAccumulator -= 1;
      spawnUnit(s, pickType(rng, cycle, cfg), cellId);
    }
  }
}

/**
 * STRAŻ NA WIELKOŚCI POCHODNEJ — `rate` i `burst` wyliczają się ze składników, z których
 * KAŻDY Z OSOBNA przechodzi walidację w konstruktorze `Sim`. Ta sama rodzina, co `angle`
 * w `sunDirection` przy `rotationPeriod = 1e-320` (light.ts) i `angleStep`
 * w `updateMovement`: wartość wewnątrz dziedziny, której pochodna już w niej nie jest.
 *
 * **Skończoność NIE WYSTARCZY, i to jest zmierzone.** `growthPerCycle = 1e200`
 * (skończony, dodatni, ≥ 1 — przechodzi walidację pól) daje na cyklu 2 tempo
 * `2,5e199`/s, czyli `1,25e198` jednostek na tick z jednego pentagonu. To jest wartość
 * SKOŃCZONA, więc straż `Number.isFinite` by ją przepuściła — a pętla wypuszczająca
 * i tak nie ma szans się skończyć. Kontrola pozytywna na pełnym `Sim`: proces padł po
 * 18 s z `FATAL ERROR: JavaScript heap out of memory` przy 4 GB; pierwsza wersja tego
 * testu wywróciła workera vitesta z SIGABRT.
 *
 * Górna granica jest **STRUKTURALNA, nie balansowa** (stąd brak `[STROJENIE]`): jeden
 * komin nie może w jednym ticku wypuścić więcej jednostek, niż planeta ma komórek —
 * powyżej tego nie jest to już wielkość rozgrywkowa, tylko rozbieg. Dobrana tak samo,
 * jak granica w `updateMovement`: z niezmiennika struktury, nie z tabeli strojenia.
 * Przy domyślnym `growthPerCycle = 1,35` granica zostaje przekroczona dopiero
 * w okolicach cyklu 40 (≈ 2 godziny gry przy obrocie 180 s), więc normalnej rozgrywki
 * nie dotyka.
 */
function assertReleasable(
  s: SimState,
  perTick: number,
  co: string,
  kontekst: Record<string, number>,
): void {
  const limit = s.planet.cells.length;
  if (Number.isFinite(perTick) && perTick <= limit) return;
  const opis = Object.entries(kontekst).map(([k, v]) => `${k}=${v}`).join(', ');
  throw new RangeError(
    `updateSpawning: ${co} released ${perTick} units from a single vent in one tick — more than the planet has cells (${limit}). ${opis}. ` +
      'A value this large (or non-finite) makes the release loop effectively non-terminating, ' +
      'so it is rejected here rather than exhausting memory. Lower baseRatePerPentagon/growthPerCycle ' +
      'or eruptionBurstBase/eruptionScalePerCap in SpawnConfig.',
  );
}

function countCaps(s: SimState): number {
  let n = 0;
  for (const cellId of s.planet.pentagons) {
    if (s.buildings[cellId]?.type === 'GEOTHERMAL_CAP') n++;
  }
  return n;
}

function pickType(rng: Rng, cycle: number, cfg: SpawnConfig): EnemyType {
  const pool: EnemyType[] = ['SWARM'];
  if (cycle >= cfg.disruptorFromCycle) pool.push('DISRUPTOR');
  if (cycle >= cfg.armorFromCycle) pool.push('ARMOR');
  return pool[rng.nextInt(pool.length)];
}
