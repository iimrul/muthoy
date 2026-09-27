// deviceRegistryPolicy.ts — A2.3's decisions, with nothing Deno-only in them.
//
// Split out for exactly the reason deviceLoginPolicy.ts was: the module beside
// this one imports `npm:bcryptjs` and `./_shared/auth.ts`, which the Node test
// runner cannot load, so anything left in there can only ever be checked by
// reading its source as text. These are the parts worth EXECUTING — the
// constant-time comparison, the deny-by-revocation rule, and the SQLSTATE
// mapping that decides whether a device quarantines itself.

/** 32 bytes. There is nothing to guess, which is why this is not bcrypt. */
const DEVICE_SECRET_BYTES = 32;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A fresh device secret. Returned to the device ONCE and never stored. */
export function mintDeviceSecret(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(DEVICE_SECRET_BYTES)));
}

/**
 * SHA-256, hex.
 *
 * NOT bcrypt, and the difference is deliberate. bcrypt's work factor exists to
 * make guessing cheap human input expensive; a 32-byte CSPRNG value has nothing
 * to guess, and paying ~300ms of bcrypt on the actor-switch path would make a
 * shared-till handover slower for no security at all. The PIN in the same
 * request stays bcrypt, because a PIN is exactly what bcrypt is for.
 */
export async function hashDeviceSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return toHex(new Uint8Array(digest));
}

/**
 * Length-independent constant-time comparison of two hex digests.
 *
 * Returning early on a length mismatch would be harmless here — both sides are
 * always 64 hex characters — but writing it that way invites reuse somewhere
 * the lengths do carry information. The XOR accumulator costs nothing.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

export interface RegistryFailure {
  status: number;
  message: string;
  code: string;
}

/**
 * Maps a registry SQLSTATE onto a stable, product-safe reply.
 *
 * The codes are load-bearing: the device uses them to decide whether to
 * persist a quarantine (`device_revoked`, `binding_revoked`) or simply report
 * a refusal. Anything unrecognised stays a 500 rather than being guessed at —
 * inventing a meaning for an unknown database error is how a transient fault
 * would end up locking a shop out of its own till.
 */
export function describeRegistryFailure(code: string | null | undefined): RegistryFailure {
  switch (code) {
    case "MU061":
      return {
        status: 403,
        message: "Owner or Manager access is required",
        code: "device_admin_required",
      };
    case "MU062":
      return {
        status: 400,
        message: "Device details are incomplete",
        code: "device_details_invalid",
      };
    case "MU063":
      return {
        status: 403,
        message: "This account is no longer active",
        code: "account_inactive",
      };
    case "MU064":
      return {
        status: 403,
        message: "This device has been removed from the shop",
        code: "device_revoked",
      };
    case "MU065":
      return {
        status: 403,
        message: "This account has been removed from this device",
        code: "binding_revoked",
      };
    case "MU066":
      return {
        status: 404,
        message: "This device is not registered",
        code: "device_not_registered",
      };
    case "MU067":
      return {
        status: 403,
        message: "This account is not registered on this device",
        code: "binding_not_registered",
      };
    case "MU068":
      return {
        status: 403,
        message: "Sign in again on this device before enabling enforcement",
        code: "device_session_unbound",
      };
    case "MU069":
      return {
        status: 403,
        message: "This device registration changed. Sign in again to relink it",
        code: "device_session_unbound",
      };
    case "MU070":
      return {
        status: 403,
        message: "Another active Owner or Manager installation must approve this device",
        code: "device_enrollment_held",
      };
    case "MU071":
      return {
        status: 403,
        message: "Approval requires a different active Owner or Manager installation",
        code: "device_approval_required",
      };
    default:
      return {
        status: 500,
        message: "Could not update device access",
        code: "device_registry_failed",
      };
  }
}

// ── Who is asking ─────────────────────────────────────────────────────────

/**
 * The requester's address, for the per-IP abuse budgets.
 *
 * `cf-connecting-ip` and NOTHING else. Supabase fronts Edge Functions with
 * Cloudflare, which sets that header to the address it accepted the connection
 * from and overwrites anything a client sent under the same name.
 *
 * `x-forwarded-for` — whose first hop this used to read — is a LIST, and a
 * client may put whatever it likes at the front of it. An attacker could
 * therefore vary it per request and hold a fresh rate-limit bucket every time,
 * which is precisely the budget the header was being consulted to enforce. A
 * limiter keyed on an attacker-chosen value is not a limiter.
 *
 * Returns null when the trusted header is absent (a local
 * `supabase functions serve`, or a future platform change). Callers must then
 * fall back to a bucket the CALLER cannot choose — never to a request-supplied
 * value, which would be the same hole under another name.
 *
 * Lives here, taking a plain getter, so it can be TESTED rather than
 * asserted about: index.ts cannot be imported by the Node runner.
 */
export function requesterIp(header: (name: string) => string | null): string | null {
  const connecting = header("cf-connecting-ip")?.trim();
  return connecting && connecting.length > 0 && connecting.length <= 64
    ? connecting
    : null;
}

// ── The request gate ──────────────────────────────────────────────────────

