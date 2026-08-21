import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Root Vitest config for pure framework-free code plus real node:sqlite DB
// verification. Screen code remains real-device validated; the one exception
// is the scanner modal's permission/error/Settings branches, which run under
// jsdom with React Native primitives stubbed at the module boundary (that
// file opts in via its own `@vitest-environment jsdom` docblock, so the
// default node environment below still applies everywhere else).
export default defineConfig({
  define: { __DEV__: false },
  resolve: {
    alias: {
      './client': resolve(process.cwd(), 'apps/mobile/db/test/client.ts'),
      'expo-sqlite': resolve(process.cwd(), 'apps/mobile/db/test/expo-sqlite.ts'),
      'expo-crypto': resolve(process.cwd(), 'apps/mobile/db/test/expo-crypto.ts'),
      'muthoy-pin-crypto': resolve(process.cwd(), 'apps/mobile/db/test/muthoy-pin-crypto.ts'),
      '../modules/muthoy-pin-crypto': resolve(process.cwd(), 'apps/mobile/db/test/muthoy-pin-crypto.ts'),
      'react-native-mmkv': resolve(process.cwd(), 'apps/mobile/db/test/react-native-mmkv.ts'),
    },
  },
  test: {
    server: { deps: { inline: ['expo-sqlite', 'expo-crypto'] } },
    include: [
      'apps/mobile/domain/**/*.test.ts',
      'apps/mobile/i18n/**/*.test.ts',
      'apps/mobile/navigation/**/*.test.ts',
      'apps/mobile/components/scanner/*.test.tsx',
      'apps/mobile/components/ui/PinPad.test.tsx',
      // dev/ also contains production-disabled auth timing code. Remove only
      // the OTP-bypass files listed in dev/README.md before production.
      'apps/mobile/dev/*.test.ts',
      'apps/mobile/db/cash.sqlite.test.ts',
      'apps/mobile/db/closed-day-guard.sqlite.test.ts',
      'apps/mobile/db/errors.test.ts',
      'apps/mobile/db/inventory-expiry.sqlite.test.ts',
      'apps/mobile/db/notifications.sqlite.test.ts',
      'apps/mobile/db/permissions.sqlite.test.ts',
      'apps/mobile/db/pin-performance.sqlite.test.ts',
      'apps/mobile/db/staff-dashboard.sqlite.test.ts',
      // Per-staff permission overrides, the phone credential's uniqueness, and
      // the revocation counter — through the real db/ actions on real SQLite.
      'apps/mobile/db/staff-permissions.sqlite.test.ts',
      // The purchase invoice number through the real createPurchase path:
      // two devices at the same local sequence must not mint the same string.
      'apps/mobile/db/purchase-invoice.sqlite.test.ts',
      'apps/mobile/db/sync-helpers.order.test.ts',
      'apps/mobile/db/sync-helpers.sqlite.test.ts',
      'apps/mobile/db/user-switch.sqlite.test.ts',
      // Every actor-attributed db/ mutation, table-driven: stale is refused,
      // a missing liveness callback fails closed, live still commits — and
      // background/system writes keep working with no session at all.
      'apps/mobile/db/stale-session-mutations.sqlite.test.ts',
      // Multi-device inventory consistency: concurrent deltas from two phones
      // combine instead of overwriting, redelivery applies once, and an
      // offline oversell is kept and flagged rather than silently dropped.
      'apps/mobile/db/inventory-ledger.sqlite.test.ts',
      // The invariant itself: every way of changing stock WITHOUT a movement is
      // rejected by migration 0006's triggers. Mostly negative controls.
      'apps/mobile/db/ledger-invariant.sqlite.test.ts',
      // The UPGRADE onto that invariant — 0000-0005, pre-ledger absolutes
      // planted by hand, THEN 0006. Every other suite starts after the
      // migration, so this is the only place a real device's data is covered.
      'apps/mobile/db/pre-ledger-upgrade.sqlite.test.ts',
      // Hydration itself, through the real pull loop on real SQLite: a fresh
      // device, a replay, a metadata-only update, and an interrupted run all
      // have to leave batches.stock equal to the sum of their movements.
      'apps/mobile/db/hydration-ledger.sqlite.test.ts',
      // The device-handover session layer, the screen that stamps a sale's
      // staff_id, and the sync engine's start/stop lifecycle. Each opts into
      // jsdom via its own docblock (react-native and react-native-mmkv mocked
      // at the module boundary), so the default node environment below is
      // unaffected.
      'apps/mobile/state/switchUser.test.tsx',
      'apps/mobile/tests/sale/checkout.test.tsx',
      // The six sibling actor-stamping write screens, driven across a real
      // OWNER → STAFF → OWNER handover with only db/ and sync/ mocked.
      'apps/mobile/tests/switch-user-writes.test.tsx',
      'apps/mobile/tests/app-layout.test.tsx',
      'apps/mobile/tests/authenticated-routing.test.tsx',
      'apps/mobile/tests/auth-pin-latency.test.tsx',
      'apps/mobile/tests/staff-home-routing.test.tsx',
      'apps/mobile/tests/staff-management-pin.test.tsx',
      'apps/mobile/sync/**/*.test.ts',
      // Reads the edge-function sources and migration SQL as text to check that
      // every direct PostgREST read has a matching grant. Named file, not a
      // backend/** glob: the rest of that directory is Deno and will not load.
      // REAL Postgres. PGlite runs the actual migrations and the actual
      // policies, so the sync dispatcher, the permission functions, the access
      // token hook and RLS are executed rather than regex-matched. The
      // text-reading suites below stayed text-only because Deno and Postgres
      // cannot both load in this runner; these two had no such excuse.
      'backend/supabase/pgtest/migration.pgtest.ts',
      'backend/supabase/pgtest/security.pgtest.ts',
      'backend/supabase/functions/sync/grants.test.ts',
      // Same text-reading technique again, for the separate-device login: that
      // the lockout precedes bcrypt, that every credential failure is
      // indistinguishable, that permission_version cannot be pushed by a
      // client, and that a default staff member can still complete a checkout.
      'backend/supabase/functions/sync/device-login.test.ts',
      'backend/supabase/functions/sync/hardening.test.ts',
      // Same text-reading technique, applied to the Postgres ledger migration:
      // stock is unwritable except through the movement trigger, that trigger
      // adds rather than assigns, and an oversell is marked rather than refused.
      'backend/supabase/functions/sync/inventory-ledger.test.ts',
      // apps/admin's pure logic + service-role exposure guards. Framework-free:
      // nothing here imports Next or opens a Supabase connection.
      'apps/admin/lib/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    environment: 'node',
  },
});
