// @vitest-environment jsdom

import { createElement, useEffect, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityRole?: string;
}

vi.mock("react-native", () => ({
  View: ({ children }: StubProps) => createElement("div", null, children),
  Text: ({ children, accessibilityRole }: StubProps) =>
    createElement("span", { role: accessibilityRole }, children),
  ScrollView: ({ children }: StubProps) => createElement("div", null, children),
  Pressable: ({ children, onPress }: StubProps) =>
    createElement("button", { onClick: onPress }, children),
  Modal: ({ children, visible }: StubProps & { visible?: boolean }) =>
    visible ? createElement("div", null, children) : null,
  ActivityIndicator: () => createElement("span", { role: "progressbar" }),
  Alert: { alert: vi.fn() },
}));

const deps = vi.hoisted(() => ({
  session: null as null | {
    shopId: string;
    userId: string;
    role: "staff" | "manager";
    permissions: Record<string, boolean>;
  },
  getStaffDashboard: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("expo-router", () => ({
  router: { replace: deps.replace, push: vi.fn() },
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock("@muthoy/constants", () => ({ colors: { brandGreen: "green" } }));
vi.mock("@muthoy/utils", () => ({ formatMoney: (value: number) => String(value) }));
vi.mock("@muthoy/types", () => ({ ZERO_PAISA: 0 }));
vi.mock("../components/ui/LanguageToggle", () => ({ LanguageToggle: () => null }));
vi.mock("../components/ui/AccessDenied", () => ({
  AccessDenied: () => createElement("span", null, "ACCESS_DENIED"),
}));
vi.mock("../components/staff/ManagerDashboard", () => ({
  ManagerDashboard: () => createElement("span", null, "MANAGER_DASHBOARD"),
}));
vi.mock("../db/staffDashboard", () => ({
  getStaffDashboard: deps.getStaffDashboard,
}));
vi.mock("../dev/runtimeDiagnostics", () => ({
  markRuntimeDiagnosticStep: vi.fn(),
  runtimeDiagnosticError: vi.fn(),
  sessionDiagnosticContext: vi.fn(() => ({})),
}));
vi.mock("../domain/permissions", () => ({ resolvePermission: () => true }));
vi.mock("../state/sessionGuard", () => ({
  captureSessionFor: () => ({ ifLive: (callback: () => void) => callback() }),
}));
vi.mock("../state/localeStore", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatNumber: (value: number) => String(value),
    formatTime: (value: string) => value,
  }),
}));
vi.mock("../state/sessionStore", () => ({
  useSessionStore: (selector: (state: { session: typeof deps.session }) => unknown) =>
    selector({ session: deps.session }),
}));
vi.mock("../state/switchUser", () => ({ switchUser: vi.fn() }));
vi.mock("../state/useUnreadCount", () => ({ useUnreadCount: () => 0 }));

const { default: StaffHomeScreen } = await import("../app/(tabs)/staff-home");

beforeEach(() => {
  deps.replace.mockReset();
  deps.getStaffDashboard.mockReset().mockResolvedValue({
    actorName: "Cashier",
    sales: 0,
    transactionCount: 0,
    averageBill: 0,
    recent: [],
  });
});

afterEach(cleanup);

describe("StaffHome role branch", () => {
  it("renders the cashier StaffHome and never the Manager dashboard", async () => {
    deps.session = {
      shopId: "shop-1",
      userId: "staff-1",
      role: "staff",
      permissions: {},
    };
    render(createElement(StaffHomeScreen));

    expect(screen.getByText("dashboardLoading")).toBeTruthy();
    expect(await screen.findByText("newSale")).toBeTruthy();
    expect(screen.queryByText("MANAGER_DASHBOARD")).toBeNull();
  });

  it("branches Manager to ManagerDashboard and never renders cashier StaffHome", () => {
    deps.session = {
      shopId: "shop-1",
      userId: "manager-1",
      role: "manager",
      permissions: {},
    };
    render(createElement(StaffHomeScreen));

    expect(screen.getByText("MANAGER_DASHBOARD")).toBeTruthy();
    expect(screen.queryByText("newSale")).toBeNull();
    expect(deps.getStaffDashboard).not.toHaveBeenCalled();
  });

  it("renders an explicit retryable error instead of a blank cashier screen", async () => {
    deps.session = {
      shopId: "shop-1",
      userId: "staff-1",
      role: "staff",
      permissions: {},
    };
    deps.getStaffDashboard.mockRejectedValueOnce(new Error("db failed"));
    render(createElement(StaffHomeScreen));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "dashboardLoadFailed db failed",
    );
    expect(screen.getByText("retry")).toBeTruthy();
  });
});
