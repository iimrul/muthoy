import { randomInt, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANON_KEY, AUTH_ORIGIN, AuthServerDouble, SERVICE_ROLE_KEY } from './authServerDouble';
import { createHarness, type Harness } from './harness';
import { restDouble } from './restDouble';
import { httpErrorBody } from '../functions/sync/errorResponse.ts';

// H-5 (DEV, 2026-10-05) — session revocation, EXECUTED.
//
// Three places in the sync function cut an auth user's sessions with
// `auth.admin.signOut(<user id>, "global")`. That admin call takes a logged-in
// JWT; GoTrue answered every one of them 403 bad_jwt. Owner PIN recovery
// failed after the OTP was spent, an auth-account rebind failed the same way,
// and signOutAppUser — which ignored the result — never signed anyone out. The
// only tests read the source as text, with the sign-out mocked away, so all of
// it shipped green.
//
// Here nothing on that path is mocked. recoverPin.ts, _shared/identity.ts and
// _shared/auth.ts run as written; supabase-js and auth-js run unmodified and
// send the requests they send to a hosted project; GoTrue's side is answered
// by authServerDouble.ts against GoTrue's own tables in a real Postgres, and
// PostgREST's by restDouble.ts as service_role against the real migrations.
// The one module replaced is the client factory, so both clients point there.

const mobileRequire = createRequire(resolve('apps/mobile/package.json'));

interface AuthClient {
  getUser(jwt: string): Promise<{ data: { user: unknown }; error: { name?: string; status?: number; code?: string } | null }>;
  refreshSession(session: { refresh_token: string }): Promise<{ error: { code?: string } | null }>;
  admin: { signOut(jwt: string, scope: string): Promise<{ error: { status?: number; code?: string } | null }> };
}
const { createClient } = mobileRequire('@supabase/supabase-js') as {
  createClient(url: string, key: string, options: Record<string, unknown>): { auth: AuthClient };
};
const bcrypt = mobileRequire('bcryptjs') as {
  hashSync(pin: string, rounds: number): string;
  compareSync(pin: string, hash: string): boolean;
};

const clients = vi.hoisted(() => ({
  admin: {} as Record<string | symbol, unknown>,
  anon: {} as Record<string | symbol, unknown>,
}));
vi.mock('../functions/sync/_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: new Proxy({}, { get: (_target, key) => clients.admin[key] }),
  supabaseAnon: new Proxy({}, { get: (_target, key) => clients.anon[key] }),
}));

const { recoverPin } = await import('../functions/sync/recoverPin.ts');
const { signOutAppUser, verifyCallerJwt } = await import('../functions/sync/_shared/auth.ts');
const { ensureAuthBinding, syntheticEmail } = await import('../functions/sync/_shared/identity.ts');

const OWNER_PIN = '1357';
const STAFF_PIN = '2468';
const NEW_PIN = '9024';
const OWNER_PIN_HASH = bcrypt.hashSync(OWNER_PIN, 10);
const STAFF_PIN_HASH = bcrypt.hashSync(STAFF_PIN, 10);
const REVOKE = 'public.h5_revoke_auth_user_sessions(uuid)';

let h: Harness;
let double: AuthServerDouble;
let anon: { auth: AuthClient };
let admin: { auth: AuthClient };
const events: string[] = [];

beforeAll(async () => {
  h = await createHarness();
  double = new AuthServerDouble(h, events);
  const rest = restDouble(h, events);
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: double.fetch },
  };
  admin = createClient(AUTH_ORIGIN, SERVICE_ROLE_KEY, options);
  anon = createClient(AUTH_ORIGIN, ANON_KEY, options);
  clients.admin = { auth: admin.auth, from: rest.from, rpc: rest.rpc };
  clients.anon = { auth: anon.auth };
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(() => {
  events.length = 0;
  double.calls.length = 0;
  double.failNextLogout = null;
  double.throwNextLogoutScope = null;
  double.failNextGenerateLink = null;
});

