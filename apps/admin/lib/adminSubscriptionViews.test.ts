// Batch 3 §8.3 — the next billing date, the renewal history, and the two
// things this page must NOT do.
//
// The cases that matter most here are the negative ones. "Next billing" on a
// canceled row and "renewal" from an unverified order are both figures that
// would look completely plausible on screen and be wrong, and neither is the
// kind of error a founder can catch by reading the page.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { asPaisa } from '@muthoy/types';
import {
  LIFECYCLE_OVERRIDE_UNAVAILABLE,
  nextBillingBasisLabel,
  nextBillingDate,
  renewalHistory,
  subscriptionDetailRows,
  SUBSCRIPTION_STATUS_FILTERS,
  upcomingExpirations,
} from './adminSubscriptionViews';
import type { EntitlementRow, PaymentOrderRow, SubscriptionRow } from './adminViews';

const NOW = Date.parse('2026-10-26T06:00:00.000Z');
const DAY_MS = 86_400_000;

function subscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'bs000000-0000-4000-8000-000000000001',
    billingAccountId: 'ba000000-0000-4000-8000-000000000001',
    tier: 'pro',
    billingCycle: 'monthly',
    status: 'active',
    startsAt: '2026-09-01T00:00:00.000Z',
    paidThrough: '2026-11-01T00:00:00.000Z',
    graceEndsAt: null,
    canceledAt: null,
    provider: 'sslcommerz',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function entitlement(overrides: Partial<EntitlementRow> = {}): EntitlementRow {
  return {
    billingAccountId: 'ba000000-0000-4000-8000-000000000001',
    tier: 'pro',
    status: 'active',
    trialEndsAt: null,
    paidThrough: '2026-11-01T00:00:00.000Z',
    graceEndsAt: null,
    verifiedAt: '2026-10-26T00:00:00.000Z',
    ...overrides,
  };
}

