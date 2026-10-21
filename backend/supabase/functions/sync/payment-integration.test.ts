// W3-06 — payment INITIATION and terminal reconciliation, executed.
//
// SYNTHETIC ONLY: fabricated store credentials, a doubled provider, no network.
//
// billing.test.ts covers billing-status self-heal and sslcommerz.test.ts covers
// the provider contract. Neither touches initiateBilling or
// finalizeBillingAttempt, which is where the money decisions actually are: who
// may start a payment, what makes a second attempt idempotent rather than a
// double charge, and whether a failed provider call can leave an order in a
// state the device will poll forever.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from './_shared/auth.ts';

const mocks = vi.hoisted(() => ({
  assertCallerCurrent: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  createSession: vi.fn(),
  config: vi.fn(),
}));

vi.mock('./_shared/auth.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_shared/auth.ts')>();
  return { ...original, assertCallerCurrent: mocks.assertCallerCurrent };
});
vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));
vi.mock('./_shared/sslcommerz.ts', () => ({
  createSslCommerzSession: mocks.createSession,
  sslCommerzConfig: mocks.config,
  PaymentProviderError: class PaymentProviderError extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly code?: string,
    ) {
      super(message);
    }
  },
}));

const { finalizeBillingAttempt, initiateBilling } = await import('./billing.ts');

const ACCOUNT = '86666666-6666-4666-8666-666666666666';
const ORDER = '7b000000-0000-4000-8000-000000000001';
const CLIENT_REQUEST = '7b000000-0000-4000-8000-0000000000c1';
const PRO_MONTHLY_PAISA = 39_900;

const caller = {
  authUserId: 'auth-1', appUserId: 'owner-1', principalUserId: 'owner-1',
  shopId: 'shop-1', role: 'owner', permissionVersion: 1,
  freshPhoneOtp: null, raw: { app_metadata: {} },
} as unknown as Caller;

const OWNER = {
  appUserId: 'owner-1', shopId: 'shop-1', roleName: 'owner', isOwner: true,
  permissionVersion: 1, billingAccountId: ACCOUNT, commercialStatus: 'active' as const,
};

const STAFF = { ...OWNER, roleName: 'staff', isOwner: false, billingAccountId: null };

function table(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'lte', 'order', 'update', 'insert']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