/** +8801XXXXXXXXX, unique per call — users.phone is a credential with a global unique index. */
function bdPhone(): string {
  return `+8801${randomInt(3, 10)}${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function sessionIds(authUserId: string): Promise<string[]> {
  const rows = await h.all<{ id: string }>('select id from auth.sessions where user_id = $1 order by created_at', [authUserId]);
  return rows.map((row) => row.id);
}

async function callerFor(accessToken: string) {
  return verifyCallerJwt(new Request('https://sync.internal/recover-pin', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
}

/** A Muthoy owner registered by OTP — on a lost phone and, now, verifying again — and a stranger. */
async function seedRecovery() {
  const shopId = randomUUID();
  const ownerId = randomUUID();
  const staffId = randomUUID();
  const ownerRole = randomUUID();
  const staffRole = randomUUID();
  const ownerPhone = bdPhone();
  const now = new Date().toISOString();
  await h.db.query(
    `insert into shops (id, owner_id, name, phone, created_at, updated_at)
     values ($1, $2, 'Recovery Shop', $3, $4, $4)`,
    [shopId, ownerId, ownerPhone, now],
  );
  await h.db.query(
    `insert into roles (id, shop_id, name, is_system, created_at, updated_at)
     values ($1, $3, 'owner', true, $4, $4), ($2, $3, 'staff', true, $4, $4)`,
    [ownerRole, staffRole, shopId, now],
  );
  await h.db.query(
    `insert into users (id, shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active, created_at, updated_at)
     values ($1, $3, 'Owner', $4, $6, $8, $9, true, $8, $8),
            ($2, $3, 'Staff', $5, $7, $8, $10, true, $8, $8)`,
    [ownerId, staffId, shopId, ownerPhone, bdPhone(), OWNER_PIN_HASH, STAFF_PIN_HASH, now, ownerRole, staffRole],
  );
  const ownerAuth = await double.createUser({ phone: ownerPhone.slice(1) });
  await h.db.query('insert into auth_bindings (app_user_id, auth_user_id) values ($1, $2)', [ownerId, ownerAuth]);
  const lostPhone = await double.signIn(ownerAuth, 'otp', new Date(Date.now() - 3 * 86_400_000));
  const otp = await double.signIn(ownerAuth, 'otp');
  const strangerAuth = await double.createUser({ phone: bdPhone().slice(1) });
  const stranger = await double.signIn(strangerAuth, 'otp');
  return { shopId, ownerId, ownerPhone, ownerAuth, lostPhone, otp, strangerAuth, stranger };
}

function recoverBody(phone: string, newPin: string, devicePublicId = `recovery-${randomUUID()}`) {
  return {
    action: 'recover-pin',
    phone,
    newPin,
    deviceRegistryVersion: 1,
    devicePublicId,
    label: 'Recovery phone',
    platform: 'android',
    model: 'test',
    osVersion: '14',
  };
}

async function ownerPinMatches(ownerId: string, pin: string): Promise<boolean> {
  const row = await h.one<{ pin_hash: string }>('select pin_hash from users where id = $1', [ownerId]);
  return bcrypt.compareSync(pin, row.pin_hash);
}

async function withoutServiceRoleExecute<T>(fn: () => Promise<T>): Promise<T> {
  await h.exec(`revoke execute on function ${REVOKE} from service_role`);
  try {
    return await fn();
  } finally {
    await h.exec(`grant execute on function ${REVOKE} to service_role`);
  }
}

/** Reproduces a genuine lookup failure: the GRANT a migration forgot. */
async function withoutServiceRoleSelect<T>(table: string, fn: () => Promise<T>): Promise<T> {
  await h.exec(`revoke select on table ${table} from service_role`);
  try {
    return await fn();
  } finally {
    await h.exec(`grant select on table ${table} to service_role`);
  }
}

describe('h5_revoke_auth_user_sessions, on GoTrue\'s own tables', () => {
  async function twoUsers() {
    const target = await double.createUser({ phone: bdPhone().slice(1) });
    const bystander = await double.createUser({ phone: bdPhone().slice(1) });
    const sessions = [await double.signIn(target), await double.signIn(target, 'magiclink')];
    const bystanderSession = await double.signIn(bystander);
    // A refresh token from before sessions existed: no session_id, so no cascade reaches it.
    await h.db.query(
      `insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id)
       values ($1, $2, false, now(), now(), null)`,
      [`legacy-${randomUUID()}`, target],
    );
    return { target, bystander, sessions, bystanderSession };
  }

  it('ends every session of exactly one auth user — refresh tokens and AMR claims with them — and nothing else', async () => {
    const { target, bystander, bystanderSession } = await twoUsers();
    const { result } = await h.as('service_role', null, () =>
      h.one<{ result: number }>(`select public.h5_revoke_auth_user_sessions($1) as result`, [target]));

    expect(result).toBe(2);
    const left = await h.one<Record<string, number>>(
      `select
         (select count(*) from auth.sessions where user_id = $1)::int as target_sessions,
         (select count(*) from auth.refresh_tokens where user_id = $1::text)::int as target_refresh_tokens,
         (select count(*) from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where s.user_id = $1)::int as target_claims,
         (select count(*) from auth.users where id = $1)::int as target_user,
         (select count(*) from auth.identities where user_id = $1)::int as target_identities,
         (select count(*) from auth.sessions where user_id = $2)::int as bystander_sessions,
         (select count(*) from auth.refresh_tokens where user_id = $2::text)::int as bystander_refresh_tokens`,
      [target, bystander],
    );
    expect(left).toEqual({
      target_sessions: 0,
      target_refresh_tokens: 0,
      target_claims: 0,
      target_user: 1,
      target_identities: 1,
      bystander_sessions: 1,
      bystander_refresh_tokens: 1,
    });
    expect(await sessionIds(bystander)).toEqual([bystanderSession.sessionId]);
  });

  it('leaves nothing a revoked refresh token can redeem, and the bystander\'s still works', async () => {
    const { target, sessions, bystanderSession } = await twoUsers();
    await h.as('service_role', null, () => h.one(`select public.h5_revoke_auth_user_sessions($1)`, [target]));

    for (const { refreshToken } of sessions) {
      const { error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
      expect(error?.code).toBe('refresh_token_not_found');
    }
    expect((await anon.auth.refreshSession({ refresh_token: bystanderSession.refreshToken })).error).toBeNull();
    // The revoked session's access token is refused wherever GoTrue looks the
    // session up: GoTrue answers session_not_found, which auth-js surfaces as
    // AuthSessionMissingError.
    const { data, error } = await admin.auth.getUser(sessions[0].accessToken);
    expect(data.user).toBeNull();
    expect(error).toMatchObject({ name: 'AuthSessionMissingError' });
  });

  it.each(['anon', 'authenticated'])('cannot be executed by %s', async (role) => {
    const { target } = await twoUsers();
    await expect(h.as(role, null, () => h.one(`select public.h5_revoke_auth_user_sessions($1)`, [target])))
      .rejects.toMatchObject({ code: '42501' });
    expect(await sessionIds(target)).toHaveLength(2);
  });

  it('is SECURITY DEFINER because it has to be: service_role cannot touch auth.sessions itself', async () => {
    const { target } = await twoUsers();
    await expect(h.as('service_role', null, () => h.exec(`delete from auth.sessions where user_id = '${target}'`)))
      .rejects.toMatchObject({ code: '42501' });
    const fn = await h.one<{ definer: boolean; config: string[] | null; returns: string }>(
      `select prosecdef as definer, proconfig as config, prorettype::regtype::text as returns
       from pg_proc where oid = '${REVOKE}'::regprocedure`,
    );
    expect(fn).toEqual({ definer: true, config: ['search_path=""'], returns: 'integer' });
  });

  it('refuses to run without a user', async () => {
    await expect(h.as('service_role', null, () => h.one('select public.h5_revoke_auth_user_sessions(null)')))
      .rejects.toMatchObject({ code: '22004' });
  });
});

describe('the old call: a user id where GoTrue wants a JWT', () => {
  it('is refused by GoTrue as bad_jwt, and ends nothing — the defect DEV showed', async () => {
    const user = await double.createUser({ phone: bdPhone().slice(1) });
    await double.signIn(user);
    const { error } = await admin.auth.admin.signOut(user, 'global');
    expect(error).toMatchObject({ status: 403, code: 'bad_jwt' });
    expect(double.calls.at(-1)).toMatchObject({ path: '/logout?scope=global', bearer: 'not_a_jwt' });
    expect(await sessionIds(user)).toHaveLength(1);
  });
});

describe('recoverPin, executed end to end', () => {
  it('logs out with the caller\'s own JWT, writes the PIN only after, and mints a fresh bound session', async () => {
    const seed = await seedRecovery();
    const caller = await callerFor(seed.otp.accessToken);
    expect(caller.freshPhoneOtp).not.toBeNull();
    const device = `recovery-${randomUUID()}`;

    const result = await recoverPin(caller, recoverBody(seed.ownerPhone, NEW_PIN, device));

    // The sign-out carried the caller's verified JWT — its user, its session — never a user id.
    expect(double.calls.filter((call) => call.path.startsWith('/logout'))).toEqual([{
      method: 'POST',
      path: '/logout?scope=global',
      bearer: 'jwt',
      sub: seed.ownerAuth,
      sessionId: seed.otp.sessionId,
    }]);
    // Old sessions die BEFORE the new PIN exists; the fresh session is minted after it.
    const loggedOut = events.indexOf('auth:logout:global');
    const pinWritten = events.indexOf('rest:update:users');
    expect(loggedOut).toBeGreaterThan(-1);
    expect(loggedOut).toBeLessThan(pinWritten);
    expect(pinWritten).toBeLessThan(events.indexOf('auth:generate_link'));

    // Every session the owner had — the lost phone's and the OTP one — is gone; only the new one stands.
    const minted = String(claimsOf(result.accessToken).session_id);
    expect(await sessionIds(seed.ownerAuth)).toEqual([minted]);
    for (const old of [seed.lostPhone.refreshToken, seed.otp.refreshToken]) {
      expect((await anon.auth.refreshSession({ refresh_token: old })).error?.code).toBe('refresh_token_not_found');
    }
    expect((await anon.auth.refreshSession({ refresh_token: result.refreshToken })).error).toBeNull();
    // Nobody else was touched.
    expect(await sessionIds(seed.strangerAuth)).toEqual([seed.stranger.sessionId]);
    expect((await anon.auth.refreshSession({ refresh_token: seed.stranger.refreshToken })).error).toBeNull();

    expect(await ownerPinMatches(seed.ownerId, NEW_PIN)).toBe(true);
    expect(result).toMatchObject({ shopId: seed.shopId, userId: seed.ownerId, deviceSecret: expect.any(String) });
    // A2.3: the minted session is the one bound to this installation.
    const bound = await h.one<{ n: number }>(
      `select count(*)::int as n from auth_session_devices s join shop_devices d on d.id = s.device_id
       where s.auth_session_id = $1 and d.device_public_id = $2 and d.status = 'active'`,
      [minted, device],
    );
    expect(bound.n).toBe(1);
    // The token the request arrived on no longer authenticates anything.
    await expect(callerFor(seed.otp.accessToken)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a PIN another user of the shop holds, before anything is revoked', async () => {
    const seed = await seedRecovery();
    const caller = await callerFor(seed.otp.accessToken);
    await expect(recoverPin(caller, recoverBody(seed.ownerPhone, STAFF_PIN)))
      .rejects.toMatchObject({ status: 409, code: 'pin_in_use' });
    expect(double.calls.some((call) => call.path.startsWith('/logout'))).toBe(false);
    expect(await sessionIds(seed.ownerAuth)).toEqual([seed.lostPhone.sessionId, seed.otp.sessionId]);
    expect(await ownerPinMatches(seed.ownerId, OWNER_PIN)).toBe(true);
  });

  it('keeps the old PIN when GoTrue will not log out, and mints nothing', async () => {
    const seed = await seedRecovery();
    const caller = await callerFor(seed.otp.accessToken);
    double.failNextLogout = { status: 500, code: 'unexpected_failure' };
    await expect(recoverPin(caller, recoverBody(seed.ownerPhone, NEW_PIN)))
      .rejects.toMatchObject({ status: 500, code: 'recovery_failed' });
    expect(events).not.toContain('rest:update:users');
    expect(events).not.toContain('auth:generate_link');
    expect(await ownerPinMatches(seed.ownerId, OWNER_PIN)).toBe(true);
    expect(await sessionIds(seed.ownerAuth)).toHaveLength(2);
  });

  it('cannot log out with a Caller that verifyCallerJwt did not produce', async () => {
    // The token lives beside the Caller verifyCallerJwt returned, never on it:
    // a copy carries every field and still holds no credential.
    const seed = await seedRecovery();
    const copy = { ...(await callerFor(seed.otp.accessToken)) };
    await expect(recoverPin(copy, recoverBody(seed.ownerPhone, NEW_PIN)))
      .rejects.toMatchObject({ status: 500, code: 'recovery_failed' });
    expect(double.calls.some((call) => call.path.startsWith('/logout'))).toBe(false);
    expect(await ownerPinMatches(seed.ownerId, OWNER_PIN)).toBe(true);
  });

  it.each([
    ['a number the session did not prove', () => bdPhone()],
    ['a number that is not Bangladeshi', () => '+15555550100'],
  ])('answers %s with the one generic refusal, before anything is revoked', async (_label, phone) => {
    const seed = await seedRecovery();
    const caller = await callerFor(seed.otp.accessToken);
    await expect(recoverPin(caller, recoverBody(phone(), NEW_PIN)))
      .rejects.toMatchObject({ status: 403, code: 'recovery_refused' });
    expect(double.calls.some((call) => call.path.startsWith('/logout'))).toBe(false);
    expect(await sessionIds(seed.ownerAuth)).toHaveLength(2);
  });

  it('sends a stale proof back for a new code, before anything is revoked', async () => {
    const seed = await seedRecovery();
    const stale = await double.signIn(seed.ownerAuth, 'otp', new Date(Date.now() - 10 * 60_000));
    const caller = await callerFor(stale.accessToken);
    await expect(recoverPin(caller, recoverBody(seed.ownerPhone, NEW_PIN)))
      .rejects.toMatchObject({ status: 403, code: 'otp_required' });
    expect(double.calls.some((call) => call.path.startsWith('/logout'))).toBe(false);
    expect(await ownerPinMatches(seed.ownerId, OWNER_PIN)).toBe(true);
  });

  describe('a post-write failure: the PIN already changed, only the follow-up session did not', () => {
    const BIND_FN = 'public.a23_bind_auth_session(uuid,uuid,uuid,text,text,text,text,text,text)';

    it('a mint failure needs no cleanup, and still reports pin_changed_login_required', async () => {
      const seed = await seedRecovery();
      const caller = await callerFor(seed.otp.accessToken);
      double.failNextGenerateLink = { status: 500, code: 'unexpected_failure' };

      await expect(recoverPin(caller, recoverBody(seed.ownerPhone, NEW_PIN))).rejects.toMatchObject({
        status: 422,
        code: 'pin_changed_login_required',
        details: { recoveryShopId: seed.shopId },
      });

      // The write already committed...
      expect(await ownerPinMatches(seed.ownerId, NEW_PIN)).toBe(true);
      // ...and there was never a session to clean up: the pre-write global
      // sign-out already ran, and nothing was minted after it.
      expect(events).not.toContain('auth:logout:local');
      expect(await sessionIds(seed.ownerAuth)).toEqual([]);
    });

    it('a bind failure after minting revokes only that one new session — "local", not "global"', async () => {
      const seed = await seedRecovery();
      const caller = await callerFor(seed.otp.accessToken);
      await h.exec(`revoke execute on function ${BIND_FN} from service_role`);
      try {
        await expect(recoverPin(caller, recoverBody(seed.ownerPhone, NEW_PIN))).rejects.toMatchObject({
          status: 422,
          code: 'pin_changed_login_required',
          details: { recoveryShopId: seed.shopId },
        });
      } finally {
        await h.exec(`grant execute on function ${BIND_FN} to service_role`);
      }

      expect(await ownerPinMatches(seed.ownerId, NEW_PIN)).toBe(true);
      // The session minted for this attempt is gone too, cleaned up by its
      // OWN scope — exactly one "local" cleanup, distinct from the one
      // "global" logout the pre-write step above already made; cleanup must
      // never reach for the rest of the account, which by now holds nothing
      // else anyway.
      expect(events.filter((event) => event === 'auth:logout:global')).toHaveLength(1);
      expect(events.filter((event) => event === 'auth:logout:local')).toHaveLength(1);
      expect(await sessionIds(seed.ownerAuth)).toEqual([]);
    });

    it('a cleanup failure after a bind failure still reports pin_changed_login_required, logged boundedly', async () => {
      const seed = await seedRecovery();
      const caller = await callerFor(seed.otp.accessToken);
      await h.exec(`revoke execute on function ${BIND_FN} from service_role`);
      double.failNextLogout = { status: 500, code: 'unexpected_failure', scope: 'local' };
      const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await expect(recoverPin(caller, recoverBody(seed.ownerPhone, NEW_PIN))).rejects.toMatchObject({
          status: 422,
          code: 'pin_changed_login_required',
          details: { recoveryShopId: seed.shopId },
        });
        // The cleanup failure IS reported — deviceBinding.ts's own bind-
        // failure log fires too, which is pre-existing and not this task's
        // concern — but whatever was logged, across every call, stays
        // bounded and generic: no raw id anywhere in it.
        expect(report.mock.calls.filter((call) => String(call[0]).includes('cleanup failed'))).toHaveLength(1);
        const logged = report.mock.calls.flat().map(String).join(' ');
        expect(logged).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      } finally {
        report.mockRestore();
        await h.exec(`grant execute on function ${BIND_FN} to service_role`);
      }
      expect(await ownerPinMatches(seed.ownerId, NEW_PIN)).toBe(true);
    });

    it('a thrown cleanup transport failure still logs once and keeps the committed-PIN result', async () => {
      const seed = await seedRecovery();
      const caller = await callerFor(seed.otp.accessToken);
      await h.exec(`revoke execute on function ${BIND_FN} from service_role`);
      double.throwNextLogoutScope = 'local';
      const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await expect(recoverPin(caller, recoverBody(seed.ownerPhone, NEW_PIN))).rejects.toMatchObject({
          status: 422,
          code: 'pin_changed_login_required',
          details: { recoveryShopId: seed.shopId },
        });
        const cleanupLogs = report.mock.calls.filter((call) => String(call[0]).includes('cleanup failed'));
        expect(cleanupLogs).toHaveLength(1);
        expect(cleanupLogs[0]).toEqual(['sync/recover-pin cleanup failed: session was not revoked']);
        expect(report.mock.calls.flat().map(String).join(' ')).not.toContain(seed.ownerPhone);
      } finally {
        report.mockRestore();
        await h.exec(`grant execute on function ${BIND_FN} to service_role`);
      }
      expect(await ownerPinMatches(seed.ownerId, NEW_PIN)).toBe(true);
      expect(events).not.toContain('auth:logout:local');
    });

    it('keeps the active shop separate from the recovered Owner shop in the HTTP reply', async () => {
      const seed = await seedRecovery();
      const { result: active } = await h.as('service_role', null, () =>
        h.one<{ result: { shopId: string } }>(
          `select b4_create_owned_shop($1, 'Active Shop', null, $2) as result`,
          [seed.ownerId, bdPhone()],
        ));
      await h.db.query(
        `update auth.users set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{active_shop_id}', to_jsonb($2::text)) where id = $1`,
        [seed.ownerAuth, active.shopId],
      );
      const activeOtp = await double.signIn(seed.ownerAuth, 'otp');
      const caller = await callerFor(activeOtp.accessToken);
      expect(caller.shopId).toBe(active.shopId);
      expect(active.shopId).not.toBe(seed.shopId);
      double.failNextGenerateLink = { status: 500, code: 'unexpected_failure' };

      const failure = await recoverPin(caller, recoverBody(seed.ownerPhone, NEW_PIN)).catch((error: unknown) => error);
      expect(failure).toMatchObject({ status: 422, code: 'pin_changed_login_required' });
      expect(httpErrorBody(failure, caller)).toMatchObject({
        shopId: active.shopId,
        recoveryShopId: seed.shopId,
        code: 'pin_changed_login_required',
      });
      expect(await ownerPinMatches(seed.ownerId, NEW_PIN)).toBe(true);
    });
  });
});

