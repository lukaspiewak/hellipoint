import { describe, expect, it } from 'vitest';
import { createPlanet } from '../src/world/planet.js';
import { createState, TICK_SECONDS } from '../src/sim/state.js';
import { applyCommand } from '../src/sim/commands.js';
import { buildAllFlowFields } from '../src/sim/flowfield.js';
import { spawnUnit, updateMovement, type MotionContext } from '../src/sim/movement.js';
import { cellSpacing, terminatorSpeedCells } from '../src/world/scale.js';
import { BUILDINGS, ENEMIES } from '../src/sim/defs.js';
import { length, scale, sub, normalize, dot } from '../src/math/vec3.js';
import { multiSourceDistances } from '../src/world/graph.js';

const planet = createPlanet({ seed: 51 });
const N = planet.cells.length;
const T = 180;

const ctx: MotionContext = {
  termSpeedCells: terminatorSpeedCells(N, T),
  spacing: cellSpacing(planet.radius, N),
  radius: planet.radius,
};

const dark = new Float32Array(N).fill(0);
const sunDir = { x: 1, y: 0, z: 0 };

function withCore() {
  const s = createState(planet, 100000);
  s.buildings[planet.startCell] = {
    cellId: planet.startCell, type: 'CORE', hp: BUILDINGS.CORE.hp, powered: false,
  };
  return s;
}

/** Komórka oddalona o dokładnie `steps` kroków od komórki startowej. */
function atSteps(steps: number): number {
  const d = multiSourceDistances(planet.cells.map((c) => c.neighbors), [planet.startCell]);
  const hit = d.findIndex((v) => v === steps);
  if (hit < 0) throw new Error(`brak komórki w odległości ${steps}`);
  return hit;
}

describe('spawnUnit', () => {
  it('stawia jednostkę na środku komórki z pełnym HP i zerową ekspozycją', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 42);
    expect(s.units).toHaveLength(1);
    expect(s.units[0]).toMatchObject({ type: 'SWARM', cellId: 42, hp: ENEMIES.SWARM.hp, exposure: 0 });
    expect(s.units[0].pos).toEqual(planet.cells[42].center);
  });

  /**
   * PRZEGLĄD GAŁĘZI, Important #5. `u.pos` było IDENTYCZNE CO DO REFERENCJI
   * z `planet.cells[id].center` (zmierzone), a `Planet` nie jest zamrożona
   * (`Object.isFrozen(planet) === false`, też zmierzone). Dziś nic nie pisze po `pos`
   * w miejscu, więc defekt był uśpiony — ale jeden zapis `u.pos.x = …` w dowolnej
   * przyszłej fazie przestawiłby środek komórki dla wszystkich późniejszych odczytów
   * planety. Test sprawdza OBIE rzeczy: brak wspólnej referencji i to, że zapis przez
   * jednostkę faktycznie nie przecieka do planety.
   */
  it('daje WŁASNY wektor pozycji, nie referencję do środka komórki planety', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 42);

    expect(s.units[0].pos).toEqual(planet.cells[42].center);
    expect(s.units[0].pos).not.toBe(planet.cells[42].center);
  });

  it('zapis w miejscu przez u.pos nie zmienia środka komórki planety', () => {
    // WŁASNA planeta, nie współdzielona z resztą pliku: ten test CELOWO pisze po `pos`
    // w miejscu, więc gdyby kopia zniknęła, uszkodziłby planetę wszystkim testom niżej
    // i dał kaskadę fałszywych czerwonych zamiast jednej czytelnej porażki.
    const local = createPlanet({ seed: 77, frequency: 8 });
    const s = createState(local, 0);
    spawnUnit(s, 'SWARM', 10);

    const przed = local.cells[10].center.x;
    (s.units[0].pos as { x: number }).x = przed + 1;
    expect(local.cells[10].center.x).toBe(przed);
  });

  it('nadaje kolejne, rosnące identyfikatory', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', 42);
    spawnUnit(s, 'ARMOR', 43);
    expect(s.units.map((u) => u.id)).toEqual([1, 2]);
  });
});

