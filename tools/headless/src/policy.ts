import {
  BUILDINGS,
  canBuild,
  cellsWithinSteps,
  connectedToCore,
  type BuildingType,
  type Command,
  type Sim,
} from '@heliopolis/sim';

/**
 * [STROJENIE eksperymentu, task-6-report.md runda poprawek 2] Cena najtańszej
 * wieży — próg rezerwy w `decide()` poniżej. Liczona z `BUILDINGS`, nie zaszyta
 * na sztywno, żeby nie rozjechać się z kosztami w defs.ts, gdyby Faza 3 je zmieniła.
 */
const RESERVE_ORE = Math.min(BUILDINGS.LASER_TURRET.costOre, BUILDINGS.KINETIC_TURRET.costOre);

/**
 * Zmierzony wybór (task-6-report.md, runda poprawek 2, eksperyment z wyjątkiem
 * dla ekstraktora): czy ekstraktor wolno postawić mimo rezerwy. Hipoteza przed
 * pomiarem: ekstraktor jako jedyny zakup zwiększa dochód, więc trzymanie się
 * rezerwy przy słabym wydobyciu mogłoby zablokować wzrost ekonomii, zanim
 * w ogóle będzie co chronić. Zmierzone OBA warianty na 1000 seedach (0-999,
 * DEFAULT_RUN) — hipoteza się NIE potwierdziła:
 *
 *   Z wyjątkiem (ekstraktor poza rezerwą):    mediana porażki 42,5 s,
 *     mediana wież/run = 0, 60,4% runów nigdy nie stawia wieży.
 *   BEZ wyjątku (ekstraktor też pod rezerwą): mediana porażki 51,6 s,
 *     mediana wież/run = 1, tylko 0,8% runów nigdy nie stawia wieży.
 *
 * BEZ wyjątku wygrywa na wszystkich trzech osiach naraz (dłużej, więcej wież,
 * rzadziej zero wież) — wolniejsza druga/trzecia kopalnia kosztuje mniej, niż
 * daje wcześniejsza i pewniejsza wieża. Ekstraktor NIE dostaje taryfy ulgowej.
 */
const EXTRACTOR_EXEMPT_FROM_RESERVE = false;

/**
 * Polityka headless: co bot chce postawić w tym ticku.
 *
 * Interfejs istnieje od Fazy 3, bo od tej fazy polityk są DWIE i każda odpowiada na inne
 * pytanie (`BeginnerPolicy` — „czy początkujący ma szansę", `SkilledPolicy` — „gdzie jest
 * sufit"). Mieszanie ich unieważniło już jedną tabelę pomiarową w §11.1 specu, więc
 * **`name` jest częścią interfejsu, nie ozdobą**: wynik bez nazwy polityki nie da się
 * potem przypisać do pytania, na które odpowiadał.
 */
export interface Policy {
  readonly name: string;
  /**
   * Co ile ticków wolno tej polityce podjąć decyzję.
   *
   * **Należy do POLITYKI, nie do runnera** — i to jest naprawa znaleziska Z1 z przeglądu
   * Zadania 1. Odstęp siedział w `simulateRun` jako jedna stała dla wszystkich i **obcinał
   * sufit o połowę**: zmierzone na pięciu seedach, `SkilledPolicy` wygrywa **5 z 5** przy
   * odstępie 1 i **2 z 5** przy 20. Na 23 grywalnych seedach: 78 % wobec 39 %.
   *
   * Dowód, że odstęp 1 jest tu właściwy, a nie po prostu łaskawszy: przy nim seed 33 kończy
   * na ticku **24 133** — co do ticka liczba referencyjna z §11.1 specu, wyznaczona przez
   * `playPlan`, które decyduje w KAŻDYM ticku. Przy odstępie 20 wychodzi 24 340, czyli
   * `SkilledPolicy` NIE BYŁA „co najmniej tak dobra jak `WINNING_OPENING`", jak wymaga
   * rozstrzygnięcie R2 planu.
   *
   * Gdyby to zostało, H1 zmierzone na tym przyrządzie pokazałoby dziś **39 % („zdrowo")
   * zamiast 78 % („przechodzi się samo")** — i całe strojenie Fazy 3 celowałoby w zły punkt.
   */
  readonly decisionIntervalTicks: number;
  decide(): Command[];
}

/** Fabryka polityki — `simulateRun` konstruuje ją po zbudowaniu `Sim`. */
export type PolicyFactory = (sim: Sim) => Policy;

/**
 * Deterministyczny, zachłanny bot. NIE ma być dobry — ma być powtarzalny
 * i reprezentować rozsądnego początkującego gracza, żeby rozkłady z runnera
 * mierzyły balans gry, a nie jakość bota.
 *
 * Priorytety, zawsze w tej kolejności:
 *   1. ekstraktor na najbliższym niewyczerpanym złożu w zasięgu sieci
 *   2. panel słoneczny, gdy podaż energii jest napięta
 *   3. bateria, gdy magazyn stoi pusty
 *   4. wieża od strony najbliższego pentagonu
 *   5. pylon rozciągający sieć ku najbliższemu złożu poza zasięgiem
 *
 * REZERWA (runda poprawek 2): powyższe pięć gałęzi to WCIĄŻ zachłanne "kup
 * pierwszą przystępną opcję" — ale żadna z nich, dopóki nie stoi ani jedna
 * wieża, nie wolno jej zejść z rudy poniżej ceny najtańszej wieży. Reguła
 * siedzi NAD wszystkimi pięcioma gałęziami naraz (`affordable()` niżej), nie
 * w jednej z nich — łatanie po gałęzi było wypróbowane dwa razy (barykada
 * w rundzie 1, i to samo zagłodzenie ujawniło się na pylonie w rundzie 2:
 * zmierzone, 375 rudy wydane w jednym runie, wieża NIGDY) i za każdym razem
 * przenosiło ten sam błąd na następną najtańszą opcję. "Nie wydaję ostatnich
 * pieniędzy, dopóki nie mam czym strzelać."
 */
