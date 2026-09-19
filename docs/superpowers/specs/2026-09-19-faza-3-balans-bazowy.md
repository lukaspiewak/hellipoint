# Raport bazowy Fazy 3 — punkt odniesienia dla strojenia

**Data:** 2026-09-19. **Gałąź:** `faza-3`. **20 000 przebiegów** (10 000 na politykę),
8 procesów, **126 minut**. Konfiguracja: `DEFAULT_RUN`, odcisk `711f754c`.

> **Ten dokument ma być OBLANY.** Jest punktem odniesienia, wobec którego mierzy się
> Zadanie 3. Raport wychodzący tu zdrowy znaczyłby, że progi z R1 są za luźne.

## Wynik: cztery kryteria oblane, dwa niezmierzone

| | zmierzone | próg | |
|---|---|---|---|
| **H1** sufit (wprawna) | **≥ 76,0 % ±0,8** | 25–60 % | **za wysoko** |
| **H2** podłoga (początkująca) | **0,0 % ±0,02** | >2 % i <38 % | **za nisko** |
| **H3** mediana runu wygranego | **20,2 min ±0,02** | 25–35 min | **za krótko** |
| **H4** porażki w cyklu 1 (początkująca) | **94,2 % ±0,5** | <15 % | **za dużo** |
| H5 różne wygrywające otwarcia | — | ≥3 | niezmierzone (Zadanie 3) |
| H6 dominacja ulepszenia | — | <10 pp | niezmierzone (Zadanie 5) |

**H1 jest DOLNYM oszacowaniem, nie oszacowaniem.** 372 przebiegi (3,7 %) nie zakończyły
się przed limitem ticków i wpadają do mianownika jako nie-zwycięstwa. Gdyby wszystkie
okazały się zwycięstwami, sufit wynosiłby 79,8 %; prawdziwa wartość leży więc w paśmie
**76,0–79,8 %**, a „±0,8" opisuje tylko mniejszą połowę tej niepewności. Kierunek nie
obala dzisiejszego werdyktu — H1 oblewa od góry, a obcięcie może je wyłącznie zaniżać,
więc „za wysoko" trzyma się tym mocniej. Będzie potrzebne wstecz, gdy Zadanie 3 wydłuży
run i odsetek obciętych zacznie rosnąć **z powodu limitu, a nie balansu**.

**Wszystkie cztery mówią to samo jednym głosem: rozpiętość między graczem niewprawnym
a wprawnym jest przepaścią, nie krzywą.** Wprawny wygrywa trzy runy na cztery, niewprawny
nie wygrywa nigdy i w 94 % przypadków ginie, zanim skończy się pierwszy obrót planety.
To nie jest „gra za trudna" ani „gra za łatwa" — to gra, która **nie ma środka**.

