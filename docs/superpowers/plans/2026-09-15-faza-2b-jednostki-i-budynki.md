# Faza 2B — Jednostki i budynki na ekranie

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postawić na widocznej planecie z Fazy 2A **jednostki i budynki**, tak żeby gracz czytał wzrokiem nie tylko granicę światła, ale też **co gdzie stoi i w jakim jest stanie** — a przy okazji naprawić bramkę czytelności, która w 2A okazała się mierzyć inną zdolność, niż deklarowała.

**Architecture:** `packages/render` rośnie o warstwę obiektów: budynki jako `InstancedMesh` per typ (dziesięć typów, ≤ 1442 sztuki łącznie), jednostki jako `InstancedMesh` per typ wroga (trzy typy, setki sztuk, pozycje zmieniane co klatkę). Stany czytelne **bez UI**: zasilony wobec niezasilonego, budynek uszkodzony, jednostka płonąca w świetle. Symulacja pozostaje nietknięta (D5) — render czyta `SimState` i **nigdy go nie modyfikuje**.

**Tech Stack:** TypeScript (strict), Three.js 0.186, Vite, Vitest, pnpm workspaces, Node ≥ 22.

**Spec:** [`docs/superpowers/specs/2026-09-14-project-heliopolis-design.md`](../specs/2026-09-14-project-heliopolis-design.md) — §3 (D1, D3), §4.4, §5.1, §6.1, §8.1.

**Wyniki i korekty Fazy 2A:** [`docs/superpowers/specs/2026-09-15-faza-2a-czytelnosc.md`](../specs/2026-09-15-faza-2a-czytelnosc.md) — **przeczytaj §7.3.1 i §7.3.3 przed Zadaniem 1**, są wiążące.

**Wymaga ukończonej Fazy 2A** (na `main`, 496 testów).

---

## Global Constraints

Wszystkie ograniczenia Fazy 2A obowiązują dalej. Powtarzam te, które ta faza może złamać:

- **`packages/sim` bez zależności runtime.** Strażnik `contract.test.ts` obejmuje teraz także `optionalDependencies` i każde rozszerzenie źródła — nie rozluźniaj go.
- **Render NIGDY nie mutuje `SimState` ani `Planet`.** Czyta i rysuje.
- **Materiał terenu pozostaje bez modelu oświetlenia.** `MeshBasicMaterial` z `vertexColors: true`. Jeśli dodasz materiał oświetlony dla jednostek albo budynków, **nie wolno mu wpłynąć na teren** — żadnych `THREE.Light` w scenie bez sprawdzenia, że pasma terenu nadal są płaskie.
- **Czytelność terminatora jest nadrzędna wobec wszystkiego, co ta faza dodaje.** Każda zmiana wyglądu terenu i każdy nowy element na nim musi przejść bramkę z Zadania 1. To jest ograniczenie, nie sugestia — D1 niesie spawn, spalanie i całą ekonomię dnia i nocy.
- **Brak alokacji w pętli renderu.** 2A wprowadziła tę dyscyplinę i ma test na liczbę cykli odśmiecania; jednostki ruszają się co klatkę, więc to tutaj jest realne ryzyko.
- Każda liczba czysto wizualna oznaczona `// [WYGLĄD]`.
- Commit po każdym zadaniu.

---

## Zadania

### Task 1: Bramka, która naprawdę bada D1, i decyzja o progu

**Files:**
- Modify: `packages/render/src/readabilityGate.ts`, `packages/render/src/terminatorPairs.ts`, `apps/client/gate.html`, `apps/client/src/gate.ts`, `packages/render/src/shading.ts`
- Test: `packages/render/test/readabilityGate.test.ts`, `packages/render/test/shading.test.ts`
- Create: `docs/superpowers/specs/2026-09-15-faza-2b-czytelnosc.md`

**To zadanie idzie PIERWSZE, przed jakimkolwiek nowym elementem na ekranie.** Powód: Zadania 2–4 zmieniają wygląd sceny, a nie da się zmierzyć, czy jej nie popsuły, przyrządem, który mierzy nie to.

**Co jest nie tak z bramką z 2A** (pełny zapis w §7.3.3 wyników 2A): pyta **lokalnie** — „która z tych dwóch zaznaczonych, sąsiadujących komórek jest oświetlona". D1 mówi o czytelności **globalnej** — „spójrz na kulę i zobacz, gdzie biegnie granica". Wymuszony wybór między dwiema wskazanymi komórkami sprowadza się do „wskaż jaśniejszą" i jest rozwiązywalny przy **dowolnej** monotonicznej palecie, więc bramka przechodzi także przy cieniowaniu ciągłym — co właściciel projektu zauważył i co potwierdzono pomiarem.

