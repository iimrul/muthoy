// A2/A3 EXECUTION ADAPTER — interfaces and exact target guards only.
//
// This module supplies the two callbacks `applyMigration34` in ./migration-gate.mjs
// requires (`readIdentity`, `apply`) and nothing else. It contains NO transport: every
// hosted operation is an injected callback, so importing or calling anything here cannot
// reach the network, a database, the CLI or a child process. That property is asserted by
// the focused tests, which refuse any non-`node:` import in this file.
//
// It does not relax, duplicate or re-derive any reviewed gate. `validateTarget`,
// `assertMigration34Ready`, `verifyMigrationBytes` and `M34_SHA256` are imported from the
// reviewed gate and used unchanged; the guards below are strictly additional.
import { validateTarget, assertMigration34Ready, M34, M34_SHA256, PRE34_HISTORY, verifyMigrationBytes } from './migration-gate.mjs';
import { EXPECTED_HISTORY, TRUSTED, refuse, sha256 } from './h9-a5-dev-readonly.mjs';

// The two versions A3 commits before the separately pinned 34.
export const M32 = '20261008000000';
export const M33 = '20261008000100';
// Never a migration target under any workstream.
export const PROTECTED_REFS = Object.freeze([TRUSTED.ref, 'jwjrijvprbsndukfhlvf']);
export const REF = /^[a-z]{20}$/;
const FINGERPRINT = /^[a-f0-9]{32}$/;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Exact target guard. Delegates to the reviewed `validateTarget` first so this can only
// ever be stricter, then re-states the protected-ref refusal independently: a future edit
// to either layer alone still cannot target DEV or the rehearsal.
export function assertDisposableTarget(target) {
  validateTarget(target);
  if (!REF.test(target.projectRef ?? '')) refuse('a2a3-target-ref');
  if (PROTECTED_REFS.includes(target.projectRef)) refuse('a2a3-target-protected');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/.test(target.approvalId ?? '')) refuse('a2a3-target-approval');
  if (target.costCeiling !== 0) refuse('a2a3-target-cost');
  return target;
}

// `readIdentity` for applyMigration34. Two injected readers: the project metadata read and
// the in-session instance fingerprint. Both are supplied by the approved executor; this
// module performs no I/O of its own.
export function makeReadIdentity({ readProject, readFingerprint }) {
  if (typeof readProject !== 'function' || typeof readFingerprint !== 'function') refuse('a2a3-reader-missing');
  return async projectRef => {
    if (!REF.test(projectRef ?? '')) refuse('a2a3-identity-ref');
    if (PROTECTED_REFS.includes(projectRef)) refuse('a2a3-identity-protected');
    const p = await readProject(projectRef);
    if (!record(p) || p.id !== projectRef) refuse('a2a3-identity-mismatch');
    if (typeof p.name !== 'string' || !p.name || typeof p.organization_id !== 'string' || !p.organization_id) refuse('a2a3-identity-shape');
    if (typeof p.region !== 'string' || !/^[a-z]{2}(?:-[a-z]+){1,2}-\d$/.test(p.region)) refuse('a2a3-identity-region');
    if (p.status !== 'ACTIVE_HEALTHY') refuse('a2a3-identity-status');
    // A2/A3 exist to prove the chain on PostgreSQL 17; a different major is not the target.
    if (!/^17\./.test(p.database?.version ?? '')) refuse('a2a3-identity-postgres-major');
    const fingerprint = await readFingerprint(projectRef);
    if (!FINGERPRINT.test(fingerprint ?? '')) refuse('a2a3-identity-fingerprint');
    return { projectRef: p.id, name: p.name, organizationId: p.organization_id, region: p.region, status: p.status, fingerprint };
  };
}

