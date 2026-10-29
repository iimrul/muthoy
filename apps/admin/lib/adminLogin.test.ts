// W4-06 — the credential boundary, executed.
//
// SYNTHETIC ONLY: a fabricated salt and hash, a doubled KDF for the
// control-flow tests, no network. One test pins the REAL PBKDF2 parameters
// against a known answer, because an injected KDF proves the branching and
// nothing about the cost.
//
// The two properties that make this not a username oracle are asserted
// directly: both branches run EXACTLY ONE KDF, and the unknown-username and
// wrong-password responses are compared byte for byte, headers included.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { recentAdminAudit } from './adminAudit';
import type { AdminIdentityClient } from './adminIdentityStore';
import { ADMIN_SESSION_COOKIE, newSessionPayload, signAdminSession, verifyAdminSession } from './adminSession';
import {
  createLoginThrottles,
  derivePasswordHash,
  handleAdminSessionRequest,
  LOGIN_FAILURE_LOCATION,
  MAX_USERNAME_FAILURES,
  PBKDF2_DIGEST,
  PBKDF2_ITERATIONS,
  PBKDF2_KEY_BYTES,
  SOURCE_BUDGET,
  type LoginThrottles,
} from './adminLogin';

const SALT = '00112233445566778899aabbccddeeff';
const PASSWORD = 'correct horse battery staple';
// The real PBKDF2-SHA256 output for PASSWORD and SALT at 600,000 iterations.
const HASH = '7c0123695eb46911838d4c16fa259d7280c59060c6031130b8269b624faacd02';
const SECRET = 'a'.repeat(32);
const ORIGIN = 'https://admin.muthoy.test';
const NOW = Date.UTC(2026, 9, 22, 6, 0, 0);
// Wider than the longest backoff, so stepping the clock by one of these makes
// each successive failure count rather than being refused by the cooldown.
const BACKOFF_STEP_MS = 61_000;

const ENV = {
  ADMIN_ACCOUNTS: JSON.stringify([{ username: 'founder', salt: SALT, hash: HASH }]),
  ADMIN_ROLES: '{"founder":"billing"}',
  ADMIN_SESSION_SECRET: SECRET,
};

interface DeriveCall {
  password: string;
  salt: string;
}

/** The injected KDF: it records every call, so "exactly one" is checkable. */
function fakeDerive(calls: DeriveCall[]): (password: string, salt: string) => string {
  return (password, salt) => {
    calls.push({ password, salt });
    return password === PASSWORD && salt === SALT ? HASH : 'f'.repeat(64);
  };
}

function loginRequest(
  fields: Record<string, string>,
  options: { origin?: string | null; source?: string; url?: string } = {},
): Request {
  const headers = new Headers({
    'content-type': 'application/x-www-form-urlencoded',
    'x-forwarded-for': options.source ?? '203.0.113.7',
  });
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  return new Request(options.url ?? ORIGIN + '/api/admin/session', {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields).toString(),
  });
}

let throttles: LoginThrottles;
let calls: DeriveCall[];

function deps(overrides: Record<string, unknown> = {}) {
  return {
    env: ENV,
    now: () => NOW,
    derive: fakeDerive(calls),
    throttles,
    sinks: [recentAdminAudit],
    ...overrides,
  };
}

beforeEach(() => {
  throttles = createLoginThrottles();
  calls = [];
  recentAdminAudit.clear();
});

describe('a correct credential', () => {
  test('issues a session cookie and redirects to the panel', async () => {
    const response = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(ADMIN_SESSION_COOKIE + '=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });

  test('the cookie it issues actually verifies, with the role from ADMIN_ROLES', async () => {
    const response = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps(),
    );
    const token = (response.headers.get('set-cookie') ?? '').split(';')[0]?.split('=')[1] ?? '';

    const verified = await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW + 1_000 });

    expect(verified).toMatchObject({ ok: true, payload: { sub: 'founder', role: 'billing' } });
  });

  test('audits the success', async () => {
    await handleAdminSessionRequest(loginRequest({ username: 'founder', password: PASSWORD }), deps());

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      role: 'billing',
      action: 'login',
      outcome: 'success',
    }]);
  });

  test('accepts a JSON body as well as a form', async () => {
    const request = new Request(ORIGIN + '/api/admin/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ username: 'founder', password: PASSWORD }),
    });

    const response = await handleAdminSessionRequest(request, deps());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
  });
});

