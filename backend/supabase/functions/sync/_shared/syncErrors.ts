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
]);

/** Authorization rejects one row; integrity/transient failures retain ordering. */
export function classifySyncSqlError(code: string | undefined): SyncErrorDisposition {
  if (code && PERMANENT_AUTHORIZATION_SQLSTATES.has(code)) {
    return { reason: "permanent", haltBatch: false };
  }
  if (code && PERMANENT_BASE_SQLSTATES.has(code)) {
    return { reason: "permanent", haltBatch: true };
  }
  return { reason: "transient", haltBatch: true };
}
