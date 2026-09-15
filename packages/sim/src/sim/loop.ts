import { Rng } from '../math/rng.js';
import type { Planet } from '../world/planet.js';
import { updateBurning } from './burning.js';
import { updateCombat } from './combat.js';
import { applyCommand, type Command } from './commands.js';
import { BUILDINGS } from './defs.js';
import { updateEconomy } from './economy.js';
import { buildAllFlowFields } from './flowfield.js';
import { lightField, sunDirection } from './light.js';
import type { MotionContext } from './movement.js';
import {
  minRotationPeriod,
  motionContext,
  motionIsSimulable,
  updateMovement,
} from './movement.js';
import { updatePower } from './power.js';
import { currentCycle, updateRules, type RunConfig } from './rules.js';
import { updateSpawning } from './spawning.js';
import { createState, TICK_SECONDS, type SimState } from './state.js';

/** [STROJENIE] Co ile ticków przeliczane są pola przepływu. 4 ticki = 5 Hz (§4.5). */
export const FLOWFIELD_INTERVAL_TICKS = 4;

/**
 * Czy z migawki `SimState` zrobionej w tym ticku da się wznowić przebieg CO DO BITU.
 * Eksportowane, bo zapis/resynchronizacja Fazy 5 musi umieć wybrać moment migawki —
 * uzasadnienie granicy: patrz straż w konstruktorze `Sim` niżej.
 */
export const isResumableTick = (tick: number): boolean =>
  Number.isInteger(tick) && tick >= 0 && tick % FLOWFIELD_INTERVAL_TICKS === 0;

export class Sim {
  readonly config: RunConfig;
  private readonly s: SimState;
  private readonly pending: Command[] = [];
  private readonly motion: MotionContext;
  private readonly waveRng: Rng;
  private fields: ReturnType<typeof buildAllFlowFields>;

