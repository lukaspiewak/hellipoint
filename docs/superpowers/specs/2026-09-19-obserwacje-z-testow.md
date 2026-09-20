# Obserwacje z testów z ludźmi — dziennik

Dziennik znalezisk z sesji z graczami. Plan sesji: [plan testów](2026-09-19-plan-testow-z-ludzmi.md).

**Reguła tego dziennika:** zapisujemy, **nie naprawiamy w trakcie serii**. Każda zmiana
balansu albo ruchu unieważnia porównanie między testerami, a przy trzech–pięciu osobach nie
ma z czego odbudować próby. Poprawki idą hurtem po całej serii — decyzja właściciela.

Każdy wpis niesie: co widział gracz, co pokazał pomiar, gdzie to siedzi w kodzie, i czego
naprawa dotknie. **Bez pomiaru wpis jest wrażeniem, nie znaleziskiem.**

---

## Sesja 1 (2026-09-19, właściciel) — balans `321c77c8`

Trzy obserwacje, wszystkie o RUCHU jednostek. Dwie pierwsze zgłoszone jako osobne wady;
trzecia okazała się ich wspólną przyczyną.

### O1. Przeciwnicy nie przekraczają granicy noc/dzień — stoją pod ścianą

**Gracz:** *„nie potrafią przekraczać granicy noc/dzień, blokują się"*.

**Pomiar** (seed 5, 20 000 ticków, próbki co 20): 20,5 % próbek jednostek znajduje się
w komórce oświetlonej, ale **głębokość zawsze wynosi dokładnie 1 krok**. Przez cały
przebieg ani jedna jednostka nie weszła głębiej. 61 wejść z cienia w światło i tyleż
natychmiastowych odwrotów.

**Kod:** `movement.ts` — `if (light[u.cellId] > 0)` → jednostka porzuca cel i biegnie ku
punktowi antypodycznemu do słońca. Warunek patrzy na **bieżącą** komórkę, więc odwrót
następuje w tym samym ticku, w którym komórka dostanie choćby ślad światła.

**Rozjazd ze specyfikacją.** §4.4 definiuje **pas śmierci** `D = burnTime · (v − v_term)` —
„maksymalna głębokość wewnątrz oświetlonego obszaru, z której wróg zdąży uciec". To opisuje
światło jako RYZYKO: można wejść na kilka komórek, zapłacić zdrowiem, przejść. Implementacja
daje ŚCIANĘ. Przy głębokości zawsze ≤ 1 wzór `D` nie opisuje niczego, co zachodzi w grze.

**Test N3 tego nie łapie:** `scale.test.ts` sprawdza wyłącznie arytmetykę `burnEscapeDepth`,
nigdy zachowania w symulacji. Wzór jest poprawny, a pas, który opisuje, nie istnieje —
ta sama klasa co „test nazwany od granicy, której arytmetyka nie osiąga" (CLAUDE.md §1).

**Konsekwencja dla rozgrywki:** przez pół każdego obrotu baza po stronie dziennej jest
**nietykalna**, a nie „trudna do zdobycia".

**Do decyzji właściciela — filar, nie liczba.** Trzy drogi:
1. zostawić ścianę i **usunąć `D` ze specu**, żeby nie obiecywał nieistniejącej mechaniki;
2. wpuścić wrogów w światło na `D` kroków zgodnie z N3 — przywraca napięcie po stronie dziennej;
3. wpuszczać tylko wtedy, gdy cel leży w zasięgu `D` — świadome poświęcenie zamiast błądzenia.

Skłaniam się do (2), bo to jest wersja już opisana w specu i nigdy niezaimplementowana.

### O2. Jednostki atakują z odstępu ~1⅓ heksa

**Gracz:** *„nie podchodzą do atakowanego obiektu, atakują z przynajmniej 1 hexem odstępu —
tak ma być?"*. **Nie, tak nie ma być.**

