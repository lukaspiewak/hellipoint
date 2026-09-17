import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
} from 'three';
import type { Building, BuildingType, Planet } from '@heliopolis/sim';
import { BUILDINGS, OUTAGE_UNLINKED } from '@heliopolis/sim';
import type { PlanetGeometry } from './geometry.js';
import type { Rgb } from './shading.js';

/**
 * Budynki na ekranie (Faza 2B, Zadanie 3): do 1442 sztuk naraz, każda na środku swojej
 * komórki, zorientowana jej normalną, z DWOMA stanami czytelnymi bez UI — `powered` i
 * `hp`.
 *
 * Render TYLKO CZYTA `SimState.buildings` (`global-constraints.md`); ten moduł nie ma
 * żadnej ścieżki zapisu do symulacji ani do `Planet`.
 *
 * ## Dlaczego budynek jest DWUTONOWY, i dlaczego to nie jest estetyka
 *
 * Paleta terenu jest LINIOWA (patrz `Rgb` w `shading.ts`), a jej luminancje to
 * **0,0508 / 0,4926 / 0,9198** (noc / zmierzch / dzień). Z tego wynika twarde
 * ograniczenie, które policzyłem ZANIM dobrałem jakikolwiek kolor:
 *
 * > **Żaden pojedynczy ton nie osiąga kontrastu WCAG 3:1 wobec wszystkich trzech pasm.**
 * > Optimum (maksimum minimum po trzech pasmach) wynosi **2,3202** i wypada przy
 * > luminancji **0,18388**. Przeszukane po całym zakresie luminancji z krokiem 10⁻⁵.
 *
 * Dowód jest jednolinijkowy: żeby mieć 3:1 wobec DNIA trzeba luminancji ≤ 0,2733, żeby mieć
 * 3:1 wobec NOCY trzeba ≥ 0,2524, a żeby mieć 3:1 wobec ZMIERZCHU trzeba ≤ 0,1309 (górna
 * gałąź, ≥ 1,578, leży poza zakresem). Przedziały `[0,2524; 0,2733]` i `(-∞; 0,1309]` są
 * rozłączne. Najsłabszym bokiem jest zmierzch↔dzień (kontrast **1,79** — `global-constraints.md`):
 * to on zjada cały zapas, bo kolor odcinający się od zmierzchu leży już blisko dnia.
 *
 * Stąd konstrukcja: każdy budynek niesie JEDNOCZEŚNIE ton bardzo ciemny i ton bardzo jasny.
 * Ciemny (`SHELL_COLOR`, L = 0,0140) daje 8,48 wobec zmierzchu i 15,15 wobec dnia; jasny
 * (`CORE_COLOR_HEALTHY`, L = 0,9621) daje 10,04 wobec nocy. Suma pokrywa wszystkie trzy
 * pasma — i wszystkie trzy barwy KRATY (`DEFAULT_OUTLINE_PALETTE`), która też bywa tłem
 * budynku — z zapasem nie mniejszym niż 5,99. Pilnuje tego test 1 w `buildingMesh.test.ts`,
 * razem z kontrolą pozytywną: ŻADEN z tych dwóch tonów sam nie przechodzi progu 3:1 na
 * wszystkich trzech pasmach, więc dwutonowość jest wymogiem, nie ozdobnikiem.
 *
 * To jest dokładnie ten sam mechanizm, który `readabilityGate.ts` zastosował do znacznika
 * bramki („pierścień jest dwutonowy… jasna część wybija się na tle nocy, ciemna na tle
 * dnia") — tam wprowadzony z obserwacji, tutaj policzony.
 *
 * ## Trzy warstwy, trzy rozłączne role
 *
 * | warstwa | geometria | co niesie |
 * |---|---|---|
 * | `shell` | graniastosłup sześciokątny, ciemny | obecność budynku + jego TYP (rozmiar bryły) |
 * | `core`  | płaski sześciokąt na szczycie, jasny | `hp` — POLE jasnego rdzenia i jego BARWA |
 * | `alert` | obręcz PRZERYWANA wokół podstawy, dwutonowa | `powered === false` |
 * | `link`  | cztery wycinki DOMYKAJĄCE tę obręcz | budynek jest wprawdzie bez prądu, ale wciąż w sieci |
 *
 * Każda to jeden `InstancedMesh`, czyli cztery wywołania rysowania niezależnie od tego, czy
 * budynków jest jeden, czy 1442.
 *
 * ## Czwarta warstwa: DLACZEGO budynek nie ma prądu (Faza 2C, Zadanie 4, Krok 6)
 *
 * `powered === false` zlewało DWIE przyczyny, które wymagają DWÓCH różnych reakcji gracza:
 *
 * - **brownout** — sieć stoi, ale zabrakło mocy (`BROWNOUT_ORDER` gasi ekstraktory PIERWSZE,
 *   więc cztery lasery po 12/s przy produkcji 10/s wyłączają kopalnie; to jest zmierzony
 *   łańcuch Q3 z Fazy 1C). Reakcja: dobuduj produkcję albo rozbierz odbiornik;
 * - **odcięcie od sieci** — nie ma drogi do CORE (`DISRUPTOR` zjadł pylony; Q4). Reakcja:
 *   napraw pylon. Dobudowanie produkcji nie pomoże TUTAJ ani trochę.
 *
 * Kodowanie: **obręcz PRZERWANA znaczy „poza siecią", obręcz ZAMKNIĘTA — „w sieci, ale bez
 * mocy"**. Metafora jest obwodem elektrycznym i czyta się bez instrukcji: przerwany obwód to
 * zerwane połączenie.
 *
 * Dlaczego akurat kąt, skoro ograniczenia dopuszczały też barwę:
 *
 * - **promienia nie ma**. Budżet między największą bryłą (2,0) a sufitem komórki (3,1720) to
 *   1,17 j.; obręcz zajmuje go w całości, a resztka 0,1420 j. należy do pulsu. Nowy pierścień
 *   nie ma gdzie stanąć — a wewnątrz bryły miejsce jest tylko przy MAŁYCH typach, czyli
 *   akurat nie tam, gdzie próg wiąże;
 * - **barwa kosztuje dwa tony**. Żaden pojedynczy ton nie osiąga 3:1 wobec wszystkich trzech
 *   pasm terenu (optimum 2,3202), więc czwarty komunikat barwny wymagałby kolejnej PARY
 *   barw, obok trzech już zajętych („budynek", „ranny", „bez prądu"). Przerwa nie wnosi ani
 *   jednej barwy: usuwa OBIE naraz, więc na nocy widać jej brak w pasie jasnym, a na dniu
 *   i zmierzchu — w ciemnym. Dwutonowość jest dziedziczona, nie dokładana;
 * - **kąt był jedynym wymiarem obręczy, którego nic nie zajmowało.** Do Zadania 4 obręcz
 *   była pełnym, jednolitym okręgiem: 360° jednej informacji.
 *
 * Kanał pierścienia jako takiego pozostaje ZAJĘTY przez `powered === false` i nie został
 * naruszony: obręcz jest pod każdym budynkiem bez prądu, a `alert.count` nadal równa się
 * liczbie takich budynków. Przerwy są podziałem WEWNĄTRZ tego kanału, nie jego zamianą.
 *
 * Najgorszym członkiem populacji jest tu `PYLON`, i to nie przypadkiem: jego bryła jest
 * najmniejsza, więc obręcz zaczyna się u niego najbliżej środka, a łuk o zadanym kącie jest
 * tam najkrótszy. Przerwa ma u niego **2,01 px** na krawędzi pasa jasnego przy progu 1,00 px
 * (`ALERT_BREAK_FRACTION`). `PYLON` to zarazem szkielet sieci, której awarię ten kanał
 * zgłasza — czyli ten sam budynek, który jest najczęstszą PRZYCZYNĄ odcięcia sąsiadów.
 *
 * ## Czego tu NIE MA: tej warstwy nie ma w scenie bramki czytelności — i to jest decyzja
 *
 * `createReadabilityGate` (`readabilityGate.ts`) dostaje `Planet`, a NIE `SimState` — nie ma
 * więc żadnych budynków do pokazania. Dołożenie tam pustej warstwy oznaczałoby wstawienie do
 * sceny trzech obiektów WIDOCZNYCH, ale nie rysujących nic, i podbicie przypiętych liczb w
 * teście 33 (`readabilityGate.test.ts`) bez żadnego zysku; wymyślenie budynków na potrzeby
 * bramki oznaczałoby, że bramka mierzy scenę, której gra nigdy nie renderuje. Scenę pełną —
 * teren + krata + budynki + jednostki — bada Zadanie 5 (Krok 1 jego briefu) i to ono jest
 * właścicielem tej zmiany. Test 33 przechodzi więc dziś bez dotknięcia.
 *
 * Zapadka na Zadanie 5 jest natomiast UZBROJONA i przetestowana z tej strony: `scene.ts`
 * wiesza `object` jako DZIECKO siatki terenu, a test 15 w `buildingMesh.test.ts` sprawdza na
 * scenie przekazywanej rendererowi, że schowanie samej planety gasi wszystkie trzy warstwy.
 * Gdy Zadanie 5 wstawi tę warstwę do bramki tym samym sposobem, kontrola pozytywna zachowa
 * zdolność do oblania; test 33 zażąda wtedy tylko podniesienia dwóch przypiętych liczb.
 *
 * ## Dlaczego stan NIEZASILONY dostał OSOBNĄ warstwę, a nie zmianę barwy budynku
 *
 * Brownout gasi obronę w środku ataku (§5.1), więc ten stan ma być widoczny NATYCHMIAST.
 * Naturalny odruch — „zgaś budynek", czyli zabierz mu jasny rdzeń — jest tu najgorszym
 * możliwym wyborem: jasny rdzeń to JEDYNY ton budynku widoczny na paśmie NOCY (ciemna
 * skorupa ma tam 1,57). Budynek niezasilony stałby się więc niewidoczny na całej półkuli
 * nocnej — dokładnie tam, gdzie brownout boli najbardziej, bo panele słoneczne nie produkują.
 * Kodowanie przez ZNIKNIĘCIE jest też z natury słabsze od kodowania przez POJAWIENIE SIĘ:
 * brak czegoś trzeba zauważyć, obecność czegoś rzuca się w oczy sama.
 *
 * Dlatego stan niezasilony DOKŁADA pierścień, zamiast cokolwiek zabierać, i pierścień jest
 * dwutonowy z tego samego powodu co budynek.
 *
 * Do rundy naprawczej 2 Zadania 3 promień pierścienia dodatkowo PULSOWAŁ — ruch jest jedynym
 * kanałem, którego pasma terenu w ogóle nie zajmują, bo teren jest nieruchomy. Tamto zadanie
 * puls wyłączyło nie dlatego, że był złym pomysłem, tylko dlatego, że komórka jest za mała,
 * żeby pomieścić i jego wychylenie, i dwa pasy obręczy, każde ponad progiem widoczności
 * jednego piksela (rachunek przy `ALERT_RADIUS_FACTOR`). Ruch bez sufitu narzuconego
 * rozmiarem komórki jest możliwy przez OBRACANIE obręczy z segmentów zamiast jej skalowania;
 * to zostaje jako kandydat dla Fazy 4.
 *
 * **Runda naprawcza 2 Zadania 5: PULS WRÓCIŁ i jest domyślnym wyglądem gry.** Przesłanka, na
 * której Zadanie 3 go wyłączyło, upadła — nie przez zmianę geometrii, tylko przez OBEJRZENIE.
 * Rachunek Zadania 3 mówił: trzy wielkości, każda ponad progiem widoczności 1 px, nie mieszczą
 * się w budżecie 4,00 px między bryłą a krawędzią komórki. Był poprawny. Milcząco zakładał
 * jednak, że próg 1 px obowiązuje TAKŻE dla wychylenia — a ten próg pochodzi z §5.3 raportu
 * Zadania 3, gdzie ustalono go obejrzeniem **cechy NIERUCHOMEJ** (pas obręczy cieńszy niż
 * piksel znikał). Człowiek przy bramce Zadania 5 zobaczył puls o amplitudzie **0,44 px**.
 *
 * Czyli: **próg 1 px obowiązuje dla ROZMIARÓW, a ruch jest wykrywalny poniżej niego.** Żaden
 * próg Zadań 3 i 4 nie traci przez to ważności — wszystkie dotyczą rozmiarów — ale granica ich
 * stosowalności ma teraz nazwę.
 *
 * Stąd puls domyślnie WŁĄCZONY, na maksymalnej legalnej amplitudzie: stan „bez prądu" jest
 * stanem, który boli (brownout gasi obronę w środku ataku, §5.1), a drugi kanał jest darmowy —
 * mieści się w budżecie komórki i został zmierzony jako widoczny. **Amplitudy NIE wolno
 * podnosić**: sufitem jest rozmiar komórki i to się nie zmieniło (test 8 pilnuje tego NA
 * SZCZYCIE pulsu, `update` egzekwuje wyjątkiem).
 *
 * Warstwa nadal nie zna zegara — fazę liczy wywołujący, funkcją czystą `alertPulse`.
 *
 * ## Skąd biorą się PIKSELE w tym pliku
 *
 * Każda liczba „x px" poniżej to jednostki świata przeliczone przez skalę widoku domyślnego
 * **3,4119 px/j**, WYPROWADZONĄ ze stałych `camera.ts` — wyprowadzenie, jego kontrola
 * negatywna i kotwica: `test/support/pixelScale.ts` oraz `camera.test.ts`. Zestrojenie
 * kadrowania w Fazie 4 zmienia tę skalę i oblewa kotwicę; wtedy przelicz także te komentarze.
 *
 * Do rundy domykającej gałąź stała tu skala **3,22**, obalona w `f71d499`: dziewięć liczb
 * pikselowych w tym pliku było przez to zaniżonych o 6%, w stronę NIEZACHOWAWCZĄ dla
 * wszystkiego, co się od budżetu odejmuje. Poprawione wszystkie.
 *
 * ## Dlaczego `hp` jest kodowane POLEM, a nie samą barwą
 *
 * Kodowanie jasnością koliduje z pasmami (wyżej), więc `hp` prowadzi kanał GEOMETRYCZNY:
 * promień jasnego rdzenia maleje z `hp`, a ciemna obwódka wokół niego rośnie. Ten odczyt
 * działa na obu tłach skrajnych z osobna: na nocy kurczy się jasna plama, na dniu grubieje
 * ciemna ramka. Barwa rdzenia (biel → czerwień) idzie z tym RÓWNOLEGLE, jako kanał
 * nadmiarowy — i wolno jej to robić dokładnie dlatego, że rdzeń NIGDY nie sąsiaduje z
 * terenem: zawsze oddziela go ciemna obwódka skorupy, jak ramka legendy na mapie. Cała
 * rampa barwy trzyma przy tym ≥ 4,25 kontrastu wobec nocy (minimum na końcu krytycznym),
 * więc kanał nadmiarowy nie kosztuje widoczności nocnej — pilnuje tego test 2.
 *
 * Rozmiar rdzenia nie kłóci się z kodowaniem TYPU, bo typ siedzi w rozmiarze SKORUPY, a
 * rdzeń skaluje się WZGLĘDEM swojej skorupy. Mała, zdrowa `PYLON` ma rdzeń wypełniający jej
 * szczyt; duży, rozbity `CORE` ma mały rdzeń w szerokiej ciemnej ramce.
 */

