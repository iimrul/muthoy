// H-9 §4.2. The one request rewrite the modern publishable key needs.
//
// A sessionless sync call (device-login, device-actor-switch) proves its
// credential inside the handler; the gateway (verify_jwt = true) only needs
// the public key in `apikey`. A publishable key is not a JWT, so it must never
// travel as the bearer: supabase-js 2.112.3 already omits it on Functions
// requests, and this keeps that true if a later SDK or a caller sends one.
//
// Exactly one shape is rewritten: `Authorization: Bearer <the configured
// publishable key>` on this project's /functions/v1/sync. A user JWT, the
// legacy anon bearer, any other bearer, and all Auth/REST/Storage traffic pass
// through untouched — a malformed user token is the server's to refuse, never
// this function's to discard.

const SYNC_FUNCTION_PATH = '/functions/v1/sync';
const PUBLISHABLE_KEY_PREFIX = 'sb_publishable_';

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return null;
  }
}

/**
 * Returns `init` itself when nothing applies, or a NEW init whose headers lack
 * that one Authorization value. The caller's headers object is never mutated.
 */
export function withoutPublishableKeyBearer(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  projectUrl: string,
  publicKey: string,
): RequestInit | undefined {
  if (!publicKey.startsWith(PUBLISHABLE_KEY_PREFIX)) return init;
  const url = requestUrl(input);
  if (!url || url.origin !== projectUrl || url.pathname !== SYNC_FUNCTION_PATH) return init;
  const source = init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined);
  const headers = new Headers(source);
  if (headers.get('authorization') !== `Bearer ${publicKey}`) return init;
  headers.delete('authorization');
  return { ...init, headers };
}
