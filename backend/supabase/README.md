# backend/supabase/

Supabase cloud mirror and Edge Functions.

- `migrations/`: 21-table PostgreSQL mirror, RLS, and service-role-only sync RPCs.
- `functions/sync/`: authenticated push, pull, and device-link actions.

SQLite remains the mobile source of truth. Notifications and the local sync/conflict
queues are intentionally not mirrored.
