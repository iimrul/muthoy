#!/usr/bin/env node
// N0 ACCOUNT INVENTORY — GET-only Supabase account capacity read.
//
// Scope: three account-scoped endpoints only (organizations list, projects list,
// organization detail). It never calls a project-scoped route, never issues a method
// other than GET, never writes, and never creates/pauses/deletes/transfers anything.
// It exists to answer one question: how many active Free project slots remain.
//
// Separate N0 custody: the PAT is read only from the clean child environment that
// the N0 launcher injects. The original A5 launcher and closure remain unchanged.
// This module never reads Credential Manager, never accepts a token on the command
// line, never puts a token in a URL, and never returns or prints one.
//
// EXECUTION IS GATED. main() refuses without an explicit --approval-id. Importing this
// module performs no I/O.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Refusal, refuse, sha256, assertEvidenceSafe, envRefusals, noReparse, TRUSTED } from './h9-a5-dev-readonly.mjs';
import { verifyN0Runtime, APPROVAL_ID } from './n0-runtime.mjs';

export const API_ORIGIN = 'https://api.supabase.com';
// Exactly three allowed reads. `organization` is parameterised by a slug that MUST have
// come from the account's own organizations listing (see assertKnownSlug).
export const ALLOWED_READS = Object.freeze(['organizations', 'projects', 'organization']);
// Supabase's documented account-wide Free allowance. Paused projects do not count, and a
// new organization does not raise it.
export const FREE_ACTIVE_LIMIT = 2;
// Refs that must never be mutated and whose status decides remaining capacity.
export const PROTECTED_REFS = Object.freeze({ [TRUSTED.ref]: 'DEV', jwjrijvprbsndukfhlvf: 'F12 rehearsal' });
// Unclassified states stay visible but cannot establish capacity.
//
// Only INACTIVE (paused) and REMOVED are documented as releasing the slot. Every other
// status counts, INCLUDING failure and transition states: a project stuck mid-pause or
// mid-restore may still hold quota, and UNKNOWN tells us nothing. Over-counting only
// delays work, while under-counting invites a create that fails after an approval was
// spent, so the bias here is deliberate and one-directional.
export const COUNTED_ACTIVE = Object.freeze(['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY', 'COMING_UP', 'INIT_READ_REPLICA', 'RESTORING', 'UPGRADING', 'PAUSING', 'RESIZING', 'RESTARTING', 'GOING_DOWN', 'PAUSE_FAILED', 'RESTORE_FAILED', 'UNKNOWN']);
export const NOT_COUNTED = Object.freeze(['INACTIVE', 'REMOVED']);
// Unknown plans remain unknown. Conservative potential-quota estimates are separate
// from the proven visible active-Free count.
export const PAID_PLANS = Object.freeze(['pro', 'team', 'enterprise']);
const SLUG = /^[A-Za-z0-9_-]{4,64}$/;
const REF = /^[a-z]{20}$/;
const MAJOR = /^(\d+)\./;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export function assertTokenShape(token) {
  if (typeof token !== 'string' || !/^sbp_[A-Za-z0-9_]{20,}$/.test(token)) refuse('n0-token-missing');
}

// The only URL builder. Anything not matching one of the three forms cannot be requested.
export function buildUrl(kind, slug) {
  if (!ALLOWED_READS.includes(kind)) refuse('n0-route');
  if (kind === 'organizations') return API_ORIGIN + '/v1/organizations';
  if (kind === 'projects') return API_ORIGIN + '/v1/projects';
  if (typeof slug !== 'string' || !SLUG.test(slug)) refuse('n0-slug');
  return API_ORIGIN + '/v1/organizations/' + slug;
}

// Defence in depth: re-parse the built URL and prove origin, scheme and path before use,
// so a future edit to buildUrl cannot silently reach another host or a project route.
export function assertAllowedUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { refuse('n0-url'); }
  if (parsed.protocol !== 'https:' || parsed.host !== 'api.supabase.com' || parsed.origin !== API_ORIGIN) refuse('n0-url-origin');
  if (parsed.search || parsed.hash || parsed.username || parsed.password) refuse('n0-url-extra');
  if (!/^\/v1\/organizations$|^\/v1\/projects$|^\/v1\/organizations\/[A-Za-z0-9_-]{4,64}$/.test(parsed.pathname)) refuse('n0-url-path');
  if (parsed.pathname.startsWith('/v1/projects/')) refuse('n0-project-scoped');
  return parsed.toString();
}

export function assertKnownSlug(slug, organizations) {
  if (!organizations.some(o => (o.slug ?? o.id) === slug)) refuse('n0-slug-unlisted');
}

