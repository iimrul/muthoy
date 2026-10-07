import type { EnvironmentReader } from "./config.ts";

// auth-send-sms/reve.ts — the REVE SMS adapter, and the ONLY file that knows
// how REVE is called.
//
// Kept isolated on purpose: when REVE confirms anything, this file changes and
// nothing else does.
//
// Transport: `post_json`. REVE support asked for POST, and REVE's Postman
// collection gives the JSON body — the same five fields — but shows it only on
// raw-IP servers. Here it goes to an approved HTTPS hostname instead, the
// credentials inside the encrypted body and nowhere in the URL. Confirmed by
// live use on DEV, 2026-10-04: smpp.revesms.com:7790 took a real POST for our
// account and answered Status 0 with a message id — and no 5400, so no IP
// restriction showed. `get_query`, REVE's documented GET, puts the credentials
// in the URL: it is INACTIVE — no configuration may select it — and, with a
// live POST confirmed, its builder is due for removal.
//
// Confirmed so far:
//   fields   apikey, secretkey, callerID (the Sender ID), toUser, messageContent
//   toUser   8801XXXXXXXXX
//   Status   0 accepted · 1 rejected · 101 internal error (ambiguous)
//            108 invalid secret · 109 invalid API key/secret
//            114 bad request parameter · 136 profile/provider blocked
//            137 TPS exceeded · 151 invalid traffic type
//            170 invalid Content-Type · 5400 IP restricted
//   REVE has NO request id: every accepted call is one SMS and one charge.
//
// Where each status comes from is recorded, sanitized, in
// testdata/reve-sendtext-statuses.json, and reve.test.ts pins this file to
// it: 0, 1, 101, 108, 109 and 114 are in REVE's API document, and all eleven
// are in REVE's Postman collection with the reply each one returns.
//
// So this adapter never retries. A timeout, a network failure, a 101 or a
// status nobody has confirmed is AMBIGUOUS — the SMS may or may not exist —
// and the dispatch ledger records it as such instead of trying again.
//
// ACCEPTED needs both an HTTP 2xx AND Status "0". REVE's verdict is the body
// of a 2xx reply; a redirect (never followed) or any other non-2xx reply is
// not that verdict whatever its body says, so it is ambiguous — never
// accepted. (What GoTrue is told about an ambiguous send is handler.ts's
// call, not this file's.)
//
// Fail closed: without an approved HTTPS endpoint, an explicit transport and
// all three credentials, no request is built and nothing is sent.

/**
 * GoTrue gives the whole hook five seconds; the provider gets at most three of
 * them — less when the ledger was slow (handler.ts, waitBudget).
 */
export const REVE_TIMEOUT_MS = 3_000;

/** A REVE reply is a few dozen bytes. Anything far larger is not one. */
const MAX_RESPONSE_CHARS = 16 * 1024;

/**
 * Every endpoint this adapter may call. Both are HTTPS hosts from REVE's own
 * API document. The document's other entries — port 7788 and the raw
 * 103.177.125.x addresses — are plain HTTP and would carry the API key and
 * secret in cleartext, so they are absent by design. A production endpoint
 * REVE confirms later is added HERE, in review — never through a secret.
 */
export const APPROVED_REVE_ENDPOINTS: ReadonlySet<string> = new Set([
  "https://smpp.revesms.com:7790/sendtext",
  "https://apismpp.revesms.com/sendtext",
]);

/**
 * The transports implemented, and the one a configuration may select.
 *
 *   post_json  REVE's JSON body, POSTed to an approved endpoint: the
 *              credentials ride only inside the TLS-encrypted body.
 *   get_query  REVE's documented GET, the credentials in the query string.
 *              INACTIVE, and due for removal now a live POST is confirmed.
 */
export type ReveTransport = "post_json" | "get_query";
const ACTIVE_TRANSPORTS: ReadonlySet<string> = new Set<ReveTransport>(["post_json"]);

export interface ReveConfig {
  endpoint: string;
  transport: ReveTransport;
  apiKey: string;
  secretKey: string;
  senderId: string;
}

export type ReveConfigProblem =
  | "reve_config_missing"
  | "reve_endpoint_unapproved"
  | "reve_transport_unsupported"
  | "reve_credentials_invalid"
  | "reve_sender_invalid";

