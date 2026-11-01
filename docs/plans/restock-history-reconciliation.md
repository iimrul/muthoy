# Batch 3: historical medicine identity reconciliation

The restock correction preserves every existing medicine, batch, purchase,
sale, refund, supplier payment and inventory movement. It does not repair
historical parallel medicine rows. No cleanup has been executed.

## Proposed separate procedure — requires authorization

1. Export a read-only, shop-scoped inventory of candidate medicine IDs and
   their strength, form, unit, barcode, manufacturer, batches and transaction
   references. Name matches identify review candidates only.
2. Have the shop owner explicitly confirm each product identity. Record both
   the accepted and rejected pairs, plus actor, date and reason. Never infer
   identity from matching names or manufacturer alone.
3. Design an additive identity alias/group, scoped by shop, for future reads
   and FEFO allocation. Keep original medicine/batch IDs on every historical
   transaction. Detect same-number batch collisions and incompatible units
   before proposing an alias. Do not rewrite or combine stock movements.
4. Present a dry run showing stock, expiry ordering, valuation, supplier
   position and cash totals before/after, plus the exact reversible alias
   records. Require a separate approved schema/sync/RLS plan and tests before
   implementation. This document does not authorize such a migration.
5. Back up the authorized shop data. Apply only the approved additive alias
   records atomically with an audit trail and operation IDs. Reconcile stock
   against movement sums and money against immutable transaction amounts.
6. Roll back by disabling the new aliases, preserving their audit records.
   Purchases, sales, refunds, supplier payments and original IDs remain intact.

## Device validation still required for the restock correction

- Select the existing Progut MUPS explicitly; add FEFO-EARLY (2027-01-15,
  quantity 50) beside Baban (2027-12-12, quantity 200). Expect one medicine,
  two batches and 250 total stock.
- Sell partially from FEFO-EARLY, then sell beyond its remainder. Verify
  spillover into Baban, each batch's own price, and movement reconciliation.
- Verify expiry-day acceptance, next-day exclusion, exhaustion and refund to
  the original sale batches.
- Check COD cash outflow, supplier position and opening cash defaulting to 0;
  credit receipts must not post cash outflow.
- Check explicit distinct-product creation, staff permission revocation,
  shop isolation and repeated taps.
- After separately authorized hosted activation, verify online push/pull and
  restart on two devices. Local SQLite/PGlite checks are not device evidence.

The hosted restock extension remains outside the active migration chain in
`backend/supabase/held-migrations`. Its reviewed activation must precede client
distribution; the currently deployed contract rejects reference-only receipt
graphs. No hosted migration or cleanup is authorized by this document.
