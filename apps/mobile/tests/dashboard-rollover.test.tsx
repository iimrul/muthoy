// @vitest-environment jsdom

import { createElement, useEffect, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP_ID = "8d000000-0000-4000-8000-000000000001";
const OWNER_ID = "8d000000-0000-4000-8000-000000000002";
const TODAY = "2026-08-23";
const YESTERDAY = "2026-08-22";

const mmkv = vi.hoisted(() => {
  const stores = new Map<string, Map<string, string>>();
  return {
    stores,
    createMMKV: ({ id }: { id: string }) => {
      const store = stores.get(id) ?? new Map<string, string>();
      stores.set(id, store);
      return {
        set: (key: string, value: string) => void store.set(key, value),
        getString: (key: string) => store.get(key),
        remove: (key: string) => void store.delete(key),
      };
    },
  };
});
vi.mock("react-native-mmkv", () => ({ createMMKV: mmkv.createMMKV }));

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  visible?: boolean;
  accessibilityLabel?: string;
  disabled?: boolean;
}
vi.mock("react-native", () => ({
  View: ({ children }: StubProps) => createElement("div", null, children),
  Text: ({ children }: StubProps) => createElement("span", null, children),
  ScrollView: ({ children }: StubProps) => createElement("div", null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel, disabled },
      children,
    ),
  Modal: ({ children, visible }: StubProps) =>
    visible ? createElement("div", null, children) : null,
  ActivityIndicator: () => createElement("span", null, "spinner"),
  Alert: { alert: vi.fn() },
}));

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("expo-router", () => ({
  router,
  useFocusEffect: (callback: () => void | (() => void)) =>
    useEffect(callback, [callback]),
}));

vi.mock("../components/dashboard/DashboardCards", () => ({
  KpiCard: ({ label, accessory }: { label: string; accessory?: ReactNode }) =>
    createElement("div", null, label, accessory),
  AlertCard: ({ title }: { title: string }) =>
    createElement("div", null, title),
  SectionHeader: ({ title }: { title: string }) =>
    createElement("div", null, title),
}));
vi.mock("../components/ui/AccessDenied", () => ({
  AccessDenied: () => createElement("div", null, "denied"),
}));
vi.mock("../components/staff/DashboardLoadState", () => ({
  DashboardLoadState: () => createElement("div", null, "loading"),
}));
vi.mock("../components/ui/LanguageToggle", () => ({
  LanguageToggle: () => null,
}));
vi.mock("../components/cash/OpeningCashModal", () => ({
  OpeningCashModal: ({
    visible,
    onClose,
  }: {
    visible: boolean;
    onClose: () => void;
  }) =>
    visible
      ? createElement(
          "div",
          { "data-testid": "opening-cash" },
          "Opening Cash",
          createElement("button", { onClick: onClose }, "Close Opening"),
        )
      : null,
}));
vi.mock("../components/cash/PreviousDaySummaryModal", () => ({
  PreviousDaySummaryModal: ({
    visible,
    onClose,
  }: {
    visible: boolean;
    onClose: () => void;
  }) =>
    visible
      ? createElement(
          "div",
          { "data-testid": "previous-day" },
          "Previous Day",
          createElement("button", { onClick: onClose }, "Close Previous"),
        )
      : null,
}));
vi.mock("../state/useUnreadCount", () => ({ useUnreadCount: () => 0 }));
vi.mock("../state/usePlan", () => ({
  usePlan: () => ({ plan: "free", effectiveTier: "free", status: "active", reason: "free", loading: false, refresh: vi.fn() }),
}));
vi.mock("../components/ui/PlanBadge", () => ({ PlanBadge: () => null }));
vi.mock("../components/ui/TrialBanner", () => ({ TrialBanner: () => null }));
vi.mock("../components/ui/ShopSwitcher", () => ({ ShopSwitcher: () => null }));
const multiShopAccess = vi.hoisted(() => ({
  entitled: true,
  primaryShopId: null as string | null,
  liveShopCount: 0,
  allowed: true,
  hasMultipleShops: false,
  loading: false,
}));
vi.mock("../state/useMultiShopAccess", () => ({
  useMultiShopAccess: () => multiShopAccess,
}));
vi.mock("../state/switchShop", () => ({ switchActiveShop: vi.fn() }));
vi.mock("../sync/connectivity", () => ({
  hasNetworkConnection: vi.fn(async () => true),
}));
vi.mock("../dev/authTiming", () => ({
  completePendingAuthTimingStage: vi.fn(),
}));

