import * as bcrypt from "npm:bcryptjs@3";
import {
  assertCallerCurrent,
  type Caller,
  HttpError,
  requireCallerShop,
  verifyCallerJwt,
} from "./_shared/auth.ts";
import { mintSessionForAppUser, resolveOrCreateAuthUserId } from "./_shared/identity.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
import { deviceLoginAppMetadata, mintedSessionMatchesActor } from "./deviceLoginPolicy.ts";
import {
  constantTimeEquals,
  describeRegistryFailure,
  hashDeviceSecret,
  mintDeviceSecret,
  parseDeviceAuthority,
} from "./deviceRegistryPolicy.ts";

// Re-exported so this file stays the single place the handlers read from,
// while the decisions themselves live in a module the Node test runner can
// execute. pull.ts imports the policy module DIRECTLY — see the note there.
export { constantTimeEquals, hashDeviceSecret, mintDeviceSecret };

// deviceRegistry.ts — A2.3. The server half of "this installation is a thing
// the shop can see, and cut off".
//
// Three responsibilities, kept in one file because they share a credential
// model that must not be allowed to drift apart:
//
//   - ENROLMENT, after phone + PIN device-login has already proved who is
//     asking. The server mints the device secret here and hands it back once.
//
//   - ACTOR SWITCH, the reason the batch exists. An already-registered
//     installation may ask for a session for a DIFFERENT actor of the same
//     shop by presenting its device secret plus that actor's PIN. No phone, no
//     OTP, no re-linking.
//
//   - ADMINISTRATION: listing installations and revoking or restoring them, or
//     individual accounts on them, for a live Owner or Manager.

// The device secret, the PIN, and why they are hashed differently, are
// explained in deviceRegistryPolicy.ts. Everything below is the plumbing that
// applies those decisions against the database.

// Same generic-failure discipline as deviceLogin.ts: a credential refusal must
// never say WHICH credential was wrong, or an attacker learns whether a device
// id is registered by watching which message comes back.
const GENERIC_FAILURE = "Could not verify this device";

// A real bcrypt hash of a value no 4-digit PIN can equal, so a switch aimed at
// an actor with no usable row costs the same as one aimed at a real account.
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

// Three dimensions, because two of them are chosen by the attacker.
//
// The device key is (shop, installation) and the actor key is a user id; both
// arrive in the request body, so somebody who never reuses a pair is never
// counted by either. The abuse key is the network address, which the caller
// does not get to pick, and it is what turns "unlimited bcrypt" back into a
// budget. Its ceiling is set high enough that a whole pharmacy behind one NAT,
// handing one till back and forth all day, never reaches it.
const DEVICE_ATTEMPT_BUDGET = 20;
const ACTOR_ATTEMPT_BUDGET = 5;
const ABUSE_ATTEMPT_BUDGET = 60;

/**
 * When the proxy gives us no address.
 *
 * One shared bucket with a deliberately large ceiling. It exists so that a
 * missing header is not a way to opt out of being counted at all; it is not a
 * per-caller limit, and its budget sits well above anything honest traffic
 * could produce in one window.
 */
const GLOBAL_ABUSE_KEY = "a23-abuse:global";
const GLOBAL_ABUSE_BUDGET = 600;

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new HttpError(400, `${key} is required`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" && value.length <= 200 ? value : "";
}

/**
 * Charges this attempt against every budget, atomically, BEFORE any work.
 *
 * Reserve-then-partial-refund, and the inversion is the point. The old shape asked
 * "are you locked?", did ~300ms of bcrypt, and only then recorded the failure
 * — three separate statements with two windows in them. Twenty parallel
 * requests all read the same pre-increment count and all sailed through, and
 * because the lock armed only once the count EXCEEDED the budget, a budget of
 * five bought six guesses.
 *
 * Now the increment happens first, inside one plpgsql function holding a row
 * lock per key, so "passed the gate without having been counted" is not a
 * state that exists. `clearAttempts` below refunds only the device and actor
 * keys when the credentials verify; the shared abuse reservation remains.
 */
