import {
  listPendingSyncRows,
  markSyncRowPermanentFailure,
  markSyncRowSent,
  markSyncRowTransientFailure,
} from '../db/sync-helpers';
import { computeBackoffMs, MAX_SYNC_ATTEMPTS } from './backoff';
import { isSupabaseConfigured, supabase } from './supabaseClient';

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

export async function pushPendingRows(shopId: string): Promise<boolean> {
  if (!isSupabaseConfigured) {
    return false;
  }

  while (true) {
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
      payload: JSON.parse(row.payload) as unknown,
    }));

    const { data, error } = await supabase.functions.invoke('sync', {
      body: { action: 'push', shopId, rows },
    });
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
