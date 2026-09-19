# Plan testów z ludźmi — co mierzymy i czego headless nie umie powiedzieć

**Data:** 2026-09-19. **Gałąź:** `faza-3`, odcisk konfiguracji `321c77c8`.
**Decyzja właściciela:** nie gonimy kamienia milowego Fazy 3 („rozkłady z 10 000 runów są
zdrowe"), tylko idziemy na testy z ludźmi i stroimy podłogę, wiedząc gdzie naprawdę leży
nowicjusz — zamiast wyprowadzać to z bota, który z założenia ma być słaby.

## Dlaczego teraz, a nie po domknięciu Fazy 3

Trzy kryteria są oblane i **wszystkie trzy opierają się na tym samym założeniu, którego
headless nie potrafi sprawdzić**: że `BeginnerPolicy` przybliża prawdziwego nowicjusza.

§11.1 specu mówi wprost, że progi bezwzględne zmierzone na słabej polityce **nie są
wiążące**. Dziś ta sama luka przewija się przez H2 (0,0 % zwycięstw), H4 (37,2 % porażek
w cyklu 1) i H5 (dwa wygrywające otwarcia z wymaganych trzech). Strojenie ich dalej
oznaczałoby celowanie w bota.

Stan przyrządów: gra jest grywalna (sprawdzone w przeglądarce na dzisiejszym balansie),
a narzędzia balansu pozwalają przeliczyć wszystkie kryteria po każdej zmianie treści
w ~30 minut czasu maszyny.

## Sześć pytań, każde z powodem i sposobem odczytu

### 1. Gdzie na osi leży prawdziwy nowicjusz

Bot początkujący wygrywa **0 %**, znana linia **37,7 %**. To są dwa końce, między którymi
nie mamy ani jednego punktu. **Bez tej liczby progi H2 i H4 są zgadywane.**

*Odczyt:* odsetek zwycięstw w pierwszych trzech runach osoby, która nie zna gry.
Interesuje nas też, czy w ogóle rozumie, że run da się wygrać.

### 2. Czy start w nocy czyta się jako napięcie, a świt jako ulga

`sunPhaseAtStart = 0,75` wybrałem **pomiarem** — 45 sekund nocy, potem wschód, i to
minimalizuje porażki w cyklu 1 (59,8 % przy tej fazie wobec 92,2 % przy starcie o świcie).
Zamierzona opowieść brzmi: *zaczynasz w ciemności, pierwszy wschód jest twoją pierwszą
ulgą*. Nie wiem, czy ktokolwiek to tak przeczyta.

*Odczyt:* co gracz mówi, gdy przychodzi pierwszy wschód. Ulga? Zaskoczenie? Nic?

### 3. Czy dwie wieże są rozróżnialne

Po zmianie z Zadania 3 obie są AOE i różnią się **wyłącznie liczbami**: tania, słaba,
oszczędna w energii wobec drogiej, mocnej, prądożernej. Zmierzony parytet (37,7 % wobec
35,2 %) znaczy, że obie linie wygrywają — ale **nie znaczy, że gracz wie, kiedy którą brać**.
Jeśli nie wie, wybór jest pozorny i trzeba wrócić do projektu tych budynków.

*Odczyt:* czy gracz kiedykolwiek stawia obie. Czy umie powiedzieć, po co.

### 4. Czy pierwsze dwadzieścia sekund to spokój, czy martwy start

Zmierzone: przy `baseRatePerPentagon = 0,05` każdy pentagon potrzebuje **20 sekund** na
pierwszą jednostkę. Do tego czasu na planecie nie dzieje się nic. Z perspektywy balansu
to oddech na postawienie wieży; z perspektywy gracza może być pustką.

*Odczyt:* co gracz robi w tych dwudziestu sekundach i czy pyta „czy to już działa".

### 5. Czy 27 minut to dobra długość pierwszego runu

Pasmo H3 (25–35 min) pochodzi z filaru D4 specu, **nie z pomiaru na ludziach**. Zmierzona
mediana runu wygranego to 27,4 min.

*Odczyt:* w której minucie gracz pyta „ile to jeszcze potrwa". Czy kończy run, czy odchodzi.

### 6. Czy HUD przyczynowy robi swoje

Faza 2C zbudowała HUD tłumaczący, **dlaczego** czegoś nie da się postawić, i bramkę
czytelności do tego. Sekcja §7 tamtej bramki **do dziś jest pusta** — nikt nie postawił
werdyktu. To naturalny moment.

*Odczyt:* czy gracz kiedykolwiek utknął, nie wiedząc czemu coś nie działa.

## Czego tester potrzebuje, a czego nie ma

**Onboarding jest POZA zakresem MVP** (§8.2) i go nie ma. Tester dostanie więc kartkę,
nie samouczek — i to jest świadome, bo samouczek zasłoniłby pytanie 6.

Minimum do podania na wejściu:

- lewy przycisk buduje, prawy rozbiera, klawisze **1–9** wybierają typ, **spacja** wraca
  kamerą do Core;
- **wygrywasz, ewakuując się** — moduł ewakuacyjny odblokowuje się dopiero w cyklu 7;
- **przegrywasz, tracąc Core**;
- wrogowie wychodzą z **pentagonów po ciemnej stronie**, a **światło ich pali**.

Ostatni punkt jest na granicy podpowiedzi. Zostaje, bo bez niego pytanie 2 nie ma sensu —
gracz nie oceni świtu jako ulgi, jeśli nie wie, że słońce działa na jego korzyść.

## Czego NIE robimy przy tych testach

Nie stroimy liczb między sesjami. Każda zmiana balansu unieważnia porównanie między
testerami, a przy trzech–pięciu osobach nie ma z czego odbudować próby. Zmiany zbieramy
i wprowadzamy **po całej serii**.

## Stan gry, na której testujemy

| kryterium | wartość | próg | |
|---|---|---|---|
| H1 sufit (znana linia) | 37,7 % ±3,0 | 25–60 % | ✓ |
| H3 mediana runu wygranego | 27,4 min ±0,04 | 25–35 min | ✓ |
| H4 porażki w cyklu 1 (bot) | 37,2 % ±3,0 | <15 % | ✗ |
| H5 wygrywające otwarcia | 2 | ≥3 | ✗ |
| H2 podłoga (bot) | 0,0 % | >2 % | ✗ |

Trzy oblane kryteria to **dokładnie te, których dotyczą pytania 1–3**. Testy mają
rozstrzygnąć, czy są wadą gry, czy wadą bota, którym je mierzono.

## Jak uruchomić

```
pnpm --filter @heliopolis/client dev
```

Domyślnie port 5180; przy kolizji z innym worktree (`strictPort` ubija start) dołóż
`-- --port 5183`.
