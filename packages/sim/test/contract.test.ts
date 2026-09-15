import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createScanner } from 'typescript/unstable/ast/scanner';
import { SyntaxKind } from 'typescript/unstable/ast';
import { SIM_VERSION } from '../src/index.js';

/**
 * Wyodrębnia specyfikatory modułów rzeczywiście importowanych/wymaganych przez
 * fragment kodu — na podstawie strumienia tokenów leksera TypeScript, nie
 * dopasowania tekstu wyrażeniem regularnym. Rozpoznaje wszystkie cztery formy:
 *   - statyczny:        import x from 'spec';  export { x } from 'spec';
 *   - efektu ubocznego: import 'spec';
 *   - dynamiczny:       import('spec')
 *   - CommonJS:         require('spec')
 *
 * Lekser traktuje komentarze jako trivię (pomijaną w całości) i literały
 * napisowe jako pojedyncze, nierozkładalne tokeny — więc w odróżnieniu od
 * dopasowania regexem po surowym tekście, nie da się go oszukać komentarzem
 * ani literałem napisowym zawierającym tekst w stylu "from 'x'".
 *
 * Rozpoznawane są dwa rodzaje literałów niosące specyfikator: zwykły literał
 * napisowy (`SyntaxKind.StringLiteral`) oraz literał szablonowy bez podstawień
 * (`SyntaxKind.NoSubstitutionTemplateLiteral`, czyli `` `spec` ``) — bo
 * `import(...)`/`require(...)` to zwykłe wywołania, przyjmujące dowolne
 * wyrażenie jako argument, więc `` import(`three`) `` i `` require(`three`) ``
 * są równie prawdziwym importem jak ich odpowiedniki z cudzysłowem.
 *
 * Pełny AST w tej wersji TypeScript (7.x, kompilator natywny) jest dostępny
 * tylko przez klienta RPC do procesu kompilatora, powiązanego z projektem i
 * plikiem tsconfig na dysku (`typescript/unstable/sync` / `/async`) — oznaczony
 * jako "unstable", zbyt ciężki i zbyt niestabilny na lekki skan specyfikatorów
 * modułów z dowolnego fragmentu tekstu w teście. Lekser
 * (`typescript/unstable/ast/scanner`) jest częścią tego samego pakietu
 * kompilatora, działa bez projektu/tsconfig na dowolnym łańcuchu znaków i daje
 * te same gwarancje (odporność na komentarze/literały) potrzebne, by domknąć
 * lukę w strażniku.
 */
function extractModuleSpecifiers(sourceText: string): string[] {
  const scanner = createScanner(/* skipTrivia */ true, undefined, sourceText);
  const specifiers: string[] = [];
  let prev: SyntaxKind | undefined;
  let prevPrev: SyntaxKind | undefined;
  let templateDepth = 0;
  let token = scanner.scan();

  while (token !== SyntaxKind.EndOfFile) {
    // Literał szablonowy Z PODSTAWIENIEM wymaga jawnego przełączenia leksera.
    // Lekser, dojechawszy do `}` domykającego `${...}`, zwraca CloseBraceToken i
    // wraca do trybu kodu; dopiero `reScanTemplateToken` każe mu odczytać to samo
    // miejsce jako TemplateMiddle/TemplateTail. Bez tego wywołania reszta literału
    // jest leksowana jako KOD, a domykający backtick otwiera fantomowy literał
    // biegnący do następnego backticka w pliku — parzystość backticków się odwraca.
    //
    // To NIE jest kosmetyka. Zmierzone w tej sesji: z `await import("three")`
    // postawionym poniżej dowolnego szablonu z podstawieniem, skaner BEZ tej obsługi
    // zwraca [] — czyli strażnik zero-zależności, fundament D5, po cichu przepuszcza
    // prawdziwy import. Szablony z podstawieniem są w każdym komunikacie błędu tego
    // pakietu, więc dziura obejmowała większość pliku w ośmiu plikach źródłowych.
    // Sprawdzone na dzisiejszym `src`: zero rozjazdów, nikt jeszcze w nią nie wpadł.
    if (token === SyntaxKind.TemplateHead) {
      templateDepth++;
    } else if (token === SyntaxKind.CloseBraceToken && templateDepth > 0) {
      token = scanner.reScanTemplateToken(/* isTaggedTemplate */ false);
      if (token === SyntaxKind.TemplateTail) templateDepth--;
    }

    if (token === SyntaxKind.StringLiteral || token === SyntaxKind.NoSubstitutionTemplateLiteral) {
      const isFromClause = prev === SyntaxKind.FromKeyword; // import/export ... from 'x'
      const isSideEffectImport = prev === SyntaxKind.ImportKeyword; // import 'x';
      const isDynamicImport = prev === SyntaxKind.OpenParenToken && prevPrev === SyntaxKind.ImportKeyword; // import('x') / import(`x`)
      const isRequireCall = prev === SyntaxKind.OpenParenToken && prevPrev === SyntaxKind.RequireKeyword; // require('x') / require(`x`)

      if (isFromClause || isSideEffectImport || isDynamicImport || isRequireCall) {
        specifiers.push(scanner.getTokenValue());
      }
    }
    prevPrev = prev;
    prev = token;
    token = scanner.scan();
  }

  return specifiers;
}

