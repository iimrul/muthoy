// @vitest-environment jsdom
//
// The CSV import screen (founder, 2026-11-27): template download, file pick,
// every problem listed in the owner's language, preview summary, import.
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

interface StubProps {
  children?: ReactNode;
  testID?: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  value?: string;
  onChangeText?: (value: string) => void;
}

vi.mock("react-native", () => ({
  View: (p: StubProps) => createElement("div", { "data-testid": p.testID }, p.children),
  Text: (p: StubProps) => createElement("span", null, p.children),
  ScrollView: (p: StubProps) => createElement("div", null, p.children),
  Pressable: (p: StubProps) =>
    createElement("button", { onClick: p.onPress, disabled: p.disabled, "aria-label": p.accessibilityLabel }, p.children),
}));
vi.mock("expo-router", () => ({ router: { back: vi.fn() } }));
vi.mock("../../components/ui/StandardHeader", () => ({
  StandardHeader: ({ title }: { title: string }) => createElement("h1", null, title),
}));
vi.mock("../../components/ui/AccessDenied", () => ({
  AccessDenied: () => createElement("p", null, "access-denied"),
}));
vi.mock("../../components/ui/AppTextInput", () => ({
  AppTextInput: (p: StubProps) =>
    createElement("textarea", {
      "aria-label": p.accessibilityLabel,
      value: p.value,
      onChange: (event: { target: { value: string } }) => p.onChangeText?.(event.target.value),
    }),
}));

const deps = vi.hoisted(() => ({
  isOwner: true,
  pick: vi.fn(),
  share: vi.fn(),
  preview: vi.fn(),
  importCsv: vi.fn(),
  sync: vi.fn(async () => undefined),
}));

vi.mock("../../state/usePermission", () => ({
  useOwnerAccess: () => ({
    session: deps.isOwner ? { shopId: "shop-1", userId: "owner-1" } : null,
    isAllowed: deps.isOwner,
  }),
}));
vi.mock("../../state/sessionGuard", () => ({
  captureSessionFor: () => ({ isStillActive: () => true, ifLive: (run: () => void) => run(), isStale: () => false }),
}));
vi.mock("../../sync", () => ({ triggerSyncNow: deps.sync }));
vi.mock("../../db/inventoryImport", () => ({
  previewInventoryCsv: deps.preview,
  importInventoryCsv: deps.importCsv,
}));
vi.mock("../../native/inventoryCsvFile", () => {
  class CsvPickError extends Error {
    constructor(readonly problem: "too_large" | "not_csv") {
      super(problem);
    }
  }
  return { CsvPickError, pickInventoryCsv: deps.pick, shareInventoryCsvTemplate: deps.share };
});

const { default: InventoryImportScreen } = await import("../../app/inventory/import");
const { InventoryCsvError } = await import("../../domain/inventoryCsvIssue");
const { CsvPickError } = await import("../../native/inventoryCsvFile");
const { useLocaleStore } = await import("../../state/localeStore");

const CSV = "name,generic,manufacturer,batch_no,stock,purchase_price,sale_price\nNapa,Paracetamol,Beximco,B-1,10,0.80,1.20";
const ROWS = [
  { rowNumber: 2, name: "Napa 500mg", type: "tablet", batchNo: "B-1", stock: 10, expiryDate: "2027-12-31", salePrice: 120, action: "create_medicine" },
  { rowNumber: 3, name: "Telmepress 20", type: "capsule", batchNo: "T-1", stock: 5, expiryDate: null, salePrice: 800, action: "add_batch" },
];

async function chooseFile() {
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Choose CSV file"));
  });
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" });
  deps.isOwner = true;
  deps.pick.mockReset().mockResolvedValue({ name: "stock.csv", text: CSV });
  deps.share.mockReset().mockResolvedValue(undefined);
  deps.preview.mockReset().mockResolvedValue({ fingerprint: "fp-1", rows: ROWS });
  deps.importCsv.mockReset().mockResolvedValue({ importId: "imp-1", rowCount: 2 });
  deps.sync.mockClear();
});
afterEach(cleanup);

