// ============================================================================
// ⚠️  DEV-ONLY — TEMPORARY UNTIL H-5 SHIPS A PRODUCTION OTP PROVIDER.
// ============================================================================
// metro.config.js resolves this module's only importer to an inert stub in
// every non-dev bundle, so nothing here — not a string, not an auth call —
// reaches a release build. H-5 deletes the whole harness; see dev/README.md.
//
// This bypasses EXACTLY ONE thing: proving ownership of a phone number.
// Everything after that is the production path, unmodified:
//   createShopAndOwner → getOwnerOnboardingPayload → linkDeviceToShop
//   (b4_onboard_owner → auth binding → token refresh → strict Owner claims)
//   → markShopCloudLinked → the root gate → PIN setup.
//
// THE CLIENT DOES NOT DECIDE THIS IS ALLOWED. `sync/link-device` refuses any
// caller without a Supabase-verified phone unless the project's own Edge
// Function secrets enable DEV onboarding — so this build pointed at production
// is refused by production, whatever `__DEV__` says here. See
// backend/supabase/functions/sync/_shared/devOnboarding.ts.
//
// It is NOT the removed anonymous bootstrap, and the differences are the point:
//
//   * The session is a REAL, non-anonymous email identity that can sign back
//     in. Anonymous users could not, so a cleared device permanently orphaned
//     its cloud shop — `shop_claims` binds a shop to one user id forever.
//   * The Owner's phone credential is NULL, not a placeholder masquerading as
//     verified. Nothing here claims an OTP happened.
//   * Recovery is identity-bound and finishes ONE interrupted link. It cannot
//     create a shop, an owner or a trial, and it refuses anything it did not
//     start itself.

import { getRandomBytes } from 'expo-crypto';
import { createMMKV } from 'react-native-mmkv';
import {
  createShopAndOwner,
  getOwnerOnboardingPayload,
  getRegistrationStatus,
  markShopCloudLinked,
} from '../db/auth';
import { linkDeviceToShop } from '../sync/linkDevice';
import { requireSupabaseConfiguration, supabase } from '../sync/supabaseClient';

/** Ordinary business fields on the shops row. Neither is a credential, and the
 *  contact number is deliberately unassigned-looking — it proves nothing and is
 *  never presented as verified. `shops.phone` is NOT NULL and carries no unique
 *  index in either database, so one fixed value is safe to reuse. */
export const DEV_HARNESS_SHOP_NAME = 'DEV Test Shop';
export const DEV_HARNESS_SHOP_CONTACT = '+8801700000000';

/**
 * Must match `DEV_HARNESS_EMAIL` in the Edge Function's devOnboarding.ts.
 *
 * A DIFFERENT subdomain from `users.muthoy.invalid`, which the server attaches
 * to every account including production ones — reusing that would make the
 * marker meaningless. RFC 2606 reserved, so it can never reach a real person.
 */
const DEV_IDENTITY_EMAIL_DOMAIN = 'harness.muthoy.invalid';

const EMAIL_KEY = 'devOwnerEmail';
const PASSWORD_KEY = 'devOwnerPassword';
const SHOP_KEY = 'devOwnerShopId';
const OWNER_KEY = 'devOwnerUserId';

/**
 * A throwaway credential for a disposable account on a disposable project.
 *
 * Plain MMKV is acceptable here and nowhere else: this module cannot exist in a
 * release bundle, and the account it names owns nothing but test data. Do not
 * copy the pattern — real secrets wait for H-3's `expo-secure-store` key store.
 */
const identityStore = createMMKV({ id: 'muthoy-dev-harness' });

export class DevHarnessError extends Error {}

interface DevIdentity {
  email: string;
  password: string;
}

function randomHex(byteLength: number): string {
  return Array.from(getRandomBytes(byteLength), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * The last line of defence, behind metro.config.js's resolver swap. If this
 * ever throws in a shipped app, the boundary above it has already failed.
 */
export function assertDevBuild(): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new DevHarnessError('The DEV registration harness cannot run in a production build.');
  }
}

function readDevIdentity(): DevIdentity | null {
  const email = identityStore.getString(EMAIL_KEY);
  const password = identityStore.getString(PASSWORD_KEY);
  return email && password ? { email, password } : null;
}

function createDevIdentity(): DevIdentity {
  const identity: DevIdentity = {
    email: `dev-${randomHex(8)}@${DEV_IDENTITY_EMAIL_DOMAIN}`,
    password: randomHex(24),
  };
  identityStore.set(EMAIL_KEY, identity.email);
  identityStore.set(PASSWORD_KEY, identity.password);
  return identity;
}

/**
 * Re-points the stored address at whatever the account's email actually IS now.
 *
 * `ensureAuthBinding` REWRITES it during link-device, to the canonical
 * `u-<appUserId>@users.muthoy.invalid` every account gets. Without this the
 * next launch would sign in with an address that no longer exists, fall through
 * to sign-up, mint a SECOND account, and be refused by `shop_claims` — the
 * exact orphaning the anonymous flow was removed for. Reading the live value
 * rather than recomputing the server's format keeps the two from drifting.
 */
function captureBoundEmail(email: string | null | undefined): void {
  if (email) identityStore.set(EMAIL_KEY, email);
}

/** The shop this harness created, remembered so recovery is identity-bound. */
function readHarnessRegistration(): { shopId: string; ownerUserId: string } | null {
  const shopId = identityStore.getString(SHOP_KEY);
  const ownerUserId = identityStore.getString(OWNER_KEY);
  return shopId && ownerUserId ? { shopId, ownerUserId } : null;
}

