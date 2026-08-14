import type { Session } from "@supabase/supabase-js";
import { requireSupabaseConfiguration, supabase } from "./supabaseClient";

async function requestOtp(phone: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) {
    throw error;
  }
}

export async function sendOtp(phone: string): Promise<void> {
  requireSupabaseConfiguration();
  // A second owner on the same device must never inherit the first JWT.
  const { error: signOutError } = await supabase.auth.signOut({
    scope: "local",
  });
  if (signOutError) {
    throw signOutError;
  }
  await requestOtp(phone);
}

export async function resendOtp(phone: string): Promise<void> {
  requireSupabaseConfiguration();
  await requestOtp(phone);
}

export async function verifyOtp(phone: string, code: string): Promise<Session> {
  requireSupabaseConfiguration();
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
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
