import type { User } from "npm:@supabase/supabase-js@2.112.3";
import { supabaseAdmin } from "./supabaseAdmin.ts";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    /**
     * Extra, non-secret fields merged into the error body.
     *
     * A2.3 needs exactly one thing here: the device authority snapshot that
     * explains a refusal. A revoked installation has to be TOLD, and an error
     * body is the only reply it gets — on the actor switch there is no session
     * left to ask with, and on a gated sync route the request never reaches a
     * handler that could return one. Never put a credential or a SQLSTATE here.
     */
    public readonly details?: Record<string, unknown>,
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
 * `raw` is kept for fields that genuinely belong to the row. Historical
 * `phone_confirmed_at` is deliberately NOT authentication evidence: enrollment
 * and recovery use the signed AMR event on this token's current session.
 */
export interface Caller {
  /** auth.uid() — the Supabase Auth account. */
  authUserId: string;
  /** users.id — the BUSINESS identity, from the hook's claim. */
  appUserId: string | null;
  /** Stable auth-bound identity; appUserId may be a per-shop actor. */
  principalUserId: string | null;
  billingAccountId: string | null;
  shopId: string | null;
  role: string | null;
  permissionVersion: number | null;
  /**
   * A2.3. The `session_id` claim — the authoritative device identity.
   *
   * GoTrue mints one per session and every refreshed token carries the same
   * value, so it survives token rotation and dies with the session. This is
   * what auth_session_devices keys on, and it is why an authenticated request
   * no longer needs (or is allowed) to say which installation it came from: a
   * request body is written by the caller, a verified claim is not.
   *
   * Null for a token minted before GoTrue emitted the claim. That is the
   * LEGACY case, and it is handled as an unbound session rather than as an
   * error — refusing it outright would lock out every session in flight on the
   * day this deploys.
   */
  authSessionId: string | null;
  /** A recent phone-OTP event carried by this verified JWT's current session. */
  freshPhoneOtp: { phone: string; authenticatedAt: number } | null;
  /**
   * Account facts from the verified user row. No route grants anything on an
   * email identity: Owner onboarding needs freshPhoneOtp (linkDevice.ts), and
   * H-5 removed the DEV registration harness, the last route that did not.
   */
  isAnonymous: boolean;
  email: string | null;
  emailConfirmedAt: string | null;
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

/**
 * OTP verification is useful as a step-up credential only briefly.
 *
 * Supabase signs `amr[{ method, timestamp }]`, `phone`, and `session_id` into
 * the JWT. A refresh preserves the original AMR event, so its timestamp — not
 * token issuance and never auth.users.phone_confirmed_at — is the age that
 * matters. Five minutes is ample for the immediate registration/recovery call
 * while making an old or replayed Owner session useless for enrollment.
 */
export const FRESH_PHONE_OTP_MAX_AGE_SECONDS = 5 * 60;
const MAX_AUTH_CLOCK_SKEW_SECONDS = 30;

function freshPhoneOtpFromClaims(
  claims: Record<string, unknown>,
  user: User,
  nowSeconds: number,
): Caller["freshPhoneOtp"] {
  const sessionId = claimString(claims, "session_id");
  const phone = claimString(claims, "phone");
  if (!sessionId || !phone || user.phone !== phone || !Array.isArray(claims.amr)) {
    return null;
  }

  let authenticatedAt: number | null = null;
  for (const rawEntry of claims.amr) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Record<string, unknown>;
    if (
      entry.method === "otp"
      && typeof entry.timestamp === "number"
      && Number.isSafeInteger(entry.timestamp)
      && entry.timestamp >= 0
      && (authenticatedAt === null || entry.timestamp > authenticatedAt)
    ) {
      authenticatedAt = entry.timestamp;
    }
  }
  if (authenticatedAt === null) return null;
  const age = nowSeconds - authenticatedAt;
  if (age < -MAX_AUTH_CLOCK_SKEW_SECONDS || age > FRESH_PHONE_OTP_MAX_AGE_SECONDS) {
    return null;
  }
  return { phone, authenticatedAt };
}

