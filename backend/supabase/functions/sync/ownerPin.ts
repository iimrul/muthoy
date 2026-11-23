import * as bcrypt from "npm:bcryptjs@3";
import { assertCallerCurrent, type Caller, HttpError } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

// ownerPin.ts — one owner PIN for every shop the owner runs (migration 43,
// founder-approved plan 2026-11-23).
//
// A multi-shop owner holds one actor row per shop. A PIN change or recovery
// used to write only one of them, so the other shops kept the old PIN and the
// phone-first PIN pad stopped signing the owner in from those shops. Every
// owner PIN write now goes through here: the new PIN is checked against every
// person in EVERY one of the owner's shops, then written to all owner actors
// at once by owner_set_pin_all_shops.
//
// CLAUDE.md rule 8: the raw PIN reaches bcrypt and nothing else — never a log,
// a response, an error message or the database.

export const OWNER_PIN_REFUSED = "owner_pin_refused";
export const PIN_IN_USE = "pin_in_use";
// Its own code, not OWNER_PIN_REFUSED: the app words "wrong PIN" and "wait a
// while" differently and reads only the code.
export const OWNER_PIN_RATE_LIMITED = "owner_pin_rate_limited";
const OWNER_PIN_FAILED = "owner_pin_failed";
const PIN_SHAPE = /^\d{4}$/;
const BCRYPT_COST_FACTOR = 10;
// A real bcrypt hash of a value no 4-digit PIN can equal: a missing row costs
// the same single compare as a wrong PIN (same value as deviceLogin.ts).
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const ATTEMPT_BUDGET = 5;
const ABUSE_BUDGET = 20;
const GLOBAL_ABUSE_BUDGET = 200;
const GLOBAL_ABUSE_KEY = "owner-pin-abuse:global";

/** One owner actor: the shop it acts in and its users row. */
export interface OwnerActor {
  shopId: string;
  actorUserId: string;
}

/**
 * The principal's live owner actors — the same set owner_set_pin_all_shops
 * writes: the principal's own row plus every active owner membership.
 */
export async function ownerActorsFor(principalUserId: string): Promise<OwnerActor[]> {
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("shop_memberships")
    .select("shop_id, actor_user_id")
    .eq("principal_user_id", principalUserId)
    .eq("role", "owner")
    .eq("is_active", true);
  if (membershipError) throw new HttpError(500, "Could not change the PIN", OWNER_PIN_FAILED);

  const candidates = new Map<string, string>();
  candidates.set(principalUserId, "");
  for (const row of (memberships ?? []) as { shop_id: string; actor_user_id: string }[]) {
    candidates.set(row.actor_user_id, row.shop_id);
  }

  const actors: OwnerActor[] = [];
  for (const actorUserId of candidates.keys()) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, shop_id, is_active, is_deleted")
      .eq("id", actorUserId)
      .maybeSingle();
    if (error) throw new HttpError(500, "Could not change the PIN", OWNER_PIN_FAILED);
    const row = data as { id: string; shop_id: string; is_active: boolean; is_deleted: boolean } | null;
    if (row && row.is_active && !row.is_deleted) actors.push({ shopId: row.shop_id, actorUserId: row.id });
  }
  return actors;
}

/**
 * Refuses a PIN anyone else in any of the owner's shops already holds.
 *
 * Two live people sharing a PIN in one shop make the PIN pad ambiguous, so it
 * signs neither in. The owner's own actors are excluded — they ARE the owner.
 */
export async function assertPinFreeInOwnerShops(
  actors: readonly OwnerActor[],
  rawPin: string,
): Promise<void> {
  const ownerIds = new Set(actors.map((actor) => actor.actorUserId));
  for (const shopId of new Set(actors.map((actor) => actor.shopId))) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, pin_hash")
      .eq("shop_id", shopId)
      .eq("is_active", true)
      .eq("is_deleted", false)
      .not("pin_set_at", "is", null);
    if (error) throw new HttpError(500, "Could not change the PIN", OWNER_PIN_FAILED);
    for (const row of (data ?? []) as { id: string; pin_hash: string | null }[]) {
      if (ownerIds.has(row.id) || !row.pin_hash) continue;
      if (await bcrypt.compare(rawPin, row.pin_hash)) {
        throw new HttpError(409, "That PIN is already in use at one of your shops. Choose another.", PIN_IN_USE);
      }
    }
  }
}