// --- Stałe wizualne — [WYGLĄD] ---------------------------------------------------------

/**
 * `[WYGLĄD]` Promień podstawy budynku o rozmiarze 1,0, jako ułamek promienia planety
 * (jak `OUTLINE_LIFT`/`MARKER_SCALE_FACTOR` — nie stała światowa, bo `createPlanet` może
 * dostać inny `radius`).
 *
 * **Wiążąca jest odległość środka od KRAWĘDZI obrysu, nie od jego NAROŻNIKA** — bo i bryła,
 * i pierścień alarmu są okrągłe, a okrąg mieści się w wieloboku wtedy i tylko wtedy, gdy jest
 * mniejszy od promienia WPISANEGO. Zmierzone na tej planecie (1442 komórki, `radius` 100),
 * kątowo od środka planety, więc bez przybliżeń płaskich:
 *
 *   najmniejsza odległość środek → KRAWĘDŹ obrysu:   **3,1720**  ← ta ogranicza
 *   najmniejsza odległość środek → NAROŻNIK obrysu:  **3,9208**
 *
 * Największy budynek ma promień **2,0**, więc ani jedna z 1442 komórek nie ma bryły
 * wychodzącej poza kratę — sprawdza to test 8 na WSZYSTKICH komórkach. Sąsiednie środki
 * dzieli co najmniej **7,796**, więc dwa sąsiadujące budynki maksymalnego rozmiaru dzieli
 * nadal 3,8 jednostki pustego terenu; są policzalne jako osobne bryły.
 *
 * > Do rundy naprawczej 1 stało tu 0,022 (bryła 2,2). Zmniejszone razem z naprawą
 * > `ALERT_RADIUS_FACTOR`: pierścień alarmu musiał się skurczyć, żeby zmieścić się w komórce,
 * > a widoczna obręcz to `promień pierścienia − promień bryły` — te 0,2 jednostki oddane
 * > przez bryłę wracają jako 0,2 jednostki obręczy przy KAŻDYM budynku.
 */
export const BUILDING_RADIUS_FACTOR = 0.02; // [WYGLĄD]

/** `[WYGLĄD]` Wysokość budynku o rozmiarze 1,0, jako ułamek promienia planety. */
export const BUILDING_HEIGHT_FACTOR = 0.024; // [WYGLĄD]

/**
 * `[WYGLĄD]` Zwężenie bryły ku górze: promień szczytu jako ułamek promienia podstawy.
 * Sylwetka zwężona ku górze czyta się jako budynek, walec — jako kropka wyciągnięta w górę.
 * Szczyt musi zostać szerszy od rdzenia o `CORE_RIM_FACTOR` — patrz niżej.
 */
export const SHELL_TAPER = 0.82; // [WYGLĄD]

/**
 * `[WYGLĄD]` Szerokość ciemnej obwódki między jasnym rdzeniem a krawędzią szczytu skorupy,
 * jako ułamek promienia planety. Promień rdzenia przy pełnym `hp` to
 * `promień_szczytu − ta_szerokość`, więc obwódka jest **JEDNAKOWA dla wszystkich dziesięciu
 * typów**: 0,35 jednostki, czyli 1,19 piksela z widoku domyślnego.
 *
 * ## Dlaczego stała szerokość, a nie ułamek promienia bryły (runda naprawcza 2)
 *
 * Do rundy 2 rdzeń miał promień `0,55 × promień bryły`, czyli obwódka była PROPORCJONALNA.
 * Skutek: spełniała próg widoczności wyłącznie dla `CORE` (1,84 px), a dla dziewięciu
 * pozostałych typów leżała poniżej — `PYLON` miał **0,63 px**. Ciemna obwódka to
 * zadeklarowany nośnik czytelności budynku na paśmie dnia (rdzeń ma tam kontrast 1,04) i
 * jedyne, co oddziela czerwony rdzeń od pomarańczu zmierzchu (odległość barw 0,195) — dla
 * większości typów po prostu jej nie było.
 *
 * Obwódka jest RAMKĄ, a ramki mają stałą szerokość niezależnie od wielkości tego, co
 * obramowują — dokładnie tak jak ramka próbki w legendzie mapy. Ta zmiana jest naprawą
 * wzorca, nie zestrojeniem liczby: przy proporcji żaden próg postawiony na MINIMUM po
 * populacji nie dałby się spełnić bez zrównania wszystkich typów co do wielkości.
 *
 * Warunek konieczny: każdy typ musi mieć szczyt szerszy niż ta obwódka, inaczej rdzeń
 * miałby promień ujemny. Najmniejszy szczyt (`PYLON`) ma 1,0496 przy obwódce 0,35.
 */
