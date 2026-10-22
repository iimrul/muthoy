// domain/errorRedaction.ts — H-8's privacy contract, as a pure function.
//
// CLAUDE.md rule 8 is absolute: a PIN is never logged. The same applies to an
// OTP, a session token, a customer's phone number or name, and any money
// amount. An error reporter is the easiest place in an app to break that rule
// by accident, because the interesting information and the forbidden
// information arrive in the same object.
//
// So this module does NOT sanitise. It builds a new value out of enumerated
// literals and integers, and discards everything else. The difference matters:
//
//   * a scrubber has to anticipate every shape a secret can take, and loses the
//     moment somebody invents a new one;
//   * an allowlist loses nothing, because a field that is not on the list never
//     existed as far as the sink is concerned.
//
// Specifically discarded, never redacted:
//
//   error.message   — arbitrary caller text. `new Error(pin)` is legal.
//   error.cause     — recurses into arbitrary objects.
//   error.stack     — its FIRST LINE IS THE MESSAGE, and its source URLs can be
//                     data:/eval:/query-bearing. Batch 1 ships no stack capture
//                     at all; a safe one needs a validated module-id allowlist
//                     that does not exist yet.
//   error.name      — also caller-assignable (`e.name = pin` is legal), so it is
//                     mapped through KNOWN_ERROR_KINDS and anything unrecognised
//                     becomes 'unknown' rather than passing through.
//
// Pure: no React, no native module, no database, no network. Tested directly
// with adversarial inputs (domain/errorRedaction.test.ts).

/** Every event this app may report. A slug not listed here cannot be sent. */
export const MONITORING_EVENTS = [
  "db.init.failed",
  "db.recovery.pending",
  "db.key.unrecoverable",
  "sync.cycle.failed",
  "sync.halted",
  "sync.conflict_detector.failed",
  // W2-01. The scanner deletes its own temporary capture on the OCR path; a
  // failure there leaves a JPEG of a medicine strip in the cache directory, so
  // it is worth a breadcrumb even though the scan itself succeeded.
  "scan.capture_cleanup.failed",
] as const;

export type MonitoringEvent = (typeof MONITORING_EVENTS)[number];

/**
 * Error classes this app raises deliberately, plus the small set of runtime
 * failures worth distinguishing. Matched against `error.name`, which is why an
 * unknown name is safe to drop rather than forward.
 */
export const KNOWN_ERROR_KINDS = [
  "DatabaseKeyUnrecoverableError",
  "DatabaseKeyUnavailableError",
  "DatabaseRecoveryPendingError",
  "DatabaseInitializationError",
  "DatabaseEncryptionMigrationError",
  "DatabaseNotReadyError",
  "StaleSessionError",
  "NotAuthorizedError",
  "CommercialReadOnlyError",
  "DeviceAccessRevokedError",
  "SyncHaltedError",
  "DeviceAccessRevokedDuringSyncError",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "Error",
] as const;

export type ErrorKind = (typeof KNOWN_ERROR_KINDS)[number] | "unknown";

/**
 * Screens and subsystems, as a closed set. Deliberately NOT a live pathname:
 * a route string can carry an id, a phone number or a search term.
 */
export const MONITORING_ROUTES = [
  "auth",
  "dashboard",
  "sale",
  "inventory",
  "credit",
  "reports",
  "settings",
  "staff",
  "suppliers",
  "sync-conflicts",
  "startup",
  "background",
  "unknown",
] as const;

export type MonitoringRoute = (typeof MONITORING_ROUTES)[number];

/** Where in a sync cycle a failure happened. */
export const SYNC_PHASES = [
  "device_gate",
  "push",
  "attachments",
  "pull",
  "apply",
  "billing",
  "unknown",
] as const;

export type SyncPhase = (typeof SYNC_PHASES)[number];

/**
 * Context KEYS whose presence is worth knowing. Only the key names ever ship —
 * never a value. "shopId was present" is a useful breadcrumb; the shop id is
 * not, and a user id is not.
 */
export const CONTEXT_KEYS = [
  "shopId",
  "actorUserId",
  "tableName",
  "rowId",
  "businessDate",
  "operationGroupId",
  "attempt",
] as const;

export type ContextKey = (typeof CONTEXT_KEYS)[number];

