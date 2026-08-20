import { normalizeBdPhone } from '@muthoy/validation';
import { markShopCloudLinked, verifyPin } from '../db/auth';
import { useSessionStore } from '../state/sessionStore';
import { pullChanges } from './pull';
import { requireSupabaseConfiguration, supabase } from './supabaseClient';

// sync/deviceAuth.ts — logging in on a device that has no local data yet.
//
// ORCHESTRATION ONLY. Every step below already existed and is reused as-is:
// pullChanges does the hydration (with its own FK ordering and all-or-nothing
// transaction), verifyPin does the local match, the session store's login()
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

interface DeviceLoginResponse {
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

/** 401 is the server's generic credential refusal; anything else is a fault. */
function toLoginError(error: unknown): DeviceLoginError {
  const status = (error as { context?: { status?: number } }).context?.status;
  return status === 401
    ? new DeviceLoginError(GENERIC_FAILURE, true)
    : new DeviceLoginError('Could not reach the server. Check your connection.', false);
}

/**
 * Phone + PIN on a fresh device: verify with the server, adopt the session it
 * mints, hydrate the shop, then log in locally.
 *
 * The local verifyPin at the end is not redundant. It proves the hydration
 * actually landed THIS user's row, and it builds the session object — role and
 * permission overrides included — from SQLite, the source of truth, rather than
 * from the server's reply. A silently incomplete hydration is caught here,
 * before any session exists.
 */
export async function loginOnNewDevice(phone: string, pin: string): Promise<void> {
  requireSupabaseConfiguration();

  // Canonical on the wire. The server keys its lockout on this string, so
  // sending it as typed would let one person spend three separate attempt
  // budgets by rotating '01…', '880…' and '+880…' — and would fail their own
  // login if they had registered in a different form.
  const canonicalPhone = normalizeBdPhone(phone);
  if (!canonicalPhone) {
    throw new DeviceLoginError(GENERIC_FAILURE, true);
  }

  const { data, error } = await supabase.functions.invoke('sync', {
    body: { action: 'device-login', phone: canonicalPhone, pin },
  });
  if (error) {
    throw toLoginError(error);
  }

  const response = parseResponse(data);

  // Adopt the minted session BEFORE pulling: pullChanges goes through the same
  // edge function, which needs this device authenticated as this user.
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: response.accessToken,
    refresh_token: response.refreshToken,
  });
  if (sessionError) {
    throw new DeviceLoginError('Could not start your session. Please try again.', false);
  }

  // `null` forces FULL hydration rather than an incremental pull from a cursor
  // this device has never had. The same call app/(auth)/otp-verify.tsx already
  // makes for an owner restoring onto a new phone — one hydration path, not two.
  await pullChanges(response.shopId, null);

  // The device now holds the shop in the same sense a registered one does, so
  // the root gate must route it to PIN Login rather than Registration.
  await markShopCloudLinked(response.shopId);

  const local = await verifyPin(pin);
  if (!local || local.userId !== response.userId || local.shopId !== response.shopId) {
    // Hydration returned without the row this login depends on. Refusing here
    // leaves the device unenrolled and the attempt retryable, which is far
    // better than a session pointing at a user SQLite does not have.
    throw new DeviceLoginError('Your shop data did not download completely. Please try again.', false);
  }

  // The same login() every other entry point calls, so the epoch bumps and
  // state/sessionGuard.ts, app/_layout.tsx's sync start and the cart cleanup all
  // behave exactly as they do after a normal PIN login.
  useSessionStore.getState().login(local);
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
  requireSupabaseConfiguration();

  // Same canonical form the server compares against the OTP-verified number.
  const canonicalPhone = normalizeBdPhone(phone);
  if (!canonicalPhone) {
    throw new DeviceLoginError(GENERIC_FAILURE, true);
  }

  const { data, error } = await supabase.functions.invoke('sync', {
    body: { action: 'recover-pin', phone: canonicalPhone, newPin },
  });
  if (error) {
    throw toLoginError(error);
  }

  const response = parseResponse({ ...(data as object), role: 'owner' });

  // The server signed out every previous session for this owner, including the
  // OTP one this request travelled on, so the device has to adopt the fresh
  // pair or it is left holding a token that is already dead.
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: response.accessToken,
    refresh_token: response.refreshToken,
  });
  if (sessionError) {
    throw new DeviceLoginError('Could not start your session. Please try again.', false);
  }

  // Recovery runs on a device that may hold nothing (lost phone) or everything
  // (forgotten PIN on the usual handset). pullChanges with an explicit null
  // covers both: a full hydration is what makes the new hash present locally,
  // and on an already-populated device it is an idempotent re-apply.
  await pullChanges(response.shopId, null);
  await markShopCloudLinked(response.shopId);

  const local = await verifyPin(newPin);
  if (!local || local.userId !== response.userId) {
    throw new DeviceLoginError('Your shop data did not download completely. Please try again.', false);
  }
  useSessionStore.getState().login(local);
}
