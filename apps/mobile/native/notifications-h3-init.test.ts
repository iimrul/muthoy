import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  readSession: vi.fn(),
  listMedicines: vi.fn(),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

vi.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 'success', Failed: 'failed' },
  registerTaskAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 1 },
  AndroidNotificationPriority: { HIGH: 1 },
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
}));
vi.mock('expo-task-manager', () => ({
  isTaskDefined: vi.fn(() => true),
  defineTask: vi.fn(),
  isAvailableAsync: vi.fn(async () => true),
}));
vi.mock('../db/init', () => ({ ensureDatabaseInitialized: mocks.ensure }));
vi.mock('../state/sessionStore', () => ({ readPersistedSessionSync: mocks.readSession }));
vi.mock('../state/notificationPreferencesStore', () => ({
  readNotificationPreferences: () => ({
    all: false,
    stock: false,
    expiry: false,
    dailyCash: false,
    credit: false,
  }),
}));
vi.mock('../db/inventory', () => ({
  listMedicines: mocks.listMedicines,
  listBatchesForMedicine: vi.fn(),
}));

const { runNotificationChecks } = await import('./notifications');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ shopId: 'shop-1', userId: 'user-1', role: 'owner' });
  mocks.listMedicines.mockResolvedValue([]);
});

describe('headless encrypted database initialization', () => {
  test('does no database work when initialization fails', async () => {
    mocks.ensure.mockRejectedValueOnce(new Error('locked'));

    await expect(runNotificationChecks('shop-1')).resolves.toBeUndefined();

    expect(mocks.ensure).toHaveBeenCalledTimes(1);
    expect(mocks.listMedicines).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith('notification-check-failed:database-init');
  });

  test('a later headless wake retries initialization', async () => {
    mocks.ensure
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);

    await runNotificationChecks('shop-1');
    await runNotificationChecks('shop-1');

    expect(mocks.ensure).toHaveBeenCalledTimes(2);
  });
});
