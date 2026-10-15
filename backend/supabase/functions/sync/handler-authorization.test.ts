import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H-9 §4.3 / §10.2. Every sync route, EXECUTED through handler.ts.
//
// The gateway keeps verify_jwt = true, but it only proves a request carried
// SOME acceptable key or token. This suite proves what the handler does with
// what arrives: with modern keys a sessionless call carries `apikey` alone, so
// an authenticated action must refuse anything short of a token GoTrue itself
// accepts — never a key, never a token it merely decodes.
//
// Real: handler.ts, verifyCallerJwt (_shared/auth.ts), the action lists and
// isDeviceGuardedAction. Doubles: GoTrue's getUser verdict (accepts exactly one
// token), the device gate's verdict, and every action handler — each a spy, so
// "no privileged effect" is a count of zero calls, not an absence of errors.
//
// Key- and JWT-shaped fixtures are composed at runtime (GitHub push protection).

const h = vi.hoisted(() => {
  // _shared/authTiming.ts reads Deno.env at module load, and handler.ts is its
  // first runtime importer under Node. Both timing guards unset: timing off.
  (globalThis as Record<string, unknown>).Deno = { env: { get: () => undefined } };
  const action = () => vi.fn(async () => ({ handled: true }));
  return {
    getUser: vi.fn(),
    rpc: vi.fn(),
    from: vi.fn(),
    guard: vi.fn(),
    actions: {
      'device-login': action(),
      'device-actor-switch': action(),
      push: action(),
      'push-group': action(),
      'refund-claim': action(),
      'billing-init': action(),
      'billing-status': action(),
      'billing-terminal': action(),
      'shop-switch': action(),
      'shop-create': action(),
      'shop-mutate': action(),
      'shop-summaries': action(),
      'staff-reactivate': action(),
      pull: action(),
      'link-device': action(),
      'device-authority': action(),
      'device-list': action(),
      'device-access': action(),
      'recover-pin': action(),
    } as Record<string, ReturnType<typeof vi.fn>>,
  };
});

vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: { getUser: h.getUser }, rpc: h.rpc, from: h.from },
  supabaseAnon: { auth: {} },
}));
vi.mock('./deviceLogin.ts', () => ({ deviceLogin: h.actions['device-login'] }));
vi.mock('./deviceRegistry.ts', () => ({
  deviceActorSwitch: h.actions['device-actor-switch'],
  deviceAuthority: h.actions['device-authority'],
  listDevices: h.actions['device-list'],
  mutateDeviceAccess: h.actions['device-access'],
}));
vi.mock('./linkDevice.ts', () => ({ linkDevice: h.actions['link-device'] }));
vi.mock('./pull.ts', () => ({ pull: h.actions.pull }));
vi.mock('./push.ts', () => ({ push: h.actions.push }));
vi.mock('./pushGroup.ts', () => ({ pushGroup: h.actions['push-group'] }));
vi.mock('./recoverPin.ts', () => ({ recoverPin: h.actions['recover-pin'] }));
vi.mock('./refundClaim.ts', () => ({ refundClaim: h.actions['refund-claim'] }));
vi.mock('./billing.ts', () => ({
  initiateBilling: h.actions['billing-init'],
  billingStatus: h.actions['billing-status'],
  finalizeBillingAttempt: h.actions['billing-terminal'],
}));
vi.mock('./multiShop.ts', () => ({
  switchShop: h.actions['shop-switch'],
  createOwnedShop: h.actions['shop-create'],
  mutateOwnedShop: h.actions['shop-mutate'],
  shopSummaries: h.actions['shop-summaries'],
}));
vi.mock('./staffLifecycle.ts', () => ({ reactivateStaff: h.actions['staff-reactivate'] }));
// The real isDeviceGuardedAction decides which routes are gated; only the
// gate's registry verdict is a double.
vi.mock('./deviceGuard.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deviceGuard.ts')>()),
  assertDeviceAuthority: h.guard,
}));

const { handleSyncRequest } = await import('./handler.ts');
const { HttpError } = await import('./_shared/auth.ts');
const {
  DEVICE_CROSS_SHOP_ACTIONS,
  DEVICE_EXEMPT_ACTIONS,
  DEVICE_GUARDED_ACTIONS,
} = await import('./deviceRegistryPolicy.ts');

