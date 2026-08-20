// The outbox drain loop itself, with only the network (supabase.functions)
// and the DB helpers mocked. sync/index.test.ts mocks this whole module, so
// nothing there can see inside this loop — and the loop is precisely where
// sync_queue gets mutated. Volume 0 Days 5/11: after a device handover no row
// may be marked sent and no further batch may leave the phone.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refreshSession: vi.fn(),
  listPendingSyncRows: vi.fn(),
  markSyncRowSent: vi.fn(),
  markSyncRowTransientFailure: vi.fn(),
  markSyncRowPermanentFailure: vi.fn(),
}));

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: { refreshSession: mocks.refreshSession },
  },
}));
vi.mock('../db/sync-helpers', () => ({
  listPendingSyncRows: mocks.listPendingSyncRows,
  markSyncRowSent: mocks.markSyncRowSent,
  markSyncRowTransientFailure: mocks.markSyncRowTransientFailure,
  markSyncRowPermanentFailure: mocks.markSyncRowPermanentFailure,
}));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import { pushPendingRows } from './push';

const SHOP = 'shop-1';

interface QueueRow {
  id: string;
  tableName: string;
  rowId: string;
  op: string;
  payload: string;
  attempts: number;
}

function queueRows(prefix: string, count: number): QueueRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    tableName: 'sales',
    rowId: `row-${prefix}${index}`,
    op: 'insert',
    payload: '{}',
    attempts: 0,
  }));
}

function applied(rows: QueueRow[]) {
  return {
    data: { results: rows.map((row) => ({ queueId: row.id, status: 'applied' })) },
    error: null,
  };
}

function functionError(code: string, message: string): FunctionsHttpError {
  return new FunctionsHttpError(new Response(
    JSON.stringify({ code, error: message }),
    { status: code === 'hook_not_configured' ? 503 : 401, headers: { 'content-type': 'application/json' } },
  ));
}

function terminalFunctionError(message: string): FunctionsHttpError {
  return new FunctionsHttpError(new Response(
    JSON.stringify({ error: message }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshSession.mockResolvedValue({ data: { session: {} }, error: null });
});

describe('push authorization and claim control flow', () => {
  it('permanently rejects one authorization row while the outbox tail survives', async () => {
    const rows = queueRows('auth', 2);
    const first = rows[0]!;
    const tail = rows[1]!;
    mocks.listPendingSyncRows.mockReturnValueOnce(rows).mockReturnValue([]);
    mocks.invoke.mockResolvedValue({
      data: {
        results: [
          { queueId: first.id, status: 'rejected', reason: 'permanent', error: 'Denied' },
          { queueId: tail.id, status: 'applied' },
        ],
      },
      error: null,
    });

    await expect(pushPendingRows(SHOP)).resolves.toBe(true);
    expect(mocks.markSyncRowPermanentFailure).toHaveBeenCalledWith(first.id, 'Denied');
    expect(mocks.markSyncRowSent).toHaveBeenCalledWith(tail.id);
    expect(mocks.markSyncRowTransientFailure).not.toHaveBeenCalled();
  });

  it('refreshes permissions_changed exactly once without consuming retry attempts', async () => {
    const rows = queueRows('claims', 2);
    mocks.listPendingSyncRows.mockReturnValueOnce(rows).mockReturnValue([]);
    mocks.invoke
      .mockResolvedValueOnce({ data: null, error: functionError('permissions_changed', 'Refresh') })
      .mockResolvedValueOnce(applied(rows));

    await expect(pushPendingRows(SHOP)).resolves.toBe(true);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.markSyncRowTransientFailure).not.toHaveBeenCalled();
    expect(mocks.markSyncRowPermanentFailure).not.toHaveBeenCalled();
  });

  it('surfaces the refreshed request terminal reason without touching the outbox', async () => {
    const rows = queueRows('terminal', 2);
    mocks.listPendingSyncRows.mockReturnValue(rows);
    mocks.invoke
      .mockResolvedValueOnce({ data: null, error: functionError('permissions_changed', 'Refresh') })
      .mockResolvedValueOnce({ data: null, error: terminalFunctionError('Account is no longer active') });

    await expect(pushPendingRows(SHOP)).rejects.toThrow('Account is no longer active');
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.markSyncRowTransientFailure).not.toHaveBeenCalled();
    expect(mocks.markSyncRowPermanentFailure).not.toHaveBeenCalled();
    expect(mocks.markSyncRowSent).not.toHaveBeenCalled();
  });

  it('halts safely on hook_not_configured without refresh or outbox mutation', async () => {
    const rows = queueRows('hook', 2);
    mocks.listPendingSyncRows.mockReturnValue(rows);
    mocks.invoke.mockResolvedValue({
      data: null,
      error: functionError('hook_not_configured', 'Authentication hook is not configured'),
    });

    await expect(pushPendingRows(SHOP)).rejects.toThrow('Authentication hook is not configured');
    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(mocks.markSyncRowTransientFailure).not.toHaveBeenCalled();
    expect(mocks.markSyncRowPermanentFailure).not.toHaveBeenCalled();
    expect(mocks.markSyncRowSent).not.toHaveBeenCalled();
  });

  it('strips permission_version from queued user payloads before sending', async () => {
    const row = queueRows('version', 1)[0]!;
    row.tableName = 'users';
    row.payload = JSON.stringify({ id: row.rowId, name: 'Staff', permission_version: 42 });
    mocks.listPendingSyncRows.mockReturnValueOnce([row]).mockReturnValue([]);
    mocks.invoke.mockResolvedValue(applied([row]));

    await pushPendingRows(SHOP);

    const request = mocks.invoke.mock.calls[0]?.[1] as { body: { rows: { payload: Record<string, unknown> }[] } };
    expect(request.body.rows[0]?.payload).toEqual({ id: row.rowId, name: 'Staff' });
  });
});

