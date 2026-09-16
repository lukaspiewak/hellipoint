import {
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  type BufferGeometry,
} from 'three';
import type { EnemyType, Planet, Unit } from '@heliopolis/sim';
import { ENEMIES } from '@heliopolis/sim';
import { buildDiscGeometry } from './buildingMesh.js';
import { lightBand, LIGHT_BANDS, type Rgb } from './shading.js';

/**
 * Jednostki na ekranie (Faza 2B, Zadanie 4): setki sztuk naraz, pozycje przepisywane CO
 * KLATKĘ (`Unit.pos` jest wektorem świata, nie identyfikatorem komórki), i JEDEN stan, który
 * gracz musi umieć odczytać bez UI — **postęp spalania w świetle**.
 *
 * Render TYLKO CZYTA `SimState.units` (`global-constraints.md`); ten moduł nie ma żadnej
 * ścieżki zapisu do symulacji ani do `Planet`.
 *
 * ## Spalanie jest TYM, co ta warstwa ma pokazać — reszta jest obudową
 *
 * `Unit.exposure` rośnie o `TICK_SECONDS` w każdym ticku, w którym `light[cellId] > 0`,
 * i jednostka ginie po `ENEMIES[type].burnTime` (`burning.ts`). To jest widoczna
 * konsekwencja niezmiennika N3 i na niej stoi cała ekonomia dnia i nocy: ARMOR
 * (`speedFactor` 0,85 — wolniejszy od terminatora) wchodzący w światło jest skazany,
 * SWARM (2,3) ucieknie i ochłonie. Gracz ma to widzieć na obiekcie o średnicy kilku
 * pikseli, więc każdy kanał tej warstwy jest liczony w pikselach, zanim zostanie dobrany.
 *
 * ## Dwa tony naraz — to samo ograniczenie palety, co przy budynkach, sprawdzone od nowa
 *
 * Paleta terenu jest LINIOWA (patrz `Rgb` w `shading.ts`), luminancje pasm to
 * **0,050802 / 0,492646 / 0,919760**. Przeliczone TUTAJ, przed doborem barw jednostki (nie
 * przepisane z Zadania 3): **żaden pojedynczy ton nie osiąga 3:1 wobec wszystkich trzech
 * pasm** — maksimum minimum po pasmach wynosi **2,3202** przy luminancji **0,18388**.
 * Ograniczenie dotyczy jednostek TAK SAMO jak budynków, bo jednostka bywa na każdym z
 * trzech pasm: rodzi się na pentagonie gdziekolwiek, ucieka przed światłem i wraca w nie.
 *
 * Stąd jednostka niesie JEDNOCZEŚNIE ton bardzo ciemny (`UNIT_RIM_COLOR`, obwódka) i ton
 * bardzo jasny (rdzeń, cała rampa `UNIT_CORE_COLOR_COOL` → `UNIT_CORE_COLOR_HOT`). Zapas
 * najciaśniejszy wynosi **3,4910** i wypada na OBRYSIE NOCY przy gorącym końcu rampy —
 * pilnuje tego test 1, razem z kontrolą pozytywną (żaden z tych tonów sam nie przechodzi).
 *
 * ## Trzy kanały, trzy rozłączne role
 *
 * | kanał | nośnik | co niesie |
 * |---|---|---|
 * | promień całej tarczy | `UNIT_SHAPES` | TYP (`SWARM` < `DISRUPTOR` < `ARMOR`, rosnąco z `hp`) |
 * | promień jasnego rdzenia | `burnCoreScale` | POSTĘP SPALANIA — kurczy się, aż zostanie połowa |
 * | barwa rdzenia | `writeUnitCoreColor` | ten sam postęp, kanał NADMIAROWY (chłodny fiolet → rozżarzenie) |
 *
 * Kierunek kodowania spalania jest wybrany POD TŁO, na którym spalanie w ogóle zachodzi:
 * ekspozycja rośnie wyłącznie tam, gdzie `light > 0`, czyli na paśmie zmierzchu albo dnia —
 * a tam jedynym widocznym tonem jednostki jest ton CIEMNY. Kurczący się rdzeń znaczy więc
 * ROSNĄCĄ ciemną obwódkę: jednostka płonąca na świetle **pęcznieje na czarno** (obwódka
 * najmniejszego typu rośnie z 1,19 px do 2,30 px, największego z 1,19 px do 3,50 px), czyli
 * sygnał przybiera dokładnie tam, gdzie jest widoczny. Odwrotne kodowanie („płonąca świeci
 * jaśniej") położyłoby cały przyrost na tonie, który na dniu ma kontrast 1,64.
 *
 * Rdzeń NIE schodzi do zera i to jest ta sama decyzja, co `CORE_SCALE_MIN` przy budynkach,
 * z własnym powodem: jednostka z wysoką ekspozycją, która UCIEKŁA w cień, dogasa na paśmie
 * NOCY — a tam widoczny jest wyłącznie jasny rdzeń. Rdzeń zgaszony do zera znaczyłby
 * „SWARM, który właśnie uciekł, znika z nocnej półkuli", czyli kasowałby drugą połowę
 * historii, którą ta warstwa ma opowiedzieć.
 *
 * ## Czego tu NIE MA: cieniowania jednostki światłem (Krok 3 briefu, rozstrzygnięty pomiarem)
 *
 * Oba warianty — progowy jak teren i gładki — są zaimplementowane (`UnitShadingMode`,
 * `unitShade`) i obejrzane w ruchu, na obu skalach. Wynik jest w raporcie zadania; sam
 * mechanizm zostaje, bo bramka Zadania 5 może chcieć obejrzeć go jeszcze raz cudzymi oczami.
 *
 * Domyślny tryb to `'flat'` — jednostka NIE jest cieniowana światłem. Decyzja stoi na
 * STROBOSKOPOWANIU trybu progowego, zmierzonym dwukrotnie i niezależnie (raz przeze mnie,
 * raz przez przegląd, własnym rusztowaniem i własnym układem budynków — te same liczby):
 * jednostka stojąca na terminatorze zmienia pasmo do **20 razy na sekundę**, co jest falą
 * prostokątną 10 Hz o amplitudzie 0,23 jasności; **15% tych zmian zachodzi na jednostkach,
 * które się nie ruszyły** — to sam terminator po nich przechodzi, więc nie usunie tego żadne
 * wygładzanie trajektorii. Wariant gładki tego nie ma (największy skok 0,0444 w ticku).
 *
 * Drugą przesłanką jest budżet kontrastu: dwutonowość zjada go CAŁY, więc przyciemnienie
 * jednostki poniżej czynnika **0,846334** łamie próg 3:1 wobec obrysu nocy (to obrys, nie
 * wypełnienie, jest tu wiążący — wypełnienie nocy znosi jeszcze 0,467232; cieniowanie samego
 * rdzenia daje IDENTYCZNĄ granicę, więc obwódka nigdy nie wiąże). Pilnuje tego test 17, który
 * liczy tę granicę bisekcją, zamiast ją przepisywać.
 *
 * ## Czego NIE wiem: jak wygląda łagodne cieniowanie GŁADKIE w granicach legalnych
 *
 * Obserwacja wzrokowa („cały wiersz SWARM-a gaśnie w tło na nocnej półkuli") została zrobiona
 * przy czynniku **0,55**, czyli przy zmianie rdzenia o **59/255** w sRGB. Maksymalne LEGALNE
 * przyciemnienie (0,846334) zmienia rdzeń o **18/255**, a obwódkę o 5/255 — i tego **nikt nie
 * obejrzał**, ani ja, ani przegląd. Zdanie „powyżej tej granicy cieniowania nie widać" stało
 * tu do rundy naprawczej 1 jako twierdzenie i było nieuprawnione: 18/255 to nie jest zero.
 *
 * Nie zmienia to werdyktu, bo werdykt niesie stroboskopowanie, a ono dotyczy WYŁĄCZNIE trybu
 * progowego i jest potwierdzone dwoma niezależnymi pomiarami. Ale zostawia otwarte pytanie
 * **czy łagodne cieniowanie GŁADKIE w granicach legalnych coś dowozi** — rozstrzyga to
 * człowiek przy bramce Zadania 5, dlatego oba tryby zostają w kodzie (klawisze 1/2/3 w
 * podglądzie), a nie zostały usunięte.
 */

