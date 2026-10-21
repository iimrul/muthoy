# W5-15 — DEV credential exposure assessment (sanitized)

**Task:** investigate the reported partial DEV service-role key exposure.
**Date:** 2026-10-20 (Batch 1, Gate 3)
**Baseline:** `origin/main` @ `354fa2a`, repository **PUBLIC** (`github.com/iimrul/muthoy`)
**Verdict:** **NO EXPOSURE FOUND.** No DEV service-role key material — whole or
partial — is present in the tracked working tree or in the public commit
history.
**Rotation:** **NOT PERFORMED.** It requires separate founder authorization, and
this assessment does not recommend it (see §5).

> **No secret material appears in this document.** Every finding is reported as
> a location, a length, a shape, or a decoded *role claim* — never a value. The
> scanners were kept in the session scratchpad and are deliberately **not**
> committed, so this file does not hand a future reader a tool for extracting
> what it just cleared.

---

## 1. What was searched, and how

Four passes, each reporting metadata only.

| Pass | Scope | Method |
|---|---|---|
| A | every tracked file (`git ls-files`) | regex for JWT-shaped (`eyJ…`) and `sb_secret_` / `sb_publishable_` strings; output limited to file, line, length, segment count |
| B | the full public history | `git log -S` pickaxe on `sb_secret_`, `eyJ`, and the real Supabase JWT header `eyJhbGciOiJIUzI1NiI`, then per-revision inspection of each hit with the token redacted |
| C | partial/truncated fragments a shape scan would miss | every tracked text file, for a high-entropy run of ≥12 base64url characters within 120 characters of a credential keyword (`service_role`, `secret`, `api_key`, `token`, `password`, …), filtered by Shannon entropy ≥3.3 and mixed case |
| D | the published surface | read `apps/admin`'s credential model, `apps/mobile/config/environmentPolicy.js`, and `tests/eas-archive.test.ts`'s secret-material refusal |

Pass C is the one that answers the *"partial"* in the report: a four- or
eight-character prefix of a real key would not match any credential-shaped
regex, so it had to be hunted by entropy and proximity instead.

---

## 2. Findings

### Pass A — 6 hits, all fabricated fixtures

| Location | Shape | Classification |
|---|---|---|
| `apps/mobile/db/environment-binding.test.ts:46` | `sb_publishable_`, 44 chars | fabricated — sits beside a `legacy` token built in-line from `e30.` (base64url of `{}`) with the literal suffix `fabricated` |
| `apps/mobile/tests/eas-archive.test.ts:157,158` | `sb_secret_`, 37 chars ×2 | fabricated — the **fixtures for the archive scanner's own refusal test**, deliberately planted in utf8 and utf16le to prove both are caught |
| `apps/mobile/tests/eas-archive.test.ts:166` | `sb_secret_`, 20 chars | the assertion that the refusal message does **not** echo the planted value |
| `apps/mobile/tests/environment-policy.test.ts:71` | `sb_secret_`, 41 chars | fabricated — a member of an "invalid public key is refused" table alongside `''`, `' '` and `'invalid'` |
| `apps/mobile/tests/environment-policy.test.ts:76` | `sb_publishable_`, 46 chars | fabricated — proves a publishable key still needs independent fingerprint approval |

Every one is synthetic by construction: the JWT-shaped neighbours are assembled
at runtime as `e30.<base64url payload>.fabricated` / `.fake`, and the
`sb_`-shaped strings are test inputs whose purpose is to be **rejected**.

### Pass B — 3 commits touch the real JWT header, none carries a key

`git log -S'eyJhbGciOiJIUzI1NiI'` returns `a407c83`, `8d4c503`, `c295559`.
Resolved:

- `.claude/skills/api-design/SKILL.md` (and its `.agents` mirror) — a
  **base64 pagination-cursor example** in a REST-design document. 14 characters,
  one segment, not a token.
- `apps/mobile/sync/supabaseConfig.test.ts` @ `8d4c503` — a constant explicitly
  named `FAKE_KEY`, whose second segment is the literal `demo-not-a-real-key`.

A decoder was run over every JWT-shaped string in those revisions, reporting the
`role` and `ref` claims only. **No token decoded to `role: service_role`**, and
none carried the DEV project ref.

### Pass C — 137 candidates, zero credentials

