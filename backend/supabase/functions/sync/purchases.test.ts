import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pushGroup = readFileSync(resolve('backend/supabase/functions/sync/pushGroup.ts'), 'utf8');
const push = readFileSync(resolve('backend/supabase/functions/sync/push.ts'), 'utf8');

describe('B3 Groups 4-6 edge rollout contract', () => {
  it('allows all four grouped purchase/supplier operation kinds', () => {
    expect(pushGroup).toContain('"supplier_payment"');
    expect(pushGroup).toContain('"purchase_receive_line"');
    expect(pushGroup).toContain('"purchase_void"');
    expect(pushGroup).toContain('"purchase_create"');
  });

  it('does not add purchases/purchase_items to the ungrouped-rejection list (old-client rollout safety)', () => {
    // The review-fix plan's explicit old-client rollout constraint: an
    // un-updated client that never stamps an operation kind on
    // purchases/purchase_items must keep pushing them ungrouped exactly as
    // it does today. Asserting the literal absence of these two table names
    // as quoted string tokens in push.ts guards against a future edit
    // silently reintroducing that rejection.
    expect(push).not.toContain('"purchases"');
    expect(push).not.toContain('"purchase_items"');
  });
});
