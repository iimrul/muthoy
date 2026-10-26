// Batch 3 §8.1 — the Dashboard's figures and its five alert classes.
//
// Every case here is a FIXTURE plus an INSTANT, because that is the whole
// reason lib/adminDashboard.ts is pure: "pharmacies active today" and
// "expiring within seven days" are both statements about a moment, and a test
// that read the real clock would be asserting something different every day.
//
// The mutation checks are what stop these from passing vacuously: each one
// plants the mistake the assertion above it exists to catch, and proves the
// assertion fails on it.

import { describe, expect, test } from 'vitest';
import { asPaisa } from '@muthoy/types';
import {
  accountsAtRisk,
  alignToWindow,
  BILLING_BOOTSTRAP_HOURS,
  dashboardAlerts,
  DASHBOARD_ALERT_IDS,
  dhakaDayLabel,
  distinctShopCount,
  expiringWithinDays,
  EXPIRY_HORIZON_DAYS,
  rejectedProviderEvents,
  shopsWithoutBillingAccount,
  staleOpenPaymentOrders,
  subscriptionDistribution,
  SUBSCRIPTION_STATUSES,
  tierDistribution,
  TREND_DAYS,
  trendDays,
} from './adminDashboard';
import type {
  EntitlementRow,
  PaymentOrderRow,
  ProviderEventRow,
  ShopRow,
  SubscriptionRow,
} from './adminViews';

/** 2026-10-25 12:00 Dhaka, so no case sits on a midnight boundary by accident. */
const NOW = Date.parse('2026-10-25T06:00:00.000Z');
const DAY_MS = 86_400_000;

function shop(overrides: Partial<ShopRow> = {}): ShopRow {
  return {
    id: '7b000000-0000-4000-8000-000000000001',
    name: 'Banani Pharmacy',
    phone: '+8801700000001',
    createdAt: '2026-01-01T00:00:00.000Z',
    plan: 'free',
    commercialStatus: 'active',
    commercialReason: null,
    archivedAt: null,
    billingAccountId: 'ba000000-0000-4000-8000-000000000001',
    ...overrides,
  };
}

function subscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'bs000000-0000-4000-8000-000000000001',
    billingAccountId: 'ba000000-0000-4000-8000-000000000001',
    tier: 'pro',
    billingCycle: 'monthly',
    status: 'active',
    startsAt: '2026-09-01T00:00:00.000Z',
    paidThrough: '2026-12-01T00:00:00.000Z',
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
    paidThrough: '2026-12-01T00:00:00.000Z',
    graceEndsAt: null,
    verifiedAt: '2026-10-25T00:00:00.000Z',
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
    expiresAt: '2026-10-26T00:00:00.000Z',
    verifiedAt: '2026-10-20T00:00:00.000Z',
    createdAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