// --- Stałe wizualne — [WYGLĄD] ---------------------------------------------------------

/**
 * `[WYGLĄD]` Promień jednostki o rozmiarze 1,0, jako ułamek promienia planety (tak jak
 * `BUILDING_RADIUS_FACTOR` — nie stała światowa, bo `createPlanet` może dostać inny `radius`).
 *
 * ## Ta liczba jest DOLNĄ granicą, a nie wyborem estetycznym
 *
 * Przy `PIXELS_PER_UNIT = 3,41` (widok domyślny — wyprowadzenie w `buildingMesh.test.ts`)
 * najmniejszy typ musi zmieścić w swoim promieniu TRZY wielkości, każdą ponad progiem
 * widoczności jednego piksela:
 *
 *   obwódka (stała szerokość)                         ≥ 1 px
 *   rdzeń przy PEŁNEJ ekspozycji (tuż przed śmiercią) ≥ 1 px
 *   SKOK promienia rdzenia między 0 a pełną ekspozycją ≥ 1 px
 *
 * Dwie ostatnie sumują się do promienia rdzenia przy zerowej ekspozycji, czyli do
 * `promień − obwódka`. **Obwódka ma STAŁĄ szerokość i wchodzi do tego rachunku swoją
 * FAKTYCZNĄ wartością (0,35 j. = 1,1935 px), nie swoim własnym minimum.** Stąd
 *
 *   promień ≥ obwódka + 2 px = 0,35 + 0,58651 = **0,93651 jednostki świata (3,194 px)**
 *
 * SWARM stoi na 1,00 (3,41 px), czyli **6,8% zapasu**. Runda naprawcza 1 poprawiła tu liczbę:
 * stało 0,88 j. i „13% zapasu", co zakładało, że obwódka JEDNOCZEŚNIE skurczy się do własnego
 * progu 1 px — konfiguracja, której ten moduł nie wysyła na ekran. Zaniżona granica jest
 * gorsza niż żadna: Faza 4, sięgając po nią, zmniejszyłaby SWARM-a o 12% w przekonaniu, że
 * robi to legalnie, i skasowała kanał spalania na najmniejszym typie.
 *
 * Granica JEST egzekwowana — nie osobną asercją, tylko testem 6, który mierzy oba progi
 * rdzenia na faktycznych macierzach NAJMNIEJSZEGO typu; osobna asercja na `0,93651` byłaby
 * algebraicznym powtórzeniem tamtych dwóch, czyli dokładnie wadą, którą runda 1 usunęła
 * z końca tego samego testu. Sprawdzone parą mutacji: `SWARM: 0.94` przechodzi,
 * `SWARM: 0.93` oblewa test 6.
 *
 * Liczba zależy od `UNIT_RIM_FACTOR`: przy innej obwódce granica się przesuwa (`obwódka +
 * 2 px`). Mniejsza jednostka nie jest „mniej czytelna" — ma kanał poniżej piksela, czyli
 * nieistniejący.
 *
 * Górna granica: największy typ (1,70) jest MNIEJSZY od najmniejszego promienia wpisanego
 * komórki (**3,1720** — zmierzone w Zadaniu 3 na wszystkich 1442 komórkach), więc żadna
 * jednostka nie przykrywa całej komórki terenu. Sprawdza to test 5.
 */
export const UNIT_RADIUS_FACTOR = 0.01; // [WYGLĄD]

