// W4-06 — the audit log, executed, with the redaction as the centre of it.
//
// The planted test is the one that matters: the service-role key, the session
// secret, a password hash, a bKash credential and a customer phone number are
// each fed in, and none may appear in the output. Allowlisting the keys is what
// makes that structural rather than a habit — a new field has to be let in
// deliberately — and the value scrub catches a secret smuggled through an
// allowed free-text key.

import { describe, expect, test } from 'vitest';
import {
  ALLOWED_META_KEYS,
  createRingBufferAuditSink,
  recordAdminAction,
  type AdminAuditEntry,
} from './adminAudit';

const NOW = Date.UTC(2026, 9, 22, 6, 0, 0);

function capture(): { sink: { write(entry: AdminAuditEntry): void }; entries: AdminAuditEntry[] } {
  const entries: AdminAuditEntry[] = [];
  return { sink: { write: (entry) => entries.push(entry) }, entries };
}

describe('what an entry records', () => {
  test('actor, role, action, target, outcome and an ISO-8601 timestamp', () => {
    const { sink, entries } = capture();

    recordAdminAction({
      actor: 'founder',
      role: 'billing',
      action: 'subscription.extend',
      target: 'account-7',
      outcome: 'success',
      now: NOW,
    }, [sink]);

    expect(entries).toEqual([{
      at: '2026-10-22T06:00:00.000Z',
      actor: 'founder',
      role: 'billing',
      action: 'subscription.extend',
      target: 'account-7',
      outcome: 'success',
      meta: {},
    }]);
  });

  test('an absent role and target are null, never undefined', () => {
    const { sink, entries } = capture();
    recordAdminAction({ actor: 'unknown', action: 'login', outcome: 'failure', now: NOW }, [sink]);
    expect(entries[0]).toMatchObject({ role: null, target: null });
  });

  test('a failing sink neither swallows the record nor breaks the caller', () => {
    const { sink, entries } = capture();
    const broken = { write: () => { throw new Error('sink down'); } };

    expect(() => recordAdminAction(
      { actor: 'founder', action: 'login', outcome: 'success', now: NOW },
      [broken, sink],
    )).not.toThrow();
    expect(entries).toHaveLength(1);
  });
});

describe('redaction is by allowlist', () => {
  test.each([
    ['the service-role key', 'serviceRoleKey'],
    ['the session secret', 'ADMIN_SESSION_SECRET'],
    ['a password hash', 'hash'],
    ['a salt', 'salt'],
    ['a bKash credential', 'bkashAppSecret'],
    ['an authorization header', 'authorization'],
    ['a customer phone', 'phone'],
    ['a password', 'password'],
  ])('drops %s outright', (_label, key) => {
    const { sink, entries } = capture();
    const secret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super-secret-value.signature';

    recordAdminAction(
      { actor: 'founder', action: 'test', outcome: 'success', now: NOW, meta: { [key]: secret } },
      [sink],
    );

    expect(Object.keys(entries[0]?.meta ?? {})).toEqual([]);
    expect(JSON.stringify(entries[0])).not.toContain('super-secret-value');
  });

  test('a phone number smuggled through an ALLOWED free-text key is scrubbed', () => {
    const { sink, entries } = capture();

    recordAdminAction(
      { actor: 'founder', action: 'test', outcome: 'success', now: NOW, meta: { reason: 'called 01712345678 to confirm' } },
      [sink],
    );

    expect(entries[0]?.meta.reason).toBe('called [redacted] to confirm');
  });

  test('a long token smuggled through an allowed key is scrubbed', () => {
    const { sink, entries } = capture();
    const key = 'sbp_' + 'a'.repeat(60);

    recordAdminAction(
      { actor: 'founder', action: 'test', outcome: 'success', now: NOW, meta: { reason: key } },
      [sink],
    );

    expect(entries[0]?.meta.reason).toBe('[redacted]');
  });

  test('an actor or target carrying a phone number is scrubbed too', () => {
    const { sink, entries } = capture();
    recordAdminAction(
      { actor: '01712345678', action: 'login', outcome: 'failure', target: 'shop 01812345678', now: NOW },
      [sink],
    );
    expect(entries[0]?.actor).toBe('[redacted]');
    expect(entries[0]?.target).toBe('shop [redacted]');
  });

  test('allowed scalar keys survive, and nested shapes do not', () => {
    const { sink, entries } = capture();

    recordAdminAction({
      actor: 'founder',
      action: 'test',
      outcome: 'denied',
      now: NOW,
      meta: {
        permission: 'subscriptions.write',
        attempt: 3,
        epoch: 0,
        claimedRole: 'super_admin',
        shopId: 'shop-1',
        nested: { leaked: 'value' },
        list: ['a'],
        fn: () => 'x',
        empty: null,
      },
    }, [sink]);

    expect(entries[0]?.meta).toEqual({
      permission: 'subscriptions.write',
      attempt: 3,
      epoch: 0,
      claimedRole: 'super_admin',
      shopId: 'shop-1',
    });
  });

  test('an inherited meta key cannot slip through the allowlist', () => {
    const { sink, entries } = capture();
    const meta = Object.create({ permission: 'subscriptions.write' }) as Record<string, unknown>;
    meta.shopId = 'shop-1';

    recordAdminAction({ actor: 'founder', action: 'test', outcome: 'denied', now: NOW, meta }, [sink]);

    expect(entries[0]?.meta).toEqual({ shopId: 'shop-1' });
  });

  test('the allowlist holds no key that names a credential', () => {
    const forbidden = /secret|password|hash|salt|key|token|phone|authorization/i;
    expect(ALLOWED_META_KEYS.filter((key) => forbidden.test(key))).toEqual([]);
  });
});

describe('the in-process ring buffer', () => {
  test('keeps the most recent entries, newest first, and drops the oldest', () => {
    const ring = createRingBufferAuditSink(3);

    for (const index of [1, 2, 3, 4]) {
      recordAdminAction({ actor: 'founder', action: 'a' + index, outcome: 'success', now: NOW }, [ring]);
    }

    expect(ring.entries().map((entry) => entry.action)).toEqual(['a4', 'a3', 'a2']);
  });

  test('clear empties it', () => {
    const ring = createRingBufferAuditSink(2);
    recordAdminAction({ actor: 'founder', action: 'a', outcome: 'success', now: NOW }, [ring]);
    ring.clear();
    expect(ring.entries()).toEqual([]);
  });
});
