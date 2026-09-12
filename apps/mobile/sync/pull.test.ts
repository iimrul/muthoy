// The pull pagination loops themselves, with only the network and the two
// write boundaries (applyRemoteRows, the MMKV cursor) mocked. A cursor that
// advances after a handover is the worst outcome here: the incoming user then
// never receives the pages the outgoing user's session skipped past.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  // Returns the per-row outcome array the real helper returns; an empty
  // array reads as "nothing deferred", which is the ordinary case.
  applyRemoteRows: vi.fn(() => []),
  purgeUnreadableTables: vi.fn(),
  getLastPulledCursor: vi.fn(),
  setLastPulledCursor: vi.fn(),
  tableNames: [
    'shops', 'subscriptions', 'roles', 'permissions', 'users', 'user_permissions',
    'shop_b2_settings', 'medicines', 'batches', 'batch_promotions',
    'inventory_movements', 'customers', 'sales', 'sale_items', 'sale_drafts',
    'sale_draft_items', 'sale_attachments', 'sale_refunds', 'sales_returns',
    'refund_tenders', 'suppliers', 'purchases', 'purchase_items', 'purchase_returns',
    'credits', 'credit_payment_allocations', 'credit_reconciliation_states',
    'expenses', 'payments', 'cash_drawer', 'inventory_imports', 'audit_logs',
  ],
}));

const CORE_TABLES = [
  'shops', 'subscriptions', 'roles', 'permissions', 'users', 'user_permissions',
  'shop_b2_settings', 'sales', 'sale_items', 'sale_attachments', 'sale_refunds',
  'sales_returns', 'refund_tenders',
];

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: mocks.invoke } },
}));
vi.mock('../db/sync-helpers', () => ({
  applyRemoteRows: mocks.applyRemoteRows,
  purgeUnreadableTables: mocks.purgeUnreadableTables,
  HYDRATION_TABLE_ORDER: mocks.tableNames,
}));
vi.mock('./cursorStore', () => ({
  getLastPulledCursor: mocks.getLastPulledCursor,
  setLastPulledCursor: mocks.setLastPulledCursor,
  clearLastPulledCursor: vi.fn(),
  HYDRATION_TABLE_ORDER: mocks.tableNames,
}));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import { pullChanges } from './pull';

const SHOP = 'shop-1';
const START_CURSOR = { updatedAt: '2026-01-01T00:00:00Z', tableName: 'sales', rowId: 'r0' };

