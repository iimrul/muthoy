# E4 — the migration-chain successor, and how to roll it back

**Batch 3. Migration 35 is written, tested in PGlite, and NOT APPLIED to any
hosted project.**

## 1. What the seal was, and why a successor was needed

H-9 left the Postgres migration chain **sealed** at migration 34. Five separate
gates recorded the chain's shape, and adding any migration broke all of them —
including a hash-pinned `h9_postmigration_checks.sql`. That was deliberate: a
chain that cannot change silently is a chain whose recorded evidence stays true.

It also meant the chain could never be extended, which is not a workable end
state. **E4 is the mechanism that lets exactly one successor land without
weakening what the seal proved.**

## 2. The four gates, and what each now checks

| Gate | Before | After |
|---|---|---|
| chain shape | the exact 34-file list | an **exact-set successor check**: the recorded chain plus the one declared successor, and nothing else |
| `h9_postmigration_checks.sql` | hash-pinned to one value | still hash-pinned, and the pinned value is **asserted unchanged** |
| migration 34 | hash-pinned | still hash-pinned, and **asserted unchanged** |
| rollback classification | 34 entries | 35, with migration 35 classified by what its statements actually do |

**The successor is an exact set, not a floor.** A count-based check would pass a
substitution that swapped one migration for another of the same length, so the
negative controls include exactly that: a same-count substitution, and a removed
registry key.

## 3. What migration 35 contains

`backend/supabase/migrations/20261023000000_e4_batch3_admin_platform.sql`.

### New tables

| Table | Purpose | Notable constraint |
|---|---|---|
| `admin_audit_log` | the durable platform admin audit | append-only by privilege: `insert` granted, nothing else |
| `admin_support_cases` | support cases | `shop_id uuid NOT NULL` |
| `admin_support_notes` | append-only notes on a case | `case_id` is **`ON DELETE RESTRICT`** |
| `admin_platform_settings` | the six platform settings | `CHECK` on the key, and on value lengths |

**Every foreign key names its `onDelete` policy explicitly** (CLAUDE.md rule 2).
`admin_support_notes.case_id` is `RESTRICT` rather than `CASCADE` on purpose: a
cascade would let deleting a case erase an append-only note trail, which is the
one thing an append-only table exists to prevent.

**Column-level UPDATE grants** on all three mutable tables, rather than
table-wide UPDATE — a table-wide grant would let attribution columns be
rewritten, which is the same class of problem as a mutable audit.

### One added column, stated rather than glossed

The promoted `admin_audit_log` is **not byte-identical** to the staged
`backend/supabase/deploy/batch2-admin-audit.sql`: it adds **`actor_verified`**.
Every column, index, revoke and grant of the staged file is preserved, **plus**
that one column, and the staged file carries a header recording exactly that
difference.

`actor_verified` exists because `apps/admin/lib/adminLogin.ts:364` audits a
failed login with `actor: account.username` and no verified cookie. "The actor
always comes from the verified cookie" was therefore false for login attempts,
which by nature precede a session. The column makes the distinction explicit
instead of leaving a reader to assume.

### Two existing tables: revoke first, then grant

`sale_refunds` and `audit_logs` needed SELECT for the admin panel. A bare
`GRANT SELECT` would have **left any existing DML in place**, so both are
`REVOKE ALL` first and then `GRANT SELECT` only:

```sql
revoke all on table public.audit_logs from service_role;
grant select on table public.audit_logs to service_role;
```

A regression gate asserts the revoke did not break sync: every existing
B2/B3/B4/H-7 pgtest still passes.

## 4. What was verified, and where

