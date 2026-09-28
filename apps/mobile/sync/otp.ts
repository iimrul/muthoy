import type { Session } from "@supabase/supabase-js";
import { normalizeBdPhoneInput } from "@muthoy/validation";
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

async function requestOtp(phone: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) {
    throw error;
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
    throw signOutError;
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
  const { data, error } = await supabase.auth.verifyOtp({
    phone: canonical,
    token: code,
    type: "sms",
  });
  if (error) {
    throw error;
  }
  if (!data.session) {
    throw new Error("OTP verification succeeded without creating a session.");
  }
  return data.session;
}
