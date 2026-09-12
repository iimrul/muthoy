import { isStaffAuthoritativelyActive } from '../db/staff';
import { assertSessionLive } from '../db/errors';
import { generateId } from '../native/id';
import { useSessionStore } from '../state/sessionStore';
import { assertCloudActorBinding, inspectCloudActorBinding } from './authActorBinding';
import { invokeSyncWithClaimRefresh } from './invoke';
import { pullChanges } from './pull';
import { pushPendingRows } from './push';

/** Server-first: only a successful full hydration may activate SQLite. */
export async function reactivateStaffOnServer(
  shopId: string,
  staffUserId: string,
  isStillActive: () => boolean,
): Promise<void> {
  const session = useSessionStore.getState().session;
  if (!session || session.shopId !== shopId || session.role !== 'owner') {
    throw new Error('Owner access only.');
  }
  assertSessionLive(isStillActive);
  assertCloudActorBinding(
    await inspectCloudActorBinding({ userId: session.userId, shopId }),
    { userId: session.userId, shopId },
  );
  assertSessionLive(isStillActive);

  // A local deactivation may still be pending. Push it first so the server
  // observes false before the narrow false -> true RPC; otherwise an immediate
  // deactivate/activate sequence could hydrate the old active row and strand
  // the newer local false under LWW.
  const pushed = await pushPendingRows(shopId, () => !isStillActive());
  if (!pushed) throw new Error('Pending changes must sync before reactivation.');
  assertSessionLive(isStillActive);

  const { error } = await invokeSyncWithClaimRefresh({
    action: 'staff-reactivate',
    shopId,
    staffUserId,
    operationId: generateId(),
  });
  if (error) throw error;
  assertSessionLive(isStillActive);

  await pullChanges(shopId, null, () => !isStillActive());
  assertSessionLive(isStillActive);
  if (!await isStaffAuthoritativelyActive(shopId, staffUserId)) {
    throw new Error('Server did not restore this staff account.');
  }
  assertSessionLive(isStillActive);
}
