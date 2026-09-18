# Bramka czytelności PRZYCZYNOWEJ — Faza 2C, Zadanie 6

**Data:** 2026-09-18. **Gałąź:** `faza-2c`. **Strona:** `/causal-gate.html`.

> **Werdykt należy do właściciela projektu i nie jest tu wpisany.** Panel podaje wyłącznie
> arytmetykę: ile trafień z dwunastu i czy próg został osiągnięty. §7 czeka pusty.

---

## 1. Czym ta bramka NIE jest

Pięć dotychczasowych bramek mierzy czytelność **optyczną**: kontrast pasm terenu, próg
jednego piksela, terminator jako granica, rozpoznawalność brył i jednostek. Wszystkie pytają
**„co widzisz"**.

Ta pyta **„dlaczego tak jest"**. To inna oś, nie szósty wariant tamtych — i dlatego jej wyniku
nie wolno zestawiać z tabelami Faz 2A i 2B wiersz po wierszu.

Kryterium z planu zadania: *gracz wskazuje, dlaczego jego budynek przestał działać, i podaje
przyczynę o jeden krok wstecz.*

---

## 2. Pytanie i cztery odpowiedzi

Jedno pytanie, powtórzone dwanaście razy nad różnymi układami:

> **Budynek w celowniku nie pracuje tak, jak powinien — albo pracuje. Co jest tego PRZYCZYNĄ?**

| kod | odpowiedź na ekranie | co to znaczy w symulacji |
|---|---|---|
| `POWERED` | Ma prąd i pracuje — sieć produkuje tyle, ile zużywa | `OUTAGE_NONE`, `rawDemand ≤ supply` |
| `DEFICIT_COVERED` | Ma prąd, ale sieć nie nadąża — różnicę dopłaca magazyn | `OUTAGE_NONE`, `rawDemand > supply` |
| `SHED` | Nie ma prądu: zgaszony, bo zapotrzebowanie przekroczyło produkcję | `OUTAGE_SHED` |
| `UNLINKED` | Nie ma prądu: odcięty od Core — przerwany łańcuch sieci | `OUTAGE_UNLINKED` |

**Te cztery, a nie dowolne cztery.** `power.ts` koduje dokładnie trzy powody braku prądu,
a linia bilansu z Zadania 4 dokłada czwarty stan: **niedobór, który magazyn jeszcze pokrywa**.
To jest ostrzeżenie PRZED awarią, czyli dosłownie „jeden krok wstecz".

Para `SHED`↔`UNLINKED` jest sednem: to ta sama para, którą Zadanie 4 kazało rozróżnić
w świecie (obręcz zamknięta kontra przerwana), bo wymaga **dwóch różnych reakcji gracza** —
„dobuduj produkcję" kontra „napraw pylon".

**Prawda jest wyprowadzana, nie wpisana.** Każdy scenariusz buduje prawdziwy `SimState`,
przepuszcza go przez prawdziwe `updatePower` i czyta wynik z `outage`. Scenariusz, który
wyszedł inaczej, niż zapowiada, **wywala stronę przy budowie** (`assertTruth`) zamiast po
cichu przekłamać jeden wiersz tabeli.

---

## 3. Protokół i próg — wyprowadzone, nie wybrane

**M = 12 osądów, N = 10 do zaliczenia.** Plan zrównoważony **3/3/3/3**.

**Skąd 10, a nie „80 %".** Bramka Fazy 2B wymagała kompletu piętnastu przy pytaniu binarnym,
czyli zdanie jej trafem miało szansę **1 na 32 768**. Tutaj odpowiedzi są cztery, więc ten sam
poziom ochrony przed trafem daje **10 z 12: 1 na 26 300** (dwumian, p = 0,25). Próg jest
dobrany tak, żeby traf był **tak samo nieprawdopodobny jak w bramce, którą projekt już
przyjął** — a nie żeby brzmiał surowo.

