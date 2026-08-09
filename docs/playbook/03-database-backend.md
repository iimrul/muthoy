# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 3 — Database & Backend
### The actual schema files (schema.ts, supabase-schema.sql) are the source of
### truth — this volume explains them and adds what those files don't cover.

---

## ER DIAGRAM
See the ERD delivered earlier in this project (23 tables). Summary of the graph:
`shops` is the hub every table traces back to (directly or via a parent); the
FEFO chain is `medicines → batches → inventory_movements`; the sale chain is
`sales → sale_items → batches`, with `sales_returns` hanging off `sale_items`;
the purchase chain mirrors it via `suppliers → purchases → purchase_items →
purchase_returns`; billing is `shops → subscriptions`; and `payments.ref_id`
polymorphically points at `expenses` when `type='expense'`.

## COMPLETE SCHEMA
**Use `schema.ts` (SQLite/Drizzle, lives at `apps/mobile/db/schema.ts`) and
`supabase-schema.sql` (Postgres, lives at `backend/supabase/migrations/`) exactly
as delivered — do not regenerate them from a fresh prompt, hand them to Cursor
verbatim.** 23 tables. Every table carries: `id` (device-generated UUID),
`shop_id`, `created_at`, `updated_at`, `is_dirty` (SQLite side), `is_deleted`,
and on the tables where it matters, `deleted_at`/`deleted_by`. Shared TypeScript
types derived from this schema live in `packages/types` so `apps/mobile` and
`apps/admin` never define the same shape twice.

## SQLITE
WAL mode (crash-safe, concurrent read/write). This is the mobile app's ONLY
database — see Volume 2's "one source of truth" rule. `updated_at` is NOT
auto-maintained by SQLite itself; the data layer (`db/`) must set it on every
write via one shared helper function — never duplicated per call site.

## DRIZZLE
The ORM layer over SQLite. Typed queries only — no raw SQL string-building in
application code (raw SQL is fine inside migration files). Every query function
lives in `db/`, nowhere else.

## SYNC QUEUE
`sync_queue` is the outbox: every local write also inserts a queue row
(table_name, row_id, op, payload, status). The sync layer (built Day 13, P0 —
Beta ships with last-write-wins across all fields; the fuller delta-merge for
stock quantities is P1) reads
`status='pending'` rows, batches them to the Edge Function, and marks them
`sent` on confirmation or increments `attempts` with backoff on failure.

## SUPABASE
Postgres + Auth (phone OTP) + Storage + Edge Functions + RLS. Built Day 12-13
(P0 — Beta-critical, per the Beta Definition in Volume 0).
Region: closest to Bangladesh for latency. The mobile app's own screens NEVER
call Supabase directly — only the `sync/` layer and, separately, the admin
panel via the service-role key.

## EDGE FUNCTIONS
Two Edge Functions total, on different timelines: the **sync endpoint** (built
Day 13, P0 — receives batched queue pushes, applies them with RLS enforced,
returns other devices' changes to pull) and the **payment webhook** (P1,
post-beta — verifies the payment provider's signature, writes a
`subscriptions` row — see Volume 2's subscription flow diagram; the phone never
self-declares its own premium status).

## STORAGE
Supabase Storage holds expense receipt photos and full-shop backup exports.
Local-first: a receipt photo is usable immediately on-device; upload happens
opportunistically when online, queued the same way as any other sync item.

## POLICIES (Row Level Security)
Every table: `shop_id = auth.jwt() ->> 'shop_id'`. `audit_logs` has insert+select
only — no update/delete policy exists at all, enforcing append-only at the
database level. Full policy list is in `supabase-schema.sql`. **Verify by hand,
never assume**: create two test shops, confirm shop A's token cannot touch a
single row belonging to shop B, on every table.

## TRIGGERS
`set_updated_at()` — a single Postgres trigger function attached to all 15
mutable tables' `before update`, so `updated_at` is always accurate for
last-write-wins sync resolution. (SQLite side: see the note under SQLITE above.)

## INDEXING
Key indexes and WHY (full list in the schema files):
```
batches(medicine_id, expiry_date)   → makes FEFO ordering a fast index scan
batches UNIQUE(shop_id, medicine_id, batch_no) → prevents duplicate batch identity
sales(shop_id, created_at)          → dashboard/report date-range queries
sales(shop_id, invoice_no) UNIQUE   → human-readable invoice numbers stay unique
notifications(shop_id, is_read)     → instant unread-count badge
sync_queue(shop_id, status)         → the sync engine's work queue
cash_drawer UNIQUE(shop_id, business_date) → exactly one drawer row per day
```

## FTS5
`medicines_fts` — a virtual table over `(name, generic)`, kept in sync via
insert/update/delete triggers, giving instant offline search across a
20,000+ item catalogue on a low-end phone.

## SEED DATA
**None ships in production.** Every fresh shop starts empty (Volume 1 rule #9).
For DEVELOPMENT/testing only, use a separate `seed-dev.ts` script gated behind
`if (__DEV__)`, generating realistic test medicines/batches so Day 6-7's FEFO
testing has something real to work against — and confirm on Day 15 that this
script never runs in a production build.

## MIGRATION STRATEGY
Every schema change is a new Drizzle-generated migration file, never a hand
edit of an old one. Before shipping any migration, test it against a database
that already contains realistic data (not just a fresh empty one) — this is
what protects a real pharmacy's data across an app update.

## BACKUP STRATEGY
From Day 13 onward, every successful sync is itself a live backup (the shop's data exists
in Supabase). Additionally, a periodic full-shop export to Supabase Storage
(JSON snapshot) gives a restore point independent of row-by-row sync history.
Restore-on-new-phone (Volume 2/system-design) is the actual disaster-recovery
mechanism an owner will use.

## SECURITY
bcrypt PIN hashing, SQLCipher at rest, RLS in the cloud, service-role key
server-side only, append-only audit log, `ON DELETE RESTRICT` protecting
financial/audit history from accidental cascading loss. See Volume 2's Security
Architecture section for the full list.

## PERFORMANCE
FTS5 for search, proper indexes on every hot-path query (listed above), and the
architectural fact that a shop's own performance never degrades as OTHER shops
are added to the platform (each phone only ever queries its own local SQLite).
The real scaling watchpoints, per muthoy-system-design.md §4, are the sync
Edge Function's batch handling and the admin panel's aggregate queries — not
raw database throughput.

## API ARCHITECTURE
Two real "APIs" in this system:
1. **The sync API** (Edge Function) — the only channel between phone and cloud
   for a shop's own data. Batched, retried, RLS-enforced.
2. **The admin API** (Next.js server routes/server components) — service-role
   reads/writes for the admin panel only, never exposed to any client bundle.
There is no general-purpose public REST/GraphQL API in the 15-day scope or the
P1/later scope — see Volume 10 for where that becomes relevant (public API
as a future SaaS direction).
