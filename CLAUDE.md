# Project Heliopolis — instrukcje dla agenta

Sferyczny survival tower defense na siatce goldbergowej. TypeScript, pnpm workspaces,
symulacja deterministyczna oddzielona od renderu. Docelowo komercyjny, z multiplayerem
na wspólnej planecie (Faza 5) — dlatego **autorytatywność symulacji jest wymogiem już
teraz**, nie refaktorem na później.

Spec: [`docs/superpowers/specs/2026-09-14-project-heliopolis-design.md`](docs/superpowers/specs/2026-09-14-project-heliopolis-design.md).
Ten plik nie powtarza specu ani planów — jest spisem treści i listą rzeczy, które już raz
kosztowały cofniętą pracę.

## Układ

| Miejsce | Co tam jest |
|---|---|
| `packages/sim` | Rdzeń: planeta, RNG, reguły, ekonomia, energia, walka, pathfinding. **Zero zależności runtime.** |
| `packages/render` | Three.js: teren, krata, budynki, jednostki, kamera, wskazywanie. Czyta stan, nigdy go nie zapisuje. |
| `apps/client` | Aplikacja Vite spinająca jedno z drugim + HUD. Szczegóły: [`apps/client/README.md`](apps/client/README.md). |
| `tools/headless` | Przebiegi bez przeglądarki — tym mierzy się balans. |

Publiczną powierzchnią pakietu jest **wyłącznie** `src/index.ts`. Symbol nieeksportowany
stamtąd nie istnieje dla reszty repo. Importy wewnątrz źródeł mają specyfikatory `.js`
(ESM) — to nie pomyłka, nie „poprawiać" na `.ts`.

## Polecenia

```bash
pnpm test        # całe repo; `pretest` buduje `dist` przed przebiegiem
pnpm dev         # klient na http://localhost:5180/ (strictPort — kolizja z innym worktree ubija start)
pnpm typecheck   # tsc -b
pnpm --filter @heliopolis/headless bench   # przebiegi balansu
```

Jedna konfiguracja Vitest dla całego repo (`vitest.config.ts`). Nie dodawać konfiguracji
per workspace: liczba „N testów w M plikach" ma zostać porównywalna między fazami.

Bramki czytelności to osobne strony tej samej aplikacji: `/gate.html` (sam teren),
`/scene-gate.html` (pełny obraz), `/causal-gate.html` (czy da się cofnąć po przyczynie).
Ich sceny **nie zmieniają się razem z grą** — inaczej dawne wyniki przestają cokolwiek opisywać.

## Zasady, które wynikły z błędów

### 1. Spec opisuje CO, nie JAK

Cztery razy zapisałem w specu konkretną implementację zamiast wymagania i cztery razy
trzeba było to cofnąć (relaksacja siatki, weldowanie epsilonem, progowanie oświetlenia,
kierunek naliczania w Dijkstrze). **W specu: kryterium akceptacji i sposób pomiaru.
W planie: implementacja, oznaczona jako jedna z możliwych dróg.**

Wariant tego samego błędu: **tekst obiecujący więcej, niż sprawdza kod** — komunikat
„positive and finite" obok warunku przepuszczającego `Infinity`, test nazwany od granicy,
której arytmetyka nie osiąga. Za każdym razem wyłapał to pomiar, nigdy czytanie.

### 2. Przyrząd pomiarowy zawodzi częściej niż kod

W tym projekcie sam pomiar zawiódł **osiem razy** — częściej, niż znalazł wadę. Zepsuty
przyrząd daje wynik nieodróżnialny od prawdziwego, więc nie koryguje się sam.

**Każdy pomiar ma mieć kontrolę, która MUSI się nie udać, gdyby przyrząd był zepsuty.**
Wzorzec dosłowny: [`packages/render/src/positiveControl.ts`](packages/render/src/positiveControl.ts)
— moduł istniejący tylko po to, żeby bramka potrafiła powiedzieć „NIE".