/**
 * `[WYGLĄD]` Rozmiar tarczy per typ, jako mnożnik `UNIT_RADIUS_FACTOR`. Rośnie z `hp`
 * (30 / 80 / 250), więc największa sylwetka należy do tego, co najtrudniej zabić.
 *
 * Rozstęp między sąsiednimi typami wynosi **0,35 jednostki = 1,194 px na promieniu** —
 * dokładnie tyle, co szerokość obwódki, i to jest ta sama liczba nie przez przypadek: to
 * najmniejsza różnica, którą ten widok w ogóle potrafi pokazać. Próg wiąże MINIMUM po
 * parach sąsiednich typów, nie rozpiętość SWARM↔ARMOR (test 5).
 *
 * To NIE jest pełna identyfikacja typu i ten moduł jej nie obiecuje: trzy tarcze różniące
 * się o 1,2 px promienia rozróżnia się PORÓWNAWCZO (dwie obok siebie), nie z pamięci.
 * Rozpoznanie typu bez porównania to kandydat na Fazę 2C razem z UI — tutaj kanał niesie
 * tyle, na ile starcza pikseli, i tyle jest zmierzone.
 */
export const UNIT_SHAPES: Readonly<Record<EnemyType, number>> = {
  SWARM: 1.0,
  DISRUPTOR: 1.35,
  ARMOR: 1.7,
}; // [WYGLĄD]

/**
 * `[WYGLĄD]` Szerokość ciemnej obwódki między jasnym rdzeniem a krawędzią tarczy, jako
 * ułamek promienia planety. Promień rdzenia przy zerowej ekspozycji to
 * `promień_tarczy − ta_szerokość`, więc obwódka jest **JEDNAKOWA dla wszystkich trzech
 * typów**: 0,35 jednostki, czyli 1,194 piksela.
 *
 * Stała szerokość, nie ułamek promienia — to jest wprost lekcja rundy naprawczej 2 Zadania
 * 3, przeniesiona tu od razu zamiast powtórzona jako błąd: obwódka jest RAMKĄ, a ramki mają
 * szerokość niezależną od tego, co obramowują. Przy ułamku próg postawiony na MINIMUM po
 * populacji spełniałby wyłącznie największy typ.
 *
 * Ta obwódka ma dwie role naraz i obie są konieczne: (1) jest jedynym tonem jednostki
 * widocznym na paśmie zmierzchu i dnia; (2) oddziela rdzeń od terenu, dzięki czemu rampa
 * barwy rdzenia może być kanałem nadmiarowym, nie sąsiadując nigdy z pomarańczem zmierzchu
 * (ten sam argument, co „ramka próbki w legendzie mapy" przy `CORE_RIM_FACTOR`).
 */
export const UNIT_RIM_FACTOR = 0.0035; // [WYGLĄD]

/**
 * `[WYGLĄD]` Promień rdzenia przy PEŁNEJ ekspozycji, jako ułamek jego promienia przy
 * zerowej. Ta jedna liczba rozdziela dwa progi ciągnące w przeciwne strony — „rdzeń zostaje
 * widoczny do końca" i „skok promienia jest widoczny" — których suma jest stała.
 * **0,5 dzieli budżet najmniejszego typu po równo**: 1,108 px na każdy. Pole rdzenia spada
 * przy tym do **0,25** pola wyjściowego.
 */
export const UNIT_CORE_SCALE_MIN = 0.5; // [WYGLĄD]

/**
 * `[WYGLĄD]` O ile tarcza jednostki unosi się nad powierzchnię, jako ułamek promienia
 * planety (0,25 jednostki).
 *
 * Musi być WYŻEJ niż krata komórek (`OUTLINE_LIFT` = 0,002 → 0,20) i niż pierścień alarmu
 * budynku (`SURFACE_LIFT_FACTOR` = 0,0015 → 0,15): jednostka jest planem pierwszym, a
 * remis w buforze głębokości z kratą dawałby migotanie linii pod biegnącą jednostką.
 * Górna granica ta sama, co dla `OUTLINE_LIFT`/`SURFACE_LIFT_FACTOR`: łącznie z rdzeniem
 * (0,40) poniżej 5% średnicy najmniejszej komórki (0,42), żeby przy limbie nic nie nawisało
 * nad sąsiadem.
 */
export const UNIT_LIFT_FACTOR = 0.0025; // [WYGLĄD]

/**
 * `[WYGLĄD]` O ile jasny rdzeń unosi się ponad tarczę, jako ułamek promienia planety.
 * Ta sama liczba i to samo uzasadnienie, co `SURFACE_LIFT_FACTOR` w `buildingMesh.ts`:
 * rozdzielczość 24-bitowego bufora głębokości na maksymalnym oddaleniu wynosi ok. **0,0292**
 * jednostki, więc 0,15 to jej pięciokrotność. Bez tego rdzeń i tarcza leżą w TEJ SAMEJ
 * płaszczyźnie i migoczą przy oddaleniu — awaria widoczna wyłącznie na GPU, czyli nigdy w CI.
 */
export const UNIT_CORE_LIFT_FACTOR = 0.0015; // [WYGLĄD]

/**
 * `[WYGLĄD]` Ciemny ton jednostki — obwódka. LINIOWY, jak cała paleta.
 * Luminancja 0,017495: kontrast **8,04** wobec zmierzchu i **14,37** wobec dnia, czyli
 * to on niesie jednostkę po tej stronie planety, po której jednostka się pali.
 * Fiolet, nie czerń: odległość barw od `SHELL_COLOR` budynku to tylko 0,157 w sRGB, więc
 * to nie ODCIEŃ odróżnia jednostkę od budynku — odróżnia ją OKRĄGŁA sylwetka (budynek jest
 * sześciokątem wpisanym w kratę) i ruch. Jest to zapisane wprost, bo pokusa „damy jednostce
 * inny czarny" jest realna, a te dwa czernie są dla oka tym samym.
 */
export const UNIT_RIM_COLOR: Rgb = [0.035, 0.008, 0.06]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Barwa rdzenia przy ZEROWEJ ekspozycji — chłodny fiolet. Luminancja 0,579488:
 * kontrast **6,24** wobec nocy i **3,72** wobec obrysu nocy.
 *
 * Fiolet, bo to jedyna rodzina odcieni WOLNA na tej planszy: teren zajmuje granat,
 * pomarańcz i ciepłą biel, budynek chłodną biel (zdrowy rdzeń), czerwień (rdzeń krytyczny)
 * i bursztyn (pierścień alarmu). Jednostka w którejkolwiek z tych rodzin czytałaby się jako
 * stan CZEGOŚ INNEGO.
 */
