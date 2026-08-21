import * as bcrypt from "npm:bcryptjs@3";
import { HttpError } from "./_shared/auth.ts";
import type { ServerAuthTiming } from "./_shared/authTiming.ts";
import { mintSessionForAppUser, resolveOrCreateAuthUserId } from "./_shared/identity.ts";
import { normalizeBdPhone } from "./_shared/phone.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

// deviceLogin.ts — phone + PIN, on a device whose SQLite is still empty.
//
// This is the ONLY unauthenticated action on the sync function: it is the entry
// point that mints the token every other action requires. Everything about its
// shape follows from that.
//
// It exists because an enrolled device logs in PIN-only, matching against the
// bcrypt hashes already on disk (db/auth.ts's verifyPin) — a check a FRESH
// device cannot perform, having no rows yet. Phone names the account so the
// server can verify the PIN, mint a session, and let the device hydrate.
//
// No OTP here: per Volume 4 staff never have a phone number to receive one at,
// and an owner's routine login must not wait on an SMS. OTP survives in exactly
// one place — owner PIN recovery — where the number is being proved precisely
// because the PIN is what was lost.

// A real bcrypt hash of a value no 4-digit PIN can equal. Compared against when
// the phone matches no account, so a miss costs the same ~300ms as a hit —
// without it, response time alone would tell an attacker which numbers are
// registered.
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const GENERIC_FAILURE = "Incorrect phone number or PIN";

// Attempts before a lockout starts, per key. The phone budget is the account
// guard. The IP budget is the DoS guard and is necessarily looser, because a
// pharmacy behind one NAT may legitimately hold several staff accounts — but it
// is what stops an attacker walking a LIST of numbers and spending ~300ms of
// bcrypt per request without ever tripping a per-phone limit.
const PHONE_ATTEMPT_BUDGET = 5;
const IP_ATTEMPT_BUDGET = 20;

async function timed<T>(
  timing: ServerAuthTiming | undefined,
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  return timing ? await timing.measure(stage, operation) : await operation();
}

interface DeviceLoginBody {
  /** Canonical +8801XXXXXXXXX. */
  phone: string;
  pin: string;
}

function parseBody(body: Record<string, unknown>): DeviceLoginBody {
  const { phone, pin } = body;
  if (typeof phone !== "string" || typeof pin !== "string") {
    throw new HttpError(400, "phone and pin are required");
  }
  // Canonicalised HERE, once, so the lockout key, the lookup and the stored
  // column can never disagree about which subscriber this is. An owner who
  // registered as '01712345678' and types '+8801712345678' is the same person
  // and now resolves to the same account instead of to a generic refusal.
  const canonical = normalizeBdPhone(phone);
  // Shape only, and answered with the generic failure — never a reply that
  // distinguishes "malformed" from "not registered".
  if (!canonical || !/^\d{4}$/.test(pin)) {
    throw new HttpError(401, GENERIC_FAILURE);
  }
  return { phone: canonical, pin };
}

/**
 * The lockout keys this attempt spends.
 *
 * Both are checked before any bcrypt work and both are incremented on failure.
 * Keying the counter on the raw string was a real hole: rotating
 * `01712345678` / `8801712345678` / `+8801712345678` bought three independent
 * budgets against ONE account. The key is the canonical form for that reason.
 */
function attemptKeys(phone: string, clientIp: string | null): { phone: string; ip: string | null } {
  return { phone: `phone:${phone}`, ip: clientIp ? `ip:${clientIp}` : null };
}

async function isLocked(key: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("login_attempt_locked_until", { p_key: key });
  if (error) {
    throw new HttpError(500, "Could not verify credentials");
  }
  return Boolean(data);
}

async function registerFailure(key: string, budget: number): Promise<void> {
  const { error } = await supabaseAdmin.rpc("register_login_failure", {
    p_key: key,
    p_free_attempts: budget,
  });
  if (error) {
    // The attempt could not be counted, so the lockout cannot be trusted on the
    // next request either. Refuse, rather than serve an unmetered PIN oracle
    // for as long as the outage lasts.
    throw new HttpError(500, "Could not verify credentials");
  }
}