export const CORE_RIM_FACTOR = 0.0035; // [WYGLĄD]

/**
 * `[WYGLĄD]` Promień rdzenia przy `hp === 0`, jako ułamek jego promienia przy pełnym `hp`.
 *
 * Ta jedna liczba rozdziela DWA progi widoczności, które ciągną w przeciwne strony, i musi
 * spełnić OBA dla NAJMNIEJSZEGO typu (`PYLON`), nie dla największego:
 *
 *   • rdzeń przy zerowym `hp` musi zostać widoczny — to jedyny ton budynku widoczny na
 *     paśmie nocy (skorupa ma tam 1,57), więc zjechanie do zera znaczyłoby „budynek tuż
 *     przed zniszczeniem znika z nocnej półkuli";
 *   • SKOK promienia między pełnym a zerowym `hp` musi być widoczny — bo to on jest
 *     sygnałem uszkodzenia.
 *
 * Suma obu jest stała i równa promieniowi rdzenia przy pełnym `hp`, więc **0,5 to jedyna
 * wartość, która dzieli budżet `PYLON`-a po równo**: 1,19 px na każdy. Przy 0,42 (do rundy
 * naprawczej 2) rdzeń `PYLON`-a przy zerowym `hp` miał 0,82 px, czyli poniżej progu.
 * Pole rdzenia spada przy tym do **0,25** pola przy pełnym `hp`.
 */
export const CORE_SCALE_MIN = 0.5; // [WYGLĄD]

/**
 * `[WYGLĄD]` Promień pierścienia alarmu (`powered === false`), jako ułamek promienia planety.
 *
 * ## Runda naprawcza 1: ta stała była ZA DUŻA, a strażnik mierzył nie tę wielkość
 *
 * Do rundy naprawczej 1 stało tu **0,032** (spoczynek 3,20, szczyt pulsu 3,81), a test 8
 * porównywał to z `min|narożnik − środek| × (1 − OUTLINE_INSET) = 3,9126`. To jest promień
 * **OPISANY** komórki. Obrys nie przechodzi przez narożniki — to zamknięta pętla po nich —
 * więc okrąg mieści się w nim wtedy i tylko wtedy, gdy jest mniejszy od promienia
 * **WPISANEGO**. Zmierzone kątowo od środka planety, na wszystkich 1442 komórkach:
 *
 *   środek → KRAWĘDŹ obrysu, minimum:   **3,1720**   ← wiążąca
 *   środek → NAROŻNIK obrysu, minimum:  **3,9208**   ← z tym porównywał test
 *
 * Skutek na ówczesnej geometrii, policzony nie oszacowany: **12 komórek, w których pierścień
 * przecinał kratę już w spoczynku** (dokładnie wszystkie 12 pięciokątów, czyli najmniejsze
 * komórki planety) i **72 komórki, w których wchodził na sąsiada na szczycie pulsu**,
 * największe wyjście **0,6360**. Pierścień jest przy tym uniesiony wyżej niż krata, więc
 * rysował PO niej, nie pod nią — a dla budynku przy terminatorze znaczyło to bursztyn po
 * granicy dnia i nocy, czyli po własności nadrzędnej wobec wszystkiego, co ta faza dodaje
 * (`global-constraints.md`).
 *
 * ## Runda naprawcza 2 Zadania 3: promień podniesiony do maksimum, obręcz dostała CAŁY budżet
 *
 * Budżet między największą bryłą (2,0) a sufitem komórki (3,1720) wynosi **1,17 jednostki**,
 * czyli **4,00 piksela** z widoku domyślnego. Muszą się w nim zmieścić TRZY rzeczy naraz:
 * jasny pas obręczy (nośnik alarmu na nocy), ciemny pas (nośnik na dniu i zmierzchu) oraz
 * wychylenie pulsu. Zadanie 3 żądało wtedy, żeby każde z nich osobno przekroczyło piksel —
 * bo §5.3 jego raportu ustaliło OBEJRZENIEM, że pas cieńszy niż piksel jest niewidoczny.
 *
 * Trzy razy po pikselu mieści się w 4,00 piksela z zapasem 1,00 px — czyli tylko wtedy, gdy
 * KAŻDA z trzech wielkości stoi blisko progu. Stąd ówczesny wybór: **obręcz dostaje cały
 * budżet**, każdy pas ma **1,76 px** przy najgorszym (największym) budynku — zamiast 1,65 px
 * pasa i 1,65 px wychylenia, z których żadne nie miałoby zapasu.
 *
 * ## PRZESŁANKA TEGO RACHUNKU UPADŁA (bramka Zadania 5, ustalenie U2) — puls WRÓCIŁ
 *
 * Rachunek był poprawny, ale milcząco stosował próg 1 px także do WYCHYLENIA, a ten próg
 * pochodzi z obejrzenia cechy NIERUCHOMEJ. **Człowiek przy bramce Zadania 5 zobaczył puls
 * o amplitudzie 0,44 px**, czyli: próg 1 px wiąże ROZMIARY, a ruch jest wykrywalny poniżej
 * niego (pełny zapis w nagłówku tego modułu). Nic w tej stałej się przez to nie zmienia —
 * obręcz zostaje na maksimum, a puls mieści się w resztce 0,1420 j., którą ten podział
 * zostawił — ale **zdanie „puls odpada" przestało obowiązywać i nie jest tu pytaniem
 * otwartym.** Nie przywracać go: to jest werdykt człowieka, nie strojenie.
 *
 * Amplitudy nadal NIE WOLNO podnosić: sufitem jest rozmiar komórki i to się nie zmieniło.
 * Droga bez tego sufitu istnieje (obręcz z segmentów, OBRACANA zamiast skalowanej — rotacja
 * nie zmienia zajmowanego miejsca) i zostaje jako kandydat dla Fazy 4, nie jako brak.
 *
 * ## Dzisiejsze liczby
 *
 *   promień **3,0300**, zapas do krawędzi **0,1420** (4,5%), komórek z przekroczeniem **0 z 1442**
 *   widoczna obręcz poza największą bryłą: **1,0300** (3,51 px)
 *
 * Pierścień ma rozmiar STAŁY, niezależny od typu budynku: to alarm, a nie część bryły.
 * Alarm o zmiennej wielkości byłby najmniejszy akurat przy najmniejszych budynkach —
 * a najmniejszy z nich to `PYLON`, czyli szkielet sieci energetycznej, której awaria
 * ten alarm zgłasza.
 */
export const ALERT_RADIUS_FACTOR = 0.0303; // [WYGLĄD]

/**
 * `[WYGLĄD]` Maksymalne wychylenie pulsu pierścienia alarmu — jako ułamek promienia planety
 * (0,13 jednostki). **Domyślnie NIEUŻYWANE: `update` bez drugiego argumentu rysuje pierścień
 * dokładnie tak, jak rysował po rundzie naprawczej 2 Zadania 3, bit w bit.**
 *
 * ## Po co to jest, skoro Zadanie 3 puls USUNĘŁO
 *
 * Bo usunęło go POMIAREM, a brief Zadania 5 mówi wprost, że rozstrzyga to CZŁOWIEK: „jeśli
 * pulsu nie widać, zapisz to jako wynik i zostaw pierścień bez pulsu, zamiast podnosić
 * amplitudę ponad rozmiar komórki". Żeby dało się odpowiedzieć uczciwie, człowiek musi móc
 * zobaczyć puls — ale WYŁĄCZNIE taki, który dałoby się wysłać na ekran.
 *
 * ## Skąd ta liczba: to jest CAŁA reszta budżetu, nie wybór
 *
 * Pierścień stoi w spoczynku na 3,0300, a sufit narzucony rozmiarem komórki (najmniejsza
 * odległość środek → KRAWĘDŹ obrysu, mierzona kątowo na wszystkich 1442 komórkach) wynosi
 * **3,1720**. Cały pozostały zapas to **0,1420** jednostki. Puls rośnie WYŁĄCZNIE w górę od
 * spoczynku — konfiguracja spoczynkowa jest tą, która maksymalizuje szerokość obu pasów
 * obręczy, więc nie ma z czego zejść w dół — a 0,13 zostawia 0,012 jednostki marginesu na
 * ostatni bit zaokrąglenia macierzy.
 *
 * **W pikselach widoku domyślnego 0,13 jednostki to 0,44 px** — mniej niż połowa progu
 * widoczności (`MIN_VISIBLE_PX` = 1 px, §5.3 raportu Zadania 3). Czyli: to NIE jest amplituda
 * dobrana tak, żeby puls było widać; to jest maksimum tego, co w ogóle istnieje. Sufitem
 * jest ROZMIAR KOMÓRKI, nie dobór wartości — i dokładnie tę różnicę bramka pokazuje.
 */
export const ALERT_PULSE_AMPLITUDE_FACTOR = 0.0013; // [WYGLĄD]

/**
 * `[WYGLĄD]` Okres pulsu w sekundach. Wolniej niż tętno spoczynkowe — puls ma czytać się jako
 * RUCH, nie jako migotanie, a gracz ma go zauważyć peryferyjnie, nie zostać nim zmęczony.
 */
export const ALERT_PULSE_PERIOD_SECONDS = 1.6; // [WYGLĄD]

declare const ALERT_PULSE_OFFSET_BRAND: unique symbol;

