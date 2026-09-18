import { FIELD_OF_VIEW_DEGREES, INITIAL_DISTANCE_FACTOR, MIN_DISTANCE_FACTOR } from '../../src/camera.js';

/**
 * Przelicznik JEDNOSTEK ŚWIATA NA PIKSELE — jedyna liczba, na której stoi cała metodologia
 * czytelności Fazy 2B, i dlatego **wyprowadzana ze stałych `camera.ts`, a nie przepisywana**.
 *
 * ## Dlaczego ten plik istnieje
 *
 * Do przeglądu gałęzi `PIXELS_PER_UNIT = 3.41` stało jako ręczny literał w DWÓCH plikach
 * testowych (`buildingMesh.test.ts`, `unitMesh.test.ts`), a jego wyprowadzenie żyło w
 * komentarzu. Wyprowadzenie bierze `INITIAL_DISTANCE_FACTOR` i `FIELD_OF_VIEW_DEGREES` —
 * obie `[WYGLĄD]`, obie strojalne w Fazie 4 — i nic tego nie wiązało. Zmierzone przez
 * przegląd gałęzi: `INITIAL_DISTANCE_FACTOR 3 → 4,5` (prawdziwa skala 2,20 px/j, −35 %) oraz
 * `FIELD_OF_VIEW_DEGREES 50 → 75` (2,07 px/j, −39 %) dawały **225/225 zielonych**, a KAŻDY
 * próg „minimum po populacji, w pikselach" stawał się fałszywy o ponad jedną trzecią: dwie
 * wielkości stojące na 1,19 px schodziły do ok. 0,73 px, czyli pod próg widoczności ustalony
 * w tej fazie OBEJRZENIEM — przy teście dalej twierdzącym, że są nad nim.
 *
 * Teraz zmiana kadrowania oblewa: wprost w `camera.test.ts` (kotwica na sam przyrząd) i
 * pośrednio w obu plikach progów, bo ich piksele idą za tą funkcją.
 *
 * ## Wyprowadzenie
 *
 * Z widoku DOMYŚLNEGO kamera stoi w odległości `d = INITIAL_DISTANCE_FACTOR × R` od ŚRODKA
 * planety o promieniu `R`. Sylwetka kuli to **OKRĄG STYCZNOŚCI, nie równik**: jej promień
 * kątowy widziany z kamery wynosi `asin(R/d)`, a kamera perspektywiczna odwzorowuje kąt `α`
 * na promień obrazu proporcjonalny do `tan α`. Stąd
 *
 *     udział wysokości kadru = tan(asin(R/d)) / tan(fov/2)
 *
 * Dla `d = 3R`, `fov = 50°` daje **0,758198**, czyli przy płótnie 900 px sylwetkę o średnicy
 * 682,4 px na 2R = 200 jednostek świata — **3,4119 px na jednostkę**.
 *
 * **Pomyłka, której nie wolno przywrócić** (naprawiona w `f71d499`, kontrola negatywna stoi
 * w `camera.test.ts`): naiwne `R/d` zamiast `tan(asin(R/d))` daje 0,71486 i **3,22 px/j**.
 * Dokładnie tę samą złą liczbę daje dzielenie przez połowę wysokości kadru wziętą na
 * odległości **SKOŚNEJ** od kamery zamiast **OSIOWEJ** — dzielenie perspektywiczne używa
 * głębokości wzdłuż osi, więc to ten sam błąd w innym języku. Kierunek błędu był
 * zachowawczy (prawdziwa skala jest WIĘKSZA o 6 %), ale dokumentacja licząca w nim zaniża
 * każdy budżet pikselowy.
 *
 * To jest miara UŚREDNIONA po tarczy. W jej środku, gdzie powierzchnia jest zwrócona wprost
 * do kamery, skala wynosi `H / (2 (d − R) tan(fov/2))` = 4,825 px/j. Bierzemy uśrednioną, bo
 * jest zachowawcza.
 */

