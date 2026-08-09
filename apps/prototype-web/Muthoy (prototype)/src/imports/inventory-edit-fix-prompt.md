# Portable POS — Fix Inventory Edit Buttons (Corrections Not Showing)

## The bug (confirmed in code)

Your medicines store data in a `batches[]` array — each batch has its own `batchNo`,
`expiryDate`, `stock`, `purchasePrice`, `salePrice`. There are NO top-level
`med.stock` / `med.batchNo` / `med.salePrice` fields.

But BOTH edit save handlers in `Inventory.tsx` read and write those NON-EXISTENT
top-level fields and never touch the `batches[]` array. So edits are written to
phantom fields that the display (which reads `batches[]`) never looks at — the
correction silently disappears. This affects:

1. **Per-batch edit** (`onUpdateBatch`, ~line 783): does
   `med.id === updatedBatch.id` then sets `med.batchNo / med.stock / ...` at the top
   level. Wrong target (the batches array) AND wrong id matching (the grouped
   `batch.id` is the active batch's source id, not a per-batch identifier).

2. **Medicine edit** (`onUpdateMedicine`, ~line 741): replaces the whole medicine
   with `updatedMedicine`, which carries flat fields the modal built — again not the
   `batches[]` entry that's actually displayed.

3. Neither handler invalidates the `medicines_grouped` cache, so even a correct
   write wouldn't re-render until the cache expires.

---

## FIX 1 — Per-batch edit must update the correct entry INSIDE batches[]

The batch row needs to know WHICH medicine record and WHICH batch it belongs to.
When opening the batch editor, capture both the medicine id and the batch number.

In the per-batch pencil handler (~line 685), set editingBatch with identifying keys:

```ts
onPointerDown={(e) => {
  e.preventDefault();
  setEditingBatch({
    ...batch,
    __medicineId: med.id,          // the grouped medicine's display id
    __originalBatchNo: batch.batchNo, // which batch row was tapped
  });
  setEditingBatchMedicineName(med.name);
  setIsEditBatchModalOpen(true);
}}
```

Then rewrite `onUpdateBatch` to find the medicine by matching the batch, and update
the batch INSIDE its `batches[]` array — not top-level fields:

```ts
onUpdateBatch={(updatedBatch) => {
  const medId = editingBatch.__medicineId;
  const origBatchNo = editingBatch.__originalBatchNo;

  const updatedMedicines = medicines.map((med: any) => {
    // Match the medicine that actually contains this batch.
    if (med.id !== medId) return med;
    if (!Array.isArray(med.batches)) return med;

    return {
      ...med,
      batches: med.batches.map((b: any) =>
        b.batchNo === origBatchNo
          ? {
              ...b,
              batchNo: updatedBatch.batchNo,
              expiryDate: updatedBatch.expiryDate,
              stock: Number(updatedBatch.stock),
              purchasePrice: Number(updatedBatch.purchasePrice),
              salePrice: Number(updatedBatch.salePrice),
            }
          : b
      ),
    };
  });

  setMedicines(updatedMedicines);
  saveMedicines(updatedMedicines);

  // Re-read so the grouped view (active batch, price, FEFO) recomputes.
  storageCache.invalidate("medicines");
  storageCache.invalidate("medicines_grouped");
  setMedicines(getMedicines());

  setIsEditBatchModalOpen(false);
  setEditingBatch(null);
}}
```

IMPORTANT: the grouped `batch.id` is the active batch's source id and is NOT a
reliable per-batch key — match on `__medicineId` + `batchNo` as above, never on
`updatedBatch.id`.

---

## FIX 2 — Medicine-level edit must write into batches[], not flat fields

The medicine-level pencil (single-batch path) flattens batch info onto the medicine
for the modal. On save, fold those fields BACK into the correct batch in `batches[]`.

Rewrite `onUpdateMedicine`:

```ts
onUpdateMedicine={(updatedMedicine: any) => {
  const targetBatchNo = updatedMedicine.__editingBatchNo; // set when opening (line ~562)

  const updatedMedicines = medicines.map((m: any) => {
    if (m.id !== updatedMedicine.id) return m;

    // Update medicine-level metadata that legitimately lives on the medicine.
    const base = {
      ...m,
      name: updatedMedicine.name ?? m.name,
      generic: updatedMedicine.generic ?? m.generic,
      manufacturer: updatedMedicine.manufacturer ?? m.manufacturer,
      threshold: updatedMedicine.threshold ?? m.threshold,
    };

    // Fold the edited batch fields back into the matching batch.
    if (Array.isArray(m.batches) && targetBatchNo) {
      base.batches = m.batches.map((b: any) =>
        b.batchNo === targetBatchNo
          ? {
              ...b,
              batchNo: updatedMedicine.batchNo ?? b.batchNo,
              expiryDate: updatedMedicine.expiryDate ?? b.expiryDate,
              stock: Number(updatedMedicine.stock ?? b.stock),
              purchasePrice: Number(updatedMedicine.purchasePrice ?? b.purchasePrice),
              salePrice: Number(updatedMedicine.salePrice ?? b.salePrice),
            }
          : b
      );
    }
    return base;
  });

  setMedicines(updatedMedicines);
  saveMedicines(updatedMedicines);
  storageCache.invalidate("medicines");
  storageCache.invalidate("medicines_grouped");
  setMedicines(getMedicines());
}}
```

---

## FIX 3 — saveMedicines must invalidate the grouped cache

So edits never need a manual refresh, make `saveMedicines` in `medicineData.ts`
invalidate both caches on every write:

```ts
export const saveMedicines = (medicines: Medicine[]) => {
  shopStorage.setItem("medicines", JSON.stringify(medicines));
  storageCache.invalidate("medicines");
  storageCache.invalidate("medicines_grouped");
};
```

Then the explicit invalidations in Fixes 1–2 are belt-and-suspenders, and every
other code path that saves medicines also refreshes correctly.

---

## FIX 4 — Use the date-based FEFO sort in the batch table too

The per-batch table (~line 635) still sorts with `a.expiry - b.expiry` (stale day
integer). Use the same date sort as the FEFO fix so the "Active" badge in the table
matches the Sale page:

```ts
[...med.batches].sort((a, b) => {
  if (!a.expiryDate) return 1;
  if (!b.expiryDate) return -1;
  return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
})
```

---

## VERIFICATION

1. Open Napa → View Batches → edit #A12347's price from ৳1.5 to ৳1.7. Save.
   The table row MUST immediately show ৳1.7 (correction now shows).
2. Edit #A234545's stock from 15 to 20. The CURRENT total and the row MUST update.
3. Change #A234545's expiry to an earlier date — the "Active" badge and the Sale
   page active batch MUST follow.
4. Reopen the app — the edits persist (written into batches[], saved, cache cleared).
5. Multi-batch medicine: editing batch 2 must NOT alter batch 1.

## WHAT NOT TO CHANGE
- The modals' input UI — only the save handlers and the sort are wrong.
- The data model (batches[]) — keep it; just write into it correctly.
- Audit logging — keep it; it can read the same before/after batch values.