afterAll(() => {
  delete (globalThis as Record<string, unknown>).Deno;
});

const ORIGIN = 'https://abcdefghijklmnopqrst.supabase.co';
const SHOP = '11111111-1111-4111-8111-111111111111';
const APP_USER = '22222222-2222-4222-8222-222222222222';
const AUTH_USER = '9f1c0000-0000-4000-8000-000000000001';
const FAR_FUTURE = 4_102_444_800;

const BODY = '0'.repeat(24);
const modernKey = (kind: 'publishable' | 'secret') => ['sb', kind, `handler${BODY}`].join('_');
const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload: Record<string, unknown>, signature = 'gotrue-signature') =>
  [segment({ alg: 'HS256', typ: 'JWT' }), segment(payload), signature].join('.');

const PUBLISHABLE = modernKey('publishable');
const SECRET = modernKey('secret');
const LEGACY_ANON = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon' });
const LEGACY_SERVICE = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'service_role' });

const CLAIMS = {
  sub: AUTH_USER,
  role: 'authenticated',
  session_id: 'session-0001',
  exp: FAR_FUTURE,
  app_metadata: {
    app_user_id: APP_USER,
    principal_user_id: APP_USER,
    billing_account_id: 'billing-0001',
    shop_id: SHOP,
    role: 'owner',
    permission_version: 1,
  },
};
/** The one token GoTrue accepts. */
const VALID = jwt(CLAIMS);
/** Byte-for-byte the same claims, NOT GoTrue's signature: decodes perfectly. */
const FORGED = jwt(CLAIMS, 'attacker-signature');
const EXPIRED = jwt({ ...CLAIMS, exp: 1 });
const FOREIGN = jwt({ ...CLAIMS, iss: 'https://tsrqponmlkjihgfedcba.supabase.co/auth/v1' });
const REVOKED = jwt({ ...CLAIMS, session_id: 'session-revoked' });
const ANONYMOUS = jwt({ ...CLAIMS, is_anonymous: true });

const VERIFIED_USER = {
  id: AUTH_USER,
  aud: 'authenticated',
  app_metadata: { shop_id: SHOP },
  user_metadata: {},
  phone: null,
  email: null,
  is_anonymous: false,
};

const DISPATCH = readFileSync(resolve('backend/supabase/functions/sync/handler.ts'), 'utf8');
const ROUTES = [...new Set(
  [...DISPATCH.matchAll(/body\.action === (?:"([a-z-]+)"|'([a-z-]+)')/g)]
    .map((match) => (match[1] ?? match[2]) as string),
)];
const SESSIONLESS = ['device-login', 'device-actor-switch'];
const AUTHENTICATED = ROUTES.filter((action) => !SESSIONLESS.includes(action));
const GUARDED = AUTHENTICATED.filter((action) => (DEVICE_GUARDED_ACTIONS as readonly string[]).includes(action));
const UNGUARDED = AUTHENTICATED.filter((action) => !GUARDED.includes(action));