describe('pushPendingRows honours the device-handover kill switch', () => {
  it('does not start the next batch once the device has changed hands', async () => {
    const first = queueRows('a', 50);
    const second = queueRows('b', 1);
    mocks.listPendingSyncRows
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValue([]);

    // The switch happens while the first batch is on the wire.
    let handedOver = false;
    mocks.invoke.mockImplementationOnce(() => {
      handedOver = true;
      return Promise.resolve(applied(first));
    });
    mocks.invoke.mockResolvedValue(applied(second));

    const completed = await pushPendingRows(SHOP, () => handedOver);

    expect(completed).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.markSyncRowSent).not.toHaveBeenCalled();
  });

  it('marks nothing sent when the handover lands while the batch is on the wire', async () => {
    const rows = queueRows('a', 3);
    mocks.listPendingSyncRows.mockReturnValue(rows);

    let releaseInvoke: () => void = () => undefined;
    mocks.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseInvoke = () => resolve(applied(rows));
      }),
    );

    let handedOver = false;
    const pushed = pushPendingRows(SHOP, () => handedOver);

    // The server said "applied" — but by the time it did, nobody was logged in.
    handedOver = true;
    releaseInvoke();

    expect(await pushed).toBe(false);
    expect(mocks.markSyncRowSent).not.toHaveBeenCalled();
    expect(mocks.markSyncRowTransientFailure).not.toHaveBeenCalled();
    expect(mocks.markSyncRowPermanentFailure).not.toHaveBeenCalled();
  });

  it('leaves cancelled rows pending, and the next login re-sends them intact', async () => {
    const rows = queueRows('a', 2);
    // The DB is the source of truth: rows stay pending precisely because the
    // cancelled push never marked them, so this keeps returning them.
    mocks.listPendingSyncRows.mockReturnValue(rows);

    await pushPendingRows(SHOP, () => true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.markSyncRowSent).not.toHaveBeenCalled();

    // Next login. Same rows, nothing lost, now actually delivered.
    mocks.listPendingSyncRows.mockReturnValueOnce(rows).mockReturnValue([]);
    mocks.invoke.mockResolvedValue(applied(rows));
    const completed = await pushPendingRows(SHOP, () => false);

    expect(completed).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.markSyncRowSent.mock.calls.map((call) => call[0])).toEqual(['a0', 'a1']);
  });

  it('still drains every batch when nobody switches user', async () => {
    const first = queueRows('a', 50);
    const second = queueRows('b', 2);
    mocks.listPendingSyncRows
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValue([]);
    mocks.invoke
      .mockResolvedValueOnce(applied(first))
      .mockResolvedValueOnce(applied(second));

    const completed = await pushPendingRows(SHOP);

    expect(completed).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.markSyncRowSent).toHaveBeenCalledTimes(52);
  });
});
