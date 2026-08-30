// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  visible?: boolean;
  accessibilityLabel?: string;
}

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

vi.mock("expo-router", () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  usePathname: () => "/dashboard",
}));
vi.mock("../domain/permissions", () => ({ resolvePermission: () => true }));
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

const { AppNavigationShell } = await import(
  "../components/navigation/AppNavigationShell"
);

afterEach(() => cleanup());

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
    expect(animated.timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 1000, useNativeDriver: true }),
    );
  });
});
