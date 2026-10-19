import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
// Test-only dependency. The protected runtime never imports it: comment-ness is
// established here, out of band, and recorded in the runtime as byte hash + offsets.
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import * as a5 from '../h9-a5-dev-readonly.mjs';
import { compareCatalogs, KINDS, FORMAT, REQUIRED_FIELDS, digest, assertAuthenticHistory } from '../compare-catalogs.mjs';
import { applyMigration34, assertMigration34Ready, stageA2Plan, PRE34_HISTORY, verifyMigrationBytes, M34_SHA256 } from '../migration-gate.mjs';
import * as evaluator from '../../h9-f12-hosted-preflight.mjs';
import {validateRecovery,rollbackPlan} from '../recovery-contract.mjs';
import {makeCheckpoint,CLI,ORDER,expectedArgv,assertStagedOutsideRepository} from '../source-checkpoint.mjs';

const preflightSql = readFileSync('backend/supabase/checks/h9_hosted_preflight.sql','utf8');
const sections = a5.splitSections(readFileSync('backend/supabase/checks/h9_postmigration_checks.sql','utf8'));
const clock = 1_800_000_000_000;
const clone = x => structuredClone(x);
const guard = () => ({role:a5.TRUSTED.role,session_role:a5.TRUSTED.sessionRole,database:'postgres',transaction_read_only:'on',server_version_num:'170011',instance_fingerprint:'1'.repeat(32)});
const project = () => ({id:a5.TRUSTED.ref,name:a5.TRUSTED.name,organization_id:a5.TRUSTED.organization,region:'ap-southeast-1',status:'ACTIVE_HEALTHY',database:{version:'17.11.0'}});
const rawAuth = () => ({external_phone_enabled:true,external_anonymous_users_enabled:false,external_email_enabled:true,sms_otp_length:6,sms_otp_exp:300,sms_max_frequency:60,hook_send_sms_enabled:true,hook_send_sms_uri:`https://${a5.TRUSTED.ref}.supabase.co/functions/v1/auth-send-sms`,hook_custom_access_token_enabled:true,hook_custom_access_token_uri:'pg-functions://postgres/public/custom_access_token_hook',sms_test_otp:'+8801700000001=111111'});
const snapshot = () => ({version:1,database:{name:'postgres',owner:'postgres',publicSchemaOwner:'postgres'},platformRolePresent:true,checks:evaluator.MANDATORY_CHECKS.map(check_name=>({check_name,pass:true,detail:check_name==='supabase_admin_public_defaults_exact'?'missing=0,extra=0':''})),roles:['anon','authenticated'].map(name=>({name,...Object.fromEntries(evaluator.ATTRIBUTES.map(k=>[k,false])),rolconfig:null})),memberships:[],publications:[]});
function fixture(mutate = () => {}) {
  const f = {project:project(),guard:guard(),functions:clone(a5.FUNCTIONS),auth:rawAuth(),snapshot:snapshot(),calls:[],queryCount:0};
  mutate(f);
  f.api = async (kind,sql) => {
    f.calls.push(kind);
    if(kind==='project')return f.project;
    if(kind==='functions')return f.functions;
    if(kind==='secrets')return [{name:'SEND_SMS_HOOK_SECRET'}];
    if(kind==='auth')return f.auth;
    f.queryCount++;
    let rows=[];
    if(sql.includes('select version, name'))rows=a5.EXPECTED_HISTORY.map(version=>({version,name:'synthetic-fixture'}));
    else if(sql.includes(preflightSql.trim().replace(/;\s*$/,'')))rows=[{snapshot:f.snapshot}];
    else if(sql.includes("extname='pg_cron'"))rows=[{present:false}];
    else for(const [name,text] of sections)if(sql.includes(text.trim().replace(/;\s*$/,'')))rows=a5.SECTION_CHECKS[name]?.map(check_name=>({check_name,pass:true,detail:''}))??[];
    const g=clone(f.guard); f.guardAt?.(g,f.queryCount);
    return [{a5:{guard:g,rows}}];
  };
  return f;
}
const collect = f => a5.collectA5({api:f.api,sections,preflightSql,evaluate:evaluator.evaluateHostedPreflight,now:()=>clock});

