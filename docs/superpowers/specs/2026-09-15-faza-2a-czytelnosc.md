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
| Bramka czytelności terminatora (§8.1 specu, piętnaście osądów) | **CZEKA NA CZŁOWIEKA** — §7. Harness zbudowany, przetestowany automatycznie (61 nowych testów) i zweryfikowany na żywym renderze przeze mnie (§6) — ale **werdykt PASS/FAIL nie jest mój do wydania** |

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
Fizycznie: `lightAt` (`packages/sim/src/sim/light.ts`) liczy `saturate(dot)` — pasmo 0
to DOKŁADNIE `dot ≤ 0`, czyli zero światła; pasma 1 i 2 to dwa poziomy TEGO SAMEGO stanu
"coś świeci".

**Dlatego harness (`findTerminatorPairs`, `packages/render/src/terminatorPairs.ts`)
dobiera pary WYŁĄCZNIE na granicy pasmo-0-kontra-reszta (noc kontra półmrok-LUB-dzień),
nigdy na granicy półmrok↔dzień.** Piętnaście prób bramki testuje więc dokładnie tę
granicę, o której mówi D1 — nie granicę estetyczną. Konsekwencja dla interpretacji
werdyktu w §7: **jeśli człowiek zgłosi trudność, ważne jest ZAPISANIE, czy trudność
dotyczyła "czy to jest w ogóle jasne czy ciemne" (D1-krytyczne, poważny wynik) czy
raczej "czy to jest już dzień czy jeszcze zmierzch" (estetyczne, nie powinno wpływać na
werdykt bramki — to pytanie, którego bramka celowo NIE zadaje).**

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

### 5.3 Kontrola pozytywna

`gate.html` ma przycisk "Pokaż kontrolę pozytywną (cieniowanie ciągłe)", który przełącza
`ReadabilityGate.setMode('smooth')` — CAŁA planeta (nie znaczniki) przechodzi na
`writeCellColorsSmooth` (`shading.ts`): interpolację liniową między kolorem nocy i dnia,
BEZ progowania `LIGHT_BANDS` — dosłownie to, co bramka Fazy 0 zmierzyła jako
NIECZYTELNE. Kliknięcia w tym trybie **nie są zapisywane** (`handleClick` zwraca `null`
— zweryfikowane testem 13 w `readabilityGate.test.ts`, nazwanym wprost "KONTROLA
POZYTYWNA"). Przełącznik nie rusza pozycji znaczników ani stanu bieżącej próby (test
14) — więc porównanie progowane↔gładkie jest na TEJ SAMEJ parze, w TEJ SAMEJ kamerze.

**Zweryfikowałem to osobiście na żywym renderze** (§6.2, nie tylko w kodzie): po
przełączeniu na tryb gładki granica dzień/noc, dotąd ostro widoczna, **wizualnie
zanika** — widać wciąż siatkę heksagonów (bo cieniowanie jest nadal płaskie per komórka),
ale bez żadnego skoku jasności między sąsiadami. To jest dowód, że instrument NAPRAWDĘ
potrafi wyprodukować "nie widzę" — bez tego piętnaście trafień w trybie progowanym nie
dowodziłoby niczego.

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
  OBOK obu znaczników nic nie robi; **tryb kontrolny wizualnie usuwa granicę** (§5.3);
  powrót do progowania natychmiast ją przywraca, na tej samej parze; trzy fazy słońca
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

*(pusta, celowo — żadna liczba nie została zmyślona; wklej tu dosłowną zawartość pola
`#export` po ukończeniu piętnastu prób)*

| # | Faza | Komórka jasna | Komórka ciemna | Kliknięto | Wynik |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |
| 12 | | | | | |
| 13 | | | | | |
| 14 | | | | | |
| 15 | | | | | |

### 7.3 Werdykt

# CZEKA NA CZŁOWIEKA

*(PASS / FAIL — wpisz po ukończeniu §7.2. PASS wymaga 15/15.)*

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
