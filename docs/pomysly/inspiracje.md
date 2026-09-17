# Inspiracje — zbiornik przed przeglądem

Plik **narastający**. Trafiają tu pomysły z zewnętrznych źródeł, zanim ktokolwiek zdecyduje,
czy wchodzą do specu albo do planu fazy. Nic tutaj nie jest ustaleniem projektowym.

**Konwencja wpisu.** Jedno źródło = jedna sekcja `## NNN — <źródło>`. Wewnątrz każdy pomysł
osobno, z polami:

- **Co** — wymaganie albo obserwacja, w formie kryterium, nie techniki.
- **Dotyka** — miejsce w Heliopolis: paragraf specu, faza, plik.
- **Koszt** — co się unieważnia, jeśli to przyjąć.
- **Rekomendacja** — moja, z uzasadnieniem. Nie jest decyzją.
- **Status** — `DO PRZEGLĄDU` / `PRZYJĘTE` / `ODRZUCONE` (+ powód).

Wszystkie propozycje implementacji są oznaczone jako **jedna z możliwych dróg**, nigdy jako wymóg
— wymaganiem jest kryterium w polu **Co**.

---

## 001 — udara.io / New Dawn Protocol

**Źródło:** https://udara.io — strona osobista Udary Jaya. Kluczowy tekst:
https://udara.io/making-a-world (dziennik NDP, wrzesień 2026). Poboczne: `/affordance`,
`/design-engineering`, `/game-of-life`, `/phylotaxis`.
**Zebrane:** 2026-09-17.

**Czym jest NDP:** strategia o odbudowie planety, solo, dwa lata pracy. Planeta generowana
z seeda, potem zostawiona symulacji: pogoda, woda spływająca po terenie, osady zależne od siebie,
migracje, awarie infrastruktury, obce społeczeństwa. Gracz autoryzuje interwencje i patrzy,
czym się stały.

**Wspólne z Heliopolis:** planeta z seeda, jedna autorytatywna symulacja, renderer który ją
*tłumaczy* i nie posiada faktów, determinizm jako wymóg od pierwszej linijki.

**Rozbieżne:** NDP to piaskownica na symulowane lata, Heliopolis to run 25–35 minut (D4).
Dlatego przenosi się **metoda**, nie treść.

---

### 001.1 — Adresowana losowość zamiast pozycji w strumieniu

**Co.** Wynik losowania ma być funkcją *adresu zdarzenia*, a nie pozycji w sekwencji.
Kryterium sprawdzalne: **dołożenie nowego konsumenta losowości w dowolnym systemie nie zmienia
ani jednego wyniku w systemach pozostałych, przy tym samym seedzie.** Sposób pomiaru: dwa
przebiegi `DEFAULT_RUN` na tym samym seedzie, drugi ze sztucznie dołożonym losowaniem w innym
systemie — hashe stanu identyczne w każdym ticku.

Sformułowanie źródła: „jeśli jutrzejsza pogoda się zmienia, chcę żeby to było dlatego, że coś się
zmieniło w jutrzejszej pogodzie, a nie dlatego, że dołożyłem pytanie sześć systemów wcześniej".

**Dotyka.**
- Spec §7.2 — zapis *„deterministyczny PRNG zasilany seedem, jeden strumień na system"*.
- `packages/sim/src/math/rng.ts` — `Rng.fork(streamId)`.
- `packages/sim/src/sim/spawning.ts:179` — `pickType` woła `rng.nextInt(pool.length)`
  ze współdzielonego `waveRng`; każdy spawn przesuwa generator.
- `packages/sim/src/sim/state.ts:163` — `waveRng: RngState` w stanie i w `stateHash`.
- Faza 3 (krzywa eskalacji, rozkłady z 10 000 runów), Faza 5 (predykcja klienta).

**Stan faktyczny — zweryfikowany w kodzie, nie założony.** Heliopolis ma to zrobione w połowie.
`fork` wyprowadza strumień z ORYGINALNEGO seeda, nie z bieżącego stanu, więc systemy są
wzajemnie niezależne — to już jest mocniejsze niż jeden wspólny strumień. Ale WEWNĄTRZ strumienia
losowania pozostają pozycyjne.

**Co z tego wynika — dwa skutki, które dziś nie bolą.**

1. **Faza 3 mierzy podziałką, która się zmienia razem z mierzonym.** Każda zmiana balansu
   dokładająca losowanie przesuwa wszystkie późniejsze typy wroga w tym strumieniu, więc
   porównanie „ten sam seed przed i po zmianie" przestaje znaczyć to, co ma znaczyć.
2. **Faza 5 ma predykcję klienta.** Przy strumieniu każdy rollback predykcji musi zapisać
   i odtworzyć pozycję generatora. Przy adresie rollback nie dotyka losowości w ogóle —
   dowolne losowanie da się przeliczyć z adresu w dowolnym momencie.

Dodatkowo: draft roguelite 1 z 3 (§5.5, Faza 3) jeszcze nie istnieje. Jeśli powstanie na
strumieniu, wylosowana oferta będzie zależeć od tego, ilu wrogów zdążyło się dotąd zespawnować.

