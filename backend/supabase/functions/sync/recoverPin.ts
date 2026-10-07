import * as bcrypt from "npm:bcryptjs@3";
import {
  type Caller,
  HttpError,
  revokeCallerSessionsGlobally,
  revokeMintedSessionLocally,
  verifyCallerJwt,
} from "./_shared/auth.ts";
import { ensureAuthBinding, mintSessionForAppUser } from "./_shared/identity.ts";
import { prepareInstallationEnrollment, tryBindSession } from "./deviceBinding.ts";
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

// Stable refusal codes. The device maps these — never the English message —
// so each keeps its meaning for as long as an installed build may read it.
// Without them every refusal reached the owner as "could not reach the
// server", right after they had paid for the SMS.
//
// RECOVERY_REFUSED is ONE code for every way a number fails to qualify — not
// Bangladeshi, no such owner, not an owner, not the number this session
// proved — so the reply says nothing about which numbers run a pharmacy.
const RECOVERY_REFUSED = "recovery_refused";
const PIN_IN_USE = "pin_in_use";
/** A fault on our side — never a verdict on the number or the PIN. */
const RECOVERY_FAILED = "recovery_failed";
/**
 * The PIN write already committed; only the follow-up session setup did not
 * finish. Never a verdict on the number or the PIN either — the opposite of
 * one, in fact — so the device must not read this as recovery having failed.
 */
const PIN_CHANGED_LOGIN_REQUIRED = "pin_changed_login_required";
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    throw new HttpError(500, "Could not recover this account", RECOVERY_FAILED);
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
    throw new HttpError(500, "Could not recover this account", RECOVERY_FAILED);
  }
  for (const row of data ?? []) {
    if (row.id === exceptUserId || !row.pin_hash) {
      continue;
    }
    if (await bcrypt.compare(rawPin, row.pin_hash)) {
      throw new HttpError(409, "That PIN is already in use at this shop. Choose another.", PIN_IN_USE);
    }
  }
}

