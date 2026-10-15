import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H-9 §4.4 / §10.2. What the Edge clients actually put on the wire, in BOTH
// key modes, from the real supabaseAdmin.ts and the real pinned supabase-js —
// not a mocked createClient. A recording fetch stands in for the network.
//
// This proves request construction only. Whether the hosted gateway accepts
// each header shape (notably `Authorization: Bearer <secret key>` on REST and
// Auth admin, which the SDK sends for every non-Functions call) is a Phase 3
// hosted check; see backend/supabase/deploy/README.md.
//
// Key-shaped fixtures are composed at runtime (GitHub push protection).

const REF = 'abcdefghijklmnopqrst';
const ORIGIN = `https://${REF}.supabase.co`;
const BODY = '0'.repeat(24);
const modernKey = (kind: 'publishable' | 'secret') => ['sb', kind, `transport${BODY}`].join('_');
const jwt = (payload: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'fabricated'].join('.');

const PUBLISHABLE = modernKey('publishable');
const SECRET = modernKey('secret');
const LEGACY_ANON = jwt({ iss: 'supabase', ref: REF, role: 'anon' });
const LEGACY_SERVICE = jwt({ iss: 'supabase', ref: REF, role: 'service_role' });
const USER_JWT = jwt({ sub: '9f1c0000-0000-4000-8000-000000000001', role: 'authenticated', exp: 4_102_444_800 });

const MODES = {
  modern: {
    env: {
      SUPABASE_URL: ORIGIN,
      MUTHOY_SUPABASE_PROJECT_REF: REF,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      // Present but ignored in modern mode: the resolver never mixes pairs.
      SUPABASE_ANON_KEY: LEGACY_ANON,
      SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
    },
    publicKey: PUBLISHABLE,
    adminKey: SECRET,
  },
  legacy: {
    env: {
      SUPABASE_URL: ORIGIN,
      MUTHOY_SUPABASE_PROJECT_REF: REF,
      MUTHOY_SUPABASE_KEY_MODE: 'legacy',
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
      SUPABASE_ANON_KEY: LEGACY_ANON,
      SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
    },
    publicKey: LEGACY_ANON,
    adminKey: LEGACY_SERVICE,
  },
} as const;

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

let sent: Sent[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

const user = {
  id: '9f1c0000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'u-1@users.muthoy.invalid',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-14T00:00:00Z',
};

/** The few platform endpoints the Edge code calls, answered with valid shapes. */
async function platform(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/rest/v1/rpc/h9_transport_probe') return json([{ ok: true }]);
  if (path === '/auth/v1/admin/generate_link') {
    return json({
      ...user,
      action_link: `${ORIGIN}/auth/v1/verify?token=fixture`,
      email_otp: '000000',
      hashed_token: 'fixture-token-hash',
      redirect_to: '',
      verification_type: 'magiclink',
    });
  }
  if (path === '/auth/v1/user') return json(user);
  if (path === '/auth/v1/verify') {
    return json({
      access_token: USER_JWT,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 4_102_444_800,
      refresh_token: 'fixture-refresh',
      user,
    });
  }
  return json({ message: 'unexpected path' }, 404);
}

function stubPlatform(env: Readonly<Record<string, string>>): void {
  vi.stubGlobal('Deno', { env: { get: (name: string) => (Object.hasOwn(env, name) ? env[name] : undefined) } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    sent.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' ? '' : await request.clone().text(),
    });
    return platform(request);
  }));
}

async function clients() {
  return import('./_shared/supabaseAdmin.ts');
}

