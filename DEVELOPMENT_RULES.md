# DEVELOPMENT_RULES.md — Muthoy POS
### How code gets written. Read alongside CLAUDE.md, PROJECT_CONTEXT.md, and
### TECH_STACK.md.

- TypeScript strict mode, no `any` without a written justification comment.
- Every input boundary (forms, scanned data) validated with Zod before it reaches
  domain logic.
- Business logic (FEFO, cash formula, permissions) lives in pure, framework-free
  functions — testable without rendering a screen.
- No inline hardcoded font strings, hex colors, or magic numbers for money/stock
  thresholds — use the design-token variables and named constants.
- No direct network calls from screen components — data flows through the layers
  defined in Volume 2.

## NAMING STANDARDS
- Files: `PascalCase.tsx` for components, `camelCase.ts` for utilities/hooks.
- Database columns: `snake_case` (Postgres/SQLite convention); Drizzle/TS fields:
  `camelCase` (mapped automatically).
- Route files (Expo Router): lowercase, kebab-case where multi-word
  (`add-medicine.tsx`).
- Boolean variables/columns: `is_` / `has_` / `requires_` prefix
  (`is_deleted`, `requires_prescription`).
- Event/handler functions: `handleX` for local UI handlers, `onX` for props.

## FOLDER STANDARDS
See Volume 2 for the full monorepo layout. Top-level rule: `apps/mobile`,
`apps/admin`, `apps/prototype-web` (reference-only, never imported), and
`packages/ui` / `packages/types` / `packages/utils` / `packages/validation` /
`packages/constants` / `packages/config` for anything shared. Never duplicate a
type, a Zod schema, or a business-logic constant between mobile and admin — it
lives in the matching `packages/*` folder once.

## FILE STANDARDS
- One component per file, named to match its default export.
- Domain logic files group by concept (`fefo.ts`, `cashFormula.ts`,
  `permissions.ts`), not by which screen calls them.
- Migration files are never edited after being committed — a schema change is
  always a NEW migration.

## DOCUMENTATION STANDARDS
Four root files, always loaded by Cursor at the start of every session:
- `CLAUDE.md` — AI-specific rules (the "Claude Rules / AI Rules" list below).
- `PROJECT_CONTEXT.md` — this volume's Business Vision through Non-Goals sections.
- `TECH_STACK.md` — the locked stack (see Volume 4's per-feature list, and the
  earlier TECH_STACK content this project already finalized).
- `DEVELOPMENT_RULES.md` — this volume's Coding Standards through Definition of
  Done sections.
Plus:
- `DECISIONS.md` — a running log of real decisions made during the build (a new
  entry per meaningful choice), so context survives across sessions and across
  switching AI tools.
- `docs/playbook/` — Volumes 0-10 in full, referenced by day/feature but not
  auto-loaded every session (too large for that; the four root files are the
  distilled always-on context).
- Every non-obvious business rule gets a one-line comment at its definition
  (e.g., why opening cash defaults to 0, why batch uniqueness matters).

## GIT STANDARDS
- Conventional commits: `feat(scope): description`, `fix(scope): description`,
  `chore(scope): description`, `test(scope): description`.
- One logical change per commit; Cursor commits after each working sub-feature,
  not once at the end of a day.
- Never commit `.env` files or secrets — use `.env.example` with placeholder keys.

## BRANCH STRATEGY
- `main` — always deployable/installable.
- `dev` — daily integration branch during the 15-day sprint (merge to `main` at
  each milestone: end of Day 3, 7, 11, 15).
- Feature branches optional during the solo sprint; required once sync/admin work
  begins once P1 work starts post-beta (`feature/sync-delta-merge`,
  `feature/admin-full-dashboard`). During the 15-day Beta sprint itself,
  `dev` is sufficient even for sync/RLS/admin work, since it all ships
  together as one Beta milestone.

## COMMIT STRATEGY
Small, frequent, working commits. A commit that doesn't compile or doesn't pass
the existing tests should never happen — ask Cursor to confirm both before
committing.

## VERSIONING
Semantic versioning from `0.1.0` (Day 1) toward `1.0.0` (public Play Store launch).
Each Play Store submission bumps at least the patch version; OTA-only JS fixes
bump the OTA runtime version per Expo's convention, not necessarily the app version.

## DEFINITION OF DONE
A feature is DONE when, and only when:
1. It matches its Volume 3/4/5 specification (or the day's prompt in Volume 0).
2. It has been tested on a real Android device, offline.
3. Its Validation Checklist (Volume 0 format) passes.
4. Money/stock-affecting logic has a passing unit test.
5. It has been committed with a conventional-commit message.
6. Any new decision is logged in `DECISIONS.md`.
"Looks right in the emulator" is NOT done. "AI said it works" is NOT done.

## ENGINEERING CHECKLIST (apply before ending any work session)
```
[ ] Does this follow CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md? Ask Cursor directly, read its answer.
[ ] Does it compile / pass lint with zero errors?
[ ] Did I test it on a real device, not just the simulator?
[ ] Is anything touching money or stock covered by a test?
[ ] Did I commit with a clear message?
[ ] Did I log any new decision in DECISIONS.md?
```


## PROJECT INITIALIZATION
Day 1 of Volume 0 is the canonical initialization sequence. Do not skip its order:
Expo+TS+Router → NativeWind/brand tokens → folder structure → git → EAS dev build.
Nothing else gets built before this exists and runs on a real phone.

