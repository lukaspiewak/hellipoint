import { dot, type Vec3 } from '../math/vec3.js';
import type { Planet } from '../world/planet.js';

/**
 * Planeta jest statyczna, orbituje źródło światła (§4.3).
 * Matematycznie tożsame z obrotem planety, ale kamera nie gubi bazy,
 * a pozycje komórek są stałe w przestrzeni świata — co upraszcza serializację.
 */
export function sunDirection(elapsedSeconds: number, rotationPeriod: number): Vec3 {
  if (!Number.isFinite(rotationPeriod) || rotationPeriod <= 0) {
    throw new RangeError(`rotationPeriod must be positive and finite, got ${rotationPeriod}`);
  }
  // Odłożone wcześniej na fałszywej przesłance, że nieskończoność da "głośny NaN".
  // Nie daje: `angle` wychodzi NaN, ale `lightAt` robi `d > 0 ? d : 0`, a `NaN > 0`
  // jest `false` — więc KAŻDA komórka planety cicho ląduje na dokładnym 0.0, zero
  // wartości NaN nigdzie. Planeta trwale ciemna, bez śladu błędu: bajt w bajt ten sam
  // tryb awarii co `rotationPeriod = 0` powyżej, który kosztował tę fazę dwie rundy.
  if (!Number.isFinite(elapsedSeconds)) {
    throw new RangeError(`elapsedSeconds must be finite, got ${elapsedSeconds}`);
  }
  const angle = (2 * Math.PI * elapsedSeconds) / rotationPeriod;
  return { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
}

/** saturate(dot(normal, sunDir)) — ciągłe, nie binarne (§5.1). */
export function lightAt(normal: Vec3, sunDir: Vec3): number {
  const d = dot(normal, sunDir);
  return d > 0 ? d : 0;
}

/**
 * Oświetlenie wszystkich komórek naraz. Liczone raz na tick i przekazywane systemom.
 *
 * [Residualne ryzyko determinizmu — nie blokuje Fazy 1B, ale przeczytaj przed użyciem
 * tego pola do czegokolwiek międzymaszynowego.] `Math.cos`/`Math.sin` w `sunDirection`
 * są przybliżeniami zależnymi od implementacji silnika JS — ECMAScript nie gwarantuje
 * identycznego wyniku co do bitu na różnych silnikach/platformach. Zmierzone (przegląd
 * końcowy Fazy 1B): perturbacja `Math.cos` o jeden ULP float64 na 2000 próbkowanych
 * kątach — 0 z 2000 przetrwało zaokrąglenie do float32 właśnie tutaj, w zwracanym
 * `Float32Array`. Dziś nieszkodliwe, bo architektura ma JEDEN autorytatywny serwer,
 * nie lockstep z resymulacją klientów. Staje się realne w dwóch momentach: (1) gdy
 * headless runner Fazy 3 ma rościć sobie odtwarzalność między maszynami dla wyprowadzonych
 * liczb balansu, (2) gdy ktokolwiek doda golden hash SAMEGO stanu symulacji (nie tylko
 * planety, jak `golden-hash.test.ts`) — w obu przypadkach warto od razu sprawdzić, czy
 * tłumienie float32 nadal wystarcza, zamiast zakładać, że jest darmowe na zawsze.
 */
export function lightField(planet: Planet, sunDir: Vec3): Float32Array {
  const out = new Float32Array(planet.cells.length);
  for (let i = 0; i < planet.cells.length; i++) {
    out[i] = lightAt(planet.cells[i].normal, sunDir);
  }
  return out;
}
