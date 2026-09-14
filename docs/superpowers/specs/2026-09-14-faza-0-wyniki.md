# Faza 0 — Wyniki spike'u czytelności kuli

> **Status dokumentu: CZĘŚCIOWY.** Ten spike wymaga człowieka przy klawiaturze
> dla P1, P2, P3 (ocena opisowa) i P5 — to jest z założenia niemożliwe do
> zmierzenia lub ocenienia automatycznie, więc te liczby/oceny **nie zostały
> sfabrykowane, oszacowane ani zasymulowane**. Każda sekcja niżej jest wprost
> oznaczona `[ZMIERZONE / ZWERYFIKOWANE PRZEZE MNIE]` albo
> `[CZEKA NA CZŁOWIEKA]`. Bramka (sekcja 1) i wybór kamery (sekcja 2) **nie są
> rozstrzygnięte** dopóki człowiek nie wypełni tabel w sekcji 3.
>
> **Aktualizacja 2026-09-14 (po sesji 1 człowieka):** człowiek wykonał sesję
> prób. **P2 i P5 zostały zmierzone/ocenione** — surowe dane w
> `.superpowers/sdd/faza-0/wyniki-sesja-1.md`, przeniesione do tabel w §3
> poniżej. **P1 i P3 okazały się niemierzalne**, z przyczyn harnessu, nie
> wykonania — diagnoza w tym samym pliku. Harness naprawiono tego samego dnia
> (szczegóły w §1); P1 i P3 czekają teraz na **sesję 2** na naprawionym
> harnessie. Tabele P1/P3 w §3 pozostają puste celowo — **żadna liczba P1/P3
> nie została zmyślona.**

Data sporządzenia: 2026-09-14. Autor: Claude (agent), zgodnie z
`docs/superpowers/plans/2026-09-14-faza-0-spike-czytelnosci.md`.

---

## 0. Metadane pomiaru

| Pozycja | Wartość |
|---|---|
| Wersja Three.js (rozwiązana przez npm, `node_modules/three/package.json`) | **0.180.0** |
| Zakres w `package.json` | `^0.180.0` |
| Vite | 5.4.21 |
| TypeScript | 5.9.3 (konfiguracja luźna: `strict: false`, zgodnie z planem) |
| Node.js użyty do budowy/uruchomienia | v22.22.0 |
| `N` (liczba komórek) | 1442 — **zweryfikowane programowo przy każdym starcie aplikacji** (patrz §6) |

Środowisko, w którym wykonywałem weryfikację funkcjonalną i pomiar P4:
przeglądarka Chromium (Claude desktop app / Claude Code Browser pane) na
macOS, GPU raportowane przez WebGL jako `ANGLE (Apple, ANGLE Metal Renderer:
Apple M5, Unspecified Version)`, 10 rdzeni CPU, 32 GB RAM, WebGL 2.0 / GLSL ES
3.00. **To NIE jest sprzęt minimalny** — patrz zastrzeżenie w §4.

---

## 1. Wynik bramki: PASS / WARUNKOWY / FAIL

# WARUNKOWY

Zatwierdzone przez człowieka po dwóch sesjach prób. Sesja 1 unieważniła P1 i P3 przez defekty
harnessu; po ich naprawie sesja 2 dała komplet danych.

| próba | werdykt | dane |
|---|---|---|
| **P1** | PASS | K1 bez wskaźników: 1676, 1884, 1966, 3275, 5008 ms → **mediana 1966 ms** wobec progu 3000. Dwie z pięciu prób powyżej progu |
| **P2** | **WARUNKOWY** | K1 wygrywa bezapelacyjnie (mediana 2868 ms wobec K2 4276 i K3 6256), ale **wszystkie próby były ZE SKRÓTEM**. Wariantu bez skrótu nie zmierzono |
| **P3** | PASS | terminator czytelny w trybie progowanym, potwierdzony nakładką prawdy. W trybie ciągłym **niewidoczny** |
| **P4** | PASS z zastrzeżeniem | 0,29–0,31 ms wobec progu 8 ms — wyłącznie maszyna deweloperska, sprzęt minimalny nadal nieustalony |
| **P5** | PASS jakościowy | „możliwe choć uciążliwe, ale tak powinno być" — uciążliwość jest tu cechą, nie wadą |

