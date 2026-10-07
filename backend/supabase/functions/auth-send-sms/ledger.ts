import { bytesToHex, hmacSha256 } from "./encoding.ts";

// auth-send-sms/ledger.ts — the hook's side of the dispatch ledger
// (migrations 20261001000000_h5_auth_sms_dispatch.sql and
// 20261004000000_h5_sms_dispatch_claim_owner.sql).
//
// The ledger is claimed BEFORE REVE is called and settled after. If the claim
// cannot be made — the database is down, slow, or answers nonsense — nothing is
// sent: the cap and the duplicate checks only mean something if they run.
//
// Every call is bounded: the caller says how long it may wait, and a call still
// running then is aborted and reported as a timeout. A claim given up on that
// way may still have committed — which is why every claim names an owner, and
// why asking again under the same owner is safe.

export type DispatchStatus = "pending" | "accepted" | "rejected" | "ambiguous";

export type ClaimDecision =
  /**
   * This invocation holds the claim: call the provider, once. `resumed` when
   * an earlier ask under the same owner made the claim and its reply was lost.
   */
  | { decision: "send"; resumed: boolean }
  | { decision: "capped" }
  | { decision: "duplicate"; status: DispatchStatus }
  /** The last day holds rows under a hash key this caller lacks: no send. */
  | { decision: "unknown_key" };

export interface DispatchKeys {
  /** Which hash key made the two keys below — a fingerprint, not the key. */
  keyId: string;
  phoneKey: string;
  contentKey: string;
}

/** One claim: the request, and the invocation that holds it. */
export interface ClaimHandle {
  webhookId: string;
  /**
   * A random value one invocation makes for itself and holds only in memory.
   * Asked again with it, the ledger resumes that invocation's own claim and
   * never anybody else's; only it can settle the claim.
   */
  owner: string;
}

export interface ClaimInput extends ClaimHandle {
  /** Under SMS_DISPATCH_HASH_KEY: read, and written. */
  keys: DispatchKeys;
  /** Under SMS_DISPATCH_HASH_KEY_PREVIOUS during a rotation: read only. */
  previousKeys: DispatchKeys | null;
  dailyCap: number;
}

export interface DispatchOutcome {
  status: "accepted" | "rejected" | "ambiguous";
  reason: string | null;
  providerStatus: string | null;
  providerMessageId: string | null;
}

export interface DispatchLedger {
  /** Waits at most `timeoutMs`. A claim given up on may still have committed. */
  claim(input: ClaimInput, timeoutMs: number): Promise<ClaimDecision>;
  /**
   * True when this owner's pending claim was settled; false when there was
   * none to settle. Waits at most `timeoutMs`.
   */
  record(claim: ClaimHandle, outcome: DispatchOutcome, timeoutMs: number): Promise<boolean>;
}

/** What a call carries in place of a SQLSTATE when this side stopped waiting. */
export const LEDGER_TIMEOUT = "timeout";

/**
 * The ledger could not answer. Carries a SQLSTATE or LEDGER_TIMEOUT at most —
 * never row data.
 */
export class LedgerUnavailableError extends Error {
  constructor(
    public readonly step: "claim" | "record",
    public readonly code: string | null,
  ) {
    super(`dispatch ledger ${step} failed`);
    this.name = "LedgerUnavailableError";
  }
}

/** Hex characters of a key id: 64 bits, enough to tell a handful of keys apart. */
const KEY_ID_LENGTH = 16;

/**
 * The ledger's two keys. HMAC-SHA256 under SMS_DISPATCH_HASH_KEY, so the
 * database never holds a phone number or a code — only values it cannot
 * reverse without a key it never sees. The prefixes keep the three spaces —
 * key id, number, code — apart. The key id is the same HMAC over a fixed
 * label, so it names the key without revealing it.
 */
export async function dispatchKeys(
  hashKey: BufferSource,
  canonicalPhone: string,
  otp: string,
): Promise<DispatchKeys> {
  const [keyId, phone, content] = await Promise.all([
    hmacSha256(hashKey, "key-id|h5-sms-dispatch"),
    hmacSha256(hashKey, `phone|${canonicalPhone}`),
    hmacSha256(hashKey, `otp|${canonicalPhone}|${otp}`),
  ]);
  return {
    keyId: bytesToHex(keyId).slice(0, KEY_ID_LENGTH),
    phoneKey: bytesToHex(phone),
    contentKey: bytesToHex(content),
  };
}

const STATUSES: ReadonlySet<string> = new Set(["pending", "accepted", "rejected", "ambiguous"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The claim function's reply, or null when it is anything else. */
export function parseClaimDecision(data: unknown): ClaimDecision | null {
  if (!isRecord(data)) return null;
  if (data.decision === "send" && typeof data.resumed === "boolean") {
    return { decision: "send", resumed: data.resumed };
  }
  if (data.decision === "capped") return { decision: "capped" };
  if (data.decision === "unknown_key") return { decision: "unknown_key" };
  if (data.decision === "duplicate" && typeof data.status === "string" && STATUSES.has(data.status)) {
    return { decision: "duplicate", status: data.status as DispatchStatus };
  }
  return null;
}

export interface RpcResult {
  data: unknown;
  error: { code?: string | null } | null;
}

/** PostgREST's RPC. `signal` aborts the request once the caller stops waiting. */
export type RpcCaller = (
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => PromiseLike<RpcResult>;

function sqlState(error: { code?: string | null }): string | null {
  return typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : null;
}

/**
 * One RPC, given up on after `timeoutMs`: aborted, and reported as a timeout.
 * A thrown transport failure is reported with no detail at all — its message
 * could quote the request.
 */
async function bounded(
  rpc: RpcCaller,
  step: "claim" | "record",
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<RpcResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LedgerUnavailableError(step, LEDGER_TIMEOUT));
    }, timeoutMs);
  });
  try {
    return await Promise.race([rpc(name, args, controller.signal), expired]);
  } catch (error) {
    throw error instanceof LedgerUnavailableError ? error : new LedgerUnavailableError(step, null);
  } finally {
    clearTimeout(timer);
  }
}

export function rpcDispatchLedger(rpc: RpcCaller): DispatchLedger {
  return {
    async claim(input, timeoutMs) {
      const { data, error } = await bounded(rpc, "claim", "h5_claim_sms_dispatch", {
        p_webhook_id: input.webhookId,
        p_claim_owner: input.owner,
        p_key_id: input.keys.keyId,
        p_phone_key: input.keys.phoneKey,
        p_content_key: input.keys.contentKey,
        p_previous_key_id: input.previousKeys?.keyId ?? null,
        p_previous_phone_key: input.previousKeys?.phoneKey ?? null,
        p_previous_content_key: input.previousKeys?.contentKey ?? null,
        p_daily_cap: input.dailyCap,
      }, timeoutMs);
      if (error) throw new LedgerUnavailableError("claim", sqlState(error));
      const decision = parseClaimDecision(data);
      if (!decision) throw new LedgerUnavailableError("claim", null);
      return decision;
    },
    async record(claim, outcome, timeoutMs) {
      const { data, error } = await bounded(rpc, "record", "h5_record_sms_dispatch", {
        p_webhook_id: claim.webhookId,
        p_claim_owner: claim.owner,
        p_status: outcome.status,
        p_reason: outcome.reason,
        p_provider_status: outcome.providerStatus,
        p_provider_message_id: outcome.providerMessageId,
      }, timeoutMs);
      if (error) throw new LedgerUnavailableError("record", sqlState(error));
      return data === true;
    },
  };
}
