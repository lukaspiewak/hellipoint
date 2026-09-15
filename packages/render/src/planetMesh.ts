import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from 'three';
import type { PlanetGeometry } from './geometry.js';
import { DEFAULT_PALETTE, writeCellColors, type Palette } from './shading.js';

/**
 * `THREE.Mesh` całej planety, budowany RAZ z geometrii Zadania 2, plus sposób na
 * odświeżenie kolorów (Zadanie 3) co klatkę bez alokacji.
 */
export interface PlanetMesh {
  // Generyki podane WPROST (nie domyślne `Mesh`): domyślny `TMaterial` w typach Three.js
  // to `Material | Material[]` (mesh może mieć wiele materiałów per grupa geometrii) — bez
  // zawężenia `mesh.material` byłoby tą szeroką unią dla KAŻDEGO konsumenta tego interfejsu,
  // zmuszając do rzutowania nawet tam, gdzie wiadomo, że to zawsze jeden `MeshBasicMaterial`
  // (dokładnie to, co ten moduł konstruuje, patrz `createPlanetMesh` niżej).
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  /**
   * Przelicza kolory wszystkich komórek wg `light` (np. z `lightField`) i pisze je do
   * WŁASNEGO, raz zaalokowanego bufora — patrz komentarz przy `colors` niżej. Bezpieczne
   * do wołania co klatkę (do 60×/s): jedyna praca to jedno przejście `writeCellColors`
   * (już zmierzone w Zadaniu 3 jako tania funkcja czysta) plus podniesienie `needsUpdate`.
   */
  updateColors(light: Float32Array, palette?: Palette): void;
  /** Zwalnia geometrię i materiał Three.js. */
  dispose(): void;
}

/**
 * Zamienia `PlanetGeometry` (Zadanie 2 — pozycje/normalne/indeksy, WŁASNE wierzchołki na
 * komórkę) w renderowalny `THREE.Mesh`. Materiał to `MeshBasicMaterial` z
 * `vertexColors: true` — CELOWO, nie `MeshStandardMaterial` ani cokolwiek z modelem
 * oświetlenia silnika: kolory z `writeCellColors` (Zadanie 3) JUŻ niosą wynik progowania
 * światła symulacji (`lightField`/`sunDirection`, filar D1 — terminator jako GRANICA, nie
 * gradient, zmierzone w bramce Fazy 0). Gdyby renderer dołożył WŁASNE cieniowanie na
 * wierzch tych kolorów (np. `MeshStandardMaterial` reagujący na `THREE.Light` w scenie),
 * rozmyłoby to ostre progi z powrotem w gładki gradient — dokładnie ten, który bramka
 * Fazy 0 zmierzyła jako NIECZYTELNY. To jest, wg briefu Zadania 4, najłatwiejszy sposób
 * na ciche zepsucie Fazy 2A: żaden test typów/testów jednostkowych by tego formalnie nie
 * wymagał, gdyby nie ten właśnie wybór materiału — stąd `planetMesh.test.ts` sprawdza go
 * wprost (`toBeInstanceOf(MeshBasicMaterial)`, `not.toBeInstanceOf(MeshStandardMaterial)`).
 *
 * Bufor kolorów (`colors`) jest WŁASNOŚCIĄ tego modułu: zaalokowany RAZ, o długości
 * `geo.positions.length` (jak wymaga `writeCellColors`), i podpięty jako atrybut `color`
 * geometrii. `updateColors` PISZE w niego wielokrotnie, nigdy nie tworzy nowego —
 * `writeCellColors` sama nie alokuje nic (Zadanie 3), a alokacja per klatka rzuciłaby
 * ~30 tys. floatów pod nogi odśmiecacza sześćdziesiąt razy na sekundę, dokładnie w pętli
 * renderu (budżet klatki 8 ms, `global-constraints.md`).
 */
export function createPlanetMesh(geo: PlanetGeometry): PlanetMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(geo.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(geo.normals, 3));
  geometry.setIndex(new BufferAttribute(geo.indices, 1));

  const colors = new Float32Array(geo.positions.length);
  const colorAttribute = new BufferAttribute(colors, 3);
  geometry.setAttribute('color', colorAttribute);

  const material = new MeshBasicMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);

  return {
    mesh,
    updateColors(light: Float32Array, palette: Palette = DEFAULT_PALETTE): void {
      writeCellColors(geo, light, colors, palette);
      colorAttribute.needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