test('healthy inventory stays checkpoint pending, never falsely A5 PASS',async()=>{
  const f=fixture(), result=await collect(f);
  assert.match(result.verdict,/CHECKPOINT PENDING/);assert.equal(result.checkpointStatus,'PENDING HOSTED VERIFICATION');
  assert.equal(f.queryCount,9);assert.equal(JSON.stringify(result.auth).includes('111111'),false);
});
for(const [field,value] of [['role','postgres'],['session_role','postgres'],['database','wrong_database'],['transaction_read_only','off'],['instance_fingerprint',undefined],['instance_fingerprint','bad'],['server_version_num','180006']])test('rejects guard '+field+'='+value,async()=>{
  const f=fixture(f=>{f.guard[field]=value;});await assert.rejects(collect(f),e=>e.code==='database-identity');assert.equal(f.queryCount,1);
});
test('rejects instance restart in the middle of observation',async()=>{
  const f=fixture(f=>{f.guardAt=(g,n)=>{if(n===4)g.instance_fingerprint='2'.repeat(32);};});
  await assert.rejects(collect(f),e=>e.code==='instance-changed');
});
for(const field of ['id','name','organization_id','status','region'])test('refuses project '+field+' before SQL',async()=>{
  const f=fixture(f=>{f.project[field]='wrong';});await assert.rejects(collect(f));assert.equal(f.queryCount,0);
});
for(const [field,value] of [['version',1],['status','INACTIVE'],['verify_jwt',false]])test('refuses deployed sync '+field,async()=>{
  const f=fixture(f=>{f.functions[0][field]=value;});await assert.rejects(collect(f),e=>e.code==='function-state');
});
test('unexpected function inventory refuses without serializing arbitrary metadata',async()=>{
  const f=fixture(f=>{f.functions.push({slug:'unexpected',version:{private:'must-not-serialize'}});});
  await assert.rejects(collect(f),e=>e.code==='function-inventory');
});
for(const field of ['hook_send_sms_uri','hook_custom_access_token_uri'])test('refuses foreign hook '+field,async()=>{
  const f=fixture(f=>{f.auth[field]='https://foreign.invalid/hook?secret=private';});await assert.rejects(collect(f),e=>e.code==='auth-configuration');
});
test('missing/null/malformed OTP data refuses; redaction excludes values',()=>{
  for(const map of [null,{},'not-a-map'])assert.throws(()=>a5.redactAuthSettings({...rawAuth(),sms_test_otp:map}));
  const a=rawAuth();delete a.sms_test_otp;assert.throws(()=>a5.redactAuthSettings(a));
  const text=JSON.stringify(a5.redactAuthSettings({...rawAuth(),smtp_pass:'DO_NOT_PRINT'}));
  for(const forbidden of ['8801700000001','111111','DO_NOT_PRINT'])assert.ok(!text.includes(forbidden));
});
test('exact sections reject partial, duplicate and renamed checks',()=>{
  const rows=a5.SECTION_CHECKS.constraints.map(check_name=>({check_name,pass:true,detail:''}));
  a5.assertSection('constraints',rows);
  for(const malformed of [rows.slice(1),[...rows,rows[0]],rows.map((r,i)=>i===0?{...r,check_name:'invented'}:r)])assert.throws(()=>a5.assertSection('constraints',malformed));
});
test('refuses startup variables case insensitively and before transport',()=>{
  for(const key of ['NODE_OPTIONS','node_options','NODE_PATH','NODE_EXTRA_CA_CERTS','NODE_USE_ENV_PROXY','OPENSSL_CONF','PGHOST','pgpassword','HTTPS_PROXY'])assert.equal(a5.envRefusals({[key]:'synthetic'}).length,1);
  assert.deepEqual(a5.envRefusals({NODE_TLS_REJECT_UNAUTHORIZED:'1'}),[]);
});
test('transport pins DEV, read_only, redirects and sanitized errors',async()=>{
  let sent;
  const call=a5.apiAdapter('SYNTHETIC',async(url,init)=>{sent={url,init};return {ok:true,text:async()=>'[]'};});
  await call('query','select 1');assert.equal(sent.url,`https://api.supabase.com/v1/projects/${a5.TRUSTED.ref}/database/query`);
  assert.equal(JSON.parse(sent.init.body).read_only,true);assert.equal(sent.init.redirect,'error');
  await assert.rejects(call('foreign-project'));
  await assert.rejects(a5.apiAdapter('SYNTHETIC',async()=>{throw new Error('SYNTHETIC_SECRET');})('project'),e=>e.code==='api-transport'&&!e.message.includes('SECRET'));
});
test('protected input hashes match approved SQL and sole evaluator has built-in closure',()=>{
  for(const [path,pin] of Object.entries(a5.PINNED_INPUTS))assert.equal(a5.sha256(readFileSync(path)),pin);
  const source=readFileSync('scripts/h9/h9-a5-dev-readonly.mjs','utf8');
  assert.equal([...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].every(m=>m[1].startsWith('node:')),true);
  assert.ok(!source.includes('D:/Muthoy/scripts/'));
});
test('local source hashes and entrypoints never prove hosted checkpoint provenance',()=>{
  const directory=resolve('audit-artifacts/h9-remediation/checkpoint-'+randomUUID());mkdirSync(directory,{recursive:true});
  const files=a5.FUNCTIONS.map(f=>{mkdirSync(resolve(directory,f.slug),{recursive:true});const path=resolve(directory,f.slug,'index.ts');writeFileSync(path,'// synthetic source '+f.slug);return {slug:f.slug,path,sha256:a5.sha256(readFileSync(path))};});
  const cp={version:1,projectRef:a5.TRUSTED.ref,sourceRevision:a5.SOURCE_REVISION,capturedAtUtc:new Date(clock).toISOString(),functions:clone(a5.FUNCTIONS),functionsBefore:clone(a5.FUNCTIONS),directory,files};
  assert.equal(a5.verifyCheckpoint(cp,clone(a5.FUNCTIONS),clock),'LOCAL FILE INVENTORY VERIFIED — HOSTED PROVENANCE UNVERIFIED');
  assert.throws(()=>a5.verifyCheckpoint({...cp,files:files.slice(1)},clone(a5.FUNCTIONS),clock));
  assert.throws(()=>a5.verifyCheckpoint({...cp,files:files.map(f=>({...f,sha256:'0'.repeat(64)}))},clone(a5.FUNCTIONS),clock));
});

test('renaming unrelated text to index.ts cannot produce an A5 PASS',async()=>{
  const directory=resolve('audit-artifacts/h9-remediation/unrelated-checkpoint-'+randomUUID());
  const files=a5.FUNCTIONS.map(({slug})=>{mkdirSync(resolve(directory,slug),{recursive:true});const path=resolve(directory,slug,'index.ts');writeFileSync(path,'unrelated harmless text');return {slug,path,sha256:a5.sha256(readFileSync(path))};});
  const cp={version:1,projectRef:a5.TRUSTED.ref,sourceRevision:a5.SOURCE_REVISION,capturedAtUtc:new Date(clock).toISOString(),functions:clone(a5.FUNCTIONS).sort((a,b)=>a.slug.localeCompare(b.slug)),functionsBefore:clone(a5.FUNCTIONS).sort((a,b)=>a.slug.localeCompare(b.slug)),directory,files};
  const f=fixture();
  const result=await a5.collectA5({api:f.api,sections,preflightSql,evaluate:evaluator.evaluateHostedPreflight,checkpoint:cp,now:()=>clock});
  assert.match(result.checkpointStatus,/HOSTED PROVENANCE UNVERIFIED/);
  assert.equal(result.verdict,'A5 INVENTORY PASS — CHECKPOINT PENDING');
});

function gateFixture() {
  const target={projectRef:'abcdefghijklmnopqrst',region:'ap-southeast-1',organizationId:'synthetic-org',name:'synthetic-A2',workstream:'A2',sourceRevision:a5.SOURCE_REVISION,approvalId:'fixture-approval',costCeiling:0};
  const evidence={project:{id:target.projectRef,name:target.name,organization_id:target.organizationId,region:target.region,status:'ACTIVE_HEALTHY'},capture:{projectRef:target.projectRef,sqlSha256:evaluator.sqlHash(),readOnly:true,guard:guard(),capturedAtUtc:new Date(clock).toISOString(),instanceFingerprint:guard().instance_fingerprint},snapshot:snapshot()};
  const observationApproval={projectRef:target.projectRef,approvalId:'fixture-observations',evidenceSha256:a5.sha256(JSON.stringify(evidence))};
  return {target,evidence,observationApproval,history:[...PRE34_HISTORY],currentFingerprint:guard().instance_fingerprint,now:clock};
}
test('A2 plan separates 1–33 and mandatory preflight → 34',()=>{
  const plan=stageA2Plan(gateFixture().target);assert.equal(plan.stages[0].versions.length,33);assert.deepEqual(plan.stages[1].versions,['20261015000000']);assert.equal(plan.stages[1].preflightRequired,true);
});
test('migration 34 never calls write on absent/failed/stale/future/wrong-instance evidence',async()=>{
  for(const alter of [f=>{f.evidence=null;},f=>{f.evidence.snapshot.checks[0].pass=false;},f=>{f.now=clock+120001;},f=>{f.now=clock-1;},f=>{f.currentFingerprint='2'.repeat(32);},f=>{f.history.pop();},f=>{f.observationApproval=null;}]) {
    const f=gateFixture();alter(f);let writes=0;
    if(f.evidence&&f.observationApproval)f.observationApproval.evidenceSha256=a5.sha256(JSON.stringify(f.evidence));
    await assert.rejects(applyMigration34({...f,now:()=>f.now,readIdentity:async()=>({projectRef:f.target.projectRef,name:f.target.name,organizationId:f.target.organizationId,region:f.target.region,status:'ACTIVE_HEALTHY',fingerprint:f.currentFingerprint}),apply:async()=>{writes++;}}));assert.equal(writes,0);
  }
});
test('migration target refuses DEV and protected rehearsal',()=>{
  for(const projectRef of ['btfprhticjgeihcngpif','jwjrijvprbsndukfhlvf'])assert.throws(()=>stageA2Plan({...gateFixture().target,projectRef}));
});
test('valid preflight passes exact history and observational approval checks',()=>assert.equal(assertMigration34Ready(gateFixture()).version,'20261015000000'));

