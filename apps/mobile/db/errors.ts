// db/errors.ts — typed errors for db/ write failures. Pure (no Drizzle/
// expo-sqlite import) so it can be unit-tested directly. First of its kind in
// the repo: every prior db/ write threw a bare `new Error(...)`.

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
