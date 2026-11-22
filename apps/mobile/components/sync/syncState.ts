// components/sync/syncState.ts — the one rule for what the queue counts MEAN.
//
// Pure and dependency-free so the sync card, the header's blinking dot and
// their tests all classify the same counts the same way.

export interface SyncCounts {
  pending: number;
  failed: number;
  stuck: number;
}

/** What the owner should understand at a glance; the counts stay underneath. */
export type SyncState = "unavailable" | "sent" | "waiting" | "failing";

/** Failing beats waiting beats sent: a row that cannot leave is the urgent one. */
export function syncStateOf(counts: SyncCounts | null): SyncState {
  if (!counts) return "unavailable";
  if (counts.failed > 0 || counts.stuck > 0) return "failing";
  return counts.pending > 0 ? "waiting" : "sent";
}
