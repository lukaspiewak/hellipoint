import { dot, type Vec3 } from '../math/vec3.js';
import type { Planet } from '../world/planet.js';

/**
 * Planeta jest statyczna, orbituje źródło światła (§4.3).
 * Matematycznie tożsame z obrotem planety, ale kamera nie gubi bazy,
 * a pozycje komórek są stałe w przestrzeni świata — co upraszcza serializację.
 */
export function sunDirection(elapsedSeconds: number, rotationPeriod: number): Vec3 {
  if (!(rotationPeriod > 0)) {
    throw new RangeError(`rotationPeriod must be positive and finite, got ${rotationPeriod}`);
  }
  const angle = (2 * Math.PI * elapsedSeconds) / rotationPeriod;
  return { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
}

/** saturate(dot(normal, sunDir)) — ciągłe, nie binarne (§5.1). */
export function lightAt(normal: Vec3, sunDir: Vec3): number {
  const d = dot(normal, sunDir);
  return d > 0 ? d : 0;
}

/** Oświetlenie wszystkich komórek naraz. Liczone raz na tick i przekazywane systemom. */
export function lightField(planet: Planet, sunDir: Vec3): Float32Array {
  const out = new Float32Array(planet.cells.length);
  for (let i = 0; i < planet.cells.length; i++) {
    out[i] = lightAt(planet.cells[i].normal, sunDir);
  }
  return out;
}
