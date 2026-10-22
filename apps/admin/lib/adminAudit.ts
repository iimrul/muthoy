// W4-06 — the admin audit log.
//
// What is recorded: every write action, every authorization denial, every login
// success and every login failure. What is NOT recorded: list-page views. With
// no durable store yet, auditing every page view produces the noise that hides
// the writes.
//
// HONEST LIMIT, and the /audit page must say it too: until Batch 3's Postgres
// table exists, the in-app view is per-instance and non-durable. stderr is the
// record of account — the host platform's log retention holds it. The sink is an
// interface precisely so that adding the Postgres sink later changes no call
// site.
//
// REDACTION IS BY ALLOWLIST, not by denylist. meta keys outside
// ALLOWED_META_KEYS are dropped, so the service-role key, the session secret, a
// password hash, a bKash credential and a customer phone number are
// structurally unable to reach the sink — a new field has to be allowed in
// deliberately. Values are scalars only, length-capped, and scrubbed for
// anything shaped like a BD phone number or a long token, because an allowed
// key such as reason could otherwise carry one in free text.

export type AdminAuditOutcome = 'success' | 'failure' | 'denied';

export interface AdminAuditEntry {
  /** ISO-8601 UTC. */
  at: string;
  actor: string;
  role: string | null;
  action: string;
  target: string | null;
  outcome: AdminAuditOutcome;
  meta: Readonly<Record<string, string | number | boolean>>;
}

export interface AdminAuditInput {
  actor: string;
  role?: string | null;
  action: string;
  target?: string | null;
  outcome: AdminAuditOutcome;
  meta?: Readonly<Record<string, unknown>>;
  now?: number;
}

export interface AdminAuditSink {
  write(entry: AdminAuditEntry): void;
}

export const ALLOWED_META_KEYS: readonly string[] = [
  'accountId',
  'attempt',
  'claimedRole',
  'effectiveRole',
  'epoch',
  'method',
  'path',
  'paymentOrderId',
  'permission',
  'reason',
  'shopId',
  'source',
  'subscriptionId',
];

const MAX_VALUE_LENGTH = 200;
const RING_CAPACITY = 200;

// A Bangladeshi mobile number, and any long opaque token (a JWT, a service-role
// key, a hex hash). Allowlisted keys carry free text, so the value is scrubbed
// as well as the key being checked.
const PHONE_PATTERN = /(?:\+?88)?0\d{9,10}/g;
const LONG_TOKEN_PATTERN = /[A-Za-z0-9_\-.]{40,}/g;

function scrubValue(value: string): string {
  return value
    .slice(0, MAX_VALUE_LENGTH)
    .replace(PHONE_PATTERN, '[redacted]')
    .replace(LONG_TOKEN_PATTERN, '[redacted]');
}

function redactMeta(
  meta: Readonly<Record<string, unknown>> | undefined,
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  if (!meta) return safe;

  for (const key of ALLOWED_META_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(meta, key)) continue;
    const value = meta[key];
    if (typeof value === 'string') {
      safe[key] = scrubValue(value);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      safe[key] = value;
    } else if (typeof value === 'boolean') {
      safe[key] = value;
    }
    // Anything else — an object, an array, a function, null, undefined — is
    // dropped: a nested shape is where an unexpected secret hides.
  }
  return safe;
}

/** One structured JSON line per entry. The platform's log retention is the record. */
export const stderrAuditSink: AdminAuditSink = {
  write(entry) {
    console.error('[admin-audit] ' + JSON.stringify(entry));
  },
};

export interface RingBufferAuditSink extends AdminAuditSink {
  /** Newest first. */
  entries(): readonly AdminAuditEntry[];
  clear(): void;
}

export function createRingBufferAuditSink(capacity = RING_CAPACITY): RingBufferAuditSink {
  let buffer: AdminAuditEntry[] = [];
  return {
    write(entry) {
      buffer = [entry, ...buffer].slice(0, capacity);
    },
    entries() {
      return buffer;
    },
    clear() {
      buffer = [];
    },
  };
}

/** The in-process view /audit renders. Per-instance and non-durable, by design. */
export const recentAdminAudit: RingBufferAuditSink = createRingBufferAuditSink();

const DEFAULT_SINKS: readonly AdminAuditSink[] = [stderrAuditSink, recentAdminAudit];

export function recordAdminAction(
  input: AdminAuditInput,
  sinks: readonly AdminAuditSink[] = DEFAULT_SINKS,
): AdminAuditEntry {
  const entry: AdminAuditEntry = {
    at: new Date(input.now ?? Date.now()).toISOString(),
    actor: scrubValue(input.actor),
    role: input.role ?? null,
    action: input.action,
    target: input.target === undefined || input.target === null ? null : scrubValue(input.target),
    outcome: input.outcome,
    meta: redactMeta(input.meta),
  };

  for (const sink of sinks) {
    // One failing sink must not swallow the record, and must not break the
    // request that was being audited.
    try {
      sink.write(entry);
    } catch {
      // Deliberately silent: there is nowhere left to report a failing sink to.
    }
  }
  return entry;
}
