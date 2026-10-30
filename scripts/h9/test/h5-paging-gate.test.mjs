import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPagingProtection } from '../h5-paging-gate.mjs';

const now = Date.parse('2026-10-19T16:00:00Z');
function fixture() {
  return { version: 1, collector: 'h5-readonly-paging-probe-v1', observedAtUtc: new Date(now).toISOString(),
    pagefileEncryption: { querySucceeded: true, enabled: false, effectiveThisBoot: 'UNVERIFIED' },
    pagefiles: { querySucceeded: true, rows: [
      { drive: 'C:', allocatedMiB: 15_529, usedMiB: 881 },
      { drive: 'D:', allocatedMiB: 10_240, usedMiB: 726 },
    ] }, volumes: { querySucceeded: false, rows: [] } };
}
const assess = (value) => assessPagingProtection(value, now);
test('observed active pagefiles with disabled flag and unknown BitLocker block', () => {
  const result = assess(fixture());
  assert.equal(result.status, 'BLOCKED'); assert.deepEqual(result.pagefileDrives, ['C:', 'D:']);
  assert.equal(result.credentialEntryAllowed, false); assert.equal(result.realDataExecutionAllowed, false);
});
test('configured encryption flag alone cannot prove current-boot encryption', () => {
  const f = fixture(); f.pagefileEncryption.enabled = true;
  assert.equal(assess(f).status, 'BLOCKED');
});
test('every pagefile drive needs actual fully encrypted protected-volume evidence', () => {
  const f = fixture(); f.volumes = { querySucceeded: true, rows: [
    { drive: 'C:', protectionStatus: 1, conversionStatus: 1, encryptionPercentage: 100 },
    { drive: 'D:', protectionStatus: 1, conversionStatus: 1, encryptionPercentage: 100 },
  ] };
  const result = assess(f); assert.equal(result.status, 'PAGING_ONLY_PROVEN');
  assert.equal(result.credentialEntryAllowed, false); assert.equal(result.realDataExecutionAllowed, false);
});
for (const [name, change] of [
  ['missing D drive', (f) => { f.volumes.rows.pop(); }],
  ['duplicate C drive', (f) => { f.volumes.rows.push({ ...f.volumes.rows[0] }); }],
  ['suspended protection', (f) => { f.volumes.rows[0].protectionStatus = 0; }],
  ['unknown protection', (f) => { f.volumes.rows[0].protectionStatus = 2; }],
  ['partial encryption', (f) => { f.volumes.rows[0].encryptionPercentage = 99; }],
  ['encryption still converting', (f) => { f.volumes.rows[0].conversionStatus = 2; }],
]) {
  test(`refuses ${name}`, () => {
    const f = fixture(); f.volumes = { querySucceeded: true, rows: ['C:', 'D:'].map((drive) =>
      ({ drive, protectionStatus: 1, conversionStatus: 1, encryptionPercentage: 100 })) };
    change(f); assert.equal(assess(f).status, 'BLOCKED');
  });
}
test('zero current usage still requires protection of allocated pagefiles', () => {
  const f = fixture(); f.pagefiles.rows.forEach((row) => { row.usedMiB = 0; });
  assert.equal(assess(f).status, 'BLOCKED');
});
test('missing inventory is unverified rather than no paging', () => {
  const f = fixture(); f.pagefiles.querySucceeded = false; f.pagefiles.rows = [];
  assert.equal(assess(f).status, 'BLOCKED');
});
test('confirmed empty inventory still cannot authorize credentials or H5', () => {
  const f = fixture(); f.pagefiles.rows = [];
  const result = assess(f); assert.equal(result.status, 'PAGING_ONLY_PROVEN');
  assert.equal(result.credentialEntryAllowed, false);
});
for (const [name, change] of [
  ['stale observation', (f) => { f.observedAtUtc = new Date(now - 300_001).toISOString(); }],
  ['future observation', (f) => { f.observedAtUtc = new Date(now + 5_001).toISOString(); }],
  ['wrong collector', (f) => { f.collector = 'arbitrary'; }],
  ['invalid drive', (f) => { f.pagefiles.rows[0].drive = 'not-a-drive'; }],
  ['invalid usage', (f) => { f.pagefiles.rows[0].usedMiB = -1; }],
]) {
  test(`refuses ${name}`, () => {
    const f = fixture(); change(f); assert.equal(assess(f).status, 'BLOCKED');
  });
}
