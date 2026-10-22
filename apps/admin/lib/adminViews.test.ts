// W4-07 — the pure shaping behind the management pages, executed.
//
// These joins decide what a platform console SAYS about an account: which plan,
// which status, when access ends, how many shops. Getting one wrong is a
// support decision made on a wrong number, so the awkward cases are the point:
// an account with no entitlement row, a shop that belongs to no account, an
// inactive membership, a payment order with no provider event, and a tier/cycle
// pair with no offering.

import { describe, expect, test } from 'vitest';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import {
  accessEndsAt,
  billingCycleLabel,
  formatDhakaDate,
  formatDhakaDateTime,
  isUuid,
  statusLabel,
  summarizeAccounts,
  summarizePaymentOrders,
  summarizeSubscriptions,
  sumPaisa,
  tierLabel,
  type AccountRow,
  type EntitlementRow,
  type MembershipRow,
  type ShopRow,
} from './adminViews';

const ACCOUNT_A = '86666666-6666-4666-8666-666666666666';
const ACCOUNT_B = '87777777-7777-4777-8777-777777777777';
const SHOP_A = '81111111-1111-4111-8111-111111111111';
const SHOP_B = '82222222-2222-4222-8222-222222222222';

function account(id: string, primaryShopId: string, createdAt: string): AccountRow {
  return {
    id,
    principalOwnerUserId: 'owner-' + id,
    primaryShopId,
    launchTrialGrantedAt: null,
    createdAt,
  };
}

function shop(id: string, name: string, billingAccountId: string | null): ShopRow {
  return {
    id,
    name,
    phone: '01700000011',
    createdAt: '2026-09-01T06:00:00.000Z',
    plan: 'free',
    commercialStatus: 'active',
    commercialReason: null,
    archivedAt: null,
    billingAccountId,
  };
}

function membership(id: string, billingAccountId: string, shopId: string, isActive: boolean): MembershipRow {
  return {
    id,
    billingAccountId,
    shopId,
    principalUserId: 'user-' + id,
    role: 'staff',
    isActive,
    createdAt: '2026-09-02T06:00:00.000Z',
  };
}

function entitlement(overrides: Partial<EntitlementRow> & { billingAccountId: string }): EntitlementRow {
  return {
    tier: 'pro',
    status: 'active',
    trialEndsAt: null,
    paidThrough: '2026-11-01T06:00:00.000Z',
    graceEndsAt: null,
    verifiedAt: '2026-10-01T06:00:00.000Z',
    ...overrides,
  };
}