export const UNIT_CORE_COLOR_COOL: Rgb = [0.98, 0.42, 0.98]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Barwa rdzenia przy PEŁNEJ ekspozycji — rozżarzenie. Luminancja 0,540216,
 * czyli kontrast wobec nocy nadal **5,86**, a wobec obrysu nocy **3,49**: kanał nadmiarowy
 * NIE kosztuje widoczności nocnej na żadnym kroku rampy (test 2). To jest wymóg, nie
 * ozdobnik — jednostka dogasająca w cieniu stoi właśnie na nocy.
 *
 * **To musi być barwa, nie ciemniejszy fiolet.** Szarość o identycznej luminancji ma ten sam
 * kontrast wobec każdego tła, więc żadna asercja oparta na luminancji jej nie odróżni, a
 * kanał barwy byłby martwy. Odległość tej barwy od szarości o jej własnej luminancji wynosi
 * w sRGB **0,5111**, a od barwy chłodnej **0,6782** — obie przypina test 2.
 *
 * Odległość od `CORE_COLOR_CRITICAL` budynku (rdzeń tuż przed zniszczeniem) to w sRGB
 * **0,2065**, czyli obie „umierające" rzeczy na tej planszy są ciepłe i nie da się ich
 * rozróżnić samym odcieniem. To jest świadomie przyjęte: rozróżnia je sylwetka (okrąg vs
 * sześciokąt), umiejscowienie (jednostka nigdy nie stoi na komórce z budynkiem — blokuje to
 * `updateMovement`) i ruch.
 */
export const UNIT_CORE_COLOR_HOT: Rgb = [1.0, 0.45, 0.08]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Liczba boków tarczy i rdzenia. Szesnastokąt czyta się jako OKRĄG już przy
 * średnicy 7 px (najdłuższy bok największego typu to 2,3 px), a okrągłość jest tym, co
 * odróżnia jednostkę od sześciokątnego budynku wpisanego w kratę.
 */
const UNIT_SIDES = 16; // [WYGLĄD]

/**
 * `[WYGLĄD]` Czynnik jasności jednostki per pasmo światła — materiał do Kroku 3 briefu,
 * NIEUŻYWANY w trybie domyślnym (`'flat'`). Tyle pozycji, ile pasm (`LIGHT_BANDS.length + 1`),
 * dokładnie jak `DEFAULT_PALETTE`; `unitShade` w trybie `'smooth'` interpoluje między
 * pierwszą a ostatnią.
 *
 * Wartości dobrane tak, żeby różnicę BYŁO WIDAĆ — inaczej porównanie obu wariantów niczego
 * by nie rozstrzygało. Kosztem jest kontrast: 0,55 łamie próg 3:1 wobec obrysu nocy
 * (granica wypada na **0,846334**, patrz komentarz modułu i test 17). Właśnie ten koszt jest
 * jedną z dwóch przesłanek werdyktu Kroku 3 — drugą jest to, co widać w ruchu.
 *
 * **Kto będzie ustawiał tu wariant LEGALNY (bramka Zadania 5), niech weźmie 0,8464, nie
 * 0,8463 ani 0,846334.** Granica jest KRESEM DOLNYM, nie osiągalnym minimum: `passesAt`
 * zwraca `false` zarówno dla 0,8463, jak i dla samej liczby 0,846334 (zaokrąglonej w dół do
 * sześciu cyfr), a `true` dopiero od 0,8464. Czynnik ustawiony dokładnie na wypisanej
 * granicy leży o włos PONIŻEJ progu 3:1, czyli poza budżetem, którego ma dowodzić.
 */
export const UNIT_BAND_SHADE: readonly number[] = [0.55, 0.78, 1.0]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Czynniki jasności w wariancie **LEGALNYM** — największe przyciemnienie, jakie
 * mieści się w budżecie kontrastu 3:1 wobec każdego tła. Materiał do pytania 4 bramki
 * Zadania 5, NIEUŻYWANY w trybie domyślnym (`'flat'`).
 *
 * Powód istnienia: drugie ogniwo argumentu Zadania 4 — „łagodnego cieniowania gładkiego i
 * tak nie widać" — **nie zostało obejrzane w granicach legalnych**. Obserwacja wzrokowa, na
 * której je oparto, była przy czynniku 0,55, czyli przy zmianie rdzenia o **59/255** w sRGB;
 * maksymalne legalne przyciemnienie zmienia rdzeń o **18/255**, a tego nie widział nikt.
 * Bramka Zadania 5 pokazuje człowiekowi DOKŁADNIE ten wariant.
 *
 * **0,8464, nie 0,8463 ani 0,846334.** Granica wyliczona bisekcją (test 17) to kres DOLNY,
 * nie osiągalne minimum: `passesAt` zwraca `false` dla samej liczby 0,846334 i `true` dopiero
 * od 0,8464. Czynnik ustawiony na wypisanej granicy leżałby o włos PONIŻEJ progu 3:1, czyli
 * poza budżetem, którego ma dowodzić. Parę „tuż przed / tuż za" przypina test 22.
 *
 * Środkowa pozycja to średnia arytmetyczna skrajnych — pasmo zmierzchu nie ma własnego
 * wymogu, a rampa równomierna jest jedynym wyborem, który nie wprowadza trzeciej liczby do
 * uzasadnienia.
 */
