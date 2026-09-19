import { DEFAULT_SPAWN, type SpawnConfig } from '../../src/sim/spawning.js';

/**
 * # Gęsta nastawa spawnu dla FIKSTUR — jedna definicja
 *
 * ## Po co istnieje
 *
 * Kilkanaście testów w tym pakiecie dowodzi rzeczy, które z balansem nie mają nic
 * wspólnego: że migawka wznawia się co do bitu, że akumulator spawnu gubi dokładnie jeden
 * egzemplarz na granicy `1/rate`, że skaner serializowalności chodzi po stanie z jednostkami,
 * że zwycięstwo pada przeciw realnym falom, a nie w pustce. **Każdy z nich potrzebuje
 * przebiegu GĘSTEGO** — przy rzadkim strumieniu „hash identyczny przez 400 ticków" jest
 * prawdą o dwóch prawie pustych stanach.
 *
 * Dopóki brały tempo z `DEFAULT_SPAWN`, były przywiązane do nastawy GRY. Zadanie 3 Fazy 3
 * zeszło z `baseRatePerPentagon` 0,25 na 0,05 i **szesnaście testów oblało naraz**, choć
 * żaden z dowodzonych niezmienników nie drgnął. Co ważne: oblały na swoich KONTROLACH
 * POZYTYWNYCH („przebieg naprawdę coś robił", „fikstura jest BOGATA"), czyli zadziałały
 * dokładnie tak, jak miały — i to one pokazały, że fikstura szła za balansem.
 *
 * Właściwą odpowiedzią nie jest poluzowanie przesłanek, tylko **odpięcie fikstur od
 * nastawy gry**. Ta sama decyzja i to samo uzasadnienie, co przy `GOLDEN_RUN_CONFIG`
 * w `golden-hash.test.ts`: fikstura idąca za balansem przestaje opisywać to, co opisywała.
 *
 * ## Skąd te liczby
 *
 * 0,25 i 1,35 to nastawa gry sprzed Zadania 3 — czyli ta, na której wyliczono wszystkie
 * liczby referencyjne w opisach tych testów (7 = floor(0,25 × 30), 4 s = 1/0,25, 144
 * zrodzonych na seedzie 102, 487 ticków na seedzie 101). Zamrożenie ich tutaj sprawia,
 * że te liczby dalej znaczą to, co znaczyły, i że **następne strojenie balansu niczego
 * tu nie ruszy**.
 *
 * Nie jest to nastawa docelowa gry i nie wolno jej za taką brać: gra ma dziś 0,05,
 * a uzasadnienie tej wartości stoi przy `DEFAULT_SPAWN` w `spawning.ts`.
 */
export const GESTY_SPAWN: SpawnConfig = {
  ...DEFAULT_SPAWN,
  baseRatePerPentagon: 0.25,
  growthPerCycle: 1.35,
};
