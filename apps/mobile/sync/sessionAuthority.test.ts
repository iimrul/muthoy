import { describe, expect, it, vi } from 'vitest';
import type { LocalActorAuthority } from '../db/auth';
import type { SessionClaims } from './authClaims';
import type { SessionAuthorityLeaseState } from './sessionAuthorityStore';
import {
  MAX_OFFLINE_SESSION_DAYS,
  MAX_OFFLINE_SESSION_MS,
  evaluateSessionAuthority,
  type SessionAuthorityInput,
} from './sessionAuthority';

// This suite exercises the pure evaluator. Loading db/auth would also load the
// native bcrypt bridge, which belongs to the SQLite/auth integration suites.
vi.mock('../db/auth', () => ({ readLocalActorAuthority: vi.fn() }));
vi.mock('./connectivity', () => ({ networkReachability: vi.fn() }));
vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: false,
  supabase: { auth: { refreshSession: vi.fn() } },
}));

const NOW = 1_800_000_000_000;
const SESSION = {
  userId: 'actor-1', shopId: 'shop-1', role: 'staff',
  principalUserId: 'principal-1', billingAccountId: 'account-1',
};

function local(overrides: Partial<LocalActorAuthority> = {}): LocalActorAuthority {
  return {
    userId: 'actor-1', shopId: 'shop-1', roleName: 'staff', permissionVersion: 3,
    isActive: true, isDeleted: false, isAccessLocked: false,
    principalUserId: 'principal-1', billingAccountId: 'account-1', ...overrides,
  };
}

function claims(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    appUserId: 'actor-1', principalUserId: 'principal-1', shopId: 'shop-1',
    role: 'staff', permissionVersion: 3, billingAccountId: 'account-1',
    isActive: true, issuedAt: 1_800_000_000, ...overrides,
  };
}

function lease(
  confirmedAtMs = NOW - 1_000,
  highWaterAtMs = NOW - 1_000,
): Extract<SessionAuthorityLeaseState, { status: 'valid' }> {
  return {
    status: 'valid' as const,
    record: { v: 1 as const, confirmedAtMs, highWaterAtMs, quarantineReason: null },
  };
}

function evaluate(overrides: Partial<SessionAuthorityInput> = {}) {
  return evaluateSessionAuthority({
    claims: null,
    session: SESSION,
    local: local(),
    lease: lease(),
    nowMs: NOW,
    freshServerResponse: false,
    ...overrides,
  });
}

describe('the exact seven-day offline lease', () => {
  it('pins the policy to literals', () => {
    expect(MAX_OFFLINE_SESSION_DAYS).toBe(7);
    expect(MAX_OFFLINE_SESSION_MS).toBe(604_800_000);
  });

  it('allows one millisecond before the boundary', () => {
    expect(evaluate({ lease: lease(NOW - MAX_OFFLINE_SESSION_MS + 1) }))
      .toEqual({ status: 'unverified', reason: 'offline_window_open' });
  });

  it('denies exactly at seven days', () => {
    expect(evaluate({ lease: lease(NOW - MAX_OFFLINE_SESSION_MS) }))
      .toEqual({ status: 'unverified', reason: 'offline_window_expired' });
  });

  it.each([
    ['absent', { status: 'absent', record: null }],
    ['corrupt', { status: 'corrupt', record: null }],
  ] as const)('denies a %s authority record', (_label, state) => {
    expect(evaluate({ lease: state }).status).toBe('unverified');
  });

  it('denies a persisted quarantine', () => {
    const state = lease();
    state.record.quarantineReason = 'actor_mismatch';
    expect(evaluate({ lease: state })).toEqual({
      status: 'revoked', reason: 'authority_quarantined',
    });
  });

  it('detects rollback from a previous day even while still after confirmation', () => {
    expect(evaluate({
      nowMs: NOW - 5 * 86_400_000,
      lease: lease(NOW - 6 * 86_400_000, NOW - 86_400_000),
    })).toEqual({ status: 'unverified', reason: 'clock_rolled_back' });
  });

  it('does not let a fresh server response erase a persisted clock rollback', () => {
    expect(evaluate({
      claims: claims(),
      freshServerResponse: true,
      nowMs: NOW - 5 * 86_400_000,
      lease: lease(NOW - 6 * 86_400_000, NOW - 86_400_000),
    })).toEqual({ status: 'unverified', reason: 'clock_rolled_back' });
  });

  it('lets a fresh server confirmation recover an absent lease', () => {
    expect(evaluate({
      claims: claims(), freshServerResponse: true,
      lease: { status: 'absent', record: null },
    })).toEqual({ status: 'confirmed', reason: 'claims_match' });
  });

  it('does not convert an attempted refresh failure into offline authority', () => {
    expect(evaluate({ refreshUnavailable: true })).toEqual({
      status: 'unverified', reason: 'authority_refresh_unavailable',
    });
  });

  it('does not let routine fresh validation clear quarantine', () => {
    const state = lease();
    state.record.quarantineReason = 'actor_mismatch';
    expect(evaluate({ claims: claims(), freshServerResponse: true, lease: state }))
      .toEqual({ status: 'revoked', reason: 'authority_quarantined' });
    expect(evaluate({
      claims: claims(), freshServerResponse: true, lease: state,
      allowQuarantineRecovery: true,
    })).toEqual({ status: 'confirmed', reason: 'claims_match' });
  });
});

