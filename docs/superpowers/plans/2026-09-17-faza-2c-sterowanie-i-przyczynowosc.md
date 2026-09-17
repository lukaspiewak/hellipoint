# Faza 2C — sterowanie, komendy i czytelność przyczynowa

> **Dla wykonawców agentowych:** WYMAGANY SUB-SKILL: użyj superpowers:subagent-driven-development (zalecane) albo superpowers:executing-plans, żeby wykonać ten plan zadanie po zadaniu. Kroki mają składnię checkboxów (`- [ ]`).

**Cel:** Gracz przechodzi pełny run od startu do ewakuacji, budując myszą — i **rozumie, dlaczego przegrał**.

**Architektura:** Wejście zamienia się w `Command` i idzie do kolejki `Sim`, nigdy w bezpośrednią mutację stanu. HUD niesie wyłącznie wielkości, których świat unieść nie może (liczby i menu); wszystko o stanie konkretnego budynku zostaje w świecie, gdzie Faza 2B już to umieściła. Nowa jakość tej fazy to **czytelność konsekwencji**: gra ma pokazywać nie tylko, że coś się stało, ale dlaczego.

**Stos:** TypeScript 7.0.2 (`tsc -b`), Vitest 5.0.0, pnpm 11.17.0, Node ≥ 22, Three.js 0.186.0, Vite 7.3.6.

