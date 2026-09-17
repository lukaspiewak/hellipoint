import { cameraRay, pickCell, type OrbitCamera } from '@heliopolis/render';
import { BUILDINGS, canBuild, type BuildingType, type Command, type Planet, type SimState, type Vec3 } from '@heliopolis/sim';

/**
 * # Wejście gracza jako KOMENDY (Faza 2C, Zadanie 2)
 *
 * Ten moduł zamienia piksel, w który gracz kliknął, na `Command` dla symulacji — i na tym
 * kończy swoją rolę. **Nie wysyła jej, nie dotyka `SimState`, nie zna `Sim`.** Wysłanie
 * (i wyłącznie przez `sim.enqueue`) robi `main.ts`; to rozdzielenie jest jedynym powodem,
 * dla którego cała ta logika daje się przetestować bez przeglądarki — a przez to jedyną
 * odpowiedzią na defekt Fazy 2B, w którym wada zamknięta w kliencie unieważniła cztery
 * z pięciu pomiarów bramki czytelności.
 *
 * ## Ograniczenie nadrzędne: wejście idzie WYŁĄCZNIE przez kolejkę
 *
 * `global-constraints.md`: *„Render NIGDY nie mutuje `SimState` ani `Planet`. Wejście
 * gracza idzie wyłącznie przez kolejkę komend (`Sim.enqueue`), nigdy przez zapis do stanu.
 * To jest warunek Fazy 5 (autorytatywny serwer), nie wygoda."* Funkcje tego modułu biorą
 * `SimState` co najwyżej do ODCZYTU (`refusalReason` → `canBuild`) i nigdy do zapisu;
 * pilnuje tego strukturalnie test `[NIEZMIENNIK, ŹRÓDŁOWY]` w `test/input.test.ts`,
 * czytający źródło TEGO pliku i `main.ts` leksererem TypeScriptu. Test behawioralny
 * („kolejka nie jest stanem") nie umiałby tego złapać: on dowodzi, że `enqueue` niczego
 * nie zmienia, a nie że klient nie ma obok drugiej, krótszej drogi.
 *
 * ## Dlaczego stan wyboru mieszka TUTAJ, a nie w HUD
 *
 * Rozstrzygnięcie przeglądu wstępnego fazy (`progress.md`, Ruling 1): wybrana komórka
 * należy do WEJŚCIA. HUD (Zadanie 3) dostaje `cellId` argumentem (`buildMenuRows(s, cellId)`)
 * i sam niczego nie pamięta — gdyby wybór mieszkał w HUD, ten sam stan miałby dwóch
 * właścicieli: ruch kursora (tutaj) i menu (tam).
 */

/**
 * Prostokąt płótna na ekranie — tyle z `DOMRect`, ile ten moduł czyta.
 *
 * Wydzielone jako parametr (z domyślnym odczytem z płótna) w rundzie naprawczej 2:
 * `getBoundingClientRect()` w przeglądarce **wymusza przeliczenie układu**, a od chwili,
 * w której wskazanie liczy się CO KLATKĘ, ten odczyt wylądował w pętli renderu. Przyrząd
 * tego nie widział i nie mógł: atrapa płótna zwraca obiekt zbudowany raz, więc pomiar
 * w teście pokazywał zero kosztu tam, gdzie w przeglądarce jest wymuszony layout.
 * `attachInput` buforuje prostokąt i unieważnia go na `resize`.
 */
export interface CanvasRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Kamera na potrzeby zamiany piksela na promień — dokładnie ta, którą buduje `createCamera`.
 *
 *  Typ wzięty przez indeksowanie `OrbitCamera`, a NIE przez `import { PerspectiveCamera }
 *  from 'three'`: `apps/client` z założenia nie importuje `three` bezpośrednio (barierka
 *  pakietu, `packages/render/src/index.ts`). Indeksowanie daje dokładnie ten sam typ bez
 *  przebijania barierki i bez dokładania `three` do zależności aplikacji. */
export type RayCamera = OrbitCamera['object'];

/** Który przycisk myszy. Nazwany, a nie `number` z `PointerEvent.button`: `0`/`2` to
 *  szczegół DOM-u, a ten moduł ma być testowalny bez DOM-u — tłumaczenie numeru na nazwę
 *  jest jedną linią w `main.ts` i zostaje po stronie, która i tak zna zdarzenia. */
export type PointerButton = 'LEFT' | 'RIGHT';

/** Tyle ze zdarzenia wskaźnika, ile ten moduł naprawdę czyta. */
export interface PointerAim {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: PointerButton;
}

