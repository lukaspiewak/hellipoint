import { describe, expect, it } from 'vitest';
import { createPlanet, lightField, sunDirection } from '@heliopolis/sim';
import { buildPlanetGeometry } from '../src/geometry.js';
import { DEFAULT_PALETTE, writeCellColors } from '../src/shading.js';
import { median, percentile } from '../src/frameStats.js';

/**
 * Budżet klatki, część czysta (Zadanie 5, Krok 1 briefu). `writeCellColors` jest JEDYNĄ
 * częścią całego renderu, którą da się zmierzyć bez GPU — i jedyną, która rośnie LINIOWO z
 * liczbą komórek (1442 dziś, docelowo skalowalne do 2562 wg D2 specu, §3) — stąd to właśnie
 * ona dostaje przypięty próg, nie próba zmierzenia `renderer.render()` w Node (niemożliwa
 * bez prawdziwego WebGL, patrz `scene.ts`/`createSceneWithRenderer`).
 *
 * Próg z briefu: **1442 komórki, 1000 wywołań, mediana < 1 ms.** Mediana (nie średnia) —
 * ten sam wybór co gdzie indziej w tym zadaniu (`frameStats.ts`): odporna na pojedynczy
 * odstający pomiar (np. jedna klatka trafiona przez GC albo przełączenie wątku przez OS),
 * którego pojedyncza pętla renderu i tak nie odczuje jako "typowej" klatki.
 */
describe('writeCellColors — budżet 1442 komórek / 1000 wywołań (Zadanie 5, Krok 1)', () => {
  it('mediana czasu jednego wywołania jest poniżej 1 ms', () => {
    const planet = createPlanet({ seed: 20260915 });
    expect(planet.cells.length).toBe(1442); // kotwica: budżet dotyczy TEJ liczby komórek, nie jakiejkolwiek

    const geo = buildPlanetGeometry(planet);
    const light = lightField(planet, sunDirection(0, 180));
    const out = new Float32Array(geo.positions.length);

    // Rozgrzewka — NIE liczy się do pomiaru. Cel: JIT silnika V8 zdąży zoptymalizować gorącą
    // pętlę PRZED pomiarem, tak jak zdąży to zrobić w prawdziwej pętli renderu po pierwszych
    // klatkach — bez tego pierwsze próby mierzyłyby głównie koszt kompilacji, nie koszt
    // funkcji w ustabilizowanym (steady-state) użyciu, które faktycznie interesuje budżet 8 ms.
    const WARMUP = 50;
    for (let i = 0; i < WARMUP; i++) {
      writeCellColors(geo, light, out, DEFAULT_PALETTE);
    }

    const ITERATIONS = 1000;
    const durationsMs: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      writeCellColors(geo, light, out, DEFAULT_PALETTE);
      durationsMs.push(performance.now() - t0);
    }

    // Kontrola pozytywna na sam pomiar: 1000 próbek NAPRAWDĘ zebranych, nie np. pętla, która
    // przez pomyłkę wykonała się zero albo jeden raz.
    expect(durationsMs.length).toBe(ITERATIONS);

    const med = median(durationsMs);
    const p95 = percentile(durationsMs, 95);
    // Tag [BUDGET] — greppowalny w logu CI/lokalnym, ten sam tag co konsola main.ts
    // (apps/client/src/main.ts), żeby "budżet" w obu miejscach znaczyło jedną i tę samą liczbę.
    console.log(
      `[BUDGET] writeCellColors × ${ITERATIONS} @ ${planet.cells.length} komórek: mediana=${med.toFixed(4)} ms, p95=${p95.toFixed(4)} ms (próg: < 1 ms)`,
    );

    expect(med).toBeLessThan(1);
  });
});
