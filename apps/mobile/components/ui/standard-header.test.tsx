// @vitest-environment jsdom
import { createElement, type CSSProperties, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { colors } from "@muthoy/constants";

interface Props {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  accessibilityLabel?: string;
  onPress?: () => void;
  disabled?: boolean;
  numberOfLines?: number;
  placeholderTextColor?: string;
  selectionColor?: string;
  value?: string;
  onChangeText?: (value: string) => void;
}
vi.mock("react-native", () => ({
  View: ({ children, className, style }: Props) =>
    createElement("div", { className, style }, children),
  Text: ({ children, numberOfLines }: Props) =>
    createElement("span", { "data-lines": numberOfLines }, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: Props) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel, disabled },
      children,
    ),
  TextInput: ({
    className,
    placeholderTextColor,
    selectionColor,
    value,
    onChangeText,
  }: Props) =>
    createElement("input", {
      className,
      value,
      "data-placeholder-color": placeholderTextColor,
      "data-selection-color": selectionColor,
      onChange: (event: { target: { value: string } }) =>
        onChangeText?.(event.target.value),
    }),
}));
vi.mock("./LanguageToggle", () => ({
  LanguageToggle: () => createElement("button", null, "Language"),
}));
const { StandardHeader } = await import("./StandardHeader");
const { AppTextInput } = await import("./AppTextInput");
const { useLocaleStore } = await import("../../state/localeStore");
beforeEach(() => useLocaleStore.setState({ locale: "en" }));
afterEach(cleanup);

describe("shared Android screen chrome", () => {
  it("owns a real nonzero top inset once and keeps header actions usable", () => {
    const back = vi.fn(),
      sync = vi.fn();
    const { container } = render(
      createElement(
        SafeAreaInsetsContext.Provider,
        {
          value: { top: 24, bottom: 0, left: 0, right: 0 },
        },
        createElement(StandardHeader, {
          title: "Long inventory title",
          onBackPress: back,
          onSyncPress: sync,
        }),
      ),
    );
    expect((container.firstElementChild as HTMLElement).style.paddingTop).toBe(
      "40px",
    );
    expect(
      screen.getByText("Long inventory title").getAttribute("data-lines"),
    ).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(back).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
  });
  it("allows an explicitly inset-owning parent without doubling the status bar", () => {
    const { container } = render(
      createElement(
        SafeAreaInsetsContext.Provider,
        {
          value: { top: 24, bottom: 0, left: 0, right: 0 },
        },
        createElement(StandardHeader, { title: "Title", safeAreaTop: false }),
      ),
    );
    expect((container.firstElementChild as HTMLElement).style.paddingTop).toBe(
      "16px",
    );
  });
  it("uses explicit input colors while preserving typed text and deliberate overrides", () => {
    const change = vi.fn();
    const { rerender } = render(
      createElement(AppTextInput, { value: "", onChangeText: change }),
    );
    const field = screen.getByRole("textbox");
    expect(field.className).toContain("text-richBlack");
    expect(field.getAttribute("data-placeholder-color")).toBe(colors.midGray);
    expect(field.getAttribute("data-selection-color")).toBe(colors.brandGreen);
    fireEvent.change(field, { target: { value: "Medicine 10" } });
    expect(change).toHaveBeenCalledWith("Medicine 10");
    rerender(
      createElement(AppTextInput, {
        value: "",
        onChangeText: change,
        placeholderTextColor: colors.error,
        selectionColor: colors.error,
      }),
    );
    expect(field.getAttribute("data-placeholder-color")).toBe(colors.error);
    expect(field.getAttribute("data-selection-color")).toBe(colors.error);
  });
});

const { CashSummarySheet } = await import("../cash/CashSummarySheet");
const { asPaisa, ZERO_PAISA } = await import("@muthoy/types");
const { formatMoney } = await import("@muthoy/utils");
const { catalog } = await import("../../i18n/catalog");

describe("cash sheet bilingual rendering", () => {
  it.each(["en", "bn"] as const)("renders refund/supplier deductions and the exact total in %s", locale => {
    useLocaleStore.setState({ locale });
    const value: import("../../db/cash").CashBreakdown = {
      businessDate: "2026-11-09", openingCash: asPaisa(10000),
      cashSales: { total: asPaisa(2000), owner: asPaisa(2000), staff: ZERO_PAISA, staffBreakdown: [] },
      creditCollections: { total: ZERO_PAISA, details: [] }, expenses: { total: ZERO_PAISA, details: [] },
      refunds: { total: asPaisa(500) }, supplierPayments: { total: asPaisa(300) },
      withdrawals: { total: ZERO_PAISA }, expectedCash: asPaisa(11200),
      reconciled: { countedAmount: null, at: null, by: null, status: "unknown", diff: null },
    };
    const { rerender } = render(createElement(CashSummarySheet, { breakdown: value }));
    for (const [label, amount] of [[catalog[locale].cashRefunds, 500], [catalog[locale].supplierPayments, 300]] as const) {
      expect(screen.getByText(label).parentElement?.textContent).toContain("− " + formatMoney(asPaisa(amount)));
    }
    expect(screen.getByText(formatMoney(asPaisa(11200)))).toBeTruthy();
    rerender(createElement(CashSummarySheet, { breakdown: { ...value,
      refunds: { total: ZERO_PAISA }, supplierPayments: { total: ZERO_PAISA } } }));
    expect(screen.getByText(catalog[locale].cashRefunds)).toBeTruthy();
    expect(screen.getByText(catalog[locale].supplierPayments)).toBeTruthy();
  });
});
