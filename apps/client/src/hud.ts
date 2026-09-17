import {
  BROWNOUT_ORDER,
  BUILDINGS,
  canBuild,
  type BuildCheck,
  type BuildingType,
  type PowerReport,
  type SimState,
} from '@heliopolis/sim';
import { playerBuildableTypes, type Report } from './input.js';

/**
 * # HUD zasobów i budowy (Faza 2C, Zadanie 3)
 *
 * ## Granica zakresu — obowiązująca, nie sugerowana
 *
 * **HUD niesie WYŁĄCZNIE wielkości, których świat unieść nie może: liczby i menu.**
 *
 * Nie ma tu ani `powered`, ani punktów życia. Faza 2B kosztowała trzy rundy naprawcze,
 * żeby te dwa kanały działały w samym świecie (pierścień alarmu dla braku prądu, pole
 * rdzenia dla uszkodzenia, obwódka o stałej szerokości), a filar D1 mówi wprost: *gracz
 * odczytuje stan wzrokiem, bez UI*. Pasek u góry powtarzający to samo unieważniłby tamtą
 * pracę — nie przez sprzeczność, tylko przez to, że gracz przestałby patrzeć na planetę.
 *
 * Ta sama granica rozstrzyga rzecz mniej oczywistą: **komunikat `WRONG_CELL_TYPE` nie mówi,
 * JAKIEJ komórki budynek wymaga.** Heksagon, pentagon i złoże rudy są rozróżnialne
 * wzrokowo na planecie (Fazy 2A/2B), więc dopisanie „wymaga pentagonu" byłoby dokładnie
 * tym duplikatem, którego ta granica zakazuje — a przy okazji drugim słownikiem do
 * utrzymania. Menu mówi „tu nie stanie"; CO tu stoi, widać.
 *
 * Co zostaje po stronie HUD, bo świat tego nie uniesie:
 *
 * | wielkość | dlaczego świat nie uniesie |
 * |---|---|
 * | `ore`, `storedEnergy` | globalne liczby, nie mają miejsca na kuli |
 * | koszt budynku | liczba z `BUILDINGS`, nie własność komórki |
 * | POWÓD odmowy | zdarzenie, które się NIE stało — nie ma czego narysować |
 * | `phase` | po `DEFEAT` symulacja kasuje kolejkę; bez tego sterowanie wygląda na zepsute |
 * | BILANS energii (Zadanie 4) | produkcja/pobór/magazyn to sumy po CAŁEJ sieci |
 *
 * ## Bilans energii jest po WŁAŚCIWEJ stronie tej granicy (Zadanie 4)
 *
 * Zadanie 3 zostawiło go sobie na później, i słusznie: `demand` było liczone PO kaskadzie
 * gaszenia, więc UI nie miało czego pokazać. Zadanie 4 dołożyło `rawDemand` i podział
 * wyszedł czysty:
 *
 * - **do HUD** idą LICZBY — ile sieć produkuje, ile była winna przed gaszeniem i co
 *   zgaszono. To są sumy po całej planecie; kula nie ma gdzie ich narysować;
 * - **do świata** idzie „KTÓRY budynek i DLACZEGO" — pierścień alarmu (`powered === false`)
 *   i jego PRZERWANIE, odróżniające budynek odcięty od sieci od zgaszonego kaskadą
 *   (`buildingMesh.ts`, Krok 6 Zadania 4).
 *
 * Panel nadal nie czyta ANI JEDNEGO pola `Building` — pilnuje tego test granicy zakresu,
 * przemalowując świeży panel na stanie o innym `hp` i innym `powered`.
 *
 * ## Właścicielem wyboru jest WEJŚCIE, nie HUD
 *
 * `buildMenuRows` dostaje `cellId` argumentem i **sam nic nie pamięta** (`progress.md`,
 * Ruling 1). Gdyby wybór mieszkał tutaj, ten sam stan miałby dwóch właścicieli: ruch
 * kursora (`input.ts`) i menu (tu).
 */

/**
 * Jedna pozycja menu budowy. `check` to **dosłownie** odpowiedź `canBuild` — nie
 * przetłumaczona na własne nazwy i nie uzupełniona o ósmy, wymyślony tu powód.
 *
 * Gdyby HUD dokładał własne powody, gracz czytałby regułę, której symulacja nie zna,
 * a Faza 5 (autorytatywny serwer) dostałaby dwie rozjeżdżające się bramki. Fakt, którego
 * `canBuild` NIE widzi — fazę runu — niesie osobno `commandsAccepted` niżej, właśnie po to,
 * żeby nie wsiąkł w `check` jako fałszywy ósmy powód.
 */
