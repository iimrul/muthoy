# W2-03 — multilingual search over a shop's own medicines

**Batch 3, step 8. CODE-COMPLETE. Real Android-device acceptance is NOT claimed
and remains a separate gate.**

## The problem

A pharmacy types a medicine's name in whichever script is to hand. The same
medicine is "Napa", "নাপা" or "napa" depending on who entered it and who is
searching for it now.

W2-02 solved this for the **imported national catalogue**: migration 0032 gives
`medicine_catalog` a `search_key` column folded by `medicineSearchKeys()`, and
the catalogue search folds the query the same way.

**A shop's own stock was left behind.** `medicines_fts` indexed `name` and
`generic` exactly as typed, and both search paths — `db/sales.ts` and
`db/purchases.ts` — passed the operator's query through `toFtsPrefixQuery`
unfolded. So the index and the query sat in different comparison spaces the
moment the scripts differed:

- a row stored as **নাপা** was unreachable by **napa**;
- a row stored as **Napa** was unreachable by **নাপা**.

The invariant that fixes it is one sentence: **the index and the query must be
folded by the SAME function.**

## What was built

### Migration `0033_medicine_search_key.sql`

1. `ALTER TABLE medicines ADD COLUMN search_key text` — **nullable, no
   default**. A volatile default would make this a data-writing migration, and
   NULL is the honest state for every row that already exists.
2. Drop the three FTS triggers and `medicines_fts`, then recreate it as
   `fts5(name, generic, search_key, content=medicines, content_rowid=rowid)`.
   fts5 has no ALTER that adds a column.
3. Recreate all three triggers, carrying `search_key`.
4. `INSERT INTO medicines_fts(medicines_fts) VALUES('rebuild')`.

**What is dropped is an INDEX, not data.** `medicines` is the content table and
the migration never touches it; the rebuild repopulates the index in full. The
test proves that against a **populated pre-0033 fixture** — medicines, batches
opened through the inventory ledger, a sale with its line, and a purchase with
its item — comparing a snapshot of all six tables before and after.

**One subtlety that would otherwise have been a silent bug.** The update
trigger's `'delete'` half must carry the **OLD** `search_key`. An
external-content fts5 index is not consulted on delete — it trusts the values it
is handed in order to locate the posting to remove — so passing the NEW key
would leave the old tokens in the index, and a renamed medicine would keep
answering to its previous name. The backfill updates every row, so this would
have happened on every row. A test renames a medicine and asserts the old name
stops matching.

### The backfill — `db/medicineSearchKeyBackfill.ts`

The fold is JavaScript (Bengali normalisation, then transliteration, then fuzzy
folds), so SQL cannot compute it and a SQL re-implementation would be a second
definition of the key.

- **chunked** — 500 rows per transaction, so a cold start does not hold one
  transaction across the whole table;
- **idempotent** — it selects only `search_key IS NULL`, so a second run reads
  one empty chunk and stops;
- **transactional per chunk** — through the same `db.transaction` idiom the rest
  of `db/` uses, so a mid-chunk failure rolls back whole and the next launch
  resumes. There is no half-written row in any outcome;
- **one column** — not `updated_at`, not `is_dirty`. Both are plain column
  defaults with no `onUpdate`, and the only triggers on `medicines` are the FTS
  ones, so a local index repair stays local and produces **no sync traffic** for
  a column Postgres does not have;
- a row whose every field folds to nothing gets the **empty string**, not NULL —
  NULL would make every future run pick it up again forever.

It runs from `db/init.ts` immediately after migrations and **before**
`isInitialized` is set, so no screen can read a half-folded table through a
published handle. **A backfill failure does not fail boot**: it is reported as
`db.medicine_search_key.failed` and swallowed, because a degraded search is
recoverable and a database that will not open is a shop that cannot trade. The
migration itself is not treated that way — if 0033 fails, boot fails.

### The query — `toMultilingualFtsQuery`

```
raw    = toFtsPrefixQuery(query)
folded = toFtsPrefixQuery(medicineSearchKey(query))
MATCH  = raw                when folded === raw or folded === ''
         (raw) OR (folded)  otherwise
```

Both halves are already FTS5-quoted by `toFtsPrefixQuery`, so the `OR` composes
two safe sub-expressions and no user text reaches the parser unquoted. The
parentheses are load-bearing: without them an inner `AND` binds across the `OR`
and the expression means something neither half intended.

`bm25()` still returns one relevance score for the matched row against the whole
expression, so ordering stays well defined. A row matched through `search_key`
and one matched through `name` are now ranked in a single list, which is the
intent.

**The union is permanent, not a migration-window measure.** A pulled row is
folded on arrival and a new row is folded on insert, but a row written by an
older bundle mid-upgrade is not — and a correctness property that depends on a
backfill having finished is the kind that fails on exactly one device.

### Sync safety

`search_key` is **device-local**: the Postgres `medicines` table has no such
column.

