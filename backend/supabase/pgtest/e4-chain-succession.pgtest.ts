import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBareHarness, migrationFiles, type Harness } from './harness';
import {
  E4_CHECK_FILE,
  H9_CHECK_FILE,
  h9BaselineMigrationFiles,
  readOnlyDetailFrom,
  readOnlySectionFrom,
} from './checkFile';

// E4 — the chain succession itself: what each of the two check files says about
// each possible history.
//
// The H-9 check is founder-signed-off evidence and is BYTE-IDENTICAL after this
// batch. It describes the H-9 baseline. The E4 check describes the live chain.
// Both are correct, about different things, and the risk is that a later reader
// assumes one supersedes the other. So this file states the relationship as
// executable assertions rather than as a paragraph:
//
//   * on the BASELINE history, the H-9 section passes and E4's fails;
//   * on the LIVE history, E4's passes and H-9's fails on exactly the two
//     assertions that moved;
//   * on every adverse history, E4's fails and NAMES the offending version.
//
// The last point is the reason the successor exists. h9's section bounds the
// chain with a COUNT plus "nothing after migration 34". That pair cannot see a
// substitution, and a substitution is precisely how a chain stops being the
// chain it claims to be while still looking the right size.

describe('E4 chain succession', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createBareHarness();
    await h.exec(`create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key, name text);`);
  }, 60_000);
  afterAll(async () => { await h?.close(); });

  async function record(names: readonly string[]): Promise<void> {
    await h.exec('truncate supabase_migrations.schema_migrations');
    for (const name of names) {
      await h.exec(`insert into supabase_migrations.schema_migrations (version, name)
        values ('${name.slice(0, 14)}', '${name.slice(15, -4)}')`);
    }
  }

  const live = () => readOnlySectionFrom(h, E4_CHECK_FILE, 'history_e4');
  const liveDetail = () => readOnlyDetailFrom(h, E4_CHECK_FILE, 'history_e4');
  const baseline = () => readOnlySectionFrom(h, H9_CHECK_FILE, 'history_post_h9');

  it('accepts the live 35-version chain', async () => {
    await record(migrationFiles());
    const checks = await live();
    expect(Object.entries(checks).filter(([, pass]) => pass !== true).map(([n]) => n)).toEqual([]);
    expect(Object.keys(checks)).toHaveLength(5);
  });

  it('refuses the H-9 baseline, because E4 is missing from it', async () => {
    await record(h9BaselineMigrationFiles());
    const checks = await live();
    expect(checks.history_has_no_missing_version).toBe(false);
    expect(checks.history_e4_immediately_follows_h9).toBe(false);
    // Nothing EXTRA is wrong with the baseline — it is a prefix, not a forgery.
    expect(checks.history_has_no_extra_version).toBe(true);
    expect(checks.history_has_all_h9_versions).toBe(true);

    const detail = await liveDetail();
    expect(detail.history_has_no_missing_version).toBe('20261023000000');
  });

  it('and the H-9 check still PASSES on that same baseline, unchanged', async () => {
    await record(h9BaselineMigrationFiles());
    // The point of keeping that file byte-identical: it is not stale, it is
    // scoped. On the history it describes, it is still entirely correct.
    expect(Object.values(await baseline()).every(Boolean)).toBe(true);
  });

  it('catches a same-count substitution, which the H-9 check cannot', async () => {
    const substituted = migrationFiles()
      .filter((name) => !name.startsWith('20260817000100'))
      .concat(['20260817000199_impostor.sql']);
    await record(substituted);

    const checks = await live();
    expect(checks.history_has_no_missing_version).toBe(false);
    expect(checks.history_has_no_extra_version).toBe(false);

    const detail = await liveDetail();
    expect(detail.history_has_no_missing_version).toBe('20260817000100');
    expect(detail.history_has_no_extra_version).toBe('20260817000199');

    // The substitution leaves the H-9 trio untouched, so the one assertion in
    // the older check that concerns the signed-off block sees nothing wrong.
    const h9 = await baseline();
    expect(h9.history_has_all_h9_versions).toBe(true);
  });

  it('catches anything appended after E4', async () => {
    await record(migrationFiles().concat(['20261231000000_unapproved.sql']));
    const checks = await live();
    expect(checks.history_has_no_extra_version).toBe(false);
    expect(checks.history_e4_immediately_follows_h9).toBe(false);
    expect((await liveDetail()).history_has_no_extra_version).toBe('20261231000000');
  });

  it('catches a migration inserted INSIDE the signed-off H-9 block', async () => {
    // The shape that would mean the block was reopened rather than extended.
    await record(migrationFiles().concat(['20261009000000_wedged.sql']));
    const checks = await live();
    expect(checks.history_h9_block_is_contiguous).toBe(false);
    expect(checks.history_has_no_extra_version).toBe(false);
    expect((await liveDetail()).history_h9_block_is_contiguous).toBe('20261009000000');
  });

  it('catches a missing H-9 version even when the count is restored', async () => {
    const withoutH9Middle = migrationFiles()
      .filter((name) => !name.startsWith('20261008000100'))
      .concat(['20260901000000_filler.sql']);
    await record(withoutH9Middle);
    const checks = await live();
    expect(checks.history_has_all_h9_versions).toBe(false);
    expect(checks.history_has_no_missing_version).toBe(false);
    expect(checks.history_has_no_extra_version).toBe(false);
  });

  it('refuses an empty history rather than passing vacuously', async () => {
    await record([]);
    const checks = await live();
    // Every "no missing" style assertion must FAIL on nothing at all. A check
    // that passes on an empty database is a check that proves nothing.
    expect(checks.history_has_no_missing_version).toBe(false);
    expect(checks.history_has_all_h9_versions).toBe(false);
    expect(checks.history_e4_immediately_follows_h9).toBe(false);
    // "No extra" is vacuously true on an empty set, which is correct and is
    // exactly why it cannot be the only assertion.
    expect(checks.history_has_no_extra_version).toBe(true);
  });
});
