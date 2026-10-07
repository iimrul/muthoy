// auth-send-sms/message.ts — the one SMS this hook sends.
//
// English only for Beta (locked 2026-09-29): GSM-7 characters keep it to a
// single 160-character segment, where Bangla would be UCS-2 at 70 characters a
// segment. "5 minutes" is the hosted OTP expiry (300 s); change both together.

const OTP = /^\d{6}$/;

/** Characters that survive percent-encoding to REVE unambiguously: no '+', '&' or '#'. */
export const SMS_SAFE_TEXT = /^[A-Za-z0-9 .:,]+$/;
export const SINGLE_SEGMENT_LIMIT = 160;

export function otpMessage(otp: string): string {
  if (!OTP.test(otp)) throw new Error("otpMessage requires a six-digit code");
  return `Muthoy code: ${otp}. Valid 5 minutes. Never share this code.`;
}