/**
 * Zamiar gracza. To jest DOKŁADNIE `Command` z `@heliopolis/sim`, nie własny, równoległy
 * kształt — i to jest cel: `main.ts` podaje wynik `intentFromPointer` wprost do
 * `sim.enqueue`, bez warstwy tłumaczącej, w której mógłby się schować błąd (albo pokusa,
 * żeby „przy okazji" zajrzeć do stanu). Alias istnieje dla słownictwa briefu.
 */
export type Intent = Command;

/**
 * Domyślny typ do budowania — pierwszy z listy dostępnej graczowi. `[WYGLĄD]` byłoby
 * nadużyciem taga (to nie jest liczba wizualna), `[STROJENIE]` też (nie wpływa na balans):
 * to czysta wygoda startowa, żeby pierwsze kliknięcie po wejściu do gry coś robiło.
 */
export const DEFAULT_BUILD_TYPE: BuildingType = 'BARRICADE';

/**
 * Typy, które gracz może postawić — wyprowadzane z `BUILDINGS` przez `playerBuildable`,
 * nie wypisane ręcznie. Ręczna lista byłaby kopią, która przeżyje swoje wejście: dodanie
 * budynku w `defs.ts` nie dodałoby go do menu, a usunięcie zostawiłoby w menu pozycję
 * budującą `undefined`.
 *
 * Kolejność = kolejność deklaracji w `BUILDINGS`, czyli ta sama, którą widać w `defs.ts`
 * (a więc i w tabeli kosztów specyfikacji). Deterministyczna — `Object.keys` na obiekcie
 * literalnym zachowuje kolejność wstawienia dla kluczy niebędących liczbami.
 */
export function playerBuildableTypes(): BuildingType[] {
  return (Object.keys(BUILDINGS) as BuildingType[]).filter((t) => BUILDINGS[t].playerBuildable);
}

/**
 * Piksel okna (`clientX`/`clientY` ze zdarzenia wskaźnika) → promień świata.
 *
 * Współrzędne znormalizowane urządzenia liczone z `getBoundingClientRect()`, a NIE
 * z `clientWidth`/`clientHeight`: te ostatnie są rozmiarem pudełka układu i nie wiedzą
 * ani o przesunięciu płótna względem lewego górnego rogu okna (canvas rzadko zaczyna się
 * w `0,0` — patrz `scene-gate.html`, gdzie stoi obok panelu), ani o skalowaniu CSS-em.
 * `clientX`/`clientY` są względem OKNA, więc bez odjęcia `rect.left`/`rect.top` gracz
 * celowałby o tyle pikseli obok, ile wynosi margines.
 *
 * Samo odwrócenie rzutowania robi `cameraRay` (`@heliopolis/render`) — patrz tam
 * uzasadnienie podziału: piksel → NDC wymaga DOM-u, NDC → świat wymaga macierzy kamery.
 *
 * `+Y` NDC rośnie w GÓRĘ ekranu, a `clientY` w DÓŁ — stąd znak minus. Bez niego wszystko
 * działa idealnie dokładnie w poziomej osi kadru i myli się tym bardziej, im dalej od niej;
 * to jest ten defekt, dla którego test tej funkcji nie może badać wyłącznie środka kadru.
 */
export function screenToRay(
  camera: RayCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  rect: CanvasRect = canvas.getBoundingClientRect(),
): { origin: Vec3; direction: Vec3 } {
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
  return cameraRay(camera, ndcX, ndcY);
}