**Pomiar** (seed 5, 1 999 próbek ataku): dystans jednostka → budynek w chwili ataku wynosi
**p10 = 1,32, p50 = 1,37, p90 = 1,52 rozstawu komórki**. Gdyby jednostka stała w środku
sąsiedniej komórki, byłoby dokładnie **1,00**.

**Kod:** zamiar w `combat.ts` brzmi „jednostka atakuje budynek w swojej komórce, a jeśli go
nie ma — ten, który blokuje jej następny krok", czyli z sąsiedztwa. Ale `movement.ts` robi
`if (next < 0 || s.buildings[next] !== null) continue;` — `continue` pomija **cały ruch**,
nie samo przejście między komórkami. Jednostka zamarza w chwili wejścia w komórkę sąsiadującą
z budynkiem, czyli przy jej DALSZEJ krawędzi, i nigdy nie dochodzi do środka.

**Naprawa jest jednoznaczna:** odmawiać wyłącznie przejścia do zajętej komórki, a nie ruchu
w obrębie własnej. Nie ma tu czego wybierać — jedyne pytanie to kiedy.

**Czego dotknie:** `updateMovement` rusza trajektorię złotego haszu i może przesunąć
przypisanie komórek, więc pola przepływu i balans. Po naprawie trzeba przemierzyć kryteria
(~30 min maszyny). Na same obrażenia nie wpływa — dps nie zależy od dystansu, więc jest to
wada CZYTELNOŚCI, a czytelność jest w tej grze filarem.

### O3. Ruch wygląda jak uderzanie w niewidzialną ścianę — WSPÓLNA PRZYCZYNA O1 i O2

**Gracz:** *„samo uciekanie jednostek przed światłem jak i podążanie wygląda źle, bo
jednostki uderzają w wirtualną ścianę"*.

**Kod:** w `movement.ts` **nie ma modelu przyspieszenia ani ograniczenia tempa skrętu**.
Sprawdzone: jedyny `lerp` w pliku to `slerpToward`, czyli krok po wielkim okręgu — nie
wygładzanie. Z tego wynikają dwie rzeczy, obie widoczne:

- **Prędkość jest zero-jedynkowa.** Albo pełny `angleStep`, albo `continue` i zero ruchu.
  Jednostka przechodzi z pełnej prędkości w bezruch w jednym ticku, bez hamowania — i tak
  właśnie wygląda O2.
- **Kierunek nie ma limitu skrętu.** `targetDir` przeskakuje między następnikiem pola
  przepływu a kierunkiem anty-słonecznym, więc potrafi się odwrócić o **180° między dwoma
  tickami**, a `slerpToward` od razu wykonuje pełny krok w nową stronę — i tak wygląda O1.

**To znaczy, że O1 i O2 nie są trzema wadami, tylko jedną wadą z trzema objawami.** Nawet
gdyby rozstrzygnąć przepuszczalność światła (O1) i domknąć odstęp (O2), ruch nadal będzie
czytał się szarpnięciami, dopóki prędkość i kierunek zmieniają się skokowo.

**Kandydaci do rozważenia** (żaden nie zmierzony, wszystkie do sprawdzenia po serii):
limit skrętu na tick; wygładzanie prędkości przy zatrzymaniu; rozdzielenie „nie mogę wejść
w tę komórkę" od „nie mogę się ruszyć". Trzeci jest najtańszy i domyka O2 przy okazji.

**Uwaga o zakresie:** to jest wada RENDERU w skutkach, ale jej źródło siedzi w symulacji,
więc nie da się jej naprawić w `packages/render`. Determinizm i autorytatywność symulacji
(D5, wymóg Fazy 5) znaczą, że każde wygładzanie musi być częścią `updateMovement`,
a nie interpolacją w kliencie.

---

## Stan napraw (2026-09-19, po sesji 1)

