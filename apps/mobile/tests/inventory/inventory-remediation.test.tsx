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
  addBatchWithPurchase: vi.fn(),
  searchRestockMedicines: vi.fn(),
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
  addBatchWithPurchase: deps.addBatchWithPurchase,
  searchRestockMedicines: deps.searchRestockMedicines,
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

// W2-02. The catalogue is real SQLite + FTS5 (db/medicineCatalog.ts); this
// suite is the UI contract, so both of its reads are doubled here. Note there
// is nothing to double for a catalogue WRITE: the module exports none, which is
// what keeps Save the one commit path.
const catalogDeps = vi.hoisted(() => ({
  search: vi.fn(),
  getCatalogEntry: vi.fn(),
}));
vi.mock("../../db/medicineCatalog", () => ({
  catalogMedicineSearchProvider: { search: catalogDeps.search },
  getCatalogEntry: catalogDeps.getCatalogEntry,
}));

/** A catalogue row with every column populated, as getCatalogEntry returns it. */
const CATALOG_ROW = {
  id: "catalog-1",
  brandName: "Napa Extra",
  brandNameBn: "নাপা এক্সট্রা",
  genericName: "Paracetamol + Caffeine",
  genericNameBn: "প্যারাসিটামল + ক্যাফেইন",
  manufacturer: "Beximco Pharmaceuticals",
  manufacturerBn: "বেক্সিমকো ফার্মাসিউটিক্যালস",
  strength: "500mg + 65mg",
  dosageForm: "Tablet",
  packSize: "Strip",
  source: "synthetic-fixture",
  sourceVersion: "2026-10-22",
};

/** The same row as the search projection hands it to the result list. */
const SEARCH_HIT = {
  id: CATALOG_ROW.id,
  name: CATALOG_ROW.brandName,
  generic: CATALOG_ROW.genericName,
  manufacturer: CATALOG_ROW.manufacturer,
  strength: CATALOG_ROW.strength,
  dosageForm: CATALOG_ROW.dosageForm,
  packSize: CATALOG_ROW.packSize,
};

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
const { ManualEntryForm } = await import("../../components/inventory/ManualEntryForm");

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
  deps.searchRestockMedicines.mockResolvedValue([]);
  deps.addBatchWithPurchase.mockResolvedValue({ purchaseId: "purchase-1" });
  deps.listBatchesForMedicine.mockResolvedValue([]);
  deps.getMedicine.mockResolvedValue(null);
  deps.adjustBatchStock.mockResolvedValue(undefined);
  deps.updateBatch.mockResolvedValue(undefined);
  deps.updateMedicine.mockResolvedValue(undefined);
  // An empty catalogue is the shipped state (gate E7: no licensed dataset),
  // so that is the default every test starts from.
  catalogDeps.search.mockResolvedValue([]);
  catalogDeps.getCatalogEntry.mockResolvedValue(null);
});

afterEach(() => cleanup());

function MoneyProbe() {
  const { formatMoney } = useI18n();
  return createElement("p", null, formatMoney(asPaisa(123450)));
}

const RESTOCK_MEDICINE = {
  id: "shop-medicine-1", name: "Progut MUPS", generic: "Esomeprazole",
  manufacturer: "Popular", strength: "20mg", type: "Tablet",
  unitOfMeasure: "piece", barcode: "123456", category: null,
  requiresPrescription: false, threshold: 10,
  batchContext: "Baban / 2099-12-12 / 200",
};

async function fillRestockBatch() {
  const fields: [string, string][] = [
    ["Batch number *", "FEFO-EARLY"], ["Expiry date *", "2099-01-15"],
    ["Purchase price (৳) *", "10"], ["Sale price (৳) *", "12"],
    ["Quantity *", "50"],
  ];
  for (const [label, value] of fields) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  await waitFor(() => expect(deps.listSupplierPickerOptions).toHaveBeenCalled());
  fireEvent.click(screen.getByLabelText("Select supplier"));
  fireEvent.click(await screen.findByLabelText("Square"));
}

