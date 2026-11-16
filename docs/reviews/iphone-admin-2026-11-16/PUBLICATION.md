# GitHub publication scope

User requested a repair summary and GitHub push on 16 November 2026.

Repair plan, not implemented:

1. Prepare a minimal forward DEV database compatibility repair for the six
   missing Admin tables, publication RPC and required privileges. Preserve the
   already-applied Staff sale repair; prove authorization and migration order.
2. Repair printer line/feed encoding and prevent automatic resend after uncertain
   delivery. Validate real BLE output on both platforms.
3. Complete all 51 route/feature checks on real iPhone and Android builds, then
   real database-backed Admin workflows and mobile Safari.

Database, printer, auth/security and sync implementation remain subject to the
approval gate in `AGENTS.md`. This push does not approve or perform them.

Publication contains the Admin presentation refresh and review evidence, plus
the existing pharmacy audit link/test and synthetic verification helpers required
by the included acceptance commands. Only the 16 November presentation decision
is staged from `DECISIONS.md`; older unrelated working-directory entries remain
local. Mobile/backend implementations and dependency upgrades remain local.

Historical audit receipts describe the integrated working directory. They are
not an exact-tree acceptance claim for this scoped publication. Native builds,
real devices, hosted Admin workflows and deployment remain unverified. No merge
to `main` or deployment is requested by this publication.

Branch: `feature/admin-responsive-platform-review`; base: `a23ca61`.

Publication checks actually run:

- `python .../run_verification.py admin-recheck --installed-cli`: 175 tests PASS
  against the isolated staged source, using existing installed dependencies.
- `python .../run_verification.py admin-build --installed-cli`: completed with
  exit 0; compiled, checked TypeScript and generated the route output. Its ESLint
  step could not resolve `eslint-plugin-react-hooks` through the reused dependency
  junctions, so this is not a snapshot lint PASS. The original integrated-workspace
  lint result remains historical, not substituted for this check.
- `python .../run_verification.py guard-check`: six controls PASS after correcting
  the runner's helper path.
- Original 14 Admin source hashes and all 21 original raw-log hashes verified.
- Python script syntax, staged-file scope, secret-pattern scan and preservation
  hashes for 382 pre-existing files checked. Scoped whitespace check passed.

The isolated source reuses installed Next 15.5.29 and workspace dependency
junctions. The scoped branch retains its existing Next 15.5.23 declaration and
lockfile; a clean install against that lockfile was not run. No dependency upgrade
is included. Synthetic environment and offline Arial font substitutions were used.
Nested snapshot root-inference warnings are retained in the build log.

Initial pnpm attempts were refused by the existing database guard before test
execution. Direct installed CLI attempts first hit sandbox `spawn EPERM`; permitted
local subprocess retries ran the actual checks. The first direct build started
outside the Admin directory and missed Tailwind configuration. The runner now
uses the Admin working directory for that command. No application source, test
assertions or safety guard was relaxed to address these runner failures.

See `PUBLICATION_RESULTS.json` for all eight new command receipts and verified
raw-log hashes. `evidence/publication-admin-source.json` identifies the 18 staged
Admin source/test/helper blobs independently of unrelated local work.
