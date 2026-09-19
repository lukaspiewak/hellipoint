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
