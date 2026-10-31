// Batch 3 §5 — the money definitions, executed against a fixture carrying one
// row of EVERY status.
//
// The two cases revision 2 of the plan got wrong are the first two tests, and
// they are why this file exists rather than a spot check:
//
//   - an ACTIVE row whose paid_through has passed but whose grace_ends_at has
//     not is still entitled. Requiring paid_through alone excluded it;
//   - a CANCELED row still inside paid_through is still entitled, because the
//     period was paid for.
//
// Both are transcribed from b4_user_has_premium
// (20260831000000_b4_commercial_platform.sql:261-272), which is the canonical
// definition. The mutation checks fail if either branch is dropped.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { asPaisa } from '@muthoy/types';
import {
  ADMIN_METRICS,
  accountsEverPaid,
  collectedPaymentsByMonth,
  collectedSubscriptionPaymentsPaisa,
  currentSubscriptionPerAccount,
  entitlementCounts,
  expiredWithoutCancellation,
  isMrrEligible,
  metricById,
  monthlyContributionPaisa,
  monthlyRecurringRevenue,
  recordedCancellations,
  requireMetric,
  trialToPaidConversion,
  isActiveSubscriptionNow,
} from './adminMetrics';
import type {
  AccountRow,
  EntitlementVerdictRow,
  OfferingRow,
  PaymentOrderRow,
  SubscriptionRow,
} from './adminViews';

const NOW = Date.parse('2026-10-25T06:00:00.000Z');
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-12-01T00:00:00.000Z';

function subscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-1',
    billingAccountId: 'account-1',
    tier: 'pro',
    billingCycle: 'monthly',
    status: 'active',
    startsAt: PAST,
    paidThrough: FUTURE,
    graceEndsAt: null,
    canceledAt: null,
    provider: 'sslcommerz',
    createdAt: PAST,
    ...overrides,
  };
}

function order(overrides: Partial<PaymentOrderRow> = {}): PaymentOrderRow {
  return {
    id: 'order-1',
    billingAccountId: 'account-1',
    tier: 'pro',
    billingCycle: 'monthly',
    amountPaisa: asPaisa(50_000),
    status: 'verified',
    provider: 'sslcommerz',
    failureCode: null,
    expiresAt: PAST,
    verifiedAt: PAST,
    createdAt: PAST,
    ...overrides,
  };
}

function account(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'account-1',
    principalOwnerUserId: 'user-1',
    primaryShopId: 'shop-1',
    launchTrialGrantedAt: PAST,
    createdAt: PAST,
    ...overrides,
  };
}

const OFFERINGS: readonly OfferingRow[] = [
  { tier: 'pro', billingCycle: 'monthly', amountPaisa: asPaisa(50_000), isActive: true },
  { tier: 'pro', billingCycle: 'annual', amountPaisa: asPaisa(500_000), isActive: true },
  { tier: 'ultra', billingCycle: 'monthly', amountPaisa: asPaisa(120_000), isActive: true },
  // A RETIRED price. is_active is ignored on purpose: a grandfathered account
  // still pays this, and skipping it would under-report the run rate.
  { tier: 'ultra', billingCycle: 'annual', amountPaisa: asPaisa(1_000_000), isActive: false },
];

// THE STATUS/DATE MATRIX IS NO LONGER TESTED HERE, because it is no longer
// IMPLEMENTED here. Two describes used to live at this point: "the two cases
// revision 2 got wrong" and "the canonical predicate, one row of every status",
// thirteen cases plus the null, unparseable and strict-`>` boundary checks.
// They tested a TypeScript transcription of `b4_user_has_premium`.
//
// The transcription is gone (see the module header), so those tests would now
// have nothing to exercise. The coverage did not go with it: it MOVED, to
// `backend/supabase/pgtest/e11-entitlement-verification.pgtest.ts`, where the
// same matrix runs against `b4_effective_tier` itself on real PostgreSQL —
// every status, both date branches, the free-tier case and the strict-`>`
// boundary, on an account whose claim is backed so the matrix is what is under
// test. That is a stronger test than this file could ever have been: it
// exercises the function the server actually uses, rather than a copy of it
// that was already two cases adrift once before.