async function reserveAttempts(
  keys: readonly string[],
  limits: readonly number[],
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("a23_reserve_attempts", {
    p_keys: keys,
    p_limits: limits,
  });
  // A limiter that cannot be read cannot be trusted on the next request
  // either. Refusing beats serving an unmetered credential oracle for the
  // duration of the outage.
  if (error) throw new HttpError(500, GENERIC_FAILURE);
  return (data as { allowed?: unknown } | null)?.allowed === true;
}

async function clearAttempts(keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await supabaseAdmin.rpc("clear_login_failures", { p_key: key });
  }
}

/** The HttpError form of deviceRegistryPolicy.ts's mapping. */
export function registryError(error: { code?: string } | null): HttpError {
  const failure = describeRegistryFailure(error?.code);
  if (failure.code === "device_registry_failed") {
    // Detail to the function log only; the device gets a stable message. Same
    // rule multiShop.ts follows — a SQLSTATE must not reach a store build.
    console.error(`sync/device-registry failed: db=${error?.code ?? "unknown"}`);
  }
  return new HttpError(failure.status, failure.message, failure.code);
}

async function callRegistry(
  fn: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) throw registryError(error);
  if (!data || typeof data !== "object") {
    throw new HttpError(500, "Could not read device access", "device_registry_failed");
  }
  return data as Record<string, unknown>;
}

// Session binding lives in deviceBinding.ts, which this file deliberately does
// NOT re-export: that module must stay reachable from deviceLogin, linkDevice
// and recoverPin without dragging `npm:bcryptjs` below into their graphs.

// ── The PIN-only actor switch ─────────────────────────────────────────────

/**
 * Authorises the switch, and on a revocation attaches the snapshot that proves
 * it to the refusal.
 *
 * This is how a device learns it has been cut off when it has NO SESSION. The
 * actor switch is unauthenticated by necessity, so the refusal body is the
 * only channel there is: without the snapshot the device would have to go and
 * ask `device-authority` for the reason, which needs the very token it does
 * not have. It would then keep offering the handover, fail again, and never
 * persist the quarantine — the revocation would hold only for as long as the
 * network did.
 *
 * Safe to include because of WHERE this runs: both credentials have already
 * verified, so the caller has proved possession of this installation's secret.
 * The snapshot names actor ids bound to a device they demonstrably hold, and
 * carries no secret of any kind.
 */
async function authorizeSwitchOrExplain(
  shopId: string,
  devicePublicId: string,
  actorUserId: string,
  /**
   * The session to bind, once there is one.
   *
   * Null on the first call — the token has not been minted yet — and the real
   * session id on the second, after minting. Splitting it that way keeps ONE
   * function deciding whether a binding is good, rather than authorising in
   * one place and writing the mapping somewhere else.
   */
  authSessionId: string | null,
): Promise<Record<string, unknown>> {
  try {
    return await callRegistry("a23_authorize_actor_switch", {
      p_shop_id: shopId,
      p_device_public_id: devicePublicId,
      p_actor_user_id: actorUserId,
      p_auth_session_id: authSessionId,
    });
  } catch (error) {
    if (
      !(error instanceof HttpError)
      || (error.code !== "device_revoked" && error.code !== "binding_revoked")
    ) {
      throw error;
    }
    const { data, error: authorityError } = await supabaseAdmin.rpc("a23_device_authority", {
      p_shop_id: shopId,
      p_device_public_id: devicePublicId,
    });
    const authority = parseDeviceAuthority(data);
    // Do not emit an "authoritative" revocation without the authority needed
    // to persist it. The client treats this as retryable/unverified and neither
    // invents nor loses a quarantine.
    if (authorityError || !authority) {
      throw new HttpError(
        503,
        "Could not verify this device right now",
        "device_gate_unavailable",
      );
    }
    throw new HttpError(error.status, error.message, error.code, { authority });
  }
}

