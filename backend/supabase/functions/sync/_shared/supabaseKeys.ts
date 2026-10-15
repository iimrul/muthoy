// H-9. Which Supabase API keys this Edge deployment uses, decided once.
//
// Supabase projects carry two key generations. Modern projects inject
// SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS as JSON dictionaries; the
// legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY JWTs are scheduled for
// removal. Which pair a deployment uses is an explicit server setting, never a
// fallback: MUTHOY_SUPABASE_KEY_MODE is `modern` (the default when unset) or
// `legacy` (the rollback), and a broken pair in the selected mode refuses to
// start instead of quietly trying the other generation.
//
// The expected project comes from MUTHOY_SUPABASE_PROJECT_REF, set from the
// approved deployment manifest — never from the URL that is being checked.
//
// Pure and runtime-neutral (no Deno, no imports) so Vitest executes it as-is.
// Every refusal carries a fixed code and a fixed message: the inputs are the
// deployment's credentials, and a thrown error lands in the function log.

export type SupabaseKeyMode = "modern" | "legacy";

export interface SupabaseKeys {
  /** Exactly `https://<projectRef>.supabase.co`. */
  url: string;
  projectRef: string;
  /** The NON-privileged key: modern publishable, or the legacy anon JWT. */
  publicKey: string;
  /** The privileged key: modern secret, or the legacy service_role JWT. */
  adminKey: string;
  mode: SupabaseKeyMode;
}

export const SUPABASE_KEY_CONFIGURATION_CODES = [
  "project_ref_invalid",
  "url_invalid",
  "key_mode_invalid",
  "publishable_keys_invalid",
  "secret_keys_invalid",
  "legacy_anon_key_invalid",
  "legacy_service_role_key_invalid",
] as const;

export type SupabaseKeyConfigurationCode = typeof SUPABASE_KEY_CONFIGURATION_CODES[number];

export class SupabaseKeyConfigurationError extends Error {
  readonly code: SupabaseKeyConfigurationCode;

  constructor(code: SupabaseKeyConfigurationCode) {
    super(`Supabase Edge configuration refused (${code})`);
    this.name = "SupabaseKeyConfigurationError";
    this.code = code;
  }
}

// Supabase project refs are twenty lower-case letters.
const PROJECT_REF = /^[a-z]{20}$/;
// The distinct prefixes are also what keeps a privileged key out of the
// public slot and vice versa: neither shape can match the other's pattern.
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;
const SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]{20,}$/;
const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/;

function refuse(code: SupabaseKeyConfigurationCode): never {
  throw new SupabaseKeyConfigurationError(code);
}

export function resolveSupabaseKeys(read: (name: string) => string | undefined): SupabaseKeys {
  const projectRef = read("MUTHOY_SUPABASE_PROJECT_REF");
  if (projectRef === undefined || !PROJECT_REF.test(projectRef)) refuse("project_ref_invalid");

  // Exact string equality rejects http, user info, ports, paths, queries,
  // fragments, case variants and every other domain without parsing anything.
  const url = `https://${projectRef}.supabase.co`;
  const injectedUrl = read("SUPABASE_URL");
  if (injectedUrl !== url && injectedUrl !== `${url}/`) refuse("url_invalid");

  const mode = keyMode(read("MUTHOY_SUPABASE_KEY_MODE"));
  if (mode === "legacy") {
    return {
      url,
      projectRef,
      publicKey: legacyKey(read("SUPABASE_ANON_KEY"), "anon", projectRef, "legacy_anon_key_invalid"),
      adminKey: legacyKey(
        read("SUPABASE_SERVICE_ROLE_KEY"),
        "service_role",
        projectRef,
        "legacy_service_role_key_invalid",
      ),
      mode,
    };
  }
  return {
    url,
    projectRef,
    publicKey: namedDefault(read("SUPABASE_PUBLISHABLE_KEYS"), PUBLISHABLE_KEY, "publishable_keys_invalid"),
    adminKey: namedDefault(read("SUPABASE_SECRET_KEYS"), SECRET_KEY, "secret_keys_invalid"),
    mode,
  };
}

function keyMode(value: string | undefined): SupabaseKeyMode {
  if (value === undefined) return "modern";
  if (value === "modern" || value === "legacy") return value;
  return refuse("key_mode_invalid");
}

/** The dictionary's own `default` entry — never "the first value". */
function namedDefault(
  raw: string | undefined,
  shape: RegExp,
  code: SupabaseKeyConfigurationCode,
): string {
  if (raw === undefined) refuse(code);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parser's message quotes the input; it is replaced, never chained.
    return refuse(code);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) refuse(code);
  if (!Object.prototype.hasOwnProperty.call(parsed, "default")) refuse(code);
  const value: unknown = (parsed as Record<string, unknown>).default;
  if (typeof value !== "string" || !shape.test(value)) refuse(code);
  return value;
}

/**
 * Classifies a legacy key by its payload's role and project ref. This decodes
 * the JWT; it does not verify its signature — the platform issued it, and
 * this only refuses a key of the wrong role or for the wrong project.
 */
function legacyKey(
  raw: string | undefined,
  role: "anon" | "service_role",
  projectRef: string,
  code: SupabaseKeyConfigurationCode,
): string {
  if (raw === undefined) refuse(code);
  const segments = raw.split(".");
  if (segments.length !== 3 || !segments.every((segment) => JWT_SEGMENT.test(segment))) refuse(code);
  const payload = decodePayload(segments[1], code);
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) refuse(code);
  const claims = payload as Record<string, unknown>;
  if (claims.role !== role || claims.ref !== projectRef) refuse(code);
  return raw;
}

function decodePayload(segment: string, code: SupabaseKeyConfigurationCode): unknown {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return refuse(code);
  }
}
