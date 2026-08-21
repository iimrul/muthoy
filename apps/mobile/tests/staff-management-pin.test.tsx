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

const SHOP_ID = "8c2f1a30-0000-4000-8000-000000000001";
const OWNER_ID = "8c2f1a30-0000-4000-8000-000000000002";
const STAFF_ID = "8c2f1a30-0000-4000-8000-000000000003";

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  value?: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  visible?: boolean;
}

const native = vi.hoisted(() => ({ alert: vi.fn() }));

vi.mock("react-native", () => ({
  View: ({ children }: StubProps) => createElement("div", null, children),
  Text: ({ children }: StubProps) => createElement("span", null, children),
  ActivityIndicator: () => createElement("span", { role: "progressbar" }),
  Modal: ({ children, visible }: StubProps) =>
    visible ? createElement("div", null, children) : null,
  ScrollView: ({ children }: StubProps) => createElement("div", null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel, disabled },
      children,
    ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    placeholder,
  }: StubProps) =>
    createElement("input", {
      value: value ?? "",
      "aria-label": accessibilityLabel,
      placeholder,
      onChange: (event: { target: { value: string } }) =>
        onChangeText?.(event.target.value),
    }),
  Alert: { alert: native.alert },
}));

vi.mock("expo-router", () => ({
  router: { back: vi.fn(), push: vi.fn() },
  useFocusEffect: (callback: () => void | (() => void)) =>
    useEffect(callback, [callback]),
}));

vi.mock("../components/ui/AccessDenied", () => ({
  AccessDenied: () => createElement("p", null, "Access denied"),
}));

const deps = vi.hoisted(() => ({
  createStaff: vi.fn(),
  activateStaff: vi.fn(),
  deactivateStaff: vi.fn(),
  listStaff: vi.fn(),
  removeStaff: vi.fn(),
  resetStaffPin: vi.fn(),
  setStaffPermissions: vi.fn(),
  getStaffPerformance: vi.fn(),
  triggerSyncNow: vi.fn(),
  triggerSyncAfterInteractions: vi.fn(
    (_shopId: string, onStart?: () => void) => {
      onStart?.();
      return vi.fn();
    },
  ),
}));

vi.mock("../db/staff", () => ({
  createStaff: deps.createStaff,
  activateStaff: deps.activateStaff,
  deactivateStaff: deps.deactivateStaff,
  listStaff: deps.listStaff,
  removeStaff: deps.removeStaff,
  resetStaffPin: deps.resetStaffPin,
  setStaffPermissions: deps.setStaffPermissions,
}));

vi.mock("../db/staffDashboard", () => ({
  getStaffPerformance: deps.getStaffPerformance,
}));

vi.mock("../sync", () => ({
  triggerSyncNow: deps.triggerSyncNow,
  triggerSyncAfterInteractions: deps.triggerSyncAfterInteractions,
}));

vi.mock("../state/usePermission", () => ({
  usePermission: () => ({
    session: { shopId: SHOP_ID, userId: OWNER_ID, role: "owner" },
    isAllowed: true,
  }),
}));

vi.mock("../state/sessionGuard", () => ({
  captureSessionFor: () => ({
    isStillActive: () => true,
    ifLive: (effect: () => void) => effect(),
    ifLiveAsync: (effect: () => Promise<void>) => effect(),
  }),
}));

const { DuplicatePinError } = await import("../db/errors");
const { default: StaffManagementScreen } =
  await import("../app/staff/management");
const { useLocaleStore } = await import("../state/localeStore");

let frameQueue: FrameRequestCallback[];

async function paintAndComplete(): Promise<void> {
  act(() => frameQueue.shift()?.(0));
  await act(async () => frameQueue.shift()?.(16));
}

function pressPin(pin: string): void {
  act(() => {
    for (const digit of pin) {
      fireEvent.click(screen.getByLabelText(`Digit ${digit}`));
    }
  });
}

async function reachPinSetup(): Promise<void> {
  render(createElement(StaffManagementScreen));
  await waitFor(() => expect(deps.listStaff).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "+ Add New Staff" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Arif" },
  });
  fireEvent.change(screen.getByLabelText("Phone Number"), {
    target: { value: "01712345678" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Set PIN")).toBeTruthy();
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" });
  vi.stubGlobal("__DEV__", true);
  frameQueue = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frameQueue.push(callback);
      return frameQueue.length;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  deps.listStaff.mockReset().mockResolvedValue([]);
  deps.getStaffPerformance.mockReset().mockResolvedValue([]);
  deps.createStaff.mockReset().mockResolvedValue({
    id: STAFF_ID,
    name: "Arif",
    phone: "+8801712345678",
    role: "staff",
    isActive: true,
    permissions: {},
  });
  deps.triggerSyncNow.mockReset();
  deps.triggerSyncAfterInteractions.mockClear();
  native.alert.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("staff PIN creation", () => {
  it("submits the confirmed four-digit PIN once and creates the staff login", async () => {
    await reachPinSetup();

    pressPin("4321");
    expect(screen.getByText("Set PIN")).toBeTruthy();
    await paintAndComplete();
    expect(screen.getByText("Confirm PIN")).toBeTruthy();

    pressPin("4321");
    await paintAndComplete();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(deps.createStaff).toHaveBeenCalledTimes(1));
    expect(deps.createStaff).toHaveBeenCalledWith(
      SHOP_ID,
      OWNER_ID,
      expect.objectContaining({
        name: "Arif",
        phone: "01712345678",
        rawPin: "4321",
        role: "staff",
        permissions: expect.any(Object),
      }),
      expect.any(Function),
    );
    expect(deps.triggerSyncAfterInteractions).toHaveBeenCalledWith(SHOP_ID);
    expect(native.alert).not.toHaveBeenCalled();
  });

  it("surfaces a PIN collision instead of the generic failure dialog", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    deps.createStaff.mockRejectedValueOnce(new DuplicatePinError());
    await reachPinSetup();

    pressPin("1234");
    await paintAndComplete();
    pressPin("1234");
    await paintAndComplete();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "That PIN is already used by someone at this shop. Choose another.",
      ),
    ).toBeTruthy();
    expect(native.alert).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
