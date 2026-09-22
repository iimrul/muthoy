import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  local: vi.fn(),
  reachability: vi.fn(),
  refreshSession: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('../db/auth', () => ({ readLocalActorAuthority: mocks.local }));
vi.mock('./connectivity', () => ({ networkReachability: mocks.reachability }));
vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { refreshSession: mocks.refreshSession, getSession: mocks.getSession } },
}));

const { __resetMMKVStores } = await import('../db/test/react-native-mmkv');
const {
  confirmSessionAuthority,
  quarantineSessionAuthority,
  readSessionAuthorityLease,
} = await import('./sessionAuthorityStore');
const { inspectSessionAuthority } = await import('./sessionAuthority');

const SESSION = {
  userId: 'actor-1', shopId: 'shop-1', role: 'staff',
  principalUserId: 'principal-1', billingAccountId: 'account-1',
};
const NOW = 1_800_000_000_000;
const metadata = {
  app_user_id: 'actor-1', principal_user_id: 'principal-1', shop_id: 'shop-1',
  role: 'staff', permission_version: 3, billing_account_id: 'account-1', is_active: true,
};
const token = (body: Record<string, unknown> = metadata) => {
  const payload = Buffer.from(JSON.stringify({ app_metadata: body, iat: 1_800_000_000 }))
    .toString('base64url');
  return `header.${payload}.sig`;
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetMMKVStores();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  mocks.local.mockResolvedValue({
    userId: 'actor-1', shopId: 'shop-1', roleName: 'staff', permissionVersion: 3,
    isActive: true, isDeleted: false, isAccessLocked: false,
    principalUserId: 'principal-1', billingAccountId: 'account-1',
  });
  mocks.reachability.mockResolvedValue('online');
  mocks.refreshSession.mockResolvedValue({
    data: { session: { access_token: token() } }, error: null,
  });
});

