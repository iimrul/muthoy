import { useEffect, useState } from 'react';
import { getBillingAccountIdForShop, subscribeCommercialCache } from '../db/commercial';

/** Resolves the current shop's verified billing account from the SQLite cache. */
export function useBillingAccountId(shopId: string | undefined): {
  billingAccountId: string | null;
  loading: boolean;
} {
  const [snapshot, setSnapshot] = useState<{
    shopId: string | undefined;
    billingAccountId: string | null;
  }>({ shopId: undefined, billingAccountId: null });

  useEffect(() => {
    let current = true;
    const refresh = async () => {
      const next = shopId ? await getBillingAccountIdForShop(shopId) : null;
      if (current) setSnapshot({ shopId, billingAccountId: next });
    };
    // The session may predate B4. The verified SQLite projection, not the
    // optional persisted session claim, discovers its billing account.
    void refresh();
    const unsubscribe = subscribeCommercialCache(() => { void refresh(); });
    return () => { current = false; unsubscribe(); };
  }, [shopId]);

  const current = snapshot.shopId === shopId;
  return {
    billingAccountId: current ? snapshot.billingAccountId : null,
    loading: !current,
  };
}
