import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  beginKey: vi.fn(),
  openTarget: vi.fn(),
  hydrate: vi.fn(),
  verifyRecovery: vi.fn(),
  promote: vi.fn(),
  verifyPin: vi.fn(),
  completeKey: vi.fn(),
  activate: vi.fn(),
  closeTarget: vi.fn(),
  releaseLocked: vi.fn(),
}));

vi.mock('./deviceAuth', () => ({
  DeviceLoginError: class DeviceLoginError extends Error {
    readonly isCredentialFailure: boolean;
    constructor(message: string, isCredentialFailure: boolean) {
      super(message);
      this.isCredentialFailure = isCredentialFailure;
    }
  },
  authenticateNewDeviceCredentials: mocks.authenticate,
  hydrateAuthenticatedDevice: mocks.hydrate,
  activateHydratedDevice: mocks.activate,
}));
vi.mock('../db/databaseKey', () => ({
  beginDatabaseKeyRecovery: mocks.beginKey,
  completeDatabaseKeyRecovery: mocks.completeKey,
}));
vi.mock('../db/databaseRecovery', () => ({
  closeDatabaseRecoveryTarget: mocks.closeTarget,
  openDatabaseRecoveryTarget: mocks.openTarget,
  promoteHydratedRecoveryDatabase: mocks.promote,
  releaseLockedRecoveryDatabase: mocks.releaseLocked,
  verifyCurrentRecoveryDatabase: mocks.verifyRecovery,
}));
vi.mock('../db/auth', () => ({ verifyPinForUser: mocks.verifyPin }));

const { recoverDatabaseFromServer } = await import('./databaseRecovery');

const response = {
  shopId: 'shop-1',
  userId: 'user-1',
  role: 'owner',
  accessToken: 'access',
  refreshToken: 'refresh',
};
const local = { shopId: 'shop-1', userId: 'user-1', role: 'owner' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue(response);
  mocks.beginKey.mockResolvedValue('ab'.repeat(32));
  mocks.openTarget.mockResolvedValue('needs-hydration');
  mocks.hydrate.mockResolvedValue(local);
  mocks.verifyPin.mockResolvedValue(local);
  mocks.completeKey.mockResolvedValue(undefined);
  mocks.activate.mockResolvedValue(undefined);
});

describe('missing-key server recovery', () => {
  test('authenticates before touching key or database state', async () => {
    await recoverDatabaseFromServer('01712345678', '1234');

    expect(mocks.authenticate).toHaveBeenCalledBefore(mocks.beginKey);
    expect(mocks.authenticate).toHaveBeenCalledBefore(mocks.openTarget);
    expect(mocks.beginKey).toHaveBeenCalledBefore(mocks.openTarget);
  });

  test('hydrates and verifies the isolated target before promotion', async () => {
    await recoverDatabaseFromServer('01712345678', '1234');

    expect(mocks.hydrate).toHaveBeenCalledWith(
      response,
      '1234',
      undefined,
      expect.objectContaining({ assertLive: expect.any(Function) }),
    );
    expect(mocks.hydrate).toHaveBeenCalledBefore(mocks.verifyRecovery);
    expect(mocks.verifyRecovery).toHaveBeenCalledBefore(mocks.promote);
    expect(mocks.promote).toHaveBeenCalledBefore(mocks.verifyPin);
    expect(mocks.verifyPin).toHaveBeenCalledWith('1234', 'shop-1', 'user-1');
  });

  test('never rotates a key when server authentication fails', async () => {
    const denied = new Error('denied');
    mocks.authenticate.mockRejectedValueOnce(denied);

    await expect(recoverDatabaseFromServer('01712345678', '0000')).rejects.toBe(denied);

    expect(mocks.beginKey).not.toHaveBeenCalled();
    expect(mocks.openTarget).not.toHaveBeenCalled();
  });

  test('keeps locked data and old key material when hydration fails', async () => {
    mocks.hydrate.mockRejectedValueOnce(new Error('network'));

    await expect(recoverDatabaseFromServer('01712345678', '1234')).rejects.toThrow('network');

    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.completeKey).not.toHaveBeenCalled();
    expect(mocks.closeTarget).toHaveBeenCalled();
    expect(mocks.releaseLocked).not.toHaveBeenCalled();
  });

  test('resumes an already-promoted verified recovery without rehydrating', async () => {
    mocks.openTarget.mockResolvedValueOnce('promoted');

    await recoverDatabaseFromServer('01712345678', '1234');

    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.verifyPin).toHaveBeenCalled();
  });

  test('releases locked files only after activation and key finalization', async () => {
    await recoverDatabaseFromServer('01712345678', '1234');

    expect(mocks.verifyPin).toHaveBeenCalledBefore(mocks.activate);
    expect(mocks.activate).toHaveBeenCalledBefore(mocks.completeKey);
    expect(mocks.completeKey).toHaveBeenCalledBefore(mocks.closeTarget);
    expect(mocks.closeTarget).toHaveBeenCalledBefore(mocks.releaseLocked);
    expect(mocks.completeKey).toHaveBeenCalledBefore(mocks.releaseLocked);
  });

  test('keeps locked files if finalization fails after activation', async () => {
    mocks.completeKey.mockRejectedValueOnce(new Error('keystore'));

    await expect(recoverDatabaseFromServer('01712345678', '1234')).rejects.toThrow('keystore');

    expect(mocks.activate).toHaveBeenCalled();
    expect(mocks.releaseLocked).not.toHaveBeenCalled();
  });

  test('post-completion cleanup failure does not trigger a second key rotation', async () => {
    mocks.releaseLocked.mockImplementationOnce(() => {
      throw new Error('cleanup I/O');
    });

    await expect(recoverDatabaseFromServer('01712345678', '1234')).resolves.toBeUndefined();
    expect(mocks.beginKey).toHaveBeenCalledTimes(1);
    expect(mocks.completeKey).toHaveBeenCalledTimes(1);
  });
});
