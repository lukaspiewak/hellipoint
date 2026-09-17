import {
  createRollingWindow,
  median,
  percentile,
  type OrbitCamera,
  type UnitShadingMode,
} from '@heliopolis/render';
import {
  createPlanet,
  lightFieldInto,
  sunDirection,
  TICK_SECONDS,
  type Building,
  type Planet,
  type RunConfig,
  type SimState,
  type Unit,
  type Vec3,
} from '@heliopolis/sim';
import {
  attachInput,
  createSelection,
  type CommandQueue,
  type ListenerTarget,
  type Selection,
} from './input.js';

/**
 * # Spięcie klienta (Faza 2C, Zadanie 2, runda naprawcza 2)
 *
 * Wszystko, co dzieje się między „mam płótno i symulację" a „na ekranie widać klatkę".
 * `main.ts` po tym module jest **czystym rozruchem**: znajdź `<canvas>`, zbuduj zależności,
 * zawołaj `wireClient`, pętla `requestAnimationFrame`. Nic więcej — i to jest jedyna forma
 * pokrycia, jaką moduł rozruchowy może mieć uczciwie.
 *
 * ## Dlaczego ten plik w ogóle istnieje
 *
 * Runda 1 przeniosła z `main.ts` treść NASŁUCHÓW i to zadziałało — drogi obejścia wstawione
 * do `input.ts` oblewają na własności. Ale w `main.ts` zostało SPIĘCIE, i tam wróciły
 * dokładnie te same dziury, piętro wyżej. Zmierzone w przeglądzie: `focusOn: () => {}`
 * (kasuje spację), `keys: canvas` (kasuje CAŁĄ klawiaturę), `setUnitShading` bez wywołania
 * sceny, usunięcie `input.refreshPointedCell()` (cofa naprawę świeżości z tej samej rundy)
 * — **każda z nich zostawiała 631/631 zielone**.
 *
 * Skan źródła, który miał tego pilnować, padał na **jednej parze zbędnych nawiasów**
 * (`(sim.state).ore = 999`) i na `sim['state']`. Poszerzanie wyrażenia rozpoznającego
 * kształt to wyścig bez mety: po nawiasach przyjdą nawiasy kwadratowe, po nich alias,
 * po nim `Reflect.set`. **Skan został skasowany w całości** razem z jego fałszywą
 * obietnicą; to, czego pilnował, pilnuje teraz własność mierzona na wykonanym kodzie.
 *
 * ## Czego tu NIE ma i dlaczego
 *
 * Wywołania zwrotne, które w runzie 1 przychodziły z `main.ts` (`focusOn`, `setUnitShading`),
 * są teraz WYPROWADZANE ze `scene` wewnątrz tego pliku. Nie da się ich podstawić z zewnątrz,
 * więc nie da się ich po cichu wykastrować — a test, który wykonuje `frame()` i naciska
 * spację na PRAWDZIWEJ kamerze, widzi, czy kamera faktycznie się ruszyła.
 */

/** Tyle ze `Sim`, ile widzi spięcie: kolejka, stan do ODCZYTU, krok i zegar. */
export interface ClientSim extends CommandQueue {
  step(): void;
  readonly elapsedSeconds: number;
  readonly cycle: number;
}

/** Tyle z `PlanetScene`, ile widzi spięcie. */
export interface ClientScene {
  readonly camera: Pick<OrbitCamera, 'object' | 'focusOn'>;
  updateBuildings(buildings: readonly (Building | null)[], alertPulseSeconds?: number): void;
  updateUnits(units: readonly Unit[], light: Float32Array): void;
  setUnitShading(mode: UnitShadingMode): void;
  render(light: Float32Array, sunDir: Vec3): void;
}

