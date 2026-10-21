// W3-06 — the SSLCommerz callback pipeline, executed.
//
// SYNTHETIC ONLY. No merchant request, no real credential, no live endpoint:
// the provider config is a fabricated store id/password and every provider call
// is a double. Nothing here can reach sslcommerz.com.
//
// What this covers that sslcommerz.test.ts does not: the pipeline itself.
// index.ts used to call Deno.serve at import time, so the signature check, the
// body-size cap, the per-IP rate limit, the terminal cancel/fail branch and the
// idempotent apply were all unreachable from a test. The provider contract
// (hash scheme, paisa conversion, host allowlisting, verificationMatchesOrder)
// is already proven there and is not re-proven here.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  config: vi.fn(),
  validHash: vi.fn(),
  validate: vi.fn(),
  matches: vi.fn(),
}));

vi.mock('../sync/_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));

vi.mock('../sync/_shared/sslcommerz.ts', () => ({
  PaymentProviderError: class PaymentProviderError extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly code?: string,
    ) {
      super(message);
    }
  },
  sslCommerzConfig: mocks.config,
  validCallbackHash: mocks.validHash,
  validateSslCommerzPayment: mocks.validate,
  verificationMatchesOrder: mocks.matches,
}));

// The handler reads PAYMENT_APP_RETURN_URL through Deno.env for the browser
// redirect. Stubbed rather than bypassed, so the 303 target is really asserted.
const env = new Map<string, string>();
(globalThis as { Deno?: unknown }).Deno = {
  env: { get: (key: string) => env.get(key) },
};

const { handlePaymentWebhook, bodyFields, rateLimited } = await import('./handler.ts');

const ORDER_ID = '7a000000-0000-4000-8000-000000000001';
const TRANSACTION = 'MTH7a0000000000400080000000';
const VALIDATION = 'v-test-1';
const AMOUNT_PAISA = 39_900;

/** A chainable PostgREST double that answers one terminal result. */
function table(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'update', 'eq', 'in', 'upsert', 'insert', 'lte', 'order']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  return builder;
}

function post(
  body: string,
  options: { url?: string; contentType?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(options.url ?? 'https://project.functions.supabase.co/payment-webhook', {
    method: 'POST',
    headers: {
      'content-type': options.contentType ?? 'application/x-www-form-urlencoded',
      ...options.headers,
    },
    body,
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  env.clear();
  env.set('PAYMENT_APP_RETURN_URL', 'muthoy://settings/plan-payment');
  mocks.config.mockReturnValue({
    storeId: 'store',
    storePassword: 'secret',
    mode: 'sandbox',
    callbackBaseUrl: 'https://project.functions.supabase.co/payment-webhook',
  });
  mocks.validHash.mockReturnValue(true);
});

describe('request-level refusals', () => {
  it('refuses a non-POST method', async () => {
    const response = await handlePaymentWebhook(
      new Request('https://x.test/payment-webhook', { method: 'GET' }),
    );
    expect(response.status).toBe(405);
  });

  it('refuses a forged or missing callback signature before anything else', async () => {
    mocks.validHash.mockReturnValue(false);
    const response = await handlePaymentWebhook(post('val_id=v1&tran_id=MTH1'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/signature/i),
    });
    // Nothing was read or written: the signature gate is first for a reason.
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a body over the cap by declared length', async () => {
    const response = await handlePaymentWebhook(
      post('val_id=v1', { headers: { 'content-length': String(32 * 1024) } }),
    );
    expect(response.status).toBe(413);
  });

  it('refuses a body over the cap by actual size', async () => {
    const response = await handlePaymentWebhook(post(`val_id=${'x'.repeat(17 * 1024)}`));
    expect(response.status).toBe(413);
  });

  it('refuses a verified callback with no val_id that is not a terminal return', async () => {
    const response = await handlePaymentWebhook(post('tran_id=MTH1'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/val_id/) });
  });

  it('fails closed when the provider is not configured', async () => {
    const { PaymentProviderError } = await import('../sync/_shared/sslcommerz.ts');
    mocks.config.mockImplementation(() => {
      throw new PaymentProviderError(
        503,
        'Payment provider is not configured',
        'payment_not_configured',
      );
    });
    const response = await handlePaymentWebhook(post('val_id=v1'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'payment_not_configured' });
  });
});

