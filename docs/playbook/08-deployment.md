# MUTHOY POS — AI ENGINEERING PLAYBOOK
## VOLUME 8 — Deployment

## GITHUB ACTIONS
CI on every PR/push to `dev`: lint, typecheck, run the unit test suite. Merge to
`main` triggers the release workflow (EAS build for mobile, Vercel deploy for
admin once it exists).

## EXPO EAS
`eas.json` profiles: `development` (Day 1's dev client), `internal`
(Day 15's pilot build, and ongoing internal testing), `production` (Play Store
submissions). Staged rollout (10% → 50% → 100%) for every production release —
never 100% on day one.

## VERCEL
Admin panel — Basic version (P0, Day 14) auto-deployed from `main`; Full
version (P1) follows the same pipeline post-beta. Environment variables
(including the Supabase service-role key) set in Vercel's project settings —
never committed to the repo.

## SUPABASE
Migrations applied via the Supabase CLI from `supabase/migrations/`, in order,
never hand-edited after being applied to a real environment. Separate
dev/staging/production Supabase projects recommended once real pharmacy data
exists — never test against the production project directly.

## ENVIRONMENT VARIABLES
`.env.example` in the repo with placeholder keys; real `.env` files gitignored.
Mobile: Supabase URL/anon key (public-safe), Sentry DSN, PostHog key. Admin:
the above PLUS the service-role key (server-only, Vercel env var, never in a
client-bundled file).

## PRODUCTION SECRETS
Service-role key, payment provider (SSLCommerz/bKash) API credentials, and the
payment webhook's signing secret — all stored in Supabase/Vercel's secret
management, never in git history, ever (including old commits — if one leaks,
rotate it immediately rather than just removing it going forward).

## MONITORING
Sentry wired from early (Volume 0 mentions adding it during the Day 15
hardening pass at the latest) — crash reports flowing before real pharmacies
ever touch the app.

## CRASH REPORTS
Sentry dashboards checked after every release, especially the first 24-48 hours
of a staged rollout — that's when a bad release shows itself.

## ANALYTICS
PostHog events: registration completed, first sale made, daily-summary viewed,
scan used (P1, once OCR/Barcode ships), sync completed/failed (P0, Day 13
onward). These map directly to the product
goals in Volume 1 (time-to-first-sale, daily-summary usage, retention).

## RELEASE WORKFLOW
```
1. Feature complete + tested on real device (per its Volume 0/6 checklist)
2. Merge to dev -> CI passes
3. Merge to main -> version bump (Volume 1's rule) -> EAS build
4. Install and test the actual build artifact yourself, not just the dev server
5. Staged rollout 10% -> monitor Sentry/PostHog 24-48h -> 50% -> 100%
6. Log the release in DECISIONS.md
```
