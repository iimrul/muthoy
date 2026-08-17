import 'server-only';

import { AdminConfigError } from './errors';

// The ONLY module in apps/admin that reads the service-role key out of the
// environment. `server-only` makes importing it from a 'use client' file a
// BUILD failure, and the variable is deliberately NOT prefixed NEXT_PUBLIC_,
// so Next never inlines it into a browser bundle (Volume 5's one rule).

export interface SupabaseServerConfig {
  url: string;
  serviceRoleKey: string;
}

function requireServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AdminConfigError(`Missing required server environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseServerConfig(): SupabaseServerConfig {
  return {
    url: requireServerEnv('SUPABASE_URL'),
    serviceRoleKey: requireServerEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
