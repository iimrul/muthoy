// Where each of the panel's eight write forms posts. Plain strings, no imports,
// so a Server Component page can name a form target without pulling the write
// modules into its own graph. lib/adminFormRoute.ts owns the handlers, and a
// test there asserts the two lists are the same set.

export const ADMIN_FORM_ACTION_PREFIX = '/api/admin/actions/';

export const ADMIN_FORM_PATHS = Object.freeze({
  reconcileLimits: ADMIN_FORM_ACTION_PREFIX + 'reconcile-limits',
  expireOrder: ADMIN_FORM_ACTION_PREFIX + 'expire-order',
  setFeatureFlag: ADMIN_FORM_ACTION_PREFIX + 'set-feature-flag',
  openSupportCase: ADMIN_FORM_ACTION_PREFIX + 'open-support-case',
  updateSupportCase: ADMIN_FORM_ACTION_PREFIX + 'update-support-case',
  addSupportNote: ADMIN_FORM_ACTION_PREFIX + 'add-support-note',
  assignAdminRole: ADMIN_FORM_ACTION_PREFIX + 'assign-admin-role',
  revokeAdminSessions: ADMIN_FORM_ACTION_PREFIX + 'revoke-admin-sessions',
} as const);

export type AdminFormPath = (typeof ADMIN_FORM_PATHS)[keyof typeof ADMIN_FORM_PATHS];
