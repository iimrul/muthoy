// @vitest-environment jsdom

/**
 * Reproduces the physical B4 defect the founder reported: tapping Multi-Shop
 * "behaves like a reload" instead of opening /multi-shop.
 *
 * The failure was never in the press handler. NavigationBoundary used to return
 * a loading/denied/premium screen INSTEAD OF its children, and its children are
 * the app's single <Stack /> navigator. Swapping the navigator out unmounts it,
 * React Navigation loses the route state it owns, and the remount restarts at
 * the initial route — which redirects to the authenticated home. On a device
 * that is indistinguishable from a reload.
 *
 * So the assertion that matters here is not "which element is on screen" but
 * "did the navigator stay mounted". Every case below tracks mount/unmount of
 * the child tree across a real route change.
 */

import { createElement, useEffect, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Role = 'owner' | 'staff' | 'manager';

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  visible?: boolean;
  accessibilityLabel?: string;
  pointerEvents?: string;
  importantForAccessibility?: string;
  accessibilityElementsHidden?: boolean;
}

const deps = vi.hoisted(() => ({
  pathname: '/dashboard',
  session: null as null | { shopId: string; userId: string; role: Role },
  locale: 'en' as 'en' | 'bn',
  plan: {
    plan: 'trial' as 'free' | 'pro' | 'ultra' | 'trial',
    effectiveTier: 'ultra' as 'free' | 'pro' | 'ultra',
    status: 'trialing' as string,
    reason: 'trial' as string,
    daysLeft: 12 as number | undefined,
    loading: false,
    refresh: async () => undefined,
  },
  multiShop: {
    allowed: true,
    entitled: true,
    hasMultipleShops: true,
    primaryShopId: 'shop-1',
    liveShopCount: 2,
    loading: false,
  },
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));

vi.mock('react-native', () => {
  class AnimatedValue {
    interpolate() {
      return 1;
    }
  }
  return {
    StyleSheet: { absoluteFill: { position: 'absolute' }, create: (styles: unknown) => styles },
    View: ({ children, pointerEvents, importantForAccessibility, accessibilityElementsHidden }: StubProps) =>
      createElement(
        'div',
        {
          'data-pointer-events': pointerEvents,
          'data-important-for-accessibility': importantForAccessibility,
          'aria-hidden': accessibilityElementsHidden ? 'true' : undefined,
        },
        children,
      ),
    Text: ({ children }: StubProps) => createElement('span', null, children),
    ActivityIndicator: () => createElement('span', null, 'spinner'),
    Pressable: ({ children, onPress, accessibilityLabel }: StubProps) =>
      createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
    Modal: ({ children, visible }: StubProps) => (visible ? createElement('div', null, children) : null),
    TextInput: () => createElement('input', null),
    ScrollView: ({ children }: StubProps) => createElement('div', null, children),
    Alert: { alert: vi.fn() },
    BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    InteractionManager: {
      runAfterInteractions: () => {
        throw new Error('InteractionManager must not gate B4 navigation');
      },
    },
    Animated: {
      Value: AnimatedValue,
      View: ({ children }: StubProps) => createElement('div', null, children),
      loop: () => ({ start: vi.fn(), stop: vi.fn() }),
      sequence: (steps: unknown[]) => steps,
      timing: (_value: unknown, config: unknown) => config,
    },
    Easing: { ease: 'ease', inOut: (value: unknown) => value },
  };
});

vi.mock('expo-router', () => ({
  router: { push: deps.push, replace: deps.replace, back: deps.back, canGoBack: () => true },
  usePathname: () => deps.pathname,
}));

vi.mock('@expo/vector-icons/Feather', () => ({
  default: ({ name }: { name: string }) => createElement('span', { 'data-testid': `feather-${name}` }),
}));
vi.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({
  default: ({ name }: { name: string }) => createElement('span', { 'data-testid': `material-${name}` }),
}));
vi.mock('../components/ui/GreenGradient', () => ({
  GreenGradient: ({ children }: StubProps) => createElement('div', null, children),
}));
vi.mock('../dev/runtimeDiagnostics', () => ({
  markRuntimeDiagnosticStep: vi.fn(),
  sessionDiagnosticContext: vi.fn(() => ({})),
}));
vi.mock('../state/localeStore', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: deps.locale,
    formatMoney: (value: number) => `৳${value}`,
    formatNumber: (value: number) => String(value),
    formatDate: (value: string) => value,
  }),
  useLocaleStore: (selector: (state: { locale: string }) => unknown) => selector({ locale: deps.locale }),
}));
vi.mock('../state/usePlan', () => ({ usePlan: () => deps.plan }));
vi.mock('../state/useMultiShopAccess', () => ({ useMultiShopAccess: () => deps.multiShop }));
vi.mock('../state/sessionStore', () => {
  const useSessionStore = (selector: (state: { session: typeof deps.session }) => unknown) =>
    selector({ session: deps.session });
  useSessionStore.persist = {
    hasHydrated: () => true,
    onHydrate: () => () => undefined,
    onFinishHydration: () => () => undefined,
  };
  return { useSessionStore };
});

