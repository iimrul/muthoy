import { describe, expect, it } from 'vitest';
import {
  canonicalizeExpenseCategory,
  expenseCategorySchema,
} from './expenses';

describe('expense category rollout boundary', () => {
  it.each([
    ['electricity', 'utilities'],
    ['transport', 'conveyance'],
    ['staff_salary', 'salary'],
    ['supplies', 'other'],
    ['rent', 'rent'],
    ['other', 'other'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizeExpenseCategory(input)).toBe(expected);
  });

  it('rejects unknown final categories and keeps new-write schema strict', () => {
    expect(() => canonicalizeExpenseCategory('fuel')).toThrow();
    expect(expenseCategorySchema.safeParse('electricity').success).toBe(false);
    expect(expenseCategorySchema.safeParse('utilities').success).toBe(true);
  });
});
