/**
 * Reads the B4 claims out of an access token the CLIENT already holds.
 *
 * Deliberately not a verification: Supabase minted and signed the token, and
 * the server re-verifies it on every request. What the device needs is the
 * ability to answer "did the auth hook actually decorate this token, or am I
 * holding a bare anonymous session?" — because those two look identical until a
 * request fails, and the failure they produce (`hook_not_configured`) names the
 * wrong culprit: the hook is usually fine, this account simply has no
 * auth_bindings row for the hook to resolve.
 */

export interface SessionClaims {
  appUserId: string | null;
  principalUserId: string | null;
  shopId: string | null;
  role: string | null;
  permissionVersion: number | null;
  billingAccountId: string | null;
}

const EMPTY: SessionClaims = {
  appUserId: null,
  principalUserId: null,
  shopId: null,
  role: null,
  permissionVersion: null,
  billingAccountId: null,
};

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    const decoded: unknown = JSON.parse(json);
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function text(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readAccessTokenClaims(accessToken: string | null | undefined): SessionClaims {
  if (!accessToken) return EMPTY;
  const payload = accessToken.split('.')[1];
  if (!payload) return EMPTY;
  const claims = decodeSegment(payload);
  if (!claims) return EMPTY;

  const raw = claims.app_metadata;
  const metadata: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const version = metadata.permission_version;

  return {
    appUserId: text(metadata, 'app_user_id'),
    // Owner-link completion requires this claim to be present in the minted
    // token itself. Do not synthesize it from app_user_id: doing so would hide
    // an incomplete hook result and falsely mark the device linked.
    principalUserId: text(metadata, 'principal_user_id'),
    shopId: text(metadata, 'shop_id'),
    role: text(metadata, 'role'),
    permissionVersion: typeof version === 'number' ? version : null,
    billingAccountId: text(metadata, 'billing_account_id'),
  };
}

/**
 * True only for a complete Owner identity. Exact shop/user matching belongs to
 * ownerSessionClaimProblems because it needs the requested link target.
 */
export function hasResolvedIdentity(claims: SessionClaims): boolean {
  return missingIdentityClaims(claims).length === 0 && claims.role === 'owner';
}

/** Which required claims are absent — safe to log: names only, no values. */
export function missingIdentityClaims(claims: SessionClaims): readonly string[] {
  return [
    ...(claims.appUserId ? [] : ['app_user_id']),
    ...(claims.principalUserId ? [] : ['principal_user_id']),
    ...(claims.shopId ? [] : ['shop_id']),
    ...(claims.role ? [] : ['role']),
    ...(claims.permissionVersion === null ? ['permission_version'] : []),
    ...(claims.billingAccountId ? [] : ['billing_account_id']),
  ];
}

export type OwnerSessionClaimProblem =
  | ReturnType<typeof missingIdentityClaims>[number]
  | 'role_not_owner'
  | 'shop_id_mismatch'
  | 'app_user_id_mismatch'
  | 'principal_user_id_mismatch';

/**
 * Safe, value-free postcondition for the refreshed Owner token.
 *
 * Supabase verifies the refreshed token. This function verifies that the
 * access-token hook decorated that exact token with every commercial identity
 * claim and that it resolved the same Owner/shop the client asked to link.
 */
export function ownerSessionClaimProblems(
  claims: SessionClaims,
  expected: { shopId: string; ownerUserId: string },
): readonly OwnerSessionClaimProblem[] {
  const problems: OwnerSessionClaimProblem[] = [...missingIdentityClaims(claims)];
  if (claims.role && claims.role !== 'owner') problems.push('role_not_owner');
  if (claims.shopId && claims.shopId !== expected.shopId) problems.push('shop_id_mismatch');
  if (claims.appUserId && claims.appUserId !== expected.ownerUserId) {
    problems.push('app_user_id_mismatch');
  }
  // At registration the Owner IS the principal — the shop has no other actor
  // yet, so the hook resolves both claims to the same users row. Checking only
  // app_user_id left the stable, auth-bound identity unverified while the
  // per-shop actor was matched, and it is the principal that shop_memberships
  // and every multi-shop RLS policy key on.
  if (claims.principalUserId && claims.principalUserId !== expected.ownerUserId) {
    problems.push('principal_user_id_mismatch');
  }
  return problems;
}

/**
 * A loggable summary naming which claims are present, plus the role — never the
 * identifiers themselves, which are account identities rather than something to
 * print into logcat.
 */
export function describeSessionClaims(claims: SessionClaims): string {
  const missing = missingIdentityClaims(claims);
  const present = missing.length === 0 ? 'all B4 claims present' : `missing ${missing.join(', ')}`;
  return `role=${claims.role ?? 'none'} ${present}`;
}
