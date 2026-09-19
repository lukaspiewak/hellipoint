import type { RunResult } from './run.js';

/**
 * # Kiedy pomiarowi NIE WOLNO wierzyć (Faza 3, narzędzia balansu)
 *
 * ## Po co to istnieje
 *
 * Raport partii wygląda identycznie dla dwóch zupełnie różnych rzeczy: „ta strategia
 * przegrała" i „ta strategia w ogóle nie zagrała". W Zadaniu 3 kosztowało to trzy
 * opublikowane wnioski i całą rundę pracy do powtórzenia — trzy warianty otwarcia
 * raportowały `0,0 % zwycięstw` i wyglądało to na wynik o grze, podczas gdy polityka
 * **zakleszczała się na tym samym budynku na każdej planecie**, bo nie stać jej było
 * na kolejną pozycję kolejki i nie umiała jej przeskoczyć.
 *
 * Złapałem to okiem, po jednej liczbie w rozkładzie (`szczyt zabudowy p10 = p50 = p90`).
 * **Sito, które działa tylko wtedy, gdy ktoś patrzy, nie jest sitem.** Ten moduł zamienia
 * tamte spojrzenia w kod.
 *
 * ## Czego tu NIE ma
 *
 * Oceny balansu. To nie mówi „gra jest za trudna" — od tego jest `assessHealth`. To mówi
 * wyłącznie **„ta partia nie niesie informacji, o którą pytasz"**, czyli dotyczy przyrządu,
 * nie gry. Rozróżnienie jest istotne: werdykt balansu bez danych to wada do naprawienia,
 * a partia bez informacji to pomiar do powtórzenia.
 */

/** Najmniejsza partia, dla której te sita mają sens. Poniżej — p10 i p90 to ta sama próbka. */
const MIN_PRZEBIEGOW = 20;

export interface Diagnoza {
  /** Krótki znacznik do maszynowego odczytu. */
  readonly kod: 'ZAKLESZCZENIE' | 'BRAK_ZROZNICOWANIA';
  /** Pełne zdanie do raportu — ma tłumaczyć, co robić, nie tylko co jest nie tak. */
  readonly opis: string;
}

const percentyl = (posortowane: readonly number[], p: number): number =>
  posortowane[Math.min(posortowane.length - 1, Math.floor(p * posortowane.length))];

/**
 * Czy tej partii wolno wierzyć.
 *
 * Zwraca pustą tablicę, gdy nic nie budzi wątpliwości — bo „brak zastrzeżeń" ma wyglądać
 * jak brak zastrzeżeń, a nie jak komunikat.
 */
export function diagnozuj(results: readonly RunResult[]): Diagnoza[] {
  const out: Diagnoza[] = [];
  const n = results.length;
  if (n < MIN_PRZEBIEGOW) return out;

  const zwyciestwa = results.filter((r) => r.phase === 'VICTORY').length;

  /**
   * ZAKLESZCZENIE — polityka stanęła w tym samym miejscu na KAŻDEJ planecie.
   *
   * Warunek jest koniunkcją i każdy człon coś wnosi: identyczny szczyt zabudowy między
   * p10 a p90 (a więc niezależny od planety) ORAZ zero zwycięstw. Sam identyczny szczyt
   * przy wygranych oznaczałby po prostu kolejkę, którą zawsze da się dokończyć — to nie
   * jest wada. Dopiero „zawsze tyle samo i nigdy nie wygrywa" znaczy, że kolejka nie
   * ruszyła dalej, bo nie mogła.
   */
  const szczyty = [...results.map((r) => r.peakBuildings)].sort((a, b) => a - b);
  if (zwyciestwa === 0 && percentyl(szczyty, 0.1) === percentyl(szczyty, 0.9)) {
    out.push({
      kod: 'ZAKLESZCZENIE',
      opis:
        `polityka zatrzymała się na ${szczyty[0]} budynkach na KAŻDEJ planecie ` +
        `(p10 = p90) i nie wygrała ani razu. To nie jest wynik o balansie — to kolejka, ` +
        'która nie mogła ruszyć dalej, bo nie było z czego budować. Powtórz pomiar po ' +
        'poprawieniu kolejki, zanim wyciągniesz z tego wniosek.',
    });
  }

  /**
   * BRAK ZRÓŻNICOWANIA — wszystkie przebiegi identyczne, czyli seed do nich nie dociera.
   *
   * Tak wygląda zepsuty szew procesowy: partia policzona raz i skopiowana, albo seed
   * nieprzekazany do potomka. Rozkłady są wtedy doskonale spójne i doskonale bezwartościowe.
   */
  const rozne = new Set(results.map((r) => `${r.ticks}:${r.peakBuildings}:${r.phase}`)).size;
  if (rozne === 1) {
    out.push({
      kod: 'BRAK_ZROZNICOWANIA',
      opis:
        `wszystkie ${n} przebiegów są IDENTYCZNE (ticki, zabudowa, faza). Seed nie dociera ` +
        'do symulacji albo partia została policzona raz i skopiowana — rozkłady nie opisują ' +
        'niczego. Sprawdź przekazanie seeda do procesów potomnych.',
    });
  }

  return out;
}
