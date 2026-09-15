# Faza 2A — Świat na ekranie

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pokazać planetę z Fazy 1 na ekranie tak, żeby gracz **czytał terminator wzrokiem** — bez UI, bez najeżdżania kursorem — i żeby kamera K1 pozwalała wrócić do bazy w czasie zmierzonym w Fazie 0.

**Architecture:** Nowy pakiet `packages/render`, zależny od `@heliopolis/sim` i od Three.js. Symulacja pozostaje bez zależności runtime (D5) — render czyta z niej dane i **nigdy jej nie modyfikuje**. Geometria terenu to jedna scalona `BufferGeometry` z **płaskich wieloboków per komórka**, budowana raz z `Planet.cells[].corners`; kolor komórki idzie atrybutem wierzchołkowym aktualizowanym co klatkę. Cała matematyka — budowa geometrii, mapowanie komórka→wierzchołki, progowanie jasności — jest **czystymi funkcjami testowanymi jednostkowo**; sam obraz podlega kryterium akceptacji z bramki Fazy 0, sprawdzanemu przez człowieka.

**Tech Stack:** TypeScript (strict), Three.js 0.180+, Vite, Vitest, pnpm workspaces, Node ≥ 22.

**Spec:** [`docs/superpowers/specs/2026-09-14-project-heliopolis-design.md`](../specs/2026-09-14-project-heliopolis-design.md) — §4.1, §4.3, §8.1 (pozycje „Render" i „Sterowanie"), §11.1.

**Wyniki bramki Fazy 0:** [`docs/superpowers/specs/2026-09-14-faza-0-wyniki.md`](../specs/2026-09-14-faza-0-wyniki.md) — wiążące, nie doradcze.

**Wymaga ukończonej Fazy 1** (na `main`, 359 testów).

---

## Global Constraints

- **`packages/sim` pozostaje bez zależności runtime.** Strażnik `contract.test.ts` obowiązuje dalej i nie wolno go rozluźniać. Three.js żyje wyłącznie w `packages/render`.
- **Render NIGDY nie mutuje `SimState` ani `Planet`.** Czyta i rysuje. Jedyny kierunek zapisu to komendy przez `Sim.enqueue`, i to dopiero w Fazie 2C.
- **Symulacja liczy światło ciągle, render prezentuje je progowo.** To dwie różne warstwy (§8.1). Zrównanie ich w którąkolwiek stronę zepsuje albo ekonomię, albo czytelność — patrz ostrzeżenie w §8.1 specu.
- **Kamera K1 — swobodna orbita wokół STATYCZNEJ planety.** Planeta się nie obraca; orbituje źródło światła (§4.3). Rozstrzygnięte bramką Fazy 0, mediana powrotu do bazy 2868 ms wobec 4276 i 6256 dla odrzuconych wariantów.
- **Skrót „wróć do Core" jest elementem WYMAGANYM**, nie opcjonalnym (§8.1). Wchodzi w Fazie 2C, ale kamera w 2A musi mieć API, które na to pozwala.
- **Wskaźniki pozaekranowe i minimapa NIE wchodzą do MVP** — zmierzone w Fazie 0 jako niepotrzebne. Nie dodawaj ich „przy okazji".
- **Budżet klatki: 8 ms** na całość renderu przy 1442 komórkach. Zmierzone w spike'u 0,29–0,31 ms, ale wyłącznie na maszynie deweloperskiej — sprzęt minimalny pozostaje nieustalony i jest pozycją oczekującą na właściciela projektu.
- Każda liczba czysto wizualna (kolory, progi pasm, czułość kamery) oznaczona komentarzem `// [WYGLĄD]` — analogicznie do `[STROJENIE]` w symulacji, żeby Faza 4 wiedziała, co wolno jej ruszać.
- Commit po każdym zadaniu.

---

## Struktura plików

