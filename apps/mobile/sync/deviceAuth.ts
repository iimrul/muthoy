import { normalizeBdPhone } from '@muthoy/validation';
import {
  clearLocalUserAccessLock,
  markShopCloudLinked,
  recordSuccessfulLogin,
  verifyPinForUser,
} from '../db/auth';
import {
  clearPinAttemptsAfterOwnerRecovery,
  pinAttemptScope,
} from '../db/pinAttemptLock';
import { handoffAuthTiming, type AuthTimingTrace } from '../dev/authTiming';
import { useSessionStore } from '../state/sessionStore';
import { captureSession, StaleSessionError, type SessionGuard } from '../state/sessionGuard';
import { SyncHaltedError } from './invoke';
import { inspectSessionAuthority } from './sessionAuthority';
import { withAuthMutation } from './authMutation';
import { pullChanges } from './pull';
import { enforceAuthoritativeRevocation } from './revocation';
import { requireSupabaseConfiguration, supabase } from './supabaseClient';
import { assertCloudActorBinding, inspectCloudActorBinding } from './authActorBinding';
import {
  installationClaim,
  recordBoundInstallation,
  type BoundInstallationResponse,
} from './deviceRegistry';
import { refreshBillingStatus } from './billing';

// sync/deviceAuth.ts — logging in on a device that has no local data yet.
//
// ORCHESTRATION ONLY. Every step below already existed and is reused as-is:
// pullChanges does the hydration (with its own FK ordering and all-or-nothing
// transaction), verifyPinForUser checks the server-selected local row, the
// session store's login()
// bumps the epoch state/sessionGuard.ts watches, and app/_layout.tsx starts the
// sync engine off that session change. Nothing here re-implements any of it.
//
// The one genuinely new step is the first call: phone + PIN, verified by the
// server, because a device with an empty SQLite has no hash to check locally.
// Once this has run, the device is enrolled and every later login is the
// existing offline PIN-only path — no network, no phone re-entry.

export class DeviceLoginError extends Error {
  /** True when the server refused the credentials, rather than failing. */
  readonly isCredentialFailure: boolean;

  constructor(message: string, isCredentialFailure: boolean) {
    super(message);
    this.name = 'DeviceLoginError';
    this.isCredentialFailure = isCredentialFailure;
  }
}

// The server answers every credential problem — unknown number, wrong PIN,
// locked out — with one message, so this deliberately does not try to tell them
// apart or improve on it. Distinguishing them here would leak precisely what
// the server withheld.
const GENERIC_FAILURE = 'Incorrect phone number or PIN';

export interface DeviceLoginResponse {
  shopId: string;
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
}

function parseResponse(value: unknown): DeviceLoginResponse {
  if (!value || typeof value !== 'object') {
    throw new DeviceLoginError('Login failed. Please try again.', false);
  }
  const body = value as Partial<DeviceLoginResponse>;
  if (
    typeof body.shopId !== 'string' ||
    typeof body.userId !== 'string' ||
    typeof body.role !== 'string' ||
    typeof body.accessToken !== 'string' ||
    typeof body.refreshToken !== 'string'
  ) {
    throw new DeviceLoginError('Login failed. Please try again.', false);
  }
  return body as DeviceLoginResponse;
}

/** 401 stays indistinguishable; safe device-policy codes remain actionable. */
async function toLoginError(error: unknown): Promise<DeviceLoginError> {
  const response = (error as { context?: Partial<Response> }).context;
  const status = typeof response?.status === 'number' ? response.status : null;
  if (status === 401) return new DeviceLoginError(GENERIC_FAILURE, true);

  let code: string | null = null;
  if (response && typeof response.clone === 'function') {
    try {
      const body: unknown = await response.clone().json();
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const candidate = (body as { code?: unknown }).code;
        code = typeof candidate === 'string' ? candidate : null;
      }
    } catch {
      // Proxy/non-JSON bodies are ordinary transport failures.
    }
  }

  switch (code) {
    case 'device_session_unbound':
      return new DeviceLoginError('Sign in again to relink this device.', false);
    case 'device_enrollment_held':
      return new DeviceLoginError(
        'Another active Owner or Manager must approve this device.',
        false,
      );
    case 'device_id_required':
      return new DeviceLoginError(
        'This app installation could not be identified. Restart and try again.',
        false,
      );
    default:
      return new DeviceLoginError('Could not reach the server. Check your connection.', false);
  }
}

