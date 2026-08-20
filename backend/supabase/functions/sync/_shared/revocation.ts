export interface RevocationState {
  isActive: boolean;
  isDeleted: boolean;
  pinHash: string | null;
  roleId: string | null;
}

/**
 * Own-PIN changes invalidate the access-token claim but keep the refresh token
 * that belongs to the caller. Every other revocation still cuts all sessions.
 */
export function shouldGloballySignOut(
  targetUserId: string,
  callerUserId: string,
  before: RevocationState | null,
  after: RevocationState,
): boolean {
  if (!after.isActive || after.isDeleted) {
    return true;
  }
  if (!before) {
    return false;
  }

  const pinChanged = before.pinHash !== after.pinHash;
  const roleChanged = before.roleId !== after.roleId;
  const activeChanged = before.isActive !== after.isActive;
  const deletedChanged = before.isDeleted !== after.isDeleted;
  const ownPinOnly = targetUserId === callerUserId
    && pinChanged
    && !roleChanged
    && !activeChanged
    && !deletedChanged;

  return !ownPinOnly && (pinChanged || roleChanged || activeChanged || deletedChanged);
}
