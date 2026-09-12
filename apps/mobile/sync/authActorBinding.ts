import { readAccessTokenClaims } from './authClaims';
import { supabase } from './supabaseClient';

export type CloudActorBinding =
  | { status: 'matched'; actorUserId: string; shopId: string }
  | { status: 'missing' | 'mismatched'; actorUserId: string | null; shopId: string | null };

/**
 * Compares the locally selected actor with the cloud session already stored on
 * this device. Decoded claims are only a fail-closed preflight: they may block
 * sync, but can never grant access or cause a local revocation. The Edge
 * function re-verifies the token before returning any lock-worthy identity.
 */
export async function inspectCloudActorBinding(expected: {
  userId: string;
  shopId: string;
}): Promise<CloudActorBinding> {
  let response: Awaited<ReturnType<typeof supabase.auth.getSession>>;
  try {
    response = await supabase.auth.getSession();
  } catch {
    return { status: 'missing', actorUserId: null, shopId: null };
  }
  const { data, error } = response;
  if (error || !data.session?.access_token) {
    return { status: 'missing', actorUserId: null, shopId: null };
  }
  const claims = readAccessTokenClaims(data.session.access_token);
  if (claims.appUserId === expected.userId && claims.shopId === expected.shopId) {
    return { status: 'matched', actorUserId: claims.appUserId, shopId: claims.shopId };
  }
  return {
    status: 'mismatched',
    actorUserId: claims.appUserId,
    shopId: claims.shopId,
  };
}

export function assertCloudActorBinding(
  binding: CloudActorBinding,
  expected: { userId: string; shopId: string },
): void {
  if (
    binding.status !== 'matched'
    || binding.actorUserId !== expected.userId
    || binding.shopId !== expected.shopId
  ) {
    throw new Error('Cloud session does not match the active local user. Sign in online to continue syncing.');
  }
}
