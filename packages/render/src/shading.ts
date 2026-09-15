import type { PlanetGeometry } from './geometry.js';

/**
 * Kolor w przestrzeni 0..1 na składową — tak jak oczekuje atrybut `color` na
 * `THREE.BufferGeometry` (Zadanie 4). Zero zależności od Three.js: to sama trójka liczb.
 */
export type Rgb = readonly [r: number, g: number, b: number];

/**
 * Progi progowania światła — `[WYGLĄD]`. Rosnące, ściśle wewnątrz (0, 1). `lightBand`
 * zwraca, ile progów dana wartość `light` przekroczyła (lub im dorównała) — więc
 * `LIGHT_BANDS.length` progów daje `LIGHT_BANDS.length + 1` pasm (patrz `Palette`).
 *
 * TO JEST ZADANIE, W KTÓRYM ROZSTRZYGA SIĘ D1 (spec §3 — decyzje strukturalne; bramka Fazy 0,
 * `docs/superpowers/specs/2026-09-14-faza-0-wyniki.md`, wiersz "terminator musi być
 * czytelny jako GRANICA, nie jako gradient"): zmierzone na działającym prototypie, że
 * gładkie `saturate(dot(normal, sunDir))` interpolowane po kuli daje terminator KOMPLETNIE
 * NIEWIDOCZNY, a progowane — ostry i czytelny natychmiast.
 *
 * `geometry.ts` już usuwa interpolację MIĘDZY komórkami (osobne wierzchołki, płaskie
 * wieloboki) — ale to NIE wystarcza samo w sobie: dwie sąsiadujące komórki po obu stronach
 * geometrycznej granicy (`dot == 0`) dzieli zwykle tylko kilka stopni kątowych, więc ich
 * `light` różni się BARDZO NIEWIELE — bez progowania różnica jasności między nimi byłaby
 * ledwo dostrzegalna, czyli dokładnie ten sam brak kontrastu, który bramka zmierzyła jako
 * nieczytelny, tylko przeniesiony z "interpolacji po krawędzi trójkąta" na "interpolację
 * po siatce komórek". Progowanie robi tu dokładnie to, co robiło w spike'u: zamienia setki
 * drobnych kroków jasności na garść dużych, kontrastowych skoków koloru — `lightBand` jest
 * tym mechanizmem, `writeCellColors` niżej go stosuje.
 *
 * NIE "napraw" tego na gładkie — `packages/sim/src/sim/power.ts` (`lightAt`/`lightField`)
 * MUSI zostać funkcją ciągłą (spec §5.1: produkcja panelu słonecznego to
 * `peakOutput · saturate(dot)`, bez progowania). To DWIE RÓŻNE WARSTWY: symulacja liczy
 * ciągle, render prezentuje progowo (`global-constraints.md`). Ten moduł tylko PREZENTUJE
 * to, co symulacja już policzyła — nie zmienia, ile energii produkuje panel.
 *
 * Wybór progów: `saturate` w `lightAt` ścina CAŁĄ noc (`dot <= 0` — dokładnie połowa sfery
 * przy w miarę równomiernej triangulacji) do JEDNEJ wartości, `0.0` — więc pasmo 0 jest z
 * fizyki tej funkcji, nie z wyboru progu, i ZAWSZE obejmie mniej więcej połowę wszystkich
 * komórek. Drugi próg (0.4) dzieli pozostałą (dzienną) połowę na wąski pas "świtu/zmierzchu"
 * tuż za terminatorem i szerszy "dzień" — to już czysta estetyka: spec (§8.1, uwaga pod
 * tabelą) mówi wprost, że trzy pasma to najtańszy sposób ze spike'a, nie rekomendacja, i że
 * Faza 4 może próbować innych dróg (stroma `smoothstep`, wyraźne obrzeże, różnica
 * temperatury barwy). Położenie DRUGIEGO progu to jeden z wielu poprawnych wyborów.
 *
 * ## PIERWSZY PRÓG WYNOSI ZERO — i to NIE jest kwestia estetyki (Faza 2B, Zadanie 1, Krok 3)
 *
 * **Rozstrzygnięte przez właściciela projektu; nie podnosić bez przeczytania tego akapitu.**
 * Do Fazy 2A pierwszy próg wynosił 0,05, czyli pasmo nocy znaczyło "noc PLUS wąski rąbek
 * świtu, którego symulacja nie uznaje za noc". Symulacja pyta wszędzie o `light[cellId] > 0`
 * (`spawning.ts`, `burning.ts`, `movement.ts`) — więc renderowana granica leżała gdzie
 * indziej niż granica, po której symulacja decyduje. Zmierzone przez 12 faz pełnego obrotu:
 * rozjeżdżały się o **8 do 38 komórek** (średnio 30,8), zawsze o dokładnie jeden krok grafu.
 * Dla energii to szum poniżej 5%, ale spawn i spalanie są BINARNE — istniał więc
 * jednokomórkowy pierścień, w którym **gracz widzi noc, a jednostki się palą i pentagony nie
 * spawnują**. Zmierzone po zmianie, tymi samymi 12 fazami plus trzema fazami bramki:
 * rozjazd **0 komórek w każdej fazie** (pomiar w dokumencie wyników Fazy 2B, §4).
 *
 * Zerowy próg daje tę zgodność Z KONSTRUKCJI, nie z dobrego trafienia: `lightBand` porównuje
 * ŚCIŚLE (`light > próg`, patrz niżej), więc `lightBand(l) === 0` ⟺ `!(l > 0)` ⟺ `l === 0`
 * — to jest TA SAMA formuła, której używa symulacja, zanegowana. Dowolny próg DODATNI, choćby
 * mikroskopijny, tej własności NIE MA: najmniejsze dodatnie `light` zmierzone na tej planecie
 * przez 12 faz wynosi **6,3·10⁻¹⁸**, więc nawet próg 10⁻⁷ zostawiłby komórki po złej stronie.
 */