describe('entitlement counts follow the SERVER, not the snapshot', () => {
  const verdict = (overrides: Partial<EntitlementVerdictRow> = {}): EntitlementVerdictRow => ({
    billingAccountId: 'account-1',
    status: 'active',
    effectiveTier: 'pro',
    ...overrides,
  });

  test('a live trial counts as trialing and pays nothing', () => {
    // b4_effective_tier answers 'ultra' for a live trial whatever the tier.
    expect(entitlementCounts([verdict({ status: 'trialing', effectiveTier: 'ultra' })]))
      .toEqual({ trialing: 1, currentlyPaid: 0, entitled: 1 });
  });

  test('a paid Ultra plan is NOT read as a trial, though the tier is the same', () => {
    // The whole reason `status` is carried alongside the tier.
    expect(entitlementCounts([verdict({ status: 'active', effectiveTier: 'ultra' })]))
      .toEqual({ trialing: 0, currentlyPaid: 1, entitled: 1 });
  });

  test.each([
    ['an expired trial the server already discounted', { status: 'trialing', effectiveTier: 'free' }],
    ['a lapsed paid plan', { status: 'active', effectiveTier: 'free' }],
    ['a free-tier account', { status: 'active', effectiveTier: 'free' }],
    ['an account the server found UNBACKED', { status: 'active', effectiveTier: 'free' }],
  ])('%s counts for nothing', (_label, overrides) => {
    expect(entitlementCounts([verdict(overrides)]))
      .toEqual({ trialing: 0, currentlyPaid: 0, entitled: 0 });
  });

  test('the two branches are disjoint, so entitled is their sum', () => {
    const counts = entitlementCounts([
      verdict({ billingAccountId: 'a1', status: 'trialing', effectiveTier: 'ultra' }),
      verdict({ billingAccountId: 'a2', status: 'active', effectiveTier: 'pro' }),
      verdict({ billingAccountId: 'a3', status: 'canceled', effectiveTier: 'pro' }),
      verdict({ billingAccountId: 'a4', status: 'expired', effectiveTier: 'free' }),
    ]);

    expect(counts).toEqual({ trialing: 1, currentlyPaid: 2, entitled: 3 });
    expect(counts.trialing + counts.currentlyPaid).toBe(counts.entitled);
  });

  test('no rows is no entitlement, not a crash', () => {
    expect(entitlementCounts([])).toEqual({ trialing: 0, currentlyPaid: 0, entitled: 0 });
  });

  test('the function takes no clock, so no date can change its answer', () => {
    // Not a style point. The defect this replaced was a SECOND reading of the
    // same dates; `entitlementCounts.length` is the arity, and a single
    // parameter is the guarantee that there is no instant to disagree about.
    expect(entitlementCounts.length).toBe(1);
  });

  test('MUTATION: counting a free verdict as entitled would differ', () => {
    // Non-vacuity for the four cases above: they would all read 1 under the
    // predicate this change deleted, which trusted the snapshot's own columns.
    const free = [verdict({ status: 'active', effectiveTier: 'free' })];

    expect(entitlementCounts(free).entitled).toBe(0);
    expect(free.filter((row) => row.effectiveTier !== 'nonsense')).toHaveLength(1);
  });
});

