import type { BuildingType } from '@heliopolis/sim';
import { NAZWA_ZNANEJ_LINII, SKILLED_OPENING, type Opening } from './skilledPolicy.js';

/**
 * # Warianty otwarcia — przyrząd kryterium H5 (Faza 3, Zadanie 3)
 *
 * ## Czego H5 naprawdę pyta
 *
 * „Ile RÓŻNYCH otwarć wygrywa ≥ 20 % seedów, próg ≥ 3". Uzasadnienie w planie brzmi:
 * §11.1 zmierzył, że **otwarcie dopuszcza dokładnie jedną linię**, i to jest dziś główna
 * wada gry. Kryterium ma więc pytać o RÓŻNORODNOŚĆ STRATEGII, nie o liczbę permutacji.
 *
 * Dlatego warianty poniżej różnią się **składem**, a nie kolejnością tych samych budynków:
 * inny typ wieży, inna kolejność faz (mur przed obroną), inne źródło pieniędzy, inna
 * odpowiedź na spawn. Pięć list, z których każda robi coś, czego pozostałe nie robią.
 * Dwadzieścia przetasowań jednej listy dałoby „dwadzieścia otwarć" i zero informacji.
 *
 * ## Warunek, bez którego wariant nic nie mierzy — ZAKLESZCZENIE
 *
 * Pierwsza wersja trzech z tych list **zakleszczała się** i pokazała to jedną liczbą:
 * `szczyt zabudowy p10 = p50 = p90`. Polityka stawia pozycje kolejki po kolei i **nie
 * przeskakuje** pozycji, na którą jej nie stać — więc otwarcie, które wcześnie żąda czegoś
 * drogiego, staje na zawsze, jeśli do tego czasu nie ma dochodu. Wariant kinetyczny prosił
 * o cztery wieże (pobór 12) zanim stanął pierwszy panel, a CORE daje 10: wieże gasły, nic
 * nie ginęło, nie było z czego kupić panelu. Zabudowa zatrzymywała się na siódmym budynku
 * na KAŻDEJ planecie.
 *
 * Zero zwycięstw z takiego przebiegu **nie jest wynikiem o grze** — jest wynikiem o szkicu.
 * Stąd dwie reguły, które znana linia spełnia i których trzymają się teraz wszystkie:
 * **pierwszy budynek musi zarabiać** (wieża, nie panel ani mur), a **pobór nie może
 * przekroczyć 10 przed pierwszym panelem**.
 *
 * ## Granica, którą trzeba znać
 *
 * To NIE jest przeszukiwanie przestrzeni otwarć — to pięć hipotez napisanych ręcznie.
 * Jeśli żadna poza znaną linią nie wygrywa, wniosek brzmi „te cztery pomysły nie działają",
 * a nie „nie istnieje drugie wygrywające otwarcie". Odwrotnie jednak wniosek jest mocny:
 * wystarczą trzy wygrywające, żeby H5 było spełnione, i wtedy pytanie jest zamknięte.
 */

const times = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value);

/** Znana linia z §11.1: dwa lasery, energia, mur z barykad. Punkt odniesienia. */
export const OTWARCIE_LASEROWE: Opening = SKILLED_OPENING;

/**
 * **Kinetyczne zamiast laserów.** Dwie kinetyczne kosztują tyle co jeden laser (2 × 50
 * wobec 100), dają 50 dps wobec 60 i pobierają 6 energii wobec 12 — czyli mniej obrażeń,
 * ale DWA RAZY tańsze w energii i rozstawione na dwóch komórkach. Hipoteza: oszczędność
 * energii pozwala odpuścić część baterii i wydać różnicę na mur.
 */
