// W4-06 — the role table and ADMIN_ROLES, executed.
//
// Two properties carry the authorization model: the table says exactly what
// each role may do, and a malformed ADMIN_ROLES denies everything rather than
// granting a half-parsed subset. The planted prototype test is the third: a
// lookup that resolved an inherited name would hand out a permission nobody
// granted.

import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ADMIN_ROLE_NAME_VALUES, adminSessionRevocationSchema } from '@muthoy/validation';
import { AdminConfigError } from './errors';
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_NAMES,
  hasPermission,
  intersectPermissions,
  isAdminPermission,
  isAdminRole,
  parseAdminRoles,
  permissionMatrix,
  permissionsForRole,
  resolveRole,
  type AdminPermission,
} from './adminRoles';

// Batch 3 §4.2, transcribed INDEPENDENTLY of ROLE_PERMISSIONS: a test that
// derived its expectation from the table it is checking would pass against any
// table at all. Order is [super_admin, billing, support, read_only], matching
// ADMIN_ROLE_NAMES.
const PLAN_MATRIX: Readonly<Record<string, readonly [boolean, boolean, boolean, boolean]>> = {
  'shops.read': [true, true, true, true],
  'accounts.read': [true, true, true, true],
  'subscriptions.read': [true, true, true, true],
  'subscriptions.write': [true, true, false, false],
  'payments.read': [true, true, true, true],
  'revenue.read': [true, true, false, false],
  'analytics.read': [true, true, true, true],
  'maps.read': [true, true, true, false],
  'support.read': [true, false, true, true],
  'support.write': [true, false, true, false],
  'audit.read': [true, true, false, true],
  'shop_audit.read': [true, false, true, false],
  'audit.export': [true, false, false, false],
  'admins.read': [true, false, false, false],
  'admins.write': [true, false, false, false],
  'reports.read': [true, true, true, true],
  'reports.export': [true, true, false, false],
  'settings.read': [true, true, true, true],
  'settings.write': [true, false, false, false],
};

