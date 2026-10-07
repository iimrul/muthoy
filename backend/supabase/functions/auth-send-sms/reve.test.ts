import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  APPROVED_REVE_ENDPOINTS,
  buildReveRequest,
  classifyReveResponse,
  type FetchLike,
  readReveConfig,
  REJECTED_STATUSES,
  type ReveConfig,
  type ReveOutcome,
  sendReveSms,
} from "./reve.ts";

// The REVE adapter against REVE's confirmed contract — and against everything
// still unconfirmed, which must fail closed or come back ambiguous rather than
// be guessed at.

const ENV = {
  REVE_API_URL: "https://smpp.revesms.com:7790/sendtext",
  REVE_TRANSPORT: "post_json",
  REVE_API_KEY: "test-api-key-123",
  REVE_SECRET_KEY: "test-secret-key-456",
  REVE_SENDER_ID: "8809600000000",
};

function reader(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ...ENV, ...overrides };
  return (name: string) => env[name];
}

const CONFIG: ReveConfig = {
  endpoint: "https://smpp.revesms.com:7790/sendtext",
  transport: "post_json",
  apiKey: "test-api-key-123",
  secretKey: "test-secret-key-456",
  senderId: "8809600000000",
};
/** The inactive GET: no configuration selects it; only its builder is kept. */
const GET_CONFIG: ReveConfig = { ...CONFIG, transport: "get_query" };
const RECIPIENT = "8801712345678";
const TEXT = "Muthoy code: 123456. Valid 5 minutes. Never share this code.";

describe("REVE configuration fails closed", () => {
  it("allowlists only REVE's documented HTTPS endpoints", () => {
    expect([...APPROVED_REVE_ENDPOINTS]).toEqual([
      "https://smpp.revesms.com:7790/sendtext",
      "https://apismpp.revesms.com/sendtext",
    ]);
    for (const endpoint of APPROVED_REVE_ENDPOINTS) {
      expect(new URL(endpoint).protocol).toBe("https:");
      expect(new URL(endpoint).hostname).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    }
  });

  it.each([
    ["https://smpp.revesms.com:7790/sendtext", "https://smpp.revesms.com:7790/sendtext"],
    ["https://apismpp.revesms.com/sendtext", "https://apismpp.revesms.com/sendtext"],
    ["https://apismpp.revesms.com:443/sendtext", "https://apismpp.revesms.com/sendtext"],
  ])("accepts the approved endpoint %s", (url, expected) => {
    expect(readReveConfig(reader({ REVE_API_URL: url })))
      .toMatchObject({ ok: true, config: { endpoint: expected, transport: "post_json" } });
  });

  it.each(Object.keys(ENV))("refuses to send without %s", (name) => {
    expect(readReveConfig(reader({ [name]: undefined })))
      .toEqual({ ok: false, problem: "reve_config_missing" });
  });

  it.each([
    "http://smpp.revesms.com:7788/sendtext",
    "http://103.177.125.106:7788/sendtext",
    "https://103.177.125.106:7790/sendtext",
    "http://103.177.125.108/sendtext",
    "http://smpp.revesms.com:7790/sendtext",
    "https://smpp.revesms.com:7788/sendtext",
    "https://smpp.revesms.com/sendtext",
    "https://smpp.revesms.com:7790/send",
    "https://smpp.revesms.com:7790/sendtext?apikey=embedded",
    "https://smpp.revesms.com:7790/sendtext#fragment",
    "https://user:pass@smpp.revesms.com:7790/sendtext",
    "https://smpp.revesms.com.attacker.example/sendtext",
    "not a url",
  ])("refuses the unapproved endpoint %s", (url) => {
    expect(readReveConfig(reader({ REVE_API_URL: url })))
      .toEqual({ ok: false, problem: "reve_endpoint_unapproved" });
  });

  it.each(["post_form", "POST_JSON", "GET_QUERY", "query"])(
    "refuses the transport %j until REVE confirms it and it is implemented here",
    (transport) => {
      expect(readReveConfig(reader({ REVE_TRANSPORT: transport })))
        .toEqual({ ok: false, problem: "reve_transport_unsupported" });
    },
  );

  it("keeps get_query inactive: a configured GET is refused, so no credential can ride in a URL", () => {
    expect(readReveConfig(reader({ REVE_TRANSPORT: "get_query" })))
      .toEqual({ ok: false, problem: "reve_transport_unsupported" });
  });

  it.each([
    ["an API key with a space", { REVE_API_KEY: "key with space" }],
    ["a secret with a newline inside", { REVE_SECRET_KEY: "secret\ninside" }],
    ["a non-ASCII secret", { REVE_SECRET_KEY: "সিক্রেট" }],
  ])("refuses %s", (_label, overrides) => {
    expect(readReveConfig(reader(overrides)))
      .toEqual({ ok: false, problem: "reve_credentials_invalid" });
  });

  it.each(["-Muthoy", "Muthoy<script>", "x".repeat(21)])("refuses the Sender ID %j", (senderId) => {
    expect(readReveConfig(reader({ REVE_SENDER_ID: senderId })))
      .toEqual({ ok: false, problem: "reve_sender_invalid" });
  });

  it.each(["8809600000000", "Muthoy"])("accepts the Sender ID %j", (senderId) => {
    expect(readReveConfig(reader({ REVE_SENDER_ID: senderId })).ok).toBe(true);
  });
});

