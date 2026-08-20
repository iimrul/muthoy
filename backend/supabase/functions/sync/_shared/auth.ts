import type { User } from "npm:@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabaseAdmin.ts";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * The caller, as this function is allowed to understand them.
 *
 * `appUserId`, `role` and `permissionVersion` come from the VERIFIED JWT's
 * claims — NOT from the auth user row. That distinction is the whole point of
 * this type, and getting it wrong once already broke every sync request:
 *
 *   custom_access_token_hook writes `event.claims.app_metadata`, which exists
 *   only inside the TOKEN. `supabaseAdmin.auth.getUser(token)` calls
 *   GET /auth/v1/user, which returns the auth.users ROW, whose `app_metadata`
 *   is the stored `raw_app_meta_data` column. Nothing ever writes the hook's
 *   claims to that column, so reading `app_user_id` off the row yielded
 *   undefined on every request, forever — and every check built on it (the
 *   permission gate, the revocation gate) was inert while appearing to run.
 *
 * `raw` is kept for the few fields that genuinely belong to the row rather than
 * the token, notably `phone_confirmed_at` for owner PIN recovery.
 */
export interface Caller {
  /** auth.uid() — the Supabase Auth account. */
  authUserId: string;
  /** users.id — the BUSINESS identity, from the hook's claim. */
  appUserId: string | null;
  shopId: string | null;
  role: string | null;
  permissionVersion: number | null;
  /** The phone Supabase itself verified, if this session came from an OTP. */
  verifiedPhone: string | null;
  raw: User;
}

/**
 * The claims of an ALREADY-VERIFIED token.
 *
 * Verification is done by GoTrue in verifyCallerJwt below — it validates the
 * signature, the expiry and the user's existence, and refuses the request
 * otherwise. This only decodes the very same string GoTrue just accepted, so
 * the claims it returns are exactly as trustworthy as that check. It is never
 * called with an unverified token.
 */
function decodeVerifiedClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) {
    throw new HttpError(401, "Invalid or expired token");
  }
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded));
    return decoded && typeof decoded === "object" ? decoded as Record<string, unknown> : {};
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
}

function claimString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function verifyCallerJwt(request: Request): Promise<Caller> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Missing bearer token");
  // GoTrue verifies the signature, the expiry, and that the user still exists.
  // Everything below reads the claims of THIS token, now that it has passed.
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired token");

  const claims = decodeVerifiedClaims(token);
  const rawMetadata = claims.app_metadata;
  const metadata: Record<string, unknown> =
    rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
      ? rawMetadata as Record<string, unknown>
      : {};

  const version = metadata.permission_version;

  return {
    authUserId: data.user.id,
    appUserId: claimString(metadata, "app_user_id"),
    // shop_id predates the hook and is ALSO stored on the row (linkDevice and
    // deviceLogin both write it there, and every pre-existing RLS policy reads
    // it). Claims first, row as the fallback, so a token minted moments before
    // link-device wrote the value still resolves during registration.
    shopId: claimString(metadata, "shop_id")
      ?? (typeof data.user.app_metadata?.shop_id === "string" ? data.user.app_metadata.shop_id : null),
    role: claimString(metadata, "role"),
    permissionVersion: typeof version === "number" ? version : null,
    verifiedPhone: data.user.phone_confirmed_at ? (data.user.phone ?? null) : null,
    raw: data.user,
  };
}

export function callerShopId(caller: Caller): string | null {
  return caller.shopId;
}

export function requireCallerShop(caller: Caller, requestedShopId: string): string {
  if (!caller.shopId || caller.shopId !== requestedShopId) {
    throw new HttpError(403, "Shop does not match authenticated user");
  }
  return caller.shopId;
}

export function requireCallerAppUserId(caller: Caller): string {
  if (!caller.appUserId) {
    // A refresh cannot manufacture a claim when the hook is not registered.
    // Keep this distinct from a stale version so the client halts without
    // burning outbox attempts in a refresh loop.
    throw new HttpError(
      503,
      "Authentication hook is not configured",
      "hook_not_configured",
    );
  }
  return caller.appUserId;
}

/** The caller's live row, re-read from the database rather than the token. */
export interface CallerRecord {
  appUserId: string;
  shopId: string;
  roleName: string;
  isOwner: boolean;
  permissionVersion: number;
}

/**
 * Rejects a token whose permission_version claim is behind the database, or
 * whose user is no longer allowed to act at all.
 *
 * This is what turns a revocation into an immediate one. Permissions themselves
 * are re-read from the tables on every request, so a grant or revoke already
 * takes effect at once; what a stale token can still carry is the right to be
 * here AT ALL — a deactivated staff member's access token stays
 * cryptographically valid for the rest of its hour. Comparing the claim against
 * the live column closes that window.
 *
 * Returns the caller's live record so callers do not have to re-query the role.
 */
export async function assertCallerCurrent(caller: Caller): Promise<CallerRecord> {
  const appUserId = requireCallerAppUserId(caller);
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, shop_id, permission_version, is_active, is_deleted, roles!inner(name)")
    .eq("id", appUserId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Could not verify caller");
  }
  if (!data || data.is_deleted || !data.is_active) {
    throw new HttpError(403, "Account is no longer active");
  }

  const { data: binding, error: bindingError } = await supabaseAdmin
    .from("auth_bindings")
    .select("auth_user_id")
    .eq("app_user_id", appUserId)
    .maybeSingle();
  if (bindingError) {
    throw new HttpError(500, "Could not verify caller");
  }
  if (!binding || binding.auth_user_id !== caller.authUserId) {
    throw new HttpError(403, "Account is no longer active");
  }
  // The shop on the token must still be the shop on the row. Without this a
  // token whose stored shop_id was written by an older flow could outlive a
  // change, and every downstream check keys off that claim.
  if (caller.shopId && caller.shopId !== data.shop_id) {
    throw new HttpError(403, "Account is no longer active");
  }
  if (caller.permissionVersion !== data.permission_version) {
    throw new HttpError(
      401,
      "Permissions changed; refresh the session",
      "permissions_changed",
    );
  }

  const roleName = (data.roles as unknown as { name: string } | null)?.name ?? "";
  return {
    appUserId,
    shopId: data.shop_id,
    roleName,
    isOwner: roleName === "owner",
    permissionVersion: data.permission_version,
  };
}

/**
 * Cuts every live session for an app user — access tokens AND refresh tokens.
 *
 * A permission_version bump alone stops the CURRENT access token at its next
 * request, but the refresh token keeps minting new ones, and those stay usable
 * against PostgREST directly. Deactivation, a role change and a PIN reset all
 * have to reach that far, so each one calls this.
 *
 * Best-effort by design: it runs AFTER the authoritative change is committed,
 * and a failure here must not roll that change back — the database is already
 * the source of truth for whether the user may act.
 */
export async function signOutAppUser(appUserId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("auth_bindings")
    .select("auth_user_id")
    .eq("app_user_id", appUserId)
    .maybeSingle();
  if (error || !data) {
    return;
  }
  await supabaseAdmin.auth.admin.signOut(data.auth_user_id, "global");
}