/**
 * Ile pikseli wolno przejechać między naciśnięciem a puszczeniem przycisku, żeby to
 * wciąż było KLIKNIĘCIE, a nie przeciągnięcie kamery. `[WYGLĄD]` — tak samo jak
 * `ORBIT_ROTATE_SPEED` w `camera.ts`: to liczba odczucia sterowania, strojona patrzeniem,
 * nie balansem.
 *
 * Bez tego rozróżnienia KAŻDY obrót kamery (lewy przycisk, `OrbitControls`) stawiałby po
 * drodze budynek w miejscu, w którym gracz zaczął przeciągać — czyli podstawowy ruch
 * kamery byłby jednocześnie podstawową akcją budowania.
 *
 * ## Obie granice, nie jedna (runda naprawcza 1)
 *
 * Pierwsza wersja miała sens tylko od GÓRY („nie za dużo, żeby obrót nie budował") i test,
 * który tę granicę wyrażał przez samą stałą — więc luz **0,25 px przechodził 17/17**,
 * mimo że zamienia KAŻDE prawdziwe kliknięcie w przeciągnięcie i gra przestaje budować.
 * Liczba wisi teraz między dwoma faktami wyrażonymi W PIKSELACH, niezależnymi od niej samej
 * (test 15 wiąże oba):
 *
 * - **od dołu**: drgnienie ręki przy klikaniu myszą sięga ~2-3 px; kliknięcie, które
 *   przejechało 3 px, ma dalej BYĆ kliknięciem, inaczej gra nie buduje nikomu, kto nie
 *   trzyma myszy w imadle;
 * - **od góry**: krok kraty przy domyślnym oddaleniu to **34,2 px** (`pixelScale.ts`,
 *   3,41 px/jednostkę), a luz ma zostać WYRAŹNIE pod połową tej odległości — inaczej
 *   „kliknięcie" mogłoby przejechać na sąsiednią komórkę i postawić budynek nie tam, gdzie
 *   gracz zaczął. Przeciągnięcie o 10 px (0,29 kroku kraty) ma już BYĆ obrotem kamery.
 *
 * Test 15 wiąże dokładnie ten przedział: **[3 px; √98 px)**, czyli `[3; 9,8995)`, i tyle
 * — nie więcej i nie mniej — jest tu obiecane. 4 px leży w nim z zapasem po obu stronach.
 * (Wcześniejsza wersja tego akapitu mówiła „o rząd wielkości pod 34,2 px", czyli ≤ 3,42 —
 * czego sama wartość 4 nie spełniała. Trzy różne liczby w jednym miejscu; zostaje jedna.)
 */
export const CLICK_SLOP_PX = 4; // [WYGLĄD]

/**
 * Czy gest od `down` do `up` był kliknięciem (a nie przeciągnięciem kamery). Porównanie
 * na KWADRATACH odległości, żeby nie płacić pierwiastka; granica włączna — dokładnie
 * `CLICK_SLOP_PX` to jeszcze kliknięcie.
 */
export function isClick(downX: number, downY: number, upX: number, upY: number): boolean {
  const dx = upX - downX;
  const dy = upY - downY;
  return dx * dx + dy * dy <= CLICK_SLOP_PX * CLICK_SLOP_PX;
}

/**
 * Zamiar wynikający z kliknięcia: lewy przycisk buduje `selectedType`, prawy rozbiera.
 * `null`, gdy promień mija planetę (kliknięcie w tło) albo gdy geometria jest przejściowo
 * niefinitna (płótno zerowego rozmiaru — patrz kontrakt `pickCell`).
 *
 * **Funkcja CZYSTA.** Nie woła `Sim`, nie czyta `SimState`, niczego nie zapisuje — i to
 * jest powód, dla którego daje się ją przetestować w całości bez przeglądarki. Czy komenda
 * jest wykonalna, rozstrzyga symulacja (`applyCommand` → `canBuild`) po swojej stronie
 * kolejki; klient może to samo sprawdzić WCZEŚNIEJ, ale wyłącznie po to, żeby powiedzieć
 * graczowi dlaczego (`refusalReason` niżej), nigdy po to, żeby zdecydować za symulację.
 */
export function intentFromPointer(
  planet: Planet,
  camera: RayCamera,
  canvas: HTMLCanvasElement,
  aim: PointerAim,
  selectedType: BuildingType,
  rect?: CanvasRect,
): Intent | null {
  const cellId = pointedCell(planet, camera, canvas, aim.clientX, aim.clientY, rect);
  if (cellId === null) return null;
  return aim.button === 'RIGHT'
    ? { kind: 'DEMOLISH', cellId }
    : { kind: 'BUILD', cellId, type: selectedType };
}

/**
 * Komórka pod pikselem, albo `null`. Wydzielone z `intentFromPointer`, bo ruch kursora
 * potrzebuje SAMEJ komórki (do `Selection` niżej i do HUD Zadania 3), bez udawania,
 * że gracz coś kliknął — a budowanie fikcyjnego `PointerAim` z przyciskiem, którego nikt
 * nie nacisnął, byłoby kłamstwem w sygnaturze.
 */
export function pointedCell(
  planet: Planet,
  camera: RayCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  rect?: CanvasRect,
): number | null {
  const ray = screenToRay(camera, canvas, clientX, clientY, rect);
  return pickCell(planet, ray.origin, ray.direction);
}