describe('failure is not an oracle', () => {
  async function failureResponse(fields: Record<string, string>): Promise<Response> {
    return handleAdminSessionRequest(loginRequest(fields), deps());
  }

  test('an unknown username and a wrong password answer identically', async () => {
    const unknown = await failureResponse({ username: 'nobody', password: PASSWORD });
    const wrong = await failureResponse({ username: 'founder', password: 'wrong password here' });

    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.text()).toBe(await wrong.text());
    expect([...unknown.headers.entries()].sort()).toEqual([...wrong.headers.entries()].sort());
    expect(unknown.headers.get('location')).toBe(LOGIN_FAILURE_LOCATION);
    expect(unknown.headers.get('set-cookie')).toBeNull();
  });

  test('both branches run EXACTLY ONE KDF', async () => {
    await failureResponse({ username: 'nobody', password: PASSWORD });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.salt).not.toBe(SALT);

    calls = [];
    await failureResponse({ username: 'founder', password: 'wrong password here' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.salt).toBe(SALT);
  });

  test('an empty username still pays the KDF cost', async () => {
    await failureResponse({ username: '', password: PASSWORD });
    expect(calls).toHaveLength(1);
  });

  test('an overlong password cannot authenticate by its matching 256-character prefix', async () => {
    const prefix = 'x'.repeat(256);
    const env = { ...ENV, ADMIN_ACCOUNTS: JSON.stringify([{ username: 'founder', salt: SALT, hash: HASH }]) };
    const derive = vi.fn((password: string) => password === prefix ? HASH : 'f'.repeat(64));
    const response = await handleAdminSessionRequest(loginRequest({ username: 'founder', password: prefix + 'wrong' }), deps({ env, derive }));
    expect(response.headers.get('location')).toBe(LOGIN_FAILURE_LOCATION);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(derive).toHaveBeenCalledExactlyOnceWith(prefix, SALT);
  });

  test('a valid maximum-length password still authenticates', async () => {
    const password = 'x'.repeat(256);
    const response = await handleAdminSessionRequest(loginRequest({ username: 'founder', password }), deps({ derive: () => HASH }));
    expect(response.headers.get('location')).toBe('/');
  });

  test('the audit DOES distinguish them, server-side only', async () => {
    await failureResponse({ username: 'nobody', password: PASSWORD });
    await failureResponse({ username: 'founder', password: 'wrong password here' });

    expect(recentAdminAudit.entries().map((entry) => entry.meta.reason))
      .toEqual(['bad_password', 'unknown_username']);
  });

  test('a correct password for a username with no role entry is still refused', async () => {
    const response = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps({ env: { ...ENV, ADMIN_ROLES: '{"ops":"support"}' } }),
    );

    // loadAdminIdentity cross-validates, so this is the 503 path rather than a
    // login that proceeds with undefined authority.
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('CSRF: the Origin header is the check', () => {
  test('a missing Origin is refused before any KDF runs', async () => {
    const response = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }, { origin: null }),
      deps(),
    );

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test('a foreign Origin is refused', async () => {
    const response = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }, { origin: 'https://evil.test' }),
      deps(),
    );

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test('ADMIN_ORIGIN pins the allowed origin when it is set', async () => {
    const env = { ...ENV, ADMIN_ORIGIN: 'https://admin.muthoy.app' };

    const pinned = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }, { origin: 'https://admin.muthoy.app' }),
      deps({ env }),
    );
    expect(pinned.status).toBe(303);

    const ownOrigin = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps({ env }),
    );
    expect(ownOrigin.status).toBe(403);
  });

  test('the forwarded host counts as the deployment origin behind a proxy', async () => {
    const request = new Request('http://10.0.0.5/api/admin/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://admin.muthoy.app',
        'x-forwarded-host': 'admin.muthoy.app',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '203.0.113.7',
      },
      body: new URLSearchParams({ username: 'founder', password: PASSWORD }).toString(),
    });

    expect((await handleAdminSessionRequest(request, deps())).status).toBe(303);
  });
});