describe('the role table', () => {
  test('super_admin holds every permission', () => {
    expect([...permissionsForRole('super_admin')].sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });

  test('the permission list is exactly the nineteen the plan names', () => {
    expect([...ADMIN_PERMISSIONS].sort()).toEqual(Object.keys(PLAN_MATRIX).sort());
  });

  test('every cell of the §4.2 matrix is granted exactly as written', () => {
    const wrong: string[] = [];
    for (const [permission, grants] of Object.entries(PLAN_MATRIX)) {
      ADMIN_ROLE_NAMES.forEach((role, index) => {
        if (hasPermission(role, permission) !== grants[index]) {
          wrong.push(role + ' ' + permission);
        }
      });
    }
    expect(wrong).toEqual([]);
  });

  test('the four non-obvious grants, named, so a silent widening is visible', () => {
    // support must never become a billing console.
    expect(hasPermission('support', 'subscriptions.write')).toBe(false);
    expect(hasPermission('support', 'revenue.read')).toBe(false);
    // A coordinate locates a physical person; read_only does not get one.
    expect(hasPermission('read_only', 'maps.read')).toBe(false);
    // An export is the one way the log leaves the panel.
    for (const role of ['billing', 'support', 'read_only']) {
      expect(hasPermission(role, 'audit.export')).toBe(false);
    }
    // Volume 5 scopes the per-shop log to support/debugging use.
    expect(hasPermission('support', 'shop_audit.read')).toBe(true);
    expect(hasPermission('billing', 'shop_audit.read')).toBe(false);
  });

  test('the matrix Page 8 renders is the table itself', () => {
    const rendered = permissionMatrix();
    expect(rendered).toHaveLength(ADMIN_PERMISSIONS.length);
    for (const row of rendered) {
      expect(row.roles.map((entry) => entry.role)).toEqual([...ADMIN_ROLE_NAMES]);
      for (const entry of row.roles) {
        expect(entry.granted).toBe(hasPermission(entry.role, row.permission));
      }
    }
  });

  test('the shared schema names the SAME four roles, so the two cannot drift', () => {
    // packages/validation/src/admin.ts has to enumerate the roles for its Zod
    // enum, and a payload schema that accepted a fifth name — or refused one of
    // these four — would be a gate that disagrees with the table it guards.
    expect([...ADMIN_ROLE_NAME_VALUES]).toEqual([...ADMIN_ROLE_NAMES]);
  });

  test('isAdminPermission accepts exactly the nineteen names', () => {
    for (const permission of ADMIN_PERMISSIONS) expect(isAdminPermission(permission)).toBe(true);
    for (const value of ['shops.write', 'SHOPS.READ', '', 'constructor', null, 7, {}]) {
      expect(isAdminPermission(value)).toBe(false);
    }
  });
});

describe('intersectPermissions — a row can only narrow', () => {
  test('a wider assignment grants nothing extra', () => {
    const effective = intersectPermissions(
      permissionsForRole('read_only'),
      permissionsForRole('super_admin'),
    );
    expect([...effective].sort()).toEqual([...permissionsForRole('read_only')].sort());
    expect(effective).not.toContain('admins.write');
    expect(effective).not.toContain('subscriptions.write');
  });

  test('a narrower assignment is what applies', () => {
    const effective = intersectPermissions(
      permissionsForRole('super_admin'),
      permissionsForRole('support'),
    );
    expect([...effective].sort()).toEqual([...permissionsForRole('support')].sort());
  });

  test('two unordered roles yield only what both hold', () => {
    const effective = intersectPermissions(
      permissionsForRole('billing'),
      permissionsForRole('support'),
    );
    expect(effective).toContain('shops.read');
    expect(effective).toContain('analytics.read');
    // Each role's exclusive permission is gone, which is the whole point: a
    // ranking would have kept one of them.
    expect(effective).not.toContain('subscriptions.write');
    expect(effective).not.toContain('support.write');
  });

  test('the result does not depend on argument order', () => {
    const left = intersectPermissions(permissionsForRole('billing'), permissionsForRole('support'));
    const right = intersectPermissions(permissionsForRole('support'), permissionsForRole('billing'));
    expect(left).toEqual(right);
  });

  test('an empty side yields nothing', () => {
    expect(intersectPermissions(permissionsForRole('super_admin'), [])).toEqual([]);
    expect(intersectPermissions([], permissionsForRole('super_admin'))).toEqual([]);
  });

  test('a value outside the permission list cannot survive the intersection', () => {
    // Both sides "hold" it and it still does not come out: the result is built
    // from ADMIN_PERMISSIONS, not from either input.
    const planted = ['constructor', 'shops.read'] as unknown as readonly AdminPermission[];
    expect(intersectPermissions(planted, planted)).toEqual(['shops.read']);
  });
});

describe('the role table — invariants that outlive any one matrix', () => {
  test.each(['u'.repeat(65), 'ops user', 'ops\tuser', '__proto__', 'constructor', 'prototype', '\u0000', '\uD800', '\uDC00'])(
    'a configured account must be addressable by revocation: %j', (username) => {
      expect(adminSessionRevocationSchema.safeParse({ username }).success).toBe(false);
      expect(() => parseAdminRoles(JSON.stringify({ [username]: 'support' }))).toThrow(AdminConfigError);
    },
  );

  test('a maximum-length manageable username remains valid', () => {
    const username = 'u'.repeat(64);
    expect(adminSessionRevocationSchema.safeParse({ username }).success).toBe(true);
    expect(parseAdminRoles(JSON.stringify({ [username]: 'support' })).get(username)).toBe('support');
  });

  test.each(['পরিচালক', 'admin\u{1F600}'])('keeps well-formed Unicode usernames manageable: %s', (username) => {
    expect(adminSessionRevocationSchema.safeParse({ username }).success).toBe(true);
    expect(parseAdminRoles(JSON.stringify({ [username]: 'support' })).get(username)).toBe('support');
  });

  test('billing and support are NOT ordered — neither contains the other', () => {
    // This is why a role mismatch cannot be resolved by "the lower-privilege of
    // the two wins": there is no lower. Either ranking preserves authority the
    // other role never had.
    const billing = new Set(permissionsForRole('billing'));
    const support = new Set(permissionsForRole('support'));
    expect([...support].every((permission) => billing.has(permission))).toBe(false);
    expect([...billing].every((permission) => support.has(permission))).toBe(false);
  });

  test('an unknown role holds nothing', () => {
    expect(permissionsForRole('owner')).toEqual([]);
    expect(hasPermission('owner', 'shops.read')).toBe(false);
  });

  test('a prototype name resolves to no permissions', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(permissionsForRole(name)).toEqual([]);
      expect(hasPermission(name, 'shops.read')).toBe(false);
    }
  });

  test('a prototype name is not a permission either', () => {
    expect(hasPermission('super_admin', 'constructor')).toBe(false);
    expect(hasPermission('super_admin', '__proto__')).toBe(false);
  });

  test('the table cannot be widened at runtime', () => {
    const permissions = permissionsForRole('read_only');
    expect(Object.isFrozen(permissions)).toBe(true);
    expect(() => {
      (permissions as string[]).push('subscriptions.write');
    }).toThrow();
    expect(hasPermission('read_only', 'subscriptions.write')).toBe(false);
  });

  test('isAdminRole accepts exactly the four names', () => {
    for (const role of ADMIN_ROLE_NAMES) expect(isAdminRole(role)).toBe(true);
    for (const value of ['owner', '', 'SUPER_ADMIN', null, undefined, 7, {}]) {
      expect(isAdminRole(value)).toBe(false);
    }
  });
});