| Claim | Suite |
|---|---|
| the DDL, every constraint, index and privilege | `backend/supabase/pgtest/e4-admin-platform.pgtest.ts` |
| role, ACL, **column-level** ACL and RLS for every new and re-granted object | same, in the effective-privilege style `batch2-admin-acl.pgtest.ts` established — `has_table_privilege`, `has_column_privilege`, `has_function_privilege`, `relrowsecurity`, policy absence |
| the chain succession, with negative controls | `backend/supabase/pgtest/e4-chain-succession.pgtest.ts` |
| the H-9 gates still hold | `h9-cron-cleanup.pgtest.ts`, `apps/mobile/tests/h9-prod-preflight.test.ts` |
| the two revokes do not break sync | every existing pgtest, re-run |
| the evidence manifest has not drifted | `apps/mobile/tests/e4-evidence-manifest.test.ts` |

**Verified at Batch 3 close: 73 tests across the three E4/H-9 chain pgtests, and
134 across the preflight, W4-05 identity and migration pgtests — all exit 0.**

## 5. The evidence manifest, and why it is not decoration

`backend/supabase/migrations/e4-source-hashes.json`, checked by
`e4-evidence-manifest.test.ts`.

H-9's own manifest (`audit-artifacts/h9-remediation/final-source-hashes.json`)
is a **static snapshot that nothing re-checks**, and one of its recorded hashes
— `DECISIONS.md` — has already drifted away from the tree. A recorded hash that
nothing verifies is decoration.

E4's manifest is the opposite: **if any recorded artifact changes without the
manifest being regenerated, the test fails and names the file.** It also
separately asserts the two H-9 baseline hashes, so regenerating E4's manifest
can never quietly move H-9's.

That guard fired during step 8 of this batch — W2-03's classification of the new
SQLite migration legitimately changed three recorded files — and the manifest
was regenerated with those three hashes and no others. **The H-9 baseline hashes
were unchanged, and are still asserted.**

## 6. Rollback and recovery

### Classification

Migration 35 is classified in
`backend/supabase/migrations/rollback-classification.json`. It **creates**
objects and **re-grants** privileges; it writes no business data.

### Per-component reversal

| Component | How to reverse | Cost |
|---|---|---|
| `admin_audit_log` | `drop table` | **the audit history in it is lost.** Take a copy first, or accept the loss deliberately |
| `admin_support_cases` / `admin_support_notes` | drop notes first, then cases — the FK is `RESTRICT`, so the order is forced | support history lost |
| `admin_platform_settings` | `drop table` | the panel falls back to its documented defaults: no row means a flag is **enabled** |
| the `sale_refunds` / `audit_logs` revoke-then-grant | re-apply the prior grants from `20260907000000_h7_security_hardening.sql` | **not a no-op.** Restoring the pre-E4 state means restoring whatever DML those roles previously held, which the revoke deliberately removed. Decide which state is wanted before reversing |
| the four gate updates | revert the test files and the classification JSON **together** | reverting one without the others leaves a gate asserting a chain that no longer exists |

### The order that matters

**Reverse the grants last.** Dropping a table whose privileges have already been
reverted can fail on a missing privilege, and that failure is confusing rather
than informative.

### What rollback cannot undo

Nothing in migration 35 is irreversible in the sense that data is destroyed by
*applying* it — it creates and grants. The irreversibility is on the way back:
**dropping the audit, support or settings tables destroys their rows**, and
there is no second copy.

## 7. Authorization gates still open

| Gate | What it is | Why it is not met |
|---|---|---|
| **E4-H** | migration 35 applied to a hosted project | a hosted write. Not performed, not authorized in this batch |
| **A2** | a fresh 34-chain on a disposable project | blocked on the Supabase Free-slot count |
| **A3** | a historical upgrade rehearsal | blocked on capacity and a DEV credential |
| **H-11 C5** | a real restore rehearsal | needs a real backup provider. **Local PGlite validation is never reported as a real restore** |

**No hosted SQL was executed, no hosted project was altered, no credential was
retrieved, and no `audit-artifacts/**` file was modified** during Batch 3. Both
Supabase Free projects are untouched: not deleted, paused, repurposed or
upgraded.