export const UNIT_BAND_SHADE_LEGAL: readonly number[] = [0.8464, 0.9232, 1.0]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Pojemność początkowa buforów instancji — liczba jednostek, które warstwa
 * rysuje bez ani jednej alokacji.
 *
 * **Oparta na pomiarze Fazy 1C: szczyt 481 ŻYWYCH jednostek w zwycięskim runie**
 * (5044 zrodzonych łącznie — ta druga liczba nie ma tu znaczenia, bufor trzyma żywe).
 * 2048 to **4,26× zmierzonego szczytu** i potęga dwójki. Zapas taki, a nie 2×, bo cały
 * `ENEMIES` i cała konfiguracja fal są oznaczone `[STROJENIE]` i Faza 3 dostroi je
 * headlessem — podwojenie tempa spawnu przy jednoczesnym osłabieniu wież jest realnym
 * wynikiem strojenia, czterokrotne nie jest. Koszt pomyłki w drugą stronę jest znikomy:
 * 2048 × 2 warstwy × 16 floatów = **262 kB** macierzy plus 49 kB barw, zaalokowane raz.
 *
 * BEZ markera `[WYGLĄD]` i to jest celowe: na ekranie nie widać tej liczby w żaden sposób,
 * bo po jej przekroczeniu warstwa rośnie i rysuje wszystko (patrz `rebuild`). To budżet
 * pamięci, nie wygląd — a `[WYGLĄD]` ma zostać etykietą, po której Faza 4 znajduje rzeczy
 * do STROJENIA WIZUALNEGO, nie wszystkim, co jest liczbą. Pilnuje tego test 18, asercją
 * na zbiorze nieoznaczonych stałych.
 */
export const INITIAL_UNIT_CAPACITY = 2048;

// --- Funkcje czyste: kodowanie stanu ----------------------------------------------------

/**
 * Ułamek drogi jednostki do śmierci od słońca, przycięty do `[0, 1]`.
 *
 * Przycięcie, nie wyjątek — z tego samego powodu co w `healthFraction`: `exposure`
 * przekracza `burnTime` w tym samym ticku, w którym jednostka ginie (`burning.ts` nabija
 * ekspozycję przed sprzątnięciem martwych), a render, który rzuca w takiej klatce,
 * wysadziłby aplikację na całkowicie poprawnym stanie symulacji.
 *
 * Dzielone przez `burnTime` TYPU, nie przez wspólną stałą: te same 2 sekundy w świetle to
 * 67% drogi do śmierci dla `SWARM` (`burnTime` 3) i 25% dla `ARMOR` (8). Kanał ma pokazywać
 * „ile temu zostało", a nie „jak długo stoi w słońcu" — inaczej nie odpowiadałby na pytanie,
 * na którym stoi ekonomia dnia i nocy.
 *
 * @throws {RangeError} gdy `burnTime` nie jest dodatni — to nie jest stan gry, tylko brak
 *   definicji typu (`ENEMIES[type].burnTime`), a dzielenie dałoby `Infinity`/`NaN` i cichy
 *   rdzeń o zerowej wielkości zamiast błędu.
 */
export function exposureFraction(exposure: number, burnTime: number): number {
  if (!(burnTime > 0)) {
    throw new RangeError(`exposureFraction: burnTime must be positive, got ${burnTime}`);
  }
  const f = exposure / burnTime;
  if (!(f > 0)) return 0;
  return f < 1 ? f : 1;
}

/**
 * Promień jasnego rdzenia jako ułamek jego promienia przy zerowej ekspozycji: liniowo od 1
 * (przy `fraction === 0`) do `UNIT_CORE_SCALE_MIN` (przy `fraction === 1`). ŚCIŚLE malejąca,
 * więc każda sekunda w świetle widać jako zmianę, a nie dopiero po przekroczeniu progu.
 */
export function burnCoreScale(fraction: number): number {
  return 1 - (1 - UNIT_CORE_SCALE_MIN) * fraction;
}

/**
 * Tryb cieniowania jednostki światłem — Krok 3 briefu Zadania 4.
 *
 * - `'flat'` — jednostka nie zależy od światła wcale (DOMYŚLNY, patrz komentarz modułu);
 * - `'threshold'` — czynnik jasności z `UNIT_BAND_SHADE[lightBand(light)]`, czyli funkcja
 *   SCHODKOWA, dokładnie jak teren (`writeCellColors`);
 * - `'smooth'` — czynnik interpolowany liniowo między pierwszym a ostatnim pasmem wg
 *   surowego `light`, czyli funkcja CIĄGŁA (odpowiednik `writeCellColorsSmooth`).
 */
export type UnitShadingMode = 'flat' | 'threshold' | 'smooth';

/**
 * Czynnik jasności, przez który mnożone są OBA tony jednostki. Funkcja czysta — to jest
 * całe rozstrzygane Krokiem 3 pytanie, sprowadzone do jednej liczby, żeby dało się je
 * zmierzyć (test 17), a nie tylko obejrzeć.
 *
 * `bands` jest parametrem, a nie odczytem stałej modułu, WYŁĄCZNIE po to, żeby bramka
 * Zadania 5 mogła pokazać wariant legalny (`UNIT_BAND_SHADE_LEGAL`) obok tego, na którym
 * stanął werdykt Zadania 4. Domyślna wartość jest tą samą stałą co wcześniej, więc każde
 * istniejące wywołanie znaczy dokładnie to samo, co znaczyło.
 */
export function unitShade(mode: UnitShadingMode, light: number, bands: readonly number[] = UNIT_BAND_SHADE): number {
  if (mode === 'flat') return 1;
  if (mode === 'threshold') return bands[lightBand(light)];
  const first = bands[0];
  const last = bands[bands.length - 1];
  const t = light < 0 ? 0 : light > 1 ? 1 : light;
  return first + (last - first) * t;
}

/**
 * Sprawdza, że tablica czynników jasności ma tyle pozycji, ile pasm, i że każda leży w
 * `(0, 1]`. Wywoływana przy KONSTRUKCJI i przy podmianie — nie w pętli renderu.
 *
 * @throws {RangeError} — czynnik 0 dałby jednostkę zgaszoną do czerni (czyli niewidoczną na
 *   nocy), czynnik > 1 rozjaśniłby ją ponad zadeklarowane barwy, a zła długość tablicy
 *   dałaby po cichu `undefined`, czyli barwę `NaN` na najwyższym paśmie.
 */
