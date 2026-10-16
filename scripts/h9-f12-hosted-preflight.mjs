#!/usr/bin/env node
// Offline evaluation only. No network client, credentials, hosted execution or configuration writes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SQL_PATH = 'backend/supabase/checks/h9_hosted_preflight.sql';
export const ATTRIBUTES = ['superuser', 'bypassrls', 'replication', 'createrole', 'createdb', 'login'];
export const MANDATORY_CHECKS = [
  'api_roles_no_default_privileges', 'api_roles_keep_schema_usage', 'every_public_table_has_rls',
  'no_public_grants', 'api_role_column_grants_exact', 'no_public_default_privileges',
  'api_roles_no_grant_options', 'memberships_reach_no_privileges', 'supabase_admin_public_defaults_exact',
  'api_roles_cannot_create_in_public', 'public_relations_owned_by_postgres', 'api_roles_have_no_unsafe_attributes',
];
export const sqlHash = () => createHash('sha256').update(readFileSync(new URL('../' + SQL_PATH, import.meta.url))).digest('hex');
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const name = (x) => typeof x === 'string' && x.length > 0 && x.length < 128;

/**
 * Evidence is captured by the separately approved hosted read-only workflow, never by this module.
 * Expected identity is supplied independently from the approved target record, not inferred from SQL.
 * Observational values are retained privately in the evidence; the CLI prints no rolconfig values.
 */
export function evaluateHostedPreflight(expected, evidence) {
  const failures = [];
  const deny = (code) => { failures.push(code); };
  if (!record(expected) || !/^[a-z]{20}$/.test(expected.projectRef ?? '') || !name(expected.region)) {
    return { pass: false, failures: ['invalid-trusted-target'], observations: null };
  }
  if (!record(evidence) || !record(evidence.project) || !record(evidence.capture) || !record(evidence.snapshot)) {
    return { pass: false, failures: ['missing-evidence'], observations: null };
  }
  const { project, capture, snapshot } = evidence;
  if (project.id !== expected.projectRef || capture.projectRef !== expected.projectRef ||
      project.region !== expected.region || project.status !== 'ACTIVE_HEALTHY') deny('target-identity-mismatch');
  if (capture.sqlSha256 !== sqlHash() || capture.readOnly !== true) deny('unverified-read-only-capture');
  if (snapshot.version !== 1 || !record(snapshot.database) || snapshot.database.name !== 'postgres' ||
      !name(snapshot.database.owner) || !name(snapshot.database.publicSchemaOwner)) deny('invalid-database-inventory');
  if (snapshot.platformRolePresent !== true) deny('hosted-platform-role-absent');
  const checks = new Map();
  if (!Array.isArray(snapshot.checks)) deny('missing-checks');
  else for (const item of snapshot.checks) {
    if (!record(item) || !name(item.check_name) || typeof item.pass !== 'boolean' || checks.has(item.check_name)) {
      deny('invalid-or-duplicate-check'); continue;
    }
    checks.set(item.check_name, item);
  }
  for (const key of MANDATORY_CHECKS) if (checks.get(key)?.pass !== true) deny('failed:' + key);
  if (checks.get('supabase_admin_public_defaults_exact')?.detail !== 'missing=0,extra=0') deny('platform-profile-not-exact');

  const roles = new Map();
  if (!Array.isArray(snapshot.roles)) deny('missing-role-inventory');
  else for (const role of snapshot.roles) {
    if (!record(role) || !name(role.name) || roles.has(role.name)) { deny('invalid-role-inventory'); continue; }
    if (ATTRIBUTES.some((key) => typeof role[key] !== 'boolean')) deny('incomplete-role-attributes');
    if (ATTRIBUTES.some((key) => role[key] === true)) deny('unsafe-api-role-attribute');
    if (!Object.hasOwn(role, 'rolconfig') ||
        (role.rolconfig !== null && (!Array.isArray(role.rolconfig) || role.rolconfig.some((x) => typeof x !== 'string')))) {
      deny('missing-rolconfig-inventory');
    }
    roles.set(role.name, role);
  }
  const members = snapshot.memberships;
  const closure = new Set(['anon', 'authenticated']);
  if (!Array.isArray(members)) deny('missing-membership-inventory');
  else {
    for (const m of members) if (!record(m) || !name(m.member) || !name(m.role) || !name(m.grantor) ||
      ['admin', 'inherit', 'set'].some((key) => typeof m[key] !== 'boolean')) deny('invalid-membership-inventory');
    // Every option is counted, including a dead membership, matching the approved conservative policy.
    for (let prior = -1; prior !== closure.size;) {
      prior = closure.size;
      for (const m of members) if (record(m) && closure.has(m.member) && name(m.role)) closure.add(m.role);
    }
  }
  if (roles.size !== closure.size || [...closure].some((r) => !roles.has(r))) deny('incomplete-reachable-role-inventory');
  if (!Array.isArray(snapshot.publications)) deny('missing-publication-inventory');
  else for (const p of snapshot.publications) {
    if (!record(p) || !name(p.name) || typeof p.allTables !== 'boolean' || !Array.isArray(p.schemas) ||
        p.schemas.some((s) => !name(s)) || !Array.isArray(p.tables) ||
        p.tables.some((t) => !record(t) || !name(t.schema) || !name(t.table))) deny('invalid-publication-inventory');
  }
  return {
    pass: failures.length === 0, failures: [...new Set(failures)],
    enforced: MANDATORY_CHECKS.map((key) => ({ name: key, pass: checks.get(key)?.pass === true, enforcedByMigration: true })),
    observations: {
      database: snapshot.database, roles: snapshot.roles, memberships: members, publications: snapshot.publications,
      // Reports require hosted review; no new publication, ownership, membership or GUC policy is introduced.
      reviewRequired: true,
    },
  };
}

export function main(argv = process.argv.slice(2), output = console.log) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--expected-project-ref', '--expected-region', '--evidence'].includes(argv[i]) ||
        !argv[i + 1] || Object.hasOwn(args, argv[i])) {
      output(JSON.stringify({ pass: false, failures: ['invalid-arguments'] })); return 1;
    }
    args[argv[i]] = argv[i + 1];
  }
  try {
    const evidence = JSON.parse(readFileSync(args['--evidence'], 'utf8'));
    const result = evaluateHostedPreflight({ projectRef: args['--expected-project-ref'], region: args['--expected-region'] }, evidence);
    output(JSON.stringify({
      pass: result.pass, failures: result.failures, enforced: result.enforced,
      observationalReviewRequired: result.observations?.reviewRequired ?? true,
      inventoryCounts: result.observations ? {
        roles: result.observations.roles.length, memberships: result.observations.memberships.length,
        publications: result.observations.publications.length,
      } : null,
    }));
    return result.pass ? 0 : 1;
  } catch {
    output(JSON.stringify({ pass: false, failures: ['unreadable-evidence'] })); return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();