describe('isUuid', () => {
  test('accepts a v4 UUID in either case', () => {
    expect(isUuid(ACCOUNT_A)).toBe(true);
    expect(isUuid(ACCOUNT_A.toUpperCase())).toBe(true);
  });

  test.each([
    ['empty', ''],
    ['a bare word', 'founder'],
    ['a SQL fragment', "' or 1=1--"],
    ['a path traversal', '../../etc/passwd'],
    ['a PostgREST filter', 'eq.86666666-6666-4666-8666-666666666666'],
    ['a truncated uuid', '86666666-6666-4666-8666'],
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('rejects %s', (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe('accessEndsAt', () => {
  test('a trial ends at trial_ends_at', () => {
    expect(accessEndsAt(entitlement({
      billingAccountId: ACCOUNT_A,
      status: 'trialing',
      trialEndsAt: '2026-10-15T06:00:00.000Z',
      paidThrough: null,
    }))).toBe('2026-10-15T06:00:00.000Z');
  });

  test('grace wins over paid_through, because it is the later access', () => {
    expect(accessEndsAt(entitlement({
      billingAccountId: ACCOUNT_A,
      status: 'grace',
      graceEndsAt: '2026-11-08T06:00:00.000Z',
    }))).toBe('2026-11-08T06:00:00.000Z');
  });

  test('an active plan ends at paid_through', () => {
    expect(accessEndsAt(entitlement({ billingAccountId: ACCOUNT_A }))).toBe('2026-11-01T06:00:00.000Z');
  });

  test('no entitlement row at all is null, not a guess', () => {
    expect(accessEndsAt(undefined)).toBeNull();
  });
});

describe('summarizeAccounts', () => {
  const accounts = [
    account(ACCOUNT_A, SHOP_A, '2026-09-01T06:00:00.000Z'),
    account(ACCOUNT_B, SHOP_B, '2026-09-05T06:00:00.000Z'),
  ];
  const shops = [
    shop(SHOP_A, 'Alpha Pharmacy', ACCOUNT_A),
    shop(SHOP_B, 'Beta Pharmacy', ACCOUNT_B),
    shop('83333333-3333-4333-8333-333333333333', 'Alpha Branch', ACCOUNT_A),
    // A shop attached to no account at all — the pre-B4 state.
    shop('84444444-4444-4444-8444-444444444444', 'Orphan Pharmacy', null),
  ];
  const memberships = [
    membership('m1', ACCOUNT_A, SHOP_A, true),
    membership('m2', ACCOUNT_A, SHOP_A, false),
    membership('m3', ACCOUNT_B, SHOP_B, true),
  ];

  test('counts shops and ACTIVE members per account', () => {
    const summaries = summarizeAccounts({
      accounts,
      shops,
      memberships,
      entitlements: [entitlement({ billingAccountId: ACCOUNT_A })],
    });

    const alpha = summaries.find((summary) => summary.id === ACCOUNT_A);
    expect(alpha).toMatchObject({
      primaryShopName: 'Alpha Pharmacy',
      shopCount: 2,
      activeMemberCount: 1,
      tier: 'pro',
      status: 'active',
    });
  });

  test('an account with no entitlement row reads as Free/unknown, never as paid', () => {
    const summaries = summarizeAccounts({ accounts, shops, memberships, entitlements: [] });

    expect(summaries.find((summary) => summary.id === ACCOUNT_B)).toMatchObject({
      tier: 'free',
      status: 'unknown',
      accessEndsAt: null,
    });
  });

  test('a shop with no account is counted against no account', () => {
    const summaries = summarizeAccounts({ accounts, shops, memberships, entitlements: [] });
    const total = summaries.reduce((sum, summary) => sum + summary.shopCount, 0);

    expect(total).toBe(3);
  });

  test('a missing primary shop shows the em dash rather than crashing', () => {
    const summaries = summarizeAccounts({
      accounts: [account(ACCOUNT_A, 'missing-shop', '2026-09-01T06:00:00.000Z')],
      shops: [],
      memberships: [],
      entitlements: [],
    });

    expect(summaries[0]?.primaryShopName).toBe('—');
  });

  test('newest account first', () => {
    const summaries = summarizeAccounts({ accounts, shops, memberships, entitlements: [] });
    expect(summaries.map((summary) => summary.id)).toEqual([ACCOUNT_B, ACCOUNT_A]);
  });
});

describe('summarizeSubscriptions', () => {
  const accountSummaries = summarizeAccounts({
    accounts: [account(ACCOUNT_A, SHOP_A, '2026-09-01T06:00:00.000Z')],
    shops: [shop(SHOP_A, 'Alpha Pharmacy', ACCOUNT_A)],
    memberships: [],
    entitlements: [],
  });

  const subscription = {
    id: 's1',
    billingAccountId: ACCOUNT_A,
    tier: 'pro',
    billingCycle: 'monthly',
    status: 'active',
    startsAt: '2026-10-01T06:00:00.000Z',
    paidThrough: '2026-11-01T06:00:00.000Z',
    graceEndsAt: null,
    canceledAt: null,
    provider: 'sslcommerz',
    createdAt: '2026-10-01T06:00:00.000Z',
  };

  test('takes the billed amount from plan_offerings, not from the subscription', () => {
    const summaries = summarizeSubscriptions({
      subscriptions: [subscription],
      entitlements: [entitlement({ billingAccountId: ACCOUNT_A, status: 'past_due' })],
      offerings: [{ tier: 'pro', billingCycle: 'monthly', amountPaisa: asPaisa(39_900), isActive: true }],
      accounts: accountSummaries,
    });

    expect(summaries[0]).toMatchObject({
      accountLabel: 'Alpha Pharmacy',
      billedAmountPaisa: 39_900,
      status: 'active',
      entitlementStatus: 'past_due',
    });
  });

  test('a tier/cycle with no offering bills zero rather than guessing a price', () => {
    const summaries = summarizeSubscriptions({
      subscriptions: [{ ...subscription, billingCycle: 'annual' }],
      entitlements: [],
      offerings: [{ tier: 'pro', billingCycle: 'monthly', amountPaisa: asPaisa(39_900), isActive: true }],
      accounts: accountSummaries,
    });

    expect(summaries[0]?.billedAmountPaisa).toBe(ZERO_PAISA);
  });

  test('an unknown account still renders, labelled with the em dash', () => {
    const summaries = summarizeSubscriptions({
      subscriptions: [{ ...subscription, billingAccountId: 'gone' }],
      entitlements: [],
      offerings: [],
      accounts: accountSummaries,
    });

    expect(summaries[0]).toMatchObject({ accountLabel: '—', entitlementStatus: 'unknown' });
  });
});

describe('summarizePaymentOrders', () => {
  const accountSummaries = summarizeAccounts({
    accounts: [account(ACCOUNT_A, SHOP_A, '2026-09-01T06:00:00.000Z')],
    shops: [shop(SHOP_A, 'Alpha Pharmacy', ACCOUNT_A)],
    memberships: [],
    entitlements: [],
  });

  const order = {
    id: 'o1',
    billingAccountId: ACCOUNT_A,
    tier: 'pro',
    billingCycle: 'monthly',
    amountPaisa: asPaisa(39_900),
    status: 'verified',
    provider: 'sslcommerz',
    failureCode: null,
    expiresAt: '2026-10-01T07:00:00.000Z',
    verifiedAt: '2026-10-01T06:30:00.000Z',
    createdAt: '2026-10-01T06:00:00.000Z',
  };

  test('counts events per order and reports the LATEST processing status', () => {
    const summaries = summarizePaymentOrders({
      orders: [order],
      events: [
        { id: 'e1', paymentOrderId: 'o1', processingStatus: 'received', errorCode: null, receivedAt: '2026-10-01T06:10:00.000Z' },
        { id: 'e2', paymentOrderId: 'o1', processingStatus: 'verified', errorCode: null, receivedAt: '2026-10-01T06:20:00.000Z' },
      ],
      accounts: accountSummaries,
      now: Date.parse('2026-10-01T06:30:00.000Z'),
    });

    expect(summaries[0]).toMatchObject({ eventCount: 2, latestEventStatus: 'verified' });
  });

  test('an order with no event reports null, not a fabricated status', () => {
    const summaries = summarizePaymentOrders({ orders: [order], events: [], accounts: accountSummaries, now: Date.parse('2026-10-01T06:30:00.000Z') });
    expect(summaries[0]).toMatchObject({ eventCount: 0, latestEventStatus: null });
  });

  test('an event with no order id is ignored rather than attached to the wrong order', () => {
    const summaries = summarizePaymentOrders({
      orders: [order],
      events: [{ id: 'e9', paymentOrderId: null, processingStatus: 'rejected', errorCode: 'x', receivedAt: '2026-10-02T06:00:00.000Z' }],
      accounts: accountSummaries,
      now: Date.parse('2026-10-01T06:30:00.000Z'),
    });

    expect(summaries[0]?.eventCount).toBe(0);
  });

  test('newest order first, and the amount is carried through untouched', () => {
    const summaries = summarizePaymentOrders({
      orders: [order, { ...order, id: 'o2', createdAt: '2026-10-05T06:00:00.000Z' }],
      events: [],
      accounts: accountSummaries,
      now: Date.parse('2026-10-01T06:30:00.000Z'),
    });

    expect(summaries.map((row) => row.id)).toEqual(['o2', 'o1']);
    expect(summaries[0]?.amountPaisa).toBe(39_900);
  });
});

describe('labels and formatting', () => {
  test.each([
    ['free', 'Free'],
    ['pro', 'Pro'],
    ['ultra', 'Ultra'],
    ['something_else', 'something_else'],
  ])('tierLabel(%s) is %s', (tier, expected) => {
    expect(tierLabel(tier)).toBe(expected);
  });

  test.each([
    ['trialing', 'Trial'],
    ['past_due', 'Past due'],
    ['read_only', 'Read-only'],
    ['verified', 'Verified'],
    ['never_heard_of_it', 'never_heard_of_it'],
  ])('statusLabel(%s) is %s', (status, expected) => {
    expect(statusLabel(status)).toBe(expected);
  });

  test('an inherited name cannot resolve to a label', () => {
    for (const name of ['constructor', '__proto__', 'toString']) {
      expect(tierLabel(name)).toBe(name);
      expect(statusLabel(name)).toBe(name);
    }
  });

  test('billingCycleLabel covers both cycles and passes anything else through', () => {
    expect(billingCycleLabel('monthly')).toBe('Monthly');
    expect(billingCycleLabel('annual')).toBe('Annual');
    expect(billingCycleLabel('weekly')).toBe('weekly');
  });

  test('a UTC timestamp renders as the DHAKA calendar day', () => {
    // 19:30 UTC is already the next day in Dhaka (+06:00). A naive UTC render
    // would show the wrong date for every evening event.
    expect(formatDhakaDate('2026-10-21T19:30:00.000Z')).toBe('2026-10-22');
    expect(formatDhakaDate('2026-10-21T17:59:00.000Z')).toBe('2026-10-21');
    expect(formatDhakaDateTime('2026-10-21T19:30:00.000Z')).toBe('2026-10-22 01:30');
  });

  test('a null or unparseable timestamp is the em dash, never Invalid Date', () => {
    expect(formatDhakaDate(null)).toBe('—');
    expect(formatDhakaDate('not a date')).toBe('—');
    expect(formatDhakaDateTime(null)).toBe('—');
    expect(formatDhakaDateTime('')).toBe('—');
  });

  test('sumPaisa adds branded integers and starts at zero', () => {
    expect(sumPaisa([])).toBe(ZERO_PAISA);
    expect(sumPaisa([39_900, 49_900])).toBe(89_800);
  });

  test('sumPaisa refuses a non-integer rather than rounding money silently', () => {
    expect(() => sumPaisa([1.5])).toThrow();
  });
});

describe('isStaleOpen (W4-08)', () => {
  const accountSummaries = summarizeAccounts({
    accounts: [account(ACCOUNT_A, SHOP_A, '2026-09-01T06:00:00.000Z')],
    shops: [shop(SHOP_A, 'Alpha Pharmacy', ACCOUNT_A)],
    memberships: [],
    entitlements: [],
  });

  const openOrder = {
    id: 'o1',
    billingAccountId: ACCOUNT_A,
    tier: 'pro',
    billingCycle: 'monthly',
    amountPaisa: asPaisa(39_900),
    status: 'pending',
    provider: 'sslcommerz',
    failureCode: null,
    expiresAt: '2026-10-01T07:00:00.000Z',
    verifiedAt: null,
    createdAt: '2026-10-01T06:00:00.000Z',
  };

  function flagFor(overrides: Partial<typeof openOrder>, nowIso: string): boolean {
    const [row] = summarizePaymentOrders({
      orders: [{ ...openOrder, ...overrides }],
      events: [],
      accounts: accountSummaries,
      now: Date.parse(nowIso),
    });
    return row?.isStaleOpen ?? false;
  }

  test('an open order past its expiry is stale', () => {
    expect(flagFor({}, '2026-10-01T07:00:01.000Z')).toBe(true);
    expect(flagFor({ status: 'created' }, '2026-10-01T08:00:00.000Z')).toBe(true);
  });

  test('an open order still inside its window is NOT stale', () => {
    expect(flagFor({}, '2026-10-01T06:30:00.000Z')).toBe(false);
  });

  test('the boundary instant counts as stale, matching the update guard', () => {
    // The action's guard is lte('expires_at', now), so the two must agree at
    // exactly the expiry instant or the button and the write disagree.
    expect(flagFor({}, '2026-10-01T07:00:00.000Z')).toBe(true);
  });

  test.each(['verified', 'failed', 'canceled', 'expired'])(
    'a %s order is never stale-open, however old it is',
    (status) => {
      expect(flagFor({ status }, '2027-01-01T00:00:00.000Z')).toBe(false);
    },
  );

  test('an unparseable expiry is not stale — it is not a licence to write', () => {
    expect(flagFor({ expiresAt: 'not a date' }, '2027-01-01T00:00:00.000Z')).toBe(false);
    expect(flagFor({ expiresAt: '' }, '2027-01-01T00:00:00.000Z')).toBe(false);
  });
});
