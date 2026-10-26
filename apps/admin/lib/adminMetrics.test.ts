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
  isEntitledNow,
  isMrrEligible,
  isPaidEntitlementNow,
  isTrialingNow,
  metricById,
  monthlyContributionPaisa,
  monthlyRecurringRevenue,
  recordedCancellations,
  requireMetric,
  trialToPaidConversion,
} from './adminMetrics';
import type {
  AccountRow,
  EntitlementRow,
  OfferingRow,
  PaymentOrderRow,
  SubscriptionRow,
} from './adminViews';

const NOW = Date.parse('2026-10-25T06:00:00.000Z');
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-12-01T00:00:00.000Z';

function entitlement(overrides: Partial<EntitlementRow> = {}): EntitlementRow {
  return {
    billingAccountId: 'account-1',
    tier: 'pro',
    status: 'active',
    trialEndsAt: null,
    paidThrough: FUTURE,
    graceEndsAt: null,
    verifiedAt: PAST,
    ...overrides,
  };
}

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

describe('the two cases revision 2 got wrong', () => {
  test('an ACTIVE row inside its GRACE window, with paid_through past, is entitled', () => {
    const row = entitlement({ status: 'active', paidThrough: PAST, graceEndsAt: FUTURE });

    expect(isPaidEntitlementNow(row, NOW)).toBe(true);
    expect(isEntitledNow(row, NOW)).toBe(true);
  });

  test('a CANCELED row still inside paid_through is entitled', () => {
    const row = entitlement({ status: 'canceled', paidThrough: FUTURE });

    expect(isPaidEntitlementNow(row, NOW)).toBe(true);
    expect(isEntitledNow(row, NOW)).toBe(true);
  });
});

describe('the canonical predicate, one row of every status', () => {
  test.each([
    ['trialing, in trial', { status: 'trialing', tier: 'free', trialEndsAt: FUTURE }, true],
    ['trialing, trial over', { status: 'trialing', tier: 'free', trialEndsAt: PAST }, false],
    ['active, paid', { status: 'active', paidThrough: FUTURE }, true],
    ['active, lapsed with no grace', { status: 'active', paidThrough: PAST }, false],
    ['active, in grace', { status: 'active', paidThrough: PAST, graceEndsAt: FUTURE }, true],
    ['past_due, in grace', { status: 'past_due', paidThrough: PAST, graceEndsAt: FUTURE }, true],
    ['past_due, grace over', { status: 'past_due', paidThrough: PAST, graceEndsAt: PAST }, false],
    ['grace, in grace', { status: 'grace', paidThrough: PAST, graceEndsAt: FUTURE }, true],
    ['canceled, still paid', { status: 'canceled', paidThrough: FUTURE }, true],
    ['canceled, past paid_through', { status: 'canceled', paidThrough: PAST }, false],
    // A canceled row does NOT get the grace branch in the SQL.
    ['canceled, in grace only', { status: 'canceled', paidThrough: PAST, graceEndsAt: FUTURE }, false],
    ['expired', { status: 'expired', paidThrough: PAST }, false],
    ['free tier, paid dates', { status: 'active', tier: 'free', paidThrough: FUTURE }, false],
  ])('%s -> %s', (_label, overrides, expected) => {
    expect(isEntitledNow(entitlement(overrides), NOW)).toBe(expected);
  });

  test('a trialing row is premium but pays nothing, so it is NOT currently paid', () => {
    const row = entitlement({ status: 'trialing', tier: 'free', trialEndsAt: FUTURE });

    expect(isTrialingNow(row, NOW)).toBe(true);
    expect(isEntitledNow(row, NOW)).toBe(true);
    expect(isPaidEntitlementNow(row, NOW)).toBe(false);
  });

  test('a null date is not a future one', () => {
    expect(isPaidEntitlementNow(entitlement({ paidThrough: null }), NOW)).toBe(false);
    expect(isTrialingNow(entitlement({ status: 'trialing', trialEndsAt: null }), NOW)).toBe(false);
  });

  test('an unparseable date does not grant entitlement', () => {
    // The wrong direction to fail would be the generous one.
    expect(isPaidEntitlementNow(entitlement({ paidThrough: 'tomorrow' }), NOW)).toBe(false);
  });

  test('the boundary is STRICTLY after, as the SQL `>` is', () => {
    const exactly = new Date(NOW).toISOString();
    expect(isPaidEntitlementNow(entitlement({ paidThrough: exactly }), NOW)).toBe(false);
    expect(isPaidEntitlementNow(entitlement({ paidThrough: new Date(NOW + 1).toISOString() }), NOW))
      .toBe(true);
  });
});

describe('MRR is forward-looking', () => {
  test('a canceled row counts as paid entitlement but NOT towards the run rate', () => {
    const canceled = { status: 'canceled', paidThrough: FUTURE };

    expect(isPaidEntitlementNow(entitlement(canceled), NOW)).toBe(true);
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
    // And the canceled row IS still a paid entitlement, which is the asymmetry.
    expect(isPaidEntitlementNow(entitlement({ status: 'canceled', paidThrough: FUTURE }), NOW))
      .toBe(true);
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
      entitlement({ billingAccountId: 'a1', status: 'active', paidThrough: FUTURE }),
      entitlement({ billingAccountId: 'a2', status: 'expired', paidThrough: PAST }),
      entitlement({ billingAccountId: 'a3', status: 'trialing', tier: 'free', trialEndsAt: FUTURE }),
    ], NOW);

    expect(counts).toEqual({ trialing: 1, currentlyPaid: 1, entitled: 2 });
    expect(accountsEverPaid([
      order({ id: 'o1', billingAccountId: 'a1' }),
      order({ id: 'o2', billingAccountId: 'a2' }),
    ])).toBe(2);
  });

  test('conversion is null, not zero, when nobody was granted a trial', () => {
    expect(trialToPaidConversion({ accounts: [], orders: [] }))
      .toEqual({ denominator: 0, numerator: 0, ratio: null });
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

    expect(result).toEqual({ denominator: 2, numerator: 1, ratio: 0.5 });
  });

  test('an account that paid without a trial does not inflate the numerator', () => {
    const result = trialToPaidConversion({
      accounts: [account({ id: 'a1' }), account({ id: 'a2', launchTrialGrantedAt: null })],
      orders: [order({ billingAccountId: 'a2' })],
    });

    expect(result).toEqual({ denominator: 1, numerator: 0, ratio: 0 });
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