// The multi-shop data layer. What is under test here is which of these get
// CALLED, and by whom — the SQLite projection itself is covered by
// db/b4-commercial-cache.sqlite.test.ts and
// db/b4-multi-shop-entitlement.sqlite.test.ts.
const effects = vi.hoisted(() => ({
  listOwnerShops: vi.fn(async () => [
    {
      shopId: 'shop-1',
      name: 'Shop One',
      nameEn: 'Shop One',
      commercialStatus: 'active',
      commercialReason: null,
      archivedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      localShopId: 'shop-1',
    },
  ]),
  readShopSummaries: vi.fn(async () => []),
  refreshShopSummaries: vi.fn(async () => []),
  subscribeCommercialCache: vi.fn(() => () => undefined),
}));

vi.mock('../db/commercial', () => ({
  listOwnerShops: effects.listOwnerShops,
  readShopSummaries: effects.readShopSummaries,
  subscribeCommercialCache: effects.subscribeCommercialCache,
}));
vi.mock('../sync/multiShop', () => ({
  refreshShopSummaries: effects.refreshShopSummaries,
  createRemoteShop: vi.fn(),
  mutateRemoteShop: vi.fn(),
}));
vi.mock('../db/cash', () => ({ currentBusinessDate: () => '2026-09-03' }));
vi.mock('../components/ui/StandardHeader', () => ({
  StandardHeader: ({ title, rightAccessory }: { title: string; rightAccessory?: ReactNode }) =>
    createElement('header', null, title, rightAccessory),
}));
vi.mock('../state/useBillingAccountId', () => ({
  useBillingAccountId: () => ({ billingAccountId: 'account-1', loading: false }),
}));
vi.mock('../state/switchShop', () => ({ switchActiveShop: vi.fn(async () => undefined) }));
vi.mock('../sync/connectivity', () => ({ hasNetworkConnection: async () => true }));

const { NavigationBoundary } = await import('../components/navigation/NavigationBoundary');
const { AppNavigationShell } = await import('../components/navigation/AppNavigationShell');
const { ShopSwitcher } = await import('../components/ui/ShopSwitcher');
const { MULTI_SHOP_HREF, MORE_ROUTES, visibleMoreRoutes } = await import('../navigation/routes');
const MultiShopScreen = (await import('../app/settings/multi-shop')).default;

const lifecycle = { mounted: 0, unmounted: 0 };

/** Stands in for the <Stack /> navigator: its identity is what must survive. */
function StackProbe() {
  useEffect(() => {
    lifecycle.mounted += 1;
    return () => {
      lifecycle.unmounted += 1;
    };
  }, []);
  return createElement('main', null, 'stack navigator');
}

const boundary = () => createElement(NavigationBoundary, null, createElement(StackProbe, null));

const OWNER = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' as const };

beforeEach(() => {
  lifecycle.mounted = 0;
  lifecycle.unmounted = 0;
  deps.push.mockReset();
  deps.replace.mockReset();
  deps.back.mockReset();
  deps.locale = 'en';
  deps.pathname = '/dashboard';
  deps.session = OWNER;
  deps.plan = {
    ...deps.plan,
    plan: 'trial',
    effectiveTier: 'ultra',
    status: 'trialing',
    reason: 'trial',
    daysLeft: 12,
    loading: false,
  };
  deps.multiShop = {
    allowed: true, entitled: true, hasMultipleShops: true,
    primaryShopId: 'shop-1', liveShopCount: 2, loading: false,
  };
  effects.listOwnerShops.mockClear();
  effects.readShopSummaries.mockClear();
  effects.refreshShopSummaries.mockClear();
  effects.subscribeCommercialCache.mockClear();
});

/** The wrapper NavigationBoundary puts around the still-mounted navigator. */
function stackWrapper(): HTMLElement {
  const wrapper = screen.getByText('stack navigator').parentElement;
  if (!wrapper) throw new Error('navigator wrapper not found');
  return wrapper;
}

afterEach(cleanup);