**Zaobserwowane wprost, i to jest podstawa nowego projektu bramki:** w trybie progowanym granica jest widoczna **jako linia przez całą tarczę**; w trybie ciągłym ta linia **znika całkowicie**, mimo że pary pozostają rozróżnialne. Pytanie globalne **rozróżnia** oba tryby. Pytanie lokalne nie.

- [ ] **Krok 1: Wybierz kształt pytania globalnego i uzasadnij wybór**

Dwa warianty, oba tanie. Zaimplementuj **ten, który lepiej uzasadnisz**, i zapisz, dlaczego odrzuciłeś drugi:

1. **Wskazanie linii** — człowiek klika kilka punktów wzdłuż terminatora; mierzymy odchylenie od prawdziwej granicy **w krokach grafu**. Zaleta: mierzy dokładnie to, co mówi D1. Wada: wymaga zdefiniowania, co znaczy „trafił", a odchylenie zależy od zoomu.
2. **Klasyfikacja bez sąsiadki** — pokazujemy **jedną** zaznaczoną komórkę i pytamy, po której stronie granicy leży. Zaleta: bez pary odniesienia „wskaż jaśniejszą" przestaje być strategią, a ocena jest binarna i bezdyskusyjna. Wada: przy komórce daleko od granicy pytanie jest trywialne, więc dobór komórek musi celować blisko niej.

- [ ] **Krok 2: Kontrola pozytywna, która NAPRAWDĘ potrafi oblać**

Bramka jest bezwartościowa, jeśli nie umie wyprodukować odpowiedzi „nie widzę". Nowa kontrola musi odtwarzać **rzeczywisty tryb awarii z Fazy 0**: kolor **interpolowany po powierzchni**, czyli geometria ze współdzielonymi wierzchołkami albo kolor liczony per wierzchołek z pozycji, a nie per komórka.

**To nie jest to samo co `writeCellColorsSmooth` z 2A** — tamta zmienia mapowanie palety, zostawiając komórki płaskimi, i dlatego nie potrafi oblać. Zbuduj wariant geometrii ze współdzielonymi wierzchołkami wyłącznie na potrzeby tej kontroli; nie musi być wydajny ani ładny, ma **rozmazywać**.

Dowód, że kontrola działa: **przejdź sam kilka prób w trybie kontrolnym i zaraportuj, czy potrafiłeś odpowiedzieć.** Jeśli potrafiłeś — kontrola nadal nie odtwarza awarii i trzeba ją poprawić, a nie zaraportować jako gotową.

- [ ] **Krok 3: Decyzja o `LIGHT_BANDS[0]` — obniż do zera**

**Rozstrzygnięte, nie do ponownej dyskusji; uzasadnienie zapisuję, żeby nikt tego nie cofnął bez powodu.** Zmierzone w 2A: przy progu 0,05 granica renderowana i **symulowana** rozjeżdżają się o 8–38 komórek (średnio 30,8), zawsze o **dokładnie jeden krok grafu**. Dla energii to szum poniżej 5 %, ale **spawn i spalanie są binarne** — więc istnieje jednokomórkowy pierścień, w którym **gracz widzi noc, a jednostki się palą i pentagony nie spawnują**.

Próg zerowy sprawia, że pasmo nocy znaczy dokładnie `light === 0`, czyli **dokładnie to samo, co symulacja**. Granica staje się pełnym skokiem palety na linii fizycznej — czytelniejsza, nie mniej.

Zmierz i zaraportuj po zmianie: rozkład komórek po pasmach i **liczbę komórek rozjeżdżających się między renderem a symulacją** (powinna wynieść zero przy każdej fazie słońca — jeśli nie wynosi, coś jest nie tak i zgłoś to zamiast zaokrąglać).

- [ ] **Krok 4: Przeprowadź bramkę i zostaw werdykt człowiekowi**

Piętnaście osądów, trzy fazy słońca. **PASS wymaga kompletu.** Ty budujesz i sprawdzasz przyrząd; **werdyktu nie wydajesz.** Zapisz protokół i puste miejsce na werdykt w nowym dokumencie wyników, tak jak zrobiło to Zadanie 5 Fazy 2A.

---

### Task 2: Siatka widoczna, bez psucia terminatora

**Files:**
- Modify: `packages/render/src/planetMesh.ts`, `packages/render/src/shading.ts`
- Test: `packages/render/test/planetMesh.test.ts`

**Problem zaobserwowany w 2A:** przy przybliżeniu dzienna strona planety jest **jednolitą płaszczyzną bez jednej linii** — żadnych krawędzi komórek, żadnych punktów odniesienia. Wynika to z dwóch świadomych i słusznych decyzji: materiał bez modelu oświetlenia oraz jeden kolor na całe pasmo.

