# Batch 3 existing-medicine restock — held draft

`20261101000000_b3_existing_medicine_restock.sql` is excluded from the active
migration directory and chain manifests. It has not been applied remotely.
The isolated `inventory-add-purchase-sync.pgtest.ts` suite explicitly applies
it to PGlite after the authorized chain; ordinary harnesses do not load it.

The draft extends `inventory_add_purchase` with a reference-only existing
medicine graph: purchase, one new batch, one received purchase item, one stock
movement, and the existing optional COD payment/drawer rows. It requires the
live `inventory_add` permission and an active medicine in the caller's shop.
It never updates or inserts an existing medicine's metadata. New-medicine
graphs, owner-only `purchase_create`, public wrappers and function ACLs retain
their existing behavior. SQLite needs no schema migration.

Release order requires separate authorization:

1. Review the draft and hosted contract tests. Keep the hosted chain HELD.
2. At the approved release gate, assign/promote the draft to the authorized
   chain using the repository's successor classification, byte-pin and
   preflight conventions. Re-run the complete chain and API-role checks.
3. Apply the approved hosted migration before distributing clients that emit
   the existing-medicine `inventory_add_purchase` shape. The current hosted
   contract rejects the new graph; local-only test success is not hosted
   deployment evidence.
4. Validate staff restocking and subsequent cross-batch sale/refund on the
   Preview APK, including online push/pull and COD reconciliation.

Rollback is forward-compatible: stop distributing the new client and disable
new restock entry while preserving the additive server support for queued
receipts. Do not restore the old staging count constraint blindly: accepted or
pending four/six-row graphs may remain. Do not delete staging, purchase, stock,
payment or historical medicine data. A SQL reversal needs a separate approved
procedure after examining pending operations and release state. Existing
medicine and transaction IDs are unchanged, so the prior client remains able
to read completed receipts.
