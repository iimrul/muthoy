// Bypasses vitest.config.ts's exact "./client" SQLite-suite alias so H-3 can
// execute the real single-flight/retry client initialization path.
export * from '../client';
