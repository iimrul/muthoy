import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationFiles } from './harness';
import {
  M35_FILE,
  POST_E4_MIGRATIONS,
  e4ChainMigrationFiles,
  expectedLiveMigrationFiles,
} from './checkFile';
import {
  E4_MIGRATIONS,
  EXPECTED_CHAIN,
  H9_MIGRATIONS,
} from '../../../scripts/h9-prod-preflight.mjs';

// THE LIVE CHAIN GATE — founder Option B, approved 2026-10-30.
//
// Four gates used to describe the live chain by reading the migrations
// directory and asserting that nothing followed migration 35. Staging one
// throwaway migration broke 13 tests across four files; three of those files
// are E4 acceptance evidence. That was measured, not argued.
//
// Option B keeps those fixtures describing the histories they were signed off
// against — the same move h9BaselineMigrationFiles made for H-9 when E4
// extended the chain — and gives the LIVE chain its own gate, here. Nothing
// sealed is edited: e4_postmigration_checks.sql, h9_postmigration_checks.sql,
// migration 34 and migration 35 are all byte-identical.
//
// This file owns one claim: the chain on disk is exactly the chain that was
// approved. Adding a migration means declaring it in POST_E4_MIGRATIONS and
// classifying it for rollback, and until both are done this gate fails.
//
// NON-VACUITY. POST_E4_MIGRATIONS is empty today, so the assertions about the
// live chain would pass against almost any implementation. Every one of them is
// therefore also exercised against synthetic histories below, where the answer
// is known. A gate that only ever sees the passing case proves nothing, which
// is the mistake this project has already made five times.

const H9_TRIO = ['20261008000000', '20261008000100', '20261015000000'] as const;
const CLASSIFICATION = 'backend/supabase/migrations/rollback-classification.json';
const E4_MANIFEST = 'backend/supabase/migrations/e4-source-hashes.json';
/** Where a post-E4 byte-pin would live. Nothing creates it yet, deliberately. */
const SUCCESSOR_MANIFEST = 'backend/supabase/migrations/post-e4-source-hashes.json';

/** Exact set membership in both directions, naming every offender. */
export function membershipDrift(
  live: readonly string[],
  expected: readonly string[],
): { missing: string[]; extra: string[] } {
  const liveSet = new Set(live);
  const expectedSet = new Set(expected);
  return {
    missing: expected.filter((name) => !liveSet.has(name)),
    extra: live.filter((name) => !expectedSet.has(name)),
  };
}

/**
 * The H-9 block must be three CONSECUTIVE files. Returns the version that
 * breaks it, or null. A count cannot see a wedge, which is the whole reason the
 * E4 successor was written in the first place.
 */
export function h9BlockDrift(chain: readonly string[]): string | null {
  const at = H9_TRIO.map((version) => chain.findIndex((name) => name.startsWith(version)));
  const absent = at.findIndex((index) => index < 0);
  if (absent >= 0) return H9_TRIO[absent];
  if (at[1] !== at[0] + 1) return chain[at[0] + 1]!.slice(0, 14);
  if (at[2] !== at[1] + 1) return chain[at[1] + 1]!.slice(0, 14);
  return null;
}

/** The 14-digit version prefix, which is what the chain is actually keyed by. */
export function versionOf(name: string): string {
  return name.slice(0, 14);
}

/**
 * ROUND 10 FINDING 4. Comparing FILENAMES let a duplicate version through:
 * `20261023000000_z_duplicate_version.sql` sorts after migration 35's filename
 * while repeating its version, and Postgres keys `schema_migrations` by the
 * version alone. So the chain is checked by version, strictly increasing and
 * unique, across the whole of it.
 */
export function versionOrderDrift(chain: readonly string[]): string | null {
  const versions = chain.map(versionOf);
  for (let i = 1; i < versions.length; i++) {
    if (versions[i]! <= versions[i - 1]!) return versions[i]!;
  }
  return null;
}