| | stan | uwaga |
|---|---|---|
| **O1** przepuszczalność światła | **zaimplementowane, WYŁĄCZONE** | mechanika gotowa, włączenie wymaga przestrojenia |
| **O2** odstęp w ataku | **naprawione** (`ee9f374`) | 1,37 → 0,51 rozstawu |
| **O3** wygładzenie ruchu | **naprawione warunkowo** | działa razem z O1 |

### Czwarta droga: zaimplementowana, zmierzona, domyślnie wyłączona

Mieszanie kierunku proporcjonalnie do `Unit.exposure` **działa i robi dokładnie to, co
obiecywało**:

| | przed | po |
|---|---|---|
| głębokość wejścia w światło | 1 krok | **2 kroki** |
| wejść w światło (próbki co 20 ticków) | 61 | **265** |
| ticków ze zwrotem ostrzejszym niż 90° | 21,85 % | **1,85 %** |
| p90 zwrotu na tick | 175,6° | **28,1°** |

Drugie dwa wiersze to naprawa O3 — jedna zmiana odpowiada na oba zgłoszenia gracza.

**Ale ściana okazała się nośna, i to jest wynik dnia:**

| | przed | po |
|---|---|---|
| H1 (sufit) | 32,2 % | **4,2 %** |
| udział zabójstw słońca | 35,0 % | **11,6 %** |

Powód jest strukturalny: mieszanie po poparzeniu czyni wrogów **optymalnymi zarządcami
oparzenia** — wchodzą, przypiekają się, cofają, regenerują w cieniu i wracają. Słońce
przestaje być barierą, a odpowiadało za **jedną trzecią wszystkich zabójstw**.

Przemiatanie własnego pokrętła mechaniki tego nie ratuje — H1 przy progu 0,5 / 0,7 / 0,85 /
1,0 wynosi 4,2 / 4,2 / 0,8 / 5,8 %. **Włączenie pasa śmierci wymaga przestrojenia całego
balansu**, nie samego pokrętła.

Stąd `RunConfig.lightPermeability`, domyślnie **0 = ściana**, dodane do `AXES` jako oś
przemiatania. Mechanika jest zaimplementowana, związana testami i mierzalna normalnym
przyrządem; gra zachowuje dzisiejszy balans do czasu decyzji. Przy zerze zachowanie jest
odtworzone **co do bitu** — złota trajektoria wróciła do wartości sprzed zmiany.

**DECYZJA (2026-09-20, właściciel): zostaje wyłączone, przestrojenie po testach.**

Powód jest ten sam, który zamyka cały ten dziennik: **seria testów ma mierzyć jedną grę.**
Przestrojenie balansu pod pas śmierci zmieniłoby to, na czym grają testerzy, a przy
trzech–pięciu osobach nie ma z czego odbudować próby. Mechanika czeka gotowa — oś
`lightPermeability` jest w `AXES`, przemiatanie kosztuje kilka godzin maszyny i zero
projektowania, bo wszystkie pomiary z 19 września są zapisane wyżej.

Kolejność jest więc: **seria testów na dzisiejszym balansie → przestrojenie hurtem →
dopiero wtedy decyzja, czy pas śmierci wchodzi razem z resztą poprawek.**

### Dlaczego O3 czeka na O1, a nie odwrotnie

Po naprawie O2 zostały dwa objawy skokowości: natychmiastowy obrót o 180° przy
terminatorze i zatrzymanie bez hamowania pod murem. **Drugi jest już łagodny** —
jednostka dochodzi do ściany zamiast zamarzać o jedną trzecią heksa od niej — więc
dominującym objawem jest ten pierwszy. A on jest **wprost sterowany decyzją O1**:
jeśli światło przestanie być ścianą, zmieni się to, *czy* i *kiedy* jednostka zawraca,
więc każde wygładzenie zrobione teraz trzeba by przerabiać.

