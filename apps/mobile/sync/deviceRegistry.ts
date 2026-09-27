import * as Device from 'expo-device';
import {
  applyDeviceAuthority,
  deviceEnrolmentMatches,
  forgetDeviceEnrolment,
  parseDeviceAuthoritySnapshot,
  readDeviceAccessObjection,
  readDeviceSecret,
  readLocalDeviceRegistry,
  type DeviceAccessObjection,
  type DeviceAuthoritySnapshot,
} from '../db/deviceRegistry';
import { getDeviceId } from '../native/deviceId';
import { invokeSyncWithClaimRefresh } from './invoke';
import { requireSupabaseConfiguration, supabase } from './supabaseClient';
import { withAuthMutation } from './authMutation';
import { handleDeviceRevocation } from './deviceRevocation';

// sync/deviceRegistry.ts — the client half of A2.3.
//
// Everything here is a thin, honest conduit between the server's registry and
// the SQLite mirror. It holds no policy of its own: it never decides that a
// device is revoked, never clears a revocation, and never treats a network
// failure as an answer. That last point is what this file exists to guarantee,
// and it is the lesson of D1 — a WiFi outage is not a revocation, and the only
// safe thing to write after a failed request is nothing at all.

/** Server refusals the device must act on, rather than merely report. */
export type DeviceRegistryCode =
  | 'device_revoked'
  | 'binding_revoked'
  | 'device_not_registered'
  | 'binding_not_registered'
  | 'device_switch_refused'
  | 'device_switch_locked'
  | 'device_admin_required';

export class DeviceRegistryError extends Error {
  constructor(
    readonly code: DeviceRegistryCode | null,
    message: string,
    readonly status: number | null = null,
    /** The authority snapshot the server attached, when it attached one. */
    readonly authority: unknown = undefined,
  ) {
    super(message);
    this.name = 'DeviceRegistryError';
  }
}

async function readErrorBody(
  error: unknown,
): Promise<{ code: string | null; status: number | null; authority: unknown }> {
  const context = (error as { context?: Partial<Response> }).context;
  const status = typeof context?.status === 'number' ? context.status : null;
  if (!context || typeof context.clone !== 'function') {
    return { code: null, status, authority: undefined };
  }
  try {
    const body: unknown = await context.clone().json();
    const parsed = body && typeof body === 'object' && !Array.isArray(body)
      ? body as { code?: unknown; authority?: unknown }
      : null;
    const code = parsed?.code;
    return {
      code: typeof code === 'string' ? code : null,
      status,
      // A2.3. The server attaches the authority snapshot to a device refusal.
      // On the actor switch it is the ONLY way the device can learn it was
      // revoked, because that route is unauthenticated by necessity and there
      // is no session left with which to go and ask.
      authority: parsed?.authority,
    };
  } catch {
    // A non-JSON proxy body carries nothing actionable and is deliberately not
    // surfaced or logged, exactly as sync/linkDevice.ts treats the same case.
    return { code: null, status, authority: undefined };
  }
}

async function toRegistryError(error: unknown, fallback: string): Promise<DeviceRegistryError> {
  const { code, status, authority } = await readErrorBody(error);
  return new DeviceRegistryError(
    code as DeviceRegistryCode | null,
    fallback,
    status,
    authority,
  );
}

function supabaseIsConfigured(): boolean {
  try {
    requireSupabaseConfiguration();
    return true;
  } catch {
    return false;
  }
}

/**
 * What this installation reports about itself at enrolment.
 *
 * Model and OS version exist so an Owner looking at the device list can tell
 * which handset a row IS. Nothing here is a credential or an identifier the
 * server keys on — `device_public_id` is the identity, and it is random.
 *
 * Read from expo-device rather than react-native's Platform on purpose: this
 * module sits in sync/pull.ts's import graph, and pulling `react-native` in
 * there would break every node-environment suite that has no business loading
 * a UI runtime.
 */
function describeInstallation(): { platform: string; model: string; osVersion: string } {
  return {
    platform: Device.osName ?? '',
    model: Device.modelName ?? '',
    osVersion: Device.osVersion ?? '',
  };
}

/**
 * What a credential-proving login tells the server about this handset.
 *
 * Attached to device-login, link-device and recover-pin rather than posted to
 * a route of its own. There IS no enrolment route any more: a separate
 * `device-enroll` action was reachable by any live access token, so a stolen
 * token could register itself a brand-new trusted installation. Registration
 * is now a consequence of proving a credential, never a request.
 */
export function installationClaim(): Record<string, string | number> {
  return {
    deviceRegistryVersion: 1,
    devicePublicId: getDeviceId(),
    ...describeInstallation(),
  };
}

/** The half of a login response that describes the installation it bound. */
export interface BoundInstallationResponse {
  deviceSecret?: unknown;
  deviceAuthority?: unknown;
}

