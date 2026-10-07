import { readDispatchConfig, type EnvironmentReader } from "./config.ts";
import {
  type ClaimDecision,
  type ClaimHandle,
  type ClaimInput,
  dispatchKeys,
  type DispatchLedger,
  type DispatchOutcome,
  type DispatchStatus,
  LedgerUnavailableError,
} from "./ledger.ts";
import { otpMessage } from "./message.ts";
import { parseSmsHookPayload } from "./payload.ts";
import {
  type FetchLike,
  readReveConfig,
  REVE_TIMEOUT_MS,
  type ReveOutcome,
  sendReveSms,
} from "./reve.ts";
import { verifyHookSignature } from "./signature.ts";

// auth-send-sms/handler.ts — Supabase Auth's Send SMS hook, end to end.
//
// Supabase Auth generates and verifies the OTP. This only delivers it, and the
// order of what it checks is the point:
//
//   1. the signature, before anything else reads the request;
//   2. the payload — a six-digit code for a Bangladeshi number, or nothing;
//   3. every setting the send needs, refused rather than defaulted;
//   4. the ledger claim, made under an owner only this invocation holds — no
//      claim of its own, no SMS;
//   5. ONE call to REVE, never retried;
//   6. the outcome, recorded best-effort: the SMS exists or not either way.
//
// Replies follow GoTrue's hook contract (supabase/auth internal/hooks/hookshttp
// and hookserrors, read 2026-10-01). GoTrue reads an error object ONLY from an
// HTTP 200/202 reply, so every decided outcome answers 200 with
// {"error":{"http_code","message"}}, and GoTrue hands http_code on as the
// status of its own reply — which is how a capped number reaches the app as a
// 429. No reply carries `retry-after`, so GoTrue's hook client never re-sends a
// request this function decided.
//
// A failure can still come back as a second SMS. On the first real DEV send
// (2026-10-04) a 503 from here was followed by a second /otp run with a NEW
// code (DECISIONS.md). So once REVE has been called, the code it was given
// stands: an outcome nobody can confirm — a timeout, a 101, a reply that is
// not REVE's verdict — answers SUCCESS. A failure there could mint a second
// code and a second SMS, and leave the first SMS carrying a dead code. The
// same holds for a retry that finds that code's claim still pending under
// another invocation: that one may already have sent it. Only what certainly
// sent nothing fails: a refusal before REVE was called, or REVE's own
// definite rejection.
//
// Messages are generic: the /otp endpoint is public, and the app shows its own
// localized copy keyed on the status alone. The same is true of the logs —
// one line per thing that went wrong, built only from fixed categories and
// REVE's numeric status. Never a number, a code, the message text, a
// credential or the provider URL.

const MAX_BODY_BYTES = 64 * 1024;

export const SEND_FAILED_MESSAGE = "SMS could not be sent";
export const RATE_LIMITED_MESSAGE =
  "Too many codes were requested for this number. Try again later.";

// Every wait comes out of one budget. GoTrue allows the whole hook five
// seconds, counted on its side, and a cold start spends some of them before
// this code runs; so the handler keeps to its own share, counted from the
// moment it starts:
//
//   claim    up to 2 s an attempt: the cold first PostgREST call of
//            2026-10-04 needed more than the 750 ms it used to get;
//   REVE     what is left — never more than its own 3 s, never under 0.5 s;
//   record   half a second, on a connection that is warm by then.
//
// A claim attempt starts only if REVE and the record still get theirs after it.

/** The handler's share of GoTrue's five seconds; the rest absorbs a cold start. */
export const HOOK_BUDGET_MS = 3_500;
/** The longest one claim attempt waits. */
export const CLAIM_TIMEOUT_MS = 2_000;
/** The least REVE is given: it answered in 0.5–0.7 s on DEV. */
export const MIN_PROVIDER_MS = 500;
/** Settling the outcome. */
export const RECORD_TIMEOUT_MS = 500;
/** A claim whose reply never came is asked once more — never a third time. */
const CLAIM_ATTEMPTS = 2;

const JSON_HEADERS = { "content-type": "application/json" };

export interface HandlerDependencies {
  read: EnvironmentReader;
  fetch: FetchLike;
  ledger: DispatchLedger;
  nowMs: () => number;
  log: (line: string) => void;
}

export interface WaitBudget {
  /** A claim attempt's wait; zero when one would leave REVE and the record too little. */
  claimMs(): number;
  /** REVE's wait. */
  providerMs(): number;
}

