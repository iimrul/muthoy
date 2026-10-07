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

/**
 * Which failure this was, for the screen to translate. The English `message`
 * stays as it was — it is what logs and existing callers read — and the code
 * is what lets a Bangla-first screen say the same thing in the user's language
 * without parsing that message.
 *
 * `credentials` is deliberately ONE code for every credential problem, for the
 * same anti-enumeration reason GENERIC_FAILURE below is one string.
 */
export type DeviceLoginErrorCode =
  | 'credentials'
  | 'invalid_response'
  | 'relink_required'
  | 'enrollment_held'
  | 'installation_unknown'
  | 'otp_required'
  | 'network'
  | 'session_start_failed'
  | 'plan_unconfirmed'
  | 'enrollment_save_failed'
  | 'access_unconfirmed'
  | 'access_revoked'
  | 'setup_incomplete'
  | 'hydration_incomplete'
  // H-5. PIN recovery's own refusals, read from the server's stable codes.
  | 'pin_in_use'
  | 'recovery_refused'
  | 'recovery_failed'
  // The PIN write committed; only the follow-up session setup did not. Not a
  // failure of recovery — the opposite of one — so it is never read as
  // `recovery_failed` and never shown as one.
  | 'pin_changed_login_required'
  // No response at all after submitting the new PIN. Unlike every other
  // `network` failure in this file, the write may already have landed —
  // see toRecoverPinError below — so this gets its own uncertain copy rather
  // than device-login's confident "nothing happened yet, just retry".
  | 'recovery_uncertain';

export class DeviceLoginError extends Error {
  /** True when the server refused the credentials, rather than failing. */
  readonly isCredentialFailure: boolean;
  readonly code: DeviceLoginErrorCode;
  /**
   * Only set for 'pin_changed_login_required': which shop's H-4 PIN-attempt
   * budget the screen should clear. The device may hold no session at all at
   * this point, so this is the only place that shop id comes from.
   */
  readonly recoveryShopId: string | null;

  constructor(
    message: string,
    isCredentialFailure: boolean,
    code: DeviceLoginErrorCode = isCredentialFailure ? 'credentials' : 'network',
    recoveryShopId: string | null = null,
  ) {
    super(message);
    this.name = 'DeviceLoginError';
    this.isCredentialFailure = isCredentialFailure;
    this.code = code;
    this.recoveryShopId = recoveryShopId;
  }
}

// The server answers every credential problem — unknown number, wrong PIN,
// locked out — with one message, so this deliberately does not try to tell them
// apart or improve on it. Distinguishing them here would leak precisely what
// the server withheld.
const GENERIC_FAILURE = 'Incorrect phone number or PIN';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_SHAPE.test(value);
}

export interface DeviceLoginResponse {
  shopId: string;
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
}

function parseResponse(value: unknown): DeviceLoginResponse {
  if (!value || typeof value !== 'object') {
    throw new DeviceLoginError('Login failed. Please try again.', false, 'invalid_response');
  }
  const body = value as Partial<DeviceLoginResponse>;
  if (
    typeof body.shopId !== 'string' ||
    typeof body.userId !== 'string' ||
    typeof body.role !== 'string' ||
    typeof body.accessToken !== 'string' ||
    typeof body.refreshToken !== 'string'
  ) {
    throw new DeviceLoginError('Login failed. Please try again.', false, 'invalid_response');
  }
  return body as DeviceLoginResponse;
}

/** A malformed success cannot authorize an H-4 reset or a new local session. */
function parseRecoveryResponse(value: unknown): DeviceLoginResponse {
  const response = parseResponse({ ...(value as object), role: 'owner' });
  if (
    !isUuid(response.shopId)
    || !isUuid(response.userId)
    || response.accessToken.length === 0
    || response.refreshToken.length === 0
  ) {
    throw new DeviceLoginError('Could not confirm the reset. Try signing in with your new PIN first.', false, 'recovery_uncertain');
  }
  return response;
}

/** The server's own JSON body, if the refusal has one. */
async function refusalBody(response: Partial<Response> | undefined): Promise<Record<string, unknown> | null> {
  if (!response || typeof response.clone !== 'function') return null;
  try {
    const body: unknown = await response.clone().json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    // Proxy/non-JSON bodies carry no code.
    return null;
  }
}

/** The stable `code` a refusal carries, if its body is the server's own JSON. */
async function refusalCode(response: Partial<Response> | undefined): Promise<string | null> {
  const candidate = (await refusalBody(response))?.code;
  return typeof candidate === 'string' ? candidate : null;
}

