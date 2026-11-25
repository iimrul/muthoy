// components/sync/undeliveredText.ts — the words for what did not reach the
// server: "1 sale and 1 activity record didn't reach the server" /
// "১টি বিক্রয় ও ১টি কার্যকলাপের রেকর্ড সার্ভারে যায়নি" (founder request
// 2026-11-25). Pure: it takes the translator, so it follows the language toggle.

import type { CatalogKey } from "../../i18n/catalog";
import { fillTemplate } from "../../i18n/display";
import {
  summarizeUndelivered,
  type SyncFailureKind,
  type SyncFailureReason,
  type UndeliveredSyncRow,
} from "../../domain/syncFailures";

type Translate = (key: CatalogKey) => string;
type FormatNumber = (value: number) => string;

const COUNT_KEYS: Readonly<Record<SyncFailureKind, readonly [CatalogKey, CatalogKey]>> = {
  sale: ["syncKindSaleOne", "syncKindSaleMany"],
  refund: ["syncKindRefundOne", "syncKindRefundMany"],
  draft: ["syncKindDraftOne", "syncKindDraftMany"],
  stock: ["syncKindStockOne", "syncKindStockMany"],
  purchase: ["syncKindPurchaseOne", "syncKindPurchaseMany"],
  supplier: ["syncKindSupplierOne", "syncKindSupplierMany"],
  expense: ["syncKindExpenseOne", "syncKindExpenseMany"],
  cash: ["syncKindCashOne", "syncKindCashMany"],
  customer: ["syncKindCustomerOne", "syncKindCustomerMany"],
  staff: ["syncKindStaffOne", "syncKindStaffMany"],
  settings: ["syncKindSettingsOne", "syncKindSettingsMany"],
  activity: ["syncKindActivityOne", "syncKindActivityMany"],
  other: ["syncKindOtherOne", "syncKindOtherMany"],
};

const LABEL_KEYS: Readonly<Record<SyncFailureKind, CatalogKey>> = {
  sale: "syncKindSale",
  refund: "syncKindRefund",
  draft: "syncKindDraft",
  stock: "syncKindStock",
  purchase: "syncKindPurchase",
  supplier: "syncKindSupplier",
  expense: "syncKindExpense",
  cash: "syncKindCash",
  customer: "syncKindCustomer",
  staff: "syncKindStaff",
  settings: "syncKindSettings",
  activity: "syncKindActivity",
  other: "syncKindOther",
};

const REASON_KEYS: Readonly<Record<SyncFailureReason, CatalogKey>> = {
  keepsFailing: "syncReasonKeepsFailing",
  planReadOnly: "syncReasonPlanReadOnly",
  notAllowed: "syncReasonNotAllowed",
  incomplete: "syncReasonIncomplete",
  refused: "syncReasonRefused",
};

/** How many kinds are named on the dashboard card before "and N more". */
export const KINDS_ON_CARD = 2;

export function kindLabel(kind: SyncFailureKind, t: Translate): string {
  return t(LABEL_KEYS[kind]);
}

export function reasonLabel(reason: SyncFailureReason, t: Translate): string {
  return t(REASON_KEYS[reason]);
}

/**
 * One sentence for the card, never longer than two kinds and a remainder, so
 * the dashboard stays the size it was. Null when there is nothing to name.
 */
export function undeliveredSentence(
  rows: readonly UndeliveredSyncRow[],
  t: Translate,
  formatNumber: FormatNumber,
): string | null {
  const kinds = summarizeUndelivered(rows);
  if (kinds.length === 0) return null;
  const named = kinds.slice(0, KINDS_ON_CARD);
  const rest = kinds.slice(KINDS_ON_CARD).reduce((sum, entry) => sum + entry.count, 0);
  const parts = named.map(({ kind, count }) => {
    const [one, many] = COUNT_KEYS[kind];
    return fillTemplate(t(count === 1 ? one : many), { count: formatNumber(count) });
  });
  if (rest > 0) parts.push(fillTemplate(t("syncListMore"), { count: formatNumber(rest) }));
  const list = parts.length === 1
    ? parts[0]!
    : `${parts.slice(0, -1).join(t("syncListComma"))}${t("syncListAnd")}${parts[parts.length - 1]!}`;
  return fillTemplate(t("syncUndeliveredTitle"), { list });
}

/**
 * SQLite's current_timestamp is "YYYY-MM-DD HH:MM:SS" in UTC without a zone;
 * read as written it would be taken as LOCAL time. Make it an ISO instant.
 */
export function queueTimestamp(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}