describe("the POST request REVE asked for", () => {
  it("POSTs exactly the five fields, in REVE's order, as JSON to the approved endpoint itself", () => {
    const { url, init } = buildReveRequest(CONFIG, RECIPIENT, TEXT);
    expect(url).toBe("https://smpp.revesms.com:7790/sendtext");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      redirect: "manual",
    });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["apikey", "secretkey", "callerID", "toUser", "messageContent"]);
    expect(body).toEqual({
      apikey: "test-api-key-123",
      secretkey: "test-secret-key-456",
      callerID: "8809600000000",
      toUser: "8801712345678",
      messageContent: TEXT,
    });
  });

  it("never puts a credential in the URL — not in the query, the path or anywhere else", () => {
    const { url } = buildReveRequest(CONFIG, RECIPIENT, TEXT);
    const parsed = new URL(url);
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe("");
    expect(parsed.pathname).toBe("/sendtext");
    for (const value of ["test-api-key-123", "test-secret-key-456", RECIPIENT, "123456"]) {
      expect(url).not.toContain(value);
    }
  });

  it("escapes every value as JSON, so nothing in one field can spill into another", () => {
    const backslash = String.fromCharCode(92);
    const tricky: ReveConfig = { ...CONFIG, apiKey: `a"b${backslash}c`, secretKey: '","toUser":"8801999999999' };
    const { init } = buildReveRequest(tricky, RECIPIENT, TEXT);
    expect(JSON.parse(init.body as string)).toEqual({
      apikey: `a"b${backslash}c`,
      secretkey: '","toUser":"8801999999999',
      callerID: "8809600000000",
      toUser: RECIPIENT,
      messageContent: TEXT,
    });
  });
});

describe("the documented GET request — inactive, kept until a live POST is confirmed", () => {
  it("carries exactly the five confirmed fields, in order, to the approved endpoint", () => {
    const request = buildReveRequest(GET_CONFIG, RECIPIENT, TEXT);
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://smpp.revesms.com:7790/sendtext");
    expect([...url.searchParams.keys()]).toEqual([
      "apikey",
      "secretkey",
      "callerID",
      "toUser",
      "messageContent",
    ]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      apikey: "test-api-key-123",
      secretkey: "test-secret-key-456",
      callerID: "8809600000000",
      toUser: "8801712345678",
      messageContent: TEXT,
    });
  });

  it("percent-encodes the message — a space is %20, never '+'", () => {
    const { url } = buildReveRequest(GET_CONFIG, RECIPIENT, TEXT);
    const query = url.slice(url.indexOf("?") + 1);
    expect(query).toContain("messageContent=Muthoy%20code%3A%20123456.%20Valid%205%20minutes.");
    expect(query).not.toContain("+");
  });

  it("encodes credentials so they cannot break the query", () => {
    const { url } = buildReveRequest({ ...GET_CONFIG, apiKey: "a&b=c", secretKey: "d#e?f" }, RECIPIENT, TEXT);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("apikey")).toBe("a&b=c");
    expect(parsed.searchParams.get("secretkey")).toBe("d#e?f");
    expect(parsed.hash).toBe("");
  });

  it("is a GET with no body that will never follow a redirect", () => {
    const { init } = buildReveRequest(GET_CONFIG, RECIPIENT, TEXT);
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(init.body).toBeUndefined();
  });
});