export class BeginnerPolicy implements Policy {
  readonly name = 'beginner';

  /**
   * `[STROJENIE]` Bot początkujący decyduje RAZ NA SEKUNDĘ, nie co tick — inaczej stawiałby
   * budynki szybciej, niż zarabia. To jest pokrętło JEGO zachowania i część tego, co znaczy
   * „rozsądny początkujący"; zostaje nietknięte, żeby wszystkie dotychczasowe pomiary
   * (raport z 1000 runów, §11.1) dalej znaczyły to samo.
   */
  readonly decisionIntervalTicks = 20;

  constructor(private readonly sim: Sim) {}

  decide(): Command[] {
    const s = this.sim.state;
    const connected = connectedToCore(s);
    const core = s.planet.startCell;

    const hasTurret = s.buildings.some(
      (b) => b !== null && (b.type === 'LASER_TURRET' || b.type === 'KINETIC_TURRET'),
    );

    /**
     * Czy zakup TEGO typu wolno wykonać bez naruszenia rezerwy. Wieża sama nigdy
     * nie jest ograniczana — jest CELEM rezerwy, nie czymś, przed czym ta rezerwa
     * chroni: gdy stać na wieżę, kupuje ją natychmiast (byle `canBuild` też się
     * zgadzał, o co dba wywołanie niżej). Gdy wieża już stoi, rezerwa znika
     * całkowicie i polityka wraca do zwykłego zachłannego wydawania.
     */
    const affordable = (type: BuildingType): boolean => {
      if (hasTurret || type === 'LASER_TURRET' || type === 'KINETIC_TURRET') return true;
      if (EXTRACTOR_EXEMPT_FROM_RESERVE && type === 'EXTRACTOR') return true;
      return s.ore - BUILDINGS[type].costOre >= RESERVE_ORE;
    };

    // Zasięg roboczy: komórki, do których sieć już dociera, plus jeden krok zapasu.
    const reachable = new Set<number>();
    for (let i = 0; i < connected.length; i++) {
      if (!connected[i]) continue;
      const radius = BUILDINGS[s.buildings[i]!.type].connectionRadius;
      for (const c of cellsWithinSteps(s, i, Math.max(1, radius))) reachable.add(c);
    }

    const free = [...reachable].filter((c) => s.buildings[c] === null).sort((a, b) => a - b);
    if (free.length === 0) return [];

    // 1. Ekstraktory na dostępnych złożach.
    if (affordable('EXTRACTOR')) {
      for (const c of free) {
        if (s.oreRemaining[c] > 0 && canBuild(s, c, 'EXTRACTOR').ok) {
          return [{ kind: 'BUILD', cellId: c, type: 'EXTRACTOR' }];
        }
      }
    }

    const plain = free.filter((c) => s.oreRemaining[c] === 0);
    if (plain.length === 0) return [];

    // 2/3. Energia: panel, gdy brak zapasu; bateria, gdy zapas stale zerowy.
    // [STROJENIE] Oba progi (50 i 5 jednostek magazynu) — pokrętła zachowania bota,
    // a nie wielkości wynikające z czegokolwiek w symulacji. Dobrane „na oko" w Tasku 6;
    // Faza 3 je przestroi razem z `energyStorage`/`energyDrain` z defs.ts.
    const PROG_PANELU = 50; // [STROJENIE]
    const PROG_BATERII = 5; // [STROJENIE]
    if (s.storedEnergy < PROG_PANELU && affordable('SOLAR_PANEL') && canBuild(s, plain[0], 'SOLAR_PANEL').ok) {
      return [{ kind: 'BUILD', cellId: plain[0], type: 'SOLAR_PANEL' }];
    }
    if (s.storedEnergy < PROG_BATERII && affordable('BATTERY') && canBuild(s, plain[0], 'BATTERY').ok) {
      return [{ kind: 'BUILD', cellId: plain[0], type: 'BATTERY' }];
    }

    // 4. Obrona: komórka najbliższa CORE spośród wolnych, żeby budować zwartą bazę.
    // [STROJENIE] Promień zwartej bazy w krokach grafu. Zwycięskie otwarcie z Taska 5
    // mieści się w 4 krokach od CORE (patrz `WINNING_OPENING` w fullrun.test.ts) — stąd
    // ta wartość, ale to nadal pokrętło polityki, nie próg wynikający z zasięgów.
    const PROMIEN_BAZY = 4; // [STROJENIE]
    const nearCore = cellsWithinSteps(s, core, PROMIEN_BAZY).filter((c) => plain.includes(c));
    const spot = nearCore[0] ?? plain[0];
    for (const type of ['LASER_TURRET', 'KINETIC_TURRET', 'BARRICADE'] as const) {
      if (affordable(type) && canBuild(s, spot, type).ok) return [{ kind: 'BUILD', cellId: spot, type }];
    }

    // 5. Rozciągnięcie sieci.
    if (affordable('PYLON') && canBuild(s, plain[plain.length - 1], 'PYLON').ok) {
      return [{ kind: 'BUILD', cellId: plain[plain.length - 1], type: 'PYLON' }];
    }

    return [];
  }
}