test('missing live fingerprint and invalid clocks cannot authorize migration 34',()=>{
  for(const currentFingerprint of [null,undefined,'','not-a-fingerprint']){
    const f=gateFixture();f.currentFingerprint=currentFingerprint;f.evidence.capture.instanceFingerprint=currentFingerprint;
    f.observationApproval.evidenceSha256=a5.sha256(JSON.stringify(f.evidence));
    assert.throws(()=>assertMigration34Ready(f),/preflight-binding/);
  }
  assert.throws(()=>assertMigration34Ready({...gateFixture(),now:NaN}),/preflight-stale/);
});

test('migration 34 uses only independently pinned bytes and a still-fresh clock',async()=>{
  const bytes=readFileSync('backend/supabase/migrations/20261015000000_h9_api_role_table_privileges.sql');
  verifyMigrationBytes(bytes);assert.throws(()=>verifyMigrationBytes(Buffer.concat([bytes,Buffer.from('\n-- drift')])));
  for(const secondClock of [clock-1,clock+120001,NaN]){
    const f=gateFixture();let reads=0,writes=0;
    await assert.rejects(applyMigration34({...f,now:()=>++reads===1?clock:secondClock,readIdentity:async()=>({projectRef:f.target.projectRef,name:f.target.name,organizationId:f.target.organizationId,region:f.target.region,status:'ACTIVE_HEALTHY',fingerprint:f.currentFingerprint}),apply:async()=>{writes++;}}),/preflight-expired-before-write/);
    assert.equal(writes,0);
  }
  const f=gateFixture();let calls=0;
  await applyMigration34({...f,now:()=>clock,readIdentity:async()=>({projectRef:f.target.projectRef,name:f.target.name,organizationId:f.target.organizationId,region:f.target.region,status:'ACTIVE_HEALTHY',fingerprint:f.currentFingerprint}),apply:async permit=>{calls++;assert.equal(permit.projectRef,f.target.projectRef);assert.equal(permit.sqlSha256,M34_SHA256);assert.deepEqual(permit.sql,bytes);}});
  assert.equal(calls,1); // Callback is a memory-only witness; no database adapter exists here.
});

const values={kind:'r',owner:'postgres',rls:true,forceRls:false,acl:[],serviceRoleAcl:[],persistence:'p',replicaIdentity:'d',options:null,partition:null,partitionKey:null,parents:[],view:null,sequence:null,sequenceOwnership:[],foreign:null,position:1,type:'bigint',notNull:true,default:null,identity:'',generated:'',collation:null,storage:'p',compression:'',definer:false,config:null,language:'sql',volatility:'v',parallel:'u',strict:false,leakproof:false,command:'*',permissive:true,roles:['authenticated'],using:null,check:null,validated:true,deferrable:false,deferred:false,noInherit:false,valid:true,ready:true,unique:false,primary:false,nullsNotDistinct:false,enabled:'O',superuser:false,inherit:false,createRole:false,createDb:false,login:false,replication:false,bypassRls:false,connectionLimit:-1,admin:false,set:false,version:'1',schema:'public',allTables:false,insert:true,update:true,delete:true,truncate:true,tables:[],event:'ddl_command_end',function:'public.fixture()',tags:null};
const catalog = () => ({format:FORMAT,identity:{projectRef:'abcdefghijklmnopqrst',instanceFingerprint:'1'.repeat(32),postgresMajor:17},coverage:[...KINDS],rows:[{kind:'schema',key:'public',value:{owner:'postgres',acl:''}},{kind:'history',key:'20260905000000',value:{name:'b4',statementsNull:true,statementsDigest:null}},{kind:'cron',key:'pg_cron',value:{profile:{present:false}}},...KINDS.filter(k=>!['schema','history','cron'].includes(k)).map(kind=>({kind,key:'synthetic.'+kind,value:Object.fromEntries(REQUIRED_FIELDS[kind].map(k=>[k,k==='definition'?(kind==='function'?'a'.repeat(32):kind==='type'?{}:'synthetic definition'):clone(values[k])]))}))]});
test('old nested snapshots and raw arrays cannot compare equal',()=>{
  for(const input of [{snapshot:{body:'A'}},[{snapshot:{body:'A'}}],[],{...catalog(),coverage:[]}])assert.throws(()=>compareCatalogs(input,input));
});
test('every captured object kind detects changed/removed/added objects',()=>{
  for(const kind of KINDS) {
    const a=catalog(),b=clone(a),row=b.rows.find(r=>r.kind===kind);row.value.changed=true;
    assert.equal(compareCatalogs(a,b).pass,false,kind+' changed');
    if(!['schema','history','cron'].includes(kind)){const c=clone(a);c.rows=c.rows.filter(r=>r.kind!==kind);assert.equal(compareCatalogs(a,c).pass,false,kind+' removed');assert.equal(compareCatalogs(c,a).pass,false,kind+' added');}
  }
});