export const LIGHT_BANDS: readonly number[] = [0, 0.4]; // [WYGLĄD] — ale [0] NIE: patrz akapit wyżej

/**
 * Paleta kolorów: dokładnie `LIGHT_BANDS.length + 1` pozycji — jedna na pasmo poniżej
 * pierwszego progu, po jednej na każdy przedział między kolejnymi progami, jedna powyżej
 * ostatniego. `writeCellColors` rzuca `RangeError`, jeśli długość przekazanej palety się
 * nie zgadza (szew opisany przy `LIGHT_BANDS` wyżej — dwie stałe, które nic nie wiąże
 * składniowo) — ale strażnik w kodzie nie zwalnia z pilnowania SAMEJ stałej: test sprawdza
 * też długość `DEFAULT_PALETTE` wprost, niezależnie od strażnika w `writeCellColors`.
 */
export type Palette = readonly Rgb[];

/**
 * `[WYGLĄD]` Noc / zmierzch-świt (pas terminatora) / dzień.
 *
 * Zmierzone PONOWNIE po obniżeniu `LIGHT_BANDS[0]` do zera (Faza 2B, Zadanie 1, Krok 3) przy
 * `createPlanet({ seed: 20260915 })` (frequency 12 domyślne, 1442 komórki) i
 * `sunDirection(0, 180)`:
 *
 *   pasmo 0 (noc):           745 komórek (51,7%)   [było 753 przy progu 0,05]
 *   pasmo 1 (zmierzch/świt): 264 komórki  (18,3%)  [było 256]
 *   pasmo 2 (dzień):         433 komórki  (30,0%)  [bez zmian — drugi próg się nie ruszył]
 *
 * Osiem komórek przeszło z nocy do zmierzchu: dokładnie te, które wpadały w szczelinę
 * `0 < light < 0,05` w TEJ fazie. Pasmo 0 liczy teraz DOKŁADNIE tyle komórek, ile symulacja
 * uznaje za nieoświetlone (745 = 1442 − 697; pomiar `simLit` w dokumencie wyników §4).
 *
 * Pasmo 0 przekracza połowę — to FIZYKA `saturate` (cała noc to jedna wartość `0.0`, patrz
 * komentarz przy `LIGHT_BANDS`), NIE złe strojenie progów: noc zawsze zajmuje dokładną
 * połowę sfery (plus/minus dyskretyzację siatki). Co BYŁOBY złym strojeniem:
 * gdyby któreś z pozostałych, DZIENNYCH pasm (1 albo 2) samo przekroczyło połowę — to
 * pilnuje test #12 w `shading.test.ts` (kanarek z przypiętym rozkładem powyżej).
 *
 * Barwa pasma zmierzchu (ciepły pomarańcz) różni się od dnia (ciepła biel/żółć) i nocy
 * (chłodny granat) też ODCIENIEM, nie tylko jasnością — temperatura barwy czyta się
 * szybciej niż sama jasność (spec, uwaga pod tabelą §8.1 — pomysł zapisany tam jako droga
 * do zbadania w Fazie 4, zastosowany tu już teraz, bo i tak są to trzy stałe kolory, więc
 * kosztuje to dokładnie tyle samo co dobór trzech odcieni szarości).
 */
