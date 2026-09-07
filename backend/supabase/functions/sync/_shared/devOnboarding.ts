import { type Caller, HttpError } from "./auth.ts";

// Who is allowed to onboard an Owner, decided on the SERVER.
//
// link-device used to accept any authenticated JWT. That was the hole: an
// email or anonymous session could complete Owner onboarding on any project,
// because nothing downstream re-checks how the identity was proved. RLS keys
// on app_metadata.shop_id and never looks at the provider, so once linked the
// two are indistinguishable.
//
// The gate has two independent conditions and BOTH must hold for the DEV path:
//
//   1. A server-authoritative project check. It reads Edge Function secrets
//      that exist only on the DEV project. A client cannot set them, cannot
//      send them, and cannot influence them — so a DEV BUILD POINTED AT
//      PRODUCTION is refused by production itself, whatever the app believes
//      about its own __DEV__ flag.
//
//   2. A DEV-only identity marker. This selects the harness on a project that
//      already permits it; it never enables anything on its own.
//
// Production satisfies neither, so production accepts exactly one thing: an
// Owner whose phone Supabase itself verified by OTP.

export type EnvironmentReader = (name: string) => string | undefined;

/**
 * Reads a function secret, tolerating a host without `Deno` (Vitest runs these
 * modules under Node). An unreadable environment yields undefined, which
 * `devOnboardingEnabled` treats as "not the DEV project" — the safe direction.
 */
const defaultRead: EnvironmentReader = (name) => {
  const host = globalThis as {
    Deno?: { env?: { get(key: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  if (host.Deno?.env?.get) return host.Deno.env.get(name);
  // Vitest runs these modules under Node, where the secrets arrive as
  // process.env. Both hosts read the same names, so the gate under test is the
  // gate that ships. An unreadable environment yields undefined either way.
  return host.process?.env?.[name];
};

/**
 * The harness's first-run address.
 *
 * Deliberately a different subdomain from `users.muthoy.invalid`, which
 * identity.ts attaches to EVERY account, production included — reusing it
 * would make the marker meaningless. `.invalid` is RFC 2606 reserved, so
 * neither can belong to a real person.
 */
export const DEV_HARNESS_EMAIL_DOMAIN = "harness.muthoy.invalid";
const DEV_HARNESS_EMAIL = /^dev-[0-9a-f]{8,64}@harness\.muthoy\.invalid$/;

/** The durable, service-role-only marker. See `needsDevHarnessStamp`. */
export const DEV_HARNESS_METADATA_KEY = "dev_harness";

export type OwnerOnboardingMode = "otp" | "dev_harness";

/**
 * True only on a project whose Edge Function secrets say so.
 *
 * Two variables, both required, both fail-closed. `MUTHOY_ENVIRONMENT` already
 * gates server auth timing, so this reuses an established signal rather than
 * inventing a second notion of "which project am I".
 */
export function devOnboardingEnabled(read: EnvironmentReader = defaultRead): boolean {
  return read("MUTHOY_ENVIRONMENT") === "development"
    && read("MUTHOY_DEV_ONBOARDING") === "1";
}

/**
 * Whether this caller is the DEV harness identity.
 *
 * Two ways to qualify, because link-device REWRITES the account's email:
 * `ensureAuthBinding` attaches the canonical `u-<appUserId>@users.muthoy.invalid`
 * address, so the first-run marker is gone by the second call. The stamp is
 * what survives, and being service-role-only it is also the one signal a client
 * could never forge.
 *
 * An anonymous session is refused outright, on every project and by both
 * routes. Nothing in the app can create one, and nothing here will accept one.
 */
export function isDevHarnessCaller(caller: Caller): boolean {
  if (caller.isAnonymous) return false;
  const metadata = caller.raw.app_metadata as Record<string, unknown> | undefined;
  if (metadata?.[DEV_HARNESS_METADATA_KEY] === true) return true;
  return typeof caller.email === "string"
    && DEV_HARNESS_EMAIL.test(caller.email)
    && caller.emailConfirmedAt !== null;
}

/**
 * THE onboarding gate. Returns how the caller qualified, or throws 403.
 *
 * Order is deliberate: a verified phone is checked first and needs no project
 * exception, so the production path is never routed through DEV logic. The
 * project check then precedes the identity check, so a DEV-shaped identity on
 * a production project is refused before its marker is even examined.
 *
 * One message for every failure, so this cannot be used to probe which project
 * is which or which identities exist.
 */
export function assertOwnerOnboardingIdentity(
  caller: Caller,
  read: EnvironmentReader = defaultRead,
): OwnerOnboardingMode {
  if (caller.verifiedPhone) return "otp";
  if (devOnboardingEnabled(read) && isDevHarnessCaller(caller)) return "dev_harness";
  throw new HttpError(
    403,
    "Owner onboarding requires a phone number verified by OTP",
    "otp_required",
  );
}

/** Whether the durable marker still needs writing for this caller. */
export function needsDevHarnessStamp(caller: Caller, mode: OwnerOnboardingMode): boolean {
  if (mode !== "dev_harness") return false;
  const metadata = caller.raw.app_metadata as Record<string, unknown> | undefined;
  return metadata?.[DEV_HARNESS_METADATA_KEY] !== true;
}
