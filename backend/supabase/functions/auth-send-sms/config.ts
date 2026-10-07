import { base64ToBytes } from "./encoding.ts";

// auth-send-sms/config.ts — the hook's own settings, read from Edge Function
// secrets and refused rather than defaulted whenever they are wrong. The REVE
// settings live with the REVE adapter (reve.ts).

export type EnvironmentReader = (name: string) => string | undefined;

/** Locked 2026-09-29: ten provider calls per number per 24 hours. */
export const DEFAULT_DAILY_CAP = 10;
/** A DEV project may LOWER the cap to test it; nothing may raise it. */
export const MAX_DAILY_CAP = 10;

const MIN_HASH_KEY_BYTES = 32;

export interface DispatchConfig {
  /** HMAC key for the ledger's phone and content keys. Never leaves this function. */
  hashKey: BufferSource;
  /**
   * The key being rotated out, read but never written: rows it wrote still
   * count against the cap and still block a duplicate. Null outside a
   * rotation. See the migration's header for the rotation procedure.
   */
  previousHashKey: BufferSource | null;
  dailyCap: number;
}

export type DispatchConfigProblem =
  | "dispatch_hash_key_invalid"
  | "dispatch_previous_hash_key_invalid"
  | "daily_cap_invalid";

export type DispatchConfigCheck =
  | { ok: true; config: DispatchConfig }
  | { ok: false; problem: DispatchConfigProblem };

function hashKey(value: string | undefined) {
  const key = base64ToBytes(value?.trim() ?? "");
  return key && key.length >= MIN_HASH_KEY_BYTES ? key : null;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function readDispatchConfig(read: EnvironmentReader): DispatchConfigCheck {
  const current = hashKey(read("SMS_DISPATCH_HASH_KEY"));
  if (!current) return { ok: false, problem: "dispatch_hash_key_invalid" };

  // Optional. When set it must be a usable key and a DIFFERENT one: an
  // unreadable or repeated value means the rotation is not what the operator
  // thinks it is, so nothing is sent until it is.
  const previousValue = read("SMS_DISPATCH_HASH_KEY_PREVIOUS")?.trim();
  const previous = previousValue ? hashKey(previousValue) : null;
  if (previousValue && (!previous || sameBytes(previous, current))) {
    return { ok: false, problem: "dispatch_previous_hash_key_invalid" };
  }

  // Optional, and only ever a lower number. An unreadable value fails closed
  // instead of quietly reverting to the default the operator meant to change.
  const capValue = read("OTP_SMS_DAILY_CAP_PER_PHONE")?.trim();
  let dailyCap = DEFAULT_DAILY_CAP;
  if (capValue) {
    if (!/^\d{1,2}$/.test(capValue)) return { ok: false, problem: "daily_cap_invalid" };
    dailyCap = Number(capValue);
    if (dailyCap < 1 || dailyCap > MAX_DAILY_CAP) return { ok: false, problem: "daily_cap_invalid" };
  }

  return { ok: true, config: { hashKey: current, previousHashKey: previous, dailyCap } };
}