describe('MRR is forward-looking', () => {
  test('a canceled row counts as paid entitlement but NOT towards the run rate', () => {
    const canceled = { status: 'canceled', paidThrough: FUTURE };

    // The entitlement half is now the server's to answer: a canceled plan
    // keeps its tier until paid_through, so b4_effective_tier says 'pro'.
    expect(entitlementCounts([{
      billingAccountId: 'account-1', status: 'canceled', effectiveTier: 'pro',
    }]).currentlyPaid).toBe(1);
    expect(isMrrEligible(subscription(canceled), NOW)).toBe(false);
  });

  test('a trial contributes nothing', () => {
    expect(isMrrEligible(subscription({ tier: 'free', status: 'trialing' }), NOW)).toBe(false);
  });

  test('an active row in grace still counts — the money is expected to arrive', () => {
    expect(isMrrEligible(
      subscription({ status: 'active', paidThrough: PAST, graceEndsAt: FUTURE }),
      NOW,
    )).toBe(true);
    expect(isMrrEligible(
      subscription({ status: 'grace', paidThrough: PAST, graceEndsAt: FUTURE }),
      NOW,
    )).toBe(true);
  });

  test('a monthly plan contributes its whole amount', () => {
    expect(monthlyContributionPaisa({ tier: 'pro', billingCycle: 'monthly' }, OFFERINGS))
      .toBe(50_000);
  });

  test('an annual plan contributes floor(amount / 12), and the residue is NOT redistributed', () => {
    // 500000 / 12 = 41666.66…, so 41666, and the residue is dropped.
    expect(monthlyContributionPaisa({ tier: 'pro', billingCycle: 'annual' }, OFFERINGS))
      .toBe(41_666);
    expect(41_666 * 12).toBeLessThan(500_000);
  });

  test('a RETIRED offering still prices a grandfathered subscription', () => {
    expect(monthlyContributionPaisa({ tier: 'ultra', billingCycle: 'annual' }, OFFERINGS))
      .toBe(Math.floor(1_000_000 / 12));
  });

  test('no matching offering yields null, so the gap can be reported', () => {
    expect(monthlyContributionPaisa({ tier: 'enterprise', billingCycle: 'monthly' }, OFFERINGS))
      .toBeNull();
  });

  test('an account with TWO subscription rows is counted ONCE', () => {
    const rows = [
      subscription({ id: 'sub-old', startsAt: '2026-01-01T00:00:00.000Z' }),
      subscription({ id: 'sub-new', startsAt: '2026-09-01T00:00:00.000Z', tier: 'ultra' }),
    ];

    const current = currentSubscriptionPerAccount(rows);

    expect(current).toHaveLength(1);
    expect(current[0]?.id).toBe('sub-new');
    expect(monthlyRecurringRevenue({ subscriptions: rows, offerings: OFFERINGS, nowMs: NOW }))
      .toMatchObject({ countedSubscriptions: 1, totalPaisa: 120_000 });
  });

  test('the current row does not depend on the order the rows arrived in', () => {
    const older = subscription({ id: 'a', startsAt: '2026-01-01T00:00:00.000Z' });
    const newer = subscription({ id: 'b', startsAt: '2026-09-01T00:00:00.000Z' });

    expect(currentSubscriptionPerAccount([older, newer])[0]?.id).toBe('b');
    expect(currentSubscriptionPerAccount([newer, older])[0]?.id).toBe('b');
  });

  test('identical timestamps are broken deterministically by id', () => {
    const left = subscription({ id: 'aaa' });
    const right = subscription({ id: 'zzz' });

    expect(currentSubscriptionPerAccount([left, right])[0]?.id).toBe('zzz');
    expect(currentSubscriptionPerAccount([right, left])[0]?.id).toBe('zzz');
  });

  test('a qualifying subscription with no price is reported, not counted as zero', () => {
    // A PAID tier on a cycle no offering covers: it passes the predicate, so it
    // reaches the pricing step and the gap is visible rather than silently
    // contributing nothing.
    const breakdown = monthlyRecurringRevenue({
      subscriptions: [subscription({ tier: 'ultra', billingCycle: 'quarterly' })],
      offerings: OFFERINGS,
      nowMs: NOW,
    });

    expect(breakdown).toMatchObject({
      totalPaisa: 0,
      countedSubscriptions: 0,
      unpricedSubscriptions: 1,
    });
  });

  test('a tier outside pro/ultra never reaches the pricing step at all', () => {
    const breakdown = monthlyRecurringRevenue({
      subscriptions: [subscription({ tier: 'enterprise' })],
      offerings: OFFERINGS,
      nowMs: NOW,
    });

    expect(breakdown).toMatchObject({
      totalPaisa: 0,
      countedSubscriptions: 0,
      unpricedSubscriptions: 0,
    });
  });

  test('the tier split sums to the total', () => {
    const breakdown = monthlyRecurringRevenue({
      subscriptions: [
        subscription({ id: 's1', billingAccountId: 'a1', tier: 'pro' }),
        subscription({ id: 's2', billingAccountId: 'a2', tier: 'ultra' }),
        subscription({ id: 's3', billingAccountId: 'a3', tier: 'pro' }),
      ],
      offerings: OFFERINGS,
      nowMs: NOW,
    });

    const summed = Object.values(breakdown.byTierPaisa).reduce((total, value) => total + value, 0);
    expect(summed).toBe(breakdown.totalPaisa);
    expect(breakdown.byTierPaisa).toEqual({ pro: 100_000, ultra: 120_000 });
  });

  test('MUTATION: an MRR that counted trials would differ', () => {
    const rows = [
      subscription({ id: 's1', billingAccountId: 'a1' }),
      subscription({ id: 's2', billingAccountId: 'a2', tier: 'free', status: 'trialing' }),
    ];

    expect(monthlyRecurringRevenue({ subscriptions: rows, offerings: OFFERINGS, nowMs: NOW })
      .countedSubscriptions).toBe(1);
    expect(rows.filter((row) => isMrrEligible(row, NOW))).toHaveLength(1);
  });

  test('MUTATION: an MRR that counted canceled rows would differ', () => {
    const rows = [
      subscription({ id: 's1', billingAccountId: 'a1' }),
      subscription({ id: 's2', billingAccountId: 'a2', status: 'canceled', paidThrough: FUTURE }),
    ];

    expect(monthlyRecurringRevenue({ subscriptions: rows, offerings: OFFERINGS, nowMs: NOW })
      .countedSubscriptions).toBe(1);
    // And the canceled row IS still a paid entitlement, which is the
    // asymmetry. Asked the way the panel now asks it: the server still grants
    // a canceled plan its paid tier until paid_through, so it counts towards
    // *currently paid* while contributing nothing to the run rate.
    expect(entitlementCounts([{
      billingAccountId: 'a2', status: 'canceled', effectiveTier: 'pro',
    }])).toEqual({ trialing: 0, currentlyPaid: 1, entitled: 1 });
  });

  test('MUTATION: excluding an active-in-grace row would differ', () => {
    const inGrace = subscription({ status: 'active', paidThrough: PAST, graceEndsAt: FUTURE });

    expect(monthlyRecurringRevenue({
      subscriptions: [inGrace],
      offerings: OFFERINGS,
      nowMs: NOW,
    }).countedSubscriptions).toBe(1);
  });
});