function validateShadingBands(bands: readonly number[], where: string): void {
  if (bands.length !== LIGHT_BANDS.length + 1) {
    throw new RangeError(
      `${where}: bands.length (${bands.length}) must equal LIGHT_BANDS.length + 1 (${LIGHT_BANDS.length + 1})`,
    );
  }
  for (let i = 0; i < bands.length; i++) {
    if (!(bands[i] > 0 && bands[i] <= 1)) {
      throw new RangeError(`${where}: bands[${i}] is ${bands[i]} — every factor must lie in (0, 1]`);
    }
  }
}

/**
 * Barwa rdzenia dla danego ułamka ekspozycji, przemnożona przez czynnik jasności:
 * interpolacja `UNIT_CORE_COLOR_COOL` → `UNIT_CORE_COLOR_HOT`. Pisze do `out` (trzy składowe
 * od `offset`) zamiast zwracać nową tablicę — ta funkcja biegnie w pętli renderu, raz na
 * jednostkę na klatkę.
 */
export function writeUnitCoreColor(fraction: number, shade: number, out: Float32Array, offset: number): void {
  for (let k = 0; k < 3; k++) {
    out[offset + k] = (UNIT_CORE_COLOR_COOL[k] + (UNIT_CORE_COLOR_HOT[k] - UNIT_CORE_COLOR_COOL[k]) * fraction) * shade;
  }
}

/** Barwa obwódki, przemnożona przez czynnik jasności. Ten sam kontrakt co wyżej. */
export function writeUnitRimColor(shade: number, out: Float32Array, offset: number): void {
  for (let k = 0; k < 3; k++) {
    out[offset + k] = UNIT_RIM_COLOR[k] * shade;
  }
}

// --- Warstwa ---------------------------------------------------------------------------

export interface UnitLayer {
  /**
   * Jeden węzeł do podpięcia. `createSceneWithRenderer` wiesza go jako DZIECKO siatki
   * terenu, nie jako rodzeństwo — `visible` w Three.js jest dziedziczne, więc wszystko, co
   * pokazuje stan świata na powierzchni planety, ma znikać razem z nią (tak samo jak krata
   * z Zadania 2 i budynki z Zadania 3; patrz test 14 tutaj i test 33 w `readabilityGate.test.ts`).
   */
  readonly object: Group;
  /** Wystawione dla testowalności — ten sam wzorzec co `BuildingLayer.shell`/`core`/`alert`. */
  readonly body: InstancedMesh;
  readonly core: InstancedMesh;
  /** Ile jednostek mieści się dziś w buforach bez alokacji. Rośnie tylko przy przekroczeniu. */
  readonly capacity: number;
  shadingMode(): UnitShadingMode;
  setShadingMode(mode: UnitShadingMode): void;
  /** Czynniki jasności pasm — patrz `UNIT_BAND_SHADE` / `UNIT_BAND_SHADE_LEGAL`. Kopia. */
  shadingBands(): readonly number[];
  setShadingBands(bands: readonly number[]): void;
  /**
   * Przepisuje macierze i barwy instancji z bieżącego `SimState.units`. Bezpieczne do
   * wołania co klatkę: NIC nie alokuje (test 13) i NICZEGO nie mutuje w wejściu (test 10).
   *
   * `light` to pole oświetlenia, którego symulacja użyła w tym ticku (`lightField`), po to
   * i tylko po to, żeby dało się przełączyć tryb cieniowania Kroku 3. W trybie domyślnym
   * (`'flat'`) jego WARTOŚCI nie wpływają na nic — ale jego DŁUGOŚĆ jest sprawdzana zawsze,
   * bo to ona pilnuje, że wywołujący podaje pole tej samej planety.
   */
  update(units: readonly Unit[], light: Float32Array): void;
  dispose(): void;
}

/**
 * Buduje warstwę jednostek dla planety. Bufory instancji mają `INITIAL_UNIT_CAPACITY`
 * miejsc; po przekroczeniu rosną (patrz niżej), nigdy nie gubiąc jednostki.
 */