const deps = vi.hoisted(() => ({
  currentBusinessDate: vi.fn(),
  hasCashDrawerForDate: vi.fn(),
  setOpeningCash: vi.fn(),
  getOwnerDashboard: vi.fn(),
  getDaySummary: vi.fn(),
  triggerSyncNow: vi.fn(),
  subscribeToSyncCompletion: vi.fn(() => vi.fn()),
  getLastSuccessfulSyncAt: vi.fn(() => null),
  stopSyncEngine: vi.fn(),
}));
vi.mock("../db/cash", () => ({
  currentBusinessDate: deps.currentBusinessDate,
  hasCashDrawerForDate: deps.hasCashDrawerForDate,
  setOpeningCash: deps.setOpeningCash,
}));
vi.mock("../db/ownerDashboard", () => ({
  getOwnerDashboard: deps.getOwnerDashboard,
  getDaySummary: deps.getDaySummary,
}));
vi.mock("../sync", () => ({
  triggerSyncNow: deps.triggerSyncNow,
  subscribeToSyncCompletion: deps.subscribeToSyncCompletion,
  getLastSuccessfulSyncAt: deps.getLastSuccessfulSyncAt,
  stopSyncEngine: deps.stopSyncEngine,
}));

const { asPaisa } = await import("@muthoy/types");
const { markBusinessDateSeen } = await import("../state/businessDayStore");
const { useLocaleStore } = await import("../state/localeStore");
const { useSessionStore } = await import("../state/sessionStore");
const { switchActiveShop } = await import("../state/switchShop");
const Dashboard = (await import("../app/(tabs)/dashboard")).default;

const DAY_SUMMARY = {
  businessDate: YESTERDAY,
  totalSales: asPaisa(0),
  cashSales: asPaisa(0),
  creditSales: asPaisa(0),
  transactionCount: 0,
  averageSale: asPaisa(0),
  topItems: [],
  trend: null,
};

const DASHBOARD_DATA = {
  businessDate: TODAY,
  ownerName: "Owner",
  shopName: "Shop",
  hasCashDrawer: false,
  today: { totalSales: asPaisa(0), transactionCount: 0, isClosed: false },
  yesterday: DAY_SUMMARY,
  cash: { expected: asPaisa(0) },
  credit: { outstanding: asPaisa(0), customerCount: 0, overdueCount: 0 },
  supplierPayable: { payable: asPaisa(0), supplierCount: 0 },
  expiry: { rows: [], moreCount: 0, total: 0 },
  lowStock: { rows: [], moreCount: 0, total: 0 },
  activeStaff: [],
  recentActivity: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  useLocaleStore.getState().setLocale("en");
  useSessionStore.setState({ session: null, epoch: 0 });
  deps.currentBusinessDate.mockReturnValue(TODAY);
  deps.hasCashDrawerForDate.mockResolvedValue(false);
  deps.getOwnerDashboard.mockResolvedValue(DASHBOARD_DATA);
  deps.getDaySummary.mockResolvedValue(DAY_SUMMARY);
  multiShopAccess.entitled = true;
  multiShopAccess.primaryShopId = null;
  multiShopAccess.liveShopCount = 0;
  multiShopAccess.allowed = true;
  multiShopAccess.hasMultipleShops = false;
  multiShopAccess.loading = false;
});

afterEach(cleanup);