test('missing field never equals a present JSON missing-marker object',()=>{
  const a=catalog(),b=clone(a);
  b.rows.find(r=>r.kind==='function').value.extra={$missing:true};
  assert.equal(compareCatalogs(a,b).pass,false);
  assert.equal(compareCatalogs(b,a).pass,false);
});
test('duplicate rows, missing fields and incompatible PostgreSQL refuse',()=>{
  const a=catalog();for(const bad of [{...a,rows:[...a.rows,a.rows[0]]},{...a,identity:{...a.identity,postgresMajor:18}},{...a,rows:[{kind:'function',key:'x'}]}])assert.throws(()=>compareCatalogs(a,bad));
});
test('normalization requires exact reviewed hashes and cannot ignore RLS/body/schema',()=>{
  const a=catalog(),b=clone(a),row=b.rows.find(r=>r.kind==='extension');row.value.version='different';
  const permit={kind:'extension',key:row.key,field:'version',leftSha256:digest('1'),rightSha256:digest('different'),approvalId:'fixture-only',reason:'explicit minor extension difference'};
  assert.equal(compareCatalogs(a,b,[permit]).pass,true);
  assert.throws(()=>compareCatalogs(a,a,[permit]));
  assert.throws(()=>compareCatalogs(a,b,[{...permit,field:'definition'}]));
  assert.equal(compareCatalogs(a,b,[]).pass,false);
});
test('authentic history retains NULL, names and original statement digest',()=>{
  const a=catalog().rows;assertAuthenticHistory(a,clone(a));
  const b=clone(a);b.find(r=>r.kind==='history').value.statementsNull=false;
  assert.throws(()=>assertAuthenticHistory(b,a));
});
test('pre/post deployment rollback are distinct; deployed code always keeps DEV ref and explicit legacy',()=>{
  const previous={projectRef:a5.TRUSTED.ref,mode:'absent',refWasPresent:false};
  const before=rollbackPlan({deployed:false,previous});assert.equal(before.unsetProjectRef,true);
  const after=rollbackPlan({deployed:true,previous,checkpointAccepted:true});
  assert.equal(after.projectRef,a5.TRUSTED.ref);assert.equal(after.keyMode,'legacy');assert.equal(after.unsetProjectRef,false);assert.equal(after.unsetMode,false);assert.deepEqual(after.redeploy,['auth-send-sms','sync']);
  assert.throws(()=>rollbackPlan({deployed:true,previous,checkpointAccepted:false}));
});
function recoveryFixture(){
  const contents=Buffer.from('SYNTHETIC BACKUP CONTRACT TEST ONLY');
  const kinds=['database','roles','extensions','sourceCatalog','sourceValues','sourceLedger','authScope','storageRecovery','settingsHooks','functionSources'];
  const manifest={version:1,projectRef:a5.TRUSTED.ref,sourcePostgresMajor:17,dumpToolMajor:17,approvalId:'fixture-only',capturedAtUtc:new Date(clock).toISOString(),retentionUntilUtc:new Date(clock+86400000).toISOString(),recoveryOwner:'fixture-owner',rpoAgreement:'fixture-zero',rtoAgreement:'fixture-record',trafficPaused:true,privateAclVerified:true,storageEncrypted:true,files:kinds.map(kind=>({kind,path:'MEMORY_ONLY/'+kind,sha256:a5.sha256(contents)}))};
  const proof={version:1,backupManifestSha256:a5.sha256(JSON.stringify(manifest)),approvalId:'fixture-only',target:{kind:'isolated-local-pg17',host:'127.0.0.1',port:55437,database:'h9_restore_fixture',postgresMajor:17,emptyBeforeRestore:true,networkIsolated:true},results:Object.fromEntries(['restoreExitZero','extensionsExact','rolesOwnersAclsExact','schemaExact','foreignKeysValid','stockInvariantExact','integerPaisaExact','authScopeVerified','storageRecoveryApproved','settingsHooksRecoveryApproved'].map(k=>[k,true])),before:{catalog:'a'.repeat(64),values:'b'.repeat(64),ledger:'c'.repeat(64)},after:{catalog:'a'.repeat(64),values:'b'.repeat(64),ledger:'c'.repeat(64)},elapsedSeconds:1,completedAtUtc:new Date(clock+1000).toISOString()};
  return {manifest,proof,read:()=>contents};
}
test('PG18 restore, wrong target, changed values and incomplete backup cannot satisfy H5',()=>{
  const good=recoveryFixture();assert.equal(validateRecovery(good.manifest,good.proof,good.read).pass,true);
  for(const alter of [f=>{f.proof.target.postgresMajor=18;},f=>{f.proof.target.host='dev.supabase.co';},f=>{f.proof.after.values='0'.repeat(64);},f=>{f.manifest.files.pop();},f=>{f.proof.results.foreignKeysValid=false;},f=>{f.manifest.dumpToolMajor=18;},f=>{f.manifest.trafficPaused=false;}]){const f=recoveryFixture();alter(f);assert.throws(()=>validateRecovery(f.manifest,f.proof,f.read));}
});
test('every restore acceptance check independently refuses a failure',()=>{
  for(const name of Object.keys(recoveryFixture().proof.results)){const f=recoveryFixture();f.proof.results[name]=false;assert.throws(()=>validateRecovery(f.manifest,f.proof,f.read));}
});

test('restore completion time must be a real timestamp after backup capture',()=>{
  for(const completedAtUtc of ['not-a-date','',null,new Date(clock-1).toISOString()]){
    const f=recoveryFixture();f.proof.completedAtUtc=completedAtUtc;
    assert.throws(()=>validateRecovery(f.manifest,f.proof,f.read),/restore-time/);
  }
});
test('supplemental PG18/PGlite SQL capture detects schema drift and absent cron (not PG17 restore proof)',async()=>{
  const db=new PGlite();
  try {
    const version=await db.query("select current_setting('server_version_num')::int as n");assert.ok(version.rows[0].n>=180000&&version.rows[0].n<190000);
    await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]); insert into supabase_migrations.schema_migrations values('20260905000000','synthetic_fixture',null); create table public.fixture(id integer primary key,amount bigint not null check(amount>=0)); create index fixture_amount on public.fixture(amount); create function public.fixture_guard() returns trigger language plpgsql as $$begin return new; end$$; create trigger fixture_trigger before update on public.fixture for each row execute function public.fixture_guard();");
    await db.exec("create type public.fixture_state as enum('original');");
    const sql=readFileSync('scripts/h9/catalog-fingerprint.sql','utf8');
    // Synthetic comparator envelope; this local engine is explicitly PG18 supplemental only.
    const capture=async()=>({...catalog(),rows:(await db.query(sql)).rows});
    const before=await capture();assert.equal(before.rows.find(r=>r.kind==='cron').value.profile.present,false);
    assert.equal(compareCatalogs(before,before).pass,true);
    for(const ddl of ['alter table public.fixture alter column amount drop not null','drop index public.fixture_amount','drop trigger fixture_trigger on public.fixture','alter table public.fixture drop constraint fixture_amount_check',"alter type public.fixture_state add value 'changed'",'create rule fixture_rule as on delete to public.fixture do instead nothing']) {
      await db.exec('begin;'+ddl);const after=await capture();assert.equal(compareCatalogs(before,after).pass,false,ddl);await db.exec('rollback');
    }
  } finally {await db.close();}
});

