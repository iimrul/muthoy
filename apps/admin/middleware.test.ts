// W4-06 — the request gate, executed against the REAL middleware.
//
// The exemption is the dangerous part. Revision 2 proposed adding
// 'login|api/admin/session' to the matcher's negative lookahead, which is a
// PREFIX exclusion: it would have opened /login-anything and
// /api/admin/session-extra too, silently. So the near-miss paths below are the
// point of this file, together with the mutation check that switching the
// exact-match Set to startsWith makes them fail.

import { beforeEach, describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN_SESSION_COOKIE,
  newSessionPayload,
  signAdminSession,
  verifyAdminSession,
} from './lib/adminSession';
import { middleware } from './middleware';

const SECRET = 'a'.repeat(32);
const ORIGIN = 'https://admin.muthoy.test';
const ENV_KEYS = ['ADMIN_SESSION_SECRET', 'ADMIN_ROLES', 'ADMIN_SESSION_EPOCH'] as const;

function configure(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}): void {
  const values: Record<string, string | undefined> = {
    ADMIN_SESSION_SECRET: SECRET,
    ADMIN_ROLES: '{"founder":"super_admin","ops":"read_only"}',
    ADMIN_SESSION_EPOCH: undefined,
    ...overrides,
  };
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

async function cookieFor(
  sub: string,
  options: { epoch?: number; now?: number } = {},
): Promise<string> {
  const now = options.now ?? Date.now();
  const payload = newSessionPayload({ sub, role: 'super_admin', epoch: options.epoch ?? 0, now });
  return signAdminSession(payload, SECRET);
}

// There is deliberately NO `lastSeen` option. It used to back-date lastSeen
// through `touchedSessionPayload`, and that is what made the idle test below
// vacuous for this whole batch -- see the comment on it.

function request(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', ADMIN_SESSION_COOKIE + '=' + cookie);
  return new NextRequest(new Request(ORIGIN + path, { headers }));
}

beforeEach(() => {
  configure();
});

describe('the public paths, and only those', () => {
  test.each(['/login', '/api/admin/session'])('%s is reachable with no cookie', async (path) => {
    const response = await middleware(request(path));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  test.each([
    '/login-anything',
    '/login/',
    '/login/extra',
    '/Login',
    '/api/admin/sessionx',
    '/api/admin/session/refresh',
    '/api/admin/sessions',
    '/loginx',
    '//login',
  ])('the near miss %s is GATED', async (path) => {
    const response = await middleware(request(path));

    expect(response.status).not.toBe(200);
  });

  test('the exempt set is exactly two paths — a third cannot be added unnoticed', () => {
    const source = readFileSync(join(import.meta.dirname, 'middleware.ts'), 'utf8');
    const literal = /const PUBLIC_PATHS = new Set\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? '';
    const paths = literal.split(',').map((entry) => entry.trim()).filter(Boolean);

    expect(paths).toEqual(["'/login'", "'/api/admin/session'"]);
  });

  test('the matcher still has no path exclusion in its lookahead', () => {
    const source = readFileSync(join(import.meta.dirname, 'middleware.ts'), 'utf8');
    const matcher = /matcher: \[([^\]]*)\]/.exec(source)?.[1] ?? '';

    // Only the three static-asset exclusions. 'login' appearing here would mean
    // the prefix mistake came back.
    expect(matcher).toContain('_next/static');
    expect(matcher).not.toContain('login');
    expect(matcher).not.toContain('session');
  });
});

describe('it fails closed', () => {
  test.each([
    ['no session secret', { ADMIN_SESSION_SECRET: undefined }],
    ['a short session secret', { ADMIN_SESSION_SECRET: 'short' }],
    ['no roles', { ADMIN_ROLES: undefined }],
    ['malformed roles', { ADMIN_ROLES: '{oops' }],
    ['an unknown role', { ADMIN_ROLES: '{"founder":"owner"}' }],
    ['a malformed epoch', { ADMIN_SESSION_EPOCH: 'later' }],
  ])('answers 503 with %s, rather than serving the panel', async (_label, overrides) => {
    configure(overrides);

    const response = await middleware(request('/pharmacies'));

    expect(response.status).toBe(503);
    expect(await response.text()).toContain('not configured');
  });

  test('a 503 is not cacheable', async () => {
    configure({ ADMIN_ROLES: undefined });
    expect((await middleware(request('/'))).headers.get('cache-control')).toBe('no-store');
  });
});

describe('an unauthenticated request', () => {
  test('a page is redirected to /login, and the dead cookie is cleared', async () => {
    const response = await middleware(request('/pharmacies'));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(ORIGIN + '/login');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test('an API route gets 401, not an HTML redirect', async () => {
    const response = await middleware(request('/api/admin/shops'));

    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
  });

  test.each([
    ['a forged signature', 'not-a-real-token.aaaa'],
    ['an empty cookie', ''],
  ])('%s is refused', async (_label, cookie) => {
    const response = await middleware(request('/pharmacies', cookie));
    expect(response.status).not.toBe(200);
  });

  test('a cookie past its absolute expiry is refused', async () => {
    const cookie = await cookieFor('founder', { now: Date.now() - 9 * 60 * 60 * 1_000 });
    expect((await middleware(request('/pharmacies', cookie))).status).toBe(303);
  });

  test('a cookie idle for more than 30 minutes is refused', async () => {
    // THIS TEST WAS VACUOUS, and a Codex round 1A fix is what revealed it.
    //
    // It used to build the cookie by back-dating `lastSeen` 31 minutes through
    // `touchedSessionPayload`, leaving lastSeen BEFORE iat. `adminSession.ts`
    // refuses that pair as `malformed` several lines above the idle check, so
    // the 303 this test asserted came from the nonsense rule and the idle rule
    // was never once exercised through the middleware. Round 1A made
    // `touchedSessionPayload` monotonic -- right, because a lagging verifier
    // must not drag lastSeen below iat -- which turned the construction into a
    // perfectly valid cookie, and the test went red and said so.
    //
    // A real idle session is one issued 31 minutes ago and never touched since,
    // so iat and lastSeen are both old and only the idle rule can refuse it.
    const cookie = await cookieFor('founder', { now: Date.now() - 31 * 60 * 1_000 });
    expect((await middleware(request('/pharmacies', cookie))).status).toBe(303);
  });

  test('the idle refusal is the IDLE rule, not the nonsense rule standing in for it', async () => {
    // The guard on the test above: these two rules are now pinned apart, so
    // neither can pass for the other again.
    const now = Date.now();
    const idle = await cookieFor('founder', { now: now - 31 * 60 * 1_000 });
    expect(await verifyAdminSession(idle, { secret: SECRET, epoch: 0, now }))
      .toEqual({ ok: false, reason: 'idle' });

    const payload = newSessionPayload({ sub: 'founder', role: 'super_admin', epoch: 0, now });
    const backdated = await signAdminSession({ ...payload, lastSeen: now - 31 * 60 * 1_000 }, SECRET);
    expect(await verifyAdminSession(backdated, { secret: SECRET, epoch: 0, now }))
      .toEqual({ ok: false, reason: 'malformed' });
    expect((await middleware(request('/pharmacies', backdated))).status).toBe(303);
  });

  test('a cookie from a revoked epoch is refused', async () => {
    configure({ ADMIN_SESSION_EPOCH: '2' });
    const cookie = await cookieFor('founder', { epoch: 1 });

    expect((await middleware(request('/pharmacies', cookie))).status).toBe(303);
  });
});

describe('an authenticated request', () => {
  test('passes, and the idle window is refreshed in place', async () => {
    const issuedAt = Date.now() - 10 * 60 * 1_000;
    const cookie = await cookieFor('founder', { now: issuedAt });

    const response = await middleware(request('/pharmacies', cookie));

    expect(response.status).toBe(200);
    const refreshed = (response.headers.get('set-cookie') ?? '').split(';')[0]?.split('=').slice(1).join('=') ?? '';
    const verified = await verifyAdminSession(refreshed, { secret: SECRET, epoch: 0, now: Date.now() });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      // The absolute expiry is untouched; only lastSeen moves.
      expect(verified.payload.iat).toBe(issuedAt);
      expect(verified.payload.exp).toBe(issuedAt + 8 * 60 * 60 * 1_000);
      expect(verified.payload.lastSeen).toBeGreaterThan(issuedAt);
    }
  });

  test('a username removed from ADMIN_ROLES is denied on the NEXT request', async () => {
    const cookie = await cookieFor('founder');
    expect((await middleware(request('/pharmacies', cookie))).status).toBe(200);

    configure({ ADMIN_ROLES: '{"ops":"read_only"}' });

    const afterRemoval = await middleware(request('/pharmacies', cookie));
    expect(afterRemoval.status).toBe(303);
    expect(afterRemoval.headers.get('location')).toBe(ORIGIN + '/login');
  });

  test('the refreshed cookie keeps HttpOnly, Secure and SameSite=Strict', async () => {
    const response = await middleware(request('/', await cookieFor('founder')));
    const cookie = response.headers.get('set-cookie') ?? '';

    // Case-insensitively: Next serializes SameSite=strict while the login
    // route writes SameSite=Strict, and RFC 6265bis treats the attribute name
    // and value as case-insensitive. What must not vary is which flags are set.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toContain('Path=/');
  });

  test('no password material is read in the Edge gate', () => {
    const source = readFileSync(join(import.meta.dirname, 'middleware.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toContain('ADMIN_ACCOUNTS');
    expect(code).not.toContain('pbkdf2');
    expect(code).not.toContain('adminIdentity');
    expect(code).not.toContain('adminLogin');
  });
});