describe("dashboard day rollover modal sequence", () => {
  it("shows previous day first, then opening cash after close, exactly once", async () => {
    markBusinessDateSeen(SHOP_ID, YESTERDAY);
    useSessionStore
      .getState()
      .login({ shopId: SHOP_ID, userId: OWNER_ID, role: "owner" });

    const first = render(createElement(Dashboard));
    await waitFor(() =>
      expect(screen.getByTestId("previous-day")).toBeTruthy(),
    );
    expect(screen.queryByTestId("opening-cash")).toBeNull();

    fireEvent.click(screen.getByText("Close Previous"));
    await waitFor(() =>
      expect(screen.getByTestId("opening-cash")).toBeTruthy(),
    );
    expect(screen.queryByTestId("previous-day")).toBeNull();
    expect(deps.getDaySummary).toHaveBeenCalledTimes(1);
    expect(deps.hasCashDrawerForDate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Close Opening"));
    expect(screen.queryByTestId("opening-cash")).toBeNull();
    first.unmount();

    render(createElement(Dashboard));
    await act(async () => undefined);
    expect(screen.queryByTestId("previous-day")).toBeNull();
    expect(screen.queryByTestId("opening-cash")).toBeNull();
    expect(deps.getDaySummary).toHaveBeenCalledTimes(1);
    expect(deps.hasCashDrawerForDate).toHaveBeenCalledTimes(1);
  });
});

describe("dashboard downgrade recovery: return to primary shop", () => {
  const login = () =>
    useSessionStore
      .getState()
      .login({ shopId: SHOP_ID, userId: OWNER_ID, role: "owner" });

  it("stays hidden while entitled, or while already on the primary shop", async () => {
    login();
    multiShopAccess.entitled = true;
    multiShopAccess.primaryShopId = "some-other-shop";
    render(createElement(Dashboard));
    await waitFor(() => expect(screen.getByText("PHARMAPOS")).toBeTruthy());
    expect(screen.queryByText("Return to primary shop")).toBeNull();

    cleanup();
    multiShopAccess.entitled = false;
    multiShopAccess.primaryShopId = SHOP_ID;
    render(createElement(Dashboard));
    await waitFor(() => expect(screen.getByText("PHARMAPOS")).toBeTruthy());
    expect(screen.queryByText("Return to primary shop")).toBeNull();
  });

  it("shows only the recovery action, never the full Multi-Shop switcher, for a stranded Free owner", async () => {
    login();
    multiShopAccess.entitled = false;
    multiShopAccess.primaryShopId = "primary-shop-id";
    render(createElement(Dashboard));

    await waitFor(() =>
      expect(screen.getByText("Return to primary shop")).toBeTruthy(),
    );
    expect(screen.getByText(/doesn't cover multiple shops/)).toBeTruthy();
  });

  it("switches to the primary shop through the existing safe exception, then the control disappears", async () => {
    login();
    multiShopAccess.entitled = false;
    multiShopAccess.primaryShopId = "primary-shop-id";
    vi.mocked(switchActiveShop).mockResolvedValue(undefined);
    render(createElement(Dashboard));
    await waitFor(() =>
      expect(screen.getByText("Return to primary shop")).toBeTruthy(),
    );

    fireEvent.click(screen.getByText("Return to primary shop"));
    await waitFor(() =>
      expect(switchActiveShop).toHaveBeenCalledWith("primary-shop-id", true),
    );
    expect(router.replace).toHaveBeenCalledWith("/dashboard");

    // The switch landed the owner back on the primary shop: re-render with
    // that reflected and the control is gone.
    multiShopAccess.primaryShopId = SHOP_ID;
    cleanup();
    render(createElement(Dashboard));
    await waitFor(() => expect(screen.getByText("PHARMAPOS")).toBeTruthy());
    expect(screen.queryByText("Return to primary shop")).toBeNull();
  });

  it("surfaces an error and keeps the control when the switch fails", async () => {
    login();
    multiShopAccess.entitled = false;
    multiShopAccess.primaryShopId = "primary-shop-id";
    vi.mocked(switchActiveShop).mockRejectedValue(new Error("offline"));
    render(createElement(Dashboard));
    await waitFor(() =>
      expect(screen.getByText("Return to primary shop")).toBeTruthy(),
    );

    fireEvent.click(screen.getByText("Return to primary shop"));
    await waitFor(() => expect(switchActiveShop).toHaveBeenCalled());
    expect(screen.getByText("Return to primary shop")).toBeTruthy();
  });
});
