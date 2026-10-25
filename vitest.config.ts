import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Root Vitest config for pure framework-free code plus real node:sqlite DB
// verification. Screen code remains real-device validated; the one exception
// is the scanner modal's permission/error/Settings branches, which run under
// jsdom with React Native primitives stubbed at the module boundary (that
// file opts in via its own `@vitest-environment jsdom` docblock, so the
// default node environment below still applies everywhere else).
export default defineConfig({
  define: { __DEV__: false },
  // Batch 3 §11. apps/admin/tsconfig.json sets `"jsx": "preserve"`, which Next
  // requires — Next does its own JSX transform. Vite reads that same tsconfig
  // and therefore falls back to the CLASSIC transform, which emits
  // `React.createElement` and fails with "React is not defined" in a file that
  // does not import React. Every workspace here is on React 19, whose own
  // runtime is the automatic one, so this states at TEST time what the apps
  // already do at build time. It changes nothing about `next build`.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      "expo-constants": resolve(process.cwd(), "apps/mobile/db/test/expo-constants.ts"),
      "expo-application": resolve(process.cwd(), "apps/mobile/db/test/expo-application.ts"),
      "./client": resolve(process.cwd(), "apps/mobile/db/test/client.ts"),
      "expo-sqlite": resolve(
        process.cwd(),
        "apps/mobile/db/test/expo-sqlite.ts",
      ),
      "expo-crypto": resolve(
        process.cwd(),
        "apps/mobile/db/test/expo-crypto.ts",
      ),
      // A2.3. sync/deviceRegistry.ts sits in sync/pull.ts's import graph, and
      // the real expo-device reaches expo-modules-core's EventEmitter at
      // import time — which failed suites that never touch a device at all.
      // The three fields it provides are cosmetic device-list labels.
      "expo-device": resolve(
        process.cwd(),
        "apps/mobile/db/test/expo-device.ts",
      ),
      "muthoy-pin-crypto": resolve(
        process.cwd(),
        "apps/mobile/db/test/muthoy-pin-crypto.ts",
      ),
      "../modules/muthoy-pin-crypto": resolve(
        process.cwd(),
        "apps/mobile/db/test/muthoy-pin-crypto.ts",
      ),
      // H-3. Same treatment as the PIN module: the Keystore-backed SQLCipher
      // key provider is Android-only, so Node gets a double that models its
      // contract (mint once, same key after, distinguishable unwrap failure).
      "muthoy-db-key": resolve(process.cwd(), "apps/mobile/db/test/muthoy-db-key.ts"),
      // db/migrations/migrations.js imports raw .sql, which only parses under
      // Metro's babel-plugin-inline-import. Rollup reads it as JavaScript and
      // dies on `CREATE TABLE`. Reachable from ordinary tests since H-3 gave
      // the headless notification task a db/init.ts gate. The stub loads the
      // real journal and SQL from disk, so it is faithful, not hollow.
      "./migrations/migrations": resolve(
        process.cwd(),
        "apps/mobile/db/test/migrations.ts",
      ),
      // db/init.ts runs Drizzle's migrator; the SQLite suites have already
      // exec'd the migration files into the shared in-memory database
      // themselves, so a second pass re-issues CREATE TABLE and fails. Same
      // reason "./client" is aliased. Both specifiers: db/index.ts imports
      // "./init", native/notifications.ts imports "../db/init".
      "./init": resolve(process.cwd(), "apps/mobile/db/test/init.ts"),
      "../db/init": resolve(process.cwd(), "apps/mobile/db/test/init.ts"),
      "../modules/muthoy-db-key": resolve(
        process.cwd(),
        "apps/mobile/db/test/muthoy-db-key.ts",
      ),
      "react-native-mmkv": resolve(
        process.cwd(),
        "apps/mobile/db/test/react-native-mmkv.ts",
      ),
      "@expo/vector-icons/Feather": resolve(
        process.cwd(),
        "apps/mobile/db/test/vector-icons.ts",
      ),
      // Auth parity: the auth primitives use the same icon family the nav
      // shell already ships, plus safe-area insets and SVG gradients. All three
      // load native modules at import time; see each double's header.
      "@expo/vector-icons/MaterialCommunityIcons": resolve(
        process.cwd(),
        "apps/mobile/db/test/vector-icons-material.ts",
      ),
      "react-native-safe-area-context": resolve(
        process.cwd(),
        "apps/mobile/db/test/safe-area-context.ts",
      ),
      "react-native-svg": resolve(
        process.cwd(),
        "apps/mobile/db/test/react-native-svg.ts",
      ),
      // H-5. Deno's npm: specifier for bcryptjs, which Node cannot resolve,
      // mapped to the same major the mobile app ships. It is what lets
      // session-revocation.pgtest.ts EXECUTE recoverPin.ts — the suites that
      // could only read it as text are how a sign-out that GoTrue refused on
      // every call shipped green.
      "npm:bcryptjs@3": resolve(process.cwd(), "apps/mobile/node_modules/bcryptjs/index.js"),
      // H-9. The Edge runtime's pinned supabase-js, mapped to the identical
      // version the mobile lockfile installs, so supabase-key-transport.test.ts
      // executes the real supabaseAdmin.ts and the real SDK it ships with.
      // W4-06. apps/admin's credential modules are marked `server-only`, whose
      // real entry point throws unless the bundler honours the react-server
      // export condition. See apps/admin/test/server-only.ts.
      "server-only": resolve(process.cwd(), "apps/admin/test/server-only.ts"),
      "npm:@supabase/supabase-js@2.112.3": resolve(
        process.cwd(),
        "apps/mobile/node_modules/@supabase/supabase-js/dist/index.mjs",
      ),
    },
  },
  test: {
    server: { deps: { inline: ["expo-sqlite", "expo-crypto"] } },
    include: [
      "apps/mobile/db/environment-binding.test.ts",
      "apps/mobile/db/medicine-catalog.sqlite.test.ts",
      "apps/mobile/tests/environment-policy.test.ts",
      // H-9 archive controls on a real Git revision; the EAS CLI 21.8.0 half
      // runs EAS's own copy/workflow code when that pinned CLI is installed.
      "apps/mobile/tests/eas-archive.test.ts",
      "apps/mobile/tests/environment-gate.render.test.tsx",
      // H-9 Phase 4. The read-only production preflight, driven against a
      // scratch Git revision and a fake Management API; it never runs live.
      "apps/mobile/tests/h9-prod-preflight.test.ts",
      // E4 / Batch 3. The evidence manifest, verified against the tree rather
      // than trusted: H-9's static equivalent has already drifted.
      "apps/mobile/tests/e4-evidence-manifest.test.ts",
      "apps/mobile/domain/**/*.test.ts",
      // W3-04 (H-8 core). The sink's bounded/offline behaviour, plus static
      // assertions that nothing in monitoring/ reaches the network or imports
      // dev/runtimeDiagnostics, which deliberately retains raw context.
      "apps/mobile/monitoring/*.test.ts",
      "apps/mobile/native/*.test.ts",
      "apps/mobile/services/*.test.ts",
      "apps/mobile/i18n/**/*.test.ts",
      "apps/mobile/navigation/**/*.test.ts",
      "apps/mobile/components/scanner/*.test.tsx",
      "apps/mobile/components/ui/PinPad.test.tsx",
      // Auth parity: the shared auth primitives (shell, notices, buttons, the
      // +880 phone field, status/loader screens, the logout sheet) and the
      // PinPad/OtpInput visual variants.
      "apps/mobile/components/auth/*.test.ts",
      "apps/mobile/components/auth/*.test.tsx",
      "apps/mobile/components/ui/auth-inputs.test.tsx",
      // Phase C Pass 1 (D1, D2). The toast and skeleton primitives that three
      // screens previously each re-implemented, tested on the behaviour those
      // copies disagreed about rather than on their markup.
      "apps/mobile/components/ui/ui-primitives.test.tsx",
      "apps/mobile/components/expenses/*.test.ts",
      "apps/mobile/components/expenses/*.test.tsx",
      "apps/mobile/components/suppliers/*.test.tsx",
      // dev/ holds production-disabled instrumentation only (auth timing,
      // runtime diagnostics — both inert unless __DEV__); H-5 deleted the DEV
      // registration harness that also lived there. See dev/README.md.
      "apps/mobile/dev/*.test.ts",
      "apps/mobile/db/cash.sqlite.test.ts",
      "apps/mobile/db/b4-commercial-cache.sqlite.test.ts",
      "apps/mobile/db/b4-entitlement-hydration.sqlite.test.ts",
      // Fail-closed multi-shop entitlement on real SQLite: trial and paid pass,
      // Free and expired are refused, and only the account primary shop stays
      // reachable after a downgrade.
      "apps/mobile/db/b4-multi-shop-entitlement.sqlite.test.ts",
      // W4-10. The local half of the SSLCommerz retirement: a refused payment
      // writes no payment_attempts row and sends no request, while historical
      // attempts, their reconciliation and the legacy writer all survive.
      "apps/mobile/db/b4-payment-retirement.sqlite.test.ts",
      // Migration 0018's data backfill against a populated pre-migration
      // fixture — the taxonomy remap, not the CHECK-constraint rebuild the
      // plan doc originally assumed (there is none on this column).
      "apps/mobile/db/expense-category-migration.sqlite.test.ts",
      "apps/mobile/db/closed-day-guard.sqlite.test.ts",
      "apps/mobile/db/errors.test.ts",
      // H-3. Three layers, none of which needs an Android device:
      // the key provider's contract, the startup state machine across every
      // crash/restart shape, and the copy->verify->swap migration driven
      // against REAL SQLite files in a temp directory. Actual ciphertext is
      // the one thing Node cannot prove; that is the separate on-device gate.
      "apps/mobile/db/database-key.test.ts",
      "apps/mobile/db/encryption-plan.test.ts",
      "apps/mobile/db/encryption-migration.sqlite.test.ts",
      "apps/mobile/db/encryption-hardening.sqlite.test.ts",
      "apps/mobile/db/encryption-verify.sqlite.test.ts",
      "apps/mobile/db/production-client.test.ts",
      "apps/mobile/db/production-init.test.ts",
      "apps/mobile/db/database-recovery.test.ts",
      // Static assertion that app.json really enables SQLCipher and disables
      // Android backup — the config is the whole mechanism, so a silent
      // revert there would un-encrypt the build with no other symptom.
      "apps/mobile/tests/h3-sqlcipher-config.test.ts",
      "apps/mobile/db/inventory-expiry.sqlite.test.ts",
      "apps/mobile/db/notifications.sqlite.test.ts",
      "apps/mobile/db/permissions.sqlite.test.ts",
      "apps/mobile/db/pin-performance.sqlite.test.ts",
      // H-4. The offline PIN pad had no attempt budget and answered a miss
      // without any bcrypt at all, so response time alone named the PIN.
      // Three layers: the pure quantiser, the attempt counter (including
      // clock rollback and a corrupt record), and both of them driven
      // through the real verifyPin on real SQLite.
      "apps/mobile/db/pin-timing.test.ts",
      "apps/mobile/db/pin-attempt-lock.test.ts",
      "apps/mobile/db/pin-hardening.sqlite.test.ts",
      "apps/mobile/db/staff-dashboard.sqlite.test.ts",
      // The Owner Dashboard composite read: authorization, the local-midnight
      // day boundary, the all-payment-types staff fix, truthful "+N more"
      // alert totals, shop isolation, and a fresh shop's empty state.
      "apps/mobile/db/owner-dashboard.sqlite.test.ts",
      "apps/mobile/db/reports.sqlite.test.ts",
      // Per-staff permission overrides, the phone credential's uniqueness, and
      // the revocation counter — through the real db/ actions on real SQLite.
      "apps/mobile/db/staff-permissions.sqlite.test.ts",
      // B3 Group 4: overdue derivation at the credit_max_days boundary,
      // unpaid/partial/settled status split, W-4's search+pagination
      // replacing the old LIMIT 50, zero-balance retention, and non-cash
      // collection method plumbing — all through the real db/customers.ts
      // functions on real SQLite.
      "apps/mobile/db/credit-completeness.sqlite.test.ts",
      // B3 Group 5: archived suppliers excluded from the active list, D-9's
      // archive-refused-while-payable>0 guard, supplier edit, and
      // recordSupplierPayment's capping/COD/fully-paid refusal + atomic
      // paid_amount increment + drawer recompute + closed-day guard.
      "apps/mobile/db/supplier-completeness.sqlite.test.ts",
      // B3 Group 6: pending purchase lines (no movement/total until
      // received), Mark Received's exact-one-movement + recompute, void's
      // zero-movement/zero-payment guard, and advisory duplicate-invoice
      // detection.
      "apps/mobile/db/purchase-completeness.sqlite.test.ts",
      // The purchase invoice number through the real createPurchase path:
      // two devices at the same local sequence must not mint the same string.
      "apps/mobile/db/purchase-invoice.sqlite.test.ts",
      // B3 Group 7: purchase returns — negative-ledger-only stock restore,
      // exact batch resolution, the received-minus-returned/current-stock
      // dual cap, required reason, closed-day guard, audit row, and the
      // downstream Supplier Credit effect on the canonical position.
      "apps/mobile/db/purchase-returns.sqlite.test.ts",
      "apps/mobile/db/sync-helpers.order.test.ts",
      // H-7 H-1, client half: the device drops rows for tables the server has
      // stopped sending, without touching unpushed outbox work.
      "apps/mobile/db/access-purge.sqlite.test.ts",
      "apps/mobile/db/h7-revocation.sqlite.test.ts",
      // H-7 H-B1. The device revocation lock must outlive any hydration that
      // re-sends the locked user's server row.
      "apps/mobile/db/h7-access-lock.sqlite.test.ts",
      "apps/mobile/db/h7-pin-reservation.sqlite.test.ts",
      // A2.3. The device-registry mirror on real SQLite: a revoked binding
      // blocks PIN login while spending NO H-4 budget, a revoked device
      // quarantines the whole shop, and no replayed or "unknown" snapshot can
      // lift either.
      "apps/mobile/db/a23-device-registry.sqlite.test.ts",
      // A2.3 staff first-login completion: the mirror write that follows a
      // credential proof must not report failure for a snapshot it correctly
      // discarded, and a completed enrolment must survive restart.
      "apps/mobile/db/a23-staff-first-login.sqlite.test.ts",
      // Receiving-device sale-graph hydration: A rings it up, B pulls it, and
      // B's own history/report/cash/credit read models have to agree.
      "apps/mobile/db/sale-graph-hydration.sqlite.test.ts",
      // Multi-Shop physical defects: cloud-link persistence across a shop
      // switch/cold restart, and shop-scoped PIN uniqueness.
      "apps/mobile/db/multi-shop-restart-pin.sqlite.test.ts",
      "apps/mobile/db/sync-helpers.sqlite.test.ts",
      // H-6 (W3-01/W3-02). Detection through the real apply path, then the
      // resolver: force-apply past the LWW gate, outbox supersession with a
      // byte-exact audit trail, and the grouped-operation refusal.
      "apps/mobile/db/push-replay.sqlite.test.ts",
      "apps/mobile/db/h6-conflict-queue.sqlite.test.ts",
      "apps/mobile/db/h6-conflict-resolution.sqlite.test.ts",
      // W3-11. The workflows run IN SEQUENCE against shared state, with the
      // ledger invariant and the accounting identity re-asserted after EVERY
      // step — a composition defect hides behind a total that balances only at
      // the end. Includes the offline outbox-group completeness check.
      "apps/mobile/db/core-workflow-regression.sqlite.test.ts",
      "apps/mobile/db/user-switch.sqlite.test.ts",
      // Every actor-attributed db/ mutation, table-driven: stale is refused,
      // a missing liveness callback fails closed, live still commits — and
      // background/system writes keep working with no session at all.
      "apps/mobile/db/stale-session-mutations.sqlite.test.ts",
      // Multi-device inventory consistency: concurrent deltas from two phones
      // combine instead of overwriting, redelivery applies once, and an
      // offline oversell is kept and flagged rather than silently dropped.
      "apps/mobile/db/inventory-ledger.sqlite.test.ts",
      // The invariant itself: every way of changing stock WITHOUT a movement is
      // rejected by migration 0006's triggers. Mostly negative controls.
      "apps/mobile/db/ledger-invariant.sqlite.test.ts",
      // The UPGRADE onto that invariant — 0000-0005, pre-ledger absolutes
      // planted by hand, THEN 0006. Every other suite starts after the
      // migration, so this is the only place a real device's data is covered.
      "apps/mobile/db/pre-ledger-upgrade.sqlite.test.ts",
      // Hydration itself, through the real pull loop on real SQLite: a fresh
      // device, a replay, a metadata-only update, and an interrupted run all
      // have to leave batches.stock equal to the sum of their movements.
      "apps/mobile/db/hydration-ledger.sqlite.test.ts",
      "apps/mobile/db/b2-*.sqlite.test.ts",
      // The device-handover session layer, the screen that stamps a sale's
      // staff_id, and the sync engine's start/stop lifecycle. Each opts into
      // jsdom via its own docblock (react-native and react-native-mmkv mocked
      // at the module boundary), so the default node environment below is
      // unaffected.
      "apps/mobile/state/switchUser.test.tsx",
      "apps/mobile/state/switchShop.test.ts",
      // H-10 A2.4. "Sign out" has to be exact about which of the nine MMKV
      // stores it clears: leaving a credential behind and wiping the H-4
      // attempt budget are opposite mistakes, and this enumerates both.
      "apps/mobile/state/signOutDevice.test.ts",
      // Staff/Manager must trigger zero owner-wide shop/primary-shop SQLite
      // reads — the role check gates the hook's effect itself.
      "apps/mobile/state/useMultiShopAccess.test.tsx",
      "apps/mobile/state/businessDayStore.test.ts",
      "apps/mobile/tests/sale/checkout.test.tsx",
      // W2-01 / gate E9: the resumed-held-draft boundary, driven through the
      // real scanner and the real capture-cleanup helper.
      "apps/mobile/tests/sale/resumed-draft-capture.test.tsx",
      // W2-01 section 6.2.3: the scan cannot reach the cart without a confirm.
      "apps/mobile/tests/sale/scan-confirm.test.tsx",
      // W2-01 section 6.2.4: the captured prescription is read, reviewed per
      // line, and never added to the sale on its own.
      "apps/mobile/tests/sale/prescription-ocr.test.tsx",
      "apps/mobile/tests/sale/cartStore.test.ts",
      "apps/mobile/tests/inventory/*.test.tsx",
      // The six sibling actor-stamping write screens, driven across a real
      // OWNER → STAFF → OWNER handover with only db/ and sync/ mocked.
      "apps/mobile/tests/switch-user-writes.test.tsx",
      "apps/mobile/tests/dashboard-rollover.test.tsx",
      "apps/mobile/tests/navigation-shell.test.tsx",
      // M-1 / screen #39: registered fallback, role-aware replacement and Back.
      // Neutral typos show Not Found; guarded prefixes retain their overlays.
      "apps/mobile/tests/not-found.test.tsx",
      "apps/mobile/tests/not-found.integration.test.tsx",
      // H-2: the DEV OTP bypass is absent from the import graph, no __DEV__
      // branch grants capability, and a production-mode Registration renders no
      // bypass/repair affordance while the real OTP path still runs.
      "apps/mobile/tests/dev-production-safety.test.ts",
      "apps/mobile/tests/dev-production-safety.render.test.tsx",
      // Phase C Pass 1 (D6). CLAUDE.md rule 6 is absolute and invisible when
      // broken — a wrong font renders perfectly. Read as source, the way the
      // DEV-safety suite above reads its own invariant.
      "apps/mobile/tests/font-tokens.test.ts",
      // H-6. The field classification derived from FOUR sources (upsertRemoteRow,
      // toSyncPayload, the migration SQL's pin vs conditional-fallback forms, and
      // push.ts's non-SQL profile write). Over-excluding a field blinds the
      // conflict detector silently, which is why this is a test and not a comment.
      "apps/mobile/tests/server-owned-fields.test.ts",
      // W3-02. The conflict screen's five UI states — empty, offline, failed
      // resolution, read-only, and a grouped row whose keep_remote button must be
      // ABSENT rather than disabled — in both locales.
      "apps/mobile/tests/sync-conflicts.test.tsx",
      // W3-08/W3-09/W3-10 ratchets, read as source: no user-visible English
      // literal in the six fixed screens, both locales present for every key
      // they use, the three hand-rolled headers reading the safe-area inset,
      // no raw hex in the screens this batch authored, and D10's focus reload
      // with its stale-result guard.
      "apps/mobile/tests/localization-and-ui-consistency.test.ts",
      // H-11 C1. The rollback classification is generated from the SQL by
      // scripts/classify-migrations.mjs; this fails if ROLLBACK.md drifts
      // from it, which is how the first audit went wrong by seven rows.
      "apps/mobile/tests/migration-rollback-classification.test.ts",
      // H-11 C2/C3. The fixture must satisfy every money, credit, cash and
      // stock invariant before a drill is run against it, and the restore
      // baseline must fingerprint the VALUES the drill corrupts.
      "apps/mobile/tests/history-fixture.test.ts",
      "apps/mobile/tests/restore-drill.test.ts",
      "apps/mobile/tests/reports-final-fixes.test.tsx",
      "apps/mobile/tests/app-layout.test.tsx",
      "apps/mobile/tests/authenticated-routing.test.tsx",
      // B4 physical regression: the Multi-Shop press must open /multi-shop
      // without the <Stack /> navigator being unmounted (which read as a
      // reload on device), across trial/free/expired and every role.
      "apps/mobile/tests/b4-multi-shop-navigation.test.tsx",
      "apps/mobile/tests/auth-pin-latency.test.tsx",
      // Auth parity: onboarding (Phase B) and sign-in / shared-till (Phase C)
      // screens, rendered in both languages with only the network/SQLite edge
      // mocked.
      "apps/mobile/tests/auth-onboarding.test.tsx",
      "apps/mobile/tests/auth-signin.test.tsx",
      "apps/mobile/tests/staff-home-routing.test.tsx",
      "apps/mobile/tests/staff-management-pin.test.tsx",
      "apps/mobile/sync/**/*.test.ts",
      // Auto-hydration end-to-end: real SQLite + real usePlan/useMultiShopAccess,
      // only the network edge mocked — proves the server Trial appears without a
      // manual Sync, retries on reconnect/foreground, and fails closed rather
      // than silently reading as Free.
      "apps/mobile/db/b4-billing-hydration.sqlite.test.tsx",
      // Reads the edge-function sources and migration SQL as text to check that
      // every direct PostgREST read has a matching grant. Named file, not a
      // backend/** glob: the rest of that directory is Deno and will not load.
      // REAL Postgres. PGlite runs the actual migrations and the actual
      // policies, so the sync dispatcher, the permission functions, the access
      // token hook and RLS are executed rather than regex-matched. The
      // text-reading suites below stayed text-only because Deno and Postgres
      // cannot both load in this runner; these two had no such excuse.
      "backend/supabase/pgtest/migration.pgtest.ts",
      "backend/supabase/pgtest/security.pgtest.ts",
      "backend/supabase/pgtest/b2.pgtest.ts",
      "backend/supabase/pgtest/b3-group2.pgtest.ts",
      "backend/supabase/pgtest/b3-group3.pgtest.ts",
      "backend/supabase/pgtest/b3-groups456-sync.pgtest.ts",
      // B3 Group 7: purchase_return grouped-sync dispatcher — server-side
      // re-derivation of max returnable, credit_amount, and row shape.
      "backend/supabase/pgtest/b3-group7-purchase-return-sync.pgtest.ts",
      "backend/supabase/pgtest/inventory-add-purchase-sync.pgtest.ts",
      "backend/supabase/pgtest/b4.pgtest.ts",
      // W4-08. The admin panel's EFFECTIVE privileges on a real Postgres:
      // what service_role actually holds after every GRANT, REVOKE and role
      // membership in the chain, including the negatives (no shop UPDATE, no
      // sales write, nothing on the device registry, nothing for anon).
      "backend/supabase/pgtest/batch2-admin-acl.pgtest.ts",
      // E4 / Batch 3. The admin platform migration's effective privileges and
      // BEHAVIOUR: the declarative acceptance sections, plus the writes those
      // privileges must actually refuse. A catalogue that looks right and a
      // table whose audit rows can still be edited are different things.
      "backend/supabase/pgtest/e4-admin-platform.pgtest.ts",
      // E4 / Batch 3. The succession between the two check files: which one is
      // correct about which history, and the substitution the older count-plus-
      // bounds check cannot see.
      "backend/supabase/pgtest/e4-chain-succession.pgtest.ts",
      // W4-05. Both barriers proven INDEPENDENTLY — the owner gate with the pin
      // bypassed, the pin with the gate bypassed — plus the seven working paths.
      "backend/supabase/pgtest/w405-shop-identity.pgtest.ts",
      // One onboarding function for BOTH the real OTP flow and DEV Skip-OTP,
      // proving they reach the same rows and the same token claims — plus the
      // Multi-Shop rename/archive path that had the identical 42501.
      //
      // Also the only suite that executes as service_role. Every PostgREST call
      // in production runs under that ACL, and until this file nothing tested
      // it — which is how a direct INSERT on shops shipped and died at 42501.
      "backend/supabase/pgtest/canonical-onboarding.pgtest.ts",
      // CREDIT CONVERGENCE PROOF (review-fix): the credit_collection
      // dispatcher branch has shipped since B2 with zero coverage through
      // sync_stage_operation_chunk. Proves sync/pull canonical balance,
      // multi-device convergence, and retry/idempotency without touching
      // the (already-correct) dispatcher itself.
      "backend/supabase/pgtest/credit-convergence.pgtest.ts",
      // H-7 (2026-09-07). Executes the cross-shop insert guard on BOTH
      // sync_apply_row overloads, and asserts per-table that what the Edge pull
      // sends equals what direct RLS would show — the two paths had drifted on
      // expenses and payments, and only a parity matrix keeps them together.
      // Also covers revoked-user reads, the bounded null-billing window, and
      // multi-billing-account isolation against a real database rather than
      // the mocks multiShop.test.ts uses.
      "backend/supabase/pgtest/h7-security.pgtest.ts",
      "backend/supabase/pgtest/h7-fix-pass-b-nonvacuity.pgtest.ts",
      "backend/supabase/pgtest/h7-actor-reactivation.pgtest.ts",
      // A2.3. The device registry executed against real Postgres: adoption of
      // an unknown installation, per-binding vs whole-device revocation, that
      // neither heals itself, cross-shop isolation, the Owner/Manager role
      // line, and the table lockdown.
      "backend/supabase/pgtest/a23-device-registry.pgtest.ts",
      // H-5. The Send SMS hook's dispatch ledger: one provider call per code
      // (replays and GoTrue retries refused), the per-number daily cap, single
      // settlement, and a table no API role can reach.
      "backend/supabase/pgtest/h5-sms-dispatch.pgtest.ts",
      // H-5 review P1: the same ledger on a PostgreSQL SERVER, every claim its
      // own backend — the lock observed in pg_locks, a lock-stripped negative
      // control, and barrier-released stampedes. Skips (and says so) where no
      // initdb/pg_ctl/psql exists; ubuntu-latest has them.
      "backend/supabase/pgtest/h5-sms-dispatch.concurrency.pgtest.ts",
      // H-5 (DEV, 2026-10-05). Session revocation, executed: the by-id
      // revocation function on real auth tables, and recoverPin, the
      // auth-account rebind and signOutAppUser run against them through the
      // real supabase-js clients and a GoTrue double.
      "backend/supabase/pgtest/session-revocation.pgtest.ts",
      "backend/supabase/pgtest/dev-harness-cleanup.pgtest.ts",
      "backend/supabase/pgtest/dev-harness-12-cleanup.pgtest.ts",
      "backend/supabase/pgtest/restore-baseline.pgtest.ts",
      // H-9. The two forward migrations: A2.3 consumption-CHECK normalization
      // across fresh and historical chains, and the guarded pg_cron schedule
      // (with a test-only pg_cron stub) plus the cleanup function it runs.
      "backend/supabase/pgtest/h9-environment-parity.pgtest.ts",
      "backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts",
      "backend/supabase/pgtest/h9-api-role-privileges.pgtest.ts",
      "backend/supabase/pgtest/h9-api-role-hardening.pgtest.ts",
      "backend/supabase/functions/sync/grants.test.ts",
      // H-9. The Edge key resolver, the real supabaseAdmin.ts + SDK request
      // construction in both key modes, and every sync route driven through
      // handler.ts against forged, foreign and key-only credentials.
      "backend/supabase/functions/sync/_shared/supabaseKeys.test.ts",
      "backend/supabase/functions/sync/supabase-key-transport.test.ts",
      "backend/supabase/functions/sync/handler-authorization.test.ts",
      // H-7: anonymous callers are refused by verifyCallerJwt itself, not by
      // the hosted Auth provider toggle alone.
      "backend/supabase/functions/sync/anonymous.test.ts",
      "backend/supabase/functions/sync/auth-current.test.ts",
      "backend/supabase/functions/sync/errorResponse.test.ts",
      "backend/supabase/functions/sync/staffLifecycle.test.ts",
      "backend/supabase/functions/sync/pull.test.ts",
      // Pure, executable device-login authority checks. The adjacent source
      // contract suite cannot import Deno's npm: bcrypt specifier under Node.
      "backend/supabase/functions/sync/deviceLoginPolicy.test.ts",
      // A2.3, same split and the same reason: the executable half of the
      // device registry (constant-time compare, deny-by-revocation, the
      // SQLSTATE map) plus the source contracts Node cannot run.
      "backend/supabase/functions/sync/deviceRegistryPolicy.test.ts",
      // Executes the mocked RPC boundary itself: malformed gate/blocked-shop
      // responses fail closed and credential flows cannot bypass a bound
      // revocation.
      "backend/supabase/functions/sync/deviceGuard.test.ts",
      // Executes enrollment preflight and binding semantics: capable clients
      // cannot omit installation identity, holds cannot be bypassed, and
      // malformed registry responses fail closed.
      "backend/supabase/functions/sync/deviceBinding.test.ts",
      // Same text-reading technique again, for the separate-device login: that
      // the lockout precedes bcrypt, that every credential failure is
      // indistinguishable, that permission_version cannot be pushed by a
      // client, and that a default staff member can still complete a checkout.
      "backend/supabase/functions/sync/device-login.test.ts",
      "backend/supabase/functions/sync/hardening.test.ts",
      // Same text-reading technique, applied to the Postgres ledger migration:
      // stock is unwritable except through the movement trigger, that trigger
      // adds rather than assigns, and an oversell is marked rather than refused.
      "backend/supabase/functions/sync/inventory-ledger.test.ts",
      "backend/supabase/functions/sync/expenses.test.ts",
      "backend/supabase/functions/sync/purchases.test.ts",
      "backend/supabase/functions/sync/sslcommerz.test.ts",
      // W3-06. The callback PIPELINE, now that handler.ts is split out of the
      // Deno.serve wiring: signature gate, body cap, per-IP rate limit, terminal
      // cancel/fail, and the idempotent keyed apply. Synthetic doubles only —
      // no merchant credential and no live endpoint.
      "backend/supabase/functions/payment-webhook/webhook.test.ts",
      // W3-06. Initiation and terminal reconciliation: who may start a payment,
      // what makes a retry idempotent rather than a double charge, and that a
      // provider failure cannot leave an order the device polls forever.
      "backend/supabase/functions/sync/payment-integration.test.ts",
      // W4-10. Provider SELECTION, which is where the retirement lives: every
      // PAYMENT_PROVIDER value — unset, unknown, 'bkash' and 'sslcommerz'
      // itself — refuses with 503 payment_not_configured, and billing-init
      // reaches no payment table on a refused attempt.
      "backend/supabase/functions/sync/payment-provider.test.ts",
      "backend/supabase/functions/sync/multiShop.test.ts",
      // billing-status self-heal: MU032 is the only failure that may answer
      // 404; every other RPC/database error stays a 500.
      "backend/supabase/functions/sync/billing.test.ts",
      "backend/supabase/functions/sync/onboarding.test.ts",
      "backend/supabase/functions/sync/linkDevice.test.ts",
      // H-5. Supabase Auth's Send SMS hook (auth-send-sms). Every module is
      // runtime-neutral — Web Crypto, fetch and Request/Response — so the code
      // these execute under Node is the code Deno deploys; only index.ts, the
      // Deno.serve wiring, stays out.
      "backend/supabase/functions/auth-send-sms/signature.test.ts",
      "backend/supabase/functions/auth-send-sms/dispatch.test.ts",
      "backend/supabase/functions/auth-send-sms/reve.test.ts",
      "backend/supabase/functions/auth-send-sms/handler.test.ts",
      // apps/admin's pure logic + service-role exposure guards. Framework-free:
      // nothing here imports Next or opens a Supabase connection.
      "apps/admin/lib/**/*.test.ts",
      // Batch 3 §11. The per-route contract INVOKES each of the eleven pages
      // and renders the result with react-dom/server. Listed explicitly
      // because the glob above covers lib/ only, and it has to live under
      // apps/admin/ — pnpm resolves react-dom from that workspace, and a
      // root-level file fails with ERR_MODULE_NOT_FOUND.
      "apps/admin/app/adminRoutes.contract.test.tsx",
      // W4-06. The REAL Next middleware, driven with NextRequest: the exact-match
      // public-path set (and every near miss), the fail-closed 503, the
      // redirect-vs-401 split, idle refresh, and denial after a role is removed.
      "apps/admin/middleware.test.ts",
      "packages/*/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