Dwa błędy są dopuszczone, bo zadanie jest trudniejsze niż „oświetlona czy ciemna". Człowiek
czytający ekran z trafnością 90 % na pytanie zdaje tę bramkę w **89 %** przebiegów; przy
wymaganym komplecie zdałby tylko w **28 %**, czyli próg mierzyłby wtedy szczęście osoby,
która umie czytać.

### 3.1 Drugi próg, ważniejszy: SUFIT KONTROLI

Kontrola pozytywna usuwa **trzy** kanały przyczyny (§5), więc pary `POWERED`↔`DEFICIT_COVERED`
i `SHED`↔`UNLINKED` stają się nierozróżnialne, a sama obecność awarii zostaje widoczna.
**Sufit kontroli to 50 %, nie 25 %.** Ktoś, kto trafnie rozpoznaje parę i zgaduje w jej
środku, ma **1 na 52** szansy dobić do 10/12.

Dlatego **wynik przebiegu ocenianego nic nie znaczy bez przebiegu kontrolnego**.

### 3.2 Odpowiedź stała

Plan jest zrównoważony, więc wciskanie w kółko tego samego przycisku daje 3/12 — tyle, co
losowanie. Sam wynik tego nie zdradza, **rozkład zdradza**: panel liczy go osobno i zgłasza,
gdy jedna odpowiedź przekroczy 60 % przebiegu. Sprawdzone na żywym przebiegu (§6.1).

### 3.3 Warunki, pod którymi tabele obowiązują

| parametr | wartość |
|---|---|
| `seed` planety | `20260915` |
| faza słońca | stała, `t/T = 0,15` — bramka nie pyta o oświetlenie |
| kotwice przebiegu ocenianego | co `stride` od heksa 1 (offset 0) |
| kotwice przebiegu kontrolnego | offset 12 — **zestawy rozłączne**, kontrola nie zdradza ocenianego |
| okno | **≥ 800 × 500 px**, wyprowadzone w §5.2; poniżej panel gry zasłania pytany budynek |

---

## 4. Dwa scenariusze o znanej prawdzie z Fazy 1C

**Q3 — kaskada.** Cztery lasery (48/s) przy produkcji CORE 10/s i pustym magazynie.
Ekran mówi: `prąd 10,0/s z 51,0/s potrzebnych · brakuje 41,0/s, więc gasną: KINETIC_TURRET,
LASER_TURRET`. Budynek w celowniku ma obręcz **zamkniętą**.

**Q4 — odcięcie.** Łańcuch pylonów do dalekiej wieży, środkowe ogniwo zjedzone (tak jak robi
to `DISRUPTOR`). Ekran mówi: `prąd 10,0/s z 0,5/s potrzebnych` — **sieć ma nadwyżkę**, a wieża
mimo to nie działa. Obręcz **przerwana**.

Izolacja jest wymuszona testem: w scenariuszu `UNLINKED` zapotrzebowanie **musi** być
≤ produkcji, inaczej gracz miałby dwie prawdziwe przyczyny naraz i pytanie straciłoby jedną
odpowiedź.

---

## 5. Kontrola pozytywna — i przeciek, który wyszedł przy jej budowie

Kontrola usuwa kanały przyczyny i zostawia sam fakt awarii:

1. **linia bilansu** ukryta (arkusz, `#hud.hud-blind .hud-line--power`),
2. **zapas magazynu** ukryty (`#hud.hud-blind .hud-storage`),
3. **obręcz alarmu bez rozróżnienia przyczyny** — `blindOutage` zbija `OUTAGE_SHED`
   i `OUTAGE_UNLINKED` w jeden kod, zostawiając `OUTAGE_NONE` nietknięte.

### 5.1 Przeciek, zmierzony na żywej stronie

Pierwsza wersja kontroli ukrywała **tylko linię bilansu**. Zmierzone na ekranie: wiersz zasobów
dalej pokazywał `magazyn`, a cztery układy miały cztery różne zapasy — **13 / 199 / 0 / 19**.
Sam magazyn identyfikował przyczynę, więc sufit kontroli był 12/12, nie 6/12, a kontrola
mierzyła czytelność jednego kanału zamiast jej braku.