export const DEFAULT_PALETTE: Palette = [
  [0.03, 0.05, 0.12], // noc — ciemny, chłodny granat (nie czysta czerń, żeby nie zlewał się z tłem canvasu, patrz CLEAR_COLOR w scene.ts)
  [0.85, 0.42, 0.16], // terminator — ciepły pomarańcz świtu/zmierzchu, punkt zaczepienia dla oka
  [0.98, 0.92, 0.74], // dzień — ciepła biel/żółć
]; // [WYGLĄD]

/**
 * Indeks pasma dla danej wartości `light` (0..1, jak zwraca `lightAt`/`lightField`): liczba
 * progów `LIGHT_BANDS`, które `light` przekroczyło ŚCIŚLE. Funkcja SCHODKOWA, celowo —
 * patrz uzasadnienie przy `LIGHT_BANDS`. Zakres wyniku: `0` (na pierwszym progu lub niżej)
 * do `LIGHT_BANDS.length` (powyżej ostatniego progu).
 *
 * **Porównanie jest ŚCISŁE (`light > próg`), nie `>=`, i to jest decyzja, nie szczegół.**
 * Do Fazy 2A było `>=`, a pierwszy próg wynosił 0,05; Krok 3 Zadania 1 Fazy 2B obniżył go do
 * zera, żeby pasmo nocy znaczyło DOKŁADNIE to samo, co noc symulacji. Przy `>=` próg zerowy
 * dałby coś wprost przeciwnego: `0 >= 0` jest prawdą, więc pasmo 0 byłoby PUSTE, a cała noc
 * wpadłaby do pasma zmierzchu. Przy `>` zachodzi natomiast
 *
 *     lightBand(l) === 0   ⟺   !(l > 0)   ⟺   l === 0
 *
 * czyli dokładnie negacja predykatu `light[cellId] > 0`, którym symulacja rozstrzyga spawn
 * (`spawning.ts`), spalanie (`burning.ts`) i ruch (`movement.ts`). Zgodność jest więc
 * ALGEBRAICZNA, nie empiryczna — nie da się jej zepsuć przesunięciem siatki ani fazy słońca.
 * Sprawdza to test #18 w `shading.test.ts`, na wszystkich komórkach i dwunastu fazach obrotu.
 *
 * Skutek dla drugiego progu (0,4) jest mikroskopijny i celowo przyjęty: `light === 0.4`
 * należy teraz do pasma NIŻSZEGO, nie wyższego. Nieciągłość pozostaje pełna — `lightBand(t)`
 * i `lightBand(t + ε)` różnią się o jeden indeks dla dowolnie małego dodatniego `ε`, co
 * sprawdza test #1.
 */
export function lightBand(light: number): number {
  let band = 0;
  for (let i = 0; i < LIGHT_BANDS.length; i++) {
    if (light > LIGHT_BANDS[i]) band++;
  }
  return band;
}