export interface MenuRow {
  readonly type: BuildingType;
  readonly costOre: number;
  /**
   * Czy stać gracza na ten budynek — liczone NIEZALEŻNIE od `check`, a nie z niego
   * wyprowadzone. `canBuild` zwraca PIERWSZY powód odmowy, więc na komórce zajętej
   * dostaje się `CELL_OCCUPIED` niezależnie od stanu skarbca: pozycja kosztująca 300 przy
   * 8 rudy wyglądałaby wtedy identycznie jak ta kosztująca 8, choć jedna jest do kupienia
   * po rozbiórce, a druga nie.
   */
  readonly affordable: boolean;
  readonly check: BuildCheck;
}

/**
 * Typy w menu — DOKŁADNIE lista `playerBuildableTypes()` z `input.ts`, w jej kolejności.
 *
 * Nie własna kopia i nie własny filtr: ta lista jest kontraktem skrótów 1-9 (`input.ts`,
 * `onKeyDown`, test 25), więc menu, które ustawiłoby pozycje inaczej, pokazywałoby przy
 * pozycji N klawisz, który wybiera coś innego. CORE odpada w niej sam, przez
 * `playerBuildable === false`.
 *
 * Policzona RAZ, przy wczytaniu modułu: `playerBuildableTypes()` alokuje tablicę, a bramka
 * świeżości menu (`createHudView`) przechodzi tędy co klatkę. Granica tego: dopisanie
 * budynku do `BUILDINGS` w czasie działania procesu nie doda pozycji — `BUILDINGS` jest
 * stałą modułową, więc dzieje się to wyłącznie w teście, który tego szuka (i który dlatego
 * woła `buildMenuRows`, czytające koszty na bieżąco, a nie tę listę).
 */
const MENU_TYPES: readonly BuildingType[] = playerBuildableTypes();

/**
 * Pozycje menu dla komórki wskazanej kursorem. **Funkcja czysta** — HUD rysuje z jej
 * wyniku i niczego sam nie liczy.
 *
 * `cellId === null` (kursor poza planetą) wchodzi do `canBuild` jako `-1`, czyli dostaje
 * `NO_SUCH_CELL` — ten sam powód, którym symulacja odrzuci komendę spoza planety.
 * Alternatywa („pusta lista, gdy nie ma wskazania") kasowałaby menu przy każdym zjechaniu
 * myszą na bok, czyli dokładnie wtedy, gdy gracz jedzie kursorem DO menu.
 *
 * Koszty czytane z `BUILDINGS` przy każdym wywołaniu, nigdy przepisane: tabela kosztów
 * w specyfikacji i tabela w menu mają być jedną tabelą.
 */
export function buildMenuRows(s: SimState, cellId: number | null): MenuRow[] {
  // `-1`, a nie `NaN`/`null`: `isCellId` w `commands.ts` odrzuca każdą z tych wartości tak
  // samo, ale `-1` jest jedyną, która czyta się jako „indeks poza planetą" także wtedy, gdy
  // ktoś ją zobaczy w debuggerze.
  const id = cellId ?? -1;
  return MENU_TYPES.map((type) => {
    const costOre = BUILDINGS[type].costOre;
    return { type, costOre, affordable: s.ore >= costOre, check: canBuild(s, id, type) };
  });
}

/**
 * Powody odmowy po polsku. Słownik **wolno mieć nadmiarowy** (klucz bez powodu nikomu nie
 * szkodzi), ale nie wolno mieć niepełnego — pilnuje tego test, który zbiera powody
 * z `commands.ts` ORAZ z `refusalReason` (`input.ts`) i sprawdza je wszystkie.
 *
 * Każdy komunikat mówi, CO ZROBIĆ albo DLACZEGO się nie da — nie powtarza identyfikatora
 * innymi literami. To jest cała różnica między „odmowa: CELL_OCCUPIED" a informacją, że
 * komórkę trzeba najpierw rozebrać prawym przyciskiem.
 *
 * ## Dziewięć, nie siedem (Faza 2C, Zadanie 4)
 *
 * Zadanie 3 opisało siedem powodów `canBuild` i zapisało granicę: `refusalReason` ma
 * jeszcze DWA własne, dotyczące rozbiórki (`NOTHING_TO_DEMOLISH`, `CORE_INDESTRUCTIBLE`),
 * których `canBuild` nie zna, bo rozbiórki nie dotyczy. Dopóki meldunek był gotowym
 * napisem, te dwa trafiały na ekran jako surowe identyfikatory — i to jest dokładnie ta
 * połowa rozjazdu, którą naprawia Krok 0 tego zadania. Po zmianie meldunków na
 * strukturalne KAŻDY powód idzie tą samą drogą, więc słownik obejmuje wszystkie dziewięć.
 */
