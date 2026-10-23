// W4-06 — the session cookie, executed.
//
// A stateless cookie is only as good as its verifier, so the rejections are
// what this file is about: a tampered payload, a cookie signed with another
// secret, one past its absolute expiry, one idle too long, one from a previous
// epoch, and one whose own iat/exp pair claims a longer life than the design
// allows. Every one of those must fail CLOSED, and the signature must be
// checked before any field of the payload is read as data.

import { describe, expect, test } from 'vitest';
import { AdminConfigError } from './errors';
import {
  ABSOLUTE_TTL_MS,
  ADMIN_SESSION_COOKIE,
  CLOCK_SKEW_MS,
  EXPIRED_SESSION_COOKIE_OPTIONS,
  IDLE_TTL_MS,
  newSessionPayload,
  readSessionEpoch,
  readSessionSecret,
  sessionCookieOptions,
  signAdminSession,
  touchedSessionPayload,
  verifyAdminSession,
} from './adminSession';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);
const NOW = Date.UTC(2026, 9, 22, 6, 0, 0);

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * Signs an arbitrary body with the real algorithm, so a test can present a
 * CORRECTLY SIGNED cookie whose payload shape is wrong — the case a forged
 * body cannot reach, because that one stops at the signature.
 */
async function signRawBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + Buffer.from(new Uint8Array(signature)).toString('base64url');
}

describe('configuration', () => {
  test('a secret shorter than 32 bytes is refused', () => {
    expect(() => readSessionSecret({ ADMIN_SESSION_SECRET: 'a'.repeat(31) })).toThrow(AdminConfigError);
    expect(() => readSessionSecret({})).toThrow(AdminConfigError);
    expect(readSessionSecret({ ADMIN_SESSION_SECRET: SECRET })).toBe(SECRET);
  });

  test('secret length is counted in BYTES, not code units', () => {
    // 16 three-byte characters is 48 bytes but only 16 code units.
    expect(readSessionSecret({ ADMIN_SESSION_SECRET: 'অ'.repeat(16) })).toHaveLength(16);
    expect(() => readSessionSecret({ ADMIN_SESSION_SECRET: 'অ'.repeat(10) })).toThrow(AdminConfigError);
  });

  test('an unset epoch is 0, and a malformed one is an error not a silent 0', () => {
    expect(readSessionEpoch({})).toBe(0);
    expect(readSessionEpoch({ ADMIN_SESSION_EPOCH: '  ' })).toBe(0);
    expect(readSessionEpoch({ ADMIN_SESSION_EPOCH: '7' })).toBe(7);
    for (const bad of ['abc', '-1', '1.5', '1e3', '0x2']) {
      expect(() => readSessionEpoch({ ADMIN_SESSION_EPOCH: bad })).toThrow(AdminConfigError);
    }
  });

  test('the cookie name is stable', () => {
    expect(ADMIN_SESSION_COOKIE).toBe('muthoy_admin_session');
  });
});

describe('a signed session round-trips', () => {
  test('verifies and returns the payload', async () => {
    const payload = newSessionPayload({ sub: 'founder', role: 'billing', epoch: 3, now: NOW });
    const token = await signAdminSession(payload, SECRET);

    const result = await verifyAdminSession(token, { secret: SECRET, epoch: 3, now: NOW + 1_000 });

    expect(result).toEqual({ ok: true, payload });
    expect(payload.exp - payload.iat).toBe(ABSOLUTE_TTL_MS);
  });

  test('the idle window moves on refresh but the absolute expiry does not', async () => {
    const payload = newSessionPayload({ sub: 'founder', role: 'support', epoch: 0, now: NOW });
    const later = NOW + 20 * 60 * 1_000;
    const refreshed = touchedSessionPayload(payload, later);

    expect(refreshed.exp).toBe(payload.exp);
    expect(refreshed.lastSeen).toBe(later);

    const token = await signAdminSession(refreshed, SECRET);
    expect((await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: later + 1_000 })).ok).toBe(true);
  });

  test('refreshing cannot outlive the 8-hour absolute window', async () => {
    const payload = newSessionPayload({ sub: 'founder', role: 'support', epoch: 0, now: NOW });
    const past = NOW + ABSOLUTE_TTL_MS + 1;
    const token = await signAdminSession(touchedSessionPayload(payload, past), SECRET);

    expect(await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: past })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});

