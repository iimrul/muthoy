// db/scanVocabulary.ts — the live strip scanner's dictionary: every medicine
// this shop has, read ONCE when the scanner opens. Read-only; writes nothing.
//
// Why not searchMedicinesForSale: that is a typed-query search capped at 50 FTS
// results. The scanner inverts the question (domain/stripMatcher.ts asks which
// of the shop's medicines is printed on the strip), so it needs the whole
// vocabulary up front and then matches every camera frame in memory, without a
// query per frame.
//
// Out-of-stock medicines are INCLUDED, flagged by isSellable, so a strip the
// shop stocks but has sold out of is reported as "out of stock" rather than as
// "not in inventory". The sellable test is the one searchMedicinesForSale uses:
// stock above zero and an expiry date (the real date, CLAUDE.md rule 3) on or
// after today's Dhaka business date.

import { dhakaBusinessDate } from "@muthoy/utils";
import { sqliteConnection } from "./client";
import { requirePermission } from "./auth";
import type { ScanVocabularyEntry } from "../domain/stripMatcher";

interface VocabularyRow {
  medicineId: string;
  name: string;
  generic: string | null;
  manufacturer: string | null;
  strength: string | null;
  dosageForm: string | null;
  requiresPrescription: number;
  isSellable: number;
}

export async function listScanVocabulary(
  shopId: string,
  actorUserId: string,
): Promise<ScanVocabularyEntry[]> {
  await requirePermission(shopId, actorUserId, "sale_entry");
  const rows = sqliteConnection.getAllSync<VocabularyRow>(
    `SELECT m.id AS medicineId, m.name, m.generic, m.manufacturer, m.strength,
            m.type AS dosageForm,
            m.requires_prescription AS requiresPrescription,
            EXISTS (
              SELECT 1 FROM batches AS b
               WHERE b.shop_id = m.shop_id
                 AND b.medicine_id = m.id
                 AND b.is_deleted = 0
                 AND b.stock > 0
                 AND (b.expiry_date IS NULL OR b.expiry_date >= $businessDate)
            ) AS isSellable
       FROM medicines AS m
      WHERE m.shop_id = $shopId
        AND m.is_deleted = 0`,
    { $shopId: shopId, $businessDate: dhakaBusinessDate(new Date()) },
  );
  return rows.map((row) => ({
    medicineId: row.medicineId,
    name: row.name,
    generic: row.generic,
    manufacturer: row.manufacturer,
    strength: row.strength,
    dosageForm: row.dosageForm,
    requiresPrescription: Boolean(row.requiresPrescription),
    isSellable: Boolean(row.isSellable),
  }));
}
