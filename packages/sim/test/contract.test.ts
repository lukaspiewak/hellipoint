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
  let token = scanner.scan();

  while (token !== SyntaxKind.EndOfFile) {
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
