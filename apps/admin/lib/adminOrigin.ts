// The CSRF check every state-changing browser POST in this panel shares.
//
// Moved out of lib/adminLogin.ts unchanged when the panel's eight write forms
// became plain form POSTs (lib/adminFormRoute.ts): two copies of an origin
// rule drift, and the one that drifts is the one nobody re-reads.
//
// A missing Origin is a rejection. Browsers send Origin on every form POST, so
// only a non-browser client omits it, and that client has no business here.

import type { AdminEnvironment } from './adminAuthz';

/** The origins a browser may legitimately post a form from. */
export function allowedOrigins(request: Request, env: AdminEnvironment): Set<string> {
  const configured = env.ADMIN_ORIGIN?.trim();
  if (configured) return new Set([configured.replace(/\/$/, '')]);

  const origins = new Set<string>();
  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // An unparseable request URL leaves the forwarded host as the only source.
  }
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const scheme = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    origins.add(scheme + '://' + forwardedHost);
  }
  return origins;
}

/** The client address for audit rows: the first forwarded hop, never a body field. */
export function clientSource(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const firstHop = forwarded?.split(',')[0]?.trim();
  if (firstHop) return firstHop;
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

/** True only when the request carries an Origin header this deployment accepts. */
export function hasAllowedOrigin(request: Request, env: AdminEnvironment): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return allowedOrigins(request, env).has(origin.replace(/\/$/, ''));
}