interface ResolvedUser {
  id: string;
  shopId: string;
  pinHash: string;
  roleName: string;
}

async function findUserByPhone(phone: string): Promise<ResolvedUser | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, shop_id, pin_hash, pin_set_at, roles!inner(name)")
    .eq("phone", phone)
    .eq("is_active", true)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "Could not verify credentials");
  }
  // pin_set_at null means registration never finished, so pin_hash is still the
  // random placeholder createShopAndOwner wrote. Treated as no account rather
  // than as a wrong PIN, so the placeholder can never be probed.
  if (!data || !data.pin_hash || !data.pin_set_at) {
    return null;
  }
  const roleName = (data.roles as unknown as { name: string } | null)?.name;
  // A P1 'manager' row gets no session at all, matching verifyPin's stance on
  // the mobile side: a role Beta does not assign must not mint a token the
  // guards would then have to keep rejecting screen by screen.
  if (roleName !== "owner" && roleName !== "staff") {
    return null;
  }
  return { id: data.id, shopId: data.shop_id, pinHash: data.pin_hash, roleName };
}

export async function deviceLogin(
  body: Record<string, unknown>,
  clientIp: string | null,
  timing?: ServerAuthTiming,
) {
  const { phone, pin } = parseBody(body);
  const keys = attemptKeys(phone, clientIp);

  // BEFORE any bcrypt work. The lockout is a brute-force guard second and a
  // CPU-exhaustion guard first: bcrypt at cost 10 is ~300ms of server time per
  // call, which is a denial-of-service primitive on an open endpoint. The IP
  // key is what makes that true for an attacker walking a list of numbers,
  // where no single phone counter would ever trip.
  if (keys.ip && await timed(timing, "rate_limit_ip", () => isLocked(keys.ip!))) {
    throw new HttpError(429, "Too many attempts. Try again later.");
  }
  if (await timed(timing, "rate_limit_phone", () => isLocked(keys.phone))) {
    // Deliberately the SAME message as a wrong PIN. A distinct "too many
    // attempts" reply confirms the number is registered, which is precisely
    // what the generic error exists to withhold. (The IP branch above may say
    // so plainly — it identifies a network, not an account.)
    throw new HttpError(401, GENERIC_FAILURE);
  }

  const user = await timed(timing, "account_lookup", () => findUserByPhone(phone));
  const matches = await timed(
    timing,
    "server_bcrypt",
    () => bcrypt.compare(pin, user?.pinHash ?? DUMMY_HASH),
  );

  if (!user || !matches) {
    await timed(
      timing,
      "failure_counter_phone",
      () => registerFailure(keys.phone, PHONE_ATTEMPT_BUDGET),
    );
    if (keys.ip) {
      await timed(
        timing,
        "failure_counter_ip",
        () => registerFailure(keys.ip!, IP_ATTEMPT_BUDGET),
      );
    }
    throw new HttpError(401, GENERIC_FAILURE);
  }

  await timed(
    timing,
    "failure_counter_clear",
    async () => {
      await supabaseAdmin.rpc("clear_login_failures", { p_key: keys.phone });
    },
  );

  const authUserId = await resolveOrCreateAuthUserId(user.id, timing);

  // shop_id is written to app_metadata BEFORE the token is minted, not after:
  // every pre-existing RLS policy reads this claim, and the hook preserves an
  // existing shop_id rather than replacing it. Writing it afterwards would mint
  // one token without it.
  const { error: metadataError } = await timed(
    timing,
    "session_metadata_update",
    () => supabaseAdmin.auth.admin.updateUserById(authUserId, {
      app_metadata: { shop_id: user.shopId },
    }),
  );
  if (metadataError) {
    throw new HttpError(500, "Could not start session");
  }

  const session = await mintSessionForAppUser(user.id, timing);

  return {
    shopId: user.shopId,
    userId: user.id,
    role: user.roleName,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}
