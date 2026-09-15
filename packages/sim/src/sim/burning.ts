import { ENEMIES } from './defs.js';
import { TICK_SECONDS, type SimState } from './state.js';

/**
 * [STROJENIE] Tempo regeneracji ekspozycji w cieniu, jako ułamek tempa nabijania.
 * Poniżej 1,0 — inaczej krótkie wyskoki w światło byłyby całkowicie bezkosztowe
 * i mechanika przestałaby kształtować trasy.
 */
export const SHADOW_RECOVERY_RATE = 0.5;

/**
 * Tolerancja na błąd akumulacji zmiennoprzecinkowej `u.exposure += TICK_SECONDS`.
 * Nie jest to liczba balansowa: TICK_SECONDS (0,05) nie ma dokładnej reprezentacji
 * binarnej, więc suma po dokładnie `burnTime / TICK_SECONDS` krokach ląduje tuż
 * PONIŻEJ `burnTime`, nie w nim — zmierzone: dla SWARM (burnTime=3, 60 kroków)
 * suma wychodzi 2,9999999999999973 (o 2,66e-15 za mało), dla ARMOR (burnTime=8,
 * 160 kroków) 7,99999999999998 (o 2,04e-14 za mało). Bez tej tolerancji `>=`
 * przegapia dokładną granicę o jeden tick za każdym razem. 1e-9 to ten sam rząd
 * co istniejąca tolerancja `theta < 1e-9` w slerpToward (movement.ts) — o wiele
 * rzędów wielkości większy niż zmierzony błąd (~1e-14/1e-15), więc pochłania go
 * z zapasem, a jednocześnie o wiele rzędów mniejszy niż jeden tick (0,05 s),
 * więc nie może przyspieszyć śmierci o cały krok.
 */
const EXPOSURE_EPSILON = 1e-9;

/**
 * Ekspozycja na światło i śmierć od słońca (§4.4).
 * Sam RUCH ucieczki realizuje updateMovement — tutaj wyłącznie akumulacja i skutek.
 */
export function updateBurning(s: SimState, light: Float32Array): void {
  let anyDead = false;

  for (const u of s.units) {
    if (light[u.cellId] > 0) {
      u.exposure += TICK_SECONDS;
      if (u.exposure >= ENEMIES[u.type].burnTime - EXPOSURE_EPSILON) {
        u.hp = 0;
        anyDead = true;
      }
    } else if (u.exposure > 0) {
      u.exposure = Math.max(0, u.exposure - TICK_SECONDS * SHADOW_RECOVERY_RATE);
    }
  }

  if (!anyDead) return;

  const survivors = [];
  for (const u of s.units) {
    if (u.hp > 0) survivors.push(u);
    else s.ore += ENEMIES[u.type].oreReward; // spalone niedobitki zostawiają rudę
  }
  s.units = survivors;
}