describe('per-IP rate limit', () => {
  it('allows up to the limit and then answers 429', () => {
    const request = post('val_id=v1', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    const start = 1_000_000;
    for (let index = 0; index < 60; index += 1) {
      expect(rateLimited(request, start + index)).toBe(false);
    }
    expect(rateLimited(request, start + 60)).toBe(true);
  });

  it('counts each caller separately and forgets them after the window', () => {
    const first = post('val_id=v1', { headers: { 'x-forwarded-for': '198.51.100.1' } });
    const second = post('val_id=v1', { headers: { 'x-forwarded-for': '198.51.100.2' } });
    const start = 2_000_000;
    for (let index = 0; index < 60; index += 1) rateLimited(first, start + index);
    expect(rateLimited(first, start + 60)).toBe(true);
    // A different IP is unaffected…
    expect(rateLimited(second, start + 60)).toBe(false);
    // …and the window resets rather than banning for good.
    expect(rateLimited(first, start + 61_000)).toBe(false);
  });
});

describe('body parsing', () => {
  it('reads form-encoded callbacks', async () => {
    expect(await bodyFields(post('tran_id=MTH1&amount=399.00'))).toEqual({
      tran_id: 'MTH1',
      amount: '399.00',
    });
  });

  it('reads JSON callbacks and drops non-string values rather than coercing them', async () => {
    const fields = await bodyFields(
      post(JSON.stringify({ tran_id: 'MTH1', risk: 0, nested: { a: 1 } }), {
        contentType: 'application/json',
      }),
    );
    expect(fields).toEqual({ tran_id: 'MTH1' });
  });

  it('treats a JSON array or scalar as no fields at all', async () => {
    for (const body of ['[1,2,3]', '"a string"', 'null']) {
      expect(await bodyFields(post(body, { contentType: 'application/json' }))).toEqual({});
    }
  });
});

describe('terminal cancel / fail returns', () => {
  it('marks a cancelled order and redirects to the configured scheme only', async () => {
    mocks.from.mockReturnValueOnce(table({ data: { id: ORDER_ID }, error: null }));
    mocks.from.mockReturnValueOnce(table({ data: null, error: null }));

    const response = await handlePaymentWebhook(
      post(`value_a=${ORDER_ID}&tran_id=${TRANSACTION}`, {
        url: 'https://project.functions.supabase.co/payment-webhook?return=cancel',
      }),
    );

    expect(response.status).toBe(303);
    const location = response.headers.get('location')!;
    expect(location.startsWith('muthoy://settings/plan-payment')).toBe(true);
    expect(location).toContain('status=canceled');
    expect(location).toContain(`orderId=${ORDER_ID}`);
    // No entitlement may be granted on a terminal return.
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a terminal return for an order it cannot match', async () => {
    mocks.from.mockReturnValueOnce(table({ data: null, error: null }));
    const response = await handlePaymentWebhook(
      post(`value_a=${ORDER_ID}&tran_id=${TRANSACTION}`, {
        url: 'https://project.functions.supabase.co/payment-webhook?return=fail',
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a malformed order id rather than querying with it', async () => {
    const response = await handlePaymentWebhook(
      post('value_a=not-a-uuid&tran_id=MTH1', {
        url: 'https://project.functions.supabase.co/payment-webhook?return=cancel',
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe('verified payment finalization', () => {
  function validationResponse() {
    return {
      status: 'VALID',
      tran_id: TRANSACTION,
      val_id: VALIDATION,
      amount: '399.00',
      currency: 'BDT',
      risk_level: '0',
      value_a: ORDER_ID,
    };
  }

  function orderRow() {
    return {
      id: ORDER_ID,
      provider_transaction_id: TRANSACTION,
      amount_paisa: AMOUNT_PAISA,
      status: 'pending',
    };
  }

  it('applies exactly once, through b4_apply_verified_payment and nothing else', async () => {
    mocks.validate.mockResolvedValue(validationResponse());
    mocks.from.mockReturnValue(table({ data: orderRow(), error: null }));
    mocks.matches.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({ error: null });

    const response = await handlePaymentWebhook(post(`val_id=${VALIDATION}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = mocks.rpc.mock.calls[0]!;
    expect(fn).toBe('b4_apply_verified_payment');
    // The event key is NOT what deduplicates: the event row is identified by
    // (provider, validation_id), and the grant is suppressed by the order
    // already being 'verified'. The key is carried for traceability.
    expect(args).toMatchObject({
      p_payment_order_id: ORDER_ID,
      p_provider_transaction_id: TRANSACTION,
      p_validation_id: VALIDATION,
      p_event_key: `validation:${VALIDATION}`,
    });
  });

  /**
   * A faithful model of `b4_apply_verified_payment`'s two guards, read off
   * `20260831000000_b4_commercial_platform.sql`:
   *
   *   1. the event row upserts `on conflict (provider, validation_id)`, so a
   *      redelivery of the same `val_id` reuses one row;
   *   2. `if v_order.status = 'verified' then … return` — once the ORDER is
   *      verified, a later apply returns the existing snapshot and grants
   *      nothing.
   *
   * The no-double-charge guarantee is therefore the ORDER STATUS, not the event
   * key. An earlier version of this test modelled dedup on `p_event_key` and so
   * proved the wrong thing: it would have called two validations against one
   * already-verified order "two payments", which is the opposite of what the
   * database does.
   *
   * The guarantee itself is proven against real Postgres in
   * `backend/supabase/pgtest/b4.pgtest.ts` ("activates only a server-priced
   * verified payment and is idempotent on replay": `version` advances exactly
   * once, one `payment_provider_events` row). What THIS test owns is the
   * handler's side — that it sends the order id, transaction id and validation
   * id the server needs to apply those guards, and sends no amount of its own.
   */
  function fakeApply() {
    const events = new Map<string, string>();
    const orderStatus = new Map<string, string>();
    const grants: string[] = [];
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
      const orderId = args.p_payment_order_id as string;
      const validationId = args.p_validation_id as string;
      // The handler must never price the order: b4_apply_verified_payment reads
      // amount_paisa from payment_orders, so a tampered callback cannot raise it.
      expect(args.p_amount_paisa).toBeUndefined();
      events.set(validationId, orderId);
      if (orderStatus.get(orderId) === 'verified') return { error: null };
      orderStatus.set(orderId, 'verified');
      grants.push(orderId);
      return { error: null };
    });
    return { rpc, grants, events };
  }

  it('a redelivered callback grants ONCE, because the order is already verified', async () => {
    const apply = fakeApply();
    mocks.rpc.mockImplementation(apply.rpc);
    mocks.validate.mockResolvedValue(validationResponse());
    mocks.from.mockReturnValue(table({ data: orderRow(), error: null }));
    mocks.matches.mockReturnValue(true);

    // The provider redelivers three times, as it does when it does not get a
    // 200 quickly enough. Every delivery is byte-identical.
    await handlePaymentWebhook(post(`val_id=${VALIDATION}`));
    await handlePaymentWebhook(post(`val_id=${VALIDATION}`));
    await handlePaymentWebhook(post(`val_id=${VALIDATION}`));

    // The outcome, not the call count: the account was credited exactly once.
    expect(apply.grants).toEqual([ORDER_ID]);
    expect(apply.events.size).toBe(1);
  });

  it('two DIFFERENT orders are two payments, and neither is swallowed', async () => {
    // Two distinct orders, as a real second purchase would be — NOT two
    // validations against one order, which the database correctly grants once.
    const SECOND_ORDER = '7a000000-0000-4000-8000-000000000002';
    const SECOND_TRANSACTION = 'MTH7a0000000000400080000002';
    const SECOND_VALIDATION = 'v-test-2';

    const apply = fakeApply();
    mocks.rpc.mockImplementation(apply.rpc);
    mocks.matches.mockReturnValue(true);

    mocks.validate.mockResolvedValue(validationResponse());
    mocks.from.mockReturnValue(table({ data: orderRow(), error: null }));
    await handlePaymentWebhook(post(`val_id=${VALIDATION}`));

    mocks.validate.mockResolvedValue({
      ...validationResponse(),
      val_id: SECOND_VALIDATION,
      tran_id: SECOND_TRANSACTION,
      value_a: SECOND_ORDER,
    });
    mocks.from.mockReturnValue(
      table({
        data: {
          ...orderRow(),
          id: SECOND_ORDER,
          provider_transaction_id: SECOND_TRANSACTION,
        },
        error: null,
      }),
    );
    await handlePaymentWebhook(post(`val_id=${SECOND_VALIDATION}`));

    expect(apply.grants).toEqual([ORDER_ID, SECOND_ORDER]);
    expect(apply.events.size).toBe(2);
  });

  it('sends the validation-derived event key and the order transaction id', async () => {
    // The handler's own contract: the server applies its guards from these
    // three fields, so sending a per-delivery key or a mismatched transaction
    // id would break deduplication from the client side.
    mocks.validate.mockResolvedValue(validationResponse());
    mocks.from.mockReturnValue(table({ data: orderRow(), error: null }));
    mocks.matches.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({ error: null });

    await handlePaymentWebhook(post(`val_id=${VALIDATION}`));
    await handlePaymentWebhook(post(`val_id=${VALIDATION}`));

    const keys = mocks.rpc.mock.calls.map(
      ([, args]) => (args as { p_event_key: string }).p_event_key,
    );
    expect(new Set(keys)).toEqual(new Set([`validation:${VALIDATION}`]));
    for (const [, args] of mocks.rpc.mock.calls) {
      expect(args).toMatchObject({
        p_payment_order_id: ORDER_ID,
        p_provider_transaction_id: TRANSACTION,
        p_validation_id: VALIDATION,
      });
    }
  });

  it('records a tampered amount as rejected and grants nothing', async () => {
    mocks.validate.mockResolvedValue({ ...validationResponse(), amount: '1.00' });
    const upsertTable = table({ data: null, error: null });
    mocks.from.mockReturnValueOnce(table({ data: orderRow(), error: null }));
    mocks.from.mockReturnValueOnce(upsertTable);
    mocks.matches.mockReturnValue(false);

    const response = await handlePaymentWebhook(post(`val_id=${VALIDATION}`));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(upsertTable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        processing_status: 'rejected',
        error_code: 'verification_mismatch',
        validation_id: VALIDATION,
      }),
      expect.objectContaining({ onConflict: 'provider,validation_id' }),
    );
  });

  it('refuses a val_id that matches no known order', async () => {
    mocks.validate.mockResolvedValue(validationResponse());
    mocks.from.mockReturnValue(table({ data: null, error: null }));

    const response = await handlePaymentWebhook(post(`val_id=${VALIDATION}`));

    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('answers 500 without leaking the cause when the apply fails', async () => {
    mocks.validate.mockResolvedValue(validationResponse());
    mocks.from.mockReturnValue(table({ data: orderRow(), error: null }));
    mocks.matches.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({
      error: { message: 'relation "payment_orders" does not exist', code: '42P01' },
    });

    const response = await handlePaymentWebhook(post(`val_id=${VALIDATION}`));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('42P01');
    expect(text).not.toContain('relation');
  });

  it('redirects the browser on a success return instead of answering JSON', async () => {
    mocks.validate.mockResolvedValue(validationResponse());
    mocks.from.mockReturnValue(table({ data: orderRow(), error: null }));
    mocks.matches.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({ error: null });

    const response = await handlePaymentWebhook(
      post(`val_id=${VALIDATION}`, {
        url: 'https://project.functions.supabase.co/payment-webhook?return=success',
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('status=verified');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the handler carries no credential into its own responses', () => {
  it('never echoes the store password, in any branch', async () => {
    mocks.validate.mockResolvedValue({ status: 'FAILED', tran_id: TRANSACTION });
    mocks.from.mockReturnValue(table({ data: null, error: null }));

    const responses = await Promise.all([
      handlePaymentWebhook(post(`val_id=${VALIDATION}`)),
      handlePaymentWebhook(post('tran_id=MTH1')),
      handlePaymentWebhook(new Request('https://x.test/payment-webhook', { method: 'GET' })),
    ]);

    for (const response of responses) {
      expect(await response.text()).not.toContain('secret');
    }
  });
});
