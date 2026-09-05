import { useEffect, useState } from 'react';
import {
  readHydrationStatus,
  subscribeHydrationStatus,
  type HydrationStatus,
} from '../sync/billingHydration';

/**
 * How the CURRENT ATTEMPT to verify the plan is going — distinct from usePlan,
 * which reports the entitlement that verification eventually produces.
 *
 * The two answer different questions, and conflating them is what put "sync
 * online once" in front of an owner who was already online: usePlan can only
 * say "no verified entitlement", never why not.
 */
export function usePlanVerification(): HydrationStatus {
  const [status, setStatus] = useState<HydrationStatus>(readHydrationStatus);
  useEffect(() => subscribeHydrationStatus(setStatus), []);
  return status;
}
