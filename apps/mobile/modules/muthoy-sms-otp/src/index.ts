import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

// JS side of the Android SMS User Consent reader (founder request 2026-11-25).
// Android only: iOS offers the code from Messages through the input's
// textContentType="oneTimeCode", with no code of ours. Where the native module
// is absent (iOS, tests, an older build) every call resolves null, so the OTP
// screen simply keeps its typed and pasted paths.

interface MuthoySmsOtpNativeModule {
  waitForSmsWithConsent(): Promise<string | null>;
  cancel(): void;
}

const nativeModule: MuthoySmsOtpNativeModule | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<MuthoySmsOtpNativeModule>('MuthoySmsOtp')
    : null;

export const isSmsConsentAvailable = nativeModule !== null;

/**
 * Waits up to 5 minutes for the next SMS carrying a one-time code and, if the
 * owner taps Allow on Android's own prompt, resolves with that message's text.
 * Resolves null on denial, timeout, cancel, or where unsupported.
 */
export function waitForSmsWithConsent(): Promise<string | null> {
  return nativeModule ? nativeModule.waitForSmsWithConsent() : Promise.resolve(null);
}

/** Stops a pending wait; its promise resolves null. */
export function cancelSmsConsent(): void {
  nativeModule?.cancel();
}
