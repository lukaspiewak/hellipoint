# Project Heliopolis — Master Design Spec

**Data:** 2026-09-14
**Status:** zatwierdzony design, przed planem implementacji
**Zastępuje:** draft GDD + Technical Specification + Master Prompt (audyt draftu w Załączniku A)

---

## 1. Zakres dokumentu

Dokument definiuje **model rdzenia, zakres MVP i roadmapę** dla gry Project Heliopolis. Nie jest planem implementacji — ten powstaje osobno, po akceptacji tego specu.

Konwencja wartości liczbowych: każda liczba oznaczona jako **[STROJENIE]** jest szacunkiem startowym do wyznaczenia przez headless runner (§8.3), nie decyzją designerską. Decyzjami designerskimi są **niezmienniki** i **struktury**, nie konkretne liczby.

---

## 2. Wysoka koncepcja

**Gatunek:** sferyczny survival tower defense / roguelite.

**Filar:** jedna zmienna fizyczna — pozycja względem słońca — napędza trzy niezależne systemy jednocześnie:

| Światło | Mrok |
|---|---|
| produkcja energii (Solar) | brak produkcji, praca z baterii |
| brak spawnu z pentagonów | spawn z pentagonów |
| obrażenia od słońca dla wrogów | bezpieczeństwo wroga |

Terminator (granica światło/cień) przesuwa się nieprzerwanie po powierzchni. Nie istnieje pozycja trwale bezpieczna. Gracz nie przełącza się między „fazą dnia" a „fazą nocy" — jego baza w każdej chwili jest częściowo oświetlona i częściowo atakowana.

**Cel komercyjny:** gra sesyjna z multiplayerem kooperacyjnym na wspólnej planecie, docelowo z warstwą meta układu planetarnego.

---

## 3. Decyzje strukturalne

Pięć decyzji podjętych świadomie; każda zmiana którejkolwiek wymaga rewizji całego dokumentu.

| # | Decyzja | Odrzucone alternatywy |
|---|---|---|
| **D1** | **Lokalny terminator jest jedyną prawdą.** Nie ma globalnej fazy dnia/nocy. Stan oświetlenia to własność komórki, wyliczana z jej normalnej i kierunku słońca | globalna faza 110/70 z draftu (sfera staje się tapetą); hybryda (traci sprzężenie obrotu ze źródłem zagrożenia) |
| **D2** | **Duża planeta, gracz kontroluje region.** ~1442 komórki (detail 11), skalowalne do 2562. Spawny 6–8 kroków od bazy | mała planeta ~162 komórek z draftu (brak zaplecza obronnego, MP niemożliwy bez innej mapy) |
| **D3** | **Budynki blokują ruch, ale są przegryzalne** — realizowane przez jednolitą funkcję kosztu, nie przez przełączanie zachowań | twarde blokowanie (perfect turtle na kuli bez krawędzi, zamurowanie sąsiada w MP); brak blokowania (wyścig DPS zamiast TD) |
| **D4** | **Roguelite: run 25–35 min, eskalacja przewyższająca wzrost gracza, draft 1 z 3 co świt** | survival-rush bez rejrywalności; kampania scenariuszowa (najdroższa, wroga MP) |
| **D5** | **Spike czytelności (do wyrzucenia) → monorepo z deterministycznym rdzeniem symulacji** | jedna aplikacja z granicą sim/render dorysowaną później (granica nie powstaje nigdy; utrata headless balansu) |

**Jawnie odrzucone z draftu:** single-file HTML, CDN, Three.js r128, pipeline OBJ/MTL. Są sprzeczne z celem komercyjnym i z D5. Docelowo: aktualne Three.js, glTF, TypeScript, Vite.

---

## 4. Model rdzenia

### 4.1 Geometria

Siatka dualna (bryła Goldberga) z `IcosahedronGeometry(R, detail)`.

```
N = 10·(detail+1)² + 2          liczba komórek
```

Zawsze dokładnie **12 pentagonów**, reszta heksagony. Wartość startowa `detail = 11` → **N = 1442** (1430 hex + 12 pent).