export const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  NO_SUCH_CELL: 'wskaż komórkę — kursor jest poza planetą',
  CELL_OCCUPIED: 'komórka zajęta — najpierw rozbierz (prawy przycisk)',
  NOT_PLAYER_BUILDABLE: 'tego nie stawia gracz — zasiewa to symulacja',
  NO_SUCH_BUILDING_TYPE: 'nie ma takiego budynku',
  WRONG_CELL_TYPE: 'ten budynek tu nie stanie',
  INSUFFICIENT_ORE: 'za mało rudy',
  EVAC_LOCKED: 'jeszcze zamknięty — otwiera się w ostatniej tercji runu',
  NOTHING_TO_DEMOLISH: 'nie ma tu czego rozbierać',
  CORE_INDESTRUCTIBLE: 'Core zostaje — bez niego run kończy się przegraną',
};

/**
 * Powód odmowy zamieniony na zdanie dla człowieka.
 *
 * Powód nieznany daje napis, który **nosi w sobie identyfikator** — i to jest decyzja, nie
 * niedopatrzenie. Rozważane były trzy zachowania:
 *
 * - *rzucić wyjątek* — najgłośniejsze, ale wywala pętlę renderu graczowi, który nie ma z tym
 *   nic wspólnego, i to w chwili, gdy `packages/sim` dostał ósmy powód;
 * - *cichy napis ogólny* („nie można tu budować") — gra działa, a wada jest niewidoczna
 *   zarówno na ekranie, jak i w teście, bo taki napis spełnia „różny od identyfikatora";
 * - *napis z identyfikatorem* — gra działa, a wada rzuca się w oczy NA EKRANIE (surowy
 *   `WIELKIMI_LITERAMI` pośród polskich zdań) i **oblewa test**, bo ten wymaga, żeby
 *   komunikat identyfikatora NIE zawierał.
 *
 * Trzecie jest jedyne, które nie handluje widoczności wady za spokój.
 */
export function refusalMessage(reason: string): string {
  return REFUSAL_MESSAGES[reason] ?? `brak opisu odmowy: ${reason}`;
}

/**
 * Meldunek strukturalny (`Report`, `input.ts`) zamieniony na jedną linijkę dla gracza.
 *
 * **To jest JEDYNE miejsce, w którym zdarzenie wejścia staje się napisem** — i to jest cały
 * powód, dla którego Krok 0 Zadania 4 przerobił `report(string)` na `report(Report)`.
 * Przedtem odmowę opisywały DWA źródła: panel tłumaczył powód przez `refusalMessage`,
 * a nakładka diagnostyczna dostawała gotowe `odmowa: CELL_OCCUPIED` sklejone w `input.ts`.
 * Gracz widział oba naraz. Teraz obie drogi schodzą się w `refusalMessage` niżej.
 *
 * **Nazwy budynków zostają angielskimi identyfikatorami** (`LASER_TURRET`) i to nie jest
 * niedokończona robota, tylko decyzja Fazy 4 (brief Zadania 4, Krok 0): polskie nazwy
 * byłyby drugim słownikiem bez źródła, z którym dałoby się je związać własnością —
 * w odróżnieniu od powodów, które mają źródło w `commands.ts` — i rozjechałyby się z menu
 * oraz ze skrótami 1-9, gdzie gracz widzi dokładnie te identyfikatory.
 *
 * Koszt czytany z `BUILDINGS` TUTAJ, a nie niesiony w meldunku: tabela kosztów ma być
 * jedna (patrz `buildMenuRows`).
 */
export function reportMessage(report: Report): string {
  switch (report.kind) {
    case 'QUEUED':
      return report.intent.kind === 'BUILD'
        ? `buduję ${report.intent.type} na komórce ${report.intent.cellId}`
        : `rozbieram na komórce ${report.intent.cellId}`;
    case 'REFUSED':
      return `${refusalMessage(report.reason)} (komórka ${report.intent.cellId})`;
    case 'MISSED':
      return 'kliknięcie w tło — poza planetą';
    case 'FOCUS_CORE':
      return `powrót do Core (komórka ${report.cellId})`;
    case 'TYPE_CHOSEN':
      return `wybrany typ: ${report.type} (${BUILDINGS[report.type].costOre} rudy)`;
    case 'SHADING':
      return `cieniowanie jednostek: ${report.mode}`;
  }
}

/**
 * Czy symulacja w ogóle PRZYJMIE teraz komendę.
 *
 * `canBuild` o tym nie wie i wiedzieć nie ma: po `VICTORY`/`DEFEAT` to `Sim.step()` kasuje
 * kolejkę w całości (`loop.ts`), bez pytania, co w niej było. Skutek na ekranie jest
 * nie do odróżnienia od zepsutego sterowania — kliknięcia przestają cokolwiek robić i nic
 * tego nie tłumaczy. Ekran końca to Zadanie 5; TO jest jedno zdanie, żeby w międzyczasie
 * nikt nie szukał usterki tam, gdzie jej nie ma.
 *
 * NIE wchodzi do `MenuRow.check` jako ósmy powód — patrz doc-comment `MenuRow`.
 */