Naprawa u źródła: `magazyn` jest od tej zmiany **osobnym elementem panelu** (`storageText`),
bo jest wielkością energetyczną — należy do tej samej rodziny co linia bilansu, a sklejony
z rudą w jednym napisie nie dawał się zasłonić bez zasłonięcia rudy, która przyczyny nie niesie.

**To trzeci raz, kiedy kontrola pozytywna w tym projekcie przeciekła.** Dwa poprzednie były
w Fazie 2B: raz przez `saturate`, raz przez celowanie kamerą w pytaną komórkę. Za każdym razem
wyglądało to jak umiejętność.

### 5.2 Strażnik przesłonięcia

Kamera stawia pytany budynek w środku płótna, a oba panele są przyklejone do krawędzi — więc
przy dość małym oknie środek wchodzi pod panel gry i pytanie staje się **nieodpowiadalne**,
a wynik wyglądałby jak brak umiejętności.

Strona **sama to zgłasza**: liczy położenie celownika co klatkę i przy kolizji z którymkolwiek
panelem pisze, że wynik przebiegu jest nieważny. Zmierzone w obie strony: przy oknie 840 × 420
ostrzeżenie zapala się (celownik y = 210, górna krawędź panelu gry y = 198), przy 1280 × 860
milczy (zapas 206 px).

**Minimalne okno bramki jest z tego WYPROWADZONE, nie wpisane.** Celownik ma promień 23 px
i musi zmieścić się w całości obok obu paneli:

- panel gry stoi 8 px nad dolną krawędzią i ma 214 px wysokości, więc
  `h/2 + 23 < h − 8 − 214` daje **h > 490**;
- panel bramki stoi 8 px od prawej i ma 364 px szerokości, więc
  `w/2 + 23 < w − 8 − 364` daje **w > 790**.

Stąd **800 × 500 px**. Liczba nie jest deklaracją, której nic nie pilnuje — pilnuje jej
strażnik wyżej, na żywym układzie, przy każdej klatce.

To nie jest ostrożność na zapas. W Fazie 2B kontrolki schowane pod krawędzią przewijania
**unieważniły cztery z pięciu pomiarów**, a w Zadaniu 3 tej fazy panel połykał 38,7 %
wskazywalnej tarczy — obie wady wyszły po fakcie, bo instrument nie miał jak zgłosić, że jest
zasłonięty. Ten ma.

---

## 6. Przebieg wykonawcy — SPRAWDZENIE PRZYRZĄDU, nie werdykt

> **Ten wynik nie jest werdyktem i nie wolno go tak czytać.** Dwa powody, oba wystarczające:
>
> 1. **Znam plan odpowiedzi**, bo go napisałem — kolejność `POWERED → DEFICIT_COVERED →
>    SHED → UNLINKED` powtarza się trzy razy. Mój przebieg nie jest ślepy i 12/12 nie mówi
>    nic o czytelności.
> 2. Agent czytający piksele i oko to **dwa różne instrumenty**. W Fazie 2B wykonawca i człowiek
>    dostali w tej samej kontroli 12/15 i brak możliwości odpowiedzi — **obie liczby były
>    prawdziwe**.
>
> Co ten przebieg SPRAWDZA: że scenariusze się renderują, celownik ląduje na pytanym budynku,
> panel gry pokazuje właściwe liczby, odpowiedzi się liczą i blok wyników się składa.

**Przebieg oceniany: 12 z 12.** Odczyty z ekranu, osąd po osądzie:

| # | prawda | co pokazał ekran |
|---|---|---|
| 1 | POWERED | `prąd 10,0/s z 3,0/s potrzebnych`, brak obręczy |
| 2 | DEFICIT_COVERED | `…z 24,0/s potrzebnych · brakuje 14,0/s — magazyn pokrywa niedobór`, magazyn 199, brak obręczy |
| 3 | SHED | `…z 51,0/s potrzebnych · brakuje 41,0/s, więc gasną: KINETIC_TURRET, LASER_TURRET`, magazyn 0, obręcz |
| 4 | UNLINKED | `prąd 10,0/s z 0,5/s potrzebnych` — nadwyżka — a mimo to obręcz |
| 5–12 | jak wyżej, trzy razy w kółko | — |

