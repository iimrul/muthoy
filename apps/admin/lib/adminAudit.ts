// W4-06 — the admin audit log.
//
// What is recorded: every write action, every authorization denial, every login
// success and every login failure. What is NOT recorded: list-page views. With
// no durable store yet, auditing every page view produces the noise that hides
// the writes.
//
// HONEST LIMIT, and the /audit page must say it too. Batch 3 adds the Postgres
// sink (lib/adminAuditStore.ts) and migration 35's `admin_audit_log`, and the
// sensitive paths AWAIT it. But the migration has not been applied to any
// hosted project, so DURABILITY IS CLAIMED FOR THE CODE PATH ONLY: stderr
// remains the record of account, held by the host platform's log retention, and
// the in-app ring buffer is still per-instance and non-durable. The sink stayed
// an interface precisely so adding the Postgres one changed no existing call
// site — see `flush` below for the one thing that did change.
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
  /**
   * Batch 3 §8.9. TRUE only when `actor` came from a VERIFIED session cookie.
   *
   * It exists because "the actor always comes from the verified cookie" was
   * false: lib/adminLogin.ts audits a failed login with the username the
   * request CLAIMED, and a login attempt by nature precedes a session. Reading
   * those two kinds of row as the same thing would let an unauthenticated
   * caller put any name it liked beside the verified ones.
   */
  actorVerified: boolean;
  role: string | null;
  action: string;
  target: string | null;
  outcome: AdminAuditOutcome;
  meta: Readonly<Record<string, string | number | boolean>>;
}

export interface AdminAuditInput {
  actor: string;
  /**
   * Defaults to FALSE. A caller must say so to claim a verified actor, so a
   * new call site is unverified until someone decides otherwise.
   */
  actorVerified?: boolean;
  role?: string | null;
  action: string;
  target?: string | null;
  outcome: AdminAuditOutcome;
  meta?: Readonly<Record<string, unknown>>;
  now?: number;
}

export interface AdminAuditSink {
  write(entry: AdminAuditEntry): void;
  /**
   * Batch 3 §8.9. Resolves once this sink has COMMITTED everything `write`
   * accepted, or rejects if it could not.
   *
   * Optional, and optional deliberately: `write(entry): void` is what every
   * existing non-sensitive call site uses, and making it async would have
   * changed all of them. Only a sink with durable storage implements this, and
   * only the sensitive paths await it.
   */
  flush?(): Promise<void>;
}

export const ALLOWED_META_KEYS: readonly string[] = [
  'accountId',
  'actorVerified',
  'attempt',
  'caseId',
  'claimedRole',
  'durationMs',
  'effectiveRole',
  'epoch',
  'fromRole',
  'method',
  'path',
  'paymentOrderId',
  'permission',
  'reason',
  'reportId',
  'rowCount',
  'settingKey',
  'shopId',
  'source',
  'subscriptionId',
  'targetUsername',
  'toRole',
];

// Batch 3 §8.9's enumerated redaction. An allowlisted KEY is not enough on its
// own: `settingKey` carrying an arbitrary string would turn the audit log into
// a place to stash text, and `fromRole`/`toRole` carrying anything at all would
// make a role change unreadable. So the keys that have a known value space are
// checked against it, and a value outside it is DROPPED rather than truncated —
// a half-recorded role is worse than a missing one.
const ROLE_VALUES: readonly string[] = ['super_admin', 'billing', 'support', 'read_only'];
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_SHAPE = /^\S{1,64}$/;

/**
 * The six settings keys, and the six report ids. They are enumerated here as
 * well as at their own modules because this file is the LAST gate before a
 * value is stored: lib/adminSettings.ts owning the list would mean a settings
 * bug could widen what the audit log accepts. adminSettings.test.ts and
 * adminReports.test.ts assert the three copies are identical.
 */
export const AUDITABLE_SETTING_KEYS: readonly string[] = [
  'feature.analytics',
  'feature.maps',
  'feature.reports_pdf',
  'notification.template.trial_ending',
  'notification.template.payment_failed',
  'notification.template.subscription_renewed',
];

export const AUDITABLE_REPORT_IDS: readonly string[] = [
  'pharmacy_registrations',
  'subscriptions',
  'subscription_revenue_and_renewals',
  'plan_distribution',
  'activity_summary',
  'refund_net_pharmacy_sales',
];

/** Per-key value rules. A key absent from here takes the generic scalar path. */
const META_VALUE_RULES: Readonly<Record<string, (value: string) => boolean>> = Object.freeze({
  caseId: (value) => UUID_SHAPE.test(value),
  settingKey: (value) => AUDITABLE_SETTING_KEYS.includes(value),
  reportId: (value) => AUDITABLE_REPORT_IDS.includes(value),
  targetUsername: (value) => USERNAME_SHAPE.test(value),
  fromRole: (value) => ROLE_VALUES.includes(value),
  toRole: (value) => ROLE_VALUES.includes(value),
});

/** Keys whose value must be a finite INTEGER, not merely a finite number. */
const INTEGER_META_KEYS: readonly string[] = ['rowCount', 'durationMs'];

const MAX_VALUE_LENGTH = 200;
const RING_CAPACITY = 200;

// A Bangladeshi mobile number, and any long opaque token (a JWT, a
// service-role key, a hex hash). Allowlisted keys carry free text, so the
// value is scrubbed as well as the key being checked.
//
// The phone pattern is ANCHORED between non-hex, non-dash boundaries and
// requires the real 01 + 9-digit shape. A looser `0\d{9,10}` matched the zero
// run inside a UUID, so an audit entry naming the payment order it changed
// came out as "7b000000-0000-4000-8000-[redacted]1" — a scrubber that
// destroys the record it is protecting. A test pins that now.
const PHONE_PATTERN = /(?<![0-9A-Fa-f-])(?:\+?88)?01[0-9]{9}(?![0-9A-Fa-f-])/g;
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
      // The per-key rule runs on the RAW value, before scrubbing: an enum
      // member that only matched after redaction mangled it would not be that
      // member. Rules are own-property lookups for the same reason
      // permissionsForRole is.
      const rule = Object.prototype.hasOwnProperty.call(META_VALUE_RULES, key)
        ? META_VALUE_RULES[key]
        : undefined;
      if (rule !== undefined && !rule(value)) continue;
      safe[key] = scrubValue(value);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      if (INTEGER_META_KEYS.includes(key) && !Number.isInteger(value)) continue;
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
    // `=== true` and not a truthiness check: a caller passing a non-boolean
    // must not be able to claim verification by accident.
    actorVerified: input.actorVerified === true,
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
