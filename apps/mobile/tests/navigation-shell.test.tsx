// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  visible?: boolean;
  accessibilityLabel?: string;
}

const route = vi.hoisted(() => ({ pathname: "/dashboard" }));

const animated = vi.hoisted(() => ({
  loop: vi.fn((animation: unknown) => ({
    animation,
    start: vi.fn(),
    stop: vi.fn(),
  })),
  sequence: vi.fn((steps: unknown[]) => steps),
  timing: vi.fn((_value: unknown, config: unknown) => config),
}));

vi.mock("react-native", () => {
  class Value {
    interpolate() {
      return 1;
    }
  }
  return {
    View: ({ children }: StubProps) => createElement("div", null, children),
    Text: ({ children }: StubProps) => createElement("span", null, children),
    Pressable: ({ children, onPress, accessibilityLabel }: StubProps) =>
      createElement(
        "button",
        { onClick: onPress, "aria-label": accessibilityLabel },
        children,
      ),
    Modal: ({ children, visible }: StubProps) =>
      visible ? createElement("div", null, children) : null,
    StatusBar: { setBarStyle: vi.fn() },
    Alert: { alert: vi.fn() },
    BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    Animated: {
      Value,
      View: ({ children }: StubProps) => createElement("div", null, children),
      loop: animated.loop,
      sequence: animated.sequence,
      timing: animated.timing,
    },
    Easing: { ease: "ease", inOut: (value: unknown) => value },
  };
});

vi.mock("@expo/vector-icons/Feather", () => ({
  default: ({ name }: { name: string }) =>
    createElement("span", { "data-testid": `feather-${name}` }),
}));
vi.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
  default: ({ name }: { name: string }) =>
    createElement("span", { "data-testid": `material-${name}` }),
}));

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), navigate: vi.fn() }));
vi.mock("expo-router", () => ({
  router: routerMock,
  usePathname: () => route.pathname,
}));
vi.mock("../domain/permissions", () => ({ resolvePermission: () => true }));
// The relink banner ends the shift through navigation/endShift.ts, which
// reaches the sync engine. Its ordering is proven in
// components/auth/DeviceRelinkBanner.test.tsx; this suite is about the shell.
vi.mock("../navigation/endShift", () => ({
  endShiftForDeviceRelink: vi.fn(),
  endShiftToPinPad: vi.fn(),
}));
vi.mock("../navigation/routes", () => ({
  authenticatedHome: () => "/dashboard",
  visibleMoreRoutes: () => [
    { key: "reports", href: "/reports", labelKey: "reports" },
  ],
}));
vi.mock("../state/localeStore", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        home: "Home",
        sale: "Sale",
        scan: "Scan",
        inventory: "Inventory",
        more: "More",
      })[key] ?? key,
  }),
}));
vi.mock("../state/sessionStore", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      session: {
        shopId: "shop-1",
        userId: "owner-1",
        role: "owner",
        permissions: undefined,
      },
    }),
}));

const { StatusBar: awaitedStatusBar } = await import("react-native");
const { AppNavigationShell } = await import(
  "../components/navigation/AppNavigationShell"
);

afterEach(() => {
  cleanup();
  route.pathname = "/dashboard";
  vi.clearAllMocks();
});

describe("status icons follow the header surface", () => {
  it.each([
    ["/staff-home", "light-content"],
    ["/inventory", "dark-content"],
    ["/dashboard", "light-content"],
    ["/role-select", "light-content"],
  ])("uses %s: %s", (pathname, style) => {
    route.pathname = pathname!;
    render(createElement(AppNavigationShell, null, createElement("main", null, "content")));
    expect(awaitedStatusBar.setBarStyle).toHaveBeenLastCalledWith(style);
  });
});

describe("tab taps reach the KEPT screens", () => {
  // app/(tabs)/_layout.tsx keeps Home/Sale/Inventory mounted; a tab tap must
  // navigate to the kept screen. replace() would tear it down and rebuild it
  // (measured: Home 8.1 s to settle on a Galaxy A04s, dev mode).
  it.each([
    ["Home", "/dashboard"],
    ["Sale", "/sale"],
    ["Inventory", "/inventory"],
  ])("%s navigates to %s", (label, href) => {
    render(createElement(AppNavigationShell, null, createElement("main", null, "content")));
    // The tab's name is its visible text; the click bubbles to its button.
    fireEvent.click(screen.getByText(label));
    expect(routerMock.navigate).toHaveBeenCalledWith(href);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("Scan, outside the tab group, is still replaced", () => {
    render(createElement(AppNavigationShell, null, createElement("main", null, "content")));
    fireEvent.click(screen.getByLabelText("Scan"));
    expect(routerMock.replace).toHaveBeenCalledWith("/scan");
    expect(routerMock.navigate).not.toHaveBeenCalled();
  });
});

describe("prototype bottom navigation", () => {
  it("uses the prototype stroke icons and starts the two-second scan pulse", () => {
    render(
      createElement(
        AppNavigationShell,
        null,
        createElement("main", null, "content"),
      ),
    );

    expect(screen.getByTestId("feather-home")).toBeTruthy();
    expect(screen.getByTestId("feather-shopping-bag")).toBeTruthy();
    expect(screen.getByTestId("feather-package")).toBeTruthy();
    expect(screen.getByTestId("material-line-scan")).toBeTruthy();
    expect(screen.getByLabelText("Scan")).toBeTruthy();
    expect(animated.loop).toHaveBeenCalledTimes(1);
    // The dashboard hero has a dark green surface.
    expect(awaitedStatusBar.setBarStyle).toHaveBeenCalledWith("light-content");
    expect(animated.timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 1000, useNativeDriver: true }),
    );
  });
});
