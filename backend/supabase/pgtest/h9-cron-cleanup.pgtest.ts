import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createBareHarness,
  HOSTED_FUNCTION_EXECUTE_MODEL,
  migrationFiles,
  migrationSql,
  OWNER_A,
  SHOP_A,
  seedShops,
  type Harness,
} from './harness';
import {
  E4_CHECK_FILE,
  H9_CHECK_FILE,
  checkSectionFrom,
  h9BaselineMigrationFiles,
  readOnlyDetailFrom,
  readOnlySectionFrom,
} from './checkFile';

// H-9 §8.4 — forward migration 33 and the cleanup it schedules, executed.
//
// PGlite cannot load pg_cron, so the "installed" path runs against a
// TEST-ONLY stand-in: a pg_extension row inserted as superuser (possible only
// in this disposable database), the pg_cron 1.6 cron.job columns, and a
// cron.schedule() that records each call and, like pg_cron's own, stamps the
// job with this server's target (cron.host, port). It proves migration 33's
// guards and its convergence with B2's own conditional schedule — never that a
// scheduler runs. A real job run is the Phase 3 hosted rehearsal's job.

const M33 = '20261008000100_h9_sync_staging_cleanup_schedule.sql';
const JOB = 'muthoy-b2-sync-staging-cleanup';
const SCHEDULE = '17 3 * * *';
const COMMAND = 'select public.sync_cleanup_incomplete_operations();';
const FUNCTION = 'public.sync_cleanup_incomplete_operations()';

/** Test-only pg_cron 1.6 stand-in. See the header: this proves guards, not a scheduler. */
const PG_CRON_STUB = `
  create schema cron;
  create table cron.job (
    jobid bigserial primary key,
    schedule text not null,
    command text not null,
    nodename text not null default 'localhost',
    nodeport integer not null default 5432,
    database text not null default current_database(),
    username text not null default current_user,
    active boolean not null default true,
    jobname text,
    constraint jobname_username_uniq unique (jobname, username)
  );
  create table cron.job_run_details (
    jobid bigint, runid bigserial primary key, status text, start_time timestamptz, end_time timestamptz
  );
  create table cron.h9_schedule_calls (jobname text, schedule text, command text, called_by text);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
  language plpgsql as $stub$
  declare v_id bigint;
  begin
    insert into cron.h9_schedule_calls values (job_name, schedule, command, current_user);
    insert into cron.job (jobname, schedule, command, nodename, nodeport)
      values (job_name, schedule, command, current_setting('cron.host'), current_setting('port')::integer)
      on conflict (jobname, username) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid into v_id;
    return v_id;
  end
  $stub$;
  insert into pg_catalog.pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion)
    values (987654, 'pg_cron', 10, 'cron'::regnamespace, false, '1.6');
  set cron.timezone = 'GMT';
  set cron.host = 'localhost';
`;

async function chain(options: { stubFirst?: boolean; stopBefore?: string } = {}): Promise<Harness> {
  const h = await createBareHarness();
  if (options.stubFirst) await h.exec(PG_CRON_STUB);
  for (const name of migrationFiles()) {
    if (options.stopBefore && name >= options.stopBefore) break;
    await h.exec(migrationSql(name));
  }
  await h.exec(HOSTED_FUNCTION_EXECUTE_MODEL);
  return h;
}

interface Job { schedule: string; command: string; nodename: string; nodeport: number; database: string; username: string; active: boolean }

async function jobs(h: Harness): Promise<Job[]> {
  return h.all<Job>(`select schedule, command, nodename, nodeport, database, username, active
    from cron.job where jobname = $1 order by jobid`, [JOB]);
}

async function scheduleCalls(h: Harness): Promise<number> {
  return (await h.one<{ count: number }>(`select count(*)::int as count from cron.h9_schedule_calls`)).count;
}

// The stand-in server's own target: the stub's cron.host and PGlite's port.
const APPROVED_JOB: Job = {
  schedule: SCHEDULE, command: COMMAND, nodename: 'localhost', nodeport: 5432,
  database: 'postgres', username: 'postgres', active: true,
};

// Delegates to the shared reader so the H-9 and E4 check files have ONE parser
// between them. The signature is unchanged, so every call site below — and
// there are many — keeps its exact shape.
function checkSection(section: string): string {
  return checkSectionFrom(H9_CHECK_FILE, section);
}