  /**
   * `snapshot` — wznowienie z zapisanego `SimState` (Faza 5: wczytanie gry,
   * resynchronizacja klienta). Podany stan jest PRZEJMOWANY (płytka kopia z podmienioną
   * `planet`, bo planetę odtwarza się z seeda, nie z zapisu), nie kopiowany głęboko.
   */
  constructor(planet: Planet, config: RunConfig, snapshot?: SimState) {
    // `!(x > 0)` NIE łapie Infinity (Infinity > 0 jest prawdziwe) — stąd Number.isFinite.
    // Walidacja tu, a nie w scale.ts, chroni WSZYSTKICH konsumentów rotationPeriod naraz:
    // terminatorSpeedWorld/terminatorSpeedCells/terminatorCrossingTime dzielą przez nie
    // bez żadnej straży i po cichu dają Infinity/0 zamiast rzucić błąd.
    if (!Number.isFinite(config.rotationPeriod) || config.rotationPeriod <= 0) {
      throw new RangeError(`RunConfig.rotationPeriod must be finite and positive, got ${config.rotationPeriod}`);
    }
    // Druga warstwa tej samej straży, na poziomie DOMENY zamiast arytmetyki: finite
    // i dodatni nie wystarczy. Poprzednia wersja stawiała tu podłogę `TICK_SECONDS`
    // ("Słońce nie może zrobić pełnego obrotu wewnątrz jednego ticka") — rozumowanie
    // słuszne, ale granica ZA NISKA o dwa rzędy wielkości, więc straż nie robiła tego,
    // co obiecywała: `rotationPeriod = 0,05` konstruowało się bez słowa i dopiero
    // `.step()` rzucał `RangeError` w ticku 12, z komunikatem o `speedFactor`
    // i `MotionContext` — czyli o wszystkim poza jedynym polem, które wołający ustawił.
    //
    // Prawdziwa podłoga wynika z niezmiennika `updateMovement`: krok kątowy NAJSZYBSZEGO
    // wroga musi zostać PONIŻEJ kątowego rozstawu komórek (inaczej `nearestLocalCell`
    // przeskakuje sąsiada, którego w ogóle nie widzi). Wyprowadzenie i pomiar — patrz
    // `minRotationPeriod` w movement.ts; dla planety domyślnej wychodzi 7,2031 s, co
    // zgadza się z pomiarem z przeglądu gałęzi co do czwartego miejsca po przecinku.
    //
    // Sprawdzane tym SAMYM predykatem, którego używa pętla ruchu (`motionIsSimulable`
    // na tym samym `MotionContext`, który dostanie `updateMovement`), a nie niezależnie
    // przeliczoną liczbą: obie strony liczone osobno rozjeżdżają się o 1-2 ULP-y, więc
    // zostawiłyby wąskie pasmo wartości przyjmowanych tutaj i odrzucanych tam.
    this.motion = motionContext(planet, config.rotationPeriod);
    if (!motionIsSimulable(this.motion)) {
      throw new RangeError(
        `RunConfig.rotationPeriod=${config.rotationPeriod} is too short to simulate on this planet: ` +
          `the fastest enemy would cover at least one whole cell per tick, so unit cellId would silently ` +
          `drift away from its true position. Minimum that works here: ${minRotationPeriod(planet)}s ` +
          `(derived from the planet's ${planet.cells.length} cells and the fastest speedFactor in ENEMIES).`,
      );
    }
    if (!Number.isFinite(config.startingOre) || config.startingOre < 0) {
      throw new RangeError(`RunConfig.startingOre must be finite and non-negative, got ${config.startingOre}`);
    }
    // Pozostałe sześć pól `RunConfig`, tym samym idiomem `Number.isFinite`. DWA z nich
    // wpływają wprost do `SimState`: `cyclesPerRun` → `evacUnlockTick`, `evacAlarmSeconds`
    // → `evacAlarmRemaining`. Bez tych straży `NaN`/`Infinity` z konfiguracji ląduje
    // w stanie, a `JSON.stringify` zamienia je na `null` — i po wczytaniu zapisu w Fazie 5
    // `s.tick < null` jest fałszem NA ZAWSZE (bramka §5.6 odwraca się w „zawsze otwarta"),
    // a `null >= 0` i `null - 0.05 <= ALARM_EPSILON` są jednocześnie prawdziwe, więc
    // PIERWSZY tick po wczytaniu ogłasza zwycięstwo. Dokładnie tryb awarii z komentarza
    // niezmiennika w state.ts, tyle że wchodzący przez konfigurację, nie przez sentinel.
    if (!Number.isInteger(config.cyclesPerRun) || config.cyclesPerRun < 1) {
      throw new RangeError(
        `RunConfig.cyclesPerRun must be an integer >= 1, got ${config.cyclesPerRun}`,
      );
    }
    // Ułamek, nie „cokolwiek dodatniego": > 1 znaczyłoby próg poza zadeklarowaną długością
    // runu, a 0 — Evac dostępny od pierwszego ticka (dopuszczalne, np. run jednocyklowy).
    if (
      !Number.isFinite(config.evacUnlockFraction) ||
      config.evacUnlockFraction < 0 || config.evacUnlockFraction > 1
    ) {
      throw new RangeError(
        `RunConfig.evacUnlockFraction must be a finite fraction in [0, 1], got ${config.evacUnlockFraction}`,
      );
    }
    // Te trzy ostro dodatnie, nie nieujemne: zero po cichu USUWA mechanikę, którą §5.6
    // nazywa z osobna (ładowanie, tempo ładowania, przetrwanie alarmu), zamiast ją
    // wyłącznie przestroić. Brak straży dawałby zwycięstwo w ticku postawienia modułu.
    if (!Number.isFinite(config.evacEnergyRequired) || config.evacEnergyRequired <= 0) {
      throw new RangeError(
        `RunConfig.evacEnergyRequired must be finite and positive, got ${config.evacEnergyRequired}`,
      );
    }
    if (!Number.isFinite(config.evacChargeRate) || config.evacChargeRate <= 0) {
      throw new RangeError(
        `RunConfig.evacChargeRate must be finite and positive, got ${config.evacChargeRate}`,
      );
    }
    if (!Number.isFinite(config.evacAlarmSeconds) || config.evacAlarmSeconds <= 0) {
      throw new RangeError(
        `RunConfig.evacAlarmSeconds must be finite and positive, got ${config.evacAlarmSeconds}`,
      );
    }
    if (typeof config.spawn !== 'object' || config.spawn === null) {
      throw new RangeError(`RunConfig.spawn must be a SpawnConfig object, got ${config.spawn}`);
    }
    // Pola `SpawnConfig`. Ta sama droga do `SimState`, co dwa pola wyżej: `rate` z dwóch
    // pierwszych wpływa do `pentagons[].spawnAccumulator`, `eruptionInterval` wprost do
    // `pentagons[].eruptionCooldown`. Wartość zdegenerowana NIE wywala się głośno —
    // `for (k = 0; k < NaN; k++)` to zero iteracji, a `cycle >= NaN` to `false`, więc typ
    // wroga po prostu nigdy się nie pojawia. Faza 3 buduje te konfiguracje programowo dla
    // tysięcy runów i dostałaby ciche śmieci w rozkładach, na których opiera strojenie.
    const spawn = config.spawn;
    if (!Number.isFinite(spawn.baseRatePerPentagon) || spawn.baseRatePerPentagon <= 0) {
      throw new RangeError(
        `RunConfig.spawn.baseRatePerPentagon must be finite and positive, got ${spawn.baseRatePerPentagon}`,
      );
    }
    // `>= 1`, nie „dodatni": mnożnik poniżej 1 znaczyłby, że fale SŁABNĄ z każdym cyklem,
    // co odwraca model narastającego ciśnienia z §5.3. Dokładnie 1 jest legalne — daje
    // tempo stałe, użyteczne jako punkt odniesienia w headlessie Fazy 3.
    if (!Number.isFinite(spawn.growthPerCycle) || spawn.growthPerCycle < 1) {
      throw new RangeError(
        `RunConfig.spawn.growthPerCycle must be finite and at least 1, got ${spawn.growthPerCycle}`,
      );
    }
    // Podłoga jednego ticka, tym samym rozumowaniem co `rotationPeriod` wyżej. Interwał
    // krótszy niż tick znaczy erupcję w KAŻDYM ticku, a `eruptionCooldown` ucieka w minus
    // bez ograniczenia, bo `-= TICK_SECONDS` przeważa nad `+= eruptionInterval`.
    // Zmierzone dla interwału 0,01 s: po 200 tys. ticków cooldown wynosi −8000.
    if (!Number.isFinite(spawn.eruptionInterval) || spawn.eruptionInterval < TICK_SECONDS) {
      throw new RangeError(
        `RunConfig.spawn.eruptionInterval must be at least one tick (${TICK_SECONDS}s), got ${spawn.eruptionInterval} — a shorter interval erupts every tick and drives eruptionCooldown negative without bound`,
      );
    }
    // `>= 1`: erupcja ma wypuścić co najmniej jedną jednostkę. NIE wymagamy całkowitości —
    // `updateSpawning` i tak zaokrągla dopiero ILOCZYN (`eruptionBurstBase × skala`), więc
    // ułamkowa baza jest sensownym pokrętłem strojenia, a nie błędem konfiguracji.
    if (!Number.isFinite(spawn.eruptionBurstBase) || spawn.eruptionBurstBase < 1) {
      throw new RangeError(
        `RunConfig.spawn.eruptionBurstBase must be finite and at least 1, got ${spawn.eruptionBurstBase}`,
      );
    }
    // `>= 0`, w odróżnieniu od pól ewakuacji: zero NIE usuwa tu mechaniki, tylko jej
    // skalowanie — erupcje nadal wybuchają, po prostu nie rosną z liczbą capów. Ujemny
    // odwracałby §5.3 (capowanie ZMNIEJSZałoby erupcje) i mógłby dać ujemny `burst`.
    if (!Number.isFinite(spawn.eruptionScalePerCap) || spawn.eruptionScalePerCap < 0) {
      throw new RangeError(
        `RunConfig.spawn.eruptionScalePerCap must be finite and non-negative, got ${spawn.eruptionScalePerCap}`,
      );
    }
    // Progi cyklu: całkowite >= 1, bo `cycle` jest całkowity i numerowany od 1. `isInteger`
    // odcina przy okazji NaN/Infinity, których `cycle >= x` nie odróżniłoby od „nigdy".
    for (const pole of ['disruptorFromCycle', 'armorFromCycle'] as const) {
      if (!Number.isInteger(spawn[pole]) || spawn[pole] < 1) {
        throw new RangeError(
          `RunConfig.spawn.${pole} must be an integer >= 1, got ${spawn[pole]}`,
        );
      }
    }

    this.config = config;
    // Migawka MUSI trafić w granicę przeliczania pól przepływu. Pola są czystą funkcją
    // `buildings`, ale NIE leżą w `SimState` (niosą `Infinity` — patrz niezmiennik
    // serializowalności w state.ts), więc `Sim` wznowiony w ticku T odbudowuje je
    // z `buildings@T`, podczas gdy oryginał używał w tym ticku pola zbudowanego
    // w ticku 4⌊T/4⌋. Zmierzone: wznowienie poza granicą rozjeżdża hash po 1 ticku
    // (15 z 241 przemiecionych ticków zapisu; te, w których zabudowa zmieniła się
    // w oknie), a NA granicy jest identyczne co do bitu przez 400+ ticków.
    // Odrzucane GŁOŚNO tutaj, zamiast cicho rozjeżdżać się później.
    if (snapshot !== undefined && !isResumableTick(snapshot.tick)) {
      throw new RangeError(
        `SimState snapshot at tick ${snapshot.tick} cannot be resumed bit-identically: flow fields ` +
          `are rebuilt every ${FLOWFIELD_INTERVAL_TICKS} ticks and that cache is NOT part of SimState, ` +
          `so a snapshot taken off the boundary resumes with a differently-phased cache. Take the ` +
          `snapshot at a tick where tick % ${FLOWFIELD_INTERVAL_TICKS} === 0 (see isResumableTick).`,
      );
    }
    // Płytka kopia z podmienioną planetą: planetę odtwarza się z seeda (`createPlanet`
    // jest deterministyczne), nie z zapisu — po round-tripie JSON byłaby i tak zwykłym
    // obiektem danych, a tak `Sim` i wołający patrzą na TĘ SAMĄ instancję.
    this.s = snapshot === undefined
      ? createState(planet, config.startingOre)
      : { ...snapshot, planet };
    // Pozycja, nie seed: `Rng.fromState` kontynuuje sekwencję dokładnie tam, gdzie
    // migawka ją zostawiła. Dla świeżego stanu `createState` wstawił pozycję startową,
    // więc ta sama linia obsługuje oba przypadki bez rozgałęzienia.
    this.waveRng = Rng.fromState(this.s.waveRng);

    // §5.6: Evac odblokowany dopiero w ostatniej tercji runu. Próg liczony TUTAJ, bo tu
    // — i tylko tu — konfiguracja jest znana, a zapisywany do stanu jako TICK, bo
    // egzekwuje go `canBuild`, która widzi wyłącznie `SimState` (patrz doc-comment
    // `evacUnlockTick` w state.ts). Cykl N zaczyna się po (N-1) pełnych obrotach, stąd
    // `unlockCycle - 1`. `Math.max(0, …)` na wypadek `evacUnlockFraction <= 0`, gdzie
    // `unlockCycle` wychodzi 0 i iloczyn byłby ujemny.
    const unlockCycle = Math.ceil(config.cyclesPerRun * config.evacUnlockFraction);
    const unlockTick = Math.max(
      0,
      Math.ceil(((unlockCycle - 1) * config.rotationPeriod) / TICK_SECONDS),
    );
    // Straż na WYNIKU, nie tylko na wejściach — ten sam idiom i to samo uzasadnienie, co
    // przy `angle` w `sunDirection` (light.ts): każde wejście z osobna może przejść
    // walidację, a iloczyn i tak przepełnić się do Infinity. Zmierzone: `rotationPeriod`
    // rzędu 1e308 jest skończony i większy od ticka, więc przechodzi obie straże wyżej,
    // ale `(unlockCycle − 1) × 1e308` to już Infinity — czyli nieskończoność w `SimState`
    // mimo poprawnej konfiguracji. Straż należy tam, gdzie wartość faktycznie staje się zła.
    if (!Number.isFinite(unlockTick)) {
      throw new RangeError(
        `RunConfig: evacUnlockTick overflowed to a non-finite value — cyclesPerRun=${config.cyclesPerRun}, evacUnlockFraction=${config.evacUnlockFraction}, rotationPeriod=${config.rotationPeriod}`,
      );
    }
    this.s.evacUnlockTick = unlockTick;

    // CORE na komórce startowej: punkt wyjścia runu, nie decyzja gracza — więc bez kosztu
    // i WPROST do stanu, nie przez `applyCommand`. `canBuild` odrzuca CORE niezależnie od
    // komórki (`playerBuildable: false`), bo inaczej gracz mnożyłby go za darmo — zmierzone
    // przed wprowadzeniem tej flagi: 50 rdzeni przy zerowej rudzie, bo `CORE.costOre = 0`,
    // a `CELL_OCCUPIED` chroni tylko TĘ SAMĄ komórkę przed drugim CORE, nie planetę przed
    // setnym. Przy warunku przegranej `!buildings.some(b => b?.type === 'CORE')` (§5.6)
    // dawałoby to darmową nieśmiertelność. Ten sam zapis stosują pomocniki testowe Fazy 1B.
    //
    // WYŁĄCZNIE dla świeżego runu: wznowienie z migawki dostaje zabudowę z zapisu, a tam
    // CORE mógł już zostać zniszczony (warunek przegranej §5.6) albo mieć nadgryzione hp.
    // Zasiew na wznowieniu wskrzeszałby go z pełnym hp przy KAŻDYM wczytaniu.
    if (snapshot === undefined) {
      this.s.buildings[planet.startCell] = {
        cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
      };
    }

    // Pola przepływu zbudowane od razu, żeby `fields` nie było nullowalne: harmonogram
    // w `step()` jest wtedy funkcją SAMEGO `tick` (patrz komentarz tamże), a nie „tick
    // albo brak cache'u". Dla świeżego `Sim` (tick 0) i dla wznowienia na granicy
    // pierwszy `step()` i tak przelicza je ponownie — ta wartość jest kosztem jednej
    // Dijkstry na konstrukcję i ceną za usunięcie gałęzi, która psuła wznawialność.
    this.fields = buildAllFlowFields(this.s);
  }