describe('the auth-account rebind', () => {
  async function seedRebind() {
    const appUserId = randomUUID();
    const oldAuth = await double.createUser({ email: syntheticEmail(appUserId) });
    const newAuth = await double.createUser({ phone: bdPhone().slice(1) });
    const strangerAuth = await double.createUser({ phone: bdPhone().slice(1) });
    await h.db.query('insert into auth_bindings (app_user_id, auth_user_id) values ($1, $2)', [appUserId, oldAuth]);
    await double.signIn(oldAuth, 'magiclink');
    await double.signIn(oldAuth, 'magiclink');
    const kept = await double.signIn(newAuth);
    const stranger = await double.signIn(strangerAuth);
    return { appUserId, oldAuth, newAuth, strangerAuth, kept, stranger };
  }

  async function boundTo(appUserId: string): Promise<string> {
    return (await h.one<{ auth_user_id: string }>(
      'select auth_user_id from auth_bindings where app_user_id = $1', [appUserId])).auth_user_id;
  }

  async function emailOf(authUserId: string): Promise<string> {
    return (await h.one<{ email: string }>('select email from auth.users where id = $1', [authUserId])).email;
  }

  it('revokes the old account\'s sessions by id before the identity moves, and no one else\'s', async () => {
    const seed = await seedRebind();
    await ensureAuthBinding(seed.appUserId, seed.newAuth, { allowRebind: true });

    expect(await sessionIds(seed.oldAuth)).toEqual([]);
    expect(await sessionIds(seed.newAuth)).toEqual([seed.kept.sessionId]);
    expect(await sessionIds(seed.strangerAuth)).toEqual([seed.stranger.sessionId]);
    expect(await boundTo(seed.appUserId)).toBe(seed.newAuth);
    expect(await emailOf(seed.newAuth)).toBe(syntheticEmail(seed.appUserId));
    expect(await emailOf(seed.oldAuth)).not.toBe(syntheticEmail(seed.appUserId));
    const revoked = events.indexOf('rpc:h5_revoke_auth_user_sessions');
    expect(revoked).toBeGreaterThan(-1);
    expect(revoked).toBeLessThan(events.indexOf('auth:update_user'));
    expect(revoked).toBeLessThan(events.indexOf('rest:update:auth_bindings'));
    // By id, through the database: GoTrue was never asked to log anybody out.
    expect(double.calls.some((call) => call.path.startsWith('/logout'))).toBe(false);
  });

  it('fails closed before the identity moves when the revocation fails', async () => {
    const seed = await seedRebind();
    await withoutServiceRoleExecute(async () => {
      await expect(ensureAuthBinding(seed.appUserId, seed.newAuth, { allowRebind: true }))
        .rejects.toMatchObject({ status: 500 });
    });
    expect(await boundTo(seed.appUserId)).toBe(seed.oldAuth);
    expect(await emailOf(seed.oldAuth)).toBe(syntheticEmail(seed.appUserId));
    expect(await sessionIds(seed.oldAuth)).toHaveLength(2);
    expect(events).not.toContain('auth:update_user');
    expect(events).not.toContain('rest:update:auth_bindings');
  });
});

