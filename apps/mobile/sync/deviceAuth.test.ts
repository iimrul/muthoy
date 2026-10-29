import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTimingTrace } from '../dev/authTiming';
import { SyncHaltedError } from './invoke';

const SHOP_ID = '8c2f1a30-0000-4000-8000-000000000001';
const USER_ID = '8c2f1a30-0000-4000-8000-000000000002';
const ACTIVE_SHOP_ID = '8c2f1a30-0000-4000-8000-000000000003';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  setSession: vi.fn(),
  signOutCurrent: vi.fn(),
  signOutMinted: vi.fn(),
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
  recordBoundInstallation: vi.fn(),
  epoch: 0,
  session: null as null | { shopId: string; userId: string },
}));

vi.mock('./supabaseClient', () => ({
  requireSupabaseConfiguration: vi.fn(),
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: {
      setSession: mocks.setSession,
      signOut: mocks.signOutCurrent,
      admin: { signOut: mocks.signOutMinted },
    },
  },
}));

vi.mock('./pull', () => ({ pullChanges: mocks.pullChanges }));
vi.mock('./billing', () => ({ refreshBillingStatus: mocks.refreshBillingStatus }));
vi.mock('./deviceRegistry', async (importOriginal) => {
  const original = await importOriginal<typeof import('./deviceRegistry')>();
  return { ...original, recordBoundInstallation: mocks.recordBoundInstallation };
});
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

