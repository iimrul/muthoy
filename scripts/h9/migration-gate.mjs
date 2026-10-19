// Offline and callback-based application gate. No network client, CLI, credentials or automatic
// execution. A separately authorized executor MUST call this immediately before its one write.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateHostedPreflight, sqlHash } from '../h9-f12-hosted-preflight.mjs';
import { EXPECTED_HISTORY, assertGuard, SOURCE_REVISION } from './h9-a5-dev-readonly.mjs';
const PROTECTED = new Set(['btfprhticjgeihcngpif','jwjrijvprbsndukfhlvf']);
export const PRE34_HISTORY = Object.freeze([...EXPECTED_HISTORY,'20261008000000','20261008000100']);
export const M34 = '20261015000000';
export const M34_SHA256 = '0b949fa9db1aa6c9b01725e011b43e1aa61e7ee58dbe069c336ae65fdc26c580';
const hash = x => createHash('sha256').update(x).digest('hex');
function deny(code) { throw new Error(code); }
export function verifyMigrationBytes(bytes) {
  if (hash(bytes) !== M34_SHA256) deny('migration-bytes-drift');
}
export function validateTarget(target) {
  if (!target || !/^[a-z]{20}$/.test(target.projectRef ?? '') || PROTECTED.has(target.projectRef) || !['A2','A3'].includes(target.workstream) || typeof target.region !== 'string' || !target.region || typeof target.organizationId !== 'string' || !target.organizationId || typeof target.name !== 'string' || !target.name || target.sourceRevision !== SOURCE_REVISION || !target.approvalId || target.costCeiling !== 0) deny('unapproved-disposable-target');
}
export function assertMigration34Ready({target,evidence,history,currentFingerprint,observationApproval,now=Date.now()}) {
  validateTarget(target);
  if (!/^[a-f0-9]{32}$/.test(currentFingerprint ?? '') || !evidence || evidence.project?.name !== target.name || evidence.project?.organization_id !== target.organizationId || evidence.capture?.sqlSha256 !== sqlHash() || evidence.capture?.instanceFingerprint !== currentFingerprint) deny('preflight-binding');
  assertGuard(evidence.capture.guard,currentFingerprint);
  const at = Date.parse(evidence.capture.capturedAtUtc);
  if (!Number.isFinite(now) || !Number.isFinite(at) || now < at || now-at > 120_000) deny('preflight-stale');
  if (!Array.isArray(history) || JSON.stringify(history) !== JSON.stringify(PRE34_HISTORY)) deny('pre34-history');
  if (observationApproval?.projectRef !== target.projectRef || observationApproval?.evidenceSha256 !== hash(JSON.stringify(evidence)) || !observationApproval?.approvalId) deny('observations-not-approved');
  const verdict = evaluateHostedPreflight({projectRef:target.projectRef,region:target.region},evidence);
  if (!verdict.pass) deny('preflight-failed');
  return {projectRef:target.projectRef,version:M34,evidenceSha256:hash(JSON.stringify(evidence)),expiresAt:at+120_000};
}
export async function applyMigration34({target,evidence,history,observationApproval,readIdentity,apply,now=Date.now}) {
  // The last identity read and clock check precede the write; a stale receipt cannot authorize it.
  validateTarget(target);
  const live = await readIdentity(target.projectRef);
  if (live.projectRef !== target.projectRef || live.name !== target.name || live.organizationId !== target.organizationId || live.region !== target.region || live.status !== 'ACTIVE_HEALTHY') deny('live-target-changed');
  const verifiedAt = now();
  const permit = assertMigration34Ready({target,evidence,history,currentFingerprint:live.fingerprint,observationApproval,now:verifiedAt});
  const bytes = readFileSync(new URL('../../backend/supabase/migrations/20261015000000_h9_api_role_table_privileges.sql',import.meta.url));
  verifyMigrationBytes(bytes);
  const beforeWrite = now();
  if (!Number.isFinite(beforeWrite) || beforeWrite < verifiedAt || beforeWrite > permit.expiresAt) deny('preflight-expired-before-write');
  // Hash is included in the evidence receipt; executor must use these bytes and refuse a link
  // different from target. This callback never receives arbitrary SQL or a protected ref.
  return apply({projectRef:permit.projectRef,version:M34,sql:bytes,sqlSha256:hash(bytes),expiresAt:permit.expiresAt});
}
export function stageA2Plan(target) {
  validateTarget(target);
  return {target,stages:[{versions:PRE34_HISTORY,preflightRequired:false},{versions:[M34],preflightRequired:true,freshnessMs:120_000}],acceptance:['constraints','cron','api_role_privileges','history_post_h9']};
}
// Export the precise SQL identity so callers cannot substitute a different preflight file.
export const preflightSqlPath = fileURLToPath(new URL('../../backend/supabase/checks/h9_hosted_preflight.sql',import.meta.url));