function renderManualForRestock(role: "owner" | "staff" = "owner") {
  const session = { ...SESSION, role };
  useSessionStore.setState({ session });
  render(createElement(ManualEntryForm, { session, onSaved: vi.fn() }));
}

async function reviewMatchingMedicine() {
  const fields: [string, string][] = [
    ["Medicine name *", RESTOCK_MEDICINE.name],
    ["Generic name *", RESTOCK_MEDICINE.generic],
    ["Manufacturer", RESTOCK_MEDICINE.manufacturer],
  ];
  for (const [label, value] of fields) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  await fillRestockBatch();
  await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
  await screen.findByLabelText("Create a distinct medicine");
}

describe("Explicit medicine identity during restocking", () => {
  beforeEach(() => {
    deps.searchRestockMedicines.mockResolvedValue([RESTOCK_MEDICINE]);
    deps.getMedicine.mockResolvedValue(RESTOCK_MEDICINE);
  });

  it("locks a confirmed distinct receipt through repeated taps until navigation unmounts it", async () => {
    let finish!: () => void;
    deps.createMedicineWithPurchase.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderManualForRestock();
    await reviewMatchingMedicine();
    const confirm = screen.getByLabelText("Create a distinct medicine");
    await act(async () => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(deps.createMedicineWithPurchase).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await act(async () => { fireEvent.click(confirm); });
    expect(deps.createMedicineWithPurchase).toHaveBeenCalledTimes(1);
  });

  it("reviews matching manual entry before writing, then restocks the explicitly chosen shop medicine", async () => {
    renderManualForRestock();
    await reviewMatchingMedicine();
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
    expect(deps.addBatchWithPurchase).not.toHaveBeenCalled();
    expect(screen.getByText(RESTOCK_MEDICINE.batchContext)).toBeTruthy();
    fireEvent.click(await screen.findByLabelText(/This is the same medicine: Progut MUPS/));
    await waitFor(() => expect(screen.queryByLabelText("Medicine name *")).toBeNull());
    await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
    expect(deps.addBatchWithPurchase).toHaveBeenCalledWith(expect.objectContaining({
      medicineId: RESTOCK_MEDICINE.id, supplierId: "supplier-1", paymentType: "cod",
      batch: { batchNo: "FEFO-EARLY", expiryDate: "2099-01-15", quantity: 50,
        purchasePrice: 1000, salePrice: 1200 },
    }));
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
  });

  it("creates a legitimate distinct product only after explicit confirmation", async () => {
    renderManualForRestock();
    await reviewMatchingMedicine();
    await act(async () => { fireEvent.click(screen.getByLabelText("Create a distinct medicine")); });
    expect(deps.createMedicineWithPurchase).toHaveBeenCalledWith(expect.objectContaining({
      name: RESTOCK_MEDICINE.name, confirmDistinctMedicine: true,
    }));
    expect(deps.addBatchWithPurchase).not.toHaveBeenCalled();
  });

  it("confirmation validates and saves current form values instead of the review snapshot", async () => {
    renderManualForRestock();
    await reviewMatchingMedicine();
    fireEvent.change(screen.getByLabelText("Quantity *"), { target: { value: "51" } });
    await act(async () => { fireEvent.click(screen.getByLabelText("Create a distinct medicine")); });
    expect(deps.createMedicineWithPurchase).toHaveBeenCalledWith(expect.objectContaining({
      firstBatch: expect.objectContaining({ quantity: 51 }),
    }));
  });

  it("lets inventory_add staff restock an explicitly chosen existing medicine", async () => {
    renderManualForRestock("staff");
    await fillRestockBatch();
    fireEvent.click(screen.getByLabelText("Restock existing medicine"));
    fireEvent.click(await screen.findByLabelText(/This is the same medicine: Progut MUPS/));
    await waitFor(() => expect((screen.getByLabelText("Save") as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
    expect(deps.addBatchWithPurchase).toHaveBeenCalledTimes(1);
    expect(deps.addBatchWithPurchase).toHaveBeenCalledWith(expect.objectContaining({
      medicineId: RESTOCK_MEDICINE.id, actorUserId: SESSION.userId,
      shopId: SESSION.shopId, supplierId: "supplier-1", paymentType: "cod",
    }));
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
  });

  it("keeps the latest explicit identity when medicine reads resolve out of order", async () => {
    const second = { ...RESTOCK_MEDICINE, id: "shop-medicine-2", strength: "40mg" };
    deps.searchRestockMedicines.mockResolvedValue([RESTOCK_MEDICINE, second]);
    let resolveFirst!: (row: typeof RESTOCK_MEDICINE) => void;
    deps.getMedicine.mockImplementation((_: string, id: string) => id === RESTOCK_MEDICINE.id
      ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve(second));
    renderManualForRestock();
    await fillRestockBatch();
    fireEvent.click(screen.getByLabelText("Restock existing medicine"));
    fireEvent.click(await screen.findByLabelText(/This is the same medicine: Progut MUPS \/ 20mg/));
    fireEvent.click(screen.getByLabelText(/This is the same medicine: Progut MUPS \/ 40mg/));
    await waitFor(() => expect(screen.queryByLabelText("Medicine name *")).toBeNull());
    await act(async () => { resolveFirst(RESTOCK_MEDICINE); });
    expect(screen.getByText(second.id)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
    expect(deps.addBatchWithPurchase).toHaveBeenCalledWith(expect.objectContaining({ medicineId: second.id }));
  });
});

describe("Restock identity safety", () => {
  beforeEach(() => {
    deps.searchRestockMedicines.mockResolvedValue([RESTOCK_MEDICINE]);
    deps.getMedicine.mockResolvedValue(RESTOCK_MEDICINE);
  });

  it("locks medicine selection before asynchronous Save validation begins", async () => {
    const second = { ...RESTOCK_MEDICINE, id: "second-medicine", strength: "40mg" };
    deps.searchRestockMedicines.mockResolvedValue([RESTOCK_MEDICINE, second]);
    renderManualForRestock();
    await fillRestockBatch();
    fireEvent.click(screen.getByLabelText("Restock existing medicine"));
    fireEvent.click(await screen.findByLabelText(/This is the same medicine: Progut MUPS \/ 20mg/));
    await waitFor(() => expect(screen.queryByLabelText("Medicine name *")).toBeNull());
    fireEvent.click(screen.getByLabelText("Choose this shop's medicine"));
    const secondChoice = await screen.findByLabelText(/This is the same medicine: Progut MUPS \/ 40mg/);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Save"));
      fireEvent.click(secondChoice);
    });
    expect(deps.getMedicine).not.toHaveBeenCalledWith(SESSION.shopId, second.id);
    expect(deps.addBatchWithPurchase).toHaveBeenCalledTimes(1);
    expect(deps.addBatchWithPurchase).toHaveBeenCalledWith(expect.objectContaining({ medicineId: RESTOCK_MEDICINE.id }));
    expect((screen.getByLabelText("Save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a failed existing selection from falling back to medicine creation", async () => {
    deps.getMedicine.mockRejectedValue(new Error("read failed"));
    renderManualForRestock();
    await fillRestockBatch();
    fireEvent.click(screen.getByLabelText("Restock existing medicine"));
    fireEvent.click(await screen.findByLabelText(/This is the same medicine: Progut MUPS/));
    await screen.findByText("Could not load medicine. Go back and try again.");
    expect((screen.getByLabelText("Save") as HTMLButtonElement).disabled).toBe(true);
    expect(deps.addBatchWithPurchase).not.toHaveBeenCalled();
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
  });

  it("ignores hidden new-medicine validation errors after choosing an existing medicine", async () => {
    renderManualForRestock();
    fireEvent.change(screen.getByLabelText("Minimum stock"), { target: { value: "-1" } });
    await fillRestockBatch();
    fireEvent.click(screen.getByLabelText("Restock existing medicine"));
    fireEvent.click(await screen.findByLabelText(/This is the same medicine: Progut MUPS/));
    await waitFor(() => expect(screen.queryByLabelText("Minimum stock")).toBeNull());
    await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
    expect(deps.addBatchWithPurchase).toHaveBeenCalledTimes(1);
  });

  it("removes the previous shop's picker context immediately when the shop changes", async () => {
    const { ExistingMedicinePicker } = await import("../../components/inventory/ExistingMedicinePicker");
    const view = render(createElement(ExistingMedicinePicker, { shopId: "shop-a", onSelect: vi.fn() }));
    await screen.findByText(RESTOCK_MEDICINE.batchContext);
    deps.searchRestockMedicines.mockRejectedValue(new Error("other shop unavailable"));
    view.rerender(createElement(ExistingMedicinePicker, { shopId: "shop-b", onSelect: vi.fn() }));
    expect(screen.queryByText(RESTOCK_MEDICINE.batchContext)).toBeNull();
    await screen.findByText("Could not load medicine. Go back and try again.");
    expect(screen.queryByText(RESTOCK_MEDICINE.batchContext)).toBeNull();
  });
});

const LOCAL_MEDICINE = {
  id: "medicine-1", name: "Progut MUPS", generic: "Esomeprazole",
  manufacturer: "Popular", strength: "20 mg", type: "Tablet",
  unitOfMeasure: "piece", barcode: "123", threshold: 10,
  requiresPrescription: false, category: null,
  batchContext: "#Baban / 2027-12-12 / 200",
};

async function enterDuplicateMedicine() {
  render(createElement(AddMedicineScreen));
  fireEvent.click(screen.getByLabelText("Manual Entry"));
  for (const [label, value] of [
    ["Medicine name *", "Progut MUPS"], ["Generic name *", "Esomeprazole"],
    ["Manufacturer", "Popular"], ["Batch number *", "FEFO-EARLY"],
    ["Expiry date *", "2027-01-15"], ["Purchase price (৳) *", "2"],
    ["Sale price (৳) *", "3"], ["Quantity *", "50"],
  ]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.click(screen.getByLabelText("Select supplier"));
  fireEvent.click(await screen.findByLabelText("Square"));
  await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
}

describe("Explicit restocking", () => {
  beforeEach(() => {
    useSessionStore.setState({ session: { ...SESSION, role: "owner" } });
    deps.searchRestockMedicines.mockResolvedValue([LOCAL_MEDICINE]);
    deps.getMedicine.mockResolvedValue(LOCAL_MEDICINE);
  });

  it("opens Add Batch for the route's explicit medicine id and keeps identity read-only", async () => {
    const AddBatchScreen = (await import("../../app/inventory/add-batch")).default;
    render(createElement(AddBatchScreen));
    await screen.findByText("This is the same medicine: Progut MUPS");
    expect(deps.getMedicine).toHaveBeenCalledWith(SESSION.shopId, "medicine-1");
    expect(screen.queryByLabelText("Medicine name *")).toBeNull();
    await fillRestockBatch();
    await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
    expect(deps.addBatchWithPurchase).toHaveBeenCalledWith(expect.objectContaining({ medicineId: "medicine-1" }));
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
  });

  it("regression: identical manual entry requires an explicit medicine choice before any write", async () => {
    await enterDuplicateMedicine();
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
    expect(deps.addBatchWithPurchase).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("Create a distinct medicine")).toBeTruthy();
    expect(screen.getByText("#Baban / 2027-12-12 / 200")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("This is the same medicine: Progut MUPS / 20 mg / medicine-1"));
    await waitFor(() => expect(screen.queryByLabelText("Medicine name *")).toBeNull());
    await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
    expect(deps.addBatchWithPurchase).toHaveBeenCalledTimes(1);
    expect(deps.addBatchWithPurchase).toHaveBeenCalledWith(expect.objectContaining({
      medicineId: "medicine-1", supplierId: "supplier-1", paymentType: "cod",
      batch: { batchNo: "FEFO-EARLY", expiryDate: "2027-01-15", quantity: 50, purchasePrice: 200, salePrice: 300 },
    }));
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
  });

  it("preserves a distinct same-name product only after explicit acknowledgement", async () => {
    await enterDuplicateMedicine();
    await act(async () => { fireEvent.click(screen.getByLabelText("Create a distinct medicine")); });
    expect(deps.createMedicineWithPurchase).toHaveBeenCalledWith(expect.objectContaining({
      name: "Progut MUPS", confirmDistinctMedicine: true,
    }));
    expect(deps.addBatchWithPurchase).not.toHaveBeenCalled();
  });

  it("offers local medicine selection with an empty reference catalogue", async () => {
    render(createElement(AddMedicineScreen));
    fireEvent.click(screen.getByLabelText("Restock existing medicine"));
    fireEvent.click(await screen.findByLabelText("This is the same medicine: Progut MUPS / 20 mg / medicine-1"));
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/inventory/add-batch", params: { medicineId: "medicine-1" } });
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
  });

  it("fails closed when local candidate lookup fails", async () => {
    deps.searchRestockMedicines.mockRejectedValue(new Error("sqlite unavailable"));
    await enterDuplicateMedicine();
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
    expect(deps.addBatchWithPurchase).not.toHaveBeenCalled();
  });

  it("restocks for granted staff without creating a duplicate", async () => {
    useSessionStore.setState({ session: SESSION });
    await enterDuplicateMedicine();
    fireEvent.click(screen.getByLabelText("This is the same medicine: Progut MUPS / 20 mg / medicine-1"));
    await waitFor(() => expect((screen.getByLabelText("Save") as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByLabelText("Save")); });
    expect(deps.addBatchWithPurchase).toHaveBeenCalledTimes(1);
    expect(deps.addBatchWithPurchase).toHaveBeenCalledWith(expect.objectContaining({
      medicineId: "medicine-1", actorUserId: SESSION.userId, shopId: SESSION.shopId,
      supplierId: "supplier-1", paymentType: "cod",
    }));
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
  });
});

describe("Add Medicine parity recovery", () => {
  // W2-02. The wiring test: a regression to the stub provider would make every
  // search silently find nothing, which is indistinguishable from an empty
  // catalogue — so it is asserted directly rather than inferred from results.
  it("searches the real catalogue provider, never the unavailable stub", async () => {
    const stub = vi.spyOn(unavailableMedicineSearchProvider, "search");
    render(createElement(AddMedicineScreen));

    fireEvent.change(screen.getByRole("textbox", { name: "Search Medicine" }), {
      target: { value: "Napa" },
    });

    await waitFor(() => expect(catalogDeps.search).toHaveBeenCalledWith("Napa"));
    expect(stub).not.toHaveBeenCalled();
  });

  it("prefills Manual Entry field-by-field from the catalogue row, writes nothing before Save, and carries strength, dosage form and unit into their own columns", async () => {
    catalogDeps.search.mockResolvedValueOnce([SEARCH_HIT]);
    catalogDeps.getCatalogEntry.mockResolvedValueOnce(CATALOG_ROW);
    render(createElement(AddMedicineScreen));

    fireEvent.change(screen.getByRole("textbox", { name: "Search Medicine" }), {
      target: { value: "Napa" },
    });
    // The disambiguating fields are on the row itself: against a 21k catalogue
    // "Napa 500mg" and "Napa 665mg" would otherwise both read just "Napa".
    await waitFor(() => expect(screen.getByText("Napa Extra")).toBeTruthy());
    expect(screen.getByText("500mg + 65mg • Tablet • Strip")).toBeTruthy();

    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Napa Extra • 500mg + 65mg • Tablet • Strip"),
      );
    });

    // Selection is a READ. getCatalogEntry ran; nothing was written.
    expect(catalogDeps.getCatalogEntry).toHaveBeenCalledWith("catalog-1");
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
    expect(deps.updateMedicine).not.toHaveBeenCalled();
    expect(deps.triggerSyncNow).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Medicine name *") as HTMLInputElement).value,
      ).toBe("Napa Extra"),
    );
    // Each value in its own field — and the brand name alone in `name`, which
    // medicines_fts indexes and findExactNameMatch compares against.
    expect(
      (screen.getByLabelText("Generic name *") as HTMLInputElement).value,
    ).toBe("Paracetamol + Caffeine");
    expect(
      (screen.getByLabelText("Manufacturer") as HTMLInputElement).value,
    ).toBe("Beximco Pharmaceuticals");
    expect((screen.getByLabelText("Strength") as HTMLInputElement).value).toBe(
      "500mg + 65mg",
    );
    expect(
      (screen.getByLabelText("Dosage form") as HTMLInputElement).value,
    ).toBe("Tablet");
    expect((screen.getByLabelText("Unit") as HTMLInputElement).value).toBe(
      "strip",
    );

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
          name: "Napa Extra",
          generic: "Paracetamol + Caffeine",
          manufacturer: "Beximco Pharmaceuticals",
          strength: "500mg + 65mg",
          type: "Tablet",
          unitOfMeasure: "strip",
          supplierId: "supplier-1",
          requiresPrescription: true,
        }),
      ),
    );
    // Save is still the only commit path: exactly one write, through the
    // existing atomic createMedicineWithPurchase.
    expect(deps.createMedicineWithPurchase).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest query's results when two searches resolve out of order", async () => {
    let resolveStale: ((rows: typeof SEARCH_HIT[]) => void) | undefined;
    catalogDeps.search
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockResolvedValueOnce([SEARCH_HIT]);
    render(createElement(AddMedicineScreen));
    const input = screen.getByRole("textbox", { name: "Search Medicine" });

    fireEvent.change(input, { target: { value: "Na" } });
    fireEvent.change(input, { target: { value: "Napa" } });
    await waitFor(() => expect(screen.getByText("Napa Extra")).toBeTruthy());

    // The first, slower query now lands. It must not overwrite the newer one.
    await act(async () => {
      resolveStale?.([
        { ...SEARCH_HIT, id: "catalog-stale", name: "Stale Result" },
      ]);
    });

    expect(screen.queryByText("Stale Result")).toBeNull();
    expect(screen.getByText("Napa Extra")).toBeTruthy();
  });

  it("falls back to the result row's own values when the catalogue row cannot be re-read", async () => {
    catalogDeps.search.mockResolvedValueOnce([SEARCH_HIT]);
    // A re-import replaces ids by deterministic hash, so null is legitimate
    // rather than exceptional — the user still gets what the row showed them.
    catalogDeps.getCatalogEntry.mockResolvedValueOnce(null);
    render(createElement(AddMedicineScreen));

    fireEvent.change(screen.getByRole("textbox", { name: "Search Medicine" }), {
      target: { value: "Napa" },
    });
    await waitFor(() => expect(screen.getByText("Napa Extra")).toBeTruthy());
    await act(async () => {
      fireEvent.click(
        screen.getByLabelText("Napa Extra • 500mg + 65mg • Tablet • Strip"),
      );
    });

    await waitFor(() =>
      expect(
        (screen.getByLabelText("Medicine name *") as HTMLInputElement).value,
      ).toBe("Napa Extra"),
    );
    expect((screen.getByLabelText("Strength") as HTMLInputElement).value).toBe(
      "500mg + 65mg",
    );
    expect(
      (screen.getByLabelText("Dosage form") as HTMLInputElement).value,
    ).toBe("Tablet");
    expect(deps.createMedicineWithPurchase).not.toHaveBeenCalled();
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
