import { normalizeBdPhone } from "../sync/_shared/phone.ts";

// auth-send-sms/payload.ts — the Send SMS hook's input, reduced to the two
// things this hook acts on: where the code goes and what it is.
//
// GoTrue sends { user, sms: { otp, phone } } (supabase/auth
// internal/hooks/v0hooks and internal/api/phone.go, read 2026-10-01).
// `sms.phone` is the DESTINATION for every OTP type. Whenever it is present it
// is the only candidate: GoTrue omits it when empty (`omitempty`), so a
// present value that is empty, not a string or not a supported number fails
// closed. It is never swapped for `user.phone` — the account's number, which
// is not always the destination: during a phone change it is the old number,
// not the one being verified. `user.phone` is read only when `sms.phone` is
// absent altogether, as from an older GoTrue that does not send it.
//
// The number must arrive in exactly the form GoTrue sends — `8801XXXXXXXXX`,
// nothing more and nothing less — and only then is it put in the canonical
// Bangladeshi form the app and every server route use (`_shared/phone.ts`,
// the server copy of packages/validation). That shared normalizer is forgiving
// on purpose — it strips whatever a person typed around the digits — so it is
// never the gate here: junk around or inside a number fails closed instead of
// being normalized away. The app already refuses anything else before calling
// Supabase, so a foreign number here came straight at the Auth API — and is
// exactly the international-SMS cost abuse this refuses before the ledger or
// REVE is ever touched.

/** Six digits: the length the app's OTP input and otpCodeSchema accept. */
const OTP = /^\d{6}$/;

export interface SmsDelivery {
  /** `+8801XXXXXXXXX` — the canonical form. */
  canonicalPhone: string;
  /** `8801XXXXXXXXX` — the destination format REVE takes. */
  recipient: string;
  otp: string;
}

export type PayloadFailure = "payload_invalid" | "otp_invalid" | "phone_unsupported";

export type PayloadCheck =
  | { ok: true; delivery: SmsDelivery }
  | { ok: false; reason: PayloadFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A Bangladeshi mobile number exactly as GoTrue sends one: E.164 digits and no
 * "+" — its validatePhone strips the "+" and any spaces before a number is
 * stored or sent (supabase/auth internal/api/phone.go, read 2026-10-02).
 * Tested against the original string, before any normalizing.
 */
const GOTRUE_BD_MOBILE = /^8801[3-9]\d{8}$/;

/**
 * The canonical destination, or null. A present `sms.phone` is the only
 * candidate, never substituted; `user.phone` is read only when it is absent.
 * Either one must be in GoTrue's exact form before it is canonicalized.
 */
function destination(sms: Record<string, unknown>, user: Record<string, unknown> | null): string | null {
  const value = Object.prototype.hasOwnProperty.call(sms, "phone") ? sms.phone : user?.phone;
  return typeof value === "string" && GOTRUE_BD_MOBILE.test(value) ? normalizeBdPhone(value) : null;
}

export function parseSmsHookPayload(body: string): PayloadCheck {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return { ok: false, reason: "payload_invalid" };
  }
  if (!isRecord(root) || !isRecord(root.sms)) return { ok: false, reason: "payload_invalid" };

  const otp = root.sms.otp;
  if (typeof otp !== "string" || !OTP.test(otp)) return { ok: false, reason: "otp_invalid" };

  const canonicalPhone = destination(root.sms, isRecord(root.user) ? root.user : null);
  if (!canonicalPhone) return { ok: false, reason: "phone_unsupported" };

  return {
    ok: true,
    delivery: { canonicalPhone, recipient: canonicalPhone.slice(1), otp },
  };
}
