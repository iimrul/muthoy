# H9 deployment compatibility gate — deployed `sync` v26 vs repository — 2026-10-18

A separate gate, derived from the H1 capture. It is **not** part of A5 acceptance and
does not authorize any deployment. Nothing here is hosted attestation: the captured
bytes establish custody only.

## Evidence this gate is built on

| Item | Value |
|---|---|
| Project | DEV `btfprhticjgeihcngpif` (Muthoy Dev/Test), `ap-northeast-1`, PG `170006` |
| Instance fingerprint | `1ccbfe38fbca65d87281693735c6230f`, unchanged across both A5 captures |
| Captured deployments | `sync` v26 ACTIVE `verify_jwt=true`; `auth-send-sms` v6 ACTIVE `verify_jwt=false` |
| Capture | 37 files, digest `4a0287cc365bbfc5d3c1b88f1d70235eb4b61ab9e106fa62201f59999467594e` |
| Staging root | `C:\Users\Imrul\.muthoy-h9-dl\h1-20261018T1737Z\staging` |
| Repository side | working tree at HEAD `b8ca5d8c9538fd41605b09d5a9475e16ff496c3d` |

## `auth-send-sms` v6 — NO GATE

All 9 deployed files are byte-identical to the repository. The 5 repository-only files
are tests and a test fixture, which are not deployed. Redeploying `auth-send-sms` from
HEAD is a byte-level no-op; a rollback to v6 needs no source restoration.

## `sync` v26 — GATE REQUIRED

28 deployed files. 23 byte-identical, 5 differ, 0 deployed-only. 26 repository-only
files, of which 24 are tests (not deployed) and **2 are deployable**.

### G-1 Behavioural — key transport (BLOCKING)

- `_shared/supabaseAdmin.ts` — deployed v26 reads `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` from the environment directly and
  throws a generic message when any is missing. HEAD replaces that with
  `resolveSupabaseKeys()` and builds both clients from `keys.url` / `keys.adminKey` /
  `keys.publicKey`.
- `_shared/supabaseKeys.ts` — **repository-only, 156 lines, not deployed.** The H-9
  resolver: it decides the key generation, refuses an unknown mode, a malformed or
  wrong-prefix key, or a URL for any project other than `MUTHOY_SUPABASE_PROJECT_REF`,
  and it throws at module load.

Consequence: deploying HEAD `sync` changes the function's startup contract. It will
serve nothing unless the modern/legacy mode setting and the project-ref setting are
correct at deploy time. This is exactly what H7/H8 exist to stage, and it is the reason
H8's post-deploy rollback must set explicit `legacy` rather than unset the settings.

Carried risk (unchanged, still unproven hosted): supabase-js 2.112.3 omits the
key-as-bearer header **only on Functions** for `sb_` keys — REST, Storage and Auth
still send `Bearer <key>`, and Edge admin sends `Bearer sb_secret_…` in modern mode.
Hosted acceptance of that transport has not been demonstrated.

### G-2 Structural — router extraction (BLOCKING for rollback)

- `index.ts` — deployed v26 is the 140-line router importing 16 modules directly. HEAD
  is a 9-line shim whose only import is `./handler.ts`.
- `handler.ts` — **repository-only, 144 lines, not deployed.** It is the extracted
  router and the single call site of the device guard.

Consequence: a functional rollback to v26 must restore the 140-line monolithic
`index.ts` **and** remove `handler.ts`, not merely revert `index.ts`. Restoring only the
shim would leave `sync` importing a module that the rolled-back deployment does not
contain. The H1 capture holds the exact v26 `index.ts` bytes
(`91ed39474bb830867ed5ca9a59133d52d9774465f35b7eca854aee8ec786ac42`) for that purpose.

### G-3 Dependency pin (BLOCKING, and a finding against v26)

`_shared/auth.ts` and `_shared/supabaseAdmin.ts` move
`npm:@supabase/supabase-js@2` → `npm:@supabase/supabase-js@2.112.3`. The diff in
`auth.ts` is exactly that one line.

Finding: deployed v26 pins only the **major**. Its effective SDK is whatever `@2`
resolved to when v26 was bundled, which the capture does not record. So a rollback to
v26 re-floats the SDK and is not reproducible at the dependency level. Any rollback
regression must be run against the rolled-back deployment as it actually resolves, not
against an assumed version.

### G-4 Comment-only — NOT BLOCKING

- `deviceGuard.ts` — one comment line: call site named `index.ts` → `handler.ts`.
- `deviceRegistryPolicy.ts` — three JSDoc lines, same rename plus a test reference.

No executable change, no exported-symbol change. Verified: the 5 differing files have
**zero** differences in exported `function` / `const` / `class` / `interface` / `type`
names. The only public-surface movement in `sync` is the `index.ts` → `handler.ts`
extraction.

## Gate conditions

Before H9 deploys `sync` from HEAD:

1. G-1: the two H9 settings are at their intended values for the target mode, captured
   privately beforehand per H8; `resolveSupabaseKeys` refusal codes observed, not
   values.
2. G-2: the v26 `index.ts` bytes from this capture are the designated rollback source,
   and the rollback procedure removes `handler.ts`.
3. G-3: the rollback regression runs against the actually resolved SDK of the
   rolled-back deployment.
4. G-4: no action.
5. `auth-send-sms` redeploys before `sync`, per the H8 ordering.

This gate does not close: H1's hosted source-provenance review, the checkpoint
artifact (see the guard-fix stop report), or any approval in the H1–H14 table.
