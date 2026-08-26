// @vitest-environment jsdom

import { createElement, Fragment, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { asPaisa } from "@muthoy/types";

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  onChangeText?: (value: string) => void;
  onValueChange?: (value: boolean) => void;
  value?: string | boolean;
  visible?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  placeholder?: string;
  data?: readonly unknown[];
  renderItem?: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown, index: number) => string;
  ListEmptyComponent?: ReactNode | (() => ReactNode);
}

vi.mock("react-native", () => ({
  View: ({ children, accessibilityLabel }: StubProps) =>
    createElement("div", { "aria-label": accessibilityLabel }, children),
  Text: ({ children }: StubProps) => createElement("span", null, children),
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
      value: typeof value === "string" ? value : "",
      "aria-label": accessibilityLabel,
      placeholder,
      onChange: (event: { target: { value: string } }) =>
        onChangeText?.(event.target.value),
    }),
  Switch: ({ value, onValueChange, accessibilityLabel }: StubProps) =>
    createElement("input", {
      type: "checkbox",
      checked: Boolean(value),
      "aria-label": accessibilityLabel,
      onChange: () => onValueChange?.(!value),
    }),
  Modal: ({ children, visible }: StubProps) =>
    visible ? createElement("div", null, children) : null,
  FlatList: ({
    data,
    renderItem,
    keyExtractor,
    ListEmptyComponent,
  }: StubProps) => {
    const rows = data ?? [];
    if (rows.length === 0) {
      return typeof ListEmptyComponent === "function"
        ? createElement(ListEmptyComponent)
        : (ListEmptyComponent ?? null);
    }
    return createElement(
      "div",
      null,
      ...rows.map((item, index) =>
        createElement(
          Fragment,
          { key: keyExtractor?.(item, index) ?? index },
          renderItem?.({ item, index }),
        ),
      ),
    );
  },
  Alert: { alert: vi.fn() },
}));

const routerMock = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));
vi.mock("expo-router", () => ({ router: routerMock }));
vi.mock("../../components/ui/StandardHeader", () => ({
  StandardHeader: ({ title }: { title: string }) =>
    createElement("h1", null, title),
}));
vi.mock("../../components/scanner/MedicineTextScanner", () => ({
  MedicineTextScanner: ({ visible }: { visible: boolean }) =>
    visible ? createElement("p", null, "scanner-open") : null,
}));
vi.mock("../../state/useUnreadCount", () => ({ useUnreadCount: () => 0 }));

const deps = vi.hoisted(() => ({
  archiveMedicine: vi.fn(),
  createMedicineWithPurchase: vi.fn(),
  listBatchesForMedicine: vi.fn(),
  listManufacturerSuggestions: vi.fn(),
  listMedicines: vi.fn(),
  listSupplierPickerOptions: vi.fn(),
  triggerSyncNow: vi.fn(),
}));

vi.mock("../../db/inventory", () => ({
  archiveMedicine: deps.archiveMedicine,
  createMedicineWithPurchase: deps.createMedicineWithPurchase,
  listBatchesForMedicine: deps.listBatchesForMedicine,
  listManufacturerSuggestions: deps.listManufacturerSuggestions,
  listMedicines: deps.listMedicines,
}));
vi.mock("../../db/suppliers", () => ({
  listSupplierPickerOptions: deps.listSupplierPickerOptions,
}));
vi.mock("../../sync", () => ({ triggerSyncNow: deps.triggerSyncNow }));

const { unavailableMedicineSearchProvider } = await import(
  "../../domain/medicineSearchProvider"
);
const { useLocaleStore } = await import("../../state/localeStore");
const { useI18n } = await import("../../state/localeStore");
const { useSessionStore } = await import("../../state/sessionStore");
const AddMedicineScreen = (await import("../../app/inventory/add-medicine"))
  .default;
const InventoryScreen = (await import("../../app/(tabs)/inventory")).default;
const { InventoryCard } = await import("../../app/(tabs)/inventory");

const SESSION = {
  shopId: "10000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000002",
  role: "staff" as const,
  permissions: { inventory_add: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.getState().setLocale("en");
  useSessionStore.setState({ session: SESSION });
  deps.listSupplierPickerOptions.mockResolvedValue([
    { id: "supplier-1", name: "Square" },
  ]);
  deps.listManufacturerSuggestions.mockResolvedValue([]);
  deps.listMedicines.mockResolvedValue([]);
  deps.listBatchesForMedicine.mockResolvedValue([]);
});

afterEach(() => cleanup());

function MoneyProbe() {
  const { formatMoney } = useI18n();
  return createElement("p", null, formatMoney(asPaisa(123450)));
}