/**
 * Mints a session for a different actor of the same shop, on an installation
 * already registered to that shop.
 *
 * UNAUTHENTICATED, and necessarily so — the same reason device-login is. The
 * outgoing actor's token may be expired, or the app may have cold-started with
 * no session at all; requiring one would put the handover straight back behind
 * the phone-based relink this batch exists to remove.
 *
 * What replaces it is strictly stronger than device-login's phone + PIN:
 *
 *   - the DEVICE SECRET, 32 random bytes only a successfully enrolled
 *     installation of this shop has ever been given, compared constant-time;
 *   - the TARGET ACTOR'S PIN, verified server-side with bcrypt against the
 *     stored hash, exactly as device-login does;
 *   - an ACTIVE BINDING for that actor on that device, which only that actor's
 *     own phone + PIN enrolment can have created.
 *
 * All three, behind a three-scope rate limiter. A stolen phone yields nothing
 * without a PIN, and revoking either the device or the single binding closes
 * this door immediately.
 */
export async function deviceActorSwitch(
  body: Record<string, unknown>,
  clientIp: string | null = null,
) {
  const shopId = requireString(body, "shopId");
  const devicePublicId = requireString(body, "devicePublicId");
  const deviceSecret = requireString(body, "deviceSecret");
  const actorUserId = requireString(body, "actorUserId");
  const pin = body.pin;
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
    throw new HttpError(401, GENERIC_FAILURE, "device_switch_refused");
  }

  const deviceKey = `a23-device:${shopId}:${devicePublicId}`;
  const actorKey = `a23-actor:${actorUserId}`;
  const abuseKey = clientIp ? `a23-abuse:${clientIp}` : GLOBAL_ABUSE_KEY;
  const attemptKeys = [deviceKey, actorKey, abuseKey];
  const attemptLimits = [
    DEVICE_ATTEMPT_BUDGET,
    ACTOR_ATTEMPT_BUDGET,
    clientIp ? ABUSE_ATTEMPT_BUDGET : GLOBAL_ABUSE_BUDGET,
  ];

  // BEFORE any hashing or bcrypt, for the same reason deviceLogin checks
  // first: this endpoint is open, and bcrypt is a CPU-exhaustion primitive.
  //
  // ONE refusal for every budget. The old code answered 429 for the device key
  // and a generic 401 for the actor key, which told an attacker which of the
  // two identifiers they had guessed right — a lockout that enumerates is a
  // lockout working against itself. Being locked out and being wrong are now
  // indistinguishable from outside.
  if (!await reserveAttempts(attemptKeys, attemptLimits)) {
    throw new HttpError(401, GENERIC_FAILURE, "device_switch_refused");
  }

  const { data: storedHash, error: hashError } = await supabaseAdmin.rpc(
    "a23_device_secret_hash",
    { p_shop_id: shopId, p_device_public_id: devicePublicId },
  );
  if (hashError) throw new HttpError(500, GENERIC_FAILURE);

  const presented = await hashDeviceSecret(deviceSecret);
  const deviceMatches = typeof storedHash === "string"
    && constantTimeEquals(presented, storedHash);

  // The actor row is read even when the device already failed, and a miss is
  // still compared against DUMMY_HASH, so an unregistered device and a wrong
  // PIN cost the same wall-clock time.
  const { data: actorRow, error: actorError } = await supabaseAdmin
    .from("users")
    .select("id, shop_id, pin_hash, pin_set_at, is_active, is_deleted")
    .eq("id", actorUserId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (actorError) throw new HttpError(500, GENERIC_FAILURE);
  const actorUsable = Boolean(
    actorRow && actorRow.pin_set_at && actorRow.is_active && !actorRow.is_deleted,
  );
  const pinMatches = await bcrypt.compare(
    pin,
    actorUsable && typeof actorRow?.pin_hash === "string" ? actorRow.pin_hash : DUMMY_HASH,
  );

  if (!deviceMatches || !actorUsable || !pinMatches) {
    // Nothing to record: the attempt was charged before the work began, and
    // leaving the reservation in place IS the failure being counted.
    throw new HttpError(401, GENERIC_FAILURE, "device_switch_refused");
  }

  // Refund the DEVICE and ACTOR budgets, and only those. It happens here
  // rather than after the registry check for the same reason the registry
  // check is not counted: what follows is a commercial refusal, not a guess,
  // and a revoked binding must not burn the budget of the colleague who still
  // holds a valid one on the same handset.
  //
  // The abuse bucket is deliberately NOT cleared. It counts requests rather
  // than failures, and its whole purpose is to bound how much bcrypt one
  // network source can spend; letting a single success reset it would hand
  // anybody holding one valid PIN an unlimited budget for guessing the rest.
  await clearAttempts([deviceKey, actorKey]);

  // Registry authorization runs only AFTER both credentials verify. The
  // session id is not known yet — it comes from the token minted below — so
  // this authorises first and binds afterwards, once there is one.
  const authority = await authorizeSwitchOrExplain(
    shopId,
    devicePublicId,
    actorUserId,
    null,
  );

  const authUserId = await resolveOrCreateAuthUserId(actorUserId);
  // Both shop selectors are overwritten before minting, exactly as
  // device-login does: the access-token hook gives active_shop_id priority, so
  // a stale value there would mint another shop's actor.
  const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    app_metadata: deviceLoginAppMetadata(shopId),
  });
  if (metadataError) throw new HttpError(500, "Could not start session");

  const session = await mintSessionForAppUser(actorUserId);

  // Fail-closed consistency check on the exact token being returned — the same
  // one device-login performs, and for the same reason: the claims are minted
  // by a hook this function does not control.
  const mintedCaller = await verifyCallerJwt(
    new Request("https://sync.internal/device-actor-switch", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    }),
  );
  if (!mintedSessionMatchesActor(mintedCaller, { authUserId, appUserId: actorUserId, shopId })) {
    throw new HttpError(500, "Could not start session");
  }
  const current = await assertCallerCurrent(mintedCaller);
  if (current.appUserId !== actorUserId || current.shopId !== shopId) {
    throw new HttpError(500, "Could not start session");
  }

  // Bind the session that was just minted. The switch already authorised this
  // actor on this installation; without this second step the handover would
  // hand back a session the gate reads as LEGACY — fine today, refused the
  // moment the shop enforces, and never covered by a revocation.
  //
  // Re-authorising rather than writing the mapping directly keeps one place
  // deciding whether a binding is good, and re-checks it under the minted
  // session's own identity.
  const bound = await authorizeSwitchOrExplain(
    shopId,
    devicePublicId,
    actorUserId,
    mintedCaller.authSessionId,
  );

  return {
    shopId,
    userId: actorUserId,
    role: current.roleName,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    authority: bound ?? authority,
  };
}

