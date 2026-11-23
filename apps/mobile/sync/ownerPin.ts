import { applyOwnerPinLocally, verifyOwnerCurrentPin } from '../db/settings';
import { assertCloudActorBinding, inspectCloudActorBinding } from './authActorBinding';
import { hasNetworkConnection } from './connectivity';
import { invokeSyncWithClaimRefresh, syncRefusalCode } from './invoke';

// sync/ownerPin.ts — the owner changes their PIN once, for every shop they
// run (migration 43, founder-approved plan 2026-11-23).
//
// Server-first, and so online-only. A multi-shop owner holds one actor row per
// shop, and this phone may not even hold all of them: only the server can
// check the new PIN against every person in every shop and write it to every
// owner row at once. A local-only change would leave the other shops on the
// old PIN — exactly the lockout this replaces.
//
// CLAUDE.md rule 8: the raw PINs go to bcrypt and to the HTTPS body, never to a
// log, an error message or the database.

export type OwnerPinChangeFailure =
  | 'wrong_current'
  | 'offline'
  | 'pin_in_use'
  | 'too_many_attempts'
  | 'failed';

export class OwnerPinChangeError extends Error {
  constructor(public readonly reason: OwnerPinChangeFailure) {
    super(`Owner PIN change failed: ${reason}`);
    this.name = 'OwnerPinChangeError';
  }
}

const SERVER_REFUSALS: Record<string, OwnerPinChangeFailure> = {
  owner_pin_refused: 'wrong_current',
  owner_pin_rate_limited: 'too_many_attempts',
  pin_in_use: 'pin_in_use',
};

export interface OwnerPinChangeDependencies {
  isOnline?: () => Promise<boolean>;
}

interface OwnerPinChangeResult {
  pinSetAt: string;
  actorUserIds: string[];
  /** Each actor's server permission_version after the write (may be partial). */
  permissionVersions: Record<string, number>;
}

/** Keeps only integer versions for actors the server actually wrote. */
function parseVersions(raw: unknown, actorUserIds: readonly string[]): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const versions: Record<string, number> = {};
  for (const id of actorUserIds) {
    const version = source[id];
    if (typeof version === 'number' && Number.isInteger(version)) versions[id] = version;
  }
  return versions;
}

function parseResult(data: unknown): OwnerPinChangeResult {
  const result = data as { pinSetAt?: unknown; actorUserIds?: unknown; permissionVersions?: unknown } | null;
  if (
    !result
    || typeof result.pinSetAt !== 'string'
    || !Array.isArray(result.actorUserIds)
    || !result.actorUserIds.every((id) => typeof id === 'string')
  ) {
    throw new OwnerPinChangeError('failed');
  }
  const actorUserIds = result.actorUserIds as string[];
  return {
    pinSetAt: result.pinSetAt,
    actorUserIds,
    permissionVersions: parseVersions(result.permissionVersions, actorUserIds),
  };
}

/**
 * Changes the owner's PIN in every one of their shops, then mirrors it onto
 * the owner rows this phone holds. Throws OwnerPinChangeError, whose `reason`
 * the screen words; nothing local changes unless the server accepted.
 */
export async function changeOwnerPinEverywhere(
  session: { shopId: string; userId: string },
  currentPin: string,
  newPin: string,
  dependencies: OwnerPinChangeDependencies = {},
): Promise<OwnerPinChangeResult> {
  // Owner-only and the current PIN, both on this phone before any request.
  let currentMatches: boolean;
  try {
    currentMatches = await verifyOwnerCurrentPin(session.userId, currentPin);
  } catch {
    throw new OwnerPinChangeError('failed');
  }
  if (!currentMatches) throw new OwnerPinChangeError('wrong_current');

  if (!await (dependencies.isOnline ?? hasNetworkConnection)()) {
    throw new OwnerPinChangeError('offline');
  }

  // The request acts as whoever the stored token names, so it must name the
  // signed-in owner — never a colleague's token left on a shared till.
  try {
    assertCloudActorBinding(
      await inspectCloudActorBinding({ userId: session.userId, shopId: session.shopId }),
      { userId: session.userId, shopId: session.shopId },
    );
  } catch {
    throw new OwnerPinChangeError('failed');
  }

  const { data, error } = await invokeSyncWithClaimRefresh({
    action: 'owner-pin-change',
    shopId: session.shopId,
    currentPin,
    newPin,
  });
  if (error) {
    const code = await syncRefusalCode(error);
    throw new OwnerPinChangeError((code && SERVER_REFUSALS[code]) || 'failed');
  }
  const result = parseResult(data);

  // The server has changed it. A failure here cannot undo that, so it is not
  // reported as a failed change: the next pull brings the same PIN down.
  await applyOwnerPinLocally(result.actorUserIds, newPin, result.pinSetAt, result.permissionVersions)
    .catch(() => 0);
  return result;
}
