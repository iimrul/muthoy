// W4-10 — provider selection, executed.
//
// SYNTHETIC ONLY: fabricated env values, a doubled Supabase client, no network.
//
// The claim this file has to make true is narrow and total: there is no
// PAYMENT_PROVIDER value, and no caller, that can start a new subscription
// payment. "Retired" written in a comment is not that claim — a test that
// enumerates the environment is. The historical settlement paths are proven
// elsewhere and deliberately untouched here: sslcommerz.test.ts for the
// provider contract, payment-webhook/webhook.test.ts for the callback
// pipeline, payment-integration.test.ts for the order state machine.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from './_shared/auth.ts';

const mocks = vi.hoisted(() => ({ assertCallerCurrent: vi.fn(), rpc: vi.fn(), from: vi.fn() }));

vi.mock('./_shared/auth.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_shared/auth.ts')>();
  return { ...original, assertCallerCurrent: mocks.assertCallerCurrent };
});
// Only the Supabase client is doubled: the real _shared/paymentProvider.ts is
// what is under test, so nothing here can stub the refusal into existence.
vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));

const { PaymentProviderError, RETIRED_PAYMENT_PROVIDERS, resolveProvider } =
  await import('./_shared/paymentProvider.ts');
const { initiateBilling } = await import('./billing.ts');

const ACCOUNT = '86666666-6666-4666-8666-666666666666';
const CLIENT_REQUEST = '7b000000-0000-4000-8000-0000000000c1';

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

/** Every shape the Edge environment can present, including the retired one. */
const ENVIRONMENTS: ReadonlyArray<readonly [string, string | undefined]> = [
  ['unset', undefined],
  ['empty', ''],
  ['whitespace', '   '],
  ['the retired provider', 'sslcommerz'],
  ['the retired provider in mixed case', 'SSLCommerz'],
  ['the retired provider with padding', '  sslcommerz  '],
  ['the blocked provider', 'bkash'],
  ['an unrelated provider', 'stripe'],
  ['a manual marker', 'manual'],
  ['a typo', 'sslcomerz'],
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCallerCurrent.mockResolvedValue(OWNER);
});

describe('resolveProvider', () => {
  it.each(ENVIRONMENTS)('refuses %s with 503 payment_not_configured', (_label, value) => {
    expect(() => resolveProvider(() => value)).toThrowError(
      expect.objectContaining({ status: 503, code: 'payment_not_configured' }),
    );
  });

  it('can never yield a provider, whatever the environment says', () => {
    for (const [, value] of ENVIRONMENTS) {
      let returned: unknown = 'the call never returned';
      try {
        returned = resolveProvider(() => value);
      } catch (error) {
        expect(error).toBeInstanceOf(PaymentProviderError);
        continue;
      }
      // Reaching here at all is the failure: a provider was handed back.
      expect(returned).toBeUndefined();
    }
  });

  it('names sslcommerz as retired rather than merely unconfigured', () => {
    expect(RETIRED_PAYMENT_PROVIDERS).toContain('sslcommerz');
    expect(() => resolveProvider(() => 'sslcommerz')).toThrowError(/retired/i);
  });

  it('reads PAYMENT_PROVIDER and nothing else', () => {
    const names: string[] = [];
    expect(() => resolveProvider((name) => { names.push(name); return undefined; })).toThrow();
    expect(names).toEqual(['PAYMENT_PROVIDER']);
  });

  it('cannot reach the SSLCommerz implementation at all', () => {
    const source = readFileSync(
      resolve('backend/supabase/functions/sync/_shared/paymentProvider.ts'),
      'utf8',
    );
    // The seam imports the shared error class from the retired module and
    // NOTHING else — a session factory or a config reader appearing here is how
    // a "retired" provider would quietly come back. Asserted as the exact set
    // of import lines, so a second import, or a multi-line one, fails closed.
    const importLines = source.split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .map((line) => line.trim());
    expect(importLines).toEqual(['import { PaymentProviderError } from "./sslcommerz.ts";']);
    // And nothing in the executable body names either entry point. Comments
    // are stripped first: this file explains the retirement in prose, and the
    // prose must not be what the assertion is reading.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/createSslCommerzSession/);
    expect(code).not.toMatch(/sslCommerzConfig/);
  });

  it('leaves no SSLCommerz import in the initiation path', () => {
    const source = readFileSync(resolve('backend/supabase/functions/sync/billing.ts'), 'utf8');
    expect(source).not.toMatch(/_shared\/sslcommerz\.ts/);
  });
});

describe('billing-init, the only server-controlled initiation path', () => {
  it('refuses a new payment with 503 payment_not_configured', async () => {
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 503, code: 'payment_not_configured' });
  });

  it('creates no order row and reads no checkout URL on refusal', async () => {
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 503 });

    // Not "no insert" — no table touched at all. A refused attempt that still
    // wrote a 'created' order would block every later attempt through the
    // open-order 409, and one that still read an order could hand back a stale
    // gateway link.
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('activates nothing — no RPC runs on a refused attempt', async () => {
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('still refuses a non-owner first, with 403 and no provider consulted', async () => {
    mocks.assertCallerCurrent.mockResolvedValue(STAFF);
    await expect(
      initiateBilling(caller, { tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a tampered client amount without reaching any payment table', async () => {
    await expect(
      initiateBilling(caller, {
        tier: 'pro', billingCycle: 'monthly', clientRequestId: CLIENT_REQUEST, amountPaisa: 1,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
