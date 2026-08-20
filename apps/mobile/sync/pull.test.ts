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
  getLastPulledCursor: vi.fn(),
  setLastPulledCursor: vi.fn(),
}));

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: mocks.invoke } },
}));
vi.mock('../db/sync-helpers', () => ({
  applyRemoteRows: mocks.applyRemoteRows,
  HYDRATION_TABLE_ORDER: ['medicines', 'sales'],
}));
vi.mock('./cursorStore', () => ({
  getLastPulledCursor: mocks.getLastPulledCursor,
  setLastPulledCursor: mocks.setLastPulledCursor,
  clearLastPulledCursor: vi.fn(),
  HYDRATION_TABLE_ORDER: ['medicines', 'sales'],
}));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import { pullChanges } from './pull';

const SHOP = 'shop-1';
const START_CURSOR = { updatedAt: '2026-01-01T00:00:00Z', tableName: 'sales', rowId: 'r0' };

function page(rowId: string, hasMore: boolean) {
  const cursor = { updatedAt: `2026-01-0${rowId.slice(1)}T00:00:00Z`, tableName: 'sales', rowId };
  return {
    data: {
      changes: [{ ...cursor, payload: { id: rowId } }],
      hasMore,
      nextCursor: cursor,
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
});
