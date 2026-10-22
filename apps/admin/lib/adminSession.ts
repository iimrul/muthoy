// W4-06 — the session cookie: signed, stateless, no table, therefore no migration.
//
// EDGE-SAFE ON PURPOSE. Both runtimes use it: middleware.ts verifies and
// refreshes the cookie in the Edge runtime, and the Node login route mints it.
// So everything here is Web Crypto (HMAC-SHA256) and base64url string work, and
// no password material is ever in reach of the Edge bundle.
//
// Two expiries, because they answer different questions:
//   - absolute 8h from iat      -> a forgotten open tab stops being a key by the
//     end of a shift, however busy that tab was;
//   - idle 30m from lastSeen    -> an unattended session dies even inside those
//     8 hours. The middleware re-signs the cookie per request to move it.
//
// Revocation is ADMIN_SESSION_EPOCH: bumping it rejects every live session
// without a table. HONEST LIMIT: it is all-or-nothing, and it takes effect only
// once the new environment is live (deployment propagation on a host such as
// Vercel). Per-user revocation needs the Batch 3 session table.

import { constantTimeEquals } from './basicAuth';
import { AdminConfigError } from './errors';
import { isAdminRole, type AdminRole } from './adminRoles';

export const ADMIN_SESSION_COOKIE = 'muthoy_admin_session';
export const ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1_000;
export const IDLE_TTL_MS = 30 * 60 * 1_000;
/** Minimum secret length, in bytes, for an HMAC-SHA256 key. */
export const MIN_SESSION_SECRET_BYTES = 32;

export interface AdminSessionPayload {
  /** The username this cookie proves. Authority comes from ADMIN_ROLES, not from here. */
  sub: string;
  /** Claimed at sign time. Audited on mismatch, never trusted. */
  role: AdminRole;
  iat: number;
  exp: number;
  lastSeen: number;
  epoch: number;
}

export type SessionRejection =
  | 'absent'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'idle'
  | 'epoch';

export type SessionVerification =
  | { ok: true; payload: AdminSessionPayload }
  | { ok: false; reason: SessionRejection };

/** Reads ADMIN_SESSION_SECRET and ADMIN_SESSION_EPOCH. A Record, not an
 * all-optional interface: a weak type accepts no ProcessEnv structurally. */
export type SessionEnvironment = Readonly<Record<string, string | undefined>>;

export function readSessionSecret(env: SessionEnvironment): string {
  const secret = env.ADMIN_SESSION_SECRET ?? '';
  if (new TextEncoder().encode(secret).length < MIN_SESSION_SECRET_BYTES) {
    throw new AdminConfigError(
      `ADMIN_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_BYTES} bytes`,
    );
  }
  return secret;
}

/**
 * Unset means epoch 0 — a deployment that has never revoked anything. A value
 * that is set but is not a non-negative integer is a configuration ERROR rather
 * than a silent 0, because a typo there would quietly disable revocation.
 */
export function readSessionEpoch(env: SessionEnvironment): number {
  const raw = env.ADMIN_SESSION_EPOCH?.trim();
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) {
    throw new AdminConfigError('ADMIN_SESSION_EPOCH must be a non-negative integer');
  }
  return Number(raw);
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64urlEncode(new Uint8Array(signature));
}

export async function signAdminSession(
  payload: AdminSessionPayload,
  secret: string,
): Promise<string> {
  const body = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

function parsePayload(body: string): AdminSessionPayload | null {
  const decoded = base64urlDecode(body);
  if (!decoded) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.sub !== 'string' || candidate.sub.length === 0) return null;
  if (!isAdminRole(candidate.role)) return null;
  for (const field of ['iat', 'exp', 'lastSeen', 'epoch'] as const) {
    const value = candidate[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  }

  return {
    sub: candidate.sub,
    role: candidate.role,
    iat: candidate.iat as number,
    exp: candidate.exp as number,
    lastSeen: candidate.lastSeen as number,
    epoch: candidate.epoch as number,
  };
}

export async function verifyAdminSession(
  token: string | null | undefined,
  options: { secret: string; epoch: number; now: number },
): Promise<SessionVerification> {
  if (!token) return { ok: false, reason: 'absent' };

  const separator = token.lastIndexOf('.');
  if (separator <= 0 || separator === token.length - 1) return { ok: false, reason: 'malformed' };
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Signature FIRST: nothing in the payload is read as data before it is proven
  // to be ours.
  const expected = await hmac(options.secret, body);
  if (!constantTimeEquals(signature, expected)) return { ok: false, reason: 'bad_signature' };

  const payload = parsePayload(body);
  if (!payload) return { ok: false, reason: 'malformed' };
  if (payload.epoch !== options.epoch) return { ok: false, reason: 'epoch' };
  if (options.now >= payload.exp) return { ok: false, reason: 'expired' };
  // An iat/exp pair wider than the absolute TTL came from someone holding the
  // secret, or from a broken clock. Either way it is not a session this
  // deployment issued.
  if (payload.exp - payload.iat > ABSOLUTE_TTL_MS) return { ok: false, reason: 'malformed' };
  if (options.now - payload.lastSeen >= IDLE_TTL_MS) return { ok: false, reason: 'idle' };
  return { ok: true, payload };
}

export function newSessionPayload(
  input: { sub: string; role: AdminRole; epoch: number; now: number },
): AdminSessionPayload {
  return {
    sub: input.sub,
    role: input.role,
    iat: input.now,
    exp: input.now + ABSOLUTE_TTL_MS,
    lastSeen: input.now,
    epoch: input.epoch,
  };
}

/** Moves the idle window without extending the absolute one. */
export function touchedSessionPayload(
  payload: AdminSessionPayload,
  now: number,
): AdminSessionPayload {
  return { ...payload, lastSeen: now };
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: 'strict';
  path: '/';
  maxAge: number;
}

/**
 * SameSite=Strict is the CSRF defence for the write actions — a platform
 * console has no cross-site flow to break. maxAge tracks what remains of the
 * ABSOLUTE window, so the cookie cannot outlive the session it carries.
 */
export function sessionCookieOptions(
  payload: AdminSessionPayload,
  now: number,
): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.max(0, Math.floor((payload.exp - now) / 1_000)),
  };
}

export const EXPIRED_SESSION_COOKIE_OPTIONS: SessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: 0,
};
