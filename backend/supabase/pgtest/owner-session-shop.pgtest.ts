import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createHarness,
  OWNER_A,
  OWNER_B,
  seedShops,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  type Harness,
} from './harness';

/**
 * Migration 43 — one owner, many shops (founder-approved plan 2026-11-23).
 *
 *  1. The token hook names the shop a SESSION is bound to (auth_session_devices),
 *     so two phones of the same owner in two shops no longer evict each other;
 *     an unbound session still follows app_metadata.active_shop_id.
 *  2. owner_set_pin_all_shops writes one PIN hash to every live owner actor of
 *     the principal, atomically, and to nobody else.
 */

const AUTH_A = '9a000000-0000-4000-8000-0000000000a1';
const HASH = `$2b$10$${'a'.repeat(53)}`;
let sessionCounter = 0;

function newSession(): string {
  sessionCounter += 1;
  return `5e543000-0000-4000-8000-${String(sessionCounter).padStart(12, '0')}`;
}

type Metadata = Record<string, unknown>;

describe('migration 43: one owner, many shops', () => {
  let h: Harness;
  let shopA2: string;
  let actorA2: string;

  async function hook(sessionId: string | null, activeShopId: string | null): Promise<Metadata> {
    const claims: Record<string, unknown> = {
      app_metadata: activeShopId ? { active_shop_id: activeShopId } : {},
    };
    if (sessionId) claims.session_id = sessionId;
    const row = await h.one<{ out: { claims: { app_metadata: Metadata } } }>(
      'select custom_access_token_hook($1::jsonb) as out',
      [JSON.stringify({ user_id: AUTH_A, claims })],
    );
    return row.out.claims.app_metadata;
  }

  async function bindSession(shopId: string, actorUserId: string): Promise<string> {
    const session = newSession();
    await h.one(
      `select a23_bind_auth_session($1, $2, $3, $4, $5, '', 'android', 'A04s', '14') as value`,
      [session, shopId, actorUserId, `install-${session}`, `hash-of-${session}`],
    );
    return session;
  }

  async function refusal(sql: string, params: unknown[]): Promise<string | null> {
    try {
      await h.one(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    const created = await h.one<{ result: { shopId: string; actorUserId: string } }>(
      `select b4_create_owned_shop($1::uuid,'Second Branch',null,null)::jsonb as result`,
      [OWNER_A],
    );
    shopA2 = created.result.shopId;
    actorA2 = created.result.actorUserId;
    await h.exec(`insert into auth_bindings (app_user_id, auth_user_id) values ('${OWNER_A}', '${AUTH_A}')`);
  }, 60_000);
  afterAll(async () => h.close());

  describe('the token hook names the session\'s own shop', () => {
    it('keeps an unbound session on app_metadata, exactly as before', async () => {
      expect(await hook(null, SHOP_A)).toMatchObject({ shop_id: SHOP_A, app_user_id: OWNER_A });
      expect(await hook(newSession(), shopA2)).toMatchObject({ shop_id: shopA2, app_user_id: actorA2 });
    });

    it('prefers the shop the session is bound to over the account-wide active shop', async () => {
      const session = await bindSession(shopA2, actorA2);
      // app_metadata still says Shop A — what another phone's login would leave.
      expect(await hook(session, SHOP_A)).toMatchObject({
        shop_id: shopA2, active_shop_id: shopA2, app_user_id: actorA2, principal_user_id: OWNER_A,
      });
    });

    it('lets two sessions of one owner stand in two shops at the same time', async () => {
      const phoneOne = await bindSession(SHOP_A, OWNER_A);
      const phoneTwo = await bindSession(shopA2, actorA2);
      // One shared app_metadata, two independent answers.
      expect(await hook(phoneOne, shopA2)).toMatchObject({ shop_id: SHOP_A, app_user_id: OWNER_A });
      expect(await hook(phoneTwo, SHOP_A)).toMatchObject({ shop_id: shopA2, app_user_id: actorA2 });
    });

    it('ignores a binding that is not this principal\'s member there', async () => {
      // A session bound to another owner's shop cannot steer this principal.
      const foreign = await bindSession(SHOP_B, OWNER_B);
      expect(await hook(foreign, SHOP_A)).toMatchObject({ shop_id: SHOP_A, app_user_id: OWNER_A });
    });

    it('never names an archived shop, bound or not', async () => {
      const session = await bindSession(shopA2, actorA2);
      await h.exec(`update shops set archived_at = now() where id = '${shopA2}'`);
      try {
        const claims = await hook(session, shopA2);
        expect(claims.shop_id).not.toBe(shopA2);
        expect(claims.app_user_id).toBe(OWNER_A);
      } finally {
        await h.exec(`update shops set archived_at = null where id = '${shopA2}'`);
      }
    });

    it('is still executable by the auth service only', async () => {
      const allowed = async (role: string) => (await h.one<{ ok: boolean }>(
        `select has_function_privilege($1,'custom_access_token_hook(jsonb)','execute') as ok`, [role],
      )).ok;
      expect(await allowed('supabase_auth_admin')).toBe(true);
      expect(await allowed('authenticated')).toBe(false);
      expect(await allowed('anon')).toBe(false);
    });
  });

  describe('owner_set_pin_all_shops', () => {
    const SET = 'select owner_set_pin_all_shops($1::uuid,$2::text) as result';

    it('writes one hash to every owner actor of the principal, and to nobody else', async () => {
      const before = await h.all<{ id: string; v: number }>(
        `select id::text, permission_version as v from users where id in ($1,$2) order by id`,
        [OWNER_A, actorA2],
      );
      const { result } = await h.one<{ result: { pinSetAt: string; actorUserIds: string[] } }>(SET, [OWNER_A, HASH]);
      expect([...result.actorUserIds].sort()).toEqual([OWNER_A, actorA2].sort());

      const owners = await h.all<{ id: string; pin_hash: string; same_time: boolean; v: number }>(
        `select id::text, pin_hash, pin_set_at = $3::timestamptz as same_time, permission_version as v
           from users where id in ($1,$2) order by id`,
        [OWNER_A, actorA2, result.pinSetAt],
      );
      expect(owners.every((row) => row.pin_hash === HASH && row.same_time)).toBe(true);
      // Tokens minted under the old PIN go stale on every owner actor.
      owners.forEach((row, index) => expect(row.v).toBeGreaterThan(before[index]!.v));

      const untouched = await h.all<{ pin_hash: string }>(
        'select pin_hash from users where id in ($1,$2)', [STAFF_A, OWNER_B],
      );
      expect(untouched.map((row) => row.pin_hash).sort()).toEqual(['hash-owner-b', 'hash-staff-a']);

      const audit = await h.all<{ shop_id: string }>(
        `select shop_id::text from audit_logs where action = 'pin_changed' and meta = 'all_owner_shops'
           and actor_id in ($1,$2) order by shop_id`,
        [OWNER_A, actorA2],
      );
      expect(audit.map((row) => row.shop_id).sort()).toEqual([SHOP_A, shopA2].sort());
    });

    it('refuses anything but a bcrypt hash and writes nothing', async () => {
      const before = await h.one<{ pin_hash: string }>('select pin_hash from users where id=$1', [OWNER_A]);
      for (const bad of ['1234', '', 'plain-text-pin', `$2b$10$${'a'.repeat(52)}`]) {
        expect(await refusal(SET, [OWNER_A, bad])).toBe('MU080');
      }
      expect(await refusal(SET, [null, HASH])).toBe('MU080');
      expect(await h.one('select pin_hash from users where id=$1', [OWNER_A])).toEqual(before);
    });

    it('refuses a principal with no live owner account', async () => {
      expect(await refusal(SET, ['00000000-0000-4000-8000-0000000000ff', HASH])).toBe('MU081');
      // A staff member is not an owner principal.
      expect(await refusal(SET, [STAFF_A, HASH])).toBe('MU081');
    });

    it('skips a deactivated owner actor', async () => {
      const other = `$2b$10$${'b'.repeat(53)}`;
      await h.exec(`update users set is_active = false where id = '${actorA2}'`);
      try {
        const { result } = await h.one<{ result: { actorUserIds: string[] } }>(SET, [OWNER_A, other]);
        expect(result.actorUserIds).toEqual([OWNER_A]);
        expect(await h.one('select pin_hash from users where id=$1', [actorA2])).toEqual({ pin_hash: HASH });
      } finally {
        await h.exec(`update users set is_active = true where id = '${actorA2}'`);
      }
    });

    it('is executable by the service role only', async () => {
      const allowed = async (role: string) => (await h.one<{ ok: boolean }>(
        `select has_function_privilege($1,'owner_set_pin_all_shops(uuid,text)','execute') as ok`, [role],
      )).ok;
      expect(await allowed('service_role')).toBe(true);
      expect(await allowed('authenticated')).toBe(false);
      expect(await allowed('anon')).toBe(false);
    });
  });
});
