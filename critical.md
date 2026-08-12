Apply only the two non-blocking review follow-ups:

1. Update apps/mobile/db/README.md with a concise auth registration-state note:
   - none -> /register
   - incomplete (pin_set_at NULL) -> /pin-setup
   - complete -> session validation -> dashboard or /pin-login
   - users.pin_set_at is the deterministic PIN-completion marker
   - existing staff were backfilled during migration 0002

2. Harden getRegistrationStatus() deterministically:
   - add an explicit ORDER BY and LIMIT 1
   - choose the most recent applicable owner/user row using the existing schema timestamps
   - preserve shop scoping and current single-shop-per-device behavior
   - do not change any other auth behavior

Also add a concise note to DECISIONS.md only if needed to document the manager-row migration assumption. Do not duplicate documentation unnecessarily.

Then run:
- tests
- typecheck
- lint
- Android Expo export

Return the exact files changed and verification results.