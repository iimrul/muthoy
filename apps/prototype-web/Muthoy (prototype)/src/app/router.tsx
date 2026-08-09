import { createHashRouter } from "react-router";
import { MuthoyLoadingScreen } from "../imports/MuthoyLoadingScreen";

// One importer per route — reused for both lazy routing AND on-press prefetch.
export const routeLoaders: Record<string, () => Promise<any>> = {
  "/": () => import("./screens/RoleSelect"),
  "/register": () => import("./screens/Registration"),
  "/otp": () => import("./screens/OTPVerification"),
  "/pin-setup": () => import("./screens/PINSetup"),
  "/login": () => import("./screens/PINLogin"),
  "/staff-login": () => import("./screens/StaffLogin"),
  "/app": () => import("./screens/MorningDashboard"),
  "/app/staff-home": () => import("./screens/StaffHome"),
  "/app/sale": () => import("./screens/SaleEntry"),
  "/app/cart": () => import("./screens/Cart"),
  "/app/checkout": () => import("./screens/Checkout"),
  "/app/inventory": () => import("./screens/Inventory"),
  "/app/expiry": () => import("./screens/ExpiryManagement"),
  "/app/credit": () => import("./screens/CreditSales"),
  "/app/credit/:customerId": () => import("./screens/CustomerCreditDetail"),
  "/app/report": () => import("./screens/Report"),
  "/app/end-of-day": () => import("./screens/EndOfDay"),
  "/app/monthly-report": () => import("./screens/MonthlyReport"),
  "/app/staff": () => import("./screens/StaffManagement"),
  "/app/settings": () => import("./screens/Settings"),
  "/app/scan": () => import("./screens/OCRScan"),
  "/app/add-medicine": () => import("./screens/AddMedicine"),
  "/app/sales-history": () => import("./screens/SalesHistory"),
  "/app/expense": () => import("./screens/ExpenseTracking"),
  "/app/staff-sales": () => import("./screens/StaffSalesView"),
  "/app/export": () => import("./screens/DataExport"),
  "/app/printer": () => import("./screens/PrinterSettings"),
  "/app/invoices": () => import("./screens/SupplierInvoices"),
  "/app/invoices/new": () => import("./screens/SupplierInvoiceCreate"),
  "/app/suppliers": () => import("./screens/Suppliers"),
  "/app/cash-summary": () => import("./screens/CashSummary"),
  "/app/notifications": () => import("./screens/NotificationCenter"),
  "/app/multi-shop": () => import("./screens/MultiShopManagement"),
  "/app/plans": () => import("./screens/Plans"),
  "/app/plan-payment": () => import("./screens/PlanPayment"),
  "/app/plan-success": () => import("./screens/PlanSuccess"),
};

// Call on finger-down to start loading a chunk before the tap completes.
export function prefetchRoute(path: string) {
  routeLoaders[path]?.().catch(() => {});
}

// Shown by RouterProvider.fallbackElement during initial route load
export function PageLoader() {
  return <MuthoyLoadingScreen />;
}

