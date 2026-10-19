// Run this installed copy directly with Node. No token, network, database or child process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRuntime,envRefusals,assertGuard,TRUSTED} from './h9-a5-dev-readonly.mjs';
test('installed runtime has exact approved bytes and evaluator closure',()=>verifyRuntime(dirname(fileURLToPath(import.meta.url))));
test('startup injection variables refuse',()=>{
  for(const key of ['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','PGHOST','OPENSSL_CONF'])assert.equal(envRefusals({[key]:'synthetic'}).length,1);
});
test('server identity refuses wrong role, session role, database and absent fingerprint',()=>{
  const good={role:TRUSTED.role,session_role:TRUSTED.sessionRole,database:'postgres',transaction_read_only:'on',server_version_num:'170011',instance_fingerprint:'a'.repeat(32)};
  assertGuard(good);
  for(const [k,v] of [['role','postgres'],['session_role','postgres'],['database','foreign'],['instance_fingerprint',null],['transaction_read_only','off']])assert.throws(()=>assertGuard({...good,[k]:v}));
  assert.throws(()=>assertGuard(good,'b'.repeat(32)));
});
