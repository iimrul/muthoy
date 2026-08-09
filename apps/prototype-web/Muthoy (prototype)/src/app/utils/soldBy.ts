// Sales attribution helper.
// Every transaction written to localStorage("transactions") should carry a
// structured `soldBy` field so dashboards, cash drawer, and staff performance
// views can attribute each sale to its true seller — owner or staff.

export interface SoldBy {
  type: "owner" | "staff";
  id: string | number;
  name: string;
  phone: string;
}

/**
 * Read the current session and return a structured soldBy attribution.
 * Falls back to a synthetic "owner" entry if nothing is logged in so legacy
 * data continues to render rather than crash.
 */
export function getCurrentSoldBy(): SoldBy {
  const authType = localStorage.getItem("authType");
  const currentStaff = JSON.parse(localStorage.getItem("currentStaff") || "null");
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");

  if (authType === "staff" && currentStaff) {
    return {
      type: "staff",
      id: currentStaff.id,
      name: currentStaff.name || currentStaff.nameEn || "Staff",
      phone: currentStaff.phone || "",
    };
  }

  return {
    type: "owner",
    id: currentUser?.id ?? 0,
    name: currentUser?.name || currentUser?.nameEn || "Owner",
    phone: currentUser?.phone || "",
  };
}

/**
 * Resolve a soldBy from an already-stored transaction. Existing records
 * predate `soldBy` and only have flat staffId/staffName — treat those as
 * owner sales by default so historical numbers don't suddenly shift.
 */
export function resolveSoldBy(txn: any): SoldBy {
  if (txn?.soldBy?.type) return txn.soldBy as SoldBy;
  return {
    type: "owner",
    id: txn?.staffId ?? 0,
    name: txn?.staffName || "Owner",
    phone: "",
  };
}