export type ReveConfigCheck =
  | { ok: true; config: ReveConfig }
  | { ok: false; problem: ReveConfigProblem };

/** Printable ASCII, no spaces: what an API key or secret can sensibly be. */
const CREDENTIAL = /^[\x21-\x7E]{1,256}$/;
/** A numeric long code or an alphanumeric masking ID. */
const SENDER_ID = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/;

function approvedEndpoint(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    return null;
  }
  const normalized = `${url.origin}${url.pathname}`;
  return APPROVED_REVE_ENDPOINTS.has(normalized) ? normalized : null;
}

export function readReveConfig(read: EnvironmentReader): ReveConfigCheck {
  const endpointValue = read("REVE_API_URL")?.trim();
  const transport = read("REVE_TRANSPORT")?.trim();
  const apiKey = read("REVE_API_KEY")?.trim();
  const secretKey = read("REVE_SECRET_KEY")?.trim();
  const senderId = read("REVE_SENDER_ID")?.trim();
  if (!endpointValue || !transport || !apiKey || !secretKey || !senderId) {
    return { ok: false, problem: "reve_config_missing" };
  }
  const endpoint = approvedEndpoint(endpointValue);
  if (!endpoint) return { ok: false, problem: "reve_endpoint_unapproved" };
  if (!ACTIVE_TRANSPORTS.has(transport)) return { ok: false, problem: "reve_transport_unsupported" };
  if (!CREDENTIAL.test(apiKey) || !CREDENTIAL.test(secretKey)) {
    return { ok: false, problem: "reve_credentials_invalid" };
  }
  if (!SENDER_ID.test(senderId)) return { ok: false, problem: "reve_sender_invalid" };
  return {
    ok: true,
    config: { endpoint, transport: transport as ReveTransport, apiKey, secretKey, senderId },
  };
}

export interface ReveRequest {
  url: string;
  init: RequestInit;
}

/**
 * The HTTP request for one SMS. It is never logged, and a fetch failure's own
 * message — which can quote the request — is discarded by sendReveSms below.
 *
 * `post_json` keeps every credential out of the URL: the request goes to the
 * approved endpoint exactly as configured — no query, nothing added to the
 * path — and the five fields travel in the body. Under `get_query` (inactive)
 * they ride in the query string, so that URL would itself be a secret.
 */
export function buildReveRequest(config: ReveConfig, recipient: string, text: string): ReveRequest {
  switch (config.transport) {
    case "post_json":
      return {
        url: config.endpoint,
        init: {
          method: "POST",
          // Explicit, never left to fetch: REVE answers a wrong one with 170.
          headers: { "content-type": "application/json", accept: "application/json" },
          // REVE's own field order. JSON.stringify escapes every value, so
          // nothing in one field can spill into another.
          body: JSON.stringify({
            apikey: config.apiKey,
            secretkey: config.secretKey,
            callerID: config.senderId,
            toUser: recipient,
            messageContent: text,
          }),
          // Never follow a redirect: a 307 or 308 would re-send the body, and
          // the credentials in it, somewhere this allowlist never approved.
          redirect: "manual",
        },
      };
    case "get_query": {
      const fields: [string, string][] = [
        ["apikey", config.apiKey],
        ["secretkey", config.secretKey],
        ["callerID", config.senderId],
        ["toUser", recipient],
        ["messageContent", text],
      ];
      // encodeURIComponent, not URLSearchParams: the latter writes a space as
      // '+', and REVE's document does not say it decodes '+' back to a space.
      const query = fields
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("&");
      return {
        url: `${config.endpoint}?${query}`,
        // Never follow a redirect: it would re-send the credential-bearing
        // request somewhere this allowlist never approved.
        init: { method: "GET", headers: { accept: "application/json" }, redirect: "manual" },
      };
    }
  }
}

export type ReveRejectReason =
  | "provider_rejected"
  | "credentials_invalid"
  | "request_invalid"
  | "profile_blocked"
  | "tps_exceeded"
  | "traffic_type_invalid"
  | "content_type_invalid"
  | "ip_restricted";

export type ReveAmbiguousReason =
  | "provider_internal_error"
  | "provider_unknown_status"
  | "provider_unreadable_response"
  | "provider_redirected"
  | "provider_http_error"
  | "provider_timeout"
  | "provider_network_error";

