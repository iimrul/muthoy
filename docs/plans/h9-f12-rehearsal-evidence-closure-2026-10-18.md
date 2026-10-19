# H-9 F12 — rehearsal hosted-evidence gate closure

This record closes one narrow gate: the F12 rehearsal hosted evidence. It closes nothing
else. No DEV or PROD action, migration rollout, commit or push is authorized or implied by
this document.

**Gate:** H-9 F12 — Rehearsal Hosted Evidence
**Decision:** CLOSED
**Approved by:** Founder, explicitly in conversation
**Approval date:** 2026-10-18
**Scope:** Rehearsal only
**Project ref:** `jwjrijvprbsndukfhlvf` (`muthoy-h9-rehearsal`, `ap-northeast-1`)
**Pinned code commit:** `b8ca5d8c9538fd41605b09d5a9475e16ff496c3d`

## Verified milestones

1. **Migration 34 applied and verified in the rehearsal.** Applied 2026-10-16, 15/15 checks,
   recorded in the sealed 52-file evidence package.
2. **Stage 1 read-only preflight and identity verification PASS.** Executor exit 0. Identity
   8/8 exact; read-only guard active as `supabase_read_only_user` with
   `transaction_read_only = on`; history exactly 34 versions ending `20261015000000`; the
   history capture is byte-identical to the sealed D1 baseline. Seven Management API calls,
   all read-only. psql was never started and the database password was never read.
3. **Live passwordless TLS certificate and hostname verification PASS.** OpenSSL process exit
   0, `Verify return code: 0 (ok)`, verified peername, TLSv1.3 / `TLS_AES_256_GCM_SHA384`.
   The chain `CN=*.pooler.supabase.com` → `Supabase Intermediate 2021 CA` →
   `Supabase Root 2021 CA` validated against the pinned root alone, not the system store. No
   bytes were sent beyond the SSLRequest and handshake. This also established that port 5432
   serves the PostgreSQL TLS upgrade, which the Management API pooler entry had not shown.
4. **Stage 2 fresh preflight 12/12 PASS.** A new preflight ran immediately before the
   transaction, inside the executor's 120-second freshness gate. Stage 1's earlier preflight
   was not reused.
5. **Migration 34 rollback-only idempotency verification: 0 revocations.** The server reported
   `0 API-role table and sequence privileges revoked` across all 53 public tables, and
   `platform profile exact (48)`.
6. **Authenticated session and identity binding PASS.** The session was bound to the
   API-verified instance fingerprint before any migration statement ran, under
   `sslmode=verify-full` with `gssencmode=disable` and the hash-pinned root. The password
   reached libpq only through a one-use, owner-only password file, never as an argument,
   environment variable or evidence value.
7. **Security checks 15/15 PASS** inside the transaction, with no server error.
8. **Before/after snapshots identical** except capture-time metadata: snapshot diff empty,
   preflight captures equal including observational values, evaluator verdicts byte-identical,
   and the post-run history capture equal to the pre-run one.
9. **Stage 2 evidence integrity 26/26 PASS.** Every file in the run manifest verifies; no file
   is unlisted; no credential-shaped string appears anywhere in the evidence.
10. **Independent Stage 2 Codex review PASS.**

Milestones 2 to 9 were re-verified locally against the generated artifacts on 2026-10-18,
independently of the terminal summaries. Milestone 1 rests on the sealed 2026-10-16 package.
Milestone 10 is recorded as reported by the founder; it was not re-performed here.

## Evidence

Referenced in place and unmodified, outside the repository:

- `C:\Users\Imrul\.muthoy-h9-f12-exec\b8ca5d8-f12-e2-recheck\evidence\stage1-20261018T054407Z`
- `C:\Users\Imrul\.muthoy-h9-f12-exec\b8ca5d8-f12-e2-recheck\evidence\tls-retry-20261018T064207Z`
- `C:\Users\Imrul\.muthoy-h9-f12-exec\b8ca5d8-f12-e2-recheck\evidence\stage2-20261018T065806Z`

The original 52-file sealed migration-34 package and its five-file addendum remain unchanged.

## Retained findings

These are not resolved by this closure and must not be reported as resolved.

- The original 2026-10-16 E2 execution omitted the distinct fresh preflight the runbook
  requires before every hosted execution of Migration 34. That deviation remains
  **UNRESOLVED**. The original evidence for it is missing and cannot be reconstructed.
- Stage 2 is **NEW compensating evidence**. It demonstrates that the idempotency rerun is
  clean today; it does not retroactively correct the original execution.
- External forensic sealing of every receipt is **not claimed**. Integrity rests on local
  SHA-256 manifests produced on the same machine.
- The pooler TLS certificate is a **shared wildcard** for `*.pooler.supabase.com`. It
  authenticates the hostname, not the project's database tenancy.
- Project tenancy is instead supported by Stage 2's own binding evidence: Management API
  identity verification and the in-session instance fingerprint guard, which aborts before any
  migration statement if the session is not the verified instance.
- No certificate revocation checking is performed, and the pinned CA's provenance is
  founder-confirmed rather than independently attested.

## Explicitly NOT closed

Overall H-9; G2; DEV rollout; PROD environment; EAS builds; H-11 restore rehearsal; Wave 2;
and overall release readiness. Each remains open and requires its own separate approval and
evidence.