/** The three filesystem facts the byte-pin check needs, injectable for tests. */
export interface PinSource {
  readonly path: string;
  exists(): boolean;
  isFile(): boolean;
  read(): string;
}

/** The real successor byte-pin, read from disk. */
export function pinSourceOnDisk(path: string): PinSource {
  return {
    path,
    exists: () => existsSync(path),
    isFile: () => statSync(path).isFile(),
    read: () => readFileSync(path, 'utf8'),
  };
}

/** Reads a migration's bytes, or null when it is not on disk. */
export function migrationBytesOnDisk(name: string): Buffer | null {
  const path = resolve('backend/supabase/migrations', name);
  return existsSync(path) ? readFileSync(path) : null;
}

/**
 * What is wrong with the successor byte-pin for this declared set, or null.
 *
 * ROUND 11 FINDING 2. My first version checked that a FILENAME EXISTED and
 * nothing more. The reviewer made all 21 assertions pass by reporting a
 * manifest with garbage contents, and counted zero reads of it. A guard that
 * never opens the thing it guards is not a guard.
 *
 * So this reads it. The file must parse, cover exactly the declared set, and
 * carry a digest matching the migration's ACTUAL bytes. An empty file, a
 * directory, an undeclared entry, a malformed digest and a stale hash each
 * fail, and the caller is told which.
 */
export function successorPinDrift(
  declared: readonly string[],
  source: PinSource,
  migrationBytes: (name: string) => Buffer | null,
): string | null {
  if (declared.length === 0) return null;
  if (!source.exists()) return `no successor byte-pin at ${source.path}`;
  if (!source.isFile()) return `${source.path} is not a file`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source.read());
  } catch {
    return `${source.path} is not valid JSON`;
  }
  const files = (parsed as { files?: unknown } | null)?.files;
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    return `${source.path} has no files map`;
  }
  const recorded = files as Record<string, unknown>;

  for (const extra of Object.keys(recorded)) {
    if (!declared.includes(extra)) {
      return `${source.path} records an undeclared migration: ${extra}`;
    }
  }
  for (const name of declared) {
    const hash = recorded[name];
    if (typeof hash !== 'string') return `${source.path} does not record ${name}`;
    if (!/^[a-f0-9]{64}$/.test(hash)) return `${source.path} records a malformed digest for ${name}`;
    const bytes = migrationBytes(name);
    if (bytes === null) return `${name} is declared and pinned but absent from disk`;
    if (createHash('sha256').update(bytes).digest('hex') !== hash) {
      return `${name} does not match its recorded digest`;
    }
  }
  return null;
}

function classifiedMigrations(): Record<string, string> {
  return JSON.parse(readFileSync(resolve(CLASSIFICATION), 'utf8')).postgres;
}

/**
 * What is wrong with the rollback classification of this declared set, or null.
 *
 * ROUND 12 FINDING 2. This was two inline assertions inside a loop over a list
 * that is empty today, so removing BOTH of them left every test passing. A
 * predicate can be exercised with a non-empty set, which is the only way the
 * rule is not dormant.
 */
export function classificationDrift(
  declared: readonly string[],
  classified: Record<string, unknown>,
): string | null {
  for (const name of declared) {
    const grade: unknown = classified[name];
    if (grade === undefined) return `${name} is not classified for rollback`;
    // ROUND 13 FINDING 2, a regression I introduced. `RegExp.test` COERCES, so
    // `['A']` stringifies to 'A' and passed -- where the `toMatch()` matcher
    // this replaced rejected any non-string. The type check is explicit now.
    if (typeof grade !== 'string') return `${name} has a non-string rollback class`;
    if (!/^[ABC]$/.test(grade)) return `${name} has an invalid rollback class: ${grade}`;
  }
  return null;
}

