import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

// The canonical onboarding path, in REAL Postgres, under the REAL service_role
// ACL — the two things whose absence let this ship broken four times.
//
// What is being proven is an equivalence, not a feature: the DEV Skip-OTP flow
// and the real OTP flow must reach the SAME database state through the SAME
// function, differing only in how the session was authenticated. Anything that
// makes DEV special again should fail here.

const OTP_SHOP = '20000000-0000-4000-8000-000000000001';
const OTP_OWNER = '20000000-0000-4000-8000-000000000002';
const OTP_ROLE = '20000000-0000-4000-8000-000000000003';
const OTP_AUTH = '20000000-0000-4000-8000-00000000000a';

const DEV_SHOP = '30000000-0000-4000-8000-000000000001';
const DEV_OWNER = '30000000-0000-4000-8000-000000000002';
const DEV_ROLE = '30000000-0000-4000-8000-000000000003';
const DEV_AUTH = '30000000-0000-4000-8000-00000000000a';

const T0 = '2026-09-05T00:00:00.000Z';
const PIN_HASH = `$2a$10$${'.'.repeat(53)}`;

interface OnboardInput {
  shopId: string; ownerId: string; ownerRoleId: string;
  shopName: string; phone: string | null;
}

/** Exactly the payload the sync function sends, for either flow. */
function payload(input: OnboardInput): Record<string, unknown> {
  const role = (suffix: string, name: string) => ({
    id: input.ownerRoleId.slice(0, -1) + suffix,
    shopId: input.shopId, name, createdAt: T0, updatedAt: T0,
  });
  return {
    shop: {
      id: input.shopId, ownerId: input.ownerId, name: input.shopName,
      nameEn: null, phone: input.phone, createdAt: T0, updatedAt: T0,
    },
    roles: [
      { id: input.ownerRoleId, shopId: input.shopId, name: 'owner', createdAt: T0, updatedAt: T0 },
      role('7', 'manager'),
      role('8', 'staff'),
    ],
    owner: {
      id: input.ownerId, shopId: input.shopId, name: input.shopName, phone: input.phone,
      pinHash: PIN_HASH, pinSetAt: null, roleId: input.ownerRoleId,
      createdAt: T0, updatedAt: T0,
    },
    settings: { id: input.shopId.slice(0, -1) + 'f' },
  };
}

const OTP_INPUT: OnboardInput = {
  shopId: OTP_SHOP, ownerId: OTP_OWNER, ownerRoleId: OTP_ROLE,
  shopName: 'Real Pharmacy', phone: '+8801711111111',
};
/** The DEV placeholder, made unique per shop so it cannot collide globally. */
const DEV_INPUT: OnboardInput = {
  shopId: DEV_SHOP, ownerId: DEV_OWNER, ownerRoleId: DEV_ROLE,
  shopName: 'DEV Test Shop', phone: '+8801700030000',
};

interface SqlFailure { code: string | null; message: string }

async function failure(fn: () => Promise<unknown>): Promise<SqlFailure | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code : null;
    return { code, message: error instanceof Error ? error.message : String(error) };
  }
}