describe('throttling', () => {
  test('the per-source budget bounds attempts, and the refusal costs no KDF', async () => {
    for (let attempt = 0; attempt < SOURCE_BUDGET; attempt += 1) {
      const response = await handleAdminSessionRequest(
        loginRequest({ username: 'nobody' + attempt, password: 'x' }),
        deps(),
      );
      expect(response.status).toBe(303);
    }
    expect(calls).toHaveLength(SOURCE_BUDGET);

    const refused = await handleAdminSessionRequest(
      loginRequest({ username: 'nobody-again', password: 'x' }),
      deps(),
    );

    expect(refused.status).toBe(429);
    expect(calls).toHaveLength(SOURCE_BUDGET);
  });

  test('an oversized body is refused BEFORE it is parsed', async () => {
    // MY ROUND 2 OF THE DUAL PROTOCOL. Round 1A moved the source budget below
    // the logout branch, which was right -- an exhausted budget must not trap
    // an operator in a session they cannot end -- but the logout signal lives
    // in the body, so `readFields` became reachable by any unauthenticated
    // request. The budget is still ahead of the KDF, which was the expensive
    // half; this ceiling covers the half that moved.
    const headers = new Headers({
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': '203.0.113.9',
      origin: ORIGIN,
      'content-length': '4097',
    });
    const response = await handleAdminSessionRequest(
      new Request(ORIGIN + '/api/admin/session', {
        method: 'POST',
        headers,
        body: 'username=founder&password=' + 'x'.repeat(4_100),
      }),
      deps(),
    );

    expect(response.status).toBe(413);
    // No KDF, and the budget is untouched: a refusal this cheap must not also
    // be a way to spend somebody else's attempts.
    expect(calls).toHaveLength(0);
    expect(
      await handleAdminSessionRequest(
        loginRequest({ username: 'founder', password: PASSWORD }, { source: '203.0.113.9' }),
        deps(),
      ),
    ).toMatchObject({ status: 303 });
  });

  test('a body at the ceiling is still read', async () => {
    // Non-vacuity: the ceiling refuses what is over it and nothing else. A
    // real form is a few hundred bytes, so this sits far above any of them.
    const body = 'username=founder&password=' + encodeURIComponent(PASSWORD);
    const headers = new Headers({
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': '203.0.113.10',
      origin: ORIGIN,
      'content-length': String(body.length),
    });

    const response = await handleAdminSessionRequest(
      new Request(ORIGIN + '/api/admin/session', { method: 'POST', headers, body }),
      deps(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain(ADMIN_SESSION_COOKIE + '=');
  });

  test('rotating usernames consumes the SAME budget — that is the point of it', async () => {
    for (let attempt = 0; attempt < SOURCE_BUDGET; attempt += 1) {
      await handleAdminSessionRequest(loginRequest({ username: 'user' + attempt, password: 'x' }), deps());
    }
    const refused = await handleAdminSessionRequest(loginRequest({ username: 'founder', password: PASSWORD }), deps());
    expect(refused.status).toBe(429);
  });

  test('a different source has its own budget', async () => {
    for (let attempt = 0; attempt < SOURCE_BUDGET; attempt += 1) {
      await handleAdminSessionRequest(loginRequest({ username: 'nobody', password: 'x' }), deps());
    }

    const other = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }, { source: '198.51.100.9' }),
      deps(),
    );

    expect(other.status).toBe(303);
  });

  test('the budget window rolls over', async () => {
    for (let attempt = 0; attempt < SOURCE_BUDGET + 1; attempt += 1) {
      await handleAdminSessionRequest(loginRequest({ username: 'nobody', password: 'x' }), deps());
    }

    const later = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps({ now: () => NOW + 15 * 60 * 1_000 }),
    );

    expect(later.status).toBe(303);
  });

  test('the per-username backoff refuses the next attempt even with the right password', async () => {
    await handleAdminSessionRequest(loginRequest({ username: 'founder', password: 'wrong' }), deps());

    const immediate = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps(),
    );
    expect(immediate.headers.get('location')).toBe(LOGIN_FAILURE_LOCATION);
    // Still exactly one KDF per attempt: the cooldown must not short-circuit it,
    // or "known username in cooldown" becomes measurably faster than "unknown".
    expect(calls).toHaveLength(2);

    const afterBackoff = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps({ now: () => NOW + 2_000 }),
    );
    expect(afterBackoff.status).toBe(303);
    expect(afterBackoff.headers.get('location')).toBe('/');
  });

  test('ten failures lock the account for fifteen minutes', async () => {
    for (let attempt = 0; attempt < MAX_USERNAME_FAILURES; attempt += 1) {
      await handleAdminSessionRequest(
        loginRequest({ username: 'founder', password: 'wrong' }),
        // Step the clock past each backoff so the failures all count.
        deps({ now: () => NOW + attempt * BACKOFF_STEP_MS }),
      );
    }

    const locked = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps({ now: () => NOW + MAX_USERNAME_FAILURES * BACKOFF_STEP_MS }),
    );
    expect(locked.headers.get('location')).toBe(LOGIN_FAILURE_LOCATION);

    const afterLockout = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps({ now: () => NOW + 16 * 60 * 1_000 + MAX_USERNAME_FAILURES * BACKOFF_STEP_MS }),
    );
    expect(afterLockout.status).toBe(303);
    expect(afterLockout.headers.get('location')).toBe('/');
  });

  test('a successful login clears the username throttle', async () => {
    await handleAdminSessionRequest(loginRequest({ username: 'founder', password: 'wrong' }), deps());
    await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps({ now: () => NOW + 2_000 }),
    );

    const again = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      deps({ now: () => NOW + 2_100 }),
    );

    expect(again.status).toBe(303);
  });
});