/**
 * Phone + PIN on a fresh device: verify with the server, adopt the session it
 * mints, hydrate the shop, then log in locally.
 *
 * The exact-user local verification at the end is not redundant. It proves
 * hydration actually landed THIS user's row, and it builds the session object — role and
 * permission overrides included — from SQLite, the source of truth, rather than
 * from the server's reply. A silently incomplete hydration is caught here,
 * before any session exists.
 */
export async function loginOnNewDevice(
  phone: string,
  pin: string,
  timing?: AuthTimingTrace,
): Promise<void> {
  const guard = captureSession();
  const response = await authenticateNewDeviceCredentials(phone, pin, timing, guard);
  const local = await hydrateAuthenticatedDevice(response, pin, timing, guard);
  await activateHydratedDevice(local, timing, guard);
}

/** DB-independent. Recovery must complete this before rotating any local key. */
export async function authenticateNewDeviceCredentials(
  phone: string,
  pin: string,
  timing?: AuthTimingTrace,
  guard: SessionGuard = captureSession(),
): Promise<DeviceLoginResponse> {
  requireSupabaseConfiguration();

  // Canonical on the wire. The server keys its lockout on this string, so
  // sending it as typed would let one person spend three separate attempt
  // budgets by rotating '01…', '880…' and '+880…' — and would fail their own
  // login if they had registered in a different form.
  const canonicalPhone = normalizeBdPhone(phone);
  if (!canonicalPhone) {
    throw new DeviceLoginError(GENERIC_FAILURE, true);
  }

  const invoke = () => supabase.functions.invoke('sync', {
    body: {
      action: 'device-login',
      // A2.3. The installation travels WITH the credential. There is no
      // separate enrolment call to make afterwards — the server registers this
      // handset and binds the session it is about to mint, in one transaction
      // behind one proof.
      ...installationClaim(),
      phone: canonicalPhone,
      pin,
      ...(timing ? { _timingId: timing.correlationId } : {}),
    },
  });
  const { data, error } = timing
    ? await timing.measure('edge_function_invocation', invoke)
    : await invoke();
  guard.assertLive();
  if (error) {
    throw await toLoginError(error);
  }

  const response = parseResponse(data);

  // Adopt the minted session BEFORE pulling: pullChanges goes through the same
  // edge function, which needs this device authenticated as this user.
  const setSession = () => {
    guard.assertLive();
    return supabase.auth.setSession({
      access_token: response.accessToken,
      refresh_token: response.refreshToken,
    });
  };
  const { error: sessionError } = timing
    ? await timing.measure('supabase_session_set', () => withAuthMutation(setSession))
    : await withAuthMutation(setSession);
  guard.assertLive();
  if (sessionError) {
    throw new DeviceLoginError('Could not start your session. Please try again.', false);
  }
  const binding = await inspectCloudActorBinding({ userId: response.userId, shopId: response.shopId });
  guard.assertLive();
  assertCloudActorBinding(
    binding,
    { userId: response.userId, shopId: response.shopId },
  );

  return response;
}

/**
 * Runs a step this login may not be treated as complete without.
 *
 * Nothing is swallowed: every caller below is genuinely mandatory and still
 * fails closed. The only thing this changes is what the person holding the
 * phone is told. A DeviceRegistryError or a SQLite fault escaping here is not
 * a DeviceLoginError, so app/(auth)/device-login.tsx rendered it as
 * "Something went wrong. Please try again." — on a login the server had
 * already completed, with the secret already issued. That message is untrue
 * and it is an instruction to retry, and each retry re-enrols and rotates the
 * device secret again.
 *
 * The stage name is also what makes the failing step visible in the DEV
 * `[auth:timing]` trace. It is a fixed literal: no PIN, token, secret or
 * response body goes near it.
 *
 * StaleSessionError and SyncHaltedError pass through untouched — they are
 * answers about a device changing hands and about revocation, and their own
 * handlers act on them.
 */
