// native/notifications.ts — the ONLY code scheduling/reading local
// notifications (expo-notifications + expo-background-task, per
// TECH_STACK.md). P1 (post-beta fast-follow, Volume 0's scope lock).
// Volume 4 NOTIFICATION: "Local, offline-capable: low-stock (threshold
// crossing, de-duplicated), expiry (configurable window), 8 PM owner-only
// cash-in-drawer summary."

// TODO(P1): schedule a check that fires when a medicine's stock crosses
// below its threshold. Must de-duplicate — Volume 4 explicitly calls out
// "de-duplicated" so the owner isn't spammed on every sale while stock
// stays low.
export async function scheduleLowStockCheck(): Promise<void> {
  throw new Error('TODO: implement low-stock notification scheduling (P1 — post-beta, Volume 4 NOTIFICATION)');
}

// TODO(P1): configurable window (e.g. "notify N days before expiry") — the
// exact default isn't specced in Volume 4; confirm with the founder before
// hardcoding one (CLAUDE.md rule 11). Must use the real expiryDate
// (CLAUDE.md rule 3), never a cached day-count.
export async function scheduleExpiryCheck(): Promise<void> {
  throw new Error('TODO: implement expiry notification scheduling (P1 — post-beta, Volume 4 NOTIFICATION)');
}

// TODO(P1): 8 PM, owner-only, cash-in-drawer summary — reads
// domain/cashFormula.expectedCash via db/cash.ts's getCashSummary. Must
// never surface to a Staff-role session (domain/permissions.ts).
export async function scheduleDailySummary(): Promise<void> {
  throw new Error('TODO: implement 8PM cash summary notification (P1 — post-beta, Volume 4 NOTIFICATION)');
}
