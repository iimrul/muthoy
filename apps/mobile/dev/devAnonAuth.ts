// ============================================================================
// ⚠️  TEMPORARY — DEV-ONLY SUPABASE ANONYMOUS AUTH ENTRY.  REMOVE BEFORE PROD.
// ============================================================================
// See ./README.md for why this exists and exactly what to delete.
//
// This does NOT fake anything. It obtains a REAL Supabase session via
// signInAnonymously(), then hands off to the SAME production helpers the real
// OTP path uses. The only thing skipped is proving ownership of a phone
// number; everything after that — shop creation, the link-device Edge
// Function, the shop_claims registry, the JWT refresh that puts shop_id into
// app_metadata, RLS enforcement, PIN setup, and sync — is the production path,
// unmodified.

import {
  clearUnverifiedOwnerPhone,
  createShopAndOwner,
  getOwnerOnboardingPayload,
  getRegistrationStatus,
  markShopCloudLinked,
  type OwnerOnboardingPayload,
} from '../db/auth';
import { linkDeviceToShop } from '../sync/linkDevice';
import { requireSupabaseConfiguration, supabase } from '../sync/supabaseClient';

/** Business data on the shops row only — never used as an auth identity. */
export const DEV_SHOP_NAME = 'DEV Test Shop';
export const DEV_SHOP_PHONE = '+8801700000000';

/**
 * Marks a local registration as belonging to this dev flow.
 *
 * The phone is the marker because it is the one field carried by
 * `getRegistrationStatus()`'s `link_pending` result, and it is a placeholder
 * this flow wrote itself — never a real, verified identity.
 */
export function isDevPlaceholderPhone(phone: string): boolean {
  return phone === DEV_SHOP_PHONE;
}

export type DevRegistrationState =
  | { status: 'none' }
  /** Local shop exists but the device-link never completed — safe to retry. */
  | { status: 'link_incomplete'; shopId: string; ownerUserId: string }
  | { status: 'ready'; shopId: string; ownerUserId: string };

/**
 * Describes where a previous dev attempt stopped, so the UI can show a real
 * recovery state instead of silently doing nothing.
 *
 * Anything that is not a dev registration reports `none` — this must never
 * claim ownership of a real phone-registered shop.
 */
export async function getDevRegistrationState(): Promise<DevRegistrationState> {
  const registration = await getRegistrationStatus();
  if (registration.status === 'none') {
    return { status: 'none' };
  }
  if (!isDevPlaceholderPhone(registration.phone)) {
    return { status: 'none' };
  }
  return registration.status === 'link_pending'
    ? { status: 'link_incomplete', shopId: registration.shopId, ownerUserId: registration.userId }
    : { status: 'ready', shopId: registration.shopId, ownerUserId: registration.userId };
}

/**
 * The repair affordance belongs only to the anonymous DEV account already
 * linked to this placeholder shop. A different/missing session may not see or
 * run it merely because a local completed registration exists.
 */
export async function hasMatchingDevRepairSession(shopId: string): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user.is_anonymous === true
    && data.session.user.app_metadata.shop_id === shopId;
}

export class DevAuthError extends Error {}

/**
 * Strips the Owner's phone from the payload this flow sends to the server.
 *
 * `users_phone_unique` is GLOBAL — one live user per number across every shop —
 * and this flow writes the SAME placeholder into every DEV registration. The
 * second DEV shop could therefore never get an Owner row: the insert died with
 * 23505, surfaced as an opaque 500, and no amount of retrying could fix it.
 *
 * Sending null is not a workaround, it is the accurate record. Skip-OTP never
 * proved ownership of that number, so it must not be stored as the credential
 * that names this account on a fresh device. b4_create_owned_shop already does
 * exactly this for every secondary shop. The local row keeps the placeholder,
 * which is what marks the registration as a dev one.
 */
async function onboardingWithoutUnverifiedPhone(
  shopId: string,
  ownerUserId: string,
): Promise<OwnerOnboardingPayload> {
  // Cleared locally FIRST, so the payload and the local row agree. Otherwise
  // the queued users insert would keep pushing the placeholder back up, to be
  // rejected 23505 by the same global index, forever.
  await clearUnverifiedOwnerPhone(shopId, ownerUserId);
  const payload = await getOwnerOnboardingPayload(shopId, ownerUserId);
  return { ...payload, owner: { ...payload.owner, phone: null } };
}

