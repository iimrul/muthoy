import { base64ToBytes, bytesToBase64, hmacSha256 } from "./encoding.ts";

// auth-send-sms/signature.ts — Standard Webhooks verification for Supabase
// Auth's HTTP hooks.
//
// This function is deployed with verify_jwt = false (Auth calls it with no
// user JWT), so this check is the ONLY thing standing between the public
// internet and a paid SMS. Nothing else in the hook runs before it passes.
//
// Supabase signs every hook request with the secret generated in Dashboard →
// Authentication → Hooks, given as `v1,whsec_<base64>`: HMAC-SHA256 over
// `${webhook-id}.${webhook-timestamp}.${raw body}`, base64-encoded, sent as
// `v1,<signature>` in `webhook-signature`. Implemented on Web Crypto rather
// than the `standardwebhooks` package so the code Vitest executes under Node
// is the code Deno deploys — an esm.sh or npm: specifier does not load there.

const VERSION_PREFIX = "v1,";

/**
 * The only spellings of the secret accepted: `whsec_<base64>`, optionally
 * behind Supabase's `v1,`. No bare base64, no other version, no whitespace —
 * a secret in any other shape is a configuration mistake, and guessing what
 * it meant would be guessing at the one gate in front of a paid SMS.
 */
const SECRET_FORMAT = /^(?:v1,)?whsec_([A-Za-z0-9+/]+={0,2})$/;

/** Standard Webhooks: a signing secret is 24 to 64 bytes. */
export const MIN_SECRET_BYTES = 24;
export const MAX_SECRET_BYTES = 64;

/** How far a signed timestamp may sit from now, either way — the spec default. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** Matches the ledger's webhook_id check constraint. */
const MAX_WEBHOOK_ID_LENGTH = 200;
const MAX_SIGNATURE_HEADER_LENGTH = 2048;

export type SignatureFailure =
  | "hook_secret_invalid"
  | "signature_headers_missing"
  | "signature_timestamp_invalid"
  | "signature_timestamp_out_of_tolerance"
  | "signature_mismatch";

export interface SignedHookRequest {
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  /** The raw request body, exactly as received. */
  body: string;
}

export type SignatureCheck =
  | { ok: true; webhookId: string }
  | { ok: false; reason: SignatureFailure };

/**
 * The HMAC key inside `v1,whsec_<base64>` or `whsec_<base64>`, or null. The
 * base64 must be canonical — padded, with no stray bits — so one secret has
 * exactly one spelling, and the key must be 24 to 64 bytes.
 */
export function hookSecretKey(secret: string) {
  const encoded = SECRET_FORMAT.exec(secret)?.[1];
  if (!encoded) return null;
  const key = base64ToBytes(encoded);
  if (!key || bytesToBase64(key) !== encoded) return null;
  return key.length >= MIN_SECRET_BYTES && key.length <= MAX_SECRET_BYTES ? key : null;
}

/**
 * Every `v1` signature in the header. GoTrue joins several with ", " (one per
 * configured secret, during a rotation), so a token may carry a trailing comma.
 */
function v1Signatures(header: string): string[] {
  return header
    .split(/\s+/)
    .map((token) => token.replace(/,+$/, ""))
    .filter((token) => token.startsWith(VERSION_PREFIX))
    .map((token) => token.slice(VERSION_PREFIX.length))
    .filter((signature) => signature.length > 0);
}

/** Constant time for equal lengths. A signature's length is not secret. */
function sameText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyHookSignature(
  request: SignedHookRequest,
  secret: string,
  nowSeconds: number,
): Promise<SignatureCheck> {
  const key = hookSecretKey(secret);
  if (!key) return { ok: false, reason: "hook_secret_invalid" };

  const { webhookId, webhookTimestamp, webhookSignature } = request;
  if (
    !webhookId || !webhookTimestamp || !webhookSignature
    || webhookId.length > MAX_WEBHOOK_ID_LENGTH
    || webhookSignature.length > MAX_SIGNATURE_HEADER_LENGTH
  ) {
    return { ok: false, reason: "signature_headers_missing" };
  }
  if (!/^\d{1,12}$/.test(webhookTimestamp)) {
    return { ok: false, reason: "signature_timestamp_invalid" };
  }
  // Bounds a replay in time; the ledger's webhook_id key refuses one inside it.
  if (Math.abs(nowSeconds - Number(webhookTimestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "signature_timestamp_out_of_tolerance" };
  }

  const expected = bytesToBase64(
    await hmacSha256(key, `${webhookId}.${webhookTimestamp}.${request.body}`),
  );
  const matched = v1Signatures(webhookSignature).some((candidate) => sameText(candidate, expected));
  return matched ? { ok: true, webhookId } : { ok: false, reason: "signature_mismatch" };
}
