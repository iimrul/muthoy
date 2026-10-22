import { NextResponse, type NextRequest } from 'next/server';
import { parseAdminRoles } from './lib/adminRoles';
import {
  ADMIN_SESSION_COOKIE,
  readSessionEpoch,
  readSessionSecret,
  sessionCookieOptions,
  signAdminSession,
  touchedSessionPayload,
  verifyAdminSession,
} from './lib/adminSession';

// W4-06 — the request gate for the whole panel. Edge runtime: it verifies the
// session cookie's HMAC and its two expiries with Web Crypto, and reads NO
// password material. Verifying a password here would need a KDF on every page
// request, which is a denial-of-service surface of its own; that work happens
// once, in the Node login route.
//
// Still fails CLOSED: with ADMIN_SESSION_SECRET or ADMIN_ROLES absent or
// malformed the panel serves 503 rather than publishing every pharmacy's name
// and phone anonymously. That is the one thing the retired Basic Auth gate got
// right, and it is preserved.
//
// THE MATCHER STAYS BROAD AND THE EXEMPTION IS AN EXACT-MATCH SET. Adding
// 'login|api/admin/session' to the matcher's negative lookahead would be a
// PREFIX exclusion, so it would also exempt /login-anything and
// /api/admin/session-extra — silently, and with no test noticing. A middleware
// exemption that can grow by accident is the shape of hole this task exists to
// close, so the check below compares request.nextUrl.pathname WHOLE.
const PUBLIC_PATHS = new Set(['/login', '/api/admin/session']);

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

function notConfigured(): NextResponse {
  return new NextResponse('Admin panel is not configured.\n', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * A browser gets the login page; anything under /api gets a status code, since
 * redirecting a fetch to an HTML form turns an auth failure into a parse error.
 */
function denied(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return new NextResponse('Authentication required.\n', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  const target = new URL('/login', request.nextUrl);
  const response = NextResponse.redirect(target, 303);
  response.headers.set('cache-control', 'no-store');
  // A cookie that failed verification is worthless; clearing it stops the
  // browser replaying it on every subsequent request.
  response.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  let secret: string;
  let epoch: number;
  let roles: ReturnType<typeof parseAdminRoles>;
  try {
    secret = readSessionSecret(process.env);
    epoch = readSessionEpoch(process.env);
    roles = parseAdminRoles(process.env.ADMIN_ROLES);
  } catch {
    return notConfigured();
  }

  const now = Date.now();
  const verified = await verifyAdminSession(request.cookies.get(ADMIN_SESSION_COOKIE)?.value, {
    secret,
    epoch,
    now,
  });
  if (!verified.ok) {
    return denied(request);
  }

  // ADMIN_ROLES is authoritative and is re-read here on EVERY request, so an
  // account removed from it is denied on its next request even though a validly
  // signed cookie is still in the browser. The cookie's own role claim grants
  // nothing.
  if (!roles.has(verified.payload.sub)) {
    return denied(request);
  }

  // Move the idle window. The absolute expiry is untouched, so re-signing can
  // extend a session's inactivity allowance but never its 8-hour lifetime.
  const refreshed = touchedSessionPayload(verified.payload, now);
  const response = NextResponse.next();
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    await signAdminSession(refreshed, secret),
    sessionCookieOptions(refreshed, now),
  );
  return response;
}