  get state(): SimState { return this.s; }
  get elapsedSeconds(): number { return this.s.tick * TICK_SECONDS; }
  get cycle(): number { return currentCycle(this.elapsedSeconds, this.config.rotationPeriod); }

  enqueue(cmd: Command): void { this.pending.push(cmd); }

  /**
   * Kolejność systemów jest CZĘŚCIĄ KONTRAKTU DETERMINIZMU (global-constraints.md).
   *
   * **Czego NIE pilnują testy determinizmu.** Wcześniejsza wersja tego komentarza
   * odsyłała do nich — niesłusznie. Porównują one przebieg SAM ZE SOBĄ, więc są zielone
   * pod KAŻDĄ stałą permutacją tych dziesięciu wywołań. Zmierzone osobno dla wszystkich
   * dziewięciu par sąsiednich (10 systemów = 9 ogniw), pełny przebieg 6000 ticków
   * z ekstraktorem, wieżami, panelami i murem, porównanie po `stateHash` i licznikach:
   *
   * | ogniwo | czym przypięte |
   * |---|---|
   * | komendy ↔ oświetlenie | **KOMUTUJE** — `lightField` nie czyta stanu mutowalnego |
   * | oświetlenie ↔ energia | **KOMPILATOR** — TS2448, `light` użyte przed deklaracją |
   * | energia ↔ ekonomia | test `ekstraktor postawiony w tym ticku już w nim wydobywa` |
   * | ekonomia ↔ pola przepływu | **KOMUTUJE** — pola czytają `buildings`, ekonomia pisze `ore` |
   * | pola przepływu ↔ ruch | **KOMPILATOR** — TS2448, `fields` użyte przed deklaracją |
   * | ruch ↔ walka | test `jednostka atakuje z komórki, do której właśnie weszła` |
   * | walka ↔ spalanie | test `jednostka gasnąca od słońca zadaje jeszcze swój ostatni cios` |
   * | spalanie ↔ fale | **KOMUTUJE** — spawn wypuszcza wyłącznie w ciemność (D1), więc
   *   `updateBurning` i tak nic by z nowymi jednostkami nie zrobił (`exposure = 0`) |
   * | fale ↔ warunki końca | **KOMUTUJE** — reguły nie czytają `units` ani `pentagons` |
   *
   * Cztery ogniwa KOMUTUJĄ i jest to **zmierzone, nie domniemane**: zamiana daje hash
   * i liczniki identyczne co do bitu przez cały przebieg. Test behawioralny na takie
   * ogniwo byłby testem, który nie może oblać — dokładnie rodzaj defektu, który ten
   * projekt tropi. NIE PISZ ICH. Same wywołania w zadeklarowanej kolejności pilnuje
   * strukturalnie `kolejność wywołań systemów w źródle step()` (fullrun.test.ts),
   * czytający ten plik.
   */
  step(): void {
    if (this.s.phase !== 'RUNNING') {
      // Kolejka opróżniana TAKŻE tutaj, nie tylko w ścieżce RUNNING niżej. Dwa powody,
      // oba realne w Fazie 5, gdzie klient może wysyłać komendy po końcu meczu:
      //  • kolejka nie rośnie bez ograniczeń (zmierzone przed poprawką: 1000 komend
      //    wysłanych, 1000 wciąż rezydujących),
      //  • komenda zakolejkowana po końcu runu nie może przeleżeć do chwili, w której
      //    faza wróciłaby do RUNNING, i wykonać się z opóźnieniem.
      this.pending.length = 0;
      return;
    }

    // 1. Komendy — zawsze pierwsze, żeby tick widział świat już zmieniony.
    for (const cmd of this.pending) applyCommand(this.s, cmd);
    this.pending.length = 0;

    // 2. Oświetlenie — liczone raz i podawane pozostałym systemom.
    const sun = sunDirection(this.elapsedSeconds, this.config.rotationPeriod);
    const light = lightField(this.s.planet, sun);

    // 3. Energia — musi być przed ekonomią i walką, bo ustawia flagi `powered`.
    updatePower(this.s, light);

    // 4. Ekonomia — po energii, bo wydobycie zależy od flagi `powered`.
    updateEconomy(this.s);

    // 5. Pola przepływu — przeliczane rzadziej niż co tick, zabudowa zmienia się wolno (§4.5).
    // Harmonogram jest funkcją SAMEGO `tick` — poprzedni warunek miał jeszcze człon
    // `this.fields === null ||` i to właśnie on psuł wznawialność: `Sim` wczytany w ticku
    // T poza granicą przeliczał pola W TYM ticku, podczas gdy oryginał używał wtedy pola
    // zbudowanego w 4⌊T/4⌋ (zmierzone: rozjazd hasza po 1 ticku). Cache jest teraz
    // przygotowany w konstruktorze, a granicę migawki egzekwuje `isResumableTick`.
    if (this.s.tick % FLOWFIELD_INTERVAL_TICKS === 0) {
      this.fields = buildAllFlowFields(this.s);
    }
    const fields = this.fields;

    // 6. Ruch.
    updateMovement(this.s, fields, light, sun, this.motion);

    // 7. Walka — po ruchu, bo jednostka atakuje z komórki, do której właśnie weszła.
    updateCombat(this.s, fields);

    // 8. Spalanie — po walce, bo `updateBurning` nalicza rudę wyłącznie za własne ofiary
    //    i polega na tym, że walka zabrała swoich zabitych wcześniej (patrz burning.ts).
    updateBurning(this.s, light);

    // 9. Fale i spawn.
    updateSpawning(this.s, light, this.waveRng, this.cycle, this.config.spawn);
    // Pozycja generatora wraca do stanu w KAŻDYM ticku, nie „przy zapisie": migawką jest
    // samo `SimState` (`sim.state` bywa serializowane przez wołającego w dowolnej chwili),
    // więc nie ma innego momentu, w którym dałoby się ją jeszcze dopisać.
    this.s.waveRng = this.waveRng.getState();

    // 10. Warunki końca — ostatnie, żeby widziały świat po wszystkich zmianach ticka.
    updateRules(this.s, this.config);

    this.s.tick++;
  }
}
