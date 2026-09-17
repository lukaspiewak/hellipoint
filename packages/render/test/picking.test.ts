import { describe, expect, it } from 'vitest';
import { createPlanet, cross, dot, normalize, type Planet, type Vec3 } from '@heliopolis/sim';
import { pickCell } from '../src/picking.js';
import { buildPlanetGeometry, type PlanetGeometry } from '../src/geometry.js';
import { mulberry32 } from './support/mulberry32.js';

// Ta sama planeta dla wszystkich testów tego pliku — seed dowolny, ustalony raz (spójny
// z seedem użytym w briefie Zadania 1).
const planet = createPlanet({ seed: 1 });

// Geometria rysowana przez renderer — testy 5/6 sprawdzają `pickCell` względem TYCH SAMYCH
// buforów, nie względem `planet.cells[i].corners` wprost (patrz `cornersFromGeometry`).
const geometry: PlanetGeometry = buildPlanetGeometry(planet);

function vecAt(positions: Float32Array, vertexIndex: number): Vec3 {
  const o = vertexIndex * 3;
  return { x: positions[o], y: positions[o + 1], z: positions[o + 2] };
}

/**
 * Narożniki komórki `cellId`, odczytane z buforów `PlanetGeometry` (nie z `Planet.cells`
 * wprost) — pierwszy wierzchołek zakresu to `cell.center` (pomijamy go, `k` startuje od 1),
 * kolejne to jej `corners` w kolejności (`buildPlanetGeometry` zapisuje je tak, Test 9 w
 * `geometry.test.ts` sprawdza tożsamość PRZEZ WARTOŚĆ).
 */
function cornersFromGeometry(geo: PlanetGeometry, cellId: number): Vec3[] {
  const start = geo.cellVertexStart[cellId];
  const count = geo.cellVertexCount[cellId];
  const corners: Vec3[] = [];
  for (let k = 1; k < count; k++) corners.push(vecAt(geo.positions, start + k));
  return corners;
}

/**
 * Czy `p` leży wewnątrz wypukłego wielokąta sferycznego rozpiętego na `corners`.
 *
 * Każda krawędź (corners[k], corners[k+1]) to łuk wielkiego koła — przecięcie sfery z
 * płaszczyzną PRZEZ ŚRODEK SFERY rozpiętą na tych dwóch wektorach. `cross(corners[k],
 * corners[k+1])` jest normalną tej płaszczyzny: dla wielokąta WYPUKŁEGO, `p` jest w środku
 * wtedy i tylko wtedy, gdy leży po TEJ SAMEJ stronie każdej z tych płaszczyzn co dowolny
 * inny punkt znany jako wewnętrzny — standardowy test półpłaszczyznowy, przeniesiony z
 * płaskiego wielokąta na sferę (rodzina tego samego testu — iloczyn potrójny, nie odległość
 * — co Test 6 w `geometry.test.ts`, tam liczony na pojedynczych trójkątach wachlarza).
 *
 * Punktem odniesienia "na pewno wewnątrz" jest CENTROID SAMYCH `corners` (średnia,
 * rzutowana z powrotem na sferę), a NIE `cell.center`/`cell.normal` — z dwóch powodów:
 *
 * 1. Niezależność: `cell.normal` to DOKŁADNIE dana, na której stoi ranking w `pickCell`.
 *    Używanie jej tutaj jako "referencji wnętrza" związałoby tę kontrolę z tym samym
 *    założeniem, które ma sprawdzać niezależnie (patrz też Test 6 niżej — tam `corners` są
 *    CELOWO cudze, więc `cell.center` w ogóle nie ma prawa mówić, co jest "wewnątrz" tego
 *    podstawionego wieloboku).
 * 2. Centroid wierzchołków wielokąta WYPUKŁEGO leży w jego wnętrzu z definicji (jest w
 *    otoczce wypukłej własnych wierzchołków) — prawdziwe niezależnie od tego, SKĄD te
 *    wierzchołki pochodzą, więc ta funkcja działa identycznie dla prawdziwego i dla
 *    (w Teście 6) podstawionego wieloboku.
 *
 * Celowo NIE korzysta z `.normal`/najbliższego środka w ŻADNYM miejscu — niezależność od
 * pomysłu, na którym stoi `pickCell`, jest tu produktem, nie przypadkiem.
 */
