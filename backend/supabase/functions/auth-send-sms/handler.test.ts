import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSendSmsHandler,
  HOOK_BUDGET_MS,
  RATE_LIMITED_MESSAGE,
  SEND_FAILED_MESSAGE,
  waitBudget,
} from "./handler.ts";
import {
  type ClaimDecision,
  type ClaimHandle,
  type ClaimInput,
  type DispatchLedger,
  type DispatchOutcome,
  type DispatchStatus,
  LEDGER_TIMEOUT,
  LedgerUnavailableError,
  type RpcCaller,
  rpcDispatchLedger,
} from "./ledger.ts";
import type { FetchLike } from "./reve.ts";

// The Send SMS hook end to end, with only its three edges replaced: the
// environment, REVE (fetch) and the dispatch ledger. Requests are signed with
// node:crypto, the way Supabase Auth signs them.

const HOOK_KEY = Buffer.alloc(32, 7);
const NOW_MS = 1_800_000_000_000;
const PHONE = "8801712345678";
const OTP = "654321";
const API_KEY = "test-api-key-123";
const SECRET_KEY = "test-secret-key-456";

/** Captured before any test fakes timers: the waits in `until` must be real. */
const realSetTimeout = globalThis.setTimeout;

const BASE_ENV: Record<string, string> = {
  SEND_SMS_HOOK_SECRET: `v1,whsec_${HOOK_KEY.toString("base64")}`,
  SMS_DISPATCH_HASH_KEY: Buffer.alloc(32, 9).toString("base64"),
  REVE_API_URL: "https://smpp.revesms.com:7790/sendtext",
  REVE_TRANSPORT: "post_json",
  REVE_API_KEY: API_KEY,
  REVE_SECRET_KEY: SECRET_KEY,
  REVE_SENDER_ID: "8809600000000",
};

/** Everything a log line or a reply must never contain. */
const NEVER_EXPOSED = [PHONE, "1712345678", OTP, API_KEY, SECRET_KEY, "revesms", "Muthoy code"];

const SENT = { status: 200, body: {} };

function hookBody(sms: Record<string, unknown> = { otp: OTP, phone: PHONE }): string {
  return JSON.stringify({ user: { id: "user-1", phone: PHONE }, sms });
}

let webhookCounter = 0;

function signedRequest(
  body: string,
  options: { id?: string; timestamp?: number; key?: Buffer; signedBody?: string } = {},
): Request {
  webhookCounter += 1;
  const id = options.id ?? `0c5f4c8e-0000-4000-8000-${String(webhookCounter).padStart(12, "0")}`;
  const timestamp = options.timestamp ?? Math.floor(NOW_MS / 1000);
  const signature = createHmac("sha256", options.key ?? HOOK_KEY)
    .update(`${id}.${timestamp}.${options.signedBody ?? body}`)
    .digest("base64");
  return new Request("https://project.supabase.co/functions/v1/auth-send-sms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${signature}`,
    },
    body,
  });
}

function reveReplying(body: string, status = 200) {
  return vi.fn<FetchLike>(async () => new Response(body, { status }));
}

function reveTimingOut() {
  return vi.fn<FetchLike>(async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
}

function fakeLedger(decision: ClaimDecision | Error = { decision: "send", resumed: false }) {
  const ledger = {
    claim: vi.fn<DispatchLedger["claim"]>(async () => {
      if (decision instanceof Error) throw decision;
      return decision;
    }),
    record: vi.fn<DispatchLedger["record"]>(async () => true),
  };
  return ledger;
}

/**
 * The migration's ownership rules, in memory: one row per webhook id; the
 * owner's own pending row is resumed; anyone else, or a settled row, gets the
 * duplicate answer; the same code is a duplicate too; only the owner settles.
 */
function ownerLedger() {
  const rows = new Map<string, { owner: string; contentKey: string; status: DispatchStatus }>();
  async function claim(input: ClaimInput): Promise<ClaimDecision> {
    const own = rows.get(input.webhookId);
    if (own) {
      return own.owner === input.owner && own.status === "pending"
        ? { decision: "send", resumed: true }
        : { decision: "duplicate", status: own.status };
    }
    const sameCode = [...rows.values()].find((row) => row.contentKey === input.keys.contentKey);
    if (sameCode) return { decision: "duplicate", status: sameCode.status };
    rows.set(input.webhookId, { owner: input.owner, contentKey: input.keys.contentKey, status: "pending" });
    return { decision: "send", resumed: false };
  }
  async function record(handle: ClaimHandle, outcome: DispatchOutcome): Promise<boolean> {
    const row = rows.get(handle.webhookId);
    if (!row || row.owner !== handle.owner || row.status !== "pending") return false;
    rows.set(handle.webhookId, { ...row, status: outcome.status });
    return true;
  }
  return { rows, claim, record };
}

/**
 * The model ledger behind the hook's real RPC adapter, so the adapter's own
 * wait is what is tested. `replyDelaysMs` delays each reply in turn — AFTER
 * the claim or record has taken effect, as a slow reply would.
 */
function modelRpc(model: ReturnType<typeof ownerLedger>, replyDelaysMs: number[] = []) {
  const signals: AbortSignal[] = [];
  const rpc = vi.fn<RpcCaller>(async (name, args, signal) => {
    signals.push(signal);
    const handle = { webhookId: String(args.p_webhook_id), owner: String(args.p_claim_owner) };
    const data = name === "h5_claim_sms_dispatch"
      ? await model.claim({
        ...handle,
        keys: {
          keyId: String(args.p_key_id),
          phoneKey: String(args.p_phone_key),
          contentKey: String(args.p_content_key),
        },
        previousKeys: null,
        dailyCap: Number(args.p_daily_cap),
      })
      : await model.record(handle, {
        status: args.p_status as DispatchOutcome["status"],
        reason: null,
        providerStatus: null,
        providerMessageId: null,
      });
    const delayMs = replyDelaysMs.shift() ?? 0;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { data, error: null };
  });
  return { rpc, signals };
}

/** Waits in REAL time — while timers may be faked — until `check` holds. */
async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => realSetTimeout(resolve, 2));
  }
}