function page(
  rowId: string,
  hasMore: boolean,
  accessVersion = 1,
  access: Record<string, unknown> = {},
) {
  const cursor = { updatedAt: `2026-01-0${rowId.slice(1)}T00:00:00Z`, tableName: 'sales', rowId };
  return {
    data: {
      changes: [{ ...cursor, payload: { id: rowId } }],
      hasMore,
      nextCursor: cursor,
      accessVersion,
      ...access,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLastPulledCursor.mockReturnValue(START_CURSOR);
});

describe('pullChanges honours the device-handover kill switch', () => {
  it('drops the page that arrives after the handover: no apply, no cursor write', async () => {
    let releasePage: () => void = () => undefined;
    mocks.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePage = () => resolve(page('r1', true));
      }),
    );
    mocks.invoke.mockResolvedValue(page('r2', false));

    let handedOver = false;
    const pulled = pullChanges(SHOP, undefined, () => handedOver);

    handedOver = true;
    releasePage();
    await pulled;

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.applyRemoteRows).not.toHaveBeenCalled();
    expect(mocks.setLastPulledCursor).not.toHaveBeenCalled();
  });

  it('does not fetch a further page once cancelled between pages', async () => {
    let handedOver = false;
    mocks.invoke.mockImplementationOnce(() => Promise.resolve(page('r1', true)));
    mocks.invoke.mockImplementation(() => {
      handedOver = true;
      return Promise.resolve(page('r2', true));
    });

    await pullChanges(SHOP, undefined, () => handedOver);

    // Page 1 applied and advanced the cursor under a live session; page 2
    // arrived after the switch, so nothing beyond it was requested.
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.applyRemoteRows).toHaveBeenCalledTimes(1);
    expect(mocks.setLastPulledCursor).toHaveBeenCalledTimes(1);
  });

  it('abandons a full hydration without storing a partial cursor', async () => {
    mocks.getLastPulledCursor.mockReturnValue(null);

    let releasePage: () => void = () => undefined;
    mocks.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePage = () => resolve(page('r1', true));
      }),
    );

    let handedOver = false;
    const pulled = pullChanges(SHOP, undefined, () => handedOver);

    handedOver = true;
    releasePage();
    await pulled;

    // A null cursor next login means the whole hydration runs again, rather
    // than the incoming user inheriting a half-populated shop.
    expect(mocks.applyRemoteRows).not.toHaveBeenCalled();
    expect(mocks.setLastPulledCursor).not.toHaveBeenCalled();
  });

  it('pages through normally when nobody switches user', async () => {
    mocks.invoke
      .mockResolvedValueOnce(page('r1', true))
      .mockResolvedValueOnce(page('r2', false));

    await pullChanges(SHOP);

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.applyRemoteRows).toHaveBeenCalledTimes(2);
    expect(mocks.setLastPulledCursor).toHaveBeenCalledTimes(2);
  });

  it.each([
    [['shops']],
    [['shops', null]],
    [['shops', 7]],
    [['shops', 'shops']],
    [['shops', 'unknown_table']],
  ])('treats malformed readableTables %j as no reconciliation answer', async (readableTables) => {
    mocks.invoke.mockResolvedValue(page('r1', false, 1, {
      readableTables,
      accessUserId: 'user-1',
      saleHistoryScope: 'own',
    }));

    await pullChanges(SHOP);

    expect(mocks.purgeUnreadableTables).not.toHaveBeenCalled();
  });

  it('passes a complete valid access answer to shop-scoped reconciliation', async () => {
    mocks.invoke.mockResolvedValue(page('r1', false, 1, {
      readableTables: CORE_TABLES,
      accessUserId: 'user-1',
      saleHistoryScope: 'own',
    }));

    await pullChanges(SHOP);

    expect(mocks.purgeUnreadableTables).toHaveBeenCalledWith({
      shopId: SHOP,
      actorUserId: 'user-1',
      readableTables: CORE_TABLES,
      saleHistoryScope: 'own',
    });
  });

  it('restarts from page one when access changes during pagination', async () => {
    const accessV1 = {
      readableTables: CORE_TABLES, accessUserId: 'user-1', saleHistoryScope: 'all',
    };
    const accessV2 = {
      readableTables: CORE_TABLES, accessUserId: 'user-1', saleHistoryScope: 'own',
    };
    mocks.invoke
      .mockResolvedValueOnce(page('r1', true, 1, accessV1))
      .mockResolvedValueOnce(page('r2', false, 2))
      .mockResolvedValueOnce(page('r1', true, 2, accessV2))
      .mockResolvedValueOnce(page('r2', false, 2));

    await pullChanges(SHOP);

    expect(mocks.invoke).toHaveBeenCalledTimes(4);
    expect(mocks.invoke.mock.calls[0]?.[1]?.body).toMatchObject({
      since: START_CURSOR, includeAccess: true,
    });
    expect(mocks.invoke.mock.calls[2]?.[1]?.body).toMatchObject({
      since: START_CURSOR, includeAccess: true,
    });
    expect(mocks.purgeUnreadableTables).toHaveBeenCalledTimes(1);
    expect(mocks.purgeUnreadableTables).toHaveBeenCalledWith(expect.objectContaining({
      saleHistoryScope: 'own',
    }));
  });

  it('bounds repeated access-change restarts and halts for revalidation', async () => {
    mocks.invoke
      .mockResolvedValueOnce(page('r1', true, 1))
      .mockResolvedValueOnce(page('r2', false, 2))
      .mockResolvedValueOnce(page('r1', true, 2))
      .mockResolvedValueOnce(page('r2', false, 3));

    await expect(pullChanges(SHOP)).rejects.toMatchObject({
      name: 'SyncHaltedError', code: 'permissions_changed',
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
    expect(mocks.purgeUnreadableTables).not.toHaveBeenCalled();
  });
});
