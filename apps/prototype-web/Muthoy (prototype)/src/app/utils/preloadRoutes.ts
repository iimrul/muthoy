// Preload every route chunk so all navigations are instant (no lazy-load flash).
// Wave 1: screens the user is most likely to hit first — loaded immediately.
// Wave 2: everything else — loaded during idle time.

const WAVE1 = [
  () => import("../screens/MorningDashboard"),
  () => import("../screens/SaleEntry"),
  () => import("../screens/Cart"),
  () => import("../screens/Checkout"),
  () => import("../screens/Inventory"),
  () => import("../screens/CreditSales"),
  () => import("../screens/StaffHome"),
  () => import("../screens/PINLogin"),
  () => import("../screens/StaffLogin"),
  () => import("../components/MainLayout"),
];

const WAVE2 = [
  () => import("../screens/EndOfDay"),
  () => import("../screens/Report"),
  () => import("../screens/MonthlyReport"),
  () => import("../screens/SalesHistory"),
  () => import("../screens/ExpenseTracking"),
  () => import("../screens/ExpiryManagement"),
  () => import("../screens/SupplierInvoices"),
  () => import("../screens/SupplierInvoiceCreate"),
  () => import("../screens/SupplierInvoiceDetail"),
  () => import("../screens/Suppliers"),
  () => import("../screens/SupplierDetail"),
  () => import("../screens/StaffManagement"),
  () => import("../screens/StaffSalesView"),
  () => import("../screens/Settings"),
  () => import("../screens/MultiShopManagement"),
  () => import("../screens/NotificationCenter"),
  () => import("../screens/CashSummary"),
  () => import("../screens/DataExport"),
  () => import("../screens/PrinterSettings"),
  () => import("../screens/AddMedicine"),
  () => import("../screens/OCRScan"),
  () => import("../screens/CustomerCreditDetail"),
  () => import("../screens/Plans"),
  () => import("../screens/PlanPayment"),
  () => import("../screens/PlanSuccess"),
];

function loadAll(loaders: Array<() => Promise<any>>) {
  loaders.forEach((load) => load().catch(() => {}));
}

export function preloadCriticalRoutes() {
  // Wave 1: start immediately so these are ready before the user can tap anything
  loadAll(WAVE1);

  // Wave 2: defer to idle so it doesn't compete with Wave 1 or first render
  const runWave2 = () => loadAll(WAVE2);
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(runWave2, { timeout: 3000 });
  } else {
    setTimeout(runWave2, 1500);
  }
}
