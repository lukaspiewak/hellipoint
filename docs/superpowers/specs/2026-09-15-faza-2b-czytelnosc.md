# Faza 2B, Zadanie 1 — bramka, która naprawdę bada D1

Dokument wyników. Powstał, bo bramka Fazy 2A **mierzyła inną zdolność, niż deklarowała**
(spec `2026-09-15-faza-2a-czytelnosc.md`, §7.3.1 i §7.3.3), a na jej wyniku stał werdykt na
D1 — filarze, z którego biorą się spawn, spalanie i cała ekonomia dnia i nocy.

**Werdykt na D1 wydaje CZŁOWIEK, nie wykonawca.** §7 tego dokumentu jest celowo pusta.
Wykonawca zbudował i sprawdził przyrząd; §8 zapisuje jego własny przebieg — jako pomiar
czułości instrumentu, **nie jako werdykt**.

---

## 1. Co było nie tak z bramką 2A

Bramka 2A pokazywała **dwa** znaczniki na dwóch **sąsiadujących** komórkach i pytała, który
leży na oświetlonej. Przeszła 15/15.

Pytanie było **lokalne**: sprowadza się do „wskaż jaśniejszą", co jest rozwiązywalne przy
**dowolnej** monotonicznej palecie — także przy cieniowaniu, które Faza 0 zmierzyła jako
nieczytelne. Właściciel projektu zauważył to, przełączywszy tryb porównawczy; pomiar
potwierdził (odległość barwna pary: progowana 0,90, gładka 0,03–0,08 — niezerowa i zawsze w
tę samą stronę).

D1 mówi o czytelności **globalnej**: „spójrz na kulę i zobacz, GDZIE biegnie granica".
Zaobserwowane wprost na żywym renderze: w trybie progowanym granica jest widoczna **jako linia
przez całą tarczę**; w trybie ciągłym ta linia **znika całkowicie**, a pary sąsiadów
pozostają rozróżnialne. Pytanie globalne rozróżnia oba tryby. Lokalne nie.

Do tego kontrola pozytywna 2A **nie mogła oblać**: zmieniała mapowanie palety, zostawiając
komórki płaskimi, więc nie odtwarzała awarii Fazy 0 (kolor interpolowany po powierzchni).

---

## 2. Wybrany kształt pytania: JEDNA komórka, odpowiedź binarna

Brief dawał dwa warianty. Zaimplementowany jest **wariant 2 — klasyfikacja bez sąsiadki**:
pokazujemy **jeden** pierścień wokół **jednej** komórki i pytamy, po której stronie granicy
leży. Odpowiedź: „Oświetlona" albo „Ciemna (noc)".

### 2.1 Dlaczego ten

1. **Odbiera strategię, która zepsuła bramkę 2A.** Bez drugiej komórki w kadrze nie ma czego
   z czym porównać, więc „wskaż jaśniejszą" przestaje być odpowiedzią. Jedyną informacją,
   która rozstrzyga, jest położenie granicy — własność globalna.
2. **Ocena zostaje binarna i bezdyskusyjna.** To była realna zaleta konstrukcji 2A i nie ma
   powodu jej tracić: nie trzeba definiować, co znaczy „trafił".
3. **Podłoga zgadywania zostaje policzalna.** Plan jest zrównoważony (8 komórek oświetlonych,
   7 ciemnych z piętnastu), więc najlepsza stała odpowiedź daje 8/15, a komplet przez
   zgadywanie ma prawdopodobieństwo 0,5¹⁵ ≈ 0,00003.
4. **Wada wariantu jest usuwalna jednym warunkiem.** „Przy komórce daleko od granicy pytanie
   jest trywialne" — więc **każda** komórka planu przylega do granicy (ma sąsiada po drugiej
   stronie, odległość 1 w grafie). Pilnuje tego test `terminatorPairs.test.ts` #18.

### 2.2 Dlaczego odrzucony wariant 1 (wskazanie linii)

Wskazanie linii mierzy dosłownie to, co mówi D1 — i to jest jego prawdziwa zaleta. Odrzucony
z czterech powodów, z których dwa są mocniejsze niż te wymienione w briefie:

1. **Nie ma zdefiniowanej podłogi zgadywania.** Policzone dla tej planety: średnica komórki
   przy `frequency 12` to ≈ 0,100 promienia, więc pas szerokości 5 komórek wzdłuż koła
   wielkiego ma pole `2πR · 0,5R = 3,15 R²` wobec `4πR² = 12,57 R²` całej sfery — **około
   25%**, a na rzucie widocznej półkuli z terminatorem pośrodku jeszcze więcej. Kryterium
   „klik w granicach 2 kroków" spełniałby więc znaczny ułamek ślepych kliknięć. Odpowiednika
   dla 0,5¹⁵ nie ma.
2. **Kryterium PASS byłoby strojoną stałą.** „Odchylenie ≤ k kroków" nie ma zasadnego `k`, a
   `k` dobierałoby się po zobaczeniu danych. Ta gałąź ma już na koncie asercje relacyjne,
   które poruszają się razem ze stałą, którą sprawdzają — to byłaby ta sama wada, tylko na
   poziomie całej bramki.
3. **Wynik zależy od zoomu**, którym człowiek swobodnie steruje (K1, 1,3–8 promieni). Liczba
   komórek na piksel zmienia się z nim, więc dwie sesje dają liczby nieporównywalne.
4. **Nie usuwa strategii lokalnej, tylko ją ukrywa.** „Kliknij na linii" da się wykonać
   wodząc wzrokiem po dowolnej widocznej nieciągłości koloru — to nadal wskazówka lokalna,
   tylko nikt jej nie mierzy.

### 2.3 Czego ta bramka NIE rozstrzyga (zapisane, żeby nikt nie rozciągnął wyniku)

W trybie progowanym odpowiedź czyta się z **własnej barwy** zaznaczonej komórki (granat
kontra pomarańcz). Bramka orzeka więc: *każda komórka przy granicy jest z renderu poprawnie
przypisywalna do swojej strony*. To jest złożenie, z którego składa się granica — zbiór
krawędzi między poprawnie sklasyfikowanymi komórkami — ale **nie** orzeka, że linia jest
estetycznie wyrazista ani że paleta jest docelowa. To zostaje Fazie 4.

---

## 3. Kontrola pozytywna — i dowód, że POTRAFI oblać

> **RUNDA 1 — KOREKTA.** Pierwsza wersja tej kontroli używała `saturate(dot)` i **nie oblała**:
> właściciel projektu dostał w niej **14/15**. Poniższy opis jest już po naprawie; przebieg
> naprawy i to, co dokładnie przeciekało, zapisuje §3.4.

`packages/render/src/positiveControl.ts`. Odtwarza awarię Fazy 0 na dwóch warstwach naraz:

