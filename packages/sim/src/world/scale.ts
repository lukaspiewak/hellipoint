/**
 * Wyprowadzenia skali z §4.3 i §4.4 specu. JEDYNE źródło prawdy dla tych wzorów —
 * nic w symulacji nie powinno liczyć ich samodzielnie.
 */

/** Pole regularnego sześciokąta o odstępie środków d wynosi (√3/2)·d². */
const HEX_AREA_FACTOR = Math.sqrt(3) / 2;

/** Bezwymiarowy stosunek odstępu komórek do promienia planety: d = R · k(N). */
const spacingRatio = (cellCount: number): number =>
  Math.sqrt((4 * Math.PI) / (HEX_AREA_FACTOR * cellCount));

/** Odległość środek–środek sąsiednich komórek, w jednostkach świata. */
export const cellSpacing = (radius: number, cellCount: number): number =>
  radius * spacingRatio(cellCount);

/** Prędkość terminatora po powierzchni, w jednostkach świata na sekundę. */
export const terminatorSpeedWorld = (radius: number, rotationPeriod: number): number =>
  (2 * Math.PI * radius) / rotationPeriod;

/**
 * Prędkość terminatora w krokach grafu na sekundę.
 * Promień skraca się — to jest formalny dowód niezmiennika N2.
 */
export const terminatorSpeedCells = (cellCount: number, rotationPeriod: number): number =>
  (2 * Math.PI) / (rotationPeriod * spacingRatio(cellCount));

/** Czas, w jakim terminator przechodzi przez bazę szeroką na baseWidthCells kroków. */
export const terminatorCrossingTime = (
  baseWidthCells: number,
  rotationPeriod: number,
  cellCount: number,
): number => (baseWidthCells * rotationPeriod * spacingRatio(cellCount)) / (2 * Math.PI);

/**
 * Niezmiennik N3: maksymalna głębokość wewnątrz oświetlonego obszaru,
 * z której jednostka zdąży uciec do cienia, w krokach grafu.
 * Wynik ≤ 0 oznacza, że jednostka NIGDY nie ucieka ze światła.
 */
export const burnEscapeDepth = (
  burnTime: number,
  speedCells: number,
  termSpeedCells: number,
): number => burnTime * (speedCells - termSpeedCells);
