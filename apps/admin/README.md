# apps/admin/

Next.js 15 admin panel — the **Basic Admin Panel** from Volume 0's Day 14 and
Volume 5's P0 scope. Exactly two pages, both read-only:

| Route         | Shows                                                      |
| ------------- | ---------------------------------------------------------- |
| `/`           | Total shops, total sales today (all shops, Asia/Dhaka day) |
| `/pharmacies` | Shop name, phone, registration date, plan                  |

Everything else in Volume 5 — analytics, charts, maps, subscription
management, audit logs, reports, role management — is **P1, post-beta**. Do not
add it here during the sprint.

## The one rule

Supabase is reached **only** from server code, using the service-role key. The
key must never reach the browser bundle or a network response.

How that is enforced, not just intended:

- `lib/env.ts` is the only module that names `SUPABASE_SERVICE_ROLE_KEY`, and
  the variable is deliberately **not** prefixed `NEXT_PUBLIC_`, so Next never
  inlines it into client JavaScript.
- `lib/env.ts`, `lib/supabaseAdmin.ts` and `lib/queries.ts` all start with
  `import 'server-only'` — importing any of them from a `'use client'` file is a
  **build** failure, not a runtime surprise.
- There are no client components at all; both pages are server components.
- `lib/serviceRoleExposure.test.ts` asserts each of the above on every test run.
- Errors are sanitised in `lib/errors.ts`: the browser gets a fixed sentence,
  the detail goes to the server log.

RLS is untouched and the panel only reads — it never writes. The service-role
key bypasses RLS by design; that is exactly why it is confined to the server.

## Database privileges

The panel needs one migration,
`backend/supabase/migrations/20260817000000_admin_read_grants.sql`:

```sql
grant select on table public.shops to service_role;
grant select on table public.sales to service_role;
```

It exists because `service_role`'s `BYPASSRLS` skips row-level *policies* but
confers **no table privileges** — PostgREST still runs `set role service_role`
and checks the table ACL first, and the initial schema grants nothing on either
table. Without this migration both pages die with `permission denied for table
shops` (SQLSTATE 42501).

Least-privilege scope: `SELECT` only, on the only two tables `lib/queries.ts`
reads, for `service_role` only. No `anon`/`authenticated` grant, no write
privilege, and deliberately no `ALTER DEFAULT PRIVILEGES` (which would silently
cover every future table). `lib/adminGrants.test.ts` derives the table list from
`queries.ts` itself and fails if a query is added without a matching grant.

## Access gate

`middleware.ts` puts HTTP Basic auth in front of every route and **fails
closed**: with `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASSWORD` unset, every
route returns 503. Without this, a deployed admin URL would publish every
pharmacy's name and phone number anonymously.

**This is a temporary P0 gate, not production admin authentication.** Volume 0
Day 14 specifies no auth at all; a single shared credential is the minimum that
closes the hole within P0 scope. Individual admin accounts, RBAC (Volume 5's P1
super-admin vs support-read-only split), MFA, session management and
admin-access auditing are all future hardening — none is implemented, and Basic
Auth should be replaced rather than extended when they land.

## Environment

Copy `.env.example` to `.env.local` for local work; set the real values in
Vercel's project settings (Volume 8). Never commit a filled-in `.env`.

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_BASIC_AUTH_USER=
ADMIN_BASIC_AUTH_PASSWORD=
```

## Commands

```bash
pnpm --filter @muthoy/admin dev        # local dev server
pnpm --filter @muthoy/admin build      # production build
pnpm --filter @muthoy/admin typecheck
pnpm --filter @muthoy/admin lint
pnpm test                              # includes apps/admin/lib/**/*.test.ts
```

## Verifying the key is not exposed (do this yourself — Volume 0, Day 14)

1. `pnpm --filter @muthoy/admin build && pnpm --filter @muthoy/admin start`
2. Open devtools → Network, load `/` and `/pharmacies`.
3. Search every response and every `_next/static/**` chunk for the key's value.
   It must not appear. `grep -r "$SUPABASE_SERVICE_ROLE_KEY" .next/static` is
   the fast version of the same check.

This check has been run with a **sentinel (fake) credential** and passed on both
pages, authenticated and unauthenticated — which proves the mechanism, not the
deployed secret. Volume 0's Human Review item is you performing step 2 yourself
against the real production key; that has not been done.

## Status

Day 14 P0 code is complete. Still outstanding before Day 14 counts as verified:

- `20260817000000_admin_read_grants.sql` is **written but not deployed**. Until
  it is, both pages fail against live Supabase — that failure is what surfaced
  the missing grant in the first place, and it has not been re-tested since.
- Day 14's Testing Checklist item — register a test shop on the mobile app, sync
  it, confirm it appears here within one sync cycle — has not been run.
- The panel has not been deployed to Vercel.

## Conventions

- Brand colors and radii come from `@muthoy/constants`' JSON tokens via
  `tailwind.config.ts`; they are never re-typed here.
- Money renders in DM Mono and every other number in Plus Jakarta Sans
  (CLAUDE.md rule 6), bound through `next/font` CSS variables — no font name is
  hardcoded in a component.
- Money is formatted by `@muthoy/utils`' `formatMoney`, on branded `Paisa`
  values from `@muthoy/types`. This app never re-implements money formatting or
  arithmetic.
