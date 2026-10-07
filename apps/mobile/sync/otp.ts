import type { Session } from "@supabase/supabase-js";
import { normalizeBdPhoneInput } from "@muthoy/validation";
import { OtpSendFailedError, toOtpSendError, toOtpVerifyError } from "./otpPolicy";
import { requireSupabaseConfiguration, supabase } from "./supabaseClient";

/** The number handed to an OTP call is not a Bangladeshi mobile number. */
export class OtpPhoneError extends Error {
  constructor() {
    super("Enter a valid Bangladeshi mobile number.");
    this.name = "OtpPhoneError";
  }
}

// The last line before the SMS provider. Whatever a screen, a route param or
// a resumed registration passes in, the provider only ever sees the one
// canonical +8801XXXXXXXXX string — so the number a code is sent to, verified
// against and recovered with cannot drift between 017…, 880… and +880… — and
// a value that is not a Bangladeshi mobile number never leaves the phone.
// Checked before anything else, so a bad number cannot even sign the local
// auth session out.
function otpPhone(phone: string): string {
  const canonical = normalizeBdPhoneInput(phone);
  if (!canonical) {
    throw new OtpPhoneError();
  }
  return canonical;
}

// H-5. Every failure leaves this file TYPED, decided by the auth error's status
// and code (sync/otpPolicy.ts) and never by its message text: a rate limit, a
// send that failed, a code the server refused, or a check that never happened.
// A send failure is one type whatever its cause, so no screen can say whether
// a number has an account.

async function requestOtp(phone: string): Promise<void> {
  let result: Awaited<ReturnType<typeof supabase.auth.signInWithOtp>>;
  try {
    result = await supabase.auth.signInWithOtp({ phone });
  } catch (cause) {
    throw toOtpSendError(cause);
  }
  if (result.error) {
    throw toOtpSendError(result.error);
  }
}

export async function sendOtp(phone: string): Promise<void> {
  const canonical = otpPhone(phone);
  requireSupabaseConfiguration();
  // A second owner on the same device must never inherit the first JWT.
  const { error: signOutError } = await supabase.auth.signOut({
    scope: "local",
  });
  if (signOutError) {
    // No code was requested: the old session had to go first.
    throw new OtpSendFailedError({ cause: signOutError });
  }
  await requestOtp(canonical);
}

export async function resendOtp(phone: string): Promise<void> {
  const canonical = otpPhone(phone);
  requireSupabaseConfiguration();
  await requestOtp(canonical);
}

export async function verifyOtp(phone: string, code: string): Promise<Session> {
  const canonical = otpPhone(phone);
  requireSupabaseConfiguration();
  let result: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;
  try {
    result = await supabase.auth.verifyOtp({
      phone: canonical,
      token: code,
      type: "sms",
    });
  } catch (cause) {
    throw toOtpVerifyError(cause);
  }
  if (result.error) {
    throw toOtpVerifyError(result.error);
  }
  if (!result.data.session) {
    throw new Error("OTP verification succeeded without creating a session.");
  }
  return result.data.session;
}
