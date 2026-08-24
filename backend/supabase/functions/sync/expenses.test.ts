import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const push = readFileSync(resolve('backend/supabase/functions/sync/push.ts'), 'utf8');
const pushGroup = readFileSync(resolve('backend/supabase/functions/sync/pushGroup.ts'), 'utf8');
const categories = readFileSync(
  resolve('backend/supabase/functions/sync/_shared/expenseCategories.ts'),
  'utf8',
);

describe('B3 Group 3 edge rollout contract', () => {
  it('allows both grouped expense operation kinds', () => {
    expect(pushGroup).toContain('"expense_create"');
    expect(pushGroup).toContain('"expense_delete"');
  });

  it('canonicalizes expense payloads on grouped and stale ungrouped pushes', () => {
    expect(push).toContain('canonicalizeExpensePayload');
    expect(pushGroup).toContain('canonicalizeExpensePayload');
    for (const [legacy, canonical] of [
      ['electricity', 'utilities'],
      ['transport', 'conveyance'],
      ['staff_salary', 'salary'],
      ['supplies', 'other'],
    ]) {
      expect(categories).toContain(`${legacy}: "${canonical}"`);
    }
    expect(categories).toContain('throw new HttpError(400, "Invalid expense category")');
  });
});