Z konkretów, każdy z przebytej wpadki:

- Przed mutowaniem pliku zrób **kopię**; przywracaj z kopii, nie przez `git checkout --`
  (skasował niezacommitowane zmiany, dwie „złapane mutacje" były w rzeczywistości `TypeError`).
- Po podmianie **odczytaj plik z dysku** i zmierz to, co miało się zmienić. `sed`/`perl`
  potrafią nie dopasować wzorca i nie krzyknąć.
- Kontrola musi **czytać** to, co sprawdza. Napis „mutacja na dysku" wypisany bezwarunkowo
  wygląda jak kontrola, a jest napisem.
- Nie łączyć kontroli z przebiegiem przez `&&` — `grep -c` zwracające 0 urywa łańcuch,
  testy nie ruszają, wygląda na „przeszło".
- Pomiar pod obciążeniem ma mieć **sondę pokazującą, że obciążenie gryzie**. 5 procesów
  na 10 rdzeniach nie zmieniło niczego; przy 20 jeden test oblewał we wszystkich sześciu przebiegach.
- Zanim uznasz „brak efektu" — uruchom zmianę, o której wiadomo, że efekt dać musi.
- Próbkowanie łapie wyłącznie to, co trwa dłużej niż odstęp między próbkami.
- **Naprawa znaleziska domyka instancję; mechanizm, który je wyprodukował, zostaje.**
  H4 liczone na niewłaściwej populacji naprawiono, licząc je na właściwej — a populacje
  nadal przychodziły do `assessHealth` POZYCYJNIE, więc zamiana dwóch ścieżek w wierszu
  poleceń odtwarzała tę samą wadę bez jednego ostrzeżenia. Po każdej naprawie pytanie
  brzmi: *co jeszcze mogłoby wejść tą samą drogą?*

### 3. Progi wiąże się parą mutacji

Dla każdego progu dwie mutacje: **tuż za** (ma oblać) i **tuż przed** (ma przejść).
Połówka „ma przejść" wykryła wadę siedem razy — zawsze wtedy, gdy pierwsza pokazywała
komplet czerwonych i wyglądało to na sukces.

**„Tuż" jest częścią reguły, nie stylem.** Para stojąca daleko od progu wiąże PASMO,
nie próg: dla 25–60 % para 40 % / 85 % świeci na zielono i przepuszcza mutację
`minPct = 35`. Osiem progów z dziewięciu miało tę wadę w Zadaniu 2 Fazy 3 — para ma stać
o najmniejszy krok od liczby, którą wiąże, a osobnej pary potrzebuje też **operator**
(`<` podmienione na `<=` to mutacja, której nie widzi żadna para odległa od granicy).

Złoty hasz: [`packages/sim/test/golden-hash.test.ts`](packages/sim/test/golden-hash.test.ts).
Zamrożona konfiguracja + osobny odcisk tabel balansu — strojenie `DEFAULT_RUN` go nie rusza,
a zmiana `BUILDINGS`/`ENEMIES` oblewa **odcisk**, nie trajektorię. Trajektoria czerwona =
zmienił się silnik.

### 4. Bramki całej gałęzi nie pomijać nigdy

Przeglądy zadaniowe widzą wyłącznie swój diff i są **strukturalnie ślepe na szwy** między
zadaniami. Przegląd całej gałęzi złapał m.in.: pakietu `@heliopolis/sim` nie dało się
zaimportować po własnej nazwie, `canBuild` pozwalał postawić 50 darmowych Core przy zerowej
rudzie, strażnik zero-zależności przechodził pusto na ścieżce ze spacją. Trzy z czterech
były **ciche** — dawały prawdopodobnie wyglądający wynik zamiast błędu.

Autoryzacja merge'a tej bramki nie znosi.

## Rytm pracy

- **Przerwy między etapami.** Etap = zamknięta implementacja, zamknięty przegląd, zamknięta
  runda naprawcza. Po każdym: krótko, co wyszło, i oddać głos. Nie łańcuchować kroków.
  W trakcie jednego etapu — bez statusów.
- **Główne zadania robi agent prowadzący sesję; delegować wolno przegląd** — gdy czegoś nie
  jest pewien albo na końcu etapu. Świeża para oczu na diff wykrywała 5–8 przeżywających
  mutacji na zadanie.
- **Defekt planu naprawia się od razu**, nie na końcu fazy: odroczenie unieważnia już
  wygenerowane briefy.
- **Pomysł z zewnątrz** ląduje w [`docs/pomysly/inspiracje.md`](docs/pomysly/inspiracje.md)
  i czeka na zbiorczy przegląd. To nie jest wyjątek od poprzedniego punktu — defekt blokuje,
  inspiracja nie.
- Runda naprawcza należy się znalezisku **tylko gdy gracz mógłby je zauważyć**. Wady samych
  testów domyka się hurtem. Raportów przeglądowych jest w tym repo więcej niż kodu gry.
- Gdy właściciel projektu mówi „na tej podstawie wybierz" — oczekuje decyzji z uzasadnieniem,
  nie listy opcji.

## Pułapki tego repo

- **Testy widzą źródło, nie `dist`.** Aliasy w `vitest.config.ts` celowo kierują nazwy
  pakietów na `src/index.ts`. Bez tego zielony test znaczyłby „ostatni build był poprawny".
- **Niezmiennik serializowalności `SimState`** (doc-comment w
  [`packages/sim/src/sim/state.ts`](packages/sim/src/sim/state.ts)): nigdy `Infinity`/`NaN`,
  `TypedArray`, `Map`/`Set` — sentinel `-1` zamiast „brak", wyjście BFS/Dijkstry przeliczane
  co tick, nie trzymane w stanie. Strzegą tego **trzy** rzeczy w `state.test.ts`, na trzech
  różnych osiach: round-trip JSON (widzi tylko pola czytane przez `stateHash`), kompletność
  `stateHash` (klucze NAJWYŻSZEGO POZIOMU, TS2366 przy nowym polu — ale **tylko pod `tsc`**,
  nie pod `vitest`) i skaner strukturalny
  [`test/support/serializable.ts`](packages/sim/test/support/serializable.ts), który chodzi
  po WARTOŚCIACH rozegranego stanu i obejmuje pola zagnieżdżone w
  `Unit`/`Building`/`PentagonState`. Świadomie poza zasięgiem skanera: `-0` (łapie je
  round-trip, bo `stateHash` koduje przez `setFloat64`) i referencja współdzielona
  (`JSON.stringify` radzi sobie z nią — zgłaszany jest tylko prawdziwy cykl).
- **`noUncheckedIndexedAccess` wyłączone świadomie** (`tsconfig.base.json`) — kod geometryczny
  to gęste indeksowanie w pętlach o niezmiennych granicach.
- **jsdom nie liczy layoutu.** Układ panelu nie jest strzeżony żadnym testem, a ta klasa wady
  uderzyła już trzy razy (m.in. unieważniła cztery z pięciu pomiarów bramki 2B).
- **Wejście gracza dociera do symulacji wyłącznie przez `sim.enqueue(cmd)`** — nigdy zapisem
  do `sim.state` ani do `Planet`. Pilnowane własnością modułów, nie skanem źródła.
- Każda faza ma własną gałąź i worktree w `.worktrees/` (gitignored); stare zostają.
  Serwery dev z kilku worktree biją się o port 5180.

## Gdzie jest stan

Plany faz: `docs/superpowers/plans/`. Wyniki bramek: `docs/superpowers/specs/`.
Stan na 2026-09-19: `main` = Fazy 0–2C scalone; **Faza 3 (pętla roguelite i balans) w toku**
na gałęzi `faza-3`. Aktualnie: `git log --oneline -5` i plan najświeższej fazy.