export function commandsAccepted(s: SimState): boolean {
  return s.phase === 'RUNNING';
}

/**
 * Zasób tak, jak go widzi gracz. **Podłoga, nie zaokrąglenie** — i to jest jedyny powód,
 * dla którego ta jedna linia jest osobną funkcją.
 *
 * Zaokrąglenie kłamie dokładnie w momencie, w którym gracz na nie patrzy: przy 7,6 rudy
 * pokazałoby „8", a pozycja kosztująca 8 byłaby nieosiągalna (`7,6 >= 8` jest fałszem).
 * Gracz widziałby wtedy „mam 8, kosztuje 8, a gra odmawia" — czyli ten sam rodzaj
 * nieczytelności przyczynowej, którą całe to zadanie ma usuwać. Podłoga nie ma jak
 * obiecać więcej, niż stan naprawdę niesie.
 */
export function shownAmount(value: number): number {
  return Math.floor(value);
}

/**
 * Tempo (jednostki na sekundę) w DZIESIĄTYCH — liczba całkowita, a nie napis.
 *
 * Dziesiąte, bo podaż jest z natury ułamkowa (panel słoneczny daje `peakRate × light`,
 * a `light` zmienia się w każdym ticku), więc podłoga jak przy rudzie pokazywałaby „9/s"
 * przy 9,98 i gracz nie widziałby, że produkcja właśnie dobija do dziesięciu.
 *
 * Liczba CAŁKOWITA, a nie `toFixed(1)`, bo ta sama wartość służy DWÓM rzeczom: napisowi
 * i bramce świeżości panelu. Gdyby bramka porównywała surowe `supply`, przemalowywałaby
 * panel w KAŻDEJ klatce (światło pełznie ciągle), czyli alokowałaby dziewięć obiektów menu
 * sześćdziesiąt razy na sekundę — dokładnie to, czego zabrania `global-constraints.md`.
 * Porównanie po dziesiątych zmienia się wtedy i tylko wtedy, gdy zmienia się ZNAK NA EKRANIE.
 */
export function shownRateTenths(value: number): number {
  return Math.round(value * 10);
}

/** Dziesiąte z powrotem na napis — jedna kropka dziesiętna, przecinek jak w polskim zapisie. */
export function rateText(tenths: number): string {
  return `${(tenths / 10).toFixed(1).replace('.', ',')}/s`;
}

/** Wiersz z liczbami, których świat unieść nie może. Bez `powered`, bez punktów życia. */
export function resourceLine(s: SimState): string {
  return `ruda ${shownAmount(s.ore)} · magazyn ${shownAmount(s.storedEnergy)}`;
}

/**
 * # Bilans energii (Faza 2C, Zadanie 4, Krok 5)
 *
 * Trzy wielkości w jednej linii: **produkcja**, **zapotrzebowanie** i **magazyn** (ten
 * ostatni w `resourceLine` wyżej — jedna liczba ma jedno miejsce).
 *
 * Zapotrzebowanie to `rawDemand`, czyli popyt SPRZED kaskady gaszenia. `demand` na ekranie
 * byłoby liczbą bezużyteczną: kaskada gasi DOPÓKI popyt nie zejdzie do podaży, więc
 * `demand` po niej jest w przybliżeniu równe `supply` i deficyt znika z ekranu dokładnie
 * w chwili, w której zaczyna boleć.
 *
 * Granica zakresu HUD jest zachowana: to są WIELKOŚCI GLOBALNE (ile wchodzi, ile wychodzi),
 * których kula unieść nie może. Który KONKRETNIE budynek zgasł i z jakiego powodu, zostaje
 * w świecie — pierścień alarmu i jego przerwanie (`buildingMesh.ts`, Krok 6).
 */
export function powerLine(power: PowerReport): string {
  return `prąd ${rateText(shownRateTenths(power.supply))} z ${rateText(shownRateTenths(power.rawDemand))} potrzebnych`;
}

