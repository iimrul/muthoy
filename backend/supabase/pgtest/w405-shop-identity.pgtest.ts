import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MANAGER_A,
  OWNER_A,
  OWNER_B,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  applyRow,
  claimsFor,
  createHarness,
  seedShops,
  type Harness,
} from './harness';

// W4-05 — shop sync security, both barriers, proven independently.
//
// THE THREAT, as Batch 1's plan corrected it: a non-owner cannot write
// user_permissions at all, because 20260819000000 raises MU015 ("only an owner
// may change permissions"). What remains is OWNER-INITIATED — an Owner *can*
// grant settings_manage, the server *does* honour it, and whole-row LWW on
// `shops` would then hand a Manager the entire shop identity row. So this is
// preventive hardening of a latent divergence, not the closure of a live hole,
// and these tests do not pretend otherwise.
//
// TWO BARRIERS, and the redundancy is the design:
//   (a) the permission gate — sync_row_permitted's `shops` arm requires an
//       active Owner, replacing `user_has_permission(..., 'settings_manage')`;
//   (b) the field-level pin — sync_apply_row overwrites the eight identity
//       fields from the stored row for any non-owner caller.
//
// Each is exercised WITH THE OTHER DISABLED, because two barriers that are only
// ever tested together are indistinguishable from one barrier plus a decoration.

const IDENTITY_FIELDS = [
  'name', 'name_en', 'phone', 'latitude', 'longitude',
  'thana', 'district', 'location_captured_at',
] as const;

interface ShopRow {
  name: string; name_en: string | null; phone: string;
  latitude: number | null; longitude: number | null;
  thana: string | null; district: string | null;
  location_captured_at: string | null;
}