| Plik | Odpowiedzialność |
|---|---|
| `packages/render/package.json` | pakiet, zależność od `three` i `@heliopolis/sim` |
| `packages/render/src/geometry.ts` | `buildPlanetGeometry(planet)` → scalona geometria + mapa komórka→wierzchołki. **Czysta funkcja, bez Three.js w sygnaturze** |
| `packages/render/src/shading.ts` | `lightBand(value)` i `cellColors(...)` — progowanie i kolory. **Czyste** |
| `packages/render/src/planetMesh.ts` | spięcie geometrii z `THREE.Mesh`, aktualizacja atrybutu koloru |
| `packages/render/src/camera.ts` | kamera K1: orbita, zoom, `focusOn(cellId)` dla skrótu z 2C |
| `packages/render/src/scene.ts` | scena, światło, pętla renderu, budżet klatki |
| `packages/render/src/index.ts` | publiczne API pakietu |
| `apps/client/` | aplikacja Vite spinająca `sim` + `render` w coś, co się otwiera |

`geometry.ts` i `shading.ts` są celowo wolne od Three.js: to one niosą całą logikę wartą testowania, a ich testy nie potrzebują ani WebGL, ani przeglądarki.

---

## Zadania

### Task 1: Pakiet, aplikacja i pusty ekran, który dowodzi, że rura działa

**Files:**
- Create: `packages/render/package.json`, `packages/render/tsconfig.json`, `packages/render/src/index.ts`
- Create: `apps/client/package.json`, `apps/client/index.html`, `apps/client/vite.config.ts`, `apps/client/src/main.ts`
- Modify: `tsconfig.json` (korzeniowy — **references na oba nowe pakiety**), `pnpm-workspace.yaml`

**Interfaces:**
- Produces: `RENDER_VERSION` (odpowiednik `SIM_VERSION`, do testu dymnego)

> **Ostrzeżenie z Fazy 1, dwukrotnie potwierdzone:** nowy pakiet **musi** zostać wpięty do korzeniowego `tsconfig.json` przez `references`, inaczej `pnpm typecheck` **po cichu go pominie**. Zdarzyło się to w Fazie 1A (brak korzeniowego tsconfiga) i w Fazie 1C (`tools/headless` niewpięty). Krok weryfikacyjny poniżej jest obowiązkowy.

- [ ] **Krok 1: Utwórz pakiety i wpnij je do przestrzeni roboczej**
- [ ] **Krok 2: Dowiedź, że typecheck NAPRAWDĘ sprawdza nowe pakiety**

Wstaw celowy błąd typu w `packages/render/src/index.ts` (np. `const x: number = 'a';`), uruchom `pnpm typecheck`, **potwierdź, że OBLEWA**, usuń błąd, potwierdź, że przechodzi. Zaraportuj obie obserwacje. Bez tego kroku zadanie jest nieukończone.

- [ ] **Krok 3: Test dymny i `pnpm dev` otwierający pusty kanwas**
- [ ] **Krok 4: Commit**

---

### Task 2: Geometria planety z płaskich wieloboków

**Files:**
- Create: `packages/render/src/geometry.ts`, `packages/render/test/geometry.test.ts`

**Interfaces:**
- Consumes: `Planet`, `Cell` z `@heliopolis/sim`
- Produces:
  - `interface PlanetGeometry { positions: Float32Array; normals: Float32Array; indices: Uint32Array; cellVertexStart: Uint32Array; cellVertexCount: Uint32Array }`
  - `function buildPlanetGeometry(planet: Planet): PlanetGeometry`

Każda komórka to **osobny wachlarz trójkątów wokół własnego środka**, z **własnymi wierzchołkami** — wierzchołki NIE są współdzielone między komórkami. To jest sedno całego zadania: współdzielenie wierzchołków wymusiłoby interpolację koloru po krawędzi, czyli dokładnie ten gładki gradient, który bramka Fazy 0 zmierzyła jako **nieczytelny**. Osobne wierzchołki dają płaskie, jednolite wieloboki i granicę biegnącą po krawędziach heksów.

`cellVertexStart[i]` i `cellVertexCount[i]` mówią, który zakres tablicy kolorów należy do komórki `i` — to jest jedyny most między symulacją a obrazem i musi być dokładny.

- [ ] **Krok 1: Napisz testy (mają nie przejść)**