async function requireLoginStep<T>(
  stage: string,
  message: string,
  operation: () => Promise<T>,
  timing?: AuthTimingTrace,
): Promise<T> {
  try {
    return timing ? await timing.measure(stage, operation) : await operation();
  } catch (error) {
    if (
      error instanceof DeviceLoginError
      || error instanceof StaleSessionError
      || error instanceof SyncHaltedError
    ) throw error;
    throw new DeviceLoginError(message, false);
  }
}

/**
 * A2.3. Records the installation the login response says the server bound.
 *
 * There is nothing to REQUEST here any more, and that is the point. Binding
 * happened inside device-login / link-device / recover-pin, in the same
 * transaction that verified the credential, and the response carries the
 * secret and the snapshot it produced. The separate `device-enroll` call this
 * replaced was reachable by any live access token, which meant a stolen token
 * could register itself a brand-new trusted installation.
 *
 * A2.3-capable credential flows are strict. The server has already enrolled
 * and session-bound this installation, so missing/mismatched authority or a
 * failed SQLCipher write must stop local completion. Otherwise the server
 * would believe enrolment succeeded while the handset lost the only plaintext
 * copy of its installation secret.
 */
async function recordDeviceBinding(
  shopId: string,
  actorUserId: string,
  response: unknown,
): Promise<void> {
  await recordBoundInstallation(shopId, response as BoundInstallationResponse, {
    required: true,
    expectedActorUserId: actorUserId,
  });
}

/** Full server hydration into whichever isolated database db/ currently owns. */
export async function hydrateAuthenticatedDevice(
  response: DeviceLoginResponse,
  pin: string,
  timing?: AuthTimingTrace,
  guard: SessionGuard = captureSession(),
) {
  const ownsHydration = guard.isStillActive;

  // `null` forces FULL hydration rather than an incremental pull from a cursor
  // this device has never had. The same call app/(auth)/otp-verify.tsx already
  // makes for an owner restoring onto a new phone — one hydration path, not two.
  try {
    if (timing) {
      await timing.measure('full_hydration', () => pullChanges(response.shopId, null, undefined, timing));
    } else {
      await pullChanges(response.shopId, null);
    }
    guard.assertLive();
  } catch (error) {
    if (error instanceof SyncHaltedError && guard.isStillActive()) {
      await enforceAuthoritativeRevocation(response.shopId, error.code, response.userId);
    }
    throw error;
  }

  // Business pull and commercial identity use separate server projections.
  // A recovery/re-link must hydrate both before it can clear quarantine or
  // persist a session carrying principal/billing authority.
  await requireLoginStep(
    'commercial_identity_hydration',
    'Could not confirm your shop plan. Reconnect and try again.',
    () => refreshBillingStatus(response.shopId, undefined, { isCurrent: ownsHydration }),
    timing,
  );
  guard.assertLive();

  // Persist the one-time installation secret before changing any local state
  // that says this enrollment completed. The shop row now exists because the
  // full pull above committed first, satisfying the mirror's SQLite FK.
  await requireLoginStep(
    'device_enrollment_persistence',
    'Could not securely save this device registration. Please try again.',
    () => recordDeviceBinding(response.shopId, response.userId, response),
    timing,
  );
  guard.assertLive();

  // The lock is device-local and may only clear after BOTH credential proof
  // and an authoritative pull succeeded for this exact actor — and then only if
  // the row that pull produced says the actor is live. Credential proof alone
  // is not enough: the server mints a session before plan suspension or an
  // archived shop is resolved, and neither of those flips `is_active`.
  //
  // A `false` answer is authority and is honoured below. A THROWN fault is not
  // an answer at all, and it used to reach the screen as the generic failure;
  // it now fails closed with a message that says which step could not be
  // completed, because an uncleared lock must never coexist with a session.
  const unlocked = await requireLoginStep(
    'local_access_unlock',
    'Could not confirm your access on this device. Please try again.',
    () => clearLocalUserAccessLock(response.shopId, response.userId),
    timing,
  );
  guard.assertLive();
  if (!unlocked) {
    // A credential refusal, not a transient fault: retrying cannot change the
    // hydrated answer, and the device must stay locked.
    throw new DeviceLoginError(
      'Your access to this shop has been revoked. Ask the shop owner to restore it.',
      true,
    );
  }

  // The device now holds the shop in the same sense a registered one does, so
  // the root gate must route it to PIN Login rather than Registration.
  await requireLoginStep(
    'local_enrollment_write',
    'Could not finish setting up this device. Please try again.',
    () => markShopCloudLinked(response.shopId),
    timing,
  );
  guard.assertLive();

  const local = await requireLoginStep(
    'hydrated_exact_user_validation',
    'Your shop data did not download completely. Please try again.',
    () => verifyPinForUser(pin, response.shopId, response.userId, timing),
    timing,
  );
  guard.assertLive();
  if (!local || local.userId !== response.userId || local.shopId !== response.shopId) {
    // Hydration returned without the row this login depends on. Refusing here
    // leaves the device unenrolled and the attempt retryable, which is far
    // better than a session pointing at a user SQLite does not have.
    throw new DeviceLoginError('Your shop data did not download completely. Please try again.', false);
  }

  return local;
}

