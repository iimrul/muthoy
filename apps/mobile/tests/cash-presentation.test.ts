// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CashBreakdown } from "../db/cash";

import { asPaisa, ZERO_PAISA } from "@muthoy/types";
import { expectedCash, type CashFormulaInput } from "../domain/cashFormula";
import { catalog } from "../i18n/catalog";
import { cashFormulaCaption } from "../components/cash/cashPresentation";

vi.mock("react-native", async () =>
  (await import("./support/reactNativeMock")).createReactNativeMock());
const { CashSummarySheet } = await import("../components/cash/CashSummarySheet");
const { useLocaleStore } = await import("../state/localeStore");
afterEach(() => { cleanup(); useLocaleStore.setState({ locale: "en" }); });

const zero: CashFormulaInput = {
  openingCash: ZERO_PAISA,
  cashSales: ZERO_PAISA,
  creditCollections: ZERO_PAISA,
  expenses: ZERO_PAISA,
  refunds: ZERO_PAISA,
  supplierPayments: ZERO_PAISA,
  withdrawals: ZERO_PAISA,
};
const money = (amount: number) => String(amount);
describe("cash presentation completeness", () => {
  it("shows the exact 11200 paisa example with refund and supplier deductions", () => {
    const input = {
      ...zero,
      openingCash: asPaisa(10000),
      cashSales: asPaisa(2000),
      refunds: asPaisa(500),
      supplierPayments: asPaisa(300),
    };
    expect(expectedCash(input)).toBe(11200);
    expect(cashFormulaCaption(input, (key) => catalog.en[key], money)).toBe(
      "Open 10000 + Sales 2000 + Collected 0 − Exp 0 − Refunds 500 − Supplier payments 300 − Withdrawals 0",
    );
  });
  it.each(["en", "bn"] as const)(
    "keeps all seven signed zero terms in %s",
    (locale) => {
      const caption = cashFormulaCaption(
        zero,
        (key) => catalog[locale][key],
        money,
      );
      expect(caption.match(/ 0/g)).toHaveLength(7);
      expect(caption.match(/\+/g)).toHaveLength(2);
      expect(caption.match(/−/g)).toHaveLength(4);
      for (const key of [
        "cashFormulaOpen",
        "cashFormulaSales",
        "cashFormulaCollected",
        "cashFormulaExpense",
        "cashFormulaRefund",
        "cashFormulaSupplier",
        "cashFormulaWithdrawal",
      ] as const) {
        expect(caption).toContain(catalog[locale][key]);
      }
    },
  );
  it("shows labels without inventing values before an end-of-day summary arrives", () => {
    expect(cashFormulaCaption(null, (key) => catalog.en[key], money)).toBe(
      "Open + Sales + Collected − Exp − Refunds − Supplier payments − Withdrawals",
    );
  });
});


describe("seven-term cash sheet, including zero supplier payments", () => {
  it.each(["en", "bn"] as const)("renders the approved order and all zero terms in %s", (locale) => {
    useLocaleStore.setState({ locale });
    const breakdown: CashBreakdown = {
      businessDate: "2026-11-10", openingCash: ZERO_PAISA,
      cashSales: { total: ZERO_PAISA, owner: ZERO_PAISA, staff: ZERO_PAISA, staffBreakdown: [] },
      creditCollections: { total: ZERO_PAISA, details: [] },
      expenses: { total: ZERO_PAISA, details: [] }, refunds: { total: ZERO_PAISA },
      supplierPayments: { total: ZERO_PAISA }, withdrawals: { total: ZERO_PAISA },
      expectedCash: ZERO_PAISA,
      reconciled: { countedAmount: null, at: null, by: null, status: "unknown", diff: null },
    };
    render(createElement(CashSummarySheet, { breakdown }));
    const labels = ["openingCash", "cashSales", "creditCollections", "expensesLabel", "cashRefunds", "supplierPayments", "withdrawals"] as const;
    expect(screen.getAllByLabelText(/./).map(row => row.getAttribute("aria-label")))
      .toEqual(labels.map(key => catalog[locale][key]));
    for (const key of labels) expect(screen.getByLabelText(catalog[locale][key]).textContent).toContain("0");
    expect(screen.getByText(catalog[locale].expectedInDrawerFooter)).toBeTruthy();
  });
});
