import * as bcrypt from "npm:bcryptjs@3";
import { type Caller, HttpError } from "./_shared/auth.ts";
import { ensureAuthBinding, mintSessionForAppUser } from "./_shared/identity.ts";
import { isSameBdPhone, normalizeBdPhone } from "./_shared/phone.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

// recoverPin.ts — the ONLY surviving use of OTP after first-time registration.
//
// Normal login is phone + PIN with no SMS. This flow is for the one case that
// cannot be: the PIN itself is what was lost, so the phone number has to be
// re-proved some other way before a new PIN can be set.
//
// OWNER ONLY, deliberately. A staff member who forgets their PIN is reset by
// their owner (db/staff.ts's resetStaffPin) — Volume 4 gives staff no phone
// number of their own to receive a code at, and self-service reset would make
// anyone able to intercept one SMS able to take over a till.
//
// The caller must ALREADY hold a session minted by Supabase's own phone OTP
// (sync/otp.ts on the device). This function neither sends nor checks codes; it
// checks that the verified phone on the caller's token is the phone on the
// owner row whose PIN is being replaced.

// Matches native/crypto.ts. A recovered PIN must verify against the same cost
// factor the device will later use offline.
const BCRYPT_COST_FACTOR = 10;

interface OwnerRow {
  id: string;
  shopId: string;
}

/**
 * The owner account for a canonical phone, or null.
 *
 * One generic reply covers "no such number" and "that number is not an owner",
 * so this endpoint cannot be used to enumerate which numbers run a pharmacy.
 */
async function findOwnerByPhone(phone: string): Promise<OwnerRow | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, shop_id, roles!inner(name)")
    .eq("phone", phone)
    .eq("is_active", true)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "Could not recover this account");
  }
  const roleName = (data?.roles as unknown as { name: string } | null)?.name;
  if (!data || roleName !== "owner") {
    return null;
  }
  return { id: data.id, shopId: data.shop_id };
}

/**
 * Refuses a PIN that already belongs to somebody else in the shop.
 *
 * PIN Login has no "who are you" step: db/auth.ts's verifyPin compares the
 * typed PIN against EVERY live user's hash and takes the first match. Two users
 * sharing a PIN therefore means one of them silently signs in as the other —
 * and if the collision is with the owner, that is a privilege escalation. The
 * same rule is enforced on the device; this is the server half, so a recovery
 * cannot introduce a collision the device would then have to live with.
 */
async function assertPinUnusedInShop(
  shopId: string,
  rawPin: string,
  exceptUserId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, pin_hash")
    .eq("shop_id", shopId)
    .eq("is_active", true)
    .eq("is_deleted", false)
    .not("pin_set_at", "is", null);
  if (error) {
    throw new HttpError(500, "Could not recover this account");
  }
  for (const row of data ?? []) {
    if (row.id === exceptUserId || !row.pin_hash) {
      continue;
    }
    if (await bcrypt.compare(rawPin, row.pin_hash)) {
      throw new HttpError(409, "That PIN is already in use at this shop. Choose another.");
    }
  }
}

export async function recoverPin(caller: Caller, body: Record<string, unknown>) {
  const { phone, newPin } = body;
  if (typeof phone !== "string" || typeof newPin !== "string") {
    throw new HttpError(400, "phone and newPin are required");
  }
  if (!/^\d{4}$/.test(newPin)) {
    throw new HttpError(400, "PIN must be exactly 4 digits");
  }
  const canonicalPhone = normalizeBdPhone(phone);
  if (!canonicalPhone) {
    throw new HttpError(403, "This number cannot be recovered here");
  }

  // The caller's token must carry a VERIFIED phone. A session minted any other
  // way — including one this very endpoint issued a moment ago — has no
  // phone_confirmed_at, so it cannot be replayed to set the PIN again.
  if (!caller.verifiedPhone) {
    throw new HttpError(403, "Phone number is not verified");
  }
  // FULL canonical equality, country code included. The previous version
  // compared the last 10 digits, which made +91 1712345678 equal to
  // +880 1712345678: an attacker could OTP-verify their own Indian number and
  // use it to take over a Bangladeshi owner's account. A non-Bangladeshi
  // verified phone normalizes to null and now matches nothing at all.
  if (!isSameBdPhone(caller.verifiedPhone, canonicalPhone)) {
    throw new HttpError(403, "Phone number does not match the verified session");
  }

  const owner = await findOwnerByPhone(canonicalPhone);
  if (!owner) {
    throw new HttpError(403, "This number cannot be recovered here");
  }

  // ORDER IS THE POINT OF THIS FUNCTION.
  //
  // Everything that can fail runs BEFORE the PIN is written, so a failure
  // leaves the account exactly as it was. The previous version wrote the hash
  // first and bound afterwards; when the binding threw — which it did,
  // permanently, for every owner who registered before auth_bindings existed —
  // the PIN had already changed and the old sessions were never cut.
  //
  // allowRebind is set here and NOWHERE else. It is safe only because Supabase
  // has just verified that this caller controls the owner's phone number, which
  // is the strongest proof of ownership the system has. It is also what lets a
  // legacy owner — whose OTP account and whose device-login account are two
  // different auth users — recover at all, instead of 403ing forever.
  await ensureAuthBinding(owner.id, caller.authUserId, { allowRebind: true });

  await assertPinUnusedInShop(owner.shopId, newPin, owner.id);

  // Cut every existing session BEFORE the new PIN exists. Recovery is what
  // someone does after losing a phone, so a session still living on that phone
  // must not survive it — including the OTP session this request arrived on.
  // Doing it first means a failure here leaves the OLD PIN in place, rather
  // than a new PIN alongside sessions that were supposed to die.
  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
    caller.authUserId,
    "global",
  );
  if (signOutError) {
    throw new HttpError(500, "Could not recover this account");
  }

  // CLAUDE.md rule 8: the raw PIN is handed to bcrypt and to nothing else — not
  // logged, not returned, not stored.
  const pinHash = await bcrypt.hash(newPin, BCRYPT_COST_FACTOR);
  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("users")
    .update({ pin_hash: pinHash, pin_set_at: now, updated_at: now })
    .eq("id", owner.id);
  if (updateError) {
    throw new HttpError(500, "Could not recover this account");
  }
  // The pin_hash change trips users_bump_permission_version, so any access
  // token that somehow survived the sign-out is now behind the database too.

  // A fresh session for the device actually performing the recovery, so the
  // owner lands on their dashboard rather than being bounced into a login they
  // would have to complete twice.
  const session = await mintSessionForAppUser(owner.id);

  return {
    shopId: owner.shopId,
    userId: owner.id,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}
