/**
 * Application Routes Configuration
 *
 * Single source of truth — mirrors router.tsx exactly.
 * Use these constants instead of hardcoding paths.
 */

export const ROUTES = {
  // Auth / onboarding (no layout)
  HOME: "/",           // RoleSelect
  REGISTER: "/register",
  OTP: "/otp",
  PIN_SETUP: "/pin-setup",
  LOGIN: "/login",
  STAFF_LOGIN: "/staff-login",

  // App routes (inside MainLayout)
  APP: {
    // Dashboard
    HOME: "/app",
    DASHBOARD: "/app",        // alias
    STAFF_HOME: "/app/staff-home",

    // Sale
    SALE: "/app/sale",
    CART: "/app/cart",
    CHECKOUT: "/app/checkout",
    SCAN: "/app/scan",

    // Inventory
    INVENTORY: "/app/inventory",
    ADD_MEDICINE: "/app/add-medicine",
    EXPIRY: "/app/expiry",

    // Financial
    CREDIT: "/app/credit",
    CREDIT_DETAIL: "/app/credit/:customerId",
    EXPENSE: "/app/expense",
    CASH_SUMMARY: "/app/cash-summary",

    // Reports
    REPORT: "/app/report",
    END_OF_DAY: "/app/end-of-day",
    MONTHLY_REPORT: "/app/monthly-report",
    SALES_HISTORY: "/app/sales-history",
    STAFF_SALES: "/app/staff-sales",
    EXPORT: "/app/export",

    // Suppliers & invoices
    SUPPLIERS: "/app/suppliers",
    SUPPLIER_DETAIL: "/app/suppliers/:id",
    INVOICES: "/app/invoices",
    INVOICE_NEW: "/app/invoices/new",
    INVOICE_DETAIL: "/app/invoices/:id",

    // Settings & staff
    STAFF: "/app/staff",
    SETTINGS: "/app/settings",
    PRINTER: "/app/printer",

    // Misc
    NOTIFICATIONS: "/app/notifications",
  },
} as const;

/**
 * Permission-based routes — keyed by the 12-key permission schema.
 */
export const PERMISSION_ROUTES = {
  sale_entry:      [ROUTES.APP.SALE, ROUTES.APP.CART, ROUTES.APP.CHECKOUT, ROUTES.APP.SCAN],
  sale_history:    [ROUTES.APP.SALES_HISTORY, ROUTES.APP.STAFF_SALES],
  inventory_view:  [ROUTES.APP.INVENTORY, ROUTES.APP.ADD_MEDICINE],
  inventory_edit:  [ROUTES.APP.INVENTORY, ROUTES.APP.ADD_MEDICINE],
  expiry_manage:   [ROUTES.APP.EXPIRY],
  credit_view:     [ROUTES.APP.CREDIT, ROUTES.APP.CREDIT_DETAIL],
  credit_manage:   [ROUTES.APP.CREDIT, ROUTES.APP.CREDIT_DETAIL],
  cash_drawer:     [ROUTES.APP.CASH_SUMMARY, ROUTES.APP.END_OF_DAY, ROUTES.APP.EXPENSE],
  reports:         [ROUTES.APP.REPORT, ROUTES.APP.MONTHLY_REPORT, ROUTES.APP.EXPORT],
  staff_manage:    [ROUTES.APP.STAFF, ROUTES.APP.STAFF_SALES],
  settings_manage: [ROUTES.APP.SETTINGS, ROUTES.APP.PRINTER],
} as const;

/** Returns true for every path that lives inside MainLayout. */
export function requiresAuth(path: string): boolean {
  return path.startsWith("/app");
}

/** Returns the correct entry point based on first-run vs returning user. */
export function getAuthEntryPoint(): string {
  const hasCompletedSetup = localStorage.getItem("setupCompleted");
  return hasCompletedSetup ? ROUTES.LOGIN : ROUTES.HOME;
}
