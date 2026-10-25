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

// Batch 3 §8.11 — presence, for the Settings page's diagnostics panel.
//
// IT LIVES HERE BECAUSE THIS IS THE ONE MODULE ALLOWED TO NAME THESE
// VARIABLES. serviceRoleExposure.test.ts asserts that exactly one module's
// source contains `SUPABASE_SERVICE_ROLE_KEY`, and that containment IS the
// guard — a settings module naming it to check whether it was set would be a
// second reader of the service-role key, which is the shape the guard exists to
// prevent. So the owner reports its own presence and lib/adminSettings.ts asks.
//
// PRESENCE, NEVER CONTENT. The returned objects carry a name and a boolean, and
// there is no field a value could be put in — a stronger guarantee than
// remembering not to put one there.
export const SUPABASE_ENV_NAMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function supabaseEnvDiagnostics(
  env: Record<string, string | undefined> = process.env,
): readonly { name: string; isSet: boolean }[] {
  return SUPABASE_ENV_NAMES.map((name) => ({
    name,
    isSet: (env[name] ?? '').trim().length > 0,
  }));
}
