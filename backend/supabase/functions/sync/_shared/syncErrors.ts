export type RejectionReason = "permanent" | "transient";

export interface SyncErrorDisposition {
  reason: RejectionReason;
  haltBatch: boolean;
}

const PERMANENT_BASE_SQLSTATES = new Set(["23505", "MU001", "MU002", "MU003", "MU004"]);
const PERMANENT_AUTHORIZATION_SQLSTATES = new Set([
  "MU010",
  "MU011",
  "MU012",
  "MU013",
  "MU014",
  "MU015",
  "MU016",
  "MU017",
  "MU018",
  "MU020",
  "MU021",
  "MU023",
  "MU024",
  "MU025",
]);

// Postgres raises data exceptions (22) and integrity violations (23) only when
// the row as sent can never be applied. Nothing on the sync apply path raises
// them on purpose (22004 and 23001 are raised deliberately, but only by the
// session-revocation RPC and the publication snapshots, which sync never calls).
// The device retries a transient row forever, so these must not be transient:
// one would hold every later row behind it without ever reaching the failed
// count that warns the Owner.
const PERMANENT_POSTGRES_CLASSES = new Set(["22", "23"]);

function isPostgresPermanentClass(code: string): boolean {
  return /^[0-9][0-9A-Z]{4}$/.test(code) && PERMANENT_POSTGRES_CLASSES.has(code.slice(0, 2));
}

/** Authorization rejects one row; integrity/transient failures retain ordering. */
export function classifySyncSqlError(code: string | undefined): SyncErrorDisposition {
  if (code && PERMANENT_AUTHORIZATION_SQLSTATES.has(code)) {
    return { reason: "permanent", haltBatch: false };
  }
  if (code && (PERMANENT_BASE_SQLSTATES.has(code) || isPostgresPermanentClass(code))) {
    return { reason: "permanent", haltBatch: true };
  }
  return { reason: "transient", haltBatch: true };
}
