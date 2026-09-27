-- A2.3. The device's local mirror of the server device registry.
--
-- SQLite rather than MMKV, deliberately and for three reasons.
--
--   1. The locked design says the MMKV quarantine is NOT authoritative. Adding
--      device revocation to it would have put the newest security state in the
--      one store that is plaintext and trivially clearable.
--   2. H-3 encrypts this database with a Keystore-wrapped SQLCipher key, so a
--      row here is protected at rest without any new native work.
--   3. CLAUDE.md rule 1 — SQLite is the source of truth for what the app's own
--      screens may do, and blocking a revoked account's PIN login is exactly
--      such a decision.
--
-- These tables are DEVICE-LOCAL. They are not in SYNCED_TABLES, carry no
-- outbox rows, and are never pushed. What they hold is the last authoritative
-- answer this installation received, plus the version that answer came with —
-- which is what lets a stale or replayed snapshot be recognised and discarded
-- instead of re-opening a door somebody closed.
--
-- No foreign keys, also deliberately. The mirror has to outlive whatever it
-- refers to: hydration order, an access purge that drops user rows, and a
-- revoked actor whose row is gone all leave the revocation itself standing.
-- (CLAUDE.md rule 2 governs foreign keys that exist; the right answer here is
-- for none to exist.)
CREATE TABLE `device_registry_state` (
  `shop_id` text PRIMARY KEY NOT NULL,
  `device_public_id` text NOT NULL,
  -- The enrolment secret, issued once by the server. Present only on an
  -- enrolled installation; null means "not enrolled", which is not the same as
  -- "revoked" and must never be treated as it. Never logged, never displayed,
  -- never synced.
  `device_secret` text,
  -- 'unknown' | 'active' | 'revoked'. 'unknown' is the pre-enrolment state and
  -- the deny-by-revocation default: an installation the registry has never
  -- seen keeps working exactly as it did before A2.3.
  `status` text NOT NULL DEFAULT 'unknown',
  -- Monotonic, server-assigned. A snapshot carrying a LOWER version than the
  -- stored one is a replay and is discarded.
  `registry_version` integer NOT NULL DEFAULT 0,
  -- Whether this shop has a registry at all, mirrored from
  -- shops.devices_enforced_at. Advisory in this batch.
  `enforced` integer NOT NULL DEFAULT 0,
  `fetched_at` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `device_binding_state` (
  `shop_id` text NOT NULL,
  `actor_user_id` text NOT NULL,
  -- 'active' | 'revoked'. A row exists only once the server has told this
  -- device about that binding; an ABSENT row is "unknown", never "revoked".
  `status` text NOT NULL,
  `binding_version` integer NOT NULL DEFAULT 0,
  `fetched_at` text NOT NULL,
  PRIMARY KEY(`shop_id`, `actor_user_id`)
);--> statement-breakpoint
CREATE INDEX `device_binding_state_shop_idx` ON `device_binding_state` (`shop_id`, `status`);