Pipeline generowania:
1. `IcosahedronGeometry` zwraca geometrię **nieindeksowaną** z duplikatami wierzchołków → wymagane weldowanie przez spatial hash z epsilonem.
2. Konwersja do siatki dualnej: dla każdego wierzchołka oryginału tworzona jest komórka, której wierzchołkami są centroidy przyległych trójkątów.
3. **2–3 iteracje relaksacji Lloyda** — redukuje wariancję powierzchni komórek z ~20 % do ~5 %. Konieczne, bo VFX i wizualne zasięgi operują w metrach, podczas gdy reguły w krokach grafu.
4. Klasyfikacja: 5 sąsiadów → `PENTAGON`, 6 sąsiadów → `HEXAGON`.

**Niezmiennik N1 — jednostki.** Wszystkie reguły rozgrywki (zasięgi, promienie, prędkości, zasięg sieci energetycznej) wyrażone są w **krokach grafu** i **krokach/sekundę**. Jednostki świata występują wyłącznie w renderze i VFX. Draft mieszał obie konwencje w jednym obiekcie konfiguracji (`range: 15` w metrach obok `connectionRadius: 3` w heksach) — to jest zakazane.

**Niezmiennik N2 — promień planety nie wpływa na rozgrywkę.** Wyprowadzenie w §4.3. `R` jest decyzją wyłącznie estetyczną.

**Pozycja startowa.** Nie może to być „komórka o indeksie 0" — 12 oryginalnych wierzchołków ikosaedru przeżywa subdywizję jako pentagony, a kolejność bufora nie jest gwarantowana. Pozycja startowa jest wybierana deterministycznie z seeda, z ograniczeniem na minimalną odległość grafową od najbliższego pentagonu (balans trudności startu).

### 4.2 Struktura danych komórki

```ts
interface CellData {
  id: number;
  center: Vec3;            // stała w przestrzeni świata — planeta się nie obraca
  normal: Vec3;
  neighbors: number[];     // 5 lub 6
  cellType: 'HEXAGON' | 'PENTAGON';
  building: BuildingId | null;
  oreRemaining: number;    // 0 = brak złoża lub wyczerpane
}
```

Stan oświetlenia **nie jest polem komórki** — jest funkcją `light(cell, t) = saturate(dot(cell.normal, sunDir(t)))`, wyliczaną na żądanie. Brak stanu = brak desynchronizacji w multiplayerze.

### 4.3 Światło i obrót

**Planeta jest statyczna, orbituje źródło światła.** Matematycznie tożsame z obrotem planety, ale:
- kamera nie gubi bazy co kilkadziesiąt sekund (draft miał obracającą się planetę + OrbitControls — baza uciekałaby z kadru),
- pozycje komórek są stałe w przestrzeni świata → tańszy raycasting, brak transformacji przy serializacji stanu.

Okres obrotu `T` **[STROJENIE: 180 s]**.

**Wyprowadzenie skali.** Odstęp środek–środek sąsiednich komórek:
```
d = R · √(4π / (0,866·N))
```
Prędkość terminatora po powierzchni:
```
v_term = 2πR / T                    [jednostki świata/s]
v_term = 2π / (T · √(4π/(0,866·N))) [kroki/s]       ← R się skraca
```
Czas przejazdu terminatora przez bazę o szerokości `B` kroków:
```
t_przejazdu = B · T · √(4π/(0,866·N)) / 2π          ← R się skraca
```

Dla `N = 1442, T = 180 s`: `v_term = 0,348 kroku/s`.

| Szerokość bazy | Czas przejazdu terminatora |
|---|---|
| 5 kroków (wczesna gra) | 14 s |
| 10 kroków | 29 s |
| 15 kroków (późna gra) | 43 s |

**To jest emergentna krzywa napięcia.** Wczesna, ciasna baza pulsuje szybko między pełnym światłem a pełnym mrokiem. Późna, rozległa jest permanentnie w połowie oświetlona i w połowie atakowana. Nie wymaga żadnego kodu — wypada z geometrii.

### 4.4 Spalanie w świetle

Wróg w oświetlonej komórce akumuluje ekspozycję; po przekroczeniu `burnTime` ginie i zostawia rudę.

**Niezmiennik N3 — pas śmierci.** Maksymalna głębokość wewnątrz oświetlonego obszaru, z której wróg zdąży uciec:
```
D = burnTime · (v − v_term)          [kroki]
```