| Direction | What happens |
|---|---|
| push | `toSyncPayload` deletes `searchKey` for `medicines` — the established pattern, alongside `shops.cloudLinkedAt` and the six `users` fields |
| pull | `applyToTable` **recomputes** it from the incoming row's own name and generic, in **both** the insert values and the conflict `set` — an UPDATE that kept the old key would leave a renamed medicine findable under its previous name |
| conflict detection | `SERVER_OWNED_FIELDS` gains `medicines: ['search_key']`, with an `EVIDENCE` entry scoped to the strip itself |

## A limit of the fold, found while testing and recorded rather than hidden

`@muthoy/utils`' fold handles `z`/`j`, `ph`/`f` and doubled letters, and it
transliterates Bangla to Latin. So **নাপা and "napa" converge**, which is the
case W2-03 exists for.

**It does not fold `c` to `k`.** Measured:

| Input | Folds to |
|---|---|
| `সেক্লো` | `seklo` |
| `seclo` | `seclo` |

So a shopkeeper who types the English spelling with a `c` will not reach a row
stored in Bangla as সেক্লো. That is a gap in the **fold** — shipped by W2-02 and
used by the national catalogue — not in this migration. Widening it would change
the catalogue's own index semantics and require a re-import, which is not this
batch's to do.

There is a test asserting the limit exactly as measured, so it is a recorded
fact rather than folklore, and it **fails the day somebody fixes the fold** —
which is the right time to notice.

## What was verified, and how

`apps/mobile/db/w203-shop-medicine-search.sqlite.test.ts` — **35 tests, real
SQLite, exit 0**:

| Requirement | How it is proved |
|---|---|
| existing shop medicine data preserved | a six-table snapshot compared before and after the migration |
| fresh installation | the migration applies to an empty schema and the index is created with three columns |
| upgrade from an existing schema | the fixture is populated **before** 0033 is applied |
| transactional failure and recovery | a fold that throws on the second row of a chunk; nothing commits, not even the first row, and the next run completes |
| correct indexing and FTS rebuild | a pre-existing row is findable by name after the rebuild; `pragma_table_info` on `medicines_fts` is exactly the three columns; all three triggers carry `search_key`, and the update trigger uses both `old.` and `new.` |
| new and updated records searchable | an inserted row is reachable by a folded query with no rebuild; a renamed row stops matching its old name; a deleted row stops matching at all |
| English search regression | name and generic still match, in both backfill states |
| Bangla/Banglish correctness | Latin query → Bangla row, and Bangla query → Latin row, when backfilled |
| offline behaviour | 50 folded queries inside an explicit 2s ceiling, with no network of any kind |
| no duplicated records | the row count and distinct-id count are unchanged; a query matching through both halves returns one row |
| no inventory/purchase/sale/medicine corruption | the snapshot, plus a separate assertion that `SUM(stock)` is unchanged |

The script matrix runs **twice** — fully backfilled, and with `search_key`
forced back to NULL — because the NULL state exists on every device between the
migration and the end of the backfill. The NULL-state block includes a test
asserting the honest limit: with no folded key, a Latin query does **not** reach
a Bangla row, and the backfill is what fixes it.

Tenant isolation is asserted in both states: the FTS index is shop-blind, so
`m.shop_id` is the only thing standing between one pharmacy and another's stock
list (CLAUDE.md rule 7), and a second shop's row sits in the fixture so the
assertion is not vacuous.

### Guards that fired, and were made stronger

| Guard | What it required |
|---|---|
| `tests/server-owned-fields.test.ts` | the `medicines` entry, with a scoped `EVIDENCE` needle pointing at the strip, and `medicines` added to the documented-authority set |
| `tests/migration-rollback-classification.test.ts` | 0033 in both the data-writing list (it rebuilds the index) and the table-dropping list (it drops `medicines_fts`), with the reasoning for each recorded in place |
| `tests/e4-evidence-manifest.test.ts` | regeneration, because three of its recorded files legitimately changed. The H-9 baseline hashes it also asserts are **unchanged** |
| `db/h7-access-lock.sqlite.test.ts` | journal ≡ registry ≡ `.sql` files — satisfied by registering 0033 in `meta/_journal.json` (`idx: 33`) and `migrations.js` (`m0033`) |
| twenty-two SQLite fixtures | migration 0033, because the Drizzle schema now declares the column and a fixture modelling the app's schema must create it |

## What is NOT claimed

- **No real Android device has run this.** Device acceptance is a separate gate.
- **No performance claim about a real phone.** The 2s ceiling is a CI ceiling on
  50 queries over a small fixture; it proves the union did not make the query
  pathological, not that a 20 000-medicine shop is fast.
- **No claim that every device has finished the backfill.** The union query is
  the reason that is safe, and the "null keys" test block is the proof.
- **No Postgres change.** `search_key` is device-local; the H-9
  migration-chain seal applies to Postgres migrations and is untouched.
