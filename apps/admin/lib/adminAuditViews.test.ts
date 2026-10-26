// Batch 3 §8.9a — the audit filters.
//
// The case this file exists for is the DATE one. A filter compared against the
// raw UTC timestamp looks right, passes a casual test, and silently drops the
// evening of every Dhaka day — which on an audit page means an operator asking
// "what happened on the 25th" is shown an answer that is missing six hours and
// is not told so.

import { describe, expect, test } from 'vitest';
import { adminListQuerySchema } from '@muthoy/validation';
import type { AdminAuditEntry } from './adminAudit';
import {
  auditActionNamespaces,
  auditActors,
  auditDhakaDay,
  AUDIT_OUTCOMES,
  filterAuditEntries,
  formatAuditMeta,
  sliceAuditEntries,
} from './adminAuditViews';

function entry(overrides: Partial<AdminAuditEntry> = {}): AdminAuditEntry {
  return {
    at: '2026-10-25T06:00:00.000Z',
    actor: 'founder',
    actorVerified: true,
    role: 'super_admin',
    action: 'settings.updated',
    target: 'flag.analytics_enabled',
    outcome: 'success',
    meta: {},
    ...overrides,
  };
}

describe('the Dhaka day of an entry', () => {
  test('an evening UTC instant belongs to the NEXT Dhaka day', () => {
    expect(auditDhakaDay({ at: '2026-10-25T17:59:00.000Z' })).toBe('2026-10-25');
    expect(auditDhakaDay({ at: '2026-10-25T18:00:00.000Z' })).toBe('2026-10-26');
  });

  test('an unparseable timestamp has no day', () => {
    expect(auditDhakaDay({ at: '' })).toBeNull();
  });
});

describe('the filters', () => {
  const entries = [
    entry({
      at: '2026-10-24T06:00:00.000Z',
      actor: 'founder',
      action: 'login',
      outcome: 'success',
    }),
    entry({
      at: '2026-10-25T06:00:00.000Z',
      actor: 'ops',
      action: 'authz.denied',
      outcome: 'denied',
    }),
    entry({
      at: '2026-10-25T19:00:00.000Z',
      actor: 'ops2',
      action: 'settings.updated',
      outcome: 'failure',
    }),
  ];

  test('no filter returns everything', () => {
    expect(filterAuditEntries(entries, {})).toHaveLength(3);
  });

  test('a blank filter is not a filter', () => {
    // A form that submits all of its fields would otherwise filter on the
    // empty string and show nothing.
    expect(
      filterAuditEntries(entries, { actor: '', action: '', outcome: '', search: '' }),
    ).toHaveLength(3);
  });

  test('the actor filter is EXACT, so "ops" does not select "ops2"', () => {
    const matched = filterAuditEntries(entries, { actor: 'ops' });

    expect(matched.map((item) => item.actor)).toEqual(['ops']);
  });

  test('the action filter is a PREFIX, so a namespace selects its family', () => {
    const matched = filterAuditEntries(entries, { action: 'settings.' });

    expect(matched.map((item) => item.action)).toEqual(['settings.updated']);
  });

  test('a denial can be isolated, which is the entry most worth finding', () => {
    const matched = filterAuditEntries(entries, { outcome: 'denied' });

    expect(matched.map((item) => item.action)).toEqual(['authz.denied']);
  });

  test('a date filter keeps the DHAKA evening on the right day', () => {
    // 19:00 UTC on the 25th is 01:00 Dhaka on the 26th. Filtering "the 25th"
    // must therefore NOT return it, and filtering "the 26th" must.
    expect(filterAuditEntries(entries, { from: '2026-10-25', to: '2026-10-25' })).toHaveLength(1);
    expect(
      filterAuditEntries(entries, { from: '2026-10-26', to: '2026-10-26' }).map(
        (item) => item.actor,
      ),
    ).toEqual(['ops2']);
  });

  test('an open-ended range works at either end', () => {
    expect(filterAuditEntries(entries, { from: '2026-10-25' })).toHaveLength(2);
    expect(filterAuditEntries(entries, { to: '2026-10-24' })).toHaveLength(1);
  });

  test('an entry with no readable date is excluded by a date filter, listed without one', () => {
    const undated = [...entries, entry({ at: 'whenever', actor: 'ghost' })];

    expect(filterAuditEntries(undated, {})).toHaveLength(4);
    expect(
      filterAuditEntries(undated, { from: '2026-10-01', to: '2026-12-31' }).map(
        (item) => item.actor,
      ),
    ).not.toContain('ghost');
  });

  test('search covers the actor, role, action, target and the meta pairs', () => {
    const rows = [
      entry({ actor: 'founder', meta: { permission: 'settings.write' } }),
      entry({ actor: 'ops', target: 'nothing', meta: {} }),
    ];

    expect(filterAuditEntries(rows, { search: 'settings.write' })).toHaveLength(1);
    expect(filterAuditEntries(rows, { search: 'FOUNDER' })).toHaveLength(1);
    expect(filterAuditEntries(rows, { search: 'super_admin' })).toHaveLength(2);
    expect(filterAuditEntries(rows, { search: 'nothing' })).toHaveLength(1);
  });

  test('filters compose: two conditions narrow, they do not widen', () => {
    expect(filterAuditEntries(entries, { actor: 'ops', outcome: 'denied' })).toHaveLength(1);
    expect(filterAuditEntries(entries, { actor: 'ops', outcome: 'success' })).toHaveLength(0);
  });

  test('MUTATION: comparing the raw UTC date instead of the Dhaka day is caught', () => {
    // The planted mistake: slicing the ISO string. That files the 19:00 UTC
    // entry under the 25th, where the Dhaka day says the 26th.
    const naive = entries.filter((item) => item.at.slice(0, 10) === '2026-10-25');

    expect(naive).toHaveLength(2);
    expect(filterAuditEntries(entries, { from: '2026-10-25', to: '2026-10-25' })).toHaveLength(1);
  });
});