/**
 * Dlaczego symulacja odrzuci ten zamiar — albo `null`, gdy go przyjmie. **Czyta stan,
 * nigdy go nie zapisuje.**
 *
 * Istnieje po to, żeby kliknięcie, które nic nie robi, miało widoczną przyczynę. Bez tego
 * `applyCommand` po cichu ignoruje niedozwoloną komendę (i słusznie — komendy przychodzą
 * z zewnątrz, a w Fazie 5 z sieci, więc nie mogą przerywać symulacji), tylko że po stronie
 * gracza wygląda to identycznie jak zepsute sterowanie.
 *
 * **Klient nie jest bramkarzem.** `main.ts` kolejkuje komendę NIEZALEŻNIE od tego, co tu
 * wyjdzie; ta funkcja produkuje wyłącznie komunikat. To nie jest niedopatrzenie, tylko
 * kształt wymagany przez Fazę 5: autorytatywna jest symulacja, a klient, który odfiltrowuje
 * komendy po swojemu, w chwili rozjazdu z serwerem połyka wejście gracza bez śladu.
 *
 * Powody dla `BUILD` to DOKŁADNIE siedem powodów `canBuild` (`commands.ts`) — nie
 * tłumaczone tutaj na własne nazwy, bo tłumaczenie byłoby drugą listą do utrzymania.
 * Dla `DEMOLISH` `canBuild` nie ma zastosowania, więc powtórzone są tu dwa warunki, na
 * których `applyCommand` po cichu wychodzi: pusta komórka i CORE.
 */
export function refusalReason(s: SimState, intent: Intent): string | null {
  if (intent.kind === 'BUILD') {
    const check = canBuild(s, intent.cellId, intent.type);
    return check.ok ? null : check.reason;
  }
  // `s.planet.cells.length`, nie `s.buildings.length` — TĄ SAMĄ granicą posługuje się
  // `isCellId` w `commands.ts`, a ta funkcja ma opisywać to, co symulacja NAPRAWDĘ zrobi
  // z komendą. Dwa zapisy tej samej granicy są dziś równe i właśnie dlatego rozjazd
  // przeszedłby niezauważony: komunikat dla gracza zacząłby opisywać inną regułę niż ta,
  // która go dotyczy.
  if (!Number.isInteger(intent.cellId) || intent.cellId < 0 || intent.cellId >= s.planet.cells.length) {
    return 'NO_SUCH_CELL';
  }
  const building = s.buildings[intent.cellId];
  if (building == null) return 'NOTHING_TO_DEMOLISH';
  if (building.type === 'CORE') return 'CORE_INDESTRUCTIBLE';
  return null;
}

/** Tryb cieniowania jednostek — narzędzie diagnostyczne Fazy 2B, Zadanie 4. */
export type ShadingMode = 'flat' | 'threshold' | 'smooth';

/**
 * # Meldunek dla gracza — STRUKTURALNY, nie gotowy napis (Faza 2C, Zadanie 4, Krok 0)
 *
 * Do tego zadania `report` przyjmował `string`, a napis składał się TUTAJ. Skutek zmierzył
 * i zgłosił wykonawca Zadania 3, świadomie go nie naprawiając (naprawa rusza kontrakt
 * Zadania 2): **panel mówił „komórka zajęta — najpierw rozbierz", a nakładka diagnostyczna
 * obok, o tym samym kliknięciu, pokazywała surowe `odmowa: CELL_OCCUPIED`.** Gracz widział
 * oba naraz i miał prawo sądzić, że to dwa różne zdarzenia.
 *
 * Przyczyną nie były dwa złe napisy, tylko dwa ŹRÓDŁA napisów: panel tłumaczył powód przez
 * `refusalMessage` (`hud.ts`), a tutaj nie było już czego tłumaczyć — napis przychodził
 * gotowy. Meldunek strukturalny usuwa drugie źródło: ten moduł mówi, CO SIĘ STAŁO,
 * a jedno miejsce (`reportMessage` w `hud.ts`) zamienia to na zdanie. Dla powodu odmowy
 * jest to DOKŁADNIE ta sama funkcja, której używa panel.
 *
 * Kształt jest przy okazji testowalny bez czytania napisów: asercja „meldunek mówi
 * o odmowie z powodu `CELL_OCCUPIED`" nie łamie się przy zmianie interpunkcji.
 */
export type Report =
  /** Komenda poszła do kolejki (klient NIE jest bramkarzem — patrz `refusalReason`). */
  | { readonly kind: 'QUEUED'; readonly intent: Intent }
  /** Komenda też poszła do kolejki, ale symulacja ją odrzuci — i oto dlaczego. */
  | { readonly kind: 'REFUSED'; readonly intent: Intent; readonly reason: string }
  /** Promień minął planetę: gracz kliknął w tło. */
  | { readonly kind: 'MISSED' }
  /** Skrót „wróć do Core" — kamera leci nad komórkę startową. */
  | { readonly kind: 'FOCUS_CORE'; readonly cellId: number }
  /** Wybór typu z menu albo skrótem 1-9. */
  | { readonly kind: 'TYPE_CHOSEN'; readonly type: BuildingType }
  /** Przełącznik cieniowania jednostek (Shift+1/2/3). */
  | { readonly kind: 'SHADING'; readonly mode: ShadingMode };

