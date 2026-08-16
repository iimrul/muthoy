import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Root Vitest config for pure framework-free code plus real node:sqlite DB
// verification. Screen code remains real-device validated; the one exception
// is the scanner modal's permission/error/Settings branches, which run under
// jsdom with React Native primitives stubbed at the module boundary (that
// file opts in via its own `@vitest-environment jsdom` docblock, so the
// default node environment below still applies everywhere else).
export default defineConfig({
  resolve: {
    alias: {
      './client': resolve(process.cwd(), 'apps/mobile/db/test/client.ts'),
      'expo-sqlite': resolve(process.cwd(), 'apps/mobile/db/test/expo-sqlite.ts'),
      'expo-crypto': resolve(process.cwd(), 'apps/mobile/db/test/expo-crypto.ts'),
    },
  },
  test: {
    server: { deps: { inline: ['expo-sqlite', 'expo-crypto'] } },
    include: [
      'apps/mobile/domain/**/*.test.ts',
      'apps/mobile/components/scanner/*.test.tsx',
      // ⚠️ TEMPORARY — remove with apps/mobile/dev/ (see dev/README.md).
      'apps/mobile/dev/*.test.ts',
      'apps/mobile/db/errors.test.ts',
      'apps/mobile/db/notifications.sqlite.test.ts',
      'apps/mobile/db/sync-helpers.order.test.ts',
      'apps/mobile/db/sync-helpers.sqlite.test.ts',
      'apps/mobile/sync/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    environment: 'node',
  },
});
