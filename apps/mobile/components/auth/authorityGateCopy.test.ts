import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../i18n/catalog';
import { signOutNoticeKindFor } from '../../state/signOutNotice';
import { authorityBlockCopy, OFFLINE_WINDOW_DAYS } from './authorityGateCopy';

describe('H-10 gate copy', () => {
  it('states the same offline window the authority engine enforces', () => {
    // The copy keeps its own constant so the gate screen does not import the
    // engine; this is what stops the two from drifting. Read as source: the
    // engine module reaches React Native, which a node suite cannot load.
    const engine = readFileSync(resolve('apps/mobile/sync/sessionAuthority.ts'), 'utf8');
    const days = /export const MAX_OFFLINE_SESSION_DAYS = (\d+);/.exec(engine)?.[1];
    expect(days).toBeDefined();
    expect(OFFLINE_WINDOW_DAYS).toBe(Number(days));
  });

  it.each([
    ['authority_absent', 'gateAbsentTitle', true],
    ['offline_window_expired', 'gateExpiredTitle', true],
    ['clock_rolled_back', 'gateClockTitle', false],
    ['authority_read_failed', 'gateUnreadableTitle', false],
    ['authority_corrupt', 'gateUnreadableTitle', false],
    ['device_authority_read_failed', 'gateUnreadableTitle', false],
    ['check_failed', 'gateUnknownTitle', false],
  ] as const)('gives %s its own explanation', (reason, titleKey, autoRecheck) => {
    const copy = authorityBlockCopy(reason);
    expect(copy.titleKey).toBe(titleKey);
    expect(copy.autoRecheck).toBe(autoRecheck);
    expect(catalog.bn[copy.titleKey]).toBeTruthy();
    expect(catalog.bn[copy.bodyKey]).toBeTruthy();
  });

  it('falls back to a generic, still-closed explanation for anything unforeseen', () => {
    expect(authorityBlockCopy('membership_missing').titleKey).toBe('gateUnknownTitle');
  });

  it('fills the offline window in both languages', () => {
    expect(catalog.en.gateExpiredBody).toContain('{days}');
    expect(catalog.bn.gateExpiredBody).toContain('{days}');
  });
});

describe('sign-out notice categories', () => {
  it.each([
    ['device_revoked', 'device_revoked'],
    ['binding_revoked', 'binding_revoked'],
    ['auth_session_invalid', 'session_ended'],
    ['claims_incomplete', 'session_ended'],
    ['authority_quarantined', 'session_ended'],
    ['actor_inactive', 'access_changed'],
    ['role_mismatch', 'access_changed'],
    ['permission_version_mismatch', 'access_changed'],
    ['billing_account_mismatch', 'access_changed'],
    ['membership_missing', 'access_changed'],
  ] as const)('shows %s as %s, never as its code', (reason, kind) => {
    expect(signOutNoticeKindFor(reason)).toBe(kind);
  });
});
