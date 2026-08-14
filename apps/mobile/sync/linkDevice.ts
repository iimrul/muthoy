import { requireSupabaseConfiguration, supabase } from './supabaseClient';

export async function linkDeviceToShop(shopId: string): Promise<void> {
  requireSupabaseConfiguration();
  const { error } = await supabase.functions.invoke('sync', {
    body: { action: 'link-device', shopId },
  });
  if (error) {
    throw error;
  }

  const { data, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    throw refreshError;
  }
  if (data.session?.user.app_metadata.shop_id !== shopId) {
    throw new Error('Refreshed Supabase session does not contain the linked shop.');
  }
}
