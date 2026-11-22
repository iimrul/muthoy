// @vitest-environment jsdom
//
// Expiry Management (prototype layout, 2026-11-22). The screen shows only what
// the actor may do: Discount needs expiry_manage + sale_discount and never
// applies to an expired batch; Return needs the owner (the invoice screen is
// owner-only) and an invoice the batch actually arrived on.

import { createElement, useEffect, type ReactElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SectionStub<T> {
  key: string;
  data: T[];
}
interface SectionListStubProps<T> {
  sections: SectionStub<T>[];
  renderItem: (info: { item: T }) => ReactElement;
  renderSectionHeader: (info: { section: SectionStub<T> }) => ReactElement;
  keyExtractor: (item: T) => string;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
}

interface PressableStubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

vi.mock("react-native", async () => ({
  ...(await import("./support/reactNativeMock")).createReactNativeMock(),
  // React Native's responder system gives a touch to the innermost Pressable
  // only; a DOM click bubbles. Without this the sheet's backdrop (an outer
  // Pressable) would close the sheet on every tap inside it.
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: PressableStubProps) =>
    createElement(
      "button",
      {
        "aria-label": accessibilityLabel,
        disabled,
        onClick: (event: { stopPropagation: () => void }) => {
          event.stopPropagation();
          onPress?.();
        },
      },
      children,
    ),
  SectionList: <T,>({ sections, renderItem, renderSectionHeader, keyExtractor, ListHeaderComponent, ListEmptyComponent }: SectionListStubProps<T>) =>
    createElement(
      "div",
      null,
      ListHeaderComponent,
      sections.length === 0 ? ListEmptyComponent : null,
      ...sections.map((section) =>
        createElement(
          "section",
          { key: section.key },
          renderSectionHeader({ section }),
          ...section.data.map((item) => createElement("div", { key: keyExtractor(item) }, renderItem({ item }))),
        ),
      ),
    ),
}));

const deps = vi.hoisted(() => ({
  listExpiringBatches: vi.fn(),
  setBatchPromotion: vi.fn(),
  setBulkBatchPromotion: vi.fn(),
  reverseBatchPromotion: vi.fn(),
  triggerSyncNow: vi.fn(),
  push: vi.fn(),
  permissions: {} as Record<string, boolean>,
  isOwner: false,
}));

vi.mock("expo-router", () => ({
  router: { push: deps.push, back: vi.fn() },
  useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
}));
vi.mock("../db/inventory", () => ({
  listExpiringBatches: deps.listExpiringBatches,
  setBatchPromotion: deps.setBatchPromotion,
  setBulkBatchPromotion: deps.setBulkBatchPromotion,
  reverseBatchPromotion: deps.reverseBatchPromotion,
}));
vi.mock("../sync", () => ({ triggerSyncNow: deps.triggerSyncNow }));
vi.mock("../components/ui/StandardHeader", () => ({
  StandardHeader: ({ title }: { title: string }) => createElement("h1", null, title),
}));
vi.mock("../state/localeStore", () => ({
  useI18n: () => ({ t: (key: string) => key, formatNumber: (value: number) => String(value) }),
}));
vi.mock("../state/sessionStore", () => ({
  useSessionStore: (selector: (state: { session: unknown }) => unknown) =>
    selector({ session: { shopId: "shop-1", userId: "user-1", role: "owner", permissions: {} } }),
}));
vi.mock("../state/sessionGuard", () => ({
  captureSessionFor: () => ({ ifLive: (callback: () => void) => callback(), isStillActive: () => true }),
}));
vi.mock("../state/usePermission", () => ({
  usePermission: (permission: string) => ({ isAllowed: deps.permissions[permission] === true }),
  useOwnerAccess: () => ({ isAllowed: deps.isOwner }),
}));

const { default: ExpiryScreen } = await import("../app/inventory/expiry");

function row(overrides: Record<string, unknown>) {
  return {
    medicineId: "med-1",
    medicineName: "Napa",
    generic: "Paracetamol",
    manufacturer: "Beximco",
    form: "tablet",
    batchNo: "B1",
    expiryDate: "2027-01-20",
    quantityAvailable: 12,
    salePrice: 200,
    daysUntilExpiry: 5,
    band: "near",
    promotionBps: 0,
    purchaseId: null,
    ...overrides,
  };
}