/**
 * Jawne założenie o wysokości płótna, w pikselach CSS — druga (obok stałych `camera.ts`)
 * przesłanka przelicznika, więc stoi tu jako stała, a nie w prozie.
 *
 * 900 px to wysokość podglądu, w którym zapadły wszystkie werdykty wzrokowe tej fazy
 * (`apps/client`, okno pełnoekranowe na maszynie właściciela projektu). Płótno wyższe daje
 * WIĘCEJ pikseli na jednostkę, więc wszystkie progi tej fazy są przy nim spełnione z
 * zapasem; ta liczba jest zachowawczym dołem, nie pomiarem konkretnej sesji.
 *
 * **To NIE jest dół dla okna podglądu w panelu przeglądarki (800×482).** Skala jest wprost
 * proporcjonalna do wysokości płótna, więc przy 482 px każda liczba pikselowa tej fazy
 * kurczy się o czynnik 0,536 — obwódka rdzenia schodzi z 1,19 na 0,64 px, najwęższy pas
 * obręczy alarmu z 1,76 na 0,94 px, przerwa obręczy z 2,01 na 1,08 px. Czyli **dwie
 * wielkości starsze niż ta faza są w oknie podglądu POD progiem**, a nie tylko bliżej niego.
 *
 * Wniosek, zapisany tutaj, żeby nie musiał być odkrywany przy każdej bramce: **werdykt
 * wzrokowy zapada na płótnie co najmniej tej wysokości, nie w oknie podglądu.** Obniżenie
 * tej stałej nie jest zestrojeniem jednego progu — unieważnia wszystkie progi Fazy 2B naraz
 * i jest decyzją o metodologii.
 */
export const CANVAS_HEIGHT_PX = 900;

/**
 * Ile pikselów ekranu przypada na jednostkę świata na sylwetce planety, z widoku domyślnego.
 *
 * @throws {RangeError} gdy `planetRadius` nie jest dodatni albo gdy `INITIAL_DISTANCE_FACTOR`
 *   nie jest większy od 1 — kamera wewnątrz planety nie ma sylwetki, a `asin` poza dziedziną
 *   dałby cichy `NaN` przenoszący się na wszystkie progi pikselowe (ten sam powód, dla
 *   którego strażniki stoją w `camera.ts` i `writeCellColors`).
 */
export function pixelsPerUnit(planetRadius: number): number {
  if (!(planetRadius > 0)) {
    throw new RangeError(`pixelsPerUnit: planetRadius must be positive and finite, got ${planetRadius}`);
  }
  if (!(INITIAL_DISTANCE_FACTOR > 1)) {
    throw new RangeError(
      `pixelsPerUnit: INITIAL_DISTANCE_FACTOR is ${INITIAL_DISTANCE_FACTOR} — camera inside the planet has no silhouette`,
    );
  }
  const frameFraction = silhouetteFrameFraction();
  return (frameFraction * CANVAS_HEIGHT_PX) / (2 * planetRadius);
}

/**
 * Udział WYSOKOŚCI KADRU zajmowany przez średnicę sylwetki planety — wydzielony osobno, żeby
 * dało się przypiąć SAM rachunek (0,758198), nie tylko jego iloczyn z płótnem. Niezależny od
 * promienia planety: `R` skraca się w `R/d`.
 */
export function silhouetteFrameFraction(distanceFactor: number = INITIAL_DISTANCE_FACTOR): number {
  if (!(distanceFactor > 1)) {
    throw new RangeError(
      `silhouetteFrameFraction: distanceFactor must be > 1 (kamera wewnątrz planety nie ma sylwetki), got ${distanceFactor}`,
    );
  }
  const angularRadius = Math.asin(1 / distanceFactor);
  return Math.tan(angularRadius) / Math.tan((FIELD_OF_VIEW_DEGREES * Math.PI) / 360);
}

