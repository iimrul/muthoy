import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createBareHarness,
  migrationFiles,
  migrationSql,
  MANAGER_A,
  OWNER_A,
  SHOP_A,
  STAFF_A,
  seedShops,
  type Harness,
} from './harness';
import { findPostgresBin, startServerPostgres, type ServerPostgres } from './serverPostgres';

// H-9 §8.3 — forward migration 32, executed.
//
// Fresh bootstrap leaves TWO identical consumption CHECKs on
// device_enrollment_holds: 0923 creates one inline and unnamed (Postgres calls
// it device_enrollment_holds_check1, after the approval CHECK's
// device_enrollment_holds_check), and 0926 adds the named one because it
// guards on that name. Projects migrated through the recorded, earlier 0923 —
// DEV — have only the named one. Migration 32 must converge both onto one
// canonical CHECK, prove equivalence on the stored parse trees, and abort —
// changing nothing — on every other shape.
//
// The historical path is the committed 0923 with exactly its inline
// consumption CHECK removed: a sanitized definition fixture, no DEV data.

const M0923 = '20260923000000_a23_device_registry.sql';
const M32 = '20261008000000_h9_enrollment_hold_constraint_normalization.sql';
const M33 = '20261008000100_h9_sync_staging_cleanup_schedule.sql';
const TABLE = `'public.device_enrollment_holds'::regclass`;
const CANONICAL = 'device_enrollment_holds_consumption_check';
const CHECK1 = 'device_enrollment_holds_check1';
const APPROVAL = 'device_enrollment_holds_check';
const PROBES = ['h9_device_enrollment_holds_consumption_probe', 'h9_device_enrollment_holds_approval_probe'];

const CONSUMPTION_RULE = `(consumed_at is null and consumed_device_id is null)
  or (consumed_at is not null and consumed_device_id is not null and approved_at is not null)`;

/** The committed 0923's inline consumption CHECK — absent from the recorded 0923. */
const INLINE_CONSUMPTION_CHECK = new RegExp(
  [
    ',\\r?\\n  check \\(\\r?\\n',
    '    \\(consumed_at is null and consumed_device_id is null\\)\\r?\\n',
    '    or\\r?\\n',
    '    \\(consumed_at is not null and consumed_device_id is not null and approved_at is not null\\)\\r?\\n',
    '  \\)\\r?\\n\\);',
  ].join(''),
  'g',
);

function recorded0923(sql: string): string {
  const matches = sql.match(INLINE_CONSUMPTION_CHECK) ?? [];
  if (matches.length !== 1) throw new Error(`expected the inline consumption CHECK once, found ${matches.length}`);
  return sql.replace(INLINE_CONSUMPTION_CHECK, '\n);');
}

async function chain(options: { recorded?: boolean } = {}): Promise<Harness> {
  const h = await createBareHarness();
  for (const name of migrationFiles().filter((file) => file < M32)) {
    const sql = migrationSql(name);
    await h.exec(options.recorded && name === M0923 ? recorded0923(sql) : sql);
  }
  return h;
}

const DEVICE_SOURCE = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const DEVICE_TARGET = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';

/** One held-only row and one approved-and-consumed row: both CHECKs exercised. */
async function seedHolds(h: Harness): Promise<void> {
  await seedShops(h);
  await h.exec(`
    insert into shop_devices (id, shop_id, device_public_id, device_secret_hash, enrolled_by_user_id) values
      ('${DEVICE_SOURCE}', '${SHOP_A}', 'device-source', repeat('a', 64), '${OWNER_A}'),
      ('${DEVICE_TARGET}', '${SHOP_A}', 'device-target', repeat('b', 64), '${OWNER_A}');
    insert into device_enrollment_holds (shop_id, actor_user_id, source_device_id, held_by_user_id, reason) values
      ('${SHOP_A}', '${STAFF_A}', '${DEVICE_SOURCE}', '${OWNER_A}', 'revoked');
    insert into device_enrollment_holds (
      shop_id, actor_user_id, source_device_id, held_by_user_id,
      requested_device_public_id, requested_at, approved_device_public_id, approved_at,
      approved_by_user_id, approved_by_device_id, consumed_at, consumed_device_id
    ) values (
      '${SHOP_A}', '${MANAGER_A}', '${DEVICE_SOURCE}', '${OWNER_A}',
      'device-target', '2026-10-01T00:00:00Z', 'device-target', '2026-10-01T00:01:00Z',
      '${OWNER_A}', '${DEVICE_TARGET}', '2026-10-01T00:02:00Z', '${DEVICE_TARGET}'
    );
  `);
}

