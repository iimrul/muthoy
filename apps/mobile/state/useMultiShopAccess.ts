import { useEffect, useState } from 'react';
import { readMultiShopContext, subscribeCommercialCache, type MultiShopContext } from '../db/commercial';
import { useSessionStore } from './sessionStore';

export interface MultiShopAccess extends MultiShopContext {
  /** Owner role AND a premium (or trial) entitlement. */
  allowed: boolean;
  /** Prototype's `hasMultipleShops()` — drives switcher/More-tile visibility. */
  hasMultipleShops: boolean;
  loading: boolean;
}

const DENIED: MultiShopContext = { entitled: false, primaryShopId: null, liveShopCount: 0 };

/**
 * Single source for "may this user see and use multi-shop". Reads the verified
 * SQLite projection, never the persisted session claim, and starts denied so a
 * first paint can never flash an entry point the plan does not cover.
 */
export function useMultiShopAccess(): MultiShopAccess {
  const shopId = useSessionStore((state) => state.session?.shopId);
  const isOwner = useSessionStore((state) => state.session?.role === 'owner');
  const epoch = useSessionStore((state) => state.epoch);
  const [snapshot, setSnapshot] = useState<{ epoch: number; isOwner: boolean; shopId: string | undefined; context: MultiShopContext }>({
    epoch: -1,
    isOwner: false,
    shopId: undefined,
    context: DENIED,
  });

  useEffect(() => {
    // Staff and Manager never own multi-shop context: this owner-wide
    // shop/primary-shop read must not run on their behalf at all. The role
    // check gates the effect itself, before it ever touches SQLite.
    if (!isOwner) {
      return;
    }
    let current = true;
    const refresh = async () => {
      const context = shopId ? await readMultiShopContext(shopId) : DENIED;
      if (current) setSnapshot({ epoch, isOwner, shopId, context });
    };
    void refresh();
    const unsubscribe = subscribeCommercialCache(() => { void refresh(); });
    return () => { current = false; unsubscribe(); };
  }, [epoch, isOwner, shopId]);

  const settled = snapshot.epoch === epoch && snapshot.isOwner === isOwner && snapshot.shopId === shopId;
  const context = settled ? snapshot.context : DENIED;
  return {
    ...context,
    allowed: isOwner && context.entitled,
    hasMultipleShops: context.liveShopCount > 1,
    loading: isOwner && !settled,
  };
}