Konsekwencje projektowe, które należy wykorzystać świadomie:
- `v < v_term` → **jednostka nigdy nie ucieknie ze światła**. Przewidziane dla Armora: staje się bronią wyłącznie nocną, która musi zdążyć do celu przed świtem. Reguła czytelna dla gracza, zero dodatkowego kodu.
- `v >> v_term` → szeroki pas ucieczki, jednostka ryzykuje tylko przy głębokim wtargnięciu.

Wzór `D` wchodzi do testów jednostkowych. Draft trafił w sensowne wartości przypadkiem (pas ~1 komórki dla wszystkich trzech typów) i zmiana `rotationSpeed` lub `radius` wywróciłaby mechanikę do zera bez żadnego sygnału.

**Ucieczka ze światła** to ruch maksymalizujący kąt względem kierunku słońca (najkrótsza droga do cienia), nie „do najbliższego pentagonu" jak w drafcie — ten mógłby prowadzić głębiej w światło.

### 4.5 Pathfinding

Trzy pola wektorowe (Dijkstra na grafie komórek), po jednym na priorytet celu:

| Pole | Źródła Dijkstry | Konsumenci |
|---|---|---|
| `NEAREST_BUILDING` | wszystkie budynki | Swarm |
| `CORE` | komórka z Core | Armor |
| `ENERGY_INFRASTRUCTURE` | budynki z flagą energetyczną | Disruptor |

**Przeliczanie: event-driven** (postawienie/zniszczenie budynku) z throttlingiem 4–10 Hz, **nie co klatkę**. Dijkstra na 1442 węzłach to <1 ms, ale per-klatka to marnotrawstwo i nie skaluje się na MP.

**Blokowanie przez jednolitą funkcję kosztu (D3).** Komórka zajęta jest przechodnia, ale jej koszt wejścia odpowiada czasowi potrzebnemu na jej zniszczenie:
```
cost(cell) = 1 + (cell.building ? building.hp / attackerDps : 0)
```
`attackerDps` to DPS **typu wroga liczącego pole**, nie stała globalna. Konsekwencja projektowa jest celowa: Armor o wysokim DPS wycenia mur taniej niż Swarm, więc te same fortyfikacje kierunkują różne typy wroga różnymi trasami — bez żadnej reguły dedykowanej.

Właściwości:
- ścieżka **zawsze istnieje** → flow field nigdy nie zawodzi, zero walidacji przy budowaniu, zero przypadków brzegowych,
- wróg sam omija drogą zabudowę i przegryza się przez tanią — bez żadnej reguły warunkowej,
- **HP budynku staje się statystyką pathfindingu.** Tanie ściany kierunkują ruch, drogie wymuszają objazd. To jest główne narzędzie kształtowania pola bitwy,
- w MP nie da się zamurować gracza na głucho — mur jest zawsze opóźnieniem wycenionym w sekundach.

Ruch w przestrzeni: `v = normalize(v_flow + v_separation) · speed`, pozycja rzutowana na sferę. Przy 1442 komórkach wektory flow fieldu są wystarczająco gęste; przy mniejszej rozdzielczości ruch byłby widocznie fasetowany.

---

## 5. Systemy

### 5.1 Sieć energetyczna

Graf połączeń: budynek jest podłączony, jeśli istnieje ścieżka przez pylony/budynki w promieniu `connectionRadius` **[STROJENIE: 3 kroki]** do Core lub baterii.

Implementacja: **inkrementalne etykietowanie komponentów (union-find)**, nie pełny rebuild przy każdej zmianie. Przy 1442 komórkach i częstym budowaniu pełny rebuild jest zbędnym kosztem, a przy MP — niedopuszczalnym.

**Brownout.** Gdy `popyt > podaż + magazyn`, urządzenia wyłączane są wg priorytetu:
```
EXTRACTOR → KINETIC_TURRET → LASER_TURRET
```
`BARRICADE` i `PYLON` nie występują w kaskadzie: Barricade nie pobiera energii (§6.1), a wyłączanie pylonów rozspójniałoby sieć, czyli pogłębiało niedobór zamiast go łagodzić.

**Obrona gaśnie ostatnia.** Draft miał kolejność odwróconą (`LASER → KINETIC → EXTRACTOR`), co oznaczało gaszenie obrony w trakcie ataku, czyli gwarantowaną spiralę śmierci. Kolejność jest przestawialna przez gracza.

