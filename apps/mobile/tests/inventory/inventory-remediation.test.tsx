// @vitest-environment jsdom

import { createElement, Fragment, useEffect, type ReactNode } from "react";
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
  placeholderTextColor?: string;
  className?: string;
  contentContainerClassName?: string;
  testID?: string;
  style?: Record<string, unknown>;
  data?: readonly unknown[];
  renderItem?: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown, index: number) => string;
  ListEmptyComponent?: ReactNode | (() => ReactNode);
}

vi.mock("react-native", () => ({
  View: ({ children, accessibilityLabel }: StubProps) =>
    createElement("div", { "aria-label": accessibilityLabel }, children),
  Text: ({ children }: StubProps) => createElement("span", null, children),
  ScrollView: ({ children, testID, style, contentContainerClassName }: StubProps) =>
    createElement(
      "div",
      {
        "data-testid": testID,
        "data-style": JSON.stringify(style ?? {}),
        "data-content-class": contentContainerClassName,
      },
      children,
    ),
  Pressable: ({ children, onPress, accessibilityLabel, disabled, className }: StubProps) =>
    createElement(
      "button",
      {
        onClick: onPress,
        "aria-label": accessibilityLabel,
        disabled,
        "data-class": className,
      },
      children,
    ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    placeholder,
    placeholderTextColor,
    className,
  }: StubProps) =>
    createElement("input", {
      value: typeof value === "string" ? value : "",
      "aria-label": accessibilityLabel,
      placeholder,
      "data-placeholder-color": placeholderTextColor,
      "data-class": className,
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
    testID,
    contentContainerClassName,
  }: StubProps) => {
    const rows = data ?? [];
    if (rows.length === 0) {
      return createElement(
        "div",
        {
          "data-testid": testID,
          "data-content-class": contentContainerClassName,
        },
        typeof ListEmptyComponent === "function"
          ? createElement(ListEmptyComponent)
          : (ListEmptyComponent ?? null),
      );
    }
    return createElement(
      "div",
      {
        "data-testid": testID,
        "data-content-class": contentContainerClassName,
      },
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
vi.mock("expo-router", () => ({
  router: routerMock,
  useFocusEffect: (callback: () => void | (() => void)) =>
    useEffect(callback, [callback]),
  useLocalSearchParams: () => ({ medicineId: "medicine-1", batchId: "batch-1" }),
}));
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
  createSupplier: vi.fn(),
  createMedicineWithPurchase: vi.fn(),
  adjustBatchStock: vi.fn(),
  archiveBatch: vi.fn(),
  getMedicine: vi.fn(),
  listBatchesForMedicine: vi.fn(),
  listManufacturerSuggestions: vi.fn(),
  listMedicines: vi.fn(),
  listSupplierPickerOptions: vi.fn(),
  updateBatch: vi.fn(),
  updateMedicine: vi.fn(),
  triggerSyncNow: vi.fn(),
}));

vi.mock("../../db/inventory", () => ({
  archiveMedicine: deps.archiveMedicine,
  adjustBatchStock: deps.adjustBatchStock,
  archiveBatch: deps.archiveBatch,
  createMedicineWithPurchase: deps.createMedicineWithPurchase,
  getMedicine: deps.getMedicine,
  listBatchesForMedicine: deps.listBatchesForMedicine,
  listManufacturerSuggestions: deps.listManufacturerSuggestions,
  listMedicines: deps.listMedicines,
  updateBatch: deps.updateBatch,
  updateMedicine: deps.updateMedicine,
}));
vi.mock("../../db/suppliers", () => ({
  createSupplier: deps.createSupplier,
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
const EditMedicineScreen = (await import("../../app/inventory/edit-medicine"))
  .default;
const EditBatchScreen = (await import("../../app/inventory/edit-batch")).default;

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
  deps.createSupplier.mockResolvedValue({
    id: "supplier-2",
    name: "Beximco",
    phone: "+8801712345678",
  });
  deps.listManufacturerSuggestions.mockResolvedValue([]);
  deps.listMedicines.mockResolvedValue([]);
  deps.listBatchesForMedicine.mockResolvedValue([]);
  deps.getMedicine.mockResolvedValue(null);
  deps.adjustBatchStock.mockResolvedValue(undefined);
  deps.updateBatch.mockResolvedValue(undefined);
  deps.updateMedicine.mockResolvedValue(undefined);
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

    fireEvent.change(screen.getByRole("textbox", { name: "Search Medicine" }), {
      target: { value: "Napa" },
    });
    await waitFor(() => expect(screen.getByText("Napa Extra")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Napa Extra"));

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Medicine name *") as HTMLInputElement).value,
      ).toBe("Napa Extra"),
    );
    expect((screen.getByLabelText("Generic name *") as HTMLInputElement).value)
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
    fireEvent.change(screen.getByLabelText("Expiry date *"), {
      target: { value: "2099-01-01" },
    });
    fireEvent.click(screen.getByLabelText("Select supplier"));
    fireEvent.click(screen.getByLabelText("Square"));
    fireEvent.click(screen.getByLabelText("Requires prescription"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Save"));
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

  it("matches the readable field, required-copy, supplier-sheet, and action shell", async () => {
    render(createElement(AddMedicineScreen));
    fireEvent.click(screen.getByLabelText("Manual Entry"));
    await waitFor(() =>
      expect(deps.listSupplierPickerOptions).toHaveBeenCalled(),
    );

    const name = screen.getByLabelText("Medicine name *");
    expect(name.getAttribute("data-placeholder-color")).toBe("#6B7280");
    expect(name.getAttribute("data-class")).toContain("h-12");
    expect(screen.getByLabelText("Generic name *")).toBeTruthy();
    expect(screen.getByText("Manufacturer *")).toBeTruthy();
    expect(screen.getByLabelText("Expiry date *")).toBeTruthy();
    expect(screen.getByText("* Marked fields are required")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Select supplier"));
    expect(screen.getByText("Supplier")).toBeTruthy();
    expect(screen.getByLabelText("Search supplier name")).toBeTruthy();
    expect(screen.queryByLabelText("New Supplier")).toBeNull();
    fireEvent.click(await screen.findByLabelText("Square"));
    expect(screen.getByText("Square")).toBeTruthy();
    expect(screen.getByLabelText("Cancel")).toBeTruthy();
    expect(screen.getByLabelText("Save")).toBeTruthy();
  });

  it("shows the exact Bangla tabs and bottom action copy", () => {
    act(() => useLocaleStore.getState().setLocale("bn"));
    render(createElement(AddMedicineScreen));
    expect(screen.getByLabelText("ম্যানুয়াল এন্ট্রি")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("ম্যানুয়াল এন্ট্রি"));
    expect(screen.getByLabelText("বাতিল করুন")).toBeTruthy();
    expect(screen.getByLabelText("সংরক্ষণ করুন")).toBeTruthy();
  });

  it("keeps New Supplier owner-only and uses the prototype create sheet", async () => {
    useSessionStore.setState({
      session: { ...SESSION, role: "owner", permissions: undefined },
    });
    render(createElement(AddMedicineScreen));
    fireEvent.click(screen.getByLabelText("Manual Entry"));
    await waitFor(() =>
      expect(deps.listSupplierPickerOptions).toHaveBeenCalled(),
    );
    fireEvent.click(screen.getByLabelText("Select supplier"));
    fireEvent.click(screen.getByLabelText("New Supplier"));
    fireEvent.change(screen.getByLabelText("Supplier name"), {
      target: { value: "Beximco" },
    });
    fireEvent.change(screen.getByLabelText("Phone Number"), {
      target: { value: "1712345678" },
    });
    const saveButtons = screen.getAllByLabelText("Save");
    fireEvent.click(
      saveButtons.find((button) =>
        button.getAttribute("data-class")?.includes("rounded-xl"),
      )!,
    );

    await waitFor(() =>
      expect(deps.createSupplier).toHaveBeenCalledWith(
        SESSION.shopId,
        SESSION.userId,
        expect.objectContaining({
          name: "Beximco",
          phone: "+8801712345678",
        }),
        expect.any(Function),
      ),
    );
  });
});

describe("Inventory action permissions and FEFO badge", () => {
  it("keeps the filter strip content-height so the first card is not pushed down", async () => {
    render(createElement(InventoryScreen));
    await waitFor(() => expect(deps.listMedicines).toHaveBeenCalled());
    expect(screen.getByTestId("inventory-filters").getAttribute("data-style"))
      .toContain('"flexGrow":0');
    expect(
      screen.getByTestId("inventory-list").getAttribute("data-content-class"),
    ).toContain("pt-0");
  });

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

describe("Inventory practical edit flow", () => {
  const BATCH = {
    id: "batch-1",
    medicineId: "medicine-1",
    batchNo: "B-1",
    expiryDate: "2099-01-01",
    quantityAvailable: 12,
    purchasePrice: asPaisa(800),
    salePrice: asPaisa(1200),
  };

  beforeEach(() => {
    useSessionStore.setState({
      session: { ...SESSION, role: "owner", permissions: undefined },
    });
    deps.getMedicine.mockResolvedValue({
      id: "medicine-1",
      name: "Napa",
      generic: "Paracetamol",
      manufacturer: "Beximco",
      barcode: "123",
      threshold: 10,
      requiresPrescription: false,
    });
    deps.listBatchesForMedicine.mockResolvedValue([BATCH]);
  });

  it("puts batch, expiry, stock, and price editing under the medicine Edit action", async () => {
    render(createElement(EditMedicineScreen));
    await waitFor(() => expect(screen.getByText("#B-1")).toBeTruthy());
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("৳8.00")).toBeTruthy();
    expect(screen.getByText("৳12.00")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Edit batch B-1"));
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: "/inventory/edit-batch",
      params: { medicineId: "medicine-1", batchId: "batch-1" },
    });
  });

  it("posts stock removal through the append-only adjustment API", async () => {
    render(createElement(EditBatchScreen));
    await waitFor(() =>
      expect((screen.getByLabelText("Batch No") as HTMLInputElement).value).toBe(
        "B-1",
      ),
    );
    fireEvent.click(screen.getByLabelText("Remove stock"));
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Reason (required)"), {
      target: { value: "Physical count" },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Post adjustment"));
    });

    expect(deps.adjustBatchStock).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-1",
        changeQty: -3,
        reason: "Physical count",
      }),
    );
  });
});