Testy do napisania, każdy z wartością wziętą z rzeczywistej planety, nie z założenia:
1. suma `cellVertexCount` równa się długości `positions` podzielonej przez 3
2. zakresy komórek **nie zachodzą na siebie i nie zostawiają dziur** — posortowane `start` z `count` pokrywają dokładnie całą tablicę
3. pentagon ma 5 rogów, heks 6 — liczba trójkątów zgadza się z liczbą rogów
4. każdy wierzchołek leży na sferze o promieniu planety (z tolerancją zmiennoprzecinkową)
5. normalna każdej komórki wskazuje **na zewnątrz** — `dot(normal, center) > 0`
6. kolejność wierzchołków daje trójkąty **zwrócone na zewnątrz** (winding), sprawdzone iloczynem wektorowym wobec normalnej komórki
7. determinizm: dwa wywołania na tym samym seedzie dają identyczne tablice co do bitu

- [ ] **Krok 2: Uruchom testy i potwierdź porażkę**
- [ ] **Krok 3: Zaimplementuj**
- [ ] **Krok 4: Testy zielone**
- [ ] **Krok 5: Zmierz i zapisz w komentarzu** liczbę wierzchołków i trójkątów dla `frequency 12` — Faza 4 będzie się o to pytać przy optymalizacji
- [ ] **Krok 6: Commit**

---

### Task 3: Progowanie światła — terminator jako granica

**Files:**
- Create: `packages/render/src/shading.ts`, `packages/render/test/shading.test.ts`

**Interfaces:**
- Consumes: `Float32Array` z `lightField`, `PlanetGeometry`
- Produces:
  - `const LIGHT_BANDS: readonly number[]` — `[WYGLĄD]`
  - `function lightBand(light: number): number`
  - `function writeCellColors(geo: PlanetGeometry, light: Float32Array, out: Float32Array, palette: Palette): void`

To jest zadanie, w którym rozstrzyga się filar D1. Bramka Fazy 0 zmierzyła, że przy gładkim `saturate(dot)` **terminatora nie widać wcale**, a przy progowanym jest ostry i natychmiast czytelny.

> **Nie „napraw" tego później na gładkie.** §5.1 specu każe produkcji paneli być funkcją ciągłą i tak jest w `power.ts` — to inna warstwa. Symulacja liczy ciągle, render progowo.

- [ ] **Krok 1: Napisz testy (mają nie przejść)**

1. `lightBand` jest **monotoniczna** i **schodkowa**: istnieją dwie wartości różniące się o mniej niż 0,01, które dają różne pasma (to jest dowód nieciągłości — czyli tego, po co ta funkcja istnieje)
2. dokładne zero daje pasmo najciemniejsze, dokładna jedynka najjaśniejsze
3. **liczba różnych wartości wyjściowych na 10 000 próbek równa się liczbie pasm** — asercja, że progowanie naprawdę progowuje, a nie przepuszcza ciągłości
4. `writeCellColors` zapisuje **jednolity kolor w całym zakresie komórki** — wszystkie wierzchołki komórki mają identyczny kolor co do bitu
5. sąsiadujące komórki po dwóch stronach terminatora dostają **różne pasma** przy rzeczywistym `lightField` — wzięte z prawdziwej planety i prawdziwego `sunDirection`, nie z liczb wpisanych ręcznie
6. `out` o złej długości → `RangeError` nazywający obie długości (wzorzec z `updatePower`)

- [ ] **Krok 2: Uruchom testy i potwierdź porażkę**
- [ ] **Krok 3: Zaimplementuj**
- [ ] **Krok 4: Testy zielone**
- [ ] **Krok 5: Zmierz** ile komórek wypada w każdym paśmie przy `sunDirection(0, 180)` i zapisz w komentarzu. Jeśli jedno pasmo obejmuje ponad połowę komórek, progi są źle dobrane — zgłoś to zamiast zostawiać
- [ ] **Krok 6: Commit**

---

### Task 4: Kamera K1 i scena

**Files:**
- Create: `packages/render/src/camera.ts`, `packages/render/src/planetMesh.ts`, `packages/render/src/scene.ts`
- Create: `packages/render/test/camera.test.ts`