export const OTWARCIE_KINETYCZNE: Opening = [
  // TRZY kinetyczne: 150 rudy, czyli DOKŁADNIE ruda startowa, przy poborze 9 — tuż pod
  // wydajnością CORE (10). To najmocniejsza uczciwa wersja tej hipotezy: więcej nie da się
  // kupić bez dochodu, a mniej daje mniej ognia. Dwie wersje wcześniejsze zakleszczały się
  // (cztery wieże — brak prądu; dwie wieże — brak dochodu na cokolwiek dalej).
  ['hex1', 'KINETIC_TURRET'], ['hex1', 'KINETIC_TURRET'], ['hex1', 'KINETIC_TURRET'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex1', 'KINETIC_TURRET'],
  ['hex2', 'BATTERY'], ['hex2', 'BATTERY'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'BATTERY'],
  ...times(16, ['hex3', 'BARRICADE'] as const),
  ...times(20, ['hex4', 'BARRICADE'] as const),
  ['hex2', 'EVACUATION_MODULE'],
];

/**
 * **Mur najpierw.** Barykady (8 rudy) stawiane zanim stanie cokolwiek innego, wieże dopiero
 * po nich. Hipoteza: wczesny mur spowalnia falę na tyle, że słońce zdąży wypalić więcej,
 * zanim cokolwiek dojdzie do bazy — czyli kupuje czas obroną BIERNĄ, nie ogniem.
 */
export const OTWARCIE_MUR_NAJPIERW: Opening = [
  // Sześć barykad (48 rudy) i od razu laser (100) — razem 148 przy 150 startowych, więc
  // dochód rusza w pierwszej minucie. Pierwsza wersja stawiała dwanaście barykad przed
  // jakąkolwiek wieżą i zatrzymywała się na czternastym budynku na KAŻDEJ planecie.
  ...times(6, ['hex2', 'BARRICADE'] as const),
  ['hex1', 'LASER_TURRET'],
  ...times(10, ['hex2', 'BARRICADE'] as const),
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ...times(10, ['hex3', 'BARRICADE'] as const),
  ['hex2', 'BATTERY'], ['hex2', 'BATTERY'],
  ['hex1', 'KINETIC_TURRET'],
  ...times(14, ['hex4', 'BARRICADE'] as const),
  ['hex2', 'EVACUATION_MODULE'],
];

/**
 * **Ekonomia najpierw.** Ekstraktory na najbliższych złożach, zanim powstanie obrona.
 *
 * Ta hipoteza ma najmocniejsze uzasadnienie z pomiaru: znana linia nie wydobywa **ani jednej
 * jednostki rudy** (`p10=p50=p90=0` w każdym raporcie Zadania 3) i finansuje się wyłącznie
 * nagrodami za zabicie. Cała ekonomia wydobywcza jest dla niej martwa. Jeśli to otwarcie
 * wygrywa, gra ma drugą oś finansowania; jeśli nie — ekstraktory są w tej grze ozdobą
 * i trzeba to powiedzieć wprost.
 */
export const OTWARCIE_EKONOMICZNE: Opening = [
  ['hex1', 'KINETIC_TURRET'],
  ['ore', 'EXTRACTOR'], ['ore', 'EXTRACTOR'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['ore', 'EXTRACTOR'], ['ore', 'EXTRACTOR'],
  ['hex2', 'BATTERY'], ['hex1', 'LASER_TURRET'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'BATTERY'],
  ...times(14, ['hex3', 'BARRICADE'] as const),
  ...times(18, ['hex4', 'BARRICADE'] as const),
  ['hex2', 'EVACUATION_MODULE'],
];

/**
 * **Zatykanie pentagonów.** `GEOTHERMAL_CAP` (75 rudy) na najbliższych pentagonach.
 *
 * §5.3: cap nie kasuje spawnu, tylko go PRZEKIEROWUJE — strumień ciągły ustaje, a ciśnienie
 * wraca jako okresowa erupcja w tym samym miejscu, rosnąca z liczbą capów. Hipoteza jest
 * więc o wymianie: zamieniamy stały napływ na skoki, które łatwiej przeczekać za murem.
 * To jedyny wariant, który w ogóle dotyka ŹRÓDŁA fali, a nie jej skutków.
 */
export const OTWARCIE_CZAPY: Opening = [
  // Laser NAJPIERW, dokładnie jak w znanej linii — bez dochodu czapa (75) nigdy nie staje.
  // Pierwsza wersja prosiła o nią jako czwartą i zatrzymywała się na piątym budynku.
  ['hex1', 'LASER_TURRET'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['hex2', 'BATTERY'], ['hex2', 'BATTERY'],
  ['pent', 'GEOTHERMAL_CAP'],
  ['hex2', 'SOLAR_PANEL'], ['hex2', 'SOLAR_PANEL'],
  ['pent', 'GEOTHERMAL_CAP'],
  ['hex2', 'BATTERY'],
  ...times(13, ['hex3', 'BARRICADE'] as const),
  ...times(17, ['hex4', 'BARRICADE'] as const),
  ['hex2', 'EVACUATION_MODULE'],
];

/** Wszystkie warianty pod nazwami, w kolejności pomiaru. */
export const OTWARCIA: ReadonlyArray<readonly [string, Opening]> = [
  [NAZWA_ZNANEJ_LINII, OTWARCIE_LASEROWE],
  ['kinetyczne', OTWARCIE_KINETYCZNE],
  ['mur najpierw', OTWARCIE_MUR_NAJPIERW],
  ['ekonomiczne', OTWARCIE_EKONOMICZNE],
  ['czapy na pentagonach', OTWARCIE_CZAPY],
];

/** Typy budynków użyte w wariancie — do kontroli, że warianty naprawdę się RÓŻNIĄ. */
export const skladOtwarcia = (o: Opening): ReadonlySet<BuildingType> =>
  new Set(o.map(([, type]) => type));