const ROWS = [
  row({ id: "expired", medicineName: "Old", band: "expired", daysUntilExpiry: -2, purchaseId: "pur-expired" }),
  row({ id: "near", medicineName: "Soon", band: "near", daysUntilExpiry: 5, purchaseId: "pur-near" }),
  row({ id: "far", medicineName: "Later", band: "far", daysUntilExpiry: 45 }),
];

async function renderLoaded(): Promise<void> {
  render(createElement(ExpiryScreen));
  await waitFor(() => expect(screen.getByText("Soon")).toBeTruthy());
}

beforeEach(() => {
  deps.listExpiringBatches.mockReset().mockResolvedValue({ rows: ROWS, nearDays: 30, farDays: 60 });
  deps.setBatchPromotion.mockReset().mockResolvedValue({ promotionId: "p" });
  deps.setBulkBatchPromotion.mockReset().mockResolvedValue(2);
  deps.triggerSyncNow.mockReset().mockResolvedValue(undefined);
  deps.push.mockReset();
  deps.permissions = { expiry_manage: true, sale_discount: true };
  deps.isOwner = true;
});

afterEach(cleanup);

describe("Expiry screen", () => {
  it("splits expired+near into Urgent and far into Warning, with the counts on the cards", async () => {
    await renderLoaded();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("expiryUrgentSection")).toBeTruthy();
    expect(screen.getByText("expiryWarningSection")).toBeTruthy();
    expect(deps.listExpiringBatches).toHaveBeenCalledWith("shop-1", { includePurchaseLinks: true });
  });

  it("offers Discount on every batch but the expired one, and Return only where an invoice exists", async () => {
    await renderLoaded();
    expect(screen.queryByRole("button", { name: "discountLabel Old" })).toBeNull();
    expect(screen.getByRole("button", { name: "discountLabel Soon" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "discountLabel Later" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "returnLabel Old" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "returnLabel Later" })).toBeNull();
    expect(screen.getByRole("button", { name: "expiryDiscountAll" })).toBeTruthy();
  });

  it("opens the invoice the batch arrived on", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "returnLabel Soon" }));
    expect(deps.push).toHaveBeenCalledWith({ pathname: "/suppliers/invoice-detail", params: { purchaseId: "pur-near" } });
  });

  it("shows a staff member without the discount grant no discount and no return", async () => {
    deps.permissions = { expiry_manage: true };
    deps.isOwner = false;
    await renderLoaded();
    expect(screen.queryAllByRole("button", { name: /^discountLabel/ })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /^returnLabel/ })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "expiryDiscountAll" })).toBeNull();
    expect(deps.listExpiringBatches).toHaveBeenCalledWith("shop-1", { includePurchaseLinks: false });
  });

  it("applies a preset discount to one batch as basis points", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "discountLabel Soon" }));
    fireEvent.click(screen.getByText("20%"));
    fireEvent.click(screen.getByText("expiryApplyAction"));
    await waitFor(() => expect(deps.setBatchPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: "shop-1", actorUserId: "user-1", batchId: "near", discountBps: 2000 }),
    ));
    expect(deps.triggerSyncNow).toHaveBeenCalledWith("shop-1");
  });

  it("discounts all expiring batches except the expired one", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "expiryDiscountAll" }));
    fireEvent.click(screen.getByText("10%"));
    fireEvent.click(screen.getByText("expiryApplyAction"));
    await waitFor(() => expect(deps.setBulkBatchPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ batchIds: ["near", "far"], discountBps: 1000 }),
    ));
  });

  it("refuses an out-of-range percent without writing", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "discountLabel Soon" }));
    fireEvent.change(screen.getByLabelText("expiryCustomPercent"), { target: { value: "150" } });
    fireEvent.click(screen.getByText("expiryApplyAction"));
    expect(await screen.findByText("expiryInvalidPercent")).toBeTruthy();
    expect(deps.setBatchPromotion).not.toHaveBeenCalled();
  });

  it("says all is well when nothing is expiring", async () => {
    deps.listExpiringBatches.mockResolvedValue({ rows: [], nearDays: 30, farDays: 60 });
    render(createElement(ExpiryScreen));
    expect(await screen.findByText("expiryNoneTitle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "expiryDiscountAll" })).toBeNull();
  });
});