/**
 * Returns an anonymous Supabase session, creating one if needed.
 *
 * Refuses to reuse a NON-anonymous session: that would attach a real
 * phone-verified account to this throwaway dev shop, permanently burning that
 * account's single `shop_claims` slot. `is_anonymous` is optional in the auth
 * types, so anything other than an explicit `true` is treated as real.
 */
async function ensureAnonymousSession(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  const existing = data.session;
  if (existing) {
    if (existing.user.is_anonymous === true) {
      return;
    }
    throw new DevAuthError(
      'A real (non-anonymous) Supabase session is signed in. Dev: Skip OTP will not reuse it — sign out first.',
    );
  }

  const { data: created, error: signInError } = await supabase.auth.signInAnonymously();
  if (signInError) {
    throw signInError;
  }
  if (!created.session) {
    throw new DevAuthError(
      'Anonymous sign-in returned no session. Enable Anonymous sign-ins in Supabase Auth settings.',
    );
  }
  if (created.session.user.is_anonymous !== true) {
    throw new DevAuthError('Expected an anonymous session but Supabase returned a non-anonymous one.');
  }
}

/** Repair must reuse the account that already owns shop_claims, never mint a
 * second anonymous identity and hope the server accepts it. */
async function requireExistingAnonymousSession(expectedShopId?: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) {
    throw new DevAuthError('The existing anonymous DEV session is required for repair.');
  }
  if (data.session.user.is_anonymous !== true) {
    throw new DevAuthError('Owner-link repair only accepts the existing anonymous DEV session.');
  }
  if (expectedShopId && data.session.user.app_metadata.shop_id !== expectedShopId) {
    throw new DevAuthError('Owner-link repair requires the anonymous session already linked to this DEV shop.');
  }
}

/**
 * Signs in anonymously (or reuses an existing ANONYMOUS session) and completes
 * registration exactly as `app/(auth)/otp-verify.tsx` does after a successful
 * OTP verification.
 *
 * Safe to re-run after a failure: an existing local dev registration is reused
 * rather than duplicated, and `linkDeviceToShop` is retried. Reusing the same
 * anonymous user matters because `shop_claims` binds a shop to one user id
 * permanently — a fresh anonymous user would be correctly rejected with 403.
 */
export async function devSignInAnonymouslyAndRegister(): Promise<{ shopId: string }> {
  requireSupabaseConfiguration();
  await ensureAnonymousSession();

  const state = await getDevRegistrationState();
  const created = state.status === 'none'
    ? await createShopAndOwner({ shopName: DEV_SHOP_NAME, phone: DEV_SHOP_PHONE })
    : { shopId: state.shopId, userId: state.ownerUserId };

  // The SAME canonical onboarding the real OTP flow runs. Not a DEV variant:
  // link-device creates the shop, roles and Owner through b4_onboard_owner,
  // writes the auth binding, and lets the server grant the trial. The only
  // thing this flow skipped was proving a phone number.
  const onboarding = await onboardingWithoutUnverifiedPhone(created.shopId, created.userId);
  await linkDeviceToShop(created.shopId, created.userId, { onboarding });
  await markShopCloudLinked(created.shopId);

  return { shopId: created.shopId };
}

/**
 * Repairs an already-registered device whose auth account was linked WITHOUT an
 * owner binding.
 *
 * Every step is the existing production path and every step is idempotent:
 * link-device re-claims a shop it already owns, `ensureAuthBinding` upserts and
 * then re-reads the agreed row, and `b4_ensure_owner_billing_account` writes
 * `launch_trial_granted_at` once with the entitlement row `on conflict do
 * nothing`. Running it on a healthy device changes nothing; running it on this
 * one writes the missing binding. It cannot create a second owner, a second
 * account, or a second trial, and it cannot reset or extend an existing one.
 */
export async function repairOwnerDeviceLink(): Promise<{
  shopId: string;
  ownerUserId: string;
}> {
  requireSupabaseConfiguration();
  const state = await getDevRegistrationState();
  if (state.status === 'none') {
    throw new DevAuthError('No local dev registration to repair.');
  }
  await requireExistingAnonymousSession(state.status === 'ready' ? state.shopId : undefined);

  const onboarding = await onboardingWithoutUnverifiedPhone(state.shopId, state.ownerUserId);
  await linkDeviceToShop(state.shopId, state.ownerUserId, { onboarding });
  // A completed registration may already carry a genuine cloud-link marker.
  // Preserve it byte-for-byte; only a previously incomplete link needs the
  // success marker written after strict refreshed-token verification passes.
  if (state.status === 'link_incomplete') {
    await markShopCloudLinked(state.shopId);
  }
  return { shopId: state.shopId, ownerUserId: state.ownerUserId };
}