const { DeviceLoginError, hydrateAuthenticatedDevice, loginOnNewDevice, recoverOwnerPin } = await import('./deviceAuth');

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
  mocks.signOutMinted.mockResolvedValue({ error: null });
  mocks.inspectBinding.mockResolvedValue({
    status: 'matched', actorUserId: USER_ID, shopId: SHOP_ID,
  });
  mocks.pullChanges.mockResolvedValue(undefined);
  mocks.refreshBillingStatus.mockResolvedValue(undefined);
  mocks.recordBoundInstallation.mockResolvedValue(true);
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
  it.each([false, true])('cancels full hydration at the write boundary after a handover (timing=%s)', async (timed) => {
    const timing = timed ? {
      measure: async <T,>(_stage: string, operation: () => Promise<T>) => operation(),
    } as AuthTimingTrace : undefined;
    mocks.pullChanges.mockImplementationOnce(async (_shopId, _cursor, isCancelled: () => boolean) => {
      expect(isCancelled()).toBe(false);
      mocks.epoch += 1;
      expect(isCancelled()).toBe(true);
    });
    await expect(hydrateAuthenticatedDevice({
      shopId: SHOP_ID, userId: USER_ID, role: 'owner', accessToken: 'access', refreshToken: 'refresh',
    }, '1234', timing)).rejects.toMatchObject({ name: 'StaleSessionError' });
    expect(mocks.refreshBillingStatus).not.toHaveBeenCalled();
    expect(mocks.markShopCloudLinked).not.toHaveBeenCalled();
  });

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
        // A2.3. The installation travels WITH the credential, because there is
        // no enrolment route to call afterwards: registering a device is a
        // consequence of proving a PIN, in the same transaction that binds the
        // session being minted.
        deviceRegistryVersion: 1,
        devicePublicId: expect.any(String),
        platform: expect.any(String),
        model: expect.any(String),
        osVersion: expect.any(String),
        _timingId: timing.correlationId,
      },
    });
    // The completion ORDER, as a single assertion: credential proof, then the
    // server session, then hydration, then the installation secret, then the
    // local access answer, and only then anything that marks this login done.
    expect(stages).toEqual([
      'edge_function_invocation',
      'supabase_session_set',
      'full_hydration',
      'commercial_identity_hydration',
      'device_enrollment_persistence',
      'local_access_unlock',
      'local_enrollment_write',
      'hydrated_exact_user_validation',
    ]);
    expect(mocks.setSession).toHaveBeenCalledBefore(mocks.pullChanges);
    expect(mocks.inspectBinding).toHaveBeenCalledWith({ userId: USER_ID, shopId: SHOP_ID });
    expect(mocks.inspectBinding).toHaveBeenCalledBefore(mocks.pullChanges);
    expect(mocks.pullChanges).toHaveBeenCalledWith(SHOP_ID, null, expect.any(Function), timing);
    expect(mocks.pullChanges).toHaveBeenCalledBefore(mocks.refreshBillingStatus);
    expect(mocks.refreshBillingStatus).toHaveBeenCalledWith(
      SHOP_ID,
      undefined,
      { isCurrent: expect.any(Function) },
    );
    expect(mocks.refreshBillingStatus).toHaveBeenCalledBefore(mocks.clearLocalUserAccessLock);
    expect(mocks.recordBoundInstallation).toHaveBeenCalledWith(
      SHOP_ID,
      expect.objectContaining({ userId: USER_ID }),
      { required: true, expectedActorUserId: USER_ID },
    );
    expect(mocks.refreshBillingStatus).toHaveBeenCalledBefore(mocks.recordBoundInstallation);
    expect(mocks.recordBoundInstallation).toHaveBeenCalledBefore(mocks.clearLocalUserAccessLock);
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

  it('fails closed before local enrollment state when secure secret persistence fails', async () => {
    mocks.recordBoundInstallation.mockRejectedValueOnce(new Error('SQLCipher unavailable'));

    // Still fails closed — the server believes this handset is enrolled while
    // the handset lost the only plaintext copy of its secret, and that must
    // never read as success. What changed is the MESSAGE: a raw SQLCipher fault
    // is not a DeviceLoginError, so the screen rendered it as "Something went
    // wrong. Please try again." and named nothing.
    const failure = await loginOnNewDevice('01712345678', '1234').catch((error) => error);
    expect(failure).toBeInstanceOf(DeviceLoginError);
    expect(failure.message).toContain('securely save this device registration');

    expect(mocks.clearLocalUserAccessLock).not.toHaveBeenCalled();
    expect(mocks.markShopCloudLinked).not.toHaveBeenCalled();
    expect(mocks.verifyPinForUser).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  // The hardware defect, at this level. The mirror write is what used to raise
  // a DeviceRegistryError for a snapshot it had correctly discarded; the screen
  // could only render that as the generic failure, so a completed login looked
  // broken and the person retyped their phone number.
  it('completes the login, exactly once, when the installation is already enrolled', async () => {
    await loginOnNewDevice('01712345678', '1234');

    expect(mocks.recordBoundInstallation).toHaveBeenCalledTimes(1);
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      cloudActorConfirmed: true,
    }));
  });

  it.each([
    ['the commercial projection', () => mocks.refreshBillingStatus, 'confirm your shop plan'],
    ['the local access answer', () => mocks.clearLocalUserAccessLock, 'confirm your access on this device'],
    ['the cloud-link marker', () => mocks.markShopCloudLinked, 'finish setting up this device'],
  ] as const)('names the step instead of a generic failure when %s faults', async (
    _label,
    faultingStep,
    expected,
  ) => {
    faultingStep().mockRejectedValueOnce(new Error('disk I/O error'));

    const failure = await loginOnNewDevice('01712345678', '1234').catch((error) => error);
    expect(failure).toBeInstanceOf(DeviceLoginError);
    expect(failure.message).toContain(expected);
    // Never the raw fault, which would tell a pharmacist nothing and reads as a
    // bug report rather than an instruction.
    expect(failure.message).not.toContain('disk I/O');
    expect(mocks.login).not.toHaveBeenCalled();
  });

  // H-7. clearLocalUserAccessLock is NOT post-auth cleanup whose failure can be
  // shrugged off: a `false` answer is the hydrated server row saying this actor
  // is not live, and releasing the lock or creating a session anyway is exactly
  // the hole the lock exists to close.
  it('still denies an authoritative access refusal, and spends no enrollment on it', async () => {
    mocks.clearLocalUserAccessLock.mockResolvedValueOnce(false);

    const failure = await loginOnNewDevice('01712345678', '1234').catch((error) => error);
    expect(failure).toBeInstanceOf(DeviceLoginError);
    expect(failure.message).toContain('has been revoked');
    expect(failure.isCredentialFailure).toBe(true);

    expect(mocks.markShopCloudLinked).not.toHaveBeenCalled();
    expect(mocks.verifyPinForUser).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });
});