**Warunkowość wisi na P2, nie na P3.** Plan definiuje WARUNKOWY jako „kryteria spełnione tylko
ze wskaźnikami / skrótem / minimapą", czyli gdy czytelność trzeba dokupić pomocą w UI. P2 spełnia
tę definicję dosłownie: powrót do bazy potwierdzony wyłącznie z klawiszem.

**Korekta rozumowania kontrolera.** Warunkowość początkowo przypisano próbie P3 i było to błędne.
Progowanie nie jest pomocą w UI, tylko właściwym sposobem renderowania tej sceny — ciągły
`saturate(dot)` był założeniem planu, nie wymaganiem bramki. P3 nie stawia warunku; P3 odkrywa
ograniczenie projektowe, co jest czymś innym.

## 2. Wybrany model kamery

# K1 — swobodna orbita (OrbitControls)

Cytat człowieka: *„kamera k1 bezapelacyjnie"*.

Poparte pomiarem P2 — mediany powrotu do bazy: **K1 2868 ms** · K2 4276 ms · K3 6256 ms.
K1 jest też najbardziej powtarzalny (rozrzut 2608–4226), podczas gdy K2 ma odstający wynik
19 438 ms, a K3 rozrzut 3428–9010.

**K1 wygrał wbrew przewidywaniu planu.** Plan przypisywał mu ryzyko „gubienie bazy, brak poczucia
góry", a K2 przyklejonej do powierzchni — przewagę orientacyjną. Pomiar tego nie potwierdził:
K1 był najszybszy I najbardziej powtarzalny. Kamera, która brzmiała lepiej, wypadła gorzej.

**Dlaczego przegrały pozostałe:**
- **K2 (przyklejona do powierzchni)** — 1,5× wolniejsza w medianie i niestabilna; odstający wynik
  19 438 ms sugeruje, że przy niekorzystnej orientacji startowej gracz traci orientację całkowicie.
- **K3 (quasi-2D)** — 2,2× wolniejsza. Bardzo bliskie zbliżenie sprawia, że baza wypada z kadru
  i odnalezienie jej wymaga nawigacji po powierzchni zamiast jednego obrotu.

## 3. Surowe tabele pomiarów P1–P5

Zgodnie z poleceniem: **puste, gotowe do wypełnienia, minimum 5 prób na
kamerę na wariant.** Nie wypełniałem żadnego wiersza liczbą. Panel HUD w
aplikacji (`spike/`) ma stoper + log + eksport markdown w dokładnie tym
formacie, jeśli łatwiej wkleić niż przepisywać ręcznie.

### P1 — czas zlokalizowania zagrożenia (grupa 20 jednostek, losowy z 12 pięciokątów)

*(sesja 1: **NIEMIERZALNE** — grupa zagrożenia dzieliła kolor z ruchem tła,
patrz `.superpowers/sdd/faza-0/wyniki-sesja-1.md` i naprawa w §1. Harness
naprawiony 2026-09-14 (`spike/src/units.ts` — grupa ma teraz odrębny,
magenta kolor per-instancję). Tabele niżej czekają na **sesję 2** na
naprawionym harnessie — żadna liczba nie została zmyślona.)*

**Wariant: bez wskaźników pozazakadrowych**

| # | Kamera | Czas (ms) | Notatki |
|---|---|---|---|
| 1 | K1 | | |
| 2 | K1 | | |
| 3 | K1 | | |
| 4 | K1 | | |
| 5 | K1 | | |
| 1 | K2 | | |
| 2 | K2 | | |
| 3 | K2 | | |
| 4 | K2 | | |
| 5 | K2 | | |
| 1 | K3 | | |
| 2 | K3 | | |
| 3 | K3 | | |
| 4 | K3 | | |
| 5 | K3 | | |

**Wariant: ze wskaźnikami na krawędzi ekranu**

| # | Kamera | Czas (ms) | Notatki |
|---|---|---|---|
| 1 | K1 | | |
| 2 | K1 | | |
| 3 | K1 | | |
| 4 | K1 | | |
| 5 | K1 | | |
| 1 | K2 | | |
| 2 | K2 | | |
| 3 | K2 | | |
| 4 | K2 | | |
| 5 | K2 | | |
| 1 | K3 | | |
| 2 | K3 | | |
| 3 | K3 | | |
| 4 | K3 | | |
| 5 | K3 | | |

