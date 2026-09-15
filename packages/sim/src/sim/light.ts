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
  // Oba argumenty mogą być finite i (dla rotationPeriod) dodatnie, a `angle` i tak wyjść
  // nieskończony — np. rotationPeriod = 1e-320 (finite, > 0) przechodzi obie straże
  // powyżej, ale dzielenie przepełnia się do Infinity. Straż NALEŻY tu, w miejscu gdzie
  // wartość faktycznie staje się zła, nie tylko na wejściach: `Math.cos`/`Math.sin`
  // Infinity dają NaN, a `lightAt` (`d > 0 ? d : 0`) ciągnie NaN do cichego 0.0 — patrz
  // komentarz przy `lightField` i raport naprawy residuali Fazy 1B.
  if (!Number.isFinite(angle)) {
    throw new RangeError(
      `sunDirection: (2π·elapsedSeconds)/rotationPeriod overflowed to a non-finite angle — elapsedSeconds=${elapsedSeconds}, rotationPeriod=${rotationPeriod}`,
    );
  }
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
 * identycznego wyniku co do bitu na różnych silnikach/platformach. Zmierzone (naprawa
 * residuali Fazy 1B; przegląd zgłosił, że poprzednia liczba jest błędna, bo liczyła jeden
 * kierunek perturbacji — powtórny pomiar tego NIE potwierdził: oba kierunki dają tyle samo,
 * a prawdziwą wadą starej liczby był rozmiar próbki, nie kierunek):
 * perturbacja `Math.cos` o jeden ULP float64 w OBU kierunkach
 * (bit w górę i w dół), ze sprawdzeniem przetrwania `Math.fround` — dokładnie tego
 * zaokrąglenia do float32, które robi `Float32Array` poniżej. Przy ~2000 próbkowanych
 * kątach na zestaw (kąty realne wg wzoru symulacji i kąty szeroko-jednostajne w
 * [-1e6, 1e6)) — 0 z 2000 przetrwało w KAŻDYM kierunku z osobna, co potwierdza starą
 * liczbę i rozszerza ją na oba kierunki. Przy 1 000 000 000 próbek na
 * zestaw liczba przestaje być zerem: 1–2 przetrwania na miliard, rząd wielkości zgodny
 * z teoretycznym stosunkiem ULP(float64)/ULP(float32) ≈ 2⁻²⁹ (~1 na 500 milionów).
 * Wniosek: tłumienie float32 drastycznie redukuje ryzyko, ale go NIE zeruje — „0 z 2000"
 * nigdy nie było dowodem niemożliwości, tylko próbką za małą, żeby złapać zdarzenie o
 * częstości rzędu 10⁻⁹. Dziś nieszkodliwe, bo architektura ma JEDEN autorytatywny serwer,
 * nie lockstep z resymulacją klientów. Staje się realne w dwóch momentach: (1) gdy
 * headless runner Fazy 3 ma rościć sobie odtwarzalność między maszynami dla wyprowadzonych
 * liczb balansu, (2) gdy ktokolwiek doda golden hash SAMEGO stanu symulacji (nie tylko
 * planety, jak `golden-hash.test.ts`) — w obu przypadkach warto od razu sprawdzić, czy
 * tłumienie float32 nadal wystarcza, zamiast zakładać, że jest darmowe na zawsze.
 */
export function lightField(planet: Planet, sunDir: Vec3): Float32Array {
  const out = new Float32Array(planet.cells.length);
  lightFieldInto(planet, sunDir, out);
  return out;
}

/**
 * Jak `lightField`, ale pisze do BUFORA WŁASNOŚCI WYWOŁUJĄCEGO — bez alokacji. Ten sam
 * wzorzec co `updatePower` w `power.ts` i `writeCellColors` w `@heliopolis/render`:
 * bufor zaalokowany RAZ, wypełniany wielokrotnie.
 *
 * Powód istnienia: pętla renderu (`apps/client/src/main.ts`) potrzebuje oświetlenia w
 * KAŻDEJ klatce. `lightField` alokuje tam `Float32Array(1442)` = 5768 B na klatkę, czyli
 * ok. 346 kB/s przy 60 Hz — wewnątrz tej samej pętli, której czas raportuje licznik
 * klatek. Zmierzone (`light.test.ts`): 2000 wywołań `lightField` daje cykle odśmiecania,
 * 2000 wywołań `lightFieldInto` — dokładnie zero.
 *
 * `lightField` deleguje TUTAJ, a nie odwrotnie: dwie niezależne pętle mogłyby się z czasem
 * rozjechać i dać RÓŻNE liczby dla tego samego wejścia — a to jest pole, po którym
 * symulacja decyduje o spawnie, paleniu i produkcji energii.
 *
 * @throws {RangeError} gdy `out.length !== planet.cells.length`. Bez tej straży krótszy
 *   bufor zostawiłby część komórek w świetle z POPRZEDNIEJ klatki (zapis poza koniec
 *   `Float32Array` gubi się po cichu, bez wyjątku) — awaria widoczna jako komórka
 *   zamrożona w dawnym świetle, nie jako błąd przy starcie.
 */
export function lightFieldInto(planet: Planet, sunDir: Vec3, out: Float32Array): void {
  const cellCount = planet.cells.length;
  if (out.length !== cellCount) {
    throw new RangeError(
      `lightFieldInto: out.length (${out.length}) must equal planet.cells.length (${cellCount})`,
    );
  }
  for (let i = 0; i < cellCount; i++) {
    out[i] = lightAt(planet.cells[i].normal, sunDir);
  }
}