describe('signOutAppUser', () => {
  /**
   * A shop + role + owner `users` row, plus the billing account and the
   * SELF shop_memberships row (principal = actor) every live user gets —
   * through b4_ensure_owner_billing_account, the real bootstrap, not a
   * hand-built row that might miss a column this test does not know matters.
   */
  async function seedOwnedShop(): Promise<{ shopId: string; principalId: string }> {
    const shopId = randomUUID();
    const roleId = randomUUID();
    const principalId = randomUUID();
    const now = new Date().toISOString();
    await h.db.query(
      `insert into shops (id, owner_id, name, phone, created_at, updated_at)
       values ($1, $2, 'Owned Shop', $3, $4, $4)`,
      [shopId, principalId, bdPhone(), now],
    );
    await h.db.query(
      `insert into roles (id, shop_id, name, is_system, created_at, updated_at)
       values ($1, $2, 'owner', true, $3, $3)`,
      [roleId, shopId, now],
    );
    await h.db.query(
      `insert into users (id, shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active, created_at, updated_at)
       values ($1, $2, 'Owner', $3, 'hash', $4, $5, true, $4, $4)`,
      [principalId, shopId, bdPhone(), now, roleId],
    );
    await h.as('service_role', null, () =>
      h.one(`select b4_ensure_owner_billing_account($1, $2)`, [principalId, shopId]));
    return { shopId, principalId };
  }

  async function seedBound() {
    const { principalId } = await seedOwnedShop();
    const bound = await double.createUser({ phone: bdPhone().slice(1) });
    const strangerAuth = await double.createUser({ phone: bdPhone().slice(1) });
    await h.db.query('insert into auth_bindings (app_user_id, auth_user_id) values ($1, $2)', [principalId, bound]);
    const sessions = [await double.signIn(bound), await double.signIn(bound, 'magiclink')];
    const stranger = await double.signIn(strangerAuth);
    return { appUserId: principalId, bound, strangerAuth, sessions, stranger };
  }

  /** A Multi-Shop owner: one principal, bound by auth, with a SEPARATE actor row in a second shop. */
  async function seedSecondaryActor() {
    const { principalId } = await seedOwnedShop();
    const bound = await double.createUser({ phone: bdPhone().slice(1) });
    await h.db.query('insert into auth_bindings (app_user_id, auth_user_id) values ($1, $2)', [principalId, bound]);
    const created = await h.as('service_role', null, () =>
      h.one<{ result: { actorUserId: string } }>(
        `select b4_create_owned_shop($1, 'Secondary Shop', null, $2) as result`,
        [principalId, bdPhone()],
      ));
    const sessions = [await double.signIn(bound), await double.signIn(bound, 'magiclink')];
    return { principalId, actorUserId: created.result.actorUserId, bound, sessions };
  }

  it('actually ends the bound account\'s sessions — and only those', async () => {
    const seed = await seedBound();
    await signOutAppUser(seed.appUserId);

    expect(await sessionIds(seed.bound)).toEqual([]);
    for (const { refreshToken } of seed.sessions) {
      expect((await anon.auth.refreshSession({ refresh_token: refreshToken })).error?.code).toBe('refresh_token_not_found');
    }
    expect(await sessionIds(seed.strangerAuth)).toEqual([seed.stranger.sessionId]);
    // The account itself, and its identity, are untouched.
    const kept = await h.one<{ users: number; identities: number }>(
      `select (select count(*) from auth.users where id = $1)::int as users,
              (select count(*) from auth.identities where user_id = $1)::int as identities`,
      [seed.bound],
    );
    expect(kept).toEqual({ users: 1, identities: 1 });
  });

  it('stays best-effort when revocation fails, and reports it without naming anyone', async () => {
    const seed = await seedBound();
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await withoutServiceRoleExecute(async () => {
        await expect(signOutAppUser(seed.appUserId)).resolves.toBeUndefined();
      });
      expect(report).toHaveBeenCalledTimes(1);
      const logged = report.mock.calls.flat().map(String).join(' ');
      expect(logged).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(logged).not.toMatch(/\d{10}/);
    } finally {
      report.mockRestore();
    }
    expect(await sessionIds(seed.bound)).toHaveLength(2);
  });

  it('resolves a Multi-Shop secondary actor to its stable principal, revokes exactly that principal, and touches no one else', async () => {
    // DEV, 2026-10-05: the old code read auth_bindings by the ACTOR's id
    // directly. auth_bindings keys on the PRINCIPAL, so that lookup silently
    // missed for every secondary-shop actor and no session was ever cut.
    const seed = await seedSecondaryActor();
    const other = await seedSecondaryActor();
    expect(seed.actorUserId).not.toBe(seed.principalId);

    await signOutAppUser(seed.actorUserId);

    expect(await sessionIds(seed.bound)).toEqual([]);
    for (const { refreshToken } of seed.sessions) {
      expect((await anon.auth.refreshSession({ refresh_token: refreshToken })).error?.code).toBe('refresh_token_not_found');
    }
    // A completely different owner's own secondary-shop actor and principal
    // sessions are untouched: resolving ONE actor's principal must never
    // cross over into a DIFFERENT principal's rows.
    expect(await sessionIds(other.bound)).toHaveLength(2);
    expect((await anon.auth.refreshSession({ refresh_token: other.sessions[0].refreshToken })).error).toBeNull();
  });

  it('fails safe when the principal lookup itself fails, and reports it without naming anyone', async () => {
    const seed = await seedBound();
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await withoutServiceRoleSelect('shop_memberships', async () => {
        await expect(signOutAppUser(seed.appUserId)).resolves.toBeUndefined();
      });
      expect(report).toHaveBeenCalledTimes(1);
      const logged = report.mock.calls.flat().map(String).join(' ');
      expect(logged).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(logged).not.toMatch(/\d{10}/);
    } finally {
      report.mockRestore();
    }
    // Nothing was revoked: a lookup failure must never be mistaken for "no
    // principal exists" and silently proceed on the wrong assumption.
    expect(await sessionIds(seed.bound)).toHaveLength(2);
  });
});
