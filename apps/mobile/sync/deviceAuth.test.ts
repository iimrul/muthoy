import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTimingTrace } from '../dev/authTiming';
import { SyncHaltedError } from './invoke';

const SHOP_ID = '8c2f1a30-0000-4000-8000-000000000001';
const USER_ID = '8c2f1a30-0000-4000-8000-000000000002';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  setSession: vi.fn(),
  pullChanges: vi.fn(),
  markShopCloudLinked: vi.fn(),
  clearLocalUserAccessLock: vi.fn(),
  verifyPinForUser: vi.fn(),
  recordSuccessfulLogin: vi.fn(),
  enforceRevocation: vi.fn(),
  login: vi.fn(),
  inspectBinding: vi.fn(),
  inspectAuthority: vi.fn(),
  clearPinAttempts: vi.fn(),
  refreshBillingStatus: vi.fn(),
  epoch: 0,
  session: null as null | { shopId: string; userId: string },
}));

vi.mock('./supabaseClient', () => ({
  requireSupabaseConfiguration: vi.fn(),
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: { setSession: mocks.setSession },
  },
}));

vi.mock('./pull', () => ({ pullChanges: mocks.pullChanges }));
vi.mock('./billing', () => ({ refreshBillingStatus: mocks.refreshBillingStatus }));
vi.mock('./authActorBinding', () => ({
  inspectCloudActorBinding: mocks.inspectBinding,
  assertCloudActorBinding: (binding: { status: string }) => {
    if (binding.status !== 'matched') throw new Error('Cloud actor mismatch');
  },
}));
vi.mock('./revocation', () => ({
  enforceAuthoritativeRevocation: mocks.enforceRevocation,
}));
vi.mock('./sessionAuthority', () => ({
  inspectSessionAuthority: mocks.inspectAuthority,
}));
vi.mock('../db/pinAttemptLock', () => ({
  pinAttemptScope: (shopId: string) => `scope:${shopId}`,
  clearPinAttemptsAfterOwnerRecovery: mocks.clearPinAttempts,
}));
vi.mock('../db/auth', () => ({
  clearLocalUserAccessLock: mocks.clearLocalUserAccessLock,
  markShopCloudLinked: mocks.markShopCloudLinked,
  verifyPinForUser: mocks.verifyPinForUser,
  recordSuccessfulLogin: mocks.recordSuccessfulLogin,
}));
vi.mock('../state/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({ epoch: mocks.epoch, session: mocks.session, login: mocks.login }),
  },
}));

const { loginOnNewDevice, recoverOwnerPin } = await import('./deviceAuth');

beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  vi.clearAllMocks();
  mocks.epoch = 0;
  mocks.session = null;
  mocks.invoke.mockResolvedValue({
    data: {
      shopId: SHOP_ID,
      userId: USER_ID,
      role: 'owner',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    },
    error: null,
  });
  mocks.setSession.mockResolvedValue({ error: null });
  mocks.inspectBinding.mockResolvedValue({
    status: 'matched', actorUserId: USER_ID, shopId: SHOP_ID,
  });
  mocks.pullChanges.mockResolvedValue(undefined);
  mocks.refreshBillingStatus.mockResolvedValue(undefined);
  mocks.markShopCloudLinked.mockResolvedValue(undefined);
  // Truthy: the clear now REPORTS whether the hydrated row justified releasing
  // the lock, and loginDeviceUser refuses the login when it does not.
  mocks.clearLocalUserAccessLock.mockResolvedValue(true);
  mocks.verifyPinForUser.mockResolvedValue({
    shopId: SHOP_ID,
    userId: USER_ID,
    role: 'owner',
    permissions: {},
    principalUserId: USER_ID,
    billingAccountId: 'account-1',
  });
  mocks.recordSuccessfulLogin.mockResolvedValue(undefined);
  mocks.enforceRevocation.mockResolvedValue(true);
  mocks.inspectAuthority.mockResolvedValue({ status: 'confirmed', reason: 'claims_match' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fresh-device auth orchestration', () => {
  it('times but preserves session, hydration, and local bcrypt validation ordering', async () => {
    const stages: string[] = [];
    const timing: AuthTimingTrace = {
      correlationId: '07070707070707070707070707070707',
      flow: 'device_login',
      mark: vi.fn(),
      measure: async <T,>(stage: string, operation: () => Promise<T>) => {
        stages.push(stage);
        return await operation();
      },
    };

    await loginOnNewDevice('01712345678', '1234', timing);

    expect(mocks.invoke).toHaveBeenCalledWith('sync', {
      body: {
        action: 'device-login',
        phone: '+8801712345678',
        pin: '1234',
        _timingId: timing.correlationId,
      },
    });
    expect(stages).toEqual([
      'edge_function_invocation',
      'supabase_session_set',
      'full_hydration',
      'local_enrollment_write',
      'hydrated_exact_user_validation',
    ]);
    expect(mocks.setSession).toHaveBeenCalledBefore(mocks.pullChanges);
    expect(mocks.inspectBinding).toHaveBeenCalledWith({ userId: USER_ID, shopId: SHOP_ID });
    expect(mocks.inspectBinding).toHaveBeenCalledBefore(mocks.pullChanges);
    expect(mocks.pullChanges).toHaveBeenCalledWith(SHOP_ID, null, undefined, timing);
    expect(mocks.pullChanges).toHaveBeenCalledBefore(mocks.refreshBillingStatus);
    expect(mocks.refreshBillingStatus).toHaveBeenCalledWith(
      SHOP_ID,
      undefined,
      { isCurrent: expect.any(Function) },
    );
    expect(mocks.refreshBillingStatus).toHaveBeenCalledBefore(mocks.clearLocalUserAccessLock);
    expect(mocks.pullChanges).toHaveBeenCalledBefore(mocks.clearLocalUserAccessLock);
    expect(mocks.clearLocalUserAccessLock).toHaveBeenCalledWith(SHOP_ID, USER_ID);
    expect(mocks.clearLocalUserAccessLock).toHaveBeenCalledBefore(mocks.verifyPinForUser);
    expect(mocks.pullChanges).toHaveBeenCalledBefore(mocks.markShopCloudLinked);
    expect(mocks.markShopCloudLinked).toHaveBeenCalledBefore(mocks.verifyPinForUser);
    expect(mocks.verifyPinForUser).toHaveBeenCalledWith('1234', SHOP_ID, USER_ID, timing);
    expect(mocks.recordSuccessfulLogin).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
    expect(mocks.recordSuccessfulLogin).toHaveBeenCalledBefore(mocks.login);
    expect(mocks.inspectAuthority).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        shopId: SHOP_ID,
        role: 'owner',
        principalUserId: USER_ID,
        billingAccountId: 'account-1',
      },
      expect.any(Number),
      { allowQuarantineRecovery: true, isCurrent: expect.any(Function) },
    );
    expect(mocks.inspectAuthority).toHaveBeenCalledBefore(mocks.login);
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ cloudActorConfirmed: true }));
  });

  it('refuses hydration when the adopted cloud session names another actor', async () => {
    mocks.inspectBinding.mockResolvedValue({
      status: 'mismatched', actorUserId: 'stale-staff', shopId: SHOP_ID,
    });

    await expect(loginOnNewDevice('01712345678', '1234')).rejects.toThrow(/Cloud actor mismatch/);
    expect(mocks.pullChanges).not.toHaveBeenCalled();
    expect(mocks.clearLocalUserAccessLock).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('locks the exact actor when authoritative revalidation fails before local login', async () => {
    const error = new SyncHaltedError('Plan suspended', 'account_plan_suspended');
    mocks.pullChanges.mockRejectedValue(error);

    await expect(loginOnNewDevice('01712345678', '1234')).rejects.toBe(error);

    expect(mocks.enforceRevocation).toHaveBeenCalledWith(
      SHOP_ID,
      'account_plan_suspended',
      USER_ID,
    );
    expect(mocks.clearLocalUserAccessLock).not.toHaveBeenCalled();
    expect(mocks.verifyPinForUser).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });
});

describe('owner recovery is the only explicit attempt-budget reset', () => {
  it('clears only after local and authoritative identity validation, before login', async () => {
    await recoverOwnerPin('+8801712345678', '2468');
    expect(mocks.clearPinAttempts).toHaveBeenCalledWith(`scope:${SHOP_ID}`);
    expect(mocks.verifyPinForUser).toHaveBeenCalledBefore(mocks.inspectAuthority);
    expect(mocks.inspectAuthority).toHaveBeenCalledBefore(mocks.clearPinAttempts);
    expect(mocks.clearPinAttempts).toHaveBeenCalledBefore(mocks.login);
  });

  it.each([
    ['server refusal', () => mocks.invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 401 } } })],
    ['binding mismatch', () => mocks.inspectBinding.mockResolvedValueOnce({ status: 'mismatched' })],
    ['pull failure', () => mocks.pullChanges.mockRejectedValueOnce(new Error('offline'))],
    ['billing authority failure', () => mocks.refreshBillingStatus.mockRejectedValueOnce(new Error('offline'))],
    ['local exact-user failure', () => mocks.verifyPinForUser.mockResolvedValueOnce(null)],
    ['authority failure', () => mocks.inspectAuthority.mockResolvedValueOnce({ status: 'revoked', reason: 'actor_inactive' })],
  ])('does not clear after %s', async (_label, arrange) => {
    arrange();
    await expect(recoverOwnerPin('+8801712345678', '2468')).rejects.toThrow();
    expect(mocks.clearPinAttempts).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('cannot clear the budget or overwrite a session that arrives during authority recovery', async () => {
    mocks.inspectAuthority.mockImplementationOnce(async () => {
      mocks.epoch += 1;
      mocks.session = { shopId: 'shop-2', userId: 'incoming' };
      return { status: 'confirmed', reason: 'claims_match' };
    });

    await expect(recoverOwnerPin('+8801712345678', '2468')).rejects.toThrow();

    expect(mocks.clearPinAttempts).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.session).toEqual({ shopId: 'shop-2', userId: 'incoming' });
  });
});