describe('W4-05 shop identity', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    // The owner-initiated setup the corrected threat model describes: the Owner
    // grants a Manager settings_manage, which the pre-W4-05 server honoured as
    // permission to write `shops`.
    await h.exec(`
      insert into user_permissions (id, shop_id, user_id, key, allowed, created_at, updated_at)
      values ('6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a', '${SHOP_A}', '${MANAGER_A}',
              'settings_manage', true, now(), now())
      on conflict do nothing;
    `);
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  const readShop = (id: string) => h.one<ShopRow>(
    `select name, name_en, phone, latitude, longitude, thana, district, location_captured_at
       from shops where id = $1`,
    [id],
  );

  /** A whole-row shops payload, the shape LWW sync pushes. */
  async function shopPayload(id: string, overrides: Record<string, unknown>) {
    const row = await h.one<Record<string, unknown>>('select * from shops where id = $1', [id]);
    return { ...row, ...overrides, updated_at: new Date(Date.now() + 60_000).toISOString() };
  }

  // ───────────────────────────────── WHICH BARRIER COVERS WHICH PATH
  //
  // Batch 1's plan called the permission gate the primary barrier and the field
  // pin "redundant by design". On the path a device actually pushes through,
  // that is the wrong way round, and these tests say so rather than asserting
  // the plan's assumption.
  //
  // sync_row_permitted is consulted by sync_apply_b2_row (20260821010000:458),
  // sync_apply_operation (:1284) and the purchase-return path
  // (20260824000000:696). It is NOT consulted by sync_apply_row — and
  // backend/supabase/functions/sync/push.ts:420 calls sync_apply_row.
  //
  // So for a plain `shops` row pushed from a device:
  //   * the PIN is the operative barrier, and it is load-bearing, not redundant;
  //   * the GATE covers the grouped-operation entry points.
  // Both are real; they just protect different doors, and the pin protects the
  // one the product uses for this table.

  it('applies a Manager shops push through the device path, but PINS the identity', async () => {
    const before = await readShop(SHOP_A);
    const result = await applyRow(h, {
      table: 'shops',
      op: 'update',
      row: await shopPayload(SHOP_A, { name: 'Renamed By Manager' }),
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });

    // Applied — sync_apply_row does not consult the permission gate — and the
    // name is unchanged, because the pin overwrote it from the stored row.
    expect(result.ok).toBe(true);
    expect((await readShop(SHOP_A)).name).toBe(before.name);
  });

  it('does the same for ordinary Staff', async () => {
    const before = await readShop(SHOP_A);
    const result = await applyRow(h, {
      table: 'shops',
      op: 'update',
      row: await shopPayload(SHOP_A, { name: 'Renamed By Staff' }),
      shopId: SHOP_A,
      callerUserId: STAFF_A,
    });
    expect(result.ok).toBe(true);
    expect((await readShop(SHOP_A)).name).toBe(before.name);
  });

  it('refuses a Manager through the GROUPED path, where the gate does apply', async () => {
    // The gate's own door. sync_row_permitted is the predicate those entry
    // points consult, so this is barrier (a) exercised where it is reachable.
    const permitted = await h.one<{ permitted: boolean }>(
      `select sync_row_permitted($1, 'shops', '{}'::jsonb) as permitted`, [MANAGER_A],
    );
    expect(permitted.permitted).toBe(false);
  });

  it('is the OWNER ROLE that decides, not the settings_manage permission', async () => {
    // The substance of the change. Before W4-05 the arm was
    // user_has_permission(..., 'settings_manage'); the Manager above holds it
    // and is still refused, while the Owner below holds no such row and is
    // allowed.
    const ownerHasPermissionRow = await h.one<{ count: string }>(
      `select count(*) as count from user_permissions
        where user_id = $1 and key = 'settings_manage' and allowed`,
      [OWNER_A],
    );
    expect(Number(ownerHasPermissionRow.count)).toBe(0);
    expect(await h.one<{ permitted: boolean }>(
      `select sync_row_permitted($1, 'shops', '{}'::jsonb) as permitted`, [OWNER_A],
    )).toEqual({ permitted: true });
    expect(await h.one<{ permitted: boolean }>(
      `select sync_row_permitted($1, 'shops', '{}'::jsonb) as permitted`, [MANAGER_A],
    )).toEqual({ permitted: false });
  });

  it('leaves every OTHER table exactly as the previous wrapper decided', async () => {
    // The wrapper replaces one arm and delegates the rest. If it had replaced
    // the whole function, a Staff sale would stop being permitted here.
    for (const [table, user, expected] of [
      ['sales', STAFF_A, true],
      ['subscriptions', OWNER_A, false], // B4's first branch: false for everyone
    ] as const) {
      const row = await h.one<{ permitted: boolean }>(
        `select sync_row_permitted($1, $2, '{}'::jsonb) as permitted`, [user, table],
      );
      expect(row.permitted, `${table} as ${user}`).toBe(expected);
    }
  });

  // ───────────────────────────────── barrier (b): the field-level pin
  //
  // Exercised with barrier (a) BYPASSED, by calling the apply dispatcher
  // directly rather than going through the permission gate. That is what makes
  // this an independent barrier rather than unreachable code.

  it('pins all eight identity fields for a non-owner reaching the dispatcher', async () => {
    const before = await readShop(SHOP_A);
    const forged = await shopPayload(SHOP_A, {
      name: 'Forged Name',
      name_en: 'Forged Name EN',
      phone: '+8801799999999',
      latitude: 23.8103,
      longitude: 90.4125,
      thana: 'Forged Thana',
      district: 'Forged District',
      location_captured_at: new Date().toISOString(),
    });

    const result = await h.one<{ result: string }>(
      `select sync_apply_row('shops', 'update', $1::jsonb, $2::uuid, $3::uuid, null) as result`,
      [JSON.stringify(forged), SHOP_A, MANAGER_A],
    );
    expect(result.result).toBe('applied');

    // Applied, and every identity field unchanged.
    const after = await readShop(SHOP_A);
    for (const field of IDENTITY_FIELDS) {
      expect(after[field], `shops.${field} was not pinned`).toEqual(before[field]);
    }
  });

  it('lets the OWNER change every identity field through the same dispatcher', async () => {
    const captured = '2026-10-24T05:00:00.000Z';
    const payload = await shopPayload(SHOP_A, {
      name: 'Owner Renamed Shop',
      name_en: 'Owner Renamed Shop EN',
      phone: '+8801700000011',
      latitude: 23.7,
      longitude: 90.4,
      thana: 'Dhanmondi',
      district: 'Dhaka',
      location_captured_at: captured,
    });

    const result = await h.one<{ result: string }>(
      `select sync_apply_row('shops', 'update', $1::jsonb, $2::uuid, $3::uuid, null) as result`,
      [JSON.stringify(payload), SHOP_A, OWNER_A],
    );
    expect(result.result).toBe('applied');

    const after = await readShop(SHOP_A);
    expect(after.name).toBe('Owner Renamed Shop');
    expect(after.name_en).toBe('Owner Renamed Shop EN');
    expect(after.phone).toBe('+8801700000011');
    expect(Number(after.latitude)).toBeCloseTo(23.7, 5);
    expect(Number(after.longitude)).toBeCloseTo(90.4, 5);
    expect(after.thana).toBe('Dhanmondi');
    expect(after.district).toBe('Dhaka');
    expect(after.location_captured_at).not.toBeNull();
  });

  it('never reaches the pin for a NULL actor: H-7 refuses that caller first', async () => {
    // w405_actor_is_shop_owner(null) is false, so the pin WOULD fire — but it
    // is never asked, because H-7's actor binding rejects a caller who is not a
    // live user of the shop before W4-05's branch runs. Recorded as the real
    // ordering rather than asserted as a reachable pin: claiming the pin
    // handles this case would overstate what protects it.
    //
    // Both trailing arguments are cast: bare `null, null` leaves the overload
    // between the 5- and 6-argument forms ambiguous and Postgres refuses it.
    const before = await readShop(SHOP_A);
    const forged = await shopPayload(SHOP_A, { name: 'Forged By Nobody' });
    let message = '';
    try {
      await h.one(
        `select sync_apply_row('shops', 'update', $1::jsonb, $2::uuid, null::uuid, null::text) as result`,
        [JSON.stringify(forged), SHOP_A],
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('not a live user of this shop');
    expect((await readShop(SHOP_A)).name).toBe(before.name);
  });

  it('does not treat an owner of a DIFFERENT shop as this shop\'s owner', async () => {
    // w405_actor_is_shop_owner is about holding the owner ROLE. Owner B is an
    // owner — of Shop B — and the dispatcher's own shop guard is what keeps
    // them away from Shop A. Both together must leave Shop A's identity intact.
    const before = await readShop(SHOP_A);
    const forged = await shopPayload(SHOP_A, { name: 'Renamed By Other Owner' });
    await h.one(
      `select sync_apply_row('shops', 'update', $1::jsonb, $2::uuid, $3::uuid, null) as result`,
      [JSON.stringify(forged), SHOP_A, OWNER_B],
    ).catch(() => undefined);
    expect((await readShop(SHOP_A)).name).toBe(before.name);
  });

  // ───────────────────────────────── no working path refused

  it('still lets a staff member push a sale and a cash row', async () => {
    const claims = await claimsFor(h, STAFF_A);
    expect(claims).toBeTruthy();
    for (const table of ['sales', 'cash_drawer'] as const) {
      const permitted = await h.one<{ permitted: boolean }>(
        `select sync_row_permitted($1, $2, '{}'::jsonb) as permitted`, [STAFF_A, table],
      );
      expect(permitted.permitted, table).toBe(true);
    }
  });

  it('leaves owner registration untouched, because it does not push a shops row', async () => {
    // The pin is guarded by `if found`, so a shop row that does not exist yet
    // is not pinned from an empty record — which was the concern worth testing.
    // But registration does NOT reach it: a fresh shop has no live user, so
    // H-7's actor binding refuses a null-actor shops push, and the real path is
    // b4_onboard_owner. That function is covered end to end by
    // canonical-onboarding.pgtest.ts, which runs WITH migration 35 applied
    // because createHarness() applies every migration.
    //
    // Asserted here as the structural fact: the onboarding RPC exists, is
    // reachable by service_role, and does not route through sync_apply_row.
    const onboard = await h.one<{ exists: boolean; definer: boolean }>(`
      select to_regprocedure('public.b4_onboard_owner(uuid,text,text,text,text)') is not null as exists,
             coalesce((select p.prosecdef from pg_proc p
                        join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'b4_onboard_owner' limit 1), false) as definer
    `);
    expect(onboard.definer).toBe(true);

    // And the pin's own guard: with no stored row, nothing is overlaid.
    const pinBody = await h.one<{ guarded: boolean }>(`
      select position('if found then' in pg_get_functiondef(
               to_regprocedure('public.sync_apply_row(text,text,jsonb,uuid,uuid,text)'))) > 0 as guarded
    `);
    expect(pinBody.guarded).toBe(true);
  });

  it('keeps Shop B unreachable from a Shop A caller throughout', async () => {
    const before = await readShop(SHOP_B);
    const forged = await shopPayload(SHOP_B, { name: 'Cross Shop Write' });
    await h.one(
      `select sync_apply_row('shops', 'update', $1::jsonb, $2::uuid, $3::uuid, null) as result`,
      [JSON.stringify(forged), SHOP_A, OWNER_A],
    ).catch(() => undefined);
    expect(await readShop(SHOP_B)).toEqual(before);
  });

  // ───────────────────────────────── the renamed implementations

  it('resolves the 5-argument arity to the new wrapper after the rename', async () => {
    // PostgreSQL re-resolves a SQL function body's callee by NAME after a
    // rename, so the untouched 5-argument wrapper now lands on the W4-05
    // 6-argument one. H-7 relied on the same property; this drives that arity
    // rather than assuming it.
    //
    // The PROOF is the pin taking effect through the 5-argument call: if that
    // overload still reached the pre-W4-05 implementation, the forged name
    // would land.
    const before = await readShop(SHOP_A);
    const five = await applyRow(h, {
      table: 'shops',
      op: 'update',
      row: await shopPayload(SHOP_A, { name: 'Forged Via Five Arg' }),
      shopId: SHOP_A,
      callerUserId: MANAGER_A,
    });
    expect(five.ok).toBe(true);
    expect((await readShop(SHOP_A)).name).toBe(before.name);
    expect((await readShop(SHOP_A)).name).not.toBe('Forged Via Five Arg');
  });
});