function syncRequest(
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
): Request {
  const hasBody = method !== 'GET' && method !== 'OPTIONS';
  return new Request(`${ORIGIN}/functions/v1/sync`, {
    method,
    // Every call carries the public key in `apikey`, as the gateway requires.
    headers: { 'content-type': 'application/json', apikey: PUBLISHABLE, ...headers },
    body: hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function handlerCalls(): number {
  return Object.values(h.actions).reduce((total, spy) => total + spy.mock.calls.length, 0);
}

function expectNoPrivilegedEffect(): void {
  expect(handlerCalls(), 'action handler calls').toBe(0);
  expect(h.guard, 'device gate').not.toHaveBeenCalled();
  expect(h.rpc, 'admin RPC').not.toHaveBeenCalled();
  expect(h.from, 'admin table access').not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getUser.mockImplementation(async (token: string) => {
    if (token === VALID) return { data: { user: VERIFIED_USER }, error: null };
    if (token === ANONYMOUS) return { data: { user: { ...VERIFIED_USER, is_anonymous: true } }, error: null };
    return { data: { user: null }, error: { name: 'AuthApiError', message: 'invalid JWT', status: 403 } };
  });
  h.guard.mockResolvedValue(undefined);
});

describe('the route table this matrix drives', () => {
  it('drives every route handler.ts dispatches, and nothing else', () => {
    expect(ROUTES.length).toBeGreaterThan(15);
    expect([...ROUTES].sort()).toEqual(Object.keys(h.actions).sort());
  });

  it('classifies every route as guarded, cross-shop or exempt', () => {
    const classified = new Set<string>([
      ...DEVICE_GUARDED_ACTIONS,
      ...DEVICE_CROSS_SHOP_ACTIONS,
      ...Object.keys(DEVICE_EXEMPT_ACTIONS),
    ]);
    expect([...ROUTES].sort()).toEqual([...classified].sort());
  });

  it('reaches exactly two routes before verifyCallerJwt', () => {
    expect(AUTHENTICATED).toHaveLength(ROUTES.length - SESSIONLESS.length);
    for (const action of SESSIONLESS) expect(ROUTES).toContain(action);
  });
});

describe('authenticated routes refuse anything GoTrue did not accept', () => {
  const credentials: Array<[string, Record<string, string>]> = [
    ['the public key in apikey alone (no Authorization)', {}],
    ['the publishable key as the bearer', bearer(PUBLISHABLE)],
    ['the secret key as the bearer', bearer(SECRET)],
    ['the legacy anon key as the bearer', bearer(LEGACY_ANON)],
    ['the legacy service_role key as the bearer', bearer(LEGACY_SERVICE)],
    ['a forged JWT carrying valid-looking claims', bearer(FORGED)],
    ['an expired JWT', bearer(EXPIRED)],
    ['a JWT from another project', bearer(FOREIGN)],
    ['a revoked session\'s JWT', bearer(REVOKED)],
    ['an empty bearer', { authorization: 'Bearer ' }],
    ['a non-Bearer scheme around a valid token', { authorization: `Basic ${VALID}` }],
  ];

  describe.each(AUTHENTICATED)('%s', (action) => {
    it.each(credentials)('refuses %s with 401 and no effect', async (_label, headers) => {
      const response = await handleSyncRequest(syncRequest({ action, shopId: SHOP }, headers));
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(['Missing bearer token', 'Invalid or expired token']).toContain(body.error);
      expect(Object.keys(body)).toEqual(['error']);
      expectNoPrivilegedEffect();
      // Verification was GoTrue's verdict on THIS token, or never attempted.
      for (const [token] of h.getUser.mock.calls) expect(token).not.toBe(VALID);
    });

    it('refuses an anonymous session with 403 and no effect', async () => {
      const response = await handleSyncRequest(syncRequest({ action }, bearer(ANONYMOUS)));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'anonymous_session_rejected' });
      expectNoPrivilegedEffect();
    });
  });

  it('asks GoTrue about the forged token instead of trusting its decodable claims', async () => {
    await handleSyncRequest(syncRequest({ action: 'pull' }, bearer(FORGED)));
    expect(h.getUser).toHaveBeenCalledTimes(1);
    expect(h.getUser).toHaveBeenCalledWith(FORGED);
    expectNoPrivilegedEffect();
  });
});