/**
 * Komórka, której meldunek dotyczy — albo `null`, gdy żadnej (kliknięcie w tło, wybór typu).
 *
 * Wydzielone, bo formatowanie (`hud.ts`) i testy pytają o to samo, a `intent.cellId`
 * schowane w dwóch wariantach unii kusiłoby do rozgałęzień w obu miejscach.
 */
export function reportCell(report: Report): number | null {
  switch (report.kind) {
    case 'QUEUED':
    case 'REFUSED':
      return report.intent.cellId;
    case 'FOCUS_CORE':
      return report.cellId;
    default:
      return null;
  }
}

/**
 * Wybór gracza: komórka pod kursorem i typ budynku z menu.
 *
 * **Obiekt, nie moduł ze zmiennymi na górze.** Zmienne modułowe dałyby jeden, globalny
 * wybór współdzielony przez wszystko, co ten moduł zaimportuje — w tym przez kolejne
 * testy w jednym pliku, które zaczęłyby na sobie polegać w kolejności wykonania
 * („strażnik zależny od kolejności" z katalogu wad tej fazy). Aplikacja tworzy DOKŁADNIE
 * JEDNĄ instancję (w `main.ts`) i to ona jest właścicielem stanu wyboru.
 *
 * `pointAt`/`chooseType` zwracają, czy coś się ZMIENIŁO: `pointermove` sypie zdarzeniami
 * kilkadziesiąt razy na sekundę, a przemalowanie HUD (Zadanie 3) i przeliczenie
 * podświetlenia mają się dziać wtedy, gdy jest co pokazać, nie na każde drgnięcie myszy
 * wewnątrz tej samej komórki.
 */
export interface Selection {
  /** Komórka pod kursorem; `null`, gdy kursor jest poza planetą albo poza płótnem. */
  readonly selectedCell: number | null;
  /** Typ, który postawi lewy przycisk. Nigdy `null` — zawsze coś jest wybrane. */
  readonly selectedType: BuildingType;
  /** Ruch kursora. Zwraca `true`, gdy wskazanie faktycznie się zmieniło. */
  pointAt(cellId: number | null): boolean;
  /** Wybór z menu albo skrótu klawiszowego. Zwraca `true`, gdy typ faktycznie się zmienił. */
  chooseType(type: BuildingType): boolean;
}

export function createSelection(initialType: BuildingType = DEFAULT_BUILD_TYPE): Selection {
  let cell: number | null = null;
  let type: BuildingType = initialType;
  return {
    get selectedCell(): number | null {
      return cell;
    },
    get selectedType(): BuildingType {
      return type;
    },
    pointAt(cellId: number | null): boolean {
      if (cellId === cell) return false;
      cell = cellId;
      return true;
    },
    chooseType(next: BuildingType): boolean {
      if (next === type) return false;
      type = next;
      return true;
    },
  };
}

/**
 * Cel skrótu „wróć do Core" — środek komórki startowej.
 *
 * Wymaganie pochodzi z bramki Fazy 0 (`docs/superpowers/specs/2026-09-14-faza-0-wyniki.md`):
 * kamera K1 (swobodna orbita) wygrała pomiar WBREW przewidywanemu ryzyku gubienia bazy —
 * ale pod warunkiem, że taki skrót istnieje. Sama matematyka przelotu leży w `focusPosition`
 * (`camera.ts`, gotowa od Fazy 2A); tutaj jest tylko odpowiedź na pytanie „dokąd".
 *
 * Czyta `planet`, nie `SimState`: komórka startowa jest własnością PLANETY (deterministyczną
 * funkcją seeda), a nie stanem rozgrywki — CORE może zostać zniszczony (§5.6), a miejsce,
 * z którego run się zaczął, zostaje. Skrót ma działać także po przegranej.
 */
export function focusCoreTarget(planet: Planet): Vec3 {
  return planet.cells[planet.startCell].center;
}

// =========================================================================================
// Spięcie wejścia — CAŁA droga od zdarzenia do kolejki, w jednym testowalnym miejscu
// =========================================================================================

