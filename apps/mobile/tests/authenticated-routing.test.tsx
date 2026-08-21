// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Role = 'owner' | 'staff' | 'manager';

const deps = vi.hoisted(() => ({
  pathname: '/staff-home',
  session: null as null | { shopId: string; userId: string; role: Role },
  replace: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: { replace: deps.replace },
  usePathname: () => deps.pathname,
}));
vi.mock('../components/ui/AccessDenied', () => ({
  AccessDenied: () => createElement('span', null, 'denied'),
}));
vi.mock('../components/staff/DashboardLoadState', () => ({
  DashboardLoadState: () => createElement('span', null, 'loading'),
}));
vi.mock('../dev/runtimeDiagnostics', () => ({
  markRuntimeDiagnosticStep: vi.fn(),
  sessionDiagnosticContext: vi.fn(() => ({})),
}));
vi.mock('../state/localeStore', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
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

const { NavigationBoundary } = await import('../components/navigation/NavigationBoundary');

function renderBoundary() {
  return render(
    createElement(
      NavigationBoundary,
      null,
      createElement('span', null, 'route content'),
    ),
  );
}

beforeEach(() => {
  deps.replace.mockReset();
});

afterEach(cleanup);

describe('authenticated home routing boundary', () => {
  it.each([
    ['Staff', 'staff' as const],
    ['Manager', 'manager' as const],
  ])('%s stays on /staff-home with no redirect', (_label, role) => {
    deps.pathname = '/staff-home';
    deps.session = { shopId: 'shop-1', userId: `${role}-1`, role };

    renderBoundary();

    expect(deps.replace).not.toHaveBeenCalled();
  });

  it('Owner stays on /dashboard with no redirect', () => {
    deps.pathname = '/dashboard';
    deps.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };

    renderBoundary();

    expect(deps.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['Staff', 'staff' as const],
    ['Manager', 'manager' as const],
  ])('%s on /dashboard goes directly to /staff-home, never /', (_label, role) => {
    deps.pathname = '/dashboard';
    deps.session = { shopId: 'shop-1', userId: `${role}-1`, role };

    renderBoundary();

    expect(deps.replace).toHaveBeenCalledTimes(1);
    expect(deps.replace).toHaveBeenCalledWith('/staff-home');
    expect(deps.replace).not.toHaveBeenCalledWith('/');
  });

  it('Owner on /staff-home goes directly to /dashboard, never /', () => {
    deps.pathname = '/staff-home';
    deps.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };

    renderBoundary();

    expect(deps.replace).toHaveBeenCalledTimes(1);
    expect(deps.replace).toHaveBeenCalledWith('/dashboard');
    expect(deps.replace).not.toHaveBeenCalledWith('/');
  });
});