**Produkcja Solar jest ciągła, nie binarna:** `output = peakOutput · saturate(dot(normal, sunDir))`. Panel na terminatorze daje ~0. Orientacja bazy staje się decyzją, a nie szczegółem.

Konsekwencja do uwzględnienia przy strojeniu: średnia z `saturate(cos)` po pełnym obrocie wynosi **1/π ≈ 0,318**, więc panel oddaje ~32 % mocy szczytowej, a nie 50 % jak przy modelu binarnym. `peakOutput` musi być odpowiednio wyższy niż 15/s z draftu, inaczej Solar staje się nieopłacalny już na starcie.

### 5.2 Ekonomia i presja

**Ruda** — zasób fizyczny, wydobywana przez ekstraktory ze złóż.

- **Startowa ruda jest wymagana** **[STROJENIE: 150]**. Draft nie miał jej wcale, co czyniło grę nierozpoczynalną: ekstraktor kosztuje rudę, a wrogowie pojawiają się dopiero w mroku.
- **Złoża są wyczerpywalne i rozłożone w klastrach** (pola złóż), nie jako pojedyncze losowe heksy.

To jest **główny motor presji**, ważniejszy niż mnożnik fal:

```
wyczerpanie złoża → ekspansja → rozciągnięcie sieci energii →
obrona większego obwodu → większa baza →
dłuższy przejazd terminatora → większa powierzchnia pod ostrzałem
```

Presja narasta z rozwoju gracza, a nie tylko z zewnętrznego licznika. Żółwienie przegrywa, bo baza która nie rośnie — umiera z głodu.

Zwrot z ekstraktora **[STROJENIE: 60–75 s]**. W drafcie wynosił 30 s, przez co ruda przestawała być decyzją w połowie rozgrywki.

### 5.3 Pentagony i spawn

12 pentagonów to jedyne punkty odradzania. Pentagon spawnuje wyłącznie gdy **jego komórka jest w cieniu** (D1).

**Geothermal Cap przekierowuje spawn, nie kasuje go.** Zatkany pentagon przestaje wypuszczać ciągły strumień, ale co `eruptionInterval` **[STROJENIE]** wykonuje **erupcję ciśnienia** w swoim miejscu; siła i częstotliwość erupcji skalują się z liczbą postawionych capów.

Uzasadnienie: cap musi być podłączony do sieci energetycznej, więc gracz capuje pentagony **blisko siebie** — i sam ściąga sobie erupcje do bazy. Handel brzmi: *ciągły strumień z daleka* ↔ *okresowy wybuch u mnie*. To jest prawdziwy trade-off.

W drafcie cap był czystym zyskiem. Licząc energię podtrzymaną na jednostkę rudy przy założeniach draftu (dzień 110 s / noc 70 s): panel oddaje 1650 energii na cykl, czyli 9,17/s średnio, a podtrzymanie tego przez noc wymaga ~642 magazynu, więc zestaw kosztuje 25 + 43 = **68 rudy za 9,17/s ⇒ 0,135 energii/s na rudę**. Cap to **75 rudy za 25/s ⇒ 0,333 — 2,5× więcej**, a po przejściu na produkcję ciągłą (§5.1) przewaga rośnie dalej. Do tego dochodziła blokada spawnu, a „kara" +15 % koncentrowała zagrożenie w jednym punkcie — w tower defense to nagroda, nie ryzyko. Mechanika `allCapsOverloadTimeSeconds` była łatką na ten zepsuty bodziec; po naprawie bodźca **znika**, bo Overload staje się po prostu skrajnym końcem ciągłej krzywej.

### 5.4 Fale i eskalacja

Presja rośnie szybciej niż może rosnąć gracz (D4). Krzywa eskalacji jest **wyznaczana headlessem** (§8.3), nie zgadywana.

Ograniczenie z draftu do usunięcia: `armorStartCycle: 3` przy grze kończącej się w cyklu 3 oznaczał, że Armor pojawia się raz, w liczbie ~4 sztuk. Przy runie 9–12 obrotów wszystkie trzy typy wroga mają czas zaistnieć i ewoluować.

**Do zdefiniowania w Fazie 1** (draft pomijał całkowicie): kadencja ataku wroga na budynek, zachowanie przy kontakcie (zatrzymuje się czy przechodzi), oraz to, czy wieże pobierają energię stale czy tylko przy strzale. Ta ostatnia różnica zmienia bilans energetyczny o rząd wielkości.