describe('collected payments are cash, not a run rate', () => {
  test('only verified orders count', () => {
    expect(collectedSubscriptionPaymentsPaisa([
      order({ id: 'o1', status: 'verified' }),
      order({ id: 'o2', status: 'pending' }),
      order({ id: 'o3', status: 'failed' }),
      order({ id: 'o4', status: 'expired' }),
      order({ id: 'o5', status: 'created' }),
    ])).toBe(50_000);
  });

  test('bucketed by the month of verified_at, oldest first', () => {
    const buckets = collectedPaymentsByMonth([
      order({ id: 'o1', verifiedAt: '2026-09-15T00:00:00.000Z' }),
      order({ id: 'o2', verifiedAt: '2026-08-02T00:00:00.000Z' }),
      order({ id: 'o3', verifiedAt: '2026-09-28T00:00:00.000Z' }),
    ]);

    expect(buckets.map((bucket) => bucket.month)).toEqual(['2026-08', '2026-09']);
    expect(buckets[1]).toMatchObject({ totalPaisa: 100_000, orderCount: 2 });
  });

  test('a verified order with no verified_at is not bucketed into a guess', () => {
    expect(collectedPaymentsByMonth([order({ verifiedAt: null })])).toEqual([]);
  });
});

describe('the counts are named for what they measure', () => {
  test('accounts ever paid counts ACCOUNTS, not orders', () => {
    expect(accountsEverPaid([
      order({ id: 'o1', billingAccountId: 'a1' }),
      order({ id: 'o2', billingAccountId: 'a1' }),
      order({ id: 'o3', billingAccountId: 'a2' }),
      order({ id: 'o4', billingAccountId: 'a3', status: 'failed' }),
    ])).toBe(2);
  });

  test('the gap between ever-paid and currently-paid is itself information', () => {
    const counts = entitlementCounts([
      { billingAccountId: 'a1', status: 'active', effectiveTier: 'pro' },
      { billingAccountId: 'a2', status: 'expired', effectiveTier: 'free' },
      { billingAccountId: 'a3', status: 'trialing', effectiveTier: 'ultra' },
    ]);

    expect(counts).toEqual({ trialing: 1, currentlyPaid: 1, entitled: 2 });
    expect(accountsEverPaid([
      order({ id: 'o1', billingAccountId: 'a1' }),
      order({ id: 'o2', billingAccountId: 'a2' }),
    ])).toBe(2);
  });

  test('conversion is null, not zero, when nobody was granted a trial', () => {
    expect(trialToPaidConversion({ accounts: [], orders: [] }))
      .toEqual({ denominator: 0, numerator: 0, ratio: null, accountIds: [] });
  });

  test('conversion counts trialed accounts that later paid', () => {
    const result = trialToPaidConversion({
      accounts: [
        account({ id: 'a1' }),
        account({ id: 'a2' }),
        account({ id: 'a3', launchTrialGrantedAt: null }),
      ],
      orders: [order({ billingAccountId: 'a1' })],
    });

    // `accountIds` is the TRIALED accounts, which is what the k=5 floor on
    // the Analytics page counts -- a3 was never granted a trial, so it is
    // not a contributor to this figure.
    expect(result).toEqual({
      denominator: 2,
      numerator: 1,
      ratio: 0.5,
      accountIds: ['a1', 'a2'],
    });
  });

  test('an account that paid without a trial does not inflate the numerator', () => {
    const result = trialToPaidConversion({
      accounts: [account({ id: 'a1' }), account({ id: 'a2', launchTrialGrantedAt: null })],
      orders: [order({ billingAccountId: 'a2' })],
    });

    expect(result).toEqual({
      denominator: 1,
      numerator: 0,
      ratio: 0,
      accountIds: ['a1'],
    });
  });

  test('recorded cancellations are bounded by the period, and are NOT churn', () => {
    const rows = [
      subscription({ id: 's1', canceledAt: '2026-09-15T00:00:00.000Z' }),
      subscription({ id: 's2', canceledAt: '2026-05-01T00:00:00.000Z' }),
      subscription({ id: 's3', canceledAt: null }),
    ];

    expect(recordedCancellations(rows, {
      fromMs: Date.parse('2026-09-01T00:00:00.000Z'),
      toMs: Date.parse('2026-09-30T23:59:59.999Z'),
    })).toBe(1);
  });

  test('expired-without-cancellation is reported separately', () => {
    const rows = [
      subscription({ id: 's1', paidThrough: PAST, canceledAt: null }),
      subscription({ id: 's2', paidThrough: PAST, canceledAt: '2026-09-01T00:00:00.000Z' }),
      subscription({ id: 's3', paidThrough: FUTURE, canceledAt: null }),
    ];

    expect(expiredWithoutCancellation(rows, NOW)).toBe(1);
  });
});