describe('canonical Owner onboarding', () => {
  let h: Harness;

  const onboard = (input: OnboardInput) =>
    h.as('service_role', null, () => h.one<{ result: Record<string, unknown> }>(
      'select b4_onboard_owner($1::jsonb) as result', [JSON.stringify(payload(input))],
    ));

  /** Everything the sync function does after onboarding, in the same order. */
  const bind = async (input: OnboardInput, authUserId: string) => {
    await h.exec(`insert into auth_bindings (app_user_id, auth_user_id)
      values ('${input.ownerId}','${authUserId}') on conflict do nothing`);
    await h.as('service_role', null, () => h.one(
      'select b4_ensure_owner_billing_account($1::uuid,$2::uuid)', [input.ownerId, input.shopId]));
  };

  const claimsFor = (authUserId: string) =>
    h.one<{ claims: Record<string, unknown> }>(`
      select custom_access_token_hook(jsonb_build_object(
        'user_id','${authUserId}','claims',jsonb_build_object('app_metadata','{}'::jsonb)
      )) -> 'claims' -> 'app_metadata' as claims`);

  beforeEach(async () => { h = await createHarness(); }, 60_000);

  // ── 9. the ACL this all runs under ────────────────────────────────────────
  it('runs under the production ACL, with no grant-all masking', async () => {
    expect(await h.one(`select
      has_table_privilege('service_role','public.shops','INSERT') as shops_insert,
      has_table_privilege('service_role','public.shops','UPDATE') as shops_update,
      has_table_privilege('service_role','public.roles','INSERT') as roles_insert,
      has_table_privilege('service_role','public.users','INSERT') as users_insert,
      has_function_privilege('service_role','b4_onboard_owner(jsonb)','EXECUTE') as onboard,
      has_function_privilege('service_role','b4_mutate_owned_shop(uuid,uuid,text,text,text)','EXECUTE') as mutate
    `)).toEqual({
      shops_insert: false, shops_update: false, roles_insert: false, users_insert: false,
      onboard: true, mutate: true,
    });
  });

  it('is reachable by nobody else', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect(await h.one<{ ok: boolean }>(
        `select has_function_privilege($1,'b4_onboard_owner(jsonb)','EXECUTE') as ok`, [role],
      )).toEqual({ ok: false });
    }
  });

  // ── 1 & 2. one function, both flows ───────────────────────────────────────
  it('completes a real post-OTP registration', async () => {
    expect((await onboard(OTP_INPUT)).result).toMatchObject({
      shopId: OTP_SHOP, ownerUserId: OTP_OWNER, ownerRoleId: OTP_ROLE,
      roles: ['manager', 'owner', 'staff'],
    });
  });

  it('completes a DEV registration through the identical function', async () => {
    expect((await onboard(DEV_INPUT)).result).toMatchObject({
      shopId: DEV_SHOP, ownerUserId: DEV_OWNER, roles: ['manager', 'owner', 'staff'],
    });
  });

  // ── 3 & 10. equivalence, and the claims the device depends on ─────────────
  it('produces claims for the DEV owner indistinguishable in shape from the OTP owner', async () => {
    await onboard(OTP_INPUT); await bind(OTP_INPUT, OTP_AUTH);
    await onboard(DEV_INPUT); await bind(DEV_INPUT, DEV_AUTH);

    const otp = (await claimsFor(OTP_AUTH)).claims;
    const dev = (await claimsFor(DEV_AUTH)).claims;

    expect(Object.keys(otp).sort()).toEqual(Object.keys(dev).sort());
    expect(otp).toMatchObject({
      app_user_id: OTP_OWNER, principal_user_id: OTP_OWNER, shop_id: OTP_SHOP,
      role: 'owner', permission_version: 0, is_active: true,
    });
    expect(dev).toMatchObject({
      app_user_id: DEV_OWNER, principal_user_id: DEV_OWNER, shop_id: DEV_SHOP,
      role: 'owner', permission_version: 0, is_active: true,
    });
    for (const claims of [otp, dev]) {
      expect(claims.billing_account_id).toEqual(expect.any(String));
    }
  });

  // ── 5. idempotency ────────────────────────────────────────────────────────
  it('is idempotent: re-running onboarding rewrites and duplicates nothing', async () => {
    await onboard(DEV_INPUT);
    const before = await h.one(`select
      (select count(*)::integer from shops where id='${DEV_SHOP}') as shops,
      (select count(*)::integer from roles where shop_id='${DEV_SHOP}') as roles,
      (select count(*)::integer from users where shop_id='${DEV_SHOP}') as users,
      (select updated_at::text from users where id='${DEV_OWNER}') as owner_updated`);

    await onboard(DEV_INPUT);
    await onboard(DEV_INPUT);

    expect(await h.one(`select
      (select count(*)::integer from shops where id='${DEV_SHOP}') as shops,
      (select count(*)::integer from roles where shop_id='${DEV_SHOP}') as roles,
      (select count(*)::integer from users where shop_id='${DEV_SHOP}') as users,
      (select updated_at::text from users where id='${DEV_OWNER}') as owner_updated`))
      .toEqual(before);
    expect(before).toMatchObject({ shops: 1, roles: 3, users: 1 });
  });

  // ── 6. the trial ──────────────────────────────────────────────────────────
  it('grants the 14-day trial exactly once, however many times onboarding runs', async () => {
    await onboard(DEV_INPUT); await bind(DEV_INPUT, DEV_AUTH);
    const first = await h.one<{ at: string }>(
      `select launch_trial_granted_at::text as at from billing_accounts where principal_owner_user_id='${DEV_OWNER}'`);

    await onboard(DEV_INPUT); await bind(DEV_INPUT, DEV_AUTH);

    expect(await h.one(
      `select launch_trial_granted_at::text as at from billing_accounts where principal_owner_user_id='${DEV_OWNER}'`))
      .toEqual(first);
    expect(await h.one<{ accounts: number; entitlements: number; status: string; days: number }>(`
      select (select count(*)::integer from billing_accounts where principal_owner_user_id='${DEV_OWNER}') as accounts,
             (select count(*)::integer from entitlement_snapshots e join billing_accounts b on b.id=e.billing_account_id
                where b.principal_owner_user_id='${DEV_OWNER}') as entitlements,
             e.status, extract(day from e.trial_ends_at-b.launch_trial_granted_at)::integer as days
      from billing_accounts b join entitlement_snapshots e on e.billing_account_id=b.id
      where b.principal_owner_user_id='${DEV_OWNER}'`))
      .toEqual({ accounts: 1, entitlements: 1, status: 'trialing', days: 14 });
  });

  // ── 7. the exact legacy state on the physical device ──────────────────────
  it('recovers a partial legacy registration: shop and role present, Owner missing', async () => {
    // eb2dfd28 on the device: v9 created the shop and the owner role, then died
    // on the Owner row. Onboarding must complete it, not fork it.
    await onboard(DEV_INPUT);
    // The Owner row is what the trigger users_activate_primary_owner_trial
    // hangs the billing account off, so unwinding to the device's actual state
    // means removing the account too — which is exactly what the device has:
    // shop and role present, no Owner, no billing_accounts row.
    // Order matters: every reference is ON DELETE RESTRICT, so the shop's FK is
    // released before the account it points at can go.
    await h.exec(`
      update shops set billing_account_id=null where id='${DEV_SHOP}';
      delete from shop_memberships where actor_user_id='${DEV_OWNER}';
      delete from entitlement_snapshots where billing_account_id in
        (select id from billing_accounts where principal_owner_user_id='${DEV_OWNER}');
      delete from billing_accounts where principal_owner_user_id='${DEV_OWNER}';
      delete from users where id='${DEV_OWNER}';
    `);
    const shopBefore = await h.one(`select created_at::text as at from shops where id='${DEV_SHOP}'`);

    expect((await onboard(DEV_INPUT)).result).toMatchObject({ ownerUserId: DEV_OWNER });

    expect(await h.one(`select created_at::text as at from shops where id='${DEV_SHOP}'`)).toEqual(shopBefore);
    expect(await h.one<{ n: number }>(
      `select count(*)::integer as n from shops where id='${DEV_SHOP}'`)).toEqual({ n: 1 });
  });

  it('names the phone collision instead of leaking a raw 23505', async () => {
    // users_phone_unique is global. The old DEV flow hardcoded ONE placeholder
    // number for every registration, so the second DEV shop could never have an
    // Owner — which is what the device was actually failing on.
    await onboard(OTP_INPUT);
    const collided = await failure(() => onboard({
      ...DEV_INPUT, phone: OTP_INPUT.phone,
    }));

    expect(collided?.code).toBe('MU043');
    expect(collided?.message).toContain('phone already registered');
  });

  it('refuses to attach an Owner to a shop that belongs to somebody else', async () => {
    await onboard(OTP_INPUT);
    // Internally consistent but pointed at a shop that already has a different
    // owner_id — caught by the ownership check (MU042), not the shape check.
    const stolen = await failure(() => onboard({ ...DEV_INPUT, shopId: OTP_SHOP }));
    expect(stolen?.code).toBe('MU042');
    expect(stolen?.message).toContain('already belongs to another owner');
  });

  it('refuses a payload whose shop and owner disagree about each other', async () => {
    const inconsistent = await failure(() => h.as('service_role', null, () => h.one(
      'select b4_onboard_owner($1::jsonb)',
      [JSON.stringify({
        ...payload(DEV_INPUT),
        shop: { ...(payload(DEV_INPUT).shop as object), ownerId: OTP_OWNER },
      })],
    )));
    expect(inconsistent?.code).toBe('MU041');
  });

  it('refuses a payload whose owner role belongs to another shop', async () => {
    const crossShop = await failure(() => h.as('service_role', null, () => h.one(
      'select b4_onboard_owner($1::jsonb)',
      [JSON.stringify({
        ...payload(DEV_INPUT),
        roles: [{ id: DEV_ROLE, shopId: OTP_SHOP, name: 'owner', createdAt: T0, updatedAt: T0 }],
      })],
    )));
    expect(crossShop?.code).toBe('MU041');
  });
});

