# sync/

The only mobile boundary that talks to Supabase. It owns persisted Supabase
Auth, OTP, device linking, ordered outbox push, composite-cursor pull, retry
backoff, connectivity triggers, and the foreground scheduler.

SQLite remains the source of truth for every screen. Pulled rows are applied
through `db/sync-helpers.ts` and are never re-enqueued.

Required Expo environment variables are documented in `../.env.example`.
Without them background sync safely no-ops; foreground OTP calls fail loudly.