export interface ClientDeps {
  /**
   * Seed planety — a NIE gotowa `Planet`, i NIE gotowy `Sim`.
   *
   * Rozruch (`main.ts`) nie dostaje przez to uchwytu ani do stanu symulacji, ani do
   * planety, więc **żadnej z dróg łamania ograniczenia nadrzędnego nie da się w nim
   * zapisać bez wprowadzenia nowej zmiennej** — a to jest zmiana strukturalna, widoczna
   * w pliku, który cały mieści się na ekranie, a nie dopisek w jednej linii. Zmierzone
   * w przeglądzie rundy 1: `(sim.state).ore = 999` i `planet.cells[0].center.x += 1e-9`
   * wstawione do `main.ts` zostawiały 631/631 zielone.
   */
  readonly seed: number;
  /**
   * Fabryka sceny — `createScene` z `@heliopolis/render` w produkcji, atrapa w teście.
   * Wstrzykiwana, bo prawdziwa scena wymaga kontekstu WebGL, którego w Vitest/Node nie ma
   * (ten sam szew i to samo uzasadnienie, co `createSceneWithRenderer` w `scene.ts`).
   */
  makeScene(planet: Planet, canvas: HTMLCanvasElement): ClientScene;
  /** Fabryka symulacji — `new Sim(planet, run)` w produkcji. */
  makeSim(planet: Planet, run: RunConfig): ClientSim;
  readonly canvas: HTMLCanvasElement;
  /** Źródło zdarzeń klawiatury — w przeglądarce `window`. NIE płótno, patrz straż niżej. */
  readonly keys: ListenerTarget;
  readonly run: RunConfig;
  /** Zegar ścienny; wstrzykiwany, żeby test nie zależał od `performance` ani od upływu czasu. */
  now(): number;
  /** Ujście dla jednorazowej migawki budżetu — w przeglądrce `console.log`. */
  log(message: string): void;
}

export interface Client {
  /** Jedna klatka: symulacja, oświetlenie, wskazanie, render. Zwraca tekst nakładki. */
  frame(): string;
  /** Prostokąt płótna zmienił się (zdarzenie `resize`) — patrz `attachInput`. */
  invalidateCanvasRect(): void;
  detach(): void;
  readonly selection: Selection;
}

/** Ile klatek trzyma okno kroczące licznika. */
const FRAME_WINDOW = 1000;

/**
 * Najdłuższa przerwa między klatkami, jaką akumulator w ogóle przyjmuje. `[STROJENIE]` —
 * po powrocie z karty w tle (przeglądarka wstrzymuje `requestAnimationFrame`) różnica
 * czasu potrafi wynieść minuty, a bez tego sufitu symulacja próbowałaby je nadrobić
 * w jednej klatce. Powyżej tej wartości czas jest PO CICHU GUBIONY — to jest świadomy
 * handel „zgubić czas zamiast zamrozić kartę", a nie przeoczenie.
 */
export const MAX_FRAME_GAP_MS = 250; // [STROJENIE]

/**
 * Ile kroków symulacji wolno wykonać w JEDNEJ klatce. `[STROJENIE]` — druga połowa tej
 * samej ochrony: bez niej akumulator po długiej przerwie nakręca spiralę (im dłużej trwa
 * nadrabianie, tym większa następna zaległość). Faza 3, dając `sim.step()` własny budżet,
 * będzie tej liczby szukać greppem po tagu.
 */
export const MAX_STEPS_PER_FRAME = 5; // [STROJENIE]