/**
 * Zdanie o SKUTKU niedoboru — albo pusty napis, gdy niedoboru nie ma.
 *
 * ## Kryterium, nie technika
 *
 * Brief: *gracz ma widzieć „brakuje 38/s, zgaszono kopalnie" zamiast „kopalnie nie
 * działają"*. Pierwsze niesie PRZYCZYNĘ, drugie tylko skutek — a bez przyczyny łańcuch Q3
 * (cztery lasery po 12/s przy produkcji 10/s gaszą EKSTRAKTORY, bo `BROWNOUT_ORDER` gasi
 * je pierwsze) jest nie do odkrycia z ekranu.
 *
 * ## Trzy stany, nie dwa
 *
 * Trzeci — „magazyn pokrywa niedobór" — jest tu dlatego, że to jedyne OSTRZEŻENIE PRZED
 * faktem: sieć już jest na minusie, ale rezerwa jeszcze go zasypuje. Bez niego brownout
 * przychodzi bez zapowiedzi, w chwili, w której magazyn schodzi do zera, czyli zwykle
 * w środku ataku (§5.1).
 *
 * ## Dlaczego deficyt liczy się z LICZB NA EKRANIE
 *
 * `brakuje` jest różnicą dwóch liczb, które gracz właśnie przeczytał w `powerLine`, a nie
 * osobno zaokrągloną różnicą surowych wartości. Inaczej panel potrafiłby pokazać
 * „prąd 10,0/s z 48,0/s — brakuje 37,9/s", czyli zdanie, które samo siebie nie zgadza się
 * o jedną dziesiątą i którego gracz nie ma jak rozstrzygnąć.
 *
 * Warunek wyzwalający jest jednak liczony z WARTOŚCI SUROWYCH (`rawDemand > supply`),
 * nie z zaokrąglonych: zaokrąglenie do dziesiątych mogłoby ogłosić niedobór 0,1/s tam,
 * gdzie sieć ma nadwyżkę 0,04/s.
 */
export function shortfallLine(power: PowerReport): string {
  const missingTenths = shownRateTenths(power.rawDemand) - shownRateTenths(power.supply);
  const missing = power.rawDemand > power.supply && missingTenths > 0
    ? `brakuje ${rateText(missingTenths)}`
    : '';
  if (power.shedTypes.length > 0) {
    // Kolejność `shedTypes` JEST kolejnością gaszenia (`BROWNOUT_ORDER`) — nie sortować.
    // To ona mówi graczowi, że ekstraktory padają PIERWSZE, czyli dlaczego po brownoucie
    // nie ma z czego odbudować obrony.
    const shed = `zgaszono: ${power.shedTypes.join(', ')}`;
    return missing === '' ? shed : `${missing} — ${shed}`;
  }
  return missing === '' ? '' : `${missing} — magazyn pokrywa niedobór`;
}

// =========================================================================================
// Rysowanie — tyle DOM-u, ile HUD naprawdę dotyka
// =========================================================================================

/**
 * Tyle z `HTMLElement`, ile ten moduł czyta i zapisuje.
 *
 * Kształt własny, a nie `HTMLElement`, z tego samego powodu, dla którego `input.ts` ma
 * `PointerStroke` zamiast `PointerEvent`: w Vitest/Node DOM-u NIE MA (`vitest.config.ts`
 * nie ustawia `environment: 'jsdom'` i celowo nie powinien). Atrapa spełniająca ten
 * interfejs mieszka w `packages/render/test/support/fakeCanvas.ts`, obok atrapy płótna —
 * jedna atrapa DOM-u na repozytorium, nie dwie.
 *
 * Granica, zapisana, żeby nikt nie wziął tego za więcej, niż jest: **jsdom i tak nie liczy
 * układu**, więc żaden test w tym pakiecie nie powie, czy panel nie wyjeżdża poza ekran przy
 * oknie 480 px (wada Fazy 2B, która unieważniła cztery z pięciu pomiarów bramki). Tu
 * mierzalne jest, CO panel pokazuje i KIEDY się przemalowuje — nie, jak leży.
 */
export interface ElementLike {
  textContent: string | null;
  className: string;
  /**
   * Tyle z `CSSStyleDeclaration`, ile HUD ustawia — i jest to CELOWO jedyna własność
   * wyglądu, jaką ten moduł dotyka. Reszta (układ, kolory, wyrównanie) mieszka w arkuszu
   * `index.html`; `pointerEvents` nie jest wyglądem, tylko **kontraktem zachowania**:
   * mówi, co w panelu da się kliknąć, a przez co kliknięcie przechodzi na planetę.
   * Dlatego jest w kodzie, gdzie widzi go test, a nie w arkuszu, którego Vitest nie czyta.
   */
  readonly style: { pointerEvents: string };
  readonly ownerDocument: DocumentLike;
  appendChild(child: ElementLike): void;
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
}

/** Tyle z `Document`, ile HUD potrzebuje: fabryka elementów. */
export interface DocumentLike {
  createElement(tag: string): ElementLike;
}

export interface HudView {
  /**
   * Przemalowuje panel, jeśli zmieniło się cokolwiek, co panel pokazuje. Zwraca `true`,
   * gdy faktycznie przemalował.
   *
   * Wołane CO KLATKĘ i dlatego **w bezruchu nie alokuje**: `buildMenuRows` tworzy dziewięć
   * obiektów i tablicę, a `global-constraints.md` zabrania alokacji w pętli renderu
   * (przyrząd: `packages/render/test/support/gcWindows.ts`). Bramka porównuje wyłącznie
   * skalary i referencje — bez sklejania napisów, bez tablic.
   */
  update(
    s: SimState,
    power: PowerReport,
    cellId: number | null,
    selectedType: BuildingType,
  ): boolean;
  detach(): void;
}

