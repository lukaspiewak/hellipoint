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
): { origin: Vec3; direction: Vec3 } {
  const rect = canvas.getBoundingClientRect();
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
): Intent | null {
  const cellId = pointedCell(planet, camera, canvas, aim.clientX, aim.clientY);
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
): number | null {
  const ray = screenToRay(camera, canvas, clientX, clientY);
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
  if (!Number.isInteger(intent.cellId) || intent.cellId < 0 || intent.cellId >= s.buildings.length) {
    return 'NO_SUCH_CELL';
  }
  const building = s.buildings[intent.cellId];
  if (building == null) return 'NOTHING_TO_DEMOLISH';
  if (building.type === 'CORE') return 'CORE_INDESTRUCTIBLE';
  return null;
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