**Obserwacja warta zapisania:** rozróżnienie obręczy **przerwanej** od **zamkniętej** nie było
dla mnie czytelne ze zrzutu przy widoku całej tarczy — odróżniłem `SHED` od `UNLINKED`
**z linii bilansu** (nadwyżka kontra niedobór), nie z pierścienia. Człowiek ma do dyspozycji
przybliżenie, którego nie użyłem. **To jest pytanie do przebiegu człowieka, nie wniosek.**

### 6.1 Wykrywanie odpowiedzi stałej — sprawdzone na żywym przebiegu

Dwanaście razy ta sama odpowiedź: wynik **3 z 12** i ostrzeżenie na ekranie oraz w bloku:
*„12 z 12 odpowiedzi to «Ma prąd i pracuje»(100 %). Plan jest zrównoważony 3/3/3/3, więc
odpowiedź stała daje wynik nieodróżnialny od losowania."*

### 6.2 Sufit ignorowania kanałów — zmierzony dwa razy

Strategia „rozpoznaj parę, zgaduj w jej środku" (bez obręczy → `POWERED`, z obręczą → `SHED`):

| przebieg | wynik |
|---|---|
| oceniany, pełny ekran | **6 z 12** |
| kontrolny, kanały usunięte | **6 z 12** |

Te dwie liczby razem mówią rzecz, której żadna z osobna nie mówi: **kanały przyczynowe
z Zadania 4 niosą dokładnie połowę odpowiedzi.** Kto ich nie czyta, ma 6/12 niezależnie od
tego, czy są na ekranie.

---

## 7. Przebieg właściciela projektu — DO WYPEŁNIENIA

Protokół:

1. Z korzenia repo: `pnpm dev`. Otwórz **`/causal-gate.html`** (nie `/` — to zwykła gra).
2. Okno **co najmniej 800 × 500 px** (§5.2). Jeśli zobaczysz ostrzeżenie o zasłonięciu
   pytanego budynku — powiększ okno; przy tym rozmiarze wynik jest nieważny.
3. **Przebieg oceniany** (domyślny): dwanaście osądów. Planetę można obracać i przybliżać.
4. **Przebieg kontrolny**: przycisk „Kontrola pozytywna". Ma własne, rozłączne układy.
   **Jeśli odpowiadasz tam wyraźnie powyżej 6/12, bramka nie umie oblać i jej wynik nic nie
   znaczy** — zapisz to poniżej.
5. Panel składa gotowy blok Markdown. Wklej oba poniżej.

### 7.1 Przebieg oceniany

```
(wklej blok z panelu)
```

### 7.2 Przebieg kontrolny

```
(wklej blok z panelu)
```

### 7.3 Werdykt

> _(zdanie właściciela projektu — panel go nie stawia)_

---

## 8. Czego ta bramka NIE mierzy

- **Czytelności optycznej.** Progi pikselowe, kontrast i terminator mierzą Fazy 2A i 2B.
- **Przyczyny ZNISZCZENIA budynku innego niż Core.** Gra nie ma dziś na to kanału; dla Core
  niesie ją ekran końca runu („Core zniszczony przez SWARM", Zadanie 5).
- **Balansu.** Że bot i niewprawny człowiek giną w cyklu 1, mówi świadectwo pierwszego
  przebiegu — to jest pytanie do tabeli `[STROJENIE]` w Fazie 3.
- **Sprawcy poboru.** HUD podaje sumę zapotrzebowania, nie rozbicie na typy, więc „czwarta
  wieża osłabiła obronę" jest z ekranu **wyprowadzalne, ale nie napisane**. Otwarte od
  Zadania 4, decyzja o zakresie HUD należy do właściciela projektu.