describe('updateMovement', () => {
  it('utrzymuje jednostki dokładnie na powierzchni planety', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', atSteps(6));
    const fields = buildAllFlowFields(s);
    for (let i = 0; i < 200; i++) updateMovement(s, fields, dark, sunDir, ctx);
    expect(length(s.units[0].pos)).toBeCloseTo(planet.radius, 6);
  });

  it('cellId zmienia się wyłącznie na komórkę sąsiednią', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', atSteps(8));
    const fields = buildAllFlowFields(s);
    let prev = s.units[0].cellId;
    for (let i = 0; i < 400 && s.units.length > 0; i++) {
      updateMovement(s, fields, dark, sunDir, ctx);
      const cur = s.units[0].cellId;
      if (cur !== prev) {
        expect(planet.cells[prev].neighbors).toContain(cur);
        prev = cur;
      }
    }
  });

  it('jednostka dociera do celu w skończonym czasie', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', atSteps(8));
    const fields = buildAllFlowFields(s);
    let reached = false;
    for (let i = 0; i < 3000 && !reached; i++) {
      updateMovement(s, fields, dark, sunDir, ctx);
      const next = fields.SWARM.next[s.units[0].cellId];
      if (next === planet.startCell || s.units[0].cellId === planet.startCell) reached = true;
    }
    expect(reached).toBe(true);
  });

  it('prędkość wynika ze speedFactor razy prędkość terminatora (§6.2)', () => {
    const s = withCore();
    const from = atSteps(8);
    spawnUnit(s, 'ARMOR', from);
    const fields = buildAllFlowFields(s);

    const start = s.units[0].pos;
    const ticks = 100;
    for (let i = 0; i < ticks; i++) updateMovement(s, fields, dark, sunDir, ctx);

    const travelled = arcLength(start, s.units[0].pos, planet.radius);
    const expected = ENEMIES.ARMOR.speedFactor * ctx.termSpeedCells * ctx.spacing * ticks * TICK_SECONDS;
    expect(travelled).toBeCloseTo(expected, 1);
  });

  it('zatrzymuje się przed zabudowaną komórką zamiast przez nią przechodzić', () => {
    const s = withCore();
    const ring = planet.cells[planet.startCell].neighbors;
    for (const n of ring) applyCommand(s, { kind: 'BUILD', cellId: n, type: 'BARRICADE' });

    // ARMOR, nie SWARM: SWARM ma targetPriority NEAREST_BUILDING, więc sam
    // pierścień barykad staje się celem pola przepływu (zmierzone: distance=0,
    // next=-1 na KAŻDEJ komórce pierścienia). ARMOR ma targetPriority CORE:
    // jedynym celem jest sam CORE, pierścień jest WYŁĄCZNIE przeszkodą na drodze
    // do niego, nigdy celem samym w sobie.
    //
    // KOREKTA (przegląd gałęzi, Important #4). Poprzednia wersja tego komentarza
    // twierdziła, że wczesny strażnik `s.buildings[next] !== null` „jest jedyną
    // rzeczą, która ARMOR-a zatrzymuje". Zmierzone: NIEPRAWDA, odkąd istnieje
    // kontrola ogonowa (`candidate !== u.cellId && s.buildings[candidate] !== null`).
    // Z wyciętym wczesnym strażnikiem ARMOR i tak NIE WCHODZI w barykadę — kontrola
    // ogonowa go nie wpuszcza — a asercje TEGO testu (cellId, next, distance)
    // pozostają spełnione: zmierzone, 313/313 testów zielonych przy wyciętym
    // strażniku. Różnica jest w POZYCJI, nie w komórce: bez strażnika jednostka
    // ślizga się dalej we WŁASNEJ komórce ku murowi (0,77 jednostki świata głębiej,
    // stateHash po 2000 tickach na seedzie 33: 7eb20bf3 -> 4f429b58). Każdą z dwóch
    // połówek pary przypina teraz osobny test niżej ("dwie połówki blokowania
    // zabudowy").
    const outside = atSteps(3);
    spawnUnit(s, 'ARMOR', outside);
    const fields = buildAllFlowFields(s);

    // Zmierzone: ARMOR (speedFactor 0,85, najwolniejszy typ) osiąga ścianę i
    // zamraża się na niej po 34 tickach — budżet 2000 ma ~58× zapasu, nie jest
    // dobrany "w ciemno".
    for (let i = 0; i < 2000; i++) updateMovement(s, fields, dark, sunDir, ctx);

    const finalCell = s.units[0].cellId;
    const finalNext = fields.ARMOR.next[finalCell];

    // Nie weszła do CORE.
    expect(finalCell).not.toBe(planet.startCell);
    // Naprawdę dotarła do ściany i TO ONA ją trzyma: własny "next" jednostki to
    // konkretnie zabudowana komórka PIERŚCIENIA (nie -1, nie coś przypadkowego),
    // czyli stoi dokładnie o krok od muru, zablokowana przez sam mur.
    expect(finalNext).toBeGreaterThanOrEqual(0);
    expect(ring).toContain(finalNext);
    expect(s.buildings[finalNext]?.type).toBe('BARRICADE');
    // I jest bliżej ściany niż punkt startowy w metryce pola przepływu — nie
    // utknęła gdzieś przypadkiem po drodze z innego powodu.
    expect(fields.ARMOR.distance[finalCell]).toBeLessThan(fields.ARMOR.distance[outside]);
  });

  it('uciekająca jednostka zatrzymuje się przed barykadą zamiast przez nią przechodzić', () => {
    const s = withCore();
    let lit = 0;
    for (let i = 0; i < N; i++) {
      if (dot(planet.cells[i].normal, sunDir) > 0.8) { lit = i; break; }
    }
    // Komórka, w którą ucieczka (kierunek -sunDir) faktycznie pcha jednostkę
    // jako pierwszą — ta sama, do której naprawdę zmierza gałąź ucieczki.
    let blocker = -1;
    let bestAlign = -Infinity;
    for (const n of planet.cells[lit].neighbors) {
      const align = dot(planet.cells[n].normal, scale(sunDir, -1));
      if (align > bestAlign) { bestAlign = align; blocker = n; }
    }
    applyCommand(s, { kind: 'BUILD', cellId: blocker, type: 'BARRICADE' });
    spawnUnit(s, 'SWARM', lit);

    const light = new Float32Array(N);
    for (let i = 0; i < N; i++) light[i] = Math.max(0, dot(planet.cells[i].normal, sunDir));
    const fields = buildAllFlowFields(s);

    // Zmierzone PRZED poprawką (gałąź ucieczki bez sprawdzenia `s.buildings`):
    // jednostka wchodziła w tę samą barykadę na ticku o indeksie 12. 100 ticków
    // to spory zapas ponad ten moment.
    for (let i = 0; i < 100; i++) updateMovement(s, fields, light, sunDir, ctx);

    expect(s.units[0].cellId).not.toBe(blocker);
    // Zamarła dokładnie tam, gdzie stała — jedyny sąsiad, do którego ucieczka ją
    // pcha, jest zabudowany, więc nie weszła NIGDZIE indziej.
    expect(s.units[0].cellId).toBe(lit);
  });

  it('jednostka otoczona zabudową ze wszystkich stron stoi w miejscu zamiast się psuć', () => {
    const s = withCore();
    let lit = 0;
    for (let i = 0; i < N; i++) {
      if (dot(planet.cells[i].normal, sunDir) > 0.8) { lit = i; break; }
    }
    for (const n of planet.cells[lit].neighbors) {
      applyCommand(s, { kind: 'BUILD', cellId: n, type: 'BARRICADE' });
    }
    spawnUnit(s, 'SWARM', lit);

    const light = new Float32Array(N);
    for (let i = 0; i < N; i++) light[i] = Math.max(0, dot(planet.cells[i].normal, sunDir));
    const fields = buildAllFlowFields(s);

    for (let i = 0; i < 300; i++) updateMovement(s, fields, light, sunDir, ctx);

    // Uwięziona: żaden sąsiad nie jest wolny, więc nigdzie nie weszła — i nadal
    // stoi dokładnie na powierzchni planety, żadnego NaN-a ani ucieczki z celu.
    // `hp`/`exposure` nie są dotykane przez ten moduł (spalanie to inny system,
    // poza zakresem Taska 1) — sprawdzane jest wyłącznie to, co updateMovement
    // faktycznie robi: ruch, nie zapłon.
    expect(s.units[0].cellId).toBe(lit);
    expect(length(s.units[0].pos)).toBeCloseTo(planet.radius, 6);
    expect(Number.isFinite(s.units[0].pos.x)).toBe(true);
    expect(Number.isFinite(s.units[0].pos.y)).toBe(true);
    expect(Number.isFinite(s.units[0].pos.z)).toBe(true);
  });

  it('jednostka w świetle ucieka OD słońca, nie do celu', () => {
    const s = withCore();
    // Wybierz komórkę mocno oświetloną i postaw tam jednostkę.
    let lit = 0;
    for (let i = 0; i < N; i++) {
      if (dot(planet.cells[i].normal, sunDir) > 0.8) { lit = i; break; }
    }
    spawnUnit(s, 'SWARM', lit);

    const light = new Float32Array(N);
    for (let i = 0; i < N; i++) light[i] = Math.max(0, dot(planet.cells[i].normal, sunDir));

    const fields = buildAllFlowFields(s);
    const before = dot(normalize(s.units[0].pos), sunDir);
    for (let i = 0; i < 300; i++) updateMovement(s, fields, light, sunDir, ctx);
    const after = dot(normalize(s.units[0].pos), sunDir);

    expect(after).toBeLessThan(before); // oddaliła się od punktu podsłonecznego

    // Asercja NOŚNA. Sam kierunek nie wystarcza: zmierzona ablacja (gałąź ucieczki
    // wycięta, jednostka tylko podąża polem przepływu) też oddala się od słońca dla
    // tego seeda — o 0,034 zamiast 0,294, bo CORE leży akurat w stronę nieco ciemniejszą.
    // Kierunkowy test przechodziłby więc z USUNIĘTĄ funkcją, którą nazywa.
    // Dotarcie do cienia rozróżnia absolutnie: ucieczka osiąga światło dokładnie 0
    // po 222 tickach, a ablacja siada na CORE i zostaje na 0,4973 również po 600.
    // 300 ticków to 222 plus zapas.
    expect(light[s.units[0].cellId]).toBe(0);
  });

  /**
   * PRZEGLĄD GAŁĘZI, Important #4. `updateMovement` blokuje wejście na zabudowaną
   * komórkę w DWÓCH miejscach i robią one RÓŻNE rzeczy:
   *
   *   • wczesny strażnik w gałęzi pola przepływu — `next < 0 || s.buildings[next] !== null`
   *     — zatrzymuje marsz do CELU: jednostka, której następny krok prowadzi w mur,
   *     nie rusza się WCALE w tym ticku;
   *   • kontrola ogonowa — `candidate !== u.cellId && s.buildings[candidate] !== null` —
   *     blokuje WEJŚCIE do zabudowanej komórki niezależnie od gałęzi (także w ucieczce
   *     przed słońcem, D3), a jej pierwszy człon celowo wyłącza ją dla komórki WŁASNEJ.
   *
   * Wcześniejsza runda przeglądu zmutowała CAŁĄ kontrolę ogonową i przypięła ją jednym
   * testem — ale KAŻDA POŁÓWKA z osobna przeżywała mutację: 313/313 zielonych w obu
   * przypadkach. Poniższe dwa testy przypinają każdą osobno.
   */
  describe('dwie połówki blokowania zabudowy — każda przypięta osobno', () => {
    /** Najmocniej oświetlona komórka pod `sunDir` (ta sama heurystyka, co w testach wyżej). */
    function litCell(): number {
      for (let i = 0; i < N; i++) {
        if (dot(planet.cells[i].normal, sunDir) > 0.8) return i;
      }
      throw new Error('brak oświetlonej komórki');
    }

    function sunlight(): Float32Array {
      const light = new Float32Array(N);
      for (let i = 0; i < N; i++) light[i] = Math.max(0, dot(planet.cells[i].normal, sunDir));
      return light;
    }

    /**
     * Człon `candidate !== u.cellId` kontroli ogonowej. Bez niego jednostka, POD KTÓRĄ
     * gracz postawi budynek, zamarza NA ZAWSZE: dopóki nie przekroczy granicy własnej
     * komórki, `candidate === u.cellId`, a ta komórka jest zabudowana — więc każdy tick
     * kończy się `continue`, jednostka nigdy nie ruszy i nigdy z tego nie wyjdzie.
     * Zmierzone: dziś schodzi w ticku 12; z wyciętym członem NIGDY (sprawdzone do 2000).
     */
    it('jednostka, pod którą postawiono budynek, SCHODZI z niego zamiast zamarzać na zawsze', () => {
      const s = withCore();
      const lit = litCell();
      spawnUnit(s, 'SWARM', lit);
      // Budynek stawiany POD jednostką — `canBuild` patrzy na `buildings`, nie na `units`,
      // więc to jest w pełni legalny ruch gracza, nie hack testu.
      applyCommand(s, { kind: 'BUILD', cellId: lit, type: 'BARRICADE' });
      expect(s.buildings[lit]?.type).toBe('BARRICADE');

      const light = sunlight();
      const fields = buildAllFlowFields(s);
      expect(light[lit]).toBeGreaterThan(0); // przesłanka: to gałąź UCIECZKI

      let leftAt = -1;
      for (let i = 0; i < 2000 && leftAt < 0; i++) {
        updateMovement(s, fields, light, sunDir, ctx);
        if (s.units[0].cellId !== lit) leftAt = i;
      }

      // Zmierzone: tick 12. Budżet 2000 to ~166× — asercja jest o „schodzi", nie o „szybko".
      expect(leftAt, 'jednostka nigdy nie zeszła z zabudowanej komórki').toBeGreaterThanOrEqual(0);
      expect(s.buildings[s.units[0].cellId]).toBeNull();
    });

    /**
     * Człon `zablokowany` — druga połówka blokowania, po naprawie obserwacji O2 z testów
     * z ludźmi.
     *
     * **Zachowanie ZMIENIŁO SIĘ ŚWIADOMIE i to jest ta zmiana.** Poprzednia wersja robiła
     * w gałęzi pola przepływu `continue`, czyli pomijała CAŁY ruch: jednostka zamarzała
     * w chwili wejścia w komórkę sąsiadującą z murem, przy jej DALSZEJ krawędzi. Zmierzone
     * w grze: atak padał z **1,37 rozstawu komórki** zamiast ~0,5 (wspólna krawędź), czyli
     * z widoczną przerwą jednej trzeciej heksa. Gracz zgłosił to jako wadę i nią było.
     *
     * Dziś jednostce wolno dosunąć się do muru WEWNĄTRZ własnej komórki, ale nie wolno jej
     * komórki ZMIENIĆ. Drugi człon jest konieczny i nie jest kosmetyką: bez niego jednostka
     * mogłaby zsunąć się bokiem do innego sąsiada, a wtedy `next` przeliczyłby się z nowej
     * komórki i przestał wskazywać atakowany budynek — walka czyta `next` PO tym wywołaniu
     * (`ahead = buildings[next]`) i straciłaby cel.
     *
     * Stąd asercje są DWIE i obie nośne: pozycja MUSI się ruszyć (inaczej wraca stara
     * przerwa), a `cellId` MUSI zostać (inaczej walka gubi cel).
     */
    it('jednostka, której next jest zabudowany, DOSUWA SIĘ do muru, ale nie zmienia komórki', () => {
      const s = withCore();
      const ring = planet.cells[planet.startCell].neighbors;
      for (const n of ring) applyCommand(s, { kind: 'BUILD', cellId: n, type: 'BARRICADE' });
      spawnUnit(s, 'ARMOR', atSteps(3));
      const fields = buildAllFlowFields(s);

      let blockedAt = -1;
      for (let i = 0; i < 2000 && blockedAt < 0; i++) {
        const next = fields.ARMOR.next[s.units[0].cellId];
        if (next >= 0 && s.buildings[next] !== null) { blockedAt = i; break; }
        updateMovement(s, fields, dark, sunDir, ctx);
      }
      expect(blockedAt, 'jednostka nigdy nie dotarła pod mur').toBeGreaterThanOrEqual(0);
      expect(dark[s.units[0].cellId]).toBe(0); // przesłanka: to gałąź POLA PRZEPŁYWU, nie ucieczki

      const przedDosunieciem = { ...s.units[0].pos };
      const cell = s.units[0].cellId;
      const mur = fields.ARMOR.next[cell];
      const odleglosc = (p: { x: number; y: number; z: number }) =>
        Math.hypot(
          p.x - planet.cells[mur].center.x,
          p.y - planet.cells[mur].center.y,
          p.z - planet.cells[mur].center.z,
        );
      const przed = odleglosc(przedDosunieciem);

      updateMovement(s, fields, dark, sunDir, ctx);
      expect(s.units[0].pos, 'pozycja MUSI drgnąć — inaczej wraca przerwa O2').not.toEqual(
        przedDosunieciem,
      );
      expect(s.units[0].cellId, 'komórka NIE MOŻE się zmienić — walka czyta z niej cel').toBe(cell);

      // Stan ustalony: dosuwa się do granicy i tam zostaje, BLIŻEJ niż była.
      for (let i = 0; i < 200; i++) updateMovement(s, fields, dark, sunDir, ctx);
      expect(s.units[0].cellId).toBe(cell);
      expect(s.buildings[cell]).toBeNull(); // stoi PRZED murem, nie w nim
      expect(odleglosc(s.units[0].pos), 'ma być BLIŻEJ muru niż przed dosunięciem').toBeLessThan(
        przed,
      );
    });
  });

  it('jest deterministyczny', () => {
    const run = () => {
      const s = withCore();
      spawnUnit(s, 'SWARM', atSteps(7));
      spawnUnit(s, 'ARMOR', atSteps(8));
      const fields = buildAllFlowFields(s);
      for (let i = 0; i < 300; i++) updateMovement(s, fields, dark, sunDir, ctx);
      return s.units.map((u) => [u.cellId, u.pos.x, u.pos.y, u.pos.z]);
    };
    expect(run()).toEqual(run());
  });
});