### 5.5 Pętla roguelite

**Świt** — moment wejścia Core w światło — jest jedynym naturalnym oddechem w rytmie gry i tam umieszczony jest **draft 1 z 3 ulepszeń**. Kategorie puli: energia / obrona / budowa / ryzyko-nagroda.

**Seed planety** steruje rozkładem klastrów rudy i pozycją startową względem 12 pentagonów.

**Meta-progresja między runami — poza MVP** (§8.2).

### 5.6 Warunki zakończenia

- **Wygrana:** zbudowanie Modułu Ewakuacyjnego (odblokowany w ostatniej tercji runu), naładowanie go i przetrwanie alarmu.
- **Przegrana:** utrata Core.

**Zniszczony Evac jest odbudowywalny** — gracz traci zgromadzony ładunek, nie run. Draft czynił z niego drugi warunek przegranej, co przy jego koszcie było zbyt losowe.

---

## 6. Baza danych obiektów

Wartości poniżej to **[STROJENIE]** w całości; strukturalne są kolumny i flagi.

**Schemat produkcji energii musi być jednolity.** Draft używał trzech różnych nazw pól dla tej samej koncepcji (`energyProduction`, `energyProductionDay`/`Night`, `energyProductionTotal`). Docelowo: jedno pole + jedna funkcja ewaluacji przyjmująca kontekst oświetlenia.

### 6.1 Budynki

| Obiekt | Rola | Uwaga wobec draftu |
|---|---|---|
| `CORE` | punkt startowy, produkcja bazowa, warunek przegranej | produkcja 10/s była w CONFIG, ale brakowało jej w opisie |
| `BARRICADE` | **nowy** — tani blok czysto-HP | D3 wprowadza mechanikę blokowania, a draft nie miał czym blokować: najtańszym blokerem był `PYLON`, który jednocześnie jest szkieletem sieci. Rozdzielenie tych ról czyni też Disruptora znacznie ciekawszym |
| `PYLON` | dystrybucja energii, słaby blok | `connectionRadius` w krokach grafu (N1) |
| `SOLAR_PANEL` | produkcja ∝ `dot(normal, sunDir)` | zmiana z binarnej na ciągłą |
| `BATTERY` | magazyn | konieczna przy D1 — baza zawsze ma stronę w cieniu |
| `EXTRACTOR` | wydobycie ze złoża, wyczerpuje je | złoże ma skończoną pojemność |
| `KINETIC_TURRET` | pojedynczy cel | zasięg w krokach grafu (N1) |
| `LASER_TURRET` | obszarowy | zasięg w krokach grafu (N1) |
| `GEOTHERMAL_CAP` | energia + przekierowanie spawnu w erupcje | przedefiniowany, §5.3 |
| `EVACUATION_MODULE` | warunek wygranej, odbudowywalny | §5.6 |

**Uwaga skalowania zasięgów.** Przy N = 162 z draftu odstęp komórek wynosił ~15 jednostek świata, czyli `KINETIC_TURRET.range = 15` nie sięgał nawet środka sąsiedniej komórki, a `DISRUPTOR.empRadius = 10` obejmował wyłącznie komórkę celu. Po przejściu na kroki grafu (N1) zasięgi wyrażane są jako liczba pierścieni sąsiedztwa — wartość startowa 2–3 pierścienie dla wież, ≥1,5 dla EMP.

### 6.2 Wrogowie

| Typ | Priorytet celu | Rola w ekonomii światła |
|---|---|---|
| `SWARM` | najbliższy budynek | szybki, szeroki pas ucieczki (N3), presja objętościowa |
| `ARMOR` | Core | **`v < v_term`** → nigdy nie ucieka ze światła; broń wyłącznie nocna, wyścig z brzaskiem |
| `DISRUPTOR` | infrastruktura energetyczna | EMP w krokach grafu; przy rozdzieleniu Pylon/Barricade zyskuje wyraźną tożsamość |

Prędkości definiowane **jako wielokrotność `v_term`**, nie w jednostkach bezwzględnych — to jedyny sposób, by N3 nie rozjechał się przy zmianie `T` lub `N`.

**Do zdefiniowania w Fazie 1:** kadencja ataku, zachowanie przy kontakcie, czas trwania i efekt EMP (wyłączenie vs. drenaż).

