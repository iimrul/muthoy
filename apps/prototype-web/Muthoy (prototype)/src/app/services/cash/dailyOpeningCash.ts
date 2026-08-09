// Per-day opening cash store.
// Shape in localStorage["cashOpening"]: { [YYYY-MM-DD]: number }

import { getDateKey, notifyCashUpdated } from "./cashCalculation";
import { shopStorage } from "../../utils/shopStorage";

const KEY = "cashOpening";

type OpeningMap = Record<string, number>;

function read(): OpeningMap {
  try {
    return JSON.parse(shopStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(map: OpeningMap) {
  shopStorage.setItem(KEY, JSON.stringify(map));
}

export function getOpeningCash(target: Date = new Date()): number | null {
  const map = read();
  const v = map[getDateKey(target)];
  return typeof v === "number" ? v : null;
}

export function setOpeningCash(amount: number, target: Date = new Date()): void {
  const map = read();
  map[getDateKey(target)] = amount;
  write(map);
  notifyCashUpdated();
}

export function hasOpeningCashToday(): boolean {
  return getOpeningCash() !== null;
}

export const OPENING_CHIPS = [500, 1000, 2000, 5000];