describe('the metric manifest (§5.2)', () => {
  test('every id is unique', () => {
    const ids = ADMIN_METRICS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no pharmacy_sales label says revenue, MRR, ARR or profit', () => {
    const banned = /revenue|mrr|arr|profit/i;
    const offenders = ADMIN_METRICS
      .filter((entry) => entry.family === 'pharmacy_sales')
      .filter((entry) => banned.test(entry.label));

    expect(offenders.map((entry) => entry.id)).toEqual([]);
  });

  test('no subscription label says sales or net', () => {
    const banned = /\bsales\b|\bnet\b/i;
    const offenders = ADMIN_METRICS
      .filter((entry) => entry.family === 'subscription')
      .filter((entry) => banned.test(entry.label));

    expect(offenders.map((entry) => entry.id)).toEqual([]);
  });

  test('ARR and profit appear in NO label, of any family', () => {
    const offenders = ADMIN_METRICS.filter((entry) => /\barr\b|profit/i.test(entry.label));
    expect(offenders.map((entry) => entry.id)).toEqual([]);
  });

  test('every paisa metric belongs to a money family, and every other one does not', () => {
    for (const entry of ADMIN_METRICS) {
      if (entry.unit === 'paisa') {
        expect(['subscription', 'pharmacy_sales']).toContain(entry.family);
      } else {
        expect(entry.family).toBe('count');
      }
    }
  });

  test('every metric carries a definitionRef', () => {
    for (const entry of ADMIN_METRICS) {
      expect(entry.definitionRef.length).toBeGreaterThan(0);
    }
  });

  // §5.2's last clause, deferred until the document existed: "every
  // definitionRef resolves to a heading that exists in
  // docs/plans/admin-metric-definitions.md".
  //
  // A non-empty string was never the claim. The claim is that a figure cannot
  // be rendered with a definition nobody wrote down — so the reference has to
  // be checked against the document, not against itself.
  describe('every definitionRef resolves to a real heading', () => {
    const DOC = 'docs/plans/admin-metric-definitions.md';

    /** Every `##`/`###` heading in the document, exactly as written. */
    function headings(): string[] {
      const source = readFileSync(resolve(DOC), 'utf8');
      return [...source.matchAll(/^#{2,3} (.+)$/gm)].map((match) => match[1]!.trim());
    }

    test('the document exists and declares headings', () => {
      // Non-vacuity: a reader that returned nothing would make the assertions
      // below pass for the wrong reason, so the count is stated.
      expect(headings().length).toBeGreaterThan(5);
    });

    test('the six headings the manifest depends on are all present', () => {
      // Named explicitly, because these are the strings the manifest's
      // definitionRef values carry. Renaming one in the document without
      // updating the manifest is the drift this catches.
      expect(headings()).toEqual(
        expect.arrayContaining([
          'MRR',
          'Collected subscription payments',
          'Pharmacy sales (refund-net)',
          'Counts, named for what they measure',
          'Currently paid entitlements',
          'Recorded cancellations',
        ]),
      );
    });

    test('no metric points at a heading that is not there', () => {
      const available = new Set(headings());
      const unresolved = ADMIN_METRICS.filter((entry) => !available.has(entry.definitionRef)).map(
        (entry) => entry.id + ' -> ' + entry.definitionRef,
      );

      expect(unresolved).toEqual([]);
    });

    test('MUTATION: an invented definitionRef does not resolve', () => {
      // Proves the check compares against the document rather than accepting
      // any non-empty string.
      const available = new Set(headings());

      expect(available.has('Total revenue, obviously')).toBe(false);
      expect(available.has('MRR')).toBe(true);
    });
  });

  test('a manifest entry cannot be mutated at runtime', () => {
    const [first] = ADMIN_METRICS;
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { label: string }).label = 'Total revenue';
    }).toThrow();
  });

  test('requireMetric throws on an undeclared id rather than rendering a blank caption', () => {
    expect(requireMetric('mrr').label).toBe('Monthly recurring run rate');
    expect(() => requireMetric('total_revenue')).toThrow(/No metric is declared/);
    expect(metricById('total_revenue')).toBeUndefined();
  });

  test('both money families have at least one paisa metric, so the split is real', () => {
    const paisaFamilies = new Set(
      ADMIN_METRICS.filter((entry) => entry.unit === 'paisa').map((entry) => entry.family),
    );
    expect([...paisaFamilies].sort()).toEqual(['pharmacy_sales', 'subscription']);
  });
});

