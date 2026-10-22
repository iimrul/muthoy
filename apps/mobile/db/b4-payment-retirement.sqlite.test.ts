// W4-10 — the LOCAL half of the SSLCommerz retirement, on real SQLite.
//
// The server refuses billing-init (payment-provider.test.ts). That alone is not
// enough: initiatePlanPayment used to write the local payment_attempts row
// FIRST and call the server second, so a server-side 503 left a row carrying
// provider 'sslcommerz' orphaned on every attempt. The decisive assertion here
// is therefore an absence — after a refused attempt the table is exactly as it
// was, and no request left the device.
//
// The other half is what must NOT change. Historical attempts stay readable, a
// pending one can still be reconciled from its server order, the legacy local
// writer and the provider CHECK are untouched, and sale refunds — a different
// subsystem entirely — are not in this import graph at all (their own proof is
// db/b2-refunds.sqlite.test.ts, run unchanged).

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { asPaisa } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';

// Only the network edge is doubled, and it is doubled to PROVE it is unused:
// a refused payment must not reach the server at all.
const invoke = vi.hoisted(() => ({ invokeSyncWithClaimRefresh: vi.fn() }));
vi.mock('../sync/supabaseClient', () => ({
  requireSupabaseConfiguration: vi.fn(),
  supabase: {},
}));
vi.mock('../sync/invoke', () => ({
  invokeSyncWithClaimRefresh: invoke.invokeSyncWithClaimRefresh,
}));

const { db } = await import('./client');
const { shops, roles, users, billingAccounts, shopDirectory, paymentAttempts } = await import('./schema');
const {
  createPaymentAttempt,
  getPaymentAttempt,
  getPaymentAttemptByServerOrder,
  updatePaymentAttemptByServerOrder,
} = await import('./commercial');
const { initiatePlanPayment, isSubscriptionPaymentAvailable, PaymentUnavailableError } =
  await import('../sync/billing');

const SHOP_ID = '81111111-1111-4111-8111-111111111111';
const OWNER_ID = '82222222-2222-4222-8222-222222222222';
const ROLE_ID = '84444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '86666666-6666-4666-8666-666666666666';
const VERIFIED_ATTEMPT = '8a000000-0000-4000-8000-00000000000a';
const PENDING_ATTEMPT = '8b000000-0000-4000-8000-00000000000b';
const PENDING_ORDER = '8c000000-0000-4000-8000-00000000000c';
const AT = '2026-10-01T06:00:00.000Z';

function countAttempts(): number {
  return db.select().from(paymentAttempts).all().length;
}

beforeAll(() => {
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrationDir = resolve('apps/mobile/db/migrations');
  for (const file of readdirSync(migrationDir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(resolve(migrationDir, file), 'utf8'));
  }
  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Retirement Shop', phone: '01700000012', createdAt: AT, updatedAt: AT }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: AT, updatedAt: AT }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000012', pinHash: 'hash', pinSetAt: AT, roleId: ROLE_ID, isActive: true, createdAt: AT, updatedAt: AT }).run();
  db.insert(billingAccounts).values({ id: ACCOUNT_ID, principalOwnerUserId: OWNER_ID, primaryShopId: SHOP_ID, launchTrialGrantedAt: AT, createdAt: AT, updatedAt: AT }).run();
  // The directory row matters: getBillingAccountIdForShop reads it, and without
  // it initiatePlanPayment would fail at "connect to the internet first"
  // instead of at the retirement gate — which would make the no-row assertion
  // below pass for the wrong reason. A mutation check caught exactly that.
  db.insert(shopDirectory).values({ shopId: SHOP_ID, billingAccountId: ACCOUNT_ID, name: 'Retirement Shop', commercialStatus: 'active', createdAt: AT, updatedAt: AT }).run();
  // Two historical SSLCommerz attempts: one settled, one still awaiting its
  // callback. Retirement must preserve both.
  db.insert(paymentAttempts).values({
    id: VERIFIED_ATTEMPT, billingAccountId: ACCOUNT_ID, clientRequestId: 'historical-verified',
    tier: 'pro', billingCycle: 'monthly', amountPaisa: asPaisa(39_900), provider: 'sslcommerz',
    status: 'verified', serverOrderId: '8d000000-0000-4000-8000-00000000000d',
    createdAt: AT, updatedAt: AT,
  }).run();
  db.insert(paymentAttempts).values({
    id: PENDING_ATTEMPT, billingAccountId: ACCOUNT_ID, clientRequestId: 'historical-pending',
    tier: 'ultra', billingCycle: 'annual', amountPaisa: asPaisa(999_900), provider: 'sslcommerz',
    status: 'pending', serverOrderId: PENDING_ORDER,
    createdAt: AT, updatedAt: AT,
  }).run();
});

beforeEach(() => {
  invoke.invokeSyncWithClaimRefresh.mockReset();
});