/**
 * Zapisuje płaski kolor KAŻDEJ komórki (wg jej pasma z `lightBand`) do WSZYSTKICH jej
 * wierzchołków w `out` — atrybut `color` geometrii Three.js (Zadanie 4), w tym samym
 * układzie co `positions`/`normals` z `PlanetGeometry` (xyz na wierzchołek → rgb na
 * wierzchołek, ten sam indeks).
 *
 * NIE ALOKUJE NICZEGO: `out` to bufor WŁASNOŚCI WYWOŁUJĄCEGO (`planetMesh.ts`, Zadanie 4),
 * zaalokowany RAZ przy tworzeniu siatki, o długości `positions.length`. Ta funkcja go tylko
 * WYPEŁNIA — w pętli renderu, do 60 razy na sekundę. Alokacja nowej tablicy tej wielkości
 * PER KLATKA (1442 komórki × ~7 wierzchołków × 3 składowe) rzuciłaby śmieci pod nogi
 * odśmiecacza dokładnie tam, gdzie budżet klatki (8 ms, `global-constraints.md`) najmniej
 * to wybacza.
 *
 * @throws {RangeError} gdy `out.length !== geo.positions.length` — wzorzec identyczny z
 *   `updatePower` w `packages/sim/src/sim/power.ts`: niedopasowana długość bez straży
 *   czytałaby/pisała poza zamierzony koniec bufora po cichu (zapis poza granice
 *   `Float32Array` po prostu się gubi, bez wyjątku), więc błąd objawiłby się jako źle
 *   pokolorowany fragment planety, nie jako awaria przy starcie.
 * @throws {RangeError} gdy `palette.length !== LIGHT_BANDS.length + 1` — szew między dwiema
 *   stałymi, które nic nie wiąże składniowo (patrz komentarz przy `LIGHT_BANDS`); Faza 4
 *   będzie zmieniać obie niezależnie.
 * @throws {RangeError} gdy `light.length` nie zgadza się z liczbą komórek w `geo`
 *   (`geo.cellVertexStart.length`). Nie ma tego w enumeracji testów briefu (Krok 1, punkty
 *   1-7 mówią tylko o `out` i `palette`) — dodane, bo to TA SAMA klasa zagrożenia na innym
 *   parametrze: `light[i]` poza zakresem dałoby cicho `undefined`, a `lightBand(undefined)`
 *   też cicho wraca `0` (żadne porównanie `undefined >= próg` nie jest prawdziwe) — czyli
 *   cicha, BŁĘDNA klasyfikacja "noc" zamiast rzuconego błędu. Pokryte testem #10 w
 *   `shading.test.ts`.
 */
export function writeCellColors(
  geo: PlanetGeometry,
  light: Float32Array,
  out: Float32Array,
  palette: Palette,
): void {
  if (out.length !== geo.positions.length) {
    throw new RangeError(
      `writeCellColors: out.length (${out.length}) must equal geo.positions.length (${geo.positions.length})`,
    );
  }
  if (palette.length !== LIGHT_BANDS.length + 1) {
    throw new RangeError(
      `writeCellColors: palette.length (${palette.length}) must equal LIGHT_BANDS.length + 1 (${LIGHT_BANDS.length + 1})`,
    );
  }
  const cellCount = geo.cellVertexStart.length;
  if (light.length !== cellCount) {
    throw new RangeError(
      `writeCellColors: light.length (${light.length}) must equal geo.cellVertexStart.length (${cellCount})`,
    );
  }

  for (let i = 0; i < cellCount; i++) {
    const color = palette[lightBand(light[i])];
    const start = geo.cellVertexStart[i];
    const end = start + geo.cellVertexCount[i];
    for (let v = start; v < end; v++) {
      const o = v * 3;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
    }
  }
}