describe('§5.1c active subscriptions, across statuses and expiry (Gate 5 finding 11)', () => {
  // THE DEFECT. The Dashboard counted `status === 'active'` literally, so a row
  // left at `active` with `paid_through` in the past was reported as an active
  // customer indefinitely. Numeric assertions, not shape assertions.
  const NOW = Date.parse('2026-10-27T06:00:00.000Z');
  const DAY = 86_400_000;
  const future = new Date(NOW + 30 * DAY).toISOString();
  const past = new Date(NOW - 30 * DAY).toISOString();

  function sub(over: Partial<SubscriptionRow>): SubscriptionRow {
    return {
      id: 'bs-' + (over.id ?? '1'),
      billingAccountId: 'ba-1',
      tier: 'pro',
      billingCycle: 'monthly',
      status: 'active',
      startsAt: past,
      paidThrough: future,
      graceEndsAt: null,
      canceledAt: null,
      provider: 'sslcommerz',
      createdAt: past,
      ...over,
    };
  }

  test('an active row inside its paid period counts', () => {
    expect(isActiveSubscriptionNow(sub({ paidThrough: future }), NOW)).toBe(true);
  });

  test('an EXPIRED active row does NOT count — the defect', () => {
    // This is the case that was wrong: status still `active`, period long gone.
    expect(isActiveSubscriptionNow(sub({ paidThrough: past, graceEndsAt: null }), NOW)).toBe(false);
  });

  test('an active row inside its GRACE period counts, even past paid_through', () => {
    // The canonical predicate allows either period; requiring paid_through
    // alone was one of the two errors an earlier draft of the plan made.
    expect(
      isActiveSubscriptionNow(sub({ paidThrough: past, graceEndsAt: future }), NOW),
    ).toBe(true);
  });

  test.each(['trialing', 'past_due', 'grace', 'canceled', 'expired'])(
    'a %s row is not an ACTIVE subscription, whatever its dates',
    (status) => {
      expect(isActiveSubscriptionNow(sub({ status, paidThrough: future }), NOW)).toBe(false);
    },
  );

  test('a free-tier active row DOES count, unlike MRR eligibility', () => {
    // The two predicates are different on purpose: a run rate needs a price,
    // an active-subscription count does not.
    const free = sub({ tier: 'free', paidThrough: future });

    expect(isActiveSubscriptionNow(free, NOW)).toBe(true);
    expect(isMrrEligible(free, NOW)).toBe(false);
  });

  test('the numeric count over a mixed population', () => {
    const rows = [
      sub({ id: 'a', paidThrough: future }), // counts
      sub({ id: 'b', paidThrough: past, graceEndsAt: future }), // counts
      sub({ id: 'c', paidThrough: past }), // expired — must NOT count
      sub({ id: 'd', status: 'trialing', paidThrough: future }), // not active
      sub({ id: 'e', status: 'canceled', paidThrough: future }), // not active
      sub({ id: 'f', tier: 'free', paidThrough: future }), // counts
    ];

    const counted = rows.filter((row) => isActiveSubscriptionNow(row, NOW)).length;

    expect(counted).toBe(3);
    // MUTATION: the literal-status count the Dashboard used would say 4,
    // including the expired row.
    expect(rows.filter((row) => row.status === 'active').length).toBe(4);
  });

  test('the boundary is exclusive at the instant the period ends', () => {
    const exactly = new Date(NOW).toISOString();

    expect(isActiveSubscriptionNow(sub({ paidThrough: exactly }), NOW)).toBe(false);
    expect(isActiveSubscriptionNow(sub({ paidThrough: new Date(NOW + 1).toISOString() }), NOW))
      .toBe(true);
  });
});