/** What a23_session_gate answered for this VERIFIED session. */
export interface DeviceGateFacts {
  /** shops.devices_enforced_at is set for the shop being acted on. */
  enforced: boolean;
  /** This session id has a row in auth_session_devices. */
  bound: boolean;
  /** Status of the installation the session was bound to. */
  deviceStatus: string | null;
  /** Status of this actor's binding on it. */
  bindingStatus: string | null;
}

export interface DeviceAuthorityFacts {
  known: boolean;
  status: "unknown" | "active" | "revoked";
  registryVersion: number;
  enforced: boolean;
  bindings: Array<{
    actorUserId: string;
    status: "active" | "revoked";
    bindingVersion: number;
  }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Strict boundary parser for every authority snapshot returned by PostgreSQL. */
export function parseDeviceAuthority(value: unknown): DeviceAuthorityFacts | null {
  const candidate = record(value);
  if (
    !candidate
    || typeof candidate.known !== "boolean"
    || typeof candidate.enforced !== "boolean"
    || !safeVersion(candidate.registryVersion)
    || !Array.isArray(candidate.bindings)
  ) return null;

  const status = candidate.status;
  if (
    (candidate.known === true && status !== "active" && status !== "revoked")
    || (candidate.known === false && status !== "unknown")
  ) return null;

  const bindings: DeviceAuthorityFacts["bindings"] = [];
  for (const rawBinding of candidate.bindings) {
    const binding = record(rawBinding);
    if (
      !binding
      || typeof binding.actorUserId !== "string"
      || binding.actorUserId.length === 0
      || (binding.status !== "active" && binding.status !== "revoked")
      || !safeVersion(binding.bindingVersion)
    ) return null;
    bindings.push({
      actorUserId: binding.actorUserId,
      status: binding.status,
      bindingVersion: binding.bindingVersion,
    });
  }
  return {
    known: candidate.known,
    status,
    registryVersion: candidate.registryVersion,
    enforced: candidate.enforced,
    bindings,
  };
}

export interface ParsedDeviceGate {
  facts: DeviceGateFacts;
  authority: DeviceAuthorityFacts | null;
}

/**
 * Missing fields are never interpreted as `false`. PostgreSQL represents the
 * legacy-unbound case explicitly with bound=false, enforced=<boolean>, null
 * statuses, and null authority; every other shape is an unavailable gate.
 */
export function parseDeviceGate(value: unknown): ParsedDeviceGate | null {
  const candidate = record(value);
  if (
    !candidate
    || typeof candidate.bound !== "boolean"
    || typeof candidate.enforced !== "boolean"
  ) return null;

  const deviceStatus = candidate.deviceStatus;
  const bindingStatus = candidate.bindingStatus;
  const validDeviceStatus = deviceStatus === null
    || deviceStatus === "active"
    || deviceStatus === "revoked"
    || deviceStatus === "mismatched";
  const validBindingStatus = bindingStatus === null
    || bindingStatus === "active"
    || bindingStatus === "revoked";
  if (!validDeviceStatus || !validBindingStatus) return null;

  if (!candidate.bound) {
    if (deviceStatus !== null || bindingStatus !== null || candidate.authority !== null) {
      return null;
    }
    return {
      facts: { bound: false, enforced: candidate.enforced, deviceStatus: null, bindingStatus: null },
      authority: null,
    };
  }

  const authority = candidate.authority === null
    ? null
    : parseDeviceAuthority(candidate.authority);
  if (candidate.authority !== null && !authority) return null;
  if (
    (deviceStatus === "active" || deviceStatus === "revoked")
    && authority === null
  ) return null;
  return {
    facts: {
      bound: true,
      enforced: candidate.enforced,
      deviceStatus,
      bindingStatus,
    },
    authority,
  };
}

/** Strict boundary parser for a23_blocked_shops. */
export function parseBlockedShopIds(
  value: unknown,
  requestedShopIds: readonly string[],
): string[] | null {
  if (!Array.isArray(value)) return null;
  const requested = new Set(requestedShopIds);
  const parsed: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !requested.has(id)) return null;
    parsed.push(id);
  }
  return parsed;
}

export type DeviceGateDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

function gateMessage(code: string): string {
  switch (code) {
    case "device_revoked":
      return "This device has been removed from the shop";
    case "binding_revoked":
      return "This account has been removed from this device";
    case "device_session_unbound":
      return "Sign in again on this device to continue";
    default:
      return "This device is not authorised for this shop";
  }
}

function refuse(code: string): DeviceGateDecision {
  return { allowed: false, code, message: gateMessage(code) };
}

/**
 * May this VERIFIED SESSION act on this shop's data?
 *
 * Pure, and exhaustively table-tested, because it is the single rule standing
 * between a stolen-but-still-valid token and a shop's entire history.
 *
 * The inputs are worth reading twice: there is no device id here, and no
 * secret. The previous version took both from the request body and was
 * therefore asking the caller to nominate its own authority — a revoked
 * handset could simply send something else. These facts come from looking up
 * the JWT's own `session_id` claim, which the client cannot choose.
 *
 * Two halves, deliberately separate:
 *
 *   A BOUND SESSION IS JUDGED ON ITS BINDING, ALWAYS. Revoke the device or the
 *   actor's binding and every session bound to it is refused on the next
 *   request — enforced or not. Revocation does not wait for a rollout flag.
 *
 *   ENFORCEMENT ONLY DECIDES THE FATE OF THE UNBOUND. A session with no
 *   binding is legacy: minted before this shipped, or by a flow that proved
 *   nothing. It is allowed while the shop is unenforced and refused once it is
 *   not. That is the whole meaning of devices_enforced_at.
 */