To odwraca rekomendację §11.1 („obciąć nagrody, podnieść rudę startową"), wyprowadzoną
z obserwacji samego bota początkującego. Przy znanym suficie recepta celowana w run
za trudny działałaby w złą stronę.

## Trzy obserwacje, których nie szukałem

**3,7 % przebiegów wprawnej nie zakończyło się** (372 z 10 000) — obcięte limitem 40 000
ticków, wciąż w fazie `RUNNING`. Raport zgłasza to na górze i słusznie: rozkłady porażek
opisują tylko runy zakończone. Przy strojeniu wydłużającym run ten odsetek urośnie
i limit trzeba będzie podnieść razem z balansem.

Po tym pomiarze okazało się, że limit był gorszy niż niedogodność: **40 000 ticków to
33,3 minuty, czyli liczba leżąca WEWNĄTRZ pasma akceptacji H3 (25–35 min = 30 000–42 000
ticków)**. Run trwający 36 minut nie mógł zostać zwycięstwem — kończył w fazie `RUNNING`,
wypadał z mediany i obniżał H1. Werdykt brzmiałby wtedy „H3 za krótko, H1 za nisko"
i kazałby stroić w stronę przeciwną do prawdy. Sufit jest teraz **wyprowadzony z progu**
(`MAX_TICKS` = 2× górna granica H3 = 84 000), więc jedna liczba nie może się już rozjechać
z drugą. **Liczby w tym dokumencie zmierzono jeszcze przy 40 000** — kolejny pomiar
Zadania 3 pójdzie już nowym sufitem i odsetek obciętych powinien spaść.

**Polityka wprawna nie wydobywa ANI JEDNEJ jednostki rudy** — `wydobyta ruda p10=p50=p90=0`.
W jej kolejce otwarcia nie ma ekstraktora. Zwycięska linia finansuje się wyłącznie nagrodami
za zabicia, co zgadza się z §11.1 („ruda nie finansuje ewakuacji, tylko wojnę na wyczerpanie")
i czyni ekonomię wydobywczą **martwą dla najlepszego znanego gracza**.

**Szczyt zabudowy: p10=42, p50=43, p90=43.** Polityka stawia dokładnie swoją 42-pozycyjną
kolejkę plus CORE i nic ponadto — bo nie ma czym. To jest mierzona granica tego przyrządu,
nie gry.

## Wada, którą znalazł dopiero ten raport

**H4 liczyłem na niewłaściwej populacji.** Pierwsza wersja mierzyła porażki w cyklu 1
u polityki WPRAWNEJ — która nigdy tam nie ginie. Kryterium raportowało **0,0 % i OK**,
podczas gdy polityka początkująca ginęła w cyklu 1 w 94 % przebiegów.

Uzasadnienie H4 w planie brzmi „dziś jest ~100 % (§11.1)", a ta setka od początku dotyczyła
bota początkującego. Sens H4 jest o **podłodze doświadczenia**, a podłogę wyznacza gracz
niewprawny. Kryterium napisane po to, żeby złapać dokładnie tę wadę, przepuszczało ją —
bo patrzyło nie na tę populację.

Nie wyszłoby to z kodu ani z testów: obie wersje przechodziły własne pary. Wyszło
z **przeczytania liczby, która była zbyt dobra**.

## Surowe raporty

## Polityka WPRAWNA — „gdzie jest sufit?"

!!! UWAGA: 372 z 10000 runów (3.7%) NIE ZAKOŃCZYŁO SIĘ —
!!! zostały OBCIĘTE limitem ticków i wciąż były w fazie RUNNING.
!!! Rozkłady porażki niżej opisują wyłącznie runy zakończone, więc są NIEPEŁNE.

polityka: skilled
konfiguracja: 711f754c
runów: 10000
  zwycięstw: 7605 (76.0%)
  porażek:   2023 (20.2%)
  obciętych: 372 (3.7%)

moment porażki [s]  p10=478.5 p50=1029.3 p90=1715.2
cykl porażki        p10=3 p50=6 p90=10
szczyt zabudowy     p10=42 p50=43 p90=43
wydobyta ruda       p10=0 p50=0 p90=0

wyczerpanie 1. złoża: 0.0% runów, czas [s] brak danych
ubite przez słońce: 36.6% · przez wieże: 63.4%

## Polityka POCZĄTKUJĄCA — „czy początkujący ma szansę?"

polityka: beginner
konfiguracja: 711f754c
runów: 10000
  zwycięstw: 0 (0.0%)
  porażek:   10000 (100.0%)
  obciętych: 0 (0.0%)

moment porażki [s]  p10=31.1 p50=52.8 p90=120.7
cykl porażki        p10=1 p50=1 p90=1
szczyt zabudowy     p10=6 p50=11 p90=32
wydobyta ruda       p10=0 p50=30.3 p90=106.4

wyczerpanie 1. złoża: 0.0% runów, czas [s] p10=134.1 p50=134.1 p90=134.1
ubite przez słońce: 39.2% · przez wieże: 60.8%

## ZDROWIE (progi z R1 planu)

Poniżej **wyjście maszyny**, nie przepisana tabela — jedyny fragment tego dokumentu
policzony przez `assessHealth`. Przeliczony po rundzie naprawczej, na tych samych
20 000 przebiegach.

```
H1  BŁĄD  zwycięstw polityki wprawnej: 76.0% ±0.8 (n=10000 runów), próg 25–60%
H2  BŁĄD  zwycięstw polityki początkującej: 0.0% ±0.02 (n=10000 runów), próg >2% i <38.0% (połowa H1 = 76.0%)
H3  BŁĄD  mediana runu wygranego POLITYKI WPRAWNEJ: 20.2 min ±0.02 (n=7605 zwycięstw), próg 25–35 min
H4  BŁĄD  runów POLITYKI POCZĄTKUJĄCEJ ginących w cyklu 1: 94.2% ±0.5 (n=10000 runów), próg <15%
H5  NIEZMIERZONE  wymaga wyników wielu OTWARĆ — Zadanie 3
H6  NIEZMIERZONE  wymaga wyników z pulą i bez niej — Zadanie 5
```

Dwie liczby zmieniły definicję po przeglądzie i obie wychodzą tu tak samo jak przed nim,
bo początkująca nie wygrała ani razu — **różnica obudzi się dopiero w Zadaniu 3**:

- **H4 liczy udział w RUNACH, nie wśród porażek.** Plan uzasadnia je zdaniem „run kończący
  się przed pierwszą decyzją nie jest runem" — to udział w próbach gracza. Dziś oba
  mianowniki mają 10 000, bo wszystkie przebiegi są porażkami. Przy 400 zwycięstwach
  i 100 śmierciach w cyklu 1 na 1 000 runów byłoby to 10,0 % (OK) zamiast 16,7 % (BŁĄD).
- **Przedziały liczone metodą Wilsona, nie Walda.** Wald daje przy `p = 0` dokładnie zero
  niezależnie od `n`, więc pierwsza wersja wypisała „H2: 0,0 % ±0,0 (n=10000)" — i to samo
  wypisałaby po ośmiu przebiegach. Teraz H2 pokazuje ±0,02 pp przy dziesięciu tysiącach
  i ±16 pp przy ośmiu.


---

# Po strojeniu (Zadanie 3)

**Nastawa:** `killRewardScale` 1 → **0,5**, `baseRatePerPentagon` 0,25 → **0,05**.
`startingOre` i `growthPerCycle` **bez zmian** — i to też jest wynik pomiaru, nie zaniechanie.
Odcisk konfiguracji `9febf80c`. Pomiar decyzyjny: 1 000 przebiegów na politykę.

```
H1  OK    zwycięstw polityki wprawnej: 35.5% ±3.0 (n=1000 runów), próg 25–60%
H2  BŁĄD  zwycięstw polityki początkującej: 0.0% ±0.2 (n=1000 runów), próg >2% i <17.8% (połowa H1 = 35.5%)
H3  OK    mediana runu wygranego POLITYKI WPRAWNEJ: 27.3 min ±0.3 (n=355 zwycięstw), próg 25–35 min
H4  BŁĄD  runów POLITYKI POCZĄTKUJĄCEJ ginących w cyklu 1: 82.5% ±2.4 (n=1000 runów), próg <15%
H5  NIEZMIERZONE  wymaga wyników wielu OTWARĆ — Zadanie 3
H6  NIEZMIERZONE  wymaga wyników z pulą i bez niej — Zadanie 5
```

| | przed | po | próg | |
|---|---|---|---|---|
| **H1** sufit | 76,0 % (≥) | **35,5 % ±3,0** | 25–60 % | **spełnione** |
| **H2** podłoga | 0,0 % | 0,0 % ±0,2 | >2 % | bez zmian |
| **H3** mediana runu | 20,2 min | **27,3 min ±0,3** | 25–35 min | **spełnione** |
| **H4** porażki w cyklu 1 | 94,2 % | 82,5 % ±2,4 | <15 % | bez zmian |

## Co się udało: sufit i długość runu, i to jedną parą liczb

Żadna z osi osobno tego nie dawała. Stopa nagród ustawia H1 i **nie rusza H3 ani o minutę**
(23,6 → 20,3 min w całym zakresie 0,2–0,7). Tempo spawnu ustawia H3 i **rozbija H1 od dołu**
— przy 0,05 sufit spada do 16 %, bo wprawna nie wydobywa ani jednej rudy i finansuje się
wyłącznie nagrodami, więc rzadszy spawn znaczy dla niej UBÓSTWO, nie ulgę.

Rozwiązanie wyszło z połączenia: rzadziej, ale drożej. Dochód to stawka × liczba zabitych,
więc obniżenie liczby odrabia się stawką, a presja i długość runu idą za samą liczbą.
Przy 0,05 zmierzone stawki 0,5 / 0,8 / 1,2 / 1,8 dają H1 kolejno 38 / 71 / 87 / 94 %,
a H3 27,1 / 21,8 / 20,2 / 19,7 min — **0,5 jest jedynym punktem, w którym oba są w paśmie**.

`growthPerCycle` zostaje na 1,35, bo podnoszenie go psuje H3 (27,1 → 21,5 → 20,7 → 20,5 min
przy 1,35 / 1,5 / 1,65 / 1,8), a H1 też nie poprawia.

## Czego NIE dało się zrobić: podłoga

H2 i H4 nie drgnęły. To nie jest brak prób — **to wynik, i da się go uzasadnić osią po osi**:

- **`killRewardScale` nie może.** Nagrody przychodzą z zabójstw, a zabójstwa zdarzają się
  po śmierciach, które definiują H4. Zmierzone: H2 i H4 identyczne co do dziesiątej
  przy stawkach 0,2 / 0,3 / 0,4 / 0,5 / 0,7 — pięć punktów, ten sam wynik.
- **`startingOre` jest osią martwą.** 150 → 1500 kupuje 9 punktów H4 i robi to
  NIEMONOTONICZNIE (przy 600 wychodzi 98,8 %, gorzej niż przy 150). Rozstrzyga jedna liczba:
  `moment porażki p10` stoi na **~31 s we wszystkich pięciu punktach**, podczas gdy
  początkująca buduje coraz więcej (szczyt zabudowy p50: 9 → 26). Stać ją, buduje, ginie
  w tej samej sekundzie.
- **`growthPerCycle` nie może z arytmetyki.** Tempo to `baseRatePerPentagon ×
  growthPerCycle^(cykl−1)`, więc w cyklu 1 wykładnik wynosi zero i wzrost nie istnieje.
  Zmierzone dla porządku: 82,5 % przy 1,35 / 1,5 / 1,65 / 1,8 — cztery razy ta sama liczba.
- **`baseRatePerPentagon` może, ale płaci H1.** Jedyna oś, która rusza H4 (95,5 → 82,5 %).
  Moment porażki skaluje się mniej więcej jak 1/tempo (p50: 50 → 64 → 84 → 125 s), a cykl 1
  trwa 180 s. Żeby 85 % przebiegów przeżyło cykl 1, tempo musiałoby zejść poniżej ~0,02 —
  rząd wielkości pod dzisiejsze, gdzie sufit jest już rozbity.

## Przyczyna, nie objaw

`updateSpawning` liczy tempo jako `baseRatePerPentagon × growthPerCycle^(cykl−1)`. W cyklu 1
daje to **pełne natężenie fali w sekundzie zerowej**, przeciw bazie złożonej z samego CORE.
Nie ma rozbiegu wewnątrz cyklu ani okresu łaski na starcie runu.

Dlatego `moment porażki p10` jest nieczuły na pieniądze: zanim cokolwiek stanie, fala już
idzie. To nie jest liczba do przestrojenia — **to brakująca mechanika**, i wykracza poza
zakres Zadania 3, które stroi liczby oznaczone `[STROJENIE]`.

**Granica, którą trzeba znać.** H4 = 82,5 % zmierzono na `BeginnerPolicy`, która z założenia
ma być słaba. Na `SkilledPolicy` to samo kryterium daje **0,0 %**. Prawdziwy nowicjusz leży
gdzieś pomiędzy, a headless nie umie powiedzieć gdzie — to jest dokładnie ta klasa pytań,
którą §11.1 specu nazywa „progi zmierzone na słabej polityce nie są wiążące". Rozstrzygnąć
to może dopiero człowiek grający (Zadanie 7).

## Skutek uboczny: fikstury testowe były przywiązane do balansu

Strojenie oblało **szesnaście testów naraz** w pięciu plikach — i każdy z nich oblał na
swojej KONTROLI POZYTYWNEJ („przebieg naprawdę coś robił", „fikstura jest BOGATA"),
czyli zadziałały dokładnie tak, jak miały. Dowodzone niezmienniki nie drgnęły: przy tempie
0,05 w 400 tickach rodziła się jedna jednostka zamiast dziesiątek, więc „hash identyczny
przez 400 ticków" stało się prawdą o dwóch prawie pustych stanach.

Naprawa: `packages/sim/test/support/gestySpawn.ts` — jedna zamrożona nastawa dla wszystkich
fikstur, ta sama decyzja co `GOLDEN_RUN_CONFIG`. Następne strojenie balansu już ich nie ruszy.

Wyjątkiem są dwa miejsca, które mają iść za grą i zostały PRZEMIERZONE: test zwycięstwa
w `fullrun.test.ts` (seed 33 kończy teraz na ticku 35 483, nie 24 133) i liczba referencyjna
w `policy.test.ts`. **Zwycięskie otwarcie nadal wygrywa** — rozstrzygnięcie R2 trzyma.


---

# Start w nocy, świt jako pierwsza ulga (Zadanie 3, część mechaniczna)

**Nastawa:** dochodzi `sunPhaseAtStart` = **0,75** — trzy czwarte obrotu po świcie komórki
startowej, czyli **45 sekund nocy, a potem wschód**. Odcisk `321c77c8`, 1 000 przebiegów
na politykę.

```
H1  OK    zwycięstw polityki wprawnej: 37.7% ±3.0 (n=1000 runów), próg 25–60%
H2  BŁĄD  zwycięstw polityki początkującej: 0.0% ±0.2 (n=1000 runów), próg >2% i <18.9% (połowa H1 = 37.7%)
H3  OK    mediana runu wygranego POLITYKI WPRAWNEJ: 27.4 min ±0.04 (n=377 zwycięstw), próg 25–35 min
H4  BŁĄD  runów POLITYKI POCZĄTKUJĄCEJ ginących w cyklu 1: 59.8% ±3.0 (n=1000 runów), próg <15%
H5  NIEZMIERZONE  wymaga wyników wielu OTWARĆ — Zadanie 3
H6  NIEZMIERZONE  wymaga wyników z pulą i bez niej — Zadanie 5
```

| | baza | po strojeniu liczb | po dołożeniu fazy | próg |
|---|---|---|---|---|
| **H1** sufit | 76,0 % | 35,5 % | **37,7 % ±3,0** | 25–60 % ✓ |
| **H3** mediana runu | 20,2 min | 27,3 min | **27,4 min ±0,04** | 25–35 min ✓ |
| **H4** porażki w cyklu 1 | 94,2 % | 82,5 % | **59,8 % ±3,0** | <15 % |
| H2 podłoga | 0,0 % | 0,0 % | 0,0 % | >2 % |

## Faza słońca była wariancją, o której nikt nie decydował

Przed tą zmianą moment startu względem dnia **różnił się planeta od planety i to
przypadkiem**: seed 7 zaczynał w pełnym świetle, seed 101 miał przed sobą 90 sekund
ciemności, seed 33 startował o świcie. Nie było to niczyim wyborem — brało się z tego,
gdzie generator postawił komórkę startową. `sunPhaseAtStart` liczy się **względem świtu tej
komórki**, więc ta sama liczba znaczy to samo na każdej planecie, a oś daje się przemiatać.

## Hipoteza była odwrotna do prawdy

Spodziewałem się, że najlepszy jest **start o świcie** — słońce broni od razu. Pomiar to
obalił. H4 według fazy (250 przebiegów wprawnej i 1 000 początkującej na punkt):

```
  0      (dzień od razu)  92,2 %      0,625  (68 s nocy)  82,3 %
  0,125                   88,5 %      0,6875 (56 s nocy)  67,1 %
  0,25   (południe)       85,9 %      0,75   (45 s nocy)  59,8 %  ← minimum
  0,5    (zmierzch)       88,2 %      0,8125 (34 s nocy)  66,9 %
                                      0,875  (22 s nocy)  77,1 %
                                      0,9375 (11 s nocy)  89,8 %
```

Minimum jest czyste: obaj sąsiedzi dają po ~67 % przy przedziałach ±2,9, więc różnica
siedmiu punktów nie jest wahaniem próbki. **Świt od razu jest najgorszy**, bo stawia bazę
NA TERMINATORZE, tuż obok całej nocnej półkuli — a tylko ciemne pentagony spawnują (D1).
Zanim baza dojedzie w głąb dnia, jest już po wszystkim.

Najlepiej działa faza, przy której **wschód przychodzi w chwili, gdy początkujący przestaje
sobie radzić**. To jest reguła, którą gracz zobaczy: zaczynasz w nocy, pierwszy świt jest
twoją pierwszą ulgą.

## Najważniejsza liczba tej rundy nie jest w tabeli

`moment porażki` polityki początkującej, p10/p50/p90:

| | p10 | p50 | p90 |
|---|---|---|---|
| przed Zadaniem 3 | 30,9 s | 50,2 s | 117,7 s |
| **po** | **149,1 s** | **173,3 s** | **205,8 s** |

**Początkująca żyje niemal pięć razy dłużej.** I stąd bierze się cała poprawa H4: mediana
zgonu (173,3 s) leży **siedem sekund przed granicą cyklu 1** (180 s). Kryterium siedzi więc
dziś dokładnie na krawędzi — drobna dalsza poprawa przeżywalności przełoży się na duży
spadek H4, a drobne pogorszenie na duży wzrost. To też znaczy, że `rotationPeriod` przestał
być neutralny: ta sama liczba wyznacza i długość dnia, i to, co znaczy „cykl 1".

## Czego nadal nie ma

H2 stoi na zerze. Początkująca przeżywa teraz pierwszy cykl w 40 % przebiegów, ale nie
wygrywa **ani razu na tysiąc**. Podłoga przesunęła się z „ginie zanim zacznie" na „gra
i przegrywa" — to postęp w tę stronę, w którą trzeba, ale kryterium wymaga, żeby czasem
wygrała, a do tego potrzeba czegoś innego niż przeżycie pierwszej nocy.


---

# H5: ile różnych otwarć wygrywa (Zadanie 3, Krok 3)

**Odpowiedź: jedno. Próg wymaga trzech.**

```
H1  OK    zwycięstw polityki wprawnej: 37.7% ±3.0 (n=1000 runów), próg 25–60%
H2  BŁĄD  zwycięstw polityki początkującej: 0.0% ±0.2 (n=1000 runów), próg >2% i <18.9% (połowa H1 = 37.7%)
H3  OK    mediana runu wygranego POLITYKI WPRAWNEJ: 27.4 min ±0.04 (n=377 zwycięstw), próg 25–35 min
H4  BŁĄD  runów POLITYKI POCZĄTKUJĄCEJ ginących w cyklu 1: 59.8% ±3.0 (n=1000 runów), próg <15%
H5  BŁĄD  otwarć wygrywających ≥20% seedów: 1, próg ≥3
H6  NIEZMIERZONE  wymaga wyników z pulą i bez niej — Zadanie 5
```

| otwarcie | zwycięstw z 250 | szczyt zabudowy p10/p50/p90 |
|---|---|---|
| **laserowe (znana linia)** | **36,8 %** | 5 / 39 / 43 |
| kinetyczne | 0,0 % | 6 / 6 / 7 |
| mur najpierw | 0,0 % | 12 / 16 / 19 |
| ekonomiczne | 0,0 % | 5 / 7 / 29 |
| czapy na pentagonach | 0,0 % | 6 / 10 / 22 |

§11.1 zmierzył przed strojeniem, że „otwarcie dopuszcza dokładnie jedną linię". **Po całym
strojeniu Zadania 3 to nadal prawda** — i to jest najmocniejszy wynik tego kroku, bo
strojenie miało tę wadę ruszyć.

## Trzy z pięciu pierwszych szkiców były ZEPSUTE, nie przegrane

Pokazała to jedna liczba: `szczyt zabudowy p10 = p50 = p90`. Polityka stawia pozycje
kolejki po kolei i **nie przeskakuje** tej, na którą jej nie stać — więc otwarcie żądające
czegoś drogiego przed pierwszym dochodem staje na zawsze, na każdej planecie w tym samym
miejscu. Wariant kinetyczny prosił o cztery wieże (pobór 12) przed pierwszym panelem przy
wydajności CORE równej 10: wieże gasły, nic nie ginęło, nie było z czego kupić panelu.

**Zero zwycięstw z takiego przebiegu nie jest wynikiem o grze, tylko o szkicu — a wygląda
identycznie.** Po przeprojektowaniu trzy z nich zaczęły grać naprawdę (szczyt zabudowy
zaczął się różnić między planetami) i **nadal przegrywają wszystkie 250 przebiegów**.

Próbowałem zamienić to w sito statyczne („pobór nie może przekroczyć wydajności CORE przed
pierwszym panelem"). **Połówka „ma przejść" obaliła regułę natychmiast:** znana linia prosi
o dwa lasery, pobór 24 przy wydajności 10, i jako jedyna wygrywa — przeżywa, bo CORE ma
magazyn 200, a brownout zrzuca obciążenie w ustalonej kolejności, więc deficyt jest kryty
z zapasu dokładnie tak długo, żeby zdążyły stanąć panele. Warunek jest DYNAMICZNY, a sito,
które go udaje, odrzuciłoby jedyną działającą linię.

## Co naprawdę rozstrzyga: ZASIĘG, nie obrażenia

Najostrzejsza para w tym pomiarze. Za 150 rudy startowej można kupić:

| | koszt | dps | zasięg | pobór | wynik |
|---|---|---|---|---|---|
| 1 × LASER_TURRET (+50 zapasu) | 100 | 60 | **3** | 12 | **36,8 % zwycięstw** |
| 3 × KINETIC_TURRET | 150 | **75** | 2 | **9** | 0,0 % |

Kinetyczne mają **więcej obrażeń i mniejszy pobór**, a mimo to nie potrafią uruchomić
ekonomii: zabudowa staje na szóstym budynku. Jedyną istotną różnicą zostaje **zasięg 3
wobec 2**. Wieża sięgająca dalej trafia jednostki, zanim dojdą do muru, i to ona — a nie
siła ognia — decyduje, czy run w ogóle wystartuje.

To nie jest wada balansu w sensie „za mocny laser". To jest **wąskie gardło projektowe**:
dopóki tylko jeden budynek ma zasięg 3, każde otwarcie musi się od niego zacząć, a H5 nie
ma jak zostać spełnione.

## Wniosek, który wychodzi poza strojenie liczb

Cztery hipotezy padły z czterech różnych powodów i wszystkie prowadzą do tego samego:

- **kinetyczne** — zasięg 2 nie zarabia (opisane wyżej),
- **mur najpierw** — barykady nie zabijają, więc opóźniają falę, nie finansując obrony,
- **ekonomiczne** — ekstraktory są zbyt wolne: cztery z nich wydobywają mniej, niż
  w tym samym czasie daje jedna wieża w nagrodach. Ekonomia wydobywcza pozostaje martwa
  dokładnie tak, jak w raporcie bazowym,
- **czapy** — zatkanie pentagonów zamienia strumień na erupcje, ale kosztuje 75 rudy
  w momencie, w którym każdy grosz jest potrzebny na wieżę.

Wspólny mianownik: **w tej grze istnieje jedno źródło pieniędzy (nagrody za zabicie)
i jeden budynek, który je otwiera (laser).** Dopóki tak jest, wariantów otwarcia nie będzie,
niezależnie od tego, jak ustawione są liczby.


---

# Druga wieża: urwisko AOE (Zadanie 3, runda naprawcza)

**Nastawa:** `KINETIC_TURRET` — `SINGLE`, zasięg 2, dps 25 → **`AOE`, zasięg 3, dps 20**.
Koszt (50) i pobór (3) bez zmian. Odcisk `321c77c8`, 1 000 przebiegów na politykę.

```
H1  OK    zwycięstw polityki wprawnej: 37.7% ±3.0 (n=1000 runów), próg 25–60%
H2  BŁĄD  zwycięstw polityki początkującej: 0.0% ±0.2 (n=1000 runów), próg >2% i <18.9% (połowa H1 = 37.7%)
H3  OK    mediana runu wygranego POLITYKI WPRAWNEJ: 27.4 min ±0.04 (n=377 zwycięstw), próg 25–35 min
H4  BŁĄD  runów POLITYKI POCZĄTKUJĄCEJ ginących w cyklu 1: 37.2% ±3.0 (n=1000 runów), próg <15%
H5  BŁĄD  otwarć wygrywających ≥20% seedów: 2, próg ≥3
H6  NIEZMIERZONE  wymaga wyników z pulą i bez niej — Zadanie 5
```

| | baza | po strojeniu liczb | po starcie w nocy | **po drugiej wieży** | próg |
|---|---|---|---|---|---|
| **H1** sufit | 76,0 % | 35,5 % | 37,7 % | **37,7 % ±3,0** | 25–60 ✓ |
| **H3** mediana runu | 20,2 min | 27,3 | 27,4 | **27,4 min ±0,04** | 25–35 ✓ |
| **H4** porażki w cyklu 1 | 94,2 % | 82,5 % | 59,8 % | **37,2 % ±3,0** | <15 |
| **H5** wygrywające otwarcia | 1 | 1 | 1 | **2** | ≥3 |
| H2 podłoga | 0,0 % | 0,0 % | 0,0 % | 0,0 % | >2 % |

## Diagnoza „rozstrzyga zasięg" była BŁĘDNA

Poprzednia sekcja tego dokumentu twierdziła, że wąskim gardłem jest zasięg. **Pomiar to
obalił:** podniesienie zasięgu kinetycznej z 2 na 3 przy zachowanym `SINGLE` dało dalej
**0,0 %** zwycięstw. Zmierzone wszystkie cztery rogi:

```
  SINGLE zasięg 2 (stara nastawa)   0,0 %        AOE zasięg 1    0,0 %
  SINGLE zasięg 3                   0,0 %        AOE zasięg 2    0,0 %
                                                 AOE zasięg 3   80,4 %  (przy dps 25)
```

**To urwisko, nie zbocze.** Potrzeba AOE **i** zasięgu 3 naraz; każde z osobna daje zero.
Powód jest w `updateCombat`: `AOE` zadaje obrażenia KAŻDEJ jednostce w zasięgu, `SINGLE`
dokładnie jednej. W cyklu 1 fala to same SWARM-y (`armorFromCycle: 5`), więc przeciw tłumowi
przewaga AOE równa się liczebności tłumu — **żadna wartość `dps` tego nie nadrabia**.

## Kalibracja do PARYTETU, nie do dominacji

Przy dps 25 druga linia wygrywała 80,4 %, czyli ponad dwa razy więcej niż laserowa — to nie
alternatywa, tylko zastąpienie. Zmierzone po 250 przebiegów na punkt, **z linią laserową
jako kontrolą** (nie używa tej wieży, więc nie ma prawa drgnąć):

```
  dps 12 → kinetyczne  0,0 %   laserowe 36,8 %
  dps 20 → kinetyczne 35,2 %   laserowe 36,8 %   ← wybrane
  dps 25 → kinetyczne 80,4 %   laserowe 36,8 %
```

Kontrola trzymała na wszystkich trzech punktach. 35,2 % wobec 37,7 % przy przedziałach
±6 pp to **parytet**, czyli dokładnie to, czym druga linia ma być.

## Skutek uboczny, którego nie planowałem: H4 spadło o 22 punkty

`BeginnerPolicy` stawia wieże wcześnie, więc dostała tę poprawę za darmo. `moment porażki`
początkującej: p10 **154,6 s**, p50 **190,5 s** — **mediana zgonu przekroczyła granicę
cyklu 1** (180 s), i stąd spadek H4 z 59,8 na 37,2 %.

Cała droga tego kryterium przez Zadanie 3: **94,2 → 82,5 → 59,8 → 37,2 %**, przy czym każdy
krok pochodził z innej klasy zmiany — strojenie liczb, mechanika startu, projekt budynku.

## Cena: tryb `SINGLE` nie ma już ANI JEDNEGO użytkownika

Obie wieże są teraz AOE i różnią się wyłącznie liczbami (tania, słaba, oszczędna w energii
wobec drogiej, mocnej, prądożernej). Gałąź `SINGLE` w `updateCombat` — razem z deterministycznym
wyborem celu po najniższym id, który był osobną naprawą — stała się **nieosiągalna z gry**.
Nie jest skasowana: `combat.test.ts` niesie strażnika, który oblewa w dniu, w którym ktoś
doda budynek z tym trybem, i wskazuje, jakie pokrycie trzeba przywrócić.

Alternatywą było zostawić `SINGLE` i dać mu niszę — ale nisza pojedynczego celu (ARMOR,
250 hp) otwiera się dopiero w cyklu 5, czyli długo po tym, jak run się rozstrzyga.
**To jest decyzja projektowa do rewizji, nie zamknięta sprawa.**

## Przy okazji: złoty hasz był ŚLEPY na kinetyczną

Kontrola pozytywna, której wcześniej nie było: podmiana `KINETIC_TURRET.dps` na **999**
nie zmieniała trajektorii ani o bit. `BROWNOUT_ORDER` zrzuca kinetyczną przed laserami,
a złoty scenariusz miał popyt 51,5 przy produkcji 10 — wieża nie oddała ani jednego strzału
przez 1200 ticków, a hasz twierdził, że strzeże silnika.

Znalazły się przy tym dwie rzeczy naraz: skrypt deklarował siedem pozycji, a stawiał sześć,
bo `slot % free.length` zawijało się na puli sześciu sąsiadów CORE i nadmiarowe budowy
trafiały w zajęte komórki, gdzie `canBuild` odrzucał je **po cichu**. Naprawione: każdy slot
ma własną komórkę, doszły dwa panele (kaskada brownoutu zostaje — w dzień podaż rośnie,
w nocy zrzut wraca). Po naprawie mutacja `dps → 999` trajektorię rusza.
