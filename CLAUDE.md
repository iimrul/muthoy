# CLAUDE.md — AI Operating Rules for Muthoy POS
### Read this every session, alongside PROJECT_CONTEXT.md, TECH_STACK.md, and
### DEVELOPMENT_RULES.md. This file holds the non-negotiable rules only.

```
1. SQLite is the only source of truth for the mobile app's own screens. Never
   call Supabase directly from a screen or component.
2. Every foreign key needs an explicit onDelete policy — never leave it default.
3. FEFO sorts by real expiryDate, never a stored day-count. Recompute at read time.
4. Cash formula is fixed (see Volume 3) — never approximate or re-derive it.
5. Opening cash defaults to 0, set by the user, resets at midnight. Never inherit
   yesterday's value.
6. Money uses the DM Mono font variable; every other number uses Plus Jakarta
   Sans. Never hardcode a font string.
7. A new owner registering on the same device must NEVER see a previous owner's
   data. Every shop has a unique, non-hardcoded id.
8. PINs are bcrypt-hashed, never logged or stored in plain text.
9. No seed/demo data ships — every fresh shop starts empty.
10. Before writing code for anything touching the database, sync, or money:
    propose a plan and wait for explicit approval.
11. If a suggestion would contradict this document, say so explicitly rather than
    silently doing something different.
12. BETA = offline AND online, both, per Volume 0's Beta Definition: SQLite
    offline-first, Sync Queue, Supabase, RLS, cloud backup, and a Basic Admin
    Panel all ship within the 15-day sprint. Never treat sync/RLS/admin as
    "later" without checking Volume 0 first — they are P0.
13. Obey the P0/P1/P2 scope lock (Volume 0) strictly. If a request during the
    15-day sprint isn't P0, say so explicitly and defer it — do not quietly
    build it "since it's quick." Scope creep is the primary risk to Beta.
14. Use the right AI tool for the task (full definitions in Volume 2): Cursor
    Pro for day-to-day interactive implementation; Claude Code for repo-wide,
    architecture-aware tasks (schema, RLS, the sync engine); Claude Chat for
    planning, docs, and prompt-crafting. Never substitute one for another by
    default — match the tool to the task's shape.
15. apps/prototype-web is reference-only. Use it for UI/UX, layouts,
    navigation, visual hierarchy, components, and interaction patterns. NEVER
    copy its React Web architecture, CSS, business logic, state management,
    or data layer into React Native.
```


## HUMAN REVIEW WORKFLOW
Since the founder cannot read code, review happens by:
1. Running the feature on a real device against its Validation Checklist.
2. Asking Cursor: "Explain what you built and why, in plain English."
3. Asking Cursor: "What are the risks or assumptions in what you just built?"
4. Asking, after every session: "Does this follow CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md? Where might
   it not?" — the single most important recurring question in this whole project.
5. For anything touching money/stock: demanding to see the test pass, not just
   being told it passes.