/**
 * Tyle z `Sim`, ile widzi klient: **kolejka komend i stan do ODCZYTU**. Nic więcej.
 *
 * Ten interfejs jest zapisem ograniczenia nadrzędnego Fazy 5 w typie, a nie tylko
 * w komentarzu: `Sim` spełnia go strukturalnie, więc `main.ts` podaje prawdziwy `Sim`,
 * a test — prawdziwy `Sim` albo atrapę liczącą wywołania. Czego tu NIE MA, tego wejście
 * nie umie zawołać.
 */
export interface CommandQueue {
  enqueue(cmd: Command): void;
  readonly state: SimState;
}

/** Cel zdarzeń, którego ten moduł potrzebuje — tyle z `EventTarget`, ile naprawdę czyta. */
export interface ListenerTarget {
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
}

/** Tyle ze zdarzenia klawiatury, ile ten moduł czyta. */
export interface KeyStroke {
  readonly code: string;
  readonly key: string;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

/** Tyle ze zdarzenia wskaźnika, ile ten moduł czyta (`button` w numeracji DOM). */
export interface PointerStroke {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
}

export interface InputWiring {
  readonly planet: Planet;
  readonly camera: RayCamera;
  /** Płótno: źródło zdarzeń wskaźnika ORAZ prostokąt do przeliczenia piksela na promień. */
  readonly canvas: HTMLCanvasElement;
  /** Źródło zdarzeń klawiatury — w przeglądarce `window`, w teście atrapa. */
  readonly keys: ListenerTarget;
  readonly sim: CommandQueue;
  readonly selection: Selection;
  /** „Wróć do Core" — przeniesienie kamery; `camera.ts` ma na to `focusOn`. */
  focusOn(target: Vec3): void;
  /**
   * Co się stało albo dlaczego nic — STRUKTURALNIE, nie gotowym napisem (patrz `Report`).
   * Zamianę na zdanie robi `reportMessage` w `hud.ts`, czyli to samo miejsce, z którego
   * bierze zdania panel.
   */
  report(report: Report): void;
  /** Przełącznik trybu cieniowania jednostek (narzędzie diagnostyczne Fazy 2B). */
  setUnitShading(mode: ShadingMode): void;
}

export interface InputHandle {
  /**
   * Przelicza wskazaną komórkę z OSTATNIEGO znanego piksela kursora. Zwraca `true`, gdy
   * wskazanie się zmieniło.
   *
   * Wołane CO KLATKĘ, nie tylko na `pointermove` — i to jest naprawa z rundy 1, nie
   * ozdoba. `OrbitControls` ma bezwładność (`DAMPING_FACTOR = 0,08`), więc kamera jedzie
   * jeszcze około sekundy po tym, jak gracz przestał ruszać myszą: przez cały ten czas
   * TEN SAM piksel wskazuje kolejne komórki, a wybór przeliczany wyłącznie zdarzeniem
   * kursora zostaje na tej sprzed dojazdu. Zmierzone na ekranie przed naprawą: HUD
   * pokazywał 874, kliknięcie w ten sam piksel budowało na 885.
   *
   * Tania, gdy nie ma co liczyć: wychodzi bez pracy i bez alokacji, jeśli ani kursor,
   * ani kamera nie ruszyły się od poprzedniego wywołania.
   */
  refreshPointedCell(): boolean;
  /**
   * Unieważnia zbuforowany prostokąt płótna. Wołane na `resize` okna — jedyny moment,
   * w którym prostokąt może się zmienić bez udziału tego modułu.
   */
  invalidateCanvasRect(): void;
  /** Odpina wszystkie nasłuchy. */
  detach(): void;
}

/** Numeracja przycisków `PointerEvent` → nazwy tego modułu. Środkowy należy do zoomu. */
function pointerButton(button: number): PointerButton | null {
  if (button === 0) return 'LEFT';
  if (button === 2) return 'RIGHT';
  return null;
}

/**
 * Który KLAWISZ naciśnięto, w postaci niezależnej od układu klawiatury.
 *
 * `event.code` jest wartością właściwą (`Digit3` to trzeci klawisz górnego rzędu niezależnie
 * od tego, czy trzeba do niego Shifta, jak na AZERTY) — ale NIE ZAWSZE JEST OBECNY.
 * Zmierzone na tej gałęzi przy sterowaniu przeglądarką zdalnie: zdarzenie dociera
 * z `code === ''` i samym `key`. To samo zgłaszają zdalne pulpity i część metod
 * wprowadzania. Stąd `code` jako źródło pierwsze, `key` jako zapasowe — zamiast
 * sterowania, które po cichu przestaje działać na części konfiguracji.
 */
export function keyCode(event: KeyStroke): string {
  if (event.code !== '') return event.code;
  if (event.key === ' ' || event.key === 'Spacebar') return 'Space';
  return /^[0-9]$/.test(event.key) ? `Digit${event.key}` : event.key;
}

/** Klawisze trybu cieniowania (z Shiftem) — narzędzie diagnostyczne Fazy 2B, Zadanie 4. */
const SHADING_KEYS: Readonly<Record<string, ShadingMode>> = {
  Digit1: 'flat',
  Digit2: 'threshold',
  Digit3: 'smooth',
};

/**
 * Podpina CAŁE sterowanie i zwraca uchwyt do odpięcia.
 *
 * ## Dlaczego to nie zostało w `main.ts`
 *
 * Bo `main.ts` **nie da się uruchomić w teście** — dotyka `document`/`window` już przy
 * imporcie. Dopóki treść nasłuchów tam siedziała, ograniczenie nadrzędne fazy nie miało
 * strażnika **w obie strony**: recenzja zmierzyła, że usunięcie jedynej linii
 * `sim.enqueue(intent)` zostawia cały pakiet **623/623 zielony**, a cztery z pięciu dróg
 * obejścia zakazu mutowania stanu przechodziły 17/17.
 *
 * Tutaj obie połowy są mierzalne WŁASNOŚCIĄ, nie kształtem składniowym:
 *
 * - **negatywna** — `stateHash` przed obsługą zdarzenia i po niej musi być identyczny;
 *   to łapie KAŻDY zapis do stanu, niezależnie od tego, jak zapisany (przez alias, przez
 *   destrukturyzację, przez `Object.assign`, przez mutację obiektu wyjętego ze stanu);
 * - **pozytywna** — po `sim.step()` świat musi się zmienić dokładnie tak, jak zapowiadała
 *   komenda; to łapie brak `enqueue`, którego żadna asercja o niemutowaniu złapać nie może.
 *
 * `main.ts` zostaje tym, czym ma być: znalezieniem płótna, pętlą renderu i tekstem HUD.
 */
export function attachInput(w: InputWiring): InputHandle {
  let pressX = 0;
  let pressY = 0;
  let pressButton: PointerButton | null = null;
  let pointerX: number | null = null;
  let pointerY: number | null = null;
  let cachedRect: CanvasRect | null = null;
  const rect = (): CanvasRect => (cachedRect ??= w.canvas.getBoundingClientRect());
  // Migawka wejścia poprzedniego przeliczenia — patrz `refreshPointedCell`. Dziewięć
  // osobnych liczb, a nie sklejony napis: napis byłby alokacją w pętli renderu, czyli
  // dokładnie tym, czego to porównanie ma unikać.
  let lastX = NaN;
  let lastY = NaN;
  let lastPx = NaN;
  let lastPy = NaN;
  let lastPz = NaN;
  let lastQx = NaN;
  let lastQy = NaN;
  let lastQz = NaN;
  let lastQw = NaN;

  const onPointerMove = (event: PointerStroke): void => {
    pointerX = event.clientX;
    pointerY = event.clientY;
  };

  const onPointerDown = (event: PointerStroke): void => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    pressButton = pointerButton(event.button);
    pressX = event.clientX;
    pressY = event.clientY;
  };

