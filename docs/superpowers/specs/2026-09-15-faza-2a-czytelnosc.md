# Zadanie 5 (Faza 2A) — Budżet klatki i bramka czytelności: wyniki

> **Status dokumentu: CZĘŚCIOWY — jak Faza 0.** Dwie liczby (budżet `writeCellColors` i
> budżet całej klatki renderu) są **zmierzone przeze mnie** i zapisane niżej dosłownie,
> bez zaokrągleń upiększających. **Werdykt bramki czytelności (§7) NIE jest rozstrzygnięty**
> — wymaga człowieka przy klawiaturze, zgodnie z §8.1 specu i z tym samym rozdzieleniem
> ról, które ustaliła Faza 0 (`docs/superpowers/specs/2026-09-14-faza-0-wyniki.md`): ja
> buduję instrument i dowodzę, że działa; człowiek go używa i wydaje osąd. Nie zgaduję
> tego osądu za nikogo — tabela w §7 jest celowo pusta.

Data sporządzenia: 2026-09-15. Autor: Claude Opus 5 (agent), zgodnie z
`.superpowers/sdd/2026-09-15-faza-2a-swiat-na-ekranie/task-5-brief.md` i
`global-constraints.md` w tym samym katalogu.

---

## 0. Metadane pomiaru

| Pozycja | Wartość |
|---|---|
| Three.js (`packages/render/package.json` / rozwiązane) | `^0.186.0` / **0.186.0** |
| `@types/three` | `0.186.0` (osobny pakiet typów, zgodnie z briefem) |
| Vite | 7.3.6 |
| TypeScript | 7.0.2 |
| Node.js | **v22.22.0** |
| `N` (liczba komórek) | **1442** (`frequency: 12` domyślne) — zweryfikowane programowo (`budget.test.ts`, asercja wprost) |
| Seed planety użyty we wszystkich pomiarach i w harnessie | `20260915` — ten sam co w Zadaniach 2–4, żeby liczby tego dokumentu mówiły o TEJ SAMEJ planecie, nie o innej |

**Maszyna, na której wykonano WSZYSTKIE pomiary poniżej** (§2 i §3):
Apple M5, macOS 26.6.2 (build 25G83), 10 rdzeni CPU, 32 GB RAM. **To NIE jest sprzęt
minimalny** — sprzęt minimalny pozostaje nieustalony (patrz `global-constraints.md`,
propozycja czeka na ratyfikację przez właściciela projektu od czasu Fazy 0). To jest,
naskutek, ta sama fizyczna maszyna, na której Faza 0 zmierzyła 0,29–0,31 ms dla pełnej
sceny spike'a.

- **§2 (`writeCellColors`, część czysta)** zmierzone bezpośrednio w Node (`vitest run`,
  ten sam proces co `pnpm test`) — brak przeglądarki, brak GPU, zgodnie z briefem
  ("to jedyna część, którą da się zmierzyć bez GPU").
- **§3 (cała klatka renderu)** zmierzone w PRZEGLĄDARCE — konkretnie w Chromium
  wbudowanym w Browser pane Claude Code (ten sam silnik renderujący co realny Chrome,
  ale osadzony w tym narzędziu, nie w oddzielnie zainstalowanej przeglądarce
  deweloperskiej) — WebGL2 aktywny, aplikacja serwowana przez `pnpm --filter
  @heliopolis/client dev` pod `http://localhost:5180/`. To jest bliższe temu, co
  faktycznie zobaczy gracz, niż pomiar w Node — ale to WCIĄŻ nie jest sprzęt minimalny,
  ani nawet koniecznie identyczna konfiguracja GPU/sterowników co osobno zainstalowana
  przeglądarka na tej samej maszynie.

---

## 1. Wynik: co jest rozstrzygnięte, co czeka na człowieka

| Pozycja | Status |
|---|---|
| Budżet `writeCellColors` (1442 komórki × 1000 wywołań, mediana < 1 ms) | **PASS, zmierzone** — §2 |
| Budżet całej klatki renderu (cel: ≤ 8 ms) | **PASS, zmierzone, z ogromnym zapasem** — §3 |
| Bramka czytelności terminatora (§8.1 specu, piętnaście osądów) | **PASS — 15/15** (§7.3) — ale z korektą §7.3.1: kontrola pozytywna okazała się wadliwa, więc werdykt obowiązuje w zawężonym zakresie (§7.3.2). Harness zbudowany, przetestowany automatycznie (61 nowych testów) i zweryfikowany na żywym renderze przeze mnie (§6) — ale **werdykt PASS/FAIL nie jest mój do wydania** |

---

## 2. Budżet `writeCellColors` — część czysta (Krok 1 briefu)

**Protokół:** 1442 komórki (`createPlanet({ seed: 20260915 })`, `frequency` domyślne),
`light` z prawdziwego `lightField(planet, sunDirection(0, 180))`, 50 wywołań rozgrzewki
(nieliczone), potem **1000 mierzonych wywołań** `writeCellColors`, każde otoczone
`performance.now()`. Mediana (nie średnia) — odporna na pojedynczy odstający pomiar.
Próg z briefu: **mediana < 1 ms**.

Kod: `packages/render/test/budget.test.ts`.

**Zmierzone (cztery przebiegi pod rząd, ta sama maszyna, ten sam proces `vitest run`):**

| Przebieg | Mediana (ms) | p95 (ms) |
|---|---|---|
| 1 | 0,0220 | 0,0223 |
| 2 | 0,0218 | 0,0243 |
| 3 | 0,0217 | 0,0242 |
| 4 | 0,0223 | 0,0228 |

Mediana konsekwentnie **0,0217–0,0223 ms** — **ok. 45× poniżej progu 1 ms**, na maszynie
deweloperskiej opisanej w §0. Zapas jest na tyle duży, że nawet sprzęt rząd wielkości
wolniejszy nie zbliżyłby się do progu — ale to, jak zawsze w tym dokumencie, twierdzenie
o TEJ maszynie, nie o sprzęcie minimalnym (wciąż nieustalonym).