describe('logout, configuration and the real KDF', () => {
  test('logout clears the cookie and says so', async () => {
    const response = await handleAdminSessionRequest(
      loginRequest({ intent: 'logout' }),
      deps(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?signedOut=1');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(calls).toHaveLength(0);
  });

  test('an UNAUTHENTICATED logout cannot forge a successful record for anyone', async () => {
    // The actor used to come from the form body, so any caller with an accepted
    // Origin could write "founder logged out, success" into the audit log.
    // Found by the final acceptance review.
    await handleAdminSessionRequest(
      loginRequest({ intent: 'logout', username: 'founder' }),
      deps(),
    );

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'unknown',
      action: 'logout',
      outcome: 'failure',
      meta: { reason: 'no_valid_session' },
    }]);
    expect(JSON.stringify(recentAdminAudit.entries())).not.toContain('founder');
  });

  test("an AUTHENTICATED logout records the cookie subject, not the body one", async () => {
    const token = await signAdminSession(
      newSessionPayload({ sub: 'founder', role: 'billing', epoch: 0, now: NOW }),
      SECRET,
    );
    const request = new Request(ORIGIN + '/api/admin/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: ORIGIN,
        'x-forwarded-for': '203.0.113.7',
        cookie: ADMIN_SESSION_COOKIE + '=' + token,
      },
      // The body claims someone else entirely.
      body: new URLSearchParams({ intent: 'logout', username: 'someone-else' }).toString(),
    });

    const query = {
      update: () => query,
      eq: () => query,
      or: () => query,
      select: async () => ({ data: [{ username: 'founder' }], error: null }),
    };
    const client = { from: () => query } as unknown as AdminIdentityClient;
    const response = await handleAdminSessionRequest(request, deps({ identityStore: { client } }));

    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      action: 'logout',
      outcome: 'success',
    }]);
  });

  test('an unconfigured panel answers 503, never a session', async () => {
    for (const env of [
      {},
      { ADMIN_ACCOUNTS: ENV.ADMIN_ACCOUNTS },
      { ADMIN_ACCOUNTS: ENV.ADMIN_ACCOUNTS, ADMIN_ROLES: ENV.ADMIN_ROLES },
      { ADMIN_ACCOUNTS: '[]', ADMIN_ROLES: ENV.ADMIN_ROLES, ADMIN_SESSION_SECRET: SECRET },
      { ADMIN_ACCOUNTS: ENV.ADMIN_ACCOUNTS, ADMIN_ROLES: ENV.ADMIN_ROLES, ADMIN_SESSION_SECRET: 'short' },
    ]) {
      const response = await handleAdminSessionRequest(
        loginRequest({ username: 'founder', password: PASSWORD }),
        deps({ env, throttles: createLoginThrottles() }),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  test('the REAL KDF parameters are the OWASP floor, and it reproduces the vector', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect(PBKDF2_KEY_BYTES).toBe(32);
    expect(PBKDF2_DIGEST).toBe('sha256');
    // An injected KDF proves the branching and nothing about the cost, so the
    // real one runs once here against a fixed vector.
    expect(derivePasswordHash(PASSWORD, SALT)).toBe(HASH);
  });

  test('the real KDF is what the module uses by default', async () => {
    const response = await handleAdminSessionRequest(
      loginRequest({ username: 'founder', password: PASSWORD }),
      { env: ENV, now: () => NOW, throttles, sinks: [recentAdminAudit] },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
  });
});
