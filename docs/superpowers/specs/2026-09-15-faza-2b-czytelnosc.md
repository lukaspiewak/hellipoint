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

`packages/render/src/positiveControl.ts`. Odtwarza awarię Fazy 0 dosłownie, na dwóch
warstwach naraz:

1. **Wierzchołki WSPÓŁDZIELONE.** Jeden wierzchołek na komórkę (jej środek), trójkąty łączą
   środki trzech wzajemnie sąsiadujących komórek — siatka dualna do goldbergowej.
   Zmierzone: **1442 wierzchołki, 2880 trójkątów**, czyli dokładnie `2V − 4` ze wzoru Eulera
   (i `V − E + F = 2` policzone z faktycznie zapisanych trójkątów — test `positiveControl.test.ts` #2).
   Każdy wierzchołek należy do 5 (pentagon) albo 6 (heksagon) trójkątów.
2. **Kolor liczony PER WIERZCHOŁEK, ciągłą rampą** noc→dzień wg `light` komórki-wierzchołka,
   z pominięciem `lightBand`.

Razem: na całej powierzchni **nie ma ani jednej nieciągłości koloru (C⁰)** — a to właśnie
nieciągłości C⁰ oko czyta jako „linia". Zmierzone: 1464 z 2880 trójkątów ma wierzchołki o
różnych kolorach (w siatce gry — **zero**, bo każda komórka ma własne wierzchołki).

Nawinięcie trójkątów jest **naprawiane, nie zakładane**: bez poprawki **1440 z 2880** wyszłoby
zwróconych do wewnątrz, a `MeshBasicMaterial` rysuje tylko przednie ściany — dziura w kontroli
sama zdradzałaby położenie.

### 3.1 Czego kontrola NIE zmienia — i dlaczego to nie osłabia dowodu

Wartości barw **per wierzchołek** są w kontroli identyczne jak w trybie „gradient, płaskie
komórki" (tabela w §4.3: 0,0655–0,1539 w obu). Różnica nie leży w liczbach na wierzchołkach,
tylko w tym, że w kontroli **nigdzie nie ma skoku** — GPU rozciąga te same wartości w rampę.
Dokładnie to Faza 0 zmierzyła jako nieczytelne i dokładnie tego nie potrafiła odtworzyć
kontrola 2A.

### 3.2 DOWÓD, ŻE KONTROLA DZIAŁA: przebieg wykonawcy w trybie kontrolnym

Wykonawca przeszedł **pełne piętnaście prób w trybie kontrolnym**, na żywym renderze
(`http://localhost:5181/gate.html`), odpowiadając wyłącznie z tego, co widział. Plan kontrolny
był mu nieznany (rozłączny zestaw komórek, przetasowana maska jasna/ciemna).

**Wynik: 8/15 (53%), przy podłodze zgadywania 50% i najlepszej stałej odpowiedzi 8/15.**

| # | Faza | Komórka | Prawda | Odpowiedź | Wynik |
|---|---|---|---|---|---|
| 1 | 1 | 119 | oświetlona | ciemna | BŁĄD |
| 2 | 1 | 221 | oświetlona | oświetlona | OK |
| 3 | 1 | 941 | oświetlona | ciemna | BŁĄD |
| 4 | 1 | 1171 | oświetlona | oświetlona | OK |
| 5 | 1 | 96 | ciemna | ciemna | OK |
| 6 | 2 | 108 | oświetlona | oświetlona | OK |
| 7 | 2 | 109 | ciemna | ciemna | OK |
| 8 | 2 | 621 | oświetlona | ciemna | BŁĄD |
| 9 | 2 | 399 | ciemna | oświetlona | BŁĄD |
| 10 | 2 | 884 | ciemna | ciemna | OK |
| 11 | 3 | 28 | ciemna | oświetlona | BŁĄD |
| 12 | 3 | 27 | oświetlona | ciemna | BŁĄD |
| 13 | 3 | 735 | ciemna | ciemna | OK |
| 14 | 3 | 1032 | ciemna | ciemna | OK |
| 15 | 3 | 763 | oświetlona | ciemna | BŁĄD |

**Co było widać:** płynna rampa od granatu do kremu przez całą tarczę i **ani jednej linii**.
Pierścień zawsze stał na jednolicie wyglądającym obszarze; nie było punktu odniesienia, wobec
którego dałoby się powiedzieć „to jest już po jasnej stronie". Odpowiedzi rozłożyły się 5×
„oświetlona" / 10× „ciemna" — przechył ku nocy, bo w rampie cała okolica granicy wygląda jak
noc. Z ośmiu komórek faktycznie oświetlonych trafione zostały trzy.

**Wniosek: bramka POTRAFI wyprodukować odpowiedź „nie widzę".** Czego nie potrafiła bramka
Fazy 2A.

### 3.3 Trzeci tryb (gradient, płaskie komórki) — i co z zestawienia wynika

`setMode('smooth')` zostaje jako trzeci punkt odniesienia: zmienia **tylko** mapowanie palety,
zostawiając komórki płaskimi. Obejrzane na żywo: komórki są widoczne jako osobne łaty o lekko
różnych odcieniach, ale **linii nie ma** — dokładnie jak opisuje §7.3.3 specu 2A.

Zestawienie trzech trybów przypisuje zasługę właściwej warstwie:

| tryb | geometria | kolor | co widać |
|---|---|---|---|
| `threshold` | osobne wierzchołki | progowany | **linia przez całą tarczę** |
| `smooth` | osobne wierzchołki | gradient | płaskie łaty, granicy nie widać |
| `control` | **współdzielone** | gradient per wierzchołek | jednolita rampa, nic |

Uwaga, która wynika z nowego pytania i której stare nie mogło pokazać: przy pytaniu
**globalnym** także tryb `smooth` przestaje być odpowiadalny — a przy pytaniu **lokalnym**
z Fazy 2A był (15/15 było w nim osiągalne). To jest najmocniejsze pojedyncze potwierdzenie,
że przeprojektowanie trafia w rzecz.

---

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

## 6. Surowa tabela piętnastu osądów (do wklejenia z `gate.html`)

<!-- Wklej tu dosłownie zawartość pola tekstowego z gate.html, wariant "Progowany (oceniany)". -->

| # | Faza | Komórka | Prawda | Odpowiedź | Wynik |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

Wynik: __ / 15

---

## 7. WERDYKT — CZEKA NA WŁAŚCICIELA PROJEKTU

**To jest jedyna sekcja tego dokumentu, której wykonawca nie wypełnia.**

### 7.1 Werdykt

<!-- PASS wymaga kompletu piętnastu. -->

# ____

### 7.2 Co ten werdykt znaczy, a czego nie znaczy

<!-- Do wypełnienia przez człowieka. -->

### 7.3 Przebieg kontrolny (jeśli wykonany)

Wynik w trybie kontrolnym: __ / 15.

Czy w trybie kontrolnym granica była widoczna? (tak/nie, i co dokładnie było widać)

### 7.4 Jeśli werdykt jest inny niż PASS — co zapisać

- **Które konkretnie próby (numery z §6) zawiodły** i, jeśli pamiętasz, dlaczego: komórka
  wyglądała dwuznacznie, pierścień obejmował więcej niż jedną łatę, kamera stała niewygodnie,
  cokolwiek innego.
- Czy trudność dotyczyła **granicy noc↔(cokolwiek jasne)** — to byłby wynik D1-krytyczny,
  uderzający w filar projektu — czy **wahania w obrębie strony jasnej** (półmrok kontra
  dzień), o którą ta bramka z definicji nie pyta (§2.3), więc byłaby to sprawa Fazy 4.
- **Czy przebieg kontrolny wyszedł wyraźnie powyżej 50%.** Jeśli tak, to podważa sam
  instrument, nie tylko wynik, i musi zostać zbadane **przed** jakąkolwiek decyzją.

---

## 8. Przebieg wykonawcy — POMIAR CZUŁOŚCI, NIE WERDYKT

Wykonawca przeszedł oba przebiegi sam, żeby sprawdzić, że przyrząd rozróżnia tryby. To **nie
jest** werdykt na D1 i nie wolno go tak czytać.

| tryb | wynik | podłoga zgadywania |
|---|---|---|
| **kontrola pozytywna** (współdzielone wierzchołki) | **8/15** (53%) | 50% / 8-15 stałą odpowiedzią |
| **progowany** (render gry) | **13/15** (87%) | 50% |

**Obie pomyłki w trybie progowanym (próby 2 i 4) padły przy mocnym przybliżeniu kamery**, gdy
w kadrze zostawało kilka komórek, a pierścień był wielkości komórki. Dziesięć kolejnych prób
(6–15), ocenianych z widoku całej tarczy, to **10/10** przy natychmiastowej pewności: barwa
pod pierścieniem to granat albo pomarańcz, bez odcieni pośrednich.

**Sprawdzone wprost, zamiast założone:** wykonawca wrócił świeżą stroną do komórki 1169
(jedna z dwóch pomylonych) i obejrzał ją **przy obu poziomach zoomu** — wnętrze pierścienia
było pomarańczowe w obu, zgodnie z prawdą. Odpowiedniość znacznik↔komórka jest więc poprawna;
pomyłki były odczytem wykonawcy, nie wadą przyrządu. Skutkiem tego ustalenia jest punkt 5
protokołu i nowy akapit w instrukcji panelu.

Nie zmienia to jednak niczego w §7: **13/15 to nie jest PASS i wykonawca żadnego werdyktu nie
wydaje.**

---

## 9. Tabela mutacji — czym zabija się każdy nowy test

Dla każdego nowego testu złamano nazwaną przez niego własność, uruchomiono zestaw
(151 testów w 10 plikach pakietu `render`) i zapisano, które testy czerwienieją. Baseline: 0
czerwonych. Skróty: `SH` = `shading.test.ts`, `TP` = `terminatorPairs.test.ts`,
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
| `packages/render/test/positiveControl.test.ts` | **nowy** — 10 testów |
| `packages/render/test/readabilityGate.test.ts` | przepisany — 31 testów |
| `packages/render/test/terminatorPairs.test.ts` | przepisany — 24 testy |
| `packages/render/test/shading.test.ts` | zmienione #1, #2, #12, #13, #14; **nowy #18** |

Baseline przed tym zadaniem: 496 testów w 36 plikach. Po nim: **516 testów w 37 plikach**,
`pnpm typecheck` czysty, `pnpm test` zielony.