export type ReveOutcome =
  | { kind: "accepted"; providerStatus: "0"; messageId: string | null }
  | { kind: "rejected"; reason: ReveRejectReason; providerStatus: string }
  | { kind: "ambiguous"; reason: ReveAmbiguousReason; providerStatus: string | null };

/** REVE refused the request outright; no SMS exists. */
export const REJECTED_STATUSES: Readonly<Record<string, ReveRejectReason>> = {
  "1": "provider_rejected",
  "108": "credentials_invalid",
  "109": "credentials_invalid",
  "114": "request_invalid",
  "136": "profile_blocked",
  "137": "tps_exceeded",
  "151": "traffic_type_invalid",
  "170": "content_type_invalid",
  "5400": "ip_restricted",
};

const PROVIDER_STATUS = /^-?\d{1,6}$/;
const MESSAGE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unreadable(): ReveOutcome {
  return { kind: "ambiguous", reason: "provider_unreadable_response", providerStatus: null };
}

/**
 * The body of a 2xx REVE reply, classified by `Status` alone — sendReveSms
 * reads no other body. `Text` is never trusted: REVE's own document spells
 * the same success both "ACCEPTD" and "Acceptd".
 */
export function classifyReveResponse(body: string): ReveOutcome {
  if (body.length > MAX_RESPONSE_CHARS) return unreadable();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return unreadable();
  }
  if (!isRecord(parsed)) return unreadable();

  const raw = parsed.Status;
  const status = typeof raw === "string"
    ? raw.trim()
    : typeof raw === "number" && Number.isSafeInteger(raw)
      ? String(raw)
      : null;
  if (status === null || !PROVIDER_STATUS.test(status)) return unreadable();

  if (status === "0") {
    const id = parsed.Message_ID;
    const messageId = typeof id === "string" && MESSAGE_ID.test(id.trim())
      ? id.trim()
      : typeof id === "number" && Number.isSafeInteger(id) && id >= 0
        ? String(id)
        : null;
    return { kind: "accepted", providerStatus: "0", messageId };
  }
  if (status === "101") {
    return { kind: "ambiguous", reason: "provider_internal_error", providerStatus: status };
  }
  const rejected = Object.prototype.hasOwnProperty.call(REJECTED_STATUSES, status)
    ? REJECTED_STATUSES[status]
    : undefined;
  if (rejected) return { kind: "rejected", reason: rejected, providerStatus: status };
  // Not on REVE's confirmed list, so nobody can say whether an SMS went out.
  return { kind: "ambiguous", reason: "provider_unknown_status", providerStatus: status };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** AbortSignal.timeout rejects with a DOMException, not always an Error subclass. */
function isTimeout(error: unknown): boolean {
  const name = typeof error === "object" && error !== null
    ? (error as { name?: unknown }).name
    : undefined;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * What the HTTP status alone decides, before any body is read: null for a
 * 2xx, whose body then holds REVE's verdict. A redirect — never followed — is
 * told apart from other failures so the log says which one happened.
 */
function httpStatusFailure(status: number): ReveAmbiguousReason | null {
  if (status >= 200 && status <= 299) return null;
  return status >= 300 && status <= 399 ? "provider_redirected" : "provider_http_error";
}

/** ONE call to REVE. Never retried, whatever happens. */
export async function sendReveSms(
  config: ReveConfig,
  recipient: string,
  text: string,
  fetchImpl: FetchLike,
  timeoutMs: number = REVE_TIMEOUT_MS,
): Promise<ReveOutcome> {
  const request = buildReveRequest(config, recipient, text);
  let body: string;
  try {
    const response = await fetchImpl(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const httpFailure = httpStatusFailure(response.status);
    if (httpFailure) {
      // Not read — nothing in it can make this accepted — but released rather
      // than left holding the connection.
      await response.body?.cancel().catch(() => undefined);
      return { kind: "ambiguous", reason: httpFailure, providerStatus: null };
    }
    body = await response.text();
  } catch (error) {
    // The error's own message can quote the request URL — API key and secret
    // included — so it is reduced to a category here and dropped.
    return {
      kind: "ambiguous",
      reason: isTimeout(error) ? "provider_timeout" : "provider_network_error",
      providerStatus: null,
    };
  }
  return classifyReveResponse(body);
}