**Spec:** `docs/superpowers/specs/2026-09-14-project-heliopolis-design.md` — Faza 2 z §9 („render + sterowanie: instancing, kamera z Fazy 0, UI zasobów i budowy, wejście jako komendy", kamień milowy: **grywalny run od startu do ewakuacji**). Warunki zakończenia: §5.6. Energia i brownout: §5.1.

**Skąd wzięło się wymaganie czytelności przyczynowej:** `docs/pomysly/inspiracje.md`, pozycje 001.2 i 001.3.

## Global Constraints

Wszystkie ograniczenia Faz 2A i 2B obowiązują dalej. Powtarzam te, które ta faza może złamać:

- **`packages/sim` bez zależności runtime.** Strażnik `contract.test.ts` — nie rozluźniaj go.
- **Render NIGDY nie mutuje `SimState` ani `Planet`.** Wejście gracza idzie **wyłącznie** przez kolejkę komend (`Sim.enqueue`), nigdy przez zapis do stanu. To jest warunek Fazy 5 (autorytatywny serwer), nie wygoda.
- **Czytelność terminatora jest nadrzędna.** Każdy nowy element na ekranie musi przejść bramkę z Fazy 2B (`apps/client/scene-gate.html`). Regresja jest najgroźniejszym możliwym wynikiem i **musi zostać zapisana, nie obejdzona**.
- **Brak alokacji w pętli renderu.** Przyrząd: `packages/render/test/support/gcWindows.ts` — **użyj go, nie pisz własnego**. Próg stoi na oknie bezczynnym plus jeden cykl, nie na zerze i nie na kontroli pozytywnej.
- **Każdy próg czytelności wiąże MINIMUM PO POPULACJI, w pikselach**, przy domyślnej odległości kamery. Skala: `packages/render/test/support/pixelScale.ts` (**3,41 px/jednostkę**, wyprowadzane ze stałych `camera.ts` — nie przepisuj liczby). Próg widoczności **1,00 px** wiąże ROZMIARY; **ruch jest wykrywalny poniżej** (puls pierścienia alarmu widziany przy 0,44 px).
- **Stałe koloru w `shading.ts` są LINIOWE, nie sRGB.** Kontrast WCAG liczy się z nich wprost; „jak bardzo to widać" — po zakodowaniu do sRGB. Kontrasty palety terenu: noc↔zmierzch **5,38**, zmierzch↔dzień **1,79**, noc↔dzień **9,62**.
- **Żaden pojedynczy ton nie osiąga 3:1 wobec wszystkich trzech pasm terenu** (najlepszy 2,3202 przy luminancji 0,18388). Każdy nowy obiekt na planecie musi nieść **dwa tony**.
- **Kolor planety mieszka w DWÓCH buforach** (wypełnienia i krata). Nie sięgaj po atrybut `color` siatki terenu wprost — idź przez `PlanetMesh`.
- Każda liczba czysto wizualna oznaczona `// [WYGLĄD]`. Każda liczba balansowa — `// [STROJENIE]`.
- Commit po każdym zadaniu.

### Dług odziedziczony — nie naprawiaj przy okazji, ale wiedz, że jest

- `UnitLayer.update` **alokuje w pętli renderu**: 0,0015 cyklu odśmiecania na klatkę, skalujące się liniowo z liczbą jednostek. 50× poniżej progu wykrywalności własnej kontroli testu. Której linii dotyczy — nieustalone, wymaga profilu sterty.
- `apps/client` **nie ma ani jednego testu**. W Fazie 2B wada układu panelu przy oknie 480 px unieważniła cztery z pięciu pomiarów bramki. **Zadanie 2 to zmienia** — zakłada pakiet testowy dla tego workspace'u. Uwaga o granicy: jsdom **nie liczy układu**, więc tamta konkretna wada (kontrolki pod krawędzią przewijania) nadal nie będzie strzeżona testem; strażnik na nią wymagałby prawdziwej przeglądarki w pakiecie i to zostaje odłożone. Testowalna jest **logika** wejścia i menu — i dlatego Zadanie 2 wymaga trzymania jej poza modułami dotykającymi DOM.

---

## Stan wyjściowy — co JUŻ istnieje i czego nie wolno budować od nowa

Zweryfikowane w kodzie 2026-09-17. Budowanie tego jeszcze raz byłoby czystą stratą.

| Co | Gdzie | Uwaga |
|---|---|---|
| `Command = {kind:'BUILD', cellId, type} \| {kind:'DEMOLISH', cellId}` | `packages/sim/src/sim/commands.ts:4` | kolejka już jest, `Sim` drenuje ją w `step()` |
| `canBuild(s, cellId, type) → {ok:true} \| {ok:false, reason}` | `commands.ts:24` | **siedem powodów**: `NO_SUCH_CELL`, `CELL_OCCUPIED`, `NOT_PLAYER_BUILDABLE`, `NO_SUCH_BUILDING_TYPE`, `WRONG_CELL_TYPE`, `INSUFFICIENT_ORE`, `EVAC_LOCKED` |
| `focusPosition(currentPosition, target, radius) → Vec3` | `packages/render/src/camera.ts:116` | gotowa matematyka dla skrótu „wróć do Core"; zachowuje odległość, przycina do zakresu zoomu |
| `PowerReport {supply, demand, shedTypes}` | `packages/sim/src/sim/power.ts:5` | **`demand` jest PO kaskadzie gaszenia** — doc-comment wprost mówi, że UI chce wartości SPRZED; patrz Zadanie 4 |
| `BROWNOUT_ORDER = ['EXTRACTOR','KINETIC_TURRET','LASER_TURRET']` | `defs.ts:116` | kolejność gaszenia; wyjaśnia Q3 |
| Warstwy renderu: teren, krata, budynki, jednostki | `packages/render/src/{planetMesh,buildingMesh,unitMesh}.ts` | `powered` i uszkodzenie **są już czytelne bez UI** — nie duplikuj ich w HUD |
| Bramka czytelności optycznej | `apps/client/scene-gate.html` | pięć pytań, przeszła 2026-09-16 |

**Czego NIE ma i trzeba zbudować:** wskazania komórki (`grep -rn "Raycaster"` → zero trafień), jakiegokolwiek HUD, wysyłania komend z klienta, widocznego bilansu energii.

**Kluczowy fakt geometryczny dla Zadania 1:** wielościan Goldberga jest **diagramem Voronoi swoich środków** — komórka to dokładnie zbiór punktów sfery bliższych jej środkowi niż każdemu innemu. Wskazanie komórki nie wymaga więc raycastu po trójkątach: wystarczy przeciąć promień ze sferą i wziąć **najbliższy środek**. Wynik jest dokładny, a nie przybliżony.

---

## Pomocnicy testowi — wspólne miejsce, pisane przy pierwszym użyciu

Testy w kilku zadaniach wołają te same funkcje pomocnicze. Nie są częścią kodu produkcyjnego.
Napisz każdą **w zadaniu, które jej potrzebuje jako pierwsze** (`mulberry32` — Zadanie 1,
`freeHexagonNear` — Zadanie 2, `fourFreeHexagonsNear` — Zadanie 4,
`defeatedStateWithLastDamager` — Zadanie 5), ale **od razu we wspólnym miejscu**:
`packages/sim/test/support/fixtures.ts` (albo `apps/client/test/support/`, gdy dotyczą
klienta). Nie powielaj ich w plikach testowych — kopia w drugim pliku to następna
liczba, która przeżyje swoje wejście.

| Pomocnik | Kontrakt |
|---|---|
| `freeHexagonNear(s: SimState): number` | indeks **pustego heksagonu** w zasięgu sieci od `startCell` — czyli takiego, na którym `canBuild(s, id, 'BARRICADE').ok === true` |
| `fourFreeHexagonsNear(s: SimState): number[]` | cztery różne takie indeksy; rzuca, jeśli nie ma czterech |
| `mulberry32(seed: number): () => number` | prosty PRNG **wyłącznie do testów**, żeby losowe promienie w Zadaniu 1 były powtarzalne. **Nie używaj `Rng` z `packages/sim`** — tamten jest częścią kontraktu determinizmu i wiązanie testu renderu z jego strumieniem byłoby kotwicą na cudzy moduł (ta wada wystąpiła w Fazie 2B trzy razy) |
| `defeatedStateWithDamager(type: EnemyType): { state: SimState; lastCoreDamager: EnemyType }` | stan z `phase === 'DEFEAT'` plus typ, który zadał ostatnie obrażenia Core. **Sprawdzone w przeglądzie wstępnym: `SimState` tego NIE zapamiętuje.** Rozstrzygnięcie niżej |

---

## Zadania

### Task 1: Wskazanie komórki

**Pliki:**
- Utwórz: `packages/render/src/picking.ts`
- Test: `packages/render/test/picking.test.ts`

**Interfejsy:**
- Konsumuje: `Planet` z `@heliopolis/sim` (`planet.cells[i].normal`, `planet.radius`).
- Produkuje: `pickCell(planet: Planet, origin: Vec3, direction: Vec3): number | null` — indeks komórki albo `null`, gdy promień mija planetę.

- [ ] **Krok 1: Test przecięcia promienia ze sferą**

```ts
it('1. promień w środek planety trafia w komórkę zwróconą do źródła promienia', () => {
  const planet = createPlanet({ seed: 1 });
  const target = planet.cells[500];
  const n = target.normal;
  const origin = { x: n.x * planet.radius * 3, y: n.y * planet.radius * 3, z: n.z * planet.radius * 3 };
  const direction = { x: -n.x, y: -n.y, z: -n.z };
  expect(pickCell(planet, origin, direction)).toBe(500);
});

it('2. promień mijający planetę daje null', () => {
  const planet = createPlanet({ seed: 1 });
  const origin = { x: 0, y: 0, z: planet.radius * 3 };
  const direction = { x: 1, y: 0, z: 0 };
  expect(pickCell(planet, origin, direction)).toBeNull();
});
```

- [ ] **Krok 2: Uruchom — ma oblać**

Run: `npx vitest run packages/render/test/picking.test.ts`
Oczekiwane: FAIL, `pickCell is not a function`.

- [ ] **Krok 3: Implementacja**

```ts
export function pickCell(planet: Planet, origin: Vec3, direction: Vec3): number | null {
  const dLen = Math.hypot(direction.x, direction.y, direction.z);
  if (!(dLen > 0)) throw new RangeError(`pickCell: direction must be non-zero, got length ${dLen}`);
  const dx = direction.x / dLen, dy = direction.y / dLen, dz = direction.z / dLen;

  // Planeta stoi w (0,0,0) — tak konstruuje ją `createPlanet`, i na tym stoi `camera.ts`.
  const b = origin.x * dx + origin.y * dy + origin.z * dz;
  const c = origin.x * origin.x + origin.y * origin.y + origin.z * origin.z - planet.radius * planet.radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);          // BLIŻSZE przecięcie: gracz wskazuje przednią półkulę
  if (t < 0) return null;

  const hx = origin.x + dx * t, hy = origin.y + dy * t, hz = origin.z + dz * t;

  // Goldberg JEST diagramem Voronoi swoich środków, więc najbliższy środek to DOKŁADNIE
  // komórka pod kursorem — nie przybliżenie. Iloczyn skalarny wystarcza zamiast odległości,
  // bo wszystkie środki leżą na tej samej sferze: większy iloczyn = mniejszy kąt = bliżej.
  let best = -1, bestDot = -Infinity;
  for (let i = 0; i < planet.cells.length; i++) {
    const n = planet.cells[i].normal;
    const dot = n.x * hx + n.y * hy + n.z * hz;
    if (dot > bestDot) { bestDot = dot; best = i; }
  }
  return best;
}
```

- [ ] **Krok 4: Uruchom — ma przejść**

Run: `npx vitest run packages/render/test/picking.test.ts` → PASS.

- [ ] **Krok 5: Test własności Voronoi — to jest właściwy strażnik**

Poprzednie dwa testy sprawdzają dwa punkty. Ten sprawdza **własność**, i oblewa, gdy ktoś zamieni „najbliższy środek" na cokolwiek innego:

```ts
it('3. [WŁASNOŚĆ] dla 2000 losowych promieni trafiona komórka jest tą o najbliższym środku', () => {
  const planet = createPlanet({ seed: 1 });
  const rng = mulberry32(12345);
  let checked = 0;
  for (let k = 0; k < 2000; k++) {
    // losowy kierunek na sferze, promień z zewnątrz do środka
    const u = rng() * 2 - 1, phi = rng() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    const n = { x: r * Math.cos(phi), y: u, z: r * Math.sin(phi) };
    const origin = { x: n.x * planet.radius * 4, y: n.y * planet.radius * 4, z: n.z * planet.radius * 4 };
    const hit = pickCell(planet, origin, { x: -n.x, y: -n.y, z: -n.z });
    expect(hit).not.toBeNull();
    // niezależne sprawdzenie: żaden inny środek nie jest bliżej punktu trafienia
    let bestDot = -Infinity, bestId = -1;
    for (let i = 0; i < planet.cells.length; i++) {
      const c = planet.cells[i].normal;
      const dot = c.x * n.x + c.y * n.y + c.z * n.z;
      if (dot > bestDot) { bestDot = dot; bestId = i; }
    }
    expect(hit).toBe(bestId);
    checked++;
  }
  expect(checked).toBe(2000);
});
```

- [ ] **Krok 6: Mutacja obowiązkowa — para**

| mutacja | oczekiwanie |
|---|---|
| `t = -b + Math.sqrt(disc)` (dalsze przecięcie zamiast bliższego) | **ma oblać** test 1 — trafia w antypodę |
| `if (dot > bestDot)` → `if (dot >= bestDot)` | **ma przejść** — remis rozstrzyga się inaczej, ale wynik jest tą samą komórką dla każdego punktu poza miarą zero |

Podaj odczyty obu.

- [ ] **Krok 7: Commit**

```bash
git add packages/render/src/picking.ts packages/render/test/picking.test.ts
git commit -m "Faza 2C/1: wskazanie komorki przez wlasnosc Voronoi, nie raycast po siatce"
```

---

### Task 2: Wejście jako komendy + skrót „wróć do Core"

**Pliki:**
- Utwórz: `apps/client/src/input.ts`
- Modyfikuj: `apps/client/src/main.ts`
- Test: `apps/client/test/input.test.ts` (**pierwszy test w `apps/client`** — patrz niżej)

**Interfejsy:**
- Konsumuje: `pickCell` (Zadanie 1), `canBuild`/`Command` z `@heliopolis/sim`, `focusPosition` z `@heliopolis/render`.
- Produkuje: `screenToRay(camera, canvas, clientX, clientY): {origin, direction}` oraz `intentFromPointer(...)` zwracające `{ kind:'BUILD'|'DEMOLISH', cellId, type? } | null`.
- Produkuje też **stan wyboru**: `selectedCell: number | null` i `selectedType: BuildingType`, trzymane w kliencie i aktualizowane ruchem kursora oraz wyborem z menu. **Rozstrzygnięcie przeglądu wstępnego:** wybór należy do wejścia, nie do HUD — Zadanie 3 dostaje `cellId` jako argument `buildMenuRows(s, cellId)` i samo niczego nie pamięta. Gdyby wybór mieszkał w HUD, ten sam stan miałby dwóch właścicieli.

**To zadanie zakłada pakiet testowy w `apps/client`.** Dziś go nie ma; dodaj minimalną konfigurację Vitest dla tego workspace'u i **trzymaj logikę wejścia POZA modułami dotykającymi DOM**, żeby dała się testować bez przeglądarki. To jest bezpośrednia reakcja na defekt Fazy 2B, w którym wada zamknięta w kliencie unieważniła cztery z pięciu pomiarów bramki.

- [ ] **Krok 1: Test zamiany współrzędnych ekranu na promień**

```ts
it('1. kliknięcie w środek kadru daje promień wzdłuż osi patrzenia kamery', () => {
  const canvas = { clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const camera = new PerspectiveCamera(50, 800 / 600, 1, 1000);
  camera.position.set(0, 0, 300);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const ray = screenToRay(camera, canvas as HTMLCanvasElement, 400, 300);
  expect(ray.direction.z).toBeLessThan(-0.999);   // patrzy w -Z, czyli w planetę
  expect(Math.abs(ray.direction.x)).toBeLessThan(1e-6);
  expect(Math.abs(ray.direction.y)).toBeLessThan(1e-6);
});
```

- [ ] **Krok 2: Uruchom — ma oblać.** `npx vitest run apps/client` → FAIL.

- [ ] **Krok 3: Implementacja `screenToRay` i `intentFromPointer`**

`screenToRay` liczy NDC z `getBoundingClientRect` (nie z `clientWidth` samego, bo płótno bywa skalowane CSS-em) i rzutuje przez `camera.unproject`. `intentFromPointer` woła `pickCell` i zwraca zamiar; **nie woła `Sim` i nie dotyka stanu** — to jest funkcja czysta, i dlatego da się ją testować.

- [ ] **Krok 4: Uruchom — ma przejść.**

- [ ] **Krok 5: Podłączenie do `main.ts` — komenda idzie do KOLEJKI**

Lewy przycisk buduje wybrany typ, prawy rozbiera. **Jedyna dozwolona droga to `sim.enqueue(cmd)`** — żadnego zapisu do `sim.state`. Ograniczenie z Global Constraints, nie styl.

- [ ] **Krok 6: Skrót „wróć do Core"**

Klawisz `Space`. Woła `focusPosition(camera.object.position, planet.cells[planet.startCell].center, planet.radius)` i ustawia pozycję kamery. Wymaganie pochodzi z bramki Fazy 0 (`docs/superpowers/specs/2026-09-14-faza-0-wyniki.md`) — kamera K1 wygrała mimo ryzyka gubienia bazy, **pod warunkiem** istnienia tego skrótu.

- [ ] **Krok 7: Test, że klient nie mutuje stanu**

```ts
it('2. [NIEZMIENNIK] obsługa wejścia nie zmienia SimState — zmienia go dopiero step()', () => {
  const sim = new Sim({ ...DEFAULT_RUN, seed: 1 });
  const before = stateHash(sim.state);
  sim.enqueue({ kind: 'BUILD', cellId: freeHexagonNear(sim.state), type: 'BARRICADE' });
  expect(stateHash(sim.state)).toBe(before);   // kolejka NIE jest stanem
  sim.step();
  expect(stateHash(sim.state)).not.toBe(before);
});
```

- [ ] **Krok 8: Commit**

```bash
git add apps/client packages/render
git commit -m "Faza 2C/2: wejscie jako komendy, skrot powrotu do Core, pierwszy test w apps/client"
```

---

### Task 3: HUD zasobów i budowy, z powodem odmowy

**Pliki:**
- Utwórz: `apps/client/src/hud.ts`
- Modyfikuj: `apps/client/src/main.ts`
- Test: `apps/client/test/hud.test.ts`

**Interfejsy:**
- Konsumuje: `SimState` (`ore`, `storedEnergy`, `phase`), `BUILDINGS`, `canBuild`.
- Produkuje: `buildMenuRows(s: SimState, cellId: number | null): MenuRow[]`, gdzie `MenuRow = { type: BuildingType; costOre: number; affordable: boolean; check: BuildCheck }`. **Funkcja czysta** — HUD rysuje z jej wyniku.

**Granica zakresu, obowiązująca:** HUD niesie **wyłącznie wielkości, których świat unieść nie może** — liczby i menu. **Nie duplikuje** stanu `powered` ani uszkodzenia; Faza 2B kosztowała trzy rundy naprawcze, żeby te kanały działały w świecie (pierścień alarmu, pole rdzenia, obwódka o stałej szerokości). Pasek u góry powtarzający to samo unieważniłby tamtą pracę.

- [ ] **Krok 1: Test — menu podaje powód odmowy, nie tylko fakt odmowy**

```ts
it('1. pozycja menu niosąca odmowę niesie też JEJ POWÓD', () => {
  const sim = new Sim({ ...DEFAULT_RUN, seed: 1 });
  const s = sim.state;
  s.ore = 0;                                        // [STROJENIE] w teście: wymuszony brak rudy
  const rows = buildMenuRows(s, freeHexagonNear(s));
  const laser = rows.find((r) => r.type === 'LASER_TURRET')!;
  expect(laser.affordable).toBe(false);
  expect(laser.check).toEqual({ ok: false, reason: 'INSUFFICIENT_ORE' });
});

it('2. GEOTHERMAL_CAP na heksagonie odmawia z powodem WRONG_CELL_TYPE', () => {
  const sim = new Sim({ ...DEFAULT_RUN, seed: 1 });
  const s = sim.state;
  s.ore = 1000;
  const rows = buildMenuRows(s, freeHexagonNear(s));
  expect(rows.find((r) => r.type === 'GEOTHERMAL_CAP')!.check)
    .toEqual({ ok: false, reason: 'WRONG_CELL_TYPE' });
});
```

- [ ] **Krok 2: Uruchom — ma oblać.**

- [ ] **Krok 3: Implementacja.** `buildMenuRows` iteruje `BUILDINGS`, pomija `playerBuildable === false` (czyli `CORE`), i dla każdego typu woła `canBuild`. Koszty **czytane z `BUILDINGS`, nie przepisywane**: BARRICADE 8, PYLON 15, SOLAR_PANEL 25, EXTRACTOR 30, BATTERY 40, KINETIC_TURRET 50, GEOTHERMAL_CAP 75, LASER_TURRET 100, EVACUATION_MODULE 300.

- [ ] **Krok 4: Uruchom — ma przejść.**

- [ ] **Krok 5: Siedem powodów ma siedem komunikatów**

Test wiążący, że **każdy** powód z `canBuild` ma tekst dla człowieka — nie surowy identyfikator:

```ts
const ALL_REASONS = ['NO_SUCH_CELL','CELL_OCCUPIED','NOT_PLAYER_BUILDABLE',
  'NO_SUCH_BUILDING_TYPE','WRONG_CELL_TYPE','INSUFFICIENT_ORE','EVAC_LOCKED'] as const;

it('3. każdy powód odmowy ma komunikat po polsku, różny od identyfikatora', () => {
  for (const r of ALL_REASONS) {
    const msg = refusalMessage(r);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toBe(r);
  }
});
```

- [ ] **Krok 6: Mutacja — para.** Usuń jeden wpis ze słownika komunikatów → **ma oblać** test 3. Dodaj wpis dla nieistniejącego powodu → **ma przejść** (słownik może być nadmiarowy, brakujący nie).

- [ ] **Krok 7: Commit**

```bash
git add apps/client
git commit -m "Faza 2C/3: HUD zasobow i budowy, siedem powodow odmowy z komunikatem"
```

---

### Task 4: Bilans energii i brownout widoczny — SERCE TEJ FAZY

**Pliki:**
- Modyfikuj: `packages/sim/src/sim/power.ts` (dołożenie `rawDemand` do `PowerReport`)
- Modyfikuj: `packages/sim/src/sim/loop.ts:407` (dziś wynik `updatePower` jest **odrzucany**)
- Modyfikuj: `apps/client/src/hud.ts`, `packages/render/src/buildingMesh.ts`
- Test: `packages/sim/test/power.test.ts`, `packages/render/test/buildingMesh.test.ts`

**Interfejsy:**
- Produkuje: `PowerReport { supply, demand, rawDemand, shedTypes }` oraz `Sim.lastPower: Readonly<PowerReport>`.

**Dlaczego to jest serce fazy.** Mamy **dwa zmierzone łańcuchy przyczynowe, których gra nie umie pokazać**:

- **Q3 (Faza 1C):** cztery lasery dają run **10 224 ticki**, dwa lasery — **13 323**. Czwarta wieża realnie OSŁABIA obronę. Mechanizm: `LASER_TURRET.energyDrain = 12`, więc cztery to **48/s**, przy produkcji `CORE` **10/s**. `BROWNOUT_ORDER` gasi najpierw `EXTRACTOR` — czyli **lasery wyłączają kopalnie**, dochód rudy znika i gracz nie ma z czego odbudować.
- **Q4 (Faza 1C):** `DISRUPTOR.targetPriority = ENERGY_INFRASTRUCTURE` — zjadł wszystkie 7 pylonów między cyklem 2 a 3, odłączając capy.

Gracz autoryzował **więcej obrony** i dostał **mniej**. Dopóki tego nie widać, nie ma jak tego odkryć.

- [ ] **Krok 1: Test — `rawDemand` jest zapotrzebowaniem SPRZED kaskady**

```ts
it('1. rawDemand niesie zapotrzebowanie PRZED gaszeniem, demand — po nim', () => {
  const sim = new Sim({ ...DEFAULT_RUN, seed: 1 });
  const s = sim.state;
  s.ore = 10_000;
  // cztery lasery: 4 x 12 = 48/s przy produkcji CORE 10/s — dokładnie przypadek Q3
  for (const cellId of fourFreeHexagonsNear(s)) sim.enqueue({ kind: 'BUILD', cellId, type: 'LASER_TURRET' });
  sim.step();
  s.storedEnergy = 0;                       // wyczerpany magazyn: kaskada musi zadziałać
  sim.step();
  const p = sim.lastPower;
  expect(p.rawDemand).toBeGreaterThanOrEqual(48);
  expect(p.demand).toBeLessThan(p.rawDemand);          // coś zgaszono
  expect(p.shedTypes.length).toBeGreaterThan(0);
});
```

- [ ] **Krok 2: Uruchom — ma oblać** (`rawDemand` nie istnieje, `sim.lastPower` nie istnieje).

- [ ] **Krok 3: Implementacja w `power.ts` i `loop.ts`**

W `power.ts` policz `rawDemand` w tej samej pętli co `demand`, **przed** kaskadą, i zwróć oba. W `loop.ts:407` zapamiętaj wynik pod nazwą, której używa test: `this.lastPower = updatePower(this.s, light);`, i wystaw go jako `get lastPower(): Readonly<PowerReport>`.

**`PowerReport` NIE wchodzi do `SimState`.** To jest raport z ticku, nie stan — trzymanie go w stanie obciążyłoby snapshot Fazy 5 i `stateHash` bez powodu. Ma być polem `Sim`, poza stanem.

- [ ] **Krok 4: Uruchom — ma przejść.**

- [ ] **Krok 5: HUD pokazuje bilans, nie samą liczbę**

Trzy wielkości: **produkcja**, **zapotrzebowanie (`rawDemand`)**, **magazyn**. Gdy `rawDemand > supply`, HUD nazywa **co zostało zgaszone** — z `shedTypes`, po polsku, w kolejności gaszenia.

Kryterium, nie technika: **gracz ma widzieć „brakuje 38/s, zgaszono kopalnie" zamiast «kopalnie nie działają».** Pierwsze niesie przyczynę, drugie tylko skutek.

- [ ] **Krok 6: Zgaszenie ma nośnik W ŚWIECIE, nie tylko w HUD**

Budynek zgaszony **kaskadą** (brownout) musi różnić się na ekranie od budynku zgaszonego **odłączeniem od sieci** (Q4). Dziś oba mają `powered === false` i wyglądają identycznie — a to są **dwie różne przyczyny wymagające dwóch różnych reakcji gracza**: pierwsza to „dobuduj produkcję", druga to „napraw pylon".

Rozstrzygnij kodowanie sam i uzasadnij. Ograniczenia twarde: minimum **1,00 px** przy domyślnej odległości kamery, wiązane na **najgorszym** członku populacji (najmniejszy budynek to `PYLON`); żaden pojedynczy ton nie osiąga 3:1 wobec trzech pasm; kanał pierścienia alarmu **jest już zajęty** przez `powered === false`.

- [ ] **Krok 7: Mutacje obowiązkowe — pary**

| własność | mutacja tuż ZA progiem | mutacja tuż PRZED |
|---|---|---|
| `rawDemand` liczony przed kaskadą | policz go po kaskadzie | — (ma oblać test 1) |
| nowy kanał ma ≥ 1,00 px na `PYLON` | wartość dająca 0,99 px | wartość dająca 1,01 px |
| dwie przyczyny są rozróżnialne | zrównaj kodowanie obu | — |

- [ ] **Krok 8: Bramka 2B ma nadal przechodzić**

Uruchom `apps/client/scene-gate.html`, tryb prób. **Regresję zapisz, nie obchodź.**

- [ ] **Krok 9: Commit**

```bash
git add packages/sim packages/render apps/client
git commit -m "Faza 2C/4: bilans energii widoczny, brownout odrozniony od odlaczenia od sieci"
```

---

### Task 5: Pełny przebieg — ewakuacja, zwycięstwo, przegrana

**Pliki:**
- Modyfikuj: `apps/client/src/hud.ts`, `apps/client/src/main.ts`
- Test: `apps/client/test/hud.test.ts`

**Interfejsy:**
- Konsumuje: `SimState.phase` (`'RUNNING' | 'VICTORY' | 'DEFEAT'`), `evacCharge`, `evacAlarmRemaining`, `evacUnlockTick`, `EVAC_LOCKED` z `canBuild`.

**§5.6 dosłownie:** wygrana to zbudowanie Modułu Ewakuacyjnego (odblokowany w ostatniej tercji runu), **naładowanie go i przetrwanie alarmu**. Przegrana to utrata Core. **Zniszczony Evac jest odbudowywalny** — gracz traci ładunek, nie run.

- [ ] **Krok 1: Test — do odblokowania ewakuacji jest widoczne odliczanie**

```ts
it('1. przed evacUnlockTick menu odmawia z EVAC_LOCKED i podaje, ile zostało', () => {
  const sim = new Sim({ ...DEFAULT_RUN, seed: 1 });
  const s = sim.state;
  s.ore = 1000;
  const rows = buildMenuRows(s, freeHexagonNear(s));
  expect(rows.find((r) => r.type === 'EVACUATION_MODULE')!.check)
    .toEqual({ ok: false, reason: 'EVAC_LOCKED' });
  expect(evacCountdownSeconds(s)).toBeGreaterThan(0);
});
```

- [ ] **Krok 2: Uruchom — ma oblać.**

- [ ] **Krok 3: Implementacja.** `evacCountdownSeconds(s) = (s.evacUnlockTick - s.tick) * TICK_SECONDS`, przycięte do zera od dołu.

- [ ] **Krok 4: Uruchom — ma przejść.**

- [ ] **Krok 5: Trzy fazy mają trzy zakończenia na ekranie**

**Rozstrzygnięcie przeglądu wstępnego — gdzie mieszka „co zniszczyło Core".** Sprawdziłem: `SimState` nie zapamiętuje tego dziś w żadnej postaci. Pole ma powstać **POZA `SimState`**, jako `Sim.lastCoreDamager: EnemyType | null`, dokładnie tak jak `Sim.lastPower` z Zadania 4 — i z tego samego powodu: **nic w logice symulacji tego nie czyta**, więc nie ma prawa wejść do `stateHash` ani obciążyć snapshotu Fazy 5. Raport z ticku nie jest stanem. Gdyby kiedyś któraś mechanika zaczęła to czytać, przeniesienie do stanu będzie świadomą zmianą, a nie skutkiem ubocznym ekranu porażki.

`RUNNING`, `VICTORY`, `DEFEAT`. Przy `DEFEAT` — **powód**, nie sam fakt: run kończy się utratą Core, więc ekran ma powiedzieć **co zniszczyło Core** (ostatni typ wroga, który zadał obrażenia). To jest ta sama zasada co Zadanie 4 i wprost przygotowuje bramkę z Zadania 6.

- [ ] **Krok 6: Test — ekran porażki niesie przyczynę**

```ts
it('2. ekran porażki nazywa typ, który zniszczył Core', () => {
  const { state, lastCoreDamager } = defeatedStateWithDamager('ARMOR');
  expect(defeatSummary(state, lastCoreDamager)).toContain('ARMOR');
});
```

- [ ] **Krok 7: Pełny przebieg ręczny**

Przejdź run od startu do ewakuacji **albo do przegranej**, i zapisz, co się stało: ile trwał, co zbudowałeś, co go zakończyło. To jest kamień milowy §9 — **pierwszy grywalny run w tym projekcie**. Zapisz go jako świadectwo, wyraźnie oznaczone jako **NIE werdykt** (werdykt należy do bramki z Zadania 6 i do człowieka).

- [ ] **Krok 8: Commit**

```bash
git add apps/client
git commit -m "Faza 2C/5: ewakuacja, zwyciestwo i przegrana z podana przyczyna"
```

---

### Task 6: Bramka czytelności PRZYCZYNOWEJ

**Pliki:**
- Utwórz: `apps/client/causal-gate.html`, `apps/client/src/causalGate.ts`
- Utwórz: `docs/superpowers/specs/2026-09-17-faza-2c-przyczynowosc.md`
- Modyfikuj: `apps/client/vite.config.ts` (trzecie wejście)

**Wzorzec dokumentu:** `docs/superpowers/specs/2026-09-15-faza-2b-czytelnosc.md` — protokół, surowa tabela, werdykt, przebieg kontrolny, tabela mutacji.

**Czego ta bramka NIE jest.** Wszystkie pięć dotychczasowych bramek mierzy czytelność **optyczną** — kontrast pasm, próg piksela, terminator jako granica. Ta mierzy, czy gracz potrafi **cofnąć się po przyczynie**. To inna oś, nie wariant tamtych.

**Kryterium akceptacji, w tej samej formie co bramka terminatora:** gracz wskazuje, **co zniszczyło jego budynek albo dlaczego jego obrona przestała działać, i podaje przyczynę o jeden krok wstecz**. Próg: **N poprawnych na M pytań**, do ustalenia w Kroku 1 tak, jak ustalono go przy poprzednich bramkach.

- [ ] **Krok 1: Protokół i próg**

Ustal `M` (liczba pytań) i `N` (próg zaliczenia), i **uzasadnij je**, tak jak §5 dokumentu 2B uzasadnia piętnaście prób. Wymóg: plan odpowiedzi musi być **zrównoważony**, a panel ma **wykrywać odpowiedź stałą** i zgłaszać ją — inaczej wynik wygląda jak umiejętność, a jest artefaktem (ta wada wyszła przy bramce Fazy 2B, Zadanie 1).

- [ ] **Krok 2: Dwa przypadki testowe są gotowe od Fazy 1C**

Wbuduj je jako scenariusze o znanej prawdzie:

1. **Q3 — brownout.** Cztery lasery przy produkcji `CORE` 10/s. Pytanie: *dlaczego kopalnie przestały działać?* Prawda: zapotrzebowanie 48/s przekroczyło produkcję, a `BROWNOUT_ORDER` gasi `EXTRACTOR` jako pierwszy.
2. **Q4 — odcięcie sieci.** Łańcuch pylonów do dalekiego pentagonu, `DISRUPTOR` zjada ogniwo. Pytanie: *dlaczego cap przestał zasilać?* Prawda: łańcuch jest przerwany, a nie cap zniszczony.

Oba muszą być **rozróżnialne** — to jest właśnie ta para przyczyn, którą Zadanie 4, Krok 6 kazało odróżnić na ekranie.

- [ ] **Krok 3: Kontrola pozytywna — bramka musi umieć OBLAĆ**

Tryb, w którym informacja przyczynowa jest usunięta (HUD bez bilansu, budynki bez rozróżnienia przyczyny zgaszenia). Jeśli człowiek odpowiada poprawnie **i tam**, bramka nie mierzy tego, co deklaruje, a jej wynik nic nie znaczy.

To jest wymóg wyciągnięty z Fazy 2B, gdzie kontrola **dwukrotnie** okazała się przeciekać — najpierw przez `saturate`, potem przez celowanie kamerą w pytaną komórkę.

- [ ] **Krok 4: Przebieg wykonawcy jako sprawdzenie PRZYRZĄDU**

Przejdź bramkę sam i **oznacz wynik wprost jako nie-werdykt**. Uzasadnienie: w Fazie 2B wykonawca i człowiek dostali w tej samej kontroli 12/15 i brak możliwości odpowiedzi — **obie liczby były prawdziwe**, bo agent czytający piksele i oko to dwa różne instrumenty. Bramka jest instrumentem dla **człowieka**.

- [ ] **Krok 5: Przekazanie bramki i zapis wyniku**

Panel składa gotowy blok do wklejenia w dokument wyników. Werdykt zapisuje **właściciel projektu**.

- [ ] **Krok 6: Commit**

```bash
git add apps/client docs/superpowers/specs
git commit -m "Faza 2C/6: bramka czytelnosci przyczynowej — inna os niz piec poprzednich"
```

---

## Definicja ukończenia Fazy 2C

- [ ] `pnpm test` zielony, `pnpm typecheck` bez błędów, strażnik zero-zależności `packages/sim` nadal przechodzi
- [ ] Sześć pełnych przebiegów pakietu **pod obciążeniem** bez oblanej asercji (nie sam pakiet renderu — hałas bierze się z równoległości plików)
- [ ] Wskazanie komórki działa i ma test własności Voronoi na 2000 promieniach
- [ ] Wejście idzie **wyłącznie** przez kolejkę komend — test niezmiennika to wiąże
- [ ] Skrót „wróć do Core" działa (wymaganie z bramki Fazy 0)
- [ ] Siedem powodów odmowy ma siedem komunikatów dla człowieka
- [ ] Bilans energii widoczny: produkcja, zapotrzebowanie **sprzed kaskady**, magazyn, nazwane zgaszone typy
- [ ] Brownout odróżnialny **w świecie** od odłączenia od sieci, przy ≥ 1,00 px na `PYLON`
- [ ] **Bramka Fazy 2B nadal przechodzi** — regresja zapisana, nie obejdzona
- [ ] Pełny run od startu do ewakuacji przeszedł ręcznie
- [ ] Bramka czytelności przyczynowej: **potrafi oblać** (dowiedzione kontrolą) i ma werdykt człowieka
- [ ] Render nadal nie mutuje `SimState` ani `Planet`
- [ ] `apps/client` ma pakiet testowy — pierwsze testy w tym workspace

---

## Czego ta faza świadomie NIE obejmuje

- **Pętla roguelite, draft 1 z 3, krzywa eskalacji** — Faza 3. Ta faza daje pojedynczy run, nie powtarzalność.
- **Adresowana losowość** (`docs/pomysly/inspiracje.md`, 001.1) — przed Fazą 3, ale osobno; unieważnia baseline'y `stateHash` i nie ma nic wspólnego ze sterowaniem.
- **Nachylenie osi, noc polarna, tempo obrotu** (002.2, 002.6) — Faza 3 lub później, razem, bo dotykają tego samego `sunDirection` i tych samych hashy.
- **Kierunek artystyczny, VFX, audio, onboarding** — Faza 4. Budynki i jednostki zostają rekwizytami; ustalenia Fazy 2B (dwa tony obowiązkowo, cztery piksele na kanały stanu, brak rozpoznania typu przez rozmiar) są **specyfikacją dla przyszłej grafiki**, nie do zmiany tutaj.
- **Profil sterty `UnitLayer.update`** — dług zapisany przy scaleniu 2B, do Fazy 3 lub 4.
