import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authorityRefusesActor,
  constantTimeEquals,
  decideDeviceGate,
  describeRegistryFailure,
  DEVICE_CROSS_SHOP_ACTIONS,
  DEVICE_EXEMPT_ACTIONS,
  DEVICE_GUARDED_ACTIONS,
  DEVICE_REENROLMENT_CODES,
  DEVICE_REVOCATION_CODES,
  hashDeviceSecret,
  mintDeviceSecret,
  requesterIp,
  type DeviceGateFacts,
} from './deviceRegistryPolicy.ts';

// A2.3, server half — the parts that can actually be RUN.
//
// deviceRegistry.ts imports npm:bcryptjs and ./_shared/auth.ts, which this
// runner cannot load, so the two files are split exactly as deviceLogin.ts and
// deviceLoginPolicy.ts are. The executable decisions live here; the source
// contracts that can only be read as text are asserted at the bottom.

const SOURCE = readFileSync(
  resolve('backend/supabase/functions/sync/deviceRegistry.ts'), 'utf8',
);
const INDEX = readFileSync(
  resolve('backend/supabase/functions/sync/index.ts'), 'utf8',
);
const BINDING = readFileSync(
  resolve('backend/supabase/functions/sync/deviceBinding.ts'), 'utf8',
);

const ACTOR = 'actor-1';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    known: true,
    status: 'active',
    registryVersion: 1,
    enforced: true,
    bindings: [] as unknown[],
    ...overrides,
  };
}

describe('the device secret', () => {
  it('is 32 bytes of CSPRNG output, hex, and never repeats', () => {
    const first = mintDeviceSecret();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    // 256 bits: a collision here would mean the CSPRNG is not one.
    const many = new Set(Array.from({ length: 200 }, () => mintDeviceSecret()));
    expect(many.size).toBe(200);
    expect(many.has(first)).toBe(false);
  });

  it('hashes deterministically to a SHA-256 hex digest', async () => {
    const secret = 'a'.repeat(64);
    const digest = await hashDeviceSecret(secret);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashDeviceSecret(secret)).toBe(digest);
    // The published SHA-256 known-answer vector for "abc", so a future
    // "optimisation" cannot quietly change the algorithm while keeping shape.
    expect(await hashDeviceSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces a completely different digest for a one-character change', async () => {
    const a = await hashDeviceSecret('0'.repeat(64));
    const b = await hashDeviceSecret(`${'0'.repeat(63)}1`);
    expect(a).not.toBe(b);
  });
});

describe('constant-time comparison', () => {
  it('accepts only an exact match', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
    // Differing in the FIRST character must be as false as the last — the
    // whole reason this is not ===.
    expect(constantTimeEquals('abc123', 'zbc123')).toBe(false);
  });

  it('rejects a prefix, a suffix and the empty string without short-circuiting', () => {
    expect(constantTimeEquals('abc', 'abcdef')).toBe(false);
    expect(constantTimeEquals('abcdef', 'abc')).toBe(false);
    expect(constantTimeEquals('', 'abc')).toBe(false);
    expect(constantTimeEquals('abc', '')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });

  it('reads every byte regardless of where the difference is', () => {
    // Behavioural proxy for the timing property: a mismatch at index 0 and one
    // at index 63 both return false, and the implementation has no early
    // return to take. Wall-clock timing is not assertable on CI, so the guard
    // against regression is this plus the source check below.
    const base = 'f'.repeat(64);
    for (const index of [0, 31, 63]) {
      const mutated = `${base.slice(0, index)}0${base.slice(index + 1)}`;
      expect(constantTimeEquals(base, mutated)).toBe(false);
    }
    expect(SOURCE).not.toContain('=== storedHash');
  });
});