/** Hashes once and writes the owner's PIN to every owner actor, atomically. */
export async function setOwnerPinEverywhere(
  principalUserId: string,
  rawPin: string,
): Promise<{ pinSetAt: string; actorUserIds: string[] }> {
  const pinHash = await bcrypt.hash(rawPin, BCRYPT_COST_FACTOR);
  const { data, error } = await supabaseAdmin.rpc("owner_set_pin_all_shops", {
    p_principal_user_id: principalUserId,
    p_pin_hash: pinHash,
  });
  if (error) {
    console.error(`sync/owner-pin write failed: db=${(error as { code?: string }).code ?? "unknown"}`);
    throw new HttpError(500, "Could not change the PIN", OWNER_PIN_FAILED);
  }
  const result = data as { pinSetAt?: unknown; actorUserIds?: unknown } | null;
  if (
    !result
    || typeof result.pinSetAt !== "string"
    || !Array.isArray(result.actorUserIds)
    || !result.actorUserIds.every((id) => typeof id === "string")
  ) {
    throw new HttpError(500, "Could not change the PIN", OWNER_PIN_FAILED);
  }
  return { pinSetAt: result.pinSetAt, actorUserIds: result.actorUserIds as string[] };
}

async function reserveAttempts(keys: readonly string[], limits: readonly number[]): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("a23_reserve_attempts", {
    p_keys: keys,
    p_limits: limits,
  });
  // An unreadable limiter must not become an unmetered PIN oracle.
  if (error) throw new HttpError(500, "Could not change the PIN", OWNER_PIN_FAILED);
  return (data as { allowed?: unknown } | null)?.allowed === true;
}

/**
 * The owner changes their own PIN — current PIN proven, new PIN unique in
 * every one of their shops, then written to all of them.
 */
export async function ownerPinChange(
  caller: Caller,
  body: Record<string, unknown>,
  clientIp: string | null = null,
): Promise<{ pinSetAt: string; actorUserIds: string[] }> {
  const { currentPin, newPin } = body;
  if (
    typeof currentPin !== "string" || !PIN_SHAPE.test(currentPin)
    || typeof newPin !== "string" || !PIN_SHAPE.test(newPin)
  ) {
    throw new HttpError(400, "A 4-digit current and new PIN are required", "owner_pin_request_invalid");
  }
  const record = await assertCallerCurrent(caller);
  if (!record.isOwner) throw new HttpError(403, "Owner access only");
  const principalUserId = caller.principalUserId;
  if (!principalUserId) {
    throw new HttpError(503, "Authentication hook is not configured", "hook_not_configured");
  }

  // Counted BEFORE any bcrypt, like device-login: this is a PIN oracle.
  const ownerKey = `owner-pin:${principalUserId}`;
  const abuseKey = clientIp ? `owner-pin-abuse:${clientIp}` : GLOBAL_ABUSE_KEY;
  if (!await reserveAttempts(
    [ownerKey, abuseKey],
    [ATTEMPT_BUDGET, clientIp ? ABUSE_BUDGET : GLOBAL_ABUSE_BUDGET],
  )) {
    throw new HttpError(429, "Too many attempts. Try again later.", OWNER_PIN_RATE_LIMITED);
  }

  const { data: actorRow, error: actorError } = await supabaseAdmin
    .from("users")
    .select("id, pin_hash")
    .eq("id", record.appUserId)
    .maybeSingle();
  if (actorError) throw new HttpError(500, "Could not change the PIN", OWNER_PIN_FAILED);
  const storedHash = (actorRow as { pin_hash?: string | null } | null)?.pin_hash;
  const matches = await bcrypt.compare(currentPin, typeof storedHash === "string" ? storedHash : DUMMY_HASH);
  if (!matches || typeof storedHash !== "string") {
    throw new HttpError(401, "Current PIN is incorrect", OWNER_PIN_REFUSED);
  }
  // The credential is proven: refund this owner's budget (never the abuse one).
  await supabaseAdmin.rpc("clear_login_failures", { p_key: ownerKey });

  const actors = await ownerActorsFor(principalUserId);
  if (!actors.some((actor) => actor.actorUserId === record.appUserId)) {
    throw new HttpError(403, "Owner access only");
  }
  await assertPinFreeInOwnerShops(actors, newPin);
  return setOwnerPinEverywhere(principalUserId, newPin);
}