/** 401 stays indistinguishable; safe device-policy codes remain actionable. */
async function toLoginError(error: unknown): Promise<DeviceLoginError> {
  const response = (error as { context?: Partial<Response> }).context;
  const status = typeof response?.status === 'number' ? response.status : null;
  if (status === 401) return new DeviceLoginError(GENERIC_FAILURE, true, 'credentials');

  const code = await refusalCode(response);

  switch (code) {
    case 'device_session_unbound':
      return new DeviceLoginError('Sign in again to relink this device.', false, 'relink_required');
    case 'device_enrollment_held':
      return new DeviceLoginError(
        'Another active Owner or Manager must approve this device.',
        false,
        'enrollment_held',
      );
    case 'device_id_required':
      return new DeviceLoginError(
        'This app installation could not be identified. Restart and try again.',
        false,
        'installation_unknown',
      );
    // The server's own freshness rule (recover-pin / link-device refuse an OTP
    // proof older than their window). Not a provider code, and not a network
    // fault: retrying the same proof can never pass, so the screen has to send
    // the owner back for a new code rather than tell them to reconnect.
    case 'otp_required':
      return new DeviceLoginError(
        'Your verification code is too old. Request a new code.',
        false,
        'otp_required',
      );
    default:
      return new DeviceLoginError('Could not reach the server. Check your connection.', false, 'network');
  }
}

/**
 * How a failed recover-pin call reads to the owner.
 *
 * Not toLoginError: that ends in "Could not reach the server" for anything it
 * does not recognise, and recovery is refused for its own nameable reasons —
 * every one of which used to reach an owner who had just paid for an SMS as a
 * connection problem. Here only a request that got NO answer is a network
 * failure; anything the server said is read from its stable code, and failing
 * that from its status. Number and account refusals share one generic message,
 * as the server shares one code for them.
 */
async function toRecoverPinError(error: unknown): Promise<DeviceLoginError> {
  const response = (error as { context?: Partial<Response> }).context;
  const status = typeof response?.status === 'number' ? response.status : null;
  if (status === null) {
    // Unlike device-login's network failures, this request may have already
    // written the new PIN before the response was lost — recoverPin's own
    // order commits the write before it does anything else that could still
    // fail. "Check your connection and retry" would read as "nothing
    // happened yet", which is not something this screen can promise.
    return new DeviceLoginError(
      "We couldn't confirm the reset. Try signing in with your new PIN first.",
      false,
      'recovery_uncertain',
    );
  }

  const body = await refusalBody(response);
  const code = typeof body?.code === 'string' ? body.code : null;
  switch (code) {
    case 'pin_changed_login_required': {
      // shopId belongs to the caller's active actor in errorResponse.ts. Only
      // the distinct, server-derived recoveryShopId may clear the H-4 scope.
      const recoveryShopId = status === 422 && isUuid(body?.recoveryShopId)
        ? body.recoveryShopId
        : null;
      if (!recoveryShopId) {
        return new DeviceLoginError(
          "We couldn't confirm the reset. Try signing in with your new PIN first.",
          false,
          'recovery_uncertain',
        );
      }
      return new DeviceLoginError(
        'PIN changed successfully. Sign in with your new PIN.',
        false,
        'pin_changed_login_required',
        recoveryShopId,
      );
    }
    case 'pin_in_use':
      return new DeviceLoginError('That PIN is already in use at this shop. Choose another.', false, 'pin_in_use');
    case 'otp_required':
      return new DeviceLoginError('Your verification code is too old. Request a new code.', false, 'otp_required');
    case 'device_session_unbound':
      return new DeviceLoginError('Sign in again to relink this device.', false, 'relink_required');
    case 'device_enrollment_held':
      return new DeviceLoginError(
        'Another active Owner or Manager must approve this device.',
        false,
        'enrollment_held',
      );
    case 'device_id_required':
      return new DeviceLoginError(
        'This app installation could not be identified. Restart and try again.',
        false,
        'installation_unknown',
      );
    case 'device_revoked':
    case 'binding_revoked':
      return new DeviceLoginError(
        'Your access to this shop has been revoked. Ask the shop owner to restore it.',
        false,
        'access_revoked',
      );
    case 'recovery_request_invalid':
    case 'pin_format_invalid':
      return new DeviceLoginError('Could not reset PIN. Try again.', false, 'recovery_failed');
    default:
      break;
  }
  // The token behind the verified code is no longer accepted: only a new code
  // can pass now.
  if (status === 401) {
    return new DeviceLoginError('Your verification code is too old. Request a new code.', false, 'otp_required');
  }
  if (status >= 500) {
    return new DeviceLoginError('Could not reset PIN. Try again.', false, 'recovery_failed');
  }
  return new DeviceLoginError('PIN reset is not available for this number.', false, 'recovery_refused');
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
    throw new DeviceLoginError(GENERIC_FAILURE, true, 'credentials');
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
    throw new DeviceLoginError('Could not start your session. Please try again.', false, 'session_start_failed');
  }
  const binding = await inspectCloudActorBinding({ userId: response.userId, shopId: response.shopId });
  guard.assertLive();
  assertCloudActorBinding(
    binding,
    { userId: response.userId, shopId: response.shopId },
  );

  return response;
}