  const onPointerUp = (event: PointerStroke): void => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    const button = pressButton;
    pressButton = null;
    // Przeciągnięcie to obrót kamery (`OrbitControls`), nie kliknięcie — inaczej każdy
    // obrót stawiałby budynek w punkcie, w którym gracz zaczął przeciągać.
    if (button === null || button !== pointerButton(event.button)) return;
    if (!isClick(pressX, pressY, event.clientX, event.clientY)) return;

    const intent = intentFromPointer(
      w.planet,
      w.camera,
      w.canvas,
      { clientX: event.clientX, clientY: event.clientY, button },
      w.selection.selectedType,
      rect(),
    );
    if (intent === null) {
      w.report({ kind: 'MISSED' });
      return;
    }

    // Powód liczony PRZED wysłaniem, wyłącznie po to, żeby gracz zobaczył, dlaczego nic
    // się nie stało. Klient NIE jest bramkarzem: komenda idzie do kolejki niezależnie od
    // tego, co tu wyszło, bo autorytatywna jest symulacja (sprawdza to samo po swojej
    // stronie). Klient, który filtruje po swojemu, w chwili rozjazdu z serwerem Fazy 5
    // połyka wejście gracza bez śladu.
    const reason = refusalReason(w.sim.state, intent);
    w.report(reason === null ? { kind: 'QUEUED', intent } : { kind: 'REFUSED', intent, reason });