1. **Wierzchołki WSPÓŁDZIELONE.** Jeden wierzchołek na komórkę (jej środek), trójkąty łączą
   środki trzech wzajemnie sąsiadujących komórek — siatka dualna do goldbergowej.
   Zmierzone: **1442 wierzchołki, 2880 trójkątów**, czyli dokładnie `2V − 4` ze wzoru Eulera
   (i `V − E + F = 2` policzone z faktycznie zapisanych trójkątów — test `positiveControl.test.ts` #2).
   Każdy wierzchołek należy do 5 (pentagon) albo 6 (heksagon) trójkątów.
2. **Kolor per wierzchołek wg `(dot + 1) / 2`, BEZ PRZYCIĘCIA**, liczony samodzielnie z
   normalnych komórek i `sunDir` — **nie** z `lightField`, które jest już przycięte.

Razem: na całej powierzchni **nie ma ani jednej nieciągłości koloru (C⁰)**, **ani jednego
obszaru jednolitego**, ani załamania pochodnej. Jasność narasta gładko od antypody słońca
(wartość 0) do punktu podsłonecznego (wartość 1), a terminator jest izolinią `0,5` —
nieodróżnialną od każdej innej.

Nawinięcie trójkątów jest **naprawiane, nie zakładane**: bez poprawki **1440 z 2880** wyszłoby
zwróconych do wewnątrz, a `MeshBasicMaterial` rysuje tylko przednie ściany — dziura w kontroli
sama zdradzałaby położenie.

### 3.1 Miara, która złapała przeciek: komórki jednolite z całym sąsiedztwem

Liczba komórek, których kolor jest nieodróżnialny od koloru **wszystkich** sąsiadów — czyli
leżących we wnętrzu jednolitej łaty. Zmierzone na planecie bramki, trzy fazy:

| odwzorowanie | faza 1 | faza 2 | faza 3 |
|---|---|---|---|
| `saturate(dot)` — kontrola sprzed korekty | **673** | **650** | **650** |
| `(dot + 1) / 2` — kontrola po korekcie | **0** | **0** | **0** |
| render gry (progowany), dla skali | 1174 | — | — |

Przypięte testem `positiveControl.test.ts` #11, asercją **bezwzględną** (`toBe(0)`), z kontrolą
pozytywną liczącą tę samą wielkość dla starego odwzorowania (musi wyjść 673).

### 3.2 Druga połowa przecieku: załamanie pochodnej

`saturate` daje zero po stronie nocnej i dodatnią pochodną po oświetlonej — kolor jest ciągły,
ale **gradient skacze**, a oko czyta nieciągłość gradientu jako krawędź. Miara: iloraz
średniego kroku barwnego na krawędziach przez terminator do średniego kroku na wszystkich
krawędziach.

| odwzorowanie | krok przez granicę / krok typowy |
|---|---|
| `saturate(dot)` | **2,78×** |
| `(dot + 1) / 2` | **1,56×** |

Przypięte testem #12. **Reszty ponad 1,0 nie da się usunąć** i jest to zapisane jako granica
tej konstrukcji, nie defekt: `dot = cos θ` ma maksymalne nachylenie dokładnie przy `θ = 90°`,
więc terminator jest izolinią o największym gradiencie dla **każdego** gładkiego,
monotonicznego odwzorowania `dot`. To jest własność geometrii kuli, nie palety.

### 3.3 DOWÓD, ŻE KONTROLA DZIAŁA: przebiegi wykonawcy

Wszystkie przebiegi oceniane **z widoku całej tarczy**, zgodnie z punktem 5 protokołu.
Plany kontrolne były wykonawcy nieznane (rozłączne komórki; do przebiegów po korekcie użyto
dodatkowych przesunięć planu, bo prawdę dla przesunięcia 2 wykonawca już widział).

| przebieg | odwzorowanie kontroli | wynik | podłoga zgadywania |
|---|---|---|---|
| kontrola, runda 0 | `saturate(dot)` | 8/15 (53%) | 50% |
| **kontrola, po korekcie** | `(dot + 1) / 2` | **5/15 (33%)** | 50% |
| kontrola, po korekcie (przebieg przerwany przeładowaniem strony) | `(dot + 1) / 2` | 5/13 (38%) | 50% |
| **tryb oceniany (progowany)** | — | **15/15** | 50% |

Łącznie po korekcie: **10/28 (36%)** w kontroli, wobec **15/15** w trybie ocenianym.

**Co widać w nowej kontroli:** tarcza jest niemal jednolicie jasnokremowa, z gradientem tak
łagodnym, że na oko nie do wychwycenia. **Nie ma ciemnej połowy, nie ma krzywej, nie ma
żadnej krawędzi** — ani ostrej, ani rozmytej. Pierścień za każdym razem stoi na obszarze
wyglądającym identycznie jak reszta kuli. To jest jakościowo inny obraz niż przed korektą,
gdzie wyraźnie widać było granatową półkulę i jej krawędź.

**Wniosek: bramka POTRAFI wyprodukować odpowiedź „nie widzę".**

### 3.4 Zapis korekty: odtworzony został WZÓR, a nie WŁASNOŚĆ

Pierwsza wersja kontroli używała `saturate(dot)` — tego samego wzoru, którego używa
`lightAt` w symulacji — z uzasadnieniem „prototyp Fazy 0 co do joty". **To było błędem, i to
nie drobnym.** Przycięcie ścina całą półkulę nocną do jednej wartości, więc noc jest jedną
jednolitą łatą, **a krawędź tej łaty JEST terminatorem**. Interpolacja po powierzchni zaciera
tę krawędź lokalnie o mniej więcej komórkę — dlatego wykonawca, oceniając z bliska, dostał
poziom zgadywania (8/15) i uznał kontrolę za działającą; właściciel projektu, oceniając z
widoku całej tarczy (czyli zgodnie z protokołem, który wykonawca sam napisał), zobaczył
krawędź natychmiast i dostał 14/15.

**Lekcja, która wykracza poza tę kontrolę:** własność, która czyniła render Fazy 0
nieczytelnym, brzmi „terminator nie ma żadnej cechy szczególnej". Wzór z przycięciem tej
własności nie ma — daje terminatorowi dwie cechy naraz (krawędź obszaru jednolitego i
załamanie pochodnej). Odtwarzanie wzoru zamiast własności jest tym samym rodzajem pomyłki,
co test nazwany od zachowania, którego nieobecności nie wykryje.

Zabezpieczenie na przyszłość jest w typie: `writeSmearedColors` **nie przyjmuje już pola
światła**, tylko `sunDir`, i liczy iloczyn skalarny sama. Przycięcie nie ma którędy wrócić.

### 3.5 Trzeci tryb (gradient, płaskie komórki) — i co z zestawienia wynika

`setMode('smooth')` zostaje jako trzeci punkt odniesienia: zmienia **tylko** mapowanie palety,
zostawiając komórki płaskimi. Obejrzane na żywo: komórki są widoczne jako osobne łaty o lekko
różnych odcieniach, ale **linii nie ma** — dokładnie jak opisuje §7.3.3 specu 2A.

| tryb | geometria | kolor | co widać |
|---|---|---|---|
| `threshold` | osobne wierzchołki | progowany | **linia przez całą tarczę** |
| `smooth` | osobne wierzchołki | gradient `saturate(dot)` | płaskie łaty, granicy nie widać |
| `control` | **współdzielone** | `(dot+1)/2` per wierzchołek | jednolita jasna tarcza, nic |

Uwaga, która wynika z nowego pytania i której stare nie mogło pokazać: przy pytaniu
**globalnym** także tryb `smooth` przestaje być odpowiadalny — a przy pytaniu **lokalnym**
z Fazy 2A był (15/15 było w nim osiągalne).

## 4. `LIGHT_BANDS[0]` obniżone do zera — pomiar po zmianie

Decyzja rozstrzygnięta w briefie; tutaj jest jej pomiar i mechanika.

### 4.1 Mechanika: dlaczego samo „0" nie wystarczyło

`lightBand` liczyło progi porównaniem **nieostrym** (`light >= próg`). Przy progu zerowym
`0 >= 0` jest prawdą, więc pasmo nocy byłoby **puste**, a cała noc wpadłaby do pasma
zmierzchu. Porównanie zmieniono więc na **ścisłe** (`light > próg`), i dopiero to daje

    lightBand(l) === 0   ⟺   !(l > 0)   ⟺   l === 0

czyli dokładnie negację predykatu `light[cellId] > 0`, którym symulacja rozstrzyga spawn
(`spawning.ts`), spalanie (`burning.ts`) i ruch (`movement.ts`). Zgodność jest **algebraiczna,
nie empiryczna**.

Próg **dodatni, choćby mikroskopijny**, tej własności nie ma: najmniejsze dodatnie `light`
zmierzone na tej planecie przez 12 faz wynosi **6,3 · 10⁻¹⁸**, więc nawet próg 10⁻⁷
zostawiłby komórki po złej stronie. Skutek uboczny dla drugiego progu jest mikroskopijny i
przyjęty świadomie: `light === 0,4` należy teraz do pasma niższego.

### 4.2 Rozkład pasm i rozjazd render↔symulacja (zmierzone kodem produkcyjnym)

`createPlanet({ seed: 20260915 })`, `frequency` domyślne (12), 1442 komórki,
`LIGHT_BANDS = [0; 0,4]`. „ROZJAZD" = liczba komórek, dla których `lightBand(light) >= 1`
nie zgadza się z `light > 0`.

| faza (t/T) | pasmo 0 (noc) | pasmo 1 (zmierzch) | pasmo 2 (dzień) | symulacja: oświetlonych | ROZJAZD |
|---|---|---|---|---|---|
| 0/12 | 745 | 264 | 433 | 697 | **0** |
| 1/12 | 722 | 283 | 437 | 720 | **0** |
| 2/12 | 722 | 295 | 425 | 720 | **0** |
| 3/12 | 722 | 287 | 433 | 720 | **0** |
| 4/12 | 722 | 295 | 425 | 720 | **0** |
| 5/12 | 722 | 283 | 437 | 720 | **0** |
| 6/12 | 722 | 287 | 433 | 720 | **0** |
| 7/12 | 722 | 283 | 437 | 720 | **0** |
| 8/12 | 722 | 295 | 425 | 720 | **0** |
| 9/12 | 722 | 287 | 433 | 720 | **0** |
| 10/12 | 722 | 295 | 425 | 720 | **0** |
| 11/12 | 722 | 283 | 437 | 720 | **0** |

Trzy fazy bramki (`t/T ∈ {0; 1/3; 2/3}`): `[745, 264, 433]`, `[722, 295, 425]`,
`[722, 295, 425]` — **rozjazd 0 w każdej**.

**Rozjazd wynosi zero przy każdej zmierzonej fazie.** Przed zmianą (próg 0,05) wynosił 8–38
komórek, średnio 30,8, zawsze o dokładnie jeden krok grafu. Jednokomórkowy pierścień, w
którym gracz widział noc, a jednostki się paliły i pentagony nie spawnowały, **zniknął**.

Zmiana rozkładu przy `sunDirection(0, 180)`: `753 / 256 / 433` → `745 / 264 / 433`. Osiem
komórek przeszło z nocy do zmierzchu — dokładnie te, które wpadały w szczelinę
`0 < light < 0,05` w tej fazie. Pasmo 0 liczy teraz dokładnie tyle komórek, ile symulacja
uznaje za nieoświetlone (745 = 1442 − 697).

Pomiar jest przypięty jako test regresji: `shading.test.ts` #18, na wszystkich 1442 komórkach
× 12 fazach, z predykatem symulacji wpisanym **dosłownie** (nie wyprowadzonym z `LIGHT_BANDS`,
żeby asercja nie poruszała się razem ze stałą, którą sprawdza) i z kontrolą pozytywną
pokazującą, że ten sam licznik daje 8 dla starego progu.

### 4.3 Odległości barwne przez granicę, `sunDirection(0, 180)`

| para (jasna, ciemna) | progowany | gradient, płaskie | kontrola (współdzielone) |
|---|---|---|---|
| (168, 11) | 0,9005 | 0,0655 | 0,0655 |
| (191, 180) | 0,9005 | 0,0655 | 0,0655 |
| (1174, 472) | 0,9005 | 0,1185 | 0,1185 |
| (1371, 687) | 0,9005 | 0,1224 | 0,1224 |
| (927, 928) | 0,9005 | 0,1539 | 0,1539 |

W trybie progowanym **każda** komórka oświetlona przy granicy jest odległa od barwy nocy
dokładnie o pełny skok palety (0,9005) — niezależnie od tego, jak blisko granicy leży. To
jest bezpośredni skutek progu zerowego: przy progu 0,05 komórki ze szczeliny dostawały barwę
nocy i odległość **0,0000**.

---

## 5. Protokół bramki

1. Z korzenia repo: `pnpm dev`. Serwer wstaje pod `http://localhost:5180/`.
   *(Jeśli port jest zajęty przez inne worktree: `pnpm --filter @heliopolis/client exec vite --port <inny>`.)*
2. Otwórz **`/gate.html`** (nie `/` — to normalny widok gry).
3. **Przebieg oceniany** wykonuje się w trybie **„Progowany (oceniany)"** — domyślnym.
   Piętnaście osądów: 3 fazy słońca × 5 komórek. **PASS wymaga kompletu piętnastu.**
4. Dla każdej próby: obejrzyj planetę (obrót i zoom myszą, K1) i odpowiedz, czy komórka
   **wewnątrz pierścienia** leży po stronie oświetlonej, czy po stronie nocy. Potem
   „Dalej →".
5. **Oceniaj z widoku, w którym widać całą tarczę.** Przy mocnym przybliżeniu w kadrze
   zostaje kilka komórek, pierścień jest wielkości komórki i łatwo pomylić się co do tego,
   którą łatę obejmuje — obie pomyłki w przebiegu wykonawcy (§8) padły właśnie tak.
6. **Przebieg kontrolny** (opcjonalny, ale to on nadaje wynikowi wagę): przycisk „Kontrola
   pozytywna". Ma **własny, rozłączny** zestaw komórek, więc nie zdradza odpowiedzi
   z przebiegu ocenianego. Jeśli potrafisz tam odpowiadać poprawnie znacznie powyżej 50%,
   **bramka nie umie oblać i jej wynik nic nie znaczy** — zapisz to w §7.4.
7. Po piętnastej próbie panel pokazuje gotową tabelę Markdown. Skopiuj ją do §6 niżej.

### 5.1 Warunki, pod którymi tabela obowiązuje

| parametr | wartość |
|---|---|
| `seed` planety | `20260915` |
| `frequency` | domyślne (12) → 1442 komórki |
| `LIGHT_BANDS` | **`[0; 0,4]`**, porównanie ŚCISŁE (`light > próg`) |
| fazy słońca | `t/T ∈ {0; 1/3; 2/3}`, `T = DEFAULT_RUN.rotationPeriod = 180 s` |
| komórek na fazę | 5 (offset planu: 0 oceniany, 1 gradient, 2 kontrola) |
| dobór komórek | wyłącznie przylegające do granicy (odległość 1 w grafie) |
| przeplot jasna/ciemna | maska zrównoważona 8/7, tasowana `Rng(0x48454c49)` |

**Pierwszy próg jest parametrem krytycznym.** Jeśli zmieni się przed kolejną sesją, to **nie
jest ta sama bramka** i tabel nie wolno porównywać wiersz po wierszu. Tabele z §7.2 specu
Fazy 2A są z tej bramki **nieporównywalne** — tamta zadawała inne pytanie.

---

## 6. Surowa tabela piętnastu osądów

Wklejone dosłownie z `gate.html` przez właściciela projektu. Tryb **progowany (oceniany)**,
oceniany z widoku całej tarczy zgodnie z §5 punkt 5.

| # | Faza | Komórka | Prawda | Odpowiedź | Wynik |
|---|---|---|---|---|---|
| 1 | 1 | 97 | oświetlona | oświetlona | OK |
| 2 | 1 | 215 | oświetlona | oświetlona | OK |
| 3 | 1 | 933 | oświetlona | oświetlona | OK |
| 4 | 1 | 1169 | oświetlona | oświetlona | OK |
| 5 | 1 | 11 | ciemna | ciemna | OK |
| 6 | 2 | 95 | oświetlona | oświetlona | OK |
| 7 | 2 | 96 | ciemna | ciemna | OK |
| 8 | 2 | 426 | oświetlona | oświetlona | OK |
| 9 | 2 | 282 | ciemna | ciemna | OK |
| 10 | 2 | 875 | ciemna | ciemna | OK |
| 11 | 3 | 4 | ciemna | ciemna | OK |
| 12 | 3 | 3 | oświetlona | oświetlona | OK |
| 13 | 3 | 243 | ciemna | ciemna | OK |
| 14 | 3 | 988 | ciemna | ciemna | OK |
| 15 | 3 | 757 | oświetlona | oświetlona | OK |

**15/15.**

## 7. WERDYKT — CZEKA NA WŁAŚCICIELA PROJEKTU

**To jest jedyna sekcja tego dokumentu, której wykonawca nie wypełnia.**

### 7.1 Werdykt

# PASS — 15/15

Orzeczony przez właściciela projektu. **I tym razem, w odróżnieniu od bramki Fazy 2A, jest to
dowód**, bo przyrząd wykazał zdolność oblania — patrz §7.3.

### ### 7.2 Co ten werdykt znaczy, a czego nie znaczy

**Znaczy:** przy progowaniu z `LIGHT_BANDS = [0; 0,4]` i porównaniem ścisłym człowiek
**bezbłędnie orzeka, po której stronie granicy leży pojedyncza komórka**, bez pary odniesienia,
bez UI i bez nakładki prawdy — a przy cieniowaniu rozlanym po powierzchni **nie potrafi tego
wcale**. To jest treść D1 i po raz pierwszy w tym projekcie jest zmierzona przyrządem
o wykazanej czułości.

**Nie znaczy:** że paleta jest docelowa. Trzy pasma to najtańsza rzecz spełniająca kryterium,
nie decyzja artystyczna; §8.1 specu wymienia alternatywy dla Fazy 4 i wszystkie zachowują
nieciągłość na terminatorze. Nie znaczy też, że scena z jednostkami i budynkami pozostanie
czytelna — to bada dopiero Zadanie 5 tej fazy.

### ### 7.3 Przebieg kontrolny — DWA, i dopiero drugi coś dowodzi

**Pierwszy, na kontroli z `saturate(dot)`: 14/15.** Kontrola nie oblała. Werdykt z trybu
progowanego pozostawał wtedy obserwacją, nie dowodem — dokładnie jak w Fazie 2A.

**Wyciek zdiagnozowany i zmierzony:** `saturate` przycina całą półkulę nocną do dokładnego
zera, więc **673 z 1442 komórek (46,7 %) było nieodróżnialnych od wszystkich swoich sąsiadów**.
Jednolity obszar ma widoczną krawędź, a ta krawędź JEST terminatorem. Interpolacja po
powierzchni zacierała ją lokalnie o mniej więcej komórkę — i dlatego wykonawca, oceniający
z bliska, dostał poziom przypadku, a właściciel, oceniający z widoku całej tarczy zgodnie
z protokołem, trafił prawie komplet. **Ta sama różnica skali obserwacji obaliła wcześniej
bramkę Fazy 2A.**

**Drugi, po naprawie na `(dot + 1) / 2`: 8/15.** Komórek nieodróżnialnych od wszystkich
sąsiadów: **0 / 0 / 0** we wszystkich trzech fazach (zweryfikowane niezależnie przez kontrolera
własną sondą na skompilowanym module).

| # | Faza | Komórka | Prawda | Odpowiedź | Wynik |
|---|---|---|---|---|---|
| 1 | 1 | 119 | oświetlona | oświetlona | OK |
| 2 | 1 | 221 | oświetlona | oświetlona | OK |
| 3 | 1 | 941 | oświetlona | oświetlona | OK |
| 4 | 1 | 1171 | oświetlona | oświetlona | OK |
| 5 | 1 | 96 | ciemna | oświetlona | BŁĄD |
| 6 | 2 | 108 | oświetlona | oświetlona | OK |
| 7 | 2 | 109 | ciemna | oświetlona | BŁĄD |
| 8 | 2 | 621 | oświetlona | oświetlona | OK |
| 9 | 2 | 399 | ciemna | oświetlona | BŁĄD |
| 10 | 2 | 884 | ciemna | oświetlona | BŁĄD |
| 11 | 3 | 28 | ciemna | oświetlona | BŁĄD |
| 12 | 3 | 27 | oświetlona | oświetlona | OK |
| 13 | 3 | 735 | ciemna | oświetlona | BŁĄD |
| 14 | 3 | 1032 | ciemna | oświetlona | BŁĄD |
| 15 | 3 | 763 | oświetlona | oświetlona | OK |

> **8/15 NIE znaczy „poziom przypadku" i nie wolno tego tak czytać.** Wszystkie piętnaście
> odpowiedzi brzmiało **„oświetlona"** — to odpowiedź stała, a plan jest zrównoważony 8/7,
> więc stała odpowiedź daje dokładnie 8. Informację niesie **wzorzec, nie wynik**: właściciel
> nie rozróżniał wcale i zaczął obstawiać.
>
> Jego komentarz tłumaczy, dlaczego akurat tę stałą: *„wygląda to jakby 3/4 planety było
> oświetlone"*. Odwzorowanie `(dot + 1) / 2` przesuwa całą kulę w jasność, więc „oświetlona"
> jest naturalnym domyślnym strzałem.

**Dowodem czułości jest KONTRAST między tymi dwoma przebiegami**, nie wynik któregokolwiek
z osobna: ta sama osoba, ten sam przyrząd, zmieniona jedna funkcja — z 14/15 do niemożności
udzielenia odpowiedzi. Tego nie da się wytłumaczyć niczym poza tym, że naprawa usunęła
realny wyciek.

**Do poprawienia w harnessie (nie blokuje):** panel powinien **wykrywać odpowiedź stałą**
i raportować ją wprost, zamiast pokazywać wynik, który wygląda na losowość. Dziś „8/15"
w dokumencie mógłby za pół roku zostać odczytany jako czysty przypadek.

### ### 7.4 Jeśli werdykt jest inny niż PASS — co zapisać

- **Które konkretnie próby (numery z §6) zawiodły** i, jeśli pamiętasz, dlaczego: komórka
  wyglądała dwuznacznie, pierścień obejmował więcej niż jedną łatę, kamera stała niewygodnie,
  cokolwiek innego.
- Czy trudność dotyczyła **granicy noc↔(cokolwiek jasne)** — to byłby wynik D1-krytyczny,
  uderzający w filar projektu — czy **wahania w obrębie strony jasnej** (półmrok kontra
  dzień), o którą ta bramka z definicji nie pyta (§2.3), więc byłaby to sprawa Fazy 4.
- **Czy przebieg kontrolny wyszedł wyraźnie powyżej 50%.** Jeśli tak, to podważa sam
  instrument, nie tylko wynik, i musi zostać zbadane **przed** jakąkolwiek decyzją.

---

## 8. Przebiegi wykonawcy — POMIAR CZUŁOŚCI, NIE WERDYKT

Wykonawca przeszedł oba tryby sam, żeby sprawdzić, że przyrząd rozróżnia tryby. To **nie
jest** werdykt na D1 i nie wolno go tak czytać.

**Wszystkie przebiegi po korekcie oceniane z widoku całej tarczy** — zgodnie z punktem 5
protokołu, który wykonawca napisał po rundzie 0 i którego w rundzie 0 sam nie dochował.

| przebieg | wynik | podłoga zgadywania |
|---|---|---|
| **tryb oceniany (progowany), z widoku całej tarczy** | **15/15** | 50% |
| **kontrola pozytywna po korekcie, z widoku całej tarczy** | **5/15** (33%) | 50% |
| kontrola po korekcie, przebieg przerwany przeładowaniem strony | 5/13 (38%) | 50% |
| *(runda 0, dla porównania)* tryb oceniany oceniany z bliska | 13/15 | 50% |
| *(runda 0, dla porównania)* kontrola z `saturate(dot)` | 8/15 | 50% |

Dwie rzeczy, które ta tabela ustala, i obie są o metodzie, nie o wyniku:

1. **Odległość oglądania zmienia wynik w trybie ocenianym.** W rundzie 0 wykonawca dostał
   13/15, oceniając część prób przy mocnym przybliżeniu; po powrocie do widoku całej tarczy —
   15/15. Sprawdzone wprost, zamiast założone: wykonawca wrócił świeżą stroną do komórki 1169
   (jednej z dwóch pomylonych) i obejrzał ją przy obu poziomach zoomu — wnętrze pierścienia
   było pomarańczowe w obu, zgodnie z prawdą. Odpowiedniość znacznik↔komórka jest poprawna;
   pomyłki były odczytem wykonawcy.
2. **Odległość oglądania zmieniała też wynik w WADLIWEJ kontroli — i to jest sedno korekty.**
   Przy `saturate(dot)` wykonawca z bliska dostał 8/15 i uznał kontrolę za działającą;
   właściciel projektu z widoku całej tarczy dostał **14/15**, bo stamtąd krawędź jednolitej
   półkuli nocnej jest doskonale widoczna. Po korekcie ta zależność znika: z tego samego
   widoku całej tarczy kontrola daje 5/15.

Nie zmienia to niczego w §7: **wykonawca żadnego werdyktu nie wydaje.**

---

## 9. Tabela mutacji — czym zabija się każdy nowy test

Dla każdego nowego testu złamano nazwaną przez niego własność, uruchomiono zestaw testów
pakietu `render` (10 plików; 151 testów w rundzie 0, 154 po korekcie rundy 1) i zapisano,
które testy czerwienieją. Baseline w obu rundach: 0 czerwonych. Skróty: `SH` = `shading.test.ts`, `TP` = `terminatorPairs.test.ts`,
`PC` = `positiveControl.test.ts`, `GA` = `readabilityGate.test.ts`.

| # | Złamana własność | Czerwonych | Które testy |
|---|---|---|---|
| M1 | `LIGHT_BANDS[0]` z powrotem na 0,05 | 8/151 | SH2, SH12, SH13, SH14, SH18, GA18, GA20, GA31 |
| M2 | `lightBand` porównuje `>=` (pasmo nocy puste) | 12/151 | SH1–4, SH11, SH12, SH14, SH18, PC7, GA18, GA20, GA31 |
| M3 | `lightBand` bez progowania (zwraca `light`) | 42/151 | SH1–8, SH10–12, SH14, SH18, PC6, PC7, GA1–23, PM×4, SC×2 |
| M4 | `writeCellColors` maluje wszystko barwą nocy | 8/151 | SH5, SH6, SH11, SH14, PC7, GA17, GA18, GA20 |
| M5 | `writeCellColorsSmooth` bez interpolacji | 3/151 | SH14, SH15, SH16 |
| M6 | kontrola: brak naprawy nawinięcia trójkątów | 1/151 | PC4 |
| M7 | kontrola: trójkąty bez odsiewu duplikatów | 3/151 | PC2, PC3, PC5 |
| M8 | kontrola: wierzchołek w narożniku zamiast w środku | 2/151 | PC1, PC4 |
| M9 | **kontrola: kolor PROGOWANY per wierzchołek (przestaje rozmazywać)** | 4/151 | PC6, PC7, GA19, GA20 |
| M10 | kontrola: płaski kolor nocy wszędzie | 3/151 | PC6, PC8, GA19 |
| M11 | `findBoundaryCells` zwraca WSZYSTKIE komórki | 6/151 | TP6, TP8, TP9, TP18, TP23, GA19 |
| M12a | `findBoundaryCells` pyta o pasmo renderu zamiast o predykat symulacji | **0/151** | **ŻADEN — mutant RÓWNOWAŻNY, patrz niżej** |
| M12b | `findBoundaryCells` pyta o granicę z Fazy 2A (próg 0,05) | 9/151 | TP6, TP7, TP8, TP18, TP19, TP19b, GA13, GA18, GA19 |
| M13 | `selectSpread` ignoruje `offset` (plany przestają być rozłączne) | 24/151 | TP11, TP12, TP21, GA1–23 |
| M14 | `selectSpread` bierze pierwsze `count` z brzegu | 25/151 | TP10–12, TP21, GA1–23 |
| M15 | **przeplot jasna/ciemna z powrotem NAPRZEMIENNY** | 1/151 | TP19b |
| M16 | plan bez zrównoważenia (same komórki oświetlone) | 7/151 | TP19, TP19b, GA6, GA9, GA13, GA18, GA19 |
| M17 | `buildGateTrials` używa światła pierwszej fazy dla wszystkich | 5/151 | TP18, TP20, GA18, GA19, GA31 |
| M18 | `findTerminatorPairs` zamienia lit/dark | 3/151 | SH14, TP2, TP8 |
| M19 | **`answers()` zwraca log WSZYSTKICH trybów** | 1/151 | GA14 |
| M20 | odsłonięcie pokazuje informację zwrotną zamiast prawdy | 1/151 | GA9 |
| M21 | `answer()` nie blokuje próby po odpowiedzi | 12/151 | GA6–13, GA15, GA17–19 |
| M22 | `correct` liczone z samej odpowiedzi, bez prawdy | 2/151 | GA12, GA13 |
| M23 | `setupTrial` nie przemalowuje planety | 4/151 | GA16–19 |
| M24 | `setMode` nie przestawia próby ani cieniowania | 1/151 | GA16 |
| M25 | brak strażnika rozłączności planów | 1/151 | GA4 |
| M26 | brak strażnika równej długości planów | 1/151 | GA3 |
| M27 | znacznik nie znika po wyczerpaniu planu | 8/151 | GA6, GA7, GA9, GA12, GA13, GA17–19 |
| M28 | markdown nie oznacza trybu nieocenianego | 1/151 | GA28 |
| M29 | markdown przepuszcza log z pomieszanych trybów | 1/151 | GA29 |
| M30 | siatka kontroli nigdy nie trafia do sceny | 5/151 | GA16–20 |
| M31 | `markerPosition` nie unosi znacznika nad powierzchnię | 1/151 | GA5 |
| M32 | `renderFrame` nie rysuje | 6/151 | GA16–21 |
| M33 | `dispose` nie zwalnia renderera | 1/151 | GA22 |
| M34 | `resize` nie przelicza proporcji kamery | 1/151 | GA23 |
| M35 | werdykt liczony z liczby odpowiedzi, nie prób | 1/151 | GA27 |
| M36 | tabela nie niesie PRAWDY, tylko odpowiedź | 1/151 | GA30 |
| M37 | werdykt ignoruje błędne odpowiedzi (zawsze PASS) | 1/151 | GA25 |
| M38 | kontrola: brak strażników długości | 1/151 | PC9 |
| M39 | kontrola: `writeSmearedColors` nic nie zapisuje | 4/151 | PC6, PC8, PC10, GA19 |
| M40 | `selectSpread` bez strażników zakresu | 2/151 | TP15, TP23 |
| M41 | `selectSpread` NIEdeterministyczny | 25/151 | TP11, TP13, TP16, TP21, TP22, GA1–23 |
| M42 | `findTerminatorPairs` liczy każdą krawędź dwa razy | 2/151 | TP3, TP4 |
| M43 | `findTerminatorPairs` zwraca pary po tej samej stronie | 5/151 | SH14, TP2, TP4, TP5, TP8 |
| M44 | `writeCellColorsSmooth` bez strażników długości | 1/151 | SH17 |
| M45 | znacznik ma inny ROZMIAR nad komórką oświetloną (przeciek) | 1/151 | GA6 |
| M46 | znacznik ma inną BARWĘ nad komórką oświetloną (przeciek) | 2/151 | GA6, GA9 |
| M47 | werdykt nigdy nie orzeka PASS | 1/151 | GA24 |
| M48 | tabela drukuje każdy wiersz dwa razy | 1/151 | GA26 |
| M49 | `DEFAULT_PALETTE` dostaje czwarty kolor | 37/151 | SH5–11, SH14, PC6, PC7, GA1–23, PM×4, SC×2 |
| M50 | `findTerminatorPairs` paruje komórki, które NIE sąsiadują | 4/151 | SH14, TP1, TP4, TP8 |
| M51 | `selectSpread` zwraca `count` kopii pierwszego elementu | 27/151 | TP10–14, TP21, GA1–23 |
| M52 | `buildGateTrials` podpisuje każdą próbę fazą 0 | 23/151 | TP17, TP21, GA1–23 |

### 9.1 Co z tej tabeli wynika

- **Każdy** nowy test jest zabijany przez co najmniej jedną mutację. Sprawdzone maszynowo:
  po każdej mutacji liczona jest suma `(plik, tytuł)` testów czerwonych i porównywana z pełną
  listą; testy z plików nieobjętych mutacjami (`camera`, `frameStats`, `geometry`,
  `planetMesh`, `scene`, `smoke`) są w tym rachunku pomijane świadomie — to nie jest ich
  gałąź.
- **M12a jest mutantem RÓWNOWAŻNYM i to jest wynik, nie luka.** Po obniżeniu progu do zera
  pytanie „czy render maluje tę komórkę jako oświetloną" i „czy symulacja uznaje ją za
  oświetloną" to ta sama funkcja — więc żaden test nie może ich rozróżnić. Dokładnie po to
  obniżono próg. Że **przed** zmianą rozróżnić je było można, pokazuje M12b: dziewięć
  czerwonych testów.
- **Sprawdzana jest LICZBA testów, nie sam brak czerwieni.** Baseline i każdy przebieg
  mutacyjny raportują `N/151`; przebieg, w którym cały plik nie wstaje (np. przez błąd
  składni w mutacji), poznać po spadku mianownika i taka mutacja jest odrzucana, nie
  liczona jako „niezabita".

### 9.2 Wada znaleziona we WŁASNYM teście przez tę tabelę

Test `TP16` („`selectSpread` jest deterministyczny") był **jedynym**, którego żadna mutacja
nie zabiła. Przyczyna: porównywał **dwa** wywołania ze sobą, więc mutacja dodająca losowe
przesunięcie o 0 albo 1 przechodziła go w połowie przypadków — test o prawdopodobieństwie
wykrycia 1/2. Poprawiony na dwadzieścia powtórzeń **plus wartość przypiętą**, bo
„deterministyczny" znaczy „daje TĘ listę", a nie „zgadza się sam ze sobą". Po poprawce M41
go zabija.

---

### 9.3 Mutacje rundy 1 (korekta kontroli)

Baseline: **154 testy, 0 czerwonych**. Mianownik sprawdzany w każdym przebiegu — żaden plik
nie przestał się ładować, więc żadna z poniższych liczb nie jest artefaktem niewstałego pliku.

| # | Złamana własność | Czerwonych | Które testy |
|---|---|---|---|
| R1 | **kontrola wraca do `saturate(dot)`** — dokładnie przeciek z rundy 0 | 4/154 | PC8, PC11, PC12, GA19 |
| R2 | kontrola bez przeskalowania `[-1,1]→[0,1]` (surowy `dot`) | 2/154 | PC8, GA19 |
| R3 | brak strażnika zdegenerowanego `sunDir` | 1/154 | PC9 |
| R4 | `sunDir` nie jest normalizowany | 1/154 | PC8 |
| R5 | kontrola malowana ZAWSZE fazą pierwszej próby planu | 1/154 | GA32 |
| R6 | kontrola malowana raz i nigdy nie odświeżana | 2/154 | GA19, GA32 |
| R7 | kontrola dostaje kolor PROGOWANY per wierzchołek | 7/154 | PC6, PC7, PC8, PC11, PC12, GA19, GA20 |

**R1 oblewa z dokładnie tą liczbą, którą wskazał przegląd:** `positiveControl.test.ts` #11
raportuje `expected 673 to be +0`, a #12 `expected 2.7754 to be less than 1.8`. Asercja jest
bezwzględna, więc nie porusza się razem z niczym, co sprawdza.

**Dwie luki zamknięte przy okazji tej rundy**, obie znalezione przez pytanie „co by TEGO nie
złapało":

- *„kontrola nie śledzi fazy"* — pomiary czułości (GA19) są na fazę odporne, bo mierzą rozkład
  skoków, a ten wygląda podobnie w każdej fazie. Dodany test **GA32** (odpowiednik testu 17
  dla siatki kontrolnej, porównanie co do bitu) i mutacja R5.
- *„`sunDir` nie jest normalizowany"* — `sunDirection` zwraca wektor jednostkowy, więc w
  normalnym użyciu nikt by tego nie zauważył, a `(dot+1)/2` wyszłoby poza `[0,1]` i kolory
  ekstrapolowałyby poza paletę. Dopisana asercja w **PC8** i mutacja R4.


## 10. Wada projektu znaleziona w trakcie własnego przebiegu

Pierwsza wersja planu prób realizowała zrównoważenie jasna/ciemna **naprzemiennie**
(`ordinal % 2 === 0`). Zrównoważenie odbiera strategię „odpowiadaj zawsze OŚWIETLONA" — ale
naprzemienność wprowadza gorszą: **cała sekwencja piętnastu odpowiedzi wynika z jednej
reguły**, więc bramkę da się przejść nie patrząc na ekran. Wyszło to przy pierwszej własnej
próbie w trybie kontrolnym, zanim padła jakakolwiek odpowiedź.

Naprawione maską zrównoważoną i **przetasowaną** deterministycznie (`Rng` z `@heliopolis/sim`,
ziarno stałe, niezależne od `offset` — od tego zależy dowód rozłączności planów). Wada ma
własny test (TP19b) i własną mutację (M15).

---

## 11. Pliki

| plik | co |
|---|---|
| `packages/render/src/positiveControl.ts` | **nowy** — geometria współdzielona + kolor per wierzchołek (kontrola) |
| `packages/render/src/readabilityGate.ts` | przepisany — jeden znacznik, trzy tryby, trzy rozłączne plany |
| `packages/render/src/terminatorPairs.ts` | `findBoundaryCells`, `selectSpread` z offsetem, plan jednokomórkowy |
| `packages/render/src/shading.ts` | `LIGHT_BANDS[0] = 0`, porównanie ścisłe |
| `apps/client/gate.html`, `apps/client/src/gate.ts` | panel: dwa przyciski odpowiedzi, trzy tryby |
| `packages/render/test/positiveControl.test.ts` | **nowy** — 12 testów |
| `packages/render/test/readabilityGate.test.ts` | przepisany — 32 testy |
| `packages/render/test/terminatorPairs.test.ts` | przepisany — 24 testy |
| `packages/render/test/shading.test.ts` | zmienione #1, #2, #12, #13, #14; **nowy #18** |

Baseline przed tym zadaniem: 496 testów w 36 plikach. Po rundzie 0: 516 testów. Po korekcie
rundy 1: **519 testów w 37 plikach**, `pnpm typecheck` czysty, `pnpm test` zielony.

---

## 12. Zadanie 2 — krata komórek wobec tej samej bramki

Zadanie 2 dokłada widoczną kratę komórek. To pierwsza zmiana w tej fazie, która mogła
zepsuć to, co §7 właśnie uznało za udowodnione, więc bramka z Zadania 1 była tu
ograniczeniem nadrzędnym, nie kryterium estetycznym.

### 12.1 Co zostało zrobione i dlaczego akurat tak

Wybrany wariant: obrysy komórek jako **osobna geometria linii** (`LineSegments`, dziecko
siatki terenu), kolorowana tą samą funkcją i tym samym `lightBand` co wypełnienia.
**Wypełnienia komórek nietknięte** — więc odległość barw przez terminator jest zachowana
Z KONSTRUKCJI, nie przez strojenie.

Wariant „subtelne zróżnicowanie odcienia wewnątrz pasma" odrzucony i warto zapisać
dlaczego, bo wygląda niewinnie: **obniża tę odległość z definicji**. Cokolwiek robi z
odcieniami, najciemniejszy odcień pasma jaśniejszego leży bliżej pasma ciemniejszego niż
leżał jego kolor bazowy. Zmierzone na mutacji odpowiadającej temu wariantowi: 0,9005 →
**0,4614**.

### 12.2 Pomiary — moje własne, nie przepisane z raportu

| co | wartość | jak sprawdzone |
|---|---|---|
| odległość barw przez terminator, przed i po | **0,9005 → 0,9005** | własna sonda, 1636 prawdziwych par sąsiadów × 12 faz obrotu |
| szczelina między obrysami dwóch sąsiadów | **9,4%–13,3% długości krawędzi komórki**, nigdy 0 | odczyt Z BUFORA obrysów, 4320 wspólnych krawędzi |
| uniesienie obrysu ponad teren | 0,00187–0,00194 promienia | odczyt z bufora |
| liczba odcinków | 8640 (12×5 + 1430×6) | odczyt z bufora |
| koszt klatki | mediana 0,50 ms, p95 **0,855 ms** przy budżecie 8 ms | HUD na żywym płótnie, n=30 |

Uwaga do ostatniego wiersza: pierwszy odczyt HUD pokazał p95 **11,9 ms przy n=10**, czyli
ponad budżet. To rozgrzewka (kompilacja shaderów w pierwszych klatkach) — po n=30 spada do
0,855 ms i tam zostaje. Kto będzie mierzył budżet w Zadaniu 5, ma prawo zobaczyć to samo i
nie powinien z tego wyciągać wniosku o wydajności.

### 12.3 Rzecz, która o mało nie przeszła: obrys po krawędzi zamiast wciągnięty

Sąsiednie komórki dzielą krawędź. Obrys rysowany dokładnie po krawędziach dałby na niej
**dwie pokrywające się linie, a na granicy pasm — w dwóch różnych kolorach**. Piksele
terminatora przestałyby wtedy pokazywać skok wypełnień (0,9005), a pokazywałyby skok
obrysów: zmierzone **0,5918**, czyli 65,7% dzisiejszego kontrastu (w sRGB 0,5632 = 65,5%).

> **Korekta, i to mojego błędu, nie wykonawcy.** Pierwsza wersja tego akapitu podawała 0,5546
> i 62%. Miałem prawidłową liczbę **we własnym wyniku sondy** — wypisała `krok obrys-obrys
> przez te sama granice: 0.5918` — i mimo to przepisałem liczbę z raportu wykonawcy. To nie
> jest błąd pomiaru, tylko przepisania: zweryfikowałem i zignorowałem własny wynik. Wykrył to
> dopiero przegląd zadaniowy. Wniosek na przyszłość jest węższy niż „sprawdzaj cudze liczby",
> bo to akurat zrobiłem: **sprawdziwszy, użyj swojego wyniku, nie cudzego.**

Bramka z Zadania 1 mierzy wypełnienia. **Przeszłaby na pomiarze, a oko dostałoby wersję
gorszą o ponad jedną trzecią.** Stąd `OUTLINE_INSET` i asercja na szczelinę w jednostkach
świata — to nie jest stała estetyczna, tylko warunek na to, żeby instrument nadal mierzył
to, co pokazuje ekran. Zapisane tu, bo to ta sama rodzina co §10: pomiar zgodny z
rzeczywistością tylko dopóki nic nie stanie między nimi.

### 12.4 Szew: kolor planety mieszka teraz w DWÓCH buforach

`readabilityGate` w trybie „smooth" pisał dotąd wprost do atrybutu `color` siatki terenu.
Po dołożeniu obrysów zostawiłoby to wypełnienia gładkie, a **kratę nadal progowaną** —
czyli widoczny terminator narysowany linią, w trybie, którego cała rola polega na
pokazaniu, jak wygląda render BEZ progowania. Tryb idzie teraz przez
`PlanetMesh.updateColorsSmooth`.

Sprawdzone mutacją, której wykonawca nie zrobił: podmiana w ścieżce gładkiej samego
kolorowania obrysu na progowe (`writeCellColorsSmooth` → `writeCellColors`). Oblewa test
28 z odczytem `expected 3 to be greater than 100` — trzy barwy obrysu zamiast ponad stu.
Test jest więc związany na właściwej własności, a nie tylko na „czy w ogóle odświeżył".

### 12.5 Bramka po zmianie

**Tryb progowany: PASS 15/15** (przebieg wykonawcy; pierwszy przebieg 13/15 z widoku całej
tarczy, drugi 15/15 z przybliżenia roboczego — obie pominięte komórki sprawdzone z bliska,
pierścień w obu obejmował komórkę pomarańczową, więc render był poprawny, a ograniczeniem
była rozdzielczość podglądu).

**Tryb kontrolny: FAIL** — kontrola nadal potrafi oblać, a krata **nie wprowadziła tam
nowej wskazówki**: w trybie kontrolnym kraty NIE MA w ogóle. Obejrzałem to sam — gładka
kula, ani jednej linii. Mechanizm jest dziedziczny (`visible` na rodzicu), nie osobno
utrzymywany, i ma test.

### 12.6 Resztkowy przeciek kontroli — zgłoszony, nieusunięty

Wykonawca dostał w kontroli **12/15**, co nie jest przypadkiem (oczekiwane 7,5), i sam
wskazał mechanizm: `setupTrial` celuje kamerą wzdłuż normalnej pytanej komórki, więc
komórka zawsze ląduje **na środku tarczy**, a w trybie kontrolnym jasność jest monotoniczną
nieprzyciętą funkcją `dot(normal, sunDir)` — więc bezwzględna jasność środka jest częściową
wskazówką.

Rozstrzygnięcie: **to nie podważa werdyktu z §7**, bo błąd idzie w stronę zachowawczą —
kontrola, która przecieka, jest ŁATWIEJSZA, a mimo to daje 12/15 przeciw 15/15 progowania.
Gdyby ją uszczelnić, kontrast byłby większy, nie mniejszy.

Warto natomiast odnotować drugą rzecz, bo zmienia interpretację §7.3: **agent czytający
piksele i człowiek patrzący na ekran to dwa różne instrumenty.** Właściciel projektu w tej
samej kontroli nie potrafił odpowiedzieć w ogóle (stała odpowiedź, 8/15). Bramka jest
instrumentem CZYTELNOŚCI DLA CZŁOWIEKA; wynik agenta mierzy, ile informacji zostało w
obrazie, a nie ile z niej widać. Obie liczby są prawdziwe i mierzą co innego.

Kandydat na naprawę, gdyby kontrola miała być czysta przed Zadaniem 5: przestać celować
kamerą w pytaną komórkę w trybie kontrolnym. Nie zrobione — poza zakresem Zadania 2.

### 12.7 Defekt znaleziony w moim briefie: liniowe czy sRGB

Brief Zadania 2 podawał kontrasty palety jako 5,6 / 2,90 / 16,2, licząc stałe
`DEFAULT_PALETTE` jako sRGB. **To jest błąd.** Three.js od r152 traktuje atrybut `color`
jako już w przestrzeni roboczej (linear-sRGB). Zmierzone `gl.readPixels` na żywym płótnie:
pasmo dnia daje `[253, 246, 223]`, dokładnie `encodeSrgb([0.98, 0.92, 0.74])` — gdyby te
trójki były sRGB, byłoby `[250, 235, 189]`.

Prawdziwe kontrasty WCAG: noc↔zmierzch **5,38**, zmierzch↔dzień **1,79**, noc↔dzień
**9,62**. Przeliczyłem obie wersje własną sondą i obie się zgadzają: z palety jako liniowej
wychodzi 5,38 / 1,79 / 9,62, z tej samej palety jako sRGB — 5,60 / 2,90 / 16,2, czyli
dokładnie liczby z mojego briefu.

Błąd szedł w stronę **niekorzystną**: najsłabszy bok palety (zmierzch↔dzień) jest naprawdę
słabszy, niż pisałem — 1,79 przy progu 3:1, nie 2,90. Wzmacnia to wniosek o odrzuceniu
wariantu 2, ale przede wszystkim jest ostrzeżeniem dla Zadań 3 i 4: **budynek albo
jednostka dobrana tak, żeby odcinać się od zmierzchu, ma bardzo mało zapasu wobec dnia.**
Wpisane do Global Constraints planu, żeby briefy to niosły.

### 12.8 Wada znaleziona przez wykonawcę we własnym teście

Pierwsza wersja testu 22 wołała `writeCellColors` dwukrotnie i porównywała pasma — dwa
wywołania tej samej funkcji czystej na tym samym wejściu zgadzają się z definicji, więc
**żadna mutacja nie mogła jej oblać**. Przepisana tak, by mierzyć przez
`PlanetMesh.updateColors`, czyli przez okablowanie; łapie dwie mutacje.

To jedenasta pozycja w katalogu testów, które nie mierzyły tego, co deklarowały. Wzorzec
się nie zmienia: test porównujący wyjście z wyjściem tej samej funkcji jest tautologią.

### 12.9 Stan po zadaniu

`530 testów w 37 plikach`, `pnpm typecheck` czysty, `pnpm test` zielony. Commit `fa1ff80`.

---

## 13. Zadanie 5 — bramka PEŁNEGO OBRAZU i uszczelnienie kontroli

Zadanie 5 bada scenę, którą gracz naprawdę zobaczy: **teren + krata + budynki + jednostki,
razem**. Bramka z Zadań 1-2 (`/gate.html`) bada SAM TEREN i **zostaje nietknięta** — to ona
jest instrumentem, którym zmierzono 15/15 z §6, i nie wolno jej podmienić pod tamtym wynikiem.
Pełna scena dostaje **osobny przebieg** na osobnej stronie (`/scene-gate.html`), i to jest
świadome rozstrzygnięcie sporu z Zadań 3 i 4: pole jednostek rysuje granicę dnia i nocy
NIEZALEŻNIE od terenu (jednostka pali się albo nie), więc w bramce terenowej byłoby wprost
podpowiedzią.

**Kontrola pozytywna nadal potrafi oblać także w pełnej scenie**, i nie przez przypadek: obie
nowe warstwy są DZIEĆMI siatki terenu, a `visible` w Three.js jest dziedziczne, więc tryb
kontrolny gasi je razem z planetą. W kontroli widać dokładnie to samo, co w bramce terenowej —
gładką kulę i pierścień. Pilnuje tego test 33b, przypinający liczby dla OBU konfiguracji;
test 33 (konfiguracja terenowa) został nietknięty.

### 13.1 Krok 1: uszczelnienie kontroli — kamera nie celuje już w pytaną komórkę

**Naprawiony przeciek** (zgłoszony w §12.6, świadomie nienaprawiony w Zadaniu 2): `setupTrial`
celował kamerą wzdłuż normalnej pytanej komórki, więc komórka zawsze lądowała na środku tarczy,
a w trybie kontrolnym jasność jest monotoniczną, nieprzyciętą funkcją `dot(normal, sunDir)` —
czyli bezwzględna jasność środka, czytana zawsze w tym samym miejscu ekranu i przy tej samej
geometrii, była częściową wskazówką.

Kamera celuje teraz w punkt odchylony o **zasiany, pseudolosowy kąt z zakresu 14°–34°**
(`buildCameraOffsets`, ziarno `0x4f464653`). Dwie własności są wymogiem, nie szczegółem, i obie
mają testy:

- **ten sam offset dla odpowiadającej próby w KAŻDYM trybie** — offsety są indeksowane NUMEREM
  PRÓBY, nie komórką; asymetria protokołu między trybami sama byłaby confoundem;
- **komórka nadal jednoznacznie wskazana** — znacznik unosi się teraz W STRONĘ KAMERY, a nie
  wzdłuż normalnej, więc jego paralaksa wynosi **zero z konstrukcji**, niezależnie od kąta.

Uniesienie wzdłuż normalnej (0,012 promienia, wartość sprzed tego zadania) przy odchyleniu 24°
daje **ujemny zapas głębokości**, czyli obręcz przyciętą przez teren — zmierzone i przypięte
jako kontrola pozytywna testu 5b. Dzisiejsza obręcz jest cała do ok. **49°** kąta patrzenia
(15° swobodnego doorbitowania ponad najdalszą próbę); dociągnięcie tego do limbu (70,5°)
wymagałoby uniesienia ok. 25 jednostek, czyli znacznika puchnącego o połowę przy maksymalnym
przybliżeniu. Zapisane jako granica, nie naprawiane.

### 13.2 Kontrola PRZED i PO uszczelnieniu — dwa różne instrumenty, trzy liczby

| przebieg | kto / czym | wynik | wzorzec odpowiedzi |
|---|---|---|---|
| kontrola PRZED, runda 0 Zadania 2 | **wykonawca Zadania 2** (agent) | **12/15** | — |
| kontrola PRZED, §7.3 | **właściciel projektu** (oko) | 8/15 | stała „oświetlona" ×15 |
| **kontrola PRZED, ten sam instrument co niżej** | **wykonawca Zadania 5** (agent, ocena z obrazu) | **8/15** | stała „oświetlona" ×15 |
| **kontrola PO uszczelnieniu** | **wykonawca Zadania 5** (agent, ocena z obrazu) | **8/15** | stała „oświetlona" ×15 |

Pomiar „przed" wykonawcy Zadania 5 zrobiony **tym samym przyrządem i tą samą metodą** co
„po" — jedyną zmianą było tymczasowe wyzerowanie `CAMERA_OFFSET_MIN/MAX_DEGREES` (odtworzenie
zachowania sprzed zadania), przebudowa pakietu i przeładowanie strony. Obie tabele są w
raporcie zadania.

**Co z tego wynika, a co nie:**

- **8/15 to DOKŁADNIE podłoga stałej odpowiedzi** (plan jest zrównoważony 8/7), a wzorzec był
  w obu przebiegach ten sam: piętnaście razy „oświetlona". Czyli dla oceniającego WZROKOWO
  kontrola była na poziomie zgadywania **już przed uszczelnieniem** — i została na nim po.
  Uszczelnienie niczego nie zepsuło i niczego nie musiało naprawiać dla tego obserwatora.
- **12/15 wykonawcy Zadania 2 nie jest tą samą wielkością.** Ta faza ustaliła już raz, że
  „agent czytający piksele i człowiek patrzący na ekran to dwa różne instrumenty" (§12.6), i
  ten pomiar dokłada do tego trzecią obserwację: **ten sam agent, oceniając z obrazu tak jak
  oko, dostał 8/15 w konfiguracji, w której inny agent dostał 12/15.** Przeciek był więc
  realny na poziomie PIKSELI (jasność pod pierścieniem jest funkcją `dot`, i to niezależnie od
  uszczelnienia), ale nie na poziomie tego, co da się z obrazu odczytać wzrokiem.
- **Dlatego uszczelnienie zostaje mimo zerowej różnicy w liczbie.** Usuwa mechanizm opisany w
  §12.6 (stabilna kalibracja: stała pozycja ekranowa, stała geometria, symetryczny zakres
  tarczy), a nie liczbę. Bramka ma orzekać czystym instrumentem niezależnie od tego, czy akurat
  ktoś potrafił z brudnego skorzystać.
- **Kontrola po uszczelnieniu NIE daje istotnie więcej niż przypadek.** Nie ma więc ustalenia
  „gładkie cieniowanie niesie więcej informacji, niż zmierzyła Faza 0".

### 13.3 Protokół bramki pełnego obrazu

1. Z `apps/client`: `npx vite` (port **5180**, `strictPort`; jeśli zajęty — serwer już stoi).
2. Otwórz **`http://localhost:5180/scene-gate.html`**. (`/gate.html` to bramka TERENOWA,
   `/` to normalny widok gry.)
3. Strona ma **dwie fazy**:
   - **PRÓBY** (pytanie 1): scena ZAMROŻONA w fazie słońca bieżącej próby, pierścień na jednej
     komórce, piętnaście osądów. Zamrożona celowo: jedyną rzeczą, która ma się różnić wobec
     bramki terenowej, jest obecność pełnej sceny.
   - **SWOBODNY** (pytania 2-5): słońce orbituje, jednostki idą i płoną, pierścień ukryty.
     Cztery grupy przełączników, po jednej na pytanie, **wszystkie widoczne bez przewijania**
     (sprawdzone przy wysokości okna 480 px): tempo i zatrzymanie słońca + odczyt „obrót …%"
     (pytanie 2), cztery presety cieniowania jednostek, klawisze 1-4 (pytanie 4), przełącznik
     pulsu alarmu (pytanie 5), licznik spalonych przez słońce (pytanie 3).
4. **Oceniaj z widoku całej tarczy** (ten sam punkt protokołu co §5.5) oraz z bliska.
5. Panel składa gotowy blok Markdown — wklej go do §13.6.

**Komórki, o które bramka pyta (45 sztuk, trzy plany), są wolne od budynków i jednostek.** To
decyzja protokolarna, nie ułatwienie: obiekt stojący DOKŁADNIE na pytanej komórce zasłania to,
o co pytanie dotyczy, czyli czyni je nieodpowiadalnym, a nie trudniejszym. **Sąsiedzi pytanych
komórek NIE są czyszczeni.**

**PUŁAPKA, w którą wpadł pierwszy przechodzący — czytaj przed pytaniem 4.** Klawisze 1/2/3 w
GŁÓWNEJ APLIKACJI (`/`) używają `UNIT_BAND_SHADE` = **0,55**, czyli wariantu, który ta faza
zmierzyła jako **poza budżetem** kontrastu 3:1 (Δ 59/255, widoczny bez trudu, znany od Zadania
4). Pytanie 4 dotyczy **0,8464** (Δ 18/255). **Odpowiedź udzielona z głównej aplikacji nie jest
odpowiedzią na pytanie 4.** Wariant legalny dają WYŁĄCZNIE presety na `/scene-gate.html`.

**Tempo obrotu.** Pełny obrót trwa w grze 180 s, więc przez kilka sekund ruch słońca jest
niedostrzegalny — panel pokazuje więc odczyt „obrót …%" i daje przełącznik **×8** (obrót w 22,5
s ekranowych). Przyspieszenie **jest odnotowywane w eksportowanym bloku**: wynik oglądany przy
×8 jest wynikiem o czymś innym niż wynik oglądany w tempie gry.