export interface BoundInstallationPersistenceOptions {
  /** Current A2.3 credential flows must fail rather than degrade to legacy. */
  required?: boolean;
  /** The actor whose active binding the credential flow just proved. */
  expectedActorUserId?: string;
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Records the installation a strong-auth login just bound this session to.
 *
 * Returns whether anything was recorded. Legacy callers may opt into the old
 * best-effort behavior by leaving `required` false. Registration and every
 * A2.3-capable credential flow pass `required: true`: malformed authority or
 * a failed secure write then fails closed before the caller treats enrolment
 * as complete.
 */
export async function recordBoundInstallation(
  shopId: string,
  response: BoundInstallationResponse | null | undefined,
  options: BoundInstallationPersistenceOptions = {},
): Promise<boolean> {
  const localDevicePublicId = getDeviceId();
  const rawAuthority = responseRecord(response?.deviceAuthority);
  const authority = parseDeviceAuthoritySnapshot(rawAuthority);
  const secret = response?.deviceSecret;
  const expectedBinding = options.expectedActorUserId
    ? authority?.bindings.find((binding) => binding.actorUserId === options.expectedActorUserId)
    : undefined;
  const valid = Boolean(
    response
    && typeof secret === 'string'
    && /^[0-9a-f]{64}$/.test(secret)
    && rawAuthority?.shopId === shopId
    && rawAuthority.devicePublicId === localDevicePublicId
    && authority?.known === true
    && authority.status === 'active'
    && (!options.expectedActorUserId || expectedBinding?.status === 'active'),
  );
  if (!valid) {
    if (options.required) {
      throw new DeviceRegistryError(null, 'Could not securely save this device registration.');
    }
    return false;
  }
  // Secret and status land in ONE write, so a device can never end up holding
  // a credential it has no recorded standing to use, or the reverse.
  const applied = await applyDeviceAuthority(shopId, localDevicePublicId, authority!, {
    deviceSecret: secret as string,
  });
  if (applied) return true;

  // `false` is not "the enrolment failed". applyDeviceAuthority also returns it
  // for a snapshot the monotonic guard DISCARDED — local state already at or
  // past this version — which leaves the handset correctly enrolled. Treating
  // that as a failure is what made a successful staff sign-in report
  // "Something went wrong", and every retry re-enrolled and rotated the secret
  // again.
  //
  // So the question asked here is the one that actually matters: does this
  // installation now hold this credential? Yes means the login completed,
  // whichever write put it there. No means it genuinely did not land, and a
  // required flow still fails closed — the server believes this handset is
  // enrolled while the handset has lost the only plaintext copy of its secret,
  // which must never be reported as success.
  const enrolled = await deviceEnrolmentMatches(
    shopId,
    localDevicePublicId,
    secret as string,
  );
  if (enrolled) return true;
  if (options.required) {
    throw new DeviceRegistryError(null, 'Could not securely save this device registration.');
  }
  return false;
}

export interface DeviceActorSwitchResult {
  shopId: string;
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * The PIN-only handover: mints a cloud session for `actorUserId` on this
 * already-registered installation, using the stored device secret.
 *
 * Returns null when this installation has no secret to present — an unenrolled
 * device, or one whose credential the server has already refused. The caller
 * then falls back to phone + PIN device-login, which is exactly the behaviour
 * that existed before A2.3, so no shop is ever worse off than it was.
 */
export async function switchActorOnDevice(
  shopId: string,
  actorUserId: string,
  pin: string,
): Promise<DeviceActorSwitchResult | null> {
  requireSupabaseConfiguration();
  const deviceSecret = await readDeviceSecret(shopId);
  if (!deviceSecret) return null;
  const devicePublicId = getDeviceId();

  const { data, error } = await supabase.functions.invoke('sync', {
    body: {
      action: 'device-actor-switch',
      shopId,
      devicePublicId,
      deviceSecret,
      actorUserId,
      pin,
    },
  });
  if (error) {
    const registryError = await toRegistryError(error, 'Could not switch user on this device.');
    // A refused CREDENTIAL means the secret this device holds is no longer the
    // one the server has — a re-enrolment elsewhere rotated it, or the device
    // row is gone. Drop it so the next attempt goes cleanly through phone +
    // PIN instead of re-presenting something already known to be dead.
    //
    // Deliberately NOT done for device_revoked / binding_revoked: those are
    // authority, and the snapshot carrying them is what must be recorded.
    if (
      registryError.code === 'device_switch_refused'
      || registryError.code === 'device_not_registered'
    ) {
      await forgetDeviceEnrolment(shopId);
    }
    // The revocation is persisted HERE, from the refusal itself, with no
    // session involved.
    //
    // It used to depend on the caller going away and running an authenticated
    // refresh afterwards — which is the one thing a device in this state
    // cannot reliably do. The handover happens precisely when the outgoing
    // session is expired or already gone, so that refresh would be attempted
    // with no usable token, fail, and write nothing. The quarantine then
    // lasted exactly as long as the screen did: reopen the app and the same
    // revoked handset was offered the same handover again.
    //
    // The server attaches the authoritative snapshot to this refusal, and it
    // goes into the encrypted mirror before the error is raised. The monotonic
    // guard still applies, so a replayed refusal cannot move anything
    // backwards.
    if (registryError.code === 'device_revoked' || registryError.code === 'binding_revoked') {
      // One path for every revocation. It strictly validates and atomically
      // persists the snapshot before writing H-10's durable quarantine.
      await handleDeviceRevocation(
        shopId,
        actorUserId,
        registryError.code,
        registryError.authority,
      );
    }
    throw registryError;
  }

  const body = data as (Partial<DeviceActorSwitchResult> & { authority?: unknown }) | null;
  if (
    !body
    || typeof body.shopId !== 'string'
    || typeof body.userId !== 'string'
    || typeof body.role !== 'string'
    || typeof body.accessToken !== 'string'
    || typeof body.refreshToken !== 'string'
  ) {
    throw new DeviceRegistryError(null, 'Could not switch user on this device.');
  }
  const accessToken = body.accessToken;
  const refreshToken = body.refreshToken;
  const authority = parseDeviceAuthoritySnapshot(body.authority);
  if (authority) {
    await applyDeviceAuthority(shopId, devicePublicId, authority);
  }

  const { error: sessionError } = await withAuthMutation(() => supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  }));
  if (sessionError) {
    throw new DeviceRegistryError(null, 'Could not start your session. Please try again.');
  }