describe('parseAdminRoles fails closed', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['not JSON', '{founder:'],
    ['an array', '["founder"]'],
    ['null', 'null'],
    ['a string', '"founder"'],
    ['an empty object', '{}'],
    ['an unknown role', '{"founder":"owner"}'],
    ['a role of the wrong type', '{"founder":1}'],
    ['a nested role', '{"founder":{"role":"support"}}'],
    ['a padded username', '{" founder":"support"}'],
    ['an empty username', '{"":"support"}'],
    ['duplicate usernames differing only in case', '{"founder":"support","Founder":"billing"}'],
    ['a reserved username', '{"__proto__":"super_admin"}'],
  ])('refuses %s', (_label, raw) => {
    expect(() => parseAdminRoles(raw)).toThrow(AdminConfigError);
  });

  test('accepts a well-formed table', () => {
    const roles = parseAdminRoles('{"founder":"super_admin","ops":"support"}');
    expect([...roles.entries()]).toEqual([
      ['founder', 'super_admin'],
      ['ops', 'support'],
    ]);
  });

  test('resolveRole answers null for an account the table does not list', () => {
    const roles = parseAdminRoles('{"founder":"super_admin"}');
    expect(resolveRole(roles, 'founder')).toBe('super_admin');
    expect(resolveRole(roles, 'ops')).toBeNull();
    expect(resolveRole(roles, 'constructor')).toBeNull();
  });
});

