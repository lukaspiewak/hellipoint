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
 * suma wychodzi 2,9999999999999973 (o 2,6645352591003757e-15 za mało), dla ARMOR
 * (burnTime=8, 160 kroków, NAJWIĘKSZY burnTime w ENEMIES) 7,99999999999998
 * (o 2,042810365310288e-14 za mało). Bez tej tolerancji `>=` przegapia dokładną
 * granicę o jeden tick za każdym razem. 1e-9 to ten sam rząd co istniejąca
 * tolerancja `theta < 1e-9` w slerpToward (movement.ts). Margines nad zmierzonym
 * błędem (zmierzone, najgorszy przypadek — ARMOR, największy `burnTime`, czyli
 * najwięcej kroków akumulacji i największy błąd): **~4,895×10⁴×**
 * (1e-9 / 2,042810365310288e-14), nie 1e5–1e6×, jak błędnie podawał wcześniejszy
 * komentarz w tym miejscu. Nadal o wiele rzędów wielkości mniejszy niż jeden
 * tick (0,05 s), więc nie może przyspieszyć śmierci o cały krok.
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
        // Ruda naliczana TUTAJ, w miejscu śmierci, nie w zamiataczu niżej: ten
        // system ma naliczać WYŁĄCZNIE za zgony, które sam spowodował. Zamiatacz
        // operujący na `hp <= 0` naliczałby też za jednostki już martwe z innego
        // źródła (np. walki) w tym samym ticku — nieszkodliwe dziś tylko dzięki
        // kolejności systemów (walka biegnie przed spalaniem i zabiera swoich
        // zabitych PRZED wywołaniem updateBurning), założeniu nigdzie w tym pliku
        // nie zapisanemu ani nie sprawdzonemu. Patrz task-3-fix-report.md, runda 2.
        s.ore += ENEMIES[u.type].oreReward;
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
  }
  s.units = survivors;
}