/** Szerokości kolumn monospace w menu. [WYGLĄD] */
const NAME_WIDTH = 18; // [WYGLĄD] najdłuższy typ to EVACUATION_MODULE (17 znaków) + spacja
const COST_WIDTH = 4; // [WYGLĄD] najdroższy budynek kosztuje 300

/**
 * Maksymalna liczba pozycji, jaką unosi maska dostępności w bramce świeżości.
 *
 * `1 << i` w JavaScripcie liczy się na 32-bitowej liczbie ZE ZNAKIEM, więc `1 << 31` jest
 * ujemne, a `1 << 32` zawija do 1 — czyli maska zaczęłaby cicho mylić pozycję 32 z pozycją 0
 * i panel przestałby się przemalowywać, gdy jedna z nich staje się osiągalna. Dziś pozycji
 * jest dziewięć, więc to jest zapas ponad trzykrotny; straż stoi tu, żeby dwudziesty trzeci
 * budynek dodany w Fazie 3 wywalił się GŁOŚNO przy rozruchu, a nie objawił się panelem,
 * który czasem nie nadąża.
 */
/**
 * Podstawa klucza pozycyjnego, którym bramka świeżości porównuje `shedTypes` (patrz
 * `HudView.update`). Cyfra to `indeks w BROWNOUT_ORDER + 2`, więc podstawa musi być
 * większa od największej możliwej cyfry — inaczej dwa różne przebiegi gaszenia dałyby
 * ten sam klucz i panel przestałby się przemalowywać przy zmianie KOLEJNOŚCI gaszenia.
 *
 * Straż niżej stoi z tego samego powodu co `MAX_MENU_TYPES`: czwarty typ w
 * `BROWNOUT_ORDER` (Faza 3 może go dołożyć) ma wywalić się GŁOŚNO przy rozruchu, a nie
 * objawić panelem, który czasem nie nadąża.
 */
const SHED_KEY_RADIX = 8;
if (BROWNOUT_ORDER.length + 2 > SHED_KEY_RADIX) {
  throw new RangeError(
    `hud.ts: BROWNOUT_ORDER ma ${BROWNOUT_ORDER.length} pozycji, a klucz świeżości unosi ` +
      `najwyżej ${SHED_KEY_RADIX - 2} (podstawa ${SHED_KEY_RADIX}). Podnieś podstawę.`,
  );
}

const MAX_MENU_TYPES = 31;
if (MENU_TYPES.length > MAX_MENU_TYPES) {
  throw new RangeError(
    `hud.ts: menu ma ${MENU_TYPES.length} pozycji, a maska dostępności w bramce świeżości ` +
      `unosi najwyżej ${MAX_MENU_TYPES} (1 << i na 32-bitowej liczbie ze znakiem). Powyżej ` +
      'tej granicy bit zawija i panel przestaje się przemalowywać przy zmianie dostępności ' +
      'zawiniętej pozycji. Zamień maskę na tablicę bitów albo na porównanie po elementach.',
  );
}

/**
 * Buduje panel i zwraca uchwyt do odświeżania.
 *
 * `onChoose` dostaje typ z klikniętej pozycji i nic więcej — HUD **nie wysyła komend**
 * i nie zna `Sim`. Wybór trafia do `Selection` (właściciela stanu wyboru), dokładnie tą samą
 * drogą, co skróty 1-9; kliknięcie w planetę zostaje jedyną drogą do kolejki komend.
 *
 * ## Kontrakt trafialności wskaźnikiem — po co `pointerEvents` jest w KODZIE
 *
 * Panel jest RODZEŃSTWEM płótna, a całe wejście (wskazanie, budowa, rozbiórka,
 * `OrbitControls`) wisi na płótnie. Element panelu, który przyjmuje zdarzenia wskaźnika,
 * jest więc dziurą w sterowaniu: w jego prostokącie nie da się ani wskazać, ani obrócić,
 * ani przybliżyć, a prawy przycisk otwiera menu przeglądarki. **Zmierzone na żywej stronie
 * przed naprawą: 38,8 % wskazywalnej tarczy planety przy 800×482.**
 *
 * Stąd podział, który robi ta funkcja:
 *
 * - **korzeń i wszystko w nim** — `pointer-events: none`, czyli przezroczyste dla wskaźnika;
 *   panel rysuje, ale nie łapie;
 * - **jedna wąska „łapka" na wiersz** (numer, nazwa, koszt — `NAME_WIDTH + COST_WIDTH`
 *   znaków) — `auto`. To jest JEDYNA rzecz w panelu, w którą da się kliknąć, i mieści się
 *   w lewym marginesie kadru, poza sylwetką planety;
 * - **zdanie z powodem odmowy** — `none`, bo jest szerokie i leżałoby na planecie.
 *
 * Kontrakt siedzi w kodzie, a nie w arkuszu `index.html`, bo arkusza Vitest nie czyta —
 * a to jest zachowanie, nie wygląd. Wersja czysto arkuszowa byłaby naprawą, której żaden
 * test nie pilnuje.
 *
 * `contextmenu` jest łapane na korzeniu: zdarzenie z „łapki" i tak przez niego przechodzi
 * bąbelkiem (`pointer-events` rozstrzyga trafianie, nie propagację), a bez tego prawy
 * przycisk nad wierszem menu otwierałby menu przeglądarki zamiast rozbierać.
 */