describe("CSV import screen", () => {
  it("is the Owner's alone", () => {
    deps.isOwner = false;
    render(createElement(InventoryImportScreen));
    expect(screen.getByText("access-denied")).toBeTruthy();
  });

  it("explains every column and shares the template", async () => {
    render(createElement(InventoryImportScreen));
    expect(screen.getByText("batch_no")).toBeTruthy();
    expect(screen.getByText("Batch number on the box")).toBeTruthy();
    expect(screen.getAllByText("Required")).toHaveLength(7);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Download template"));
    });
    expect(deps.share).toHaveBeenCalledWith("Muthoy inventory template");
  });

  it("checks a picked file and shows what will be added", async () => {
    render(createElement(InventoryImportScreen));
    await chooseFile();
    expect(deps.preview).toHaveBeenCalledWith("shop-1", "owner-1", CSV);
    const preview = await screen.findByTestId("csv-preview");
    expect(preview.textContent).toContain("New medicines");
    expect(screen.getByText("stock.csv")).toBeTruthy();
    expect(screen.getByText("Napa 500mg")).toBeTruthy();
    expect(screen.getByText("Capsule")).toBeTruthy();
    expect(screen.getByLabelText("Import").textContent).toBe("Import (2)");
  });

  it("imports the checked file with its fingerprint and says how many rows went in", async () => {
    render(createElement(InventoryImportScreen));
    await chooseFile();
    await act(async () => {
      fireEvent.click(await screen.findByLabelText("Import"));
    });
    expect(deps.importCsv).toHaveBeenCalledWith("shop-1", "owner-1", CSV, "fp-1", expect.any(Function));
    expect(deps.sync).toHaveBeenCalledWith("shop-1");
    expect((await screen.findByTestId("csv-import-done")).textContent).toContain("2 rows added");
    expect(screen.queryByTestId("csv-preview")).toBeNull();
  });

  it("lists every problem, by sheet row, in Bangla", async () => {
    useLocaleStore.setState({ locale: "bn" });
    deps.preview.mockRejectedValueOnce(
      new InventoryCsvError([
        { rowNumber: 3, code: "bad_expiry", column: "expiry_date" },
        { rowNumber: 7, code: "uneven_columns" },
        { rowNumber: null, code: "missing_column", column: "sale_price" },
      ]),
    );
    render(createElement(InventoryImportScreen));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("CSV ফাইল বেছে নিন"));
    });
    const issues = await screen.findByTestId("csv-issues");
    expect(issues.textContent).toContain("সারি ৩: তারিখ YYYY-MM-DD আকারে লিখুন (expiry_date)");
    expect(issues.textContent).toContain("সারি ৭: ঘর বেশি");
    expect(issues.textContent).toContain("কলাম নেই (sale_price)");
    expect(screen.queryByTestId("csv-preview")).toBeNull();
  });

  it("explains an Excel workbook pick", async () => {
    deps.pick.mockRejectedValueOnce(new CsvPickError("not_csv"));
    render(createElement(InventoryImportScreen));
    await chooseFile();
    expect(screen.getByText(/This is an Excel file/)).toBeTruthy();
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it("does nothing when the picker is cancelled", async () => {
    deps.pick.mockResolvedValueOnce(null);
    render(createElement(InventoryImportScreen));
    await chooseFile();
    expect(deps.preview).not.toHaveBeenCalled();
    expect(screen.queryByTestId("csv-issues")).toBeNull();
  });

  it("says a file was already imported", async () => {
    deps.importCsv.mockRejectedValueOnce(new Error("This CSV was already imported"));
    render(createElement(InventoryImportScreen));
    await chooseFile();
    await act(async () => {
      fireEvent.click(await screen.findByLabelText("Import"));
    });
    expect(screen.getByText("This file was already imported.")).toBeTruthy();
  });

  it("checks pasted text too", async () => {
    render(createElement(InventoryImportScreen));
    fireEvent.click(screen.getByLabelText("Or paste CSV text"));
    fireEvent.change(screen.getByLabelText("name,generic,manufacturer,batch_no,stock,purchase_price,sale_price"), {
      target: { value: CSV },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Check"));
    });
    await waitFor(() => expect(deps.preview).toHaveBeenCalledWith("shop-1", "owner-1", CSV));
  });
});
