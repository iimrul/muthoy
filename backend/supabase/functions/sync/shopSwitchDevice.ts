import { type Caller, HttpError } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
import {
  bindSessionToInstallation,
  DEVICE_REGISTRY_PROTOCOL_VERSION,
  prepareInstallationEnrollment,
  readInstallationDetails,
} from "./deviceBinding.ts";
import { describeRegistryFailure, parseDeviceGate } from "./deviceRegistryPolicy.ts";

// shopSwitchDevice.ts — carrying this session's installation into the shop an
// owner switches to.
//
// THE BUG THIS EXISTS FOR (2026-11-22). A session is bound to ONE
// (shop, actor, installation) in auth_session_devices, and a23_session_gate
// refuses a bound session the moment its token names a different shop or actor
// ("mismatched" → device_session_unbound). shop-switch moved the owner's
// active_shop_id and nothing else, so the refreshed token named the target
// shop while the binding still named the source one. Every guarded request
// after it — the first pull, and the rollback switch back — was refused, and
// the app retried the switch forever behind "Checking your access…".
//
// What this changes is WHICH registration the session points at, never what
// is permitted. switchShop has already proved, before anything here runs:
//   - the shared guard: this session is bound to an ACTIVE installation with
//     an ACTIVE binding in the shop it is standing in (or is legacy-unbound in
//     an unenforced shop, which is left exactly as it was);
//   - the target is not blocked for this installation (a23_blocked_shops:
//     not revoked there, and not unregistered in an enforced shop);
//   - the caller is the owner of the target, on the same billing account.
// The installation identity comes from the verified session, never from the
// request body, so a caller can only ever carry ITS OWN handset — the one a
// phone + PIN or OTP proof already registered — and only into a shop the same
// owner already owns. A revocation, a binding revocation or an enrolment hold
// in the target still refuses.

export interface ShopSwitchSide {
  shopId: string;
  actorUserId: string;
}

export interface CarriedInstallation {
  devicePublicId: string;
  authority: unknown;
  /** Present only when the target registration was created or re-keyed. */
  deviceSecret?: string;
}

function gateUnavailable(code: string | undefined): HttpError {
  console.error(`sync/shop-switch device gate unavailable: db=${code ?? "unknown"}`);
  return new HttpError(503, "Could not verify this device right now", "device_gate_unavailable");
}

/**
 * The installation this verified session is bound to in `source`, or null for
 * a legacy unbound session (which keeps its pre-existing behaviour).
 */
export async function sessionInstallation(
  caller: Caller,
  source: ShopSwitchSide,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("a23_session_gate", {
    p_auth_session_id: caller.authSessionId,
    p_shop_id: source.shopId,
    p_actor_user_id: source.actorUserId,
  });
  if (error) throw gateUnavailable((error as { code?: string }).code);
  const gate = parseDeviceGate(data);
  if (!gate) throw gateUnavailable("malformed_response");
  if (!gate.facts.bound) return null;
  const devicePublicId = (data as Record<string, unknown>).devicePublicId;
  if (
    gate.facts.deviceStatus !== "active"
    || gate.facts.bindingStatus !== "active"
    || typeof devicePublicId !== "string"
    || devicePublicId.length === 0
  ) {
    // The shared guard refuses these before switchShop runs. Reaching here
    // means the registry changed in between; the source standing is gone.
    throw new HttpError(403, "Sign in again on this device to continue", "device_session_unbound");
  }
  return devicePublicId;
}

/**
 * A refusal about the TARGET shop, in codes the device will not mistake for
 * its current shop's standing.
 *
 * Deliberately NOT device_revoked / binding_revoked / device_session_unbound:
 * the device persists those against the shop it is standing in and quarantines
 * or re-links it. Here the source shop is fine — it is the target that said no.
 */