/** Specyfikatory z {@link extractModuleSpecifiers}, odfiltrowane do tych spoza pakietu. */
function findOffendingSpecifiers(sourceText: string): string[] {
  return extractModuleSpecifiers(sourceText).filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'));
}

describe('kontrakt pakietu sim', () => {
  it('eksportuje wersję', () => {
    expect(SIM_VERSION).toBe('0.0.0');
  });

  it('nie ma ŻADNYCH zależności runtime (fundament D5)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it('żaden plik źródłowy nie importuje three ani niczego spoza pakietu', async () => {
    const { globSync } = await import('node:fs');
    // fileURLToPath, NIE `.pathname` surowego URL-a: `.pathname` jest %-kodowany
    // (spacja → %20 itd.), więc na ścieżce zawierającej znak wymagający kodowania
    // `cwd` przestałby istnieć, `globSync` po cichu zwróciłby [], a cała reszta tego
    // testu zielono "sprawdziłaby" zero plików. `fileURLToPath` dekoduje z powrotem
    // do rzeczywistej ścieżki systemu plików.
    const files = globSync('src/**/*.ts', { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    // Strażnik na własną niepustość: bez tego powyższa klasa błędu (albo dowolna inna
    // regresja globu) przechodzi zielono, nie przeczytawszy ani jednego pliku.
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      for (const spec of findOffendingSpecifiers(src)) {
        offenders.push(`${f}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('strażnik importów (lekser TypeScript, nie regex): findOffendingSpecifiers', () => {
  it('wykrywa statyczny import: `import { x } from "spec"`', () => {
    expect(findOffendingSpecifiers(`import { foo } from 'three';`)).toEqual(['three']);
  });

  it('wykrywa re-eksport: `export { x } from "spec"`', () => {
    expect(findOffendingSpecifiers(`export { foo } from 'three';`)).toEqual(['three']);
  });

  it('wykrywa import efektu ubocznego: `import "spec"`', () => {
    expect(findOffendingSpecifiers(`import 'three';`)).toEqual(['three']);
  });

  it('wykrywa dynamiczny import: `import("spec")`', () => {
    const src = `export async function load() { return await import('three'); }`;
    expect(findOffendingSpecifiers(src)).toEqual(['three']);
  });

  it('wykrywa CommonJS: `require("spec")`', () => {
    expect(findOffendingSpecifiers(`const three = require('three');`)).toEqual(['three']);
  });

  it('wykrywa dynamiczny import zapisany literałem szablonowym: `import(`spec`)`', () => {
    const src = 'export async function load() { return await import(`three`); }';
    expect(findOffendingSpecifiers(src)).toEqual(['three']);
  });

  it('widzi import stojący PO literale szablonowym z podstawieniem', () => {
    // Regresja na realną dziurę, nie hipotetyczną. Bez obsługi reScanTemplateToken
    // ten przypadek zwracał [] — strażnik przepuszczał `three` bez słowa.
    const src = [
      'function msg(a: number) { return `wartosc ${a} koniec`; }',
      'export async function load() { return await import("three"); }',
    ].join('\n');
    expect(findOffendingSpecifiers(src)).toEqual(['three']);
  });

  it('wraca do właściwej parzystości po wielu literałach szablonowych', () => {
    const src = [
      'const a = `x ${1} y`;',
      'const b = `p ${2} q`;',
      'const c = `m ${3} ${4} n`;',
      'export async function load() { return await import("three"); }',
    ].join('\n');
    expect(findOffendingSpecifiers(src)).toEqual(['three']);
  });

  // Dwa poniższe testy są PARĄ i żaden nie zastępuje drugiego. Zmierzona tabela
  // (kolumny: bez obsługi reScanTemplateToken / z FLAGĄ logiczną / z LICZNIKIEM):
  //
  //   zagnieżdżenie:   1        2        3        4        5
  //   bez naprawy:     []    three      []     three      []
  //   flaga:         three      []    three      []     three
  //   licznik:       three   three    three    three    three
  //
  // Rozróżnialność ALTERNUJE z parzystością zagnieżdżenia, bo o wszystkim decyduje
  // parzystość backticków po rozjeździe leksera. Wniosek, którego nie da się obejść:
  // ŻADNA pojedyncza głębokość nie wykrywa obu regresji naraz. Zagnieżdżenie
  // NIEPARZYSTE łapie brak naprawy, ale przepuszcza flagę; PARZYSTE łapie flagę,
  // ale przepuszcza brak naprawy. Stąd dwa testy, po jednym na każdą parzystość.
  it('trzy poziomy zagnieżdżenia: łapie BRAK obsługi reScanTemplateToken', () => {
    const src = [
      'const a = `A ${ `B ${ `C ${1} c` } b` } a`;',
      'export async function load() { return await import("three"); }',
    ].join('\n');
    expect(findOffendingSpecifiers(src)).toEqual(['three']);
  });

  it('dwa poziomy zagnieżdżenia: łapie FLAGĘ tam, gdzie potrzebny jest LICZNIK', () => {
    // Ten przypadek przechodzi BEZ jakiejkolwiek naprawy, więc jako strażnik regresji
    // „usunięto reScanTemplateToken" jest bezwartościowy — i dokładnie dlatego stoi obok
    // tamtego, a nie zamiast niego. Jego jedyne zadanie to nie dać zdegradować licznika
    // głębokości do flagi logicznej, bo flaga gubi tu domknięcie zewnętrznego szablonu.
    const src = [
      'const a = `A ${ `B ${1} b` } a`;',
      'export async function load() { return await import("three"); }',
    ].join('\n');
    expect(findOffendingSpecifiers(src)).toEqual(['three']);
  });

  it('wykrywa CommonJS zapisany literałem szablonowym: `require(`spec`)`', () => {
    expect(findOffendingSpecifiers('const three = require(`three`);')).toEqual(['three']);
  });

  it('NIE zgłasza importów względnych ani wbudowanych node:', () => {
    const src = [`import { helper } from './helper.js';`, `import { readFileSync } from 'node:fs';`].join('\n');
    expect(findOffendingSpecifiers(src)).toEqual([]);
  });

  it('NIE zgłasza komentarza ani literału napisowego zawierającego tekst "from \'x\'"', () => {
    const src = [
      `// ten kod jest adapted from 'three' — to tylko komentarz`,
      `const note = "napis mówi from 'three', ale to nie import";`,
      `export const OK = 1;`,
    ].join('\n');
    expect(findOffendingSpecifiers(src)).toEqual([]);
  });
});
