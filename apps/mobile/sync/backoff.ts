export const MAX_SYNC_ATTEMPTS = 8;

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 300_000;

export function computeBackoffMs(attempts: number): number {
  const normalizedAttempts = Math.max(1, Math.floor(attempts));
  return Math.min(BASE_BACKOFF_MS * 2 ** (normalizedAttempts - 1), MAX_BACKOFF_MS);
}
