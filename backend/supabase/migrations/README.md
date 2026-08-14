# backend/supabase/migrations/

Apply timestamped files in order with the Supabase CLI.

The initial schema mirrors 21 SQLite business tables with native UUIDs,
BIGINT paisa, explicit FK deletion behavior, and shop-isolating RLS. Sync RPCs
preserve client `updated_at` values for Beta LWW and are executable only by
`service_role`.

Committed migrations are immutable; later changes require a new migration.