describe('fresh authoritative session reconciliation', () => {
  it('requires online refresh when no trusted anchor exists', async () => {
    mocks.reachability.mockResolvedValueOnce('offline');
    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'unverified', reason: 'authority_absent',
    });
    expect(mocks.refreshSession).not.toHaveBeenCalled();

    mocks.reachability.mockResolvedValueOnce('online');
    await expect(inspectSessionAuthority(SESSION, NOW + 1)).resolves.toEqual({
      status: 'confirmed', reason: 'claims_match',
    });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid', record: { confirmedAtMs: NOW + 1, quarantineReason: null },
    });
  });

  it('uses refreshSession, never stale cached getSession claims', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: token({
      ...metadata, role: 'owner',
    }) } } });
    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toMatchObject({ status: 'confirmed' });
    expect(mocks.refreshSession).toHaveBeenCalledOnce();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('cannot clear quarantine through routine refresh, only recovery/re-link', async () => {
    quarantineSessionAuthority('shop-1', 'actor-1', 'actor_mismatch', NOW - 1);
    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'revoked', reason: 'authority_quarantined',
    });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid', record: { quarantineReason: 'authority_quarantined' },
    });

    await expect(inspectSessionAuthority(
      SESSION,
      NOW + 1,
      { allowQuarantineRecovery: true },
    )).resolves.toEqual({ status: 'confirmed', reason: 'claims_match' });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid', record: { quarantineReason: null, confirmedAtMs: NOW + 1 },
    });
  });

  it('quarantines incomplete authoritative claims', async () => {
    mocks.refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: token({ ...metadata, billing_account_id: undefined }) } },
      error: null,
    });
    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'revoked', reason: 'claims_incomplete',
    });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid', record: { quarantineReason: 'claims_incomplete' },
    });
  });

  it.each([
    ['transport', { name: 'AuthRetryableFetchError', message: 'request failed' }, 'refresh_transport_failure'],
    ['provider 503', { name: 'AuthApiError', status: 503, code: 'unexpected_failure' }, 'refresh_provider_temporary_failure'],
    ['provider rate limit', { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit' }, 'refresh_provider_temporary_failure'],
    ['missing local session', { name: 'AuthSessionMissingError' }, 'refresh_session_missing'],
    ['unknown provider error', { name: 'AuthApiError', status: 401, code: 'new_provider_code', message: 'secret detail' }, 'refresh_unknown_failure'],
  ])('keeps %s refresh failures retryable and never quarantines them', async (
    _label,
    error,
    diagnostic,
  ) => {
    confirmSessionAuthority('shop-1', 'actor-1', NOW - 1);
    mocks.refreshSession.mockResolvedValueOnce({ data: { session: null }, error });

    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'unverified', reason: 'authority_refresh_unavailable',
    });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid', record: { quarantineReason: null, confirmedAtMs: NOW - 1 },
    });
    expect(console.info).toHaveBeenCalledWith(`[session-authority:refresh] ${diagnostic}`);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('secret detail');
  });

  it('treats a success response without a session as unavailable, not revocation', async () => {
    confirmSessionAuthority('shop-1', 'actor-1', NOW - 1);
    mocks.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: null });

    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'unverified', reason: 'authority_refresh_unavailable',
    });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid', record: { quarantineReason: null },
    });
    expect(console.info).toHaveBeenCalledWith(
      '[session-authority:refresh] refresh_response_missing_session',
    );
  });

  it('keeps thrown unknown refresh failures retryable without persisting their details', async () => {
    mocks.refreshSession.mockRejectedValueOnce(new Error('credential-shaped secret'));
    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'unverified', reason: 'authority_refresh_unavailable',
    });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toEqual({
      status: 'absent', record: null,
    });
    expect(console.info).toHaveBeenCalledWith(
      '[session-authority:refresh] refresh_unknown_failure',
    );
    expect(JSON.stringify(vi.mocked(console.info).mock.calls))
      .not.toContain('credential-shaped secret');
  });

  it('cannot turn malformed local authority into quarantine when refresh is unavailable', async () => {
    mocks.local.mockResolvedValueOnce({
      userId: 'actor-1', shopId: 'shop-1', roleName: null, permissionVersion: 3,
      isActive: true, isDeleted: false, isAccessLocked: false,
      principalUserId: null, billingAccountId: null,
    });
    mocks.refreshSession.mockRejectedValueOnce(new Error('temporary provider failure'));

    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'unverified', reason: 'authority_refresh_unavailable',
    });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toEqual({
      status: 'absent', record: null,
    });
  });

  it('keeps a reachability probe failure retryable and does not call the provider', async () => {
    mocks.reachability.mockRejectedValueOnce(new Error('native probe failed'));
    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'unverified', reason: 'authority_refresh_unavailable',
    });
    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toEqual({
      status: 'absent', record: null,
    });
    expect(console.info).toHaveBeenCalledWith(
      '[session-authority:refresh] refresh_transport_failure',
    );
  });

  it.each([
    ['refresh_token_not_found', 'refresh_denied_refresh_token_not_found'],
    ['refresh_token_already_used', 'refresh_denied_refresh_token_already_used'],
    ['session_expired', 'refresh_denied_session_expired'],
    ['session_not_found', 'refresh_denied_session_not_found'],
    ['user_banned', 'refresh_denied_user_banned'],
    ['user_not_found', 'refresh_denied_user_not_found'],
  ])('quarantines explicit authoritative denial %s', async (code, diagnostic) => {
    mocks.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { name: 'AuthApiError', status: 400, code },
    });

    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'revoked', reason: 'auth_session_invalid',
    });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid', record: { quarantineReason: 'auth_session_invalid' },
    });
    expect(console.info).toHaveBeenCalledWith(`[session-authority:refresh] ${diagnostic}`);
  });

  it('does not quarantine inability to read local authority', async () => {
    mocks.local.mockRejectedValueOnce(new Error('database busy'));
    await expect(inspectSessionAuthority(SESSION, NOW)).resolves.toEqual({
      status: 'unverified', reason: 'authority_read_failed',
    });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toEqual({
      status: 'absent', record: null,
    });
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it('does not persist a stale same-actor verdict after the requesting epoch changes', async () => {
    confirmSessionAuthority('shop-1', 'actor-1', NOW - 10);
    let resolveRefresh!: (value: unknown) => void;
    mocks.refreshSession.mockReturnValueOnce(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    let current = true;

    const inspection = inspectSessionAuthority(SESSION, NOW, { isCurrent: () => current });
    await vi.waitFor(() => expect(mocks.refreshSession).toHaveBeenCalledOnce());
    current = false;
    resolveRefresh({
      data: { session: { access_token: token({ ...metadata, role: 'owner' }) } },
      error: null,
    });

    await expect(inspection).resolves.toEqual({ status: 'revoked', reason: 'role_mismatch' });
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid',
      record: { confirmedAtMs: NOW - 10, quarantineReason: null },
    });
  });
});
