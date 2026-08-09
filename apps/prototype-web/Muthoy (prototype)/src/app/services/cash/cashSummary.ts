// Thin convenience layer for the Cash Summary screen.
// Keeps the screen logic-free.

import {
  getCashBreakdown,
  getActualCash,
  setActualCash,
  getDifference,
  notifyCashUpdated,
  type CashBreakdown,
} from "./cashCalculation";

export interface CashSummary extends CashBreakdown {
  actual: number | null;
  diff: number;
  status: "match" | "surplus" | "shortage" | "unknown";
}

export function getCashSummary(target: Date = new Date()): CashSummary {
  const breakdown = getCashBreakdown(target);
  const actual = getActualCash(target);
  const { diff, status } = getDifference(target);
  return { ...breakdown, actual, diff, status };
}

export function saveActualCash(amount: number, target: Date = new Date()) {
  setActualCash(amount, target);
  notifyCashUpdated();
}
