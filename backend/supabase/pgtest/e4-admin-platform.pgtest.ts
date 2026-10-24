import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, SHOP_A, seedShops, type Harness } from './harness';
import { E4_CHECK_FILE, readOnlySectionFrom } from './checkFile';

// E4 / Batch 3 — the admin platform migration's EFFECTIVE privileges and
// behaviour, measured on a real Postgres.
//
// Two layers, because neither alone is enough:
//
//   1. the declarative layer — every row of e4_postmigration_checks.sql's
//      object, privilege and function sections, which is what a hosted
//      acceptance run would execute;
//   2. the BEHAVIOURAL layer — the privileges actually refusing the writes
//      they are supposed to refuse. `has_table_privilege` says what the
//      catalogue holds; only an attempted UPDATE says what the database does.
//      An audit table whose privileges look right and whose rows can still be
//      edited is the failure this file exists to prevent.
//
// The negatives carry as much weight as the positives throughout, which is the
// standard batch2-admin-acl.pgtest.ts set for this repository.

const SYNTHETIC_UUID = '7b000000-0000-4000-8000-000000000001';

interface Refusal { code: string | null; message: string }

describe('E4 admin platform', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  /** Runs `sql` as `role` and reports the SQLSTATE rather than throwing. */
  async function attempt(role: string, sql: string): Promise<Refusal | null> {
    return h.as(role, null, async () => {
      try {
        await h.exec(sql);
        return null;
      } catch (error) {
        const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : null;
        return { code, message: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  // ───────────────────────────────── the declarative layer

  it.each(['e4_objects', 'e4_privileges', 'e4_legacy_privileges', 'e4_functions'])(
    'passes every row of the %s acceptance section',
    async (section) => {
      const checks = await readOnlySectionFrom(h, E4_CHECK_FILE, section);
      const failed = Object.entries(checks).filter(([, pass]) => pass !== true).map(([name]) => name);
      // Named rather than counted: a failing privilege assertion has to say
      // WHICH privilege, or the reader has to go and re-derive it.
      expect(failed).toEqual([]);
      expect(Object.keys(checks).length).toBeGreaterThan(0);
    },
  );

  // ───────────────────────────────── the revoke that this migration performs

  it('leaves service_role able to READ sale_refunds', async () => {
    expect(await attempt('service_role', 'select count(*) from sale_refunds')).toBeNull();
  });

  it('refuses service_role every WRITE on sale_refunds', async () => {
    // 20260821010000:299 granted select+insert+update+delete in a loop over a
    // table list that includes sale_refunds, so the admin panel's key held DML
    // on a money table until E4 revoked it.
    for (const sql of [
      `insert into sale_refunds (id, shop_id, sale_id, total_amount) values ('${SYNTHETIC_UUID}', '${SHOP_A}', '${SYNTHETIC_UUID}', 1)`,
      'update sale_refunds set total_amount = 0',
      'delete from sale_refunds',
    ]) {
      const refusal = await attempt('service_role', sql);
      expect(refusal?.code, sql).toBe('42501');
    }
  });

  it('refuses service_role every WRITE on audit_logs, matching the append-only policy', async () => {
    for (const sql of [
      "update audit_logs set action = 'tampered'",
      'delete from audit_logs',
    ]) {
      const refusal = await attempt('service_role', sql);
      expect(refusal?.code, sql).toBe('42501');
    }
    expect(await attempt('service_role', 'select count(*) from audit_logs')).toBeNull();
  });

  // The end-to-end proof that the revoke breaks no write path is the whole
  // existing B2/B3/B4/H-7 pgtest set: harness.ts's createHarness() applies
  // every migration, so those suites run WITH migration 35 and exercise refund
  // application, sale pushes and stock pushes through sync_apply_row. This
  // assertion records the mechanism they rely on — the dispatcher is
  // SECURITY DEFINER, so it executes as its owner and not as the caller.
  it('keeps the sync dispatcher SECURITY DEFINER, which is why the revoke is safe', async () => {
    const row = await h.one<{ definer: boolean; owner_is_caller: boolean }>(`
      select p.prosecdef as definer,
             pg_get_userbyid(p.proowner) = 'service_role' as owner_is_caller
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'sync_apply_row'
         and p.pronargs = 6
    `);
    expect(row.definer).toBe(true);
    // And its owner is NOT the role whose privileges were revoked.
    expect(row.owner_is_caller).toBe(false);
  });

  // ───────────────────────────────── admin_audit_log is evidence, not state

  it('lets service_role append an audit row', async () => {
    expect(await attempt(
      'service_role',
      `insert into admin_audit_log (at, actor, actor_verified, role, action, outcome)
         values (now(), 'founder', true, 'super_admin', 'test.append', 'success')`,
    )).toBeNull();
    const row = await h.one<{ count: string }>('select count(*) as count from admin_audit_log');
    expect(Number(row.count)).toBe(1);
  });

  it('refuses every attempt to edit or erase an audit row', async () => {
    for (const sql of [
      "update admin_audit_log set actor = 'someone_else'",
      'update admin_audit_log set actor_verified = true',
      'delete from admin_audit_log',
      'truncate admin_audit_log',
    ]) {
      const refusal = await attempt('service_role', sql);
      expect(refusal?.code, sql).toBe('42501');
    }
    // And the row survived every one of them.
    const row = await h.one<{ count: string }>('select count(*) as count from admin_audit_log');
    expect(Number(row.count)).toBe(1);
  });

  it('refuses an outcome outside the three the panel records', async () => {
    const refusal = await attempt(
      'service_role',
      `insert into admin_audit_log (at, actor, action, outcome)
         values (now(), 'founder', 'test.bad_outcome', 'maybe')`,
    );
    expect(refusal?.code).toBe('23514');
  });

  // ───────────────────────────────── attribution is immutable by privilege

  it('lets service_role narrow a role but never rewrite the attribution', async () => {
    expect(await attempt(
      'service_role',
      `insert into admin_role_assignments (username, role, assigned_by)
         values ('ops', 'read_only', 'founder')`,
    )).toBeNull();

    // The three mutable columns a narrowing needs.
    expect(await attempt('service_role', "update admin_role_assignments set role = 'support' where username = 'ops'")).toBeNull();
    expect(await attempt('service_role', "update admin_role_assignments set is_active = false where username = 'ops'")).toBeNull();
    expect(await attempt('service_role', "update admin_role_assignments set sessions_revoked_at = now() where username = 'ops'")).toBeNull();

    // The three immutable ones. A panel that can rewrite who assigned a role,
    // or when, has no attribution.
    for (const column of ['username', 'assigned_by', 'assigned_at']) {
      const value = column === 'assigned_at' ? 'now()' : "'forged'";
      const refusal = await attempt('service_role', `update admin_role_assignments set ${column} = ${value}`);
      expect(refusal?.code, column).toBe('42501');
    }
  });

  it('refuses a role outside the four the panel knows', async () => {
    const refusal = await attempt(
      'service_role',
      `insert into admin_role_assignments (username, role, assigned_by)
         values ('intruder', 'root', 'founder')`,
    );
    expect(refusal?.code).toBe('23514');
  });

  it('refuses DELETE on an assignment — an account is disabled, never deleted', async () => {
    const refusal = await attempt('service_role', 'delete from admin_role_assignments');
    expect(refusal?.code).toBe('42501');
  });

  // ───────────────────────────────── support persistence

  it('lets service_role open a case and append notes, and refuses note edits', async () => {
    expect(await attempt(
      'service_role',
      `insert into admin_support_cases (id, shop_id, category, summary, opened_by)
         values ('${SYNTHETIC_UUID}', '${SHOP_A}', 'sync', 'synthetic case', 'support1')`,
    )).toBeNull();
    expect(await attempt(
      'service_role',
      `insert into admin_support_notes (case_id, body, author)
         values ('${SYNTHETIC_UUID}', 'synthetic note', 'support1')`,
    )).toBeNull();

    // A case can progress...
    expect(await attempt('service_role', "update admin_support_cases set status = 'resolved'")).toBeNull();
    // ...but it cannot be moved to a different shop or re-attributed.
    for (const column of ['shop_id', 'opened_by', 'opened_at']) {
      const value = column === 'shop_id' ? `'${SHOP_A}'` : column === 'opened_at' ? 'now()' : "'forged'";
      const refusal = await attempt('service_role', `update admin_support_cases set ${column} = ${value}`);
      expect(refusal?.code, column).toBe('42501');
    }
    // And a note is a record of what somebody said, so it cannot change.
    for (const sql of [
      "update admin_support_notes set body = 'rewritten'",
      'delete from admin_support_notes',
    ]) {
      const refusal = await attempt('service_role', sql);
      expect(refusal?.code, sql).toBe('42501');
    }
  });

  it('refuses a support category, status, priority or summary outside its allowlist', async () => {
    for (const sql of [
      `insert into admin_support_cases (shop_id, category, summary, opened_by) values ('${SHOP_A}', 'gossip', 's', 'a')`,
      `insert into admin_support_cases (shop_id, category, status, summary, opened_by) values ('${SHOP_A}', 'sync', 'pending_forever', 's', 'a')`,
      `insert into admin_support_cases (shop_id, category, priority, summary, opened_by) values ('${SHOP_A}', 'sync', 'apocalyptic', 's', 'a')`,
      `insert into admin_support_cases (shop_id, category, summary, opened_by) values ('${SHOP_A}', 'sync', '', 'a')`,
    ]) {
      const refusal = await attempt('service_role', sql);
      expect(refusal?.code, sql).toBe('23514');
    }
  });

  // RESTRICT, not CASCADE: the note history protects the case. Asserted as the
  // TABLE OWNER, because service_role holds no delete at all — so without this
  // the FK policy would never actually be exercised and CASCADE would look
  // identical from the panel's side.
  it('refuses deleting a case that still has notes, even as the table owner', async () => {
    let code: string | null = null;
    try {
      await h.exec(`delete from admin_support_cases where id = '${SYNTHETIC_UUID}'`);
    } catch (error) {
      code = (error as { code?: string }).code ?? null;
    }
    // 23001 restrict_violation, NOT 23503 foreign_key_violation. The
    // distinction is the assertion: RESTRICT raises 23001, a plain NO ACTION
    // raises 23503, and CASCADE raises nothing at all and silently takes the
    // notes with it. Only 23001 proves the policy that was actually written.
    expect(code).toBe('23001');
  });

  it('refuses a case for a shop that does not exist', async () => {
    const refusal = await attempt(
      'service_role',
      `insert into admin_support_cases (shop_id, category, summary, opened_by)
         values ('7b000000-0000-4000-8000-0000000000ff', 'sync', 's', 'a')`,
    );
    expect(refusal?.code).toBe('23503');
  });

  // ───────────────────────────────── settings: a bounded key space

  it('accepts each of the six allowed settings keys and refuses anything else', async () => {
    for (const key of [
      'flag.analytics_enabled', 'flag.maps_enabled', 'flag.reports_pdf_enabled',
      'notification.template.trial_ending', 'notification.template.payment_failed',
      'notification.template.subscription_expired',
    ]) {
      expect(await attempt(
        'service_role',
        `insert into admin_platform_settings (key, value, updated_by) values ('${key}', 'true'::jsonb, 'founder')`,
      ), key).toBeNull();
    }

    // An arbitrary configuration key cannot be written even by a caller
    // holding the table privilege — the CHECK is the allowlist.
    for (const key of ['flag.bogus', 'notification.template.anything', 'arbitrary', '']) {
      const refusal = await attempt(
        'service_role',
        `insert into admin_platform_settings (key, value, updated_by) values ('${key}', 'true'::jsonb, 'founder')`,
      );
      expect(refusal?.code, key).toBe('23514');
    }
  });

  it('lets a setting value change but never its key', async () => {
    expect(await attempt(
      'service_role',
      "update admin_platform_settings set value = 'false'::jsonb, updated_by = 'founder' where key = 'flag.maps_enabled'",
    )).toBeNull();
    const refusal = await attempt('service_role', "update admin_platform_settings set key = 'flag.bogus'");
    expect(refusal?.code).toBe('42501');
  });

  // ───────────────────────────────── the API roles reach none of it

  it.each(['anon', 'authenticated'])('gives %s no access to any E4 table', async (role) => {
    for (const table of [
      'admin_audit_log', 'admin_role_assignments', 'admin_support_cases',
      'admin_support_notes', 'admin_platform_settings',
    ]) {
      const refusal = await attempt(role, `select count(*) from ${table}`);
      expect(refusal?.code, `${role} -> ${table}`).toBe('42501');
    }
  });
});