    // ↓ JEDYNA droga wejścia gracza do świata. `global-constraints.md`: „Wejście gracza
    // idzie wyłącznie przez kolejkę komend (`Sim.enqueue`), nigdy przez zapis do stanu.
    // To jest warunek Fazy 5 (autorytatywny serwer), nie wygoda."
    w.sim.enqueue(intent);
  };

  // Prawy przycisk to rozbiórka — menu kontekstowe przeglądarki musi zejść z drogi.
  const onContextMenu = (event: KeyStroke): void => {
    event.preventDefault();
  };

  const onKeyDown = (event: KeyStroke): void => {
    const code = keyCode(event);
    if (event.shiftKey) {
      const next = SHADING_KEYS[code];
      if (next === undefined) return;
      w.setUnitShading(next);
      w.report({ kind: 'SHADING', mode: next });
      event.preventDefault();
      return;
    }

    // Skrót „wróć do Core" — wymaganie bramki Fazy 0
    // (`docs/superpowers/specs/2026-09-14-faza-0-wyniki.md`): kamera K1 wygrała pomiar
    // mimo przewidywanego ryzyka gubienia bazy, ale POD WARUNKIEM istnienia tego skrótu.
    if (code === 'Space') {
      w.focusOn(focusCoreTarget(w.planet));
      w.report({ kind: 'FOCUS_CORE', cellId: w.planet.startCell });
      event.preventDefault();
      return;
    }

    const digit = /^Digit([1-9])$/.exec(code);
    if (digit !== null) {
      const types = playerBuildableTypes();
      const type: BuildingType | undefined = types[Number(digit[1]) - 1];
      if (type === undefined) return;
      w.selection.chooseType(type);
      w.report({ kind: 'TYPE_CHOSEN', type });
      event.preventDefault();
    }
  };

  // Płótno jest tu typowane jako `HTMLCanvasElement` (tego wymaga `screenToRay`), więc jego
  // `addEventListener` ma sygnaturę DOM-ową, gadającą o `Event`. Ten moduł czyta ze zdarzeń
  // DOKŁADNIE tyle, ile obiecują `PointerStroke`/`KeyStroke`, i to jest cały powód, dla
  // którego daje się go wykonać na atrapie bez przeglądarki — rzutowanie jest tu JEDNO,
  // w jednym miejscu, zamiast pięciu rozsianych po rejestracjach.
  const pointerEvents = w.canvas as unknown as ListenerTarget;
  const registrations: [ListenerTarget, string, (event: never) => void][] = [
    [pointerEvents, 'pointermove', onPointerMove as (event: never) => void],
    [pointerEvents, 'pointerdown', onPointerDown as (event: never) => void],
    [pointerEvents, 'pointerup', onPointerUp as (event: never) => void],
    [pointerEvents, 'contextmenu', onContextMenu as (event: never) => void],
    [w.keys, 'keydown', onKeyDown as (event: never) => void],
  ];
  for (const [target, type, listener] of registrations) target.addEventListener(type, listener);

  return {
    refreshPointedCell(): boolean {
      if (pointerX === null || pointerY === null) return false;
      // Odcisk pozycji i obrotu kamery. Gdy ani on, ani piksel kursora się nie zmieniły,
      // odpowiedź musiałaby wyjść identyczna — więc nie ma po co liczyć 1442 iloczynów
      // skalarnych ani alokować dwóch `Vec3` w pętli renderu. Porównanie po siedmiu
      // liczbach, bo `matrixWorld` jest ich czystą funkcją (planeta stoi w (0,0,0)).
      const p = w.camera.position;
      const q = w.camera.quaternion;
      const unchanged =
        pointerX === lastX && pointerY === lastY &&
        p.x === lastPx && p.y === lastPy && p.z === lastPz &&
        q.x === lastQx && q.y === lastQy && q.z === lastQz && q.w === lastQw;
      if (unchanged) return false;
      lastX = pointerX;
      lastY = pointerY;
      lastPx = p.x;
      lastPy = p.y;
      lastPz = p.z;
      lastQx = q.x;
      lastQy = q.y;
      lastQz = q.z;
      lastQw = q.w;
      return w.selection.pointAt(pointedCell(w.planet, w.camera, w.canvas, pointerX, pointerY, rect()));
    },
    invalidateCanvasRect(): void {
      cachedRect = null;
    },
    detach(): void {
      for (const [target, type, listener] of registrations) target.removeEventListener(type, listener);
    },
  };
}