// ── Reading and administering the registry ────────────────────────────────

/**
 * This installation's authority snapshot, for the caller's shop.
 *
 * Any authenticated member may read it: it describes the device in their hand,
 * and the client needs it to decide whether to keep a local session alive. It
 * carries no secret.
 */
export async function deviceAuthority(caller: Caller, body: Record<string, unknown>) {
  await assertCallerCurrent(caller);
  const shopId = requireCallerShop(caller, requireString(body, "shopId"));
  // Derived from the SESSION. A device asking "what is my standing?" must not
  // be able to ask about somebody else's installation, and the old version —
  // which took a device id from the body — let it do exactly that.
  //
  // Ungated on purpose: this is how an installation that has just been refused
  // finds out why, so gating it would hide the answer from the one caller who
  // needs it. It returns status, never a credential.
  const { data, error } = await supabaseAdmin.rpc("a23_session_authority", {
    p_auth_session_id: caller.authSessionId,
    p_shop_id: shopId,
  });
  if (error) throw registryError(error);
  // null is the one explicit legacy-unbound result. Any other non-snapshot is
  // a broken boundary response and must not be interpreted as "unenforced".
  if (data === null) return { bound: false };
  const authority = parseDeviceAuthority(data);
  if (!authority) {
    throw new HttpError(503, "Could not verify this device right now", "device_gate_unavailable");
  }
  return authority;
}

