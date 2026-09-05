import * as WebBrowser from 'expo-web-browser';

export interface HostedPaymentResult {
  status: 'verified' | 'failed' | 'canceled' | 'dismissed';
  orderId?: string;
}

export async function openHostedPayment(url: string): Promise<HostedPaymentResult> {
  if (!url.startsWith('https://')) throw new Error('Invalid payment URL');
  const result = await WebBrowser.openAuthSessionAsync(url, 'muthoy://settings/plan-payment', {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
  });
  if (result.type !== 'success') return { status: 'dismissed' };
  const returned = new URL(result.url);
  const status = returned.searchParams.get('status');
  const orderId = returned.searchParams.get('orderId') ?? undefined;
  return {
    status: status === 'verified' || status === 'failed' || status === 'canceled' ? status : 'dismissed',
    orderId,
  };
}
