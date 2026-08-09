// Cross-cutting scheduler: hooks the cash 8 PM job into the in-app inbox
// and runs lightweight periodic scans for stock / expiry / overdue credit.

import { pushNotification } from "./notificationService";
import { getCashBreakdown } from "../cash/cashCalculation";
import { getExpiringMedicines, getLowStockMedicines } from "../../utils/medicineData";
import { shopStorage } from "../../utils/shopStorage";

function fmtBdt(n: number): string {
  return "৳" + Math.round(n).toLocaleString("en-US");
}

/** Drop a "today's cash summary" item in the inbox — called by the 8 PM job. */
export function pushCashSummaryNotification() {
  if (localStorage.getItem("authType") !== "owner") return;
  const { expected } = getCashBreakdown();
  pushNotification({
    type: "cash_summary",
    title: "আজকের নগদ সারসংক্ষেপ",
    message: `আজ ড্রয়ারে প্রায় ${fmtBdt(expected)} থাকার কথা`,
    actionRoute: "/app/cash-summary",
    dedupeKey: "cash_summary_daily",
  });
}

/** Scan inventory + credit and push items that need attention (deduped per day). */
export function runDailyAlertScan() {
  try {
    const settings = JSON.parse(
      localStorage.getItem("appSettings") ||
        '{"expiryWarningDays":60,"creditAlerts":true,"lowStockAlerts":true,"expiryAlerts":true}'
    );

    if (settings.lowStockAlerts !== false) {
      const low = getLowStockMedicines();
      if (low.length > 0) {
        pushNotification({
          type: "low_stock",
          title: "স্টক ঘাটতি",
          message: `${low.length} টি ওষুধের স্টক কম আছে। দ্রুত রিস্টক করুন।`,
          actionRoute: "/app/inventory",
          dedupeKey: "low_stock_daily",
        });
      }
    }

    if (settings.expiryAlerts !== false) {
      const expiring = getExpiringMedicines(settings.expiryWarningDays || 60);
      if (expiring.length > 0) {
        pushNotification({
          type: "expiry",
          title: "মেয়াদ শেষের সতর্কতা",
          message: `${expiring.length} টি ওষুধের মেয়াদ শীঘ্রই শেষ হবে।`,
          actionRoute: "/app/expiry",
          dedupeKey: "expiry_daily",
        });
      }
    }

    if (settings.creditAlerts !== false) {
      const credit = JSON.parse(shopStorage.getItem("creditData") || '{"customers":[]}');
      const today = new Date();
      const overdue = (credit.customers || []).filter((c: any) => {
        if (!c.amount || c.amount <= 0 || !c.lastDate) return false;
        return new Date(c.lastDate) < today;
      });
      if (overdue.length > 0) {
        pushNotification({
          type: "overdue_credit",
          title: "বাকি বকেয়া",
          message: `${overdue.length} জন গ্রাহকের বাকি পরিশোধের সময় পেরিয়ে গেছে।`,
          actionRoute: "/app/credit",
          dedupeKey: "overdue_credit_daily",
        });
      }
    }
  } catch {
    // Scans must never throw and break the dashboard mount.
  }
}

/** Convenience helper for the sync button. */
export function pushSyncCompletedNotification() {
  pushNotification({
    type: "sync_completed",
    title: "সিঙ্ক সম্পন্ন",
    message: "সব ডাটা আপডেট হয়েছে।",
    dedupeKey: "sync_completed",
  });
}