export async function listDevices(caller: Caller, body: Record<string, unknown>) {
  const record = await assertCallerCurrent(caller);
  const shopId = requireCallerShop(caller, requireString(body, "shopId"));
  const { data, error } = await supabaseAdmin.rpc("a23_list_devices", {
    p_shop_id: shopId,
    p_caller_user_id: record.appUserId,
  });
  if (error) throw registryError(error);
  // `{ devices, enrollmentHolds, enforced }` — pending replacement ids are
  // visible only to the same Owner/Manager policy that may approve one.
  // The enforcement flag rides with the list because that screen is where it
  // is decided. Revocation already applies to every bound session; this flag
  // controls only whether legacy unbound sessions remain accepted.
  const listing = (data ?? {}) as { devices?: unknown; enforced?: unknown };
  return {
    devices: Array.isArray(listing.devices) ? listing.devices : [],
    enrollmentHolds: Array.isArray((listing as { enrollmentHolds?: unknown }).enrollmentHolds)
      ? (listing as { enrollmentHolds: unknown[] }).enrollmentHolds
      : [],
    enforced: listing.enforced === true,
  };
}

/**
 * Revoke or restore, device-wide or for one account on it.
 *
 * One entry point, four distinct database functions — the dispatch is here so
 * the authorization and audit semantics stay separate down in SQL, where they
 * are enforced, rather than being flattened into a single parameterised write.
 */
export async function mutateDeviceAccess(caller: Caller, body: Record<string, unknown>) {
  const record = await assertCallerCurrent(caller);
  const shopId = requireCallerShop(caller, requireString(body, "shopId"));

  // The rollout switch. Handled before `deviceId` is required, because it is
  // shop-wide rather than about one installation: it identifies the CALLER'S
  // device instead, so the database can refuse to enforce from a handset that
  // would then be locked out by the rule it just turned on.
  if (body.operation === "set-enforcement") {
    if (typeof body.enabled !== "boolean") {
      throw new HttpError(400, "enabled must be true or false");
    }
    return await callRegistry("a23_set_device_enforcement", {
      p_shop_id: shopId,
      p_caller_user_id: record.appUserId,
      // The caller's OWN session, from its verified token. Enabling requires
      // it to be bound to an active installation whose secret has not been
      // rotated out from under it, so the act of enforcing cannot be the act
      // that strands the person performing it.
      p_auth_session_id: caller.authSessionId,
      p_enabled: body.enabled,
    });
  }

  if (body.operation === "approve-enrollment") {
    return await callRegistry("a23_approve_enrollment", {
      p_shop_id: shopId,
      p_caller_user_id: record.appUserId,
      p_auth_session_id: caller.authSessionId,
      p_target_actor_user_id: requireString(body, "actorUserId"),
      p_device_public_id: requireString(body, "devicePublicId"),
    });
  }

  const deviceId = requireString(body, "deviceId");
  const reason = optionalString(body, "reason");

  switch (body.operation) {
    case "revoke-device":
      return await callRegistry("a23_revoke_device", {
        p_shop_id: shopId,
        p_caller_user_id: record.appUserId,
        p_device_id: deviceId,
        p_reason: reason,
      });
    case "restore-device":
      return await callRegistry("a23_restore_device", {
        p_shop_id: shopId,
        p_caller_user_id: record.appUserId,
        p_device_id: deviceId,
      });
    case "revoke-binding":
      return await callRegistry("a23_revoke_binding", {
        p_shop_id: shopId,
        p_caller_user_id: record.appUserId,
        p_device_id: deviceId,
        p_target_actor_user_id: requireString(body, "actorUserId"),
        p_reason: reason,
      });
    case "restore-binding":
      return await callRegistry("a23_restore_binding", {
        p_shop_id: shopId,
        p_caller_user_id: record.appUserId,
        p_device_id: deviceId,
        p_target_actor_user_id: requireString(body, "actorUserId"),
      });
    default:
      throw new HttpError(400, "Invalid device operation");
  }
}
