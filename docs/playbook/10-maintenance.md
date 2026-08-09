# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 10 — Maintenance & Future Direction

## VERSIONING
Semantic versioning continues past 1.0.0 per Volume 1's rule. Every release
logged in DECISIONS.md with what changed and why.

## MIGRATION
Ongoing schema changes always via Volume 6's Migration Prompt — new migration
files, tested against realistic populated data before shipping, never a hand
edit of history.

## SCALING
Per muthoy-system-design.md §4: the mobile app scales for free (each phone only
ever touches its own local data). Cloud-side attention points as shop count
grows: Postgres read replicas / partitioning of high-volume tables past
~10,000-shop scale, sync Edge Function batch tuning, admin dashboard queries
moved to materialized views rather than live aggregation.

## PERFORMANCE MONITORING
Sentry + PostHog stay on permanently, not just through beta. Watch for
performance regressions introduced by new features the same way Volume 7's
Performance Testing caught them originally.

## SECURITY UPDATES
Dependency updates on a regular cadence (not left to accumulate); any Supabase/
Expo SDK security advisory triaged immediately given the app holds real
financial data; PIN hashing and RLS policies re-audited whenever a related
library updates.

## NEW FEATURES
Every new feature still goes through Volume 1's Definition of Done and Volume 6's
prompt patterns — the discipline doesn't relax once in production. A live
pharmacy's data is at stake on every change, not a demo's.

## AI WORKFLOW (ongoing)
The same PM/AI-developer loop from Volume 0 continues indefinitely: full context
(CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md, kept current) → one task at a time → plan → approve → build
→ test on device → commit → review with "does this follow CLAUDE.md, PROJECT_CONTEXT.md, TECH_STACK.md, and DEVELOPMENT_RULES.md?"

## FUTURE SaaS DIRECTION
Once the core POS is proven at scale, natural extensions (in rough order of
likely value, not commitments):
- **Multi-tenant refinements** — the architecture already supports many shops
  per owner and full isolation; formalizing organization-level features
  (multi-owner businesses, franchise-style grouping) if demand appears.
- **Web portal** — a lightweight browser view of reports/inventory for owners
  who want to check their shop from a desktop, reading the same Supabase data
  the admin panel already reads (read-only, mobile stays the system of record).
- **Vendor/supplier portal** — letting suppliers see their own purchase/payable
  history with a given pharmacy, reducing phone-call reconciliation.
- **Public API** — only once there's real external demand (e.g. an accounting
  integration a pharmacy wants) — a deliberately scoped, authenticated API
  surface over the existing Supabase schema, not a rewrite.

## LONG-TERM ROADMAP (directional, not a commitment)
```
Now → 15-day Beta sprint: offline core + Supabase/RLS/sync + Basic Admin (Volume 0)
Immediately post-beta (P1) → sync delta-merge, OCR/Barcode, notifications,
  full supplier/purchase system, full staff permission matrix, payments/
  subscriptions, full admin panel (see Volume 0's P1 list for the complete set)
10-50 pilot pharmacies → prove retention/reliability (Volume 9) — begin once
  the P1 sync delta-merge has shipped, per the multi-device risk note
500 pharmacies → Play Store staged public rollout
iOS → same Expo codebase, fast-follow once Android is stable
5,000-10,000 shops → revisit cloud scaling watchpoints (this volume, Scaling)
100,000 shops → the platform this whole playbook was designed to reach
```
The discipline that gets you from here to there is the same one stated in
Volume 1: never assign the next unit of work until the current one passes its
criteria on a real device. That rule scales from Day 1 to shop 100,000 without
changing.
