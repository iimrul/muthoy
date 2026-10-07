import type { CatalogKey } from '../../i18n/catalog';
import type { DeviceLoginErrorCode } from '../../sync/deviceAuth';
import { codeLikelyExpired, OtpCodeRejectedError, OtpRateLimitedError } from '../../sync/otpPolicy';

// components/auth/authMessages.ts — server/client failure codes to catalog
// keys, so an auth screen translates a refusal instead of printing the English
// message it arrived with.
//
// `credentials` stays one message for every credential problem. The server
// withholds whether the number or the PIN was wrong; translating it must not
// invent the distinction.

const DEVICE_LOGIN_ERROR_KEYS: Record<DeviceLoginErrorCode, CatalogKey> = {
  credentials: 'authErrorCredentials',
  invalid_response: 'authErrorInvalidResponse',
  relink_required: 'authErrorRelink',
  enrollment_held: 'authErrorEnrollmentHeld',
  installation_unknown: 'authErrorInstallationUnknown',
  otp_required: 'authErrorOtpRequired',
  network: 'authErrorNetwork',
  session_start_failed: 'authErrorSessionStart',
  plan_unconfirmed: 'authErrorPlan',
  enrollment_save_failed: 'authErrorEnrollmentSave',
  access_unconfirmed: 'authErrorAccessUnconfirmed',
  access_revoked: 'authErrorAccessRevoked',
  setup_incomplete: 'authErrorSetup',
  hydration_incomplete: 'authErrorHydration',
  pin_in_use: 'authErrorPinInUse',
  recovery_refused: 'authErrorRecoveryRefused',
  recovery_failed: 'authErrorRecoveryFailed',
  pin_changed_login_required: 'authErrorPinChangedLoginRequired',
  recovery_uncertain: 'authErrorRecoveryUncertain',
};

/** The catalog key for a DeviceLoginError's code; the generic failure for anything unknown. */
export function deviceLoginErrorKey(code: unknown): CatalogKey {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(DEVICE_LOGIN_ERROR_KEYS, code)
    ? DEVICE_LOGIN_ERROR_KEYS[code as DeviceLoginErrorCode]
    : 'deviceLoginGenericFailure';
}

/**
 * H-5. A failed send or resend. A rate limit is the one failure worth naming —
 * waiting is the fix. Everything else is ONE message, so a screen never says
 * whether the number belongs to an account.
 */
export function otpSendErrorKey(
  cause: unknown,
  fallback: 'otpSendFailed' | 'otpResendFailed' = 'otpSendFailed',
): CatalogKey {
  return cause instanceof OtpRateLimitedError ? 'otpRateLimited' : fallback;
}

/**
 * H-5. A failed verification: rate-limited, a code the server refused (wrong
 * or expired, told apart by when it was sent), or a check that never happened
 * — which must not be shown as a wrong code.
 */
export function otpVerifyErrorKey(cause: unknown, sentAtMs: number | null, nowMs: number): CatalogKey {
  if (cause instanceof OtpRateLimitedError) return 'otpRateLimited';
  if (cause instanceof OtpCodeRejectedError) {
    return codeLikelyExpired(sentAtMs, nowMs) ? 'otpExpired' : 'otpIncorrect';
  }
  return 'otpVerifyFailed';
}