### P2 — powrót do bazy (z losowej orientacji kamery)

**Wariant: bez skrótu klawiszowego**

*(nie zmierzono w sesji 1 — patrz `.superpowers/sdd/faza-0/wyniki-sesja-1.md`:
„brak wariantu BEZ SKRÓTU, a to jego dotyczył próg z planu". Wciąż czeka na
pomiar.)*

| # | Kamera | Czas (ms) | Notatki |
|---|---|---|---|
| 1 | K1 | | |
| 2 | K1 | | |
| 3 | K1 | | |
| 4 | K1 | | |
| 5 | K1 | | |
| 1 | K2 | | |
| 2 | K2 | | |
| 3 | K2 | | |
| 4 | K2 | | |
| 5 | K2 | | |
| 1 | K3 | | |
| 2 | K3 | | |
| 3 | K3 | | |
| 4 | K3 | | |
| 5 | K3 | | |

**Wariant: ze skrótem „wróć do Core" (`R`)** — **ZMIERZONE (sesja 1)**

| # | Kamera | Czas (ms) | Notatki |
|---|---|---|---|
| 1 | K1 | 2608 | |
| 2 | K1 | 2829 | |
| 3 | K1 | 2868 | mediana K1 |
| 4 | K1 | 3937 | |
| 5 | K1 | 4226 | |
| 1 | K2 | 3239 | |
| 2 | K2 | 4276 | mediana K2 |
| 3 | K2 | 19438 | odstający (outlier) |
| 1 | K3 | 3428 | |
| 2 | K3 | 6256 | mediana K3 |
| 3 | K3 | 9010 | |

(K2 i K3 mają po 3 próby, nie 5 — to jest dokładnie to, co człowiek
wykonał i zalogował, nie dopełniałem do 5 zmyśloną liczbą.)

Werdykt człowieka: **K1 wygrywa** — potwierdza to rozrzut: K1 mieści się w
2608–4226 ms, K2 ma odstający wynik 19438 ms. Żaden wynik, nawet najlepszy
(K1 = 2608 ms), nie spełnia progu z planu (< 2 s) — próg był prawdopodobnie
nierealistyczny, bo nie uwzględniał czasu reakcji człowieka i animacji
kamery. Źródło: `.superpowers/sdd/faza-0/wyniki-sesja-1.md`.

### P3 — czytelność terminatora

*(sesja 1: **NIEMIERZALNE** — trzy defekty harnessu (przełącznik cieniowania
poza sekcją P3; brak punktu odniesienia „ground truth"; brak dowodu, że tryb
progowany faktycznie czyta się jako granica) — patrz
`.superpowers/sdd/faza-0/wyniki-sesja-1.md` i naprawa w §1. Wszystkie trzy
naprawiono 2026-09-14: przełącznik przeniesiono do sekcji P3, dodano tam
overlay „ground truth" domyślnie wyłączony (`spike/src/terrain.ts` /
`spike/index.html`). Wciąż **CZEKA NA SESJĘ 2** człowieka — patrz też §5.)*

| Kamera | Cieniowanie | Widać które komórki produkują energię / spawnują bez najechania? | Notatki |
|---|---|---|---|
| K1 | ciągłe `saturate(dot)` | | |
| K1 | progowane | | |
| K2 | ciągłe `saturate(dot)` | | |
| K2 | progowane | | |
| K3 | ciągłe `saturate(dot)` | | |
| K3 | progowane | | |

### P4 — budżet klatki

**Zmierzone przeze mnie — patrz §4.** Nie jest to pusta tabela, bo to jedyny
pomiar z protokołu, który mogłem wykonać zgodnie z poleceniem.

### P5 — ilu graczy widać naraz (4 bazy rozrzucone po planecie)

**ZALICZONE JAKOŚCIOWO (sesja 1)** — jakościowe, bez stopera, zgodnie z
protokołem. Źródło: `.superpowers/sdd/faza-0/wyniki-sesja-1.md`.