describe('the filter options', () => {
  const entries = [
    entry({ actor: 'ops', action: 'authz.denied' }),
    entry({ actor: 'founder', action: 'settings.updated' }),
    entry({ actor: 'founder', action: 'login' }),
  ];

  test('actors are distinct and sorted', () => {
    expect(auditActors(entries)).toEqual(['founder', 'ops']);
  });

  test('action options are NAMESPACES, with a dotless action kept whole', () => {
    expect(auditActionNamespaces(entries)).toEqual(['authz.', 'login', 'settings.']);
  });

  test('the three outcomes are the three', () => {
    expect([...AUDIT_OUTCOMES]).toEqual(['success', 'failure', 'denied']);
  });
});

describe('paging and rendering', () => {
  const entries = Array.from({ length: 7 }, (_unused, index) =>
    entry({ at: '2026-10-25T06:00:0' + index + '.000Z' }),
  );

  test('the total is the FILTERED count, not the buffer length', () => {
    const matched = filterAuditEntries(entries, { outcome: 'success' });
    const slice = sliceAuditEntries(matched, 0, 2);

    expect(slice.entries).toHaveLength(3);
    expect(slice.total).toBe(7);

    const denied = filterAuditEntries(entries, { outcome: 'denied' });
    expect(sliceAuditEntries(denied, 0, 2).total).toBe(0);
  });

  test('a page past the end is empty rather than an error', () => {
    expect(sliceAuditEntries(entries, 100, 124).entries).toEqual([]);
  });

  test('empty meta renders the em dash, never an empty cell', () => {
    expect(formatAuditMeta(entry({ meta: {} }))).toBe('—');
    expect(formatAuditMeta(entry({ meta: { permission: 'audit.read', rowCount: 3 } }))).toBe(
      'permission=audit.read rowCount=3',
    );
  });
});

describe('every RENDERED filter option survives the shared schema (Gate 5 finding 6)', () => {
  // THE DEFECT. The Audit page generates its Action options from the recorded
  // entries — dotted namespaces such as `authz.` and `session.` — and submitted
  // them through `plan`, whose `/^[a-z_]*$/` rejects a dot. So selecting any
  // namespaced action made `parseListQuery` fail, and the page reported "that
  // filter is not valid" and queried nothing. Every option but the dotless
  // `login` was unusable.
  //
  // Generating an option the schema refuses is the whole bug, so the test is:
  // round-trip the OPTIONS THE PAGE ACTUALLY RENDERS.
  const entries: AdminAuditEntry[] = [
    entry({ actor: 'founder', action: 'authz.denied', outcome: 'denied' }),
    entry({ actor: 'ops', action: 'session.role_revoked', outcome: 'failure' }),
    entry({ actor: 'ops2', action: 'settings.updated', outcome: 'success' }),
    entry({ actor: 'founder', action: 'login', outcome: 'success' }),
    entry({ actor: 'founder', action: 'admins.role_assigned', outcome: 'success' }),
  ];

  test('the rendered options really do contain dots, or this proves nothing', () => {
    const options = auditActionNamespaces(entries);

    expect(options.length).toBeGreaterThan(3);
    expect(options.filter((option) => option.includes('.')).length).toBeGreaterThan(2);
  });

  test('every action namespace option parses', () => {
    for (const option of auditActionNamespaces(entries)) {
      const parsed = adminListQuerySchema.safeParse({ action: option });
      expect(parsed.success, option + ' is offered but refused by the schema').toBe(true);
    }
  });

  test('every actor and outcome option parses too', () => {
    for (const actor of auditActors(entries)) {
      expect(adminListQuerySchema.safeParse({ district: actor }).success, actor).toBe(true);
    }
    for (const outcome of AUDIT_OUTCOMES) {
      expect(adminListQuerySchema.safeParse({ status: outcome }).success, outcome).toBe(true);
    }
  });

  test('MUTATION: the field this used to borrow still refuses a dotted action', () => {
    // Proves the fix was necessary rather than cosmetic: the old carrier
    // rejects exactly the options the page offers.
    expect(adminListQuerySchema.safeParse({ plan: 'authz.' }).success).toBe(false);
    expect(adminListQuerySchema.safeParse({ action: 'authz.' }).success).toBe(true);
  });

  test('the action field is still BOUNDED — it is not a free-text hole', () => {
    for (const rejected of ['Authz.', 'authz;drop', 'a'.repeat(65), 'authz denied', 'authz-1']) {
      expect(adminListQuerySchema.safeParse({ action: rejected }).success, rejected).toBe(false);
    }
  });
});
