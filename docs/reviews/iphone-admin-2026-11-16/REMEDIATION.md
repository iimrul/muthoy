# Approved local remediation — 16 November 2026

Founder approved the protected plan in chat: "ok i approved".

Approved: local database compatibility candidate, printer repairs, isolated tests,
review and documentation. Hosted activation remains a separate approval after
the candidate, preflight, backup/restore evidence and exact catalog diff are ready.

Files: `domain/escpos.ts`, `native/printer.ts`, their tests/characterization fixtures;
a new held Admin compatibility migration and PostgreSQL rehearsal; this review.
Existing historical migrations and unrelated working changes stay intact.

Risks: duplicate/partial paper after uncertain BLE delivery; accidentally widening
Admin grants; losing append-only audit/publication guarantees; disturbing the
existing Staff-sale wrapper. Verification must cover actual SQL behavior and byte
output, not just compilation.

Device/native and hosted workflow acceptance remain NOT RUN. No macOS/Xcode or
physical iPhone/Android/printer is available through the current tools.

## Built

- ESC/POS preserves builder-owned LF while sanitizing control bytes in fields.
  Monthly output now includes three LF before cut. All other fixture content,
  including integer-paisa amounts, matches original byte-content hashes.
- Each print request makes one native send. Disconnect, send failure and timeout
  are surfaced without automatic duplication. A new explicit request can retry.
- New CLI-generated held migration restores the six Admin stores, publication
  RPC, read-only shop audit/refunds grants and append-only evidence controls.
  Both new functions pin search_path; only the RPC is callable by service_role.
  No sync, entitlement or Staff-sale function is changed. No business-row DML.
- Preflight refuses non-postgres execution, missing/changed Staff repair,
  partial stores, unreviewed schema/column ACL/policies, and unknown publication
  implementations/helpers/triggers. Reapplication retains data and history.
- SELECT-only DEV preflight is prepared. Hosted DEV still has 32 migrations and
  zero of the six Admin stores; its Staff function hash remains unchanged.

## Verification and limits

`run_remediation.py` retains every attempt and raw-log digest. Initial printer
requirements reproduced all eight failures; the repaired requirements passed
without modifying `release-requirements.hwtest.ts`. Characterization assertions
were updated to the approved semantics, including exact money/content preservation.

| Actual check | Result |
| --- | --- |
| Printer/domain/iOS source contracts | 22 passed |
| Hardware-model suite | 103 passed; one baseline-only platform branch skipped |
| New PostgreSQL candidate rehearsal | 60 passed on DEV-order and repository-order fixtures |
| Existing Staff/role-switch PostgreSQL suites | 75 passed (42 Staff + 33 role-switch) |
| Admin routes/financial labels | 175 passed |
| `pnpm typecheck` | Seven tasks passed; five cache hits |
| `pnpm lint` | Seven tasks passed; five cache hits |

The exact staged publication was also checked in a separate source snapshot:
60 PostgreSQL candidate tests, six printer/domain unit tests, and 100 hardware
model checks passed, with one explicit platform skip. This snapshot excludes the
uncommitted iOS integration, so its counts differ from the integrated workspace.
It reuses installed dependencies through junctions; no fresh locked install,
native compilation or new Admin production build is claimed for this repair.

The SQL tests execute real PostgreSQL through PGlite. They verify role refusals,
allowed updates, immutable attribution, FK restriction, atomic publication/audit,
no disclosure on repeated publication, whole-month/k-floor checks, rejected
unknown installations, Staff split/credit replay, standalone credit denial, and
restore of a new synthetic database image. This is not a hosted PG17 backup or
restore rehearsal. Broader original Staff/role-switch results are recorded below.

Initial SQL attempts exposed test registration/parameter-binding mistakes, an
incorrect RESTRICT SQLSTATE expectation, a malformed synthetic function signature
and Windows line-ending fingerprints. Those were corrected, not hidden. No
assertion/timeout or independent release requirement was weakened. The held SQL
and captured DEV reference have LF Git attributes. Fresh self-review also added
the explicit postgres-owner guard and unknown-state refusal cases.

## Publication scope

Only this repair, its standalone synthetic test dependencies and documentation
are candidates for publication. Unrelated mobile/database/auth/sync integration
and dependency upgrades remain local. Existing iOS modules and their native
activation are not bundled by this scoped repair; local iOS contract results
describe that integrated working directory, not an iOS-ready GitHub release.

The PostgreSQL fixture captures the already-hosted Staff repair as a test-only
reference, SHA256 `a60acce006b39bcd0a9c5e66d7cfb8510b8de3fb5653da81157e689416d544c2`.
It reconstructs DEV31 + that patch without promoting other local migrations.
Repository fixtures use their actual checked-out chain, adding that same reviewed
test prerequisite only when absent. This reference is never a hosted command.

The hardware transport tests detect whether their target checkout includes the
separate iOS integration. Extra iOS uncertainty cases run only when that path
exists; the baseline unsupported-platform check otherwise remains explicit.
`database-regression` needs the separately integrated suites and reports that
requirement if they are absent from a checkout. No full repository PASS is claimed.

## Remaining gates

Hosted activation is **NOT ready/approved**: fresh exact pre/post catalog and
business-state comparison, real PG17 backup/restore evidence, quiesced writes and
an explicit migration-history decision are still required. The held candidate is
outside `migrations/`; no automatic `db push` is permitted. Class C audit history
must not be dropped as rollback. In-flight failures must roll back the transaction;
after accepted writes, recover forward or from a verified complete restore.

The seven historical migration gaps are not papered over by this candidate. E11
entitlement verification, W4-05 hardening, cron/constraint maintenance and the
role-switch deployment gates remain separate. No subscription/recovery feature
or live payment provider was activated. Existing advisor findings remain open.

Real iPhone/Android builds and all 51 route/device checks, BLE hardware, Safari,
real fonts/map tiles, DB-backed Admin flows and hosted concurrency remain NOT RUN.

## Files and suggested commit

Source: `apps/mobile/domain/escpos.ts`, `apps/mobile/native/printer.ts`.
Tests: printer unit tests, hardware fixture directory, new Admin PostgreSQL
rehearsal and its one Vitest registration. SQL: new held candidate and SELECT-only
preflight. Documentation: this review, the new decision and two LF attributes.

`fix(platform): repair printing and prepare held admin compatibility migration`