describe("REVE's confirmed statuses", () => {
  it.each([
    ['{"Status":"0","Text":"ACCEPTD","Message_ID":"444"}', "444"],
    ['{"Status":"0","Text":"Acceptd"}', null],
    ['{"Status":0,"Message_ID":444}', "444"],
    ['{"Status":" 0 ","Message_ID":"../etc"}', null],
  ])("reads %s as accepted", (body, messageId) => {
    expect(classifyReveResponse(body)).toEqual({ kind: "accepted", providerStatus: "0", messageId });
  });

  it.each([
    ["1", "provider_rejected"],
    ["108", "credentials_invalid"],
    ["109", "credentials_invalid"],
    ["114", "request_invalid"],
    ["136", "profile_blocked"],
    ["137", "tps_exceeded"],
    ["151", "traffic_type_invalid"],
    ["170", "content_type_invalid"],
    ["5400", "ip_restricted"],
  ])("reads Status %s as rejected: %s", (status, reason) => {
    expect(classifyReveResponse(`{"Status":"${status}","Text":"REJECTD"}`))
      .toEqual({ kind: "rejected", reason, providerStatus: status });
  });

  it("reads Status 101 as ambiguous: REVE failed internally, the SMS may exist", () => {
    expect(classifyReveResponse('{"Status":"101","Text":"REJECTD"}'))
      .toEqual({ kind: "ambiguous", reason: "provider_internal_error", providerStatus: "101" });
  });

  it.each(["-42", "2", "4", "999"])("reads the unconfirmed Status %s as ambiguous, not as a guess", (status) => {
    expect(classifyReveResponse(`{"Status":"${status}"}`))
      .toEqual({ kind: "ambiguous", reason: "provider_unknown_status", providerStatus: status });
  });

  it("never trusts Text: a failure labelled ACCEPTD is still a failure", () => {
    expect(classifyReveResponse('{"Status":"1","Text":"ACCEPTD"}'))
      .toMatchObject({ kind: "rejected", reason: "provider_rejected" });
  });

  it.each(["ACCEPTD", "<html>302 Found</html>", "", "[]", '{"Text":"ACCEPTD"}', '{"Status":"ok"}', "x".repeat(20_000)])(
    "reads the unreadable reply %j as ambiguous",
    (body) => {
      expect(classifyReveResponse(body))
        .toEqual({ kind: "ambiguous", reason: "provider_unreadable_response", providerStatus: null });
    },
  );
});

// ── Pinned to the evidence ───────────────────────────────────────────────
//
// testdata/reve-sendtext-statuses.json records, sanitized, every sendtext
// status the adapter maps and the vendor material each one comes from —
// REVE's API PDF and REVE's Postman collection. These tests hold the adapter
// and that record together: no status is mapped without vendor evidence, no
// evidenced status goes unmapped, and every reply body REVE documents
// classifies as pinned below.

interface EvidenceEntry {
  status: string;
  source: "reve-api-pdf" | "reve-postman-collection";
  case: string;
  body: Record<string, unknown>;
}

const EVIDENCE_TEXT = readFileSync(new URL("./testdata/reve-sendtext-statuses.json", import.meta.url), "utf8");
const EVIDENCE = JSON.parse(EVIDENCE_TEXT) as { sources: Record<string, string>; sendtext: EvidenceEntry[] };

