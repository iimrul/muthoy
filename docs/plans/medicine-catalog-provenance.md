# The medicine catalogue: provenance, licensing and what "done" requires

**Status: BLOCKED (gate E7).** The code is complete and tested. **Zero
catalogue rows ship**, and the figure "21,000 medicines" is **not claimed**
anywhere in the product or its documentation.

This document exists so the gap is visible rather than discovered later, and so
whoever obtains a dataset knows exactly what has to be true before the feature
can be described as working.

---

## 1. What was actually built (W2-02)

| Piece | File |
|---|---|
| Two tables: the catalogue and its import bookkeeping | `apps/mobile/db/schema.ts`, migration `0032_medicine_catalog.sql` |
| Search, lookup, count, and a search provider | `apps/mobile/db/medicineCatalog.ts` |
| A chunked, idempotent, resumable, owner-only importer | `apps/mobile/db/medicineCatalogImport.ts` |
| Add Medicine wiring: provider, prefill, editable fields | `app/inventory/add-medicine.tsx`, `components/inventory/SearchMedicineTab.tsx`, `ManualEntryForm.tsx`, `domain/catalogPrefill.ts` |
| 15 tests including a 25,000-row chunking test, plus 24 for the prefill mapper | `db/medicine-catalog.sqlite.test.ts`, `domain/catalogPrefill` tests |

Selection from the catalogue is a **READ**. It prefills the Add Medicine form,
the user can see and correct every prefilled value, and the single existing
atomic save path is what writes. `createMedicineFromCatalog` was deliberately
not built: a second write path to the same table is how two definitions of
"adding a medicine" start to drift.

---

## 2. Why no data ships

| Source | Count | Problem |
|---|---|---|
| **DGDA** (Directorate General of Drug Administration) — the authoritative registry | ~34,000 allopathic products | its TLS certificate is expired, and there is no published bulk download or licence for redistribution |
| **Kaggle dataset scraped from medex.com.bd** | ~21,000 — the figure that matches the original scope line | **no stated licence.** It is a scrape of a commercial website; redistributing it inside a shipped app is not something this project can assume is permitted |
| medex.com.bd directly | n/a | no published API or data licence |

The repository already recorded the uncertainty before this batch:
`apps/mobile/domain/medicineSearchProvider.ts` carries the note that "MedEx vs.
another source is still pending".

So the number in the original scope line is traceable to an unlicensed scrape,
not to a registry. **Shipping it would be a licensing decision disguised as a
data-loading task**, which is why no rows ship and the count is not claimed.

---

## 3. The import format, and why it is JSONL

The importer takes **JSON Lines**: one JSON object per line, streamed in chunks
of 500 rows.

It is not CSV, and that is deliberate. `@muthoy/utils`' `parseCsv` enforces
`MAX_INVENTORY_CSV_ROWS = 1000` and `MAX_INVENTORY_CSV_BYTES = 2 MiB`
(`packages/utils/src/csv.ts:1-5`). A ~21,000-row catalogue is 21× that row cap,
and raising the cap would weaken a guard that protects the **shop inventory**
import path — a different feature with different risk. JSONL also needs no
quote-aware buffering, so retained memory is bounded by the chunk rather than by
the file.

Each line is expected to carry at least: a name, and optionally a generic name,
strength, dosage form, pack size, and manufacturer. The importer is:

- **chunked** — 500 rows at a time, so a 21,000-row file never materialises in
  memory;
- **idempotent** — re-importing the same file changes nothing;
- **resumable** — an interrupted import can continue;
- **owner-only** — a staff account cannot load a catalogue.

---

## 4. What "verified count" will mean

When a licensed file exists, the count may only be described as verified once
all four of these hold:

1. **Licence.** A written licence or terms permitting redistribution inside a
   commercial mobile app, recorded in this document with its source URL and
   date.
2. **Provenance.** The file's origin, its retrieval date, and a checksum, so the
   shipped data can be traced to the thing that was licensed.
3. **Count.** The number of rows actually imported on a device, read back from
   the database — not the number of lines in the file, and not a figure from a
   dataset description.
4. **Offline availability.** The rows are present and searchable with the device
   in airplane mode, because the whole point is offline lookup.

Until all four hold, the catalogue is **BLOCKED**, and the correct description
of the feature is "the catalogue mechanism is complete and empty".

---

## 5. What E7 DOES block, including something this document first got wrong

**Corrected 2026-10-23, after the final acceptance review.** An earlier version
of this section said multilingual search "works on whatever rows exist,
including the shop's own inventory, and is not gated on E7". That was false, and
it mattered, so the truth is recorded rather than quietly edited:

- The Bangla / Banglish **fold** (`medicineSearchKey`) is applied in exactly one
  place: `db/medicineCatalog.ts`, both when the importer builds a row's search
  key and when a query is matched against it.
- Shop-inventory search (`db/sales.ts`, `db/purchases.ts`) passes the raw query
  to `medicines_fts`, which indexes names as they were typed in. It is
  therefore **single-script**, exactly as it was before this batch.
- So with zero catalogue rows, **multilingual search has no data to act on at
  all.** Bangla / English / Banglish matching is implemented and tested
  (`packages/utils/src/bengali.ts`, 21 tests) but reaches only the catalogue
  path, and the catalogue is empty.

The plan intended more than this: §11.2 lists `apps/mobile/db/sales.ts` as
gaining "search keys via medicineSearchKeys", and that part was not built. **W2-03
is therefore PARTIAL, not done.** Extending the fold to shop inventory needs a
folded-key column on `medicines` plus an FTS rebuild — a SQLite migration that
rewrites a search index every existing shop depends on — and it cannot be
device-validated in this batch. It is named as Batch 3 work rather than rushed
in at a closing gate.

What IS unaffected: the Add Medicine screen degrades exactly as it did before
when the catalogue is empty — the provider finds nothing and the existing "not
connected yet" state is what the user sees. That degradation was tested, not
assumed.

---

## 6. One mapping to re-check against real data

`packSize → unitOfMeasure` is an **allowlist of bare unit words**; anything
containing a digit is dropped. That is because `sale_items.unit_snapshot` copies
that column onto a receipt line, and a pack size like "1 x 10" would then appear
as a unit on a customer's receipt. The allowlist was written without a real
dataset in front of it, so **it must be re-checked against the first licensed
file** — if real pack-size values are shaped differently, the mapping will drop
more than it should, which is the safe direction but not necessarily the right
one.