export function wireClient(deps: ClientDeps): Client {
  // Zdarzenia klawiatury NIE docierają do `<canvas>`, dopóki nie ma on ogniskowej — a
  // `createScene` nigdy mu jej nie nadaje. Podanie tu płótna zamiast `window` kasuje CAŁĄ
  // klawiaturę (wybór typu, cieniowanie, skrót „wróć do Core") i jest przy tym całkowicie
  // ciche: nasłuch rejestruje się poprawnie i po prostu nigdy nie dostaje zdarzenia.
  // Zmierzone w przeglądzie jako 631/631 zielone. Skoro nie da się tego zobaczyć testem
  // zachowania (test podaje atrapę, która zdarzenia dostarcza), musi to być GŁOŚNY błąd
  // przy rozruchu — ten sam idiom, co straże `RangeError` w `createCamera`.
  if ((deps.keys as unknown) === (deps.canvas as unknown)) {
    throw new RangeError(
      'wireClient: `keys` nie może być płótnem — <canvas> bez atrybutu tabindex nigdy nie ' +
        'dostaje ogniskowej, więc żadne zdarzenie klawiatury do niego nie dotrze i CAŁA ' +
        'klawiatura (1-9, Shift+1/2/3, spacja) przestaje działać po cichu. Podaj `window`.',
    );
  }

  const { canvas, keys, run } = deps;
  const planet = createPlanet({ seed: deps.seed });
  const scene = deps.makeScene(planet, canvas);
  const sim = deps.makeSim(planet, run);
  const selection = createSelection();

  let lastMessage = 'lewy: buduj · prawy: rozbierz · 1-9: typ · spacja: wróć do Core';
  let shadingMode: UnitShadingMode = 'flat';

  const input = attachInput({
    planet,
    camera: scene.camera.object,
    canvas,
    keys,
    sim,
    selection,
    // Wyprowadzane ze `scene`, nie przyjmowane z zewnątrz — patrz „Czego tu NIE ma" wyżej.
    focusOn: (target) => scene.camera.focusOn(target),
    report: (message) => {
      lastMessage = message;
    },
    setUnitShading: (mode) => {
      shadingMode = mode;
      scene.setUnitShading(mode);
    },
  });

  // Budżet z `global-constraints.md` (8 ms na CAŁY render przy 1442 komórkach) mówi o czasie
  // PRACY per klatka, nie o odstępie między wywołaniami rAF (ten drugi to głównie odświeżanie
  // monitora, ok. 16,6 ms przy 60 Hz, NIEZALEŻNIE od tego, jak szybko skończyła się praca) —
  // mierzone jest więc dokładnie to, co Faza 0 mierzyła w P4 (§4 wyników). Czas symulacji
  // jest liczony OSOBNO i odejmowany: budżet 8 ms dotyczy RENDERU, a `sim.step()` dostanie
  // własny w Fazie 3.
  const frameTimes = createRollingWindow(FRAME_WINDOW);
  const simTimes = createRollingWindow(FRAME_WINDOW);
  let totalFrames = 0;
  let loggedBudgetOnce = false;

  // Bufor oświetlenia zaalokowany RAZ, poza pętlą — nie co klatkę. `lightField` zwraca
  // świeżą `Float32Array(1442)` (5768 B) przy każdym wywołaniu, czyli ok. 346 kB/s przy
  // 60 Hz, rzucane pod nogi odśmiecaczowi WEWNĄTRZ tej samej pętli, której czas raportuje
  // licznik klatek.
  const light = new Float32Array(planet.cells.length);

  let lastFrameAt = deps.now();
  let simAccumulator = 0;

  function hudText(state: SimState): string {
    const samples = frameTimes.snapshot();
    const cell = selection.selectedCell;
    return (
      `render: mediana ${median(samples).toFixed(3)} ms · p95 ${percentile(samples, 95).toFixed(3)} ms ` +
      `(n=${samples.length}) — budżet 8 ms\n` +
      `symulacja (osobny budżet): mediana ${median(simTimes.snapshot()).toFixed(3)} ms · ` +
      `tick ${state.tick} · cykl ${sim.cycle} · ${state.phase}\n` +
      `ruda ${state.ore.toFixed(0)} · jednostek ${state.units.length} · ` +
      `typ [1-9]: ${selection.selectedType} · wskazana komórka: ${cell === null ? '—' : cell}\n` +
      `${lastMessage}   (cieniowanie Shift+1/2/3: ${shadingMode})`
    );
  }

  let cachedHud = 'klatka: zbieranie danych…';

  return {
    selection,
    invalidateCanvasRect(): void {
      input.invalidateCanvasRect();
    },
    detach(): void {
      input.detach();
    },
    frame(): string {
      const frameStart = deps.now();

      // Symulacja w STAŁYM kroku (`TICK_SECONDS`), nie w kroku klatki — §7.2: nic
      // w symulacji nie wolno wiązać z czasem ściennym.
      const simStart = deps.now();
      simAccumulator += Math.min(frameStart - lastFrameAt, MAX_FRAME_GAP_MS) / 1000;
      lastFrameAt = frameStart;
      let steps = 0;
      while (simAccumulator >= TICK_SECONDS && steps < MAX_STEPS_PER_FRAME) {
        simAccumulator -= TICK_SECONDS;
        steps++;
        sim.step();
      }
      const simMs = deps.now() - simStart;
      simTimes.push(simMs);

      // Zegar RENDERU jest zegarem SYMULACJI, nie ściennym — inaczej terminator na ekranie
      // byłby gdzie indziej niż terminator, którym symulacja właśnie paliła jednostki,
      // a czytelność terminatora jest w tej gałęzi ograniczeniem nadrzędnym.
      // `simAccumulator` dokłada ułamek ticka jeszcze nierozliczonego, żeby przy 60 Hz
      // słońce szło gładko zamiast przeskakiwać 20 razy na sekundę o 0,1° (0,6 px).
      const renderSeconds = sim.elapsedSeconds + simAccumulator;
      const sunDir = sunDirection(renderSeconds, run.rotationPeriod);
      lightFieldInto(planet, sunDir, light);

      // Wskazanie przeliczane CO KLATKĘ z ostatniego znanego piksela, nie tylko na
      // `pointermove`: `OrbitControls` ma bezwładność, więc kamera jedzie jeszcze około
      // sekundy po zatrzymaniu myszy i przez cały ten czas ten sam piksel wskazuje kolejne
      // komórki. Wychodzi bez pracy, gdy ani kursor, ani kamera nie drgnęły.
      input.refreshPointedCell();

      // Render CZYTA stan symulacji i nigdy go nie zapisuje (`global-constraints.md`).
      scene.updateBuildings(sim.state.buildings, renderSeconds);
      scene.updateUnits(sim.state.units, light);
      scene.render(light, sunDir);

      frameTimes.push(deps.now() - frameStart - simMs);
      totalFrames++;

      // Odświeżanie tekstu co 10 klatek — nie co klatkę: sam zapis do DOM ma swój koszt,
      // a ma nie stać się zauważalną częścią tego, co mierzy.
      if (totalFrames % 10 === 0) cachedHud = hudText(sim.state);

      // Migawka „pierwsze 1000 klatek" RAZ, nie za każdym kolejnym tysiącem —
      // porównywalna z `budget.test.ts` (ten sam próg 1000 pomiarów).
      if (!loggedBudgetOnce && totalFrames >= FRAME_WINDOW) {
        loggedBudgetOnce = true;
        const samples = frameTimes.snapshot();
        const simSamples = simTimes.snapshot();
        deps.log(
          `[BUDGET] pierwsze ${FRAME_WINDOW} klatek renderu: mediana=${median(samples).toFixed(3)} ms, ` +
            `p95=${percentile(samples, 95).toFixed(3)} ms (budżet: 8 ms) — przy ${sim.state.units.length} ` +
            `jednostkach; symulacja OSOBNO: mediana=${median(simSamples).toFixed(3)} ms, ` +
            `p95=${percentile(simSamples, 95).toFixed(3)} ms`,
        );
      }

      return cachedHud;
    },
  };
}

/**
 * Kształt celu zdarzeń, jakiego wymaga `ClientDeps.keys`. Reeksport z `input.ts`, żeby
 * rozruch (`main.ts`) importował JEDEN moduł i nie musiał wiedzieć o wnętrzu wejścia.
 */
export type ListenerTargetLike = ListenerTarget;
