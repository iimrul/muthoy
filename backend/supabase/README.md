# backend/supabase/

Supabase cloud mirror and Edge Functions.

- `migrations/`: 21-table PostgreSQL mirror, RLS, service-role-only sync RPCs,
  and the narrow `SELECT` grants the Day 14 admin panel and the sync push path
  need — see that folder's README on why `BYPASSRLS` is not a `GRANT`.
- `functions/sync/`: authenticated push, pull, and device-link actions.

SQLite remains the mobile source of truth. Notifications and the local sync/conflict
queues are intentionally not mirrored.