**Interfaces:**
- Produces:
  - `function createCamera(canvas, radius): OrbitCamera`
  - `interface OrbitCamera { object; update(); focusOn(target: Vec3, immediate?: boolean): void; dispose(): void }`
  - `function createScene(planet: Planet, canvas: HTMLCanvasElement): PlanetScene`
  - `interface PlanetScene { render(light: Float32Array, sunDir: Vec3): void; camera: OrbitCamera; dispose(): void }`

`focusOn` istnieje już teraz, mimo że skrót „wróć do Core" wchodzi dopiero w 2C — bo to on jest elementem **wymaganym** przez bramkę i kamera musi go umożliwiać od początku, a nie po dorobieniu.

Testowalna jest **matematyka kamery**, nie obraz. Wydziel ją do czystych funkcji i testuj je; sam `OrbitControls` traktuj jako bibliotekę.

- [ ] **Krok 1: Napisz testy matematyki kamery (mają nie przejść)**

1. `focusOn(cellCenter)` ustawia kamerę tak, że **kierunek patrzenia pokrywa się z normalną komórki** — `dot(normalize(camera.position), normalize(target)) > 0,999`
2. `focusOn` zachowuje **odległość** od środka planety (zoom nie skacze przy powrocie do bazy)
3. zoom jest ograniczony z obu stron: nie da się wejść pod powierzchnię ani odlecieć poza zadany limit
4. determinizm: `focusOn` na tę samą komórkę z dwóch różnych pozycji daje **tę samą** pozycję końcową

- [ ] **Krok 2–4: porażka → implementacja → zielone**
- [ ] **Krok 5: Spięcie sceny** — `planetMesh.ts` tworzy `THREE.Mesh` z geometrii Taska 2, materiał `MeshBasicMaterial` z `vertexColors: true` (**nie** `MeshStandardMaterial` — oświetlenie liczy symulacja, nie silnik renderu), pętla renderu wywołuje `writeCellColors` i podnosi `needsUpdate`
- [ ] **Krok 6: Commit**

---

### Task 5: Budżet klatki i bramka czytelności

**Files:**
- Create: `packages/render/test/budget.test.ts`
- Modify: `apps/client/src/main.ts` (licznik klatek na ekranie)
- Create: `docs/superpowers/specs/2026-09-15-faza-2a-czytelnosc.md` (protokół i wynik)

To zadanie nie dowozi kodu rozgrywki — dowozi **odpowiedź**, tak samo jak Faza 0. Jego produktem jest zmierzona liczba i werdykt człowieka.

- [ ] **Krok 1: Test budżetu części czystych**

`writeCellColors` na 1442 komórkach, 1000 wywołań, mediana poniżej **1 ms**. To jedyna część, którą da się zmierzyć bez GPU; zmierz ją i przypnij, bo to ona rośnie liniowo z liczbą komórek.

- [ ] **Krok 2: Licznik klatek w aplikacji** — mediana i p95 czasu klatki, widoczne na ekranie, plus wypisanie do konsoli po 1000 klatkach
- [ ] **Krok 3: Zmierz na maszynie deweloperskiej** i zapisz obie liczby
- [ ] **Krok 4: BRAMKA CZYTELNOŚCI — do wykonania przez człowieka**

Kryterium akceptacji jest dosłownie to z §8.1, przeniesione z bramki Fazy 0:

> Gracz wskazuje komórkę przy granicy i mówi „ta świeci, ta nie" — **bez UI, bez najeżdżania kursorem, bez nakładki prawdy**.

Protokół: pięć losowych par sąsiadujących komórek po dwóch stronach terminatora, przy trzech różnych fazach słońca. Dla każdej pary człowiek orzeka „widzę granicę" albo „nie widzę". **PASS wymaga kompletu piętnastu.** Wynik zapisz do dokumentu wyników — także jeśli jest negatywny, razem z tym, co wtedy trzeba zmienić.

- [ ] **Krok 5: Commit**

---

## Definicja ukończenia Fazy 2A

