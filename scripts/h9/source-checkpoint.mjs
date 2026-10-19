#!/usr/bin/env node
// OFFLINE: inventories a protected CLI source download between two actual A5 captures.
// The directory argument is the CLI's <stagingRoot>\supabase\functions — NOT the
// staging root and never a source tree: `--workdir` is a Supabase PROJECT directory,
// so the CLI also writes config.toml and .temp/ as siblings of functions/.
// A download is only acceptable with its provenance record; local bytes alone never
// establish hosted origin, so the status stays hosted-UNVERIFIED either way.
import {readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TRUSTED,SOURCE_REVISION,FUNCTIONS,noReparse,sha256,assertGuard,assertEvidenceSafe,assertSourceSafe,sourceKey,verifyCheckpoint} from './h9-a5-dev-readonly.mjs';

export const CLI = Object.freeze({version:'2.117.0',sha256:'442c83f7d455edc0462e94e22d60c9f7f05783fc83d39a0f49dadc78a914a1dd'});
const REPO = resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
export const isInside = (root,path) => {const r=relative(root,path);return r===''||(!r.startsWith('..')&&!isAbsolute(r));};
// Same rule as h9-prod-preflight.mjs's workdir-inside-repository refusal.
export function assertStagedOutsideRepository(directory){
  if(!isAbsolute(directory))throw new Error('checkpoint-directory-relative');
  if(isInside(REPO,resolve(directory)))throw new Error('checkpoint-directory-inside-repository');
  for(let p=resolve(directory);;p=dirname(p)){
    if(existsSync(join(p,'.git')))throw new Error('checkpoint-directory-source-tree');
    if(p===dirname(p))break;
  }
}
// Downloads are sequential and ordered: sync first, then auth-send-sms, into one root.
export const ORDER = Object.freeze(['sync','auth-send-sms']);
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
// The exact argv each download must have had. Anything missing, partial, reordered or
// extra fails closed: a forgotten --project-ref would target whatever the workdir is
// linked to, and a wrong --workdir would write into a source tree.
export function expectedArgv(cliPath,slug,stagingRoot){
  return [cliPath,'functions','download',slug,'--project-ref',TRUSTED.ref,'--use-api','--workdir',stagingRoot];
}
export function assertProvenance(provenance,directory,before,after,start,end){
  const p=provenance;
  if(p?.version!==2||p.projectRef!==TRUSTED.ref||p.cliVersion!==CLI.version||p.cliSha256!==CLI.sha256||p.useApi!==true)throw new Error('provenance-identity');
  if(!isAbsolute(p.cliPath??''))throw new Error('provenance-cli-path');
  if(!isAbsolute(p.stagingRoot??''))throw new Error('provenance-staging-root');
  // Structurally pins the corrected input path to the CLI's real output location.
  if(resolve(directory)!==resolve(p.stagingRoot,'supabase','functions'))throw new Error('provenance-staging-mismatch');
  assertStagedOutsideRepository(p.stagingRoot);
  // Both actual deployed inventories are preserved, not just the closing one.
  if(!same(p.deployedBefore,before.functions)||!same(p.deployedAfter,after.functions))throw new Error('provenance-deployed');
  if(!Array.isArray(p.commands)||p.commands.length!==ORDER.length)throw new Error('provenance-commands');
  let previousEnd=start;
  for(const [index,slug] of ORDER.entries()){
    const command=p.commands[index];
    if(command?.slug!==slug)throw new Error('provenance-command-order');
    if(!same(command.argv,expectedArgv(p.cliPath,slug,p.stagingRoot)))throw new Error('provenance-command');
    const from=Date.parse(command.startedAtUtc),to=Date.parse(command.completedAtUtc);
    if(!Number.isFinite(from)||!Number.isFinite(to)||from>to||from<previousEnd||to>end)throw new Error('provenance-window');
    previousEnd=to;
  }
  if(!Array.isArray(p.functions)||p.functions.length!==FUNCTIONS.length)throw new Error('provenance-functions');
  const slugs=new Set();
  for(const entry of p.functions){
    const deployed=after.functions.find(f=>f.slug===entry?.slug);
    if(!deployed||entry.version!==deployed.version||entry.status!==deployed.status||entry.verify_jwt!==deployed.verify_jwt)throw new Error('provenance-version');
    if(entry.entrypoint!=='index.ts'||!Array.isArray(entry.files)||entry.files.length===0||slugs.has(entry.slug))throw new Error('provenance-entrypoint');
    slugs.add(entry.slug);
  }
  if(!same([...slugs].sort(),[...ORDER].sort()))throw new Error('provenance-functions');
  return p;
}
export function makeCheckpoint(directory,before,after,provenance,now=Date.now()){
  for(const receipt of [before,after])if(receipt?.identity?.id!==TRUSTED.ref||receipt.sourceRevision!==SOURCE_REVISION||!Array.isArray(receipt.functions))throw new Error('checkpoint-receipt');
  assertGuard(before.databaseGuard);assertGuard(after.databaseGuard,before.databaseGuard.instance_fingerprint);
  const start=Date.parse(before.preflight?.capture?.capturedAtUtc),end=Date.parse(after.preflight?.capture?.capturedAtUtc);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>end||end>now||now-start>3_600_000)throw new Error('checkpoint-capture-window');
  assertStagedOutsideRepository(directory);
  assertProvenance(provenance,directory,before,after,start,end);
  noReparse(directory);
  const files=[];
  const walk=path=>{for(const entry of readdirSync(path,{withFileTypes:true})){
    const p=join(path,entry.name);noReparse(p);
    if(entry.isDirectory())walk(p);
    else if(entry.isFile()){
      const head=relative(directory,p).split(/[\\/]/)[0];
      if(!FUNCTIONS.some(f=>f.slug===head))throw new Error('checkpoint-unexpected-function');
      // Restricted source scope: credentials always refuse; the approved documentation
      // example is tolerated only in the exact pinned bytes of an approved file, at its
      // lexer-verified offsets. Bytes, not text, so the pin matches the recorded hash.
      const bytes=readFileSync(p);assertSourceSafe(bytes,sourceKey(directory,p));
      files.push({slug:head,path:resolve(p),sha256:sha256(bytes)});
    }else throw new Error('checkpoint-kind');
  }};
  walk(directory);
  // Every downloaded byte must be declared with its own hash, and nothing extra may appear.
  const onDisk=new Map(files.map(f=>[resolve(f.path),f.sha256]));
  const declared=new Map();
  for(const entry of provenance.functions){
    if(!onDisk.has(resolve(directory,entry.slug,'index.ts')))throw new Error('provenance-entrypoint-missing');
    for(const file of entry.files){
      if(!isAbsolute(file?.path??'')||!/^[a-f0-9]{64}$/.test(file?.sha256??''))throw new Error('provenance-file');
      if(relative(resolve(directory,entry.slug),resolve(file.path)).startsWith('..'))throw new Error('provenance-file-outside-slug');
      if(declared.has(resolve(file.path)))throw new Error('provenance-file-duplicate');
      declared.set(resolve(file.path),file.sha256);
    }
  }
  if(declared.size!==onDisk.size)throw new Error('provenance-file-count');
  for(const [path,hash] of onDisk)if(declared.get(path)!==hash)throw new Error('provenance-file-hash');
  const result={version:1,projectRef:TRUSTED.ref,sourceRevision:SOURCE_REVISION,capturedAtUtc:new Date(end).toISOString(),directory:resolve(directory),functions:after.functions,functionsBefore:before.functions,files:files.sort((a,b)=>a.path.localeCompare(b.path)),provenance:{cliPath:provenance.cliPath,cliVersion:provenance.cliVersion,cliSha256:provenance.cliSha256,useApi:true,stagingRoot:resolve(provenance.stagingRoot),order:[...ORDER],commands:provenance.commands.map(c=>({slug:c.slug,argv:[...c.argv],startedAtUtc:c.startedAtUtc,completedAtUtc:c.completedAtUtc})),deployedBefore:provenance.deployedBefore,deployedAfter:provenance.deployedAfter,hostedProvenanceVerified:false,functions:provenance.functions.map(f=>({slug:f.slug,version:f.version,entrypoint:f.entrypoint,fileCount:f.files.length}))}};
  assertEvidenceSafe(result.provenance);
  verifyCheckpoint(result,after.functions,now);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==7)throw new Error('arguments');const load=p=>JSON.parse(readFileSync(p,'utf8'));const result=makeCheckpoint(resolve(process.argv[2]),load(process.argv[3]),load(process.argv[4]),load(process.argv[5]));writeFileSync(process.argv[6],JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log('SOURCE FILE INVENTORY VERIFIED; hosted provenance UNVERIFIED; values suppressed');process.exitCode=4;}
  catch{console.error('SOURCE CHECKPOINT REFUSED');process.exitCode=2;}
}