describe('owner recovery is the only explicit attempt-budget reset', () => {
  it('cancels recovery hydration after a handover without marking setup complete', async () => {
    mocks.pullChanges.mockImplementationOnce(async (_shopId, _cursor, isCancelled: () => boolean) => {
      expect(isCancelled()).toBe(false);
      mocks.epoch += 1;
      expect(isCancelled()).toBe(true);
    });
    await expect(recoverOwnerPin('+8801712345678', '2468'))
      .rejects.toMatchObject({ name: 'StaleSessionError' });
    expect(mocks.markShopCloudLinked).not.toHaveBeenCalled();
    expect(mocks.refreshBillingStatus).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('clears at the valid server-success commit point, before session setup', async () => {
    await recoverOwnerPin('+8801712345678', '2468');
    expect(mocks.clearPinAttempts).toHaveBeenCalledWith(`scope:${SHOP_ID}`);
    expect(mocks.invoke).toHaveBeenCalledBefore(mocks.clearPinAttempts);
    expect(mocks.clearPinAttempts).toHaveBeenCalledBefore(mocks.setSession);
    expect(mocks.verifyPinForUser).toHaveBeenCalledBefore(mocks.inspectAuthority);
    expect(mocks.clearPinAttempts).toHaveBeenCalledBefore(mocks.login);
    expect(mocks.signOutMinted).not.toHaveBeenCalled();
  });

  it('sends mandatory A2.3 installation identity with PIN recovery', async () => {
    await recoverOwnerPin('+8801712345678', '2468');
    expect(mocks.invoke).toHaveBeenCalledWith('sync', {
      body: expect.objectContaining({
        action: 'recover-pin',
        deviceRegistryVersion: 1,
        devicePublicId: expect.any(String),
      }),
    });
  });

  it.each([
    ['device_session_unbound', 'Sign in again to relink this device.'],
    ['device_enrollment_held', 'Another active Owner or Manager must approve this device.'],
    ['device_id_required', 'This app installation could not be identified. Restart and try again.'],
  ])('maps %s to an actionable recovery error', async (code, message) => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({ code }), { status: 403 }) },
    });
    await expect(recoverOwnerPin('+8801712345678', '2468')).rejects.toMatchObject({
      message,
      isCredentialFailure: false,
    });
  });

  it('does not clear after a server refusal before PIN commit', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 401 } } });
    await expect(recoverOwnerPin('+8801712345678', '2468')).rejects.toMatchObject({ code: 'otp_required' });
    expect(mocks.clearPinAttempts).not.toHaveBeenCalled();
    expect(mocks.signOutMinted).not.toHaveBeenCalled();
  });

  it.each([
    ['setSession', () => mocks.setSession.mockResolvedValueOnce({ error: new Error('session failed') })],
    ['binding inspection', () => mocks.inspectBinding.mockResolvedValueOnce({ status: 'mismatched' })],
    ['hydration', () => mocks.pullChanges.mockRejectedValueOnce(new Error('offline'))],
    ['plan confirmation', () => mocks.refreshBillingStatus.mockRejectedValueOnce(new Error('offline'))],
    ['device persistence', () => mocks.recordBoundInstallation.mockRejectedValueOnce(new Error('disk fault'))],
    ['setup write', () => mocks.markShopCloudLinked.mockRejectedValueOnce(new Error('disk fault'))],
    ['local verification', () => mocks.verifyPinForUser.mockResolvedValueOnce(null)],
    ['access confirmation', () => mocks.inspectAuthority.mockResolvedValueOnce({ status: 'revoked', reason: 'actor_inactive' })],
    ['final activation', () => mocks.login.mockImplementationOnce(() => { throw new Error('activation failed'); })],
  ] as const)('keeps the PIN committed after %s fails, and revokes only this attempt\'s session', async (_label, arrange) => {
    arrange();
    const failure = await recoverOwnerPin('+8801712345678', '2468').catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ code: 'pin_changed_login_required', recoveryShopId: SHOP_ID });
    expect(mocks.clearPinAttempts).toHaveBeenCalledTimes(1);
    expect(mocks.clearPinAttempts).toHaveBeenCalledWith(`scope:${SHOP_ID}`);
    expect(mocks.clearPinAttempts).toHaveBeenCalledBefore(mocks.setSession);
    expect(mocks.signOutMinted).toHaveBeenCalledTimes(1);
    expect(mocks.signOutMinted).toHaveBeenCalledWith('access-token', 'local');
    expect(mocks.signOutCurrent).not.toHaveBeenCalled();
  });

  // H-5 (DEV, 2026-10-05). recover-pin's refusals used to fall through to
  // "Could not reach the server" — every one of them, right after the owner had
  // paid for the SMS. They are read from the server's stable codes now, then
  // from the status; only a request that got no answer at all is a network
  // failure. None of the unconfirmed/pre-commit failures may refill H-4.
  const answered = (status: number, body?: unknown) => ({
    data: null,
    error: {
      context: new Response(body === undefined ? 'upstream unavailable' : JSON.stringify(body), { status }),
    },
  });
  it.each([
    // Unlike device-login's network failures, recoverPin commits the PIN
    // write before anything else that could still fail — so a lost response
    // here may already have landed it. This reads distinctly from `network`
    // and carries uncertain, not confident-retry, copy (see deviceAuth.ts).
    ['no answer at all (transport failure)', { data: null, error: { context: new TypeError('Network request failed') } }, 'recovery_uncertain'],
    ['a PIN another user of the shop holds', answered(409, { code: 'pin_in_use' }), 'pin_in_use'],
    ['a proof the server calls stale', answered(403, { code: 'otp_required' }), 'otp_required'],
    ['a token the server no longer accepts', answered(401, { error: 'Invalid or expired token' }), 'otp_required'],
    ['a number that cannot recover here', answered(403, { code: 'recovery_refused' }), 'recovery_refused'],
    ['an inactive account', answered(403, { code: 'account_inactive' }), 'recovery_refused'],
    ['an uncoded refusal', answered(403, { error: 'Forbidden' }), 'recovery_refused'],
    ['a revoked device', answered(403, { code: 'device_revoked' }), 'access_revoked'],
    ['a malformed request', answered(400, { code: 'pin_format_invalid' }), 'recovery_failed'],
    ['the server failing', answered(500, { code: 'recovery_failed' }), 'recovery_failed'],
    ['an uncoded server failure', answered(500, { error: 'Internal server error' }), 'recovery_failed'],
    ['a registry outage', answered(503, { code: 'device_gate_unavailable' }), 'recovery_failed'],
    ['a proxy page instead of JSON', answered(502), 'recovery_failed'],
  ])('reads %s as %s, and resets nothing', async (_label, reply, code) => {
    mocks.invoke.mockResolvedValueOnce(reply);
    const failure = await recoverOwnerPin('+8801712345678', '2468').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DeviceLoginError);
    expect(failure).toMatchObject({ code, isCredentialFailure: false });
    expect(mocks.clearPinAttempts).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  // H-5. pin_changed_login_required is the one refusal in the table above
  // that is NOT a refusal: the server has already committed the write, only
  // the automatic sign-in that was supposed to follow it did not finish. It
  // gets the opposite treatment — the budget DOES clear, on the same
  // authority as a full recovery's own clear further up this file — even
  // though, like every other case here, no session is ever set.
  it('clears recovered shop B, never active shop A, after confirmed partial success', async () => {
    mocks.invoke.mockResolvedValueOnce(answered(422, {
      code: 'pin_changed_login_required',
      shopId: ACTIVE_SHOP_ID,
      recoveryShopId: SHOP_ID,
    }));
    const failure = await recoverOwnerPin('+8801712345678', '2468').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DeviceLoginError);
    expect(failure).toMatchObject({
      code: 'pin_changed_login_required',
      isCredentialFailure: false,
      recoveryShopId: SHOP_ID,
    });
    expect(mocks.clearPinAttempts).toHaveBeenCalledWith(`scope:${SHOP_ID}`);
    expect(mocks.clearPinAttempts).not.toHaveBeenCalledWith(`scope:${ACTIVE_SHOP_ID}`);
    expect(mocks.clearPinAttempts).toHaveBeenCalledTimes(1);
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'not-a-uuid'])('never clears H-4 from an unconfirmed target %s', async (recoveryShopId) => {
    mocks.invoke.mockResolvedValueOnce(answered(422, {
      code: 'pin_changed_login_required',
      shopId: ACTIVE_SHOP_ID,
      recoveryShopId,
    }));
    const failure = await recoverOwnerPin('+8801712345678', '2468').catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'recovery_uncertain' });
    expect(mocks.clearPinAttempts).not.toHaveBeenCalled();
  });

  it('does not clear H-4 on a malformed successful response', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { shopId: 'not-a-uuid', userId: USER_ID }, error: null });
    await expect(recoverOwnerPin('+8801712345678', '2468')).rejects.toBeInstanceOf(DeviceLoginError);
    expect(mocks.clearPinAttempts).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.signOutMinted).not.toHaveBeenCalled();
  });

  it.each([
    ['returned error', () => mocks.signOutMinted.mockResolvedValueOnce({ error: new Error('secret response') })],
    ['thrown transport error', () => mocks.signOutMinted.mockRejectedValueOnce(new Error('secret transport'))],
  ] as const)('logs one generic line for mobile %s cleanup without downgrading PIN success', async (_label, arrange) => {
    mocks.pullChanges.mockRejectedValueOnce(new Error('offline'));
    arrange();
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(recoverOwnerPin('+8801712345678', '2468')).rejects.toMatchObject({
        code: 'pin_changed_login_required', recoveryShopId: SHOP_ID,
      });
      expect(report.mock.calls).toEqual([['sync/recover-pin cleanup failed: minted session was not revoked']]);
    } finally {
      report.mockRestore();
    }
    expect(mocks.signOutMinted).toHaveBeenCalledWith('access-token', 'local');
    expect(mocks.signOutCurrent).not.toHaveBeenCalled();
  });

  it('keeps device-login\'s own reading of an unrecognised failure', async () => {
    // The recovery mapping is recovery's: device-login still treats what it
    // cannot name as a connection problem, exactly as before.
    mocks.invoke.mockResolvedValueOnce(answered(500, { error: 'Internal server error' }));
    await expect(loginOnNewDevice('+8801712345678', '2468')).rejects.toMatchObject({ code: 'network' });
  });

  it('clears only the recovered shop and cannot overwrite a later app session', async () => {
    mocks.inspectAuthority.mockImplementationOnce(async () => {
      mocks.epoch += 1;
      mocks.session = { shopId: 'shop-2', userId: 'incoming' };
      return { status: 'confirmed', reason: 'claims_match' };
    });

    await expect(recoverOwnerPin('+8801712345678', '2468')).rejects.toThrow();

    expect(mocks.clearPinAttempts).toHaveBeenCalledWith(`scope:${SHOP_ID}`);
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.session).toEqual({ shopId: 'shop-2', userId: 'incoming' });
    expect(mocks.signOutMinted).toHaveBeenCalledWith('access-token', 'local');
    expect(mocks.signOutCurrent).not.toHaveBeenCalled();
  });
});