**Jest przy tym droga, która rozwiązuje O1 i O3 naraz i nie wymaga nowego stanu.**
`Unit.exposure` już istnieje i rośnie, dopóki jednostka stoi w świetle. Kierunek marszu
można mieszać między celem z pola przepływu a ucieczką w cień **proporcjonalnie do
ekspozycji**: jednostka wchodzi w światło dalej idąc do celu, a zawraca dopiero, gdy
poparzenie narasta. To daje jednocześnie:

- **pas śmierci z §4.4** — wejście w światło na głębokość zależną od `burnTime`, czyli
  dokładnie to, co opisuje `D = burnTime · (v − v_term)`, a czego dziś nie ma;
- **płynny obrót** zamiast skoku o 180°, bo mieszanie jest ciągłe;
- **zero nowych pól w `SimState`**, więc bez ruszania niezmiennika serializowalności,
  kompletności `stateHash` i skanera strukturalnego.

**Nie wdrażam tego bez decyzji**, bo to zmienia filar: światło przestaje być ścianą.
Zapisane tutaj, żeby przy rozstrzyganiu O1 była na stole razem z trzema drogami wyżej —
jako czwarta, która wychodzi taniej niż każda z nich osobno.

---

## Odłożone z bramki gałęzi Fazy 3 (2026-09-20)

Bramka dała 11 znalezisk; sześć naprawiono przed scaleniem, trzy drobne przy okazji.
**Dwa zostały świadomie odłożone** — żadne nie zmienia liczby, którą ktoś dziś zobaczy,
ale oba są prawdziwe i wracają przy następnym strojeniu.

### D1. Pasmo H2 robi się arytmetycznie puste przy H1 ≤ 4 %

`health.ts`: `ok: h2Pct > 2 && h2Pct < h1Pct * 0.5`. Przy H1 = 4 % sufit wynosi 2 %, więc
warunek `> 2 && < 2` jest **niespełnialny dla żadnej wartości podłogi**. Widać to w raporcie
wprost: `próg >2% i <0.0%`.

Dziś nieszkodliwe (H1 = 32,2 % → pasmo (2; 16,1)), ale **przemiatanie `lightPermeability`
działa w zakresie H1 = 0,8–5,8 %**, czyli dokładnie tam, gdzie H2 dostaje wykrzyknik
z powodu arytmetyki, a nie z powodu bota — i nic tego nie mówi. Wróci przy przestrajaniu
balansu pod pas śmierci.

*Kierunek naprawy:* trzeci stan („pasmo puste — kryterium nie orzeka") zamiast `ok: false`,
tak jak przy H5/H6 bez danych.

### D2. Dwie fikstury nadal idą za balansem

`fullrun.test.ts` („wrogowie faktycznie się pojawiają i faktycznie atakują CORE") oraz
`snapshot.test.ts` („wznowienie po przegranej nie wskrzesza zniszczonego CORE") biorą
`DEFAULT_RUN` wprost, choć ich przesłanki wymagają **gęstego przebiegu** — czyli dokładnie
tej klasy, dla której powstał `gestyRun`.

Zmierzony zapas: 2 655–2 752 ticków przy limicie 6 000, czyli 2,2×. Dziś nic nie oblewa;
ryzyko jest jakościowe — **następne zejście z tempem spawnu ruszy je razem z balansem**,
a wtedy oblewa coś, co z balansem nie ma nic wspólnego.

*Kierunek naprawy:* przepuścić obie przez `gestyRun` przy najbliższym strojeniu, razem
z przemierzeniem liczb w ich komentarzach (część pochodzi sprzed Zadania 3).

---

## Co z tego wynika dla Fazy 4

Kamień milowy Fazy 4 to „wersja do pokazania", a jej zakres to m.in. **game feel**. O3 jest
dokładnie tym: żadna ilość VFX nie zasłoni ruchu, który skacze. **Warto wejść w Fazę 4
z rozstrzygniętym O1 i naprawionym O2**, bo inaczej pierwsze, co zrobi kierunek artystyczny,
to podkreśli szarpnięcia.
