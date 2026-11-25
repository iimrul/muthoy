// domain/otpCode.ts — the six-digit code inside an SMS or a pasted text
// (founder request 2026-11-25: the code should fill itself in, and pasting it
// should work).
//
// Muthoy's own SMS reads "Muthoy code: 123456. Valid 5 minutes. ...", but a
// pasted text can be anything: the code alone, the whole message, or a number
// with spaces. (The app never names the server's SMS sender; see H-5 in
// tests/dev-production-safety.test.ts.)
// `otpCodeSchema` still validates the result; this only finds it.

export const OTP_CODE_LENGTH = 6;

const STANDALONE_SIX_DIGITS = /(?<!\d)(\d{6})(?!\d)/g;

/**
 * The one six-digit code in `text`, or null when there is none or more than
 * one candidate (guessing between two codes would be worse than asking).
 * A text that is only digits, spaces and dashes ("123 456") counts as one code.
 */
export function extractOtpCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const compact = text.trim();
  if (/^[\d\s-]+$/.test(compact)) {
    const digits = compact.replace(/\D/g, "");
    return digits.length === OTP_CODE_LENGTH ? digits : null;
  }
  const codes = [...compact.matchAll(STANDALONE_SIX_DIGITS)].map((match) => match[1]!);
  const unique = [...new Set(codes)];
  return unique.length === 1 ? unique[0]! : null;
}