export function createHudView(
  root: ElementLike,
  onChoose: (type: BuildingType) => void,
): HudView {
  const doc = root.ownerDocument;
  root.style.pointerEvents = 'none';

  const resources = doc.createElement('div');
  resources.className = 'hud-resources';
  root.appendChild(resources);

  // Bilans energii i jego SKUTEK — dwa elementy, nie jeden napis: skutek jest ostrzeżeniem
  // i ma własny kolor, a bilans stoi zawsze, także gdy wszystko jest w porządku. Zlepienie
  // ich w jedną linię kazałoby malować całość na czerwono albo nie malować wcale.
  const power = doc.createElement('div');
  power.className = 'hud-power';
  root.appendChild(power);

  const shortfall = doc.createElement('div');
  shortfall.className = 'hud-shortfall';
  root.appendChild(shortfall);

  const headline = doc.createElement('div');
  headline.className = 'hud-headline';
  root.appendChild(headline);

  // Elementy wierszy powstają RAZ. Przemalowanie ustawia `textContent`/`className` na
  // istniejących — inaczej każda zmiana rudy kasowałaby i odtwarzała dziewięć elementów
  // DOM-u w pętli renderu, razem z ich nasłuchami.
  const rowElements: ElementLike[] = [];
  const pickElements: ElementLike[] = [];
  const whyElements: ElementLike[] = [];
  const listeners: [ElementLike, string, (event: never) => void][] = [];
  for (let i = 0; i < MENU_TYPES.length; i++) {
    const type = MENU_TYPES[i];
    const row = doc.createElement('div');
    row.className = 'hud-row';

    const pick = doc.createElement('span');
    pick.className = 'hud-pick';
    pick.style.pointerEvents = 'auto';
    const listener = ((): void => onChoose(type)) as (event: never) => void;
    pick.addEventListener('click', listener);
    listeners.push([pick, 'click', listener]);
    row.appendChild(pick);

    const why = doc.createElement('span');
    why.className = 'hud-why';
    row.appendChild(why);

    root.appendChild(row);
    rowElements.push(row);
    pickElements.push(pick);
    whyElements.push(why);
  }

  const onContextMenu = ((event: { preventDefault(): void }): void => {
    event.preventDefault();
  }) as (event: never) => void;
  root.addEventListener('contextmenu', onContextMenu);
  listeners.push([root, 'contextmenu', onContextMenu]);

  // Migawka tego, co panel POKAZUJE — osobne skalary, nie sklejony napis: napis byłby
  // alokacją w pętli renderu, czyli dokładnie tym, czego ta bramka ma unikać.
  let lastCell: number | null | undefined;
  let lastType: BuildingType | undefined;
  let lastPhase = '';
  let lastOccupant: unknown;
  let lastOre = NaN;
  let lastEnergy = NaN;
  let lastAffordMask = -1;
  let lastEvacLocked: boolean | undefined;
  let lastOreLeft: boolean | undefined;
  let lastSupplyTenths = NaN;
  let lastDemandTenths = NaN;
  let lastShedKey = -1;

  return {
    update(
      s: SimState,
      report: PowerReport,
      cellId: number | null,
      selectedType: BuildingType,
    ): boolean {
      // Wszystko, od czego zależy CHOĆ JEDEN znak na panelu — i nic ponadto.
      const ore = shownAmount(s.ore);
      const energy = shownAmount(s.storedEnergy);
      // Po DZIESIĄTYCH, nie po surowych wartościach: podaż pełznie w każdym ticku razem ze
      // światłem, więc surowe porównanie przemalowywałoby panel co klatkę — patrz
      // `shownRateTenths`. Porównywane jest dokładnie to, co idzie na ekran.
      const supplyTenths = shownRateTenths(report.supply);
      const demandTenths = shownRateTenths(report.rawDemand);
      // Klucz LICZBOWY, nie `shedTypes.join(',')`: bramka biegnie co klatkę, a sklejony
      // napis byłby alokacją w pętli renderu przez cały czas trwania brownoutu — czyli
      // dokładnie wtedy, gdy klatka ma najwięcej roboty. Liczba pozycyjna, nie maska bitowa,
      // bo KOLEJNOŚĆ gaszenia jest treścią (to ona mówi, że ekstraktory padają pierwsze),
      // a maska by ją zgubiła. `+2`, żeby typ spoza `BROWNOUT_ORDER` (indexOf → −1) dał 1,
      // czyli wartość różną od „nie ma nic".
      let shedKey = 0;
      for (let i = 0; i < report.shedTypes.length; i++) {
        shedKey = shedKey * SHED_KEY_RADIX + (BROWNOUT_ORDER.indexOf(report.shedTypes[i]) + 2);
      }
      // Maska osobno od `ore`: koszty są dziś całkowite, więc zmiana podłogi rudy pokrywa
      // każdą zmianę dostępności — ale `[STROJENIE]` Fazy 3 może dać koszt ułamkowy, a wtedy
      // panel przestałby się przemalowywać w chwili, w której pozycja staje się osiągalna.
      let affordMask = 0;
      for (let i = 0; i < MENU_TYPES.length; i++) {
        if (s.ore >= BUILDINGS[MENU_TYPES[i]].costOre) affordMask |= 1 << i;
      }
      const occupant = cellId === null ? null : s.buildings[cellId];
      const evacLocked = s.tick < s.evacUnlockTick;
      const oreLeft = cellId === null ? false : s.oreRemaining[cellId] > 0;

      if (
        cellId === lastCell && selectedType === lastType && s.phase === lastPhase &&
        occupant === lastOccupant && ore === lastOre && energy === lastEnergy &&
        affordMask === lastAffordMask && evacLocked === lastEvacLocked && oreLeft === lastOreLeft &&
        supplyTenths === lastSupplyTenths && demandTenths === lastDemandTenths &&
        shedKey === lastShedKey
      ) {
        return false;
      }
      lastSupplyTenths = supplyTenths;
      lastDemandTenths = demandTenths;
      lastShedKey = shedKey;
      lastCell = cellId;
      lastType = selectedType;
      lastPhase = s.phase;
      lastOccupant = occupant;
      lastOre = ore;
      lastEnergy = energy;
      lastAffordMask = affordMask;
      lastEvacLocked = evacLocked;
      lastOreLeft = oreLeft;

      resources.textContent = resourceLine(s);
      power.textContent = powerLine(report);
      // Zdanie o skutku pojawia się WYŁĄCZNIE wtedy, gdy jest skutek — pusty napis daje
      // element o zerowej wysokości, więc panel nie trzyma rezerwy na ostrzeżenie, którego
      // nie ma. Klasa niesie ODDZIELNIE fakt zgaszenia (kolor alarmu) od samego niedoboru
      // (magazyn jeszcze go pokrywa), bo to dwie różne pilności.
      const shed = shortfallLine(report);
      shortfall.textContent = shed;
      shortfall.className =
        shed === ''
          ? 'hud-shortfall'
          : `hud-shortfall${report.shedTypes.length > 0 ? ' hud-shortfall--shed' : ' hud-shortfall--drain'}`;
      // Wskazana komórka zostaje w nagłówku TAKŻE po końcu runu. Pierwsza wersja podmieniała
      // całą linię na ostrzeżenie i zabierała przy tym jedyny odczyt wskazania — zmierzone
      // na ekranie po `DEFEAT`: menu dalej liczyło powody odmowy dla komórki, której numeru
      // już nie było widać.
      const accepted = commandsAccepted(s);
      headline.textContent =
        `komórka: ${cellId === null ? '—' : cellId}` +
        (accepted ? '' : ` · komendy nie są przyjmowane — run zakończony (${s.phase})`);
      headline.className = accepted ? 'hud-headline' : 'hud-headline hud-headline--over';

      const rows = buildMenuRows(s, cellId);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // `i + 1`, nie `i`: to jest NUMER KLAWISZA, którym `input.ts` wybiera tę pozycję
        // (`/^Digit([1-9])$/` → `types[n - 1]`). Panel obiecujący zły klawisz jest gorszy
        // od panelu bez numerów, bo gracz wciska to, co przeczytał.
        pickElements[i].textContent =
          `${i + 1} ${row.type.padEnd(NAME_WIDTH)}${String(row.costOre).padStart(COST_WIDTH)}`;
        whyElements[i].textContent = row.check.ok ? '' : `  ${refusalMessage(row.check.reason)}`;
        // Klasy, nie style w linii: liczby wyglądu mieszkają w `index.html`, gdzie da się
        // je oglądać razem z resztą układu panelu. Wyjątkiem jest `pointerEvents`, ustawiany
        // przy budowie — patrz doc-comment `createHudView`.
        rowElements[i].className =
          `hud-row${row.check.ok ? '' : ' hud-row--refused'}` +
          `${row.affordable ? '' : ' hud-row--poor'}` +
          `${row.type === selectedType ? ' hud-row--selected' : ''}`;
      }
      return true;
    },
    detach(): void {
      for (const [element, type, listener] of listeners) {
        element.removeEventListener(type, listener);
      }
    },
  };
}