// --- Corrected A5 source-capture staging (F5 follow-up) ---------------------
// `--workdir` is a Supabase PROJECT directory, so the CLI writes to
// <stagingRoot>/supabase/functions/<slug>/. The checkpoint input is that functions
// directory, it may never be a repository path, and a download is only acceptable
// with its own provenance record.
const CLI_PATH = resolve(homedir(),'.muthoy-h9-pinned-cli','supabase.exe');
const stagingFixture = (mutate=()=>{}) => {
  const root=join(homedir(),'.muthoy-h9-checkpoint-tests-'+randomUUID());
  const directory=join(root,'supabase','functions');
  const functions=clone(a5.FUNCTIONS).sort((a,b)=>a.slug.localeCompare(b.slug));
  const declared=functions.map(f=>{
    mkdirSync(join(directory,f.slug),{recursive:true});
    const path=join(directory,f.slug,'index.ts');
    writeFileSync(path,`// downloaded ${f.slug}`);
    return {slug:f.slug,version:f.version,status:f.status,verify_jwt:f.verify_jwt,entrypoint:'index.ts',files:[{path,sha256:a5.sha256(readFileSync(path))}]};
  });
  const receipt=at=>({identity:{id:a5.TRUSTED.ref},sourceRevision:a5.SOURCE_REVISION,functions,databaseGuard:guard(),preflight:{capture:{capturedAtUtc:new Date(at).toISOString()}}});
  // Two sequential, non-overlapping downloads inside the two capture times.
  const commands=ORDER.map((slug,index)=>({slug,argv:expectedArgv(CLI_PATH,slug,root),startedAtUtc:new Date(clock-54_000+index*6_000).toISOString(),completedAtUtc:new Date(clock-50_000+index*6_000).toISOString()}));
  const f={root,directory,before:receipt(clock-60_000),after:receipt(clock-30_000),provenance:{version:2,projectRef:a5.TRUSTED.ref,cliPath:CLI_PATH,cliVersion:CLI.version,cliSha256:CLI.sha256,useApi:true,stagingRoot:root,deployedBefore:functions,deployedAfter:functions,commands,functions:declared}};
  mutate(f);
  return f;
};
const stage = f => makeCheckpoint(f.directory,f.before,f.after,f.provenance,clock);

test('corrected staging path yields a checkpoint that is still hosted-UNVERIFIED',()=>{
  const f=stagingFixture(),result=stage(f);
  assert.equal(result.directory,resolve(f.root,'supabase','functions'));
  assert.equal(result.provenance.hostedProvenanceVerified,false);
  assert.equal(result.provenance.cliVersion,'2.117.0');
  assert.equal(a5.verifyCheckpoint(result,f.after.functions,clock),'LOCAL FILE INVENTORY VERIFIED — HOSTED PROVENANCE UNVERIFIED');
  assert.equal(result.files.length,2);
});

test('a repository path can never be the source-capture directory',()=>{
  for(const inside of ['.','backend','backend/supabase/functions','audit-artifacts/h9-remediation/stage','scripts/h9'])
    assert.throws(()=>assertStagedOutsideRepository(resolve(inside)),/checkpoint-directory-inside-repository/,inside);
  assert.throws(()=>assertStagedOutsideRepository('backend/supabase/functions'),/checkpoint-directory-relative/);
  const f=stagingFixture();
  for(const directory of [resolve('backend/supabase/functions'),resolve('.'),resolve('audit-artifacts')])
    assert.throws(()=>makeCheckpoint(directory,f.before,f.after,f.provenance,clock),/checkpoint-directory-inside-repository/);
});

test('a staging root inside any git work tree refuses',()=>{
  const root=join(homedir(),'.muthoy-h9-checkpoint-tests-'+randomUUID());
  mkdirSync(join(root,'.git'),{recursive:true});
  const directory=join(root,'nested','supabase','functions');
  mkdirSync(directory,{recursive:true});
  assert.throws(()=>assertStagedOutsideRepository(directory),/checkpoint-directory-source-tree/);
});

test('the checkpoint directory must be exactly <stagingRoot>/supabase/functions',()=>{
  // The staging root itself also holds config.toml and .temp/, which are not source.
  for(const wrong of [f=>f.directory=f.root,f=>f.directory=join(f.root,'supabase'),f=>f.provenance.stagingRoot=join(f.root,'supabase')]) {
    const f=stagingFixture(wrong);
    assert.throws(()=>stage(f),/provenance-staging-mismatch|checkpoint-unexpected-function|ENOENT/);
  }
});

test('download provenance is mandatory and pinned to the reviewed CLI and DEV ref',()=>{
  assert.throws(()=>stage(stagingFixture(f=>f.provenance=null)),/provenance-identity/);
  assert.throws(()=>stage(stagingFixture(f=>f.provenance=undefined)),/provenance-identity/);
  for(const mutate of [
    f=>f.provenance.version=1,
    f=>f.provenance.version=3,
    f=>f.provenance.projectRef='jwjrijvprbsndukfhlvf',
    f=>f.provenance.cliVersion='2.121.0',
    f=>f.provenance.cliSha256='0'.repeat(64),
    f=>f.provenance.useApi=false,
    f=>delete f.provenance.useApi,
  ]) assert.throws(()=>stage(stagingFixture(mutate)),/provenance-identity/);
  for(const mutate of [f=>delete f.provenance.cliPath,f=>f.provenance.cliPath='supabase.exe'])
    assert.throws(()=>stage(stagingFixture(mutate)),/provenance-cli-path/);
  assert.throws(()=>stage(stagingFixture(f=>f.provenance.stagingRoot='relative/path')),/provenance-staging-root/);
});

test('BOTH download commands are required, in order, with the exact flags',()=>{
  for(const mutate of [
    f=>delete f.provenance.commands,
    f=>f.provenance.commands=[f.provenance.commands[0]],
    f=>f.provenance.commands=[...f.provenance.commands,f.provenance.commands[0]],
    f=>f.provenance.commands='functions download',
  ]) assert.throws(()=>stage(stagingFixture(mutate)),/provenance-commands/);
  // auth-send-sms first, or a slug that is not in the order at all.
  for(const mutate of [
    f=>f.provenance.commands.reverse(),
    f=>f.provenance.commands[0].slug='auth-send-sms',
    f=>f.provenance.commands[1].slug='payment-webhook',
    f=>delete f.provenance.commands[0].slug,
  ]) assert.throws(()=>stage(stagingFixture(mutate)),/provenance-command-order/);
  // Each argv must be exactly the reviewed command: nothing missing, swapped or extra.
  for(const mutate of [
    f=>f.provenance.commands[0].argv=f.provenance.commands[0].argv.filter(a=>a!=='--use-api'),
    f=>f.provenance.commands[0].argv=f.provenance.commands[0].argv.filter(a=>a!=='--project-ref'),
    f=>f.provenance.commands[0].argv=f.provenance.commands[0].argv.filter(a=>a!==a5.TRUSTED.ref),
    f=>f.provenance.commands[0].argv=expectedArgv(CLI_PATH,'sync',f.root).map(a=>a===a5.TRUSTED.ref?'jwjrijvprbsndukfhlvf':a),
    f=>f.provenance.commands[0].argv=expectedArgv(CLI_PATH,'sync',resolve('backend')),
    f=>f.provenance.commands[1].argv=expectedArgv(CLI_PATH,'sync',f.root),
    f=>f.provenance.commands[0].argv=[...expectedArgv(CLI_PATH,'sync',f.root),'--debug'],
    f=>f.provenance.commands[0].argv=expectedArgv('C:\\other\\supabase.exe','sync',f.root),
    f=>f.provenance.commands[0].argv=expectedArgv(CLI_PATH,'sync',f.root).join(' '),
    f=>delete f.provenance.commands[0].argv,
  ]) assert.throws(()=>stage(stagingFixture(mutate)),/provenance-command/);
  // The positive control proves the exact argv is reachable, not merely strict.
  const ok=stagingFixture(),result=stage(ok);
  assert.deepEqual(result.provenance.commands.map(c=>c.slug),['sync','auth-send-sms']);
  assert.deepEqual(result.provenance.commands[0].argv,expectedArgv(CLI_PATH,'sync',ok.root));
  assert.deepEqual(result.provenance.order,['sync','auth-send-sms']);
});