// All routes use React Router v7's built-in `lazy` property.
// Modules are loaded BEFORE rendering (as part of navigation), so no
// React.lazy / Suspense is needed and the "suspended during synchronous input"
// error cannot occur.
//
// A single pathless root wrapper supplies HydrateFallback for every child
// route, silencing the "No HydrateFallback element provided" warning without
// repeating it on all 30+ routes.
export const router = createHashRouter([
  {
    HydrateFallback: PageLoader,
    children: [
  {
    path: "/",
    lazy: async () => {
      const { RoleSelect } = await import("./screens/RoleSelect");
      return { Component: RoleSelect };
    },
  },
  {
    path: "/register",
    lazy: async () => {
      const { Registration } = await import("./screens/Registration");
      return { Component: Registration };
    },
  },
  {
    path: "/otp",
    lazy: async () => {
      const { OTPVerification } = await import("./screens/OTPVerification");
      return { Component: OTPVerification };
    },
  },
  {
    path: "/pin-setup",
    lazy: async () => {
      const { PINSetup } = await import("./screens/PINSetup");
      return { Component: PINSetup };
    },
  },
  {
    path: "/login",
    lazy: async () => {
      const { PINLogin } = await import("./screens/PINLogin");
      return { Component: PINLogin };
    },
  },
  {
    path: "/staff-login",
    lazy: async () => {
      const { StaffLogin } = await import("./screens/StaffLogin");
      return { Component: StaffLogin };
    },
  },
  {
    path: "/app",
    lazy: async () => {
      const { MainLayout } = await import("./components/MainLayout");
      return { Component: MainLayout };
    },
    children: [
      {
        index: true,
        lazy: async () => {
          const { MorningDashboard } = await import("./screens/MorningDashboard");
          return { Component: MorningDashboard };
        },
      },
      {
        path: "staff-home",
        lazy: async () => {
          const { StaffHome } = await import("./screens/StaffHome");
          return { Component: StaffHome };
        },
      },
      {
        path: "sale",
        lazy: async () => {
          const { SaleEntry } = await import("./screens/SaleEntry");
          return { Component: SaleEntry };
        },
      },
      {
        path: "cart",
        lazy: async () => {
          const { Cart } = await import("./screens/Cart");
          return { Component: Cart };
        },
      },
      {
        path: "checkout",
        lazy: async () => {
          const { Checkout } = await import("./screens/Checkout");
          return { Component: Checkout };
        },
      },
      {
        path: "inventory",
        lazy: async () => {
          const { Inventory } = await import("./screens/Inventory");
          return { Component: Inventory };
        },
      },
      {
        path: "expiry",
        lazy: async () => {
          const { ExpiryManagement } = await import("./screens/ExpiryManagement");
          return { Component: ExpiryManagement };
        },
      },
      {
        path: "credit",
        lazy: async () => {
          const { CreditSales } = await import("./screens/CreditSales");
          return { Component: CreditSales };
        },
      },
      {
        path: "credit/:customerId",
        lazy: async () => {
          const { CustomerCreditDetail } = await import("./screens/CustomerCreditDetail");
          return { Component: CustomerCreditDetail };
        },
      },
      {
        path: "report",
        lazy: async () => {
          const { Report } = await import("./screens/Report");
          return { Component: Report };
        },
      },
      {
        path: "end-of-day",
        lazy: async () => {
          const { EndOfDay } = await import("./screens/EndOfDay");
          return { Component: EndOfDay };
        },
      },
      {
        path: "monthly-report",
        lazy: async () => {
          const { MonthlyReport } = await import("./screens/MonthlyReport");
          return { Component: MonthlyReport };
        },
      },
      {
        path: "staff",
        lazy: async () => {
          const { StaffManagement } = await import("./screens/StaffManagement");
          return { Component: StaffManagement };
        },
      },
      {
        path: "settings",
        lazy: async () => {
          const { Settings } = await import("./screens/Settings");
          return { Component: Settings };
        },
      },
      {
        path: "multi-shop",
        lazy: async () => {
          const { MultiShopManagement } = await import("./screens/MultiShopManagement");
          return { Component: MultiShopManagement };
        },
      },
      {
        path: "scan",
        lazy: async () => {
          const { OCRScan } = await import("./screens/OCRScan");
          return { Component: OCRScan };
        },
      },
      {
        path: "add-medicine",
        lazy: async () => {
          const { AddMedicine } = await import("./screens/AddMedicine");
          return { Component: AddMedicine };
        },
      },
      {
        path: "sales-history",
        lazy: async () => {
          const { SalesHistory } = await import("./screens/SalesHistory");
          return { Component: SalesHistory };
        },
      },
      {
        path: "expense",
        lazy: async () => {
          const { ExpenseTracking } = await import("./screens/ExpenseTracking");
          return { Component: ExpenseTracking };
        },
      },
      {
        path: "staff-sales",
        lazy: async () => {
          const { StaffSalesView } = await import("./screens/StaffSalesView");
          return { Component: StaffSalesView };
        },
      },
      {
        path: "export",
        lazy: async () => {
          const { DataExport } = await import("./screens/DataExport");
          return { Component: DataExport };
        },
      },
      {
        path: "printer",
        lazy: async () => {
          const { PrinterSettings } = await import("./screens/PrinterSettings");
          return { Component: PrinterSettings };
        },
      },
      {
        path: "invoices",
        lazy: async () => {
          const { SupplierInvoices } = await import("./screens/SupplierInvoices");
          return { Component: SupplierInvoices };
        },
      },
      {
        path: "invoices/new",
        lazy: async () => {
          const { SupplierInvoiceCreate } = await import("./screens/SupplierInvoiceCreate");
          return { Component: SupplierInvoiceCreate };
        },
      },
      {
        path: "invoices/:id",
        lazy: async () => {
          const { SupplierInvoiceDetail } = await import("./screens/SupplierInvoiceDetail");
          return { Component: SupplierInvoiceDetail };
        },
      },
      {
        path: "suppliers",
        lazy: async () => {
          const { Suppliers } = await import("./screens/Suppliers");
          return { Component: Suppliers };
        },
      },
      {
        path: "suppliers/:id",
        lazy: async () => {
          const { SupplierDetail } = await import("./screens/SupplierDetail");
          return { Component: SupplierDetail };
        },
      },
      {
        path: "cash-summary",
        lazy: async () => {
          const { CashSummary } = await import("./screens/CashSummary");
          return { Component: CashSummary };
        },
      },
      {
        path: "notifications",
        lazy: async () => {
          const { NotificationCenter } = await import("./screens/NotificationCenter");
          return { Component: NotificationCenter };
        },
      },
      {
        path: "plans",
        lazy: async () => {
          const { Plans } = await import("./screens/Plans");
          return { Component: Plans };
        },
      },
      {
        path: "plan-payment",
        lazy: async () => {
          const { PlanPayment } = await import("./screens/PlanPayment");
          return { Component: PlanPayment };
        },
      },
      {
        path: "plan-success",
        lazy: async () => {
          const { PlanSuccess } = await import("./screens/PlanSuccess");
          return { Component: PlanSuccess };
        },
      },
      {
        path: "*",
        lazy: async () => {
          const { NotFound } = await import("./screens/NotFound");
          return { Component: NotFound };
        },
      },
    ],
  },
    {
      path: "*",
      lazy: async () => {
        const { NotFound } = await import("./screens/NotFound");
        return { Component: NotFound };
      },
    },
    ],
  },
]);