function order(overrides: Partial<PaymentOrderRow> = {}): PaymentOrderRow {
  return {
    id: 'po000000-0000-4000-8000-000000000001',
    billingAccountId: 'ba000000-0000-4000-8000-000000000001',
    tier: 'pro',
    billingCycle: 'monthly',
    amountPaisa: asPaisa(50_000),
    status: 'verified',
    provider: 'sslcommerz',
    failureCode: null,
    expiresAt: '2026-10-01T00:00:00.000Z',
    verifiedAt: '2026-09-30T00:00:00.000Z',
    createdAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('the next billing date', () => {
  test('an active paid cycle bills at paid_through', () => {
    const next = nextBillingDate(subscription({ status: 'active' }), entitlement());

    expect(next).toEqual({ on: '2026-11-01T00:00:00.000Z', basis: 'paid_through' });
  });

  test('a trial ends at the entitlement’s trial_ends_at', () => {
    // `billing_subscriptions` has no trial column, so the snapshot is the only
    // record that knows when a trial ends.
    const next = nextBillingDate(
      subscription({ status: 'trialing' }),
      entitlement({ status: 'trialing', trialEndsAt: '2026-10-30T00:00:00.000Z' }),
    );

    expect(next).toEqual({ on: '2026-10-30T00:00:00.000Z', basis: 'trial_ends_at' });
  });

  test('a trialing row with NO snapshot has no date, not a paid_through fallback', () => {
    // Falling back would print the paid cycle's end for a row that has never
    // been paid for.
    expect(nextBillingDate(subscription({ status: 'trialing' }), null)).toEqual({
      on: null,
      basis: 'none',
    });
  });

  test('a grace period bills at grace_ends_at, not paid_through', () => {
    const next = nextBillingDate(
      subscription({
        status: 'grace',
        paidThrough: '2026-10-01T00:00:00.000Z',
        graceEndsAt: '2026-10-29T00:00:00.000Z',
      }),
      entitlement({ status: 'grace' }),
    );

    expect(next).toEqual({ on: '2026-10-29T00:00:00.000Z', basis: 'grace_ends_at' });
  });

  test('past_due with no recorded grace end falls back to paid_through, the only date there is', () => {
    const next = nextBillingDate(subscription({ status: 'past_due' }), entitlement());

    expect(next).toEqual({ on: '2026-11-01T00:00:00.000Z', basis: 'paid_through' });
  });

  test.each(['canceled', 'expired'])('a %s row has NO next billing date', (status) => {
    // `paid_through` on a canceled row is when access ran out, in the past.
    // Printing it under "next billing" would read as an upcoming charge.
    expect(nextBillingDate(subscription({ status }), entitlement())).toEqual({
      on: null,
      basis: 'none',
    });
  });

  test('an empty paid_through is absent, not an empty date', () => {
    expect(nextBillingDate(subscription({ paidThrough: '' }), entitlement())).toEqual({
      on: null,
      basis: 'none',
    });
  });

  test('every basis has a sentence, including none', () => {
    for (const basis of ['paid_through', 'trial_ends_at', 'grace_ends_at', 'none'] as const) {
      expect(nextBillingBasisLabel(basis).length, basis).toBeGreaterThan(5);
    }
  });
});

describe('the renewal history', () => {
  test('only verified orders count as a renewal', () => {
    const history = renewalHistory([
      order({ id: 'a', status: 'verified', verifiedAt: '2026-09-30T00:00:00.000Z' }),
      order({ id: 'b', status: 'pending', verifiedAt: null }),
      order({ id: 'c', status: 'failed', verifiedAt: null }),
      order({ id: 'd', status: 'expired', verifiedAt: null }),
      order({ id: 'e', status: 'created', verifiedAt: null }),
    ]);

    const entries = history.byAccount.get('ba000000-0000-4000-8000-000000000001') ?? [];
    expect(entries.map((entry) => entry.orderId)).toEqual(['a']);
  });

  test('a verified order with NO timestamp is counted apart, not dropped', () => {
    // Dropping it silently would make this page and the billing-exception list
    // disagree about how many verified orders exist.
    const history = renewalHistory([order({ status: 'verified', verifiedAt: null })]);

    expect(history.undatedVerified).toBe(1);
    expect(history.byAccount.size).toBe(0);
  });

  test('renewals are newest first, per account', () => {
    const history = renewalHistory([
      order({ id: 'old', verifiedAt: '2026-07-01T00:00:00.000Z' }),
      order({ id: 'new', verifiedAt: '2026-09-01T00:00:00.000Z' }),
      order({ id: 'mid', verifiedAt: '2026-08-01T00:00:00.000Z' }),
    ]);

    const entries = history.byAccount.get('ba000000-0000-4000-8000-000000000001') ?? [];
    expect(entries.map((entry) => entry.orderId)).toEqual(['new', 'mid', 'old']);
  });

  test('two accounts do not share a history', () => {
    const history = renewalHistory([
      order({ id: 'a', billingAccountId: 'ba-1' }),
      order({ id: 'b', billingAccountId: 'ba-2' }),
    ]);

    expect(history.byAccount.get('ba-1')?.map((entry) => entry.orderId)).toEqual(['a']);
    expect(history.byAccount.get('ba-2')?.map((entry) => entry.orderId)).toEqual(['b']);
  });

  test('an empty order list yields no history and no exceptions', () => {
    const history = renewalHistory([]);

    expect(history.byAccount.size).toBe(0);
    expect(history.undatedVerified).toBe(0);
  });
});

describe('the page’s rows', () => {
  const offerings = [
    { tier: 'pro', billingCycle: 'monthly', amountPaisa: asPaisa(50_000) },
    { tier: 'ultra', billingCycle: 'yearly', amountPaisa: asPaisa(900_000) },
  ];

  function rowsFor(subscriptions: readonly SubscriptionRow[], orders: readonly PaymentOrderRow[]) {
    return subscriptionDetailRows({
      subscriptions,
      entitlements: [entitlement()],
      offerings,
      accountLabels: new Map([['ba000000-0000-4000-8000-000000000001', 'Banani Pharmacy']]),
      renewals: renewalHistory(orders),
    });
  }

  test('the billed amount is the offering price for that tier and cycle', () => {
    const rows = rowsFor([subscription({ tier: 'pro', billingCycle: 'monthly' })], []);

    expect(rows[0]?.billedAmountPaisa).toBe(50_000);
  });

  test('a tier and cycle matching NO offering is billed zero, not undefined', () => {
    const rows = rowsFor([subscription({ tier: 'pro', billingCycle: 'weekly' })], []);

    expect(rows[0]?.billedAmountPaisa).toBe(0);
  });

  test('an account with no label renders the em dash, never undefined', () => {
    const rows = subscriptionDetailRows({
      subscriptions: [subscription({ billingAccountId: 'ba-unknown' })],
      entitlements: [],
      offerings,
      accountLabels: new Map(),
      renewals: renewalHistory([]),
    });

    expect(rows[0]?.accountLabel).toBe('—');
    expect(rows[0]?.entitlementStatus).toBe('unknown');
  });

  test('rows are ordered by next billing date, soonest first, undated last', () => {
    const rows = rowsFor(
      [
        subscription({ id: 'later', paidThrough: '2026-12-01T00:00:00.000Z' }),
        subscription({ id: 'canceled', status: 'canceled' }),
        subscription({ id: 'sooner', paidThrough: '2026-10-28T00:00:00.000Z' }),
      ],
      [],
    );

    expect(rows.map((row) => row.id)).toEqual(['sooner', 'later', 'canceled']);
  });

  test('the renewal count and the latest renewal come from the verified orders', () => {
    const rows = rowsFor(
      [subscription()],
      [
        order({ id: 'a', verifiedAt: '2026-08-01T00:00:00.000Z' }),
        order({ id: 'b', verifiedAt: '2026-09-01T00:00:00.000Z' }),
        order({ id: 'c', status: 'failed', verifiedAt: null }),
      ],
    );

    expect(rows[0]?.renewalCount).toBe(2);
    expect(rows[0]?.latestRenewal?.orderId).toBe('b');
  });

  test('upcoming expirations use the SAME next billing date the column shows', () => {
    const rows = rowsFor(
      [
        subscription({ id: 'soon', paidThrough: new Date(NOW + 2 * DAY_MS).toISOString() }),
        subscription({ id: 'far', paidThrough: new Date(NOW + 60 * DAY_MS).toISOString() }),
        subscription({ id: 'past', paidThrough: new Date(NOW - DAY_MS).toISOString() }),
        subscription({ id: 'gone', status: 'expired' }),
      ],
      [],
    );

    expect(upcomingExpirations(rows, NOW, 7).map((row) => row.id)).toEqual(['soon']);
  });
});

describe('what this page refuses to offer', () => {
  test('the lifecycle-override notice names the gate and says nothing is built', () => {
    expect(LIFECYCLE_OVERRIDE_UNAVAILABLE).toContain('E10');
    expect(LIFECYCLE_OVERRIDE_UNAVAILABLE).toContain('not available');
    expect(LIFECYCLE_OVERRIDE_UNAVAILABLE).toContain('superseded and');
    // It must say what does NOT happen, not merely that a control is disabled.
    expect(LIFECYCLE_OVERRIDE_UNAVAILABLE).toMatch(/No control on this page writes/);
  });

  test('this module exposes no write of any kind', () => {
    // §8.3's rule is that nothing creates or extends a paid entitlement
    // without verified payment evidence. This module structurally cannot: it
    // has no client, no insert, no update and no RPC. Asserted against the
    // source, so adding one is a visible failure rather than a review miss.
    const source = readFileSync(join(import.meta.dirname, 'adminSubscriptionViews.ts'), 'utf8');

    for (const forbidden of [
      'getSupabaseAdmin',
      '.insert(',
      '.update(',
      '.delete(',
      '.rpc(',
      'b4_refresh_entitlement_snapshot',
    ]) {
      expect(source.includes(forbidden), forbidden + ' must not appear').toBe(false);
    }
  });

  test('the six statuses are the six, in lifecycle order', () => {
    expect([...SUBSCRIPTION_STATUS_FILTERS]).toEqual([
      'trialing',
      'active',
      'past_due',
      'grace',
      'canceled',
      'expired',
    ]);
  });
});