/**
 * WYCHYLENIE PROMIENIA pierścienia alarmu, w JEDNOSTKACH ŚWIATA — typ nazwany, nie goły
 * `number`, i to jest jedyny powód jego istnienia.
 *
 * Wychodzą stąd DWIE drogi tego samego pojęcia, o podpisach nie do odróżnienia okiem:
 * `PlanetScene.updateBuildings(list, alertPulseSeconds)` bierze **SEKUNDY** i przelicza je
 * sama, a `GateWorld.updateBuildings(list, alertPulseOffset)` bierze **gotowe wychylenie**.
 * Dopóki oba były `number | undefined`, podanie sekund tam, gdzie oczekiwane jest wychylenie,
 * kompilowało się bez słowa i rzucało `RangeError`-em dopiero po 0,13 s zegara ściennego —
 * czyli na losowej klatce, daleko od miejsca pomyłki. Marka sprawia, że taką wartość da się
 * dostać WYŁĄCZNIE z `alertPulse` (spoczynek to `alertPulse(r, 0)`), więc pomyłka jest błędem
 * kompilacji zamiast błędem wykonania.
 *
 * Marka jest fantomowa: w czasie wykonania to zwykły `number` i arytmetyka na nim działa
 * normalnie. Sam `BuildingLayer.update` przyjmuje nadal goły `number` — to warstwa niska,
 * której testy podają dowolne wychylenia z zakresu, a strażnik zakresu jest w niej wyjątkiem.
 *
 * **Spoczynek zapisuje się jako `alertPulse(radius, 0)`**, a nie osobną stałą — wychodzi z
 * tego dokładne zero (`1 − cos 0`), więc wartość jest WYPROWADZONA z tej samej funkcji, co
 * każda inna faza, i nie może się od niej rozjechać przy strojeniu.
 */
export type AlertPulseOffset = number & { readonly [ALERT_PULSE_OFFSET_BRAND]: true };

/**
 * Wychylenie promienia pierścienia alarmu w chwili `seconds` — funkcja CZYSTA, żeby zegar
 * został u wywołującego, a warstwa pozostała funkcją swojego wejścia (`BuildingLayer.update`
 * nie zna czasu i to jest własność z Zadania 3, nie niedopatrzenie).
 *
 * Kosinus podniesiony do `[0, 1]`, więc puls rośnie WYŁĄCZNIE W GÓRĘ od spoczynku: konfiguracja
 * spoczynkowa maksymalizuje szerokość obu pasów obręczy (patrz `ALERT_RADIUS_FACTOR`), więc nie
 * ma z czego zejść w dół. Szczyt wypada DOKŁADNIE na `ALERT_PULSE_AMPLITUDE_FACTOR` i ani o
 * bit wyżej — to jest ta sama granica, którą `update` egzekwuje wyjątkiem.
 */
export function alertPulse(planetRadius: number, seconds: number): AlertPulseOffset {
  const phase = (2 * Math.PI * seconds) / ALERT_PULSE_PERIOD_SECONDS;
  return (planetRadius * ALERT_PULSE_AMPLITUDE_FACTOR * 0.5 * (1 - Math.cos(phase))) as AlertPulseOffset;
}

/**
 * `[WYGLĄD]` Wewnętrzna krawędź pierścienia alarmu, jako ułamek jego promienia (1,8786).
 *
 * Pierwsza wersja miała tu 0,8, czyli obręcz szerokości 0,59 jednostki świata. **Obejrzane
 * z widoku CAŁEJ TARCZY: oba pasy razem miały 2,0 piksela, a każdy z osobna około piksela
 * albo mniej — alarmu nie było widać w ogóle**, mimo że macierze instancji były poprawne, a
 * testy zielone. (Runda naprawcza 1 skasowała przy okazji jedyną asercję, która tę wartość
 * wykluczała; test 8 wiąże ją teraz wprost, przez SZEROKOŚĆ PASÓW, a nie przez różnicę
 * promieni — patrz `ALERT_SPLIT_FACTOR`.)
 *
 * Krawędź wewnętrzna LEŻY POD bryłą największych budynków (1,8786 kontra 2,0) i to jest
 * świadome: część schowana pod budynkiem nic nie kosztuje. Ale właśnie dlatego widoczności
 * alarmu NIE WOLNO mierzyć różnicą promieni — trzeba mierzyć, ile z każdego PASA zostaje
 * na zewnątrz bryły.
 */
export const ALERT_INNER_FACTOR = 0.62; // [WYGLĄD]

/**
 * `[WYGLĄD]` Granica między jasnym a ciemnym pasem pierścienia, jako ułamek promienia
 * (2,5149). Dobrana tak, żeby dla NAJWIĘKSZEJ bryły — czyli w najgorszym przypadku, bo to
 * ona zasłania najwięcej — oba pasy zostały na zewnątrz w tej samej szerokości: jasny
 * `2,5149 − 2,0 = 0,5149`, ciemny `3,0300 − 2,5149 = 0,5151`. Po 1,76 piksela.
 *
 * Pas ciemny niesie alarm na dniu i zmierzchu, jasny na nocy, więc **żaden nie może być
 * pasem resztkowym** — i do rundy naprawczej 2 to zdanie nie miało żadnego strażnika:
 * 0,63 zabijało pas jasny, 0,99 pas ciemny, oba przechodziły komplet testów. Wiąże to teraz
 * test 8, minimum po wszystkich dziesięciu typach, w pikselach.
 *
 * Jasny leży WEWNĄTRZ, ciemny NA ZEWNĄTRZ — bo to jasny pas dubluje się z ciemną bryłą
 * budynku po sąsiedzku, a ciemny musi mieć czyste, jasne tło dnia tuż obok.
 */
export const ALERT_SPLIT_FACTOR = 0.83; // [WYGLĄD]

/**
 * `[WYGLĄD]` O ile jasny rdzeń unosi się ponad szczyt skorupy i o ile pierścień alarmu
 * unosi się ponad powierzchnię — jako ułamek promienia planety.
 *
 * Dolna granica to rozdzielczość bufora głębokości: przy `near = radius × 0,01` i
 * `far = radius × 16` (patrz `camera.ts`) rozdzielczość 24-bitowego bufora na maksymalnym
 * oddaleniu (kamera 700 jednostek od powierzchni) wynosi `z²(far−near)/(near·far·2²⁴)` ≈
 * **0,0292** jednostki, więc 0,15 to pięciokrotność. Bez tego rdzeń leżałby W TEJ SAMEJ
 * PŁASZCZYŹNIE co pokrywa skorupy i migotałby przy oddaleniu — awaria widoczna wyłącznie
 * na GPU, czyli **nigdy w CI**, i dlatego do rundy naprawczej 1 wyzerowanie tej stałej
 * przechodziło komplet testów. Test 4 przypina teraz próg **trzykrotności rozdzielczości**,
 * liczonej w teście ze stałych `camera.ts`, i mierzy uniesienie na FAKTYCZNYCH macierzach,
 * nie na stałej.
 *
 * Górna granica jest ta sama, co dla `OUTLINE_LIFT`: poniżej 5% średnicy najmniejszej
 * komórki (0,42), żeby przy limbie nic nie nawisało nad sąsiadem; 0,15 to 1,8%.
 */
export const SURFACE_LIFT_FACTOR = 0.0015; // [WYGLĄD]

/**
 * `[WYGLĄD]` Ciemny ton budynku — skorupa. LINIOWY, jak cała paleta (`Rgb` w `shading.ts`).
 * Luminancja 0,0140: kontrast WCAG **8,48** wobec zmierzchu i **15,15** wobec dnia.
 * Nie czysta czerń, żeby bryła miała własną barwę, a nie czytała się jak dziura w terenie.
 */
export const SHELL_COLOR: Rgb = [0.012, 0.014, 0.02]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Jasny ton budynku przy PEŁNYM `hp` — rdzeń. Luminancja 0,9621: kontrast
 * **10,04** wobec nocy. Lekko chłodny, żeby odróżniał się od ciepłej bieli pasma dnia
 * (`DEFAULT_PALETTE[2]`) także odcieniem, nie tylko tym, że oddziela je ciemna obwódka.
 */