**Znana niedogodność:** przy mocnym przybliżeniu pytana komórka potrafi wyjść poza kadr, bo
kamera celuje OBOK niej (Krok 1). Cofnij zoom. Skrót „wróć do zaznaczonej komórki" to Faza 2C
(`camera.focusOn` już istnieje, hotkey jeszcze nie).

### 13.4 Przebieg wykonawcy — SPRAWDZENIE PRZYRZĄDU, NIE WERDYKT

Wykonawca przeszedł bramkę sam, żeby sprawdzić, że przyrząd działa i że pełna scena nie psuje
odpowiedzi. **To nie jest werdykt na D1 i nie wolno go tak czytać** — pięciu pytań rozstrzyga
człowiek patrzący na ekran.

| przebieg | wynik | podłoga zgadywania |
|---|---|---|
| **pełna scena, tryb progowany (oceniany), z widoku całej tarczy** | **15/15** | 50% |
| kontrola pozytywna PO uszczelnieniu | 8/15 (stała odpowiedź) | 50% |
| kontrola pozytywna PRZED uszczelnieniem (ta sama metoda) | 8/15 (stała odpowiedź) | 50% |

Tryb progowany: **te same piętnaście komórek i te same piętnaście odpowiedzi, co w tabeli §6**
(97, 215, 933, 1169, 11, 95, 96, 426, 282, 875, 4, 3, 243, 988, 757). **Żadna próba nie stała
się trudniejsza po dołożeniu kraty, budynków i jednostek** — w przebiegu wykonawcy.