export function createUnitLayer(planet: Planet): UnitLayer {
  // Szew między dwiema stałymi, których nic nie wiąże składniowo — ten sam, co między
  // `LIGHT_BANDS` a `DEFAULT_PALETTE` w `writeCellColors`, i sprawdzany w tym samym
  // miejscu cyklu życia: przy konstrukcji, nie w pętli renderu. Bez niego
  // `UNIT_BAND_SHADE[lightBand(...)]` po dołożeniu progu w Fazie 4 dawałoby po cichu
  // `undefined`, czyli barwę `NaN` i niewidzialne jednostki na najwyższym paśmie.
  validateShadingBands(UNIT_BAND_SHADE, 'createUnitLayer (UNIT_BAND_SHADE)');
  validateShadingBands(UNIT_BAND_SHADE_LEGAL, 'createUnitLayer (UNIT_BAND_SHADE_LEGAL)');
  const cellCount = planet.cells.length;
  const baseRadius = planet.radius * UNIT_RADIUS_FACTOR;
  const rimWidth = planet.radius * UNIT_RIM_FACTOR;
  const bodyLift = planet.radius * UNIT_LIFT_FACTOR;
  const coreLift = bodyLift + planet.radius * UNIT_CORE_LIFT_FACTOR;

  // Geometrie budowane RAZ i WSPÓŁDZIELONE przez wszystkie instancje — a przy powiększeniu
  // pojemności współdzielone dalej, przez nowe siatki (patrz `rebuild`), więc `dispose`
  // zwalnia je dokładnie raz.
  const bodyGeometry: BufferGeometry = buildDiscGeometry(UNIT_SIDES);
  const coreGeometry: BufferGeometry = buildDiscGeometry(UNIT_SIDES);

  // `MeshBasicMaterial` — BEZ modelu oświetlenia, tak samo jak teren i budynki
  // (`global-constraints.md`). Biel w obu materiałach, żeby `instanceColor` był JEDYNYM
  // źródłem barwy: Three.js mnoży `material.color × instanceColor`, więc każdy inny odcień
  // tutaj po cichu przesunąłby całą rampę i cały czynnik cieniowania.
  const bodyMaterial = new MeshBasicMaterial({ color: new Color(0xffffff) });
  const coreMaterial = new MeshBasicMaterial({ color: new Color(0xffffff) });

  const object = new Group();

  let capacity = 0;
  let body!: InstancedMesh;
  let core!: InstancedMesh;
  let bodyMatrices!: Float32Array;
  let coreMatrices!: Float32Array;
  let bodyColors!: Float32Array;
  let coreColors!: Float32Array;

  /**
   * Buduje (albo przebudowuje) obie siatki na `nextCapacity` instancji.
   *
   * ## Dlaczego pojemność MOŻE urosnąć, choć brief mówi „bufor alokowany raz"
   *
   * Bufor stały ma dokładnie trzy możliwe zachowania przy przepełnieniu i dwa z nich są
   * nie do przyjęcia w pętli renderu: rzucić wyjątek (wysadza aplikację na POPRAWNYM stanie
   * gry — „gracz jest zalewany" jest legalnym stanem, nie błędem programu) albo narysować
   * pierwsze `capacity` i resztę po cichu pominąć (gubi jednostki dokładnie w tej chwili,
   * w której gracz najbardziej potrzebuje je widzieć). Trzecie to powiększenie bufora.
   *
   * Powiększenie alokuje — ale WYŁĄCZNIE przy nowym rekordzie liczby żywych jednostek,
   * nigdy w stanie ustalonym, więc własność, o którą chodzi briefowi („zero alokacji w
   * pętli renderu"), zostaje utrzymana i jest zmierzona wprost: test 13 liczy cykle
   * odśmiecania przy PEŁNEJ pojemności, a test 12 sprawdza, że drugie wywołanie z tą samą,
   * przekroczoną liczbą jednostek już nic nie alokuje.
   */
  function rebuild(nextCapacity: number): void {
    const previousBody = body as InstancedMesh | undefined;
    const previousCore = core as InstancedMesh | undefined;

    const nextBody = new InstancedMesh(bodyGeometry, bodyMaterial, nextCapacity);
    const nextCore = new InstancedMesh(coreGeometry, coreMaterial, nextCapacity);
    // Bufory barw tworzone TERAZ, nie przy pierwszym `setColorAt` — inaczej pierwsza klatka
    // z jednostką alokowałaby 24 kB w pętli renderu.
    nextBody.instanceColor = new InstancedBufferAttribute(new Float32Array(nextCapacity * 3), 3);
    nextCore.instanceColor = new InstancedBufferAttribute(new Float32Array(nextCapacity * 3), 3);
    for (const mesh of [nextBody, nextCore]) {
      // Ten sam powód co przy budynkach: sfera otaczająca `InstancedMesh` wynika z macierzy
      // WSZYSTKICH instancji, a te zmieniają się co klatkę — przeliczanie jej byłoby
      // przejściem po całym buforze z alokacją, a nieprzeliczanie groziłoby zniknięciem
      // całej warstwy odciętej ostrosłupem widzenia.
      mesh.frustumCulled = false;
      mesh.count = 0;
    }

    if (previousBody) object.remove(previousBody, previousCore as InstancedMesh);
    object.add(nextBody, nextCore);
    previousBody?.dispose();
    previousCore?.dispose();

    body = nextBody;
    core = nextCore;
    bodyMatrices = nextBody.instanceMatrix.array as Float32Array;
    coreMatrices = nextCore.instanceMatrix.array as Float32Array;
    bodyColors = nextBody.instanceColor.array as Float32Array;
    coreColors = nextCore.instanceColor.array as Float32Array;
    capacity = nextCapacity;
  }

  rebuild(INITIAL_UNIT_CAPACITY);

  let mode: UnitShadingMode = 'flat';
  let bands: readonly number[] = UNIT_BAND_SHADE;

  /**
   * Parametry `writeInstance`, przekazywane przez ZAALOKOWANY RAZ bufor, a nie argumentami:
   * `[t1(3), t2(3), normalna(3), promień, odległość_od_środka]`.
   *
   * Dziwna forma, ta sama co w `buildingMesh.ts` i z tego samego POMIARU: V8 nie wstawia
   * takiej funkcji w ciało pętli, a każda niecałkowita liczba przekraczająca granicę
   * wywołania jest wtedy pudełkowana (`HeapNumber`), co daje kilkanaście cykli odśmiecania
   * na tysiąc klatek. Referencja na `Float32Array` i mały całkowity `slot` się nie pudełkują,
   * więc te dwa zostają zwykłymi argumentami.
   */
  const params = new Float64Array(11);

  /**
   * Wpisuje macierz jednej instancji WPROST do bufora `InstancedMesh` (to samo, co robi
   * `setMatrixAt`, bez pośrednictwa `Matrix4`). Układ kolumnowy: kolumny 0-2 to baza,
   * kolumna 3 to przesunięcie.
   *
   * Baza to `(t1·promień, t2·promień, normalna)`. W tej kolejności jest PRAWOSKRĘTNA
   * (`t1 × t2 = normalna`), więc nawinięcie trójkątów tarczy zostaje takie, jak zbudowane, a
   * odcinanie tylnych ścian nie zjada całej warstwy — dokładnie ta awaria zdarzyła się w
   * Zadaniu 3 i nie znalazł jej żaden test, tylko oczy (dziś pilnuje jej test 15).
   */
  function writeInstance(target: Float32Array, slot: number): void {
    const r = params[9];
    const d = params[10];
    const o = slot * 16;
    target[o] = params[0] * r;
    target[o + 1] = params[1] * r;
    target[o + 2] = params[2] * r;
    target[o + 3] = 0;
    target[o + 4] = params[3] * r;
    target[o + 5] = params[4] * r;
    target[o + 6] = params[5] * r;
    target[o + 7] = 0;
    target[o + 8] = params[6];
    target[o + 9] = params[7];
    target[o + 10] = params[8];
    target[o + 11] = 0;
    target[o + 12] = params[6] * d;
    target[o + 13] = params[7] * d;
    target[o + 14] = params[8] * d;
    target[o + 15] = 1;
  }

  return {
    object,
    get body(): InstancedMesh {
      return body;
    },
    get core(): InstancedMesh {
      return core;
    },
    get capacity(): number {
      return capacity;
    },

    shadingMode: (): UnitShadingMode => mode,
    setShadingMode(next: UnitShadingMode): void {
      mode = next;
    },

    shadingBands: (): readonly number[] => bands.slice(),
    setShadingBands(next: readonly number[]): void {
      validateShadingBands(next, 'UnitLayer.setShadingBands');
      bands = next.slice();
    },

    update(units: readonly Unit[], light: Float32Array): void {
      if (light.length !== cellCount) {
        throw new RangeError(
          `UnitLayer.update: light.length (${light.length}) must equal planet.cells.length (${cellCount})`,
        );
      }
      if (units.length > capacity) {
        // Podwajanie, nie dopasowanie co do sztuki: przy wzroście o jedną jednostkę na
        // klatkę dopasowanie alokowałoby CO KLATKĘ, czyli dokładnie to, czemu ten bufor ma
        // zapobiegać. Podwajanie daje log₂ alokacji na całą partię.
        let next = capacity;
        while (next < units.length) next *= 2;
        rebuild(next);
      }

      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const def = ENEMIES[unit.type];
        const shape = UNIT_SHAPES[unit.type];
        if (def === undefined || shape === undefined) {
          throw new RangeError(`UnitLayer.update: unknown enemy type "${unit.type}" at index ${i}`);
        }
        // `cellId` poza zakresem dałoby `light[cellId] === undefined`, a `lightBand(undefined)`
        // cicho zwraca 0 („noc") — czyli cichą, BŁĘDNĄ klasyfikację zamiast błędu. Ten sam
        // strażnik i ten sam powód, co przy `light.length` w `writeCellColors`.
        const cellId = unit.cellId;
        if (!(cellId >= 0 && cellId < cellCount)) {
          throw new RangeError(
            `UnitLayer.update: units[${i}].cellId is ${cellId} — outside [0, ${cellCount})`,
          );
        }

        const px = unit.pos.x;
        const py = unit.pos.y;
        const pz = unit.pos.z;
        // `Math.sqrt(x² + y² + z²)`, nie `Math.hypot`: zmierzone `v8.GCProfiler` na 600
        // wywołaniach przy 2048 jednostkach — `Math.hypot` daje **15 cykli odśmiecania**
        // (przyjmuje argumenty przez `rest` i alokuje tablicę na każde wywołanie), `sqrt`
        // daje **0**. `Math.hypot` chroni przed nadmiarem/niedomiarem przy skrajnych
        // wykładnikach; tutaj argumenty leżą na sferze o promieniu 100, więc ta ochrona
        // nie ma czego chronić.
        const length = Math.sqrt(px * px + py * py + pz * pz);
        if (!(length > 0)) {
          // Wektor zerowy nie ma kierunku, więc nie ma z czego zbudować bazy stycznej —
          // to jest błąd programu (jednostka w środku planety), nie stan gry.
          throw new RangeError(`UnitLayer.update: units[${i}].pos is a zero vector`);
        }
        const inv = 1 / length;
        const nx = px * inv;
        const ny = py * inv;
        const nz = pz * inv;

        // Baza styczna z osi NAJMNIEJ zgodnej z normalną — jedyny wybór, przy którym
        // odejmowanie składowej wzdłuż normalnej nigdy nie daje wektora zerowego.
        // Przy przejściu jednostki przez granicę tego wyboru baza skacze, czyli
        // szesnastokąt obraca się o co najwyżej 22,5°. Sylwetka zmienia się przy tym o
        // `r·(1 − cos 11,25°)` = 1,9% promienia, czyli **0,11 px** dla największego typu —
        // poniżej progu widoczności, więc tarcza nie „pyka" przy przekroczeniu granicy.
        let ax = 0;
        let ay = 0;
        let az = 0;
        const absX = nx < 0 ? -nx : nx;
        const absY = ny < 0 ? -ny : ny;
        const absZ = nz < 0 ? -nz : nz;
        if (absX <= absY && absX <= absZ) ax = 1;
        else if (absY <= absZ) ay = 1;
        else az = 1;
        const along = ax * nx + ay * ny + az * nz;
        let t1x = ax - along * nx;
        let t1y = ay - along * ny;
        let t1z = az - along * nz;
        const t1inv = 1 / Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
        t1x *= t1inv;
        t1y *= t1inv;
        t1z *= t1inv;

        params[0] = t1x;
        params[1] = t1y;
        params[2] = t1z;
        // t2 = normalna × t1, więc (t1, t2, normalna) jest prawoskrętna.
        params[3] = ny * t1z - nz * t1y;
        params[4] = nz * t1x - nx * t1z;
        params[5] = nx * t1y - ny * t1x;
        params[6] = nx;
        params[7] = ny;
        params[8] = nz;

        const radius = baseRadius * shape;
        params[9] = radius;
        params[10] = length + bodyLift;
        writeInstance(bodyMatrices, i);

        const fraction = exposureFraction(unit.exposure, def.burnTime);
        // Promień rdzenia liczony przez ODJĘCIE obwódki o STAŁEJ szerokości od promienia
        // tarczy, nie przez ułamek promienia — patrz `UNIT_RIM_FACTOR`.
        params[9] = (radius - rimWidth) * burnCoreScale(fraction);
        params[10] = length + coreLift;
        writeInstance(coreMatrices, i);

        const shade = unitShade(mode, light[cellId], bands);
        writeUnitRimColor(shade, bodyColors, i * 3);
        writeUnitCoreColor(fraction, shade, coreColors, i * 3);
      }

      body.count = units.length;
      core.count = units.length;
      body.instanceMatrix.needsUpdate = true;
      core.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      if (core.instanceColor) core.instanceColor.needsUpdate = true;
    },

    dispose(): void {
      bodyGeometry.dispose();
      coreGeometry.dispose();
      bodyMaterial.dispose();
      coreMaterial.dispose();
      body.dispose();
      core.dispose();
    },
  };
}