test('both downloads must fall sequentially between the two actual A5 captures',()=>{
  for(const mutate of [
    f=>f.provenance.commands[0].startedAtUtc=new Date(clock-120_000).toISOString(),
    f=>f.provenance.commands[1].completedAtUtc=new Date(clock).toISOString(),
    f=>f.provenance.commands[0].startedAtUtc='not-a-date',
    f=>delete f.provenance.commands[1].completedAtUtc,
    // completed before started
    f=>{const c=f.provenance.commands[0];[c.startedAtUtc,c.completedAtUtc]=[c.completedAtUtc,c.startedAtUtc];},
    // auth-send-sms overlapping or preceding sync's download
    f=>f.provenance.commands[1].startedAtUtc=new Date(clock-58_000).toISOString(),
  ]) assert.throws(()=>stage(stagingFixture(mutate)),/provenance-window/);
});

test('provenance preserves both the pre and post deployed inventories',()=>{
  for(const mutate of [
    f=>delete f.provenance.deployedBefore,
    f=>delete f.provenance.deployedAfter,
    f=>f.provenance.deployedAfter=[f.provenance.deployedAfter[0]],
    f=>f.provenance.deployedBefore=f.provenance.deployedBefore.map(x=>({...x,version:x.version+1})),
    f=>f.provenance.deployedAfter=f.provenance.deployedAfter.map(x=>({...x,status:'REMOVED'})),
  ]) assert.throws(()=>stage(stagingFixture(mutate)),/provenance-deployed/);
  const result=stage(stagingFixture());
  assert.deepEqual(result.provenance.deployedBefore,result.provenance.deployedAfter);
  assert.equal(result.provenance.deployedAfter.length,2);
});

test('provenance must match the actually deployed versions and both entrypoints',()=>{
  for(const mutate of [
    f=>f.provenance.functions[0].version=99,
    f=>f.provenance.functions[0].status='REMOVED',
    f=>f.provenance.functions[0].verify_jwt=!f.provenance.functions[0].verify_jwt,
    f=>f.provenance.functions[0].slug='payment-webhook',
  ]) assert.throws(()=>stage(stagingFixture(mutate)),/provenance-version/);
  for(const mutate of [
    f=>f.provenance.functions[0].entrypoint='main.ts',
    f=>f.provenance.functions[0].files=[],
    f=>f.provenance.functions[1].slug=f.provenance.functions[0].slug,
  ]) assert.throws(()=>stage(stagingFixture(mutate)),/provenance-entrypoint|provenance-version/);
  for(const mutate of [f=>f.provenance.functions=[f.provenance.functions[0]],f=>f.provenance.functions='two'])
    assert.throws(()=>stage(stagingFixture(mutate)),/provenance-functions/);
});

test('every downloaded byte must be declared with its own hash, and nothing extra',()=>{
  assert.throws(()=>stage(stagingFixture(f=>f.provenance.functions[0].files[0].sha256='0'.repeat(64))),/provenance-file-hash/);
  assert.throws(()=>stage(stagingFixture(f=>f.provenance.functions[0].files[0].sha256='short')),/provenance-file/);
  assert.throws(()=>stage(stagingFixture(f=>f.provenance.functions[0].files[0].path='relative.ts')),/provenance-file/);
  // An undeclared dependency file left on disk must not slip through.
  assert.throws(()=>stage(stagingFixture(f=>writeFileSync(join(f.directory,f.provenance.functions[0].slug,'deps.ts'),'// undeclared'))),/provenance-file-count/);
  // A declared file outside its own slug tree is refused before hashing.
  assert.throws(()=>stage(stagingFixture(f=>f.provenance.functions[0].files.push({path:join(f.root,'outside.ts'),sha256:'1'.repeat(64)}))),/provenance-file-outside-slug/);
  assert.throws(()=>stage(stagingFixture(f=>f.provenance.functions[0].files.push({...f.provenance.functions[0].files[0]}))),/provenance-file-duplicate/);
});

test('the capture procedure and its runbook agree on the corrected destination',()=>{
  const source=readFileSync('scripts/h9/source-checkpoint.mjs','utf8');
  assert.match(source,/process\.argv\.length!==7/);
  const runbook=readFileSync('backend/supabase/deploy/H9-LOCAL-REMEDIATION.md','utf8');
  // The original defect: --workdir described as the download destination.
  assert.doesNotMatch(runbook,/--workdir <private-download-workdir>/);
  assert.match(runbook,/supabase\\functions/);
  assert.match(runbook,/new-download-staging\.ps1/);
  assert.ok(runbook.includes('Supabase PROJECT directory')||runbook.includes('project directory'));
  // The sequential state machine and both commands must be documented, in order.
  for(const token of ['-Stage provision','pre-download','post-download','-Stage complete','download-staging.test.ps1'])
    assert.ok(runbook.includes(token),token);
  assert.ok(runbook.indexOf('download sync')<runbook.indexOf('download auth-send-sms'),'sync is documented before auth-send-sms');
});

