import { requireSupabaseConfiguration, supabase } from './supabaseClient';

/**
 * `ownerUserId` binds this OTP-created auth account to the owner's app user and
 * attaches the synthetic email a later phone+PIN login needs. It is sent from
 * here because the users row itself has not synced up yet at this point in
 * registration — without it, the same owner logging in on a SECOND device would
 * mint a second auth identity, and the two would disagree about who owns the
 * shop. Optional on the server, so an older client still links.
 */
export async function linkDeviceToShop(shopId: string, ownerUserId?: string): Promise<void> {
  requireSupabaseConfiguration();
  const { error } = await supabase.functions.invoke('sync', {
    body: { action: 'link-device', shopId, ownerUserId },
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
