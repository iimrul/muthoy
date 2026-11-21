// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

interface StubProps {
  children?: ReactNode;
  className?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; disabled?: boolean };
  disabled?: boolean;
  visible?: boolean;
}

vi.mock("react-native", () => ({
  View: (p: StubProps) => createElement("div", { className: p.className }, p.children),
  Text: (p: StubProps) => createElement("span", { className: p.className }, p.children),
  Pressable: (p: StubProps) =>
    createElement(
      "button",
      {
        onClick: p.onPress,
        disabled: p.disabled,
        "aria-label": p.accessibilityLabel,
        "aria-selected": p.accessibilityState?.selected,
      },
      p.children,
    ),
  Modal: (p: StubProps) => (p.visible ? createElement("div", { role: "dialog" }, p.children) : null),
  KeyboardAvoidingView: (p: StubProps) => createElement("div", null, p.children),
  Platform: { OS: "android" },
}));
vi.mock("@expo/vector-icons/Feather", () => ({ default: () => null }));

const { DateField } = await import("./DateField");
const { useLocaleStore } = await import("../../state/localeStore");

function renderField(props: Partial<Parameters<typeof DateField>[0]> = {}) {
  const onChange = vi.fn();
  render(createElement(DateField, { value: "", onChange, accessibilityLabel: "Expiry date", ...props }));
  return onChange;
}

beforeEach(() => useLocaleStore.setState({ locale: "en" }));
afterEach(cleanup);

describe("DateField", () => {
  it("shows the stored date in words, never the raw YYYY-MM-DD", () => {
    renderField({ value: "2027-01-15" });
    expect(screen.getByText("15 Jan 2027")).toBeTruthy();
    expect(screen.queryByText("2027-01-15")).toBeNull();
  });

  it("asks for a date when empty", () => {
    renderField();
    expect(screen.getByText("Choose a date")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on the stored month and saves the tapped day as YYYY-MM-DD", () => {
    const onChange = renderField({ value: "2027-01-15" });
    fireEvent.click(screen.getByLabelText("Expiry date: 15 Jan 2027"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("January 2027")).toBeTruthy();
    expect(screen.getByLabelText("15 Jan 2027").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByLabelText("20 Jan 2027"));
    expect(onChange).toHaveBeenCalledWith("2027-01-20");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("steps by month and by year, crossing the year boundary", () => {
    const onChange = renderField({ value: "2026-12-10" });
    fireEvent.click(screen.getByLabelText("Expiry date: 10 Dec 2026"));

    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.getByText("January 2027")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next year"));
    expect(screen.getByText("January 2028")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous month"));
    expect(screen.getByText("December 2027")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("31 Dec 2027"));
    expect(onChange).toHaveBeenCalledWith("2027-12-31");
  });

  it("will not pick a day outside the allowed range", () => {
    const onChange = renderField({ value: "2026-11-15", minDate: "2026-11-10", maxDate: "2026-11-20" });
    fireEvent.click(screen.getByLabelText("Expiry date: 15 Nov 2026"));

    fireEvent.click(screen.getByLabelText("9 Nov 2026"));
    fireEvent.click(screen.getByLabelText("21 Nov 2026"));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("10 Nov 2026"));
    expect(onChange).toHaveBeenCalledWith("2026-11-10");
  });

  it("clears an optional date", () => {
    const onChange = renderField({ value: "2026-11-15", isClearable: true });
    fireEvent.click(screen.getByLabelText("Expiry date: 15 Nov 2026"));
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not offer Clear for a required date", () => {
    renderField({ value: "2026-11-15" });
    fireEvent.click(screen.getByLabelText("Expiry date: 15 Nov 2026"));
    expect(screen.queryByText("Clear")).toBeNull();
  });

  it("writes days and the month in Bengali when the app is in Bengali", () => {
    useLocaleStore.setState({ locale: "bn" });
    renderField({ value: "2027-01-15" });
    fireEvent.click(screen.getByLabelText(/^Expiry date: /));
    expect(screen.getByText("১৫")).toBeTruthy();
  });
});
