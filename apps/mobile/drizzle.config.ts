import type { Config } from 'drizzle-kit';

// drizzle-kit config — used ONLY at development time to generate migration
// files from db/schema.ts. Never bundled into the app.
// Regenerate after any schema change:  pnpm --filter @muthoy/mobile db:generate
// Migration files are never hand-edited after being committed; a schema change
// is always a NEW migration (DEVELOPMENT_RULES.md).
export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