/** Default happy-path reads: no existing order, a live offering, a full profile. */
function defaultTables(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  const defaults: Record<string, { data: unknown; error: unknown }> = {
    payment_orders: { data: null, error: null },
    plan_offerings: { data: { amount_paisa: PRO_MONTHLY_PAISA }, error: null },
    users: {
      data: { name: 'Owner', phone: '01700000700', email: 'owner@example.test' },
      error: null,
    },
    entitlement_snapshots: {
      data: { tier: 'free', status: 'trialing', paid_through: null, grace_ends_at: null },
      error: null,
    },
  };
  mocks.from.mockImplementation((name: string) =>
    table(overrides[name] ?? defaults[name] ?? { data: null, error: null }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCallerCurrent.mockResolvedValue(OWNER);
  mocks.config.mockReturnValue({
    storeId: 'store', storePassword: 'secret', mode: 'sandbox',
    callbackBaseUrl: 'https://project.functions.supabase.co/payment-webhook',
  });
  mocks.createSession.mockResolvedValue({
    sessionKey: 'session-key',
    gatewayPageUrl: 'https://sandbox.sslcommerz.com/pay',
  });
  defaultTables();
});

describe('who may start a payment', () => {
  it('refuses a non-owner', async () => {
    mocks.assertCallerCurrent.mockResolvedValue(STAFF);
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('fails closed BEFORE reusing any checkout URL when the provider is unconfigured', async () => {
    const { PaymentProviderError } = await import('./_shared/sslcommerz.ts');
    mocks.config.mockImplementation(() => {
      throw new PaymentProviderError(503, 'Payment provider is not configured', 'payment_not_configured');
    });
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 503 });
    // The order table was never even read: an unconfigured provider must not
    // hand back a stale checkout link.
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('input validation', () => {
  it.each([
    ['unknown tier', { tier: 'enterprise', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }],
    ['unknown cycle', { tier: 'pro', billingCycle: 'weekly', clientRequestId: CLIENT_REQUEST }],
    ['missing clientRequestId', { tier: 'pro', billingCycle: 'monthly' }],
    ['non-UUID clientRequestId', { tier: 'pro', billingCycle: 'monthly', clientRequestId: 'abc' }],
  ])('refuses %s with 400', async (_name, body) => {
    await expect(initiateBilling(caller, body)).rejects.toMatchObject({ status: 400 });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe('idempotency and concurrency', () => {
  it('returns the SAME order for a repeated clientRequestId instead of charging twice', async () => {
    defaultTables({
      payment_orders: {
        data: {
          id: ORDER, status: 'pending',
          checkout_url: 'https://sandbox.sslcommerz.com/pay',
          expires_at: '2026-10-20T12:00:00.000Z',
        },
        error: null,
      },
    });

    const result = await initiateBilling(caller, {
      tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST,
    });

    expect(result).toMatchObject({ orderId: ORDER, status: 'pending' });
    // The decisive assertion: no second provider session, so no second charge.
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('reuses an open order for the same tier and cycle', async () => {
    let call = 0;
    mocks.from.mockImplementation((name: string) => {
      if (name !== 'payment_orders') {
        return table({ data: { amount_paisa: PRO_MONTHLY_PAISA }, error: null });
      }
      call += 1;
      // First read is the clientRequestId lookup (miss); second is the open scan.
      return table(call === 1
        ? { data: null, error: null }
        : {
            data: {
              id: ORDER, status: 'pending',
              checkout_url: 'https://sandbox.sslcommerz.com/pay',
              expires_at: null, tier: 'pro', billing_cycle: 'monthly',
            },
            error: null,
          });
    });

    const result = await initiateBilling(caller, {
      tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST,
    });

    expect(result).toMatchObject({ orderId: ORDER });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('refuses a DIFFERENT plan while one payment is already in flight', async () => {
    let call = 0;
    mocks.from.mockImplementation((name: string) => {
      if (name !== 'payment_orders') {
        return table({ data: { amount_paisa: PRO_MONTHLY_PAISA }, error: null });
      }
      call += 1;
      return table(call === 1
        ? { data: null, error: null }
        : {
            data: {
              id: ORDER, status: 'pending', checkout_url: null,
              expires_at: null, tier: 'ultra', billing_cycle: 'annual',
            },
            error: null,
          });
    });

    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 409, code: 'payment_in_progress' });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe('commercial rules', () => {
  it('refuses an incomplete owner profile with 422 rather than sending blanks to the provider', async () => {
    defaultTables({
      users: { data: { name: 'Owner', phone: '01700000700', email: null }, error: null },
    });
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 422, code: 'payment_profile_incomplete' });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('refuses a malformed owner email', async () => {
    defaultTables({
      users: { data: { name: 'Owner', phone: '01700000700', email: 'not-an-email' }, error: null },
    });
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('refuses Ultra -> Pro inside a paid term, pointing at expiry instead', async () => {
    defaultTables({
      entitlement_snapshots: {
        data: {
          tier: 'ultra', status: 'active',
          paid_through: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          grace_ends_at: null,
        },
        error: null,
      },
    });
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 409, code: 'downgrade_at_expiry' });
  });

  it('allows Ultra -> Pro while merely trialing', async () => {
    defaultTables({
      entitlement_snapshots: {
        data: { tier: 'ultra', status: 'trialing', paid_through: null, grace_ends_at: null },
        error: null,
      },
    });
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).resolves.toMatchObject({ status: 'pending' });
  });
});

describe('a provider failure never leaves a stuck order', () => {
  it('flips the order to failed/init_failed and surfaces the provider status', async () => {
    const { PaymentProviderError } = await import('./_shared/sslcommerz.ts');
    const orders = table({ data: null, error: null });
    mocks.from.mockImplementation((name: string) =>
      name === 'payment_orders'
        ? orders
        : table(
            name === 'plan_offerings'
              ? { data: { amount_paisa: PRO_MONTHLY_PAISA }, error: null }
              : name === 'users'
                ? { data: { name: 'Owner', phone: '01700000700', email: 'owner@example.test' }, error: null }
                : { data: { tier: 'free', status: 'trialing', paid_through: null, grace_ends_at: null }, error: null },
          ),
    );
    mocks.createSession.mockRejectedValue(
      new PaymentProviderError(502, 'Payment provider unavailable'),
    );

    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 502 });

    // The order must not be left 'created': the device would poll it forever.
    expect(orders.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', failure_code: 'init_failed' }),
    );
  });

  it('sends the exact integer-paisa amount from plan_offerings, never a client figure', async () => {
    await initiateBilling(caller, {
      tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST,
      // A tampered client amount must be ignored outright.
      amountPaisa: 1,
    } as Record<string, unknown>);

    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaisa: PRO_MONTHLY_PAISA }),
    );
  });
});

describe('finalizeBillingAttempt', () => {
  it.each([['verified'], ['pending'], ['anything']])(
    'refuses status %s — only failed and canceled are client-reportable',
    async (status) => {
      await expect(
        finalizeBillingAttempt(caller, { orderId: ORDER, status }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('refuses a non-UUID orderId', async () => {
    await expect(
      finalizeBillingAttempt(caller, { orderId: 'nope', status: 'canceled' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a non-owner', async () => {
    mocks.assertCallerCurrent.mockResolvedValue(STAFF);
    await expect(
      finalizeBillingAttempt(caller, { orderId: ORDER, status: 'canceled' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('marks a cancellation with a client-attributed failure code', async () => {
    const orders = table({ data: { id: ORDER, status: 'canceled' }, error: null });
    mocks.from.mockReturnValue(orders);

    await expect(
      finalizeBillingAttempt(caller, { orderId: ORDER, status: 'canceled' }),
    ).resolves.toMatchObject({ id: ORDER, status: 'canceled' });

    expect(orders.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled', failure_code: 'client_canceled' }),
    );
  });

  it('returns an already-terminal order unchanged rather than rewriting it', async () => {
    // The guarded UPDATE matches nothing (status not in created/pending/expired),
    // so the follow-up read is what answers.
    let call = 0;
    mocks.from.mockImplementation(() => {
      call += 1;
      return table(call === 1
        ? { data: null, error: null }
        : { data: { id: ORDER, status: 'verified' }, error: null });
    });

    await expect(
      finalizeBillingAttempt(caller, { orderId: ORDER, status: 'failed' }),
    ).resolves.toMatchObject({ id: ORDER, status: 'verified' });
  });

  it('answers 404 for an order outside the caller’s billing account', async () => {
    mocks.from.mockReturnValue(table({ data: null, error: null }));
    await expect(
      finalizeBillingAttempt(caller, { orderId: ORDER, status: 'failed' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('never grants an entitlement — only the verified webhook may do that', async () => {
    mocks.from.mockReturnValue(table({ data: { id: ORDER, status: 'failed' }, error: null }));
    await finalizeBillingAttempt(caller, { orderId: ORDER, status: 'failed' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
