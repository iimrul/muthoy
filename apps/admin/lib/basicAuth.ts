// Pure HTTP Basic credential check for middleware.ts. Framework-free so it can
// be unit-tested, and so it runs identically in the Edge runtime.
//
// This is NOT role management (Volume 5, P1) and adds no page — it exists so a
// deployed admin URL never anonymously exposes every pharmacy's name and phone.
// It fails CLOSED: with no credentials configured, nothing is served.

export type BasicAuthOutcome = 'authorized' | 'unauthorized' | 'not-configured';

export interface BasicAuthCredentials {
  user: string | undefined;
  password: string | undefined;
}

/**
 * Byte-by-byte comparison that never short-circuits, so response timing does
 * not leak how many leading characters of the password were correct.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function decodeBase64(value: string): string | null {
  try {
    return atob(value);
  } catch {
    return null;
  }
}

export function evaluateBasicAuth(
  authorizationHeader: string | null,
  credentials: BasicAuthCredentials,
): BasicAuthOutcome {
  const expectedUser = credentials.user?.trim() ?? '';
  const expectedPassword = credentials.password ?? '';

  if (expectedUser.length === 0 || expectedPassword.length === 0) {
    return 'not-configured';
  }
  if (!authorizationHeader) {
    return 'unauthorized';
  }

  const [scheme, encoded] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) {
    return 'unauthorized';
  }

  const decoded = decodeBase64(encoded);
  if (decoded === null) {
    return 'unauthorized';
  }

  // Only the FIRST colon separates the pair — a password may contain colons.
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) {
    return 'unauthorized';
  }

  // Both comparisons always run; combining afterwards keeps the timing flat.
  const userMatches = constantTimeEquals(decoded.slice(0, separatorIndex), expectedUser);
  const passwordMatches = constantTimeEquals(decoded.slice(separatorIndex + 1), expectedPassword);

  return userMatches && passwordMatches ? 'authorized' : 'unauthorized';
}