**Ograniczenie tego przebiegu, zapisane wprost:** wykonawca czytał §6 tego dokumentu PRZED
przebiegiem, a maska jasna/ciemna jest **wspólna dla wszystkich trzech planów** (ziarno
`LIT_PATTERN_SEED` nie zależy od `offset`), więc znał sekwencję prawd. Zobowiązał się
odpowiadać wyłącznie z obrazu i wynik 8/15 w obu kontrolach — z pięcioma błędami tam, gdzie
znana sekwencja dawała poprawną odpowiedź — jest tego świadectwem, ale **nie dowodem**.
Przebieg CZŁOWIEKA, który tej sekwencji nie zna, jest jedynym czystym pomiarem.

### 13.5 Budżet klatki przy pełnej scenie (Krok 3)

| co | wartość |
|---|---|
| **mediana renderu** | **0,800 ms** |
| **p95 renderu** | **1,300 ms** |
| budżet | 8 ms |
| jednostek | **481** (szczyt zmierzony w Fazie 1C, utrzymywany dosypywaniem) |
| budynków | 148 |
| komórek | 1442 |
| okno | n = 1000 klatek, wyłącznie z trybu swobodnego |
| rusztowanie symulacji (POZA budżetem) | mediana 0,000 ms |
| **maszyna** | **Apple M5 (Mac17,2), 10 rdzeni, macOS 26.6.2**, przeglądarka w panelu Browser |

