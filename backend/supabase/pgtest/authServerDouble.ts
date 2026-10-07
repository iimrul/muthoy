import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Harness } from './harness';

// backend/supabase/pgtest/authServerDouble.ts — GoTrue's HTTP surface, as far
// as session revocation and PIN recovery reach, answered from the harness's
// REAL auth tables.
//
// Not a mock of the call under test. supabase-js and auth-js run unmodified and
// send exactly the requests they send to a hosted project; this answers them
// the way GoTrue (supabase/auth) does, reading and writing auth.users,
// auth.sessions, auth.refresh_tokens and auth.mfa_amr_claims in the same
// Postgres the migrations ran in, and decorating every token it mints through
// the real public.custom_access_token_hook. What those requests do not reach —
// rate limits, the audit log, email, the SMS hook — is left out.
//
// Behaviour that matters here, from GoTrue and from the hosted DEV project
// (2026-10-05):
//   - a bearer that is not a JWT → 403 bad_jwt "invalid JWT: unable to parse
//     or verify signature, token is malformed: …" — DEV's exact answer to
//     `auth.admin.signOut(<user id>, "global")`;
//   - a JWT whose session no longer exists → 403 session_not_found;
//   - /logout?scope=global deletes every session of the token's own user;
//   - a refresh token whose row is gone → 400 refresh_token_not_found.

export const AUTH_ORIGIN = 'http://auth.double.test';
export const SERVICE_ROLE_KEY = 'service-role-key-of-the-double';
export const ANON_KEY = 'anon-key-of-the-double';
const BASE = `${AUTH_ORIGIN}/auth/v1`;
const ACCESS_TOKEN_SECONDS = 3600;

type Json = Record<string, unknown>;

/** One request, as GoTrue saw it. Never the token itself. */
export interface AuthCall {
  method: string;
  /** Below /auth/v1, query included. */
  path: string;
  bearer: 'service_role' | 'anon' | 'jwt' | 'not_a_jwt' | 'none';
  /** For a verified JWT: whose, and which session it named. */
  sub?: string;
  sessionId?: string;
}

class GoTrueError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export class AuthServerDouble {
  readonly calls: AuthCall[] = [];
  /**
   * Makes the next /logout fail the way an unavailable GoTrue would — every
   * scope by default, or only a named one. A single recoverPin call can
   * reach /logout twice, with two different scopes (the pre-write account-
   * wide one, then a post-write cleanup scoped to just the session it
   * minted); naming a scope targets one without also failing the other.
   */
  failNextLogout: { status: number; code: string; scope?: 'global' | 'local' | 'others' } | null = null;
  /** A transport rejection, which auth-js throws instead of returning AuthError. */
  throwNextLogoutScope: 'global' | 'local' | 'others' | null = null;
  /** Makes the next /admin/generate_link fail the way an unavailable GoTrue would. */
  failNextGenerateLink: { status: number; code: string } | null = null;
  private readonly secret = randomBytes(32);
  private readonly links = new Map<string, string>();

  constructor(
    private readonly h: Harness,
    /** Shared with the REST double, so a test can assert cross-service order. */
    private readonly events: string[] = [],
  ) {}

