# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 1 — Project Foundation & Engineering Standards (Overview)

**This volume is a readable overview of the project's foundation. The four
root docs — CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and
DEVELOPMENT_RULES.md — remain the canonical, detailed, source-of-truth
documents. When this overview and a root doc ever seem to disagree, the root
doc is correct; treat that as a signal to update this overview, not the other
way around.**

---

## BUSINESS VISION
Muthoy becomes the default point-of-sale for small independent pharmacies
across Bangladesh — starting with 10-50 pilot shops after Beta, scaling toward
100,000. The business wins by making an owner's daily operations measurably
easier from day one, earning trust before earning money (14-day full-access
trial, a P1 feature — see TECH_STACK.md and Volume 0's scope lock).

## PRODUCT VISION
A Bangla-first, offline-first pharmacy POS that works perfectly with zero
internet AND backs up safely to the cloud, tracks stock by expiry (FEFO),
tells the owner exactly how much cash should be in the drawer, and never
loses a sale — even on a shared, low-end Android phone.

## MISSION
Replace the paper notebook. Make the owner's life measurably easier within
the first day of use.

## TARGET USERS
- **Primary — Ruhin (42), pharmacy owner.** Samsung Galaxy A14-class phone,
  limited data, sometimes no signal. Wants to know: what's in stock, what's
  about to expire, how much cash should be in the drawer, who owes him money.
- **Secondary — Arif, counter staff.** Uses the phone to sell and look up
  stock; should never see owner-only financial data unless explicitly
  permitted.
- **Tertiary — the founder**, via the Basic Admin Panel (built in Beta, P0)
  and its fuller version (P1).

## GOALS
- Time-to-first-sale under 5 minutes, unaided.
- Daily-summary-view usage above 75% of active shops.
- 30-day retention above 40%.
- Zero data loss, ever — offline or during sync.
- One shop can never see another's data (proven via RLS, not assumed).

## NON-GOALS (explicitly out of scope for Beta and near-term)
- Multi-country support (Bangladesh only).
- A full ERP / accounting suite (POS + inventory + basic P&L only).
- iOS in the 15-day Beta sprint (Android first; iOS is a same-codebase
  fast-follow).
- Real-time multi-device collaboration within a single sale.
- Anything on Volume 0's P1/P2 lists during the 15-day Beta window — see that
  list for the authoritative, current cut line.

## ENGINEERING PHILOSOPHY

### Offline-First Philosophy
SQLite on the phone is the ONLY source of truth for a shop's own screens. The
cloud is backup + multi-device sync + the admin's window — never the live
data source. A screen that calls the network to decide what to show is a bug.
Beta ships BOTH the offline core and the cloud sync layer — offline-first
means SQLite is authoritative, not that the cloud is optional forever.

### Mobile-First
Design and build for a 2GB-RAM, 360dp-width Android phone first. If it's not
fast and legible there, it's not done.

### AI-First Development
The founder is the Project Manager; AI is the developer — across three tools
with distinct roles (full definitions in CLAUDE.md / Volume 2):
- **Cursor Pro** — primary IDE: code navigation, editing, debugging, local
  development, day-to-day AI-assisted implementation.
- **Claude Code** — terminal/agent-based: repository-wide tasks,
  architecture-aware coding, refactoring, testing, automation (schema
  rollout, RLS, the sync engine — see Volume 0's Days 2, 12, 13).
- **Claude Chat** — planning, architecture, documentation, prompt generation,
  daily development guidance (used every morning to plan the day ahead).
Every task follows: give full context → assign one phase/day at a time →
require a plan before code → review by running it, not by reading it → verify
against acceptance criteria before moving on.

## CODING STANDARDS (full detail in DEVELOPMENT_RULES.md)
TypeScript strict mode; Zod validation at every input boundary; business logic
in pure, framework-free functions; no hardcoded font strings/colors/magic
numbers; no direct network calls from screen components.

## NAMING STANDARDS (full detail in DEVELOPMENT_RULES.md)
`PascalCase.tsx` components, `camelCase.ts` utilities; `snake_case` DB
columns; kebab-case route files; `is_`/`has_`/`requires_` boolean prefixes;
`handleX`/`onX` for handlers/props.

## FOLDER / FILE STANDARDS (full detail in DEVELOPMENT_RULES.md and Volume 2)
`apps/mobile`, `apps/admin`, `apps/prototype-web` (reference-only — see the
Prototype Rule below), `backend/supabase`, `packages/{ui,types,utils,
validation,constants,config}`. One component per file. Domain logic files
group by concept, not by calling screen.

## DOCUMENTATION STANDARDS (full detail in DEVELOPMENT_RULES.md)
The four root docs are read every session. `DECISIONS.md` logs every real
decision, dated, with a why. Non-obvious business rules get a one-line
comment at their definition.

## GIT (full detail in DEVELOPMENT_RULES.md)
Conventional commits, one logical change per commit, `.env` never committed.
`main` always installable; `dev` is the daily integration branch during Beta.

## DEFINITION OF DONE (full detail in DEVELOPMENT_RULES.md)
A feature is done only when it matches its spec, has been tested on a real
device offline, its Validation Checklist passes, money/stock logic has a
passing test, it's committed with a clear message, and any new decision is
logged. "AI said it works" is never done on its own.

## HUMAN REVIEW WORKFLOW (full detail in CLAUDE.md)
Since the founder cannot read code, review happens by running the feature
against its checklist, asking the AI to explain what it built and why in
plain English, asking what assumptions/risks exist, and asking after every
session: "Does this follow CLAUDE.md / PROJECT_CONTEXT.md / TECH_STACK.md /
DEVELOPMENT_RULES.md? Where might it not?" — the single most important
recurring question in this project.

## THE PROTOTYPE RULE (full detail in Volume 2 and apps/prototype-web/README.md)
`apps/prototype-web` is reference-only. Use it for UI/UX, screen layouts,
navigation, visual hierarchy, components, and interaction patterns. Do NOT
copy its React Web architecture, CSS, business logic, state management, or
data layer into React Native — those get rebuilt fresh, correctly, native.