// --- Source vs evidence scanning scopes (H1 checkpoint guard) ----------------
// The deployed `sync` source documents phone canonicalization with the standard
// example subscriber, and a single strict guard treated those comments like leaked
// evidence. Source bytes now have their own scope: every credential check is retained,
// and the example is admitted only in the EXACT pinned bytes of an approved file at its
// lexer-verified offsets.
//
// A line-prefix comment test was tried first and is unsound. Three witnesses break it:
// `/* done */ const x = "+<n>"` opens with a block marker but is code; a line starting
// `*` inside a template literal is data; a continuation line starting `*` is
// multiplication. Deciding comment-ness needs a real lexer, which the protected runtime
// may not depend on — so the TypeScript scanner runs HERE and the result is pinned.
// `refuse()` keeps a generic message and carries the reason on .code, while
// source-checkpoint.mjs throws plain Errors whose message IS the reason; assert the
// exact reason either way so a test can never pass on the wrong refusal.
const refusesWith = (code,fn,label) => assert.throws(fn,error=>error.code===code||error.message===code,label??code);
const APPROVED_SOURCES = {
  'sync/_shared/phone.ts':'backend/supabase/functions/sync/_shared/phone.ts',
  'sync/deviceLogin.ts':'backend/supabase/functions/sync/deviceLogin.ts',
};
const PHONE = /\+?8801\d{9}/g;
// The example literal is read out of the repository, never hardcoded here, so this
// suite introduces no subscriber-shaped data of its own.
const APPROVED_EXAMPLE = readFileSync(APPROVED_SOURCES['sync/_shared/phone.ts'],'utf8').match(PHONE)[0].replace(/^\+/,'');
const approvedBytes = key => readFileSync(APPROVED_SOURCES[key]);
// Genuine comment ranges per the TypeScript lexer.
function commentRanges(text){
  const scanner=ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,text);
  const ranges=[];
  for(;;){
    const token=scanner.scan();
    if(token===ts.SyntaxKind.EndOfFileToken)break;
    if(token===ts.SyntaxKind.SingleLineCommentTrivia||token===ts.SyntaxKind.MultiLineCommentTrivia)
      ranges.push([scanner.getTokenStart?scanner.getTokenStart():scanner.getTokenPos(),scanner.getTokenEnd?scanner.getTokenEnd():scanner.getTextPos()]);
  }
  return ranges;
}
const everyMatchInComment = text => {
  const ranges=commentRanges(text);
  return [...text.matchAll(PHONE)].every(m=>ranges.some(([s,e])=>m.index>=s&&m.index+m[0].length<=e));
};
// The three witnesses, built from the repository's own example literal.
const CODEX_WITNESSES = {
  'after a closed block comment':`/* canonicalization */ const fallback = "+${APPROVED_EXAMPLE}";\n`,
  'inside template data':'const rows = `\n * +'+APPROVED_EXAMPLE+'\n`;\n',
  'multiplication continuation':`const total = base\n  * rate + ${APPROVED_EXAMPLE};\n`,
};
const CREDENTIAL_WITNESSES = {
  'sbp_token':'const t = "sbp_'+'a'.repeat(24)+'";',
  'sb_secret':'const k = "sb_secret_'+'b'.repeat(24)+'";',
  'whsec':'const w = "whsec_'+'c'.repeat(24)+'";',
  'pg_url':'const u = "postgresql://user:pw@host:5432/postgres";',
  'private_key':'const p = "-----BEGIN RSA PRIVATE KEY-----";',
  'bearer':'headers.set("Authorization", "Bearer abcdefghijklmnopqrstuvwx");',
};
// Writes an extra captured file AND declares it, the way a real download would.
const withSourceFile = (relPath,content) => f => {
  const path=join(f.directory,relPath);
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,content);
  f.provenance.functions.find(x=>x.slug===relPath.split('/')[0]).files.push({path,sha256:a5.sha256(readFileSync(path))});
};
const withApprovedSources = f => { for(const key of Object.keys(APPROVED_SOURCES)) withSourceFile(key,approvedBytes(key))(f); };

test('every pinned offset is inside a genuine comment per the TypeScript lexer',()=>{
  assert.deepEqual(Object.keys(a5.SOURCE_SUBSCRIBER_ALLOWLIST).sort(),Object.keys(APPROVED_SOURCES).sort());
  for(const [key,path] of Object.entries(APPROVED_SOURCES)){
    const bytes=readFileSync(path),text=bytes.toString('utf8'),pin=a5.SOURCE_SUBSCRIBER_ALLOWLIST[key];
    // The pinned byte hash is the real file, and it is the same hash the download gate
    // recorded for the captured copy.
    assert.equal(a5.sha256(bytes),pin.fileSha256,key);
    const matches=[...text.matchAll(PHONE)];
    assert.deepEqual(matches.map(m=>m.index),[...pin.offsets],key);
    assert.equal(everyMatchInComment(text),true,key);
    const literals=new Set(matches.map(m=>a5.sha256(m[0].replace(/^\+/,''))));
    assert.equal(literals.size,1,key);
    assert.equal([...literals][0],pin.literalSha256,key);
    assert.ok(commentRanges(text).length>0,key);
  }
  assert.equal(a5.sha256(APPROVED_EXAMPLE),a5.SOURCE_SUBSCRIBER_ALLOWLIST['sync/_shared/phone.ts'].literalSha256);
});

test('legitimate captured comments pass creation and verification unchanged',()=>{
  for(const key of Object.keys(APPROVED_SOURCES))a5.assertSourceSafe(approvedBytes(key),key);
  // Bytes and decoded text are interchangeable for the pin.
  a5.assertSourceSafe(approvedBytes('sync/deviceLogin.ts').toString('utf8'),'sync/deviceLogin.ts');
  const f=stagingFixture(withApprovedSources),result=stage(f);
  assert.equal(result.files.length,4);
  assert.equal(a5.verifyCheckpoint(result,f.after.functions,clock),'LOCAL FILE INVENTORY VERIFIED — HOSTED PROVENANCE UNVERIFIED');
  // The checkpoint carries hashes and provenance only.
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,PHONE);
  assert.doesNotMatch(serialized,/normalizeBdPhone|export function/);
});

test('the three comment-boundary bypasses refuse: block-comment, template, multiplication',()=>{
  for(const [name,text] of Object.entries(CODEX_WITNESSES)){
    // First the premise: the lexer agrees none of these is inside a comment.
    assert.equal(everyMatchInComment(text),false,name);
    // Then the guard, for both approved keys and end to end through creation.
    for(const key of Object.keys(APPROVED_SOURCES))refusesWith('source-subscriber-bytes',()=>a5.assertSourceSafe(text,key),`${name} / ${key}`);
    refusesWith('source-subscriber-bytes',()=>stage(stagingFixture(withSourceFile('sync/_shared/phone.ts',text))),name);
    // Appending a witness to the genuine bytes also refuses: the pin is the whole file.
    refusesWith('source-subscriber-bytes',()=>a5.assertSourceSafe(Buffer.concat([approvedBytes('sync/_shared/phone.ts'),Buffer.from('\n'+text)]),'sync/_shared/phone.ts'),name);
  }
});

