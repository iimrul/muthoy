// sync/otpPolicy.ts — H-5. The OTP rules every OTP screen shares, and the typed
// failures sync/otp.ts raises.
//
// Kept apart from sync/otp.ts so a screen — and a screen test that mocks the
// OTP calls — can read them without loading the Supabase client.
//
// The two numbers MIRROR hosted Supabase Auth settings that no client can read:
//   OTP_EXPIRY_SECONDS           Auth → SMS OTP expiry
//   OTP_RESEND_COOLDOWN_SECONDS  Auth → minimum interval between codes per number
// Locked 2026-09-29. Change the hosted setting and this file together.
export const OTP_EXPIRY_SECONDS = 300;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Too many codes or attempts for this number right now: wait, then try again. */
export class OtpRateLimitedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Too many attempts. Wait before trying again.', options);
    this.name = 'OtpRateLimitedError';
  }
}

/**
 * A code could not be sent. ONE failure for every reason — provider, network,
 * configuration — so nothing a screen says can tell whether a number belongs
 * to an account.
 */
export class OtpSendFailedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The verification code could not be sent.', options);
    this.name = 'OtpSendFailedError';
  }
}

/**
 * The server refused the code itself. Supabase answers a wrong code and an
 * expired one identically (403 `otp_expired`), so this cannot say which —
 * codeLikelyExpired below decides how to describe it.
 */
export class OtpCodeRejectedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The verification code was not accepted.', options);
    this.name = 'OtpCodeRejectedError';
  }
}

/**
 * The code could not be checked — network, server, configuration, or any
 * refusal that does not name the code — so it may well be right.
 */
export class OtpVerifyFailedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('The verification code could not be checked.', options);
    this.name = 'OtpVerifyFailedError';
  }
}

interface AuthFailure {
  status: number | null;
  code: string | null;
}

/** Status and code of a Supabase auth error, read structurally. Never its message. */
function authFailure(cause: unknown): AuthFailure {
  if (typeof cause !== 'object' || cause === null) return { status: null, code: null };
  const { status, code } = cause as { status?: unknown; code?: unknown };
  return {
    status: typeof status === 'number' ? status : null,
    code: typeof code === 'string' && code.length > 0 ? code : null,
  };
}

/**
 * Supabase's own limits, plus a 429 from the Send SMS hook's per-number daily
 * cap, which reaches the app as a bare status with no code.
 */
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'over_sms_send_rate_limit',
  'over_request_rate_limit',
]);

/**
 * The codes that mean "the server checked this code and refused it". Only
 * these read as wrong or expired. Supabase Auth names a refused code
 * explicitly — `otp_expired`, for a wrong code and an expired one alike — so
 * a 400/401/403 WITHOUT a code is not a verdict on the code: it is a
 * misconfiguration, an auth failure or a server fault, and telling the user
 * their correct code was wrong would send them retyping a code that works.
 */
const CODE_REJECTION_CODES: ReadonlySet<string> = new Set(['otp_expired']);

function isRateLimited(failure: AuthFailure): boolean {
  return failure.status === 429 || (failure.code !== null && RATE_LIMIT_CODES.has(failure.code));
}

/** A failed send or resend, typed by status and code — never by message text. */
export function toOtpSendError(cause: unknown): OtpRateLimitedError | OtpSendFailedError {
  return isRateLimited(authFailure(cause))
    ? new OtpRateLimitedError({ cause })
    : new OtpSendFailedError({ cause });
}

/** A failed verification, typed by status and code — never by message text. */
export function toOtpVerifyError(
  cause: unknown,
): OtpRateLimitedError | OtpCodeRejectedError | OtpVerifyFailedError {
  const failure = authFailure(cause);
  if (isRateLimited(failure)) return new OtpRateLimitedError({ cause });
  if (failure.code !== null && CODE_REJECTION_CODES.has(failure.code)) {
    return new OtpCodeRejectedError({ cause });
  }
  return new OtpVerifyFailedError({ cause });
}

/**
 * Whether a refused code should be described as expired.
 *
 * The server cannot tell (see OtpCodeRejectedError), so the device decides by
 * its own clock: refused at or after the code's lifetime reads as expired,
 * anything sooner as incorrect. An unknown send time reads as incorrect —
 * retyping costs nothing, and a resend is always offered alongside.
 */
export function codeLikelyExpired(sentAtMs: number | null, nowMs: number): boolean {
  return sentAtMs !== null && nowMs - sentAtMs >= OTP_EXPIRY_SECONDS * 1000;
}
