# @heliopolis/client

Aplikacja Vite renderująca planetę Heliopolis przez Three.js (`@heliopolis/render`).
Zaczęło się w Fazie 2A, Zadanie 1, jako dowód samej rury renderującej (pusty canvas);
Zadania 2-4 dołożyły geometrię, progowane światło i kamerę K1 — dziś `/` pokazuje
prawdziwą, oświetloną planetę.

## Uruchomienie

Z korzenia repo:

```sh
pnpm dev
```

albo bezpośrednio przez filtr workspace:

```sh
pnpm --filter @heliopolis/client dev
```

Otwiera serwer deweloperski Vite pod `http://localhost:5180/`.

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
