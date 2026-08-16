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

import { createShopAndOwner, getRegistrationStatus, markShopCloudLinked } from '../db/auth';
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
  | { status: 'link_incomplete'; shopId: string }
  | { status: 'ready'; shopId: string };

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
  if (registration.status === 'link_pending') {
    return isDevPlaceholderPhone(registration.phone)
      ? { status: 'link_incomplete', shopId: registration.shopId }
      : { status: 'none' };
  }
  return { status: 'ready', shopId: registration.shopId };
}

export class DevAuthError extends Error {}

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
  const shopId =
    state.status === 'none'
      ? (await createShopAndOwner({ shopName: DEV_SHOP_NAME, phone: DEV_SHOP_PHONE })).shopId
      : state.shopId;

  // Production helper, untouched: invokes the `sync` Edge Function's
  // link-device action (which claims the shop in shop_claims and writes
  // app_metadata.shop_id), then refreshSession() and verifies the refreshed
  // JWT actually carries that shop_id. RLS depends on that claim.
  await linkDeviceToShop(shopId);
  await markShopCloudLinked(shopId);

  return { shopId };
}