/** Activates only a database that already passed hydration verification. */
export async function activateHydratedDevice(
  local: NonNullable<Awaited<ReturnType<typeof verifyPinForUser>>>,
  timing?: AuthTimingTrace,
  guard: SessionGuard = captureSession(),
): Promise<void> {
  await recordSuccessfulLogin(local);
  guard.assertLive();
  // Credential proof + full hydration + exact local actor validation are the
  // only operation allowed to clear an H-10 quarantine.
  const authority = await inspectSessionAuthority(
    {
      userId: local.userId,
      shopId: local.shopId,
      role: local.role,
      principalUserId: local.principalUserId,
      billingAccountId: local.billingAccountId,
    },
    Date.now(),
    { allowQuarantineRecovery: true, isCurrent: guard.isStillActive },
  );
  guard.assertLive();
  if (authority.status !== 'confirmed') {
    throw new DeviceLoginError('Could not confirm your access. Please reconnect and try again.', false);
  }
  // The same login() every other entry point calls, so the epoch bumps and
  // state/sessionGuard.ts, app/_layout.tsx's sync start and the cart cleanup all
  // behave exactly as they do after a normal PIN login.
  guard.assertLive();
  useSessionStore.getState().login({ ...local, cloudActorConfirmed: true });
  handoffAuthTiming(timing);
}

/**
 * Owner PIN recovery. The caller must ALREADY have completed a phone OTP
 * through sync/otp.ts — this hands the resulting session to the server, which
 * checks the verified number against the owner row before writing the new hash.
 *
 * Staff never reach this: they have no phone number of their own to prove, and
 * their PIN is reset by the owner (db/staff.ts's resetStaffPin).
 */