describe('deny by revocation, not allow by enrolment', () => {
  it('raises no objection for an installation the registry has never seen', () => {
    // The rollout safety property. If this ever returns true, deploying A2.3
    // locks every shop out of its own till.
    expect(authorityRefusesActor(snapshot({ known: false, status: 'unknown' }), ACTOR))
      .toBe(false);
    expect(authorityRefusesActor(null, ACTOR)).toBe(false);
  });

  it('refuses everyone on a revoked device, bindings or not', () => {
    expect(authorityRefusesActor(snapshot({ status: 'revoked' }), ACTOR)).toBe(true);
    expect(authorityRefusesActor(
      snapshot({ status: 'revoked', bindings: [{ actorUserId: ACTOR, status: 'active' }] }),
      ACTOR,
    )).toBe(true);
  });

  it('refuses only the revoked actor, leaving colleagues alone', () => {
    const value = snapshot({
      bindings: [
        { actorUserId: ACTOR, status: 'revoked' },
        { actorUserId: 'actor-2', status: 'active' },
      ],
    });
    expect(authorityRefusesActor(value, ACTOR)).toBe(true);
    expect(authorityRefusesActor(value, 'actor-2')).toBe(false);
    // An actor the snapshot never mentions is unknown, not revoked.
    expect(authorityRefusesActor(value, 'actor-3')).toBe(false);
  });

  it('ignores malformed binding entries rather than trusting them', () => {
    expect(authorityRefusesActor(snapshot({ bindings: 'nonsense' }), ACTOR)).toBe(false);
    expect(authorityRefusesActor(snapshot({ bindings: [null, 7, 'x'] }), ACTOR)).toBe(false);
  });
});

describe('SQLSTATE to product code', () => {
  it.each([
    ['MU061', 403, 'device_admin_required'],
    ['MU062', 400, 'device_details_invalid'],
    ['MU063', 403, 'account_inactive'],
    ['MU064', 403, 'device_revoked'],
    ['MU065', 403, 'binding_revoked'],
    ['MU066', 404, 'device_not_registered'],
    ['MU067', 403, 'binding_not_registered'],
    ['MU068', 403, 'device_session_unbound'],
    ['MU069', 403, 'device_session_unbound'],
    ['MU070', 403, 'device_enrollment_held'],
    ['MU071', 403, 'device_approval_required'],
  ])('maps %s to %i %s', (sqlstate, status, code) => {
    expect(describeRegistryFailure(sqlstate as string)).toMatchObject({ status, code });
  });

  it('never guesses a meaning for an unrecognised error', () => {
    // A transient database fault must not be reported as a revocation, or a
    // bad five minutes becomes a persisted quarantine on every device.
    for (const unknown of ['23505', '42501', 'MU999', undefined, null, '']) {
      expect(describeRegistryFailure(unknown)).toMatchObject({
        status: 500, code: 'device_registry_failed',
      });
    }
  });

  it('leaks no SQLSTATE into a message the device would show', () => {
    for (const sqlstate of ['MU061', 'MU064', 'MU067', '42501']) {
      expect(describeRegistryFailure(sqlstate).message).not.toMatch(/MU\d{3}|42501|db=/);
    }
  });

  it('maps stale and unbound enforcement failures to relink instructions', () => {
    expect(describeRegistryFailure('MU068')).toMatchObject({
      status: 403,
      code: 'device_session_unbound',
      message: expect.stringMatching(/sign in again/i),
    });
    expect(describeRegistryFailure('MU069')).toMatchObject({
      status: 403,
      code: 'device_session_unbound',
      message: expect.stringMatching(/sign in again.*relink/i),
    });
  });
});


// -- The request gate ------------------------------------------------------

function facts(overrides: Partial<DeviceGateFacts> = {}): DeviceGateFacts {
  // A healthy bound session in an unenforced shop. Every test below breaks
  // exactly one thing, so the reason for each refusal is the single field it
  // changed.
  return {
    enforced: false,
    bound: true,
    deviceStatus: 'active',
    bindingStatus: 'active',
    ...overrides,
  };
}

function refusalCode(overrides: Partial<DeviceGateFacts>): string | null {
  const decision = decideDeviceGate(facts(overrides));
  return decision.allowed ? null : decision.code;
}