describe('a verified caller', () => {
  it.each(GUARDED)('%s passes the device gate BEFORE its handler runs', async (action) => {
    const body = { action, shopId: SHOP };
    const response = await handleSyncRequest(syncRequest(body, bearer(VALID)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handled: true });
    expect(h.guard).toHaveBeenCalledTimes(1);
    expect(h.guard.mock.calls[0]?.[0]).toMatchObject({ appUserId: APP_USER, shopId: SHOP, authSessionId: 'session-0001' });
    const handler = h.actions[action];
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1]).toEqual(body);
    expect(h.guard.mock.invocationCallOrder[0]).toBeLessThan(handler.mock.invocationCallOrder[0] ?? 0);
    expect(handlerCalls()).toBe(1);
  });

  it.each(GUARDED)('%s runs no handler when the device gate refuses', async (action) => {
    h.guard.mockRejectedValueOnce(new HttpError(403, 'This device has been revoked', 'device_revoked'));
    const response = await handleSyncRequest(syncRequest({ action }, bearer(VALID)));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'device_revoked', actorUserId: APP_USER, shopId: SHOP });
    expect(handlerCalls()).toBe(0);
  });

  it.each(UNGUARDED)('%s reaches its handler without the shared gate (exempt or self-gating)', async (action) => {
    const response = await handleSyncRequest(syncRequest({ action }, bearer(VALID)));
    expect(response.status).toBe(200);
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.actions[action]).toHaveBeenCalledTimes(1);
    expect(handlerCalls()).toBe(1);
    const reason = (DEVICE_EXEMPT_ACTIONS as Record<string, string>)[action];
    const crossShop = (DEVICE_CROSS_SHOP_ACTIONS as readonly string[]).includes(action);
    expect(crossShop || (typeof reason === 'string' && reason.length > 20), action).toBe(true);
  });

  it('gets 400 for an unknown action and reaches no handler', async () => {
    const response = await handleSyncRequest(syncRequest({ action: 'device-enroll' }, bearer(VALID)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unsupported action' });
    expectNoPrivilegedEffect();
  });

  it('is never verified for an unknown action it cannot prove', async () => {
    const response = await handleSyncRequest(syncRequest({ action: 'device-enroll' }));
    expect(response.status).toBe(401);
    expectNoPrivilegedEffect();
  });
});

describe('the two sessionless routes', () => {
  it.each(SESSIONLESS)('%s runs on the public key alone, never asking GoTrue', async (action) => {
    const body = { action, phone: '+8801700000001', pin: '000000' };
    const response = await handleSyncRequest(syncRequest(body, { 'cf-connecting-ip': '203.0.113.7' }));
    expect(response.status).toBe(200);
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.guard).not.toHaveBeenCalled();
    const handler = h.actions[action];
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual(body);
    expect(handler.mock.calls[0]?.[1]).toBe('203.0.113.7');
    expect(handlerCalls()).toBe(1);
  });

  it.each(SESSIONLESS)('%s ignores whatever bearer arrives — its handler proves the credential', async (action) => {
    await handleSyncRequest(syncRequest({ action }, { ...bearer(FORGED), 'cf-connecting-ip': '203.0.113.7' }));
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.actions[action]).toHaveBeenCalledTimes(1);
  });

  it.each(SESSIONLESS)('%s never takes its abuse-budget address from x-forwarded-for', async (action) => {
    await handleSyncRequest(syncRequest({ action }, { 'x-forwarded-for': '198.51.100.9' }));
    expect(h.actions[action].mock.calls[0]?.[1]).toBeNull();
  });
});

describe('requests that are not a sync call grant nothing', () => {
  it('answers OPTIONS with CORS only', async () => {
    const response = await handleSyncRequest(syncRequest(null, bearer(VALID), 'OPTIONS'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization, x-client-info, apikey, content-type');
    expect(h.getUser).not.toHaveBeenCalled();
    expectNoPrivilegedEffect();
  });

  it.each(['GET', 'PUT', 'DELETE'])('refuses %s with 405', async (method) => {
    const response = await handleSyncRequest(new Request(`${ORIGIN}/functions/v1/sync`, {
      method,
      headers: { apikey: PUBLISHABLE, ...bearer(VALID) },
    }));
    expect(response.status).toBe(405);
    expect(h.getUser).not.toHaveBeenCalled();
    expectNoPrivilegedEffect();
  });

  it.each([
    ['an array', []],
    // Raw text: syncRequest sends strings as-is, so this is the JSON "push".
    ['a JSON string', '"push"'],
    ['null', null],
    ['a number', 7],
  ])('refuses %s as the body with 400', async (_label, body) => {
    const response = await handleSyncRequest(syncRequest(body, bearer(VALID)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request body' });
    expect(h.getUser).not.toHaveBeenCalled();
    expectNoPrivilegedEffect();
  });

  it('answers malformed JSON with a bare 500 and no effect (pre-existing mapping)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await handleSyncRequest(syncRequest('{"action":', bearer(VALID)));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Internal server error' });
      expect(logged).toHaveBeenCalledWith('sync function failed', expect.any(String));
      expect(h.getUser).not.toHaveBeenCalled();
      expectNoPrivilegedEffect();
    } finally {
      logged.mockRestore();
    }
  });
});
