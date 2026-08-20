import { describe, expect, it } from 'vitest';
import { shouldGloballySignOut, type RevocationState } from './_shared/revocation';
import { classifySyncSqlError } from './_shared/syncErrors';

const active: RevocationState = {
  isActive: true,
  isDeleted: false,
  pinHash: 'old-hash',
  roleId: 'staff-role',
};

describe('sync SQLSTATE classification', () => {
  it.each(['MU010', 'MU011', 'MU012', 'MU013', 'MU014', 'MU015'])(
    'treats %s as a permanent row rejection without halting unrelated rows',
    (code) => {
      expect(classifySyncSqlError(code)).toEqual({ reason: 'permanent', haltBatch: false });
    },
  );

  it('keeps inventory-ledger MU005 transient', () => {
    expect(classifySyncSqlError('MU005')).toEqual({ reason: 'transient', haltBatch: true });
  });
});

describe('session revocation', () => {
  it('keeps the current auth session refreshable for an own-PIN-only change', () => {
    expect(shouldGloballySignOut(
      'caller',
      'caller',
      active,
      { ...active, pinHash: 'new-hash' },
    )).toBe(false);
  });

  it('still globally signs out another user after a PIN reset', () => {
    expect(shouldGloballySignOut(
      'staff',
      'owner',
      active,
      { ...active, pinHash: 'new-hash' },
    )).toBe(true);
  });

  it('still globally signs out deactivation, deletion and role changes', () => {
    expect(shouldGloballySignOut('staff', 'owner', active, { ...active, isActive: false })).toBe(true);
    expect(shouldGloballySignOut('staff', 'owner', active, { ...active, isDeleted: true })).toBe(true);
    expect(shouldGloballySignOut('staff', 'owner', active, { ...active, roleId: 'owner-role' })).toBe(true);
  });
});