function rememberHarnessRegistration(shopId: string, ownerUserId: string): void {
  identityStore.set(SHOP_KEY, shopId);
  identityStore.set(OWNER_KEY, ownerUserId);
}

/**
 * A real, non-anonymous Supabase session for this device's DEV identity.
 *
 * Refuses to reuse anybody else's session. Attaching a throwaway DEV shop to a
 * real account would spend that account's single, permanent `shop_claims` slot
 * on test data, and no later cleanup can give it back.
 */
async function ensureDevSession(): Promise<void> {
  const { data: current, error } = await supabase.auth.getSession();
  if (error) throw error;

  const stored = readDevIdentity();
  if (current.session) {
    if (stored && current.session.user.email === stored.email) return;
    throw new DevHarnessError(
      'A different Supabase session is signed in. Sign out first — the harness will not attach a DEV shop to an existing account.',
    );
  }

  const identity = stored ?? createDevIdentity();
  const signedIn = await supabase.auth.signInWithPassword({
    email: identity.email,
    password: identity.password,
  });
  if (signedIn.data?.session) return;

  // A stored identity that cannot sign in was purged server-side, or its
  // password no longer matches. Signing UP under that address would either
  // collide or mint a stranger, so name the state instead of guessing.
  if (stored) {
    throw new DevHarnessError(
      "The stored DEV identity could not sign in — it was probably purged from the project. Clear the app's data to start a new DEV shop.",
    );
  }

  const signedUp = await supabase.auth.signUp({
    email: identity.email,
    password: identity.password,
  });
  if (signedUp.error) throw signedUp.error;
  if (!signedUp.data?.session) {
    throw new DevHarnessError(
      'Sign-up returned no session. Turn OFF "Confirm email" on the DEV project (Authentication → Providers → Email).',
    );
  }
}

/**
 * What `registerDevOwner` is about to do, decided before anything is touched.
 *
 * `resume` exists for exactly one state: server onboarding, binding and trial
 * all succeeded, and then the refreshed-token claim check failed — leaving a
 * local shop that is `link_pending` while the hosted rows are complete.
 * Refusing it stranded that data with no way forward but wiping the device.
 *
 * It is identity-bound: only the shop and Owner THIS harness recorded qualify.
 * A registration it did not create reads as `refuse`, so a real OTP shop can
 * never be adopted, and the generic repair architecture H-2 removed is not
 * coming back through here.
 */
export type HarnessPlan =
  | { action: 'fresh' }
  | { action: 'resume'; shopId: string; ownerUserId: string }
  | { action: 'refuse'; reason: string };

export async function planDevRegistration(): Promise<HarnessPlan> {
  const registration = await getRegistrationStatus();
  if (registration.status === 'none') return { action: 'fresh' };

  const remembered = readHarnessRegistration();
  const isOwnRegistration = remembered !== null
    && remembered.shopId === registration.shopId
    && remembered.ownerUserId === registration.userId;

  if (!isOwnRegistration) {
    return {
      action: 'refuse',
      reason: `This device holds a ${registration.status} registration the DEV harness did not create. Clear the app's data to start a new DEV shop.`,
    };
  }
  if (registration.status !== 'link_pending') {
    return {
      action: 'refuse',
      reason: `The DEV shop on this device is already ${registration.status}. Clear the app's data to start a new one.`,
    };
  }
  return { action: 'resume', shopId: registration.shopId, ownerUserId: registration.userId };
}

/**
 * Creates a DEV Owner and shop through the canonical onboarding path, or
 * finishes the one this harness already started.
 *
 * The resume branch re-sends the SAME onboarding payload rather than a
 * shortened one. Every server step is idempotent — `b4_onboard_owner` inserts
 * `on conflict do nothing`, `ensureAuthBinding` upserts then re-reads, and
 * `b4_ensure_owner_billing_account` writes `launch_trial_granted_at` once — so
 * one path covers both "onboarding never ran" and "onboarding ran and only the
 * claim check failed", with no second code path that finishes differently. It
 * cannot create a second shop, owner, billing account or trial.
 */
export async function registerDevOwner(): Promise<{ shopId: string; ownerUserId: string }> {
  assertDevBuild();
  requireSupabaseConfiguration();

  const plan = await planDevRegistration();
  if (plan.action === 'refuse') throw new DevHarnessError(plan.reason);

  await ensureDevSession();

  const target = plan.action === 'resume'
    ? { shopId: plan.shopId, userId: plan.ownerUserId }
    : await createShopAndOwner({
        shopName: DEV_HARNESS_SHOP_NAME,
        phone: DEV_HARNESS_SHOP_CONTACT,
        // No OTP happened, so this Owner has no phone credential. Writing the
        // contact number here instead would both claim a verification that
        // never occurred and collide on the GLOBAL users_phone_unique index
        // the second time this runs.
        ownerPhone: null,
      });

  // Recorded BEFORE the link, so an interruption anywhere after this point is
  // recognisable as ours on the next launch.
  rememberHarnessRegistration(target.shopId, target.userId);

  const onboarding = await getOwnerOnboardingPayload(target.shopId, target.userId);
  await linkDeviceToShop(target.shopId, target.userId, { onboarding });

  const { data: bound } = await supabase.auth.getUser();
  captureBoundEmail(bound?.user?.email);

  await markShopCloudLinked(target.shopId);
  return { shopId: target.shopId, ownerUserId: target.userId };
}