describe("Add Medicine parity recovery", () => {
  it("prefills Manual Entry from the selected search result", async () => {
    vi.spyOn(unavailableMedicineSearchProvider, "search").mockResolvedValueOnce([
      {
        id: "master-1",
        name: "Napa Extra",
        generic: "Paracetamol",
        manufacturer: "Beximco",
      },
    ]);
    render(createElement(AddMedicineScreen));

    fireEvent.change(screen.getByRole("textbox", { name: "Search medicine" }), {
      target: { value: "Napa" },
    });
    await waitFor(() => expect(screen.getByText("Napa Extra")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Napa Extra"));

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Medicine name *") as HTMLInputElement).value,
      ).toBe("Napa Extra"),
    );
    expect((screen.getByLabelText("Generic name") as HTMLInputElement).value)
      .toBe("Paracetamol");
    expect((screen.getByLabelText("Manufacturer") as HTMLInputElement).value)
      .toBe("Beximco");
    fireEvent.change(screen.getByLabelText("Batch number *"), {
      target: { value: "NAPA-1" },
    });
    fireEvent.change(screen.getByLabelText("Purchase price (৳) *"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Sale price (৳) *"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Quantity *"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByLabelText("Select a supplier."));
    fireEvent.click(screen.getByLabelText("Square"));
    fireEvent.click(screen.getByLabelText("Requires prescription"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Save medicine"));
    });
    await waitFor(() =>
      expect(deps.createMedicineWithPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          supplierId: "supplier-1",
          requiresPrescription: true,
        }),
      ),
    );
  });

  it("offers the search-shell scan action and opens the real scanner flow", async () => {
    render(createElement(AddMedicineScreen));
    fireEvent.click(screen.getByLabelText("Scan strip to prefill"));
    await waitFor(() => expect(screen.getByText("scanner-open")).toBeTruthy());
  });
});

describe("Inventory action permissions and FEFO badge", () => {
  it("localizes expanded-batch money digits without changing paisa", () => {
    render(createElement(MoneyProbe));
    expect(screen.getByText("৳1,234.50")).toBeTruthy();
    act(() => useLocaleStore.getState().setLocale("bn"));
    expect(screen.getByText("৳১,২৩৪.৫০")).toBeTruthy();
  });

  it("shows only actions granted to an inventory_add staff member", async () => {
    render(createElement(InventoryScreen));
    await waitFor(() => expect(deps.listMedicines).toHaveBeenCalled());
    expect(screen.getByLabelText("Add Stock")).toBeTruthy();
    expect(screen.queryByLabelText("Expiry")).toBeNull();
    expect(screen.queryByLabelText("Import CSV")).toBeNull();
    expect(screen.queryByLabelText("Edit")).toBeNull();
    expect(screen.queryByLabelText("Delete")).toBeNull();
  });

  it("marks only the actual sellable FEFO batch Active", () => {
    render(
      createElement(InventoryCard, {
        medicine: {
          medicineId: "medicine-1",
          name: "Napa",
          generic: "Paracetamol",
          manufacturer: "Beximco",
          threshold: 10,
          totalStock: 9,
          sellableStock: 4,
          batchCount: 2,
          batchSearchText: "EXPIRED SELLABLE",
          hasExpiringStock: false,
          activePromotionBps: null,
          activeBatch: {
            id: "sellable",
            medicineId: "medicine-1",
            expiryDate: "2099-02-01",
            quantityAvailable: 4,
            salePrice: asPaisa(1200),
          },
        },
        t: (key: string) =>
          ({
            activeBatchLabel: "Active",
            daysShortSuffix: "d",
            thresholdLabel: "Threshold",
            currentLabel: "Current",
            batchesCountLabel: "Batches",
            expiryShortLabel: "Expiry",
            genericNameLabel: "Generic",
            manufacturerLabel: "Manufacturer",
            statusOkLabel: "OK",
            viewBatchesLabel: "View Batches",
            batchNoColumnLabel: "Batch",
            qtyColumnLabel: "Qty",
            priceColumnLabel: "Price",
            expiredLabel: "Expired",
            editLabel: "Edit",
            deleteLabel: "Delete",
          })[key] ?? key,
        formatNumber: String,
        formatDate: String,
        formatPercent: String,
        formatMoney: () => "৳12.00",
        expanded: true,
        batches: [
          {
            id: "expired",
            medicineId: "medicine-1",
            batchNo: "EXPIRED",
            expiryDate: "2020-01-01",
            quantityAvailable: 5,
            purchasePrice: asPaisa(800),
            salePrice: asPaisa(1200),
          },
          {
            id: "sellable",
            medicineId: "medicine-1",
            batchNo: "SELLABLE",
            expiryDate: "2099-02-01",
            quantityAvailable: 4,
            purchasePrice: asPaisa(800),
            salePrice: asPaisa(1200),
          },
        ],
        onToggleBatches: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        canEdit: false,
        onEditBatch: vi.fn(),
      }),
    );

    expect(screen.getByLabelText("Active SELLABLE")).toBeTruthy();
    expect(screen.queryByLabelText("Active EXPIRED")).toBeNull();
  });
});