/** The adapter's decision for each status — what the evidence is pinned to. */
const PINNED: Record<string, Exclude<ReveOutcome, { kind: "accepted" }> | "accepted"> = {
  "0": "accepted",
  "1": { kind: "rejected", reason: "provider_rejected", providerStatus: "1" },
  "101": { kind: "ambiguous", reason: "provider_internal_error", providerStatus: "101" },
  "108": { kind: "rejected", reason: "credentials_invalid", providerStatus: "108" },
  "109": { kind: "rejected", reason: "credentials_invalid", providerStatus: "109" },
  "114": { kind: "rejected", reason: "request_invalid", providerStatus: "114" },
  "136": { kind: "rejected", reason: "profile_blocked", providerStatus: "136" },
  "137": { kind: "rejected", reason: "tps_exceeded", providerStatus: "137" },
  "151": { kind: "rejected", reason: "traffic_type_invalid", providerStatus: "151" },
  "170": { kind: "rejected", reason: "content_type_invalid", providerStatus: "170" },
  "5400": { kind: "rejected", reason: "ip_restricted", providerStatus: "5400" },
};

describe("REVE's statuses, pinned to the sanitized evidence", () => {
  const statuses = (entries: EvidenceEntry[]) => [...new Set(entries.map((entry) => entry.status))].sort();

  it("covers exactly the eleven statuses under review", () => {
    expect(statuses(EVIDENCE.sendtext)).toEqual(
      ["0", "1", "101", "108", "109", "114", "136", "137", "151", "170", "5400"].sort(),
    );
    expect(Object.keys(PINNED).sort()).toEqual(statuses(EVIDENCE.sendtext));
  });

  it("maps no status the evidence lacks, and leaves no evidenced status unmapped", () => {
    const mapped = ["0", "101", ...Object.keys(REJECTED_STATUSES)].sort();
    expect(mapped).toEqual(statuses(EVIDENCE.sendtext));
  });

  it.each(EVIDENCE.sendtext)(
    "classifies REVE's documented reply for Status $status ($source: $case) as pinned",
    (entry) => {
      const pinned = PINNED[entry.status]!;
      const expected = pinned === "accepted"
        ? { kind: "accepted", providerStatus: "0", messageId: (entry.body.Message_ID as string | undefined) ?? null }
        : pinned;
      expect(classifyReveResponse(JSON.stringify(entry.body))).toEqual(expected);
    },
  );

  it("rests every status on vendor material, with the reply REVE documents for it", () => {
    const bySource = (source: EvidenceEntry["source"]) =>
      statuses(EVIDENCE.sendtext.filter((entry) => entry.source === source));
    expect(Object.keys(EVIDENCE.sources).sort()).toEqual(["reve-api-pdf", "reve-postman-collection"]);
    expect(bySource("reve-api-pdf")).toEqual(["0", "1", "101", "108", "109", "114"]);
    // The collection's own table covers all eleven — including 136, 137, 151,
    // 170 and 5400, which until 2026-10-02 rested only on a relayed instruction.
    expect(bySource("reve-postman-collection")).toEqual(statuses(EVIDENCE.sendtext));
    for (const entry of EVIDENCE.sendtext) {
      expect(["reve-api-pdf", "reve-postman-collection"], `Status ${entry.status}`).toContain(entry.source);
      expect(entry.body.Status, `Status ${entry.status}: the reply must be that status's own`).toBe(entry.status);
    }
  });

  it("is sanitized: no credential, endpoint, address or number", () => {
    for (const forbidden of [
      /apikey\s*=/i,
      /secretkey\s*=/i,
      /callerID/,
      /https?:\/\//i,
      /\b\d{1,3}(\.\d{1,3}){3}\b/,
      /\b880\d{7,}/,
      // REVE's documented ports, and the ports the Postman collection's samples use.
      /\b(7788|7790|9988|8124|8125|4479)\b/,
      /revesms\.com/i,
      /[A-Za-z0-9+/_-]{24,}/,
    ]) {
      expect(EVIDENCE_TEXT, String(forbidden)).not.toMatch(forbidden);
    }
  });
});