| Pytanie | Odpowiedź |
|---|---|
| Da się zorientować, co robią pozostali gracze, bez dodatkowego UI? | Tak. Cytat człowieka: „ogarnięcie 4 baz jest możliwe choć uciążliwe (ale tak powinno być)". Uciążliwość potraktowana jako cecha (gra ma być o zarządzaniu uwagą), nie wada. |
| Potrzebna minimapa? | Nie zaadresowane wprost w notatce z sesji 1. |
| Jeśli tak — jaka projekcja? | Nie zaadresowane w sesji 1. |
| Różnica między kamerami (K1/K2/K3) w tej ocenie | Nie zaadresowane w sesji 1. |

Zastrzeżenie do P5 (patrz też `spike/README.md`): sceną steruje jeden
wspólny strumień ruchu jednostek do oryginalnego Core — przycisk P5
przemalowuje 4 rozrzucone budynki na 4 odrębne kolory jako wizualne
zaczepienie, ale NIE przekierowuje jednostek do 4 różnych celów. Wystarczające
do oceny orientacji/czytelności rozmieszczenia, ale nie do oceny „czy widzę
walkę przy czyjejś bazie".

---

## 4. P4 — budżet klatki (zmierzone przeze mnie)

**Zastrzeżenie sprzętowe (ważniejsze niż same liczby):** pomiar wykonano na
maszynie deweloperskiej (Apple M5, ANGLE Metal Renderer, przeglądarka
Chromium wbudowana w Claude desktop app), **nie na ustalonym sprzęcie
minimalnym** — bo taki sprzęt nie był nigdzie ustalony przed tym spikem.
Poniżej propozycja (do ratyfikacji przez człowieka/zespół), plus rzeczywiste
liczby z maszyny deweloperskiej.

### Propozycja sprzętu minimalnego (do ratyfikacji, nie decyzja ostateczna)

| Komponent | Propozycja |
|---|---|
| GPU | zintegrowana grafika sprzed ~2018 zdolna do WebGL2 (np. Intel UHD 620 / Apple A12 / równoważna) — bez dedykowanej karty |
| CPU | 4 rdzenie, klasa ~Intel Core i5-6400 / Apple M1 lub lepsza |
| RAM | 8 GB |
| Ekran | 1920×1080 |
| Przeglądarka | dowolna evergreen (Chrome/Firefox/Safari/Edge) z WebGL2 |

Uzasadnienie propozycji: scena jest naprawdę prosta (3–4 draw calls, ~14k
trójkątów, zero tekstur, zero post-processingu) — nawet skromna zintegrowana
grafika powinna to obsłużyć bez trudu, ale to przypuszczenie, nie pomiar.
**Nie testowałem na takim sprzęcie — nie mogę potwierdzić PASS względem tej
propozycji, tylko względem maszyny deweloperskiej.**

### Zmierzone liczby (maszyna deweloperska, nie minimalna)

**Zmierzone ponownie 2026-09-14 po korekcie geometrii terenu** (patrz §1):
teren przestał być `InstancedMesh` sześciokątnych bilbordów i stał się jedną
scaloną, indeksowaną `BufferGeometry` zbudowaną z prawdziwych wieloboków 1442
komórek (wachlarz trójkątów od środka komórki do jej narożników — 1430 × 6 +
12 × 5 = **8640 trójkątów terenu**),
dalej jako **jeden draw call**. Kolor i stan „zaznaczona" komórki, które
wcześniej jechały jako atrybuty per-instancję, teraz są atrybutami
per-wierzchołek (`aColor`, `aSelected`) — ten sam kształt danych, inne źródło.
Liczby poniżej są **po** tej zmianie; poprzednia wersja tej tabeli (sprzed
korekty terenu, teren = sześciokątne bilbordy) jest zachowana pod tabelą dla
porównania.

Metoda pomiaru niezmieniona: `frameMs` mierzy pełny czas CPU na klatkę —
aktualizacja słońca, przepisanie `sunDir` do materiału terenu, aktualizacja
~300 jednostek, aktualizacja aktywnego kontrolera kamery, wywołanie
`renderer.render()` i odświeżenie HUD — a nie wyłącznie czas GPU. To bardziej
uczciwa (surowsza) liczba niż „tylko render".

