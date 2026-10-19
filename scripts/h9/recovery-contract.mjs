// H5 OFFLINE evidence acceptance only. Does not back up, restore, connect or collect passwords.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const DEV='btfprhticjgeihcngpif';
const HASH=/^[a-f0-9]{64}$/;
const REQUIRED=['database','roles','extensions','sourceCatalog','sourceValues','sourceLedger','authScope','storageRecovery','settingsHooks','functionSources'];
function deny(code){throw new Error(code);}
export function validateRecovery(manifest,proof,read=readFileSync){
  if(manifest?.version!==1||manifest.projectRef!==DEV||manifest.sourcePostgresMajor!==17||manifest.dumpToolMajor!==17||!manifest.approvalId||!manifest.retentionUntilUtc||!manifest.recoveryOwner||!manifest.rpoAgreement||!manifest.rtoAgreement||manifest.trafficPaused!==true||manifest.privateAclVerified!==true||manifest.storageEncrypted!==true||!Array.isArray(manifest.files))deny('backup-contract');
  if(!Number.isFinite(Date.parse(manifest.retentionUntilUtc))||!Number.isFinite(Date.parse(manifest.capturedAtUtc))||Date.parse(manifest.retentionUntilUtc)<=Date.parse(manifest.capturedAtUtc))deny('backup-retention');
  const names=new Set();
  for(const f of manifest.files){
    if(!REQUIRED.includes(f.kind)||names.has(f.kind)||typeof f.path!=='string'||!HASH.test(f.sha256??''))deny('backup-file-contract');
    const bytes=read(f.path);if(bytes.length===0||createHash('sha256').update(bytes).digest('hex')!==f.sha256)deny('backup-integrity');names.add(f.kind);
  }
  if(REQUIRED.some(k=>!names.has(k)))deny('backup-incomplete');
  const t=proof?.target;
  if(proof?.version!==1||proof.backupManifestSha256!==createHash('sha256').update(JSON.stringify(manifest)).digest('hex')||!t||t.kind!=='isolated-local-pg17'||t.host!=='127.0.0.1'||!Number.isInteger(t.port)||t.port<1024||t.port>65535||!/^h9_restore_[a-z0-9_]+$/.test(t.database??'')||t.postgresMajor!==17||t.emptyBeforeRestore!==true||t.networkIsolated!==true||!proof.approvalId)deny('restore-target-or-binding');
  const results=proof.results;
  for(const name of ['restoreExitZero','extensionsExact','rolesOwnersAclsExact','schemaExact','foreignKeysValid','stockInvariantExact','integerPaisaExact','authScopeVerified','storageRecoveryApproved','settingsHooksRecoveryApproved'])if(results?.[name]!==true)deny('restore-check-'+name);
  for(const name of ['catalog','values','ledger'])if(!HASH.test(proof.before?.[name]??'')||proof.before[name]!==proof.after?.[name])deny('restore-digest-'+name);
  const completedAt=Date.parse(proof.completedAtUtc);
  if(!Number.isFinite(proof.elapsedSeconds)||proof.elapsedSeconds<0||!Number.isFinite(completedAt)||completedAt<Date.parse(manifest.capturedAtUtc))deny('restore-time');
  return {pass:true,projectRef:DEV,postgresMajor:17,status:'H5 RESTORE EVIDENCE ACCEPTED — founder operational acceptance still required'};
}
export function rollbackPlan({deployed,previous,checkpointAccepted}){
  if(typeof deployed!=='boolean'||!previous||previous.projectRef!==DEV||!['absent','legacy','modern'].includes(previous.mode)||typeof previous.refWasPresent!=='boolean')deny('rollback-state');
  if(deployed){if(checkpointAccepted!==true)deny('rollback-checkpoint');return {projectRef:DEV,keyMode:'legacy',unsetProjectRef:false,unsetMode:false,phone:'OFF',redeploy:['auth-send-sms','sync'],verify:'approved legacy regression before any Phone restoration'};}
  return {projectRef:previous.refWasPresent?DEV:null,keyMode:previous.mode==='absent'?null:previous.mode,unsetProjectRef:!previous.refWasPresent,unsetMode:previous.mode==='absent',phone:'OFF',redeploy:[]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==4)deny('arguments');const read=p=>JSON.parse(readFileSync(p,'utf8'));console.log(JSON.stringify(validateRecovery(read(process.argv[2]),read(process.argv[3]))));}
  catch{console.error('H5 REFUSED: backup-or-pg17-restore-evidence-incomplete');process.exitCode=2;}
}
