// db/errors.ts — typed errors for db/ write failures. Pure (no Drizzle/
// expo-sqlite import) so it can be unit-tested directly. First of its kind in
// the repo: every prior db/ write threw a bare `new Error(...)`.

import { ACCESS_DENIED_MESSAGE } from '../domain/permissions';

// Thrown by db/inventory.ts's addBatchToMedicine when the batch number is
// already used for this medicine — the UNIQUE(shop_id, medicine_id, batch_no)
// constraint at db/schema.ts's batches_shop_medicine_batchno_unique index.
// Screens catch this and render the message inline under the batch-number
// field (Volume 0 Day 8: "a friendly error, not a crash") — never an Alert.
export class DuplicateBatchError extends Error {
  readonly medicineId: string;
  readonly batchNo: string;

  constructor(medicineId: string, batchNo: string) {
    super(`Batch number "${batchNo}" already exists for this medicine.`);
    this.name = 'DuplicateBatchError';
    this.medicineId = medicineId;
    this.batchNo = batchNo;
  }
}

export class BatchExpiryMismatchError extends Error {
  readonly medicineId: string;
  readonly batchNo: string;
  constructor(medicineId: string, batchNo: string) {
    super(`Batch "${batchNo}" already exists with a different expiry date.`);
    this.name = 'BatchExpiryMismatchError';
    this.medicineId = medicineId;
    this.batchNo = batchNo;
  }
}

// Thrown by db/auth.ts's requirePermission/requireOwner when the actor's role
// — re-read from SQLite, never trusted from the session store — does not grant
// the action. Screens render the same friendly denial text, so a blocked
// action and a blocked route read identically to the user.
export class NotAuthorizedError extends Error {
  constructor() {
    super(ACCESS_DENIED_MESSAGE);
    this.name = 'NotAuthorizedError';
  }
}

// Thrown by db/cash.ts's assertBusinessDateOpen, and by any write path that
// calls it (sales, customer credit collections, purchases) before touching a
// business date whose cash_drawer.closed_at is already set. Volume 0 Day 10:
// a closed day's locked EOD snapshot (closing_expected/counted/variance) must
// never be invalidated by a later write — the guard is a read-only check, so
// it never reopens or rewrites the drawer itself.
export class DayClosedError extends Error {
  readonly businessDate: string;

  constructor(businessDate: string) {
    super('This day is already closed — reopening is not supported.');
    this.name = 'DayClosedError';
    this.businessDate = businessDate;
  }
}

// expo-sqlite surfaces a plain Error with no `.code` — detection is by
// message text. SQLite's own wording: 'UNIQUE constraint failed:
// batches.shop_id, batches.medicine_id, batches.batch_no'. Used as a backstop
// behind addBatchToMedicine's pre-check SELECT (see db/inventory.ts).
export function isUniqueConstraintViolation(err: unknown, table: string, columns: string[]): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  if (!err.message.includes('UNIQUE constraint failed')) {
    return false;
  }
  return columns.every((column) => err.message.includes(`${table}.${column}`));
}
