// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  ScrollView: ({
    children,
    accessibilityRole,
  }: {
    children?: ReactNode;
    accessibilityRole?: string;
  }) => createElement("div", { role: accessibilityRole }, children),
  Text: ({ children }: { children?: ReactNode }) =>
    createElement("span", null, children),
  View: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("expo-router", () => ({ usePathname: () => "/staff-home" }));

function BrokenDashboard(): ReactNode {
  throw new Error("physical render failed");
}

const { AuthenticatedRuntimeErrorBoundary, DevRuntimeErrorBoundary } = await import(
  "../components/navigation/AuthenticatedRuntimeErrorBoundary"
);
const { markRuntimeDiagnosticStep } = await import("./runtimeDiagnostics");

beforeEach(() => {
  vi.stubGlobal("__DEV__", true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DEV runtime diagnostics", () => {
  it("leaves the production tree unchanged and emits no diagnostic log", () => {
    vi.stubGlobal("__DEV__", false);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    render(
      createElement(
        AuthenticatedRuntimeErrorBoundary,
        null,
        createElement("span", null, "production child"),
      ),
    );

    expect(screen.getByText("production child")).toBeTruthy();
    expect(log).not.toHaveBeenCalled();
  });

  it("shows and logs safe context for an uncaught render error", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    markRuntimeDiagnosticStep("staff_home_cashier_branch_selected", {
      currentRoute: "/staff-home",
      userId: "user-1",
      shopId: "shop-1",
      resolvedRole: "staff",
      permissionCount: 2,
    });

    render(
      createElement(
        DevRuntimeErrorBoundary,
        {
          context: {
            currentRoute: "/staff-home",
            userId: "user-1",
            shopId: "shop-1",
            resolvedRole: "staff",
            permissionCount: 2,
          },
        },
        createElement(BrokenDashboard),
      ),
    );

    const diagnostic = screen.getByRole("alert");
    expect(diagnostic.textContent).toContain("physical render failed");
    expect(diagnostic.textContent).toContain("/staff-home");
    expect(diagnostic.textContent).toContain("user-1");
    expect(diagnostic.textContent).toContain("shop-1");
    expect(diagnostic.textContent).toContain("staff");
    expect(diagnostic.textContent).toContain("2");
    expect(diagnostic.textContent).toContain(
      "staff_home_cashier_branch_selected",
    );
    expect(log).toHaveBeenCalledWith(
      "[staff-home:runtime-error]",
      expect.objectContaining({
        errorMessage: "physical render failed",
        currentRoute: "/staff-home",
        userId: "user-1",
        shopId: "shop-1",
        resolvedRole: "staff",
        permissionCount: 2,
        lastCompletedStep: "staff_home_cashier_branch_selected",
      }),
    );
  });
});