All 137 resolve to identifiers: SQL function names (`b4_apply_verified_payment`,
`h7_actor_binding_staff_reactivation`, `a23_assert_device_admin`), migration
filenames, PowerShell script names, and two 64-character hex strings that are
**SHA-256 content hashes** — one in `scripts/h9/install-local-runtime.ps1:18`
(the content-addressed runtime pin) and one in
`docs/plans/h9-local-codex-review-2026-10-18.md:106`. Neither is a credential.

### Pass D — the published surface holds

- **`apps/admin`**: four independent mechanisms, all verified present —
  `lib/env.ts` is the only module naming `SUPABASE_SERVICE_ROLE_KEY` and the
  variable is deliberately **not** `NEXT_PUBLIC_`-prefixed; `lib/env.ts`,
  `lib/supabaseAdmin.ts` and `lib/queries.ts` each open with
  `import 'server-only'`; **zero** `'use client'` files exist in the app; and
  `lib/errors.ts` sanitizes failures so a Postgres error cannot carry schema or
  connection detail into a page. `lib/serviceRoleExposure.test.ts` asserts the
  first three on every test run.
- **`apps/mobile/config/environmentPolicy.js`**: contains a SHA-256
  **fingerprint** of the anon/publishable key and the DEV project ref. A
  fingerprint is not a key, and the project ref is a public identifier present
  in any app build. Production's `supabaseProjectRef` and `publicKeySha256` are
  deliberately `null`/`[]` — it fails closed until approved.
- **`tests/eas-archive.test.ts`**: refuses an archive containing secret material
  with reason `archive-secret-material`, and asserts the refusal message does
  not echo what it found.

---

## 3. What the report most likely referred to

The phrase "partial DEV service-role key exposure" is consistent with
**GitHub push protection firing on the fabricated fixtures in §2** rather than
with a real leak. That mechanism is already known to be active for this remote
and to block `sb_secret_`-shaped strings *even when the string is invented for a
test that exists to reject it*. A push blocked by that scanner reads like an
exposure report and is not one.

This is a defensible interpretation, **not a confirmed root cause**: the
assessment was given the symptom, not the alert. If an actual provider or GitHub
alert exists, its identifier would let this be closed conclusively rather than
inferentially — that is the one piece of evidence §5 asks for.

---

## 4. Residual risk

| Risk | Status |
|---|---|
| Real DEV service-role key in the tracked tree | **Not found** (passes A, C) |
| Real DEV service-role key in public history | **Not found** (pass B) |
| Truncated/partial key fragment | **Not found** (pass C, entropy + proximity) |
| Key reachable from a shipped client bundle | **Not possible by construction** (pass D: `server-only`, no client components, not `NEXT_PUBLIC_`) |
| Key inside an EAS archive | **Refused by test** (`archive-secret-material`) |
| Untracked local files (`.env`, `%USERPROFILE%\.muthoy-secrets\`, the protected H-9 runtime) | **Out of scope, and correctly so** — they are not published. Not inspected, not altered |
| A key exposed somewhere this repository cannot see (a chat log, a screenshot, a CI log, a third-party service) | **UNVERIFIABLE from here.** This assessment covers the repository and its history only, and says nothing about exposure outside it |

That last row is the honest limit of this work.

---

## 5. Recommendation

**Do not rotate on the strength of this assessment.** Nothing found here is a
real credential, and a rotation carries its own risk: the DEV project ref is
pinned in `environmentPolicy.js`, the anon-key fingerprint is approved by hash,
and H-9's hosted evidence references the current configuration.

Two actions worth taking, neither of which is a rotation:

1. **Close the loop on the original report.** If a GitHub push-protection alert
   or a provider notification exists, its identifier would turn §3's inference
   into a conclusion. Without it the report cannot be fully retired.
2. **If the founder has independent reason to believe a key was exposed outside
   this repository** — pasted into a chat, captured in a screenshot, read from a
   CI log — then rotate, because §4's last row means this assessment cannot
   clear that. Rotation remains a separately authorized action.

---

## 6. Method integrity

- No secret value was printed to the session, written to a file, or committed.
- The three scanners live only in the session scratchpad and are **not** added
  to the repository.
- Redaction was applied at the point of output, not after: the context printer
  substituted `<REDACTED:len>` for every match before emitting a line.
- The two 64-character hex strings in §2 were identified as content hashes by
  their role in the surrounding tooling, never by comparison against a secret.