test('altered approved bytes refuse, whatever the alteration',()=>{
  const key='sync/_shared/phone.ts',genuine=approvedBytes(key),text=genuine.toString('utf8');
  const alterations={
    'one byte appended':Buffer.concat([genuine,Buffer.from('\n')]),
    'comment reworded':Buffer.from(text.replace('Stored as typed','Stored as given'),'utf8'),
    'occurrence removed':Buffer.from(text.replace('+'+APPROVED_EXAMPLE,'a number'),'utf8'),
    'fourth occurrence added':Buffer.concat([genuine,Buffer.from(`\n// extra +${APPROVED_EXAMPLE}\n`,'utf8')]),
    'unknown number substituted':Buffer.from(text.replaceAll(APPROVED_EXAMPLE,APPROVED_EXAMPLE.slice(0,-1)+String((Number(APPROVED_EXAMPLE.slice(-1))+1)%10)),'utf8'),
    'occurrence moved into code':Buffer.from(text+`\nconst fallback = "+${APPROVED_EXAMPLE}";\n`,'utf8'),
    'whitespace shifted before the first occurrence':Buffer.from(text.replace('// Why this','//  Why this'),'utf8'),
  };
  for(const [name,bytes] of Object.entries(alterations)){
    assert.notEqual(a5.sha256(bytes),a5.SOURCE_SUBSCRIBER_ALLOWLIST[key].fileSha256,name);
    refusesWith('source-subscriber-bytes',()=>a5.assertSourceSafe(bytes,key),name);
    refusesWith('source-subscriber-bytes',()=>stage(stagingFixture(withSourceFile(key,bytes))),name);
  }
  // The byte pin is the decisive gate, so a tampered approved file can never reach the
  // per-offset and per-literal checks behind it. Those stay as defence in depth against
  // an allowlist edited into disagreement with itself; the lexer test above is what
  // enforces the recorded offsets and literal hash.
  assert.ok([...approvedBytes(key).toString('utf8').matchAll(PHONE)].length===a5.SOURCE_SUBSCRIBER_ALLOWLIST[key].offsets.length);
});

test('the approved example refuses in every unapproved location',()=>{
  const genuine=approvedBytes('sync/_shared/phone.ts');
  // Genuine bytes, wrong key: the other approved slug, the other approved file, a
  // sibling module, a test file and an empty key.
  for(const key of ['sync/deviceLogin.ts','sync/billing.ts','sync/index.ts','auth-send-sms/index.ts','sync/_shared/phone.test.ts',''])
    refusesWith(key==='sync/deviceLogin.ts'?'source-subscriber-bytes':'source-subscriber-file',()=>a5.assertSourceSafe(genuine,key),key||'(empty key)');
  for(const relPath of ['sync/billing.ts','auth-send-sms/handler.ts'])
    refusesWith('source-subscriber-file',()=>stage(stagingFixture(withSourceFile(relPath,genuine))),relPath);
});

test('evidence metadata scope stays strict for credentials AND subscriber numbers',()=>{
  refusesWith('evidence-sensitive',()=>a5.assertEvidenceSafe({note:'+'+APPROVED_EXAMPLE}));
  refusesWith('evidence-sensitive',()=>a5.assertEvidenceSafe({note:APPROVED_EXAMPLE}));
  refusesWith('evidence-sensitive',()=>a5.assertEvidenceSafe({body:approvedBytes('sync/_shared/phone.ts').toString('utf8')}));
  for(const [name,witness] of Object.entries(CREDENTIAL_WITNESSES))
    refusesWith('evidence-sensitive',()=>a5.assertEvidenceSafe({witness}),name);
  // The deliberate asymmetry: bytes that pass as approved source still refuse as metadata.
  a5.assertSourceSafe(approvedBytes('sync/_shared/phone.ts'),'sync/_shared/phone.ts');
});

test('genuine secret leakage in source refuses for every credential class',()=>{
  const key='sync/_shared/phone.ts';
  for(const [name,witness] of Object.entries(CREDENTIAL_WITNESSES)){
    refusesWith('source-credential',()=>a5.assertSourceSafe(witness,key),name);
    // Credentials are checked before the subscriber logic, so appending one to the
    // genuine approved bytes refuses as a credential, not as a byte-pin mismatch.
    refusesWith('source-credential',()=>a5.assertSourceSafe(Buffer.concat([approvedBytes(key),Buffer.from('\n'+witness)]),key),name);
    refusesWith('source-credential',()=>stage(stagingFixture(withSourceFile(key,witness))),name);
    refusesWith('source-credential',()=>stage(stagingFixture(withSourceFile('auth-send-sms/index.ts',witness))),name);
  }
});

test('wrong project refuses in provenance and in both inventory receipts',()=>{
  const foreign='jwjrijvprbsndukfhlvf';
  assert.throws(()=>stage(stagingFixture(f=>{withApprovedSources(f);f.provenance.projectRef=foreign;})),/provenance-identity/);
  assert.throws(()=>stage(stagingFixture(f=>{withApprovedSources(f);f.before.identity.id=foreign;})),/checkpoint-receipt/);
  assert.throws(()=>stage(stagingFixture(f=>{withApprovedSources(f);f.after.identity.id=foreign;})),/checkpoint-receipt/);
  assert.throws(()=>stage(stagingFixture(f=>{withApprovedSources(f);f.before.sourceRevision='0'.repeat(40);})),/checkpoint-receipt/);
  const f=stagingFixture(withApprovedSources),result=stage(f);
  refusesWith('checkpoint-metadata',()=>a5.verifyCheckpoint({...result,projectRef:foreign},f.after.functions,clock));
  refusesWith('checkpoint-metadata',()=>a5.verifyCheckpoint({...result,sourceRevision:'0'.repeat(40)},f.after.functions,clock));
});

test('source tampering after provenance refuses at creation and at verification',()=>{
  const key='sync/_shared/phone.ts';
  // Bytes replaced on disk after the hash was declared.
  assert.throws(()=>stage(stagingFixture(f=>{
    withApprovedSources(f);
    writeFileSync(join(f.directory,'sync','_shared','phone.ts'),'// replaced after declaration\n');
  })),/provenance-file-hash/);
  // A verified checkpoint whose approved file is then edited cannot be re-verified, and
  // the hash gate fires before the subscriber gate.
  const f=stagingFixture(withApprovedSources),result=stage(f);
  assert.equal(a5.verifyCheckpoint(result,f.after.functions,clock),'LOCAL FILE INVENTORY VERIFIED — HOSTED PROVENANCE UNVERIFIED');
  writeFileSync(join(f.directory,'sync','_shared','phone.ts'),Buffer.concat([approvedBytes(key),Buffer.from('\n// appended after capture\n')]));
  refusesWith('checkpoint-hash',()=>a5.verifyCheckpoint(result,f.after.functions,clock));
});

test('invalid provenance still fails closed with the approved example present',()=>{
  for(const [mutate,pattern] of [
    [f=>{withApprovedSources(f);f.provenance.commands=[f.provenance.commands[0]];},/provenance-commands/],
    [f=>{withApprovedSources(f);f.provenance.commands.reverse();},/provenance-command-order/],
    [f=>{withApprovedSources(f);f.provenance.commands[0].argv=[...f.provenance.commands[0].argv,'--debug'];},/provenance-command/],
    [f=>{withApprovedSources(f);f.provenance.commands[0].startedAtUtc=new Date(clock-120_000).toISOString();},/provenance-window/],
    [f=>{withApprovedSources(f);f.provenance.deployedBefore=[];},/provenance-deployed/],
    [f=>{withApprovedSources(f);f.provenance.functions.find(x=>x.slug==='sync').files.pop();},/provenance-file-count/],
  ]) assert.throws(()=>stage(stagingFixture(mutate)),pattern);
});