interface ConstraintRow { conname: string; contype: string; convalidated: boolean; connoinherit: boolean; conkey: string; conbin: string }

async function checks(h: Harness): Promise<ConstraintRow[]> {
  return h.all<ConstraintRow>(
    `select conname, contype::text as contype, convalidated, connoinherit, conkey::text as conkey, conbin::text as conbin
       from pg_constraint where conrelid = ${TABLE} and contype = 'c' order by conname`,
  );
}

/** Everything migration 32 must NOT change, beyond the consumption duplicate. */
async function snapshot(h: Harness) {
  const a23Tables = [...migrationSql(M0923).matchAll(/create table (\w+) \(/g)].map((match) => match[1]);
  return {
    otherConstraints: await h.all(
      `select conname, contype::text as contype, convalidated, pg_get_constraintdef(oid) as definition
         from pg_constraint where conrelid = ${TABLE} and contype <> 'c' order by conname`,
    ),
    rows: await h.one<{ digest: string; count: number }>(
      `select md5(coalesce(string_agg(t::text, '|' order by t.shop_id, t.actor_user_id), '')) as digest,
              count(*)::int as count
         from device_enrollment_holds t`,
    ),
    functions: await h.all(
      `select p.oid::regprocedure::text as signature, md5(pg_get_functiondef(p.oid)) as body,
              coalesce(p.proacl::text, '') as acl, p.prosecdef,
              coalesce(array_to_string(p.proconfig, ','), '') as config, pg_get_userbyid(p.proowner) as owner
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'a23\\_%' order by 1`,
    ),
    tables: await h.all(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity, coalesce(c.relacl::text, '') as acl
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1) order by 1`,
      [a23Tables],
    ),
    policies: await h.all(
      `select tablename, policyname, permissive, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
         from pg_policies where schemaname = 'public' and tablename = any($1) order by 1, 2`,
      [a23Tables],
    ),
  };
}

const sameMeaning = (row: ConstraintRow | undefined) =>
  row ? { conbin: row.conbin, conkey: row.conkey, connoinherit: row.connoinherit } : undefined;

/** One section of the runbook's read-only checks, run in a READ ONLY transaction. */
async function readOnlyChecks(h: Harness, section: string): Promise<Record<string, boolean>> {
  const text = readFileSync(resolve('backend/supabase/checks/h9_postmigration_checks.sql'), 'utf8');
  const body = text.split(/^-- section: /m).find((part) => part.split(/\r?\n/, 1)[0] === section);
  if (!body) throw new Error(`missing check section ${section}`);
  await h.exec('begin transaction read only');
  try {
    const rows = await h.all<{ check_name: string; pass: boolean }>(body.slice(body.indexOf('\n') + 1));
    return Object.fromEntries(rows.map((row) => [row.check_name, row.pass]));
  } finally {
    await h.exec('rollback');
  }
}

describe('the H-9 forward migrations sit after every historical migration', () => {
  it('orders 32 and 33 last, in that order', () => {
    const files = migrationFiles();
    expect(files.slice(-2)).toEqual([M32, M33]);
    expect(files.filter((name) => name < M32)).toHaveLength(files.length - 2);
  });
});

describe('fresh bootstrap', () => {
  let h: Harness;
  let beforeChecks: ConstraintRow[];
  let beforeRest: Awaited<ReturnType<typeof snapshot>>;
  let afterChecks: ConstraintRow[];

  beforeAll(async () => {
    h = await chain();
    await seedHolds(h);
    beforeChecks = await checks(h);
    beforeRest = await snapshot(h);
    await h.exec(migrationSql(M32));
    afterChecks = await checks(h);
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('starts with the equivalent duplicate pair fresh bootstrap leaves', () => {
    const byName = new Map(beforeChecks.map((row) => [row.conname, row]));
    expect([...byName.keys()]).toEqual([APPROVAL, CHECK1, CANONICAL]);
    expect(sameMeaning(byName.get(CHECK1))).toEqual(sameMeaning(byName.get(CANONICAL)));
    expect(sameMeaning(byName.get(APPROVAL))).not.toEqual(sameMeaning(byName.get(CANONICAL)));
  });

  it('removes only the unnamed duplicate', () => {
    expect(afterChecks).toEqual(beforeChecks.filter((row) => row.conname !== CHECK1));
    expect(afterChecks.find((row) => row.conname === CANONICAL)?.convalidated).toBe(true);
  });

  it('changes no row, A2.3 function, grant, RLS flag, policy or other constraint', async () => {
    const after = await snapshot(h);
    expect(beforeRest.rows.count).toBe(2);
    expect(after).toEqual(beforeRest);
  });

  it('leaves no probe behind', async () => {
    expect(await h.all(`select conname from pg_constraint where conname = any($1)`, [PROBES])).toEqual([]);
  });

  it('passes every read-only runbook constraint check', async () => {
    const results = await readOnlyChecks(h, 'constraints');
    expect(Object.keys(results)).toHaveLength(6);
    expect(Object.entries(results).filter(([, pass]) => !pass)).toEqual([]);
  });

  it('is a no-op when it runs again', async () => {
    await h.exec(migrationSql(M32));
    expect(await checks(h)).toEqual(afterChecks);
  });

  it('still refuses a consumed hold with no consuming device, by the canonical CHECK', async () => {
    await expect(h.exec(`
      update device_enrollment_holds set consumed_device_id = null
       where actor_user_id = '${MANAGER_A}'`)).rejects.toMatchObject({ code: '23514', constraint: CANONICAL });
  });

  it('still refuses a half-approved hold, by the unchanged approval CHECK', async () => {
    await expect(h.exec(`
      update device_enrollment_holds set approved_at = now()
       where actor_user_id = '${STAFF_A}'`)).rejects.toMatchObject({ code: '23514', constraint: APPROVAL });
  });

  it('applies its timeouts to its own transaction only', async () => {
    await h.exec('begin');
    try {
      await h.exec(migrationSql(M32));
      expect(await h.one(`select current_setting('lock_timeout') as lock, current_setting('statement_timeout') as statement`))
        .toEqual({ lock: '5s', statement: '1min' });
    } finally {
      await h.exec('rollback');
    }
    expect(await h.one(`select current_setting('lock_timeout') as lock, current_setting('statement_timeout') as statement`))
      .toEqual({ lock: '0', statement: '0' });
  });
});

describe('historical upgrade (the recorded 0923 that DEV ran)', () => {
  let historical: Harness;
  let fresh: Harness;
  let before: Awaited<ReturnType<typeof snapshot>>;
  let beforeChecks: ConstraintRow[];

  beforeAll(async () => {
    historical = await chain({ recorded: true });
    await seedHolds(historical);
    beforeChecks = await checks(historical);
    before = await snapshot(historical);
    await historical.exec(migrationSql(M32));
    fresh = await chain();
    await seedHolds(fresh);
    await fresh.exec(migrationSql(M32));
  }, 240_000);
  afterAll(async () => { await historical?.close(); await fresh?.close(); });

  it('starts as DEV does: the named consumption CHECK and the approval CHECK only', () => {
    expect(beforeChecks.map((row) => row.conname)).toEqual([APPROVAL, CANONICAL]);
  });

  it('is a semantic no-op there', async () => {
    expect(await checks(historical)).toEqual(beforeChecks);
    expect(await snapshot(historical)).toEqual(before);
  });

  it('passes every read-only runbook constraint check', async () => {
    const results = await readOnlyChecks(historical, 'constraints');
    expect(Object.entries(results).filter(([, pass]) => !pass)).toEqual([]);
  });

  it('converges with fresh bootstrap', async () => {
    expect(await checks(historical)).toEqual(await checks(fresh));
    // Structure only across databases: the seeded rows take clock_timestamp()
    // defaults, so their digests can only be compared within one database.
    const { rows: historicalRows, ...historicalStructure } = await snapshot(historical);
    const { rows: freshRows, ...freshStructure } = await snapshot(fresh);
    expect(historicalStructure).toEqual(freshStructure);
    expect(historicalRows.count).toBe(freshRows.count);
  });
});

describe('every other shape aborts and changes nothing', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await chain();
    await seedHolds(h);
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('is caught by the read-only runbook checks before migration 32 runs', async () => {
    // This database is the fresh bootstrap WITHOUT migration 32: the
    // duplicate pair is exactly what the checks exist to flag.
    expect(await readOnlyChecks(h, 'constraints')).toEqual({
      holds_table_present: true,
      canonical_consumption_check_validated: true,
      single_consumption_rule: false,
      no_check1_duplicate: false,
      no_h9_probe_left: true,
      two_check_constraints_total: false,
    });
  });

  /** setup → migration 32 inside one transaction; always rolled back. */
  async function scenario(setup: string, verify: () => Promise<void>): Promise<void> {
    await h.exec('begin');
    try {
      await h.exec(setup);
      await verify();
    } finally {
      await h.exec('rollback');
    }
  }

  async function refuses(message: RegExp): Promise<void> {
    const before = await checks(h);
    const rows = await h.one(`select md5(coalesce(string_agg(t::text, '|' order by t.shop_id, t.actor_user_id), '')) as digest from device_enrollment_holds t`);
    await h.exec('savepoint before_m32');
    await expect(h.exec(migrationSql(M32))).rejects.toThrow(message);
    await h.exec('rollback to savepoint before_m32');
    expect(await checks(h)).toEqual(before);
    expect(await h.one(`select md5(coalesce(string_agg(t::text, '|' order by t.shop_id, t.actor_user_id), '')) as digest from device_enrollment_holds t`)).toEqual(rows);
    expect(await h.all(`select conname from pg_constraint where conname = any($1)`, [PROBES])).toEqual([]);
  }

  it('recreates an absent canonical from the probe and drops the equivalent duplicate', async () => {
    await scenario(`alter table device_enrollment_holds drop constraint ${CANONICAL};`, async () => {
      await h.exec(migrationSql(M32));
      const after = await checks(h);
      expect(after.map((row) => row.conname)).toEqual([APPROVAL, CANONICAL]);
      expect(after.every((row) => row.convalidated)).toBe(true);
    });
  });

  it('recreates and validates the canonical when neither consumption CHECK exists', async () => {
    await scenario(`
      alter table device_enrollment_holds drop constraint ${CANONICAL};
      alter table device_enrollment_holds drop constraint ${CHECK1};`, async () => {
      await h.exec(migrationSql(M32));
      expect((await checks(h)).map((row) => [row.conname, row.convalidated])).toEqual([[APPROVAL, true], [CANONICAL, true]]);
    });
  });

  it('refuses a canonical name with a different rule', async () => {
    await scenario(`
      alter table device_enrollment_holds drop constraint ${CANONICAL};
      alter table device_enrollment_holds add constraint ${CANONICAL} check (
        (consumed_at is null and consumed_device_id is null)
        or (consumed_at is not null and consumed_device_id is not null));`,
    () => refuses(/is not the validated canonical rule/));
  });

  it('refuses an unvalidated canonical', async () => {
    await scenario(`
      alter table device_enrollment_holds drop constraint ${CANONICAL};
      alter table device_enrollment_holds add constraint ${CANONICAL} check (${CONSUMPTION_RULE}) not valid;`,
    () => refuses(/is not the validated canonical rule/));
  });

  it('refuses a check1 that means something else', async () => {
    await scenario(`
      alter table device_enrollment_holds drop constraint ${CHECK1};
      alter table device_enrollment_holds add constraint ${CHECK1} check (consumed_at is null or consumed_device_id is not null);`,
    () => refuses(/check1 is not the equivalent fresh-bootstrap duplicate/));
  });

  it('refuses an unvalidated check1', async () => {
    await scenario(`
      alter table device_enrollment_holds drop constraint ${CHECK1};
      alter table device_enrollment_holds add constraint ${CHECK1} check (${CONSUMPTION_RULE}) not valid;`,
    () => refuses(/check1 is not the equivalent fresh-bootstrap duplicate/));
  });

  it('refuses any further equivalent duplicate instead of guessing which to drop', async () => {
    await scenario(
      `alter table device_enrollment_holds add constraint device_enrollment_holds_extra_check check (${CONSUMPTION_RULE});`,
      () => refuses(/another consumption-equivalent CHECK exists/),
    );
  });

  it('aborts on a row that violates the rule rather than repairing it', async () => {
    await scenario(`
      alter table device_enrollment_holds drop constraint ${CANONICAL};
      alter table device_enrollment_holds drop constraint ${CHECK1};
      update device_enrollment_holds set consumed_device_id = null where actor_user_id = '${MANAGER_A}';`,
    () => refuses(/violated by some row/));
  });

  it('refuses when the approval CHECK is missing', async () => {
    await scenario(`alter table device_enrollment_holds drop constraint ${APPROVAL};`,
      () => refuses(/exactly one validated approval CHECK/));
  });

  it('refuses a missing table', async () => {
    await scenario(`alter table device_enrollment_holds rename to device_enrollment_holds_moved;`, async () => {
      await h.exec('savepoint before_m32');
      await expect(h.exec(migrationSql(M32))).rejects.toThrow(/device_enrollment_holds is missing/);
      await h.exec('rollback to savepoint before_m32');
    });
  });

  it.each([
    ['a renamed column', 'alter table device_enrollment_holds rename column consumed_device_id to consuming_device_id;'],
    ['a changed type', 'alter table device_enrollment_holds alter column approved_device_public_id type varchar(200);'],
  ])('refuses %s', async (_label, setup) => {
    await scenario(setup, () => refuses(/columns are not the expected shape/));
  });

  it('refuses when a probe name is already taken', async () => {
    await scenario(
      `alter table device_enrollment_holds add constraint ${PROBES[0]} check (true);`,
      async () => {
        const before = await checks(h);
        await h.exec('savepoint before_m32');
        await expect(h.exec(migrationSql(M32))).rejects.toThrow(/probe constraint name is already in use/);
        await h.exec('rollback to savepoint before_m32');
        expect(await checks(h)).toEqual(before);
      },
    );
  });
});

describe('on a PostgreSQL server: waits for locks only as long as allowed', () => {
  // PGlite is one backend and can never hold a conflicting lock. A real
  // server, one psql per session, shows the bound actually firing. psql
  // runs each statement in autocommit — so the top-level SET LOCAL is inert
  // there and the DO block's own set_config('lock_timeout') must carry it.
  const BIN = findPostgresBin();
  let pg: ServerPostgres | undefined;
  let skipReason: string | null = BIN ? null : 'no PostgreSQL binaries (initdb, pg_ctl, psql)';

  beforeAll(async () => {
    if (!BIN) return;
    pg = await startServerPostgres(BIN);
    const version = Number((await pg.query(`select current_setting('server_version_num');`)).trim());
    if (version < 170000) {
      skipReason = `server is ${version}; migration 32 requires PostgreSQL 17+`;
      return;
    }
    const table = (migrationSql(M0923).match(/create table device_enrollment_holds \([\s\S]*?\n\);/) ?? [''])[0]
      .replace(/\s+references\s+\w+\(id\)\s+on delete (?:cascade|restrict)/g, '');
    await pg.query(`${table}
      alter table device_enrollment_holds add constraint ${CANONICAL} check (${CONSUMPTION_RULE});`);
  }, 120_000);
  afterAll(() => { pg?.stop(); });

  it('aborts with lock_timeout, leaving no probe, then normalizes once the lock is gone', async (context) => {
    if (skipReason || !pg) {
      console.warn(`[h9 parity] SKIPPED: ${skipReason}.`);
      context.skip();
      return;
    }
    const holder = pg.open('begin; select count(*) from device_enrollment_holds;\n');
    try {
      // psql starts asynchronously: wait until the holder's lock is GRANTED,
      // or migration 32 can win the race and prove nothing.
      const held = async () => (await pg!.query(
        `select count(*) from pg_locks l join pg_class c on c.oid = l.relation
          where c.relname = 'device_enrollment_holds' and l.mode = 'AccessShareLock'
            and l.granted and l.pid <> pg_backend_pid();`,
      )).trim() !== '0';
      const deadline = Date.now() + 30_000;
      while (!(await held())) {
        if (Date.now() > deadline) throw new Error('the lock holder never acquired its lock');
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      const started = Date.now();
      const blocked = await pg.run(migrationSql(M32));
      const elapsed = Date.now() - started;
      expect(blocked.code).not.toBe(0);
      expect(blocked.stderr).toMatch(/lock timeout/);
      expect(elapsed).toBeGreaterThanOrEqual(4_500);
      expect(elapsed).toBeLessThan(30_000);
    } finally {
      holder.write('rollback;\n');
      await holder.end();
    }
    const names = async () => (await pg!.query(
      `select string_agg(conname, ',' order by conname) from pg_constraint
        where conrelid = 'public.device_enrollment_holds'::regclass and contype = 'c';`,
    )).trim();
    expect(await names()).toBe([APPROVAL, CHECK1, CANONICAL].join(','));
    const applied = await pg.run(migrationSql(M32));
    expect(applied.code, applied.stderr).toBe(0);
    expect(await names()).toBe([APPROVAL, CANONICAL].join(','));
  }, 120_000);
});
