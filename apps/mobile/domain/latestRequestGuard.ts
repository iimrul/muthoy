// domain/latestRequestGuard.ts — tracks which of several overlapping async
// calls is the most recent, so a slow-resolving earlier call (e.g. a scan's
// background search racing a manual retype) can tell it has been superseded
// and must not drive a side effect like adding to the cart
// (docs/plans/ocr.md — Sale Entry stale-result safety).
//
// Zero React/native/DB imports (mirrors domain/fefo.ts). This is the same
// "increment a ref, compare on resolve" guard app/(tabs)/sale.tsx already
// used inline for its search request-id — extracted here so the guarantee
// itself is unit-testable without a component-rendering harness.

export interface LatestRequestGuard {
  start(): number;
  isLatest(id: number): boolean;
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let latestId = 0;

  return {
    start(): number {
      latestId += 1;
      return latestId;
    },
    isLatest(id: number): boolean {
      return id === latestId;
    },
  };
}