/**
 * The bearer token each Caller was verified from.
 *
 * Deliberately NOT a field of Caller. Every handler receives a Caller, and
 * none of them has any business holding the credential it arrived with — a
 * field is one log line or one spread away from leaving the function. The one
 * thing the token is needed for, GoTrue's own logout, is reachable only through
 * revokeCallerSessionsGlobally below. Keyed weakly, so it lives exactly as long
 * as the request's Caller does.
 */
const verifiedTokens = new WeakMap<Caller, string>();

export async function verifyCallerJwt(request: Request): Promise<Caller> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Missing bearer token");
  // GoTrue verifies the signature, the expiry, and that the user still exists.
  // Everything below reads the claims of THIS token, now that it has passed.
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid or expired token");

  // H-7 H-2. An anonymous session is refused HERE, by the server, for every
  // authenticated action — not left to the hosted "Anonymous sign-ins" toggle.
  //
  // It was already closed indirectly: an anonymous account has no auth_bindings
  // row, so the access-token hook decorates nothing and assertCallerCurrent
  // answers 503 `hook_not_configured`. But that is three accidents in a row
  // reporting an infrastructure fault, and it leans on a project setting that
  // lives outside this repository. RLS keys on app_metadata.shop_id and never
  // inspects is_anonymous, so once such a session were linked it would be
  // indistinguishable from a real one — which is why the client lost the
  // ability to create one (DECISIONS.md, H-2) and why the server now says so
  // explicitly instead of inferring it.
  if (data.user.is_anonymous === true) {
    throw new HttpError(
      403,
      "Anonymous sessions cannot access this shop",
      "anonymous_session_rejected",
    );
  }

  const claims = decodeVerifiedClaims(token);
  const rawMetadata = claims.app_metadata;
  const metadata: Record<string, unknown> =
    rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)
      ? rawMetadata as Record<string, unknown>
      : {};

  const version = metadata.permission_version;

  const caller: Caller = {
    authUserId: data.user.id,
    appUserId: claimString(metadata, "app_user_id"),
    // NO fallback to app_user_id. custom_access_token_hook mints all six
    // identity claims in ONE jsonb_build_object, so a token carrying
    // app_user_id always carries principal_user_id too — the fallback could
    // only ever mask a token the hook did not decorate, by inventing the
    // stable identity that shop_memberships and every multi-shop RLS policy
    // key on. Absent means absent.
    principalUserId: claimString(metadata, "principal_user_id"),
    billingAccountId: claimString(metadata, "billing_account_id"),
    // shop_id predates the hook and is ALSO stored on the row (linkDevice and
    // deviceLogin both write it there, and every pre-existing RLS policy reads
    // it). Claims first, row as the fallback, so a token minted moments before
    // link-device wrote the value still resolves during registration.
    shopId: claimString(metadata, "shop_id")
      ?? (typeof data.user.app_metadata?.shop_id === "string" ? data.user.app_metadata.shop_id : null),
    role: claimString(metadata, "role"),
    permissionVersion: typeof version === "number" ? version : null,
    // Read from the TOP-LEVEL claims, not from app_metadata: session_id is
    // minted by GoTrue itself, not by our access-token hook.
    authSessionId: claimString(claims, "session_id"),
    freshPhoneOtp: freshPhoneOtpFromClaims(
      claims,
      data.user,
      Math.floor(Date.now() / 1000),
    ),
    isAnonymous: data.user.is_anonymous === true,
    email: data.user.email ?? null,
    emailConfirmedAt: data.user.email_confirmed_at ?? null,
    raw: data.user,
  };
  verifiedTokens.set(caller, token);
  return caller;
}

/**
 * Ends EVERY session of the caller's own auth account — the one this request
 * arrived on included — through GoTrue's /logout?scope=global.
 *
 * That endpoint authenticates by a logged-in JWT and by nothing else:
 * `auth.admin.signOut` takes that JWT, NOT a user id. Handing it a user id was
 * the defect this replaced (DEV, 2026-10-05) — GoTrue answered 403 bad_jwt, and
 * Owner PIN recovery failed after the OTP had been spent, on every project.
 *
 * False for a Caller this module did not verify, or when GoTrue refuses. The
 * token is never logged, stored or returned.
 *
 * Access tokens already issued stay signature-valid until they expire —
 * Supabase JWTs are not revocable — but their sessions are gone: GoTrue
 * refuses them (and so does verifyCallerJwt above), and they cannot refresh.
 */