beforeEach(() => {
  vi.resetModules();
  sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(['modern', 'legacy'] as const)('%s key mode — real supabaseAdmin.ts and SDK', (mode) => {
  const { env, publicKey, adminKey } = MODES[mode];

  it('sends admin RPCs to this project with the admin key in apikey and the bearer', async () => {
    stubPlatform(env);
    const { supabaseAdmin } = await clients();
    const { error } = await supabaseAdmin.rpc('h9_transport_probe', { p_value: 1 });
    expect(error).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `${ORIGIN}/rest/v1/rpc/h9_transport_probe`, method: 'POST' });
    expect(sent[0].headers.get('apikey')).toBe(adminKey);
    // supabase-js 2.112.3 still falls back to the key as the REST bearer for
    // every key type; only Functions requests omit it for sb_ keys.
    expect(sent[0].headers.get('authorization')).toBe(`Bearer ${adminKey}`);
  }, 30_000);

  it('mints sessions through admin generateLink with the admin key only', async () => {
    stubPlatform(env);
    const { supabaseAdmin } = await clients();
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: 'u-1@users.muthoy.invalid',
    });
    expect(error).toBeNull();
    expect(data.properties?.hashed_token).toBe('fixture-token-hash');
    expect(sent.map((request) => request.url)).toEqual([`${ORIGIN}/auth/v1/admin/generate_link`]);
    expect(sent[0].headers.get('apikey')).toBe(adminKey);
    expect(sent[0].headers.get('authorization')).toBe(`Bearer ${adminKey}`);
  }, 30_000);

  it('verifies a caller with the caller\'s own JWT as the bearer, never the key', async () => {
    stubPlatform(env);
    const { supabaseAdmin } = await clients();
    const { data, error } = await supabaseAdmin.auth.getUser(USER_JWT);
    expect(error).toBeNull();
    expect(data.user?.id).toBe(user.id);
    expect(sent.map((request) => request.url)).toEqual([`${ORIGIN}/auth/v1/user`]);
    expect(sent[0].headers.get('authorization')).toBe(`Bearer ${USER_JWT}`);
    expect(sent[0].headers.get('apikey')).toBe(adminKey);
  }, 30_000);

  it('exchanges a token_hash through the NON-privileged client and its public key', async () => {
    stubPlatform(env);
    const { supabaseAnon } = await clients();
    const { data, error } = await supabaseAnon.auth.verifyOtp({ token_hash: 'fixture-token-hash', type: 'email' });
    expect(error).toBeNull();
    expect(data.session?.access_token).toBe(USER_JWT);
    expect(sent.map((request) => request.url)).toEqual([`${ORIGIN}/auth/v1/verify`]);
    expect(sent[0].headers.get('apikey')).toBe(publicKey);
    expect(sent[0].headers.get('authorization')).toBe(`Bearer ${publicKey}`);
    expect(JSON.parse(sent[0].body)).toMatchObject({ token_hash: 'fixture-token-hash', type: 'email' });
  }, 30_000);

  it('keeps the two clients\' keys apart on every request', async () => {
    stubPlatform(env);
    const { supabaseAdmin, supabaseAnon } = await clients();
    await supabaseAdmin.rpc('h9_transport_probe', {});
    await supabaseAnon.auth.verifyOtp({ token_hash: 'fixture-token-hash', type: 'email' });
    const [admin, anon] = sent;
    for (const header of ['apikey', 'authorization']) {
      expect(admin.headers.get(header)).not.toContain(publicKey);
      expect(anon.headers.get(header)).not.toContain(adminKey);
    }
    // No request ever leaves for another origin.
    for (const request of sent) expect(new URL(request.url).origin).toBe(ORIGIN);
  }, 30_000);
});

describe('a refused configuration serves nothing', () => {
  it.each([
    ['no project ref', { ...MODES.modern.env, MUTHOY_SUPABASE_PROJECT_REF: undefined }, 'project_ref_invalid'],
    ['a foreign URL', { ...MODES.modern.env, SUPABASE_URL: 'https://tsrqponmlkjihgfedcba.supabase.co' }, 'url_invalid'],
    ['an unknown mode', { ...MODES.modern.env, MUTHOY_SUPABASE_KEY_MODE: 'auto' }, 'key_mode_invalid'],
    ['a secret key in the public slot', {
      ...MODES.modern.env,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: SECRET }),
    }, 'publishable_keys_invalid'],
  ])('%s fails module load with a fixed code and no request', async (_label, env, code) => {
    stubPlatform(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string>);
    await expect(clients()).rejects.toMatchObject({
      name: 'SupabaseKeyConfigurationError',
      code,
      message: `Supabase Edge configuration refused (${code})`,
    });
    expect(sent).toEqual([]);
  }, 30_000);
});
