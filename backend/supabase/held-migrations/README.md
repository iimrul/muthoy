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


## Role-switch credit-link contract — HELD local candidate

`role-switch-credit-link-contract.sql` is separately Founder-approved for local
PGlite validation only. It is excluded from active migrations/manifests and has
not been applied remotely. The new role-switch-credit-contract pgtest opts in;
ordinary harnesses retain the active chain. Existing linked credits keep their
server sale identity when a projected client sends null; a different nonnull
identity is rejected. Staff pull masks only the JSON sale_id for a colleague
sale outside that actor's history scope. Stored rows, financial values, existing
permissions and pagination are preserved. R1 client access hydration reconstructs
the local relationship when Owner returns.

Current hosted behavior remains defective until a separate approved promotion,
classification/seal/preflight, deployment and DEV acceptance gate. This file does
not authorize any of those operations or a backfill of already-null server rows.
Rollback this local candidate/tests only. A remote reversal requires its own plan:
queued clients can contain intentionally masked credit links and must not silently
erase server identity after the guard is removed. No history or queue deletion.


### Approved local F3/F4 extension — still HELD

The same candidate also masks hidden-sale completed-draft links. The separately
approved client access-hydration guard restores only the equal-stamp otherwise-
identical link, with same-shop, unique-link and pending/failed graph protection.
The public readable predicate requires allocation permission and readable credits,
payments AND customers; reconciliation requires its permission and customers.
Narrow credit_view/sale_return roles lose inconsistent child history; no parent
permission is added. Default sales+sale_return retains reconciliation/customers
but receives no allocation without payments. Staff receipt-less restocking stays
available. This is a documented pull-narrower-than-existing-RLS exception; no
RLS policy changes. Renamed predicate internals deny service_role too. Tests warm
both existing callers before rename and exercise complete pagination/reapply/ACLs.
Activation still requires separate promotion/classification/seal/preflight/approval.
No hosted/device repair or historical backfill is authorized by this local scope.


### Priority2 recovery storage candidate (11 November 2026)

`recovery-storage-contract.sql` is LOCAL HELD only. Private immutable DEV objects,
exact tenant/device path, live Owner membership and existing bound active A23
session required. Recovery code grants no login/enrollment authority. No update,
delete, public access, service key or new financial permissions. No hosted bucket
has been created. Minimal PGlite Storage catalog tests do not run Storage API,
object durability, deployed JWT/session verification or existing hosted policy
interactions. Before activation inspect all Storage policies for permissive OR
leakage and separately approve DEV bucket/policy creation. New-device authentic
recovery and sole-owner A23 concerns remain gated. Automatic Staff backup is not
implemented; fully offline or unverified copies remain unprotected.

### Priority1 reviewed-ordering prerequisite guard (local only)

The candidate now refuses partial installs, unknown wrapper sources/owners and
replacement of later E4 security wrappers BEFORE any mutation. It recognizes
sealed DEV31 and repository37 originals, and only its own complete reapplication.
DEV31 compatibility tests pin all31 migration contents to existing seals; migration
31 -> HELD ->32..37 -> HELD is independently tested to refuse the final reapply.
Promotion/history ordering remains a separate decision; this guard is not approval
to apply six unrelated migrations or to install a higher version out of order.
Current candidate SHA256 is recorded in held-order-guard-fingerprints-20261111.json.
The pre/postflight scripts are SELECT-only and compare wrapper identity/ownership,
all-shop business-row fingerprints and H-5 identity. No hosted activation occurred.

### Local migration38 promotion (Founder A3 approval; not hosted)

20261111000000_role_switch_credit_link_contract.sql promotes only the accepted
HELD body. Original37 SQL files/seals remain immutable. DEV still has31 migrations;
no missing32..37 migration is applied by this local promotion. Automatic hosted
push is blocked: a separate explicit history/order decision must name the one DEV
patch and preserve the six missing versions. Both wrapper orders are tested,
including E4 Staff shop-identity protection. Existing deployed push/pull bodies
match the reviewed contract; unrelated router, auth and billing changes are not
part of this deployment. Live schema/data backup, paused sync, empty in-flight
staging, exact pre/post comparison and Founder approval remain mandatory.
No device hydration or historical-null backfill is authorized here.


## Admin DEV compatibility candidate — SUPERSEDED (16 November 2026)

`20261116002928_admin_dev_compatibility.sql` was prepared to give DEV the six
Admin tables and the publication RPC without migrations 32-38. The founder
instead approved applying the real chain 32-38 to DEV (then 40), so DEV now
carries exactly the migrations PROD will receive. 35 (E4 admin platform) and
36 (E4-B publication) supply those tables and that RPC. Do NOT apply this
candidate to any hosted project: its objects would already exist, and its
subset would leave DEV different from PROD. It stays only as review history.

Current DEV state after the 16 November catch-up: history 1-40 in the order
1-31, 39, 32-38, 40 (39 had already been applied on 15 November). The older
paragraphs above that say DEV has 31 migrations describe the state before
this catch-up and are kept as history.