export function decideDeviceGate(facts: DeviceGateFacts): DeviceGateDecision {
  if (facts.bound) {
    // A mapping pointing at a device or binding that no longer exists, or at
    // another shop/actor. Not a revocation and not legacy — it is a session
    // whose standing cannot be established, so it fails closed either way.
    if (facts.deviceStatus === null || facts.bindingStatus === null) {
      return refuse("device_session_unbound");
    }
    if (facts.deviceStatus === "revoked") return refuse("device_revoked");
    if (facts.bindingStatus === "revoked") return refuse("binding_revoked");
    if (facts.deviceStatus !== "active" || facts.bindingStatus !== "active") {
      return refuse("device_session_unbound");
    }
    return { allowed: true };
  }

  // Unbound. Legacy while the shop has not enforced — this is what lets A2.3
  // deploy to a shop whose tills are mid-upgrade, and to sessions that were
  // already live when it did. Refused once the shop enforces, which is the
  // only thing that flag decides.
  return facts.enforced ? refuse("device_session_unbound") : { allowed: true };
}

/**
 * Refusals that are AUTHORITY: the device must persist them and quarantine.
 *
 * Everything else the gate can say means "sign in again", which is a
 * re-binding, not a revocation. Conflating them is how an ordinary expired
 * session would lock a shop out of its own till.
 */
export const DEVICE_REVOCATION_CODES = ["device_revoked", "binding_revoked"] as const;

/** Refusals meaning "prove a credential again", never "you were cut off". */
export const DEVICE_REENROLMENT_CODES = ["device_session_unbound"] as const;

/**
 * Every action the sync function routes, classified exactly once.
 *
 * ONE guard with ONE call site, and this table decides which actions it
 * covers — so a route added later cannot quietly arrive ungated. A test parses
 * index.ts and fails if any routed action is missing from all three lists.
 */
export const DEVICE_GUARDED_ACTIONS = [
  "pull",
  "push",
  "push-group",
  "refund-claim",
  "billing-init",
  "billing-status",
  "billing-terminal",
  "staff-reactivate",
  "device-list",
  "device-access",
  "shop-switch",
  "shop-create",
] as const;

/**
 * Actions that gate themselves, per TARGET shop, inside their handler.
 *
 * Multi-shop cannot use the shared guard: it keys on the caller's CURRENT
 * shop, and these two act on other ones. `shop-summaries` returns every
 * shop's takings and `shop-mutate` renames and archives shops the caller is
 * not standing in, so checking the active shop checks the wrong thing. They
 * call a23_blocked_shops with the session's own installation instead.
 * `shop-switch` is shared-guarded for the current shop and separately checks
 * its named target; `shop-create` is shared-guarded before creating anything.
 */
export const DEVICE_CROSS_SHOP_ACTIONS = [
  "shop-summaries",
  "shop-mutate",
] as const;

/**
 * Actions deliberately outside the gate, each with its stated reason.
 *
 * These are the paths by which a session ESTABLISHES standing. Gate them and
 * the system has no way back from its own refusals — in particular there is no
 * longer a `device-enroll` entry here, because a route on which any current
 * token could register a fresh trusted installation is the bypass this batch
 * exists to remove.
 */
export const DEVICE_EXEMPT_ACTIONS: Readonly<Record<string, string>> = {
  // Unauthenticated; each carries its own credential proof and limiter, and
  // each BINDS the session it mints.
  "device-login": "phone + PIN; it is how a device gets a bound session at all",
  "device-actor-switch": "device secret + PIN, verified in the handler, binds on success",
  // Standing-establishing or standing-repairing, all credential-proven.
  "link-device": "OTP registration; binds the caller's own proven session",
  "device-authority": "how a refused device learns why; gating it hides the answer",
  "recover-pin": "OTP-proved recovery; mints and binds a fresh session",
};

/**
 * True when this snapshot says the device, or this actor on it, is cut off.
 *
 * UNKNOWN IS NOT REVOKED. An installation the registry has never seen produces
 * no objection at all, and that is the property that makes deploying A2.3
 * safe: nothing becomes illegal by default, so no live shop is locked out of
 * its own till by the rollout.
 */
export function authorityRefusesActor(
  authority: Record<string, unknown> | null,
  actorUserId: string,
): boolean {
  if (!authority || authority.known !== true) return false;
  if (authority.status === "revoked") return true;
  const bindings = Array.isArray(authority.bindings) ? authority.bindings : [];
  return bindings.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const binding = entry as Record<string, unknown>;
    return binding.actorUserId === actorUserId && binding.status === "revoked";
  });
}