export async function recoverOwnerPin(phone: string, newPin: string): Promise<void> {
  const guard = captureSession();
  requireSupabaseConfiguration();

  // Same canonical form the server compares against the OTP-verified number.
  const canonicalPhone = normalizeBdPhone(phone);
  if (!canonicalPhone) {
    throw new DeviceLoginError(GENERIC_FAILURE, true);
  }

  const { data, error } = await supabase.functions.invoke('sync', {
    body: {
      action: 'recover-pin',
      phone: canonicalPhone,
      newPin,
      // Recovery is a credential proof too, and it is frequently performed on
      // a REPLACEMENT handset — precisely the installation that needs to
      // appear in the registry and hold the session being minted.
      ...installationClaim(),
    },
  });
  guard.assertLive();
  if (error) {
    throw await toLoginError(error);
  }

  const response = parseResponse({ ...(data as object), role: 'owner' });

  // The server signed out every previous session for this owner, including the
  // OTP one this request travelled on, so the device has to adopt the fresh
  // pair or it is left holding a token that is already dead.
  const { error: sessionError } = await withAuthMutation(() => {
    guard.assertLive();
    return supabase.auth.setSession({
      access_token: response.accessToken,
      refresh_token: response.refreshToken,
    });
  });
  guard.assertLive();
  if (sessionError) {
    throw new DeviceLoginError('Could not start your session. Please try again.', false);
  }
  const binding = await inspectCloudActorBinding({ userId: response.userId, shopId: response.shopId });
  guard.assertLive();
  assertCloudActorBinding(
    binding,
    { userId: response.userId, shopId: response.shopId },
  );

  // Recovery runs on a device that may hold nothing (lost phone) or everything
  // (forgotten PIN on the usual handset). pullChanges with an explicit null
  // covers both: a full hydration is what makes the new hash present locally,
  // and on an already-populated device it is an idempotent re-apply.
  await pullChanges(response.shopId, null);
  guard.assertLive();
  await requireLoginStep(
    'commercial_identity_hydration',
    'Could not confirm your shop plan. Reconnect and try again.',
    () => refreshBillingStatus(response.shopId, undefined, { isCurrent: guard.isStillActive }),
  );
  guard.assertLive();

  // Recovery is an authoritative login too, and it is frequently the one that
  // happens on a REPLACEMENT handset — which is precisely the installation
  // that needs to appear in the registry. Persist its one-time secret before
  // marking the local shop as linked.
  //
  // Wrapped for the same reason device-login is. Recovery reaches an owner who
  // has just spent an OTP, so a raw DeviceRegistryError rendered as the generic
  // "Something went wrong" is the worst possible thing to show them: it names
  // nothing, and retrying costs another code.
  await requireLoginStep(
    'device_enrollment_persistence',
    'Could not securely save this device registration. Please try again.',
    () => recordDeviceBinding(response.shopId, response.userId, response),
  );
  guard.assertLive();
  await requireLoginStep(
    'local_enrollment_write',
    'Could not finish setting up this device. Please try again.',
    () => markShopCloudLinked(response.shopId),
  );
  guard.assertLive();

  const local = await verifyPinForUser(newPin, response.shopId, response.userId);
  guard.assertLive();
  if (!local || local.userId !== response.userId) {
    throw new DeviceLoginError('Your shop data did not download completely. Please try again.', false);
  }

  // H-4. The one authority allowed to refill the offline attempt budget.
  //
  // A successful PIN login deliberately does not, because the budget is
  // shop-wide and the pad cannot tell who is typing — clearing it on success
  // let anyone holding one valid PIN reset the guard forever. Recovery is
  // different in kind: the server has verified an OTP against the owner's
  // phone number before it would write this hash at all, so the person in
  // front of the device has proved something the pad never can.
  //
  // Placed AFTER the local verification above, so a recovery that did not
  // actually land locally leaves the budget where it was.
  const authority = await inspectSessionAuthority(
    {
      userId: local.userId,
      shopId: local.shopId,
      role: local.role,
      principalUserId: local.principalUserId,
      billingAccountId: local.billingAccountId,
    },
    Date.now(),
    { allowQuarantineRecovery: true, isCurrent: guard.isStillActive },
  );
  guard.assertLive();
  if (authority.status !== 'confirmed') {
    throw new DeviceLoginError('Could not confirm your access. Please reconnect and try again.', false);
  }

  guard.assertLive();
  clearPinAttemptsAfterOwnerRecovery(pinAttemptScope(response.shopId));

  useSessionStore.getState().login({ ...local, cloudActorConfirmed: true });
}