function insideSphericalPolygon(corners: readonly Vec3[], p: Vec3): boolean {
  const n = corners.length;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const c of corners) {
    cx += c.x;
    cy += c.y;
    cz += c.z;
  }
  const centroid = normalize({ x: cx / n, y: cy / n, z: cz / n });

  for (let k = 0; k < n; k++) {
    const edgeNormal = cross(corners[k], corners[(k + 1) % n]);
    const centroidSide = dot(edgeNormal, centroid);
    const pSide = dot(edgeNormal, p);
    if (Math.sign(pSide) !== Math.sign(centroidSide)) return false;
  }
  return true;
}

describe('pickCell — przecięcie promienia ze sferą', () => {
  it('1. promień w środek planety trafia w komórkę zwróconą do źródła promienia', () => {
    const target = planet.cells[500];
    const n = target.normal;
    const origin = { x: n.x * planet.radius * 3, y: n.y * planet.radius * 3, z: n.z * planet.radius * 3 };
    const direction = { x: -n.x, y: -n.y, z: -n.z };
    expect(pickCell(planet, origin, direction)).toBe(500);
  });

  it('2. promień mijający planetę daje null', () => {
    const origin = { x: 0, y: 0, z: planet.radius * 3 };
    const direction = { x: 1, y: 0, z: 0 };
    expect(pickCell(planet, origin, direction)).toBeNull();
  });

  // Własna para mutacji (Krok 6 briefu wymaga co najmniej jednej dodatkowej, obok pary z
  // briefu — patrz tabela w raporcie) stoi na TYM teście. Bez niego strażnik `dLen > 0` w
  // `picking.ts` nie miałby czego pilnować: żaden inny test tego pliku nie woła `pickCell`
  // z kierunkiem zerowym.
  it('3. kierunek zerowy rzuca RangeError, nie liczy w ciszy 0/0', () => {
    const origin = { x: 0, y: 0, z: planet.radius * 3 };
    expect(() => pickCell(planet, origin, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------
// Własność Voronoi — 2000 losowych promieni, DWIE niezależne wyrocznie
// ---------------------------------------------------------------------------------------
//
// Próbki wygenerowane RAZ (ten sam seed rng co w briefie: 12345), żeby oba testy niżej
// sprawdzały DOKŁADNIE ten sam zbiór promieni pod dwiema różnymi wyroczniami, zamiast
// losować dwukrotnie (i przypadkiem sprawdzać różne promienie pod tą samą nazwą "2000
// próbek").
const SAMPLE_COUNT = 2000;
interface Sample {
  readonly n: Vec3; // punkt na sferze jednostkowej = dokładny, analitycznie znany punkt trafienia
  readonly origin: Vec3;
  readonly direction: Vec3;
}
const samples: Sample[] = (() => {
  const rng = mulberry32(12345);
  const out: Sample[] = [];
  for (let k = 0; k < SAMPLE_COUNT; k++) {
    // Losowy kierunek na sferze (próbkowanie przez `u = cos(theta)` jednostajne, NIE
    // `theta` jednostajne, żeby uniknąć zagęszczenia przy biegunach), promień z zewnątrz
    // (4 promienie planety) celujący dokładnie w środek.
    const u = rng() * 2 - 1;
    const phi = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const n: Vec3 = { x: r * Math.cos(phi), y: u, z: r * Math.sin(phi) };
    const origin: Vec3 = { x: n.x * planet.radius * 4, y: n.y * planet.radius * 4, z: n.z * planet.radius * 4 };
    const direction: Vec3 = { x: -n.x, y: -n.y, z: -n.z };
    out.push({ n, origin, direction });
  }
  return out;
})();

describe('pickCell — własność Voronoi na 2000 losowych promieniach', () => {
  it('4. [WŁASNOŚĆ] trafiona komórka jest tą o najbliższym środku (druga pętla po .normal)', () => {
    // Wyrocznia z briefu: liczy PONOWNIE "najbliższy środek", tą samą formułą co
    // `pickCell` wewnątrz siebie. Łapie błąd w przecięciu ze sferą (zły pierwiastek, zła
    // normalizacja kierunku) i w indeksowaniu pętli — ale NIE złapałaby błędu w samej idei
    // "najbliższy środek = komórka", bo używa dokładnie tej idei do sprawdzenia samej
    // siebie. Test 6 niżej pokazuje to na żywym przykładzie.
    let checked = 0;
    for (const { n, origin, direction } of samples) {
      const hit = pickCell(planet, origin, direction);
      expect(hit).not.toBeNull();

      let bestDot = -Infinity;
      let bestId = -1;
      for (let i = 0; i < planet.cells.length; i++) {
        const c = planet.cells[i].normal;
        const d = c.x * n.x + c.y * n.y + c.z * n.z;
        if (d > bestDot) {
          bestDot = d;
          bestId = i;
        }
      }
      expect(hit).toBe(bestId);
      checked++;
    }
    expect(checked).toBe(SAMPLE_COUNT);
  });

  it('5. [WŁASNOŚĆ, niezależnie od "najbliższy środek"] punkt trafienia leży w wielokącie zwróconej komórki, liczonym z buforów buildPlanetGeometry', () => {
    // Druga wyrocznia — geometrycznie INNA, nie kolejne przepisanie tej samej pętli:
    // sprawdza, że `n` (dokładny punkt trafienia — promień celuje wzdłuż -n prosto w
    // środek, więc trafia sferę dokładnie w promień*n, NIEZALEŻNIE od tego, jak `pickCell`
    // policzył to wewnątrz siebie) leży wewnątrz wieloboku sferycznego zwróconej komórki,
    // odczytanego z TYCH SAMYCH buforów, które rysuje renderer (`buildPlanetGeometry`) — nie
    // z `planet.cells[i].corners` wprost, i bez użycia `.center`/`.normal` w ogóle (patrz
    // `insideSphericalPolygon`). To zamyka dwie luki naraz: błąd w samym pomyśle "najbliższy
    // środek" (ten test w ogóle go nie używa) oraz ewentualną niezgodność między
    // `Planet.cells[i].corners` a tym, co `buildPlanetGeometry` faktycznie zapisuje do
    // bufora wierzchołków.
    //
    // ZMIERZONE (nie zgadywane — patrz `picking.ts`, sekcja "Zastrzeżenie", i raport
    // Zadania 1): ta własność NIE trzyma się dla WSZYSTKICH 2000 próbek. `dual.ts` buduje
    // `corners` jako centroidy trójkątów siatki geodezyjnej, nie jako cyrkumcentry — więc
    // granica narysowanego wieloboku jest BLISKĄ, ale nie tożsamą co do bitu aproksymacją
    // prawdziwego diagramu Voronoi generatorów `normal`. Liczymy więc rozbieżności (wzorem
    // Testu 9 w `geometry.test.ts`), zamiast fail-fast na pierwszej, i przypinamy DOKŁADNĄ
    // zmierzoną liczbę — regresja (więcej rozbieżności, większy margines, rozbieżność
    // wobec NIE-sąsiada) ma to oblać, a nie przejść po cichu.
    let checked = 0;
    let mismatches = 0;
    for (const { n, origin, direction } of samples) {
      const hit = pickCell(planet, origin, direction);
      expect(hit).not.toBeNull();
      const hitId = hit as number;

      const corners = cornersFromGeometry(geometry, hitId);
      if (!insideSphericalPolygon(corners, n)) {
        mismatches++;
        // Charakteryzacja obowiązkowa, nie tylko licznik: KAŻDA rozbieżność musi być
        // wobec bezpośredniego sąsiada zwróconej komórki, na włos od granicy — nigdy
        // wobec odległej, niepowiązanej komórki (co wskazywałoby na prawdziwy błąd
        // `pickCell`, nie na przybliżenie `dual.ts`).
        let bestId = -1;
        let bestDot = -Infinity;
        let secondId = -1;
        let secondDot = -Infinity;
        for (let i = 0; i < planet.cells.length; i++) {
          const d = dot(planet.cells[i].normal, n);
          if (d > bestDot) {
            secondDot = bestDot;
            secondId = bestId;
            bestDot = d;
            bestId = i;
          } else if (d > secondDot) {
            secondDot = d;
            secondId = i;
          }
        }
        expect(bestId).toBe(hitId);
        expect(planet.cells[hitId].neighbors).toContain(secondId);
        expect(bestDot - secondDot).toBeLessThan(1e-3); // margines "na włos", nie przypadek
      }
      checked++;
    }
    expect(checked).toBe(SAMPLE_COUNT);
    // Wartość PRZYPIĘTA dla seed=1 / mulberry32(12345) — patrz komentarz wyżej i raport
    // Zadania 1 po pełne pochodzenie liczby (1,25% próbek, zawsze na granicy z sąsiadem).
    expect(mismatches).toBe(25);
  });

  it('6. [DOWÓD NIEZALEŻNOŚCI] gdy corners przestają zgadzać się z normal, test 5 to widzi, test 4 — nie', () => {
    // Nie mutacja `picking.ts` — mutacja PLANETY, symulująca hipotetyczny (znacznie
    // większy niż zmierzony w Teście 5) błąd w `dual.ts`, w którym granica wielokąta
    // komórki (`corners`) rozjeżdża się z jej środkiem Voronoi (`normal`). `pickCell`
    // czyta WYŁĄCZNIE `.normal`, więc taki błąd nie zmienia jego odpowiedzi — pytanie
    // brzmi, KTÓRA z dwóch wyroczni powyżej by go wykryła.
    const targetId = 500;
    const target = planet.cells[targetId];

    // Punkt trafienia CELOWO przesunięty od `target.normal` (mieszanka 90/10 z sąsiadem,
    // znormalizowana) — NIE `target.normal` wprost. Gdyby `n === target.normal`, `n` byłby
    // RÓWNOLEGŁY do `target.center` (ten sam kierunek, inna skala): każda kontrola "ta sama
    // strona co centrum" wypadałaby zgodnie z definicji, niezależnie od tego, jakie
    // `corners` by podstawić — degenerat, nie test. Margines 0,1 zweryfikowany (patrz
    // raport): `pickCell` nadal zwraca 500, punkt nadal głęboko wewnątrz prawdziwego
    // wieloboku 500.
    const neighborNormal = planet.cells[target.neighbors[0]].normal;
    const nudge = 0.1;
    const n = normalize({
      x: target.normal.x * (1 - nudge) + neighborNormal.x * nudge,
      y: target.normal.y * (1 - nudge) + neighborNormal.y * nudge,
      z: target.normal.z * (1 - nudge) + neighborNormal.z * nudge,
    });
    const origin = { x: n.x * planet.radius * 3, y: n.y * planet.radius * 3, z: n.z * planet.radius * 3 };
    const direction = { x: -n.x, y: -n.y, z: -n.z };

    const hit = pickCell(planet, origin, direction);
    expect(hit).toBe(targetId); // `.normal` komórki 500 nietknięte — pickCell nie widzi korupcji
    // Kontrola: prawdziwy (nieskorumpowany) wielokąt 500 rzeczywiście zawiera `n` — inaczej
    // poniższe "wielokąt to widzi" nie miałoby żadnej wartości dowodowej.
    expect(insideSphericalPolygon(cornersFromGeometry(geometry, targetId), n)).toBe(true);

    // Komórka najdalsza od `target` po `.normal` (praktycznie antypoda) — dawca "obcych"
    // corners, o których wiadomo geometrycznie, że NIE mogą zawierać punktu trafienia w
    // `target`.
    let foreignId = -1;
    let worstDot = Infinity;
    for (let i = 0; i < planet.cells.length; i++) {
      const d = dot(planet.cells[i].normal, target.normal);
      if (d < worstDot) {
        worstDot = d;
        foreignId = i;
      }
    }
    expect(foreignId).toBeGreaterThanOrEqual(0);

    const corrupted: Planet = {
      ...planet,
      cells: planet.cells.map((cell, i) =>
        i === targetId ? { ...cell, corners: planet.cells[foreignId].corners } : cell,
      ),
    };
    const corruptedGeometry = buildPlanetGeometry(corrupted);

    // Wyrocznia z testu 5 (wielokąt z buforów, referencja = centroid WŁASNYCH corners):
    // ZAUWAŻA. Prawdziwy punkt trafienia nie leży w podstawionym, odległym wielokącie.
    expect(insideSphericalPolygon(cornersFromGeometry(corruptedGeometry, targetId), n)).toBe(false);

    // Wyrocznia z testu 4 (druga pętla po .normal): NIE MA JAK zauważyć — liczy wyłącznie
    // po `.normal`, którego korupcja nie dotknęła, więc zgadza się z `pickCell` tak samo,
    // jakby nic się nie stało. To jest granica tamtego testu, nazwana wprost (patrz uwaga
    // przy Kroku 5 briefu).
    let bestDot = -Infinity;
    let bestId = -1;
    for (let i = 0; i < corrupted.cells.length; i++) {
      const c = corrupted.cells[i].normal;
      const d = c.x * n.x + c.y * n.y + c.z * n.z;
      if (d > bestDot) {
        bestDot = d;
        bestId = i;
      }
    }
    expect(bestId).toBe(targetId); // ślepe na dokładnie tę korupcję — patrz raport
  });
});
