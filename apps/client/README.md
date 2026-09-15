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
- **`/gate.html`** (Zadanie 5) — bramka czytelności terminatora: harness, w którym
  człowiek ocenia piętnaście par sąsiadujących komórek po dwóch stronach granicy
  światła. Protokół i miejsce na werdykt: `docs/superpowers/specs/
  2026-09-15-faza-2a-czytelnosc.md`, §7.