  return {
    shopId: body.shopId,
    userId: body.userId,
    role: body.role,
    accessToken,
    refreshToken,
  };
}

/**
 * Records a snapshot the server volunteered on a pull response.
 *
 * This is the ordinary way a device learns it has been cut off: no extra round
 * trip, no separate schedule, and it happens on every sync cycle the device
 * was going to run anyway.
 */
export async function applyPulledDeviceAuthority(
  shopId: string,
  value: unknown,
  actorUserId?: string,
): Promise<DeviceAccessObjection | null> {
  const snapshot = parseDeviceAuthoritySnapshot(value);
  if (!snapshot) return null;
  await applyDeviceAuthority(shopId, getDeviceId(), snapshot);
  // Reported back so the caller can stop the cycle it is in the middle of.
  // Recording a revocation and then carrying on to push the outbox would be a
  // device acting on authority it has just been told it no longer holds.
  if (!actorUserId) return null;
  return await readDeviceAccessObjection(shopId, actorUserId);
}

/** An explicit refresh, for paths that need the answer before a pull runs. */
export type DeviceAuthorityRefresh =
  | { kind: 'authoritative'; snapshot: DeviceAuthoritySnapshot }
  /** The server answered, and this session is bound to no installation. */
  | { kind: 'unbound' }
  /** No answer at all. NOT evidence of anything, in either direction. */
  | { kind: 'unavailable' };

export async function refreshDeviceAuthority(
  shopId: string,
): Promise<DeviceAuthorityRefresh> {
  if (!supabaseIsConfigured()) return { kind: 'unavailable' };
  // No device id is sent. The server derives this installation from the
  // session's own `session_id` claim, so there is nothing here for a caller to
  // misstate — and nothing an attacker gains by asking about somebody else's.
  const { data, error } = await invokeSyncWithClaimRefresh({
    action: 'device-authority',
    shopId,
  });
  // A failed refresh writes NOTHING. Silence from the server is not evidence
  // about access, and turning it into evidence is exactly how an outage
  // becomes a shop-wide lockout. The caller is told so explicitly, because
  // "could not check" and "checked, nothing wrong" must lead to different
  // decisions before anything is pushed.
  if (error) return { kind: 'unavailable' };
  if (
    data
    && typeof data === 'object'
    && !Array.isArray(data)
    && (data as { bound?: unknown }).bound === false
  ) return { kind: 'unbound' };
  const snapshot = parseDeviceAuthoritySnapshot(data);
  if (!snapshot) return { kind: 'unavailable' };
  await applyDeviceAuthority(shopId, getDeviceId(), snapshot);
  return { kind: 'authoritative', snapshot };
}

/** True when this installation holds a usable enrolment for the shop. */
export async function isDeviceEnrolled(shopId: string): Promise<boolean> {
  const registry = await readLocalDeviceRegistry(shopId);
  return registry?.isEnrolled === true
    && registry.devicePublicId === getDeviceId()
    && registry.status !== 'revoked';
}

// ── Owner/Manager administration ──────────────────────────────────────────