---

## 3. Budżet całej klatki renderu — w przeglądarce (Krok 2–3 briefu)

**Mechanizm** (`apps/client/src/main.ts`): każda klatka pętli `requestAnimationFrame`
mierzy `performance.now()` na wejściu i na wyjściu z ciała `tick()` — a więc
aktualizację `sunDirection`/`lightField`, aktualizację kamery (bezwładność orbity K1),
przepisanie kolorów komórek (`scene.render`) i sam `renderer.render()`. To jest ta sama
definicja "czasu klatki", jakiej użyła Faza 0 w P4 ("pełny czas CPU na klatkę... a nie
wyłącznie czas GPU").

Ostatnie 1000 próbek trzyma bufor kołowy bez alokacji (`createRollingWindow`,
`packages/render/src/frameStats.ts`). Licznik na ekranie (mediana/p95, uaktualniany co
10 klatek) jest widoczny cały czas; **po pierwszych 1000 klatkach aplikacja wypisuje do
konsoli jedną migawkę**, tagowaną `[BUDGET]` (ten sam tag co w `budget.test.ts`, żeby
"budżet" w obu miejscach znaczyło jedną liczbę policzoną tą samą arytmetyką — `median`/
`percentile` z `frameStats.ts` są dzielone między testem Node a tym licznikiem).

**Zmierzone na żywo** (Browser pane, `http://localhost:5180/`, zweryfikowane zrzutem
ekranu i odczytem konsoli, nie zgadywane):

```
[BUDGET] pierwsze 1000 klatek renderu: mediana=0,200 ms, p95=0,400 ms (budżet: 8 ms)
```

Licznik na ekranie kilka sekund później (okno kroczące dalej się przesuwa, więc liczba
naturalnie się zmienia w miarę napływu nowych próbek): mediana 0,100 ms, p95 0,300 ms
przy n=1000. Oba odczyty — **rząd wielkości 0,1–0,4 ms — mieszczą się z ogromnym
zapasem w budżecie 8 ms** (20–80×), i są tego samego rzędu co pomiar Fazy 0 na tej samej
klasie maszyny (0,29–0,31 ms na pełnej scenie spike'a, wtedy z ok. 300 jednostkami —
Faza 2A nie ma jeszcze jednostek/budynków, więc niższy wynik jest spójny z prostszą
sceną, nie sprzecznością pomiaru).

**To samo zastrzeżenie co w `global-constraints.md`:** to jest maszyna deweloperska
(Apple M5, opisana w §0), NIE sprzęt minimalny. Scena jest wciąż bardzo prosta (jeden
`Mesh` planety, dwa małe sprite'y znaczników w harnessie bramki, zero tekstur poza samym
znacznikiem, zero post-processingu) — więc zapas jest wiarygodny, ale niepotwierdzony na
innym sprzęcie.

---

## 4. Dlaczego bramka bada JEDNĄ konkretną granicę, nie dowolną z trzech pasm

Paleta ma trzy pasma (`LIGHT_BANDS` w `shading.ts`): noc / terminator (zmierzch-świt) /
dzień. Przegląd Zadania 3 policzył odległości barwne między nimi:

| Para pasm | Δ odcienia | Kontrast WCAG |
|---|---|---|
| noc ↔ terminator | 155,9° | 5,60 |
| noc ↔ dzień | 178,3° | 16,24 |
| terminator ↔ dzień | **22,4°** | **2,90** |

Pierwsze dwie granice są mocno rozdzielone barwnie. **Granica terminator↔dzień jest
poniżej progu 3:1 przyjmowanego w UI** — to jest różnica czysto estetyczna (kandydatka
do strojenia w Fazie 4), **nie D1-owa**: D1 i kryterium §8.1 mówią o tym, czy komórka w
ogóle dostaje światło ("ta świeci, ta nie"), nie o tym, czy dostaje "trochę" czy "dużo".

> **Skorygowane.** Stało tu zdanie: „pasmo 0 to DOKŁADNIE `dot ≤ 0`, czyli zero światła".
> To nieprawda. Pasmo 0 to `light < LIGHT_BANDS[0]` (dziś 0,05), czyli noc **plus** wąski
> rąbek świtu, który symulacja już uznaje za oświetlony. Zmierzone w §4.1 niżej.

**Harness (`findTerminatorPairs`, `packages/render/src/terminatorPairs.ts`) dobiera pary
WYŁĄCZNIE na granicy pasmo-0-kontra-reszta (noc kontra półmrok-LUB-dzień), nigdy na
granicy półmrok↔dzień.** Bramka mierzy więc **granicę RENDEROWANEGO pasma — tę, którą
widzi oko.** To jest właściwa rzecz do mierzenia dla D1, bo D1 mówi dokładnie o tym, co
gracz czyta wzrokiem, bez UI. Ale **nie jest to ta sama linia, po której decyduje
symulacja** (`light[cellId] > 0`) — §4.1.

Konsekwencja dla interpretacji werdyktu w §7: **jeśli człowiek zgłosi trudność, ważne
jest ZAPISANIE, czy trudność dotyczyła "czy to jest w ogóle jasne czy ciemne"
(D1-krytyczne, poważny wynik) czy raczej "czy to jest już dzień czy jeszcze zmierzch"
(estetyczne, nie powinno wpływać na werdykt bramki — to pytanie, którego bramka celowo
NIE zadaje).**

### 4.1 Granica renderowana a granica symulowana — zmierzone, do decyzji właściciela

To nie jest błąd dokumentacji. Renderowana granica dnia i nocy oraz **symulowana**
granica dnia i nocy to **dwie różne linie**, a między nimi leży pas komórek, w których
symulacja i obraz mówią co innego:

- **Symulacja** pyta `light[cellId] > 0`, czyli `dot > 0`. Dosłownie tak, trzy razy:
  `spawning.ts:79` (pentagony tam **nie spawnują**), `burning.ts:37` (jednostki tam
  **płoną**), `movement.ts:170`. `power.ts` używa wartości ciągłej.
- **Render** pyta `light ≥ LIGHT_BANDS[0]`, dziś `0,05`.
- **Szczelina**: komórki z `0 < light < 0,05` — symulacja traktuje je jako **oświetlone**,
  gracz widzi **noc**.

Zmierzone na `createPlanet({ seed: 20260915 })`, 1442 komórki, dwanaście faz słońca
równomiernie po pełnym obrocie (`DEFAULT_RUN.rotationPeriod`):

| faza (t/okres) | noc (`light = 0`) | **szczelina** | render-dzień | głębokość szczeliny |
|---|---|---|---|---|
| 0/12 | 745 | **8** | 689 | 1 krok komórki |
| 1/12 | 722 | **29** | 691 | 1 |
| 2/12 | 722 | **38** | 682 | 1 |
| 3/12 | 722 | **31** | 689 | 1 |
| 4/12 | 722 | **38** | 682 | 1 |
| 5/12 | 722 | **29** | 691 | 1 |
| 6/12 | 722 | **31** | 689 | 1 |
| 7/12 | 722 | **29** | 691 | 1 |
| 8/12 | 722 | **38** | 682 | 1 |
| 9/12 | 722 | **31** | 689 | 1 |
| 10/12 | 722 | **38** | 682 | 1 |
| 11/12 | 722 | **29** | 691 | 1 |

- **Ile komórek: 8 do 38**, średnio 30,8 na fazę. Liczba 8 (cytowana w §7.3.1 i w
  przeglądzie) to **przypadek szczególny fazy 0/12**, gdzie orientacja siatki geodezyjnej
  wyjątkowo dobrze trafia w granicę — nie liczba typowa. Udział: **4,28%** wszystkich
  komórek, które symulacja uznaje za oświetlone.
- **Jak szeroki pas: 1 krok komórki, w KAŻDEJ z dwunastu faz.** Mierzone jako odległość
  grafowa (BFS po sąsiedztwie) od najbliższej komórki prawdziwie ciemnej: maksimum 1,
  średnia dokładnie 1,00, najgrubsze przejście z nocy do renderowanego dnia — 1 komórka.
  Szczelina jest więc **jedną warstwą komórek** wokół terminatora, nigdy pasem.
- **Dlaczego tak wąski:** szczelina `dot ∈ (0; 0,05)` obejmuje **2,87°** kąta, a średni
  krok kątowy do sąsiada przy `frequency 12` wynosi **5,74°** — czyli **0,50 kroku
  komórki**. Pas jest z natury węższy niż jedna komórka; łapie tylko te, które akurat
  wpadły w niego środkiem.
- **Bramka:** w **6 z 15** zapisanych prób (§7.2) komórka oznaczona jako „ciemna" jest dla
  symulacji **oświetlona**: próby 2 (komórka 191, light 0,0458), 6 (211, 0,0052),
  7 (264, 0,0400), 11 (3, 0,0146), 13 (1228, 0,0105), 15 (1034, 0,0058). Werdykt PASS
  pozostaje prawdziwy jako orzeczenie o **granicy widzianej** — człowiek trafił za każdym
  razem — ale nie jest orzeczeniem o granicy symulowanej.

**Znaczenie dla rozgrywki, nie dla testów.** W pasie do 38 komórek gracz widzi noc, a
symulacja liczy dzień: pentagony tam nie spawnują, jednostki tam płoną, panele tam
produkują (choć poniżej 5% mocy szczytowej, więc energetycznie to szum — inaczej niż
spawnowanie i palenie, które są zero-jedynkowe).

**`LIGHT_BANDS` NIE zostało zmienione** — to stała `[WYGLĄD]`, a decyzja należy do
właściciela projektu. Kierunek jest jednak jednoznaczny: im niższy pierwszy próg, tym
bliżej obie linie. Próg `0,05` daje szczelinę 0,50 kroku komórki; przy progu `0` obie
linie pokrywałyby się dokładnie, kosztem tego, że komórka o `light = 0,001` dostałaby
barwę półmroku.

---

## 5. Harness bramki czytelności — projekt

Kod: `packages/render/src/terminatorPairs.ts` (dobór par, czyste funkcje),
`packages/render/src/readabilityGate.ts` (scena, znaczniki, klik, tryb kontrolny),
`packages/render/src/shading.ts` (`writeCellColorsSmooth`, kontrola pozytywna),
`apps/client/gate.html` + `apps/client/src/gate.ts` (strona, którą uruchamia człowiek).

### 5.1 Protokół

- **Piętnaście prób = 3 fazy słońca × 5 par.** Fazy: `sunDirection(0,180)`,
  `sunDirection(60,180)`, `sunDirection(120,180)` — trzy równomiernie rozłożone punkty
  pełnego obrotu (`DEFAULT_RUN.rotationPeriod = 180 s`), z PRAWDZIWYM `lightField` tej
  samej planety (`seed: 20260915`), co widzi normalny widok (`main.ts`).
- Dla każdej fazy `findTerminatorPairs` przeszukuje WSZYSTKICH sąsiadów wszystkich 1442
  komórek i zwraca każdą parę, w której jedna strona ma pasmo 0, druga pasmo ≥ 1
  (§4). Zmierzone (nie zgadywane) liczby genuinie znalezionych par na tych trzech
  fazach: **142, 143, 143** — więcej niż potrzeba (5), więc `selectSpreadPairs` (dobór
  równomiernie rozłożonych indeksów, deterministyczny) zawsze ma z czego wybierać.
- **Co dokładnie znaczy tu "ciemna".** Pasmo 0 to `light < LIGHT_BANDS[0]` = 0,05, czyli
  **komórka renderowana jako noc** — nie „komórka, której symulacja nie oświetla".
  Zmierzone (§4.1): w **6 z 15** prób komórka oznaczona jako ciemna ma `light > 0`, więc
  symulacja traktuje ją jako oświetloną. Bramka bada granicę, którą WIDZI OKO, i to jest
  właściwa rzecz dla D1 — ale czytając wynik trzeba wiedzieć, że to nie jest orzeczenie o
  granicy `dot ≤ 0`.
- Ten sam plan prób (te same 15 par, w tej samej kolejności) wychodzi za KAŻDYM
  uruchomieniem `gate.html` — dobór jest deterministyczny, nie losowy. Zamierzone:
  powtórna sesja człowieka (jak sesja 2 w Fazie 0) patrzy na te same pary, nie na nowy,
  nieporównywalny zestaw.

### 5.2 Jak znacznik NIE zdradza odpowiedzi

To jest najbardziej newralgiczna część projektu — patrz ostrzeżenie w briefie. Rozwiązanie:

1. **Oba znaczniki to ten sam obiekt geometrii/materiału źródłowego** (`Sprite` +
   `SpriteMaterial` skonstruowane przez tę samą funkcję, `createMarkerSprite`), różniące
   się WYŁĄCZNIE pozycją w świecie. Zweryfikowane testem (`readabilityGate.test.ts`,
   testy 4–6): identyczna barwa materiału, identyczna referencja tekstury, identyczny
   rozmiar — dopóki para nie jest odsłonięta.
2. **Tekstura jest celowo dwutonowa**: biały wypełniony okrąg z czarnym obrysem, na
   przezroczystym tle (`createMarkerTexture`). Biały środek wybija się na ciemnym tle
   nocy; czarny obrys wybija się na jasnym tle dnia/terminatora. Gdyby znacznik był
   jednym jednolitym kolorem (np. sam biały), byłby SAM w sobie bardziej widoczny po
   jednej stronie terminatora niż po drugiej — czyli mierzyłby własną widoczność, nie
   granicę planety. Dwutonowość jest odpowiedzią wprost na to ryzyko.
3. **Znacznik to `Sprite` (billboard), nie siatka leżąca na powierzchni.** Zawsze
   zwrócony wprost do kamery — człowiek widzi ten sam, niezniekształcony obrazek
   niezależnie od kąta orbity K1. Płaski znacznik zorientowany wg normalnej komórki,
   oglądany pod kątem stycznym, ścieńczałby do kreski w sposób zależny od kąta patrzenia
   — dokładnie tego rodzaju artefaktu unika billboard.
4. **Znacznik jest uniesiony nad powierzchnią** wzdłuż normalnej komórki (`markerPosition`,
   promień × 0,03 — [WYGLĄD]), NIE leży dokładnie na niej. Dwa konkretne powody: (a)
   płaski billboard styczny do kuli, dokładnie na jej powierzchni, częściowo zapadałby
   się pod krzywiznę sfery na krawędziach — z-fighting z terenem zależny od kąta
   patrzenia; uniesienie usuwa to całkowicie; (b) znacznik nie styka się wtedy fizycznie
   z barwną powierzchnią komórki (choć wypełnienie jest w pełni nieprzezroczyste, więc
   to ryzyko było już zamknięte wyborem materiału — to dodatkowa, tania rezerwa).
5. **Odpowiedź to wymuszony wybór dwuwartościowy (2AFC)**: klik na TEN znacznik, który
   wygląda na leżący na oświetlonej komórce — nie samo-ocena "widzę granicę / nie
   widzę". To zamienia subiektywne wrażenie w zero-jedynkowy wynik per próba,
   weryfikowalny wprost przeciw `lightField`, i zmniejsza ryzyko obciążenia typu "chcę,
   żeby wyszło PASS": piętnaście trafień z rzędu czystym zgadywaniem ma
   prawdopodobieństwo 0,5¹⁵ ≈ 0,00003.
6. **Odsłonięcie następuje DOPIERO po odpowiedzi**, nigdy przed: zielony = faktycznie
   oświetlona, czerwony = faktycznie ciemna — niezależnie od tego, co kliknięto (patrz
   `readabilityGate.test.ts`, testy 8–10).

### 5.3 Tryb porównawczy — NIE jest kontrolą pozytywną

> **Ta sekcja została skorygowana.** Zdanie, że przyrząd „potrafi wydać werdykt nie",
> zostało usunięte jako fałszywe — patrz §7.3.1 i §7.3.2. Poniżej jest to, co ten
> przełącznik robi naprawdę.

`gate.html` ma przycisk przełączający `ReadabilityGate.setMode('smooth')` — CAŁA planeta
(nie znaczniki) przechodzi na `writeCellColorsSmooth` (`shading.ts`): interpolację liniową
między kolorem nocy i dnia, BEZ progowania `LIGHT_BANDS`. Kliknięcia w tym trybie **nie są
zapisywane** (`handleClick` zwraca `null` — test 13 w `readabilityGate.test.ts`).
Przełącznik nie rusza pozycji znaczników ani stanu bieżącej próby (test 14) — więc
porównanie progowane↔gładkie jest na TEJ SAMEJ parze, w TEJ SAMEJ kamerze.

**Czego ten tryb NIE robi.** Nie odtwarza trybu awarii zmierzonego w Fazie 0.
`writeCellColorsSmooth` zmienia **mapowanie palety**, a nie **interpolację**: nadal maluje
każdą komórkę jednym płaskim kolorem, bo geometria Zadania 2 daje każdej własne
wierzchołki. W Fazie 0 kolor był interpolowany **po powierzchni**, między wierzchołkami
współdzielonymi, i granica się **rozmazywała**. Tej awarii ta architektura nie potrafi
odtworzyć z konstrukcji. Zmierzone na prawdziwych parach terminatora (`shading.test.ts`,
test 14): różnica barwna w trybie gładkim wynosi **0,030–0,081 na kanał**, jest niezerowa
i zawsze w tę samą stronę — komórka oświetlona jest jaśniejsza. Przy wymuszonym wyborze
dwóch alternatyw wystarczy wskazać jaśniejszą.

**Co ten tryb pokazuje naprawdę, i co jest warte pokazania.** Ile kontrastu dokłada
progowanie ponad to, co dowozi sama geometria: odległość barwna pary rośnie z ~0,07–0,12
do 0,9005, czyli **7,4–12,7×** (zmierzone na pięciu parach fazy 1). Czytelność granicy
dowozi **geometria** z Zadania 2 — płaskie cieniowanie per komórka czyni ją WIDZIALNĄ;
progowanie z Zadania 3 czyni ją WYGODNĄ.

Kontrola pozytywna odtwarzająca RZECZYWISTY tryb awarii Fazy 0 (współdzielone wierzchołki
albo kolor liczony per wierzchołek z pozycji) jest **do domknięcia w Fazie 2B** — §7.3.2.

---

## 6. Co zweryfikowałem sam — to NIE jest werdykt bramki

Rozróżnienie jest celowe i ważne (patrz §1): poniższe to dowód, że **instrument działa
poprawnie**, nie osąd, czy terminator jest czytelny. Tego drugiego nie oceniam.

### 6.1 Testy automatyczne

61 nowych testów (patrz §8), wszystkie zielone, w tym:
- `terminatorPairs.test.ts` (16 testów): pary zwrócone przez `findTerminatorPairs` są
  prawdziwymi sąsiadami, naprawdę stoją po dwóch stronach granicy pasmo-0-kontra-reszta,
  bez duplikatów; `selectSpreadPairs` zwraca dokładnie żądaną liczbę, rozłożoną
  równomiernie, deterministycznie.
- `readabilityGate.test.ts` (25 testów): m.in. **przebieg PEŁNYCH piętnastu prób z
  rzędu** (test 17) — klik w prawdziwie oświetlony znacznik piętnaście razy kończy plan
  (`isFinished()`), z piętnastoma poprawnymi odpowiedziami zapisanymi. Kliknięcie
  wymaga prawdziwego rzutowania promienia (`Raycaster`) przez prawdziwą kamerę
  Three.js — **zweryfikowałem probe'ą w Node przed napisaniem kodu produkcyjnego**, że
  `camera.updateMatrixWorld(true)` musi być wołane jawnie przed `setFromCamera`, bo
  Three.js NIE przelicza automatycznie macierzy świata po samym `position.set()` — bez
  tej linii klik tuż po ruchu kamery (a `focusOn` rusza kamerą przy KAŻDEJ nowej próbie)
  chybiałby milcząco, wyglądając identycznie jak "kliknąłeś obok". Ta poprawka jest w
  `readabilityGate.ts`, skomentowana wprost przy `handleClick`.
- `frameStats.test.ts` (15 testów), `shading.test.ts` (+4 testy `writeCellColorsSmooth`,
  w tym dowód, że interpolacja jest liniowa i że dwie komórki tuż przy `dot == 0` dostają
  kolory RÓŻNE, ale bliskie o rząd wielkości mniejszy niż skok między pasmami
  progowanego wariantu — to jest "granica niewidoczna", zoperacjonalizowana jako liczba).

### 6.2 Weryfikacja na żywym renderze (Browser pane, nie zgadywanie z kodu)

Uruchomiłem `pnpm --filter @heliopolis/client dev` i przeszedłem cały interfejs:

- `http://localhost:5180/` — planeta z trzema ostrymi pasmami, licznik klatek widoczny
  i aktualizujący się, log `[BUDGET]` w konsoli po 1000 klatkach (§3).
- `http://localhost:5180/gate.html` — oba znaczniki widoczne, wizualnie NIEODRÓŻNIALNE
  przed kliknięciem (zrzuty ekranu potwierdzają to gołym okiem, nie tylko testem);
  kliknięcie w prawidłowy znacznik daje "Poprawnie!" i zielono-czerwone odsłonięcie;
  kliknięcie w zły znacznik daje "Niepoprawnie" z tym samym odsłonięciem; kliknięcie
  OBOK obu znaczników nic nie robi; tryb porównawczy wyraźnie ZMNIEJSZA kontrast
  granicy, a powrót do progowania natychmiast go przywraca, na tej samej parze —
  **skorygowane:** pierwotnie zapisałem tu, że tryb ten granicę USUWA; właściciel projektu
  ustalił, że jej nie usuwa, i pomiar to potwierdził (§5.3, §7.3.1); trzy fazy słońca
  faktycznie dają trzy różne, widoczne pozycje terminatora; ekran końcowy po
  piętnastej próbie poprawnie pokazuje wynik, werdykt mechaniczny i tabelę Markdown do
  wklejenia — z prawdziwymi identyfikatorami komórek prawdziwej planety.
- Zero błędów w konsoli przeglądarki przez całą sesję.

### 6.3 Mutacje — dowód, że kluczowe testy NAPRAWDĘ łapią regresję, nie tylko przechodzą

Ostrzeżenie z briefu ("instrumenty pomiarowe w tym projekcie dały fałszywy odczyt pięć
razy") dotyczy TEŻ testów, które piszę — samo "61 testów, wszystkie zielone" niczego nie
dowodzi bez sprawdzenia, że te testy faktycznie by zawiodły, gdyby kod był zły. Cztery
mutacje wykonane w źródle (nie w kopii), uruchomione, zaobserwowany czerwony wynik,
przywrócone — dokładnie ten wzorzec co przeglądy Zadań 3–4:

| # | Mutacja | Plik | Złapana przez | Wynik |
|---|---|---|---|---|
| M1 | `correct: clickedLit` → `correct: !clickedLit` (odwrócony scoring) | `readabilityGate.ts` | testy 8, 9, 17 | 3 testy czerwone |
| M2 | `if (selfLit === neighborLit) continue` → `!==` (para bierze DWIE komórki z TEJ SAMEJ strony granicy zamiast dwóch różnych) | `terminatorPairs.ts` | testy 2, 4, 5 (`terminatorPairs.test.ts`), 14 (`buildGateTrials`) | 4 testy czerwone |
| M3 | usunięcie `camera.object.updateMatrixWorld(true)` / `threeScene.updateMatrixWorld(true)` (dokładnie ta poprawka, którą wykazała probe w Node przed napisaniem kodu — §6.1) | `readabilityGate.ts` | testy 8, 9, 10, 12, 16, 17, 18 | 7 testów czerwonych |
| M4 | `selectSpreadPairs`: `pairs[floor(i·len/count)]` → `pairs[i]` (pierwsze `count` z brzegu zamiast rozłożonych) | `terminatorPairs.ts` | test 6 | 1 test czerwony |

Jedno spostrzeżenie warte zapisania, nie oczywiste z góry: **M2 (błędna SEMANTYKA pary —
"jasna"/"ciemna" komórka są w rzeczywistości po tej samej stronie) nie złapał ŻADEN test
w `readabilityGate.test.ts`.** Te testy sprawdzają wyłącznie, czy klik trafiający we
znacznik NA POZYCJI `litCellId` poprawnie ROZPOZNAJE, że to `litCellId` (mechanizm
klik→identyfikacja) — nie sprawdzają NIEZALEŻNIE, czy `litCellId` jest naprawdę
oświetlona wg `lightField` (semantyka). Te dwie warstwy ochrony są rozłączne i obie
potrzebne: `terminatorPairs.test.ts` (semantyka par) + `readabilityGate.test.ts`
(mechanizm kliku) razem zamykają lukę, którą żaden z osobna by nie złapał. Wszystkie
cztery mutacje przywrócone; `git diff` po całej sesji mutacji wychodzi pusty (`git
status` czyste) — żadna nie została przypadkiem zostawiona w kodzie.

### 6.4 Załącznik: mój własny, niemiarodajny przebieg mechaniczny (NIE werdykt)

Podczas weryfikacji klikałem przez wszystkie piętnaście prób, żeby dowieść, że ekran
końcowy działa — **bez starannej, uważnej oceny każdej pary** (klikałem głównie po to,
żeby przesunąć harness do końca, nie żeby wydać osąd o czytelności). Wynik: **13/15**,
FAIL wg mechanicznego progu. To NIE jest sesja człowieka wymagana przez §8.1 — nie
zastępuje jej i nie powinna być cytowana jako wynik bramki. Zapisuję ją wyłącznie jako
dowód, że harness faktycznie potrafi wyprodukować WYNIK RÓŻNY OD "wszystko trywialnie
poprawne", czyli że test ma realną moc rozróżniającą, nie tylko zawsze zdaje:

```
| # | Faza | Komórka jasna | Komórka ciemna | Kliknięto | Wynik |
|---|---|---|---|---|---|
| 1 | 1 | 468 | 12 | 12 | BŁĄD |
| 2 | 1 | 201 | 191 | 201 | OK |
| 3 | 1 | 1174 | 472 | 1174 | OK |
| 4 | 1 | 1365 | 692 | 1365 | OK |
| 5 | 1 | 921 | 922 | 921 | OK |
| 6 | 2 | 94 | 211 | 211 | BŁĄD |
| 7 | 2 | 253 | 264 | 253 | OK |
| 8 | 2 | 419 | 409 | 419 | OK |
| 9 | 2 | 785 | 784 | 785 | OK |
| 10 | 2 | 895 | 884 | 895 | OK |
| 11 | 3 | 2 | 3 | 2 | OK |
| 12 | 3 | 219 | 96 | 219 | OK |
| 13 | 3 | 550 | 1228 | 550 | OK |
| 14 | 3 | 876 | 875 | 876 | OK |
| 15 | 3 | 1045 | 1034 | 1045 | OK |

Wynik: 13/15 — FAIL (13/15)
```

(Wygenerowane dosłownie przez `formatGateResultsMarkdown` na żywym uruchomieniu —
skopiowane z `#export`, nie przepisane ręcznie.)

---

## 7. Werdykt człowieka — CZEKA NA WŁAŚCICIELA PROJEKTU

**To jest jedyna sekcja tego dokumentu, którą wypełnia człowiek, nie ja.**

### 7.1 Jak uruchomić bramkę

1. Z korzenia repo (albo z `apps/client`): `pnpm --filter @heliopolis/client dev` (albo
   `pnpm dev` z korzenia — uruchamia to samo). Serwer wstaje pod `http://localhost:5180/`.
2. Otwórz **`http://localhost:5180/gate.html`** (NIE `/` — to normalny widok gry bez
   harnessu; bramka mieszka na osobnej stronie).
3. Panel po prawej pokazuje instrukcję, fazę/parę/numer próby i podpowiedź. Obracaj i
   przybliżaj kamerę myszą (K1) ile potrzeba, PRZED odpowiedzią.
4. Dla każdej z piętnastu prób: kliknij na planecie ten z dwóch identycznych znaczników,
   który Twoim zdaniem leży na OŚWIETLONEJ komórce. Zobaczysz odsłonięcie (zielony =
   faktycznie oświetlona, czerwony = faktycznie ciemna) i przycisk "Dalej →".
5. Opcjonalnie, w dowolnym momencie PRZED odpowiedzią: kliknij "Pokaż kontrolę
   pozytywną", żeby zobaczyć tę samą parę bez progowania (dowód, że granica MOŻE
   zniknąć) — kliknięcia w tym trybie się nie liczą; wróć do progowania przyciskiem,
   żeby kontynuować ocenianą próbę.
6. Po piętnastej próbie panel pokaże wynik końcowy i pole tekstowe z gotową tabelą
   Markdown — skopiuj jej zawartość (zaznacz całość w polu, Ctrl/Cmd+C) i wklej w
   miejsce tabeli w §7.2 niżej, zamiast pustych wierszy.
7. Zapisz werdykt w §7.3 — **PASS wymaga wszystkich piętnastu poprawnych**. Jeśli wynik
   jest inny niż 15/15, to jest realny wynik, nie porażka tego zadania — zapisz go
   i przejdź do §7.4.

### 7.2 Surowa tabela piętnastu prób (do wklejenia z `gate.html`)

Wklejone dosłownie z `gate.html`, wariant progowania, przez właściciela projektu.

**Warunki, pod którymi ta tabela obowiązuje** — bez nich nie da się jej powtórzyć ani
porównać z drugą sesją:

| parametr | wartość w tym przebiegu |
|---|---|
| `seed` planety | `20260915` |
| `frequency` | domyślne (12) → 1442 komórki |
| `LIGHT_BANDS` | **`[0,05; 0,4]`** |
| fazy słońca | `t/T ∈ {0; 1/3; 2/3}`, `T = DEFAULT_RUN.rotationPeriod = 180 s` |
| par na fazę | 5 |

**Pierwszy próg jest tu parametrem krytycznym, nie szczegółem.** Plan prób jest
deterministyczny, ale wyprowadzony z `LIGHT_BANDS[0]` — zmiana progu zmienia zarówno to,
które pary w ogóle są graniczne, jak i to, które z nich wybierze `selectSpreadPairs`.
Zmierzone, ile z piętnastu par tej tabeli zostałoby w nowym planie:

| `LIGHT_BANDS[0]` | par z tej tabeli w nowym planie | par tej tabeli nadal granicznych |
|---|---|---|
| **0,05** (ten przebieg) | 15/15 | 15/15 |
| 0,055 | 12/15 | — |
| 0,06 | **10/15** | 13/15 |
| 0,07 | 6/15 | — |
| 0,04 | 6/15 | 13/15 |
| 0,03 | 6/15 | 13/15 |

Wniosek dla drugiej sesji człowieka (§5.1): **jeśli `LIGHT_BANDS` zmieni się przed nią,
to nie jest ta sama bramka** i tabel nie wolno porównywać wiersz po wierszu. Próg trzeba
sprawdzić PRZED uruchomieniem i zapisać obok nowej tabeli.

| # | Faza | Komórka jasna | Komórka ciemna | Kliknięto | Wynik |
|---|---|---|---|---|---|
| 1 | 1 | 468 | 12 | 468 | OK |
| 2 | 1 | 201 | 191 | 201 | OK |
| 3 | 1 | 1174 | 472 | 1174 | OK |
| 4 | 1 | 1365 | 692 | 1365 | OK |
| 5 | 1 | 921 | 922 | 921 | OK |
| 6 | 2 | 94 | 211 | 94 | OK |
| 7 | 2 | 253 | 264 | 253 | OK |
| 8 | 2 | 419 | 409 | 419 | OK |
| 9 | 2 | 785 | 784 | 785 | OK |
| 10 | 2 | 895 | 884 | 895 | OK |
| 11 | 3 | 2 | 3 | 2 | OK |
| 12 | 3 | 219 | 96 | 219 | OK |
| 13 | 3 | 550 | 1228 | 550 | OK |
| 14 | 3 | 876 | 875 | 876 | OK |
| 15 | 3 | 1045 | 1034 | 1045 | OK |

### 7.3 Werdykt

# PASS — 15/15

Orzeczony przez właściciela projektu po przejściu wszystkich piętnastu prób w wariancie
progowania. Komplet trafień: pięć par w każdej z trzech faz słońca, bez ani jednej pomyłki.

**Co to znaczy, a czego nie znaczy.**

Znaczy: **D1 ma pokrycie w działającym renderze**, nie tylko w specyfikacji. Filar całego
projektu brzmi „gracz czyta granicę światła wzrokiem, bez UI" — i po raz pierwszy w historii
tego projektu zostało to sprawdzone na czymś, co naprawdę rysuje piksele, w wymuszonym wyborze
dwóch alternatyw, bez nakładki prawdy i bez najeżdżania kursorem. Faza 0 zmierzyła, że gładkie
cieniowanie czyni terminator **niewidocznym**; ta bramka mierzy, że progowane czyni go
jednoznacznym.

Nie znaczy: że paleta jest docelowa ani że wygląda ładnie. Bramka bada JEDNĄ granicę —
noc kontra strona oświetlona (§4) — bo to ona niesie D1. Rozróżnienie półmroku od dnia jest
estetyczne i zostaje otwarte dla Fazy 4; policzony kontrast tej pary (Δodcienia 22,4°, WCAG 2,90)
jest poniżej progu przyjmowanego w interfejsach i **świadomie nie był przedmiotem tej bramki**.

### 7.3.1 KOREKTA — kontrola pozytywna NIE JEST kontrolą

Właściciel projektu, przełączywszy kontrolę pozytywną, ocenił że **15/15 byłoby osiągalne także
w trybie gładkim**. Zmierzone i potwierdzone — ocena jest trafna, a przyrząd wadliwy.

Odległości barw między sąsiadami przez terminator, `sunDirection(0, 180)`:

> **Etykieta skorygowana.** Te pomiary były podpisane „seed 33", co sugerowało, że zależą
> od seeda. Nie zależą — zmierzone na seedach 20260915, 33, 1 i 999999: `positions`,
> `normals` i `lightField` wychodzą **bit w bit identyczne** na każdym z nich. Seed
> steruje wyłącznie `Cell.oreCapacity` i wyborem `startCell` (np. 1156 kontra 488), a
> geometria zależy tylko od `frequency`. Liczby poniżej są poprawne i obowiązują dla
> KAŻDEGO seeda przy `frequency 12`; podpis był mylący, nie pomiar.

| para | światło jaśniejszej | progowane | gładkie |
|---|---|---|---|
| (12, 468) | 0,074 | 0,90 | **0,11** |
| (96, 97) | 0,103 | 0,90 | **0,15** |
| (107, 108) | 0,053 | 0,90 | **0,08** |

W trybie gładkim różnica jest mniejsza, ale **niezerowa i konsekwentna w tym samym kierunku** —
komórka oświetlona jest zawsze jaśniejsza. Przy wymuszonym wyborze dwóch alternatyw wystarczy
wskazać jaśniejszą, więc komplet trafień jest osiągalny.

**Przyczyna jest architektoniczna i została przeoczona przy pisaniu planu.**
`writeCellColorsSmooth` zmienia **mapowanie palety**, a nie **interpolację**: nadal maluje każdą
komórkę jednym kolorem, bo geometria z Zadania 2 daje każdej własne wierzchołki. Tryb awarii
zmierzony w Fazie 0 był inny — tam kolor był interpolowany **po powierzchni**, między
wierzchołkami współdzielonymi, więc granica się **rozmazywała**. Tej awarii nasza architektura
nie potrafi odtworzyć z konstrukcji.

**Co z tego wynika dla projektu, i jest to ważniejsze niż sama wada bramki:**

**Czytelność dowozi geometria z Zadania 2, nie progowanie z Zadania 3.** Płaskie cieniowanie
per komórka czyni granicę WIDZIALNĄ; progowanie podbija kontrast z ~0,1 do 0,90, czyli czyni ją
WYGODNĄ. To są dwie różne zasługi i dotąd przypisywaliśmy obie progowaniu. Decyzja
o niewspółdzielonych wierzchołkach jest więc jeszcze bardziej nośna, niż sądziliśmy — i nic
jej nie bada wizualnie.

**Drugie ustalenie, niezamówione:** para (11, 168) daje w trybie **progowanym odległość 0,0000**,
bo światło 0,0458 nie przekracza pierwszego progu 0,05 i obie komórki lądują w tym samym paśmie.
Osiem komórek na 1442 wpada w tę szczelinę. Czyli **progowanie potrafi ukryć granicę, której
gładkie cieniowanie by nie ukryło** — argument za niskim pierwszym progiem, nie przeciw niemu.

> **Rozwinięte i zmierzone w §4.1.** Liczba „osiem" dotyczy WYŁĄCZNIE fazy `sunDirection(0, 180)`,
> gdzie orientacja siatki geodezyjnej wyjątkowo dobrze trafia w granicę. Przez dwanaście faz
> pełnego obrotu szczelina obejmuje **8 do 38 komórek** (średnio 30,8; 4,28% komórek, które
> symulacja uznaje za oświetlone), a jej grubość to **1 krok komórki w każdej fazie**.
> W 6 z 15 prób §7.2 komórka oznaczona jako „ciemna" jest dla symulacji oświetlona.

### 7.3.2 Zakres, w jakim werdykt PASS nadal obowiązuje

Obowiązuje: **terminator jest w tym renderze czytelny jako granica** — piętnaście wymuszonych
wyborów bez pomyłki, bez nakładki i bez najeżdżania kursorem. To jest prawdziwa obserwacja
o działającym produkcie i nie zmienia jej wada kontroli.

**NIE obowiązuje** wcześniejsze zdanie, że „przyrząd potrafi wydać werdykt nie". Nie potrafi
— jego kontrola zmienia paletę, nie interpolację. Zdanie zostało usunięte jako fałszywe.

**Do domknięcia w Fazie 2B:** kontrola pozytywna odtwarzająca RZECZYWISTY tryb awarii Fazy 0 —
kolor interpolowany po powierzchni, czyli geometria ze współdzielonymi wierzchołkami albo kolor
liczony per wierzchołek z pozycji, nie per komórka. Dopiero taka kontrola pozwoli powtórzyć tę
bramkę jako rozstrzygającą.

### 7.4 Jeśli werdykt jest inny niż PASS — co zapisać

Zgodnie z briefem: FAIL (albo dowolny wynik poniżej 15/15) to WYNIK, nie porażka tego
zadania — nie próbuj go "poprawiać" retuszem progów bez zapisania, co się faktycznie
stało. Zapisz tutaj:

- **Które konkretnie próby (numery z §7.2) zawiodły** i, jeśli pamiętasz, dlaczego —
  para wyglądała dwuznacznie, znacznik był trudny do zlokalizowania, kamera stała w
  niewygodnym miejscu, cokolwiek innego.
- **Czy trudność dotyczyła granicy noc↔(cokolwiek jasne)** — to byłby wynik D1-krytyczny,
  uderzający w sam filar projektu — **czy raczej wahania w obrębie strony jasnej**
  (półmrok kontra dzień) — to bramka z definicji NIE powinna była zadać (§4), więc jeśli
  mimo to tak odczułeś/aś trudność, zapisz to precyzyjnie: to zmienia, co naprawia Faza 4
  (paleta/progi), nie samą mechanikę bramki.
- Czy kontrola pozytywna (tryb gładki) rzeczywiście wyglądała gorzej / mniej czytelnie
  niż tryb progowany, na tej samej parze — jeśli NIE, to podważa samą bramkę (instrument
  nieczuły), nie tylko wynik, i powinno zostać zbadane przed jakąkolwiek decyzją.

---

## 8. Zestawienie testów dodanych w tym zadaniu

| Plik | Testów |
|---|---|
| `packages/render/test/budget.test.ts` | 1 |
| `packages/render/test/frameStats.test.ts` | 15 |
| `packages/render/test/terminatorPairs.test.ts` | 16 |
| `packages/render/test/readabilityGate.test.ts` | 25 |
| `packages/render/test/shading.test.ts` (dopisane do istniejącego pliku) | +4 |
| **Razem nowych** | **61** |

Baseline przed tym zadaniem: 422 testy w 32 plikach. Po tym zadaniu: **483 testy w 36
plikach**, `pnpm typecheck` (`tsc -b` z korzenia) czyste, `pnpm test` zielone.

---

## 9. Pliki

- `packages/render/src/frameStats.ts` — `median`, `percentile`, `createRollingWindow` (dzielone przez test budżetu i licznik w `main.ts`)
- `packages/render/src/terminatorPairs.ts` — dobór par granicznych, plan prób
- `packages/render/src/readabilityGate.ts` — harness: scena, znaczniki, klik, tryb kontrolny, eksport Markdown
- `packages/render/src/shading.ts` — dodane `writeCellColorsSmooth` (kontrola pozytywna)
- `packages/render/test/budget.test.ts`, `frameStats.test.ts`, `terminatorPairs.test.ts`, `readabilityGate.test.ts`, dopiski w `shading.test.ts`
- `apps/client/src/main.ts` — licznik klatek (mediana/p95 na ekranie + log po 1000 klatkach)
- `apps/client/gate.html`, `apps/client/src/gate.ts` — strona bramki czytelności
- `apps/client/vite.config.ts` — `gate.html` dodane jako drugie wejście builda