let logs: string[];

function handler(options: {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  ledger?: DispatchLedger;
  nowMs?: () => number;
} = {}) {
  const env: Record<string, string | undefined> = { ...BASE_ENV, ...options.env };
  return createSendSmsHandler({
    read: (name) => env[name],
    fetch: options.fetch ?? reveReplying('{"Status":"0","Text":"ACCEPTD","Message_ID":"444"}'),
    ledger: options.ledger ?? fakeLedger(),
    nowMs: options.nowMs ?? (() => NOW_MS),
    log: (line) => logs.push(line),
  });
}

async function hookReply(response: Response): Promise<{ status: number; body: unknown }> {
  return { status: response.status, body: await response.json() };
}

function decidedError(httpCode: number, message = SEND_FAILED_MESSAGE) {
  return { status: 200, body: { error: { http_code: httpCode, message } } };
}

beforeEach(() => {
  logs = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a signed request, end to end", () => {
  it("claims first, sends the locked text to 8801… exactly once, then records the outcome", async () => {
    const fetch = reveReplying('{"Status":"0","Text":"ACCEPTD","Message_ID":"444"}');
    const ledger = fakeLedger();
    const response = await handler({ fetch, ledger })(signedRequest(hookBody()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({});

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    // POSTed to the approved endpoint itself: nothing secret in the URL.
    expect(url).toBe("https://smpp.revesms.com:7790/sendtext");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      redirect: "manual",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      apikey: API_KEY,
      secretkey: SECRET_KEY,
      callerID: "8809600000000",
      toUser: PHONE,
      messageContent: `Muthoy code: ${OTP}. Valid 5 minutes. Never share this code.`,
    });

    expect(ledger.claim).toHaveBeenCalledWith({
      webhookId: expect.stringMatching(/^0c5f4c8e-/),
      owner: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      keys: {
        keyId: expect.stringMatching(/^[0-9a-f]{16}$/),
        phoneKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        contentKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      previousKeys: null,
      dailyCap: 10,
    }, 2_000);
    const [claimed] = ledger.claim.mock.calls[0]!;
    // Settled by the same owner that claimed — and by nobody else.
    expect(ledger.record).toHaveBeenCalledWith(
      expect.objectContaining({ webhookId: claimed.webhookId, owner: claimed.owner }),
      {
        status: "accepted",
        reason: null,
        providerStatus: "0",
        providerMessageId: "444",
      } satisfies DispatchOutcome,
      500,
    );
    // Claim → provider → record, in that order and no other.
    expect(ledger.claim.mock.invocationCallOrder[0]!).toBeLessThan(fetch.mock.invocationCallOrder[0]!);
    expect(fetch.mock.invocationCallOrder[0]!).toBeLessThan(ledger.record.mock.invocationCallOrder[0]!);
    expect(logs).toEqual([]);
  });

  it("never stores the number: the ledger keys are not the number in any form", async () => {
    const ledger = fakeLedger();
    await handler({ ledger })(signedRequest(hookBody()));
    const claimed = JSON.stringify(ledger.claim.mock.calls[0]![0]);
    for (const value of [PHONE, "1712345678", OTP]) expect(claimed).not.toContain(value);
  });

  it("claims under a fresh owner every time, even for the same request", async () => {
    const ledger = fakeLedger();
    const send = handler({ ledger });
    const request = signedRequest(hookBody());
    await send(request.clone());
    await send(request);
    const [first, second] = ledger.claim.mock.calls.map(([input]) => input);
    expect(first!.webhookId).toBe(second!.webhookId);
    expect(first!.owner).not.toBe(second!.owner);
  });
});

describe("nothing runs before the signature", () => {
  it.each([
    ["no signature at all", () => {
      const request = signedRequest(hookBody());
      const headers = new Headers(request.headers);
      headers.delete("webhook-signature");
      return new Request(request.url, { method: "POST", headers, body: hookBody() });
    }],
    ["a signature made with another secret", () => signedRequest(hookBody(), { key: Buffer.alloc(32, 1) })],
    ["a body changed after signing", () => signedRequest(
      hookBody({ otp: OTP, phone: "8801812345678" }),
      { signedBody: hookBody() },
    )],
    ["a replay outside the five-minute window", () =>
      signedRequest(hookBody(), { timestamp: Math.floor(NOW_MS / 1000) - 301 })],
  ])("refuses %s with 401 and touches neither the ledger nor REVE", async (_label, build) => {
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger();
    const response = await handler({ fetch, ledger })(build());
    expect(response.status).toBe(401);
    expect(ledger.claim).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(logs).toEqual([expect.stringContaining("outcome=unauthorized")]);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "v1,whsec_"],
    // Each of these holds the very key the request is signed with: the refusal
    // is the secret's shape, never a signature that happened not to match.
    ["bare base64", HOOK_KEY.toString("base64")],
    ["padded with whitespace", ` v1,whsec_${HOOK_KEY.toString("base64")} `],
    ["URL-safe base64", `v1,whsec_${HOOK_KEY.toString("base64url")}`],
  ])("fails closed when the hook secret is %s", async (_label, secret) => {
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger();
    const response = await handler({ env: { SEND_SMS_HOOK_SECRET: secret }, fetch, ledger })(
      signedRequest(hookBody()),
    );
    expect(response.status).toBe(500);
    expect(ledger.claim).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(logs).toEqual([expect.stringMatching(/outcome=config_invalid reason=hook_secret_(missing|invalid)/)]);
  });

  it.each([23, 65])("fails closed on a %i-byte hook key, outside Standard Webhooks' 24-64", async (bytes) => {
    const key = Buffer.alloc(bytes, 7);
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger();
    const response = await handler({
      env: { SEND_SMS_HOOK_SECRET: `v1,whsec_${key.toString("base64")}` },
      fetch,
      ledger,
    })(signedRequest(hookBody(), { key }));
    expect(response.status).toBe(500);
    expect(ledger.claim).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses anything but POST, and an oversized body", async () => {
    const get = await handler()(new Request("https://project.supabase.co/functions/v1/auth-send-sms"));
    expect(get.status).toBe(405);

    const huge = await handler()(signedRequest(JSON.stringify({ padding: "x".repeat(70 * 1024) })));
    expect(huge.status).toBe(413);
  });
});