describe('straż niezmiennika nearestLocalCell: angleStep musi być mniejszy niż kątowy rozstaw komórek', () => {
  it('nie rzuca dla dzisiejszych ENEMIES przy T=180, N=1442 (margines zmierzony w raporcie)', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', atSteps(6)); // najszybszy typ (speedFactor 2,3) — najciaśniejszy margines
    const fields = buildAllFlowFields(s);
    expect(() => updateMovement(s, fields, dark, sunDir, ctx)).not.toThrow();
  });

  it('rzuca RangeError, gdy skonfigurowana prędkość nie jest mniejsza niż rozstaw kątowy komórek', () => {
    const s = withCore();
    spawnUnit(s, 'SWARM', atSteps(6));
    const fields = buildAllFlowFields(s);
    // angleStep / kątowyRozstaw = speedFactor × termSpeedCells × TICK_SECONDS —
    // spacing i radius się skracają, więc próg nie zależy od geometrii planety.
    // 2× ponad próg, żeby test nie balansował na krawędzi zaokrągleń float.
    const brokenCtx: MotionContext = {
      ...ctx,
      termSpeedCells: 2 / (ENEMIES.SWARM.speedFactor * TICK_SECONDS),
    };
    expect(() => updateMovement(s, fields, dark, sunDir, brokenCtx)).toThrow(RangeError);
    expect(() => updateMovement(s, fields, dark, sunDir, brokenCtx)).toThrow(/SWARM/);
  });
});

function arcLength(a: { x: number; y: number; z: number }, b: typeof a, radius: number): number {
  const ua = scale(a, 1 / radius);
  const ub = scale(b, 1 / radius);
  void sub;
  return radius * Math.acos(Math.min(1, Math.max(-1, dot(ua, ub))));
}
