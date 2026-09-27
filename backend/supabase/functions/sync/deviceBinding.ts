import { HttpError } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
import {
  describeRegistryFailure,
  hashDeviceSecret,
  mintDeviceSecret,
} from "./deviceRegistryPolicy.ts";

// deviceBinding.ts — registering an installation, and binding the session that
// just proved a credential to it.
//
// Its own module, and NOT part of deviceRegistry.ts, for a structural reason
// rather than a stylistic one: deviceRegistry.ts imports `npm:bcryptjs` for
// the actor switch's PIN check, and a runtime npm: specifier cannot be loaded
// by the Node test runner even transitively. The three flows that bind a
// session — deviceLogin, linkDevice, recoverPin — all have executable test
// suites, and importing them through the bcrypt graph broke every one of them
// at collection time. Same split, and the same reason, as deviceLoginPolicy.ts.
//
// Everything here is also the answer to a security question. There used to be
// an authenticated `device-enroll` route: any live access token could call it
// and register a brand-new trusted installation, so a stolen token did not
// merely inherit a device — it could mint itself one. There is no such route
// now. Binding happens only from inside a flow that has just verified a
// credential, against the session that flow is about to hand back.

/** What a credential-proving flow knows about the handset it is running on. */
export interface InstallationDetails {
  devicePublicId: string;
  label?: string;
  platform?: string;
  model?: string;
  osVersion?: string;
}

/** Version advertised by clients that understand mandatory A2.3 binding. */
export const DEVICE_REGISTRY_PROTOCOL_VERSION = 1;

function optionalString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" && value.length <= 200 ? value : "";
}

export function readInstallationDetails(
  body: Record<string, unknown>,
): InstallationDetails | null {
  const devicePublicId = body.devicePublicId;
  if (
    typeof devicePublicId !== "string"
    || devicePublicId.length === 0
    || devicePublicId.length > 200
  ) {
    return null;
  }
  return {
    devicePublicId,
    label: optionalString(body, "label"),
    platform: optionalString(body, "platform"),
    model: optionalString(body, "model"),
    osVersion: optionalString(body, "osVersion"),
  };
}

export interface BoundInstallation {
  deviceSecret: string;
  authority: Record<string, unknown>;
}

function enrollmentFailure(code: string | null | undefined): HttpError {
  const failure = describeRegistryFailure(code);
  return new HttpError(failure.status, failure.message, failure.code);
}

/**
 * Checks the actor+shop enrolment hold before any session/PIN mutation.
 *
 * Missing installation identity is accepted only for an old client that did
 * not advertise A2.3 and only while the shop remains unenforced. Every current
 * client advertises the protocol version, so a missing id is a malformed
 * credential flow rather than a silent unbound-session fallback.
 */
export async function prepareInstallationEnrollment(
  shopId: string,
  actorUserId: string,
  body: Record<string, unknown>,
): Promise<InstallationDetails | null> {
  const installation = readInstallationDetails(body);
  const capable = body.deviceRegistryVersion === DEVICE_REGISTRY_PROTOCOL_VERSION;
  if (capable && !installation) {
    throw new HttpError(400, "This app installation could not be identified", "device_id_required");
  }

  const { data, error } = await supabaseAdmin.rpc("a23_prepare_enrollment", {
    p_shop_id: shopId,
    p_actor_user_id: actorUserId,
    p_device_public_id: installation?.devicePublicId ?? null,
  });
  if (error) throw enrollmentFailure((error as { code?: string }).code);
  const decision = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  if (
    !decision
    || typeof decision.allowed !== "boolean"
    || typeof decision.held !== "boolean"
    || typeof decision.enforced !== "boolean"
    || typeof decision.legacyUnbound !== "boolean"
  ) {
    throw new HttpError(503, "Could not verify device enrollment", "device_gate_unavailable");
  }
  if (decision.allowed !== true) {
    if (decision.held === true) throw enrollmentFailure("MU070");
    throw enrollmentFailure("MU068");
  }
  return installation;
}

/**
 * Registers this installation and binds the freshly minted session to it.
 *
 * `authSessionId` is the `session_id` claim of the token about to be returned,
 * read back from verifying that token — never from a request field.
 */
export async function bindSessionToInstallation(
  authSessionId: string,
  shopId: string,
  actorUserId: string,
  installation: InstallationDetails,
): Promise<BoundInstallation> {
  const secret = mintDeviceSecret();
  const { data, error } = await supabaseAdmin.rpc("a23_bind_auth_session", {
    p_auth_session_id: authSessionId,
    p_shop_id: shopId,
    p_actor_user_id: actorUserId,
    p_device_public_id: installation.devicePublicId,
    p_secret_hash: await hashDeviceSecret(secret),
    p_label: installation.label ?? "",
    p_platform: installation.platform ?? "",
    p_model: installation.model ?? "",
    p_os_version: installation.osVersion ?? "",
  });
  if (error) {
    const failure = describeRegistryFailure((error as { code?: string }).code);
    if (failure.code === "device_registry_failed") {
      // Detail to the function log only; the device gets a stable message.
      console.error(
        `sync/device-bind failed: db=${(error as { code?: string }).code ?? "unknown"}`,
      );
    }
    throw new HttpError(failure.status, failure.message, failure.code);
  }
  if (!data || typeof data !== "object") {
    throw new HttpError(500, "Could not register this device", "device_registry_failed");
  }
  // The ONE time the plaintext leaves this function. It is never logged, never
  // stored server-side, and never returned again — a device that loses it
  // re-proves a credential, which is the same thing that created it.
  return { deviceSecret: secret, authority: data as Record<string, unknown> };
}

/**
 * Binds a prepared credential flow. Null means the explicit pre-A2.3 legacy
 * case already accepted by prepareInstallationEnrollment; a current client
 * never degrades to an unbound session on an omitted id or registry failure.
 */
export async function tryBindSession(
  authSessionId: string | null,
  shopId: string,
  actorUserId: string,
  body: Record<string, unknown>,
  prepared?: InstallationDetails | null,
): Promise<BoundInstallation | null> {
  const installation = prepared === undefined
    ? await prepareInstallationEnrollment(shopId, actorUserId, body)
    : prepared;
  if (!installation) return null;
  if (!authSessionId) {
    throw new HttpError(500, "Could not bind this device session", "device_registry_failed");
  }
  return await bindSessionToInstallation(authSessionId, shopId, actorUserId, installation);
}
