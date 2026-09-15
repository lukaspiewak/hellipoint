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
 * TO JEST ZADANIE, W KTÓRYM ROZSTRZYGA SIĘ D1 (spec §4.1; bramka Fazy 0,
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
 * komórek plus wąski rąbek świtu poniżej pierwszego progu (pomiar w komentarzu przy
 * `DEFAULT_PALETTE`). Stąd pierwszy próg (0.05) jest NISKI — im niższy, tym bliżej granica
 * pasma 0/1 leży prawdziwej granicy geometrycznej `dot == 0`. Drugi próg (0.4) dzieli
 * pozostałą (dzienną) połowę na wąski pas "świtu/zmierzchu" tuż za terminatorem i szerszy
 * "dzień" — to już czysta estetyka: spec (§8.1, uwaga pod tabelą) mówi wprost, że trzy
 * pasma to najtańszy sposób ze spike'a, nie rekomendacja, i że Faza 4 może próbować innych
 * dróg (stroma `smoothstep`, wyraźne obrzeże, różnica temperatury barwy). Liczba i
 * położenie progów tutaj to jeden z wielu poprawnych wyborów, nie JEDYNY poprawny wybór.
 */
export const LIGHT_BANDS: readonly number[] = [0.05, 0.4]; // [WYGLĄD]

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
 * Zmierzone (Krok 5 briefu) przy `createPlanet({ seed: 20260915 })` (frequency 12
 * domyślne, 1442 komórki) i `sunDirection(0, 180)`:
 *
 *   pasmo 0 (noc):           753 komórek (52,2%)
 *   pasmo 1 (zmierzch/świt): 256 komórek (17,8%)
 *   pasmo 2 (dzień):         433 komórki  (30,0%)
 *
 * Pasmo 0 przekracza połowę — to FIZYKA `saturate` (cała noc to jedna wartość `0.0`, patrz
 * komentarz przy `LIGHT_BANDS`), NIE złe strojenie progów: żaden wybór progu > 0 może tego
 * uniknąć, bo noc i tak zawsze zajmuje dokładną połowę sfery. Co BYŁOBY złym strojeniem:
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
  [0.03, 0.05, 0.12], // noc — ciemny, chłodny granat (nie czysta czerń, żeby nie zlewał się z tłem canvasu, patrz CLEAR_COLOR w index.ts)
  [0.85, 0.42, 0.16], // terminator — ciepły pomarańcz świtu/zmierzchu, punkt zaczepienia dla oka
  [0.98, 0.92, 0.74], // dzień — ciepła biel/żółć
]; // [WYGLĄD]

/**
 * Indeks pasma dla danej wartości `light` (0..1, jak zwraca `lightAt`/`lightField`): liczba
 * progów `LIGHT_BANDS`, które `light` przekroczyło lub im dorównało. Funkcja SCHODKOWA,
 * celowo — patrz uzasadnienie przy `LIGHT_BANDS`. Zakres wyniku: `0` (poniżej pierwszego
 * progu) do `LIGHT_BANDS.length` (od ostatniego progu wzwyż, włącznie).
 *
 * Próg wliczany jest do pasma WYŻSZEGO (`light >= próg` ⇒ pasmo już podniesione) —
 * `lightBand(LIGHT_BANDS[i])` (dokładnie na progu) i `lightBand(LIGHT_BANDS[i] - ε)` (tuż
 * przed nim) różnią się więc o dokładnie jeden indeks, dla dowolnie małego dodatniego `ε`.
 * To jest cały sens tej funkcji — dowód nieciągłości, nie ozdobnik — i dokładnie to
 * sprawdza test #1 w `shading.test.ts`.
 */
export function lightBand(light: number): number {
  let band = 0;
  for (let i = 0; i < LIGHT_BANDS.length; i++) {
    if (light >= LIGHT_BANDS[i]) band++;
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