export function targetShopRefusal(error: unknown): HttpError {
  const code = error instanceof HttpError ? error.code : undefined;
  switch (code) {
    case "device_revoked":
    case "binding_revoked":
      return new HttpError(
        403,
        "This phone was removed from that shop. An Owner or Manager there must restore it.",
        "shop_switch_device_removed",
      );
    case "device_enrollment_held":
    case "device_approval_required":
      return new HttpError(
        403,
        "Another Owner or Manager phone in that shop must approve this phone first.",
        "shop_switch_approval_required",
      );
    case "account_inactive":
      return new HttpError(403, "Shop membership not found");
    case "device_gate_unavailable":
      return error as HttpError;
    default:
      console.error(`sync/shop-switch device carry failed: code=${code ?? "unknown"}`);
      return new HttpError(500, "Could not switch shop", "shop_switch_failed");
  }
}

function registryRefusal(error: { code?: string } | null): HttpError {
  const failure = describeRegistryFailure(error?.code);
  return targetShopRefusal(new HttpError(failure.status, failure.message, failure.code));
}

/**
 * Re-points this session at an EXISTING registration of the same installation
 * in `side`. No secret is rotated, so the device's stored secret stays valid.
 */
async function pointSessionAt(
  caller: Caller,
  side: ShopSwitchSide,
  devicePublicId: string,
): Promise<{ data: unknown; error: { code?: string } | null }> {
  const { data, error } = await supabaseAdmin.rpc("a23_authorize_actor_switch", {
    p_shop_id: side.shopId,
    p_device_public_id: devicePublicId,
    p_actor_user_id: side.actorUserId,
    p_auth_session_id: caller.authSessionId,
  });
  return { data, error: error as { code?: string } | null };
}

/** Registration missing in the target: MU066 (installation) or MU067 (binding). */
const NOT_REGISTERED = new Set(["MU066", "MU067"]);

/**
 * Binds this session to `target`'s registration of its own installation,
 * registering it there first if this is its first time in that shop.
 *
 * `body.deviceSecretMissing` lets a device that never received (or lost) its
 * secret for the target ask for a re-keyed one. It can only re-key its OWN
 * installation, which any phone + PIN sign-in on it may do anyway.
 */
export async function carryInstallationIntoShop(
  caller: Caller,
  source: ShopSwitchSide,
  target: ShopSwitchSide,
  body: Record<string, unknown>,
): Promise<CarriedInstallation | null> {
  const devicePublicId = await sessionInstallation(caller, source);
  if (!devicePublicId) return null;
  if (!caller.authSessionId) throw gateUnavailable("missing_session_id");

  if (body.deviceSecretMissing !== true) {
    const existing = await pointSessionAt(caller, target, devicePublicId);
    if (!existing.error) return { devicePublicId, authority: existing.data };
    if (!NOT_REGISTERED.has(existing.error.code ?? "")) throw registryRefusal(existing.error);
  }

  // Cosmetic fields (label, model) may come from the request; the identity
  // never does — it is overwritten with the session's own installation.
  const claim = {
    ...body,
    devicePublicId,
    deviceRegistryVersion: DEVICE_REGISTRY_PROTOCOL_VERSION,
  };
  let installation;
  try {
    installation = await prepareInstallationEnrollment(target.shopId, target.actorUserId, claim);
  } catch (error) {
    throw targetShopRefusal(error);
  }
  const details = installation ?? readInstallationDetails(claim);
  if (!details) throw new HttpError(500, "Could not switch shop", "shop_switch_failed");
  try {
    const bound = await bindSessionToInstallation(
      caller.authSessionId,
      target.shopId,
      target.actorUserId,
      details,
    );
    return { devicePublicId, authority: bound.authority, deviceSecret: bound.deviceSecret };
  } catch (error) {
    throw targetShopRefusal(error);
  }
}

/**
 * Best-effort compensation when the switch fails AFTER the session was carried:
 * point it back at the source registration it came from, so the session, its
 * binding and the unchanged active_shop_id agree again.
 */
export async function restoreSourceInstallation(
  caller: Caller,
  source: ShopSwitchSide,
  devicePublicId: string,
): Promise<void> {
  const { error } = await pointSessionAt(caller, source, devicePublicId);
  if (error) {
    console.error(`sync/shop-switch restore failed: db=${error.code ?? "unknown"}`);
  }
}
