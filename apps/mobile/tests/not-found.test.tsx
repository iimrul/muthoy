// @vitest-environment jsdom
//
// M-1 component contracts: copy, styles, CTA dispatch and boundary presentation.
// Router methods here are spies, NOT history proof. The companion
// not-found.integration.test.tsx exercises installed route matching/stack code
// and documents the remaining native-renderer limitation.

import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Role = 'owner' | 'staff' | 'manager';

const UNMATCHED_PATH = '/totally-unknown-route';
/** An unmatched path that DOES sit under an auth prefix, so isAuthPath() is true. */
const UNMATCHED_AUTH_PATH = '/register-typo';

const deps = vi.hoisted(() => ({
  pathname: '/totally-unknown-route',
  session: null as null | { shopId: string; userId: string; role: Role },
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  canGoBack: vi.fn(() => false),
  premiumLock: vi.fn(),
}));

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  className?: string;
}

vi.mock('react-native', () => ({
  StyleSheet: { absoluteFill: { position: 'absolute' } },
  ActivityIndicator: () => createElement('span', null, 'spinner'),
  View: ({ children, className }: StubProps) => createElement('div', { className }, children),
  Text: ({ children, className }: StubProps) => createElement('span', { className }, children),
  Pressable: ({ children, onPress, accessibilityLabel, className }: StubProps) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, className }, children),
}));

vi.mock('expo-router', () => ({
  router: {
    replace: deps.replace,
    push: deps.push,
    back: deps.back,
    canGoBack: () => deps.canGoBack(),
  },
  usePathname: () => deps.pathname,
}));

