# AGENTS.md — Muthoy POS Shared AI Rules

Read before work:
- PROJECT_CONTEXT.md
- TECH_STACK.md
- DEVELOPMENT_RULES.md
- DECISIONS.md
- only the relevant Playbook/feature spec for the current task
- Output direct code patches or commands immediately.
- Respond like a caveman: extremely terse, no conversational filler, no explanations unless asked.

Repository docs are source of truth. Do not depend on previous chat context.

## Core Rules

1. SQLite is the mobile source of truth. Screens/components never access Supabase directly.
2. `db/` alone touches SQLite/Drizzle; `sync/` alone handles Supabase sync; `domain/` stays pure TS; `native/` wraps native modules.
3. Every FK needs explicit `onDelete`.
4. FEFO uses real expiry dates.
5. Money = INTEGER paisa. Never use floating-point money. Cash formula is fixed per Volume 3.
6. Opening cash defaults to 0 and never inherits yesterday's value.
7. Shop data must be isolated by unique shop ID. No cross-shop leakage.
8. PINs are bcrypt-hashed and never stored/logged plaintext.
9. No production seed/demo data.
10. `apps/prototype-web` is UI/UX reference only; never copy its web architecture/data/state layer.
11. Respect current P0/P1/P2 scope. Do not add scope silently.
12. Beta includes the approved offline + online architecture; check Volume 0 before deferring sync/RLS/admin.

## Safety Gate

Before MODIFYING database/schema/migrations, sync, Supabase/RLS, money,
stock/FEFO, auth/security, or destructive data operations:

PLAN → identify files/risk/tests → WAIT FOR USER APPROVAL → IMPLEMENT.

## Agent Workflow

Any capable agent may plan, implement, test, debug, review, or document.

When multiple agents are available:
PLAN → IMPLEMENT → TEST → INDEPENDENT REVIEW → FIX → VERIFY.

When one agent is available:
PLAN → IMPLEMENT → TEST → FRESH SELF-REVIEW → FIX → VERIFY.

Before editing, inspect current git status and relevant existing code.
Never overwrite unrelated/uncommitted work.

## Verification

Never claim PASS without running the check.

After meaningful work report only:
- Built
- Tests/commands actually run
- Risks/assumptions
- Manual validation still required
- Files changed
- Suggested commit

For money/stock/auth/sync/migrations/RLS, compilation alone is not proof.

## Communication

Extremely terse by default.
No conversational filler.
Do not explain obvious code unless asked.
Do not repeat the task back.
Do not paste unchanged code.
Prefer diffs, filenames, commands, and PASS/FAIL.