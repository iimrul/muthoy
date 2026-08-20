import {
  listPendingSyncRows,
  markSyncRowPermanentFailure,
  markSyncRowSent,
  markSyncRowTransientFailure,
} from '../db/sync-helpers';
import { computeBackoffMs, MAX_SYNC_ATTEMPTS } from './backoff';
import { invokeSyncWithClaimRefresh } from './invoke';
import { isSupabaseConfigured } from './supabaseClient';

const PUSH_BATCH_SIZE = 50;
const retryNotBefore = new Map<string, number>();

interface PushResultApplied {
  queueId: string;
  status: 'applied';
}

interface PushResultRejected {
  queueId: string;
  status: 'rejected';
  reason: 'permanent' | 'transient';
  error: string;
}

interface PushResultSkipped {
  queueId: string;
  status: 'skipped';
}

type PushResult = PushResultApplied | PushResultRejected | PushResultSkipped;

function outgoingPayload(tableName: string, serialized: string): unknown {
  const payload = JSON.parse(serialized) as unknown;
  if (tableName !== 'users' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const sanitized = { ...(payload as Record<string, unknown>) };
  delete sanitized.permission_version;
  return sanitized;
}

function parsePushResults(value: unknown): PushResult[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { results?: unknown }).results)) {
    throw new Error('Sync push returned an invalid response.');
  }
  return (value as { results: unknown[] }).results.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Sync push returned an invalid row result.');
    }
    const result = item as {
      queueId?: unknown;
      status?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    if (typeof result.queueId !== 'string') {
      throw new Error('Sync push result is missing queueId.');
    }
    if (result.status === 'applied') {
      return { queueId: result.queueId, status: 'applied' };
    }
    if (result.status === 'skipped') {
      return { queueId: result.queueId, status: 'skipped' };
    }
    if (result.status === 'rejected'
        && (result.reason === 'permanent' || result.reason === 'transient')
        && typeof result.error === 'string') {
      return {
        queueId: result.queueId,
        status: 'rejected',
        reason: result.reason,
        error: result.error,
      };
    }
    throw new Error('Sync push returned an invalid row result.');
  });
}

function scheduleRetry(queueId: string, attempts: number): void {
  retryNotBefore.set(queueId, Date.now() + computeBackoffMs(attempts));
}

function markTransient(queueId: string, error: string, previousAttempts: number): void {
  const attempts = previousAttempts + 1;
  markSyncRowTransientFailure(queueId, error, MAX_SYNC_ATTEMPTS);
  if (attempts < MAX_SYNC_ATTEMPTS) {
    scheduleRetry(queueId, attempts);
  } else {
    retryNotBefore.delete(queueId);
  }
}

/**
 * Drains the outbox for one shop.
 *
 * `isCancelled` is the device-handover kill switch (Volume 0 Days 5/11). The
 * orchestrator in sync/index.ts cannot enforce it on our behalf: the loop below
 * is where the queue is actually mutated, and a guard outside a loop cannot
 * stop the loop. Cancellation is checked before starting each batch and again
 * the moment the network settles, so after stopSyncEngine() no further batch
 * goes out and no row is marked sent.
 *
 * Cancelling never loses a row. The outbox is at-least-once: a batch left
 * un-marked stays `pending` and is re-sent at the next login, where the sync
 * edge function upserts it by rowId. Marking rows sent under no active user is
 * the failure we refuse; re-sending one is not a failure.
 */
export async function pushPendingRows(
  shopId: string,
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  if (!isSupabaseConfigured) {
    return false;
  }

  while (true) {
    if (isCancelled()) {
      return false;
    }
    const pending = listPendingSyncRows(shopId, PUSH_BATCH_SIZE);
    if (pending.length === 0) {
      return true;
    }

    const now = Date.now();
    // Never overtake a backoff-delayed parent row with later child rows.
    const firstDelayedIndex = pending.findIndex((row) => (retryNotBefore.get(row.id) ?? 0) > now);
    const due = firstDelayedIndex === -1 ? pending : pending.slice(0, firstDelayedIndex);
    if (due.length === 0) {
      return false;
    }

    const byId = new Map(due.map((row) => [row.id, row]));
    const rows = due.map((row) => ({
      queueId: row.id,
      tableName: row.tableName,
      rowId: row.rowId,
      op: row.op,
      payload: outgoingPayload(row.tableName, row.payload),
    }));

    if (isCancelled()) {
      return false;
    }
    const { data, error } = await invokeSyncWithClaimRefresh({
      action: 'push',
      shopId,
      rows,
    });
    // The handover landed while this batch was on the wire. The request cannot
    // be recalled, but every local consequence of it can be: leave the rows
    // pending and let the next login re-send them.
    if (isCancelled()) {
      return false;
    }
    if (error) {
      due.forEach((row) => markTransient(row.id, error.message, row.attempts));
      return false;
    }

    let results: PushResult[];
    try {
      results = parsePushResults(data);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Invalid sync push response';
      due.forEach((row) => markTransient(row.id, message, row.attempts));
      return false;
    }

    const seen = new Set<string>();
    results.forEach((result) => {
      const local = byId.get(result.queueId);
      if (!local || seen.has(result.queueId)) {
        return;
      }
      seen.add(result.queueId);
      if (result.status === 'applied') {
        markSyncRowSent(result.queueId);
        retryNotBefore.delete(result.queueId);
      } else if (result.status === 'skipped') {
        markTransient(
          result.queueId,
          'Sync server skipped this row after an earlier batch failure.',
          local.attempts,
        );
      } else if (result.reason === 'permanent') {
        markSyncRowPermanentFailure(result.queueId, result.error);
        retryNotBefore.delete(result.queueId);
      } else {
        markTransient(result.queueId, result.error, local.attempts);
      }
    });

    due.forEach((row) => {
      if (!seen.has(row.id)) {
        markTransient(row.id, 'Sync server omitted this row result.', row.attempts);
      }
    });

    if (results.some((result) => result.status === 'skipped'
        || (result.status === 'rejected' && result.reason === 'transient'))
        || seen.size !== due.length) {
      return false;
    }
  }
}