**Jedna z możliwych dróg** (nie wymóg): adres postaci `(seed, rodzaj, encja, wystąpienie)`.
Dla spawnu najtańsza forma to typ jednostki jako czysta funkcja jej `unitId` — `nextUnitId` już
jest w stanie i już jest hashowany, więc zmiana **usuwa** `waveRng` ze stanu zamiast cokolwiek
dokładać. Dla draftu: adres `(seed, DRAFT, numer świtu)`. Generację planety zostawić na
strumieniach — tam losowania są masowe w pętli i indeks pętli JEST naturalnym adresem.

**Koszt.** Unieważnia baseline'y `stateHash` i wszystkie zapisane przebiegi referencyjne.
Robi się to raz. Po Fazie 3 koszt rośnie, bo unieważni też zestrojoną krzywą.

**Rekomendacja.** Przyjąć, wykonać przed Fazą 3 — czyli w 2C albo tuż po. Osobno i wcześniej:
poprawić §7.2, bo „jeden strumień na system" to JAK zapisane jako wymóg (patrz 001.5).
Ta poprawka jest słuszna niezależnie od tego, czy adresowanie wejdzie.

**Status:** DO PRZEGLĄDU.

---

### 001.2 — Autoryzacja to nie jest sterowanie

**Co.** Komenda gracza jest **autoryzacją**, nie wykonaniem. Między nią a skutkiem stoją warunki
materialne, i to one rozstrzygają. Kryterium: gdy komenda się nie powiedzie albo zadziała gorzej
niż gracz oczekiwał, **przyczyna ma być odczytywalna z gry**, nie z kodu.

Sformułowanie źródła: rozpad umowy z inną społecznością nie ma być skutkiem zdarzenia
dyplomatycznego, tylko tego, że zobowiązanie materialne pod umową przestało być wykonalne.

**Dotyka.** Faza 2C (sterowanie, komendy) — plan jeszcze nie napisany. Spec §7.2 ma już
„wejście gracza jako komendy w kolejce, nigdy jako bezpośrednia mutacja stanu" — to jest
warunek konieczny tego pomysłu, ale nie on sam.

**Heliopolis ma już dwa zmierzone przypadki, których nie umie pokazać:**
- **Q3:** cztery lasery dają run 10 224 ticki, dwa — 13 323. Czwarta wieża realnie OSŁABIA
  obronę, bo popyt ponad podaż trzyma brownout włączony na stałe. Gracz autoryzował więcej
  obrony i dostał mniej.
- **Q4:** DISRUPTOR celuje w `ENERGY_INFRASTRUCTURE`, więc łańcuchy pylonów do dalekich
  pentagonów są pułapką — zjadł wszystkie 7 między cyklem 2 a 3, odłączając capy.

Oba to łańcuchy przyczynowe istniejące w symulacji i niewidoczne dla gracza.

**Koszt.** Sam w sobie żaden — to jest kryterium dla planu, który dopiero powstanie. Koszt
pojawi się w zakresie UI 2C.

**Rekomendacja.** Wpisać do planu Fazy 2C jako wymaganie, nie jako „nice to have". Q3 i Q4
są gotowymi przypadkami testowymi.

**Status:** DO PRZEGLĄDU.

---

### 001.3 — Bramka czytelności PRZYCZYNOWEJ

**Co.** Wszystkie dotychczasowe bramki mierzą czytelność **optyczną**: kontrast pasm, próg
piksela, terminator jako ostra granica, pięć pytań o stany jednostek. Nie istnieje żaden pomiar
tego, czy gracz potrafi **cofnąć się po przyczynie**.

