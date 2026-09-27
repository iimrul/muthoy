import { type Caller, HttpError } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
import {
  decideDeviceGate,
  DEVICE_GUARDED_ACTIONS,
  parseBlockedShopIds,
  parseDeviceGate,
} from "./deviceRegistryPolicy.ts";

// deviceGuard.ts — A2.3's server-side enforcement, in ONE place.
//
// The first version of this file asked the wrong question. It read
// `devicePublicId` and `deviceSecret` out of the request body and checked them
// against the registry — which is to say, it asked the caller which device it
// was, then verified the answer against a credential stored in the same app
// storage that caller controlled. A revoked handset could send a different id,
// send none, or send the id of a device it had watched a colleague use.
//
// It now asks: which installation was THIS SESSION created on? That is
// answerable, because the session id is a claim inside a JWT GoTrue has
// already verified, and auth_session_devices records which installation the
// credential-proving flow bound it to. There is no parameter here a caller can
// influence — the request body is not consulted at all.
//
// ONE guard, ONE call site (index.ts), with the action classification living
// in deviceRegistryPolicy.ts where a test parses the router back against it.
// The shape this replaced — a check each route was supposed to remember to
// call — is how pull ended up gated and push did not.

const GUARDED = new Set<string>(DEVICE_GUARDED_ACTIONS);

export function isDeviceGuardedAction(action: unknown): boolean {
  return typeof action === "string" && GUARDED.has(action);
}

function gateUnavailable(code: string | undefined): HttpError {
  // FAIL CLOSED, but transiently. A registry that cannot answer cannot be read
  // as permission — an outage is exactly the moment a revoked handset would
  // like the gate to shrug. 503 with a code the client treats as a retry, so a
  // bad minute stalls sync instead of quarantining a shop: the device persists
  // nothing, and nothing is revoked by a database hiccup.
  console.error(`sync/device-gate unavailable: db=${code ?? "unknown"}`);
  return new HttpError(
    503,
    "Could not verify this device right now",
    "device_gate_unavailable",
  );
}

/**
 * Refuses this request if the registry says this session may not act.
 *
 * Every input comes from the VERIFIED token: `caller.authSessionId`,
 * `caller.shopId` and `caller.appUserId` are claims GoTrue validated, so a
 * caller can neither aim the gate at another shop nor nominate a different
 * installation for itself.
 *
 * Returns quietly when the token carries no shop or actor claim. Not leniency:
 * the route's own `requireCallerShop` / `assertCallerCurrent` refuses such a
 * caller a moment later with the right error, and duplicating that judgement
 * here would only give it a second, worse-worded voice.
 */
export async function assertDeviceAuthority(caller: Caller): Promise<void> {
  const shopId = caller.shopId;
  const actorUserId = caller.appUserId;
  if (!shopId || !actorUserId) return;

  const { data, error } = await supabaseAdmin.rpc("a23_session_gate", {
    p_auth_session_id: caller.authSessionId,
    p_shop_id: shopId,
    p_actor_user_id: actorUserId,
  });
  if (error) {
    throw gateUnavailable((error as { code?: string } | null)?.code);
  }
  const gate = parseDeviceGate(data);
  if (!gate) throw gateUnavailable("malformed_response");
  const decision = decideDeviceGate(gate.facts);
  if (decision.allowed) return;

  // The snapshot rides on the refusal. It is how a device that has been cut
  // off actually LEARNS it: the request never reaches a handler that could
  // return one, and after a revocation there may be no successful request left
  // in which to tell it. It carries no credential — a23_device_authority
  // deliberately omits the secret digest.
  const authority = gate.authority
    ? { authority: gate.authority }
    : undefined;
  throw new HttpError(403, decision.message, decision.code, authority);
}

/**
 * Enrollment/recovery bypass the ordinary route gate so they can establish a
 * new session. A session that is ALREADY bound does not get to bypass its
 * standing: revocation is checked before it can nominate another installation.
 * Unbound is accepted here only because the caller has separately proved a
 * fresh credential in the enclosing flow.
 */
export async function assertSessionMayBindInstallation(
  caller: Caller,
  shopId: string,
  actorUserId: string,
): Promise<void> {
  if (!caller.authSessionId) throw gateUnavailable("missing_session_id");
  const { data, error } = await supabaseAdmin.rpc("a23_session_gate", {
    p_auth_session_id: caller.authSessionId,
    p_shop_id: shopId,
    p_actor_user_id: actorUserId,
  });
  if (error) throw gateUnavailable((error as { code?: string }).code);
  const gate = parseDeviceGate(data);
  if (!gate) throw gateUnavailable("malformed_response");
  if (!gate.facts.bound) return;
  const decision = decideDeviceGate(gate.facts);
  if (decision.allowed) return;
  throw new HttpError(
    403,
    decision.message,
    decision.code,
    gate.authority ? { authority: gate.authority } : undefined,
  );
}

/**
 * The target shops this session's installation may NOT act in.
 *
 * Multi-shop cannot use the guard above: that keys on the caller's CURRENT
 * shop, while shop-summaries returns every shop's takings and shop-mutate
 * renames and archives shops the caller is not standing in. Validating either
 * against the active shop checks the wrong thing entirely — a handset revoked
 * in the shop being administered would pass, because it is still fine in the
 * shop it happens to be looking at.
 *
 * The installation is resolved from the session and then looked up again under
 * each target shop by its own public id, because one handset enrolled in two
 * shops is two independently revocable rows.
 */
export async function blockedShopsForSession(
  caller: Caller,
  shopIds: readonly string[],
): Promise<Set<string>> {
  if (shopIds.length === 0) return new Set();
  if (!caller.principalUserId) throw gateUnavailable("missing_principal");
  const { data, error } = await supabaseAdmin.rpc("a23_blocked_shops", {
    p_auth_session_id: caller.authSessionId,
    p_principal_user_id: caller.principalUserId,
    p_shop_ids: shopIds,
  });
  // Same fail-closed-but-transient rule as the guard. Answering "nothing is
  // blocked" on a lookup fault would make an outage the way through.
  if (error) throw gateUnavailable((error as { code?: string }).code);
  const blocked = parseBlockedShopIds(data, shopIds);
  if (!blocked) throw gateUnavailable("malformed_response");
  return new Set(blocked);
}

/**
 * Refuses one target shop, for the administration routes that act on a single
 * named shop rather than listing many.
 */
export async function assertShopNotBlocked(
  caller: Caller,
  shopId: string,
): Promise<void> {
  const blocked = await blockedShopsForSession(caller, [shopId]);
  if (!blocked.has(shopId)) return;
  throw new HttpError(
    403,
    "Sign in again on this device to manage that shop",
    "device_session_unbound",
  );
}
