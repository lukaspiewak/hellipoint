import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { buildAllFlowFields } from '../src/sim/flowfield.js';
import { spawnUnit, updateMovement, type MotionContext } from '../src/sim/movement.js';
import { SHADOW_RECOVERY_RATE, updateBurning } from '../src/sim/burning.js';
import { lightField, sunDirection } from '../src/sim/light.js';
import { cellSpacing, terminatorSpeedCells } from '../src/world/scale.js';
import { BUILDINGS, ENEMIES } from '../src/sim/defs.js';
import { dot } from '../src/math/vec3.js';

const planet = createPlanet({ seed: 71 });
const N = planet.cells.length;
const T = 180;

const ctx: MotionContext = {
  termSpeedCells: terminatorSpeedCells(N, T),
  spacing: cellSpacing(planet.radius, N),
  radius: planet.radius,
};

const fullLight = new Float32Array(N).fill(1);
const noLight = new Float32Array(N).fill(0);

function withCore() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

describe('updateBurning', () => {
  it('ekspozycja rośnie w świetle', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    updateBurning(s, fullLight);
    expect(s.units[0].exposure).toBeCloseTo(TICK_SECONDS, 9);
  });

  it('w cieniu ekspozycja nie rośnie i jednostka nie ginie nigdy', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    for (let i = 0; i < 10_000; i++) updateBurning(s, noLight);
    expect(s.units).toHaveLength(1);
    expect(s.units[0].exposure).toBe(0);
  });

  it('jednostka w pełnym świetle ginie po dokładnie burnTime sekund', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    const ticks = Math.ceil(ENEMIES.SWARM.burnTime / TICK_SECONDS);

    for (let i = 0; i < ticks - 1; i++) updateBurning(s, fullLight);
    expect(s.units).toHaveLength(1);

    updateBurning(s, fullLight);
    expect(s.units).toHaveLength(0);
  });

  it('spalona jednostka zostawia rudę (§3 specu — świt to żniwa)', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    const before = s.ore;
    for (let i = 0; i < 1000 && s.units.length > 0; i++) updateBurning(s, fullLight);
    expect(s.ore).toBeCloseTo(before + ENEMIES.SWARM.oreReward, 6);
  });

  it('powrót do cienia regeneruje ekspozycję', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    for (let i = 0; i < 20; i++) updateBurning(s, fullLight);
    const peak = s.units[0].exposure;

    for (let i = 0; i < 10; i++) updateBurning(s, noLight);
    // Math.max(0, …) po obu stronach: kod klamruje w miejscu, więc oczekiwanie
    // musi klamrować tak samo, inaczej test pęka przy legalnym przestrojeniu
    // SHADOW_RECOVERY_RATE [STROJENIE] (Faza 3), nie przy regresji w kodzie —
    // zmierzone: przy rate ≥ 2,0 (4× dzisiejszej wartości) `peak - 10*TICK*rate`
    // sam wychodzi ujemny, mimo że kod poprawnie stoi na zerze.
    expect(s.units[0].exposure).toBeCloseTo(
      Math.max(0, peak - 10 * TICK_SECONDS * SHADOW_RECOVERY_RATE),
      6,
    );
  });

  it('regeneracja nie schodzi poniżej zera', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10);
    // Ekspozycja startowa MNIEJSZA niż jeden krok regeneracji
    // (TICK_SECONDS * SHADOW_RECOVERY_RATE) — połowa jednego kroku, liczona ZE
    // STAŁEJ, nie z literału (SHADOW_RECOVERY_RATE jest [STROJENIE], test ma
    // zostać poprawny przy każdej dodatniej wartości). Bez tego jeden tick
    // regeneracji nigdy nie przestrzeliwuje zera z tego konkretnego stanu:
    // `spawnUnit` daje exposure=0, a `else if (u.exposure > 0)` w ogóle nie
    // wchodzi w gałąź regeneracji przy zerze — `Math.max(0, …)`, jedyna rzecz,
    // którą ten test nazywa, nigdy nie była osiągana (zmierzone mutacją:
    // usunięcie samego Math.max przy tym samym starcie od zera zostawiało
    // całą suitę zieloną).
    s.units[0].exposure = (TICK_SECONDS * SHADOW_RECOVERY_RATE) / 2;
    updateBurning(s, noLight);
    expect(s.units[0].exposure).toBe(0);
  });

  it('ARMOR (speedFactor < 1) postawiony w świetle GINIE — niezmiennik N3 na żywo', () => {
    // Pełna pętla: ruch (z ucieczką) + spalanie, przy prawdziwym, ruchomym terminatorze.
    const s = withCore();

    // Jednostka tuż za linią terminatora, czyli najpłycej jak się da.
    const sun0 = sunDirection(0, T);
    let shallow = -1;
    let bestDot = Infinity;
    for (let i = 0; i < N; i++) {
      const d = dot(planet.cells[i].normal, sun0);
      if (d > 0 && d < bestDot) { bestDot = d; shallow = i; }
    }
    spawnUnit(s, 'ARMOR', shallow);
    const fields = buildAllFlowFields(s);

    // Zmierzone (raport Task 3): ARMOR ginie dokładnie na ticku 165 — tylko 5 ticków
    // (0,25 s) później niż czysty budżet spalania w miejscu (160 ticków = burnTime/TICK_SECONDS),
    // czyli ucieczka realnie kupuje jej prawie nic, zgodnie z niezmiennikiem N3.
    // Budżet burnTime×4/TICK_SECONDS z brief-u (640) ma ~3,9× zapasu ponad tę potrzebę —
    // zmierzone, że regresja spowalniająca akumulację ekspozycji o połowę (bug: `* 0.5`
    // przy `u.exposure += TICK_SECONDS`) przesuwa śmierć na tick 376, WCIĄŻ w budżecie 640,
    // czyli oryginalny budżet nie łapie 2×-wolniejszego spalania. 250 (~1,5× zmierzonej
    // potrzeby, wciąż z zapasem na przyszłe retuningi [STROJENIE] ARMOR-a w Fazie 3) łapie
    // każdą regresję wolniejszą niż ~1,5× — w tym powyższą.
    const maxTicks = 250;
    for (let t = 0; t < maxTicks && s.units.length > 0; t++) {
      const sun = sunDirection(t * TICK_SECONDS, T);
      const light = lightField(planet, sun);
      updateMovement(s, fields, light, sun, ctx);
      updateBurning(s, light);
    }

    expect(s.units).toHaveLength(0);
  });

  it('SWARM (speedFactor > 1) z tej samej pozycji UCIEKA', () => {
    const s = withCore();
    const sun0 = sunDirection(0, T);
    let shallow = -1;
    let bestDot = Infinity;
    for (let i = 0; i < N; i++) {
      const d = dot(planet.cells[i].normal, sun0);
      if (d > 0 && d < bestDot) { bestDot = d; shallow = i; }
    }
    spawnUnit(s, 'SWARM', shallow);
    const fields = buildAllFlowFields(s);

    const maxTicks = Math.ceil((ENEMIES.SWARM.burnTime * 4) / TICK_SECONDS);
    for (let t = 0; t < maxTicks && s.units.length > 0; t++) {
      const sun = sunDirection(t * TICK_SECONDS, T);
      const light = lightField(planet, sun);
      updateMovement(s, fields, light, sun, ctx);
      updateBurning(s, light);
    }

    expect(s.units).toHaveLength(1);
  });
});