---

## 7. Architektura techniczna

### 7.1 Podział pakietów

```
packages/sim      TypeScript, zero zależności, zero Three.js
                  stały krok 20 Hz, deterministyczny
                  wejście wyłącznie jako komendy
                  stan w pełni serializowalny
packages/render   Three.js, konsumuje snapshoty, nie mutuje stanu
apps/client       sklejka + UI
tools/headless    runner balansowy (§8.3)
```

**Uzasadnienie:** multiplayer przestaje być przepisaniem i staje się deploymentem — ten sam `packages/sim` uruchamiany jest po stronie serwera jako autorytet. Granica narysowana później nie powstaje nigdy.

### 7.2 Determinizm

Wymagania obowiązujące od pierwszej linijki `packages/sim`:
- stały krok symulacji, całkowicie niezależny od `requestAnimationFrame`,
- wejście gracza jako **komendy** w kolejce, nigdy jako bezpośrednia mutacja stanu,
- deterministyczny PRNG zasilany seedem, jeden strumień na system,
- stabilna kolejność iteracji po encjach (brak zależności od kolejności `Map`/`Set` wynikającej z alokacji),
- stan serializowalny do snapshotu + delty.

### 7.3 Render

- `InstancedMesh` dla terenu, budynków i jednostek — od pierwszego dnia, nie jako optymalizacja.
- Kamera: **model wybierany w Fazie 0**. Swobodna orbita jest odrzucona a priori tylko w zestawieniu z obracającą się planetą; przy statycznej planecie pozostaje kandydatem obok kamery przyklejonej do punktu powierzchni i quasi-2D lokalnej płaszczyzny.
- Pixelizacja 320×240 z draftu: **odłożona**. To decyzja estetyczna podjęta przed istnieniem kierunku artystycznego, a przy 1442 komórkach i 10 typach budynków czytelność przy takiej rozdzielczości jest poważnie zagrożona.

---

## 8. MVP

### 8.1 W zakresie

| Obszar | Zakres |
|---|---|
| Siatka | dual mesh, relaksacja Lloyda, seed, klastry rudy, deterministyczna pozycja startowa |
| Światło | orbitujące źródło, oświetlenie per komórka, spalanie wg N3 |
| Ruch | 3 pola flow, jednolita funkcja kosztu (D3), separacja jednostek |
| Energia | inkrementalne komponenty, brownout z poprawioną kolejnością, ciągła produkcja Solar |
| Ekonomia | wyczerpywalne złoża w klastrach, startowa ruda |
| Obiekty | 10 typów budynków (w tym nowy Barricade), 3 typy wrogów |
| Zagrożenie | eskalacja fal + erupcje capów |
| Roguelite | draft 1 z 3 co świt, seed planety |
| Zakończenie | warunki wygranej i przegranej |
| **Narzędzia** | **headless runner balansowy + testy jednostkowe reguł** |

Dwie ostatnie pozycje są w MVP celowo, nie jako „nice to have" — patrz §8.3.

### 8.2 Poza zakresem MVP

meta-progresja między runami · zaćmienia · kierunek artystyczny i pixelizacja · audio · multiplayer · układ planetarny · onboarding

### 8.3 Headless runner — uzasadnienie obecności w MVP

W tej grze co najmniej sześć systemów jest wzajemnie sprzężonych: geometria ↔ prędkość terminatora ↔ pas śmierci ↔ dobór wrogów ↔ bilans energetyczny ↔ tempo wyczerpywania złóż. Audyt draftu (Załącznik A) wykazał 13 sprzeczności arytmetycznych w dokumencie, którego nikt nie uruchomił.

Strojenie „na oko" nie zbalansuje tego układu. Headless runner pozwala przepuścić 10 000 runów na zadanych seedach i odczytać rozkłady: odsetek zwycięstw, moment przegranej, wykorzystanie typów budynków, moment wyczerpania złóż, udział spalania w świetle w całkowitych ubitych.

**Warunkiem jego istnienia jest D5** — rdzeń symulacji bez zależności od renderu. To jest główny, konkretny zwrot z inwestycji w architekturę.

### 8.4 Testy do napisania obok reguł

