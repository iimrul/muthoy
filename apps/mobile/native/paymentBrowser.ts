import * as WebBrowser from 'expo-web-browser';
import { ENVIRONMENT_POLICIES } from '../config/environmentPolicy';
import { readEnvironmentConfiguration } from './environmentIdentity';

export interface HostedPaymentResult {
  status: 'verified' | 'failed' | 'canceled' | 'dismissed';
  orderId?: string;
}

/**
 * The return link for THIS validated build variant. A DEV/preview build must
 * never wait on (or accept) the production app's `muthoy://` scheme. The server
 * return URL must match per variant before any payment is enabled there.
 */
function paymentReturnUrl(): string {
  return `${ENVIRONMENT_POLICIES[readEnvironmentConfiguration().appVariant].scheme}://settings/plan-payment`;
}

export async function openHostedPayment(url: string): Promise<HostedPaymentResult> {
  if (!url.startsWith('https://')) throw new Error('Invalid payment URL');
  const returnUrl = paymentReturnUrl();
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
  });
  if (result.type !== 'success' || result.url.split(/[?#]/)[0] !== returnUrl) return { status: 'dismissed' };
  const returned = new URL(result.url);
  const status = returned.searchParams.get('status');
  const orderId = returned.searchParams.get('orderId') ?? undefined;
  return {
    status: status === 'verified' || status === 'failed' || status === 'canceled' ? status : 'dismissed',
    orderId,
  };
}
