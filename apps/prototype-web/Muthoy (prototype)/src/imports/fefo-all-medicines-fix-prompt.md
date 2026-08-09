# Portable POS — Make FEFO Correct for EVERY Medicine
## Comprehensive fix, not screenshot-specific

The earlier fix used Napa as the example. This prompt generalises the FEFO logic so
it is provably correct for ANY medicine, ANY number of batches, legacy flat records,
discounted batches, sold-out batches, and missing/null expiry dates. Apply every fix.

The single recurring root cause across the whole codebase: code keeps reading a
STORED `expiryDays` / `expiry` NUMBER that was frozen when stock was added. That
number goes stale over time and corrupts FEFO ordering and display. The rule:
**expiry days must ALWAYS be derived from `expiryDate` at read time, never stored
and trusted.**

---

## FIX 1 — One canonical FEFO helper, used everywhere

Create a single source of truth so no two screens sort differently.

```ts
// medicineData.ts — the ONLY place batch ordering is defined.
export function sortBatchesFEFO<T extends { expiryDate?: string | null }>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    if (!a.expiryDate) return 1;     // null expiry always last
    if (!b.expiryDate) return -1;
    return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
  });
}

// Always compute days from the date — never read a stored number.
export function expiryDaysFromDate(expiryDate?: string | null): number | null {
  return expiryDate ? calculateExpiryDays(expiryDate) : null;
}
```

Replace EVERY inline batch sort (in `getGroupedMedicines`, `Inventory.tsx` batch
table, `reduceStock`, `calculateBatchDistribution`) with `sortBatchesFEFO(...)`.
There must be zero hand-written `a.expiry - b.expiry` sorts left anywhere.

---

## FIX 2 — Purge every stale `expiryDays` / `expiry` read

Search the whole codebase for these patterns and replace each with a fresh
computation from `expiryDate`:

- `b.expiryDays ?? ...`            → `expiryDaysFromDate(b.expiryDate)`
- `b.expiry ?? null` (when sorting/picking active) → `expiryDaysFromDate(b.expiryDate)`
- `sourceBatch.expiryDays ?? sourceBatch.expiry` (Inventory edit prefill) →
  `expiryDaysFromDate(sourceBatch.expiryDate)`

Specifically fix `calculateBatchDistribution` (~line 519) where
`expiry: b.expiryDays ?? null` must become
`expiry: expiryDaysFromDate(b.expiryDate)`. The sort there is already date-based;
this makes the returned `expiry` field consistent too.

The stored `expiryDays` may remain in data for backward compatibility, but NO logic
may sort, pick the active batch, or display the countdown from it — always recompute.

---

## FIX 3 — Active batch is derived identically in all three views

For EVERY medicine, the active batch = `sortBatchesFEFO(batches)[0]`.

- `getGroupedMedicines`: after `sortBatchesFEFO`, set `med.activeBatch = batches[0]`
  and derive `med.price/salePrice/batchNo/expiryDate/expiry/id` from it.
- `SaleEntry.tsx`: display `med.activeBatch` (batchNo, expiryDate, price).
- `Inventory.tsx` batch table: mark `sortBatchesFEFO(batches)[0]` as the "Active"
  row — same helper, so the badge always matches the Sale page for every medicine.

Because all three call the same helper on the same data, they cannot disagree for
any medicine.

---

## FIX 4 — FEFO deduction works for every medicine and spills across batches

`reduceStock` and `calculateBatchDistribution` must:
1. Collect all in-stock batches across ALL rows matching name+generic (handles the
   case where the same medicine exists as multiple records).
2. Sort with `sortBatchesFEFO`.
3. Deduct earliest-expiry first; when a batch hits 0, continue into the next.
4. Remove emptied batches and recompute totals via `updateComputedFields`.

Resolve the medicine robustly (id may point at a batch after grouping):

```ts
const reference =
  medicines.find(m => m.id === medicineId) ||
  medicines.find(m => (m.batches || []).some((b: any) => b.id === medicineId));
if (!reference) return medicines;
```

This must hold for a medicine with 1 batch, 2 batches, or 5 batches — generically.

---

## FIX 5 — Discounted and null-expiry batches behave correctly for all medicines

- A discounted active batch: the Sale price must be the discounted `salePrice` of
  `activeBatch`, and `originalPrice` preserved for the "Save ৳X" label — for any
  medicine, not just ones currently on discount.
- A batch with no expiry date (`expiryDate` null/empty): sorts LAST (never becomes
  active while dated stock exists), and its countdown shows "N/A", never a negative
  or stale number.
- A fully sold-out batch (stock 0): excluded from active-batch selection and from
  `calculateBatchDistribution`, for every medicine.

---

## FIX 6 — Cache invalidation is universal, not per-screen

Any write to medicines — sale (`reduceStock`), stock add, batch edit, medicine edit,
discount apply/remove, expiry return — must funnel through `saveMedicines`, which
clears `groupedCache` and dispatches `medicines-updated`. Verify each of these call
sites calls `saveMedicines` (not a raw `shopStorage.setItem("medicines", ...)`), so
the Sale page refreshes the active batch for every medicine after any change.

Grep for raw writes to bypass detection:
`shopStorage.setItem("medicines"` — every hit except inside `saveMedicines` itself
must be replaced with a `saveMedicines(...)` call.

---

## FIX 7 — Legacy flat medicines (no batches[]) also obey FEFO

`migrateLegacyMedicine` must convert any flat medicine (top-level stock/expiryDate)
into a single-batch `batches[]` entry so it flows through the same FEFO path. Confirm
that after migration, NO medicine in storage is missing a `batches` array. A flat
medicine with one batch is just FEFO with a single element — it must still display
its active batch and deduct correctly.

---

## GENERAL VERIFICATION (run for several different medicines)

Pick at least 3 medicines with different shapes:
- A: two batches, different expiry dates (e.g. Napa)
- B: one batch only (e.g. Ace)
- C: three+ batches, one discounted, one with null expiry

For EACH:
1. Sale page active batch == Inventory "Active" row (same batchNo, price, expiry).
2. Selling beyond the active batch's stock spills into the next-earliest batch.
3. When the active batch empties, the next-earliest becomes active everywhere
   automatically, and the displayed price updates.
4. Null-expiry batch never shows as active while a dated batch has stock.
5. Discounted active batch shows discounted price + correct "Save ৳X".
6. Inventory CURRENT total and BATCHES count update after each sale.
7. Dashboard sales total reflects the sale.

If all three medicines pass all seven checks, FEFO is correct generally — not just
for the screenshot case.

## WHAT NOT TO CHANGE
- The data model (`batches[]`), shop-scoping, brand, or modal UIs.
- `calculateExpiryDays` itself — it is correct; just always call it instead of
  reading stored day counts.
