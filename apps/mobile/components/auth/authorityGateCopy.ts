import type { CatalogKey } from '../../i18n/catalog';
import type { SessionAuthorityReason } from '../../sync/sessionAuthority';
import type { AuthIconName } from './AuthIconTile';

// components/auth/authorityGateCopy.ts — what the H-10 gate SAYS for each
// reason it stays closed.
//
// The gate used to show "Checking your access…" for every one of these,
// forever, with no action. The decisions are unchanged (sync/sessionAuthority.ts
// makes them); this only names them, in words a pharmacist can act on.
//
// Only reasons that leave the gate closed WITH a session reach here:
// `unverified` outcomes other than the open offline window and the retrying
// refresh outage, plus a check that threw. A `revoked` outcome never does —
// the session is already gone and the PIN pad explains it
// (state/signOutNotice.ts).

export type AuthorityBlockReason = SessionAuthorityReason | 'check_failed';

export interface AuthorityBlockCopy {
  icon: AuthIconName;
  titleKey: CatalogKey;
  bodyKey: CatalogKey;
  /** The gate re-checks by itself on reconnect/foreground; say so. */
  autoRecheck: boolean;
}

/**
 * Mirrors MAX_OFFLINE_SESSION_DAYS (sync/sessionAuthority.ts) for the copy
 * only; authorityGateCopy.test.ts pins the two together. Not imported from
 * there so the gate screen does not drag the authority engine's SQLite and
 * network graph into every render path that shows it.
 */
export const OFFLINE_WINDOW_DAYS = 7;

const UNREADABLE: AuthorityBlockCopy = {
  icon: 'database-alert-outline',
  titleKey: 'gateUnreadableTitle',
  bodyKey: 'gateUnreadableBody',
  autoRecheck: false,
};

const UNKNOWN: AuthorityBlockCopy = {
  icon: 'shield-alert-outline',
  titleKey: 'gateUnknownTitle',
  bodyKey: 'gateUnknownBody',
  autoRecheck: false,
};

export function authorityBlockCopy(reason: AuthorityBlockReason): AuthorityBlockCopy {
  switch (reason) {
    case 'authority_absent':
      return { icon: 'wifi-off', titleKey: 'gateAbsentTitle', bodyKey: 'gateAbsentBody', autoRecheck: true };
    case 'offline_window_expired':
      return { icon: 'cloud-off-outline', titleKey: 'gateExpiredTitle', bodyKey: 'gateExpiredBody', autoRecheck: true };
    case 'clock_rolled_back':
      return { icon: 'clock-alert-outline', titleKey: 'gateClockTitle', bodyKey: 'gateClockBody', autoRecheck: false };
    case 'authority_corrupt':
    case 'authority_read_failed':
    case 'device_authority_read_failed':
      return UNREADABLE;
    default:
      return UNKNOWN;
  }
}