/** The ONLY shape a provider ever receives. Every field is closed or an integer. */
export interface MonitoringReport {
  readonly event: MonitoringEvent;
  readonly errorKind: ErrorKind;
  readonly route: MonitoringRoute;
  readonly syncPhase: SyncPhase;
  /**
   * A BUCKET from ATTEMPT_BUCKETS, never the caller's number. This field cannot
   * carry a paisa amount, a row count or a timestamp.
   */
  readonly attempt: number;
  /** Key NAMES only, deduplicated and canonically ordered. Never values. */
  readonly contextKeysPresent: readonly ContextKey[];
}

export interface RedactionInput {
  readonly event: MonitoringEvent;
  readonly error?: unknown;
  readonly route?: unknown;
  readonly syncPhase?: unknown;
  readonly attempt?: unknown;
  /**
   * Caller context. Only its KEYS are read, and only those in CONTEXT_KEYS.
   * Values are never touched, so a value cannot leak even by accident.
   */
  readonly context?: Readonly<Record<string, unknown>>;
}

const EVENT_SET = new Set<string>(MONITORING_EVENTS);
const KIND_SET = new Set<string>(KNOWN_ERROR_KINDS);
const ROUTE_SET = new Set<string>(MONITORING_ROUTES);
const PHASE_SET = new Set<string>(SYNC_PHASES);
const CONTEXT_KEY_ORDER = new Map<string, number>(
  CONTEXT_KEYS.map((key, index) => [key, index]),
);

/**
 * Attempt counts ship as a BUCKET, not a number.
 *
 * An arbitrary integer channel is a channel: a caller can put a paisa amount, a
 * row count or a timestamp through it, and an earlier version of this module
 * did exactly that — its own test asserted that 129900 survived. A bucket keeps
 * the only thing a maintainer needs ("first try" vs "retrying" vs "stuck")
 * while making the field incapable of carrying a value.
 */
export const ATTEMPT_BUCKETS = [0, 1, 2, 5, 10] as const;

function bucketAttempt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  const floored = Math.floor(value);
  let bucket = 0;
  for (const edge of ATTEMPT_BUCKETS) {
    if (floored >= edge) bucket = edge;
  }
  return bucket;
}

export function isMonitoringEvent(value: unknown): value is MonitoringEvent {
  return typeof value === "string" && EVENT_SET.has(value);
}

/**
 * Maps an unknown thrown value to a closed kind.
 *
 * Reads ONLY `name`, and only to look it up. An unrecognised name — including
 * one an attacker set to a PIN — collapses to 'unknown', so the output cannot
 * carry caller text no matter what was thrown.
 */
export function classifyErrorKind(error: unknown): ErrorKind {
  if (error === null || typeof error !== "object") {
    return "unknown";
  }
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && KIND_SET.has(name)
    ? (name as ErrorKind)
    : "unknown";
}

function toRoute(value: unknown): MonitoringRoute {
  return typeof value === "string" && ROUTE_SET.has(value)
    ? (value as MonitoringRoute)
    : "unknown";
}

function toSyncPhase(value: unknown): SyncPhase {
  return typeof value === "string" && PHASE_SET.has(value)
    ? (value as SyncPhase)
    : "unknown";
}



/**
 * Reads the KEYS of the caller's context, keeps the known ones, and orders them
 * canonically so two reports of the same failure compare equal.
 *
 * `Object.keys` deliberately: it does not touch a single value, so no getter
 * runs and nothing is stringified.
 */
function toContextKeys(
  context: Readonly<Record<string, unknown>> | undefined,
): readonly ContextKey[] {
  if (!context || typeof context !== "object") {
    return [];
  }
  const present = Object.keys(context).filter((key) =>
    CONTEXT_KEY_ORDER.has(key),
  );
  return [...new Set(present)]
    .sort(
      (left, right) =>
        CONTEXT_KEY_ORDER.get(left)! - CONTEXT_KEY_ORDER.get(right)!,
    )
    .map((key) => key as ContextKey);
}

/**
 * Builds the report. Returns null for an unknown event rather than inventing
 * one, so a typo at a call site is dropped instead of becoming a new slug the
 * provider has never seen.
 */
export function redactForMonitoring(
  input: RedactionInput,
): MonitoringReport | null {
  if (!isMonitoringEvent(input.event)) {
    return null;
  }
  return {
    event: input.event,
    errorKind: classifyErrorKind(input.error),
    route: toRoute(input.route),
    syncPhase: toSyncPhase(input.syncPhase),
    attempt: bucketAttempt(input.attempt),
    contextKeysPresent: toContextKeys(input.context),
  };
}
