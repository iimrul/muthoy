// domain/inventoryCsvTemplate.ts — the sheet the owner downloads, fills in
// Excel or Google Sheets, and imports (founder, 2026-11-27: "একটা টেমপ্লেট
// দেওয়া থাকতো কি কি দরকার তা যাতে ঠিকঠাক আসে").
//
// The columns are exactly the ones db/inventoryImport.ts reads; a test imports
// this template through the real importer so the two can never drift apart.
// The example rows use batch "EXAMPLE-…", which the importer refuses — an
// owner who forgets to delete them gets told, rather than 100 phantom Napa.
//
// Pure: no React, native or DB imports.

import type { CatalogKey } from "../i18n/catalog";

export interface InventoryCsvColumn {
  key: string;
  isRequired: boolean;
  /** The column's name in the owner's language, for the error list. */
  label: CatalogKey;
  hint: CatalogKey;
}

export const INVENTORY_CSV_COLUMNS: readonly InventoryCsvColumn[] = [
  { key: "name", isRequired: true, label: "csvFieldName", hint: "csvColumnName" },
  { key: "generic", isRequired: true, label: "csvFieldGeneric", hint: "csvColumnGeneric" },
  { key: "manufacturer", isRequired: true, label: "csvFieldManufacturer", hint: "csvColumnManufacturer" },
  { key: "type", isRequired: false, label: "csvFieldType", hint: "csvColumnType" },
  { key: "batch_no", isRequired: true, label: "csvFieldBatch", hint: "csvColumnBatch" },
  { key: "expiry_date", isRequired: false, label: "csvFieldExpiry", hint: "csvColumnExpiry" },
  { key: "stock", isRequired: true, label: "csvFieldStock", hint: "csvColumnStock" },
  { key: "purchase_price", isRequired: true, label: "csvFieldPurchasePrice", hint: "csvColumnPurchasePrice" },
  { key: "sale_price", isRequired: true, label: "csvFieldSalePrice", hint: "csvColumnSalePrice" },
  { key: "unit", isRequired: false, label: "csvFieldUnit", hint: "csvColumnUnit" },
  { key: "threshold", isRequired: false, label: "csvFieldThreshold", hint: "csvColumnThreshold" },
  { key: "barcode", isRequired: false, label: "csvFieldBarcode", hint: "csvColumnBarcode" },
];

const EXAMPLE_ROWS: readonly (readonly string[])[] = [
  ["Napa 500mg", "Paracetamol", "Beximco Pharmaceuticals", "tablet", "EXAMPLE-1", "2027-12-31", "100", "0.80", "1.20", "piece", "20", ""],
  ["Telmepress 20", "Telmisartan", "Square Pharmaceuticals", "capsule", "EXAMPLE-2", "2027-06-30", "50", "6.00", "8.00", "piece", "10", ""],
];

export const INVENTORY_CSV_TEMPLATE_NAME = "muthoy-inventory-template.csv";

/**
 * Header plus two example rows. A BOM leads the file so Excel opens it as
 * UTF-8 and a Bangla medicine name typed into it survives the round trip.
 */
export function buildInventoryCsvTemplate(): string {
  const lines = [INVENTORY_CSV_COLUMNS.map((column) => column.key), ...EXAMPLE_ROWS];
  return `﻿${lines.map((cells) => cells.join(",")).join("\r\n")}\r\n`;
}