describe('new subscription payment initiation', () => {
  it('reports no available payment provider', () => {
    expect(isSubscriptionPaymentAvailable()).toBe(false);
  });

  it('refuses with payment_not_configured, the same code the server answers', async () => {
    await expect(
      initiatePlanPayment({ shopId: SHOP_ID, tier: 'pro', billingCycle: 'monthly' }),
    ).rejects.toBeInstanceOf(PaymentUnavailableError);
    await expect(
      initiatePlanPayment({ shopId: SHOP_ID, tier: 'pro', billingCycle: 'monthly' }),
    ).rejects.toMatchObject({ code: 'payment_not_configured' });
  });

  it('creates NO local payment_attempts row on refusal', async () => {
    const before = countAttempts();
    await expect(
      initiatePlanPayment({ shopId: SHOP_ID, tier: 'ultra', billingCycle: 'annual' }),
    ).rejects.toThrow();
    expect(countAttempts()).toBe(before);
    // And nothing was created then abandoned in a 'created' state either.
    expect(db.select().from(paymentAttempts).where(eq(paymentAttempts.status, 'created')).all()).toEqual([]);
  });

  it('never reaches the server on refusal', async () => {
    await expect(
      initiatePlanPayment({ shopId: SHOP_ID, tier: 'pro', billingCycle: 'annual' }),
    ).rejects.toThrow();
    expect(invoke.invokeSyncWithClaimRefresh).not.toHaveBeenCalled();
  });

  it('activates nothing locally — no attempt is promoted', async () => {
    await expect(
      initiatePlanPayment({ shopId: SHOP_ID, tier: 'pro', billingCycle: 'monthly' }),
    ).rejects.toThrow();
    const statuses = db.select({ status: paymentAttempts.status }).from(paymentAttempts).all()
      .map((row) => row.status).sort();
    expect(statuses).toEqual(['pending', 'verified']);
  });

  it('refuses before reading the billing account, so an offline device gets the same answer', async () => {
    // getBillingAccountIdForShop would otherwise answer "connect to the
    // internet first", which is a different and misleading failure.
    await expect(
      initiatePlanPayment({ shopId: 'a-shop-that-does-not-exist', tier: 'pro', billingCycle: 'monthly' }),
    ).rejects.toBeInstanceOf(PaymentUnavailableError);
  });
});

describe('what retirement must not break', () => {
  it('keeps historical attempts readable, provider value and all', async () => {
    expect(await getPaymentAttempt(VERIFIED_ATTEMPT)).toMatchObject({
      id: VERIFIED_ATTEMPT, provider: 'sslcommerz', status: 'verified', amountPaisa: 39_900,
    });
    expect(await getPaymentAttemptByServerOrder(PENDING_ORDER)).toMatchObject({
      id: PENDING_ATTEMPT, provider: 'sslcommerz', status: 'pending',
    });
  });

  it('still reconciles a pending historical attempt from its server order', async () => {
    await updatePaymentAttemptByServerOrder(PENDING_ORDER, { status: 'verified', failureCode: null });
    expect(await getPaymentAttemptByServerOrder(PENDING_ORDER)).toMatchObject({ status: 'verified' });
    // Put it back, so no later test depends on the order this one ran in.
    await updatePaymentAttemptByServerOrder(PENDING_ORDER, { status: 'pending', failureCode: null });
  });

  it('leaves the legacy local writer and the provider CHECK in place', async () => {
    // Retired, not removed. createPaymentAttempt is no longer called by
    // initiatePlanPayment, but deleting it — or relaxing the column — would be
    // an unproven schema change on a money table.
    const created = await createPaymentAttempt({
      billingAccountId: ACCOUNT_ID, tier: 'pro', billingCycle: 'monthly',
      amountPaisa: asPaisa(39_900),
    });
    expect(await getPaymentAttempt(created.id)).toMatchObject({ provider: 'sslcommerz', status: 'created' });
    db.delete(paymentAttempts).where(eq(paymentAttempts.id, created.id)).run();
    expect(await getPaymentAttempt(created.id)).toBeUndefined();
  });

  it('shares no module with sale refunds', () => {
    const refunds = readFileSync(resolve('apps/mobile/db/refunds.ts'), 'utf8');
    expect(refunds).not.toMatch(/paymentAttempts/);
    expect(refunds).not.toMatch(/['"]\.\/commercial['"]/);
  });
});

describe('the retirement is in the source, not only in a comment', () => {
  it('refuses before the local write, not after it', () => {
    const source = readFileSync(resolve('apps/mobile/sync/billing.ts'), 'utf8');
    const gate = source.indexOf('if (!isSubscriptionPaymentAvailable())');
    const write = source.indexOf('await createPaymentAttempt(');
    expect(gate).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(write);
  });

  it('names no provider on the payment screen and gates its Pay button', () => {
    const screen = readFileSync(resolve('apps/mobile/app/settings/plan-payment.tsx'), 'utf8');
    // Comments are stripped first: the file EXPLAINS the retirement in prose,
    // and naming the retired provider there is the point. What must be gone is
    // the branding the owner sees.
    const rendered = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(rendered).not.toMatch(/Commerz/i);
    expect(screen).toMatch(/isSubscriptionPaymentAvailable\(\)/);
    expect(screen).toMatch(/disabled=\{!paymentAvailable/);
    // Both locales, because a Bangla-only owner must not be shown an English
    // dead end (W3-08's rule).
    expect(screen).toMatch(/Online payment is unavailable/);
    expect(screen).toMatch(/এখন অনলাইন পেমেন্ট করা যাচ্ছে না/);
  });
});
