import { describe, expect, it } from 'vitest';
import {
  describeSessionClaims,
  hasResolvedIdentity,
  missingIdentityClaims,
  ownerSessionClaimProblems,
  readAccessTokenClaims,
} from './authClaims';

/**
 * The physical failure this exists for: an anonymous auth account that had
 * app_metadata.shop_id written on its USER ROW by link-device, but no
 * auth_bindings row — so the access-token hook had nothing to resolve and the
 * minted token carried no app_user_id. Every sync request then failed as
 * `hook_not_configured`, which blames the hook rather than the missing binding.
 *
 * Checking the user row could never have caught that. Checking the TOKEN does.
 */

/** An unsigned token shaped like the real thing; only the payload is read. */
function token(appMetadata: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'auth-1', app_metadata: appMetadata })}.sig`;
}

const FULL = {
  app_user_id: 'owner-1',
  principal_user_id: 'owner-1',
  shop_id: 'shop-1',
  role: 'owner',
  permission_version: 3,
  billing_account_id: 'account-1',
};

describe('reading B4 identity from a minted access token', () => {
  it('reads every claim the sync function requires', () => {
    expect(readAccessTokenClaims(token(FULL))).toEqual({
      appUserId: 'owner-1',
      principalUserId: 'owner-1',
      shopId: 'shop-1',
      role: 'owner',
      permissionVersion: 3,
      billingAccountId: 'account-1',
    });
  });

  it('requires principal_user_id explicitly instead of synthesizing it', () => {
    const claims = readAccessTokenClaims(token({ ...FULL, principal_user_id: undefined }));
    expect(claims.principalUserId).toBeNull();
    expect(hasResolvedIdentity(claims)).toBe(false);
    expect(missingIdentityClaims(claims)).toContain('principal_user_id');
  });

  it('recognises the exact broken session: shop_id present, identity absent', () => {
    // What an anonymous account looks like after link-device ran WITHOUT
    // ownerUserId — the state the physical device was stuck in.
    const claims = readAccessTokenClaims(token({ shop_id: 'shop-1' }));

    expect(claims.shopId).toBe('shop-1');
    expect(claims.appUserId).toBeNull();
    expect(claims.role).toBeNull();
    expect(hasResolvedIdentity(claims)).toBe(false);
    expect(missingIdentityClaims(claims)).toEqual([
      'app_user_id', 'principal_user_id', 'role', 'permission_version', 'billing_account_id',
    ]);
  });

  it('accepts a fully bound owner token', () => {
    const claims = readAccessTokenClaims(token(FULL));
    expect(hasResolvedIdentity(claims)).toBe(true);
    expect(missingIdentityClaims(claims)).toEqual([]);
  });

  it.each([
    ['principal_user_id', { ...FULL, principal_user_id: undefined }],
    ['billing_account_id', { ...FULL, billing_account_id: undefined }],
    ['permission_version', { ...FULL, permission_version: undefined }],
  ])('rejects an owner identity missing %s', (_claim, metadata) => {
    expect(hasResolvedIdentity(readAccessTokenClaims(token(metadata)))).toBe(false);
  });

  it('rejects a non-Owner role even when every claim exists', () => {
    expect(hasResolvedIdentity(readAccessTokenClaims(token({ ...FULL, role: 'staff' })))).toBe(false);
  });

  it('reports exact requested identity mismatches without exposing values', () => {
    const problems = ownerSessionClaimProblems(
      readAccessTokenClaims(token({ ...FULL, app_user_id: 'other-owner', shop_id: 'other-shop' })),
      { ownerUserId: 'owner-1', shopId: 'shop-1' },
    );
    expect(problems).toEqual(['shop_id_mismatch', 'app_user_id_mismatch']);
    expect(problems.join(' ')).not.toContain('owner-1');
    expect(problems.join(' ')).not.toContain('shop-1');
  });

  it('treats permission_version 0 as present, not missing', () => {
    // Zero is a legitimate starting version; a truthiness check would drop it
    // and make a healthy token look broken.
    const claims = readAccessTokenClaims(token({ ...FULL, permission_version: 0 }));
    expect(claims.permissionVersion).toBe(0);
    expect(missingIdentityClaims(claims)).toEqual([]);
  });

  it.each([
    ['no token at all', null],
    ['an empty string', ''],
    ['a non-JWT string', 'not-a-token'],
    ['a JWT with an unparseable payload', 'header.%%%.sig'],
  ])('degrades safely for %s', (_label, value) => {
    const claims = readAccessTokenClaims(value);
    expect(hasResolvedIdentity(claims)).toBe(false);
    expect(claims.appUserId).toBeNull();
  });

  it('summarises claims by name and role only, never by identifier', () => {
    const healthy = describeSessionClaims(readAccessTokenClaims(token(FULL)));
    expect(healthy).toContain('role=owner');
    expect(healthy).toContain('all B4 claims present');
    // Account identifiers must not end up in logcat.
    expect(healthy).not.toContain('owner-1');
    expect(healthy).not.toContain('account-1');

    const broken = describeSessionClaims(readAccessTokenClaims(token({ shop_id: 'shop-1' })));
    expect(broken).toContain('role=none');
    expect(broken).toContain('app_user_id');
    expect(broken).not.toContain('shop-1');
  });
});