export const CORE_COLOR_HEALTHY: Rgb = [0.95, 0.97, 0.92]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Barwa rdzenia przy `hp === 0`. Kontrast wobec nocy nadal **4,25** — czyli kanał
 * nadmiarowy nie kosztuje widoczności nocnej.
 *
 * Odległość barw od `CORE_COLOR_HEALTHY` wynosi **0,7556 w przestrzeni sRGB**. Dla
 * porównania skok przez terminator, liczony w TEJ SAMEJ przestrzeni, to **0,8598** —
 * i to NIE jest kanoniczna liczba projektu **0,9005** z `global-constraints.md`, która
 * opisuje tę samą parę barw, ale **liniowo**. Obie są poprawne; przestrzeń trzeba nazwać
 * przy każdej, bo zestawienie 0,86 z 0,9005 bez tej informacji wygląda jak rozjazd pomiaru.
 * (Reguła jest w `shading.ts` przy `Rgb`: WCAG liczy się z luminancji LINIOWEJ, a „jak
 * bardzo to widać" — po ZAKODOWANIU do sRGB.)
 *
 * **To musi być CZERWIEŃ, nie ciemniejszy odcień.** Szarość o identycznej luminancji
 * (0,378608) ma ten sam kontrast wobec każdego pasma, więc żadna asercja oparta na
 * luminancji jej nie odróżni — a kanał barwy byłby wtedy martwy. Odległość tej barwy od
 * szarości o jej własnej luminancji wynosi w sRGB **0,4640** i to jest wielkość, którą
 * przypina test 2 (do rundy naprawczej 1 mutacja na szarość przechodziła komplet testów).
 */
export const CORE_COLOR_CRITICAL: Rgb = [1.0, 0.22, 0.12]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Jasny pas pierścienia alarmu — bursztyn. Luminancja 0,7362, kontrast **7,80**
 * wobec nocy. Celowo NIE biel rdzenia i NIE czerwień uszkodzenia: trzy różne komunikaty
 * („budynek", „ranny", „bez prądu") mają mieć trzy różne barwy, inaczej zlewają się w
 * jedną rampę i gracz czyta jeden stan zamiast dwóch.
 */
export const ALERT_COLOR_LIGHT: Rgb = [1.0, 0.72, 0.12]; // [WYGLĄD]

/**
 * `[WYGLĄD]` Ciemny pas pierścienia alarmu. Luminancja 0,0163: kontrast **8,19** wobec
 * zmierzchu i **14,63** wobec dnia — to on niesie pierścień po jasnej stronie planety.
 */
export const ALERT_COLOR_DARK: Rgb = [0.02, 0.016, 0.008]; // [WYGLĄD]

/** `[WYGLĄD]` Liczba boków bryły i rdzenia: sześciokąt, jak komórka pod spodem. */
const SHELL_SIDES = 6; // [WYGLĄD]
/** `[WYGLĄD]` Liczba boków pierścienia alarmu — tyle, żeby przy zbliżeniu czytał się jako okrąg. */
const ALERT_SIDES = 24; // [WYGLĄD]

/**
 * `[WYGLĄD]` Ile przerw ma pierścień budynku ODCIĘTEGO OD SIECI (Faza 2C, Zadanie 4, Krok 6).
 *
 * Cztery, nie jedna i nie dwanaście. Jedna czyta się jak artefakt rasteryzacji albo jak
 * przesłonięcie przez sąsiada; dwanaście zjadłoby sam pierścień, czyli kanał NADRZĘDNY
 * („ten budynek nie ma prądu"), który ma zostać czytelny niezależnie od tego, czy gracz
 * rozpozna przyczynę. Cztery zostawiają 288° obręczy (80 %) i dają wzór, a nie wyjątek.
 */
export const ALERT_BREAK_COUNT = 4; // [WYGLĄD]

/**
 * `[WYGLĄD]` Kątowa szerokość JEDNEJ przerwy, jako ułamek pełnego obrotu (18°).
 *
 * ## Co ta liczba wiąże
 *
 * Przerwa jest oknem na teren, więc jej widoczność mierzy się jej NAJWĘŻSZYM wymiarem, a to
 * jest łuk na WEWNĘTRZNEJ krawędzi widocznej części obręczy — czyli tam, gdzie promień jest
 * najmniejszy. Najgorszym członkiem populacji jest `PYLON`: jego bryła (1,28) jest mniejsza
 * od krawędzi wewnętrznej pierścienia (1,8786), więc obręcz zaczyna się u niego NAJBLIŻEJ
 * środka i łuk o tym samym kącie jest tam najkrótszy. (Dla `CORE` bryła zasłania wszystko
 * poniżej 2,0, więc przerwa jest o 6 % szersza.)
 *
 *   przerwa na krawędzi pasa jasnego, `PYLON`:  1,8786 × 0,31416 = **0,5902 j. = 2,01 px**
 *   przerwa na krawędzi pasa ciemnego, `PYLON`: 2,5149 × 0,31416 = **0,7902 j. = 2,70 px**
 *
 * Próg z `global-constraints.md` wynosi **1,00 px** i wiąże ROZMIARY — przerwa jest
 * rozmiarem, nie ruchem, więc obowiązuje bez zniżki. Dwukrotny zapas jest tu świadomy:
 * próg pochodzi z werdyktu wzrokowego (§5.3 raportu Zadania 3), a nie z pomiaru
 * rozdzielczości, więc wartość leżąca tuż nad nim byłaby wartością leżącą tuż nad
 * OSZACOWANIEM. Para mutacji na samej granicy stoi w teście 26.
 *
 * ## Dlaczego przerwa, a nie kolor
 *
 * Bo przerwa jest DARMOWA pod względem kontrastu. `global-constraints.md`: żaden pojedynczy
 * ton nie osiąga 3:1 wobec wszystkich trzech pasm terenu (optimum 2,3202), więc każdy nowy
 * obiekt musi nieść DWA tony. Przerwa nie wnosi ani jednego — usuwa OBA naraz, jasny i
 * ciemny, na całej szerokości obręczy. Na paśmie nocy widać jej brak w pasie jasnym
 * (bursztyn ma tam 7,80), na dniu i zmierzchu — w pasie ciemnym (8,19 i 14,63). Kanał
 * dziedziczy więc dwutonowość pierścienia zamiast szukać czwartej barwy w palecie, w której
 * trzy komunikaty („budynek", „ranny", „bez prądu") już siedzą.
 */
export const ALERT_BREAK_FRACTION = 0.05; // [WYGLĄD]

/**
 * `[WYGLĄD]` Rozmiar bryły per typ: `radius` i `height` jako mnożniki
 * `BUILDING_RADIUS_FACTOR` / `BUILDING_HEIGHT_FACTOR`.
 *
 * TYP jest kodowany SYLWETKĄ, nie barwą — barwa jest już zajęta przez dwutonowość
 * (obecność) i rampę `hp` (stan), a trzeci kanał barwny na tej palecie nie istnieje
 * (patrz rachunek w komentarzu modułu). Każda para (`radius`, `height`) jest inna, więc
 * żadne dwa typy nie mają identycznej bryły — sprawdza to test 5.
 *
 * To NIE jest pełna identyfikacja typu: dziesięciu sylwetek różniących się dwiema liczbami
 * nie da się rozróżnić z widoku całej tarczy i ten moduł tego nie obiecuje. Pytania bramki
 * Zadania 5 dotyczą stanów (`powered`, `hp`), nie rozpoznania typu; rozpoznanie typu to
 * kandydat na Fazę 2C razem z UI budowania.
 *
 * Do rundy naprawczej 1 ta tabela była przypięta WYŁĄCZNIE do samej siebie (test sprawdzał,
 * że macierze zgadzają się z tabelą, i że dziesięć par jest różnych), więc `PYLON` o
 * promieniu **0,03** — bryła o średnicy 0,2 piksela, czyli typ znikający z ekranu —
 * przechodził komplet testów. Test 5 ma próg bezwzględny na KAŻDYM typie.
 *
 * ## Runda naprawcza 2: dolna granica podniesiona z 0,34 na 0,64
 *
 * Najmniejszy typ musi udźwignąć OBA progi rdzenia (widoczny przy zerowym `hp` ORAZ widoczny
 * skok promienia), a ich suma równa się promieniowi rdzenia przy pełnym `hp`, czyli
 * `promień × SHELL_TAPER − CORE_RIM_FACTOR × 100`. Dwa piksele po jednym wymagają promienia
 * bryły co najmniej **1,142**, czyli czynnika **0,571**. `PYLON` stoi na 0,64 (bryła 1,28),
 * czyli 12% nad granicą, i daje 1,19 px na każdy z nich.
 *
 * (Granicę przeliczono w rundzie domykającej gałąź. Stało tu **1,266 / 0,633** i ta liczba
 * nie zgadzała się z ŻADNĄ skalą: odtwarza się ją dopiero przy obwódce 0,42 zamiast
 * dzisiejszych 0,35 — czyli przeżyła zmianę `CORE_RIM_FACTOR` w tej samej rundzie, w której
 * powstała. Kierunek błędu był zachowawczy — granica była zawyżona — a `PYLON` i tak stoi
 * nad obiema.)
 *
 * Kosztem jest sylwetka: `PYLON` był wcześniej dwukrotnie cieńszy niż wszystko inne, dziś
 * jest „tylko" najcieńszy. W zamian dostał największą wysokość w całej tabeli (1,6, więcej
 * niż `CORE`), bo maszt CZYTA SIĘ wysokością, nie brakiem szerokości — i pozostaje jedynym
 * typem, którego wysokość przekracza średnicę.
 */
export const BUILDING_SHAPES: Readonly<Record<BuildingType, { readonly radius: number; readonly height: number }>> = {
  CORE: { radius: 1.0, height: 1.45 },
  EVACUATION_MODULE: { radius: 0.96, height: 1.3 },
  GEOTHERMAL_CAP: { radius: 0.92, height: 0.55 },
  SOLAR_PANEL: { radius: 0.9, height: 0.3 },
  BARRICADE: { radius: 0.86, height: 0.42 },
  EXTRACTOR: { radius: 0.8, height: 0.7 },
  BATTERY: { radius: 0.76, height: 0.62 },
  KINETIC_TURRET: { radius: 0.72, height: 0.95 },
  LASER_TURRET: { radius: 0.68, height: 1.2 },
  PYLON: { radius: 0.64, height: 1.6 },
}; // [WYGLĄD]

// --- Funkcje czyste: kodowanie stanów --------------------------------------------------

/**
 * Ułamek życia budynku, przycięty do `[0, 1]`. Przycięcie, nie wyjątek: `hp` spada poniżej
 * zera w tym samym ticku, w którym budynek ginie (`combat.ts` odejmuje obrażenia przed
 * sprzątnięciem), a render, który rzuca w takiej klatce, wysadziłby aplikację na
 * poprawnym stanie symulacji.
 *
 * @throws {RangeError} gdy `maxHp` nie jest dodatnie — to nie jest stan gry, tylko brak
 *   definicji typu (`BUILDINGS[type].hp`), a dzielenie dałoby `Infinity`/`NaN` i cichy
 *   rdzeń o zerowej wielkości zamiast błędu.
 */
export function healthFraction(hp: number, maxHp: number): number {
  if (!(maxHp > 0)) {
    throw new RangeError(`healthFraction: maxHp must be positive, got ${maxHp}`);
  }
  const f = hp / maxHp;
  if (!(f > 0)) return 0;
  return f < 1 ? f : 1;
}

/**
 * Promień jasnego rdzenia jako ułamek jego promienia przy pełnym `hp`: liniowo od
 * `CORE_SCALE_MIN` (przy `fraction === 0`) do 1 (przy `fraction === 1`). ŚCIŚLE rosnąca,
 * więc każde obrażenie widać jako zmianę, a nie dopiero po przekroczeniu progu.
 */
export function coreScale(fraction: number): number {
  return CORE_SCALE_MIN + (1 - CORE_SCALE_MIN) * fraction;
}

/**
 * Barwa rdzenia dla danego ułamka życia: interpolacja liniowa `CORE_COLOR_CRITICAL` →
 * `CORE_COLOR_HEALTHY`. Pisze do `out` (trzy składowe od `offset`) zamiast zwracać nową
 * tablicę — ta funkcja biegnie w pętli renderu, raz na budynek na klatkę.
 */
export function writeCoreColor(fraction: number, out: Float32Array, offset: number): void {
  for (let k = 0; k < 3; k++) {
    out[offset + k] = CORE_COLOR_CRITICAL[k] + (CORE_COLOR_HEALTHY[k] - CORE_COLOR_CRITICAL[k]) * fraction;
  }
}


// --- Geometrie brył (budowane RAZ, współdzielone przez wszystkie instancje) -------------

/**
 * Graniastosłup o `sides` bokach: podstawa o promieniu 1 w `z = 0`, szczyt o promieniu
 * `SHELL_TAPER` w `z = 1`, ściany boczne plus pokrywa. BEZ dna — jest odwrócone tyłem do
 * kamery (`side: FrontSide`), a przy tym leży dokładnie na powierzchni, więc narysowane
 * biłoby się z terenem o bufor głębokości.
 */
function buildShellGeometry(sides: number): BufferGeometry {
  // (dolny pierścień, górny pierścień, środek szczytu)
  const vertexCount = sides * 2 + 1;
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    positions[i * 3] = c;
    positions[i * 3 + 1] = s;
    positions[i * 3 + 2] = 0;
    positions[(sides + i) * 3] = c * SHELL_TAPER;
    positions[(sides + i) * 3 + 1] = s * SHELL_TAPER;
    positions[(sides + i) * 3 + 2] = 1;
  }
  const apex = sides * 2;
  positions[apex * 3 + 2] = 1;

  const indices = new Uint16Array(sides * 3 * 3);
  let cursor = 0;
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    // Ściana: dwa trójkąty, nawinięte przeciwnie do wskazówek zegara patrząc z ZEWNĄTRZ.
    indices[cursor++] = i;
    indices[cursor++] = j;
    indices[cursor++] = sides + j;
    indices[cursor++] = i;
    indices[cursor++] = sides + j;
    indices[cursor++] = sides + i;
    // Pokrywa: wachlarz wokół środka szczytu.
    indices[cursor++] = apex;
    indices[cursor++] = sides + i;
    indices[cursor++] = sides + j;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * Płaski wielobok o `sides` bokach i promieniu 1 w `z = 0`, wachlarz wokół środka.
 *
 * Eksportowany (Faza 2B, Zadanie 4), bo `unitMesh.ts` potrzebuje DOKŁADNIE tej samej bryły
 * — łącznie z nawinięciem, które w tym zadaniu raz już było odwrotne i skasowało całą
 * warstwę z ekranu (patrz `buildAlertGeometry`). Druga kopia tych piętnastu linii byłaby
 * drugim miejscem, w którym ten sam błąd może wrócić osobno.
 */
export function buildDiscGeometry(sides: number): BufferGeometry {
  const positions = new Float32Array((sides + 1) * 3);
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    positions[(i + 1) * 3] = Math.cos(a);
    positions[(i + 1) * 3 + 1] = Math.sin(a);
  }
  const indices = new Uint16Array(sides * 3);
  for (let i = 0; i < sides; i++) {
    indices[i * 3] = 0;
    indices[i * 3 + 1] = i + 1;
    indices[i * 3 + 2] = ((i + 1) % sides) + 1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/** Łuk kątowy obręczy: `[początek, koniec]` w radianach, `koniec > początek`. */
export type AlertSpan = readonly [number, number];

/**
 * Łuki obręczy alarmu w DWÓCH kompletach: przerywanym (`broken`) i domykającym go
 * (`closing`). Razem pokrywają pełny obrót, bez zakładki i bez luki.
 *
 * Funkcja CZYSTA i eksportowana, żeby test mógł zbudować obręcz o innym kącie przerwy
 * i ZMIERZYĆ ją tym samym przyrządem, co obręcz produkcyjną — bez tego para mutacji
 * „0,99 px oblewa / 1,01 px przechodzi" wymagałaby edytowania stałej i ręcznego przebiegu.
 *
 * @throws {RangeError} gdy przerwa nie mieści się w swoim wycinku — pierścień bez łuków
 *   nie jest pierścieniem, a kanał NADRZĘDNY („bez prądu") zniknąłby razem z nim.
 */
export function alertSpans(
  breakCount: number,
  breakFraction: number,
): { broken: AlertSpan[]; closing: AlertSpan[] } {
  if (!Number.isInteger(breakCount) || breakCount < 1) {
    throw new RangeError(`alertSpans: breakCount must be a positive integer, got ${breakCount}`);
  }
  const sector = (Math.PI * 2) / breakCount;
  const gap = Math.PI * 2 * breakFraction;
  if (!(gap > 0) || gap >= sector) {
    throw new RangeError(
      `alertSpans: break of ${breakFraction} of a turn (${gap} rad) does not fit in a sector ` +
        `of ${sector} rad — the ring would have no arcs left and the "no power" channel ` +
        'would disappear with them',
    );
  }
  const broken: AlertSpan[] = [];
  const closing: AlertSpan[] = [];
  for (let k = 0; k < breakCount; k++) {
    const start = k * sector;
    closing.push([start, start + gap]);
    broken.push([start + gap, start + sector]);
  }
  return { broken, closing };
}

/**
 * Obręcz alarmu na zadanych łukach: płaska, w `z = 0`, od `ALERT_INNER_FACTOR` do 1,
 * złożona z DWÓCH pasów o barwach wpisanych w atrybut `color` — jasnego wewnątrz, ciemnego
 * na zewnątrz. Dwutonowość mieszka więc w geometrii, a nie w materiale, i jest ta sama dla
 * każdej instancji (`instanceColor` tej warstwy nie używa).
 *
 * Gęstość podziału jest zadana NA PEŁNY OBRÓT (`segmentsPerTurn`), a nie na łuk: obie
 * geometrie (przerywana i domykająca) mają wtedy tę samą krzywiznę cięciwy, więc szew
 * między nimi nie jest widoczny jako załamanie.
 *
 * Eksportowane z tego samego powodu co `alertSpans`: próg czytelności przerwy (1,00 px na
 * najgorszym członku populacji) ma być ZMIERZONY NA NARYSOWANEJ GEOMETRII, także dla kątów
 * innych niż produkcyjny — inaczej para mutacji „0,99 px oblewa / 1,01 px przechodzi"
 * wymagałaby edytowania stałej i ręcznego przebiegu, czyli nie byłaby testem.
 */
export function buildAlertGeometry(
  spans: readonly AlertSpan[],
  segmentsPerTurn: number,
): BufferGeometry {
  // Wierzchołki pierścienia ROZDZIELONEGO na promieniu `ALERT_SPLIT_FACTOR` są ZDUBLOWANE
  // (rings[1] i rings[2] mają ten sam promień, różne barwy). Bez zdublowania GPU
  // interpolowałby barwę wzdłuż całej obręczy i zamiast dwóch tonów byłby jeden gradient —
  // czyli dokładnie ten tryb awarii, przed którym `geometry.ts` broni terenu osobnymi
  // wierzchołkami na komórkę. Pas jasny i pas ciemny mają być PŁASKIE.
  const rings = [ALERT_INNER_FACTOR, ALERT_SPLIT_FACTOR, ALERT_SPLIT_FACTOR, 1];
  const ringColors = [ALERT_COLOR_LIGHT, ALERT_COLOR_LIGHT, ALERT_COLOR_DARK, ALERT_COLOR_DARK];

  // Próbki kątowe wszystkich łuków, sklejone w jedną listę; `spanStart`/`spanCount` mówią,
  // gdzie leży który łuk. Czworokąty łączą WYŁĄCZNIE próbki w obrębie jednego łuku — to
  // jedyna różnica wobec pełnego okręgu, w którym ostatnia próbka wracała do pierwszej.
  const angles: number[] = [];
  const spanStart: number[] = [];
  const spanCount: number[] = [];
  for (const [from, to] of spans) {
    const segments = Math.max(1, Math.ceil(((to - from) / (Math.PI * 2)) * segmentsPerTurn));
    spanStart.push(angles.length);
    spanCount.push(segments + 1);
    for (let i = 0; i <= segments; i++) angles.push(from + ((to - from) * i) / segments);
  }

  const n = angles.length;
  const positions = new Float32Array(n * rings.length * 3);
  const colors = new Float32Array(n * rings.length * 3);
  for (let r = 0; r < rings.length; r++) {
    const color = ringColors[r];
    for (let i = 0; i < n; i++) {
      const v = r * n + i;
      positions[v * 3] = Math.cos(angles[i]) * rings[r];
      positions[v * 3 + 1] = Math.sin(angles[i]) * rings[r];
      colors[v * 3] = color[0];
      colors[v * 3 + 1] = color[1];
      colors[v * 3 + 2] = color[2];
    }
  }

  // Dwa PASY (0→1 jasny, 2→3 ciemny); para 1→2 to szew o zerowej szerokości, pomijana.
  const bands = [0, 2];
  let quads = 0;
  for (const count of spanCount) quads += count - 1;
  const indices = new Uint16Array(quads * bands.length * 6);
  let cursor = 0;
  for (const r of bands) {
    for (let s = 0; s < spanStart.length; s++) {
      for (let k = 0; k + 1 < spanCount[s]; k++) {
        const i = spanStart[s] + k;
        const j = i + 1;
        const a0 = r * n + i;
        const b0 = r * n + j;
        const a1 = (r + 1) * n + i;
        const b1 = (r + 1) * n + j;
        // Nawinięcie przeciwne do wskazówek zegara PATRZĄC OD +Z, czyli od strony kamery:
        // kolejność (wewnętrzny_i, zewnętrzny_j, wewnętrzny_j) daje normalną +Z. Odwrotna —
        // (wewnętrzny_i, wewnętrzny_j, zewnętrzny_j), czyli pierwsza, jaką się pisze —
        // daje −Z, więc `side: FrontSide` wycina CAŁY pierścień i alarm po prostu nie
        // istnieje na ekranie. Zobaczone w przeglądarce; żaden test tego nie łapał, bo
        // macierze instancji były poprawne (patrz raport Zadania 3).
        indices[cursor++] = a0;
        indices[cursor++] = b1;
        indices[cursor++] = b0;
        indices[cursor++] = a0;
        indices[cursor++] = a1;
        indices[cursor++] = b1;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

// --- Bazy komórek ----------------------------------------------------------------------

/**
 * Ortonormalna baza każdej komórki, policzona RAZ: `[t1x, t1y, t1z, t2x, t2y, t2z]` na
 * komórkę. `t1` to kierunek na PIERWSZY NAROŻNIK komórki (zrzutowany na płaszczyznę
 * styczną i znormalizowany), `t2 = normal × t1`.
 *
 * Kierunek narożnika, a nie dowolny wektor styczny: dzięki temu sześciokąt budynku jest
 * OBRÓCONY TAK SAMO jak sześciokąt komórki pod nim, więc bryła siedzi w kracie z Zadania 2,
 * zamiast stać w niej krzywo. To jest też jedyny powód, dla którego ta warstwa w ogóle
 * potrzebuje `PlanetGeometry`, a nie samego `Planet`: narożniki bierzemy z TEGO SAMEGO
 * bufora, który rysuje teren.
 *
 * Funkcja CZYSTA, bez Three.js — testowalna bez WebGL, tak jak `buildCellOutlines`.
 *
 * @throws {RangeError} gdy któraś komórka ma mniej niż 4 wierzchołki (środek + 3 narożniki);
 *   ten sam strażnik i to samo uzasadnienie co w `buildCellOutlines`.
 */
export function buildCellBases(geo: PlanetGeometry): Float32Array {
  const cellCount = geo.cellVertexStart.length;
  const out = new Float32Array(cellCount * 6);
  for (let i = 0; i < cellCount; i++) {
    if (geo.cellVertexCount[i] < 4) {
      throw new RangeError(
        `buildCellBases: cell ${i} has ${geo.cellVertexCount[i]} vertices, expected at least 4 (center + 3 corners)`,
      );
    }
    const c = geo.cellVertexStart[i] * 3;
    const nx = geo.normals[c];
    const ny = geo.normals[c + 1];
    const nz = geo.normals[c + 2];
    const k = c + 3; // pierwszy narożnik
    let ax = geo.positions[k] - geo.positions[c];
    let ay = geo.positions[k + 1] - geo.positions[c + 1];
    let az = geo.positions[k + 2] - geo.positions[c + 2];
    // Odjęcie składowej wzdłuż normalnej — odcinek środek→narożnik nie leży dokładnie w
    // płaszczyźnie stycznej (narożnik jest na sferze, nie na stycznej).
    const along = ax * nx + ay * ny + az * nz;
    ax -= along * nx;
    ay -= along * ny;
    az -= along * nz;
    const len = Math.hypot(ax, ay, az);
    const inv = 1 / len;
    const t1x = ax * inv;
    const t1y = ay * inv;
    const t1z = az * inv;
    const o = i * 6;
    out[o] = t1x;
    out[o + 1] = t1y;
    out[o + 2] = t1z;
    out[o + 3] = ny * t1z - nz * t1y;
    out[o + 4] = nz * t1x - nx * t1z;
    out[o + 5] = nx * t1y - ny * t1x;
  }
  return out;
}

// --- Warstwa ---------------------------------------------------------------------------

export interface BuildingLayer {
  /**
   * Jeden węzeł do podpięcia. `createSceneWithRenderer` wiesza go jako DZIECKO siatki
   * terenu, nie jako rodzeństwo — `visible` w Three.js jest dziedziczne, więc wszystko, co
   * pokazuje stan komórek, ma znikać razem z planetą (tak samo jak krata z Zadania 2;
   * patrz uzasadnienie przy `createPlanetMesh` i test 33 w `readabilityGate.test.ts`).
   */
  readonly object: Group;
  /** Wystawione dla testowalności — ten sam wzorzec co `PlanetMesh.mesh`/`outline`. */
  readonly shell: InstancedMesh;
  readonly core: InstancedMesh;
  /**
   * Obręcz PRZERYWANA — rysowana pod KAŻDYM budynkiem bez prądu, niezależnie od przyczyny.
   * To jest kanał nadrzędny („ten budynek nie ma prądu") i on się nie zmienił: liczba
   * instancji tej warstwy równa się liczbie budynków z `powered === false`.
   */
  readonly alert: InstancedMesh;
  /**
   * Cztery wycinki DOMYKAJĄCE obręcz — rysowane tylko tam, gdzie budynek jest wprawdzie bez
   * prądu, ale wciąż PODŁĄCZONY do sieci (`OUTAGE_SHED`). Razem z `alert` dają obręcz pełną.
   */
  readonly link: InstancedMesh;
  /**
   * Przepisuje macierze i barwy instancji z bieżącego `SimState.buildings`. Bezpieczne do
   * wołania co klatkę: NIC nie alokuje (test 16) i NICZEGO nie mutuje w wejściu (test 14).
   *
   * Nadal bez parametru CZASU, i to jest ta sama decyzja co po rundzie naprawczej 2 Zadania
   * 3: warstwa nie zna zegara. `alertPulse` to gotowe WYCHYLENIE PROMIENIA w jednostkach
   * świata; fazę liczy wywołujący funkcją czystą `alertPulse(radius, seconds)`, więc jeden
   * zegar zostaje w jednym miejscu, a warstwa pozostaje funkcją swojego wejścia.
   *
   * **Domyślne 0 nie znaczy „produkcja nie pulsuje"** — znaczy „bez argumentu nie ma
   * wychylenia", bo warstwa bez zegara nie ma skąd go wziąć. Pulsowanie jest dziś domyślnym
   * wyglądem gry i wnosi je wywołujący (`scene.ts` → `apps/client`); patrz komentarz modułu.
   *
   * @param outage przyczyna braku prądu per komórka — `PowerReport.outage` z `@heliopolis/sim`.
   *   Pominięta znaczy „przyczyna nieznana": obręcz jest wtedy PEŁNA, czyli dokładnie taka,
   *   jak przed Zadaniem 4. Warstwa **nie liczy jej sama** — `connectedToCore` to
   *   przeszukiwanie całej planety, więc w pętli renderu byłaby tą samą pracą sześćdziesiąt
   *   razy na sekundę zamiast dwadzieścia (i drugim źródłem prawdy o sieci).
   * @throws {RangeError} gdy `alertPulse` jest ujemny albo przekracza
   *   `planet.radius × ALERT_PULSE_AMPLITUDE_FACTOR`. Amplituda ponad sufit wyprowadza
   *   pierścień poza komórkę — a to jest dokładnie ta awaria, którą runda naprawcza 1
   *   Zadania 3 znalazła w 72 komórkach i którą test 8 pilnuje NA SZCZYCIE pulsu.
   * @throws {RangeError} gdy `outage` ma inną długość niż lista budynków — dwie tablice
   *   indeksowane tym samym `cellId`, których nic nie wiąże składniowo.
   */
  update(
    buildings: readonly (Building | null)[],
    outage?: Uint8Array,
    alertPulse?: number,
  ): void;
  dispose(): void;
}

/**
 * Buduje warstwę budynków dla planety i jej geometrii. Pojemność każdej warstwy to
 * `planet.cells.length` (1442) — tyle, ile wynosi twarde maksimum z definicji: `SimState`
 * trzyma co najwyżej jeden budynek na komórkę.
 *
 * @throws {RangeError} gdy `geo` opisuje inną liczbę komórek niż `planet` — dwie struktury
 *   indeksowane tym samym `cellId`, których nic nie wiąże składniowo (ten sam wzorzec co
 *   strażniki w `writeCellColors`).
 */
export function createBuildingLayer(planet: Planet, geo: PlanetGeometry): BuildingLayer {
  const cellCount = planet.cells.length;
  if (geo.cellVertexStart.length !== cellCount) {
    throw new RangeError(
      `createBuildingLayer: geo describes ${geo.cellVertexStart.length} cells, planet has ${cellCount}`,
    );
  }

  const bases = buildCellBases(geo);
  const baseRadius = planet.radius * BUILDING_RADIUS_FACTOR;
  const baseHeight = planet.radius * BUILDING_HEIGHT_FACTOR;
  const alertRadius = planet.radius * ALERT_RADIUS_FACTOR;
  const maxAlertPulse = planet.radius * ALERT_PULSE_AMPLITUDE_FACTOR;
  const coreRim = planet.radius * CORE_RIM_FACTOR;
  const lift = planet.radius * SURFACE_LIFT_FACTOR;

  const shellGeometry = buildShellGeometry(SHELL_SIDES);
  const coreGeometry = buildDiscGeometry(SHELL_SIDES);
  const spans = alertSpans(ALERT_BREAK_COUNT, ALERT_BREAK_FRACTION);
  const alertGeometry = buildAlertGeometry(spans.broken, ALERT_SIDES);
  const linkGeometry = buildAlertGeometry(spans.closing, ALERT_SIDES);

  // `MeshBasicMaterial` wszędzie — BEZ modelu oświetlenia, tak samo jak teren
  // (`global-constraints.md`). Materiał oświetlony wymagałby `THREE.Light` w scenie, a
  // światło w scenie cieniowałoby TAKŻE teren i rozmyło progi z Zadania 1 z powrotem w
  // gradient, który Faza 0 zmierzyła jako nieczytelny.
  // `new Color(r, g, b)` woła `setRGB` w PRZESTRZENI ROBOCZEJ (linear-sRGB), tak samo jak
  // Three.js czyta atrybut `color` geometrii — więc te stałe znaczą tu dokładnie to samo,
  // co stałe palety terenu w `shading.ts`, i wyliczone z nich kontrasty WCAG są prawdziwe.
  const shellMaterial = new MeshBasicMaterial({ color: new Color(...SHELL_COLOR) });
  // Biel, żeby `instanceColor` (rampa `hp`) był JEDYNYM źródłem barwy rdzenia: Three.js
  // mnoży `material.color × instanceColor`, więc każdy inny odcień tutaj po cichu
  // przesunąłby całą rampę.
  const coreMaterial = new MeshBasicMaterial({ color: 0xffffff });
  // JEDEN materiał na obie części obręczy: barwy siedzą w atrybucie `color` geometrii, więc
  // drugi materiał byłby drugim miejscem, w którym można by je po cichu rozjechać — a wtedy
  // przerwana obręcz różniłaby się od pełnej NIE TYLKO przerwą.
  const alertMaterial = new MeshBasicMaterial({ vertexColors: true });

  const shell = new InstancedMesh(shellGeometry, shellMaterial, cellCount);
  const core = new InstancedMesh(coreGeometry, coreMaterial, cellCount);
  const alert = new InstancedMesh(alertGeometry, alertMaterial, cellCount);
  const link = new InstancedMesh(linkGeometry, alertMaterial, cellCount);

  // Bufor barw instancji tworzony TERAZ, nie przy pierwszym `setColorAt` — inaczej
  // pierwsza klatka z budynkiem alokowałaby 17 kB w pętli renderu.
  const coreColors = new Float32Array(cellCount * 3);
  core.instanceColor = new InstancedBufferAttribute(coreColors, 3);

  for (const mesh of [shell, core, alert, link]) {
    // Sfera otaczająca `InstancedMesh` wynika z macierzy WSZYSTKICH instancji, więc po
    // każdej zmianie trzeba by ją przeliczać (przejście po 1442 macierzach z alokacją) —
    // albo zostawić nieaktualną i ryzykować, że cała warstwa zniknie odcięta ostrosłupem
    // widzenia. Instancje i tak pokrywają całą kulę, którą kamera ogląda z zewnątrz, więc
    // odcinanie na poziomie warstwy nie ma tu nic do zyskania.
    mesh.frustumCulled = false;
    mesh.count = 0;
  }

  const object = new Group();
  object.add(shell, core, alert, link);

  const shellMatrices = shell.instanceMatrix.array as Float32Array;
  const coreMatrices = core.instanceMatrix.array as Float32Array;
  const alertMatrices = alert.instanceMatrix.array as Float32Array;
  const linkMatrices = link.instanceMatrix.array as Float32Array;

  /**
   * Parametry `writeInstance`, przekazywane przez ZAALOKOWANY RAZ bufor, a nie argumentami
   * — `[promień, wysokość, uniesienie]`.
   *
   * To wygląda dziwnie i jest tu z POMIARU, nie z gustu. Wersja z tymi trzema liczbami jako
   * zwykłymi argumentami alokuje: V8 nie wstawił `writeInstance` w ciało pętli, więc każda
   * niecałkowita liczba przekraczająca granicę wywołania jest PUDEŁKOWANA (`HeapNumber`).
   * Zmierzone `v8.GCProfiler`, 1000 przebiegów po 1442 budynki (ten sam przyrząd co
   * `budget.test.ts`):
   *
   *   | wariant                                             | cykle GC |
   *   |-----------------------------------------------------|----------|
   *   | argumenty zwykłe, promień STAŁY (poza pętlą)         | 0        |
   *   | argumenty zwykłe, promień ZMIENNY co budynek         | 5-6      |
   *   | pełny `update` z argumentami zwykłymi                | 12-13    |
   *   | **parametry przez ten bufor**                        | **0**    |
   *   | arytmetyka wpisana wprost w pętlę (bez funkcji)      | 0        |
   *
   * Ostatni wiersz działa tak samo dobrze i został odrzucony jako trzy kopie tych samych
   * szesnastu przypisań — bufor kosztuje jeden komentarz, kopie kosztowałyby rozjazd przy
   * pierwszej zmianie.
   */
  const params = new Float64Array(3);

  /**
   * Wpisuje macierz jednej instancji WPROST do bufora `InstancedMesh` (to samo, co robi
   * `setMatrixAt` — `Matrix4.toArray(instanceMatrix.array, slot * 16)` — tylko bez
   * pośrednictwa `Matrix4`). Układ kolumnowy: kolumny 0-2 to baza (X, Y, Z), kolumna 3 to
   * przesunięcie.
   *
   * Baza to `(t1·promień, t2·promień, normalna·wysokość)`. W tej kolejności jest
   * PRAWOSKRĘTNA (`t1 × t2 = normalna`), więc nawinięcie trójkątów bryły zostaje takie, jak
   * zbudowane, a odcinanie tylnych ścian nie wywraca jej na lewą stronę.
   */
  function writeInstance(target: Float32Array, slot: number, cellId: number): void {
    const radius = params[0];
    const height = params[1];
    const liftAmount = params[2];
    const b = cellId * 6;
    const c = geo.cellVertexStart[cellId] * 3;
    const nx = geo.normals[c];
    const ny = geo.normals[c + 1];
    const nz = geo.normals[c + 2];
    const o = slot * 16;
    target[o] = bases[b] * radius;
    target[o + 1] = bases[b + 1] * radius;
    target[o + 2] = bases[b + 2] * radius;
    target[o + 3] = 0;
    target[o + 4] = bases[b + 3] * radius;
    target[o + 5] = bases[b + 4] * radius;
    target[o + 6] = bases[b + 5] * radius;
    target[o + 7] = 0;
    target[o + 8] = nx * height;
    target[o + 9] = ny * height;
    target[o + 10] = nz * height;
    target[o + 11] = 0;
    target[o + 12] = geo.positions[c] + nx * liftAmount;
    target[o + 13] = geo.positions[c + 1] + ny * liftAmount;
    target[o + 14] = geo.positions[c + 2] + nz * liftAmount;
    target[o + 15] = 1;
  }

  return {
    object,
    shell,
    core,
    alert,
    link,

    update(
      buildings: readonly (Building | null)[],
      outage?: Uint8Array,
      alertPulse = 0,
    ): void {
      if (buildings.length !== cellCount) {
        throw new RangeError(
          `BuildingLayer.update: buildings.length (${buildings.length}) must equal planet.cells.length (${cellCount})`,
        );
      }
      if (outage !== undefined && outage.length !== cellCount) {
        throw new RangeError(
          `BuildingLayer.update: outage.length (${outage.length}) must equal planet.cells.length (${cellCount})`,
        );
      }
      if (!(alertPulse >= 0 && alertPulse <= maxAlertPulse)) {
        throw new RangeError(
          `BuildingLayer.update: alertPulse is ${alertPulse} — must lie in [0, ${maxAlertPulse}] (ring would leave its cell)`,
        );
      }

      let built = 0;
      let unpowered = 0;
      let linked = 0;
      for (let i = 0; i < cellCount; i++) {
        const building = buildings[i];
        if (building === null || building === undefined) continue;
        // `cellId` DUBLUJE indeks tablicy — dwa źródła prawdy o tym samym, których nic nie
        // wiąże składniowo. Render rysuje wg INDEKSU (bo tak symulacja adresuje budynki
        // wszędzie indziej), a rozjazd zgłasza, zamiast po cichu narysować budynek na
        // cudzej komórce: to jest błąd programu, a nie stan gry.
        if (building.cellId !== i) {
          throw new RangeError(
            `BuildingLayer.update: buildings[${i}].cellId is ${building.cellId} — index and cellId must agree`,
          );
        }
        const def = BUILDINGS[building.type];
        const shape = BUILDING_SHAPES[building.type];
        if (def === undefined || shape === undefined) {
          throw new RangeError(`BuildingLayer.update: unknown building type "${building.type}" at cell ${i}`);
        }

        const radius = baseRadius * shape.radius;
        const height = baseHeight * shape.height;
        params[0] = radius;
        params[1] = height;
        params[2] = 0;
        writeInstance(shellMatrices, built, i);

        const fraction = healthFraction(building.hp, def.hp);
        // Rdzeń leży na SZCZYCIE skorupy (`height`), uniesiony o `lift` — patrz
        // `SURFACE_LIFT_FACTOR`: bez tego dwie powierzchnie leżą w tej samej płaszczyźnie
        // i biją się o bufor głębokości.
        // Promień rdzenia liczony przez ODJĘCIE obwódki o STAŁEJ szerokości od promienia
        // szczytu, nie przez ułamek promienia bryły — patrz `CORE_RIM_FACTOR`: przy ułamku
        // obwódka najmniejszego typu schodziła do 0,63 piksela.
        params[0] = (radius * SHELL_TAPER - coreRim) * coreScale(fraction);
        params[1] = 1;
        params[2] = height + lift;
        writeInstance(coreMatrices, built, i);
        writeCoreColor(fraction, coreColors, built * 3);
        built++;

        if (!building.powered) {
          params[0] = alertRadius + alertPulse;
          params[1] = 1;
          params[2] = lift;
          writeInstance(alertMatrices, unpowered, i);
          unpowered++;
          // Obręcz DOMYKANA wszędzie poza budynkiem odciętym od sieci — i przy braku
          // informacji o przyczynie też, bo wtedy alarm ma wyglądać dokładnie tak, jak
          // wyglądał przed Zadaniem 4, zamiast zgłaszać awarię sieci, której nikt nie
          // stwierdził. Ta sama macierz co obręcz: oba komplety łuków są rozłączne kątowo,
          // więc nic się nie nakłada i nie biją się o bufor głębokości.
          if (outage === undefined || outage[i] !== OUTAGE_UNLINKED) {
            writeInstance(linkMatrices, linked, i);
            linked++;
          }
        }
      }

      shell.count = built;
      core.count = built;
      alert.count = unpowered;
      link.count = linked;
      shell.instanceMatrix.needsUpdate = true;
      core.instanceMatrix.needsUpdate = true;
      alert.instanceMatrix.needsUpdate = true;
      link.instanceMatrix.needsUpdate = true;
      if (core.instanceColor) core.instanceColor.needsUpdate = true;
    },

    dispose(): void {
      shellGeometry.dispose();
      coreGeometry.dispose();
      alertGeometry.dispose();
      linkGeometry.dispose();
      shellMaterial.dispose();
      coreMaterial.dispose();
      alertMaterial.dispose();
      shell.dispose();
      core.dispose();
      alert.dispose();
      link.dispose();
    },
  };
}
