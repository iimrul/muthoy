import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Root Vitest config for pure framework-free code plus real node:sqlite DB
// verification. None import React Native, so no jest-expo transform is needed;
// component/screen code remains real-device validated.
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
