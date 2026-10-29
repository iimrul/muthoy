/** The environment allowlist and management actions must name the same accounts. */
export function isAdminUsername(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0 && value.length <= 64
    && /^\S+$/.test(value)
    // PostgreSQL text rejects NUL and JSON rejects unpaired UTF-16 surrogates.
    // In Unicode mode a valid surrogate pair is one code point outside this range.
    && !/[\u0000\uD800-\uDFFF]/u.test(value)
    && value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}
