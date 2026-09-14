# Faza 0 — Spike czytelności kuli

> **Uwaga dla wykonawców:** To **nie jest** plan TDD i nie należy go wykonywać skillem `subagent-driven-development`. Produktem spike'a jest **odpowiedź i liczby**, nie kod. Cały powstały kod jest świadomie do wyrzucenia.

**Cel:** Rozstrzygnąć, czy tower defense na pełnej sferze jest czytelny i przyjemny w sterowaniu — zanim powstanie jakakolwiek architektura, która to założenie zabetonuje.

**Podejście:** Jeden plik, jedna scena, trzy modele kamery do bezpośredniego porównania. Zero ekonomii, zero UI budowania, zero architektury. Wyłącznie to, co potrzebne do zmierzenia czytelności.

**Stos:** Three.js (najnowsza wersja z npm — **nie** r128 z draftu), Vite, TypeScript bez rygoru.

**Spec:** [`docs/superpowers/specs/2026-09-14-project-heliopolis-design.md`](../specs/2026-09-14-project-heliopolis-design.md) — §10 (ryzyko nr 1), §7.3, Q1.

**Budżet czasu: 2 dni. Twardy.** Spike, który się przeciąga, przestaje być spike'iem i staje się długiem.

---

## Global Constraints

- Kod powstaje w `spike/` z plikiem `spike/README.md` zawierającym dosłownie: **„Kod do wyrzucenia. Nie buduj na tym. Patrz docs/superpowers/plans/2026-09-14-faza-0-spike-czytelnosci.md"**.
- **Zakaz przenoszenia czegokolwiek ze `spike/` do `packages/`.** Faza 1 pisze wszystko od zera, z testami. Jedyne, co przechodzi dalej, to dokument z wynikami.
- `N = 1442` (detail 11), zgodnie z D2. Nie testujemy czytelności na mniejszej planecie, bo pytanie dotyczy docelowej skali.
- Planeta statyczna, orbituje światło (§4.3).
- Okres obrotu `T = 180 s` (§4.3) — spike ma pokazać, jak ten rytm wygląda, więc nie wolno go po cichu zmieniać „żeby ładniej wyglądało". Jeśli wygląda źle, to jest wynik pomiaru i idzie do raportu.

---

## Co budujemy

Minimalna scena zawierająca **wyłącznie** to, co wpływa na czytelność:

| Element | Zakres | Świadomie pominięte |
|---|---|---|
| Siatka dualna | 1442 komórki, `InstancedMesh`, kolor per instancja | relaksacja Lloyda (nierówność komórek jest tu nieistotna) |
| Światło | orbitujące źródło kierunkowe, cieniowanie z `dot(normal, sunDir)` | zaćmienia, atmosfera, bloom |
| Jednostki | ~300 sztuk, `InstancedMesh`, prymitywny ruch do Core | flow field (wystarczy ruch po wielkim okręgu), typy wroga, walka |
| Budynki | ~150 sztuk, dwa kolory (Core / reszta) | wszystkie mechaniki |
| Wybór komórki | raycaster + podświetlenie | panel budowy, koszty |
| Kamera | **trzy modele, przełączane klawiszem 1/2/3** | — |

## Trzy modele kamery

| # | Model | Opis | Znane ryzyko |
|---|---|---|---|
| **K1** | Swobodna orbita | `OrbitControls` wokół statycznej planety. Gracz sam obraca widok | gubienie bazy; brak poczucia „góry" |
| **K2** | Przyklejona do powierzchni | Kamera trzyma punkt zaczepienia na sferze; przesuwanie przenosi zaczepienie po wielkim okręgu, `up` = normalna powierzchni. Planeta toczy się pod graczem | choroba lokomocyjna przy szybkim przesuwaniu; nieoczywista rotacja |
| **K3** | Quasi-2D lokalna płaszczyzna | Kamera patrzy niemal prostopadle w dół, blisko powierzchni, wąskie FOV. Sfera jest renderowana, ale gra czyta się jak zawijana mapa 2D | traci się poczucie kuli, czyli częściowo filar projektu |

Wszystkie trzy muszą być dostępne w **jednej** sesji, przełączane na żywo. Porównanie z pamięci między osobnymi buildami jest bezwartościowe.

---

## Protokół pomiarowy

Każdy pomiar wykonywany na wszystkich trzech kamerach, minimum 5 prób.

