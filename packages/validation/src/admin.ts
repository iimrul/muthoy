import { z } from 'zod';

// Batch 3 §8.13 — the admin panel's write payloads and query shapes.
//
// They live HERE and not in apps/admin because
// docs/playbook/02-system-architecture.md:127 is explicit: "packages/validation
// — every Zod schema. A form in apps/mobile and any future admin-side write
// both import from here — never duplicated."
//
// An admin username is NOT a phone number and NOT an email. It is a key in the
// ADMIN_ROLES environment allowlist, and lib/adminRoles.ts already refuses a
// key with surrounding space, a reserved prototype name, or a case-duplicate.
// The schema enforces the same shape at the payload boundary so a malformed
// name is refused before it reaches a query, not after.
const adminUsername = z
  .string()
  .trim()
  .min(1, 'An admin username is required')
  .max(64, 'An admin username is at most 64 characters')
  .regex(/^\S+$/, 'An admin username contains no whitespace')
  .refine(
    (value) => value !== '__proto__' && value !== 'constructor' && value !== 'prototype',
    { message: 'That username is reserved' },
  );

/**
 * The four role names, duplicated nowhere: apps/admin asserts this list equals
 * ADMIN_ROLE_NAMES, so the two cannot drift.
 */
export const ADMIN_ROLE_NAME_VALUES = ['super_admin', 'billing', 'support', 'read_only'] as const;

export const adminRoleSchema = z.enum(ADMIN_ROLE_NAME_VALUES);

/**
 * Narrowing a role, and enabling or disabling the account, are one payload
 * because they are one row and one audited decision.
 */
export const adminRoleAssignmentUpdateSchema = z.object({
  username: adminUsername,
  role: adminRoleSchema,
  isActive: z.boolean(),
});

export const adminSessionRevocationSchema = z.object({
  username: adminUsername,
});

export type AdminRoleAssignmentUpdate = z.infer<typeof adminRoleAssignmentUpdateSchema>;
export type AdminSessionRevocation = z.infer<typeof adminSessionRevocationSchema>;
