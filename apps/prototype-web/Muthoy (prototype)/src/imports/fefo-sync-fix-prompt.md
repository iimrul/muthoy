# Portable POS — Fix FEFO Active-Batch Sync (Inventory ↔ Sale ↔ Cart)

## The bug (confirmed against your screenshots)

Inventory shows Napa's active batch as **#A234545** (expires 2026-09-12, ~98 days,
৳2, 15 units). But the Sale page shows Napa as **#A12347** (2026-11-12, 159 days,
৳1.50). The Sale page is displaying the WRONG batch — the later-expiry one — and
therefore the wrong price.

### Root cause 1 — FEFO sorts on a STALE stored day-count
In `medicineData.ts` (getGroupedMedicines, ~line 147) and the batch normalisation,
the `expiry` field is computed as:

```ts
expiry: b.expiryDays ?? (b.expiryDate ? calculateExpiryDays(b.expiryDate) : ...)
```

`b.expiryDays` is a NUMBER frozen when the stock was added. Months later it no
longer reflects reality. The FEFO sort then orders batches by this stale number and
picks the wrong active batch. This is the exact cause of the screenshot mismatch.

### Root cause 2 — sorting by day-integer instead of the real date
The sort `return a.expiry - b.expiry` sorts on the stale integer. FEFO must sort on
the actual `expiryDate` calendar value, which never goes stale.

---

## FIX 1 — Always compute expiry from the date, never trust stored expiryDays

In `medicineData.ts`, in BOTH batch-normalisation branches, stop using
`b.expiryDays ??`. Always recompute from `expiryDate`:

```ts
// BEFORE
expiry: b.expiryDays ?? (b.expiryDate ? calculateExpiryDays(b.expiryDate) : (med as any).expiry),

// AFTER — always recompute from the real date
expiry: b.expiryDate ? calculateExpiryDays(b.expiryDate) : null,
```

Do the same on the legacy flat branch (use `med.expiryDate`, not a stored `expiry`).
Stored day-counts are display conveniences only — never sort or pick the active
batch from them.

---

## FIX 2 — Sort batches by the actual expiry DATE (true FEFO)

Replace the day-integer sort with a date sort so it is always correct:

```ts
// BEFORE
med.batches.sort((a, b) => {
  if (a.expiry === null) return 1;
  if (b.expiry === null) return -1;
  return a.expiry - b.expiry;
});

// AFTER — sort by real expiry date string; missing dates go last
med.batches.sort((a, b) => {
  if (!a.expiryDate) return 1;
  if (!b.expiryDate) return -1;
  return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
});
```

After this sort, `batches[0]` is the genuine earliest-expiry batch (FEFO active).
The active price/batch assignment that follows (`med.price = activeBatch.salePrice`,
etc.) is then correct.

---

## FIX 3 — Make Inventory and Sale use the SAME active-batch logic

Both screens must derive the active batch the same way so they can never disagree.

- `Inventory.tsx` currently treats `batchIndex === 0` as active after its own sort.
- `SaleEntry.tsx` displays `med.batches[0]`.

Ensure BOTH consume the batches array already sorted by Fix 2 (from
getGroupedMedicines). Inventory must use the SAME date sort, not its own
day-integer sort. Find Inventory's batch sort (~line 636) and replace it with the
identical date-based sort from Fix 2. Then both screens point to the same
`batches[0]` as active, with the same price and batch number.

---

## FIX 4 — Cart and Checkout must resolve the active batch at confirm time

When an item is added to the cart, store the stable medicine id and resolve the
batch FRESH at checkout (not a snapshot taken at add-time), so that if stock of the
active batch runs out between adding and checkout, the next FEFO batch is used:

- Cart stores `medicineId` (stable) + the active batch number for display.
- At checkout confirm, re-read the medicine, re-sort batches by date (Fix 2), and
  deduct from `batches[0]` first; if it lacks quantity, spill into the next batch.
- The price charged is the active batch's salePrice at confirm time.

This guarantees the cart price and batch always match what Inventory shows as active.

---

## FIX 5 — Invalidate the grouped cache when stock/batches change

The grouped result is cached under `medicines_grouped`. Whenever a sale, stock
addition, batch edit, or expiry action changes batches, invalidate BOTH
`medicines` and `medicines_grouped` so the next read re-sorts and re-picks the
active batch:

```ts
storageCache.invalidate("medicines");
storageCache.invalidate("medicines_grouped");
```

Add this everywhere batches are written (checkout, AddMedicine, batch edit,
expiry discount/return). Without it, the Sale page keeps showing a stale active
batch even after the real one changed.

---

## VERIFICATION (using your exact screenshot data)

1. Napa has #A234545 (2026-09-12) and #A12347 (2026-11-12).
2. Inventory active batch = #A234545 (earlier date). Sale page MUST now show
   #A234545 at ৳2, exp 2026-09-12 — matching Inventory.
3. Sell all 15 units of #A234545. The active batch must auto-switch to #A12347,
   and the Sale page price must change to ৳1.50, exp 2026-11-12 — dynamically.
4. Add Napa to cart, then in another action sell out #A234545; at checkout the cart
   must charge from #A12347 (next FEFO), not the depleted batch.
5. Inventory, Sale card, and Cart must all show the SAME active batch and price at
   every step.

---

## WHAT NOT TO CHANGE

- `calculateExpiryDays` itself is correct — keep it; just stop caching its output as
  the sort key.
- The grouping structure, the shop-scoping, the speed caching (just add the
  invalidation in Fix 5).
- Any unrelated screen.
