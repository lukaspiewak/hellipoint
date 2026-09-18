# Pierwszy grywalny przebieg — świadectwo, NIE werdykt

**Data:** 2026-09-18. **Gałąź:** `faza-2c`, po Zadaniu 5. **Kamień milowy §9.**

> **To jest ŚWIADECTWO, nie werdykt.** Zapis tego, co się stało, kiedy run przeszło się
> od startu do końca — po raz pierwszy w tym projekcie. Werdykt o czytelności należy do
> bramki z Zadania 6 i do człowieka; werdykt o balansie należy do Fazy 3, która ma do tego
> headless i tabelę `[STROJENIE]`. Żadnej z tych rzeczy ten dokument nie rozstrzyga.

## 1. Przebieg zagrany w przeglądarce

`localhost:5185`, okno 773×482, `DEFAULT_RUN`, planeta domyślna.

| | |
|---|---|
| Koniec | **DEFEAT** w ticku **903**, czyli **45,2 s** |
| Cykl | 1 z 10 |
| Co zbudowałem | 3 × `KINETIC_TURRET` (komórki 1173, 484 i sąsiednia), ręcznie, klawiszem `6` i lewym przyciskiem |
| Ruda na końcu | 26 (start 150) |
| Jednostek na planszy w chwili końca | 48 |
| Co zakończyło run | `SWARM` — **napisane na ekranie**, nie wyprowadzone |

Ekran końca: `PRZEGRANA — Core zniszczony przez SWARM`, wyróżniony pas na górze panelu.
Nagłówek obok: `komendy nie są przyjmowane — run zakończony (DEFEAT)`.

**Co ten przebieg potwierdził jako DZIAŁAJĄCE** (obejrzane, nie wywnioskowane z testów):

- Odliczanie do ewakuacji stoi przy powodzie odmowy:
  `9 EVACUATION_MODULE 300  jeszcze zamknięty — otwiera się w ostatniej tercji runu (za 17:38)`
  i schodzi w dół razem z runem (17:38 → 17:21 w ciągu kilkunastu sekund).
- Skrót „wróć do Core" (spacja) parkuje Core na środku płótna.
- Budowa lewym przyciskiem, wybór typu cyframi, meldunek w nakładce
  (`buduję KINETIC_TURRET na komórce 1173`).
- Po `DEFEAT` menu przestaje przyjmować komendy i **mówi o tym**, zamiast milczeć.
- Przy tym oknie żaden wiersz panelu się nie zawijał.

## 2. Dwanaście przebiegów headless, dla tła

`tools/headless`, `DEFAULT_RUN`, seedy 1–12, bot `ScriptedPolicy` z Fazy 1C.

| Wynik | Liczba |
|---|---|
| DEFEAT | **12 z 12** |
| VICTORY | 0 |
| obcięte limitem ticków | 0 |

Czas do porażki: **33,1 s – 122,7 s** (mediana ok. 55 s). Wszystkie w **cyklu 1**.
Szczyt zabudowy 7–26 budynków. Sprawca: **SWARM we wszystkich dwunastu**.

**Dlaczego zawsze SWARM, i dlaczego to NIE jest artefakt pomiaru:** `DEFAULT_SPAWN` ma
`disruptorFromCycle: 3` i `armorFromCycle: 5`, a żaden z tych przebiegów nie wyszedł poza
cykl 1 — w cyklu 1 nie ma się od czego zginąć poza rojem. Reguła „ostatni sprawca w ticku
wygrywa" nie miała tu z czym konkurować.

## 3. Jedna liczba, którą warto zapamiętać

Ewakuacja odblokowuje się w ticku **21 600**, czyli po **1080 s**. Najdłuższy z trzynastu
przebiegów (dwunastu botowych i mojego) skończył się w **122,7 s** — czyli na **11 %** drogi
do momentu, w którym zwycięstwo w ogóle staje się możliwe. Mój własny: na **4 %**.

**Czego to NIE znaczy.** Że gra jest za trudna — tego ten pomiar nie mówi. Bot z Fazy 1C
jest celowo prosty (stawia wg skryptu, nie broni się), a ja grałem pierwszy raz i postawiłem
trzy wieże. Zmierzone jest to, że **ani bot, ani niewprawny człowiek nie zbliżają się do
warunku zwycięstwa** — a to jest pytanie do tabeli `[STROJENIE]` w Fazie 3, gdzie headless
ma ją wyznaczyć, a nie do Fazy 2C.

**Czego to NA PEWNO znaczy:** ścieżka zwycięstwa (`evacCharge` → alarm → `VICTORY`) nie
została w tym projekcie jeszcze ANI RAZU przejechana od startu do końca w normalnym biegu.
Testy ją pokrywają (`rules.test.ts`, blok 35), obejrzana nie była.

## 4. Co z tego wynika dla Zadania 6

Bramka czytelności PRZYCZYNOWEJ potrzebuje przebiegów, w których jest co czytać.
Przy medianie 55 s i śmierci w cyklu 1 scenariusze Q3 (brownout od czwartej wieży) i Q4
(EMP `DISRUPTOR`-a, od cyklu 3) **nie wystąpią same z siebie** — trzeba je ustawić stanem,
tak jak robią to testy, albo wydłużyć przebieg konfiguracją. To jest wejście do Zadania 6,
nie usterka.
