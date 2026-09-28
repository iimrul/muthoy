import type { CatalogKey } from '../../i18n/catalog';
import type { DeviceLoginErrorCode } from '../../sync/deviceAuth';

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
};

/** The catalog key for a DeviceLoginError's code; the generic failure for anything unknown. */
export function deviceLoginErrorKey(code: unknown): CatalogKey {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(DEVICE_LOGIN_ERROR_KEYS, code)
    ? DEVICE_LOGIN_ERROR_KEYS[code as DeviceLoginErrorCode]
    : 'deviceLoginGenericFailure';
}