/** How long each wait may be, from what is left of HOOK_BUDGET_MS since `startedAt`. */
export function waitBudget(startedAt: number, nowMs: () => number): WaitBudget {
  const left = () => startedAt + HOOK_BUDGET_MS - nowMs();
  return {
    claimMs: () =>
      Math.max(0, Math.min(CLAIM_TIMEOUT_MS, left() - MIN_PROVIDER_MS - RECORD_TIMEOUT_MS)),
    providerMs: () => Math.min(REVE_TIMEOUT_MS, Math.max(MIN_PROVIDER_MS, left() - RECORD_TIMEOUT_MS)),
  };
}

function hookOk(): Response {
  return new Response("{}", { status: 200, headers: JSON_HEADERS });
}

/** A decided outcome GoTrue passes to the app as `http_code`. */
function hookError(httpCode: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

/** For requests that never became a hook call: not POST, too big, not signed. */
function transportError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: JSON_HEADERS,
  });
}

/** Only identifiers safe to print: a log line cannot be forged through them. */
function safeToken(value: string | null | undefined): string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : "none";
}

function logLine(fields: Record<string, string | null | undefined>): string {
  const parts = Object.entries(fields).map(([name, value]) => `${name}=${safeToken(value)}`);
  return `auth-send-sms: ${parts.join(" ")}`;
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const body = await request.text();
  return new TextEncoder().encode(body).length > MAX_BODY_BYTES ? null : body;
}

function ledgerOutcome(outcome: ReveOutcome): DispatchOutcome {
  switch (outcome.kind) {
    case "accepted":
      return {
        status: "accepted",
        reason: null,
        providerStatus: outcome.providerStatus,
        providerMessageId: outcome.messageId,
      };
    case "rejected":
    case "ambiguous":
      return {
        status: outcome.kind,
        reason: outcome.reason,
        providerStatus: outcome.providerStatus,
        providerMessageId: null,
      };
  }
}

/**
 * After the one REVE call. Ambiguous answers success: its code is the one
 * that stands (see the header). A definite rejection fails; TPS exhaustion is
 * the transient one.
 */
function replyForOutcome(outcome: ReveOutcome): Response {
  if (outcome.kind !== "rejected") return hookOk();
  return hookError(outcome.reason === "tps_exceeded" ? 503 : 500, SEND_FAILED_MESSAGE);
}

/**
 * A replay is answered from the outcome already in the ledger — never a new
 * send. Only a definite rejection proves this code never went out.
 *
 * A row still `pending` is another invocation's claim: its REVE call may be in
 * flight, or done with the outcome lost before it was recorded. Its code may
 * be on the phone already, so it stands — success, as for ambiguous. The row
 * stays pending; only its owner can settle it.
 */
function replyForRecordedStatus(status: DispatchStatus): Response {
  if (status === "rejected") return hookError(500, SEND_FAILED_MESSAGE);
  return hookOk();
}

/**
 * The ledger claim, asked at most twice under ONE owner. A claim can commit
 * and still lose its reply — a slow cold call, a dropped connection — so a
 * failed ask proves nothing either way, and is never permission. Asked again
 * under the same owner, the ledger answers about that very claim: it resumes
 * it if it committed, makes it now if it did not, and never hands this
 * invocation anybody else's. Null when no answer came at all.
 */
async function claimDispatch(
  deps: HandlerDependencies,
  claim: ClaimInput,
  budget: WaitBudget,
): Promise<ClaimDecision | null> {
  const webhook = claim.webhookId;
  for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt += 1) {
    const timeoutMs = budget.claimMs();
    if (timeoutMs <= 0) {
      deps.log(logLine({ outcome: "claim_abandoned", reason: "budget_spent", webhook }));
      return null;
    }
    try {
      const decision = await deps.ledger.claim(claim, timeoutMs);
      if (attempt > 1) {
        const resumed = decision.decision === "send" && decision.resumed;
        deps.log(logLine({ outcome: "claim_reconciled", resumed: resumed ? "yes" : "no", webhook }));
      }
      return decision;
    } catch (error) {
      const db = error instanceof LedgerUnavailableError ? error.code : null;
      deps.log(logLine({
        outcome: "ledger_unavailable",
        step: "claim",
        attempt: String(attempt),
        db,
        webhook,
      }));
    }
  }
  return null;
}

/** Best-effort, and only by this claim's owner: the SMS exists or not regardless. */
async function recordOutcome(
  deps: HandlerDependencies,
  claim: ClaimHandle,
  outcome: ReveOutcome,
): Promise<void> {
  const webhook = claim.webhookId;
  try {
    const settled = await deps.ledger.record(claim, ledgerOutcome(outcome), RECORD_TIMEOUT_MS);
    if (!settled) deps.log(logLine({ outcome: "ledger_unsettled", step: "record", webhook }));
  } catch (error) {
    const db = error instanceof LedgerUnavailableError ? error.code : null;
    deps.log(logLine({ outcome: "ledger_unavailable", step: "record", db, webhook }));
  }
}