### P1 — Czas zlokalizowania zagrożenia
Grupa 20 jednostek pojawia się poza kadrem, w losowym z 12 pentagonów. Mierzony czas od spawnu do wyśrodkowania kadru na grupie.
- Wykonać w dwóch wariantach: **bez** wskaźników pozazakadrowych i **ze** wskaźnikami na krawędzi ekranu.
- Zapisać oba czasy. Różnica między nimi mówi, ile czytelności trzeba dokupić w UI.

### P2 — Powrót do bazy
Z losowej orientacji kamery: czas powrotu do wyśrodkowania na Core.
- Wariant bez skrótu i ze skrótem klawiszowym „wróć do Core".

### P3 — Czytelność terminatora
Zrzut ekranu z granicą światło/cień przechodzącą przez bazę. Pytanie: czy bez najeżdżania kursorem da się wskazać, które komórki produkują energię, a które spawnują?
- Odpowiedź opisowa + zrzuty. Sprawdzić przy cieniowaniu ciągłym (`saturate(dot)`) i progowanym.

### P4 — Budżet klatki
Przy 1442 komórkach, 300 jednostkach, 150 budynkach:
- ms/klatkę (render), liczba draw calls, zużycie pamięci GPU.
- Zmierzyć na **docelowym sprzęcie minimalnym**, nie na maszynie deweloperskiej. Jeśli minimalny sprzęt nie jest jeszcze ustalony — ustalić go teraz i zapisać w raporcie.

### P5 — Ilu graczy widać naraz
Ustawić 4 bazy rozrzucone po planecie (przygotowanie do Fazy 5). Czy da się zorientować, co robią pozostali? Czy potrzebna będzie minimapa, a jeśli tak — jaka projekcja?

---

## Kryteria wyjścia

Bramka rozstrzygana **przed** napisaniem pierwszej linijki Fazy 1.

| Wynik | Warunek | Co dalej |
|---|---|---|
| **PASS** | Istnieje kamera, w której: P1 bez wskaźników < 3 s, P2 bez skrótu < 2 s, P3 czytelny, P4 render ≤ 8 ms na sprzęcie minimalnym | Faza 1 rusza. Wybrany model kamery + zmierzone liczby wchodzą do specu jako rozstrzygnięcie Q1 |
| **WARUNKOWY** | Kryteria spełnione tylko ze wskaźnikami pozazakadrowymi / skrótem / minimapą | Faza 1 rusza, ale te elementy UI **wchodzą do zakresu MVP** (§8.1) jako wymagane, nie opcjonalne. Zaktualizować §8.1 |
| **FAIL** | Żaden model nie daje czytelnej rozgrywki | **Stop.** Powrót do designu — patrz warianty odwrotu poniżej |

## Warianty odwrotu przy FAIL

Nazwane teraz, żeby przy złym wyniku nie podejmować decyzji pod presją:

1. **Czasza zamiast pełnej sfery.** Rozgrywka ograniczona do czaszy planety; reszta jest tłem. Zachowuje terminator i brak krawędzi w jednej osi, traci 3–4 pentagony z 12.
2. **Mniejsze `N`.** Powrót w stronę 642 komórek. Ciaśniejsza gra, płytsza obrona warstwowa, ale wszystko mieści się w kadrze. Cofa część D2.
3. **Geometria toroidalna.** Zachowuje brak krawędzi i ruchomy terminator, traci 12 pentagonów — czyli warstwę map control, na której ma stać multiplayer. Najkosztowniejszy wariant, wymienia jeden filar na drugi.

Każdy wariant odwrotu wymaga rewizji specu, nie łatki w planie.

---

## Produkt końcowy

Plik `docs/superpowers/specs/2026-09-14-faza-0-wyniki.md` zawierający:

- [ ] Wynik bramki: PASS / WARUNKOWY / FAIL, z uzasadnieniem
- [ ] Wybrany model kamery i **dlaczego** przegrały pozostałe dwa
- [ ] Surowe tabele pomiarów P1–P5 (wszystkie próby, nie średnie)
- [ ] Zrzuty ekranu z P3, oba warianty cieniowania
- [ ] Zmierzony budżet klatki + specyfikacja sprzętu minimalnego
- [ ] Lista elementów UI, bez których czytelność nie działa → aneks do §8.1
- [ ] Ustalona wersja Three.js, na której mierzono
- [ ] Jeśli WARUNKOWY lub FAIL: konkretna propozycja zmiany w specu

Po zapisaniu raportu: zaktualizować w specu Q1 (§11) i — jeśli trzeba — §8.1, §7.3, §10. Dopiero wtedy rusza plan Fazy 1A.
