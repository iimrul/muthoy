import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'apps/mobile/components/ui/ShopSwitcher.tsx'), 'utf8');

describe('ShopSwitcher cache and state contract', () => {
  it('subscribes to the SQLite commercial cache and reloads on notifications', () => {
    expect(source).toContain('subscribeCommercialCache');
    expect(source).toMatch(/subscribeCommercialCache\(\(\) => \{ void load\(\); \}\)/);
  });

  it('discovers the billing account from SQLite instead of a stale persisted session', () => {
    expect(source).toContain('useBillingAccountId(session?.shopId)');
    expect(source).not.toContain('!session.billingAccountId');
  });

  it('opens the canonical management route on the press, with no deferred navigation', () => {
    // Was: assert the InteractionManager deferral. That deferral was a
    // workaround for NavigationBoundary unmounting the Stack, and it made the
    // push depend on the scan button's infinite Animated.loop draining. The
    // press now dispatches the push directly and closes the sheet after.
    expect(source).toContain('router.push(MULTI_SHOP_HREF)');
    expect(source).not.toContain('InteractionManager.runAfterInteractions');
    expect(source).not.toContain("router.push('/settings/multi-shop'");
  });

  it('renders explicit loading, empty, error, and retry states', () => {
    expect(source).toContain('Loading shops…');
    expect(source).toContain('No active shops');
    expect(source).toContain('Could not load shops.');
    expect(source).toContain("onPress={() => void load()}");
  });
});