  /** A GoTrue user, as an OTP sign-up or the admin API would leave it. */
  async createUser(user: { id?: string; phone?: string | null; email?: string | null }): Promise<string> {
    const id = user.id ?? randomUUID();
    const now = new Date().toISOString();
    await this.h.db.query(
      `insert into auth.users (id, aud, role, email, phone, email_confirmed_at, phone_confirmed_at,
                               raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ($1, 'authenticated', 'authenticated', $2, $3, $4, $5, '{}'::jsonb, '{}'::jsonb, $6, $6)`,
      [id, user.email ?? null, user.phone ?? null, user.email ? now : null, user.phone ? now : null, now],
    );
    await this.h.db.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
       values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text), $2::text, $3::timestamptz, $3::timestamptz)`,
      [id, user.phone ? 'phone' : 'email', now],
    );
    return id;
  }

  /**
   * A session as GoTrue's /verify leaves one after a code was accepted —
   * `method` is the AMR it records (`otp` for an SMS code).
   */
  async signIn(
    userId: string,
    method = 'otp',
    authenticatedAt = new Date(),
  ): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
    const sessionId = randomUUID();
    const at = authenticatedAt.toISOString();
    await this.h.db.query(
      'insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, $3, $3)',
      [sessionId, userId, at],
    );
    await this.h.db.query(
      `insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
       values ($1, $2, $3, $3, $4)`,
      [randomUUID(), sessionId, at, method],
    );
    const refreshToken = await this.issueRefreshToken(userId, sessionId, null);
    return { accessToken: await this.accessToken(userId, sessionId), refreshToken, sessionId };
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.startsWith('/auth/v1') ? url.pathname.slice('/auth/v1'.length) : url.pathname;
    const call: AuthCall = { method, path: `${path}${url.search}`, bearer: 'none' };
    this.calls.push(call);
    try {
      if (path === '/logout' && this.throwNextLogoutScope === url.searchParams.get('scope')) {
        this.throwNextLogoutScope = null;
        throw new TypeError('Network request failed');
      }
      const headers = new Headers(init.headers);
      const bearer = /^Bearer\s+(.+)$/i.exec(headers.get('authorization') ?? '')?.[1] ?? null;
      const body = typeof init.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) as Json : {};
      return await this.route(method, path, url, bearer, body, call);
    } catch (error) {
      if (error instanceof GoTrueError) {
        return Response.json({ code: error.status, error_code: error.code, msg: error.message }, { status: error.status });
      }
      throw error;
    }
  };

  private async route(method: string, path: string, url: URL, bearer: string | null, body: Json, call: AuthCall) {
    if (method === 'GET' && path === '/user') {
      const { sub } = await this.requireSession(bearer, call);
      return Response.json(await this.userJson(sub));
    }
    if (method === 'POST' && path === '/logout') {
      return this.logout(bearer, url.searchParams.get('scope') ?? 'global', call);
    }
    if (method === 'POST' && path === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      this.classify(bearer, call);
      return Response.json(await this.refresh(String(body.refresh_token ?? '')));
    }
    if (method === 'POST' && path === '/admin/generate_link') {
      this.requireServiceRole(bearer, call);
      return Response.json(await this.generateLink(body));
    }
    if (method === 'POST' && path === '/verify') {
      this.classify(bearer, call);
      return Response.json(await this.verifyTokenHash(body));
    }
    const userPath = /^\/admin\/users\/([0-9a-f-]{36})$/.exec(path);
    if (method === 'PUT' && userPath) {
      this.requireServiceRole(bearer, call);
      return Response.json(await this.updateUser(userPath[1], body));
    }
    throw new GoTrueError(404, 'not_found', `the double does not serve ${method} ${path}`);
  }

  private classify(bearer: string | null, call: AuthCall): void {
    call.bearer = bearer === null ? 'none'
      : bearer === SERVICE_ROLE_KEY ? 'service_role'
        : bearer === ANON_KEY ? 'anon'
          : bearer.split('.').length === 3 ? 'jwt' : 'not_a_jwt';
  }

  private requireServiceRole(bearer: string | null, call: AuthCall): void {
    this.classify(bearer, call);
    if (bearer !== SERVICE_ROLE_KEY) {
      throw new GoTrueError(403, 'not_admin', 'User not allowed');
    }
  }

  /** GoTrue's requireAuthentication: a valid JWT, and the session it names must still exist. */
  private async requireSession(bearer: string | null, call: AuthCall): Promise<{ sub: string; sessionId: string }> {
    this.classify(bearer, call);
    const claims = this.verifyJwt(bearer ?? '');
    const sub = String(claims.sub);
    const sessionId = String(claims.session_id);
    call.sub = sub;
    call.sessionId = sessionId;
    const { rows } = await this.h.db.query('select 1 from auth.sessions where id = $1', [sessionId]);
    if (rows.length === 0) {
      throw new GoTrueError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
    }
    return { sub, sessionId };
  }

  private async logout(bearer: string | null, scope: string, call: AuthCall): Promise<Response> {
    const { sub, sessionId } = await this.requireSession(bearer, call);
    if (this.failNextLogout && (this.failNextLogout.scope ?? scope) === scope) {
      const { status, code } = this.failNextLogout;
      this.failNextLogout = null;
      throw new GoTrueError(status, code, 'logout failed');
    }
    // models.Logout / LogoutSession / LogoutAllExceptMe. Refresh tokens and
    // AMR claims go with their sessions through the cascade.
    if (scope === 'local') {
      await this.h.db.query('delete from auth.sessions where id = $1', [sessionId]);
    } else if (scope === 'others') {
      await this.h.db.query('delete from auth.sessions where user_id = $1 and id <> $2', [sub, sessionId]);
    } else {
      await this.h.db.query('delete from auth.sessions where user_id = $1', [sub]);
    }
    this.events.push(`auth:logout:${scope}`);
    return new Response(null, { status: 204 });
  }

  private async refresh(token: string): Promise<Json> {
    const { rows } = await this.h.db.query<{ id: number; user_id: string; revoked: boolean; session_id: string | null }>(
      'select id, user_id, revoked, session_id from auth.refresh_tokens where token = $1',
      [token],
    );
    const row = rows[0];
    if (!row || row.session_id === null) {
      throw new GoTrueError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
    }
    if (row.revoked) {
      throw new GoTrueError(400, 'refresh_token_already_used', 'Invalid Refresh Token: Already Used');
    }
    await this.h.db.query('update auth.refresh_tokens set revoked = true, updated_at = now() where id = $1', [row.id]);
    const next = await this.issueRefreshToken(row.user_id, row.session_id, token);
    this.events.push('auth:refresh');
    return this.sessionJson(row.user_id, row.session_id, next);
  }

  private async generateLink(body: Json): Promise<Json> {
    if (this.failNextGenerateLink) {
      const { status, code } = this.failNextGenerateLink;
      this.failNextGenerateLink = null;
      throw new GoTrueError(status, code, 'generate_link failed');
    }
    if (body.type !== 'magiclink' || typeof body.email !== 'string') {
      throw new GoTrueError(400, 'validation_failed', 'only magic links are served by the double');
    }
    const { rows } = await this.h.db.query<{ id: string }>('select id from auth.users where email = $1', [body.email]);
    if (!rows[0]) throw new GoTrueError(404, 'user_not_found', 'User not found');
    const hashed = randomBytes(28).toString('hex');
    this.links.set(hashed, rows[0].id);
    this.events.push('auth:generate_link');
    return {
      ...(await this.userJson(rows[0].id)),
      action_link: `${BASE}/verify?token=${hashed}&type=magiclink`,
      email_otp: '000000',
      hashed_token: hashed,
      redirect_to: AUTH_ORIGIN,
      verification_type: 'magiclink',
    };
  }

  private async verifyTokenHash(body: Json): Promise<Json> {
    const userId = this.links.get(String(body.token_hash ?? ''));
    if (!userId) throw new GoTrueError(403, 'otp_expired', 'Email link is invalid or has expired');
    this.links.delete(String(body.token_hash));
    const session = await this.signIn(userId, 'magiclink');
    this.events.push('auth:verify');
    return this.sessionJson(userId, session.sessionId, session.refreshToken);
  }

  private async updateUser(id: string, body: Json): Promise<Json> {
    if (typeof body.email === 'string') {
      const taken = await this.h.db.query('select 1 from auth.users where email = $1 and id <> $2', [body.email, id]);
      if (taken.rows.length > 0) {
        throw new GoTrueError(422, 'email_exists', 'A user with this email address has already been registered');
      }
      await this.h.db.query(
        `update auth.users set email = $2::text,
                email_confirmed_at = case when $3::boolean then coalesce(email_confirmed_at, now()) else email_confirmed_at end,
                updated_at = now()
         where id = $1::uuid`,
        [id, body.email, body.email_confirm === true],
      );
    }
    this.events.push('auth:update_user');
    return this.userJson(id);
  }

  private async issueRefreshToken(userId: string, sessionId: string, parent: string | null): Promise<string> {
    const token = randomBytes(12).toString('base64url');
    await this.h.db.query(
      `insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, parent, session_id)
       values ($1, $2, false, now(), now(), $3, $4)`,
      [token, userId, parent, sessionId],
    );
    return token;
  }

  private async userJson(id: string): Promise<Json> {
    const { rows } = await this.h.db.query<Json>(
      `select id, aud, role, email, phone, email_confirmed_at, phone_confirmed_at,
              raw_app_meta_data as app_metadata, raw_user_meta_data as user_metadata,
              is_anonymous, created_at, updated_at
       from auth.users where id = $1`,
      [id],
    );
    if (!rows[0]) throw new GoTrueError(404, 'user_not_found', 'User not found');
    return JSON.parse(JSON.stringify(rows[0])) as Json;
  }

  private async sessionJson(userId: string, sessionId: string, refreshToken: string): Promise<Json> {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: await this.accessToken(userId, sessionId),
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      expires_at: now + ACCESS_TOKEN_SECONDS,
      refresh_token: refreshToken,
      user: await this.userJson(userId),
    };
  }

  /** GoTrue's access token for a session, decorated by the project's own hook. */
  private async accessToken(userId: string, sessionId: string): Promise<string> {
    const user = await this.userJson(userId);
    const { rows: amr } = await this.h.db.query<{ method: string; at: number }>(
      `select authentication_method as method, extract(epoch from created_at)::bigint as at
       from auth.mfa_amr_claims where session_id = $1 order by created_at`,
      [sessionId],
    );
    const now = Math.floor(Date.now() / 1000);
    const claims: Json = {
      aud: 'authenticated',
      exp: now + ACCESS_TOKEN_SECONDS,
      iat: now,
      iss: BASE,
      sub: userId,
      email: user.email ?? '',
      phone: user.phone ?? '',
      app_metadata: user.app_metadata ?? {},
      user_metadata: user.user_metadata ?? {},
      role: 'authenticated',
      aal: 'aal1',
      amr: amr.map((entry) => ({ method: entry.method, timestamp: Number(entry.at) })),
      session_id: sessionId,
      is_anonymous: false,
    };
    const { rows } = await this.h.db.query<{ result: { claims?: Json } }>(
      'select public.custom_access_token_hook($1::jsonb) as result',
      [JSON.stringify({ user_id: userId, claims, authentication_method: amr[0]?.method ?? 'otp' })],
    );
    return this.signJwt(rows[0]?.result?.claims ?? claims);
  }

  private signJwt(claims: Json): string {
    const unsigned = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}`;
    return `${unsigned}.${createHmac('sha256', this.secret).update(unsigned).digest('base64url')}`;
  }

  private verifyJwt(token: string): Json {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new GoTrueError(
        403,
        'bad_jwt',
        'invalid JWT: unable to parse or verify signature, token is malformed: token contains an invalid number of segments',
      );
    }
    const expected = createHmac('sha256', this.secret).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new GoTrueError(403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, signature is invalid');
    }
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Json;
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new GoTrueError(403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired');
    }
    return claims;
  }
}
