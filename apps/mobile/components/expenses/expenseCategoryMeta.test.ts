import { describe, expect, it } from 'vitest';
import { expenseCategoryIcon, expenseCategoryLabelKey, isKnownExpenseCategory } from './expenseCategoryMeta';

// B3 Group 3 — "new UI must gracefully handle any legacy category value
// instead of crashing": a device syncing on a stale pre-0018 build can still
// preserve a pre-enforcement/corrupted old-taxonomy category
// (electricity/transport/staff_salary/supplies).

describe('expenseCategoryMeta', () => {
  it('recognizes exactly the 5 locked D-4 categories', () => {
    for (const category of ['rent', 'salary', 'utilities', 'conveyance', 'other']) {
      expect(isKnownExpenseCategory(category)).toBe(true);
    }
  });

  it('treats every pre-migration legacy value as unrecognized', () => {
    for (const legacy of ['electricity', 'transport', 'staff_salary', 'supplies']) {
      expect(isKnownExpenseCategory(legacy)).toBe(false);
    }
  });

  it('falls back to a generic icon for an unrecognized category, never throws', () => {
    expect(() => expenseCategoryIcon('electricity')).not.toThrow();
    expect(expenseCategoryIcon('electricity')).toBe('more-horizontal');
    expect(expenseCategoryIcon('utilities')).toBe('zap');
  });

  it('returns null (not a mistranslation) for an unrecognized category label key', () => {
    expect(expenseCategoryLabelKey('electricity')).toBeNull();
    expect(expenseCategoryLabelKey('utilities')).toBe('categoryUtilities');
  });
});
