import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SIM_VERSION } from '../src/index.js';

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
    const files = globSync('src/**/*.ts', { cwd: new URL('..', import.meta.url).pathname });
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        const isRelative = spec.startsWith('.');
        const isNodeBuiltin = spec.startsWith('node:');
        if (!isRelative && !isNodeBuiltin) offenders.push(`${f}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