/**
 * Skala dla powierzchni ZWRÓCONEJ DO KAMERY, w największym dopuszczalnym przybliżeniu
 * (`MIN_DISTANCE_FACTOR`) — odniesienie dla progów WIERNOŚCI KSZTAŁTU.
 *
 * ## Dlaczego to NIE jest `pixelsPerUnit` przy innej odległości
 *
 * `pixelsPerUnit` liczy skalę na SYLWETCE, czyli uśrednioną po tarczy, i to jest właściwe
 * odniesienie dla progów WIDOCZNOŚCI — rzecz niewidoczna z widoku domyślnego jest niewidoczna,
 * a skala mniejsza od prawdziwej daje próg OSTRZEJSZY, czyli zachowawczy.
 *
 * **Dla progów WIERNOŚCI KSZTAŁTU oba te kierunki się odwracają i to jest cała treść tej
 * funkcji.** Wielokąt udający okrąg zdradza się, gdy podjedziesz blisko i patrzysz na niego
 * WPROST, a nie gdy oglądasz go z brzegu tarczy w skrócie perspektywicznym. Najgorszym
 * przypadkiem jest więc powierzchnia czołowa przy `MIN_DISTANCE_FACTOR`, gdzie skala jest
 * NAJWIĘKSZA — a większa skala to większa strzałka w pikselach, czyli próg trudniejszy do
 * spełnienia. Skala mniejsza od prawdziwej jest tu POBŁAŻLIWA, nie zachowawcza.
 *
 * **Wpadka, której nie wolno przywrócić** (naprawiona tutaj; zawężony przegląd rundy
 * naprawczej Zadania 4, znalezisko N13): pierwsza wersja brała `silhouetteFrameFraction`
 * przy `MIN_DISTANCE_FACTOR`, czyli skalę SYLWETKOWĄ — 11,62 px/j zamiast 32,17 px/j,
 * **2,77× w stronę pobłażliwą**. Uzasadnienie „bierzemy uśrednioną, bo jest zachowawcza"
 * zostało przeniesione z doc-commentu `pixelsPerUnit` do kontekstu, w którym ma PRZECIWNY
 * znak. Skutkiem próg wypadał na 14 bokach zamiast na 22: obręcz czternastoboczna
 * przechodziła 699/699 przy realnej strzałce ponad progiem.
 *
 * ## Wyprowadzenie
 *
 * Kamera stoi w odległości `d = MIN_DISTANCE_FACTOR × R` od ŚRODKA planety, więc powierzchnia
 * zwrócona do niej leży na głębokości OSIOWEJ `d − R`. Płaszczyzna prostopadła do osi widoku
 * na głębokości `z` odwzorowuje jednostkę świata na `H / (2 z tan(fov/2))` pikseli. Stąd
 *
 *     px/jednostkę = H / (2 R (MIN_DISTANCE_FACTOR − 1) tan(fov/2))
 *
 * Dla `R = 100`, `MIN_DISTANCE_FACTOR = 1,3`, `fov = 50°`, `H = 900` daje **32,168 px/j**.
 *
 * @throws {RangeError} gdy `planetRadius` nie jest dodatni albo gdy `MIN_DISTANCE_FACTOR`
 *   nie jest większy od 1 — kamera na powierzchni planety albo w jej wnętrzu nie ma przed
 *   sobą powierzchni czołowej, a dzielenie przez zero dałoby ciche `Infinity`.
 */
export function pixelsPerUnitFacingClosest(planetRadius: number): number {
  if (!(planetRadius > 0)) {
    throw new RangeError(
      `pixelsPerUnitFacingClosest: planetRadius must be positive and finite, got ${planetRadius}`,
    );
  }
  if (!(MIN_DISTANCE_FACTOR > 1)) {
    throw new RangeError(
      `pixelsPerUnitFacingClosest: MIN_DISTANCE_FACTOR is ${MIN_DISTANCE_FACTOR} — kamera nie ` +
        'stoi przed powierzchnią planety, więc skala czołowa nie istnieje',
    );
  }
  const depth = planetRadius * (MIN_DISTANCE_FACTOR - 1);
  return CANVAS_HEIGHT_PX / (2 * depth * Math.tan((FIELD_OF_VIEW_DEGREES * Math.PI) / 360));
}

/**
 * Próg widoczności — jeden dla obu warstw i dla obu plików progów, bo opisuje TEN SAM ekran.
 *
 * Liczba pochodzi z §5.3 raportu Zadania 3: pierwsza wersja obręczy alarmu miała pasy poniżej
 * piksela i została odrzucona OBEJRZENIEM („alarmu nie było widać w ogóle"). To jedyny werdykt
 * wzrokowy, jaki ta faza ma na temat granicy widoczności, więc on jest progiem.
 *
 * **Zakres stosowalności, ustalony przez człowieka w bramce Zadania 5: próg 1 px wiąże
 * ROZMIARY, a RUCH jest wykrywalny poniżej niego** — puls pierścienia alarmu został zobaczony
 * przy amplitudzie 0,44 px. Żaden próg Zadań 3 i 4 przez to nie traci ważności (wszystkie
 * dotyczą rozmiarów), ale granica ich stosowalności ma teraz nazwę.
 */
export const MIN_VISIBLE_PX = 1;