export async function recoverPin(caller: Caller, body: Record<string, unknown>) {
  const { phone, newPin } = body;
  if (typeof phone !== "string" || typeof newPin !== "string") {
    throw new HttpError(400, "phone and newPin are required", "recovery_request_invalid");
  }
  if (!/^\d{4}$/.test(newPin)) {
    throw new HttpError(400, "PIN must be exactly 4 digits", "pin_format_invalid");
  }
  const canonicalPhone = normalizeBdPhone(phone);
  if (!canonicalPhone) {
    throw new HttpError(403, "This number cannot be recovered here", RECOVERY_REFUSED);
  }

  // The VERIFIED CURRENT JWT must carry a recent OTP AMR event. A historical
  // auth.users.phone_confirmed_at value says only that this account completed
  // OTP once; it does not prove who holds this session now.
  if (!caller.freshPhoneOtp) {
    throw new HttpError(403, "Fresh phone verification is required", "otp_required");
  }
  // FULL canonical equality, country code included. The previous version
  // compared the last 10 digits, which made +91 1712345678 equal to
  // +880 1712345678: an attacker could OTP-verify their own Indian number and
  // use it to take over a Bangladeshi owner's account. A non-Bangladeshi
  // verified phone normalizes to null and now matches nothing at all.
  if (!isSameBdPhone(caller.freshPhoneOtp.phone, canonicalPhone)) {
    throw new HttpError(403, "Phone number does not match the verified session", RECOVERY_REFUSED);
  }

  const owner = await findOwnerByPhone(canonicalPhone);
  if (!owner) {
    throw new HttpError(403, "This number cannot be recovered here", RECOVERY_REFUSED);
  }
  // The recovery target comes only from the Owner row. Validate it before
  // any credential mutation; a partial-success reply must never guess a shop.
  if (!UUID_SHAPE.test(owner.shopId)) {
    throw new HttpError(500, "Could not recover this account", RECOVERY_FAILED);
  }

  // BEFORE auth rebinding, global sign-out or PIN mutation. A device-revoked
  // owner cannot turn OTP recovery into a fresh-install bypass, and a missing
  // installation id cannot leave an A2.3 client holding an unbound session.
  const installation = await prepareInstallationEnrollment(
    owner.shopId,
    owner.id,
    body,
  );

  // ORDER IS THE POINT OF THIS FUNCTION — but "runs before the write" is not
  // the same claim as "the account is unchanged". By the time the write below
  // is attempted, the rebind just underneath this comment may already have
  // moved the auth binding, and the global sign-out further down may already
  // have ended every session. Both are safe to have already happened even if
  // the write then fails: neither one IS the credential, so a legacy owner
  // simply stays rebound and keeps their OLD PIN hash, and sessions that were
  // cut were never going to be usable again regardless. What this ordering
  // actually guarantees is narrower, and is still the point: every check that
  // can REFUSE the recovery outright — an unqualified number, a PIN collision,
  // a sign-out GoTrue itself refuses — runs before the write, so a refusal
  // never lands alongside a PIN that already changed.
  //
  // The previous version wrote the hash first and bound afterwards; when the
  // binding threw — which it did, permanently, for every owner who registered
  // before auth_bindings existed — the PIN had already changed and the old
  // sessions were never cut.
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
  //
  // With the caller's OWN token. GoTrue's global logout authenticates by a
  // logged-in JWT and nothing else, and ends every session of the account that
  // token belongs to — the account Supabase has just verified holds the
  // owner's number, and the one ensureAuthBinding has just bound. This was
  // once handed the user id instead; GoTrue refused it, and recovery failed
  // after the OTP was spent (DEV, 2026-10-05).
  if (!(await revokeCallerSessionsGlobally(caller))) {
    throw new HttpError(500, "Could not recover this account", RECOVERY_FAILED);
  }

  // CREDENTIAL COMMIT POINT. CLAUDE.md rule 8: the raw PIN is handed to
  // bcrypt and to nothing else — not logged, not returned, not stored.
  const pinHash = await bcrypt.hash(newPin, BCRYPT_COST_FACTOR);
  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("users")
    .update({ pin_hash: pinHash, pin_set_at: now, updated_at: now })
    .eq("id", owner.id);
  if (updateError) {
    throw new HttpError(500, "Could not recover this account", RECOVERY_FAILED);
  }
  // The pin_hash change trips users_bump_permission_version, so any access
  // token that somehow survived the sign-out is now behind the database too.

  // Recovery has ALREADY SUCCEEDED, as of the write above. Supabase Auth and
  // this table are two systems, not one transaction, so there is no PIN to
  // roll back into even if minting, verifying or binding a fresh session now
  // fails — this block is recoverable follow-up work, never the recovery
  // itself, and its own failure must not read as one. The device already
  // knows how to recover from here regardless: sign in with the PIN that was
  // just set, the ordinary way.
  try {
    // A fresh session for the device actually performing the recovery, so the
    // owner lands on their dashboard rather than being bounced into a login
    // they would have to complete twice.
    const session = await mintSessionForAppUser(owner.id);
    try {
      // A2.3. An OTP-verified recovery is a credential proof, so the session
      // it mints is bound to this installation exactly as device-login's is.
      // Without it, recovering your PIN would leave you holding an unbound
      // session that an enforcing shop then refuses — recovery that does not
      // recover.
      const mintedCaller = await verifyCallerJwt(
        new Request("https://sync.internal/recover-pin", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }),
      );
      const bound = await tryBindSession(
        mintedCaller.authSessionId,
        owner.shopId,
        owner.id,
        body,
        installation,
      );
      return {
        shopId: owner.shopId,
        userId: owner.id,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        ...(bound
          ? { deviceSecret: bound.deviceSecret, deviceAuthority: bound.authority }
          : {}),
      };
    } catch (followUpError) {
      // Best-effort, and scoped to exactly the one session just minted — this
      // account's other sessions are already gone, and "global" would only
      // restate that. Never returned, on either outcome of the cleanup; a
      // cleanup failure is reported by revokeMintedSessionLocally itself.
      await revokeMintedSessionLocally(session.accessToken);
      throw followUpError;
    }
  } catch {
    // Reached either because minting itself failed (nothing to clean up —
    // there is no session yet) or because the catch above already cleaned up
    // the one it minted. Either way the PIN write earlier in this function
    // already committed, so this is reported as its own stable code — never
    // RECOVERY_FAILED, which would tell the device the PIN did NOT change.
    // This distinct, server-derived field cannot be replaced by the caller's
    // ACTIVE shop in httpErrorBody. It is exposed only after the PIN write.
    throw new HttpError(
      422,
      "PIN changed, but the new session could not be completed",
      PIN_CHANGED_LOGIN_REQUIRED,
      { recoveryShopId: owner.shopId },
    );
  }
}