describe('the live migration chain is exactly the approved chain', () => {
  it('is the E4 chain plus exactly what was approved after it', () => {
    expect(membershipDrift(migrationFiles(), expectedLiveMigrationFiles())).toEqual({
      missing: [],
      extra: [],
    });
  });

  it('keeps the E4 chain as a real prefix, so the sealed fixtures still describe it', () => {
    // If this fails, the E4 and H-9 fixtures are describing a history that no
    // longer exists as a prefix of the live one, and re-scoping them was wrong.
    const live = migrationFiles();
    expect(live.slice(0, e4ChainMigrationFiles().length)).toEqual(e4ChainMigrationFiles());
    expect(e4ChainMigrationFiles().at(-1)).toBe(M35_FILE);
  });

  it('keeps the H-9 block contiguous', () => {
    expect(h9BlockDrift(migrationFiles())).toBeNull();
  });

  it('keeps the production preflight in step with the declared chain', () => {
    // THE SIXTH GATE, and it fails differently from the other five: it never
    // reads the migrations directory, so a new migration does not make it fail
    // -- it makes it SILENTLY WRONG, and you find out when a hosted preflight
    // refuses a legitimate workdir with `migration-chain-unexpected`.
    //
    // Its own comment says the list is "hardcoded deliberately ... so deriving
    // it from that workdir would make the check circular", and that is right:
    // it must stay an independent expectation at run time. Two independent
    // declarations are fine; two that can drift apart unnoticed are not. So the
    // preflight keeps its own list and this asserts the two agree.
    expect([...EXPECTED_CHAIN]).toEqual(expectedLiveMigrationFiles());

    // ROUND 11 FINDING 3. EXPECTED_CHAIN is not the preflight's only chain
    // constraint: it separately requires the whole post-H9 tail to equal
    // E4_MIGRATIONS, so a successor declared in BOTH the chain and
    // EXPECTED_CHAIN still returned `migration-chain-unexpected`. Both of its
    // declarations are cross-checked here, not just the first one I found.
    const live = expectedLiveMigrationFiles();
    const h9Start = live.indexOf(H9_MIGRATIONS[0]!);
    expect(h9Start).toBeGreaterThan(0);
    expect(live.slice(h9Start, h9Start + H9_MIGRATIONS.length)).toEqual([...H9_MIGRATIONS]);
    expect(live.slice(h9Start + H9_MIGRATIONS.length)).toEqual([...E4_MIGRATIONS]);
  });

  it('keeps the E4 evidence manifest scoped to the chain it is evidence about', () => {
    // ROUND 10 FINDING 2's third constraint. The manifest read the whole
    // directory, so a later migration pushed its counts to 36/49 while
    // e4-evidence-manifest.test.ts asserts 35/48 -- statements about what was
    // ACCEPTED, which regeneration cannot satisfy. It is now bounded to the E4
    // chain, and this stops that bound drifting back open.
    const manifest = JSON.parse(readFileSync(resolve(E4_MANIFEST), 'utf8'));
    expect(manifest.expectedChain).toEqual(e4ChainMigrationFiles().map(versionOf));
    expect(manifest.counts.migrations).toBe(e4ChainMigrationFiles().length);
    for (const name of POST_E4_MIGRATIONS) {
      expect(Object.keys(manifest.files), name).not.toContain(
        `backend/supabase/migrations/${name}`,
      );
    }
  });

  it('refuses a post-E4 migration whose BYTES are pinned nowhere', () => {
    // The gap Option B leaves, made blocking instead of silent. A post-E4
    // migration's chain MEMBERSHIP is covered three ways -- declaration,
    // rollback class, and the preflight's EXPECTED_CHAIN -- but the E4 manifest
    // is correctly not evidence about it, so nothing pins its bytes.
    //
    // This fails the moment one is declared without a successor byte-pin, and
    // the message says what to build. It is dormant while the list is empty,
    // which is why the two assertions below also exercise it directly.
    expect(
      successorPinDrift(
        POST_E4_MIGRATIONS,
        pinSourceOnDisk(resolve(SUCCESSOR_MANIFEST)),
        migrationBytesOnDisk,
      ),
      `Create ${SUCCESSOR_MANIFEST} holding {"files":{"<migration>.sql":"<sha256>"}} for every ` +
        `post-E4 migration, before any of them is applied to a hosted project.`,
    ).toBeNull();
  });

  it('classifies every post-E4 migration for rollback before it may ship', () => {
    expect(classificationDrift(POST_E4_MIGRATIONS, classifiedMigrations())).toBeNull();
  });

  it('requires every post-E4 migration to have a 14-digit version AFTER migration 35', () => {
    for (const name of POST_E4_MIGRATIONS) {
      expect(name, name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
      // By VERSION, not by filename -- round 10 finding 4.
      expect(versionOf(name) > versionOf(M35_FILE), name).toBe(true);
    }
    expect(new Set(POST_E4_MIGRATIONS).size).toBe(POST_E4_MIGRATIONS.length);
  });

  it('keeps every version in the live chain unique and strictly increasing', () => {
    expect(versionOrderDrift(migrationFiles())).toBeNull();
    expect(new Set(migrationFiles().map(versionOf)).size).toBe(migrationFiles().length);
  });
});

describe('the live chain gate, against histories where the answer is known', () => {
  const chain = () => e4ChainMigrationFiles();
  const PROBE = '20261231000001_undeclared.sql';

  it('catches a migration on disk that was never declared', () => {
    // The exact case that blocked the publication snapshot.
    expect(membershipDrift([...chain(), PROBE], chain())).toEqual({
      missing: [],
      extra: [PROBE],
    });
  });

  it('accepts that same migration once it is declared', () => {
    expect(membershipDrift([...chain(), PROBE], [...chain(), PROBE])).toEqual({
      missing: [],
      extra: [],
    });
  });

  it('catches a declared migration that is missing from disk', () => {
    expect(membershipDrift(chain(), [...chain(), PROBE])).toEqual({
      missing: [PROBE],
      extra: [],
    });
  });

  it('catches a same-count substitution, which a count cannot', () => {
    const substituted = [...chain().slice(0, -1), '20261023000001_impostor.sql'];
    const drift = membershipDrift(substituted, chain());
    expect(drift.missing).toEqual([M35_FILE]);
    expect(drift.extra).toEqual(['20261023000001_impostor.sql']);
    expect(substituted).toHaveLength(chain().length);
  });

  it('refuses an empty history rather than passing vacuously', () => {
    const drift = membershipDrift([], chain());
    expect(drift.missing).toHaveLength(chain().length);
    // "Extra" is vacuously empty on nothing at all, which is exactly why it
    // cannot be the only direction checked.
    expect(drift.extra).toEqual([]);
    expect(h9BlockDrift([])).toBe(H9_TRIO[0]);
  });

  it('catches a migration wedged inside the H-9 block', () => {
    const wedged = [...chain(), '20261009000000_wedged.sql'].sort();
    expect(h9BlockDrift(wedged)).toBe('20261009000000');
  });

  it('catches a missing H-9 version even when the count is restored', () => {
    const withoutMiddle = [
      ...chain().filter((name) => !name.startsWith('20261008000100')),
      '20260901000000_filler.sql',
    ].sort();
    expect(h9BlockDrift(withoutMiddle)).toBe('20261008000100');
  });

  it('catches a duplicate version hiding behind a later-sorting filename', () => {
    // The reviewer's exact case. It sorts after migration 35 and repeats its
    // version, so a filename comparison admits it and Postgres would collide.
    const duplicate = '20261023000000_z_duplicate_version.sql';
    expect(duplicate > M35_FILE).toBe(true);
    expect(versionOf(duplicate)).toBe(versionOf(M35_FILE));
    expect(versionOf(duplicate) > versionOf(M35_FILE)).toBe(false);
    expect(versionOrderDrift([...chain(), duplicate])).toBe('20261023000000');
  });

  it('catches an out-of-order version even when every name is distinct', () => {
    expect(versionOrderDrift(['20261023000000_a.sql', '20261001000000_b.sql']))
      .toBe('20261001000000');
  });

  it('accepts a genuine successor by version', () => {
    expect(versionOrderDrift([...chain(), '20261231000001_real_successor.sql'])).toBeNull();
  });

  it('reads the successor byte-pin rather than trusting that a file exists', () => {
    // ROUND 11 FINDING 2's reproduction, as cases. A manifest that merely
    // EXISTS must not satisfy this, and nor must one whose contents are wrong.
    const NAME = '20261231000001_real.sql';
    const BYTES = Buffer.from('-- successor\nselect 1;\n');
    const DIGEST = createHash('sha256').update(BYTES).digest('hex');
    const bytes = (n: string) => (n === NAME ? BYTES : null);

    const src = (
      text: string,
      options: { exists?: boolean; isFile?: boolean } = {},
    ): PinSource => ({
      path: 'post-e4-source-hashes.json',
      exists: () => options.exists ?? true,
      isFile: () => options.isFile ?? true,
      read: () => text,
    });
    const pin = (files: string) => src(`{"files":${files}}`);

    // Nothing declared: nothing required.
    expect(successorPinDrift([], src('', { exists: false }), bytes)).toBeNull();

    // Declared, but the pin is absent or is not a file.
    expect(successorPinDrift([NAME], src('', { exists: false }), bytes))
      .toMatch(/no successor byte-pin/);
    expect(successorPinDrift([NAME], src('', { isFile: false }), bytes))
      .toMatch(/is not a file/);

    // Present, and useless -- the exact shape that passed before.
    expect(successorPinDrift([NAME], src('not json at all'), bytes)).toMatch(/not valid JSON/);
    expect(successorPinDrift([NAME], src(''), bytes)).toMatch(/not valid JSON/);
    expect(successorPinDrift([NAME], src('{}'), bytes)).toMatch(/no files map/);
    expect(successorPinDrift([NAME], pin('[]'), bytes)).toMatch(/no files map/);

    // Present and specific, but incomplete, malformed, undeclared or stale.
    expect(successorPinDrift([NAME], pin('{}'), bytes)).toMatch(/does not record/);
    expect(successorPinDrift([NAME], pin(`{"${NAME}":"nope"}`), bytes))
      .toMatch(/malformed digest/);
    expect(successorPinDrift([NAME], pin(`{"${NAME}":"${'a'.repeat(64)}"}`), bytes))
      .toMatch(/does not match its recorded digest/);
    expect(
      successorPinDrift([NAME], pin(`{"${NAME}":"${DIGEST}","other.sql":"${DIGEST}"}`), bytes),
    ).toMatch(/records an undeclared migration/);
    expect(successorPinDrift([NAME], pin(`{"${NAME}":"${DIGEST}"}`), () => null))
      .toMatch(/absent from disk/);

    // And the one shape that is correct.
    expect(successorPinDrift([NAME], pin(`{"${NAME}":"${DIGEST}"}`), bytes)).toBeNull();
  });

  it('demands a rollback class for a declared migration, with a valid grade', () => {
    // ROUND 12 FINDING 2: the real assertions are dormant while the declared
    // list is empty, so the rule is exercised here against a non-empty one.
    const NAME = '20261231000001_real.sql';
    expect(classificationDrift([], {})).toBeNull();
    expect(classificationDrift([NAME], {})).toMatch(/not classified for rollback/);
    expect(classificationDrift([NAME], { [NAME]: 'D' })).toMatch(/invalid rollback class/);
    expect(classificationDrift([NAME], { [NAME]: '' })).toMatch(/invalid rollback class/);
    // ROUND 13 FINDING 2: a one-element array stringifies to a valid grade, so
    // it has to be rejected by TYPE rather than by pattern.
    for (const coercible of [['A'], ['B'], ['C'], 1, true, {}, null]) {
      expect(classificationDrift([NAME], { [NAME]: coercible }), String(coercible))
        .toMatch(/non-string rollback class/);
    }
    for (const grade of ['A', 'B', 'C']) {
      expect(classificationDrift([NAME], { [NAME]: grade })).toBeNull();
    }
    // And the live chain's own migrations really are all classified.
    expect(classificationDrift(e4ChainMigrationFiles(), classifiedMigrations())).toBeNull();
  });

  it('exercises the REAL disk adapter, not only injected doubles', () => {
    // ROUND 12 FINDING 2: every negative pin case above injects a double, and
    // with no successor declared `pinSourceOnDisk` was never called at all --
    // replacing its read() with a constant left everything green. These cases
    // drive the real adapter against real files.
    const NAME = '20261231000001_real.sql';
    const BYTES = Buffer.from('-- successor\nselect 1;\n');
    const DIGEST = createHash('sha256').update(BYTES).digest('hex');
    const bytes = (n: string) => (n === NAME ? BYTES : null);

    const dir = mkdtempSync(join(tmpdir(), 'post-e4-pin-'));
    try {
      // A path that does not exist: the real adapter must say so.
      const absent = pinSourceOnDisk(join(dir, 'absent.json'));
      expect(absent.exists()).toBe(false);
      expect(successorPinDrift([NAME], absent, bytes)).toMatch(/no successor byte-pin/);

      // A directory, through the real adapter.
      const asDirectory = pinSourceOnDisk(dir);
      expect(asDirectory.exists()).toBe(true);
      expect(asDirectory.isFile()).toBe(false);
      expect(successorPinDrift([NAME], asDirectory, bytes)).toMatch(/is not a file/);

      // A real file holding garbage, then a wrong digest, then the right one.
      const path = join(dir, 'post-e4-source-hashes.json');
      writeFileSync(path, 'garbage');
      const real = pinSourceOnDisk(path);
      expect(real.read()).toBe('garbage');
      expect(successorPinDrift([NAME], real, bytes)).toMatch(/not valid JSON/);

      writeFileSync(path, JSON.stringify({ files: { [NAME]: 'b'.repeat(64) } }));
      expect(successorPinDrift([NAME], pinSourceOnDisk(path), bytes))
        .toMatch(/does not match its recorded digest/);

      writeFileSync(path, JSON.stringify({ files: { [NAME]: DIGEST } }));
      expect(successorPinDrift([NAME], pinSourceOnDisk(path), bytes)).toBeNull();

      // ROUND 13 FINDING 3: every case above injects the bytes reader, so
      // `migrationBytesOnDisk` itself stayed dormant -- replacing it with
      // `return null` left everything green. These drive the REAL reader.
      expect(migrationBytesOnDisk('20261231999999_not_on_disk.sql')).toBeNull();
      const realBytes = migrationBytesOnDisk(M35_FILE);
      expect(realBytes).not.toBeNull();
      expect(realBytes!.length).toBeGreaterThan(0);
      const realDigest = createHash('sha256').update(realBytes!).digest('hex');

      // End to end through BOTH real adapters: a pin recording migration 35's
      // actual digest passes, and one digit changed does not.
      writeFileSync(path, JSON.stringify({ files: { [M35_FILE]: realDigest } }));
      expect(successorPinDrift([M35_FILE], pinSourceOnDisk(path), migrationBytesOnDisk)).toBeNull();

      const wrong = realDigest.slice(0, -1) + (realDigest.endsWith('0') ? '1' : '0');
      writeFileSync(path, JSON.stringify({ files: { [M35_FILE]: wrong } }));
      expect(successorPinDrift([M35_FILE], pinSourceOnDisk(path), migrationBytesOnDisk))
        .toMatch(/does not match its recorded digest/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not mistake an appended migration for a wedge', () => {
    expect(h9BlockDrift([...chain(), PROBE].sort())).toBeNull();
  });
});
