# Faza 3 — pętla roguelite, pula ulepszeń i balans

> **Dla wykonawców agentowych:** WYMAGANY SUB-SKILL: użyj superpowers:subagent-driven-development (zalecane) albo superpowers:executing-plans, żeby wykonać ten plan zadanie po zadaniu. Kroki mają składnię checkboxów (`- [ ]`).

**Cel:** Run jest **napięty i powtarzalny**, a gracz co świt podejmuje decyzję, która coś zmienia.

**Architektura:** Balans wyznacza **headless runner**, nie intuicja. Draft ulepszeń jest częścią `SimState` (wpływa na przebieg, więc migawka Fazy 5 musi go nieść), ale **pula i jej skutki są danymi**, nie gałęziami w kodzie. Klient dostaje ekran draftu; reszta pętli jest po stronie symulacji.

**Stos:** TypeScript 7.0.2 (`tsc -b`), Vitest 5.0.0, pnpm 11.17.0, Node ≥ 22, Three.js 0.186.0, Vite 7.3.6.

**Spec:** `docs/superpowers/specs/2026-09-14-project-heliopolis-design.md` — Faza 3 z §9, pętla roguelite §5.5, fale i eskalacja §5.4, filar D4. Punkt wyjścia dla balansu: **§11.1** (pomiary Fazy 1C). Otwarte pytania tej fazy: **Q5** (wszystkie `[STROJENIE]`) i **Q6** (skład puli).

---

## Global Constraints

Wszystkie ograniczenia Faz 2A–2C obowiązują dalej. Powtarzam te, które ta faza może złamać, plus jedno nowe.

- **`packages/sim` bez zależności runtime.** Strażnik `contract.test.ts`.
- **Wejście gracza idzie wyłącznie przez kolejkę komend.** Wybór ulepszenia to **komenda**, nie zapis do stanu — tak samo jak budowa. To warunek Fazy 5, nie wygoda.
- **Render nigdy nie mutuje `SimState` ani `Planet`.**
- **NOWE — złoty hasz trajektorii jest dwuczłonowy.** `packages/sim/test/golden-hash.test.ts` przypina osobno **odcisk tabel balansu** i **hasz trajektorii**. Ta faza będzie zmieniać balans, więc odcisk będzie oblewał — **to jest oczekiwane**. Zasada: gdy oblewa **sam odcisk**, przepnij obie liczby w tym samym commicie i napisz w nim, że zmiana balansu jest zamierzona. Gdy oblewa **trajektoria przy nietkniętym odcisku** — to regresja silnika, **nie przepinaj**.
- **Determinizm jest nienaruszalny.** Ten sam seed i ta sama konfiguracja dają ten sam przebieg co do bitu. Draft ulepszeń losuje z generatora wyprowadzonego z seeda, nigdy z `Math.random`.
- Każda liczba balansowa oznaczona `// [STROJENIE]`, każda czysto wizualna `// [WYGLĄD]`.
- Commit po każdym zadaniu.

---

## Rozstrzygnięcia tego planu — i co je może obalić

Trzy rzeczy trzeba było rozstrzygnąć, żeby plan dało się napisać. Każda jest **rozstrzygnięciem, nie odkryciem** — zapisana tak, żeby pomiar mógł ją obalić.

### R1. „Zdrowe rozkłady" dostają sześć liczb

Kamień milowy §9 brzmi „rozkłady z 10 000 runów są zdrowe". To nie jest kryterium, dopóki nie ma liczb. Przyjmuję sześć, wszystkie mierzalne headlessem:

| # | kryterium | próg | skąd |
|---|---|---|---|
| **H1** | odsetek zwycięstw polityki WPRAWNEJ | **25–60 %** | roguelite: ani „przechodzi się samo", ani „nie da się" |
| **H2** | odsetek zwycięstw polityki POCZĄTKUJĄCEJ | **> 2 % i < H1/2** | gra musi być do nauczenia, a umiejętność musi mieć znaczenie |
| **H3** | mediana długości runu WYGRANEGO | **25–35 min** (30 000–42 000 ticków) | D4 wprost |
| **H4** | odsetek porażek w cyklu 1 | **< 15 %** | dziś jest ~100 % (§11.1) — run kończący się przed pierwszą decyzją nie jest runem |
| **H5** | liczba RÓŻNYCH otwarć wygrywających ≥ 20 % seedów | **≥ 3** | §11.1: „otwarcie dopuszcza dokładnie jedną linię" jest dziś główną wadą |
| **H6** | dla każdego ulepszenia z puli: zmiana H1 po jego USUNIĘCIU | **< 10 punktów proc.** | ulepszenie zmieniające wynik o więcej nie jest wyborem, tylko wymogiem |