describe('every rejection fails closed', () => {
  test.each([null, undefined, '', 'no-dot', '.', 'body.', '.signature'])(
    'refuses the malformed token %j',
    async (token) => {
      expect((await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW })).ok).toBe(false);
    },
  );

  test('a tampered payload is rejected before it is read', async () => {
    const payload = newSessionPayload({ sub: 'ops', role: 'read_only', epoch: 0, now: NOW });
    const token = await signAdminSession(payload, SECRET);
    const forged = base64url(JSON.stringify({ ...payload, role: 'super_admin' }))
      + '.' + token.split('.')[1];

    expect(await verifyAdminSession(forged, { secret: SECRET, epoch: 0, now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('a cookie signed with another secret is rejected', async () => {
    const token = await signAdminSession(
      newSessionPayload({ sub: 'founder', role: 'super_admin', epoch: 0, now: NOW }),
      OTHER_SECRET,
    );

    expect(await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('a previous epoch is rejected — this is how revocation works', async () => {
    const token = await signAdminSession(
      newSessionPayload({ sub: 'founder', role: 'super_admin', epoch: 4, now: NOW }),
      SECRET,
    );

    expect(await verifyAdminSession(token, { secret: SECRET, epoch: 5, now: NOW })).toEqual({
      ok: false,
      reason: 'epoch',
    });
  });

  test('idling past 30 minutes is rejected even inside the absolute window', async () => {
    const token = await signAdminSession(
      newSessionPayload({ sub: 'founder', role: 'billing', epoch: 0, now: NOW }),
      SECRET,
    );

    expect(
      await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW + IDLE_TTL_MS }),
    ).toEqual({ ok: false, reason: 'idle' });
  });

  test('a self-extended lifetime is rejected, not honoured', async () => {
    // Someone holding the secret could mint exp = iat + a year. The verifier
    // refuses any pair wider than the design's absolute TTL, so a leaked secret
    // cannot also buy an unbounded session.
    const token = await signRawBody(
      base64url(JSON.stringify({
        sub: 'founder',
        role: 'super_admin',
        iat: NOW,
        exp: NOW + 365 * 24 * 60 * 60 * 1_000,
        lastSeen: NOW,
        epoch: 0,
      })),
      SECRET,
    );

    expect(await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test.each([
    ['a missing sub', { role: 'billing', iat: NOW, exp: NOW + 1_000, lastSeen: NOW, epoch: 0 }],
    ['an empty sub', { sub: '', role: 'billing', iat: NOW, exp: NOW + 1_000, lastSeen: NOW, epoch: 0 }],
    ['an unknown role', { sub: 'x', role: 'owner', iat: NOW, exp: NOW + 1_000, lastSeen: NOW, epoch: 0 }],
    ['a string iat', { sub: 'x', role: 'billing', iat: String(NOW), exp: NOW + 1_000, lastSeen: NOW, epoch: 0 }],
    ['a null lastSeen', { sub: 'x', role: 'billing', iat: NOW, exp: NOW + 1_000, lastSeen: null, epoch: 0 }],
    ['an array payload', [1, 2, 3]],
    ['a JSON string payload', 'founder'],
  ])('refuses %s even when correctly signed', async (_label, payload) => {
    const token = await signRawBody(base64url(JSON.stringify(payload)), SECRET);

    expect(await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('a body that is not base64url is refused', async () => {
    const token = 'not*base64url.' + 'x'.repeat(43);
    expect((await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW })).ok).toBe(false);
  });
});

describe('cookie attributes', () => {
  test('HttpOnly, Secure, SameSite=Strict, Path=/ and a bounded Max-Age', () => {
    const payload = newSessionPayload({ sub: 'founder', role: 'billing', epoch: 0, now: NOW });

    expect(sessionCookieOptions(payload, NOW + 60_000)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: (ABSOLUTE_TTL_MS - 60_000) / 1_000,
    });
  });

  test('a past expiry never yields a negative Max-Age', () => {
    const payload = newSessionPayload({ sub: 'founder', role: 'billing', epoch: 0, now: NOW });
    expect(sessionCookieOptions(payload, NOW + ABSOLUTE_TTL_MS + 5_000).maxAge).toBe(0);
  });

  test('the clearing options expire the cookie immediately', () => {
    expect(EXPIRED_SESSION_COOKIE_OPTIONS.maxAge).toBe(0);
    expect(EXPIRED_SESSION_COOKIE_OPTIONS.sameSite).toBe('strict');
    expect(EXPIRED_SESSION_COOKIE_OPTIONS.httpOnly).toBe(true);
  });
});

describe('a future-dated token cannot outlive the absolute window', () => {
  // The verifier used to check only `now >= exp` and `exp - iat <= 8h`. A token
  // signed with iat years ahead and exp = iat + 8h satisfied both, and
  // `now - lastSeen` went NEGATIVE so the idle check passed as well — so it
  // stayed valid for years. Found by the final acceptance review.
  test('refuses a token whose iat is in the future', async () => {
    const future = NOW + 365 * 24 * 60 * 60 * 1_000;
    const token = await signRawBody(
      base64url(JSON.stringify({
        sub: 'founder',
        role: 'super_admin',
        iat: future,
        exp: future + ABSOLUTE_TTL_MS,
        lastSeen: future,
        epoch: 0,
      })),
      SECRET,
    );

    expect(await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('refuses a future lastSeen that would make the idle window negative', async () => {
    const token = await signRawBody(
      base64url(JSON.stringify({
        sub: 'founder',
        role: 'billing',
        iat: NOW - 1_000,
        exp: NOW + ABSOLUTE_TTL_MS,
        lastSeen: NOW + 48 * 60 * 60 * 1_000,
        epoch: 0,
      })),
      SECRET,
    );

    expect(await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  test('refuses lastSeen earlier than iat, and exp at or before iat', async () => {
    const backwards = await signRawBody(
      base64url(JSON.stringify({
        sub: 'founder', role: 'billing', iat: NOW, exp: NOW + ABSOLUTE_TTL_MS,
        lastSeen: NOW - 60_000, epoch: 0,
      })),
      SECRET,
    );
    expect((await verifyAdminSession(backwards, { secret: SECRET, epoch: 0, now: NOW })).ok).toBe(false);

    const inverted = await signRawBody(
      base64url(JSON.stringify({
        sub: 'founder', role: 'billing', iat: NOW, exp: NOW, lastSeen: NOW, epoch: 0,
      })),
      SECRET,
    );
    expect((await verifyAdminSession(inverted, { secret: SECRET, epoch: 0, now: NOW })).ok).toBe(false);
  });

  test('still tolerates ordinary clock drift within the skew', async () => {
    // A verifying host whose clock is a few seconds behind the signer must not
    // reject a legitimate fresh session.
    const token = await signAdminSession(
      newSessionPayload({ sub: 'founder', role: 'billing', epoch: 0, now: NOW + 5_000 }),
      SECRET,
    );

    expect((await verifyAdminSession(token, { secret: SECRET, epoch: 0, now: NOW })).ok).toBe(true);
    expect(CLOCK_SKEW_MS).toBeGreaterThan(5_000);
  });
});
