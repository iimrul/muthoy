# iPhone, Android and Admin verification — 16 November 2026

Scope: inspect every mobile route and native boundary; run current local checks;
compare Admin database dependencies with DEV catalog; refresh existing Admin UI.

Implementation: presentation only in `apps/admin/app/layout.tsx`,
`app/globals.css`, shared navigation and shared card/filter/table components.
Keep existing queries, effective permissions, actions, financial labels and
suppression behavior. Preserve pre-existing uncommitted work.

Risks: mobile hardware cannot be simulated by Node; Apple source tests cannot
establish Swift compilation, Keychain, SQLCipher or CoreBluetooth behavior.
Synthetic HTTP tests cannot establish hosted RLS, grants or database parity.
Database metadata is read-only. No migration, sync/security/business writer,
device installation, deployment or production-data change is authorized here.

Checks: full Vitest suite, hardware requirements, workspace typecheck/lint,
Admin production build with synthetic environment/offline verification fonts,
four-role HTTP matrices, responsive browser checks if available, diff review.
Record actual failures and skips. Never treat skipped checks as PASS.

Workflow: plan → implement → test → independent review → fix → verify.
Independent audit was attempted; worker had no tools. Use fresh self-review and
disclose this limitation. Protected fixes require a separate exact-file plan and
Founder approval under AGENTS.md Safety Gate before implementation.