describe('ROUND 11 FINDING 6 / ROUND 12 FINDING 9: every permission has a SERVER gate', () => {
  // THE DEFECT THIS GENERALISES. `audit.export` was declared here, granted to
  // super_admin alone, and documented in 4.4 -- and checked by nothing. A
  // permission with no enforcement point is not an access control; it is a
  // line in a document.
  //
  // ROUND 12 FINDING 9 -- MY FIRST VERSION OF THIS GUARD WAS TOO WEAK. It
  // accepted `permissions.includes(...)` as enforcement, and it read comments.
  // The reviewer deleted the real Settings write gate in memory and the guard
  // still answered true, purely because the page renders a permission-
  // dependent control. Hiding a button is not an access control: the URL can
  // be typed and the action can be invoked.
  //
  // So the requirement is a SERVER gate -- `requireAdminPermission` -- and the
  // scan reads code with comments blanked. A visibility check no longer
  // satisfies anything on its own.

  const ROOTS = ['app', 'lib', 'components'] as const;
  const IGNORED = new Set(['node_modules', '.next']);

  /** Source text with every comment blanked, same length. */
  function codeOf(text: string): string {
    const file = ts.createSourceFile(
      'scanned.tsx',
      text,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TSX,
    );
    const ranges: ts.CommentRange[] = [];
    const collectAt = (position: number): void => {
      ranges.push(
        ...(ts.getLeadingCommentRanges(text, position) ?? []),
        ...(ts.getTrailingCommentRanges(text, position) ?? []),
      );
    };
    const visit = (node: ts.Node): void => {
      collectAt(node.pos);
      node.forEachChild(visit);
    };
    visit(file);
    collectAt(file.endOfFileToken.pos);

    const LF = String.fromCharCode(10);
    const CR = String.fromCharCode(13);
    const SPACE = String.fromCharCode(32);
    const out = text.split('');
    for (const range of ranges) {
      for (let index = range.pos; index < range.end && index < out.length; index += 1) {
        if (out[index] !== LF && out[index] !== CR) out[index] = SPACE;
      }
    }
    return out.join('');
  }

  function sources(directory: string): { path: string; code: string }[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) return IGNORED.has(entry.name) ? [] : sources(absolute);
      if (!/[.](ts|tsx)$/.test(entry.name)) return [];
      // Shipped code only: a permission "enforced" inside a test is not
      // enforced at all, and counting test files would make this vacuous.
      if (/[.]test[.]tsx?$/.test(entry.name)) return [];
      return [{ path: absolute, code: codeOf(readFileSync(absolute, 'utf8')) }];
    });
  }

  const SHIPPED = ROOTS.flatMap((root) => sources(join(import.meta.dirname, '..', root)));
  const CODE = SHIPPED.map((file) => file.code).join(String.fromCharCode(10));

  /**
   * The ONE permission enforced without `requireAdminPermission`, and why.
   *
   * `shop_audit.read` gates the per-shop audit view INSIDE the /audit page's
   * loader: without it the loader returns `forbidden` and issues no query at
   * all, so a caller cannot even learn whether a shop id exists. That is a
   * server-side refusal before any read, which is what matters -- it is simply
   * not spelled `requireAdminPermission`, because the page is already gated on
   * `audit.read` and this is a narrower second check within it.
   *
   * The exemption is BACKED by the test below, so it fails if that loader
   * stops refusing.
   */
  const SERVER_GATE_EXEMPT = new Set(['shop_audit.read']);

  test('the scan found the shipped code, or every case below is vacuous', () => {
    expect(CODE.length).toBeGreaterThan(50_000);
    expect(CODE).toContain('requireAdminPermission');
    // And the comment blanking actually happened: this phrase appears only
    // inside comments in the shipped tree.
    expect(CODE).not.toContain('GATE 5 FINDING');
  });

  for (const permission of ADMIN_PERMISSIONS) {
    test(permission + ' is gated on the SERVER, not merely hidden in the UI', () => {
      if (SERVER_GATE_EXEMPT.has(permission)) {
        expect(CODE).toContain("permissions.includes('" + permission + "')");
        return;
      }
      // Round 13 finding 7: `requireAnyAdminPermission([...])` is a server
      // gate too, and /audit needs it because two different permissions open
      // two different sections of that page. Matched on the quoted name
      // appearing inside such a call, not merely anywhere in the file.
      const named = "'" + permission + "'";
      const direct = CODE.includes('requireAdminPermission(' + named);
      const anyOf = [...CODE.matchAll(/requireAnyAdminPermission\(\[([^\]]*)\]/g)].some(
        (match) => (match[1] ?? '').includes(named),
      );

      expect(
        direct || anyOf,
        permission + ' has no server-side permission gate in shipped code',
      ).toBe(true);
    });
  }

  test('the shop_audit.read exemption is EARNED: it refuses before reading', () => {
    const page = SHIPPED.find((file) => file.path.endsWith(join('app', 'audit', 'page.tsx')));
    expect(page, 'the audit page is not in the scan').toBeDefined();
    const code = page?.code ?? '';

    const check = code.indexOf("permissions.includes('shop_audit.read')");
    expect(check, 'the shop_audit.read check is gone').toBeGreaterThan(-1);

    // The refusal is in the SAME statement as the check, so there is no path
    // between them on which a read could happen first. Measured FORWARD from
    // the check rather than against the file's first `forbidden`, which my
    // first version did -- and that one sits 684 characters EARLIER, in the
    // result type, so the assertion was comparing the wrong pair.
    const statement = code.slice(check, check + 120);
    expect(statement, 'the check no longer refuses on the spot').toContain("'forbidden'");
    expect(statement.slice(0, statement.indexOf("'forbidden'"))).not.toContain('await');
  });

  test('MUTATION: a guard that accepted visibility checks would pass this', () => {
    // Round 12 finding 9's reproduction. With the real gate removed, the old
    // version of this guard still answered true for settings.write because the
    // page offers a permission-dependent control. The strengthened rule looks
    // for the SERVER gate, so the same mutant now fails it.
    const mutant = CODE.split("requireAdminPermission('settings.write'").join(
      "requireAdminPermission('settings.read'",
    );

    expect(mutant.includes("requireAdminPermission('settings.write'")).toBe(false);
    // The visibility check survives the mutation, which is exactly why it
    // cannot be what this guard accepts.
    expect(mutant).toContain("permissions.includes('settings.write')");
  });

  test('audit.export is enforced by a ROUTE, not only by hiding a link', () => {
    const route = codeOf(
      readFileSync(join(import.meta.dirname, '..', 'app/api/audit/export/route.ts'), 'utf8'),
    );

    expect(route).toContain("requireAdminPermission('audit.export')");
    // And the export is itself audited, awaited, before any bytes are sent.
    expect(route).toContain("action: 'audit.export'");
    expect(route).toContain('recordAdminActionDurably');
    expect(route).toContain('MESSAGES.unrecorded');
  });

  test('audit.export is held by super_admin ALONE', () => {
    const holders = ADMIN_ROLE_NAMES.filter((role) =>
      permissionsForRole(role).includes('audit.export'),
    );

    expect(holders).toEqual(['super_admin']);
  });

  test('a role may READ the audit without being able to EXPORT it', () => {
    const readers = ADMIN_ROLE_NAMES.filter((role) =>
      permissionsForRole(role).includes('audit.read'),
    );
    const readOnly = readers.filter(
      (role) => !permissionsForRole(role).includes('audit.export'),
    );

    expect(readers.length).toBeGreaterThan(1);
    expect(readOnly.length).toBeGreaterThan(0);
  });
});