// The boundary's overlays. Stubbed so an unexpected denial or premium cover is
// visible as a distinct string rather than silently swallowing the screen.
vi.mock('../components/ui/AccessDenied', () => ({
  AccessDenied: () => createElement('span', null, 'denied'),
}));
vi.mock('../components/staff/DashboardLoadState', () => ({
  DashboardLoadState: () => createElement('span', null, 'loading'),
}));
vi.mock('../components/ui/PremiumLock', () => ({
  PremiumLock: ({ feature }: { feature: string }) => {
    deps.premiumLock(feature);
    return createElement('span', null, 'locked');
  },
}));
vi.mock('../state/usePlan', () => ({
  usePlan: () => ({ effectiveTier: 'ultra', loading: false }),
}));
vi.mock('../dev/runtimeDiagnostics', () => ({
  markRuntimeDiagnosticStep: vi.fn(),
  sessionDiagnosticContext: vi.fn(() => ({})),
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

const { default: NotFoundScreen } = await import('../app/+not-found');
const { NavigationBoundary } = await import('../components/navigation/NavigationBoundary');
const { useLocaleStore } = await import('../state/localeStore');
const { catalog } = await import('../i18n/catalog');

function renderScreen() {
  return render(createElement(NotFoundScreen));
}

/** Component-only boundary check; the companion suite owns route discovery. */
function renderRoutedScreen() {
  return render(createElement(NavigationBoundary, null, createElement(NotFoundScreen)));
}

beforeEach(() => {
  deps.replace.mockReset();
  deps.push.mockReset();
  deps.back.mockReset();
  deps.premiumLock.mockReset();
  deps.canGoBack.mockReset();
  deps.canGoBack.mockReturnValue(false);
  deps.pathname = UNMATCHED_PATH;
  deps.session = null;
  useLocaleStore.setState({ locale: 'bn' });
});

afterEach(cleanup);

describe('Not Found boundary presentation', () => {
  it.each([
    ['Owner', 'owner' as const],
    ['Manager', 'manager' as const],
    ['Staff', 'staff' as const],
  ])('%s on an unmatched path sees Not Found, not a denial or a lock', (_label, role) => {
    deps.pathname = UNMATCHED_PATH;
    deps.session = { shopId: 'shop-1', userId: `${role}-1`, role };

    renderRoutedScreen();

    expect(screen.getByText('404')).toBeTruthy();
    expect(screen.getByText(catalog.bn.pageNotFound)).toBeTruthy();
    expect(screen.queryByText('denied')).toBeNull();
    expect(screen.queryByText('locked')).toBeNull();
    expect(deps.premiumLock).not.toHaveBeenCalled();
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it('a signed-out device on an unmatched path is sent to the startup gate, never an authenticated route', () => {
    deps.pathname = UNMATCHED_PATH;
    deps.session = null;

    renderRoutedScreen();

    expect(deps.replace).toHaveBeenCalledWith('/');
    expect(deps.replace).not.toHaveBeenCalledWith('/dashboard');
    expect(deps.replace).not.toHaveBeenCalledWith('/staff-home');
  });

  it('a signed-out device on an unmatched AUTH path sees Not Found with no redirect', () => {
    // `/register-typo` starts with an auth prefix, so the boundary lets it
    // render rather than bouncing it — this is the sessionless case the screen
    // itself has to handle.
    deps.pathname = UNMATCHED_AUTH_PATH;
    deps.session = null;

    renderRoutedScreen();

    expect(screen.getByText('404')).toBeTruthy();
    expect(screen.queryByText('denied')).toBeNull();
    expect(deps.replace).not.toHaveBeenCalled();
  });
});

describe('+not-found role recovery', () => {
  it.each([
    ['Owner', 'owner' as const, '/dashboard'],
    ['Manager', 'manager' as const, '/staff-home'],
    ['Staff', 'staff' as const, '/staff-home'],
  ])('%s recovers to %s by replacing, never pushing', (_label, role, home) => {
    deps.session = { shopId: 'shop-1', userId: `${role}-1`, role };

    renderScreen();
    fireEvent.click(screen.getByLabelText(catalog.bn.goToHome));

    expect(deps.replace).toHaveBeenCalledTimes(1);
    expect(deps.replace).toHaveBeenCalledWith(home);
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('a signed-out visitor recovers to the startup gate, not an authenticated home', () => {
    deps.session = null;

    renderScreen();
    fireEvent.click(screen.getByLabelText(catalog.bn.goToHome));

    expect(deps.replace).toHaveBeenCalledTimes(1);
    expect(deps.replace).toHaveBeenCalledWith('/');
    expect(deps.replace).not.toHaveBeenCalledWith('/dashboard');
    expect(deps.replace).not.toHaveBeenCalledWith('/staff-home');
  });

  it.each([
    ['Owner', 'owner' as const],
    ['Manager', 'manager' as const],
    ['Staff', 'staff' as const],
    ['signed-out', null],
  ])('%s: the CTA never routes back to the unmatched path', (_label, role) => {
    deps.pathname = UNMATCHED_PATH;
    deps.session = role ? { shopId: 'shop-1', userId: `${role}-1`, role } : null;

    renderScreen();
    fireEvent.click(screen.getByLabelText(catalog.bn.goToHome));

    const target = deps.replace.mock.calls[0]?.[0];
    expect(target).not.toBe(UNMATCHED_PATH);
    expect(['/dashboard', '/staff-home', '/']).toContain(target);
  });
});

describe('+not-found back affordance', () => {
  it('offers no Back button on a cold start into a dead link', () => {
    deps.canGoBack.mockReturnValue(false);
    deps.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };

    renderScreen();

    expect(screen.queryByLabelText(catalog.bn.goBack)).toBeNull();
    expect(screen.getByLabelText(catalog.bn.goToHome)).toBeTruthy();
  });

  it('dispatches Back when the router reports history', () => {
    deps.canGoBack.mockReturnValue(true);
    deps.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };

    renderScreen();
    fireEvent.click(screen.getByLabelText(catalog.bn.goBack));

    expect(deps.back).toHaveBeenCalledTimes(1);
    expect(deps.replace).not.toHaveBeenCalled();
    expect(deps.push).not.toHaveBeenCalled();
  });
});

describe('+not-found language', () => {
  it.each(['bn', 'en'] as const)('uses existing %s font classes and prototype spacing/shadow', (locale) => {
    useLocaleStore.setState({ locale });
    const view = renderScreen();
    const numeral = screen.getByText('404');
    expect(numeral.className).toContain('leading-[120px]');
    expect(numeral.className).toContain('font-sans-bold');
    expect(view.container.firstElementChild?.className).toContain('px-4');
    expect(view.container.firstElementChild?.className).toContain('pb-20');
    expect(screen.getByText(catalog[locale].pageNotFound).className).toContain(locale === 'bn' ? 'font-bangla-bold' : 'font-sans-bold');
    expect(screen.getByText(catalog[locale].pageNotFoundMessage).className).toContain(locale === 'bn' ? 'font-bangla' : 'font-sans');
    expect(screen.getByText(catalog[locale].goToHome).className).toContain(locale === 'bn' ? 'font-bangla-semibold' : 'font-sans-semibold');
    expect(screen.getByRole('button', { name: catalog[locale].goToHome }).className).toContain('shadow-lg');
  });

  it('renders Bangla from the shared catalog by default', () => {
    deps.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };

    renderScreen();

    expect(screen.getByText(catalog.bn.pageNotFound)).toBeTruthy();
    expect(screen.getByText(catalog.bn.pageNotFoundMessage)).toBeTruthy();
    expect(screen.getByLabelText(catalog.bn.goToHome)).toBeTruthy();
  });

  it('follows the existing locale toggle into English', () => {
    deps.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };
    useLocaleStore.setState({ locale: 'en' });

    renderScreen();

    expect(screen.getByText(catalog.en.pageNotFound)).toBeTruthy();
    expect(screen.getByText(catalog.en.pageNotFoundMessage)).toBeTruthy();
    expect(screen.getByLabelText(catalog.en.goToHome)).toBeTruthy();
    expect(screen.queryByText(catalog.bn.pageNotFound)).toBeNull();
  });

  it('keeps the 404 numeral literal in both locales', () => {
    deps.session = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };

    // Never a localised digit string: it is branding, not data, so Bangla
    // renders the same "404" glyphs the prototype shows.
    renderScreen();
    expect(screen.getByText('404')).toBeTruthy();

    cleanup();
    useLocaleStore.setState({ locale: 'en' });
    renderScreen();
    expect(screen.getByText('404')).toBeTruthy();
  });
});
