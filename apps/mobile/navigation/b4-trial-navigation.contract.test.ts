import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const settings = read('apps/mobile/app/settings/settings.tsx');
const dashboard = read('apps/mobile/app/(tabs)/dashboard.tsx');
const plans = read('apps/mobile/app/settings/plans.tsx');
const banner = read('apps/mobile/components/ui/TrialBanner.tsx');
const multiShop = read('apps/mobile/app/settings/multi-shop.tsx');

describe('B4 physical trial and navigation UX contract', () => {
  it('routes Settings and Dashboard shop management through /multi-shop', () => {
    expect(settings).toContain('router.push(MULTI_SHOP_HREF)');
    expect(dashboard).toContain('<ShopSwitcher />');
    expect(read('apps/mobile/components/ui/ShopSwitcher.tsx')).toContain('router.push(MULTI_SHOP_HREF)');
    expect(read('apps/mobile/app/multi-shop.tsx')).toContain("export { default } from './settings/multi-shop'");
  });

  it('shows automatic Trial, countdown, and Ultra-equivalent access in bn/en', () => {
    expect(dashboard).toContain('<TrialBanner plan={plan} />');
    expect(banner).toContain("plan.plan === 'trial'");
    expect(banner).toContain('plan.daysLeft');
    expect(banner).toContain('আল্ট্রা-সমমান সব ফিচার চালু');
    expect(banner).toContain('All Ultra-equivalent features are active');
    expect(plans).toContain("plan.plan === 'trial'");
    expect(plans).toContain('বর্তমান প্ল্যান: ট্রায়াল');
    expect(plans).toContain('Current plan: Trial');
    expect(plans).toContain('activated automatically');
    expect(plans).not.toContain('Start Trial');
  });

  it('never swaps the Stack navigator out for a gate, and never defers a nav press', () => {
    // Behaviour is proven in tests/b4-multi-shop-navigation.test.tsx. These two
    // are structural guards against the specific shapes that caused the
    // reload: returning a gate in place of `children`, and pushing from inside
    // an InteractionManager callback.
    const boundary = read('apps/mobile/components/navigation/NavigationBoundary.tsx');
    expect(boundary).toContain('StyleSheet.absoluteFill');
    expect(boundary).not.toMatch(/return\s*<PremiumGate[^>]*>\{children\}/);
    for (const path of [
      'apps/mobile/components/navigation/AppNavigationShell.tsx',
      'apps/mobile/components/ui/ShopSwitcher.tsx',
    ]) {
      expect(read(path)).not.toContain('InteractionManager.runAfterInteractions');
    }
  });

  it('keeps the Settings entry always listed, badged PREMIUM until entitled', () => {
    // The row is discovery, not access: hiding it would leave a Free owner with
    // no way to learn the feature exists. Access is enforced on the screen
    // (role + entitlement) and again on the server.
    expect(settings).toContain('router.push(MULTI_SHOP_HREF)');
    expect(settings).toContain("badge={multiShop.entitled ? undefined : 'PREMIUM'}");
    expect(settings).toContain('Manage Multiple Shops');
    expect(settings).toContain('Add, switch, and view summary across shops');
    expect(settings).toContain("plan.effectiveTier !== 'ultra'");
  });

  it('enforces multi-shop at the data layer, not only at the route overlay', () => {
    const commercial = read('apps/mobile/db/commercial.ts');
    expect(commercial).toContain('export async function requireMultiShopAccess');
    expect(commercial).toContain('export async function requireShopSwitchAccess');
    expect(read('apps/mobile/state/switchShop.ts')).toContain('requireShopSwitchAccess(current.shopId, shopId)');
    const clientMultiShop = read('apps/mobile/sync/multiShop.ts');
    // One guard per exported remote operation: create, mutate, summaries.
    expect(clientMultiShop.match(/requireMultiShopAccess\(currentShopId\)/g)).toHaveLength(3);
    expect(read('backend/supabase/functions/sync/multiShop.ts')).toContain('assertPremiumAccount');
  });

  it('loads Multi-Shop from verified SQLite membership and blocks direct non-owner rendering', () => {
    // The billing account is resolved only for an authorized render, so a
    // denied user never triggers even the membership lookup.
    expect(multiShop).toContain('useBillingAccountId(authorized ? session?.shopId : undefined)');
    expect(multiShop).toContain("session.role !== 'owner'");
    expect(multiShop).toContain('<AccessDenied />');
    expect(multiShop).toContain('if (!authorized) return;');
    expect(multiShop).toContain('<PremiumLock feature="multi_shop" />');
  });
});