export interface RegisteredDeviceBinding {
  actorUserId: string;
  actorName: string | null;
  role: string | null;
  status: 'active' | 'revoked';
  lastAuthenticatedAt: string | null;
}

export interface RegisteredDevice {
  deviceId: string;
  devicePublicId: string;
  label: string | null;
  platform: string | null;
  model: string | null;
  osVersion: string | null;
  status: 'active' | 'revoked';
  enrolledAt: string;
  lastSeenAt: string | null;
  bindings: RegisteredDeviceBinding[];
}

export interface DeviceEnrollmentHold {
  actorUserId: string;
  actorName: string | null;
  role: string | null;
  sourceDeviceId: string;
  heldAt: string;
  requestedDevicePublicId: string | null;
  requestedAt: string | null;
  approved: boolean;
  approvedAt: string | null;
}

export interface RegisteredDeviceListing {
  devices: RegisteredDevice[];
  enrollmentHolds: DeviceEnrollmentHold[];
  /** True when the server is refusing unproven installations for this shop. */
  enforced: boolean;
}

export async function listRegisteredDevices(
  shopId: string,
): Promise<RegisteredDeviceListing> {
  requireSupabaseConfiguration();
  const { data, error } = await invokeSyncWithClaimRefresh({ action: 'device-list', shopId });
  if (error) throw await toRegistryError(error, 'Could not load registered devices.');
  const body = data as {
    devices?: unknown;
    enrollmentHolds?: unknown;
    enforced?: unknown;
  } | null;
  return {
    devices: Array.isArray(body?.devices) ? body.devices as RegisteredDevice[] : [],
    enrollmentHolds: Array.isArray(body?.enrollmentHolds)
      ? body.enrollmentHolds as DeviceEnrollmentHold[]
      : [],
    enforced: body?.enforced === true,
  };
}

export type DeviceAccessOperation =
  | 'revoke-device'
  | 'restore-device'
  | 'revoke-binding'
  | 'restore-binding';

export async function approveDeviceEnrollment(
  shopId: string,
  actorUserId: string,
  devicePublicId: string,
): Promise<void> {
  requireSupabaseConfiguration();
  const { error } = await invokeSyncWithClaimRefresh({
    action: 'device-access',
    operation: 'approve-enrollment',
    shopId,
    actorUserId,
    devicePublicId,
  });
  if (error) throw await toRegistryError(error, 'Could not approve this installation.');
}

/**
 * Turns server-side device enforcement on or off for this shop.
 *
 * The switch that stops accepting legacy UNBOUND sessions. Bound sessions are
 * always gated and known revocation always applies. While it is off, a session
 * minted before A2.3 remains usable, which lets a shop update its tills one at
 * a time. Once it is on, every session must have a proven active binding.
 *
 * No device id is sent. The database judges the CALLER'S SESSION: it refuses
 * to enable enforcement unless that session is bound to an installation that
 * is registered, active, bound for this actor, and holding the secret the
 * server currently has. The last condition matters — a colleague re-enrolling
 * on the same handset rotates the secret, and a session left holding the old
 * one would otherwise throw a switch that then locked it out.
 */
export async function setDeviceEnforcement(
  shopId: string,
  enabled: boolean,
): Promise<boolean> {
  requireSupabaseConfiguration();
  const { data, error } = await invokeSyncWithClaimRefresh({
    action: 'device-access',
    operation: 'set-enforcement',
    shopId,
    enabled,
  });
  if (error) throw await toRegistryError(error, 'Could not change device enforcement.');
  return (data as { enforced?: unknown } | null)?.enforced === true;
}

/**
 * Applies an Owner/Manager decision, then records the snapshot it returns.
 *
 * Recording matters even though the administrator is usually acting on some
 * OTHER handset: the response describes whichever installation was acted on,
 * so revoking your own quarantines it immediately instead of waiting for a
 * pull. Acting on a different one writes nothing, because the snapshot is not
 * about this device.
 */
export async function mutateDeviceAccess(
  shopId: string,
  operation: DeviceAccessOperation,
  deviceId: string,
  options: { actorUserId?: string; reason?: string } = {},
): Promise<void> {
  requireSupabaseConfiguration();
  const { data, error } = await invokeSyncWithClaimRefresh({
    action: 'device-access',
    shopId,
    operation,
    deviceId,
    ...(options.actorUserId ? { actorUserId: options.actorUserId } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
  });
  if (error) throw await toRegistryError(error, 'Could not update device access.');
  const snapshot = parseDeviceAuthoritySnapshot(data);
  if (!snapshot) return;
  const affected = (data as { devicePublicId?: unknown }).devicePublicId;
  if (typeof affected === 'string' && affected === getDeviceId()) {
    await applyDeviceAuthority(shopId, affected, snapshot);
  }
}
