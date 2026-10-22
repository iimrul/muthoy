// W4-06 — the retirement of Basic Auth, asserted rather than assumed, plus the
// one primitive that outlived it.
//
// The shared-credential gate is gone from the code AND from the environment it
// read. Leaving evaluateBasicAuth importable would leave a second, weaker door
// one import away from being reopened, so its absence is a test, not a comment.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import * as basicAuth from './basicAuth';
import { constantTimeEquals } from './basicAuth';

const ADMIN_ROOT = join(import.meta.dirname, '..');
const IGNORED = new Set(['node_modules', '.next', '.turbo']);

// Comments are stripped, the same guard serviceRoleExposure.test.ts uses:
// basicAuth.ts EXPLAINS what it retired, and prose about a retired variable
// must not read as use of it.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(directory: string): { path: string; contents: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return IGNORED.has(entry.name) ? [] : sourceFiles(absolute);
    if (!/\.(ts|tsx|mjs)$/.test(entry.name)) return [];
    return [{
      path: relative(ADMIN_ROOT, absolute).split(sep).join('/'),
      contents: stripComments(readFileSync(absolute, 'utf8')),
    }];
  });
}

const SOURCES = sourceFiles(ADMIN_ROOT);

describe('Basic Auth is retired', () => {
  test('finds the admin source tree', () => {
    expect(SOURCES.length).toBeGreaterThan(5);
  });

  test('evaluateBasicAuth is no longer exported', () => {
    expect('evaluateBasicAuth' in basicAuth).toBe(false);
  });

  test('the module exports constantTimeEquals and nothing else', () => {
    expect(Object.keys(basicAuth).sort()).toEqual(['constantTimeEquals']);
  });

  test('no source file reads the shared Basic Auth credentials any more', () => {
    const offenders = SOURCES.filter(
      (file) =>
        !file.path.endsWith('basicAuth.test.ts') &&
        /ADMIN_BASIC_AUTH_(?:USER|PASSWORD)/.test(file.contents),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test('no source file sends a WWW-Authenticate challenge any more', () => {
    const offenders = SOURCES.filter(
      (file) => !file.path.endsWith('basicAuth.test.ts') && /WWW-Authenticate/i.test(file.contents),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});

describe('constantTimeEquals', () => {
  test('matches identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
  });

  test('rejects a differing byte at the same length', () => {
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });

  test('rejects differing lengths', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });

  test('compares bytes, not code units, so multi-byte input cannot alias', () => {
    expect(constantTimeEquals('é', 'é')).toBe(false);
  });

  test('two empty strings are equal — the callers never pass one', () => {
    expect(constantTimeEquals('', '')).toBe(true);
  });
});