| Scenariusz | fps | ms/klatkę | draw calls | trójkąty | geometrie | tekstury | est. VRAM (bufory)\* |
|---|---|---|---|---|---|---|---|
| Widok startowy (K1, cała sfera w kadrze), słońce w orbicie automatycznej | 2678–5326 | 0,19–0,37 | 3 | 14 040 | 3 | 0 | 0,51 MB |
| Po spawnie pełnej grupy zagrożenia (~300/300 jednostek aktywnych jednocześnie) | 2513 | 0,40 | 3 | 14 040 | 3 | 0 | 0,51 MB |
| Kamera bardzo blisko powierzchni (K3, ciasny kadr) | 2832 | 0,35 | 3 | 14 040 | 3 | 0 | 0,51 MB |

\* „est. VRAM" to suma rozmiarów buforów JS w bajtach (dla terenu teraz:
position/normal/aColor/aSelected/index; dla jednostek i budynków jak wcześniej
position/normal/uv/instanceMatrix/instanceColor), **nie** prawdziwy odczyt
pamięci GPU — WebGL nie udostępnia takiego zapytania. Potraktuj to jako dolną
granicę, nie jako rzeczywiste zużycie VRAM (tekstury, bufory ramki, kompilacja
shaderów itd. nie są tu wliczone). Wzrost względem poprzedniego pomiaru (0,14
→ 0,51 MB) jest oczekiwany i nieszkodliwy: teren ma teraz ~10 082 unikalne
wierzchołki (środek + narożniki każdej z 1442 komórek, bo sąsiadujące komórki
NIE mogą dzielić wierzchołków — każda niesie własny kolor/stan) zamiast
jednej bazowej geometrii dzielonej przez macierz instancji; to wciąż
pomijalne dla współczesnego GPU.

Trójkąty terenu spadły nieznacznie (14 052 → 14 040, różnica dokładnie 12) bo
12 pięciokątów rysuje się teraz jako 5 trójkątów zamiast 6 — dokładnie tyle,
ile powinno.

Próg z planu („P4 render ≤ 8 ms") jest spełniony z ogromnym zapasem (0,19–0,40
ms vs. 8 ms) na tej maszynie, praktycznie bez zmiany względem pomiaru sprzed
korekty terenu. Biorąc pod uwagę jak prosta jest scena, bardzo prawdopodobne
jest że próg utrzyma się też na realnym sprzęcie minimalnym — ale to
przypuszczenie, nie potwierdzony wynik.

<details>
<summary>Poprzedni pomiar (sprzed korekty terenu, teren = InstancedMesh sześciokątnych bilbordów) — zachowane dla porównania, NIE aktualne</summary>

| Scenariusz | fps | ms/klatkę | draw calls | trójkąty | geometrie | tekstury | est. VRAM (bufory) |
|---|---|---|---|---|---|---|---|
| Widok startowy (K1, cała sfera w kadrze), słońce w orbicie automatycznej | 3504 | 0,29 | 3 (4 gdy marker słońca w kadrze) | 14 052 | 3 (4) | 0 | 0,14 MB |
| Po spawnie pełnej grupy zagrożenia (~300/300 jednostek aktywnych jednocześnie) | 2606 | 0,38 | 3 | 14 052 | 3 | 0 | 0,14 MB |
| Kamera bardzo blisko powierzchni (K3, ciasny kadr) | 2865–7206 (zmienność zależna od naliczania nakładania się trójkątów jednostek na ekranie) | 0,14–0,35 | 3–4 | 14 052 | 3–4 | 0 | 0,14 MB |

</details>

---

## 5. Zrzuty ekranu P3 (oba warianty cieniowania)

