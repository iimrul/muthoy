import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTimingTrace } from '../dev/authTiming';

const SHOP_ID = '8c2f1a30-0000-4000-8000-000000000001';
const USER_ID = '8c2f1a30-0000-4000-8000-000000000002';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  setSession: vi.fn(),
  pullChanges: vi.fn(),
  markShopCloudLinked: vi.fn(),
  verifyPinForUser: vi.fn(),
  login: vi.fn(),
}));

vi.mock('./supabaseClient', () => ({
  requireSupabaseConfiguration: vi.fn(),
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: { setSession: mocks.setSession },
  },
}));

vi.mock('./pull', () => ({ pullChanges: mocks.pullChanges }));
vi.mock('../db/auth', () => ({
  markShopCloudLinked: mocks.markShopCloudLinked,
  verifyPinForUser: mocks.verifyPinForUser,
}));
vi.mock('../state/sessionStore', () => ({
  useSessionStore: { getState: () => ({ login: mocks.login }) },
}));

const { loginOnNewDevice } = await import('./deviceAuth');

beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  vi.clearAllMocks();
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
  mocks.pullChanges.mockResolvedValue(undefined);
  mocks.markShopCloudLinked.mockResolvedValue(undefined);
  mocks.verifyPinForUser.mockResolvedValue({
    shopId: SHOP_ID,
    userId: USER_ID,
    role: 'owner',
    permissions: {},
  });
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
    expect(mocks.pullChanges).toHaveBeenCalledWith(SHOP_ID, null, undefined, timing);
    expect(mocks.pullChanges).toHaveBeenCalledBefore(mocks.markShopCloudLinked);
    expect(mocks.markShopCloudLinked).toHaveBeenCalledBefore(mocks.verifyPinForUser);
    expect(mocks.verifyPinForUser).toHaveBeenCalledWith('1234', SHOP_ID, USER_ID, timing);
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
  });
});