describe('B4 — Multi-Shop opens instead of reloading', () => {
  it('keeps the navigator mounted across /dashboard -> /multi-shop for a trial Owner', () => {
    const view = render(boundary());
    expect(lifecycle.mounted).toBe(1);

    deps.pathname = '/multi-shop';
    view.rerender(boundary());

    // The whole defect in one assertion: no teardown, so no restart at '/'.
    expect(lifecycle.unmounted).toBe(0);
    expect(lifecycle.mounted).toBe(1);
    expect(screen.getByText('stack navigator')).toBeTruthy();
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it('keeps the navigator mounted while the entitlement read is still resolving', () => {
    const view = render(boundary());

    deps.pathname = '/multi-shop';
    deps.plan = { ...deps.plan, loading: true };
    view.rerender(boundary());

    // The loading tick is exactly when the old code tore the Stack down.
    expect(lifecycle.unmounted).toBe(0);
    expect(screen.getByText('stack navigator')).toBeTruthy();
    expect(screen.getByText('spinner')).toBeTruthy();
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it('covers the route with the premium lock for a Free Owner without unmounting it', () => {
    const view = render(boundary());

    deps.pathname = '/multi-shop';
    deps.plan = {
      ...deps.plan,
      plan: 'free',
      effectiveTier: 'free',
      status: 'expired',
      reason: 'trial_ended',
      daysLeft: 0,
      loading: false,
    };
    view.rerender(boundary());

    expect(screen.getByText('Multi-shop is a premium feature')).toBeTruthy();
    expect(lifecycle.unmounted).toBe(0);
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['Staff', 'staff' as const],
    ['Manager', 'manager' as const],
  ])('%s is denied /multi-shop with no redirect and no navigator teardown', (_label, role) => {
    deps.session = { shopId: 'shop-1', userId: `${role}-1`, role };
    deps.pathname = '/multi-shop';

    render(boundary());

    expect(screen.getByText('accessDenied')).toBeTruthy();
    // Role denial must never reach the paid-feature evaluation.
    expect(screen.queryByText('Multi-shop is a premium feature')).toBeNull();
    expect(deps.replace).not.toHaveBeenCalled();
    expect(lifecycle.unmounted).toBe(0);
  });

  it('treats an expired trial as Free and a live trial as Ultra on the same route', () => {
    deps.pathname = '/multi-shop';
    deps.plan = { ...deps.plan, plan: 'free', effectiveTier: 'free', reason: 'trial_ended', loading: false };
    const view = render(boundary());
    expect(screen.getByText('Multi-shop is a premium feature')).toBeTruthy();

    deps.plan = { ...deps.plan, plan: 'trial', effectiveTier: 'ultra', reason: 'trial', daysLeft: 9, loading: false };
    view.rerender(boundary());

    expect(screen.queryByText('Multi-shop is a premium feature')).toBeNull();
    expect(screen.getByText('stack navigator')).toBeTruthy();
    expect(lifecycle.unmounted).toBe(0);
  });
});

describe('B4 — the cover isolates what stays mounted', () => {
  it('leaves the navigator interactive and reachable while access is open', () => {
    deps.pathname = '/multi-shop';
    render(boundary());

    const wrapper = stackWrapper();
    expect(wrapper.getAttribute('data-pointer-events')).toBe('auto');
    expect(wrapper.getAttribute('data-important-for-accessibility')).toBe('auto');
    expect(wrapper.getAttribute('aria-hidden')).toBeNull();
  });

  it.each([
    ['the premium lock', { plan: 'free', effectiveTier: 'free', reason: 'trial_ended', loading: false }],
    ['the entitlement spinner', { loading: true }],
  ])('blocks touch and hides the subtree from screen readers behind %s', (_label, patch) => {
    deps.pathname = '/multi-shop';
    deps.plan = { ...deps.plan, ...patch } as typeof deps.plan;
    render(boundary());

    const wrapper = stackWrapper();
    // TalkBack and VoiceOver walk the view tree, not the pixels: a cover alone
    // would leave every protected control announceable and activatable.
    expect(wrapper.getAttribute('data-pointer-events')).toBe('none');
    expect(wrapper.getAttribute('data-important-for-accessibility')).toBe('no-hide-descendants');
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
  });

  it('isolates the subtree for a role denial too', () => {
    deps.session = { shopId: 'shop-1', userId: 'staff-1', role: 'staff' };
    deps.pathname = '/multi-shop';
    render(boundary());

    const wrapper = stackWrapper();
    expect(wrapper.getAttribute('data-pointer-events')).toBe('none');
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
  });

  it('offers a working way back from the lock instead of a dead end', () => {
    deps.pathname = '/multi-shop';
    deps.plan = { ...deps.plan, plan: 'free', effectiveTier: 'free', reason: 'trial_ended', loading: false };
    render(boundary());

    fireEvent.click(screen.getByText('Go back'));
    // The navigator was never unmounted, so back is a real pop.
    expect(deps.back).toHaveBeenCalledTimes(1);
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it('routes the lock CTA to Plans', () => {
    deps.pathname = '/multi-shop';
    deps.plan = { ...deps.plan, plan: 'free', effectiveTier: 'free', reason: 'trial_ended', loading: false };
    render(boundary());

    fireEvent.click(screen.getByText('View Plans'));
    expect(deps.push).toHaveBeenCalledWith('/settings/plans');
  });
});

describe('B4 — the guarded screen authorizes before it does any work', () => {
  it.each([
    ['a Free owner', { allowed: false, entitled: false, loading: false }],
    ['an owner whose entitlement has not resolved yet', { allowed: false, entitled: false, loading: true }],
    ['a Staff member', { allowed: false, entitled: false, loading: false }, 'staff' as const],
  ])('starts no cache, network, or subscription effect for %s', async (_label, patch, role?: Role) => {
    if (role) deps.session = { shopId: 'shop-1', userId: 'staff-1', role };
    deps.multiShop = { ...deps.multiShop, ...patch };

    render(createElement(MultiShopScreen, null));
    await Promise.resolve();

    // A deep link reaches this screen directly, so the route cover is not what
    // protects it. Authorization gates the effect itself.
    expect(effects.listOwnerShops).not.toHaveBeenCalled();
    expect(effects.readShopSummaries).not.toHaveBeenCalled();
    expect(effects.refreshShopSummaries).not.toHaveBeenCalled();
    expect(effects.subscribeCommercialCache).not.toHaveBeenCalled();
  });

  it('shows the premium lock, not the shop list, to an entitled-less owner', () => {
    deps.multiShop = { ...deps.multiShop, allowed: false, entitled: false, loading: false };
    render(createElement(MultiShopScreen, null));

    expect(screen.getByText('Multi-shop is a premium feature')).toBeTruthy();
    expect(screen.queryByText('Active Shops')).toBeNull();
  });

  it('denies a Staff member outright, without the paid-feature copy', () => {
    deps.session = { shopId: 'shop-1', userId: 'staff-1', role: 'staff' };
    render(createElement(MultiShopScreen, null));

    expect(screen.getByText('accessDenied')).toBeTruthy();
    expect(screen.queryByText('Multi-shop is a premium feature')).toBeNull();
  });

  it('runs the protected effects only once the trial owner is authorized', async () => {
    render(createElement(MultiShopScreen, null));
    await Promise.resolve();
    await Promise.resolve();

    expect(effects.listOwnerShops).toHaveBeenCalledWith('account-1');
    expect(effects.subscribeCommercialCache).toHaveBeenCalled();
  });
});

describe('B4 — Multi-Shop entry points', () => {
  it('the More sheet pushes the canonical /multi-shop route on the press itself', () => {
    render(createElement(AppNavigationShell, null, createElement('main', null, 'content')));

    fireEvent.click(screen.getByText('more'));
    fireEvent.click(screen.getByText('multiShop'));

    expect(deps.push).toHaveBeenCalledTimes(1);
    expect(deps.push).toHaveBeenCalledWith(MULTI_SHOP_HREF);
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it('the dashboard ShopSwitcher pushes the same canonical route', () => {
    render(createElement(ShopSwitcher, null));

    fireEvent.click(screen.getByLabelText('Switch shop'));
    fireEvent.click(screen.getByText('Add new shop'));

    expect(deps.push).toHaveBeenCalledTimes(1);
    expect(deps.push).toHaveBeenCalledWith(MULTI_SHOP_HREF);
  });

  it.each([
    ['a Free owner', { allowed: false, entitled: false, hasMultipleShops: true }],
    ['an owner with a single shop', { allowed: true, entitled: true, hasMultipleShops: false }],
  ])('hides both the dashboard switcher and the More tile from %s', (_label, patch) => {
    deps.multiShop = { ...deps.multiShop, ...patch };

    const switcher = render(createElement(ShopSwitcher, null));
    expect(switcher.container.textContent).toBe('');
    switcher.unmount();

    render(createElement(AppNavigationShell, null, createElement('main', null, 'content')));
    fireEvent.click(screen.getByText('more'));
    expect(screen.queryByText('multiShop')).toBeNull();
  });

  it('exposes exactly one owner-only Multi-Shop entry in the More registry', () => {
    const entries = MORE_ROUTES.filter((route) => route.href === MULTI_SHOP_HREF);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ownerOnly).toBe(true);
    expect(entries[0]?.multiShopOnly).toBe(true);
    expect(visibleMoreRoutes(OWNER as never, true).some((route) => route.href === MULTI_SHOP_HREF)).toBe(true);
    // Default is denied: a caller that forgets to pass entitlement gets no tile.
    expect(visibleMoreRoutes(OWNER as never).some((route) => route.href === MULTI_SHOP_HREF)).toBe(false);
    expect(
      visibleMoreRoutes({ shopId: 'shop-1', userId: 'staff-1', role: 'staff' } as never, true)
        .some((route) => route.href === MULTI_SHOP_HREF),
    ).toBe(false);
  });
});
