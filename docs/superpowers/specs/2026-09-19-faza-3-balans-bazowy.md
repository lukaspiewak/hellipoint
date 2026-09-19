# Raport bazowy Fazy 3 — punkt odniesienia dla strojenia

**Data:** 2026-09-19. **Gałąź:** `faza-3`. **20 000 przebiegów** (10 000 na politykę),
8 procesów, **126 minut**. Konfiguracja: `DEFAULT_RUN`, odcisk `711f754c`.

> **Ten dokument ma być OBLANY.** Jest punktem odniesienia, wobec którego mierzy się
> Zadanie 3. Raport wychodzący tu zdrowy znaczyłby, że progi z R1 są za luźne.

## Wynik: cztery kryteria oblane, dwa niezmierzone

| | zmierzone | próg | |
|---|---|---|---|
| **H1** sufit (wprawna) | **76,0 % ±0,8** | 25–60 % | **za wysoko** |
| **H2** podłoga (początkująca) | **0,0 %** | ≥2 % i ≤38 % | **za nisko** |
| **H3** mediana runu wygranego | **20,2 min** | 25–35 min | **za krótko** |
| **H4** porażki w cyklu 1 (początkująca) | **94,2 % ±0,5** | <15 % | **za dużo** |
| H5 różne wygrywające otwarcia | — | ≥3 | niezmierzone (Zadanie 3) |
| H6 dominacja ulepszenia | — | <10 pp | niezmierzone (Zadanie 5) |

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
