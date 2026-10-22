// W2-02 / W2-03: reading the offline medicine reference catalogue.
//
// This module READS ONLY. It deliberately contains no catalogue-to-`medicines`
// writer: a catalogue hit becomes a shop-owned medicine exclusively through the
// existing atomic `createMedicineWithPurchase` when the user presses Save, so
// Add Medicine keeps one commit path and the explicit-confirmation rule holds.
//
// It implements the seam that already exists — `domain/medicineSearchProvider`'s
// `MedicineSearchProvider` — rather than inventing an interface or a second
// medicine-search UI. `components/inventory/SearchMedicineTab.tsx` already takes
// a `provider` prop and already renders a real result list; until a licensed
// dataset is imported the table is empty, the provider returns nothing, and that
// component's existing "not connected yet" state is what the user sees.

import { eq, sql } from "drizzle-orm";
import { medicineSearchKey } from "@muthoy/utils";
import { db, sqliteConnection } from "./client";
import { medicineCatalog } from "./schema";
import { uuidV5 } from "../domain/deterministicId";
import { toFtsPrefixQuery } from "../domain/ftsQuery";
import type { MedicineSearchResult } from "../domain/medicineSearchProvider";

const SEARCH_LIMIT = 50;

/** Fixed namespace so a row's id is stable across machines and re-imports. */
const CATALOG_ID_NAMESPACE = "9f1c6e3a-7b4d-5a28-9c10-0a1b2c3d4e5f";

/** The natural key of a catalogue row, before hashing. */
export interface CatalogNaturalKey {
  brandName: string;
  strength?: string | null;
  dosageForm?: string | null;
  manufacturer?: string | null;
}

/**
 * Deterministic row id. Two imports of the same product — from the same file or
 * a later revision of it — produce the same id, which is what makes the importer
 * idempotent via `on conflict (id) do update` instead of accumulating duplicates.
 *
 * The key is FOLDED before hashing (`medicineSearchKey`), so "Napa 500mg Tablet"
 * and "napa 500 mg tablet" are one product rather than two. Fields are joined
 * with a separator that cannot appear in a folded key, so ("ab","c") and
 * ("a","bc") cannot collide.
 */
export function catalogRowId(key: CatalogNaturalKey): string {
  const parts = [key.brandName, key.strength, key.dosageForm, key.manufacturer].map(
    (part) => (part ? medicineSearchKey(part) : ""),
  );
  return uuidV5(CATALOG_ID_NAMESPACE, parts.join("|"));
}

/** Everything a catalogue row holds. Read on selection, never on every keystroke. */
export interface CatalogEntry {
  id: string;
  brandName: string;
  brandNameBn: string | null;
  genericName: string | null;
  genericNameBn: string | null;
  manufacturer: string | null;
  manufacturerBn: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
  source: string;
  sourceVersion: string;
}

interface CatalogSearchRow {
  id: string;
  brandName: string;
  genericName: string | null;
  manufacturer: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
}

/**
 * Search the catalogue in whichever of the three scripts the user typed.
 *
 * The query is folded by the SAME `medicineSearchKey` the importer used to build
 * `search_key`, which is the whole mechanism: English, Bangla and Banglish all
 * land in one comparison space. Falls back to the raw query when folding yields
 * nothing (a query of only punctuation), so a stray keystroke cannot produce an
 * empty MATCH expression — which is a SQLite syntax error, not a no-op.
 */
export async function searchCatalog(
  query: string,
  limit: number = SEARCH_LIMIT,
): Promise<MedicineSearchResult[]> {
  const folded = medicineSearchKey(query);
  const matchQuery = toFtsPrefixQuery(folded || query);
  if (!matchQuery) return [];

  const rows = sqliteConnection.getAllSync<CatalogSearchRow>(
    `SELECT c.id AS id, c.brand_name AS brandName, c.generic_name AS genericName,
            c.manufacturer AS manufacturer, c.strength AS strength,
            c.dosage_form AS dosageForm, c.pack_size AS packSize
       FROM medicine_catalog_fts
       JOIN medicine_catalog AS c ON c.rowid = medicine_catalog_fts.rowid
      WHERE medicine_catalog_fts MATCH $matchQuery
      ORDER BY bm25(medicine_catalog_fts), c.brand_name
      LIMIT $limit`,
    { $matchQuery: matchQuery, $limit: limit },
  );

  // Strength, dosage form and pack size travel with the result because without
  // them "Napa 500" and "Napa 665" both render as "Napa" and the user picks
  // blind. They are NEVER folded into `name` — medicines.name must stay the
  // brand name, since medicines_fts indexes it and findExactNameMatch compares
  // against it.
  return rows.map((row) => ({
    id: row.id,
    name: row.brandName,
    generic: row.genericName ?? undefined,
    manufacturer: row.manufacturer ?? undefined,
    strength: row.strength ?? undefined,
    dosageForm: row.dosageForm ?? undefined,
    packSize: row.packSize ?? undefined,
  }));
}

/** The full row for a selected result. One read, at selection time only. */
export async function getCatalogEntry(id: string): Promise<CatalogEntry | null> {
  const row = db
    .select({
      id: medicineCatalog.id,
      brandName: medicineCatalog.brandName,
      brandNameBn: medicineCatalog.brandNameBn,
      genericName: medicineCatalog.genericName,
      genericNameBn: medicineCatalog.genericNameBn,
      manufacturer: medicineCatalog.manufacturer,
      manufacturerBn: medicineCatalog.manufacturerBn,
      strength: medicineCatalog.strength,
      dosageForm: medicineCatalog.dosageForm,
      packSize: medicineCatalog.packSize,
      source: medicineCatalog.source,
      sourceVersion: medicineCatalog.sourceVersion,
    })
    .from(medicineCatalog)
    .where(eq(medicineCatalog.id, id))
    .get();
  return row ?? null;
}

/** How many reference rows are loaded. 0 means "no dataset imported yet". */
export function catalogRowCount(): number {
  const row = db
    .select({ value: sql<number>`count(*)` })
    .from(medicineCatalog)
    .get();
  return row?.value ?? 0;
}

/**
 * The real provider for the seam `domain/medicineSearchProvider.ts` defines.
 * Passed to `SearchMedicineTab` by Add Medicine, replacing
 * `unavailableMedicineSearchProvider`.
 */
export const catalogMedicineSearchProvider = {
  async search(query: string): Promise<MedicineSearchResult[]> {
    return searchCatalog(query);
  },
};
