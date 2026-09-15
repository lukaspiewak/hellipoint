import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { buildAllFlowFields } from '../src/sim/flowfield.js';
import { spawnUnit, updateMovement, type MotionContext } from '../src/sim/movement.js';
import { SHADOW_RECOVERY_RATE, updateBurning } from '../src/sim/burning.js';
import { lightField, sunDirection } from '../src/sim/light.js';
import { cellSpacing, terminatorSpeedCells } from '../src/world/scale.js';
import { BUILDINGS, ENEMIES } from '../src/sim/defs.js';
import { dot, normalize } from '../src/math/vec3.js';

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

  it('nalicza rudę wyłącznie za jednostki, które SAMO zabiło — nie za już martwe z zewnątrz', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 10); // umrze OD SPALANIA w tym samym wywołaniu
    spawnUnit(s, 'ARMOR', 11); // "obcy trup": hp=0 z zewnątrz (np. walka), NIE od spalania
    s.units[0].exposure = ENEMIES.SWARM.burnTime; // += TICK_SECONDS w środku przebije próg
    s.units[1].hp = 0;
    // ARMOR w pełnym świetle też nabija ekspozycję w tym wywołaniu (0 → 0,05),
    // ale burnTime=8 jest o wiele rzędów wielkości dalej — jego WŁASNA gałąź
    // śmierci nie odpala się w ogóle, więc jedyne źródło jego hp<=0 jest
    // zewnętrzne, tak jak ma być w tym scenariuszu.
    const before = s.ore;

    updateBurning(s, fullLight);

    expect(s.units).toHaveLength(0); // obie usunięte — jedna umarła tu, druga była już martwa
    // TYLKO nagroda SWARM-a (2), NIGDY nagroda ARMOR-a (10) za trupa, którego
    // spalanie nie zabiło. Sprzed poprawki: before+12 (2+10, zamiatacz naliczał
    // za KAŻDĄ jednostkę z hp<=0, patrz task-3-fix-report.md, runda 2).
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

    // Samo "umarła w ogóle" (jedyna asercja tego testu w Rundzie 1) NIE dowodzi
    // PRZYCZYNY: zmierzone (Runda 2) — jednostka ZAMROŻONA (bez wołania w ogóle
    // updateMovement) ginie na ticku 160, realnie uciekająca na 165. `toHaveLength(0)`
    // przechodzi identycznie w obu przypadkach; nie odróżnia "zginęła, bo nie
    // mogła uciec" od "zginęła, bo nikt nawet nie próbował". Śledzimy więc
    // pozycję i wyrównanie ze słońcem, żeby to rozdzielić.
    const startPos = s.units[0].pos;
    let lastPos = startPos;
    let prevAlign = dot(normalize(startPos), sun0);
    let everRetreated = false;
    let deathTick = -1;

    const maxTicks = 250;
    for (let t = 0; t < maxTicks && s.units.length > 0; t++) {
      const sun = sunDirection(t * TICK_SECONDS, T);
      const light = lightField(planet, sun);
      updateMovement(s, fields, light, sun, ctx);
      updateBurning(s, light);

      if (s.units.length > 0) {
        lastPos = s.units[0].pos;
        // Malejące wyrównanie z BIEŻĄCYM słońcem = realnie oddala się od punktu
        // podsłonecznego. Punkt, który się NIE rusza, w tym miejscu planety i w
        // tym oknie czasu tylko coraz bardziej się oświetla wraz z obrotem
        // terminatora (zmierzone: zamrożona jednostka ma `align` rosnące, nigdy
        // malejące) — więc samo `align` w dowolną stronę nie dowodzi niczego,
        // TYLKO spadek dowodzi ruchu przeciw temu naturalnemu wzrostowi.
        const align = dot(normalize(lastPos), sun);
        if (align < prevAlign) everRetreated = true;
        prevAlign = align;
      } else {
        deathTick = t + 1;
      }
    }

    expect(s.units).toHaveLength(0);

    // (1) Treść niezmiennika N3 dla v < v_term, wyrażona liczbą, nie tylko
    // "umarła kiedyś w rozsądnym czasie": ucieczka kupuje ARMOR-owi PRAWIE NIC.
    // Zmierzone: zamrożona ginie dokładnie na ARMOR_BURN_TICKS (czysty budżet
    // spalania w miejscu, 160 = burnTime/TICK_SECONDS), realna z ucieczką na 165
    // — zysk to 5 ticków. Okno [ARMOR_BURN_TICKS, ARMOR_BURN_TICKS + 15] przypina
    // to z marginesem 3× zmierzonego zysku (nie z budżetu pętli 250, który
    // dopuszczał zysk do 90 ticków i przepuszczał 2×-wolniejsze spalanie —
    // Runda 1 tego zadania). Dolna granica jest fizycznym dołem: ekspozycja
    // rośnie najwyżej o TICK_SECONDS na tick, więc szybciej niż w miejscu umrzeć
    // się nie da, niezależnie od ruchu.
    //
    // ZAKRES WAŻNOŚCI OKNA, zmierzony przemiataniem [STROJENIE] speedFactor ARMOR-a:
    //   0,85 → 165   0,90 → 172   0,95 → 274   1,00 → 352   1,05 → przeżywa budżet
    // Margines 15 pokrywa 0,85 i 0,90. Przy 0,95 tick śmierci wyskakuje na 274 i ten
    // test oblewa — NIE z powodu regresji, tylko dlatego, że im bliżej v_term, tym
    // więcej ucieczka realnie kupuje, czyli zmienia się sama wielkość, którą mierzymy.
    // Jeśli Faza 3 przestroi ARMOR-a powyżej ~0,9, przelicz margines z nowego pomiaru
    // zamiast go poszerzać na oko: szerokie okno to dokładnie ten defekt, który Runda 1
    // tego zadania usuwała (budżet 250 dopuszczał zysk 90 ticków i przepuszczał
    // 2×-wolniejsze spalanie). Powyżej 1,0 jednostka przestaje ginąć i właściwym
    // testem staje się ten dla SWARM-a, nie ten.
    const ARMOR_BURN_TICKS = Math.ceil(ENEMIES.ARMOR.burnTime / TICK_SECONDS);
    expect(deathTick).toBeGreaterThanOrEqual(ARMOR_BURN_TICKS);
    expect(deathTick).toBeLessThanOrEqual(ARMOR_BURN_TICKS + 15);

    // (2) Naprawdę PRÓBOWAŁA uciekać, a nie zamarzła: pozycja zmieniła się
    // względem startu, i przez część runu realnie oddalała się od punktu
    // podsłonecznego (patrz komentarz przy `align` wyżej).
    expect(dot(normalize(lastPos), normalize(startPos))).toBeLessThan(1 - 1e-9);
    expect(everRetreated).toBe(true);
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
