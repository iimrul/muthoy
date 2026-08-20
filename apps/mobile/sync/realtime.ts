import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabaseClient';

// sync/realtime.ts — near-real-time inventory propagation between the shop's
// devices.
//
// Realtime is a SIGNAL here, never a data channel. The payload is discarded
// and the client reacts by running the incremental pull it already has, so
// there stays exactly ONE apply path (sync/pull.ts → db/sync-helpers.ts) where
// FK ordering, LWW, and ledger idempotency live. Applying CDC payloads
// directly would fork that logic and reintroduce, in a second place, precisely
// the divergence this ledger work exists to remove.
//
// Subscribing to `batches` rather than `inventory_movements` is deliberate:
// the ledger trigger bumps `batches.updated_at` on every applied delta, so one
// subscription covers sales, purchases, returns and adjustments alike, and the
// pull it triggers fetches the movements themselves in FK-safe order.

let channel: RealtimeChannel | null = null;

/**
 * Starts listening for this shop's stock changes.
 *
 * `onStockChanged` is invoked with no argument and must be cheap — the engine
 * passes its existing debounced pull trigger. Duplicate signals are harmless:
 * the pull is cursor-based and a no-op when nothing new is waiting.
 *
 * Silently does nothing when Supabase is unconfigured, matching the rest of
 * sync/: offline-first means every cloud capability is additive, and a shop
 * that never links a device must still sell all day.
 */
export function startInventoryRealtime(shopId: string, onStockChanged: () => void): void {
  if (!isSupabaseConfigured || channel) {
    return;
  }

  channel = supabase
    .channel(`inventory:${shopId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'batches',
        // Shop isolation is still enforced by RLS on the replication stream;
        // this filter narrows what this device is sent, it does not grant
        // anything. A device cannot subscribe its way into another shop.
        filter: `shop_id=eq.${shopId}`,
      },
      () => {
        onStockChanged();
      },
    )
    .subscribe();
}

/**
 * Tears the subscription down. Idempotent, and safe to call when nothing was
 * ever started — state/switchUser.ts's handover path and app/_layout.tsx's
 * cleanup both reach it, in either order.
 */
export function stopInventoryRealtime(): void {
  if (!channel) {
    return;
  }
  void supabase.removeChannel(channel);
  channel = null;
}
