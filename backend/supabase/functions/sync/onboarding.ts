import { HttpError } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

/**
 * The ONE way a shop and its Owner reach the server.
 *
 * Registration used to have two, and neither worked. The real OTP path had no
 * server-side creation at all: it wrote the rows to local SQLite and trusted
 * ordinary sync push to carry them up — but push rejects a caller without an
 * app_user_id claim, that claim needs an auth_bindings row, and the binding is
 * only written after assertBindingTarget has found the users row ON THE SERVER.
 * A genuinely new shop could never close that loop. DEV Skip-OTP worked around
 * it with a private bootstrap that wrote through PostgREST as service_role,
 * which holds no INSERT on those tables and died with 42501 every time.
 *
 * Both now call b4_onboard_owner, a SECURITY DEFINER function that creates the
 * shop, its three system roles, the Owner and the B2 settings row in one
 * transaction, idempotently. DEV differs from production in exactly one place —
 * how the session was authenticated — and nowhere after it.
 */

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const ROLE_NAMES = new Set(["owner", "manager", "staff"]);

function object(value: unknown, field: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `Invalid onboarding ${field}`, "onboarding_invalid");
  }
  return value as Json;
}

function text(source: Json, key: string, field: string, max = 200): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new HttpError(400, `Invalid onboarding ${field}.${key}`, "onboarding_invalid");
  }
  return value;
}

function uuid(source: Json, key: string, field: string): string {
  const value = text(source, key, field, 36);
  if (!UUID.test(value)) {
    throw new HttpError(400, `Invalid onboarding ${field}.${key}`, "onboarding_invalid");
  }
  return value;
}

function timestamp(source: Json, key: string, field: string): string {
  const value = text(source, key, field, 40);
  if (!Number.isFinite(Date.parse(value))) {
    throw new HttpError(400, `Invalid onboarding ${field}.${key}`, "onboarding_invalid");
  }
  return value;
}

function optionalTimestamp(source: Json, key: string, field: string): string | null {
  return source[key] === null || source[key] === undefined
    ? null
    : timestamp(source, key, field);
}

/**
 * Structural validation only — the database owns the authority questions
 * (does this shop already have a different owner, is this phone taken). Those
 * cannot be answered here without a read that would race the write anyway.
 */
export function parseOnboarding(raw: unknown, shopId: string, ownerUserId: string): Json {
  const root = object(raw, "payload");
  const shop = object(root.shop, "shop");
  const owner = object(root.owner, "owner");
  const roles = root.roles;
  if (!Array.isArray(roles) || roles.length === 0 || roles.length > 8) {
    throw new HttpError(400, "Invalid onboarding roles", "onboarding_invalid");
  }

  const parsedRoles = roles.map((entry) => {
    const role = object(entry, "role");
    const name = text(role, "name", "role", 20);
    if (!ROLE_NAMES.has(name)) {
      throw new HttpError(400, "Invalid onboarding role name", "onboarding_invalid");
    }
    return {
      id: uuid(role, "id", "role"),
      shopId: uuid(role, "shopId", "role"),
      name,
      createdAt: timestamp(role, "createdAt", "role"),
      updatedAt: timestamp(role, "updatedAt", "role"),
    };
  });

  const pinHash = text(owner, "pinHash", "owner", 100);
  if (!BCRYPT.test(pinHash)) {
    throw new HttpError(400, "Invalid onboarding owner.pinHash", "onboarding_invalid");
  }

  const parsed = {
    shop: {
      id: uuid(shop, "id", "shop"),
      ownerId: uuid(shop, "ownerId", "shop"),
      name: text(shop, "name", "shop", 120),
      nameEn: typeof shop.nameEn === "string" ? shop.nameEn.slice(0, 120) : null,
      phone: text(shop, "phone", "shop", 30),
      createdAt: timestamp(shop, "createdAt", "shop"),
      updatedAt: timestamp(shop, "updatedAt", "shop"),
    },
    roles: parsedRoles,
    owner: {
      id: uuid(owner, "id", "owner"),
      shopId: uuid(owner, "shopId", "owner"),
      name: text(owner, "name", "owner", 120),
      phone: typeof owner.phone === "string" && owner.phone.length > 0
        ? owner.phone.slice(0, 30)
        : null,
      pinHash,
      pinSetAt: optionalTimestamp(owner, "pinSetAt", "owner"),
      roleId: uuid(owner, "roleId", "owner"),
      createdAt: timestamp(owner, "createdAt", "owner"),
      updatedAt: timestamp(owner, "updatedAt", "owner"),
    },
    settings: root.settings === undefined || root.settings === null
      ? null
      : { id: uuid(object(root.settings, "settings"), "id", "settings") },
  };

  // The request already named the shop and owner it is linking. The payload has
  // to agree, or a caller who legitimately holds one shop's claim could onboard
  // an Owner into a different shop entirely.
  if (parsed.shop.id !== shopId || parsed.owner.id !== ownerUserId) {
    throw new HttpError(403, "This account cannot be linked to that shop");
  }
  return parsed as unknown as Json;
}

/** Maps the function's own error codes onto answers the device can act on. */
const ONBOARDING_ERRORS: Record<string, { status: number; message: string; code: string }> = {
  MU041: { status: 400, message: "Onboarding details are inconsistent", code: "onboarding_invalid" },
  MU042: { status: 403, message: "This account cannot be linked to that shop", code: "onboarding_conflict" },
  MU043: { status: 409, message: "That phone number already has a shop", code: "phone_already_registered" },
};

export async function onboardOwner(
  shopId: string,
  ownerUserId: string,
  raw: unknown,
): Promise<void> {
  const payload = parseOnboarding(raw, shopId, ownerUserId);
  const { error } = await supabaseAdmin.rpc("b4_onboard_owner", { p_payload: payload });
  if (!error) return;

  const known = error.code ? ONBOARDING_ERRORS[error.code] : undefined;
  if (known) {
    throw new HttpError(known.status, known.message, known.code);
  }
  // Anything unmapped keeps its SQLSTATE and the step that raised it. The
  // database's own message is dropped: it can quote the offending row.
  throw new HttpError(
    500,
    `Could not complete onboarding (db=${error.code ?? "unknown"} op=onboard_owner)`,
    "onboarding_failed",
  );
}