describe("refused before the ledger is claimed", () => {
  it.each([
    ["a foreign number", hookBody({ otp: OTP, phone: "+911712345678" }), "phone_unsupported"],
    // hookBody always carries a valid user.phone: it must rescue neither.
    ["an empty sms.phone", hookBody({ otp: OTP, phone: "" }), "phone_unsupported"],
    ["a non-string sms.phone", hookBody({ otp: OTP, phone: Number(PHONE) }), "phone_unsupported"],
    ["an sms.phone with junk before the number", hookBody({ otp: OTP, phone: `abc${PHONE}` }), "phone_unsupported"],
    ["an sms.phone with a leading +", hookBody({ otp: OTP, phone: `+${PHONE}` }), "phone_unsupported"],
    ["a code that is not six digits", hookBody({ otp: "12345", phone: PHONE }), "otp_invalid"],
    ["a body that is not GoTrue's", JSON.stringify({ hello: "world" }), "payload_invalid"],
  ])("refuses %s with 400", async (_label, body, reason) => {
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger();
    expect(await hookReply(await handler({ fetch, ledger })(signedRequest(body)))).toEqual(decidedError(400));
    expect(ledger.claim).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(logs).toEqual([expect.stringContaining(`reason=${reason}`)]);
  });

  it.each([
    ["without the REVE API key", { REVE_API_KEY: undefined }, "reve_config_missing"],
    ["with REVE's plain-HTTP port", { REVE_API_URL: "http://smpp.revesms.com:7788/sendtext" }, "reve_endpoint_unapproved"],
    ["with REVE's raw IP endpoint", { REVE_API_URL: "http://103.177.125.106:7788/sendtext" }, "reve_endpoint_unapproved"],
    ["with an unconfirmed transport", { REVE_TRANSPORT: "post_form" }, "reve_transport_unsupported"],
    ["with the inactive GET transport", { REVE_TRANSPORT: "get_query" }, "reve_transport_unsupported"],
    ["without a Sender ID", { REVE_SENDER_ID: undefined }, "reve_config_missing"],
    ["without the dispatch hash key", { SMS_DISPATCH_HASH_KEY: undefined }, "dispatch_hash_key_invalid"],
    ["with an unreadable previous hash key", { SMS_DISPATCH_HASH_KEY_PREVIOUS: "not base64!" }, "dispatch_previous_hash_key_invalid"],
    ["with a previous hash key equal to the current one", { SMS_DISPATCH_HASH_KEY_PREVIOUS: BASE_ENV.SMS_DISPATCH_HASH_KEY }, "dispatch_previous_hash_key_invalid"],
    ["with a cap above the locked ten", { OTP_SMS_DAILY_CAP_PER_PHONE: "11" }, "daily_cap_invalid"],
  ])("fails closed %s — no claim, no SMS", async (_label, env, problem) => {
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger();
    expect(await hookReply(await handler({ env, fetch, ledger })(signedRequest(hookBody()))))
      .toEqual(decidedError(500));
    expect(ledger.claim).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(logs).toEqual([expect.stringContaining(`reason=${problem}`)]);
  });

  it("passes a lowered DEV cap to the ledger", async () => {
    const ledger = fakeLedger();
    await handler({ env: { OTP_SMS_DAILY_CAP_PER_PHONE: "2" }, ledger })(signedRequest(hookBody()));
    expect(ledger.claim).toHaveBeenCalledWith(expect.objectContaining({ dailyCap: 2 }), 2_000);
  });

  it("during a hash-key rotation, claims under both keys: the same number, two key sets", async () => {
    const previous = Buffer.alloc(32, 4);
    const ledger = fakeLedger();
    await handler({ env: { SMS_DISPATCH_HASH_KEY_PREVIOUS: previous.toString("base64") }, ledger })(
      signedRequest(hookBody()),
    );
    const input = ledger.claim.mock.calls[0]![0];
    const keyed = (key: Buffer, message: string) => createHmac("sha256", key).update(message).digest("hex");
    expect(input.previousKeys).toEqual({
      keyId: keyed(previous, "key-id|h5-sms-dispatch").slice(0, 16),
      phoneKey: keyed(previous, "phone|+8801712345678"),
      contentKey: keyed(previous, `otp|+8801712345678|${OTP}`),
    });
    expect(input.previousKeys!.keyId).not.toBe(input.keys.keyId);
    expect(input.previousKeys!.phoneKey).not.toBe(input.keys.phoneKey);
  });
});