Dla porównania: 2A mierzyła 0,200 ms mediany przy samym terenie, Zadanie 2 — 0,50 ms / 0,855 ms
po dołożeniu kraty. Pełna scena z 481 jednostkami i 148 budynkami mieści się w **10% budżetu**.

Pierwsze klatki po starcie pokazują p95 rzędu 7-12 ms — to rozgrzewka shaderów, nie wydajność
(ta sama uwaga co w §12.2). Odczyt brać dopiero przy n = 1000.

Osobno, bez GPU: `budget.test.ts` mierzy CAŁĄ pracę CPU per klatka pełnej sceny (kolorowanie
terenu i kraty + budynki + jednostki) i pilnuje, że **nie alokuje niczego**. Zmierzona
rozdzielczość tego pomiaru jest zapisana w komentarzu testu, razem z mutacją, której NIE łapie.

### 13.6 PIĘĆ PYTAŃ — CZEKA NA WŁAŚCICIELA PROJEKTU

**To jest sekcja, której wykonawca nie wypełnia.** Wklej tu blok z panelu
(`/scene-gate.html`, pole „Do wklejenia w dokument wyników").

| # | pytanie | werdykt | uwagi |
|---|---|---|---|
| 1 | Czy terminator nadal jest czytelny przy pełnej scenie? | **PASS — 15/15** | orzeczone przez właściciela projektu. **Zero regresji** wobec 15/15 z §6 po dołożeniu kraty, budynków i jednostek |
| 2 | Czy widać, który budynek jest niezasilony, bez najeżdżania kursorem? | — | |
| 3 | Czy widać, że jednostka się pali, zanim zginie? | — | |
| 4 | Czy widać cieniowanie jednostki czynnikiem 0,8464? | — | **odpowiedź musi pochodzić z presetów `/scene-gate.html`**; klawisze w głównej aplikacji dają 0,55, czyli wariant POZA budżetem — patrz pułapka w §13.3. Jeśli NIE — argument Zadania 4 domyka się i `flat` zostaje bez zastrzeżeń; jeśli TAK — ustalenie do Fazy 4, nie powód do zmiany teraz |
| 5 | Czy widać, że pierścień alarmu pulsuje? | — | jeśli NIE — pierścień zostaje bez pulsu; amplitudy NIE wolno podnosić ponad rozmiar komórki |

#### Materiał, na którym te pytania stoją — zmierzony, nie oszacowany

**Pytanie 4.** Wariant legalny to `UNIT_BAND_SHADE_LEGAL = [0,8464; 0,9232; 1,0]`. **0,8464, nie
0,8463 ani 0,846334**: granica z bisekcji jest kresem DOLNYM, nie osiągalnym minimum. Test 22
(`unitMesh.test.ts`) przypina parę tuż przy granicy — `passesAt(0,8464)` prawda,
`passesAt(0,8463)` fałsz, `passesAt(0,846334)` fałsz — oraz MINIMALNOŚĆ (nie ma mniejszego
czynnika przy rozdzielczości czterech cyfr, który też przechodzi). Czynnik 0,8464 zmienia rdzeń
jednostki o **18/255 sRGB**; obserwacja, na której Zadanie 4 oparło wniosek, była przy 0,55,
czyli przy **59/255**. Panel daje oba warianty obok siebie (klawisze 1-4), przy zatrzymanym
słońcu.

**Pytanie 5.** Puls wrócił do `BuildingLayer.update` jako opcjonalne, **domyślnie zerowe**
wychylenie promienia (test 24 pilnuje, że domyślna ścieżka daje macierze identyczne co do bitu
jak przed tym zadaniem). Maksymalna LEGALNA amplituda to **cały** pozostały zapas między
pierścieniem (3,0300) a sufitem narzuconym rozmiarem komórki (3,1720):

| co | wartość |
|---|---|
| amplituda `ALERT_PULSE_AMPLITUDE_FACTOR` | **0,13 jednostki** |
| to samo w pikselach widoku domyślnego | **0,44 px** |
| próg widoczności (§5.3 raportu Zadania 3) | 1 px |
| szczyt pulsu | 3,1600 przy sufucie **3,1720** |
| komórek z przekroczeniem na szczycie pulsu | **0 z 1442** (test 8) |

Czyli: to nie jest amplituda dobrana tak, żeby puls było widać — to jest **maksimum tego, co w
ogóle istnieje**. Sufitem jest rozmiar komórki, nie dobór wartości, i dokładnie tę różnicę
pytanie 5 pokazuje. Amplituda większa o 0,0002 promienia oblewa test 8 (para mutacji w §13.7).

### 13.7 Tabela mutacji — czym zabija się każdy nowy próg Zadania 5

Dla każdego progu para: **tuż za granicą** (ma oblać) i **tuż przed** (ma przejść), obie blisko
granicy. Baseline: 587 zielonych w 39 plikach.

| # | złamana własność | mutacja | wynik |
|---|---|---|---|
| M1 | kamera nie celuje w pytaną komórkę | `CAMERA_OFFSET_MIN/MAX = 0` | **oblewa** 5c, 5d |
| M1b | dolna granica odchylenia | `CAMERA_OFFSET_MIN = 13` (tuż za) | **oblewa** 5d |
| M1c | — | `CAMERA_OFFSET_MIN = 14` (dziś, tuż przed) | przechodzi |
| M2 | offset ten sam dla odpowiadającej próby w każdym trybie | indeks offsetu z `cellId` zamiast z numeru próby | **oblewa** 5c |
| M3 | uniesienie znacznika | `MARKER_MIN_LIFT_FACTOR = 0,012` (wartość sprzed zadania) | **oblewa** 5b |
| M3b | — | `0,035` (tuż przed) | przechodzi |
| M3c | — | `0,030` (tuż za) | **oblewa** 5b |
| M4 | zerowa paralaksa znacznika | uniesienie wzdłuż NORMALNEJ zamiast w stronę kamery | **oblewa** 5 |
| M5 | wariant legalny mieści się w budżecie 3:1 | `UNIT_BAND_SHADE_LEGAL[0] = 0,8463` (tuż za) | **oblewa** 22 |
| M5b | wariant legalny jest MAKSYMALNY | `0,8465` (legalne, ale nie maksymalne) | **oblewa** 22 |
| M5c | warstwa faktycznie stosuje podane czynniki | `setShadingBands` ignoruje argument | **oblewa** 22 |
| M6 | puls mieści się w komórce | `ALERT_PULSE_AMPLITUDE_FACTOR = 0,0015` (tuż za) | **oblewa** 8, 23 |
| M6b | — | `0,0014` (tuż przed) | przechodzi |
| M7 | puls domyślnie WYŁĄCZONY | domyślne `alertPulse` = maksimum | **oblewa** 23, 24 |
| M8 | warstwy pełnej sceny gasną razem z planetą | warstwy jako RODZEŃSTWO siatki terenu | **oblewa** 33b |
| M9 | pełna scena nie alokuje w pętli renderu | `Float64Array(64)` na jednostkę | **oblewa** test budżetu |
| M9b | — | `Math.sqrt` → `Math.hypot` (481 alok./klatkę) | **NIE oblewa** — granica czułości, zapisana w komentarzu testu |
| M10 | `paintTerrain` tylko w trybie ocenianym | usunięty strażnik trybu | **oblewa** 34 |
| M11 | wykrywanie ODPOWIEDZI STAŁEJ | wyłączone | **oblewa** 24b |
| M11b | — | adnotacja drukowana ZAWSZE | **oblewa** 24b |
| M12 | *(kontrola na samą tabelę)* rozluźnienie `toBe(8)` → `toBeGreaterThanOrEqual(1)` w 33b | — | przechodzi, czyli rozluźnienie JEST wykrywalne tylko przez czytanie diffu |

Połówka „ma przejść" wykryła w tym zadaniu jedną wadę: przy M5b okazało się, że pierwsza wersja
testu 22 przypinała `Math.min(...UNIT_BAND_SHADE_LEGAL) === 0,8464` **kotwicą na dzisiejszą
liczbę**, zamiast własnością „to jest najmniejszy czynnik, który przechodzi". Przepisane na
minimalność; oblewa teraz obie strony, a nie tylko jedną.

### 13.8 Runda naprawcza 1 — panel stawiał swoje uzasadnienie NAD swoimi instrumentami

Człowiek przeszedł bramkę. **Pytanie 1: 15/15 PASS — zero regresji terminatora po dołożeniu
kraty, budynków i jednostek.** Tabela piętnastu prób jest kompletna i stoi.

**Pytania 2-5 nie zostały zmierzone tym instrumentem, i przyczyna była jedna.** Wszystkie
przełączniki trybu swobodnego istniały i działały, ale leżały **pod krawędzią przewijania**, za
trzema akapitami metodologii. Człowiek przewinął przez prozę, zobaczył przyciski faz i do
przełączników **nigdy nie dotarł**: odpowiedział na pytania 2, 3 i 4 z głównej aplikacji, a na
5 wpisał „nie da się rozstrzygnąć", co znaczyło „nie znalazłem przełącznika".

**Jedna z tych odpowiedzi była gorsza niż brak odpowiedzi.** Pytanie 4 dostało „TAK — widać
delikatną różnicę", ale klawisze w głównej aplikacji dają **0,55**, czyli wariant, który ten
sam panel opisuje jako poza budżetem. Potwierdzało to Δ 59/255, o czym wiadomo od Zadania 4; o
**0,8464** (Δ 18/255) — jedynym otwartym pytaniu — nadal nie wiemy nic. Wpisanie tego „TAK" do
§13.6 byłoby **fałszywym wynikiem**.

Cztery naprawy, wszystkie w panelu i w tym, co on mówi — **żadna nie dotyka tego, co renderuje**:

| co | naprawa |
|---|---|
| przyrządy pod prozą | kontrolki pytań 2-5 **zaraz pod przyciskami faz**, proza w zwijanych `<details>` na dole; sprawdzone programowo przy oknie **480 px**: `scrollTop = 0`, wszystkie cztery grupy w kadrze |
| pytanie 4: pułapka głównej aplikacji | jednolinijkowe **ostrzeżenie przy samych przyciskach** + pełne w `<details>` + w treści pytania |
| pytanie 3: „nie giną" | „linijka" (rampa 3×5) **nie była rysowana w trybie swobodnym** — realna wada, naprawiona; dołożony licznik **spalonych przez słońce** (`SimState.killsBySun`) i opis, czego szukać |
| pytanie 2: „słońce się nie rusza" | odczyt **„obrót …%"** z paskiem + przełącznik tempa **×8**, odnotowywany w eksporcie |

Wada z pytania 3 była realna: `unitsToDraw = sim.units` pomijało `rulerUnits`, więc odniesienia
— w tym stanu tuż przed śmiercią — **na ekranie nie było**, choć panel o nim pisał. Jednostki
ginęły przez cały czas (licznik po kilkudziesięciu sekundach pokazuje setki), tylko nie było z
czym porównać.

Metoda sprawdzenia jest tą samą, co „patrz na obu skalach": **instrument obejrzany w warunkach
użycia, nie we własnych.** Przy 1080 px defekt jest niewidoczny.

### 13.9 Stan po zadaniu

`587 testów w 39 plikach`, `pnpm typecheck` czysty, `pnpm test` zielony (trzy pełne przebiegi
pod obciążeniem równoległym). Testy 33, 15 i 14 — zapadki zastawione na to zadanie —
**nietknięte**; zamiast nich dołożone 33b (pełna scena) i 34 (faza swobodna).

Zrobiony przy okazji ruling zapisany po werdykcie Zadania 1: **panel wykrywa ODPOWIEDŹ STAŁĄ i
mówi to wprost** w eksportowanym logu, zamiast pokazywać liczbę wyglądającą na przypadek.
Zadanie 5 wyprodukowało ten przypadek dwa razy z rzędu (oba przebiegi kontroli), więc adnotacja
stoi już przy obu tabelach z §13.2.

**Pytanie 1 rozstrzygnięte przez człowieka: 15/15 PASS.** Pytania 2-5 czekają — patrz §13.8.
