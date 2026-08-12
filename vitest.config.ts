import { defineConfig } from 'vitest/config';

// Root Vitest config for the product's pure, framework-free code: apps/mobile's
// domain/ layer and every packages/*/src. None of these import React Native, so
// no jest-expo / RN transform is needed here — apps/mobile's component/screen
// code is exercised via real-device testing instead (CLAUDE.md's HUMAN REVIEW
// WORKFLOW), not this runner.
export default defineConfig({
  test: {
    include: ['apps/mobile/domain/**/*.test.ts', 'apps/mobile/db/errors.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