- pas śmierci `D = burnTime · (v − v_term)` dla każdego typu wroga przy zmienionych `T` i `N`
- `v < v_term` ⇒ jednostka nigdy nie opuszcza oświetlonego obszaru
- kaskada brownoutu przy kolejnych progach niedoboru
- funkcja kosztu ścieżki: ścieżka istnieje zawsze, także przy pełnym otoczeniu budynkami
- sieć energetyczna: rozspójnienie po zniszczeniu pylonu, ponowne spojenie po odbudowie
- determinizm: identyczny seed + identyczna kolejka komend ⇒ identyczny hash stanu po N tickach

---

## 9. Roadmapa

Szacunki dla **jednej osoby na pełny etat**; do przeliczenia po ustaleniu składu zespołu.

| Faza | Czas | Zakres | Kamień milowy |
|---|---|---|---|
| **0** | 1–2 dni | Spike czytelności kuli. Świadomie do wyrzucenia. Dual mesh detail 11, orbitujące światło, kilkadziesiąt jednostek na flow fieldzie, wybór komórki, **trzy modele kamery do porównania** | Wybrany model kamery + zmierzony budżet klatki przy 1442 komórkach i setkach jednostek |
| **1** | ~2 tyg | Monorepo. `packages/sim` headless: tick 20 Hz, siatka, światło, flow field, energia, ekonomia, fale. **Zero renderu.** Testy §8.4 + headless runner | Gra przechodzi się w konsoli i daje się zbalansować statystycznie |
| **2** | ~2 tyg | `packages/render` + sterowanie: instancing, kamera z Fazy 0, UI zasobów i budowy, wejście jako komendy | Grywalny run od startu do ewakuacji |
| **3** | ~2–3 tyg | Pętla roguelite, pula ulepszeń, krzywa eskalacji strojona headlessem, seedy | Run jest napięty i powtarzalny; rozkłady z 10 000 runów są zdrowe |
| **4** | ~2–3 tyg | Kierunek artystyczny, VFX terminatora, audio, game feel, onboarding | Wersja do pokazania |
| **5** | ~4–6 tyg | Co-op na jednej planecie: autorytatywny `sim` na serwerze, predykcja klienta, reconnect, 2–4 graczy | 4 bazy na jednej planecie |
| **6** | — | Układ planetarny: warstwa meta, interakcja między planetami, persystencja | |
| **7** | — | Komercjalizacja: dystrybucja, meta-progresja, content | |

---

## 10. Ryzyka

| Ryzyko | Faza | Mitygacja |
|---|---|---|
| **Tower defense na kuli może być nieczytelny.** Gracz nie widzi połowy planety, zagrożenie nadchodzi zza horyzontu | 0 | Faza 0 jest **bramką, nie formalnością**. Negatywny wynik oznacza powrót do designu, nie brnięcie dalej |
| **Pasmo w multiplayerze.** Setki jednostek × autorytatywny serwer | 5 | Budżet pasma liczony w **Fazie 1**, przy projektowaniu formatu snapshotu — nie w Fazie 5. Kompresja delt + interest management |
| **Przestrzeń balansu jest duża i sprzężona** | 1–3 | Headless runner w MVP (§8.3) |
| **Czytelność przy 10 typach budynków** — draft zakładał 320×240 | 2, 4 | Pixelizacja odłożona do istnienia kierunku artystycznego; decyzja o rozdzielczości po Fazie 2 |
| **Zakres Fazy 6 jest niedookreślony.** „Inne planety, gdzie gracze walczą o przetrwanie" może oznaczać asynchroniczny metagame albo rozgrywkę live — to dwa różne projekty | 6 | Rozstrzygnięcie odłożone do po Fazie 5, gdy znane będą realne koszty warstwy sieciowej |

---

## 11. Pytania otwarte

Świadomie nierozstrzygnięte; każde ma przypisaną fazę.

| # | Pytanie | Faza |
|---|---|---|
| Q1 | Model kamery | 0 |
| Q2 | Kadencja ataku wroga i zachowanie przy kontakcie z budynkiem | 1 |
| Q3 | Czy wieże pobierają energię stale, czy tylko przy strzale (różnica rzędu wielkości w bilansie) | 1 |
| Q4 | Efekt EMP: wyłączenie budynku czy drenaż magazynu | 1 |
| Q5 | Wszystkie wartości **[STROJENIE]** | 1–3 |
| Q6 | Skład puli ulepszeń roguelite | 3 |
| Q7 | Kierunek artystyczny i docelowa rozdzielczość | 4 |
| Q8 | Zaćmienia: telegrafowane i rzadkie-ale-duże, czy całkowicie usunięte | 4 |
| Q9 | Charakter warstwy międzyplanetarnej: asynchroniczna czy live | po 5 |