Dla 2A to nie była wada. **Dla tej fazy jest, i to u podstaw:** jednostki i budynki staną na płaszczyźnie bez odniesień, gracz **nie zobaczy kraty, na której buduje** — a w tower defense rozmieszczenie jest główną decyzją — a przy obrocie nad jednolitym obszarem nie ma czucia ruchu ani skali.

- [ ] **Krok 1: Wybierz rozwiązanie i zmierz je bramką z Zadania 1**

Warianty warte sprawdzenia, w kolejności rosnącego ryzyka dla czytelności:
1. **cienkie obrysy komórek** — osobna geometria linii po krawędziach, kolor stały albo zależny od pasma;
2. **subtelne zróżnicowanie w obrębie pasma**, deterministyczne z `cellId`, **nieprzekraczające granicy pasma** — czyli najciemniejszy odcień pasma jaśniejszego musi zostać wyraźnie jaśniejszy od najjaśniejszego odcienia pasma ciemniejszego;
3. **poleganie na samych budynkach** jako punktach odniesienia — podejrzewam, że niewystarczające, ale ta faza i tak je dodaje, więc da się to sprawdzić za darmo.

**Twarde ograniczenie:** cokolwiek wybierzesz, **bramka z Zadania 1 musi przejść po zmianie**. Zmierz odległość barw przez terminator przed i po — jeśli spadła, wariant jest zły, niezależnie od tego, jak ładnie wygląda.

- [ ] **Krok 2: Test na nieprzekraczanie granicy pasma**