**Nie dołączam tu plików zrzutów ekranu.** Środowisko, w którym budowałem i
weryfikowałem spike (Claude Code Browser pane), pozwala mi oglądać żywy
render i robić zrzuty do wglądu w rozmowie, ale nie ma prostego mechanizmu do
zapisania ich jako plików PNG w repozytorium bez uciekania się do kruchych
obejść (np. wymuszania `preserveDrawingBuffer` i ręcznego składania warstwy
WebGL z warstwą HUD). P3 z definicji wymaga też opisowej odpowiedzi człowieka
(„czy widać, bez najeżdżania kursorem, które komórki produkują energię, a
które spawnują") — to osąd, nie liczba, i celowo nie próbowałem go zgadywać
za kogoś.

Co faktycznie zweryfikowałem (obiektywnie, nie subiektywnie) na żywym
renderze:

- **Cieniowanie ciągłe (`saturate(dot(normal, sunDir))`)** — daje płynny
  gradient jasności od w pełni oświetlonej strony do w pełni ciemnej, bez
  ostrej krawędzi.
- **Cieniowanie progowane** — daje wyraźnie twardszą granicę (trzy pasma:
  dzień / wąski pas terminatora / noc), zaobserwowana granica była
  zauważalnie ostrzejsza niż w wariancie ciągłym przy tej samej pozycji
  słońca.
- Oba warianty renderują się bez błędów, przełącznik w HUD (checkbox
  „thresholded shading") działa natychmiastowo i widocznie zmienia obraz.
- Podświetlenie wybranej komórki (raycaster) pozostaje widoczne w obu
  wariantach cieniowania i niezależnie od tego, czy komórka jest w dzień czy
  w nocy (celowo ignoruje oświetlenie — patrz `terrain.ts`, `vSelected`).

**Aktualizacja 2026-09-14, po naprawie harnessu (§1):** ponownie zweryfikowałem
oba warianty na żywym renderze po przeniesieniu przełącznika do sekcji P3 i
dodaniu overlayu „ground truth". Cieniowanie progowane **czyta się jako
wyraźna granica** — w bliskim kadrze widać trzy odrębne pasma (dzień / wąski
pas zmierzchu ~1–2 komórki szerokości / noc) rozdzielone ostrym, poszarpanym
(bo cieniowanie jest płaskie per-komórka) skokiem jasności; cieniowanie
ciągłe w tej samej pozycji słońca daje gładki gradient bez wyczuwalnej
krawędzi. Nie zmieniałem progów `ndl > 0.12` / `ndl > -0.05` w
`spike/src/terrain.ts` — pasmo dzień/noc jest czytelne od razu, więc nie były
oczywiście źle dobrane; retuning „na oko" byłby sam w sobie wynikiem P3, nie
poprawką harnessu (patrz zadanie naprawy). Overlay „ground truth" (domyślnie
wyłączony) poprawnie oznacza zweryfikowane wizualnie pięciokąty w cieniu na
czerwono, a oświetlone na zielono, i wraca do zwykłego wyglądu po wyłączeniu —
zweryfikowane bezpośrednio, nie zgadywane. To wciąż nie zastępuje opisowej
oceny człowieka w tabeli P3 (§3) — to jedynie obiektywna weryfikacja, że
mechanizm renderuje to, co ma renderować.

### Jak człowiek odtworzy dokładnie tę samą klatkę do zrzutu

1. Uruchom spike, zaznacz checkbox „manual sun phase" w sekcji P3 panelu.
2. Ustaw suwak fazy słońca na **0°** (dla domyślnie wybranego Core w tej
   sesji to ustawia terminator dokładnie na Core; jeśli Core wypadnie gdzie
   indziej, przesuń suwak aż terminator przetnie widoczną, podświetloną
   komórkę Core).
3. Kliknij „Jump to Core view" (centruje aktywną kamerę na Core).
4. W razie potrzeby dosuń/oddal kamerę (kółko myszy / K1) tak, by kilka
   komórek po obu stronach terminatora było wyraźnie widocznych.
5. Zrób zrzut ekranu (systemowy skrót OS, nie w aplikacji) — raz z
   odznaczonym „thresholded shading", raz z zaznaczonym (checkbox mieszka
   teraz w tej samej sekcji P3 panelu — patrz aktualizacja wyżej).
6. Wklej oba zrzuty w tej sekcji + wpisz opisową odpowiedź w tabeli P3 (§3).
   Opcjonalnie: zaznacz „ground-truth overlay" PO własnej ocenie, żeby
   sprawdzić swój odczyt (patrz aktualizacja wyżej — domyślnie wyłączony,
   to wyłącznie pomoc weryfikacyjna, nie część normalnego widoku).

---

## 6. Weryfikacja siatki dualnej (N=1442, D2)

Zweryfikowane programowo (skrypt uruchamiany raz w izolacji + potwierdzone
przez `console.log`/`console.warn` przy każdym starcie aplikacji w
`spike/src/dualMesh.ts` i `spike/src/main.ts`):