---

## Załącznik A — audyt draftu

Zachowany jako uzasadnienie decyzji. „Blocker" oznacza sprzeczność uniemożliwiającą uruchomienie gry w zamierzonej formie.

| # | Draft | Ustalenie | Waga | Rozwiązanie |
|---|---|---|---|---|
| A1 | `detail: 2` → 150 hex + 12 pent | Three.js: `N = 10(detail+1)²+2`, więc detail 2 → **92 komórki**. Deklarowane 162 wymaga detail 3 | Blocker | D2, §4.1 |
| A2 | Sesja 45–60 min | 3 cykle × 180 s = **9 minut**, rozbieżność ~6× | Blocker | D4 |
| A3 | Kinetic range 15, Laser 20 | Przy 162 komórkach odstęp ≈ 15 jednostek świata → Kinetic nie sięga środka sąsiada | Blocker | N1, §6.1 |
| A4 | Pentagony jako odległe zagrożenie | 12 pentagonów = wierzchołki ikosaedru; kąt wierzchołek→środek ściany 37,4° → **max 2,1 kroku od dowolnego punktu**. Brak zaplecza obronnego przy każdej rozdzielczości poniżej ~1400 komórek | Blocker | D2 |
| A5 | Fala cyklu 3 = klimaks | 15 × 1,35² = 27 wrogów, ~2040 EHP. Jeden laser czyści w 34 s | Blocker | D4, §5.4 |
| A6 | Brak startowej rudy | Ekstraktor kosztuje 30, wrogowie dają rudę dopiero w mroku → cykl 1 nierozgrywalny | Blocker | §5.2 |
| A7 | Cap jako ryzyko | 75 rudy → 25/s całodobowo = 2,1× lepiej niż solar+bateria za 95 rudy, **plus** blokada spawnu. „Kara" +15 % koncentruje zagrożenie w jednym punkcie, co w TD jest nagrodą | Wysoka | §5.3 |
| A8 | Brownout `[LASER, KINETIC, EXTRACTOR]` | Gasi obronę w trakcie ataku → spirala śmierci | Wysoka | §5.1 |
| A9 | `connectionRadius: 3` obok `range: 15` | Dwie jednostki w jednym obiekcie konfiguracji | Wysoka | N1 |
| A10 | Ekonomia jako ograniczenie | Zwrot z ekstraktora 30 s; przychód ~2× całkowitego możliwego wydatku → ruda przestaje być decyzją | Wysoka | §5.2 |
| A11 | `armorStartCycle: 3` przy końcu w cyklu 3 | Armor pojawia się raz, ~4 sztuki — cała jego mechanika nie zdąży zaistnieć | Średnia | D4 |
| A12 | Komórka 0 = `STARTING_HEXAGON` | 12 wierzchołków ikosaedru przeżywa subdywizję jako pentagony; kolejność bufora niegwarantowana | Średnia | §4.1 |
| A13 | `empRadius: 10` | Przy odstępie 15 obejmuje wyłącznie komórkę celu | Średnia | N1 |

**Sprzeczności koncepcyjne:** globalna faza 110/70 wobec geometrii, w której oświetlona jest zawsze dokładnie połowa planety (→ D1) · obracająca się planeta + OrbitControls gubiące bazę z kadru (→ §4.3) · zadeklarowany gatunek roguelite bez żadnego elementu roguelite (→ D4) · „single-file, CDN, r128" wobec celu komercyjnego i multiplayera (→ D5) · `isOccupied` w strukturze danych, którego żadna reguła nie używa (→ D3).

**Trafienie przypadkowe, warte zachowania:** prędkość terminatora `ωR = 1,745 j/s` dawała pas śmierci 18,8 / 15,0 / 10,0 jednostek dla Swarm / Disruptor / Armor — spójny pas ~1 komórki. Nikt tego nie policzył i zmiana `rotationSpeed` lub `radius` wyzerowałaby mechanikę bez sygnału. Sformalizowane jako niezmiennik N3.