// `apply` for applyMigration34. The reviewed gate has already bound the permit, read the
// live identity and checked the clock before calling this; these guards re-verify the
// request independently so a drifted or replayed request cannot reach the injected writer.
export function makeApply({ push, now = Date.now }) {
  if (typeof push !== 'function') refuse('a2a3-writer-missing');
  return async request => {
    if (!record(request)) refuse('a2a3-apply-request');
    const { projectRef, version, sql, sqlSha256, expiresAt } = request;
    if (!REF.test(projectRef ?? '')) refuse('a2a3-apply-ref');
    if (PROTECTED_REFS.includes(projectRef)) refuse('a2a3-apply-protected');
    if (version !== M34) refuse('a2a3-apply-version');
    // Only migration 34's exact reviewed bytes can pass. Both the declared hash and the
    // bytes themselves are checked, so neither alone can authorize a substitution.
    if (sqlSha256 !== M34_SHA256) refuse('a2a3-apply-sql-hash');
    verifyMigrationBytes(sql);
    if (sha256(sql) !== sqlSha256) refuse('a2a3-apply-sql-bytes');
    const at = now();
    if (!Number.isFinite(at) || !Number.isFinite(expiresAt) || at > expiresAt) refuse('a2a3-apply-expired');
    const receipt = await push({ projectRef, version, sql, sqlSha256 });
    // The writer must report the ref it actually linked to and the version it actually
    // applied. A receipt that does not name this exact target is not acceptance.
    if (!record(receipt)) refuse('a2a3-receipt');
    if (receipt.linkedProjectRef !== projectRef) refuse('a2a3-receipt-link');
    if (receipt.appliedVersion !== version) refuse('a2a3-receipt-version');
    if (receipt.applied !== true) refuse('a2a3-receipt-not-applied');
    return { projectRef, version, sqlSha256, appliedAt: at, receipt };
  };
}

// A3 is the historical-upgrade rehearsal: restore a DEV schema dump, prove the authentic
// 31-version history, commit 32 and 33, then a FRESH preflight and separately pinned 34.
// A later stage failing never implies an earlier stage rolled back.
export function stageA3Plan(target) {
  assertDisposableTarget(target);
  if (target.workstream !== 'A3') refuse('a2a3-plan-workstream');
  return {
    target,
    stages: Object.freeze([
      // Authentic source history is restored, never synthesised. The comparator's
      // assertAuthenticHistory is the acceptance check for this stage.
      { kind: 'restore-baseline', versions: [], preflightRequired: false, expectHistoryAfter: [...EXPECTED_HISTORY], authenticHistoryRequired: true },
      { kind: 'migrate', versions: [M32, M33], preflightRequired: false, expectHistoryAfter: [...PRE34_HISTORY] },
      { kind: 'migrate', versions: [M34], preflightRequired: true, freshnessMs: 120_000, expectHistoryAfter: [...PRE34_HISTORY, M34] },
    ]),
    acceptance: ['historical_upgrade_from_dev_dump', 'constraints', 'cron', 'api_role_privileges', 'history_post_h9'],
    rollbackImplied: false,
  };
}

// Stage result guard: the executor must have pushed exactly the staged versions and the
// resulting history must match exactly. A superset, a subset or a reorder all refuse.
export function assertStageResult(stage, result) {
  if (!record(stage) || !record(result)) refuse('a2a3-stage-shape');
  if (!equal(result.pushedVersions ?? null, stage.versions)) refuse('a2a3-stage-pushed');
  if (!equal(result.historyAfter ?? null, stage.expectHistoryAfter)) refuse('a2a3-stage-history');
  if (stage.preflightRequired && result.preflightEvidenceSha256 === undefined) refuse('a2a3-stage-preflight-missing');
  return true;
}

// Convenience binding used by the approved executor: proves the permit with the reviewed
// gate, then hands the request to the guarded writer. No transport, no credentials.
export async function prepareMigration34({ target, evidence, history, currentFingerprint, observationApproval, now = Date.now() }) {
  assertDisposableTarget(target);
  return assertMigration34Ready({ target, evidence, history, currentFingerprint, observationApproval, now });
}
