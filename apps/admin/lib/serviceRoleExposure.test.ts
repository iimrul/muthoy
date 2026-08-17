// Volume 5's one rule, enforced mechanically: the service-role key must never
// reach the browser bundle. `next build` already fails if a 'use client' file
// imports a `server-only` module, but that only helps once someone writes the
// import. These assertions guard the shape that makes the leak possible at all.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const ADMIN_ROOT = join(import.meta.dirname, '..');
const IGNORED_DIRECTORIES = new Set(['node_modules', '.next', '.turbo']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
// Tests never reach a browser bundle, and this file quotes every string it
// searches for — scanning tests would only ever match this file itself.
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

interface SourceFile {
  /** Path relative to apps/admin, always with forward slashes. */
  path: string;
  contents: string;
  /** Comments removed, so prose ABOUT a forbidden token is not mistaken for use of it. */
  code: string;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function collectSourceFiles(directory: string): SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : collectSourceFiles(absolutePath);
    }
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      return [];
    }
    if (TEST_FILE_PATTERN.test(entry.name)) {
      return [];
    }
    const contents = readFileSync(absolutePath, 'utf8');

    return [
      {
        path: relative(ADMIN_ROOT, absolutePath).split(sep).join('/'),
        contents,
        code: stripComments(contents),
      },
    ];
  });
}

const SOURCE_FILES = collectSourceFiles(ADMIN_ROOT);

describe('service-role key exposure guards', () => {
  test('finds the admin source tree', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(5);
  });

  test('no page or component is a client component', () => {
    const clientFiles = SOURCE_FILES.filter(
      (file) =>
        (file.path.startsWith('app/') || file.path.startsWith('components/')) &&
        /^\s*['"]use client['"]/m.test(file.contents),
    );

    expect(clientFiles.map((file) => file.path)).toEqual([]);
  });

  test('nothing is exposed to the browser through a NEXT_PUBLIC_ variable', () => {
    const offenders = SOURCE_FILES.filter((file) => file.code.includes('NEXT_PUBLIC_'));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test('the service-role key is read in exactly one module', () => {
    const readers = SOURCE_FILES.filter((file) => file.code.includes('SUPABASE_SERVICE_ROLE_KEY'));

    expect(readers.map((file) => file.path)).toEqual(['lib/env.ts']);
  });

  test.each(['lib/env.ts', 'lib/supabaseAdmin.ts', 'lib/queries.ts'])('%s is marked server-only', (expectedPath) => {
    const file = SOURCE_FILES.find((candidate) => candidate.path === expectedPath);

    expect(file).toBeDefined();
    expect(file?.contents).toMatch(/^import 'server-only';$/m);
  });

  test('only a server-only module constructs the Supabase client', () => {
    const creators = SOURCE_FILES.filter((file) => file.code.includes('createClient('));

    expect(creators.map((file) => file.path)).toEqual(['lib/supabaseAdmin.ts']);
  });
});