/**
 * Tryb GŁADKI cieniowania: interpolacja liniowa między kolorem nocy a kolorem dnia wg
 * `saturate(dot(normal, sunDir))`, całkowicie POMIJAJĄC `LIGHT_BANDS`/`lightBand`. Nigdy
 * używana w normalnym renderze gry — `planetMesh.ts`/`scene.ts` wołają wyłącznie
 * `writeCellColors` powyżej. Napędza przełącznik porównawczy w harnessie bramki
 * (`readabilityGate.ts`, `setMode('smooth')`).
 *
 * ## TO NIE JEST KONTROLA POZYTYWNA BRAMKI — i było tak opisane błędnie
 *
 * Pierwotnie ta funkcja miała być kontrolą pozytywną: trybem, w którym granica dzień/noc
 * NAPRAWDĘ znika, żeby człowiek potwierdził, że instrument w ogóle potrafi wyprodukować
 * odpowiedź "nie widzę". NIE POTRAFI. Ustalone przez właściciela projektu na żywym renderze
 * i zmierzone (spec §7.3.1):
 *
 * **Ta funkcja zmienia MAPOWANIE palety, nie INTERPOLACJĘ.** Nadal maluje każdą komórkę
 * JEDNYM płaskim kolorem, bo `geometry.ts` daje każdej komórce własne wierzchołki. Tryb
 * awarii zmierzony w Fazie 0 był inny: tam kolor był interpolowany PO POWIERZCHNI, między
 * wierzchołkami WSPÓŁDZIELONYMI przez sąsiadów, i granica się ROZMAZYWAŁA. Tej awarii ta
 * architektura nie potrafi odtworzyć z konstrukcji — musiałaby mieć współdzielone
 * wierzchołki albo liczyć kolor per wierzchołek z pozycji, a nie per komórka.
 *
 * Zmierzone na prawdziwych parach terminatora (`shading.test.ts`, test 14): różnica barwna
 * w trybie gładkim wynosi 0,030–0,081 na kanał, jest NIEZEROWA i zawsze w tę samą stronę —
 * komórka oświetlona jest jaśniejsza. Przy wymuszonym wyborze dwóch alternatyw wystarczy
 * wskazać jaśniejszą, więc komplet trafień jest w tym trybie osiągalny.
 *
 * Co ta funkcja NAPRAWDĘ pokazuje, i co jest warte pokazania: **ile kontrastu dokłada
 * progowanie ponad to, co dowozi sama geometria.** Progowanie podbija odległość barwną
 * pary z ~0,07–0,12 do 0,90 (7,4–12,7×). Czytelność granicy dowozi GEOMETRIA z Zadania 2
 * (płaskie cieniowanie per komórka czyni granicę WIDZIALNĄ); progowanie z Zadania 3 czyni
 * ją WYGODNĄ. To dwie różne zasługi i dotąd przypisywaliśmy obie progowaniu.
 *
 * **Kontrola pozytywna mieszka teraz w `positiveControl.ts`** (Faza 2B, Zadanie 1, Krok 2) —
 * geometria ze WSPÓŁDZIELONYMI wierzchołkami plus kolor liczony per wierzchołek, czyli
 * rzeczywisty tryb awarii Fazy 0. Ta funkcja zostaje jako trzeci punkt odniesienia
 * ("gładka paleta, ale płaskie komórki"), bo dopiero zestawienie WSZYSTKICH TRZECH trybów
 * przypisuje zasługę właściwej warstwie: płaskie+progowane = czytelne, płaskie+gładkie =
 * granica słaba ale obecna, współdzielone+gładkie = granicy nie ma wcale.
 *
 * Interpoluje liniowo, PER KOMÓRKA, między `palette[0]` ("noc") i
 * `palette[palette.length - 1]` ("dzień") wg `light[i]` (0..1, już `saturate(dot)` z
 * `lightAt`/`lightField`).
 *
 * Te same trzy `RangeError` co `writeCellColors`, z tego samego powodu (te same bufory
 * własności wywołującego) — poza strażnikiem długości palety: ta funkcja nie zna
 * `LIGHT_BANDS.length + 1`, bo nie progowanie, tylko sama obecność dwóch końców gradientu,
 * jest tu wymogiem.
 */
export function writeCellColorsSmooth(
  geo: PlanetGeometry,
  light: Float32Array,
  out: Float32Array,
  palette: Palette = DEFAULT_PALETTE,
): void {
  if (out.length !== geo.positions.length) {
    throw new RangeError(
      `writeCellColorsSmooth: out.length (${out.length}) must equal geo.positions.length (${geo.positions.length})`,
    );
  }
  if (palette.length < 2) {
    throw new RangeError(`writeCellColorsSmooth: palette must have at least 2 entries, got ${palette.length}`);
  }
  const cellCount = geo.cellVertexStart.length;
  if (light.length !== cellCount) {
    throw new RangeError(
      `writeCellColorsSmooth: light.length (${light.length}) must equal geo.cellVertexStart.length (${cellCount})`,
    );
  }

  const night = palette[0];
  const day = palette[palette.length - 1];

  for (let i = 0; i < cellCount; i++) {
    const t = light[i];
    const r = night[0] + (day[0] - night[0]) * t;
    const g = night[1] + (day[1] - night[1]) * t;
    const b = night[2] + (day[2] - night[2]) * t;
    const start = geo.cellVertexStart[i];
    const end = start + geo.cellVertexCount[i];
    for (let v = start; v < end; v++) {
      const o = v * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
}
