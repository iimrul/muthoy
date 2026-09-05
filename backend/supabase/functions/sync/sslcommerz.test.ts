import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createSslCommerzSession,
  isAllowedCheckoutUrl,
  paisaToProviderAmount,
  providerAmountToPaisa,
  sslCommerzConfig,
  validCallbackHash,
  verificationMatchesOrder,
  type SslCommerzConfig,
} from './_shared/sslcommerz.ts';

const config: SslCommerzConfig = {
  storeId: 'store', storePassword: 'secret', mode: 'sandbox',
  callbackBaseUrl: 'https://project.functions.supabase.co/payment-webhook',
};

describe('SSLCommerz boundary', () => {
  it('fails closed when provider configuration is incomplete', () => {
    expect(() => sslCommerzConfig(() => undefined)).toThrow(/not configured/i);
    expect(() => sslCommerzConfig((name) => name === 'SSLCOMMERZ_STORE_ID' ? 'store' : undefined)).toThrow(/not configured/i);
  });

  it('converts integer paisa without floating point money', () => {
    expect(paisaToProviderAmount(39_900)).toBe('399.00');
    expect(providerAmountToPaisa('399.00')).toBe(39_900);
    expect(providerAmountToPaisa('399.5')).toBe(39_950);
    expect(providerAmountToPaisa('399.999')).toBeNull();
  });

  it('builds the hosted checkout server-side with callbacks and opaque order identity', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('store_passwd')).toBe('secret');
      expect(form.get('total_amount')).toBe('399.00');
      expect(form.get('value_a')).toBe('order-1');
      expect(form.get('success_url')).toContain('return=success');
      return new Response(JSON.stringify({ sessionkey: 'session', GatewayPageURL: 'https://sandbox.sslcommerz.com/pay' }));
    }) as typeof fetch;
    await expect(createSslCommerzSession({
      config, transactionId: 'MTH123', orderId: 'order-1', amountPaisa: 39_900,
      planLabel: 'Muthoy Pro', customerName: 'Owner', customerEmail: 'owner@example.com',
      customerPhone: '01700000000', fetcher,
    })).resolves.toEqual({ sessionKey: 'session', gatewayPageUrl: 'https://sandbox.sslcommerz.com/pay' });
  });

  it('rejects checkout redirects outside the configured SSLCommerz host', async () => {
    expect(isAllowedCheckoutUrl('https://sandbox.sslcommerz.com/pay', 'sandbox')).toBe(true);
    expect(isAllowedCheckoutUrl('https://securepay.sslcommerz.com/pay', 'live')).toBe(true);
    expect(isAllowedCheckoutUrl('https://sandbox.sslcommerz.com.evil.test/pay', 'sandbox')).toBe(false);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      sessionkey: 'session', GatewayPageURL: 'https://evil.test/pay',
    }))) as typeof fetch;
    await expect(createSslCommerzSession({
      config, transactionId: 'MTH123', orderId: 'order-1', amountPaisa: 39_900,
      planLabel: 'Muthoy Pro', customerName: 'Owner', customerEmail: 'owner@example.com',
      customerPhone: '01700000000', fetcher,
    })).rejects.toThrow(/rejected/i);
  });

  it('rejects missing or forged callback signatures', () => {
    expect(validCallbackHash({}, config.storePassword)).toBe(false);
    expect(validCallbackHash({ verify_key: 'tran_id', tran_id: 'MTH123', verify_sign: '0'.repeat(32) }, config.storePassword)).toBe(false);
  });

  it('accepts the provider callback hash contract', () => {
    const fields = { tran_id: 'MTH123', amount: '399.00', verify_key: 'tran_id,amount' };
    const passwordHash = createHash('md5').update(config.storePassword).digest('hex');
    const verifySign = createHash('md5').update(`tran_id=MTH123&amount=399.00&store_passwd=${passwordHash}`).digest('hex');
    expect(validCallbackHash({ ...fields, verify_sign: verifySign }, config.storePassword)).toBe(true);
  });

  it('accepts only verified, exact transaction/order/amount/currency, low-risk responses', () => {
    const order = { id: 'order-1', transactionId: 'MTH123', amountPaisa: 39_900 };
    const valid = { status: 'VALID', tran_id: 'MTH123', val_id: 'v1', amount: '399.00', currency: 'BDT', risk_level: '0', value_a: 'order-1' };
    expect(verificationMatchesOrder(valid, order, 'v1')).toBe(true);
    expect(verificationMatchesOrder(valid, order, 'other-validation')).toBe(false);
    expect(verificationMatchesOrder({ ...valid, amount: '499.00' }, order, 'v1')).toBe(false);
    expect(verificationMatchesOrder({ ...valid, tran_id: 'other' }, order, 'v1')).toBe(false);
    expect(verificationMatchesOrder({ ...valid, risk_level: '1' }, order, 'v1')).toBe(false);
    expect(verificationMatchesOrder({ ...valid, status: 'PENDING' }, order, 'v1')).toBe(false);
  });
});
