import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationFiles } from './harness';
import {
  M35_FILE,
  POST_E4_MIGRATIONS,
  e4ChainMigrationFiles,
  expectedLiveMigrationFiles,
} from './checkFile';

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

function classifiedMigrations(): Record<string, string> {
  return JSON.parse(readFileSync(resolve(CLASSIFICATION), 'utf8')).postgres;
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

  it('classifies every post-E4 migration for rollback before it may ship', () => {
    const classified = classifiedMigrations();
    for (const name of POST_E4_MIGRATIONS) {
      expect(Object.keys(classified), name).toContain(name);
      expect(classified[name], name).toMatch(/^[ABC]$/);
    }
  });

  it('requires every post-E4 migration to sort after migration 35 with a 14-digit version', () => {
    for (const name of POST_E4_MIGRATIONS) {
      expect(name > M35_FILE, name).toBe(true);
      expect(name, name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
    expect(new Set(POST_E4_MIGRATIONS).size).toBe(POST_E4_MIGRATIONS.length);
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

  it('does not mistake an appended migration for a wedge', () => {
    expect(h9BlockDrift([...chain(), PROBE].sort())).toBeNull();
  });
});
