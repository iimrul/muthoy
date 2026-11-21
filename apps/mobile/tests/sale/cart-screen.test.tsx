// @vitest-environment jsdom
//
// Cart rows get the cart store's own actions (stable) and call them with their
// own medicineId, so a +/− re-renders one row instead of the whole cart. These
// tests pin the wiring that change could break: each button acts on ITS line.

import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mmkv = vi.hoisted(() => {
  const stores = new Map<string, Map<string, string>>();
  return {
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
  accessibilityLabel?: string;
  disabled?: boolean;
}
interface ListProps<T> {
  data: readonly T[];
  renderItem: (info: { item: T; index: number }) => ReactNode;
  keyExtractor: (item: T) => string;
  ListEmptyComponent?: ReactNode;
}

vi.mock("react-native", () => ({
  View: ({ children }: StubProps) => createElement("div", null, children),
  Text: ({ children }: StubProps) => createElement("span", null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement("button", { onClick: onPress, "aria-label": accessibilityLabel, disabled }, children),
  FlatList: <T,>({ data, renderItem, keyExtractor, ListEmptyComponent }: ListProps<T>) =>
    createElement(
      "div",
      null,
      data.length === 0
        ? ListEmptyComponent
        : data.map((item, index) => createElement("div", { key: keyExtractor(item) }, renderItem({ item, index }))),
    ),
}));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), push: vi.fn(), replace: vi.fn(), dismissTo: vi.fn() } }));
vi.mock("@expo/vector-icons/Feather", () => ({ default: () => null }));
vi.mock("../../components/ui/StandardHeader", () => ({
  StandardHeader: ({ title }: { title: string }) => createElement("h1", null, title),
}));
vi.mock("../../components/ui/EmptyState", () => ({
  EmptyState: ({ title }: { title: string }) => createElement("p", null, title),
}));
vi.mock("../../components/ui/AppTextInput", () => ({
  AppTextInput: ({ value, accessibilityLabel }: { value: string; accessibilityLabel?: string }) =>
    createElement("input", { value, readOnly: true, "aria-label": accessibilityLabel }),
}));
vi.mock("../../db/sales", () => ({ getActiveBatchForMedicine: vi.fn(async () => null) }));

const { default: CartScreen } = await import("../../app/sale/cart");
const { useCartStore } = await import("../../state/cartStore");
const { useLocaleStore } = await import("../../state/localeStore");
const { useSessionStore } = await import("../../state/sessionStore");
const { asPaisa } = await import("@muthoy/types");

function line(medicineId: string, medicineName: string, quantity: number) {
  return {
    medicineId,
    medicineName,
    batchId: `${medicineId}-batch`,
    quantity,
    unitPrice: asPaisa(1000),
    availableQuantity: 50,
    expiryDate: "2099-01-01",
  };
}

const quantityOf = (medicineId: string) =>
  useCartStore.getState().items.find((item) => item.medicineId === medicineId)?.quantity;

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" });
  useSessionStore.getState().login({ shopId: "shop-1", userId: "owner-1", role: "owner" });
  useCartStore.setState({ items: [line("napa", "Napa", 2), line("flacol", "Flacol", 5)] });
});

afterEach(() => cleanup());

describe("cart rows act on their own line", () => {
  it("+ and − change only the line they belong to", async () => {
    render(createElement(CartScreen));

    await act(async () => fireEvent.click(screen.getByLabelText("Increase Napa quantity")));
    expect(quantityOf("napa")).toBe(3);
    expect(quantityOf("flacol")).toBe(5);

    await act(async () => fireEvent.click(screen.getByLabelText("Decrease Flacol quantity")));
    expect(quantityOf("flacol")).toBe(4);
    expect(quantityOf("napa")).toBe(3);
    expect(screen.getByLabelText("Flacol quantity")).toHaveProperty("value", "4");
  });

  it("a quick-quantity chip sets that line, and the trash removes only that line", async () => {
    render(createElement(CartScreen));

    await act(async () => fireEvent.click(screen.getByLabelText("Set Napa quantity to 10")));
    expect(quantityOf("napa")).toBe(10);

    await act(async () => fireEvent.click(screen.getByLabelText("Remove Flacol")));
    expect(quantityOf("flacol")).toBeUndefined();
    expect(quantityOf("napa")).toBe(10);
  });
});
