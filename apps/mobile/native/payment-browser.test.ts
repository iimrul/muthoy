import { afterEach, describe, expect, test, vi } from 'vitest';

// The hosted-payment return link must belong to THIS build variant. Before H-9
// every variant shared `muthoy://`; now a DEV/preview build waiting on that
// scheme would hand the payment result to the production app instead.
const browser = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: browser.open, WebBrowserPresentationStyle: { FULL_SCREEN: 'fullScreen' } }));
const ref = 'btfprhticjgeihcngpif';
const key = `e30.${Buffer.from(JSON.stringify({ role: 'anon', ref })).toString('base64url')}.fabricated`;
const checkout = 'https://sandbox.sslcommerz.com/gwprocess/v4/fabricated';

async function load(url = `https://${ref}.supabase.co`) {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', url);
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', key);
  return import('./paymentBrowser');
}
afterEach(() => { vi.unstubAllEnvs(); browser.open.mockReset(); });

describe('hosted payment return link follows the validated build variant', () => {
  test('a development build waits only for its own scheme', async () => {
    browser.open.mockResolvedValue({ type: 'success', url: 'muthoy-dev://settings/plan-payment?status=verified&orderId=order-1' });
    const { openHostedPayment } = await load();
    await expect(openHostedPayment(checkout)).resolves.toEqual({ status: 'verified', orderId: 'order-1' });
    expect(browser.open).toHaveBeenCalledWith(checkout, 'muthoy-dev://settings/plan-payment', expect.anything());
  });
  test.each([
    'muthoy://settings/plan-payment?status=verified&orderId=order-1',
    'muthoy-preview://settings/plan-payment?status=verified&orderId=order-1',
    'muthoy-dev://settings/plan-payment-elsewhere?status=verified&orderId=order-1',
  ])('a return on %s is never accepted as a result', async returned => {
    browser.open.mockResolvedValue({ type: 'success', url: returned });
    const { openHostedPayment } = await load();
    await expect(openHostedPayment(checkout)).resolves.toEqual({ status: 'dismissed' });
  });
  test('an unverified environment refuses before any browser opens', async () => {
    const { openHostedPayment } = await load('https://foreign.supabase.co');
    await expect(openHostedPayment(checkout)).rejects.toMatchObject({ code: 'configuration-invalid' });
    expect(browser.open).not.toHaveBeenCalled();
  });
});
