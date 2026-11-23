import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyCurrent: vi.fn(),
  applyLocally: vi.fn(),
  inspectBinding: vi.fn(),
  invoke: vi.fn(),
  refusalCode: vi.fn(),
}));

vi.mock('../db/settings', () => ({
  verifyOwnerCurrentPin: mocks.verifyCurrent,
  applyOwnerPinLocally: mocks.applyLocally,
}));
vi.mock('./authActorBinding', () => ({
  inspectCloudActorBinding: mocks.inspectBinding,
  assertCloudActorBinding: (binding: { status: string }) => {
    if (binding.status !== 'matched') throw new Error('Cloud actor mismatch');
  },
}));
vi.mock('./connectivity', () => ({ hasNetworkConnection: async () => true }));
vi.mock('./invoke', () => ({
  invokeSyncWithClaimRefresh: mocks.invoke,
  syncRefusalCode: mocks.refusalCode,
}));

// eslint-disable-next-line import/first
import { changeOwnerPinEverywhere, OwnerPinChangeError } from './ownerPin';

const SESSION = { shopId: 'shop-a', userId: 'owner-a' };
const ONLINE = { isOnline: async () => true };
const RESULT = { pinSetAt: '2026-11-23T09:15:42.123456+00:00', actorUserIds: ['owner-a', 'owner-b'] };

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  const failure = await promise.then(() => null, (error: unknown) => error);
  expect(failure).toBeInstanceOf(OwnerPinChangeError);
  return (failure as OwnerPinChangeError).reason;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyCurrent.mockResolvedValue(true);
  mocks.applyLocally.mockResolvedValue(2);
  mocks.inspectBinding.mockResolvedValue({ status: 'matched', actorUserId: 'owner-a', shopId: 'shop-a' });
  mocks.invoke.mockResolvedValue({ data: RESULT, error: null });
  mocks.refusalCode.mockResolvedValue(null);
});

describe('changeOwnerPinEverywhere (migration 43)', () => {
  it('asks the server, then mirrors the server\'s PIN onto every owner row it names', async () => {
    await expect(changeOwnerPinEverywhere(SESSION, '4821', '7390', ONLINE)).resolves.toEqual(RESULT);
    expect(mocks.verifyCurrent).toHaveBeenCalledWith('owner-a', '4821');
    expect(mocks.invoke).toHaveBeenCalledWith({
      action: 'owner-pin-change', shopId: 'shop-a', currentPin: '4821', newPin: '7390',
    });
    expect(mocks.verifyCurrent).toHaveBeenCalledBefore(mocks.invoke);
    expect(mocks.applyLocally).toHaveBeenCalledWith(['owner-a', 'owner-b'], '7390', RESULT.pinSetAt);
    expect(mocks.invoke).toHaveBeenCalledBefore(mocks.applyLocally);
  });

  it('refuses a wrong current PIN on the phone, spending no server attempt', async () => {
    mocks.verifyCurrent.mockResolvedValue(false);
    expect(await reasonOf(changeOwnerPinEverywhere(SESSION, '0000', '7390', ONLINE))).toBe('wrong_current');
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.applyLocally).not.toHaveBeenCalled();
  });

  it('needs the internet, and changes nothing without it', async () => {
    const offline = { isOnline: async () => false };
    expect(await reasonOf(changeOwnerPinEverywhere(SESSION, '4821', '7390', offline))).toBe('offline');
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.applyLocally).not.toHaveBeenCalled();
  });

  it('fails a non-owner before any request', async () => {
    mocks.verifyCurrent.mockRejectedValue(new Error('Owner access only'));
    expect(await reasonOf(changeOwnerPinEverywhere(SESSION, '4821', '7390', ONLINE))).toBe('failed');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('never sends a request on a token that names someone else', async () => {
    mocks.inspectBinding.mockResolvedValue({ status: 'mismatched', actorUserId: 'staff-a', shopId: 'shop-a' });
    expect(await reasonOf(changeOwnerPinEverywhere(SESSION, '4821', '7390', ONLINE))).toBe('failed');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['owner_pin_refused', 'wrong_current'],
    ['owner_pin_rate_limited', 'too_many_attempts'],
    ['pin_in_use', 'pin_in_use'],
    ['owner_pin_failed', 'failed'],
    [null, 'failed'],
  ])('words server refusal %s as %s and changes nothing locally', async (code, reason) => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('refused') });
    mocks.refusalCode.mockResolvedValue(code);
    expect(await reasonOf(changeOwnerPinEverywhere(SESSION, '4821', '7390', ONLINE))).toBe(reason);
    expect(mocks.applyLocally).not.toHaveBeenCalled();
  });

  it('treats a malformed server answer as a failure and changes nothing locally', async () => {
    mocks.invoke.mockResolvedValue({ data: { pinSetAt: 5 }, error: null });
    expect(await reasonOf(changeOwnerPinEverywhere(SESSION, '4821', '7390', ONLINE))).toBe('failed');
    expect(mocks.applyLocally).not.toHaveBeenCalled();
  });

  it('still reports success when only the local mirror fails — the server already changed it', async () => {
    mocks.applyLocally.mockRejectedValue(new Error('database locked'));
    await expect(changeOwnerPinEverywhere(SESSION, '4821', '7390', ONLINE)).resolves.toEqual(RESULT);
  });

  it('never puts a PIN in the error it throws', async () => {
    mocks.verifyCurrent.mockResolvedValue(false);
    const failure = await changeOwnerPinEverywhere(SESSION, '4821', '7390', ONLINE).catch((error: Error) => error);
    expect(String((failure as Error).message)).not.toMatch(/4821|7390/);
  });
});
