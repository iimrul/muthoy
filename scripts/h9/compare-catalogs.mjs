#!/usr/bin/env node
// Strict offline A3 comparator. Does not run SQL, mutate history, or contact a project.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const KINDS = Object.freeze(['schema','relation','column','column_acl','function','policy','constraint','index','trigger','default_acl','role','membership','extension','publication','event_trigger','history','cron','type','rule']);
export const FORMAT = 'muthoy-h9-catalog-v1';
export const REQUIRED_FIELDS = Object.freeze({
  schema:['owner','acl'],relation:['kind','owner','rls','forceRls','acl','serviceRoleAcl','persistence','replicaIdentity','options','partition','partitionKey','parents','view','sequence','sequenceOwnership','foreign'],
  column:['position','type','notNull','default','identity','generated','collation','storage','compression'],column_acl:['acl'],
  function:['definition','owner','definer','config','language','volatility','parallel','strict','leakproof','acl','serviceRoleAcl'],
  policy:['command','permissive','roles','using','check'],constraint:['type','definition','validated','deferrable','deferred','noInherit'],
  index:['definition','valid','ready','unique','primary','nullsNotDistinct'],trigger:['definition','enabled'],default_acl:['acl'],
  role:['superuser','inherit','createRole','createDb','login','replication','bypassRls','connectionLimit','config'],membership:['admin','inherit','set'],
  extension:['version','schema','owner'],publication:['allTables','insert','update','delete','truncate','tables'],event_trigger:['event','function','enabled','owner','tags'],
  history:['name','statementsNull','statementsDigest'],cron:['profile'],type:['definition'],rule:['definition','enabled'],
});
const own = (o,k) => Object.hasOwn(o,k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const BOOLS=new Set(['rls','forceRls','notNull','definer','strict','leakproof','permissive','validated','deferrable','deferred','noInherit','valid','ready','unique','primary','nullsNotDistinct','superuser','inherit','createRole','createDb','login','replication','bypassRls','admin','set','allTables','insert','update','delete','truncate','statementsNull']);
const ARRAYS=new Set(['acl','serviceRoleAcl','parents','sequenceOwnership','roles','tables']);
const NULL_ARRAYS=new Set(['options','sequence','foreign','config','tags']);
const NULL_STRINGS=new Set(['default','partition','partitionKey','view','collation','using','check','name','statementsDigest']);
function deny(code) { throw new Error(code); }
export function canonical(x) {
  if (x === null || typeof x === 'boolean' || typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))) return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (!object(x)) deny('invalid-value');
  return '{' + Object.keys(x).sort().map(k => JSON.stringify(k)+':'+canonical(x[k])).join(',') + '}';
}
export const digest = x => createHash('sha256').update(canonical(x)).digest('hex');
export function validateCapture(capture) {
  if (!object(capture) || capture.format !== FORMAT || !object(capture.identity) || !/^[a-z]{20}$/.test(capture.identity.projectRef ?? '') || !/^[a-f0-9]{32}$/.test(capture.identity.instanceFingerprint ?? '') || capture.identity.postgresMajor !== 17 || !Array.isArray(capture.rows) || !Array.isArray(capture.coverage) || canonical([...capture.coverage].sort()) !== canonical([...KINDS].sort())) deny('unsupported-catalog-format');
  const map = new Map();
  for (const row of capture.rows) {
    if (!object(row) || canonical(Object.keys(row).sort()) !== canonical(['key','kind','value']) || !KINDS.includes(row.kind) || typeof row.key !== 'string' || !row.key || row.key.includes('\0') || !object(row.value)) deny('invalid-catalog-row');
    const id = row.kind + '\0' + row.key;
    if (map.has(id)) deny('duplicate-catalog-object');
    if (REQUIRED_FIELDS[row.kind].some(k=>!own(row.value,k))) deny('incomplete-catalog-object');
    for(const field of REQUIRED_FIELDS[row.kind]){
      const value=row.value[field];let valid;
      if(BOOLS.has(field))valid=typeof value==='boolean';
      else if(field==='acl'&&row.kind==='schema')valid=typeof value==='string';
      else if(ARRAYS.has(field))valid=Array.isArray(value);
      else if(NULL_ARRAYS.has(field))valid=value===null||Array.isArray(value);
      else if(NULL_STRINGS.has(field))valid=value===null||typeof value==='string';
      else if(['position','connectionLimit'].includes(field))valid=Number.isInteger(value);
      else if(field==='profile'||(field==='definition'&&row.kind==='type'))valid=object(value);
      else valid=typeof value==='string';
      if(!valid)deny('invalid-catalog-field-type');
    }
    if(row.kind==='function'&&!/^[a-f0-9]{32}$/.test(row.value.definition))deny('invalid-function-digest');
    if(row.kind==='cron'&&(typeof row.value.profile.present!=='boolean'||(row.value.profile.present&&!Array.isArray(row.value.profile.jobs))))deny('invalid-cron-profile');
    if (row.kind==='history'&&(!/^\d{14}$/.test(row.key)||typeof row.value.statementsNull!=='boolean'||(row.value.statementsNull?row.value.statementsDigest!==null:!/^[a-f0-9]{32}$/.test(row.value.statementsDigest??'')))) deny('invalid-history-object');
    canonical(row.value);
    map.set(id,row);
  }
  if (!capture.rows.some(r => r.kind === 'schema' && r.key === 'public') || !capture.rows.some(r => r.kind === 'history') || !capture.rows.some(r => r.kind === 'cron' && r.key === 'pg_cron')) deny('incomplete-catalog-capture');
  return map;
}
export function assertAuthenticHistory(rows, sourceRows) {
  const history = input => input.filter(r => r.kind === 'history').sort((a,b) => a.key.localeCompare(b.key));
  if (canonical(history(rows)) !== canonical(history(sourceRows))) deny('historical-metadata-not-authentic');
}
function allowedNormalization(n) {
  if (n.kind === 'extension' && n.field === 'version') return true;
  if (n.kind === 'cron' && n.key === 'pg_cron' && n.field === 'profile') return true;
  if (['relation','function'].includes(n.kind) && n.field === 'serviceRoleAcl') return true;
  if (n.kind === 'history' && ['20260905000000','20260923000000'].includes(n.key) && ['statementsDigest','statementsNull'].includes(n.field)) return true;
  return ['event_trigger\0rls_auto_enable', 'function\0public.ensure_rls()'].includes(n.kind+'\0'+n.key) && n.field === '$object';
}
export function compareCatalogs(left, right, normalization = []) {
  const a = validateCapture(left), b = validateCapture(right);
  if (!Array.isArray(normalization)) deny('invalid-normalization');
  const approved = new Map();
  for (const n of normalization) {
    if (!object(n) || !allowedNormalization(n) || typeof n.approvalId !== 'string' || !n.approvalId.trim() || typeof n.reason !== 'string' || !n.reason.trim() || !/^[a-f0-9]{64}$/.test(n.leftSha256 ?? '') || !/^[a-f0-9]{64}$/.test(n.rightSha256 ?? '')) deny('unapproved-normalization');
    const id = n.kind+'\0'+n.key+'\0'+n.field;
    if (approved.has(id)) deny('duplicate-normalization');
    approved.set(id,n);
  }
  const differences = [], normalized = [], used = new Set();
  function differs(kind,key,field,l,r) {
    if (canonical(l) === canonical(r)) return;
    const id = kind+'\0'+key+'\0'+field, permit = approved.get(id);
    if (permit && permit.leftSha256 === digest(l) && permit.rightSha256 === digest(r)) { used.add(id); normalized.push({kind,key,field,approvalId:permit.approvalId}); }
    else differences.push({kind,key,field,leftSha256:digest(l),rightSha256:digest(r)});
  }
  for (const id of [...new Set([...a.keys(),...b.keys()])].sort()) {
    const x = a.get(id), y = b.get(id), row = x ?? y;
    if (!x || !y) differs(row.kind,row.key,'$object',x?.value ?? null,y?.value ?? null);
    else for (const field of [...new Set([...Object.keys(x.value),...Object.keys(y.value)])].sort()) {
      if (!own(x.value,field)||!own(y.value,field)) differences.push({kind:row.kind,key:row.key,field,leftSha256:digest({present:own(x.value,field),value:x.value[field]??null}),rightSha256:digest({present:own(y.value,field),value:y.value[field]??null})});
      else differs(row.kind,row.key,field,x.value[field],y.value[field]);
    }
  }
  if ([...approved.keys()].some(k => !used.has(k))) deny('unused-or-stale-normalization');
  return { pass: differences.length === 0, differences, normalized, objectCounts: {left:a.size,right:b.size} };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length < 4 || process.argv.length > 5) deny('arguments');
    const read = p => JSON.parse(readFileSync(p,'utf8'));
    const result = compareCatalogs(read(process.argv[2]),read(process.argv[3]),process.argv[4]?read(process.argv[4]):[]);
    console.log(JSON.stringify(result,null,2)); process.exitCode = result.pass ? 0 : 1;
  } catch { console.error('CATALOG COMPARISON REFUSED: invalid-input-or-normalization'); process.exitCode=2; }
}
