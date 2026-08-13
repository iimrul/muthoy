import { defineConfig } from 'vitest/config';

// Root Vitest config for pure framework-free code plus real node:sqlite DB
// verification. None import React Native, so no jest-expo transform is needed;
// component/screen code remains real-device validated.
export default defineConfig({
  test: {
    include: [
      'apps/mobile/domain/**/*.test.ts',
      'apps/mobile/db/errors.test.ts',
      'apps/mobile/db/notifications.sqlite.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    environment: 'node',
  },
});
