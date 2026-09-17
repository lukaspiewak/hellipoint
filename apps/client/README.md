# @heliopolis/client

Aplikacja Vite renderująca planetę Heliopolis przez Three.js (`@heliopolis/render`).
Zaczęło się w Fazie 2A, Zadanie 1, jako dowód samej rury renderującej (pusty canvas);
Zadania 2-4 dołożyły geometrię, progowane światło i kamerę K1. Faza 2C, Zadanie 2
wstawiła pod to PRAWDZIWĄ symulację (`Sim`) i zamknęła pętlę: kliknięcie gracza jest
komendą, którą symulacja wykonuje w następnym ticku.

## Uruchomienie

Z korzenia repo:

```sh
pnpm dev
```

albo bezpośrednio przez filtr workspace:

```sh
pnpm --filter @heliopolis/client dev
```

Otwiera serwer deweloperski Vite pod `http://localhost:5180/`. Port jest ustawiony na
sztywno (`strictPort`), więc jeśli 5180 zajmuje serwer z INNEGO worktree tego repo,
uruchomienie się nie powiedzie zamiast po cichu wylądować na innym porcie — zatrzymaj
tamten albo dodaj `--port`.

## Sterowanie

| Wejście | Co robi |
|---|---|
| lewy przycisk (klik) | buduje wybrany typ na wskazanej komórce |
| prawy przycisk (klik) | rozbiera budynek na wskazanej komórce |
| przeciągnięcie | obraca kamerę — **nie** buduje (próg `CLICK_SLOP_PX` w `input.ts`) |
| kółko | zoom, ograniczony do `[1,3 R, 8 R]` |
| `1`–`9` | wybór typu budynku (kolejność jak w `BUILDINGS`, bez CORE) |
| `Spacja` | „wróć do Core" — kamera patrzy wprost na komórkę startową, bez zmiany zoomu |
| `Shift`+`1/2/3` | tryb cieniowania jednostek (narzędzie diagnostyczne Fazy 2B) |

Wejście gracza dociera do symulacji **wyłącznie** przez `sim.enqueue(cmd)` — nigdy przez
zapis do `sim.state`. To warunek Fazy 5 (autorytatywny serwer), pilnowany **własnością**:
`attachInput` (`src/input.ts`) trzyma całą drogę od zdarzenia do kolejki, a testy 18-20
mierzą obie połowy — hasz stanu nietknięty przez obsługę zdarzenia, świat zmieniony
dokładnie tak, jak zapowiadała komenda, dopiero po `step()`. Skan źródła (test 12) jest
tylko siatką pomocniczą na `main.ts`, którego nie da się uruchomić w teście.

## Testy

```sh
pnpm test            # całe repo (buduje `dist` przed uruchomieniem)
npx vitest run apps/client
```

Testy tego workspace'u **nie potrzebują przeglądarki**: cała logika wejścia siedzi
w `src/input.ts`, poza modułami dotykającymi DOM, a atrapę płótna dostarcza
`packages/render/test/support/fakeCanvas.ts`. **Granica:** to nie jest strażnik UKŁADU —
jsdom nie liczy layoutu, więc wada z Fazy 2B (kontrolki panelu pod krawędzią przewijania
przy oknie 480 px) dalej nie jest niczym strzeżona.

## Strony

- **`/`** (`index.html`) — normalny widok: planeta, kamera K1, orbitujące słońce.
- **`/gate.html`** — bramka czytelności terminatora **na SAMYM TERENIE**: piętnaście
  osądów „czy zaznaczona komórka leży po stronie oświetlonej". To jest instrument, którym
  Faza 2B zmierzyła 15/15, i jego scena **nie zmienia się razem z grą** — inaczej tamten
  wynik przestałby opisywać cokolwiek. Protokół i werdykt:
  `docs/superpowers/specs/2026-09-15-faza-2b-czytelnosc.md`, §5–§7.
- **`/scene-gate.html`** (Faza 2B, Zadanie 5) — bramka **PEŁNEGO OBRAZU**: ta sama
  mechanika prób, ale na scenie, którą gracz naprawdę widzi (teren + krata + budynki +
  jednostki). Dwie fazy: PRÓBY (pytanie 1, scena zamrożona) i SWOBODNY (pytania 2–5,
  słońce orbituje, jednostki idą i płoną). Protokół, wyniki i pięć pytań do wypełnienia:
  ten sam dokument, §13.
