// Focused final acceptance: mocked authorized routes only, no credentials/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectInventory, summarise, PROTECTED_REFS } from '../n0-account-inventory.mjs';
import { refuse } from '../h9-a5-dev-readonly.mjs';

const refs = Object.keys(PROTECTED_REFS);
const organization = { id: 'org_uuid_123', slug: 'org-slug-123', name: 'Test organization' };
const detail = { id: organization.id, name: organization.name, plan: 'free' };
const projects = refs.map(ref => ({ id: 'uuid-' + ref, ref, name: 'Test project', organization_id: organization.id, status: 'ACTIVE_HEALTHY' }));
const inventory = (overrides = {}) => ({ organizations: [organization], projects, details: { [organization.slug]: detail }, ...overrides });

test('real API id/slug and id/ref distinctions reconcile both protected projects', async () => {
  const calls = [];
  const result = await collectInventory({ api: async (kind, slug) => {
    calls.push([kind, slug]);
    if (kind === 'organizations') return [organization];
    if (kind === 'projects') return projects;
    assert.equal(slug, organization.slug);
    return detail;
  } });
  assert.deepEqual(calls, [['organizations', undefined], ['organization', organization.slug], ['projects', undefined]]);
  assert.deepEqual(result.protectedRefsMissing, []);
  assert.equal(result.provenVisibleActiveFreeCount, 2);
  assert.equal(result.accountActiveFreeCount, null);
  assert.equal(result.slotsAvailable, null);
  assert.equal(result.verdict, 'CAPACITY UNVERIFIED');
  assert.ok(result.capacityUnverifiedReasons.includes('OWNER_ADMIN_MEMBERSHIP_UNVERIFIED'));
});

for (const missing of refs) test('missing known ref ' + missing + ' never releases capacity', () => {
  const result = summarise(inventory({ projects: projects.filter(p => p.ref !== missing) }));
  assert.deepEqual(result.protectedRefsMissing, [missing]);
  assert.equal(result.slotsAvailable, null);
  assert.equal(result.a2a3Feasibility, 'UNVERIFIED_NO_ALLOCATION');
});

for (const kind of ['organizations', 'organization', 'projects']) test('visibility refusal of ' + kind + ' retains safe partial evidence', async () => {
  const result = await collectInventory({ api: async route => {
    if (route === kind) refuse('n0-status');
    return route === 'organizations' ? [organization] : route === 'projects' ? projects : detail;
  } });
  assert.equal(result.verdict, 'CAPACITY UNVERIFIED');
  assert.equal(result.slotsAvailable, null);
  assert.ok(result.capacityUnverifiedReasons.some(reason => /VISIBILITY|LIST|PLAN/.test(reason)));
});

for (const plan of [null, '', 'future-paid-plan']) test('unknown plan ' + JSON.stringify(plan) + ' never becomes a confirmed Free plan', () => {
  const result = summarise(inventory({ details: { [organization.slug]: { ...detail, plan } } }));
  assert.equal(result.provenVisibleActiveFreeCount, 0);
  assert.equal(result.organizations[0].plan, plan);
  assert.equal(result.organizations[0].planConfirmed, false);
  assert.ok(result.capacityUnverifiedReasons.includes('ORGANIZATION_PLAN_UNVERIFIED'));
});

test('conflicting list/detail plans do not establish Free or paid capacity', () => {
  const result = summarise(inventory({ organizations: [{ ...organization, plan: 'pro' }] }));
  assert.equal(result.organizations[0].planConfirmed, false);
  assert.equal(result.provenVisibleActiveFreeCount, 0);
  assert.equal(result.slotsAvailable, null);
});

test('unknown and transition states remain separate from proven active Free count', () => {
  for (const status of ['UNKNOWN', 'PAUSING', 'PAUSE_FAILED', 'RESTORING', 'UNRECOGNIZED']) {
    const result = summarise(inventory({ projects: projects.map(p => ({ ...p, status })) }));
    assert.equal(result.provenVisibleActiveFreeCount, 0);
    assert.equal(result.conservativeVisiblePotentialFreeCount, 2);
    assert.equal(result.slotsAvailable, null);
  }
});

test('both paused witnesses and a paid organization still cannot prove eligible Free allocation', () => {
  for (const plan of ['free', 'pro']) {
    const result = summarise(inventory({ projects: projects.map(p => ({ ...p, status: 'INACTIVE' })), details: { [organization.slug]: { ...detail, plan } } }));
    assert.equal(result.provenVisibleActiveFreeCount, 0);
    assert.equal(result.slotsAvailable, null);
    assert.equal(result.verdict, 'CAPACITY UNVERIFIED');
  }
});