export async function revokeCallerSessionsGlobally(caller: Caller): Promise<boolean> {
  const token = verifiedTokens.get(caller);
  if (!token) return false;
  const { error } = await supabaseAdmin.auth.admin.signOut(token, "global");
  return !error;
}

/**
 * Ends exactly the ONE session a just-minted access token belongs to —
 * "local" scope, never "global". For recoverPin's cleanup when something
 * AFTER minting a fresh session fails: that account's other sessions are
 * already gone by this point, so "global" would merely restate that, and
 * reaching for it instead of "local" would stop being true the moment that
 * stops being the case. This is the one call narrow enough for the job.
 *
 * Logs its own failure, generically and without the token or any id. Kept
 * here rather than in the caller: recoverPin.ts is checked elsewhere to hand
 * the raw PIN to bcrypt and nowhere else, by asserting it has no console
 * call AT ALL — the bluntest guard against that call ever picking up a
 * secret. A fault report belongs beside the call that can fail, not inside
 * the one file that must stay provably silent.
 */
export async function revokeMintedSessionLocally(accessToken: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, "local");
    if (!error) return true;
  } catch {
    // auth-js returns AuthErrors but rethrows transport failures. Both have
    // the same bounded report; neither may replace the committed-PIN result.
  }
  console.error("sync/recover-pin cleanup failed: session was not revoked");
  return false;
}

/**
 * Ends every session of ONE auth user, by id, for the paths that hold no JWT
 * of the user they must cut off: an auth-account rebind and signOutAppUser.
 *
 * h5_revoke_auth_user_sessions (20261005000000) deletes the user's sessions —
 * their refresh tokens cascade — and nothing else. Same caveat as above for
 * access tokens already issued.
 */
export async function revokeAuthUserSessions(authUserId: string): Promise<boolean> {
  const { error } = await supabaseAdmin.rpc("h5_revoke_auth_user_sessions", {
    p_auth_user_id: authUserId,
  });
  return !error;
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
  billingAccountId: string | null;
  commercialStatus: "active" | "read_only";
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
    // The `shops` embed is pinned to users.shop_id BY CONSTRAINT NAME, and it
    // has to be. A2.3 added four tables that each carry a foreign key to both
    // `users` and `shops` — shop_devices, shop_device_bindings,
    // auth_session_devices and device_enrollment_holds. PostgREST reads any
    // such table as a junction, so `users -> shops` stopped being one
    // relationship and became five: the real many-to-one plus four
    // many-to-many. An ambiguous embed is PGRST201, which this function
    // reports as "Could not verify caller" — a 500 on EVERY authenticated
    // action, for every user, the moment that migration lands.
    //
    // Revoking the API roles' access to those tables does not help: PostgREST
    // resolves relationships from the schema, not from grants. Naming the
    // constraint is what makes the embed mean one thing forever, whatever
    // later migrations add alongside it.
    .select("id, shop_id, permission_version, is_active, is_deleted, plan_suspended_at, roles!inner(name), shops!users_shop_id_fkey!inner(billing_account_id, commercial_status, archived_at, is_deleted)")
    .eq("id", appUserId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Could not verify caller");
  }
  if (!data || data.is_deleted) {
    throw new HttpError(403, "Account is no longer active", "account_deleted");
  }
  if (!data.is_active) {
    throw new HttpError(403, "Account is no longer active", "account_inactive");
  }
  if (data.plan_suspended_at) {
    throw new HttpError(403, "Account is suspended by the current plan", "account_plan_suspended");
  }
  const { data: withinLimit, error: limitError } = await supabaseAdmin.rpc(
    "b4_user_within_current_staff_limit",
    { p_app_user_id: appUserId },
  );
  if (limitError) throw new HttpError(500, "Could not verify plan access");
  if (!withinLimit) {
    throw new HttpError(
      403,
      "Account is suspended by the current plan",
      "account_plan_suspended",
    );
  }

  // The PRINCIPAL owns the binding — under Multi-Shop, app_user_id is a
  // per-shop actor while principal_user_id is the one stable auth identity.
  // Falling back to app_user_id here checked the wrong row for any caller
  // acting in a secondary shop, and quietly passed. The hook always mints
  // both claims, so a missing principal is a broken token, not a default.
  if (!caller.principalUserId) {
    throw new HttpError(
      503,
      "Authentication hook is not configured",
      "hook_not_configured",
    );
  }
  const { data: binding, error: bindingError } = await supabaseAdmin
    .from("auth_bindings")
    .select("auth_user_id")
    .eq("app_user_id", caller.principalUserId)
    .maybeSingle();
  if (bindingError) {
    throw new HttpError(500, "Could not verify caller");
  }
  if (!binding || binding.auth_user_id !== caller.authUserId) {
    throw new HttpError(403, "Account is no longer active", "access_invalidated");
  }
  // The shop on the token must still be the shop on the row. Without this a
  // token whose stored shop_id was written by an older flow could outlive a
  // change, and every downstream check keys off that claim.
  if (caller.shopId && caller.shopId !== data.shop_id) {
    throw new HttpError(403, "Account is no longer active", "access_invalidated");
  }
  if (caller.permissionVersion !== data.permission_version) {
    throw new HttpError(
      401,
      "Permissions changed; refresh the session",
      "permissions_changed",
    );
  }

  const roleName = (data.roles as unknown as { name: string } | null)?.name ?? "";
  const shop = data.shops as unknown as {
    billing_account_id: string | null;
    commercial_status: "active" | "read_only";
    archived_at: string | null;
    is_deleted: boolean;
  };
  if (shop.archived_at || shop.is_deleted) {
    throw new HttpError(403, "Shop is archived", "shop_inactive");
  }
  return {
    appUserId,
    shopId: data.shop_id,
    roleName,
    isOwner: roleName === "owner",
    permissionVersion: data.permission_version,
    billingAccountId: shop.billing_account_id,
    commercialStatus: shop.commercial_status,
  };
}