- [ ] `pnpm test` zielony, `pnpm typecheck` bez błędów, strażnik zero-zależności `packages/sim` nadal przechodzi
- [ ] **Dowiedzione, że typecheck obejmuje nowe pakiety** (celowy błąd oblewa)
- [ ] Planeta renderuje się z płaskich wieloboków per komórka, wierzchołki niewspółdzielone
- [ ] **Bramka czytelności zaliczona przez człowieka**, wynik zapisany
- [ ] Mediana czasu klatki zmierzona i zapisana, wraz z maszyną, na której mierzono
- [ ] Kamera K1 z `focusOn`, zoom ograniczony obustronnie
- [ ] Render nie mutuje `SimState` ani `Planet` — sprawdzone testem porównującym `stateHash` przed i po klatce
- [ ] Wszystkie liczby wizualne oznaczone `// [WYGLĄD]`

**Następna faza:** 2B — jednostki i budynki na ekranie (instancing, stany zasilania, obrażenia). Plan powstaje **po** bramce czytelności, bo jej wynik może zmienić sposób renderowania wszystkiego, co stoi na terenie.

---

## Czego ta faza świadomie NIE obejmuje

- **Jednostki i budynki** — Faza 2B. Tu rysujemy wyłącznie teren i światło, bo to na nich stoi filar D1 i to je bramka Fazy 0 badała.
- **Sterowanie i komendy** — Faza 2C. Kamera owszem, ale kliknięcie w komórkę i postawienie budynku to osobna warstwa.
- **Skrót „wróć do Core"** — Faza 2C, choć `focusOn` powstaje już tu.
- **Wskaźniki pozaekranowe i minimapa** — **wycięte z MVP na podstawie pomiaru** w Fazie 0. Nie wracaj do nich bez nowych danych.
- **Kierunek artystyczny, VFX, audio** — Faza 4. Tu chodzi o czytelność, nie o urodę.

---

## Zarys reszty Fazy 2 — konteksty dla 2A, nie plany do wykonania

Faza 2 to trzy podfazy, tak jak Faza 1 była 1A/1B/1C. Poniższe zarysy istnieją po to,
żeby wykonawca 2A wiedział, co przyjdzie po nim i czego **nie** ma robić z wyprzedzeniem.
Pełne plany powstaną po bramkach poprzedniczek, bo każda z nich może zmienić następną.

### 2B — Jednostki i budynki na ekranie

Instancing dla jednostek (setki naraz, trzy typy, `THREE.InstancedMesh`), budynki jako
instancje per typ, oraz **stany widoczne bez UI**: zasilony wobec niezasilonego, budynek
uszkodzony, jednostka płonąca w świetle. Ostatnie jest istotne — bramka Fazy 0 badała
czytelność terenu, ale to, że jednostka się pali, jest sprzężeniem zwrotnym dla filaru N3
i gracz musi je widzieć.

Otwarte pytanie do rozstrzygnięcia pomiarem, nie założeniem: **czy jednostki mają być
cieniowane progowo tak jak teren.** Argument za spójnością mówi „tak"; argument za tym,
że jednostka jest mała i pasma na niej będą migotać, mówi „nie".

### 2C — Sterowanie, komendy i pełny run

Kliknięcie w komórkę (raycaster wobec geometrii z 2A, z użyciem `cellVertexStart`),
UI zasobów i budowy, wejście zamieniane na `Command` i wysyłane przez `Sim.enqueue`,
**skrót „wróć do Core" jako element wymagany**, oraz ekrany końca runu.

Kamień milowy całej Fazy 2 z §9 specu brzmi „grywalny run od startu do ewakuacji" i to
2C go dowozi. Warto wtedy dopiąć jedną rzecz otwartą od Fazy 0: **pomiar P2 bez skrótu**,
który jest jedynym powodem, dla którego werdykt tamtej bramki brzmi WARUNKOWY zamiast PASS.
Mając grywalny run, ten pomiar staje się tani.

### Czego Faza 2 NIE tknie

Pętli roguelite (Faza 3), kierunku artystycznego i audio (Faza 4), sieci (Faza 5).
A także **strojenia balansu** — §11.1 specu niesie rekomendację obcięcia nagród do ~0,25×
i podniesienia rudy startowej, ale to jest praca Fazy 3 na headlessie. Faza 2 renderuje
grę taką, jaka jest; kuszenie się o „poprawienie przy okazji" zepsułoby punkt odniesienia
dla pomiarów, które Faza 3 dopiero wykona.
