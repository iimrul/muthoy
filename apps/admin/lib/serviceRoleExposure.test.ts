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

  // Batch 3 §8 replaces "zero client files" with an ALLOWLIST. Charts and the
  // map genuinely need a browser, and the plan's own reasoning is that a
  // 'use client' boundary never endangered the service-role key anyway — that
  // key is protected by `server-only` on lib/env.ts, which is a BUILD failure
  // if a client file reaches it. The assertions below are what make the
  // narrower rule stronger than the blanket one it replaces.
  const ALLOWED_CLIENT_FILES: readonly string[] = [
    'components/charts/ChartLoader.tsx',
    'components/charts/PlatformCharts.tsx',
    'components/map/MapCanvas.tsx',
    'components/map/MapLoader.tsx',
  ];

  function clientFiles(): typeof SOURCE_FILES {
    return SOURCE_FILES.filter((file) => /^\s*['"]use client['"]/m.test(file.contents));
  }

  test('only the four presentational chart and map components are client components', () => {
    expect(
      clientFiles()
        .map((file) => file.path)
        .sort(),
    ).toEqual([...ALLOWED_CLIENT_FILES].sort());
  });

  test('every allowlisted client file EXISTS — a stale entry is a hole', () => {
    for (const path of ALLOWED_CLIENT_FILES) {
      expect(
        SOURCE_FILES.map((file) => file.path),
        path,
      ).toContain(path);
    }
  });

  test('no page is a client component, so authorization always runs on the server', () => {
    // The part of the old rule that must never relax: a page running in the
    // browser would be a page whose requireAdminPermission a reader could skip.
    const clientPages = clientFiles().filter((file) => file.path.startsWith('app/'));

    expect(clientPages.map((file) => file.path)).toEqual([]);
  });

  test('no client file reaches a server-only module, even transitively', () => {
    // The real containment. A client file importing lib/env.ts is a BUILD
    // failure, but only once somebody writes that import — this walks the graph
    // so the second and third hops are checked too.
    const byPath = new Map(SOURCE_FILES.map((file) => [file.path, file]));

    function localImports(file: (typeof SOURCE_FILES)[number]): string[] {
      const resolved: string[] = [];
      for (const match of file.code.matchAll(/from\s+'(\.[^']+)'/g)) {
        const specifier = match[1] ?? '';
        const base = new URL(specifier, 'file:///' + file.path).pathname.slice(1);
        for (const candidate of [base + '.ts', base + '.tsx', base]) {
          if (byPath.has(candidate)) {
            resolved.push(candidate);
            break;
          }
        }
      }
      return resolved;
    }

    const offenders: string[] = [];
    for (const entry of clientFiles()) {
      const seen = new Set<string>();
      const queue = localImports(entry);
      while (queue.length > 0) {
        const path = queue.shift() ?? '';
        if (seen.has(path)) continue;
        seen.add(path);
        const file = byPath.get(path);
        if (file === undefined) continue;
        if (/^import 'server-only';$/m.test(file.contents)) {
          offenders.push(entry.path + ' -> ' + path);
          continue;
        }
        queue.push(...localImports(file));
      }
    }

    expect(offenders).toEqual([]);
  });

  test('no client component takes a raw database row as a prop', () => {
    // §8's client-boundary rule: a client component receives already-aggregated,
    // already-suppressed values. A prop typed as a row would be a row crossing
    // the boundary even if today's caller happens to reduce it first.
    const ROW_TYPES = [
      'ShopRow',
      'AccountRow',
      'SubscriptionRow',
      'PaymentOrderRow',
      'EntitlementRow',
      'MembershipRow',
      'SupportCaseRow',
      'SupportNoteRow',
      'ReportShopRow',
      'ReportSaleTotalRow',
      'AdminSettingRow',
      'ShopLocationRow',
    ];

    const offenders: string[] = [];
    for (const file of clientFiles()) {
      for (const type of ROW_TYPES) {
        if (new RegExp('(^|[^A-Za-z])' + type + '([^A-Za-z]|$)').test(file.code)) {
          offenders.push(file.path + ' -> ' + type);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test('nothing is exposed to the browser through a NEXT_PUBLIC_ variable', () => {
    const offenders = SOURCE_FILES.filter((file) => file.code.includes('NEXT_PUBLIC_'));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test('the service-role key is read in exactly one module', () => {
    const readers = SOURCE_FILES.filter((file) => file.code.includes('SUPABASE_SERVICE_ROLE_KEY'));

    expect(readers.map((file) => file.path)).toEqual(['lib/env.ts']);
  });

  // W4-06 added four credential-handling modules; each one that reads a secret
  // or decides authorization carries the same build-time marker.
  test.each([
    'lib/env.ts',
    'lib/supabaseAdmin.ts',
    'lib/queries.ts',
    'lib/adminIdentity.ts',
    'lib/adminLogin.ts',
    'lib/adminAuthz.ts',
  ])('%s is marked server-only', (expectedPath) => {
    const file = SOURCE_FILES.find((candidate) => candidate.path === expectedPath);

    expect(file).toBeDefined();
    expect(file?.contents).toMatch(/^import 'server-only';$/m);
  });

  test('only a server-only module constructs the Supabase client', () => {
    const creators = SOURCE_FILES.filter((file) => file.code.includes('createClient('));

    expect(creators.map((file) => file.path)).toEqual(['lib/supabaseAdmin.ts']);
  });

  // W4-06. The same containment argument as the service-role key, applied to the
  // credentials that now exist: each secret is read in exactly ONE module, and
  // the password hashes are read in a module the Edge middleware cannot pull in.
  test('the session secret is read in exactly one module', () => {
    const readers = SOURCE_FILES.filter((file) => file.code.includes('ADMIN_SESSION_SECRET'));

    expect(readers.map((file) => file.path)).toEqual(['lib/adminSession.ts']);
  });

  test('the password hashes are read in exactly one module', () => {
    const readers = SOURCE_FILES.filter((file) => file.code.includes('ADMIN_ACCOUNTS'));

    expect(readers.map((file) => file.path)).toEqual(['lib/adminIdentity.ts']);
  });

  test('the Edge middleware reaches no module that reads a password', () => {
    const middleware = SOURCE_FILES.find((file) => file.path === 'middleware.ts');

    expect(middleware).toBeDefined();
    for (const forbidden of ['adminIdentity', 'adminLogin', 'ADMIN_ACCOUNTS', 'pbkdf2', 'node:crypto']) {
      expect(middleware?.code).not.toContain(forbidden);
    }
  });

  test('the KDF is called in exactly one module', () => {
    const callers = SOURCE_FILES.filter((file) => file.code.includes('pbkdf2'));

    expect(callers.map((file) => file.path)).toEqual(['lib/adminLogin.ts']);
  });
});
