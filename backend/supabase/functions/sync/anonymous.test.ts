import { beforeEach, describe, expect, it, vi } from 'vitest';

// H-7 H-2. An anonymous session is refused by verifyCallerJwt itself.
//
// It was already closed indirectly — no auth_bindings row means the access
// token carries no app_user_id, so assertCallerCurrent answers 503
// `hook_not_configured` — but that reports an infrastructure fault for what is
// an authorization decision, and it leans on the hosted "Anonymous sign-ins"
// provider toggle, which lives outside this repository. RLS keys on
// app_metadata.shop_id and never inspects is_anonymous, so a linked anonymous
// session would be indistinguishable from a real one.
//
// verifyCallerJwt is the single chokepoint for EVERY authenticated action —
// push, pull, push-group, refund-claim, link-device, recover-pin, billing-*
// and every shop-* multi-shop action are all dispatched through it in
// index.ts. Testing it here therefore covers all of them at once; only
// device-login bypasses it, and it authenticates by phone + PIN instead.

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser } },
  supabaseAnon: { auth: {} },
}));

const { HttpError, verifyCallerJwt } = await import('./_shared/auth.ts');

/**
 * A structurally valid token. The signature is never checked here — GoTrue
 * does that inside getUser, which is mocked — so this only has to survive the
 * base64 decode that runs AFTER the anonymous gate.
 */
function bearer(claims: Record<string, unknown> = {}): Request {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return new Request('https://example.test/sync', {
    method: 'POST',
    headers: { authorization: `Bearer header.${payload}.signature` },
  });
}

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '9f1c0000-0000-4000-8000-000000000001',
    app_metadata: {},
    phone: null,
    phone_confirmed_at: null,
    email: null,
    email_confirmed_at: null,
    is_anonymous: false,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getUser.mockReset();
});

describe('verifyCallerJwt rejects anonymous sessions', () => {
  it('refuses an anonymous caller with a stable code', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: authUser({ is_anonymous: true }) },
      error: null,
    });

    const error = await verifyCallerJwt(bearer({ app_metadata: {} })).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as InstanceType<typeof HttpError>).status).toBe(403);
    expect((error as InstanceType<typeof HttpError>).code).toBe('anonymous_session_rejected');
  });

  it('refuses it BEFORE any claim is read, so a decorated anonymous token gains nothing', async () => {
    // The interesting case is not an empty anonymous session but one whose
    // token already carries a shop. RLS would honour that claim, so the refusal
    // has to precede claim handling entirely rather than depend on it.
    mocks.getUser.mockResolvedValue({
      data: {
        user: authUser({
          is_anonymous: true,
          app_metadata: { shop_id: '11111111-1111-4111-8111-111111111111' },
        }),
      },
      error: null,
    });

    await expect(
      verifyCallerJwt(
        bearer({
          app_metadata: {
            shop_id: '11111111-1111-4111-8111-111111111111',
            app_user_id: '22222222-2222-4222-8222-222222222222',
            principal_user_id: '22222222-2222-4222-8222-222222222222',
            role: 'owner',
            permission_version: 0,
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 403, code: 'anonymous_session_rejected' });
  });

  it('still accepts a normal caller, so the gate is not blanket denial', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: authUser({ is_anonymous: false }) },
      error: null,
    });

    const caller = await verifyCallerJwt(
      bearer({
        app_metadata: {
          shop_id: '11111111-1111-4111-8111-111111111111',
          app_user_id: '22222222-2222-4222-8222-222222222222',
          principal_user_id: '22222222-2222-4222-8222-222222222222',
          role: 'owner',
          permission_version: 3,
        },
      }),
    );
    expect(caller.shopId).toBe('11111111-1111-4111-8111-111111111111');
    expect(caller.appUserId).toBe('22222222-2222-4222-8222-222222222222');
    expect(caller.isAnonymous).toBe(false);
  });

  it('treats a MISSING is_anonymous flag as not anonymous', async () => {
    // Older GoTrue responses omit the field. Refusing on absence would lock out
    // every real user, so the check is strictly `=== true`.
    const user = authUser();
    delete (user as Record<string, unknown>).is_anonymous;
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });

    const caller = await verifyCallerJwt(bearer({ app_metadata: {} }));
    expect(caller.isAnonymous).toBe(false);
  });

  it('keeps rejecting an invalid token before it looks at anonymity at all', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    await expect(verifyCallerJwt(bearer())).rejects.toMatchObject({ status: 401 });
  });
});