Kryterium akceptacji, w tej samej formie co bramka terminatora („gracz wskazuje komórkę i mówi:
ta świeci, ta nie"): **gracz wskazuje, co zniszczyło jego budynek, i podaje przyczynę o jeden
krok wstecz. Próg: N poprawnych na M pytań.** Wartości N i M do ustalenia, tak jak przy
poprzednich bramkach.

Sformułowanie źródła: „nie chcę gry, która zachowuje się losowo na tyle, żeby mnie zaskoczyć.
Chcę takiej, gdzie patrzę na coś, czego nie przewidziałem, idę po konsekwencjach wstecz
i w końcu myślę: no jasne". I osobno: „samo zaskoczenie jest bardzo tanie".

**Dotyka.** Faza 2C lub 4. Wzorzec dokumentu: `docs/superpowers/specs/2026-09-15-faza-2b-czytelnosc.md`.

**Koszt.** Bramka wymaga udziału użytkownika, jak poprzednie. Nie da się jej zrobić headlessem
— to jest pomiar na człowieku.

**Rekomendacja.** Przyjąć jako bramkę Fazy 2C. Uzasadnienie: 2C jest pierwszym pełnym grywalnym
przebiegiem (kamień milowy §9), czyli pierwszym momentem, w którym łańcuchy przyczynowe w ogóle
mają gdzie się objawić.

**Status:** DO PRZEGLĄDU.

---

### 001.4 — Headless jako instrument projektowy, nie tylko balansowy

**Co.** Runner ma odpowiadać na pytanie **dlaczego run się skończył**, nie tylko kiedy.
Kryterium: z raportu pojedynczego przebiegu da się odtworzyć łańcuch przyczynowy prowadzący
do przegranej, bez czytania kodu symulacji.

Sformułowanie źródła: „jednym z moich ulubionych sposobów testowania gry jest teraz nie granie
w nią" — puścił świat na pełny symulowany rok bez gracza i patrzył, czy świat miał rok, a nie
czy zdarzeń było dużo. „Większość tych zdarzeń jest skrajnie nudna w izolacji."

**Dotyka.** `tools/headless/src/report.ts`, `tools/headless/src/run.ts`. Faza 3 (strojenie krzywej).

**Koszt.** Ślad przyczynowy to nowe dane w symulacji albo w runnerze. Jeśli w symulacji —
dotyka `SimState` i przez to Fazy 5. Do rozstrzygnięcia przy planie.

**Rekomendacja.** Przyjąć, ale dopiero razem z Fazą 3 — wcześniej nie ma czego stroić.
Warto wtedy sprawdzić, czy ślad da się trzymać POZA `SimState`, żeby nie obciążać snapshotu.

**Status:** DO PRZEGLĄDU.

---

### 001.5 — Defekt w §7.2 ujawniony przez 001.1

**Co.** §7.2 zapisuje: *„deterministyczny PRNG zasilany seedem, **jeden strumień na system**"*.
To jest JAK postawione w miejscu CO — dokładnie ten powracający błąd, który w tym projekcie
cofnął pracę cztery razy (relaksacja siatki, weldowanie epsilonem, progowanie oświetlenia,
kierunek naliczania w Dijkstrze).

Wymaganiem jest **odtwarzalność z seeda i niezależność systemów**. „Jeden strumień na system"
to jedna z dróg do tego — i jak pokazuje 001.1, słabsza od adresowania, bo nie daje
niezależności WEWNĄTRZ systemu.

**Dotyka.** Spec §7.2, jedna linijka.

**Koszt.** Żaden. Poprawka jest słuszna niezależnie od losu 001.1 — zamienia technikę na
kryterium i nie przesądza implementacji.

**Rekomendacja.** Poprawić przy najbliższym dotknięciu specu. Nie czeka na resztę przeglądu.

**Status:** DO PRZEGLĄDU (użytkownik świadomie odłożył do przeglądu zbiorczego 2026-09-17).

---

### 001.6 — Nie przenosić: głębi symulacji NDP

**Co.** NDP sprzęga pogodę → wody gruntowe → logistykę → chorobę → politykę. To działa, bo
gracz ma symulowane lata. Run 25–35 minut (D4) nie zdąży spłacić kaskady przez osiem systemów,
a filar §2 — JEDNA zmienna fizyczna napędzająca trzy systemy naraz — jest wart więcej niż osiem
sprzężonych. Przyjęcie tego wymagałoby rewizji D1–D5, czyli całego dokumentu (§3).

**Ale zasada pod tą głębią już u nas jest**, w najlepiej zaprojektowanej mechanice: Geothermal
Cap musi być podłączony do sieci → gracz capuje pentagony blisko siebie → sam ściąga sobie
erupcje do bazy (§5.3). Nikt nie napisał „ukarz gracza za capowanie". To wypada z ograniczenia
materialnego.

Udara nazywa regułę ogólną tego, co spec odkrył lokalnie: **nie autoruj konsekwencji, autoruj
ograniczenie i pozwól konsekwencji się zasłużyć.** Draft robił odwrotnie — cap jako czysty zysk
plus `allCapsOverloadTimeSeconds` jako łatka na zepsuty bodziec — i spec już to raz naprawił.

**Rekomendacja.** Odrzucić treść, zapisać zasadę jako test dla każdej przyszłej mechaniki:
*czy konsekwencja jest autorska, czy zasłużona?*

**Status:** ODRZUCONE (treść) / DO PRZEGLĄDU (zasada jako kryterium projektowe).

---

### 001.7 — Pozostałe teksty źródła, bez pomysłu do przeniesienia

- **`/design-engineering`** — projektowanie i programowanie jako jedno rzemiosło; „obszary
  podatne na iterację buduje się luźniej, fundamenty w rdzeniu — solidnie". To opis metody,
  którą Heliopolis już stosuje (spike Fazy 0 świadomie do wyrzucenia, rdzeń z 591 testami).
  Potwierdza, nic nie zmienia.
- **`/affordance`** — afordancje jako drabina, w której każdy szczebel zakłada poprzedni;
  most przez znajomy kształt (Wii, korona Apple Watch). Może wrócić przy onboardingu (Faza 4),
  dziś bez zastosowania.
- **`/phylotaxis`, `/game-of-life`, `/science/virtual-cells`** — zaplecze intelektualne autora,
  nie projekt. Phyllotaxis dotyczy rozkładu punktów na PŁASZCZYŹNIE; nasza siatka to dual
  geodezyjnej, inny problem. Bez przeniesienia.

---

## 002 — pomysły użytkownika

**Źródło:** użytkownik, 2026-09-17.
**Uwaga o formie:** część pozycji przyszła jako nazwy zmiennych (`axialTiltDeg = 23.5`,
`rotationSpeedRad`). Zapisuję pod nimi wymaganie, bo nazwa pola to JAK — a przy trzech z tych
pomysłów to właśnie wybór JAK okazał się rozstrzygający (patrz 002.3).

**Pomiary w tej sekcji są zmierzone, nie wyprowadzone.** Skrypty: pełny obrót próbkowany co tick
(T = 180 s, 3600 próbek) na planecie `seed: 1`, `frequency: 12`, 1442 komórki, przez `createPlanet`
i `lightAt` z `packages/sim/dist`. Odtwarzalne; skrypty były jednorazowe, w razie potrzeby
napisać ponownie.

---

### 002.0 — Stan wyjściowy: co planeta ROBI dzisiaj

Zmierzone, bo trzy kolejne pozycje opierają się na tym, czego dziś nie ma:

| Fakt | Wartość |
|---|---|
| Komórki **nigdy nie oświetlone** | **dokładnie 2** — `#96` n=(0, 1, 0) i `#875` n=(0, −1, 0), średnie nasłonecznienie `0.000000` |
| Frakcja światła — mediana i maksimum po wszystkich komórkach | **0,5000 / 0,5000** |
| Frakcja cienia każdego z 12 pentagonów | **0,5000** (dwa 0,5003 — artefakt próbkowania) |
| Średnie nasłonecznienie: pas równikowy → podbiegunowy | **0,3164 → 0,0686** (spadek 4,6×) |
| Równik wobec teorii `1/π` z §5.1 | 0,3164 vs 0,3183 ✓ |

**Wniosek, który organizuje całą sekcję 002.1–002.3:**

> Planeta ma dziś gradient **energii** wzdłuż szerokości geograficznej (4,6×), ale **nie ma
> żadnego gradientu zagrożenia**. Frakcja cienia wynosi 0,5000 w każdym pasie i przy każdym
> pentagonie. Szerokość geograficzna zmienia to, ile dostajesz prądu — nigdy tego, jak długo
> jesteś atakowany.

`sunDirection` zwraca `{cos θ, 0, sin θ}` — słońce krąży dokładnie w płaszczyźnie `y = 0`,
czyli deklinacja wynosi zero. Dwie komórki na biegunach osi `y` mają `dot = 0` dokładnie
(nie w przybliżeniu — `normalize` daje tam zera bitowe), więc `light > 0` jest tam fałszem
zawsze. To są jedyne dwa miejsca na planecie, gdzie panel daje trwałe zero, a jednostka
nigdy się nie pali.

---

### 002.1 — Strefy termiczne: ciepło w świetle, mróz w cieniu

**Co.** Użytkownik świadomie zostawił otwarte, na co mają wpływać („może wpływać na jakieś
mechaniki"). Zapisuję więc pytanie, nie wymaganie: **czy temperatura wnosi informację, której
nie niesie już binarne światło/cień?**

**Dotyka.** §2 (filar: JEDNA zmienna fizyczna napędza trzy systemy), §4.4 (spalanie), `light.ts`,
`burning.ts`.

**Ryzyko, które trzeba nazwać.** Jeśli temperatura jest funkcją bieżącego oświetlenia, to nie
jest nową zmienną — to piąte i szóste znaczenie doklejone do tej samej binarnej informacji,
którą gracz już czyta jako „światło = prąd + bezpiecznie, cień = spawn + groźnie". Filar §2
zyskuje na tym, że jedna zmienna robi trzy rzeczy; przy pięciu zaczyna tracić czytelność,
a bramka 2B pokazała, że kanałów wizualnych jest mało (żaden pojedynczy ton nie osiąga 3:1
wobec wszystkich trzech pasm terenu — obiekt musi nieść dwa tony).

**Wariant, w którym to JEST nową zmienną: bezwładność cieplna.** Temperatura jako **całka
oświetlenia po czasie**, nie jego bieżąca wartość. Komórka świeżo wchodząca w cień jest jeszcze
ciepła, komórka w głębi nocy — głęboko wychłodzona. Wtedy terminator dostaje **strukturę
ciągnącą się za nim**, której dziś nie ma, i która niesie informację o *historii* komórki.
To jest też jedyny wariant, w którym 002.2 i 002.3 mają na co działać: nachylenie osi i tempo
obrotu zmieniają właśnie całkę, nie wartość chwilową.

**Koszt.** Jeden float na komórkę w `SimState` → +1442 wartości w snapshocie, czyli obciążenie
Fazy 5 (§10: pasmo jest zapisanym ryzykiem). Do sprawdzenia, czy da się to trzymać jako wartość
**wyprowadzalną** z `tick` i normalnej komórki zamiast przechowywanej — przy stałym `T`
temperatura jest funkcją analityczną czasu i szerokości, więc prawdopodobnie tak.

**Rekomendacja.** Nie przyjmować „ciepła i mrozu" jako osobnych stref. Przyjąć **bezwładność
cieplną** jako kandydata, z kryterium akceptacji przed implementacją: *czy gracz odczytuje
różnicę między komórką świeżo wychłodzoną a wychłodzoną od dawna, bez UI?* Jeśli nie —
mechanika nie ma nośnika i wraca do kolejki. To jest ten sam test, który wyciął relaksację
siatki i progowanie oświetlenia.

**Status:** DO PRZEGLĄDU.

---

### 002.2 — Tempo obrotu jako modyfikator planety

**Co.** Szybki obrót → częste krótkie starcia. Wolny → długie, wycieńczające noce.
Wymaganie: **tempo obrotu jest parametrem planety, różnicującym rytm runu.**

**Dotyka.** §4.3 (okres `T` **[STROJENIE: 180 s]**), §5.1 (produkcja Solar), `light.ts`.

**To jest najtańsza pozycja w całym zbiorze — parametr już istnieje.** §4.3 wyprowadza z `T`
całą krzywą napięcia i podaje tabelę czasów przejazdu terminatora (5 kroków → 14 s, 15 kroków
→ 43 s przy T = 180 s). Zmiana `T` per planeta nie wymaga nowego kodu, tylko przeniesienia
stałej do konfiguracji planety.

**Handel, który to otwiera — i który jest ostry.** Średnie nasłonecznienie to `1/π` **niezależnie
od `T`** (średnia po pełnym cyklu nie zależy od jego długości). Więc wolniejszy obrót **nie
zmienia ilości energii** — zmienia wyłącznie to, ile **magazynu** trzeba, żeby przetrwać noc,
i to liniowo. Czyli: wolna planeta nie jest biedniejsza, jest **droższa w baterie**. Szybka
planeta jest tania w baterie, ale nie daje okna na odbudowę między falami.

To jest handel tego samego rodzaju co Geothermal Cap (§5.3) — wypada z arytmetyki, nikt go
nie autorował.

**Koszt.** Minimalny. Unieważnia strojenie §5.2/§5.4 dla wartości innych niż 180 s, więc krzywa
eskalacji z Fazy 3 musiałaby być strojona **wobec `T`**, nie przy jednym `T`.

**Rekomendacja.** Przyjąć. Wykonać razem z Fazą 3, nie wcześniej — przed strojeniem krzywej nie
ma czego różnicować. Zakres do rozstrzygnięcia przy planie: czy `T` jest losowane z seeda,
czy wybierane przez gracza jako modyfikator trudności.

**Status:** DO PRZEGLĄDU.

---

### 002.3 — Nachylenie osi i noc polarna

**Co.** Wymaganie: **szerokość geograficzna ma wpływać na czas trwania cienia, a nie tylko na
nasłonecznienie** — czyli ma powstać gradient zagrożenia, którego dziś nie ma (002.0).

**Dotyka.** §4.3, §5.3 (pentagon spawnuje wyłącznie w cieniu), `light.ts`, `spawning.ts:79`
(`if (light[cellId] > 0) continue`), orientacja dwudziestościanu w `geodesic.ts`.

**Zmierzone: co daje stała deklinacja słońca.** Deklinacja `δ` = nachylenie; słońce zatacza
okrąg na stałej wysokości nad równikiem. Pomiar na tej samej planecie:

| Nachylenie | Noc polarna | Dzień polarny | Pentagony w nocy polarnej | Śr. frakcja cienia |
|---|---|---|---|---|
| 0° (stan dzisiejszy) | **2 kom.** | 0 | — | 0,5007 |
| 10° | 7 kom. | 7 kom. | — | 0,5000 |
| **23,5°** | **57 kom.** | **57 kom.** | **—** | 0,5000 |
| 30° | 87 kom. | 87 kom. | — | 0,5000 |
| 31,7° | 107 kom. | 107 kom. | — | 0,5000 |
| **32°** | 111 kom. | 111 kom. | **`#558`, `#781`** | 0,5000 |
| 45° | 215 kom. | 215 kom. | `#558`, `#781` | 0,5000 |

**Trzy rzeczy, których pomiar nie potwierdził albo wprost obalił:**

1. **Przy 23,5° żaden pentagon nie trafia w noc polarną.** Próg leży **między 31,7° a 32°** —
   bo najwyżej położone pentagony siedzą na `|y| = 0,851` (szerokość 58,3°), a warunek trwałej
   ciemności to `|szerokość| > 90° − δ`. Czyli **wartość z pomysłu (23,5°) nie daje efektu,
   który ten pomysł ma dawać.** Sama liczba pochodzi z Ziemi, gdzie o tym, czy coś stoi za
   kołem podbiegunowym, decyduje położenie miasta — a tutaj decyduje orientacja
   dwudziestościanu, która jest stała dla wszystkich planet.

2. **Średnia frakcja cienia to 0,5000 przy KAŻDYM nachyleniu.** Nachylenie nie zmienia
   globalnego budżetu cienia, tylko jego rozkład: ile komórka zyskuje, tyle inna traci,
   a dzień polarny powstaje zawsze symetrycznie do nocy polarnej i w tej samej liczbie komórek.
   To nie jest pokrętło trudności, tylko pokrętło **nierówności**.

3. **Nachylenie nie daje SEZONU.** Przy stałej deklinacji czapa nocy polarnej jest trwała przez
   cały run — nie przychodzi i nie odchodzi. Sezon wymaga drugiej skali czasu (deklinacja
   oscylująca z osobnym okresem = „rok"). Run to 9–12 obrotów, więc rok ≈ długość runu, czyli
   **jeden przechył sezonowy na run** — eskalacja wypadająca z geometrii, dokładnie w duchu
   §4.3. To jest osobny, droższy pomysł niż samo nachylenie i trzeba go rozstrzygnąć osobno.

**Tania droga do „różnicuje planety" (jedna z możliwych).** Nie nachylenie, tylko **losowa
orientacja siatki wobec osi obrotu, per seed**. Dziś orientacja dwudziestościanu jest stała,
więc każda planeta ma pentagony na tych samych szerokościach. Jeden kwaternion z seeda sprawia,
że seed rozstrzyga, ilu pentagonom przypadnie noc polarna — przy dowolnym nachyleniu, w tym
przy 23,5°. Koszt: jedna rotacja przy generacji, zero w symulacji, zero w stanie.

**Koszt całości.** Zmiana `sunDirection` unieważnia wszystkie baseline'y `stateHash` i zapisane
przebiegi. Dotyka `pickStart` (§5.3 dobiera start wobec odległości od pentagonów — przy nocy
polarnej odległość przestaje wystarczać jako miara zagrożenia).

**Rekomendacja.** Przyjąć **wymaganie** (gradient zagrożenia wzdłuż szerokości), odrzucić
**liczbę** 23,5° jako nieskuteczną przy obecnej orientacji. Kolejność: najpierw losowa orientacja
per seed (tania, sama w sobie różnicuje planety), potem nachylenie jako parametr planety,
sezon jako osobna decyzja po Fazie 3. Nie wcześniej niż razem z 002.2 — obie zmieniają to samo
`sunDirection` i ten sam zestaw baseline'ów.

**Status:** ROZSTRZYGNIĘTE → patrz **002.6**, gdzie wymaganie („gradient zagrożenia") dostało konkretny kształt, liczby i dwie otwarte kwestie. Liczba 23,5° pozostaje odrzucona.

---

### 002.4 — Fizyczne magistrale po krawędziach zamiast promienia zasięgu

**Co.** Zastąpienie bezprzewodowego `connectionRadius` fizycznymi rurami/tunelami/taśmami
układanymi po krawędziach sąsiednich komórek. Wymaganie pod spodem: **zniszczenie jednego
odcinka ma odcinać całe podrzędne skrzydło bazy.**

**Dotyka.** §5.1 (`connectionRadius` **[STROJENIE: 3 kroki]**, union-find, kaskada brownoutu),
`network.ts`, `power.ts`, D3 (budynki blokują ruch, ale są przegryzalne).

**Wymaganie jest już spełnione — i to zmierzone.** Q4 z Fazy 1C: DISRUPTOR celuje
w `ENERGY_INFRASTRUCTURE`, więc łańcuchy pylonów do dalekich pentagonów **są pułapką** —
zjadł wszystkie 7 między cyklem 2 a 3, odłączając capy. To jest dokładnie „zniszczenie odcinka
odcina skrzydło", tyle że odcinkiem jest pylon w komórce, nie rura na krawędzi. §5.1 zna ten
problem na tyle dobrze, że wyłącza `PYLON` z kaskady brownoutu, bo *„wyłączanie pylonów
rozspójniałoby sieć, czyli pogłębiało niedobór zamiast go łagodzić"*.

**Czyli pytanie nie brzmi „czy dodać chokepointy", tylko „co daje przeniesienie ich na
krawędzie".** Odpowiedź ma dwie strony i druga jest stratą:

- **Zysk:** magistrala zajmuje krawędź, nie komórkę → logistyka przestaje konkurować o miejsce
  z zabudową; ~3× więcej krawędzi niż komórek, więc przestrzeń decyzji rośnie.
- **Strata:** dzisiejszy pylon jest **jednocześnie przewodem i murem** — blokuje ruch i daje się
  przegryźć (D3). Magistrala na krawędzi nie jest ani murem, ani celem w komórce. To **rozprzęga**
  logistykę od D3, czyli zdejmuje sprzężenie, które D3 zostało powołane utrzymać.

**Koszt.** Przepisanie §5.1 unieważnia Q3 — pomiar „4 lasery dają run 10 224 ticki, 2 lasery
13 323", czyli cały dzisiejszy baseline balansu energetycznego. Do tego nowa struktura danych
(~4300 krawędzi), nowa warstwa renderu, nowy rodzaj celu dla wroga.

**Rekomendacja.** Nie przyjmować przed Fazą 3, i nie na podstawie samego pomysłu. Najpierw
odpowiedzieć empirycznie na pytanie, które 002.4 zakłada za rozstrzygnięte: **czy gracz odczytuje
dzisiejszą awarię łańcucha pylonów jako chokepoint** — to jest przypadek testowy gotowy do
bramki czytelności przyczynowej z 001.3. Jeśli tak, magistrale kupują przestrzeń decyzji za cenę
rozprzęgnięcia D3 i jest to handel do rozważenia. Jeśli nie — problemem jest czytelność,
nie topologia, i przepisanie §5.1 go nie naprawi.

**Status:** DO PRZEGLĄDU.

---

### 002.5 — Galaktyka: planeta jako trwała instancja na serwerze

**Co.** Każda planeta jest fizyczną instancją na serwerze; gracze mogą ją odwiedzać wiele razy.

**Dotyka.** **Q9** (charakter warstwy międzyplanetarnej: asynchroniczna czy live — faza „po 5"),
§10 (ryzyko: *„zakres Fazy 6 jest niedookreślony… to dwa różne projekty"*), **D4** (roguelite,
run 25–35 min), §8.2 (meta-progresja poza MVP), §9 Faza 6.

**To jest odpowiedź na Q9, i to na droższą gałąź.** §10 świadomie odłożyło to rozstrzygnięcie
do po Fazie 5, *„gdy znane będą realne koszty warstwy sieciowej"*. Zapisuję jako **deklarację
kierunku użytkownika**, nie jako zamknięcie Q9 — powód odroczenia nie zniknął.

**Co to zmienia w D4, i to trzeba powiedzieć wprost.** Jeśli planeta trwa i wraca się na nią,
to **jednostką rozgrywki przestaje być run, a staje się planeta.** D4 mówi „run 25–35 min,
eskalacja przewyższająca wzrost gracza" — przy trwałej instancji trzeba rozstrzygnąć, co się
dzieje z planetą między wizytami: zamarza, cofa się, czy żyje dalej bez gracza. Trzecia opcja
to jest dokładnie NDP z 001 („świat miał rok, gracz po prostu niewiele w nim pomógł") — i jest
najdroższa, bo wymaga symulacji działającej bez sesji.

Zgodnie z §3 zmiana któregokolwiek z D1–D5 wymaga rewizji całego dokumentu.

**Ograniczenie, które obowiązuje JUŻ TERAZ, niezależnie od rozstrzygnięcia Q9.** Trwała
instancja oznacza, że stan planety musi być serializowalny **do trwałego magazynu**, nie tylko
na drut: wersjonowany, migrowalny między wersjami gry, odtwarzalny po latach. §7.2 wymaga dziś
serializowalności do snapshotu i delt — to jest warunek słabszy. Ma to bezpośredni skutek dla
001.1: adresowana losowość jest przy trwałych instancjach **mocniej uzasadniona**, bo pozycja
generatora zapisana w migawce sprzed roku i zmiana kodu w międzyczasie to dokładnie ten tryb
awarii, który 001.1 likwiduje.

**Koszt.** Hosting per planeta, pasmo z §10 pomnożone przez czas życia instancji, wersjonowanie
zapisu. Zakres Fazy 6.

**Rekomendacja.** Nie zamykać Q9 teraz — powód odroczenia z §10 jest nadal ważny i nie mamy
kosztów sieci. Przyjąć natomiast **jedno wynikające stąd ograniczenie do Fazy 5**: projektując
format snapshotu, założyć trwałość i wersjonowanie, nie tylko transmisję. To jest tanie
teraz i bardzo drogie później.

**Status:** DO PRZEGLĄDU (deklaracja kierunku) / Q9 pozostaje OTWARTE.

---

### 002.6 — Ciemna czapa jako CEL WYPRAWY

**Co.** Rozstrzygnięcie 002.3 po rozmowie z użytkownikiem 2026-09-17. Wymaganie brzmi:
**trwale ciemny rejon ma być miejscem, po które się IDZIE — urozmaiceniem i zagrożeniem
naraz — a nie rejonem, którego się unika.** Odrzucona została wcześniejsza interpretacja
przez blokadę pływową (patrz „Czego NIE robić" niżej).

**Dotyka.** §4.3 (`sunDirection`, okres `T`), §5.3 (kominy, Geothermal Cap, `pickStart`),
`packages/sim/src/sim/spawning.ts:79`, `light.ts`, orientacja dwudziestościanu w `geodesic.ts`.
Faza 3 (krzywa eskalacji).

#### Pętla domyka się z części, KTÓRE JUŻ ISTNIEJĄ

Nic z poniższego nie wymaga nowej mechaniki. Wszystkie liczby zmierzone na `seed: 1`,
nachylenie 32°, `T = 180 s`.

1. **Zagrożenie.** Przy nachyleniu ≥ 32° w czapę wpadają pentagony (#0 i #102 na północy,
   #558 i #781 na południu). Pierwsza linijka logiki pentagonu to `if (light[cellId] > 0)
   continue` — a `continue` stoi **przed wszystkim**, także przed odliczaniem erupcji.
   Skoro frakcja cienia wynosi **dokładnie 0,5000** wszędzie indziej, komin w nocy polarnej
   jest **dwukrotnie aktywniejszy** od każdego innego, i to w obu trybach naraz.
2. **Powód, żeby tam iść.** `GEOTHERMAL_CAP` daje **25 energii stale, niezależnie od światła**
   (`energyOutput: CONSTANT`). W trwałej ciemności to **jedyne działające źródło** — panel daje
   tam zero na zawsze. Zacapowanie jednocześnie zatrzymuje strumień i zapala prąd tam,
   gdzie prądu nie ma skąd wziąć.
3. **Cena.** Start (#1382) leży **14–22 kroki** od pentagonów czapy, `PYLON.connectionRadius`
   to 3 kroki. Wyprawa kosztuje **5–8 pylonów × 15 rudy + cap 75 = 150–195 rudy**.
   Dla skali: całe otwarcie daje 150 rudy i kupuje za nie jeden laser (§11.1).
   **Wyprawa na biegun to cały budżet otwarcia.**
4. **Ryzyko ciągłe.** `DISRUPTOR.targetPriority = ENERGY_INFRASTRUCTURE` — pępowina zasilająca
   jest dokładnie tym, co on zjada. Zmierzone w Fazie 1C (Q4): zjadł wszystkie 7 pylonów
   między cyklem 2 a 3, odłączając capy.
5. **Kara za sukces.** §5.3: cap nie kasuje ciśnienia, tylko przekierowuje je w okresowe
   erupcje rosnące z liczbą capów. Skoro zegar erupcji **też zamarza w świetle**, zacapowany
   komin polarny erupuje z **podwójną częstotliwością**. Czyli komin, który najbardziej chcesz
   zatkać, jest tym, w którym zatkanie boli najmocniej.

Punkt 5 nikogo nie kosztował projektowania — wypada z jednego `continue`. To jest ten sam
wzorzec, co Geothermal Cap w §5.3 i ta sama zasada, co 001.6: **nie autoruj konsekwencji,
autoruj ograniczenie.**

#### Zmierzone progi

| Fakt | Wartość |
|---|---|
| Najwyższy pentagon | `\|y\| = 0,8507` → szerokość **58,3°** |
| Nachylenie, przy którym pentagon wpada w czapę | **> 31,72°** (23,5° NIE wystarcza) |
| Czapa przy 32° / 45° | **111** / **215** komórek, promień 5,6 / 7,8 kroku |
| Głębokość penetracji wroga w rejon TRWALE oświetlony | SWARM **2,40**, DISRUPTOR **2,23**, ARMOR **2,37** kroku |
| Ruda w czapach (seed 1) | 7 komórek płn. / 28 płd., przy 229 na planecie |

Uwaga do trzeciego wiersza: trzy typy o zupełnie różnej prędkości i czasie spalania dochodzą
**praktycznie tak samo daleko**. To skutek tego, że `speedFactor` jest zdefiniowany WZGLĘDEM
prędkości terminatora (`movement.ts:36`), a nie w jednostkach świata.

#### Dwie kwestie otwarte — do rozstrzygnięcia przed implementacją

1. **Jasna czapa jest symetryczna i nikt jej nie zamawiał.** Nachylenie daje ją zawsze, w tej
   samej liczbie komórek: 111 przy 32°, dwa **martwe** kominy (spawn wymaga cienia) i — skoro
   wróg wchodzi na 2,4 kroku przy promieniu 5,6 — **rdzeń ~3 kroków, do którego nic nie dojdzie**.
   Łagodzą to trzy istniejące fakty: nasłonecznienie podbiegunowe **0,0686 wobec 0,3164** na
   równiku (4,6× mniej, więc panele tam prawie nie produkują), CORE się **nie przenosi**
   (stoi na `startCell`), a `ARMOR.targetPriority = CORE`, więc schowanie się nic nie daje.
   Kandydat do rozważenia, NIE decyzja: moduł ewakuacyjny stojący tam, gdzie obrony nie
   potrzeba, ale gdzie nie ma prądu, żeby go zasilić — końcówka runu jako problem logistyczny
   zamiast kolejnej walki.
2. **Wariancja rudy w czapach jest duża** (7 wobec 28 przy jednym seedzie). To urozmaicenie,
   ale Faza 3 musi je uwzględnić przy strojeniu krzywej, inaczej rozrzut runów wzrośnie
   z powodu, którego nikt nie kontroluje.

#### Czego NIE robić: blokada pływowa

Rozważona i **odrzucona pomiarem**. Przy blokadzie terminator stoi, więc: §4.3 traci krzywą
napięcia (jest wyprowadzona z przejazdu terminatora przez bazę), §5.1 traci sens baterii
(po jasnej stronie nie ma nocy, po ciemnej nie ma słońca), §5.3 dostaje 6 kominów wiecznie
czynnych i 6 martwych, a **N3 przestaje pracować w obie strony** — nic nie ucieka, ale też nic
nigdy nie zostaje złapane, bo światło na nikogo nie nachodzi. To terytorium D1–D5, czyli
rewizja całego dokumentu (§3).

Przy okazji zmierzone: **`D = burnTime × (speedFactor − 1) × v_term`**, czyli głębokość ucieczki
jest **odwrotnie proporcjonalna do okresu obrotu**. Użyteczne okno `T` jest wąskie —
przy 60 s SWARM ucieka 4,1 kroku (dzienna strona dziurawa), przy 600 s ćwierć kroku (granica
staje się absolutną ścianą). Sensowny zakres to **120–300 s**, a dzisiejsze 180 s leży
pośrodku. To zawęża 002.2 bardziej, niż tam napisano.

**Koszt.** Zmiana `sunDirection` unieważnia wszystkie baseline'y `stateHash` i zapisane przebiegi.
Dotyka `pickStart` (§5.3 dobiera start wobec odległości od pentagonów — przy nocy polarnej sama
odległość przestaje wystarczać jako miara zagrożenia).

**Rekomendacja.** Przyjąć wymaganie. Kolejność: **(a)** losowa orientacja siatki per seed —
tania, zero kosztu w symulacji i w stanie, a sprawia, że seed rozstrzyga, ile pentagonów wpada
w czapę; **(b)** nachylenie jako parametr planety, razem z `T` z 002.2, bo obie zmiany dotykają
tego samego kodu i tych samych hashy; **(c)** rozstrzygnięcie kwestii jasnej czapy.
Nie wcześniej niż Faza 3 — przed zestrojoną krzywą nie ma czego różnicować.

**Status:** PRZYJĘTE (wymaganie) / DO ROZSTRZYGNIĘCIA (jasna czapa, wariancja rudy) /
ODRZUCONE (blokada pływowa, 23,5° jako liczba).