**Co je może obalić.** H1 i H3 są wzięte z gatunku i z D4, nie zmierzone — jeśli po Zadaniu 3 okaże się, że przy zdrowych H2/H4/H5 odsetek zwycięstw uparcie siada na 15 %, to **pomiar wygrywa z tą tabelą**, a próg trzeba przepisać wraz z uzasadnieniem. H6 jest najpewniejsze, bo mierzy własność wewnętrzną puli, nie gust.

### R2. Dwie polityki, nie jedna — i każda odpowiada na inne pytanie

Dzisiejszy bot ma w doc-comment: *„NIE ma być dobry — ma reprezentować rozsądnego początkującego"*. To jest słuszne i **zostaje**. Ale §11.1 zawiera zastrzeżenie, którego nie da się obejść: tabela ekstraktorów używała słabszej polityki, więc **progi bezwzględne z niej nie są wiążące**.

Rozstrzygnięcie: **dwie polityki, nazwane po pytaniu, na które odpowiadają.**

- `BeginnerPolicy` (dzisiejsza, nietknięta) — *„czy początkujący ma szansę?"*
- `SkilledPolicy` (nowa, co najmniej tak dobra jak `WINNING_OPENING`) — *„gdzie jest sufit?"*

Mieszanie ich to dokładnie ta wada, która unieważniła tabelę ekstraktorów. Każdy pomiar balansu w tej fazie **nazywa politykę**, na której powstał.

### R3. Ulepszenia są DANYMI, a ich skutek — mnożnikiem w jednym miejscu

Pula ma cztery kategorie (§5.5: energia / obrona / budowa / ryzyko-nagroda). Kuszące jest zapisać każde ulepszenie jako gałąź w kodzie symulacji. **Nie.** Ulepszenie to wpis w tabeli z listą modyfikatorów, a modyfikatory wchodzą w **jednym** miejscu na system.

Powód nie jest estetyczny: przy gałęziach każde nowe ulepszenie dokłada ścieżkę, której złoty hasz trajektorii nie pilnuje, a Faza 5 musi zserializować. Przy danych — pula jest jedną tabelą, a stan niesie **listę wziętych ulepszeń**, czyli kilka bajtów.

