# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 5 — Admin Panel
### Basic Admin Panel (below, marked P0) is built Day 14, WITHIN the 15-day
### Beta sprint — per the Beta Definition in Volume 0, a basic admin panel is
### Beta-critical, not post-beta. Full Admin (marked P1) follows immediately
### after Beta.

---

## BASIC ADMIN PANEL — P0, built Day 14

Exactly two pages, deliberately minimal, both reading Supabase via the
service-role key server-side only:

### Pharmacy List (P0)
A read-only table: shop name, phone, registration date, plan. Searchable is a
nice-to-have, not required for Beta — a plain list is sufficient.

### Simple Dashboard (P0)
Total shops registered, total sales made today across all shops. Two numbers.
No charts, no time-series, no drill-down yet.

**That is the entire P0 scope for Volume 5.** Everything below this line is P1.

---

## FULL ADMIN PANEL — P1, built immediately after Beta

## DASHBOARD (P1 — expanded)
Landing page grows from the P0 two-number view into: active-today count, MRR,
trial-vs-paid split, recent signups. High-level, glanceable, no deep
drill-down here either — that's PHARMACY MANAGEMENT's job.

## ANALYTICS (P1)
Time-series: new signups, daily active shops, sales volume across the platform
(aggregated, never per-shop financial detail unless drilled into one shop).

## PHARMACY MANAGEMENT (P1 — expanded from the P0 list)
Searchable/filterable list (by district, plan, activity level). Row click →
per-shop drill-down: profile, plan/subscription status, location on the map,
recent activity, support notes.

## USERS (P1)
Platform-level: the founder's own admin accounts (not shop staff — that's
managed on the phone). Role-gated if more than one admin user exists later.

## SUBSCRIPTION (P1 — depends on the Subscription/billing feature itself, P1)
List by status (trialing/active/past_due/grace/canceled/expired), due-soon view
via `next_billing_at`, manual override actions (extend trial, force a status
change) — reads/writes `subscriptions` directly via the service-role key.

## AUDIT LOGS (P1)
A read-only view into each shop's `audit_logs` (support/debugging use only —
never edit or delete from here, matching the append-only DB policy).

## REVENUE (P1)
MRR trend, plan-tier breakdown, churn rate — computed from `subscriptions`
history, charted with Recharts.

## CHARTS (P1)
Recharts for all standard time-series/bar/pie visualizations (revenue, signups,
plan distribution). Kept separate from the map (see below) since they're a
different kind of visualization with a different library.

## MAPS (P1)
Leaflet, plotting shops by `(latitude, longitude)` captured on-device during
onboarding. Marker color = plan tier. Click → drill-down into that shop.

## REPORTS (P1)
Exportable platform-level summaries (CSV/PDF) for the founder's own review —
distinct from the per-shop reports the mobile app already generates for owners.

## ROLE MANAGEMENT (P1)
If/when more than one person administers the platform: simple role gating
(super-admin vs support-read-only) on the admin app's own auth, separate from
the pharmacy-side roles (Owner/Manager/Staff) defined in Volume 3.

## SETTINGS (P1)
Admin-panel-level configuration: notification templates for admin-pushed
notices, feature flags for gradual rollouts, environment/deployment info.

---

## THE ONE RULE THAT GOVERNS ALL OF VOLUME 5, P0 AND P1 ALIKE
Every page above reads/writes Supabase via the service-role key in **server-side
code only** (Next.js server components or API routes). The browser bundle must
never contain that key. Verify this explicitly (check devtools' network tab)
before considering ANY admin feature done — this is a hard-spot verification,
not a formality, and it applies exactly as strictly to the two-page P0 version
as to the full P1 build-out.
