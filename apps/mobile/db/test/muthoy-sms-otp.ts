// Node stand-in for modules/muthoy-sms-otp, aliased in vitest.config.ts like
// the PIN and DB-key modules. The real module imports `expo`, whose index
// loads native code Node cannot run. Here, as on iOS or an older build, the
// SMS consent reader is absent: every wait resolves null at once, so the OTP
// screen keeps only its typed and pasted paths. Suites that test the consent
// loop mock this module themselves.

export const isSmsConsentAvailable = false;

export function waitForSmsWithConsent(): Promise<string | null> {
  return Promise.resolve(null);
}

export function cancelSmsConsent(): void {
  // Nothing is pending.
}