describe("what the ledger decides", () => {
  it("answers a capped number with 429, the one status the app shows as a rate limit", async () => {
    const fetch = reveReplying('{"Status":"0"}');
    expect(await hookReply(await handler({ fetch, ledger: fakeLedger({ decision: "capped" }) })(
      signedRequest(hookBody()),
    ))).toEqual(decidedError(429, RATE_LIMITED_MESSAGE));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["accepted", SENT],
    // Its code is the one that stands: a failure here could mint a second.
    ["ambiguous", SENT],
    ["rejected", decidedError(500)],
    // Another invocation's claim, whose REVE call may already have happened.
    ["pending", SENT],
  ] as const)("replays a %s duplicate without calling REVE", async (status, expected) => {
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger({ decision: "duplicate", status });
    expect(await hookReply(await handler({ fetch, ledger })(signedRequest(hookBody())))).toEqual(expected);
    expect(fetch).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it("sends nothing while the ledger holds rows under a hash key this instance lacks", async () => {
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger({ decision: "unknown_key" });
    expect(await hookReply(await handler({ fetch, ledger })(signedRequest(hookBody()))))
      .toEqual(decidedError(503));
    expect(fetch).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
    expect(logs).toEqual([expect.stringContaining("outcome=ledger_key_unknown")]);
  });

  it("answers a GoTrue retry — new webhook id, same code — from the ledger, with no second SMS", async () => {
    const model = ownerLedger();
    const fetch = reveReplying('{"Status":"0","Message_ID":"901"}');
    const send = handler({ fetch, ledger: model });

    expect(await hookReply(await send(signedRequest(hookBody())))).toEqual(SENT);
    expect(await hookReply(await send(signedRequest(hookBody())))).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("a replay that finds the claim still pending under another invocation", () => {
  /** The model behind spies; with `recordLost`, every record fails before it reaches the ledger. */
  function spiedLedger(model: ReturnType<typeof ownerLedger>, { recordLost = false } = {}) {
    return {
      claim: vi.fn<DispatchLedger["claim"]>(model.claim),
      record: vi.fn<DispatchLedger["record"]>(async (claim, outcome) => {
        if (recordLost) throw new LedgerUnavailableError("record", LEDGER_TIMEOUT);
        return model.record(claim, outcome);
      }),
    };
  }

  it.each([
    ["a GoTrue retry of the code", () => signedRequest(hookBody())],
    ["an exact replay of the request", (id: string) => signedRequest(hookBody(), { id })],
  ])("REVE was called but its outcome was never recorded: %s answers success and sends nothing", async (
    _label,
    again,
  ) => {
    const model = ownerLedger();
    const fetch = reveReplying('{"Status":"0","Message_ID":"706"}');
    const ledger = spiedLedger(model, { recordLost: true });
    const send = handler({ fetch, ledger });
    const original = signedRequest(hookBody());

    expect(await hookReply(await send(original))).toEqual(SENT);
    expect(await hookReply(await send(again(original.headers.get("webhook-id")!)))).toEqual(SENT);

    // One SMS: the replay neither called REVE nor took the claim over.
    expect(fetch).toHaveBeenCalledOnce();
    const [owner, replay] = ledger.claim.mock.calls.map(([input]) => input.owner);
    expect(replay).not.toBe(owner);
    expect(ledger.record).toHaveBeenCalledOnce();
    expect(ledger.record.mock.calls[0]![0].owner).toBe(owner);
    // Still pending, still the owner's — never turned into `accepted`.
    expect([...model.rows.values()]).toEqual([expect.objectContaining({ owner, status: "pending" })]);
    expect(logs).toEqual([
      expect.stringContaining("outcome=ledger_unavailable step=record db=timeout"),
      expect.stringContaining("outcome=duplicate status=pending"),
    ]);
  });

  it("a retry landing while the owner's REVE call is in flight answers success — and the owner still settles, alone", async () => {
    const model = ownerLedger();
    const ledger = spiedLedger(model);
    let raced: unknown = null;
    let reveCalls = 0;
    let send: (request: Request) => Promise<Response> = async () => new Response();
    const fetch = vi.fn<FetchLike>(async () => {
      reveCalls += 1;
      // REVE has the request; before its answer is back, GoTrue retries the code.
      if (reveCalls === 1) raced = await hookReply(await send(signedRequest(hookBody())));
      return new Response('{"Status":"0","Message_ID":"707"}');
    });
    send = handler({ fetch, ledger });

    expect(await hookReply(await send(signedRequest(hookBody())))).toEqual(SENT);
    expect(raced).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
    const [owner, retry] = ledger.claim.mock.calls.map(([input]) => input.owner);
    expect(retry).not.toBe(owner);
    expect(ledger.record).toHaveBeenCalledOnce();
    expect(ledger.record.mock.calls[0]![0].owner).toBe(owner);
    expect([...model.rows.values()]).toEqual([expect.objectContaining({ owner, status: "accepted" })]);
  });
});

describe("the claim: waited out, and asked again under the same owner", () => {
  /** Fakes only the clock the hook waits on; crypto and I/O stay real. */
  function fakeClock() {
    vi.useFakeTimers({ now: NOW_MS, toFake: ["setTimeout", "clearTimeout", "Date"] });
  }

  it("waits out a cold claim that answers in 1.2 s — past the old 750 ms — and sends once", async () => {
    fakeClock();
    const model = ownerLedger();
    const { rpc, signals } = modelRpc(model, [1_200]);
    const fetch = reveReplying('{"Status":"0","Message_ID":"702"}');
    const pending = handler({ fetch, ledger: rpcDispatchLedger(rpc), nowMs: () => Date.now() })(
      signedRequest(hookBody()),
    );
    await until(() => rpc.mock.calls.length === 1, "the claim to be in flight");
    await vi.advanceTimersByTimeAsync(1_200);

    expect(await hookReply(await pending)).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
    expect(signals[0]!.aborted).toBe(false);
    expect([...model.rows.values()]).toEqual([expect.objectContaining({ status: "accepted" })]);
    expect(logs).toEqual([]);
  });

  it("asks again under the same owner when 2 s pass first — the claim had committed, so it is resumed: one SMS", async () => {
    fakeClock();
    const model = ownerLedger();
    // The claim takes effect at once; its reply would land after 5 s.
    const { rpc, signals } = modelRpc(model, [5_000]);
    const fetch = reveReplying('{"Status":"0","Message_ID":"703"}');
    const pending = handler({ fetch, ledger: rpcDispatchLedger(rpc), nowMs: () => Date.now() })(
      signedRequest(hookBody()),
    );
    await until(() => rpc.mock.calls.length === 1, "the claim to be in flight");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await hookReply(await pending)).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
    // The first ask was abandoned AND aborted; the second asked as the same owner.
    expect(signals[0]!.aborted).toBe(true);
    const claims = rpc.mock.calls.filter(([name]) => name === "h5_claim_sms_dispatch");
    expect(claims).toHaveLength(2);
    expect(claims[1]![1].p_claim_owner).toBe(claims[0]![1].p_claim_owner);
    expect([...model.rows.values()]).toEqual([
      expect.objectContaining({ owner: claims[0]![1].p_claim_owner, status: "accepted" }),
    ]);
    expect(logs).toEqual([
      expect.stringContaining("outcome=ledger_unavailable step=claim attempt=1 db=timeout"),
      expect.stringContaining("outcome=claim_reconciled resumed=yes"),
    ]);
  });

  /** The model, with the reply to its FIRST claim lost after that claim took effect. */
  function firstReplyLost(model: ReturnType<typeof ownerLedger>, meanwhile: () => Promise<void>) {
    let lost = false;
    return {
      claim: vi.fn<DispatchLedger["claim"]>(async (input) => {
        const decision = await model.claim(input);
        if (lost) return decision;
        lost = true;
        await meanwhile();
        throw new LedgerUnavailableError("claim", LEDGER_TIMEOUT);
      }),
      record: vi.fn<DispatchLedger["record"]>(model.record),
    };
  }

  it.each([
    ["an exact replay of the request", (id: string) => signedRequest(hookBody(), { id })],
    ["a GoTrue retry of the code", () => signedRequest(hookBody())],
  ])("while that reply is lost, %s cannot send — and the owner still sends, once", async (_label, again) => {
    const model = ownerLedger();
    const fetch = reveReplying('{"Status":"0","Message_ID":"704"}');
    const original = signedRequest(hookBody());
    let raced: unknown = null;
    let meanwhile = async () => undefined;
    const ledger = firstReplyLost(model, () => meanwhile());
    const send = handler({ fetch, ledger });
    meanwhile = async () => {
      raced = await hookReply(await send(again(original.headers.get("webhook-id")!)));
    };

    expect(await hookReply(await send(original))).toEqual(SENT);
    // Someone else's claim, still in flight: success, and no SMS from the racer.
    expect(raced).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
    const owners = ledger.claim.mock.calls.map(([input]) => input.owner);
    expect(owners).toHaveLength(3);
    expect(owners[2]).toBe(owners[0]);
    expect(owners[1]).not.toBe(owners[0]);
    expect([...model.rows.values()]).toEqual([
      expect.objectContaining({ owner: owners[0], status: "accepted" }),
    ]);
  });

  it("makes the claim on the second ask when the first never reached the database", async () => {
    const model = ownerLedger();
    const fetch = reveReplying('{"Status":"0","Message_ID":"705"}');
    const ledger = {
      claim: vi.fn<DispatchLedger["claim"]>(model.claim)
        .mockRejectedValueOnce(new LedgerUnavailableError("claim", null)),
      record: vi.fn<DispatchLedger["record"]>(model.record),
    };
    expect(await hookReply(await handler({ fetch, ledger })(signedRequest(hookBody())))).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
    expect(ledger.claim.mock.calls[1]![0].owner).toBe(ledger.claim.mock.calls[0]![0].owner);
    expect(logs).toEqual([
      expect.stringContaining("outcome=ledger_unavailable step=claim attempt=1 db=none"),
      expect.stringContaining("outcome=claim_reconciled resumed=no"),
    ]);
  });

  it("sends nothing when both asks fail — and never asks a third time", async () => {
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger(new LedgerUnavailableError("claim", "57014"));
    expect(await hookReply(await handler({ fetch, ledger })(signedRequest(hookBody()))))
      .toEqual(decidedError(503));
    expect(fetch).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
    expect(ledger.claim).toHaveBeenCalledTimes(2);
    expect(ledger.claim.mock.calls[1]![0].owner).toBe(ledger.claim.mock.calls[0]![0].owner);
    expect(logs).toEqual([
      expect.stringContaining("outcome=ledger_unavailable step=claim attempt=1 db=57014"),
      expect.stringContaining("outcome=ledger_unavailable step=claim attempt=2 db=57014"),
    ]);
  });

  it("gives the first ask 2 s and the second only what still leaves REVE and the record theirs", async () => {
    let now = NOW_MS;
    const ledger = fakeLedger();
    ledger.claim
      .mockImplementationOnce(async (_input, timeoutMs) => {
        now += timeoutMs;
        throw new LedgerUnavailableError("claim", LEDGER_TIMEOUT);
      })
      .mockImplementationOnce(async () => ({ decision: "send", resumed: true }));
    expect(await hookReply(await handler({ ledger, nowMs: () => now })(signedRequest(hookBody()))))
      .toEqual(SENT);
    expect(ledger.claim.mock.calls.map(([, timeoutMs]) => timeoutMs)).toEqual([2_000, 500]);
  });

  it("does not ask again when that would leave REVE too little — and sends nothing", async () => {
    let now = NOW_MS;
    const fetch = reveReplying('{"Status":"0"}');
    const ledger = fakeLedger();
    ledger.claim.mockImplementationOnce(async () => {
      now += 2_600;
      throw new LedgerUnavailableError("claim", LEDGER_TIMEOUT);
    });
    expect(await hookReply(await handler({ fetch, ledger, nowMs: () => now })(signedRequest(hookBody()))))
      .toEqual(decidedError(503));
    expect(ledger.claim).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(logs).toEqual([
      expect.stringContaining("outcome=ledger_unavailable step=claim attempt=1 db=timeout"),
      expect.stringContaining("outcome=claim_abandoned reason=budget_spent"),
    ]);
  });
});

describe("the time budget", () => {
  it.each([
    [0, 2_000, 3_000],
    [300, 2_000, 2_700],
    [2_000, 500, 1_000],
    [2_500, 0, 500],
    [3_400, 0, 500],
    [9_000, 0, 500],
  ])("%i ms in: a claim may still wait %i ms, REVE %i ms", (elapsed, claimMs, providerMs) => {
    const budget = waitBudget(NOW_MS, () => NOW_MS + elapsed);
    expect(budget.claimMs()).toBe(claimMs);
    expect(budget.providerMs()).toBe(providerMs);
  });

  it.each([
    ["an instant claim leaves REVE its full 3 s", 0, 3_000],
    ["a warm 300 ms claim leaves REVE 2.7 s", 300, 2_700],
    ["a slow claim leaves REVE only what is left", 2_400, 600],
    ["a claim that used nearly everything still leaves REVE half a second", 3_400, 500],
  ])("%s", async (_label, claimTookMs, providerMs) => {
    let now = NOW_MS;
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const ledger = fakeLedger();
    ledger.claim.mockImplementationOnce(async () => {
      now += claimTookMs;
      return { decision: "send", resumed: false };
    });
    await handler({ ledger, nowMs: () => now })(signedRequest(hookBody()));
    expect(timeouts).toHaveBeenCalledOnce();
    expect(timeouts).toHaveBeenCalledWith(providerMs);
  });

  it("adds up, at worst, to its 3.5 s — every wait used in full — leaving 1.5 s of GoTrue's 5 s for a cold start", async () => {
    let now = NOW_MS;
    const providerWaits: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      providerWaits.push(ms);
      return new AbortController().signal;
    });
    const ledger = fakeLedger();
    ledger.claim
      .mockImplementationOnce(async (_input, timeoutMs) => {
        now += timeoutMs;
        throw new LedgerUnavailableError("claim", LEDGER_TIMEOUT);
      })
      .mockImplementationOnce(async (_input, timeoutMs) => {
        now += timeoutMs;
        return { decision: "send", resumed: true };
      });
    ledger.record.mockImplementationOnce(async (_claim, _outcome, timeoutMs) => {
      now += timeoutMs;
      throw new LedgerUnavailableError("record", LEDGER_TIMEOUT);
    });
    const fetch = vi.fn<FetchLike>(async () => {
      now += providerWaits.at(-1)!;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    expect(await hookReply(await handler({ fetch, ledger, nowMs: () => now })(signedRequest(hookBody()))))
      .toEqual(SENT);
    expect(now - NOW_MS).toBe(HOOK_BUDGET_MS);
    expect(HOOK_BUDGET_MS).toBe(3_500);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("after REVE has been called, its code stands", () => {
  it.each([
    ["a timeout", reveTimingOut(), "provider_timeout", null],
    ["a network failure", vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    }), "provider_network_error", null],
    ["Status 101", reveReplying('{"Status":"101","Text":"X"}'), "provider_internal_error", "101"],
    ["an unreadable reply", reveReplying("<html>ok</html>"), "provider_unreadable_response", null],
    ["a status nobody confirmed", reveReplying('{"Status":"-42"}'), "provider_unknown_status", "-42"],
  ])("%s answers GoTrue SUCCESS, is recorded ambiguous, and REVE is never called again", async (
    _label,
    fetch,
    reason,
    providerStatus,
  ) => {
    const ledger = fakeLedger();
    expect(await hookReply(await handler({ fetch, ledger })(signedRequest(hookBody())))).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
    expect(ledger.record).toHaveBeenCalledWith(expect.anything(), {
      status: "ambiguous",
      reason,
      providerStatus,
      providerMessageId: null,
    }, 500);
    expect(logs).toEqual([expect.stringContaining(`outcome=ambiguous reason=${reason}`)]);
  });

  it("answers a GoTrue retry of an ambiguous send from the ledger: success, and still one REVE call", async () => {
    const model = ownerLedger();
    const fetch = reveTimingOut();
    const send = handler({ fetch, ledger: model });

    expect(await hookReply(await send(signedRequest(hookBody())))).toEqual(SENT);
    expect(await hookReply(await send(signedRequest(hookBody())))).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
    expect([...model.rows.values()]).toEqual([expect.objectContaining({ status: "ambiguous" })]);
  });

  it("still fails a definite rejection — REVE sent nothing — and never calls twice", async () => {
    const fetch = reveReplying('{"Status":"109","Text":"Invalid api key"}');
    const ledger = fakeLedger();
    expect(await hookReply(await handler({ fetch, ledger })(signedRequest(hookBody()))))
      .toEqual(decidedError(500));
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("REVE's confirmed statuses, as the app and the ledger see them", () => {
  it.each([
    ["0", null, "accepted", null],
    ["1", 500, "rejected", "provider_rejected"],
    ["101", null, "ambiguous", "provider_internal_error"],
    ["108", 500, "rejected", "credentials_invalid"],
    ["109", 500, "rejected", "credentials_invalid"],
    ["114", 500, "rejected", "request_invalid"],
    ["136", 500, "rejected", "profile_blocked"],
    ["137", 503, "rejected", "tps_exceeded"],
    ["151", 500, "rejected", "traffic_type_invalid"],
    ["170", 500, "rejected", "content_type_invalid"],
    ["5400", 500, "rejected", "ip_restricted"],
    ["-42", null, "ambiguous", "provider_unknown_status"],
  ] as const)("Status %s → app %s, ledger %s (%s), one call", async (status, httpCode, ledgerStatus, reason) => {
    const fetch = reveReplying(`{"Status":"${status}","Text":"X"}`);
    const ledger = fakeLedger();
    const reply = await hookReply(await handler({ fetch, ledger })(signedRequest(hookBody())));

    expect(reply).toEqual(httpCode === null ? SENT : decidedError(httpCode));
    expect(fetch).toHaveBeenCalledOnce();
    expect(ledger.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: ledgerStatus,
      reason,
      providerStatus: status,
    }), 500);
  });

  it.each([
    [500, "provider_http_error"],
    [403, "provider_http_error"],
    [302, "provider_redirected"],
  ] as const)("never records HTTP %i as accepted, even with Status 0 in the body — it is ambiguous", async (
    httpStatus,
    reason,
  ) => {
    const fetch = reveReplying('{"Status":"0","Text":"ACCEPTD","Message_ID":"444"}', httpStatus);
    const ledger = fakeLedger();
    // Ambiguous, so its code stands (above) — but the ledger never calls it sent.
    expect(await hookReply(await handler({ fetch, ledger })(signedRequest(hookBody())))).toEqual(SENT);
    expect(fetch).toHaveBeenCalledOnce();
    expect(ledger.record).toHaveBeenCalledWith(expect.anything(), {
      status: "ambiguous",
      reason,
      providerStatus: null,
      providerMessageId: null,
    }, 500);
    expect(logs).toEqual([expect.stringContaining(`outcome=ambiguous reason=${reason}`)]);
  });

  it("still reports success when REVE accepted but the outcome could not be recorded", async () => {
    const ledger = fakeLedger();
    ledger.record.mockRejectedValueOnce(new LedgerUnavailableError("record", "08006"));
    const response = await handler({ ledger })(signedRequest(hookBody()));
    expect(await hookReply(response)).toEqual(SENT);
    expect(logs).toEqual([expect.stringContaining("outcome=ledger_unavailable step=record db=08006")]);
  });
});

describe("what leaves the function", () => {
  it("answers in the shape GoTrue reads: HTTP 200, JSON, an error object, and no retry-after", async () => {
    const response = await handler({ ledger: fakeLedger({ decision: "capped" }) })(signedRequest(hookBody()));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.json()).toEqual({ error: { http_code: 429, message: RATE_LIMITED_MESSAGE } });
  });

  it("never puts the number, the code, the message, a credential, the provider URL or the claim's owner in a log or a reply", async () => {
    const scenarios: { fetch: FetchLike; ledger: ReturnType<typeof fakeLedger> }[] = [
      { fetch: async (url) => { throw new TypeError(`error sending request for url (${url})`); }, ledger: fakeLedger() },
      { fetch: reveReplying('{"Status":"5400","Text":"REJECTD"}'), ledger: fakeLedger() },
      { fetch: reveReplying('{"Status":"101"}'), ledger: fakeLedger() },
      { fetch: reveReplying("<html>gateway error</html>", 502), ledger: fakeLedger() },
      { fetch: reveReplying('{"Status":"0"}'), ledger: fakeLedger(new LedgerUnavailableError("claim", null)) },
      { fetch: reveReplying('{"Status":"0"}'), ledger: fakeLedger({ decision: "capped" }) },
    ];
    const owners: string[] = [];
    for (const scenario of scenarios) {
      const response = await handler(scenario)(signedRequest(hookBody()));
      const text = await response.text();
      owners.push(...scenario.ledger.claim.mock.calls.map(([input]) => input.owner));
      for (const value of [...NEVER_EXPOSED, ...owners]) {
        expect(text, `reply leaked ${value}`).not.toContain(value);
      }
    }
    expect(owners.length).toBeGreaterThanOrEqual(scenarios.length);
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      for (const value of [...NEVER_EXPOSED, ...owners]) {
        expect(line, `log leaked ${value}`).not.toContain(value);
      }
      expect(line).toMatch(/^auth-send-sms: [a-z_]+=[A-Za-z0-9._:-]+( [a-z_]+=[A-Za-z0-9._:-]+)*$/);
    }
  });

  it("logs a refused number without the number itself", async () => {
    await handler()(signedRequest(hookBody({ otp: OTP, phone: "+911712345678" })));
    expect(logs.join("\n")).not.toContain("911712345678");
  });
});