async function handle(request: Request, deps: HandlerDependencies): Promise<Response> {
  const budget = waitBudget(deps.nowMs(), deps.nowMs);
  if (request.method !== "POST") return transportError(405, "Method not allowed");
  const body = await readBody(request);
  if (body === null) return transportError(413, "Payload too large");

  const secret = deps.read("SEND_SMS_HOOK_SECRET");
  if (!secret) {
    deps.log(logLine({ outcome: "config_invalid", reason: "hook_secret_missing" }));
    return transportError(500, "Hook is not configured");
  }
  const signature = await verifyHookSignature(
    {
      webhookId: request.headers.get("webhook-id"),
      webhookTimestamp: request.headers.get("webhook-timestamp"),
      webhookSignature: request.headers.get("webhook-signature"),
      body,
    },
    secret,
    Math.floor(deps.nowMs() / 1000),
  );
  if (!signature.ok) {
    if (signature.reason === "hook_secret_invalid") {
      deps.log(logLine({ outcome: "config_invalid", reason: signature.reason }));
      return transportError(500, "Hook is not configured");
    }
    deps.log(logLine({ outcome: "unauthorized", reason: signature.reason }));
    return transportError(401, "Invalid signature");
  }
  const webhook = signature.webhookId;

  const payload = parseSmsHookPayload(body);
  if (!payload.ok) {
    deps.log(logLine({ outcome: "refused", reason: payload.reason, webhook }));
    return hookError(400, SEND_FAILED_MESSAGE);
  }

  const reve = readReveConfig(deps.read);
  if (!reve.ok) {
    deps.log(logLine({ outcome: "config_invalid", reason: reve.problem, webhook }));
    return hookError(500, SEND_FAILED_MESSAGE);
  }
  const dispatch = readDispatchConfig(deps.read);
  if (!dispatch.ok) {
    deps.log(logLine({ outcome: "config_invalid", reason: dispatch.problem, webhook }));
    return hookError(500, SEND_FAILED_MESSAGE);
  }

  const { delivery } = payload;
  const { hashKey, previousHashKey, dailyCap } = dispatch.config;
  const [keys, previousKeys] = await Promise.all([
    dispatchKeys(hashKey, delivery.canonicalPhone, delivery.otp),
    previousHashKey ? dispatchKeys(previousHashKey, delivery.canonicalPhone, delivery.otp) : null,
  ]);
  // Made here, held only in memory, never logged: the proof a claim is ours.
  const claim: ClaimInput = { webhookId: webhook, owner: crypto.randomUUID(), keys, previousKeys, dailyCap };

  const decision = await claimDispatch(deps, claim, budget);
  if (!decision) return hookError(503, SEND_FAILED_MESSAGE);
  if (decision.decision === "capped") {
    deps.log(logLine({ outcome: "capped", webhook }));
    return hookError(429, RATE_LIMITED_MESSAGE);
  }
  if (decision.decision === "unknown_key") {
    // A hash-key rotation done early or half-way: this instance cannot read
    // the whole recent ledger, so it cannot rule out a duplicate. Fails until
    // the previous key is restored or its rows age past a day.
    deps.log(logLine({ outcome: "ledger_key_unknown", webhook }));
    return hookError(503, SEND_FAILED_MESSAGE);
  }
  if (decision.decision === "duplicate") {
    deps.log(logLine({ outcome: "duplicate", status: decision.status, webhook }));
    return replyForRecordedStatus(decision.status);
  }

  const outcome = await sendReveSms(
    reve.config,
    delivery.recipient,
    otpMessage(delivery.otp),
    deps.fetch,
    budget.providerMs(),
  );
  await recordOutcome(deps, claim, outcome);

  if (outcome.kind !== "accepted") {
    deps.log(logLine({
      outcome: outcome.kind,
      reason: outcome.reason,
      provider_status: outcome.providerStatus,
      webhook,
    }));
  }
  return replyForOutcome(outcome);
}

export function createSendSmsHandler(
  deps: HandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handle(request, deps);
    } catch {
      // Nothing above is expected to throw. If something does, say nothing
      // specific: the error could carry anything it touched.
      deps.log(logLine({ outcome: "internal_error" }));
      return hookError(500, SEND_FAILED_MESSAGE);
    }
  };
}