describe('complete local and server identity', () => {
  it.each([
    ['missing actor', null, 'actor_not_local'],
    ['deleted actor', local({ isDeleted: true }), 'actor_inactive'],
    ['inactive actor', local({ isActive: false }), 'actor_inactive'],
    ['H-7 locked actor', local({ isAccessLocked: true }), 'actor_inactive'],
    ['missing role', local({ roleName: null }), 'actor_role_missing'],
    ['missing principal', local({ principalUserId: null }), 'membership_missing'],
    ['missing billing', local({ billingAccountId: null }), 'membership_missing'],
  ] as const)('denies %s', (_label, row, reason) => {
    expect(evaluate({ local: row }).reason).toBe(reason);
  });

  it.each([
    ['principal', { principalUserId: 'principal-2' }, 'principal_mismatch'],
    ['billing', { billingAccountId: 'account-2' }, 'billing_account_mismatch'],
    ['missing principal', { principalUserId: undefined }, 'principal_mismatch'],
    ['missing billing', { billingAccountId: undefined }, 'billing_account_mismatch'],
  ] as const)('denies persisted session %s mismatch', (_label, changed, reason) => {
    expect(evaluate({ session: { ...SESSION, ...changed } }).reason).toBe(reason);
  });

  it.each([
    ['actor', { appUserId: 'actor-2' }, 'actor_mismatch'],
    ['principal', { principalUserId: 'principal-2' }, 'principal_mismatch'],
    ['shop', { shopId: 'shop-2' }, 'shop_mismatch'],
    ['role', { role: 'owner' }, 'role_mismatch'],
    ['active', { isActive: false }, 'actor_inactive'],
    ['permission version', { permissionVersion: 4 }, 'permission_version_mismatch'],
    ['billing', { billingAccountId: 'account-2' }, 'billing_account_mismatch'],
  ] as const)('denies fresh %s mismatch', (_label, changed, reason) => {
    expect(evaluate({ claims: claims(changed), freshServerResponse: true }).reason).toBe(reason);
  });

  it.each([
    ['actor', { appUserId: null }],
    ['principal', { principalUserId: null }],
    ['shop', { shopId: null }],
    ['role', { role: null }],
    ['active', { isActive: null }],
    ['permission version', { permissionVersion: null }],
    ['billing', { billingAccountId: null }],
    ['issued at', { issuedAt: null }],
  ] as const)('denies a fresh token missing %s', (_label, changed) => {
    expect(evaluate({ claims: claims(changed), freshServerResponse: true }))
      .toEqual({ status: 'revoked', reason: 'claims_incomplete' });
  });
});
