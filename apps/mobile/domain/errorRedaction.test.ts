// The privacy contract, tested adversarially.
//
// Every case here is a way a real secret could reach a crash report if the
// module scrubbed instead of allowlisting. The PIN, OTP, token, phone, customer
// name and paisa amount below are synthetic, and the point of each assertion is
// that NONE of them appears anywhere in the output — not in a field, not in a
// key, not in the serialised form.

import { describe, expect, it } from 'vitest';
import {
  classifyErrorKind,
  CONTEXT_KEYS,
  isMonitoringEvent,
  redactForMonitoring,
  type RedactionInput,
} from './errorRedaction';

// Synthetic secrets. If any of these shows up in a report, the test fails.
const PIN = '4821';
const OTP = '908172';
// Built the way environment-binding.test.ts and eas-archive.test.ts already
// build theirs: `e30` is base64url of `{}`, so this is token-SHAPED without
// resembling a real credential. The repository is public and push protection
// flags credential-shaped literals even in fixtures that exist to be rejected
// (see the W5-15 assessment) — and a scanner-tripping test string would be a
// self-inflicted version of the very problem this module prevents.
const TOKEN = `e30.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.fabricated`;
const PHONE = '+8801712345678';
const CUSTOMER = 'Rahima Begum';
const PAISA = '129900';
const SECRETS = [PIN, OTP, TOKEN, PHONE, CUSTOMER, PAISA];

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function expectNoSecrets(value: unknown): void {
  const text = serialize(value);
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
  }
}

describe('redactForMonitoring — adversarial inputs', () => {
  it('drops a message, a cause chain and a stack entirely', () => {
    const deepest = new Error(`otp ${OTP}`);
    const middle = new Error(`token ${TOKEN}`, { cause: deepest });
    const top = new Error(`customer ${CUSTOMER} paid ${PAISA}`, { cause: middle });

    const report = redactForMonitoring({ event: 'sync.cycle.failed', error: top });

    expect(report).not.toBeNull();
    expectNoSecrets(report);
    // Stated positively too: the fields simply do not exist on the DTO.
    expect(report).not.toHaveProperty('message');
    expect(report).not.toHaveProperty('cause');
    expect(report).not.toHaveProperty('stack');
    expect(Object.keys(report!).sort()).toEqual([
      'attempt', 'contextKeysPresent', 'errorKind', 'event', 'route', 'syncPhase',
    ]);
  });

  it('collapses a caller-assigned error name to unknown', () => {
    // `name` is writable, so this is the obvious way to smuggle a PIN out.
    const error = new Error('boom');
    error.name = PIN;

    const report = redactForMonitoring({ event: 'db.init.failed', error });

    expect(report!.errorKind).toBe('unknown');
    expectNoSecrets(report);
  });

  it('keeps a recognised error name, which is the only reason the field exists', () => {
    const error = new Error('the local database is encrypted');
    error.name = 'DatabaseKeyUnrecoverableError';
    expect(redactForMonitoring({ event: 'db.key.unrecoverable', error })!.errorKind)
      .toBe('DatabaseKeyUnrecoverableError');
  });

  it('refuses a route that is a live pathname rather than an enum member', () => {
    const report = redactForMonitoring({
      event: 'sync.cycle.failed',
      route: `/credit/customer?phone=${PHONE}&name=${CUSTOMER}`,
    });
    expect(report!.route).toBe('unknown');
    expectNoSecrets(report);
  });

  it('refuses a syncPhase it does not know', () => {
    expect(redactForMonitoring({ event: 'sync.cycle.failed', syncPhase: TOKEN })!.syncPhase)
      .toBe('unknown');
  });

  it('ships context KEYS and never context VALUES', () => {
    const report = redactForMonitoring({
      event: 'sync.conflict_detector.failed',
      context: {
        shopId: 'shop-0001',
        actorUserId: 'user-0001',
        tableName: 'customers',
        // Unknown keys are dropped, not carried:
        pin: PIN,
        otp: OTP,
        customerName: CUSTOMER,
      },
    });

    expect(report!.contextKeysPresent).toEqual(['shopId', 'actorUserId', 'tableName']);
    expectNoSecrets(report);
  });

  it('reads no context value, so a throwing getter cannot break the reporter', () => {
    const hostile = {
      get shopId(): string {
        throw new Error(`exploded with ${PIN}`);
      },
    };
    const report = redactForMonitoring({
      event: 'db.init.failed',
      context: hostile as unknown as Record<string, unknown>,
    });
    // Object.keys sees the accessor without invoking it.
    expect(report!.contextKeysPresent).toEqual(['shopId']);
    expectNoSecrets(report);
  });

  it('orders and deduplicates context keys so one failure always reports identically', () => {
    const first = redactForMonitoring({
      event: 'db.init.failed',
      context: { tableName: 'x', shopId: 'y' },
    });
    const second = redactForMonitoring({
      event: 'db.init.failed',
      context: { shopId: 'y', tableName: 'x' },
    });
    expect(first).toEqual(second);
  });

  it('buckets attempt so the field cannot carry a value at all', () => {
    // The point of a bucket rather than a clamp: a paisa amount, a row count or
    // a timestamp put through this channel comes out as a bucket edge, not as
    // itself. An earlier version clamped to 1,000,000 and happily preserved
    // 129900 — a money value in a crash report.
    const cases: [unknown, number][] = [
      [undefined, 0], [-5, 0], [0, 0], [1, 1], [2.9, 2], [3, 2], [7, 5], [99, 10],
      // NaN and Infinity are not attempt counts; both fail safe to 0.
      [Number.NaN, 0], [Number.POSITIVE_INFINITY, 0],
      [Number(PAISA), 10], [1e12, 10],
    ];
    for (const [input, expected] of cases) {
      expect(
        redactForMonitoring({ event: 'db.init.failed', attempt: input })!.attempt,
        `attempt ${String(input)}`,
      ).toBe(expected);
    }
    // Stated directly: the paisa amount is nowhere in the output.
    expectNoSecrets(redactForMonitoring({ event: 'db.init.failed', attempt: Number(PAISA) }));
  });

  it('drops an unrecognised event rather than coercing it', () => {
    const report = redactForMonitoring({
      event: 'payment.secret.leak' as RedactionInput['event'],
    });
    expect(report).toBeNull();
  });

  it('survives a non-object throw', () => {
    for (const thrown of [PIN, 42, null, undefined, Symbol('x')]) {
      expect(classifyErrorKind(thrown)).toBe('unknown');
    }
  });

  it('every CONTEXT_KEYS entry is accepted, so the list is not decorative', () => {
    const context = Object.fromEntries(CONTEXT_KEYS.map((key) => [key, 'value']));
    const report = redactForMonitoring({ event: 'db.init.failed', context });
    expect(report!.contextKeysPresent).toEqual([...CONTEXT_KEYS]);
  });

  it('isMonitoringEvent gates the slug set', () => {
    expect(isMonitoringEvent('sync.halted')).toBe(true);
    expect(isMonitoringEvent('sync.halted.extra')).toBe(false);
    expect(isMonitoringEvent(PIN)).toBe(false);
  });
});