describe("one call to REVE, never retried", () => {
  it("calls fetch once with the built request and a timeout signal", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"Status":"0","Message_ID":"777"}'));
    await expect(sendReveSms(CONFIG, RECIPIENT, TEXT, fetchImpl))
      .resolves.toEqual({ kind: "accepted", providerStatus: "0", messageId: "777" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const built = buildReveRequest(CONFIG, RECIPIENT, TEXT);
    expect(url).toBe(built.url);
    expect(init).toMatchObject({ method: "POST", body: built.init.body, redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives up at the timeout as ambiguous, and does not call again", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }));
    await expect(sendReveSms(CONFIG, RECIPIENT, TEXT, fetchImpl, 25))
      .resolves.toEqual({ kind: "ambiguous", reason: "provider_timeout", providerStatus: null });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("drops a network error's message, which can quote the request and the credentials in it", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      throw new TypeError(`error sending request for url (${url}) body ${String(init.body)}: connection reset`);
    });
    const outcome = await sendReveSms(CONFIG, RECIPIENT, TEXT, fetchImpl);
    expect(outcome).toEqual({ kind: "ambiguous", reason: "provider_network_error", providerStatus: null });
    const serialized = JSON.stringify(outcome);
    for (const secret of ["test-api-key-123", "test-secret-key-456", "revesms", RECIPIENT, "123456"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("treats a body that cannot be read as a network failure", async () => {
    const broken = new Response('{"Status":"0"}');
    vi.spyOn(broken, "text").mockRejectedValue(new TypeError("body stream aborted"));
    await expect(sendReveSms(CONFIG, RECIPIENT, TEXT, async () => broken))
      .resolves.toEqual({ kind: "ambiguous", reason: "provider_network_error", providerStatus: null });
  });
});

describe("accepted only on an HTTP 2xx AND Status 0", () => {
  const ACCEPTED_BODY = '{"Status":"0","Text":"ACCEPTD","Message_ID":"777"}';

  function replying(body: string, status: number, headers: Record<string, string> = {}) {
    return vi.fn<FetchLike>(async () => new Response(body, { status, headers }));
  }

  it.each([200, 202])("reads HTTP %i with Status 0 as accepted", async (status) => {
    const fetchImpl = replying(ACCEPTED_BODY, status);
    await expect(sendReveSms(CONFIG, RECIPIENT, TEXT, fetchImpl))
      .resolves.toEqual({ kind: "accepted", providerStatus: "0", messageId: "777" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 404, 429, 500, 502, 503, 504])(
    "never reads HTTP %i as accepted, Status 0 or not — its body is not even read",
    async (status) => {
      const reply = new Response(ACCEPTED_BODY, { status });
      const read = vi.spyOn(reply, "text");
      const fetchImpl = vi.fn<FetchLike>(async () => reply);
      await expect(sendReveSms(CONFIG, RECIPIENT, TEXT, fetchImpl))
        .resolves.toEqual({ kind: "ambiguous", reason: "provider_http_error", providerStatus: null });
      expect(read).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it.each([301, 302, 303, 307, 308])(
    "never reads a redirect, HTTP %i, as accepted — and never follows it",
    async (status) => {
      const fetchImpl = replying(ACCEPTED_BODY, status, { location: "https://elsewhere.example/sendtext" });
      await expect(sendReveSms(CONFIG, RECIPIENT, TEXT, fetchImpl))
        .resolves.toEqual({ kind: "ambiguous", reason: "provider_redirected", providerStatus: null });
      expect(fetchImpl).toHaveBeenCalledOnce();
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(new URL(url).hostname).toBe("smpp.revesms.com");
      expect(init.redirect).toBe("manual");
    },
  );

  it("reads HTTP 200 with Status 101 as ambiguous: REVE failed internally", async () => {
    await expect(sendReveSms(CONFIG, RECIPIENT, TEXT, replying('{"Status":"101","Text":"REJECTD"}', 200)))
      .resolves.toEqual({ kind: "ambiguous", reason: "provider_internal_error", providerStatus: "101" });
  });

  it.each(["ACCEPTD", "", "<html>200 OK</html>", '{"Text":"ACCEPTD"}', '{"Status":"ok"}', '{"Status":"0"'])(
    "reads the malformed HTTP 200 body %j as ambiguous",
    async (body) => {
      await expect(sendReveSms(CONFIG, RECIPIENT, TEXT, replying(body, 200)))
        .resolves.toEqual({ kind: "ambiguous", reason: "provider_unreadable_response", providerStatus: null });
    },
  );
});