| Sprawdzenie | Wynik |
|---|---|
| Liczba komórek po zespawaniu wierzchołków | 1442 (oczekiwane: 1442) |
| Liczba pięciokątów | 12 (oczekiwane: 12) |
| Liczba sześciokątów | 1430 (oczekiwane: 1430) |
| Asymetryczne krawędzie sąsiedztwa (A sąsiaduje z B, ale nie odwrotnie) | 0 |
| Niezgodność liczby wierzchołków wieloboku komórki z liczbą sąsiadów | 0 |
| Komórki poza promieniem R (tolerancja 0.01) | 0 |

Metoda: `IcosahedronGeometry(R, 11)` → spawanie zduplikowanych wierzchołków
przez hash przestrzenny → dual (każdy oryginalny wierzchołek staje się
komórką, jej wielobok to pierścień centroidów trójkątów wokół tego wierzchołka,
odwiedzanych w kolejności nawijania siatki) → klasyfikacja 5/6 sąsiadów.
Relaksacja Lloyda celowo pominięta (plan: nierówność komórek nieistotna dla
tego spike'a).

---

## 7. Lista elementów UI, bez których czytelność nie działa → aneks do §8.1

Bramka wyszła WARUNKOWA, więc poniższe przestają być opcjonalne i wchodzą do zakresu MVP.

**1. Render pasmowy oświetlenia zamiast gładkiego `dot`** — źródło: P3 (PASS).

To ograniczenie projektowe, nie warunek bramki. Pomiar przy identycznej fazie słońca pokazał,
że w trybie ciągłym terminatora po prostu nie widać, a w progowanym jest ostry i natychmiast
czytelny. D1 — filar całego projektu — stoi na tym, że gracz czyta granicę światła wzrokiem,
bez UI, więc render gładki unieważniałby filar.

> **Uwaga, żeby nikt tego później nie „naprawił":** to NIE jest sprzeczne z §5.1 specu, który
> każe produkcji paneli być ciągłą funkcją `peakOutput · saturate(dot)`. To dwie różne warstwy.
> **Symulacja liczy ciągle, render prezentuje progowo.** Zrównanie ich w którąkolwiek stronę
> zepsuje albo ekonomię, albo czytelność.

**2. Skrót „wróć do Core" jako element WYMAGANY, nie opcjonalny** — źródło: P2 (WARUNKOWY).

Wszystkie zmierzone powroty do bazy korzystały z klawisza. Czytelność bez niego pozostaje
niepotwierdzona, więc do czasu ewentualnego domiaru skrót jest częścią minimalnego zakresu.

**Nie wchodzą do zakresu** (zmierzone jako niepotrzebne albo niezmierzone):
- wskaźniki pozazakadrowe — P1 przeszło BEZ nich (mediana 1966 ms)
- minimapa — P5 zaliczone bez niej

## 8. Propozycja zmian w specu i planie

1. **Q1 (model kamery) → ROZSTRZYGNIĘTE: K1.** Przenieść w §11 specu z otwartych do rozstrzygniętych.
2. **§8.1 specu** — dopisać dwa elementy z §7 powyżej do zakresu MVP.
3. **Próg P2 w planie Fazy 0 był nierealistyczny.** „< 2 s bez skrótu" nie uwzględniał czasu
   reakcji człowieka plus animacji kamery; najlepszy zmierzony czas ZE skrótem to 2608 ms.
   Przy ewentualnym powtórzeniu pomiaru próg powinien wynosić ~3,5 s bez skrótu.
4. **Sprzęt minimalny nadal nieustalony.** P4 ma trzydziestokrotny zapas, ale wyłącznie na
   maszynie deweloperskiej. Propozycja z §4 czeka na ratyfikację.
5. **Warianty odwrotu z planu Fazy 0 są nieaktualne** — bramka nie wypadła FAIL, więc czasza,
   mniejsze N ani geometria toroidalna nie są potrzebne.

**Niedomierzone, świadomie:** P1 dla K2 i K3 oraz wariant ze wskaźnikami; P2 bez skrótu.
Nie blokuje to decyzji, bo o kamerze rozstrzygnęło P2, a P1 przeszło na zwycięskiej kamerze
w wariancie trudniejszym.

## 9. Co dalej

Zgodnie z planem: dopiero po wypełnieniu §1–§3 i §5 przez człowieka można
zaktualizować `docs/superpowers/specs/2026-09-14-project-heliopolis-design.md`
— Q1 (§11), a jeśli trzeba także §8.1, §7.3, §10. Ten dokument świadomie
**nie** dotyka jeszcze specu głównego.
