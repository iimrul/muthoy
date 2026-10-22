import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

// W4-08 — the admin panel's EFFECTIVE privileges, measured on a real Postgres.
//
// apps/admin/lib/adminGrants.test.ts reads the migration text and asks whether
// a GRANT appears in it. That cannot answer what the role actually holds after
// ordered GRANTs, REVOKEs, role memberships and default privileges have all
// been applied — which is the only question that matters for a panel running
// with a BYPASSRLS service-role key. So this applies the whole chain and asks
// Postgres.
//
// The NEGATIVES carry as much weight as the positives: a privilege the panel
// must not have, proven absent rather than assumed absent.

const READ_TABLES = [
  'billing_accounts',
  'billing_subscriptions',
  'entitlement_snapshots',
  'payment_orders',
  'payment_provider_events',
  'plan_offerings',
  'sales',
  'shop_memberships',
  'shops',
  'users',
] as const;

const DEVICE_REGISTRY_TABLES = [
  'shop_devices',
  'shop_device_bindings',
  'device_registry_events',
  'auth_session_devices',
  'device_enrollment_holds',
] as const;

const PRIVILEGES = ['select', 'insert', 'update', 'delete', 'truncate'] as const;

interface PrivilegeRow {
  held: boolean;
}

describe('Batch 2 admin effective ACL', () => {
  let h: Harness;

  async function holds(role: string, table: string, privilege: string): Promise<boolean> {
    const row = await h.one<PrivilegeRow>(
      `select has_table_privilege($1, ('public.' || $2)::regclass, $3) as held`,
      [role, table, privilege],
    );
    return row.held;
  }

  async function executes(role: string, signature: string): Promise<boolean> {
    const row = await h.one<PrivilegeRow>(
      `select has_function_privilege($1, $2::regprocedure, 'execute') as held`,
      [role, signature],
    );
    return row.held;
  }

  beforeAll(async () => {
    h = await createHarness();
  }, 120_000);
  afterAll(async () => h.close());

  it('grants service_role SELECT on every table the panel declares it reads', async () => {
    const missing: string[] = [];
    for (const table of READ_TABLES) {
      if (!(await holds('service_role', table, 'select'))) missing.push(table);
    }
    // A table the panel reads without this privilege dies with SQLSTATE 42501
    // in production, which is exactly how the Day-14 pages shipped broken.
    expect(missing).toEqual([]);
  });

  it('grants service_role EXECUTE on the two RPCs the write actions call', async () => {
    expect(await executes('service_role', 'b4_refresh_entitlement_snapshot(uuid)')).toBe(true);
    expect(await executes('service_role', 'b4_reconcile_plan_limits(uuid,timestamptz)')).toBe(true);
  });

  it('does NOT grant anon or authenticated EXECUTE on those RPCs', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect(await executes(role, 'b4_refresh_entitlement_snapshot(uuid)')).toBe(false);
      expect(await executes(role, 'b4_reconcile_plan_limits(uuid,timestamptz)')).toBe(false);
    }
  });

  it('does NOT grant service_role UPDATE on shops — W4-05 is still a blocker', async () => {
    // A shop write from the panel would need this. Its absence is why
    // location/map management is reported BLOCKED rather than built.
    expect(await holds('service_role', 'shops', 'update')).toBe(false);
    expect(await holds('service_role', 'shops', 'insert')).toBe(false);
    expect(await holds('service_role', 'shops', 'delete')).toBe(false);
  });

  it('does NOT grant service_role any write on sales', async () => {
    for (const privilege of ['insert', 'update', 'delete', 'truncate']) {
      expect(await holds('service_role', 'sales', privilege)).toBe(false);
    }
  });

  it('does NOT grant service_role anything on the device registry tables', async () => {
    const held: string[] = [];
    for (const table of DEVICE_REGISTRY_TABLES) {
      for (const privilege of PRIVILEGES) {
        if (await holds('service_role', table, privilege)) held.push(table + ':' + privilege);
      }
    }
    expect(held).toEqual([]);
  });

  it('records the MEASURED privilege on sale_refunds, which plan §5.5 had backwards', async () => {
    // Plan §5.5 listed this as a negative to prove: "sale_refunds SELECT is
    // false (W4-04's blocker, proven rather than assumed)". Measured here, it
    // is TRUE — 20260821010000_phase_b2_sales_inventory_sync.sql grants
    // select, insert, update, delete on sale_refunds to service_role inside
    // its per-table loop, because the SYNC path needs it.
    //
    // So the panel's protection is not a missing grant. It is that
    // sale_refunds is not in the declared read manifest and no admin source
    // reads it — which apps/admin/lib/adminGrants.test.ts asserts from the
    // source side. Asserting a false here would have failed, and asserting it
    // loosely would have hidden a real privilege.
    expect(await holds('service_role', 'sale_refunds', 'select')).toBe(true);
    expect(READ_TABLES as readonly string[]).not.toContain('sale_refunds');
  });

  it('does NOT grant anon or authenticated anything on a commercial table', async () => {
    const held: string[] = [];
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['billing_accounts', 'billing_subscriptions', 'entitlement_snapshots',
        'payment_orders', 'payment_provider_events', 'plan_offerings', 'shop_memberships']) {
        for (const privilege of PRIVILEGES) {
          if (await holds(role, table, privilege)) held.push(role + ':' + table + ':' + privilege);
        }
      }
    }
    expect(held).toEqual([]);
  });
});