describe('a BOUND session is judged on its binding, always', () => {
  it('allows one whose installation and binding are both active', () => {
    expect(decideDeviceGate(facts())).toEqual({ allowed: true });
    expect(decideDeviceGate(facts({ enforced: true }))).toEqual({ allowed: true });
  });

  it.each([false, true])('refuses a revoked DEVICE (enforced=%s)', (enforced) => {
    // The property the rework exists for: revocation bites without waiting for
    // the shop to throw the enforcement switch. An Owner who removes a lost
    // handset expects it to stop that minute.
    expect(refusalCode({ enforced, deviceStatus: 'revoked' })).toBe('device_revoked');
  });

  it.each([false, true])('refuses a revoked BINDING (enforced=%s)', (enforced) => {
    expect(refusalCode({ enforced, bindingStatus: 'revoked' })).toBe('binding_revoked');
  });

  it('reports the DEVICE revocation when both are revoked', () => {
    // The whole installation is gone; naming one actor's binding would be a
    // smaller and less accurate truth.
    expect(refusalCode({ deviceStatus: 'revoked', bindingStatus: 'revoked' }))
      .toBe('device_revoked');
  });

  it('fails closed on a mapping that points nowhere', () => {
    // A session bound to a device row that has been deleted, or to another
    // shop or actor — the gate reports those as a null status. Not a
    // revocation and not legacy: standing cannot be established, so it is
    // refused either way.
    expect(refusalCode({ deviceStatus: null })).toBe('device_session_unbound');
    expect(refusalCode({ bindingStatus: null })).toBe('device_session_unbound');
    expect(refusalCode({ deviceStatus: 'mismatched', bindingStatus: null }))
      .toBe('device_session_unbound');
  });
});

describe('enforcement only decides the fate of the UNBOUND', () => {
  it('allows a legacy unbound session while the shop does not enforce', () => {
    // The rollout safety property. Every session that was already live when
    // this deployed is unbound, and refusing them would lock out an entire
    // customer base on the day of release.
    expect(decideDeviceGate(facts({
      bound: false, deviceStatus: null, bindingStatus: null,
    }))).toEqual({ allowed: true });
  });

  it('refuses a legacy unbound session once the shop enforces', () => {
    expect(refusalCode({
      enforced: true, bound: false, deviceStatus: null, bindingStatus: null,
    })).toBe('device_session_unbound');
  });

  it('is the ONLY thing the enforcement flag changes', () => {
    // Stated as a property rather than a case: across every combination of
    // device and binding status, turning enforcement on may change the answer
    // only when the session is unbound.
    const statuses = [null, 'active', 'revoked', 'mismatched'];
    for (const deviceStatus of statuses) {
      for (const bindingStatus of statuses) {
        for (const bound of [true, false]) {
          const off = decideDeviceGate(facts({
            enforced: false, bound, deviceStatus, bindingStatus,
          }));
          const on = decideDeviceGate(facts({
            enforced: true, bound, deviceStatus, bindingStatus,
          }));
          if (bound) {
            expect(on, `bound ${deviceStatus}/${bindingStatus}`).toEqual(off);
          } else {
            expect(off.allowed, 'unbound, unenforced').toBe(true);
            expect(on.allowed, 'unbound, enforced').toBe(false);
          }
        }
      }
    }
  });
});

describe('revocation and re-binding stay separate', () => {
  it('classifies every gate refusal into exactly one of the two sets', () => {
    const revocations = new Set<string>(DEVICE_REVOCATION_CODES);
    const rebinds = new Set<string>(DEVICE_REENROLMENT_CODES);
    const everyRefusal = [
      refusalCode({ deviceStatus: 'revoked' }),
      refusalCode({ bindingStatus: 'revoked' }),
      refusalCode({ deviceStatus: null }),
      refusalCode({ enforced: true, bound: false, deviceStatus: null, bindingStatus: null }),
    ];
    for (const code of everyRefusal) {
      expect(code).not.toBeNull();
      expect(
        revocations.has(code as string) !== rebinds.has(code as string),
        `${code} must be classified exactly once`,
      ).toBe(true);
    }
  });

  it('never treats an unbound session as a revocation', () => {
    // Persisting a quarantine for an unbound session would make revocation
    // self-inflicted: every ordinary expired session would look like one.
    for (const code of DEVICE_REENROLMENT_CODES) {
      expect(new Set<string>(DEVICE_REVOCATION_CODES).has(code)).toBe(false);
    }
  });
});

