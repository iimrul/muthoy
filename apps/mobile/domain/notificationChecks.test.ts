import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { expectedCash } from './cashFormula';

const mocks = vi.hoisted(() => ({
  session: { shopId: 'shop-1', userId: 'owner-1', role: 'owner' as 'owner' | 'staff' } as {
    shopId: string;
    userId: string;
    role: 'owner' | 'staff';
  } | null,
  activeRole: 'owner' as 'owner' | 'staff' | null,
  medicines: [] as { medicineId: string; name: string; totalStock: number; threshold: number }[],
  batches: new Map<string, { id: string; medicineId: string; batchNo: string; expiryDate: string | null; quantityAvailable: number; salePrice: number }[]>(),
  rows: [] as { id: string; type: string; severity: string; title: string; body: string; refId: string | null; resolvedAt: string | null }[],
  scheduled: vi.fn(),
  setChannel: vi.fn(),
  getPermissions: vi.fn(async () => ({ granted: true })),
  requestPermissions: vi.fn(async () => ({ granted: true })),
  registerTask: vi.fn(),
  cashInput: {
    openingCash: 10_000,
    cashSales: 5_000,
    creditCollections: 2_000,
    expenses: 1_000,
    refunds: 500,
    supplierPayments: 250,
    withdrawals: 100,
  },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  registerTaskAsync: mocks.registerTask,
}));
vi.mock('expo-task-manager', () => ({
  isTaskDefined: vi.fn(() => false),
  defineTask: vi.fn(),
  isAvailableAsync: vi.fn(async () => true),
  isTaskRegisteredAsync: vi.fn(async () => false),
}));
vi.mock('expo-notifications', () => ({
  AndroidNotificationPriority: { HIGH: 'high' },
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: vi.fn(),
  scheduleNotificationAsync: mocks.scheduled,
  setNotificationChannelAsync: mocks.setChannel,
  getPermissionsAsync: mocks.getPermissions,
  requestPermissionsAsync: mocks.requestPermissions,
}));
vi.mock('../state/sessionStore', () => ({ readPersistedSessionSync: () => mocks.session }));
vi.mock('../db/auth', () => ({ getActiveSessionRole: vi.fn(async () => mocks.activeRole) }));
vi.mock('../db/cash', () => ({ getCashSummary: vi.fn(async () => mocks.cashInput) }));
vi.mock('../db/inventory', () => ({
  listMedicines: vi.fn(async () => mocks.medicines),
  listBatchesForMedicine: vi.fn(async (_shopId: string, medicineId: string) => mocks.batches.get(medicineId) ?? []),
}));
vi.mock('../db/notifications', () => ({
  createNotification: vi.fn(async (_shopId: string, type: string, severity: string, title: string, body: string, refId?: string) => {
    mocks.rows.push({ id: `notification-${mocks.rows.length + 1}`, type, severity, title, body, refId: refId ?? null, resolvedAt: null });
  }),
  createDailySummaryNotification: vi.fn(async (_shopId: string, _userId: string, title: string, body: string, businessDate: string) => {
    mocks.rows.push({ id: `notification-${mocks.rows.length + 1}`, type: 'daily_summary', severity: 'info', title, body, refId: businessDate, resolvedAt: null });
  }),
  findUnresolvedLowStockAlert: vi.fn(async (_shopId: string, medicineId: string) =>
    mocks.rows.find((row) => row.type === 'low_stock' && row.refId === medicineId && row.resolvedAt === null) ?? null),
  resolveLowStockAlert: vi.fn(async (id: string) => {
    const row = mocks.rows.find((candidate) => candidate.id === id);
    if (row) row.resolvedAt = new Date().toISOString();
  }),
  hasExpiryAlert: vi.fn(async (_shopId: string, batchId: string) => mocks.rows.some((row) => row.type === 'expiry' && row.refId === batchId)),
  hasDailySummaryToday: vi.fn(async (_shopId: string, date: string) => mocks.rows.some((row) => row.type === 'daily_summary' && row.refId === date)),
  localBusinessDate: (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
}));

// Mocks must register before the native module's global task definition runs.
// eslint-disable-next-line import/first
import {
  registerNotificationBackgroundTaskAsync,
  requestNotificationPermissionsAsync,
  runNotificationChecks,
} from '../native/notifications';

describe('runNotificationChecks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T20:30:00'));
    mocks.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };
    mocks.activeRole = 'owner';
    mocks.medicines = [];
    mocks.batches.clear();
    mocks.rows.length = 0;
    mocks.scheduled.mockClear();
    mocks.setChannel.mockClear();
    mocks.getPermissions.mockClear();
    mocks.requestPermissions.mockClear();
    mocks.registerTask.mockClear();
  });

  it('creates the Android channel before checking notification permission', async () => {
    await requestNotificationPermissionsAsync();
    expect(mocks.setChannel).toHaveBeenCalledWith('muthoy-alerts', { name: 'Muthoy alerts', importance: 4 });
    expect(mocks.setChannel.mock.invocationCallOrder[0]).toBeLessThan(mocks.getPermissions.mock.invocationCallOrder[0]!);
  });

  it('registers the shared task without requesting notification permission', async () => {
    await registerNotificationBackgroundTaskAsync();
    expect(mocks.registerTask).toHaveBeenCalledOnce();
    expect(mocks.registerTask).toHaveBeenCalledWith('com.expo.modules.backgroundtask.processing', { minimumInterval: 15 });
  });

  it('creates once while low, silently re-arms on recovery, then fires on a second drop', async () => {
    mocks.medicines = [{ medicineId: 'med-1', name: 'Napa', totalStock: 4, threshold: 5 }];
    await runNotificationChecks('shop-1');
    await runNotificationChecks('shop-1');
    expect(mocks.rows.filter((row) => row.type === 'low_stock')).toHaveLength(1);
    expect(mocks.setChannel.mock.invocationCallOrder[0]).toBeLessThan(mocks.scheduled.mock.invocationCallOrder[0]!);

    mocks.medicines[0]!.totalStock = 5;
    await runNotificationChecks('shop-1');
    expect(mocks.rows[0]!.resolvedAt).not.toBeNull();

    mocks.medicines[0]!.totalStock = 4;
    await runNotificationChecks('shop-1');
    expect(mocks.rows.filter((row) => row.type === 'low_stock')).toHaveLength(2);
  });

  it('deduplicates expiry alerts and uses the real date for critical severity', async () => {
    mocks.medicines = [{ medicineId: 'med-1', name: 'Napa', totalStock: 10, threshold: 5 }];
    mocks.batches.set('med-1', [
      { id: 'batch-1', medicineId: 'med-1', batchNo: 'B1', expiryDate: '2026-08-19', quantityAvailable: 10, salePrice: 1000 },
      { id: 'batch-null', medicineId: 'med-1', batchNo: 'B2', expiryDate: null, quantityAvailable: 10, salePrice: 1000 },
    ]);
    await runNotificationChecks('shop-1');
    await runNotificationChecks('shop-1');
    const expiryRows = mocks.rows.filter((row) => row.type === 'expiry');
    expect(expiryRows).toHaveLength(1);
    expect(expiryRows[0]!.severity).toBe('critical');
    expect(expiryRows[0]!.body).toContain('expires in 7 days');
  });

  it('never creates a cash summary for staff, but creates one owner row per day', async () => {
    mocks.session = { shopId: 'shop-1', userId: 'staff-1', role: 'staff' };
    mocks.activeRole = 'staff';
    await runNotificationChecks('shop-1');
    expect(mocks.rows.filter((row) => row.type === 'daily_summary')).toHaveLength(0);

    mocks.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };
    mocks.activeRole = 'owner';
    await runNotificationChecks('shop-1');
    await runNotificationChecks('shop-1');
    const dailyRows = mocks.rows.filter((row) => row.type === 'daily_summary');
    expect(dailyRows).toHaveLength(1);
    expect(dailyRows[0]!.body).toBe(`Expected cash in drawer: ${formatMoney(expectedCash({
      openingCash: asPaisa(mocks.cashInput.openingCash),
      cashSales: asPaisa(mocks.cashInput.cashSales),
      creditCollections: asPaisa(mocks.cashInput.creditCollections),
      expenses: asPaisa(mocks.cashInput.expenses),
      refunds: asPaisa(mocks.cashInput.refunds),
      supplierPayments: asPaisa(mocks.cashInput.supplierPayments),
      withdrawals: asPaisa(mocks.cashInput.withdrawals),
    }))}`);
  });

  it('skips all checks when the persisted session does not match the shop', async () => {
    mocks.session = { shopId: 'shop-2', userId: 'owner-2', role: 'owner' };
    await runNotificationChecks('shop-1');
    expect(mocks.rows).toHaveLength(0);
  });
});