export function getAdapter(token, fetcher = globalThis.fetch) {
  assertTokenShape(token);
  return async (kind, slug) => {
    const url = assertAllowedUrl(buildUrl(kind, slug));
    let response;
    try {
      response = await fetcher(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch { refuse('n0-transport'); }
    if (!record(response) || typeof response.status !== 'number') refuse('n0-response');
    // A 3xx with redirect:'error' already threw; this also refuses a fetcher that followed.
    if (response.redirected === true || (response.status >= 300 && response.status < 400)) refuse('n0-redirect');
    if (!response.ok) refuse('n0-status');
    let text;
    try { text = await response.text(); } catch { refuse('n0-body'); }
    if (typeof text !== 'string') refuse('n0-body');
    if (text.length > 4_000_000) refuse('n0-size');
    try { return JSON.parse(text); } catch { refuse('n0-json'); }
  };
}

// Output projection. Only these fields leave the executor; everything else the API returns
// (connection strings, hosts, JWT secrets, billing identifiers) is dropped, not redacted.
export function projectOrganization(o) {
  if (!record(o) || typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(o.id) || typeof o.name !== 'string') refuse('n0-organization-shape');
  const slug = o.slug ?? o.id;
  if (typeof slug !== 'string' || !SLUG.test(slug)) refuse('n0-slug');
  const plan = o.plan ?? null;
  if (plan !== null && typeof plan !== 'string') refuse('n0-organization-plan');
  return { id: o.id, slug, name: o.name, plan };
}

export function projectProject(p) {
  const ref = p?.ref ?? p?.id;
  if (!record(p) || typeof ref !== 'string' || !REF.test(ref) || typeof p.name !== 'string' || typeof p.organization_id !== 'string' || typeof p.status !== 'string') refuse('n0-project-shape');
  const version = p.database?.version ?? '';
  const major = MAJOR.exec(typeof version === 'string' ? version : '');
  return {
    ref,
    name: p.name,
    organizationId: p.organization_id,
    status: p.status,
    region: typeof p.region === 'string' ? p.region : null,
    postgresMajor: major ? Number(major[1]) : null,
    countsAgainstFreeLimit: NOT_COUNTED.includes(p.status) ? false : COUNTED_ACTIVE.includes(p.status) ? true : null,
    protectedRole: PROTECTED_REFS[ref] ?? null,
  };
}

export function summarise({ organizations, projects, details }) {
  if (!Array.isArray(organizations) || !Array.isArray(projects) || !record(details)) refuse('n0-inventory-shape');
  const orgs = organizations.map(projectOrganization);
  const ids = new Set(orgs.map(o => o.id));
  if (ids.size !== orgs.length) refuse('n0-organization-duplicate');
  if (new Set(orgs.map(o => o.slug)).size !== orgs.length) refuse('n0-organization-duplicate');
  const enriched = orgs.map(o => {
    const detail = details[o.slug];
    if (detail === undefined || detail === null) return { ...o, plan: null, planConfirmed: false, detailVisible: false };
    const d = projectOrganization(detail);
    if (d.id !== o.id) refuse('n0-organization-detail-mismatch');
    const known = typeof d.plan === 'string' && ['free', ...PAID_PLANS].includes(d.plan.trim().toLowerCase());
    const conflict = o.plan !== null && d.plan !== null && o.plan.trim().toLowerCase() !== d.plan.trim().toLowerCase();
    return { id: o.id, slug: o.slug, name: o.name, plan: d.plan, planConfirmed: known && !conflict, detailVisible: true };
  });
  const rows = projects.map(projectProject);
  if (new Set(rows.map(r => r.ref)).size !== rows.length) refuse('n0-project-duplicate');
  const orgOf = id => enriched.find(o => o.id === id);
  const isFree = id => orgOf(id)?.planConfirmed && orgOf(id).plan.trim().toLowerCase() === 'free';
  const activeFree = rows.filter(r => ['ACTIVE_HEALTHY', 'ACTIVE_UNHEALTHY'].includes(r.status) && isFree(r.organizationId));
  const missing = Object.keys(PROTECTED_REFS).filter(ref => !rows.some(r => r.ref === ref));
  // Neither presence of both witnesses nor a successful list response proves account
  // coverage, Owner/Admin membership, other members' quotas or creation eligibility.
  // The approved endpoints cannot close these gates. Never manufacture free capacity.
  const reasons = ['ACCOUNT_PROJECT_COVERAGE_UNVERIFIED', 'OWNER_ADMIN_MEMBERSHIP_UNVERIFIED', 'OTHER_MEMBERS_QUOTA_UNVERIFIED', 'CREATION_ELIGIBILITY_UNVERIFIED'];
  if (missing.length) reasons.push('KNOWN_PROJECT_MISSING');
  if (enriched.some(o => !o.planConfirmed)) reasons.push('ORGANIZATION_PLAN_UNVERIFIED');
  if (enriched.some(o => !o.detailVisible) || rows.some(r => !ids.has(r.organizationId))) reasons.push('ORGANIZATION_VISIBILITY_UNVERIFIED');
  if (rows.some(r => !COUNTED_ACTIVE.includes(r.status) && !NOT_COUNTED.includes(r.status))) reasons.push('PROJECT_STATUS_UNVERIFIED');
  const conservativeCount = rows.filter(r => r.countsAgainstFreeLimit !== false && (!orgOf(r.organizationId)?.planConfirmed || isFree(r.organizationId))).length;
  return {
    verdict: 'CAPACITY UNVERIFIED',
    organizations: enriched,
    projects: rows,
    freeActiveLimit: FREE_ACTIVE_LIMIT,
    provenVisibleActiveFreeCount: activeFree.length,
    accountActiveFreeCount: null,
    activeFreeRefs: activeFree.map(r => r.ref).sort(),
    conservativeVisiblePotentialFreeCount: conservativeCount,
    slotsAvailable: null,
    capacityConfidence: 'UNVERIFIED',
    capacityUnverifiedReasons: reasons,
    protectedRefsObserved: rows.filter(r => r.protectedRole).map(r => ({ ref: r.ref, role: r.protectedRole, status: r.status, countsAgainstFreeLimit: r.countsAgainstFreeLimit })),
    protectedRefsMissing: missing,
    // Slot arithmetic only. This is NOT a statement that creation will succeed.
    a2a3Feasibility: 'UNVERIFIED_NO_ALLOCATION',
    eligibilityUnverified: true,
    eligibilityCaveat: 'Slot arithmetic only. Account payment eligibility, and another Owner or Administrator having exhausted their own quota in a shared organization, can still refuse creation. This read cannot measure either.',
    founderDecisionRequired: true,
  };
}

export async function collectInventory({ api }) {
  const failures = [];
  const readList = async kind => {
    try {
      const value = await api(kind);
      if (Array.isArray(value)) return value;
    } catch { /* No raw transport messages reach evidence. */ }
    failures.push(kind === 'organizations' ? 'ORGANIZATION_LIST_UNVERIFIED' : 'PROJECT_LIST_UNVERIFIED');
    return [];
  };
  const organizations = await readList('organizations');
  const listed = organizations.map(projectOrganization);
  const details = Object.create(null);
  for (const o of listed) {
    assertKnownSlug(o.slug, listed);
    try { details[o.slug] = await api('organization', o.slug); }
    catch (error) {
      if (!(error instanceof Refusal)) refuse('n0-transport');
      details[o.slug] = null;
    }
  }
  const projects = await readList('projects');
  const result = summarise({ organizations, projects, details });
  result.capacityUnverifiedReasons.push(...failures);
  // The same sanitiser the A5 runtime uses: refuses if any credential shape or subscriber
  // number reached the output, including the bearer token itself.
  assertEvidenceSafe(result);
  return result;
}

export async function main(args = process.argv.slice(2)) {
  if (envRefusals(process.env).length) refuse('n0-environment');
  if (args.length !== 4 || args[0] !== '--approval-id' || args[2] !== '--evidence-root') refuse('n0-arguments');
  const approvalId = args[1];
  if (approvalId !== APPROVAL_ID) refuse('n0-approval-missing');
  if (!isAbsolute(args[3])) refuse('n0-arguments');
  noReparse(args[3]);
  // Separate N0 manifest and ACL verification. A5's file closure stays unchanged.
  const root = dirname(fileURLToPath(import.meta.url));
  if (resolve(args[3]) !== join(root, 'evidence')) refuse('n0-evidence-root');
  const runtime = verifyN0Runtime(root);
  const manifestHash = sha256(readFileSync(join(root, 'runtime-manifest.json')));
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
  assertTokenShape(token);
  const result = await collectInventory({ api: getAdapter(token) });
  verifyN0Runtime(root);
  if (sha256(readFileSync(join(root, 'runtime-manifest.json'))) !== manifestHash) refuse('n0-runtime-changed-during-read');
  result.approvalId = approvalId;
  result.capturedAtUtc = new Date().toISOString();
  result.runtime = { manifestSha256: manifestHash, files: runtime.files, workingTreeBaseCommit: runtime.workingTreeBaseCommit, runtimeFilesGitCommit: null, historicalSourceRevisionLabel: runtime.historicalSourceRevisionLabel };
  assertEvidenceSafe(result);
  const out = join(args[3], 'n0-' + randomUUID());
  mkdirSync(out);
  const bytes = JSON.stringify(result, null, 2) + '\n';
  writeFileSync(join(out, 'inventory.json'), bytes, { flag: 'wx' });
  writeFileSync(join(out, 'SHA256SUMS'), sha256(bytes) + '  inventory.json\n', { flag: 'wx' });
  console.log(JSON.stringify({ verdict: result.verdict, slotsAvailable: result.slotsAvailable, a2a3Feasibility: result.a2a3Feasibility, founderDecisionRequired: true, evidence: out }));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error('N0 REFUSED: ' + (error instanceof Refusal ? error.code : 'unexpected-error')); process.exitCode = 2; });
}