Jeśli wybrałeś wariant 2, to jest jego kluczowy test i musi być asercją **na wartość bezwzględną**, nie relacyjną: minimum odcieni pasma N+1 **ściśle większe** od maksimum odcieni pasma N, zmierzone na wszystkich 1442 komórkach. Asercja relacyjna („różnią się") przeszłaby dla wariantu, który tę granicę zaciera — a to jest ten sam kształt defektu, który w 2A wystąpił trzykrotnie.

---

### Task 3: Budynki na ekranie

**Files:**
- Create: `packages/render/src/buildingMesh.ts`
- Test: `packages/render/test/buildingMesh.test.ts`

**Interfaces:**
- Consumes: `SimState.buildings: (Building | null)[]`, `BUILDINGS`, `PlanetGeometry`
- Produces: `createBuildingLayer(planet, geo)` → `{ object, update(buildings), dispose() }`

Dziesięć typów budynków (`CORE`, `BARRICADE`, `PYLON`, `SOLAR_PANEL`, `BATTERY`, `EXTRACTOR`, `KINETIC_TURRET`, `LASER_TURRET`, `GEOTHERMAL_CAP`, `EVACUATION_MODULE`), maksymalnie 1442 sztuki naraz, każdy na środku swojej komórki, zorientowany normalną.

- [ ] **Krok 1: Stany czytelne bez UI**

`Building` niesie `hp` i `powered`. Oba muszą być widoczne **bez najeżdżania kursorem**:
- **niezasilony** — to jest stan, który w tej grze boli, bo brownout gasi obronę w środku ataku (§5.1). Gracz musi go zobaczyć natychmiast.
- **uszkodzony** — `hp` względem `BUILDINGS[type].hp`.

Dobierz kodowanie i **uzasadnij je**, pamiętając, że teren pod spodem ma już trzy pasma, a jednostki dojdą w Zadaniu 4. Kodowanie jasnością będzie kolidować z pasmami terenu; kształt, obrys albo ruch kolidują mniej.

- [ ] **Krok 2: Mutacja obowiązkowa — czy stan naprawdę jest widoczny**

Dla każdego stanu: ustaw go w `SimState`, wyrenderuj, i **dowiedź testem, że wyjście się zmieniło** — kolor instancji, macierz, cokolwiek niesie tę informację. Test asercjujący, że „funkcja została wywołana", nie wystarcza; ten projekt ma dziesięć testów nazwanych od zachowania, którego braku by nie wykryły.

---

### Task 4: Jednostki na ekranie

**Files:**
- Create: `packages/render/src/unitMesh.ts`
- Test: `packages/render/test/unitMesh.test.ts`

**Interfaces:**
- Consumes: `SimState.units: Unit[]`, `ENEMIES`, `lightField`
- Produces: `createUnitLayer(planet)` → `{ object, update(units, light), dispose() }`

Trzy typy (`SWARM`, `ARMOR`, `DISRUPTOR`), setki sztuk naraz, pozycje **zmieniane co klatkę** — `Unit.pos` jest wektorem świata, nie identyfikatorem komórki, więc jednostki poruszają się płynnie między komórkami.

- [ ] **Krok 1: Instancing bez alokacji w pętli**

Bufor macierzy alokowany raz, o rozmiarze na maksymalną spodziewaną liczbę jednostek. **Zmierzone w Fazie 1C: szczyt 481 żywych jednostek w zwycięskim runie, 5044 zrodzone łącznie.** Dobierz zapas i zapisz, na jakiej liczbie się oparłeś. Test na liczbę cykli odśmiecania, wzorem `budget.test.ts` z 2A.

- [ ] **Krok 2: Jednostka płonąca w świetle — sprzężenie zwrotne dla N3**

`Unit.exposure` rośnie w świetle i jednostka ginie po `ENEMIES[type].burnTime`. **To jest widoczna konsekwencja niezmiennika N3** i gracz musi ją czytać, bo na niej stoi cała ekonomia dnia i nocy: ARMOR wchodzący w światło jest skazany, SWARM ucieknie.

Zakoduj postęp spalania tak, żeby był widoczny **na jednostce wielkości kilku pikseli** — to jest realne ograniczenie, bo przy 1442 komórkach na kuli jednostka jest mała.

- [ ] **Krok 3: Otwarte pytanie do rozstrzygnięcia POMIAREM, nie założeniem**

**Czy jednostki mają być cieniowane progowo, jak teren?** Argument za spójnością mówi „tak". Argument przeciw mówi, że jednostka jest mała i pasma na niej będą migotać przy ruchu między komórkami o różnym paśmie.

Zaimplementuj oba, obejrzyj oba w ruchu i **zaraportuj, co widzisz**. Nie zgaduj — to jest dokładnie ten rodzaj pytania, na które ta sesja czterokrotnie odpowiadała błędnie z fotela.

---

### Task 5: Bramka pełnego obrazu

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-faza-2b-czytelnosc.md`

Bramka z Zadania 1 badała sam teren. Ta bada **scenę, którą gracz naprawdę zobaczy**: teren plus siatka plus budynki plus jednostki, w ruchu.

- [ ] **Krok 1: Trzy pytania, każde do osobnego werdyktu człowieka**

1. **Czy terminator nadal jest czytelny** przy pełnej scenie? Regresja wobec Zadania 1 jest tu najgroźniejszym możliwym wynikiem i **musi zostać zapisana, nie obejdzona**.
2. **Czy widać, który budynek jest niezasilony**, bez najeżdżania kursorem?
3. **Czy widać, że jednostka się pali**, zanim zginie?

- [ ] **Krok 2: Zmierz budżet klatki przy pełnej scenie**

2A mierzyła 0,200 ms mediany przy samym terenie, przy budżecie 8 ms. Zmierz przy szczycie z Fazy 1C — **481 jednostek i kilkadziesiąt budynków** — i zapisz maszynę, na której mierzyłeś.

---

## Definicja ukończenia Fazy 2B

- [ ] `pnpm test` zielony, `pnpm typecheck` bez błędów, strażnik zero-zależności `packages/sim` nadal przechodzi
- [ ] **Bramka z Zadania 1 potrafi OBLAĆ** — dowiedzione przejściem prób w trybie kontrolnym
- [ ] `LIGHT_BANDS[0] = 0`, a liczba komórek rozjeżdżających się między renderem a symulacją wynosi **zero**
- [ ] Siatka komórek widoczna, a odległość barw przez terminator **nie spadła**
- [ ] Dziesięć typów budynków na ekranie, stan `powered` i uszkodzenie czytelne bez UI
- [ ] Trzy typy jednostek, płynny ruch, spalanie widoczne
- [ ] Budżet klatki zmierzony przy 481 jednostkach, z zapisaną maszyną
- [ ] Render nadal nie mutuje `SimState` ani `Planet`
- [ ] Brak alokacji w pętli renderu — test na cykle odśmiecania
- [ ] Trzy werdykty człowieka z Zadania 5 zapisane

**Następna faza:** 2C — sterowanie, komendy i pełny run. Dopiero ona dowozi kamień milowy z §9 specu: „grywalny run od startu do ewakuacji".

---

## Czego ta faza świadomie NIE obejmuje

- **Sterowanie, kliknięcie w komórkę, budowanie** — Faza 2C. Tu wyłącznie patrzymy.
- **Skrót „wróć do Core"** — 2C, choć `focusOn` istnieje od 2A.
- **Kierunek artystyczny, VFX, audio** — Faza 4. Tu chodzi o czytelność stanu, nie o urodę. Trzy pasma terenu **nie są decyzją artystyczną**, tylko najtańszą rzeczą spełniającą kryterium; §8.1 specu wymienia alternatywy dla Fazy 4 i wszystkie zachowują nieciągłość na terminatorze.
- **Strojenie balansu** — Faza 3, headlessem. §11.1 specu niesie rekomendacje, ale zmiana liczb teraz unieważniłaby punkt odniesienia.