/**
 * The stable auth-bound principal for a changed actor, from the authoritative
 * Multi-Shop rows — never from a JWT claim, since this function is called
 * with nothing but an id (push.ts holds no Caller for the user who changed).
 *
 * `shop_memberships.actor_user_id` is the per-shop `users.id` that may have
 * just been edited; `principal_user_id` is the one identity `auth_bindings`
 * actually keys on. Every live user has a row here — a direct, single-shop
 * user as a self-reference (principal = actor), a Multi-Shop owner's
 * secondary-shop actor as a distinct row pointing at their primary identity —
 * so one query answers both without a special case for either.
 *
 * Null for anything this cannot answer confidently: a missing row, or more
 * than one (`.maybeSingle()` itself refuses that). Guessing the wrong
 * principal here would revoke a stranger's sessions, which is worse than
 * revoking none.
 */
async function resolvePrincipalForActor(actorUserId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("shop_memberships")
    .select("principal_user_id")
    .eq("actor_user_id", actorUserId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return data.principal_user_id;
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
 *
 * Best-effort is not the same as inert. This used to hand the user id to
 * `auth.admin.signOut`, which takes a JWT, and ignore the 403 that came back —
 * so no session was ever cut (DEV, 2026-10-05). A failure is now at least
 * reported, without naming anybody.
 *
 * It also used to read `auth_bindings` by `appUserId` directly, which is only
 * the PRINCIPAL's id. Under Multi-Shop, `appUserId` here is whichever actor
 * row `push.ts` just wrote — for a Multi-Shop owner acting in a secondary
 * shop, that is a DIFFERENT row from the one `auth_bindings` keys on, so the
 * lookup silently found nothing and no session was ever cut for them either.
 */
export async function signOutAppUser(appUserId: string): Promise<void> {
  const principalUserId = await resolvePrincipalForActor(appUserId);
  if (!principalUserId) {
    console.error("sync/sign-out failed: sessions were not revoked");
    return;
  }
  const { data, error } = await supabaseAdmin
    .from("auth_bindings")
    .select("auth_user_id")
    .eq("app_user_id", principalUserId)
    .maybeSingle();
  if (error || !data) {
    console.error("sync/sign-out failed: sessions were not revoked");
    return;
  }
  if (!(await revokeAuthUserSessions(data.auth_user_id))) {
    console.error("sync/sign-out failed: sessions were not revoked");
  }
}