**To jest jedna z możliwych dróg, nie wymóg.** Gdyby któreś ulepszenie z puli okazało się nieopisywalne mnożnikiem (np. „pentagony zaczynają erupować parami"), to jest sygnał do przemyślenia tego rozstrzygnięcia, a nie do wciśnięcia go na siłę.

---

## Stan wyjściowy — co JUŻ istnieje i czego nie wolno budować od nowa

Zweryfikowane w kodzie 2026-09-18, na `main` po scaleniu Fazy 2C.

- **`tools/headless`** — runner, `ScriptedPolicy`, `formatReport`, `RunResult` (niesie też `coreDamager`). `pnpm bench [liczbaRunów] [pierwszySeed]`.
- **`packages/sim`** — kompletna symulacja: ekonomia, energia z kaskadą brownoutu, sieć, flow fieldy, walka, spalanie, fale, warunki końca. Determinizm strzeżony **złotym haszem trajektorii** (każdy tick, 1200 ticków) plus odciskiem tabel balansu.
- **`WINNING_OPENING`** w `fullrun.test.ts` — kolejka zabudowy, która wygrywa na `DEFAULT_RUN` (tick 24 133, seed 33). **To jest punkt wyjścia dla `SkilledPolicy`, nie do przepisania od nowa.**
- **Klient** — sterowanie, HUD z powodami odmowy, bilans energii, trzy zakończenia runu, ekran końca z przyczyną.
- **Bramki czytelności** — pięć optycznych (`gate.html`, `scene-gate.html`) i jedna przyczynowa (`causal-gate.html`).

**Czego NIE ma:** meta-progresji między runami (§5.5 — poza MVP, i ta faza jej nie dodaje).

---

### Task 1: Dwie polityki headless — przyrząd, zanim cokolwiek się mierzy

**Pliki:**
- Modyfikuj: `tools/headless/src/policy.ts` (przemianowanie na `BeginnerPolicy`, bez zmiany zachowania)
- Utwórz: `tools/headless/src/skilledPolicy.ts`
- Modyfikuj: `tools/headless/src/run.ts` (wybór polityki), `tools/headless/src/report.ts` (nazwa polityki w raporcie)
- Test: `tools/headless/test/policy.test.ts`

**Interfejsy:**
- Produkuje: `interface Policy { readonly name: string; decide(): Command[] }`; `BeginnerPolicy`, `SkilledPolicy`
- Konsumuje: `Sim`, `canBuild`, `BUILDINGS` — bez zmian w `packages/sim`

**Dlaczego to jest Zadanie 1.** Każdy pomiar balansu zrobiony przed tym zadaniem mierzy bota, nie grę. §11.1 ma tego gotowy przykład: tabela ekstraktorów powstała na słabej polityce i jej progi bezwzględne **nie są wiążące**.

- [ ] **Krok 1: Test — polityka wprawna wygrywa tam, gdzie początkująca ginie**

**Zmiana sygnatury `simulateRun`.** Dziś polityka powstaje WEWNĄTRZ funkcji
(`new ScriptedPolicy(sim)`), więc nie da się jej podmienić. Fabryka wchodzi parametrem,
domyślnie dzisiejsza — wszyscy dotychczasowi wołający zostają nietknięci:

```ts
export interface Policy {
  readonly name: string;
  decide(): Command[];
}

export type PolicyFactory = (sim: Sim) => Policy;

export function simulateRun(
  seed: number,
  cfg: RunConfig,
  maxTicks: number,
  makePolicy: PolicyFactory = (sim) => new BeginnerPolicy(sim),
): RunResult { /* … */ }
```

```ts
it('1. SkilledPolicy wygrywa na seedzie 33, BeginnerPolicy na tym samym ginie w cyklu 1', () => {
  const skilled = simulateRun(33, DEFAULT_RUN, WIN_CAP, (sim) => new SkilledPolicy(sim));
  const beginner = simulateRun(33, DEFAULT_RUN, WIN_CAP, (sim) => new BeginnerPolicy(sim));
  expect(skilled.phase).toBe('VICTORY');
  expect(beginner.phase).toBe('DEFEAT');
  expect(beginner.cycle).toBe(1);
});
```

- [ ] **Krok 2: Uruchom — ma oblać** (`SkilledPolicy` nie istnieje).

- [ ] **Krok 3: Implementacja.** `SkilledPolicy` odtwarza `WINNING_OPENING` jako **politykę**, nie jako listę: kolejka priorytetów z odbudową muru.

```ts
export class SkilledPolicy implements Policy {
  readonly name = 'skilled';
  /** Kolejka z `WINNING_OPENING` — [STROJENIE], bo Zadanie 3 ją przestroi. */
  private queue = [...SKILLED_OPENING];
  private placed = new Map<number, BuildingType>(); // cellId → co tam stało

  constructor(private readonly sim: Sim) {}

  decide(): Command[] {
    // 1. ODBUDOWA przed rozbudową: zniszczony mur wpuszcza falę, a mur jest tańszy
    //    niż wieża, którą ta fala zje. §11.1: zwycięski run ma 2280 odbudów barykad.
    for (const [cellId, type] of this.placed) {
      if (this.sim.state.buildings[cellId] === null && this.affords(type)) {
        return [{ kind: 'BUILD', cellId, type }];
      }
    }
    // 2. Następna pozycja kolejki, gdy stać.
    return this.nextFromQueue();
  }
}
```

- [ ] **Krok 4: Uruchom — ma przejść.**

- [ ] **Krok 5: Test — polityka wprawna jest REPREZENTATYWNA, nie dopasowana do jednego seeda**

Bot wygrywający wyłącznie na seedzie 33 jest przepisaną odpowiedzią, nie polityką.

```ts
it('2. SkilledPolicy wygrywa na WIĘCEJ NIŻ JEDNYM seedzie', () => {
  const wins = [33, 101, 202, 303, 404].filter(
    (seed) =>
      simulateRun(seed, DEFAULT_RUN, WIN_CAP, (sim) => new SkilledPolicy(sim)).phase === 'VICTORY',
  );
  expect(wins.length, `wygrane seedy: ${wins}`).toBeGreaterThanOrEqual(2);
});
```

**Uwaga o progu.** `>= 2` z pięciu jest **niskie celowo**: przy dzisiejszym balansie (0 zwycięstw na 1000 runów bota) nie wiadomo, ile seedów w ogóle jest wygrywalnych. Ten próg pilnuje wyłącznie „to nie jest przepisana odpowiedź na jeden seed". Po Zadaniu 3 **podnieś go** i zapisz nową wartość razem ze zmierzonym odsetkiem.

- [ ] **Krok 6: Raport nazywa politykę.** `formatReport` dostaje nagłówek `polityka: <name>`. Raport bez nazwy polityki jest w tej fazie nieczytelny — dwie liczby z dwóch polityk wyglądają tak samo.

- [ ] **Krok 7: Commit**

```bash
git add tools/headless
git commit -m "Faza 3/1: dwie polityki headless — poczatkujacy i wprawny, kazda na inne pytanie"
```

---

### Task 2: Sześć liczb zdrowia i raport bazowy na 10 000 runów

**Pliki:**
- Utwórz: `tools/headless/src/health.ts`
- Modyfikuj: `tools/headless/src/report.ts`
- Test: `tools/headless/test/health.test.ts`
- Utwórz: `docs/superpowers/specs/<data>-faza-3-balans-bazowy.md` (data dnia, w którym powstaje — tak jak wszystkie dokumenty w tym katalogu)

**Interfejsy:**
- Produkuje: `interface HealthVerdict { id: 'H1'|…|'H6'; value: number; ok: boolean; note: string }`, `assessHealth(runs, policy): HealthVerdict[]`
- Konsumuje: `RunResult[]` z Zadania 1

**Dlaczego osobne zadanie.** Bo bez tego „zdrowy" zostaje przymiotnikiem, a strojenie z Zadania 3 nie ma jak się skończyć. **Tabela z R1 jest tu zamieniana na kod**, żeby werdykt liczyła maszyna, a nie oko patrzące na histogram.

- [ ] **Krok 1: Test — każde kryterium ma PARĘ: rozkład zdrowy przechodzi, chory oblewa**

```ts
it('3. [PARA] H4 (porażki w cyklu 1) przechodzi przy 10%, oblewa przy 20%', () => {
  expect(assessOne('H4', runsWithCycle1Share(0.10)).ok).toBe(true);
  expect(assessOne('H4', runsWithCycle1Share(0.20)).ok).toBe(false);
});
```

**Wymóg dla wszystkich sześciu:** para po obu stronach progu. Kryterium bez połówki „ma przejść" spełni też funkcja zwracająca zawsze `false`.

- [ ] **Krok 2: Uruchom — ma oblać.**

- [ ] **Krok 3: Implementacja** `assessHealth` wedle tabeli R1.

```ts
export interface HealthVerdict {
  readonly id: 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6';
  readonly value: number;
  readonly ok: boolean;
  /** Zdanie dla człowieka: co zmierzono i wobec jakiego progu. */
  readonly note: string;
}

export function assessHealth(runs: readonly RunResult[], policy: string): HealthVerdict[];
```

**Progi mieszkają w JEDNYM miejscu**, jako tabela — nie rozsypane po sześciu funkcjach.
Zadanie 3 będzie je czytać, a nie przepisywać.

- [ ] **Krok 4: Uruchom — ma przejść.**

- [ ] **Krok 5: Raport bazowy.** Przepuść **10 000 runów każdą polityką** na dzisiejszym balansie i zapisz wynik do dokumentu.

**Spodziewany wynik: większość kryteriów OBLANA.** To jest cel tego kroku — dokument jest **punktem odniesienia**, wobec którego mierzy się Zadanie 3. Raport, który tu wychodzi zdrowy, znaczy, że kryteria są za luźne.

- [ ] **Krok 6: Commit**

```bash
git add tools/headless docs/superpowers/specs
git commit -m "Faza 3/2: szesc liczb zdrowia i raport bazowy — punkt odniesienia dla strojenia"
```

---

### Task 3: Strojenie krzywej — nagrody, ruda startowa, eskalacja

**Pliki:**
- Modyfikuj: `packages/sim/src/sim/defs.ts`, `packages/sim/src/sim/rules.ts`, `packages/sim/src/sim/spawning.ts` (wyłącznie liczby `[STROJENIE]`)
- Utwórz: `tools/headless/src/sweep.ts`
- Modyfikuj: `packages/sim/test/golden-hash.test.ts` (**przepięcie odcisku balansu — patrz Global Constraints**)
- Dokument: `docs/superpowers/specs/<data>-faza-3-balans-bazowy.md` (data dnia, w którym powstaje — tak jak wszystkie dokumenty w tym katalogu) (sekcja „po strojeniu")

**Interfejsy:**
- Produkuje: `sweep(axis, values, policy): HealthVerdict[][]` — przemiatanie jednej osi
- Konsumuje: `assessHealth` z Zadania 2

**Punkt wyjścia jest zmierzony, nie zgadnięty** (§11.1). Trzy rzeczy są już wiadome i **nie wolno ich odkrywać od nowa**:

1. **Cena modułu ewakuacyjnego NIE jest bramką** — 300 → 1200 przesuwa zwycięstwo o 281 ticków. Nie marnuj na to przemiatania.
2. **Stopa nagród za zabicie jest prawdziwym suwakiem**, z progiem między **0,25×** a **0,1×**. Poniżej progu run umiera, bo nie stać go na **mur**, nie na moduł.
3. **Ekstraktory rozstrzygają run dokładnie wtedy, gdy nagrody nie pokrywają odbudowy muru** — zmierzone przy 600 rudy startowej i nagrodach 0,25×.

**Rekomendacja specu:** nagrody ~0,25× i wyższa ruda startowa. **To jest hipoteza do sprawdzenia, nie wartość do wpisania.**

- [ ] **Krok 1: Przemiataj stopę nagród** w zakresie 0,15×–0,5× przy dzisiejszej rudzie startowej, OBIEMA politykami. Zapisz H1–H4 dla każdego punktu.

- [ ] **Krok 2: Przemiataj rudę startową** w zakresie 150–900 przy stopie wybranej w Kroku 1.

- [ ] **Krok 3: Sprawdź H5 — ile otwarć wygrywa.** Wymaga wariantów `SkilledPolicy` o różnej kolejności zakupów. **To jest kryterium, dla którego strojenie w ogóle się robi**: §11.1 pokazało, że dziś wygrywa dokładnie jedna linia.

- [ ] **Krok 4: Krzywa eskalacji.** `growthPerCycle`, `baseRatePerPentagon`, progi `disruptorFromCycle`/`armorFromCycle` — przemiataj pod H3 (mediana runu 25–35 min) i H4.

- [ ] **Krok 5: Wpisz wybrane wartości**, każdą z komentarzem `[STROJENIE]` mówiącym **na jakim pomiarze stoi**. Liczba bez tego zdania jest w tej fazie zakazana.

- [ ] **Krok 6: Przepnij złoty hasz.** Odcisk balansu oblał — to zamierzone. Przepnij **obie** liczby i napisz w commicie, że zmiana balansu jest zamierzona.

- [ ] **Krok 7: Raport po strojeniu** — te same 10 000 runów, obie polityki, sekcja „po strojeniu" w dokumencie. Przy każdym kryterium: **przed → po**.

- [ ] **Krok 8: Commit**

```bash
git add packages/sim tools/headless docs/superpowers/specs
git commit -m "Faza 3/3: krzywa wyznaczona headlessem — nagrody, ruda startowa, eskalacja"
```

---

### Task 4: Draft 1 z 3 o świcie — mechanika

**Pliki:**
- Utwórz: `packages/sim/src/sim/upgrades.ts`
- Modyfikuj: `packages/sim/src/sim/state.ts` (pola draftu), `packages/sim/src/sim/commands.ts` (komenda wyboru), `packages/sim/src/sim/loop.ts` (wykrycie świtu), `packages/sim/src/sim/hash.ts` (nowe pola stanu), `packages/sim/src/math/rng.ts` (**nowy strumień `STREAM.DRAFT`** — dziś są `ORE`, `START`, `WAVE`)
- Test: `packages/sim/test/upgrades.test.ts`

**Interfejsy:**
- Produkuje: `type UpgradeId`, `UPGRADES: Record<UpgradeId, UpgradeDef>`, `SimState.pendingDraft: readonly UpgradeId[]`, `SimState.takenUpgrades: readonly UpgradeId[]`, `Command` wariant `{ kind: 'PICK_UPGRADE'; id: UpgradeId }`
- Konsumuje: `lightAt` (wykrycie świtu Core), `Rng` (losowanie trójki z seeda)

**Świt** (§5.5) = moment, w którym **Core wchodzi w światło**. To jedyny naturalny oddech w rytmie gry.

- [ ] **Krok 1: Test — świt wykrywany jest PRZEJŚCIEM, nie stanem**

```ts
it('4. [PARA] draft pojawia się w ticku PRZEJŚCIA Core w światło, nie w każdym jasnym ticku', () => {
  const sim = runUntilCoreLit(seed);
  expect(sim.state.pendingDraft).toHaveLength(3);
  sim.step();
  expect(sim.state.pendingDraft, 'drugi tick w świetle NIE generuje drugiego draftu')
    .toHaveLength(3); // ta sama trójka, nie nowa
});
```

- [ ] **Krok 2: Uruchom — ma oblać.**

- [ ] **Krok 3: Implementacja.** Stan pamięta, czy Core był oświetlony w poprzednim ticku; draft powstaje na **zboczu** ciemno→jasno.

```ts
// state.ts — trzy pola, wszystkie serializowalne (niezmiennik z §snapshot)
coreWasLit: boolean;            // poprzedni tick — bez tego nie ma zbocza, tylko stan
pendingDraft: UpgradeId[];      // pusta tablica = brak oczekującego draftu
takenUpgrades: UpgradeId[];     // kolejność wzięcia jest treścią, więc tablica, nie Set

// loop.ts, w step(), po systemie światła
const coreLit = light[coreCellId] > 0;
if (coreLit && !this.s.coreWasLit && this.s.pendingDraft.length === 0) {
  // Generator z SEEDA I NUMERU CYKLU, nigdy `Math.random` — ten sam run musi dać
  // tę samą trójkę. Strumień własny, żeby draft nie przesuwał generatora fal.
  this.s.pendingDraft = drawThree(Rng.fork(STREAM.DRAFT, this.cycle), this.s.takenUpgrades);
}
this.s.coreWasLit = coreLit;
```

**`pendingDraft.length === 0` w warunku** — inaczej niewybrany draft byłby co świt
zastępowany nowym, a gracz, który raz odpuścił, nigdy nie zobaczyłby tamtej trójki.

- [ ] **Krok 4: Uruchom — ma przejść.**

- [ ] **Krok 5: Test — wybór idzie KOMENDĄ, a stan wchodzi do haszu**

```ts
it('5. wybrane ulepszenie wchodzi do stateHash, a niewybrane nie zmieniają przebiegu', () => {
  const before = stateHash(sim.state);
  sim.enqueue({ kind: 'PICK_UPGRADE', id: sim.state.pendingDraft[0] });
  sim.step();
  expect(stateHash(sim.state)).not.toBe(before);
});
```

**Dlaczego to musi być w haszu, inaczej niż `lastPower`:** ulepszenie **wpływa na przebieg runu**, więc migawka Fazy 5 musi je nieść. To jest różnica między raportem z ticku a stanem.

- [ ] **Krok 6: Test — niewybranie draftu NIE zatrzymuje runu.** Gracz, który nie kliknie, gra dalej bez ulepszenia. Run zatrzymany na modalu byłby grą, w której odejście od klawiatury zmienia zasady.

- [ ] **Krok 7: Commit**

```bash
git add packages/sim
git commit -m "Faza 3/4: draft 1 z 3 o swicie — zbocze, nie stan; wybor komenda, nie zapisem"
```

---

### Task 5: Pula ulepszeń — WYPROWADZONA, nie wymyślona

**Pliki:**
- Modyfikuj: `packages/sim/src/sim/upgrades.ts`
- Utwórz: `tools/headless/src/upgradeSweep.ts`
- Test: `packages/sim/test/upgrades.test.ts`
- Dokument: `docs/superpowers/specs/<data>-faza-3-pula-ulepszen.md`

**To jest odpowiedź na Q6** i jedyne zadanie tej fazy, w którym plan **celowo nie podaje treści**. Kategorie są ze specu (energia / obrona / budowa / ryzyko-nagroda). Konkretne ulepszenia mają zostać **zmierzone**, nie wybrane — bo dokładnie w tym miejscu cztery razy w tym projekcie zapisano implementację zamiast wymagania.

- [ ] **Krok 1: Kandydaci.** Wypisz po 3–5 kandydatów na kategorię. Każdy jako **lista modyfikatorów** (R3), nie gałąź w kodzie. Kandydat nieopisywalny mnożnikiem → zapisz go jako sygnał do przemyślenia R3, nie wciskaj.

- [ ] **Krok 2: Zmierz KAŻDEGO kandydata osobno.** Dla każdego: 2 000 runów `SkilledPolicy` z pulą zawierającą tego kandydata jako jedyną opcję, wobec 2 000 runów bez niego. Zapisz zmianę H1.

- [ ] **Krok 3: Odsiej dwie skrajności.**
  - **martwy** — zmiana H1 poniżej 2 punktów proc.: ulepszenie, którego wzięcie nic nie zmienia, jest szumem w wyborze
  - **wymagany** — zmiana H1 powyżej 10 punktów proc. (H6): to nie jest wybór, tylko podatek

- [ ] **Krok 4: Test — H6 na PEŁNEJ puli**

```ts
it('6. żadne ulepszenie nie jest wymagane — usunięcie każdego zmienia H1 o mniej niż 10 pp', () => {
  const full = winRate(FULL_POOL);
  for (const id of Object.keys(UPGRADES) as UpgradeId[]) {
    const without = winRate(FULL_POOL.filter((u) => u !== id));
    expect(Math.abs(full - without), `ulepszenie ${id}`).toBeLessThan(10);
  }
});
```

- [ ] **Krok 5: Test — trójka jest ZRÓŻNICOWANA.** Draft podający trzy warianty tej samej rzeczy nie jest wyborem: co najmniej dwie kategorie w każdej trójce.

- [ ] **Krok 6: Dokument puli** — dla każdego ulepszenia: kategoria, modyfikatory, **zmierzona zmiana H1**, decyzja (w puli / odrzucone jako martwe / odrzucone jako wymagane).

- [ ] **Krok 7: Commit**

```bash
git add packages/sim tools/headless docs/superpowers/specs
git commit -m "Faza 3/5: pula ulepszen wyprowadzona pomiarem — martwe i wymagane odsiane"
```

---

### Task 6: Ekran draftu i seed w interfejsie

**Pliki:**
- Modyfikuj: `apps/client/src/hud.ts`, `apps/client/src/client.ts`, `apps/client/src/input.ts`, `apps/client/hud.css`
- Test: `apps/client/test/hud.test.ts`

**Interfejsy:**
- Konsumuje: `SimState.pendingDraft`, `UPGRADES`, komenda `PICK_UPGRADE`

- [ ] **Krok 1: Test — trzy ulepszenia na ekranie, wybór idzie KOMENDĄ.** Ten sam niezmiennik, co przy budowie: panel nie dotyka stanu.

- [ ] **Krok 2: Uruchom — ma oblać. Krok 3: Implementacja. Krok 4: Uruchom — ma przejść.**

- [ ] **Krok 5: Budżet znaków.** Nowe wiersze wchodzą do testu 31. **Uwaga: na linii bilansu zostały TRZY znaki zapasu** (108 ze 111) — jeśli opis ulepszenia jest dłuższy niż budżet, **podnieś `MIN_WINDOW_WIDTH_PX` i przelicz budżet**, nie skracaj opisu w ciemno.

- [ ] **Krok 6: Seed widoczny i do podzielenia się.** Numer seeda w HUD; ten sam seed odtwarza ten sam run. To jest „powtarzalny" z kamienia milowego.

- [ ] **Krok 7: Kontrakt wskaźnika.** Nowe elementy panelu **nie mogą łapać wskaźnika** poza wąską łapką — patrz test 33g i wada z Zadania 3 Fazy 2C (38,7 % tarczy).

- [ ] **Krok 8: Commit**

```bash
git add apps/client
git commit -m "Faza 3/6: ekran draftu i seed w interfejsie"
```

---

### Task 7: Bramka Fazy 3 — rozkłady zdrowe I człowiek potwierdza napięcie

**Pliki:**
- Utwórz: `docs/superpowers/specs/<data>-faza-3-bramka.md`

**Rozkłady są konieczne, ale NIE wystarczające.** Sześć liczb z R1 mierzy kształt rozkładu; **żadna z nich nie mierzy, czy w to się chce grać**. Kamień milowy mówi „run jest **napięty**", a napięcie jest osądem człowieka — tak samo jak pięć bramek czytelności.

- [ ] **Krok 1: Raport końcowy** — 10 000 runów, obie polityki, sześć kryteriów, werdykt maszynowy przy każdym.

- [ ] **Krok 2: Protokół dla człowieka.** Trzy pełne runy na trzech różnych seedach, z odpowiedzią na cztery pytania:
  1. Czy w którymkolwiek momencie **wiedziałeś, że już przegrałeś**, i grałeś dalej mimo to? (run napięty nie ma takiego momentu przed końcem)
  2. Czy draft o świcie był **wyborem**, czy oczywistością?
  3. Czy przegrana była **zrozumiała** — umiałeś powiedzieć, co zrobiłbyś inaczej?
  4. Czy dwudziesta piąta minuta była **ciekawsza** niż piąta?

- [ ] **Krok 3: Werdykt właściciela projektu.** Dokument zostawia §7 pusty, tak jak bramka przyczynowa.

- [ ] **Krok 4: Commit**

```bash
git add docs/superpowers/specs
git commit -m "Faza 3/7: bramka fazy — rozklady zdrowe i protokol dla czlowieka"
```

---

## Definicja ukończenia Fazy 3

- [ ] `pnpm test` zielony, `pnpm typecheck` bez błędów, **sześć przebiegów pod obciążeniem z sondą** pokazującą, że obciążenie ugryzło
- [ ] Dwie polityki headless, każda nazwana w każdym raporcie
- [ ] Sześć kryteriów zdrowia policzonych kodem, każde z parą testów po obu stronach progu
- [ ] **H1–H5 spełnione** na 10 000 runów; każde niespełnione zapisane z przyczyną, nie obejdzione
- [ ] **H6 spełnione** — żadne ulepszenie nie jest wymagane
- [ ] Draft 1 z 3 o świcie działa, wybór idzie komendą, stan wchodzi do haszu
- [ ] Pula udokumentowana ze **zmierzoną** zmianą H1 przy każdym wpisie
- [ ] Ten sam seed odtwarza ten sam run co do bitu; seed widoczny w interfejsie
- [ ] **Złoty hasz trajektorii przepięty świadomie** — każde przepięcie w commicie mówiącym, że zmiana balansu jest zamierzona
- [ ] Bramki czytelności Fazy 2B i 2C **nadal przechodzą** — regresja zapisana, nie obejdzona
- [ ] Werdykt człowieka o napięciu runu

---

## Czego ta faza świadomie NIE obejmuje

- **Meta-progresja między runami** — §5.5 stawia ją poza MVP.
- **Kierunek artystyczny, VFX, audio, onboarding** — Faza 4.
- **Rozcięcie sprzężenia trajektorii z tabelami balansu** (wstrzykiwanie `BUILDINGS`/`ENEMIES`) — decyzja architektoniczna, do rozważenia dopiero gdy strojenie tej fazy pokaże, ile naprawdę kosztuje przepinanie odcisku.
- **Profil sterty `UnitLayer.update`** — dług z Fazy 2B, dalej otwarty.
- **Adresowana losowość** (`docs/pomysly/inspiracje.md`, 001.1) — unieważnia baseline'y `stateHash`; osobno.
- **Nachylenie osi i trwale ciemny rejon** (002.2, 002.6) — dotykają `sunDirection` i tych samych haszy; razem, później.