/** Each mandatory login step, and the code its failure is reported under. */
const LOGIN_STEP_CODES = {
  commercial_identity_hydration: 'plan_unconfirmed',
  device_enrollment_persistence: 'enrollment_save_failed',
  local_access_unlock: 'access_unconfirmed',
  local_enrollment_write: 'setup_incomplete',
  hydrated_exact_user_validation: 'hydration_incomplete',
} as const satisfies Record<string, DeviceLoginErrorCode>;

type LoginStep = keyof typeof LOGIN_STEP_CODES;

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
  stage: LoginStep,
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
    throw new DeviceLoginError(message, false, LOGIN_STEP_CODES[stage]);
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
      'access_revoked',
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
    throw new DeviceLoginError('Your shop data did not download completely. Please try again.', false, 'hydration_incomplete');
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
    throw new DeviceLoginError('Could not confirm your access. Please reconnect and try again.', false, 'access_unconfirmed');
  }
  // The same login() every other entry point calls, so the epoch bumps and
  // state/sessionGuard.ts, app/_layout.tsx's sync start and the cart cleanup all
  // behave exactly as they do after a normal PIN login.
  guard.assertLive();
  useSessionStore.getState().login({ ...local, cloudActorConfirmed: true });
  handoffAuthTiming(timing);
}

/** Revoke this recovery attempt's minted session, never whichever is current. */
async function revokeRecoverySessionLocally(accessToken: string): Promise<void> {
  try {
    // GoTrue's logout authenticates this exact JWT. Unlike auth.signOut(),
    // admin.signOut does not read or erase a later device-current session.
    const { error } = await supabase.auth.admin.signOut(accessToken, 'local');
    if (!error) return;
  } catch {
    // auth-js rethrows transport errors; a confirmed PIN change stays confirmed.
  }
  console.error('sync/recover-pin cleanup failed: minted session was not revoked');
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
    throw new DeviceLoginError(GENERIC_FAILURE, true, 'credentials');
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
  if (error) {
    const mapped = await toRecoverPinError(error);
    if (mapped.code === 'pin_changed_login_required' && mapped.recoveryShopId) {
      // The same authority documented on clearPinAttemptsAfterOwnerRecovery
      // below: this request's session already carried a server-verified OTP
      // for the owner's own number before the server would touch the PIN at
      // all, and the server has just confirmed the write landed. Automatic
      // sign-in failing to finish does not withdraw that proof.
      clearPinAttemptsAfterOwnerRecovery(pinAttemptScope(mapped.recoveryShopId));
    }
    guard.assertLive();
    throw mapped;
  }

  // A valid success means the server already committed the PIN. This is the
  // CLIENT commit point too: everything below is sign-in follow-up only.
  const response = parseRecoveryResponse(data);
  try {
    clearPinAttemptsAfterOwnerRecovery(pinAttemptScope(response.shopId));
    guard.assertLive();

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
    throw new DeviceLoginError('Could not start your session. Please try again.', false, 'session_start_failed');
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
    throw new DeviceLoginError('Your shop data did not download completely. Please try again.', false, 'hydration_incomplete');
  }

  // H-4 cleared at the response commit point above. A successful ordinary
  // PIN login still cannot refill the shop-wide attempt budget.
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
    throw new DeviceLoginError('Could not confirm your access. Please reconnect and try again.', false, 'access_unconfirmed');
  }

  guard.assertLive();
  useSessionStore.getState().login({ ...local, cloudActorConfirmed: true });
  } catch (cause) {
    // This JWT came from THIS response, so the logout can never target a later
    // or unrelated current session. Failure is best-effort and cannot turn a
    // committed PIN change into a reset failure.
    await revokeRecoverySessionLocally(response.accessToken);
    // A different app user may now hold the phone. Never route their screen
    // from a stale recovery continuation.
    if (cause instanceof StaleSessionError) throw cause;
    throw new DeviceLoginError(
      'PIN changed successfully. Sign in with your new PIN.',
      false,
      'pin_changed_login_required',
      response.shopId,
    );
  }
}