describe('no sync route can drift out of the gate', () => {
  /**
   * Every `body.action === "..."` the router dispatches on.
   *
   * Both quote styles, deliberately. The file mixes them — `'staff-reactivate'`
   * is single-quoted while its neighbours are double — so a parser that
   * understood only one would silently skip routes and then report a clean
   * sweep, which is worse than not checking at all.
   */
  const routed = [...INDEX.matchAll(/body\.action === (?:"([a-z-]+)"|'([a-z-]+)')/g)]
    .map((match) => (match[1] ?? match[2]) as string);

  it('finds the routes at all, in both quote styles', () => {
    expect(new Set(routed).size).toBeGreaterThan(15);
    // The single-quoted one a double-quote-only parser would miss.
    expect(routed).toContain('staff-reactivate');
    expect(routed).toContain('pull');
  });

  it('classifies every routed action as guarded, cross-shop or exempt', () => {
    // The drift test. A route added later is behind the device gate, gates
    // itself per target shop, or carries a written reason for neither — there
    // is no fourth state, and no way to reach one by forgetting.
    const guarded = new Set<string>(DEVICE_GUARDED_ACTIONS);
    const crossShop = new Set<string>(DEVICE_CROSS_SHOP_ACTIONS);
    const unclassified = [...new Set(routed)].filter(
      (action) => !guarded.has(action)
        && !crossShop.has(action)
        && !(action in DEVICE_EXEMPT_ACTIONS),
    );
    expect(unclassified, 'unclassified sync actions').toEqual([]);
  });

  it('gates every route that carries shop data', () => {
    for (const action of [
      'pull', 'push', 'push-group', 'refund-claim', 'device-access',
      'shop-switch', 'shop-create',
    ]) {
      expect(new Set<string>(DEVICE_GUARDED_ACTIONS).has(action), action).toBe(true);
    }
  });

  it('has NO enrolment route left to exempt', () => {
    // The bypass this batch removed: a route on which any live access token
    // could register itself a brand-new trusted installation.
    expect(routed).not.toContain('device-enroll');
    expect('device-enroll' in DEVICE_EXEMPT_ACTIONS).toBe(false);
    expect(new Set<string>(DEVICE_GUARDED_ACTIONS).has('device-enroll')).toBe(false);
  });

  it('exempts only routes that establish or repair standing', () => {
    for (const action of ['device-login', 'link-device', 'recover-pin', 'device-authority']) {
      expect(action in DEVICE_EXEMPT_ACTIONS, action).toBe(true);
      expect(DEVICE_EXEMPT_ACTIONS[action]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('never classifies an action two ways', () => {
    for (const action of DEVICE_GUARDED_ACTIONS) {
      expect(action in DEVICE_EXEMPT_ACTIONS, action).toBe(false);
      expect(new Set<string>(DEVICE_CROSS_SHOP_ACTIONS).has(action), action).toBe(false);
    }
    for (const action of DEVICE_CROSS_SHOP_ACTIONS) {
      expect(action in DEVICE_EXEMPT_ACTIONS, action).toBe(false);
    }
  });

  it('runs the gate once, after JWT verification and before every handler', () => {
    const verifyIndex = INDEX.indexOf('verifyCallerJwt(request)');
    const gateIndex = INDEX.indexOf('await assertDeviceAuthority(caller)');
    const firstHandler = INDEX.indexOf('body.action === "push"');
    expect(gateIndex).toBeGreaterThan(verifyIndex);
    expect(gateIndex).toBeLessThan(firstHandler);
    // Exactly one call site. A second would be the start of per-route drift.
    expect(INDEX.match(/assertDeviceAuthority\(/g) ?? []).toHaveLength(1);
    // And it is handed the CALLER only — never the body, which is the entire
    // difference between this design and the one it replaced.
    expect(INDEX).not.toMatch(/assertDeviceAuthority\(caller,\s*body\)/);
  });
});

describe('source contracts the runner cannot execute', () => {
  it('charges every attempt budget BEFORE any hashing or bcrypt', () => {
    const reserveIndex = SOURCE.indexOf('await reserveAttempts(attemptKeys, attemptLimits)');
    const bcryptIndex = SOURCE.indexOf('bcrypt.compare(');
    const hashIndex = SOURCE.indexOf('await hashDeviceSecret(deviceSecret)');
    expect(reserveIndex).toBeGreaterThan(-1);
    // bcrypt at cost 10 is ~300ms of server time. On an unauthenticated
    // endpoint that is a CPU-exhaustion primitive, so the limiter is a DoS
    // guard first and a brute-force guard second.
    expect(reserveIndex).toBeLessThan(bcryptIndex);
    expect(reserveIndex).toBeLessThan(hashIndex);
  });

  it('reserves the attempt rather than recording it afterwards', () => {
    // The concurrency fix, as a source contract. A separate "record the
    // failure" call after the work is exactly the shape that let N parallel
    // requests all read the same pre-increment count and all pass.
    expect(SOURCE).not.toContain('registerFailure');
    expect(SOURCE).not.toContain('login_attempt_locked_until');
    expect(SOURCE).toContain('a23_reserve_attempts');
  });

  it('counts a dimension the caller does not choose', () => {
    // shopId, devicePublicId and actorUserId all arrive in the request body.
    // Without an IP/global key, rotating them buys unlimited server bcrypt.
    expect(SOURCE).toContain('a23-abuse:');
    expect(SOURCE).toContain('GLOBAL_ABUSE_KEY');
    expect(SOURCE).toMatch(/clientIp \? `a23-abuse:\$\{clientIp\}` : GLOBAL_ABUSE_KEY/);
    // And the router has to actually supply it.
    expect(INDEX).toContain('deviceActorSwitch(body, clientIp(request))');
  });

  it('answers every lockout with the same refusal it answers a wrong PIN with', () => {
    // A 429 on one key and a 401 on another told an attacker which of the two
    // identifiers they had guessed right. A limiter that enumerates is a
    // limiter working against itself.
    expect(SOURCE).not.toContain('device_switch_locked');
    expect(SOURCE).not.toContain('HttpError(429');
    expect(SOURCE).toMatch(
      /if \(!await reserveAttempts\(attemptKeys, attemptLimits\)\)[\s\S]{0,160}GENERIC_FAILURE/,
    );
  });

  it('compares a PIN miss against a dummy hash so a miss costs what a hit costs', () => {
    expect(SOURCE).toContain('DUMMY_HASH');
    expect(SOURCE).toMatch(/bcrypt\.compare\([\s\S]{0,200}DUMMY_HASH/);
  });

  it('answers every credential failure with one indistinguishable message', () => {
    expect(SOURCE).toContain('const GENERIC_FAILURE = "Could not verify this device"');
    // The refusal must not say which of the two credentials was wrong.
    expect(SOURCE).toMatch(
      /if \(!deviceMatches \|\| !actorUsable \|\| !pinMatches\)[\s\S]{0,320}GENERIC_FAILURE/,
    );
  });

  it('does not charge an attempt for a registry refusal, only for a bad credential', () => {
    const clearIndex = SOURCE.indexOf('await clearAttempts([deviceKey, actorKey])');
    const authorizeIndex = SOURCE.indexOf('const authority = await authorizeSwitchOrExplain(');
    // The budgets are refunded the moment the credentials verify, BEFORE the
    // registry is consulted. A revoked binding is a commercial refusal, not a
    // guess, and must not burn the budget of the colleague who still holds a
    // valid one on the same handset.
    expect(clearIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeLessThan(authorizeIndex);
    expect(SOURCE.slice(authorizeIndex)).not.toContain('reserveAttempts');
  });

  it('attaches the authority snapshot to a revocation refusal', () => {
    // The actor switch is unauthenticated, so the refusal body is the ONLY
    // channel by which a revoked device can learn it was revoked. Without
    // this the quarantine would depend on a follow-up authenticated refresh
    // that a device in this state cannot make.
    const explain = SOURCE.indexOf('async function authorizeSwitchOrExplain');
    expect(explain).toBeGreaterThan(-1);
    const body = SOURCE.slice(explain, explain + 2600);
    expect(body).toContain('a23_device_authority');
    expect(body).toMatch(/error\.code !== "device_revoked" && error\.code !== "binding_revoked"/);
    expect(body).toContain('parseDeviceAuthority(data)');
    expect(body).toContain('new HttpError(error.status, error.message, error.code, { authority })');
  });

  it('never logs the plaintext secret, and returns it exactly once', () => {
    // The secret is minted and handed back in deviceBinding.ts, a separate
    // module because deviceRegistry.ts's `npm:bcryptjs` import cannot be
    // loaded by this runner even transitively. Checked there, and the
    // no-logging rule is checked across BOTH — a secret leaking through the
    // actor switch would be exactly as bad as one leaking through binding.
    const returns = BINDING.match(/deviceSecret: secret/g) ?? [];
    expect(returns).toHaveLength(1);
    for (const source of [SOURCE, BINDING]) {
      expect(source).not.toMatch(/console\.\w+\([^)]*(secret|deviceSecret|pin)\b/i);
    }
    // And the plaintext never reaches the database: only its digest does.
    expect(BINDING).toContain('p_secret_hash: await hashDeviceSecret(secret)');
  });

  it('verifies the minted token and re-checks liveness before returning a session', () => {
    expect(SOURCE).toContain('mintedSessionMatchesActor');
    expect(SOURCE).toContain('assertCallerCurrent(mintedCaller)');
  });

  it('routes the actor switch BEFORE JWT verification, and everything else after', () => {
    const switchIndex = INDEX.indexOf('body.action === "device-actor-switch"');
    const verifyIndex = INDEX.indexOf('verifyCallerJwt(request)');
    // Unauthenticated by necessity: a handover may hold an expired token or
    // none at all. It authenticates by device secret + PIN instead.
    expect(switchIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeLessThan(verifyIndex);
    // Every administration action stays behind the token. `device-enroll` is
    // deliberately absent from this list and from the router entirely — see
    // "has NO enrolment route left to exempt" above.
    for (const action of ['device-authority', 'device-list', 'device-access']) {
      const index = INDEX.indexOf(`body.action === "${action}"`);
      expect(index, `${action} must be authenticated`).toBeGreaterThan(verifyIndex);
    }
  });
});

// -- Blocker 9: which address the limiter is allowed to believe --------------

describe('the requester address', () => {
  function headers(map: Record<string, string>) {
    return (name: string) => map[name] ?? null;
  }

  it('reads cf-connecting-ip, the one header the platform sets', () => {
    expect(requesterIp(headers({ 'cf-connecting-ip': '198.51.100.7' })))
      .toBe('198.51.100.7');
  });

  it('IGNORES x-forwarded-for entirely, even when it is the only header', () => {
    // The hole this closes. x-forwarded-for is a list and its first hop is
    // whatever the client wrote, so keying a rate limit on it let an attacker
    // mint a fresh budget per request by varying one header.
    expect(requesterIp(headers({ 'x-forwarded-for': '203.0.113.9' }))).toBeNull();
  });

  it('is not fooled by a spoofed x-forwarded-for beside a real address', () => {
    // Cloudflare overwrites cf-connecting-ip with the address it accepted the
    // connection from, so a spoofed list alongside it must change nothing.
    expect(requesterIp(headers({
      'x-forwarded-for': '10.0.0.1, 10.0.0.2',
      'cf-connecting-ip': '198.51.100.7',
    }))).toBe('198.51.100.7');
  });

  it('reports NO address rather than inventing one', () => {
    // A local `supabase functions serve`, or a platform change. The caller
    // then has to fall back to a bucket the CALLER cannot choose — never to a
    // request-supplied value, which would be the same hole renamed.
    expect(requesterIp(headers({}))).toBeNull();
    expect(requesterIp(headers({ 'cf-connecting-ip': '   ' }))).toBeNull();
    // And an absurdly long value is refused rather than used as a key.
    expect(requesterIp(headers({ 'cf-connecting-ip': 'a'.repeat(65) }))).toBeNull();
  });

  it('is the ONLY thing the router consults', () => {
    expect(INDEX).toContain('requesterIp((name) => request.headers.get(name))');
    expect(INDEX).not.toContain('x-forwarded-for');
  });
});

describe('the abuse bucket survives a successful switch', () => {
  it('refunds the device and actor budgets, never the abuse one', () => {
    // The abuse key counts REQUESTS, not failures: its purpose is to bound how
    // much bcrypt one network source can spend. Clearing it on success would
    // hand anybody holding a single valid PIN an unlimited budget for guessing
    // everybody else's — one success, reset, repeat.
    expect(SOURCE).toContain('await clearAttempts([deviceKey, actorKey])');
    expect(SOURCE).not.toContain('clearAttempts(attemptKeys)');
  });

  it('falls back to a SERVER-controlled bucket when no address is available', () => {
    // Never to a caller-supplied value. The shop id and the device id both
    // arrive in the request body, so keying the fallback on either would let
    // an attacker opt out of being counted by varying one field.
    expect(SOURCE).toMatch(/clientIp \? `a23-abuse:\$\{clientIp\}` : GLOBAL_ABUSE_KEY/);
    expect(SOURCE).toContain('const GLOBAL_ABUSE_KEY = "a23-abuse:global"');
  });
});