// ── 8. Multi-Shop ───────────────────────────────────────────────────────────

describe('Multi-Shop create, rename, archive, restore', () => {
  let h: Harness;
  let accountId: string;
  let secondShop: string;

  beforeEach(async () => {
    h = await createHarness();
    await h.as('service_role', null, () => h.one(
      'select b4_onboard_owner($1::jsonb)', [JSON.stringify(payload(OTP_INPUT))]));
    await h.exec(`insert into auth_bindings (app_user_id, auth_user_id) values ('${OTP_OWNER}','${OTP_AUTH}')`);
    await h.as('service_role', null, () => h.one(
      'select b4_ensure_owner_billing_account($1::uuid,$2::uuid)', [OTP_OWNER, OTP_SHOP]));
    accountId = (await h.one<{ id: string }>(
      `select id::text as id from billing_accounts where principal_owner_user_id='${OTP_OWNER}'`)).id;
    // A trialing owner is effective Ultra, so a second shop is permitted.
    const created = await h.as('service_role', null, () => h.one<{ result: { shopId: string } }>(
      `select b4_create_owned_shop($1::uuid,'Second Branch',null,null) as result`, [OTP_OWNER]));
    secondShop = created.result.shopId;
  }, 60_000);

  it('creates the second shop on the same billing account, with no second trial', async () => {
    expect(await h.one<{ shops: number; accounts: number }>(`
      select (select count(*)::integer from shops where billing_account_id='${accountId}') as shops,
             (select count(*)::integer from billing_accounts) as accounts`))
      .toEqual({ shops: 2, accounts: 1 });
  });

  it('renames through the definer path that service_role may actually use', async () => {
    // .from("shops").update(...) is 42501 here: service_role has SELECT on shops
    // and nothing more. multiShop.ts reported that as 404 "Shop not found".
    const denied = await h.as('service_role', null, () => failure(() => h.one(
      `update shops set name='Direct' where id=$1::uuid`, [secondShop])));
    expect(denied?.code).toBe('42501');

    const renamed = await h.as('service_role', null, () => h.one<{ result: { name: string } }>(
      `select b4_mutate_owned_shop($1::uuid,$2::uuid,'rename','Renamed Branch',null) as result`,
      [accountId, secondShop]));
    expect(renamed.result.name).toBe('Renamed Branch');
  });

  it('archives and restores, and refuses to archive the billing anchor', async () => {
    const archived = await h.as('service_role', null, () => h.one<{ result: { archived_at: string | null } }>(
      `select b4_mutate_owned_shop($1::uuid,$2::uuid,'archive',null,null) as result`, [accountId, secondShop]));
    expect(archived.result.archived_at).toEqual(expect.any(String));

    const restored = await h.as('service_role', null, () => h.one<{ result: { archived_at: string | null } }>(
      `select b4_mutate_owned_shop($1::uuid,$2::uuid,'restore',null,null) as result`, [accountId, secondShop]));
    expect(restored.result.archived_at).toBeNull();

    const anchor = await h.as('service_role', null, () => failure(() => h.one(
      `select b4_mutate_owned_shop($1::uuid,$2::uuid,'archive',null,null)`, [accountId, OTP_SHOP])));
    expect(anchor?.code).toBe('MU046');
  });

  it('refuses a shop on another billing account', async () => {
    const foreign = await h.as('service_role', null, () => failure(() => h.one(
      `select b4_mutate_owned_shop($1::uuid,$2::uuid,'rename','Nope',null)`,
      ['00000000-0000-4000-8000-0000000000ff', secondShop])));
    expect(foreign?.code).toBe('MU045');
  });

  it('switches: the hook resolves the active shop through shop_memberships', async () => {
    const claims = await h.one<{ claims: Record<string, unknown> }>(`
      select custom_access_token_hook(jsonb_build_object(
        'user_id','${OTP_AUTH}',
        'claims',jsonb_build_object('app_metadata',jsonb_build_object('active_shop_id','${secondShop}'))
      )) -> 'claims' -> 'app_metadata' as claims`);

    expect(claims.claims).toMatchObject({
      shop_id: secondShop, principal_user_id: OTP_OWNER, role: 'owner',
    });
    // The actor for the second shop is its own users row, not the principal.
    expect(claims.claims.app_user_id).not.toBe(OTP_OWNER);
  });
});