function event(overrides: Partial<ProviderEventRow> = {}): ProviderEventRow {
  return {
    id: 'pe000000-0000-4000-8000-000000000001',
    paymentOrderId: 'po000000-0000-4000-8000-000000000001',
    processingStatus: 'applied',
    errorCode: null,
    receivedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('subscriptions expiring within the horizon', () => {
  test('the horizon is seven days, as §8.1 fixes it', () => {
    expect(EXPIRY_HORIZON_DAYS).toBe(7);
  });

  test('a period ending inside the horizon is counted', () => {
    const rows = [subscription({ paidThrough: new Date(NOW + 3 * DAY_MS).toISOString() })];

    expect(expiringWithinDays(rows, NOW)).toBe(1);
  });

  test('a period ending beyond the horizon is NOT counted', () => {
    const rows = [subscription({ paidThrough: new Date(NOW + 30 * DAY_MS).toISOString() })];

    expect(expiringWithinDays(rows, NOW)).toBe(0);
  });

  test('a period that has ALREADY ended is expired, not expiring', () => {
    // The distinction matters: counting the past would make the alert never
    // clear, and an alert that never clears is one nobody reads.
    const rows = [subscription({ paidThrough: new Date(NOW - DAY_MS).toISOString() })];

    expect(expiringWithinDays(rows, NOW)).toBe(0);
  });

  test('a grace period is what expires when one is running', () => {
    const rows = [
      subscription({
        status: 'grace',
        paidThrough: new Date(NOW - 10 * DAY_MS).toISOString(),
        graceEndsAt: new Date(NOW + 2 * DAY_MS).toISOString(),
      }),
    ];

    expect(expiringWithinDays(rows, NOW)).toBe(1);
  });

  test('a canceled or expired row carries no horizon', () => {
    const soon = new Date(NOW + DAY_MS).toISOString();

    expect(
      expiringWithinDays(
        [
          subscription({ status: 'canceled', paidThrough: soon }),
          subscription({ status: 'expired', paidThrough: soon }),
        ],
        NOW,
      ),
    ).toBe(0);
  });

  test('an unparseable period end is not counted as expiring', () => {
    const rows = [subscription({ paidThrough: 'not a date' })];

    expect(expiringWithinDays(rows, NOW)).toBe(0);
  });
});

describe('accounts at risk', () => {
  test('past_due and grace are both counted', () => {
    const rows = [entitlement({ status: 'past_due' }), entitlement({ status: 'grace' })];

    expect(accountsAtRisk(rows)).toBe(2);
  });

  test('active, trialing and free are not at risk', () => {
    const rows = [
      entitlement({ status: 'active' }),
      entitlement({ status: 'trialing' }),
      entitlement({ status: 'free' }),
    ];

    expect(accountsAtRisk(rows)).toBe(0);
  });
});

describe('shops with no billing account', () => {
  test('the bootstrap window is 24 hours', () => {
    expect(BILLING_BOOTSTRAP_HOURS).toBe(24);
  });

  test('a shop registered inside the window is NOT alerted', () => {
    // A shop and its billing account are two separate writes. Alerting here
    // would make the dashboard cry wolf on every single signup.
    const rows = [
      shop({ billingAccountId: null, createdAt: new Date(NOW - 3_600_000).toISOString() }),
    ];

    expect(shopsWithoutBillingAccount(rows, NOW)).toBe(0);
  });

  test('a shop registered before the window IS alerted', () => {
    const rows = [
      shop({ billingAccountId: null, createdAt: new Date(NOW - 5 * DAY_MS).toISOString() }),
    ];

    expect(shopsWithoutBillingAccount(rows, NOW)).toBe(1);
  });

  test('a shop WITH an account is never alerted, however old', () => {
    const rows = [shop({ createdAt: '2020-01-01T00:00:00.000Z' })];

    expect(shopsWithoutBillingAccount(rows, NOW)).toBe(0);
  });

  test('an unparseable registration date is counted, not skipped', () => {
    // Skipping would hide the worse case: a row with no account AND no
    // readable timestamp is exactly what an operator should be shown.
    const rows = [shop({ billingAccountId: null, createdAt: '' })];

    expect(shopsWithoutBillingAccount(rows, NOW)).toBe(1);
  });

  test('MUTATION: a zero-hour window alerts on a fresh signup', () => {
    // Proves the window is real rather than decorative — with it removed, the
    // case that must NOT alert does.
    const fresh = [
      shop({ billingAccountId: null, createdAt: new Date(NOW - 3_600_000).toISOString() }),
    ];

    expect(shopsWithoutBillingAccount(fresh, NOW, 0)).toBe(1);
    expect(shopsWithoutBillingAccount(fresh, NOW)).toBe(0);
  });
});

describe('stale open payment orders and rejected events', () => {
  test('an open order past expiry is stale', () => {
    const rows = [order({ status: 'pending', expiresAt: new Date(NOW - DAY_MS).toISOString() })];

    expect(staleOpenPaymentOrders(rows, NOW)).toBe(1);
  });

  test('a verified order past expiry is not stale — it completed', () => {
    const rows = [order({ status: 'verified', expiresAt: new Date(NOW - DAY_MS).toISOString() })];

    expect(staleOpenPaymentOrders(rows, NOW)).toBe(0);
  });

  test('an open order still inside its expiry is not stale', () => {
    const rows = [order({ status: 'created', expiresAt: new Date(NOW + DAY_MS).toISOString() })];

    expect(staleOpenPaymentOrders(rows, NOW)).toBe(0);
  });

  test('only rejected provider events are counted', () => {
    const rows = [
      event({ processingStatus: 'rejected' }),
      event({ processingStatus: 'applied' }),
      event({ processingStatus: 'ignored' }),
    ];

    expect(rejectedProviderEvents(rows)).toBe(1);
  });
});

describe('the alert list', () => {
  const empty = {
    shops: [] as ShopRow[],
    subscriptions: [] as SubscriptionRow[],
    entitlements: [] as EntitlementRow[],
    orders: [] as PaymentOrderRow[],
    events: [] as ProviderEventRow[],
  };

  test('exactly the five §8.1 classes, in a frozen list', () => {
    expect([...DASHBOARD_ALERT_IDS]).toEqual([
      'subscriptions_expiring_soon',
      'accounts_at_risk',
      'shops_without_billing_account',
      'stale_open_payment_orders',
      'rejected_provider_events',
    ]);
  });

  test('all five are returned on an empty platform, each at zero', () => {
    // A zero is a CHECKED FACT. An absent row would read as an unchecked one,
    // and on an operational dashboard those are opposites.
    const alerts = dashboardAlerts(empty, NOW);

    expect(alerts.map((alert) => alert.id)).toEqual([...DASHBOARD_ALERT_IDS]);
    expect(alerts.every((alert) => alert.count === 0)).toBe(true);
  });

  test('every alert says what it is and where to look', () => {
    for (const alert of dashboardAlerts(empty, NOW)) {
      expect(alert.label.length, alert.id).toBeGreaterThan(8);
      expect(alert.detail.length, alert.id).toBeGreaterThan(20);
      expect(alert.href, alert.id).not.toBeNull();
    }
  });

  test('each class counts its own condition and no other', () => {
    const alerts = dashboardAlerts(
      {
        shops: [shop({ billingAccountId: null, createdAt: '2026-01-01T00:00:00.000Z' })],
        subscriptions: [subscription({ paidThrough: new Date(NOW + 2 * DAY_MS).toISOString() })],
        entitlements: [entitlement({ status: 'past_due' })],
        orders: [order({ status: 'pending', expiresAt: new Date(NOW - DAY_MS).toISOString() })],
        events: [event({ processingStatus: 'rejected' })],
      },
      NOW,
    );

    expect(Object.fromEntries(alerts.map((alert) => [alert.id, alert.count]))).toEqual({
      subscriptions_expiring_soon: 1,
      accounts_at_risk: 1,
      shops_without_billing_account: 1,
      stale_open_payment_orders: 1,
      rejected_provider_events: 1,
    });
  });

  test('MUTATION: a list missing a class is caught by the id assertion', () => {
    const missing = dashboardAlerts(empty, NOW)
      .filter((alert) => alert.id !== 'rejected_provider_events')
      .map((alert) => alert.id);

    expect(missing).not.toEqual([...DASHBOARD_ALERT_IDS]);
  });
});

describe('the distributions', () => {
  test('all six subscription statuses appear, even at zero', () => {
    const buckets = subscriptionDistribution([subscription({ status: 'active' })]);

    expect(buckets.map((bucket) => bucket.key)).toEqual([...SUBSCRIPTION_STATUSES]);
    expect(buckets.find((bucket) => bucket.key === 'active')?.count).toBe(1);
    expect(buckets.find((bucket) => bucket.key === 'expired')?.count).toBe(0);
  });

  test('an undeclared status is APPENDED, not dropped', () => {
    // A status nobody declared is precisely the thing worth seeing.
    const buckets = subscriptionDistribution([subscription({ status: 'wat' })]);

    expect(buckets.map((bucket) => bucket.key)).toContain('wat');
    expect(buckets.find((bucket) => bucket.key === 'wat')?.count).toBe(1);
  });

  test('tiers are counted the same way', () => {
    const buckets = tierDistribution([
      subscription({ tier: 'pro' }),
      subscription({ tier: 'pro' }),
      subscription({ tier: 'ultra' }),
    ]);

    expect(buckets.find((bucket) => bucket.key === 'pro')?.count).toBe(2);
    expect(buckets.find((bucket) => bucket.key === 'free')?.count).toBe(0);
  });
});

describe('the Dhaka day axis', () => {
  test('a UTC evening instant belongs to the NEXT Dhaka day', () => {
    // 18:00 UTC is midnight in Dhaka. A naive UTC day would file six hours of
    // every day under the wrong date.
    expect(dhakaDayLabel('2026-10-25T20:00:00.000Z')).toBe('2026-10-26');
    expect(dhakaDayLabel('2026-10-25T17:59:00.000Z')).toBe('2026-10-25');
    expect(dhakaDayLabel('2026-10-25T18:00:00.000Z')).toBe('2026-10-26');
  });

  test('an unparseable timestamp has no day, rather than a plausible wrong one', () => {
    expect(dhakaDayLabel('')).toBeNull();
    expect(dhakaDayLabel('yesterday')).toBeNull();
  });

  test('the window is thirty days, oldest first, ending on today', () => {
    const days = trendDays('2026-10-25');

    expect(TREND_DAYS).toBe(30);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-09-26');
    expect(days[29]).toBe('2026-10-25');
    expect([...days].sort()).toEqual([...days]);
  });

  test('the window crosses a month and a year boundary correctly', () => {
    const days = trendDays('2027-01-02', 5);

    expect(days).toEqual(['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  test('an unparseable anchor yields no axis rather than a wrong one', () => {
    expect(trendDays('not-a-day')).toEqual([]);
  });

  test('a day with no rows becomes an EMPTY bucket, not a gap', () => {
    const aligned = alignToWindow(
      [{ day: '2026-10-25', shopIds: ['a', 'b'] }],
      ['2026-10-24', '2026-10-25'],
    );

    expect(aligned).toEqual([
      { day: '2026-10-24', shopIds: [] },
      { day: '2026-10-25', shopIds: ['a', 'b'] },
    ]);
  });

  test('a bucket outside the window is dropped', () => {
    const aligned = alignToWindow([{ day: '2020-01-01', shopIds: ['a'] }], ['2026-10-25']);

    expect(aligned).toEqual([{ day: '2026-10-25', shopIds: [] }]);
  });

  test('DISTINCT shops are counted, not rows', () => {
    // A hundred sales from one pharmacy is one active pharmacy.
    expect(distinctShopCount({ day: '2026-10-25', shopIds: ['a', 'a', 'a', 'b'] })).toBe(2);
    expect(distinctShopCount({ day: '2026-10-25', shopIds: [] })).toBe(0);
  });
});
