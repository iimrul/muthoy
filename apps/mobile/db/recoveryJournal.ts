import type { DbTransaction } from "./sync-helpers";
import { recoveryJournal, syncQueue } from "./schema";

/** Called only inside recordChange's existing transaction, after its outbox row. */
export function appendRecoveryJournal(
  tx: DbTransaction,
  row: typeof syncQueue.$inferInsert,
): void {
  tx.insert(recoveryJournal)
    .values({
      shopId: row.shopId,
      queueId: row.id,
      outboxSeq: row.seq ?? 0,
      tableName: row.tableName,
      rowId: row.rowId,
      op: row.op,
      payload: row.payload,
      operationGroupId: row.operationGroupId,
      operationKind: row.operationKind,
      operationSequence: row.operationSequence,
      operationExpectedCount: row.operationExpectedCount,
      ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
    })
    .run();
}