/** One section of the runbook's read-only checks, run in a READ ONLY transaction. */
async function readOnlyChecks(h: Harness, section: string): Promise<Record<string, boolean>> {
  await h.exec('begin transaction read only');
  try {
    const rows = await h.all<{ check_name: string; pass: boolean }>(checkSection(section));
    return Object.fromEntries(rows.map((row) => [row.check_name, row.pass]));
  } finally {
    await h.exec('rollback');
  }
}

describe('without pg_cron (PGlite, DEV)', () => {
  let h: Harness;
  beforeAll(async () => { h = await chain(); }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('creates no scheduler objects', async () => {
    expect(await h.one(`select to_regnamespace('cron') is null as absent`)).toEqual({ absent: true });
  });

  it('stays a no-op when it runs again', async () => {
    await expect(h.exec(migrationSql(M33))).resolves.toBeUndefined();
    expect(await h.one(`select to_regnamespace('cron') is null as absent`)).toEqual({ absent: true });
  });
});

describe('pg_cron enabled before the chain (the PROD and rehearsal order)', () => {
  let h: Harness;
  beforeAll(async () => { h = await chain({ stubFirst: true }); }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('converges on B2\'s own job: exactly one, scheduled once, by B2', async () => {
    expect(await jobs(h)).toEqual([APPROVED_JOB]);
    expect(await scheduleCalls(h)).toBe(1);
  });

  it('accepts B2\'s job on this server when it runs again, and schedules nothing', async () => {
    await h.exec(migrationSql(M33));
    expect(await jobs(h)).toEqual([APPROVED_JOB]);
    expect(await scheduleCalls(h)).toBe(1);
  });

  it('passes the read-only runbook cron checks', async () => {
    expect(await readOnlyChecks(h, 'cron')).toEqual({
      pg_cron_installed: true,
      cron_timezone_utc: true,
      staging_cleanup_job_unique: true,
      staging_cleanup_job_exact: true,
      staging_cleanup_job_targets_this_server: true,
    });
  });

  it.each([
    ['another host', `update cron.job set nodename = 'foreign-db.invalid' where jobname = '${JOB}'`],
    ['another port', `update cron.job set nodeport = 6543 where jobname = '${JOB}'`],
    ['foreign-db.invalid:6543', `update cron.job set nodename = 'foreign-db.invalid', nodeport = 6543 where jobname = '${JOB}'`],
  ])('flags a job aimed at %s in the read-only runbook checks', async (_label, setup) => {
    await h.exec('begin');
    try {
      await h.exec(setup);
      const rows = await h.all<{ check_name: string; pass: boolean }>(checkSection('cron'));
      expect(Object.fromEntries(rows.map((row) => [row.check_name, row.pass])))
        .toMatchObject({ staging_cleanup_job_exact: true, staging_cleanup_job_targets_this_server: false });
    } finally {
      await h.exec('rollback');
    }
  });

  it('reports a successful run only once the scheduler has recorded one (rehearsal check)', async () => {
    expect(await readOnlyChecks(h, 'cron_runs')).toEqual({ staging_cleanup_latest_run_succeeded: false });
    await h.exec('begin');
    try {
      await h.exec(`insert into cron.job_run_details (jobid, status, start_time)
        select jobid, 'succeeded', now() from cron.job where jobname = '${JOB}'`);
      const rows = await h.all<{ pass: boolean }>(checkSection('cron_runs'));
      expect(rows.map((row) => row.pass)).toEqual([true]);
    } finally {
      await h.exec('rollback');
    }
  });
});

describe('pg_cron enabled after B2 ran (B2 skipped; migration 33 schedules)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await chain({ stopBefore: M33 });
    await h.exec(PG_CRON_STUB);
    await h.exec(migrationSql(M33));
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('schedules the approved job exactly once through cron.schedule', async () => {
    expect(await jobs(h)).toEqual([APPROVED_JOB]);
    expect(await h.all(`select jobname, schedule, command, called_by from cron.h9_schedule_calls`))
      .toEqual([{ jobname: JOB, schedule: SCHEDULE, command: COMMAND, called_by: 'postgres' }]);
  });

  it('is idempotent: repeated runs schedule nothing and keep the job on this server', async () => {
    await h.exec(migrationSql(M33));
    await h.exec(migrationSql(M33));
    expect(await scheduleCalls(h)).toBe(1);
    expect(await jobs(h)).toEqual([APPROVED_JOB]);
  });

  it('takes the target from this server\'s settings, not from a literal', async () => {
    await h.exec('begin');
    try {
      await h.exec(`set local cron.host = 'db-internal.invalid'`);
      await h.exec(`update cron.job set nodename = 'db-internal.invalid' where jobname = '${JOB}'`);
      await expect(h.exec(migrationSql(M33))).resolves.toBeUndefined();
      expect(await scheduleCalls(h)).toBe(1);
      expect(await jobs(h)).toEqual([{ ...APPROVED_JOB, nodename: 'db-internal.invalid' }]);
    } finally {
      await h.exec('rollback');
    }
  });

  describe('refuses — without overwriting anything — when', () => {
    async function refuses(setup: string, message: RegExp): Promise<void> {
      await h.exec('begin');
      try {
        await h.exec(setup);
        const before = await jobs(h);
        const calls = await scheduleCalls(h);
        await h.exec('savepoint before_m33');
        await expect(h.exec(migrationSql(M33))).rejects.toThrow(message);
        await h.exec('rollback to savepoint before_m33');
        expect(await jobs(h)).toEqual(before);
        expect(await scheduleCalls(h)).toBe(calls);
      } finally {
        await h.exec('rollback');
      }
    }

    it.each([
      ['the schedule differs', `update cron.job set schedule = '0 0 * * *' where jobname = '${JOB}'`],
      ['the command differs', `update cron.job set command = 'select 1' where jobname = '${JOB}'`],
      ['the job is inactive', `update cron.job set active = false where jobname = '${JOB}'`],
      ['the database differs', `update cron.job set database = 'other' where jobname = '${JOB}'`],
      ['another role owns it', `update cron.job set username = 'someone_else' where jobname = '${JOB}'`],
      ['the job runs on another host', `update cron.job set nodename = 'foreign-db.invalid' where jobname = '${JOB}'`],
      ['the job runs on another port', `update cron.job set nodeport = 6543 where jobname = '${JOB}'`],
      ['the job targets foreign-db.invalid:6543', `update cron.job set nodename = 'foreign-db.invalid', nodeport = 6543 where jobname = '${JOB}'`],
      ['the server\'s own target is not the job\'s', `set local cron.host = 'db-internal.invalid'`],
    ])('%s', async (_label, setup) => {
      await refuses(setup, /does not match the approved job/);
    });

    it('the scheduler\'s execution target cannot be established', async () => {
      await refuses(`set local cron.host = ''`, /execution target \(cron\.host, port\) cannot be established/);
    });

    it('a second job carries the same name', async () => {
      await refuses(
        `insert into cron.job (jobname, schedule, command, username)
         values ('${JOB}', '${SCHEDULE}', 'select public.sync_cleanup_incomplete_operations();', 'someone_else')`,
        /more than one muthoy-b2-sync-staging-cleanup job exists/,
      );
    });

    it.each([
      ['a local timezone', `set local cron.timezone = 'Asia/Dhaka'`],
      ['an empty timezone', `set local cron.timezone = ''`],
    ])('the scheduler runs in %s', async (_label, setup) => {
      await refuses(setup, /cron.timezone must be UTC\/GMT/);
    });

    it('cron.job is missing', async () => {
      await h.exec('begin');
      try {
        await h.exec('drop table cron.job_run_details; drop table cron.job cascade;');
        await h.exec('savepoint before_m33');
        await expect(h.exec(migrationSql(M33))).rejects.toThrow(/cron.job or cron.schedule\(text,text,text\) is missing/);
        await h.exec('rollback to savepoint before_m33');
      } finally {
        await h.exec('rollback');
      }
    });

    it.each([
      ['it runs as the caller', `alter function ${FUNCTION} security invoker`, /is not the expected definer function/],
      ['another role owns it', `create role h9_other_owner; alter function ${FUNCTION} owner to h9_other_owner`, /is not the expected definer function/],
      ['anon may execute it', `grant execute on function ${FUNCTION} to anon`, /executable by PUBLIC or an API role/],
      ['authenticated may execute it', `grant execute on function ${FUNCTION} to authenticated`, /executable by PUBLIC or an API role/],
      ['PUBLIC may execute it', `grant execute on function ${FUNCTION} to public`, /executable by PUBLIC or an API role/],
    ])('the cleanup function is not as B2 shipped it: %s', async (_label, setup, message) => {
      await refuses(setup, message);
    });

    it('it runs as a role other than postgres', async () => {
      // service_role cannot read the cron schema at all, so the before/after
      // state is read as postgres around the refused run.
      const before = await jobs(h);
      await h.exec('begin');
      try {
        await h.exec('set local role service_role');
        await h.exec('savepoint before_m33');
        await expect(h.exec(migrationSql(M33))).rejects.toThrow(/must run as the postgres migration role/);
        await h.exec('rollback to savepoint before_m33');
      } finally {
        await h.exec('rollback');
      }
      expect(await jobs(h)).toEqual(before);
      expect(await scheduleCalls(h)).toBe(1);
    });
  });
});

describe('migration 33 never writes cron.job directly and never runs the cleanup', () => {
  const code = migrationSql(M33).replace(/--[^\n]*/g, '');

  it('schedules only through cron.schedule', () => {
    expect(code).toMatch(/cron\.schedule\(/);
    expect(code).not.toMatch(/\b(?:insert\s+into|update|delete\s+from)\s+cron\.job\b/i);
    expect(code).not.toMatch(/cron\.(?:unschedule|alter_job)\(/i);
  });

  it('does not invoke the cleanup itself', () => {
    // String literals removed: the job's COMMAND text names the call by design.
    const executable = code.replace(/'(?:[^']|'')*'/g, "''");
    expect(executable).not.toMatch(/sync_cleanup_incomplete_operations\s*\(\s*\)\s*;/i);
    expect(code).toContain(`'${COMMAND}'`);
  });
});

describe('the cleanup the job runs (B2\'s sync_cleanup_incomplete_operations)', () => {
  let h: Harness;
  const op = (n: number) => `c1c1c1c1-0000-4000-8000-${String(n).padStart(12, '0')}`;

  beforeAll(async () => {
    h = await chain();
    await seedShops(h);
    const rows: Array<[number, string, string]> = [
      [1, 'staging', `now() - interval '7 days 1 minute'`],
      [2, 'rejected', `now() - interval '8 days'`],
      [3, 'staging', `now() - interval '6 days 23 hours 59 minutes'`],
      [4, 'applied', `now() - interval '30 days'`],
      [5, 'applying', `now() - interval '30 days'`],
    ];
    for (const [n, status, updatedAt] of rows) {
      await h.exec(`
        insert into sync_operation_staging (operation_id, shop_id, operation_kind, actor_id, device_id,
          expected_row_count, payload_hash, status, updated_at)
        values ('${op(n)}', '${SHOP_A}', 'sale', '${OWNER_A}', 'device-h9', 1, repeat('a', 32), '${status}', ${updatedAt});
        insert into sync_operation_chunks (operation_id, sequence, row_count, chunk_hash, rows)
        values ('${op(n)}', 0, 1, 'chunk-${n}', '[{}]'::jsonb);`);
    }
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('refuses EXECUTE to the API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(h.as(role, null, () => h.one(`select public.sync_cleanup_incomplete_operations()`)))
        .rejects.toMatchObject({ code: '42501' });
    }
    expect(await h.one(`select count(*)::int as count from sync_operation_staging`)).toEqual({ count: 5 });
  });

  it('deletes only staging/rejected graphs older than 7 days, chunks included', async () => {
    expect(await h.one(`select public.sync_cleanup_incomplete_operations() as deleted`)).toEqual({ deleted: 2 });
    expect((await h.all<{ operation_id: string }>(`select operation_id from sync_operation_staging order by operation_id`))
      .map((row) => row.operation_id)).toEqual([op(3), op(4), op(5)]);
    expect((await h.all<{ operation_id: string }>(`select distinct operation_id from sync_operation_chunks order by operation_id`))
      .map((row) => row.operation_id)).toEqual([op(3), op(4), op(5)]);
  });

  it('deletes nothing more when it runs again', async () => {
    expect(await h.one(`select public.sync_cleanup_incomplete_operations() as deleted`)).toEqual({ deleted: 0 });
  });
});

describe('the read-only migration-history checks', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createBareHarness();
    await h.exec(`create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);`);
  }, 60_000);
  afterAll(async () => { await h?.close(); });

  async function record(names: string[]): Promise<void> {
    await h.exec('truncate supabase_migrations.schema_migrations');
    for (const name of names) {
      await h.exec(`insert into supabase_migrations.schema_migrations (version, name)
        values ('${name.slice(0, 14)}', '${name.slice(15, -4)}')`);
    }
  }

  it('recognizes DEV\'s pre-H-9 history and refuses it as post-H-9', async () => {
    await record(migrationFiles().filter((name) => name < '20261008000000'));
    expect(Object.values(await readOnlyChecks(h, 'history_pre_h9'))).toEqual([true, true]);
    expect(await readOnlyChecks(h, 'history_post_h9'))
      .toMatchObject({ history_has_34_versions: false, history_has_all_h9_versions: false });
  });

  it('refuses a history that stops before migration 34 as post-H-9', async () => {
    await record(migrationFiles().filter((name) => name < '20261015000000'));
    expect(await readOnlyChecks(h, 'history_post_h9')).toEqual({
      history_has_34_versions: false, history_has_all_h9_versions: false, history_has_nothing_after_h9: true,
    });
  });

  // RE-SCOPED for E4, and this is the whole point of the successor design.
  //
  // This recorded `migrationFiles()` — the whole directory — and expected
  // history_post_h9 to be all-true. That was a correct test for exactly as long
  // as the directory WAS the H-9 baseline. E4 adds migration 35, so the
  // directory and the baseline are no longer the same set, and the section
  // under test describes the baseline: `count(*) = 34`, nothing after
  // 20261015000000.
  //
  // So the test records the BASELINE, which is the history this section was
  // written for and the state an A2/A3 rehearsal reproduces. The section's SQL
  // is untouched and its file is still byte-identical.
  it('recognizes the complete post-H-9 history and refuses an unexpected later version', async () => {
    await record(h9BaselineMigrationFiles());
    expect(Object.values(await readOnlyChecks(h, 'history_post_h9'))).toEqual([true, true, true]);
    expect(await readOnlyChecks(h, 'history_pre_h9')).toMatchObject({ history_has_31_versions: false });
    await h.exec(`insert into supabase_migrations.schema_migrations (version, name) values ('20261231000000', 'unexpected')`);
    expect(await readOnlyChecks(h, 'history_post_h9')).toMatchObject({ history_has_nothing_after_h9: false });
  });

  // The two tests below are ADDED, not substituted. Re-scoping the one above
  // would otherwise mean the H-9 section silently stopped being exercised
  // against the live chain, and nobody could tell from the suite whether that
  // was deliberate or an oversight. These make the drift explicit: the H-9
  // section fails on the live chain, on EXACTLY two assertions and no others,
  // and the successor passes on the same history.
  it('shows exactly how the H-9 section drifts once the chain is extended', async () => {
    await record(migrationFiles());
    expect(await readOnlyChecks(h, 'history_post_h9')).toEqual({
      // The count moved, and there is now something after migration 34.
      history_has_34_versions: false,
      history_has_nothing_after_h9: false,
      // The H-9 trio itself is untouched, which is the invariant that matters.
      history_has_all_h9_versions: true,
    });
  });

  it('hands the live chain to the E4 successor, which accepts it', async () => {
    await record(migrationFiles());
    const live = await readOnlySectionFrom(h, E4_CHECK_FILE, 'history_e4');
    expect(Object.values(live).every(Boolean), JSON.stringify(live)).toBe(true);
  });

  // The defect a count-plus-bounds check cannot see. Swap one pre-H-9 version
  // for an unknown one of the same length: the COUNT is unchanged, nothing new
  // appears after migration 34, so h9's section still passes — while the chain
  // is demonstrably not the chain it claims to be. The successor fails in both
  // directions and names both versions.
  it('catches a same-count substitution that the H-9 section cannot', async () => {
    const substituted = migrationFiles()
      .filter((name) => !name.startsWith('20260817000100'))
      .concat(['20260817000199_impostor.sql']);
    await record(substituted);

    expect(await readOnlyChecks(h, 'history_post_h9')).toMatchObject({
      history_has_34_versions: false,
      history_has_all_h9_versions: true,
    });

    const live = await readOnlySectionFrom(h, E4_CHECK_FILE, 'history_e4');
    expect(live.history_has_no_missing_version).toBe(false);
    expect(live.history_has_no_extra_version).toBe(false);

    const detail = await readOnlyDetailFrom(h, E4_CHECK_FILE, 'history_e4');
    expect(detail.history_has_no_missing_version).toBe('20260817000100');
    expect(detail.history_has_no_extra_version).toBe('20260817000199');
  });
});
