// @vitest-environment jsdom

/**
 * M-1 core integration, not a native navigator test.
 *
 * Expo's renderRouter requires Jest and @testing-library/react-native; this
 * repository uses Vitest/jsdom and cannot parse React Native's Flow entrypoint.
 * Instead use the INSTALLED Expo Router's filesystem discovery, linking config,
 * path parser and StackRouter reducer. The real matched screen and real
 * NavigationBoundary render. No test decides whether a URL is unmatched.
 *
 * Only transport is adapted: router methods dispatch real stack actions and a
 * root-stack outlet renders the resolved leaf (nested layouts/destination screen
 * bodies are placeholders). __testPath preserves each entry's URL for that outlet.
 * This proves matching and core replace/Back semantics, not ExpoRoot, native
 * animation, nested navigator dispatch, Android hardware events or safe insets.
 * Those remain physical checks. Internal Expo imports intentionally fail loudly
 * on an SDK change; never replace these algorithms with test implementations.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { createElement, useSyncExternalStore, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteNode } from 'expo-router/build/Route';
import type { RequireContext } from 'expo-router/build/types';

type Role = 'owner' | 'manager' | 'staff';
const deps = vi.hoisted(() => ({
  session: null as null | { shopId: string; userId: string; role: Role },
  tier: 'ultra' as 'free' | 'ultra',
  loading: false,
  transport: null as null | {
    replace: (path: string) => void;
    push: (path: string) => void;
    back: () => void;
    canGoBack: () => boolean;
    pathname: () => string;
    subscribe: (listener: () => void) => () => void;
  },
}));

interface NativeProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityElementsHidden?: boolean;
  pointerEvents?: string;
}
vi.mock('react-native', () => ({
  StyleSheet: { absoluteFill: { position: 'absolute' } },
  ActivityIndicator: () => createElement('span', null, 'spinner'),
  View: ({ children, pointerEvents, accessibilityElementsHidden }: NativeProps) =>
    createElement('div', { 'data-pointer-events': pointerEvents, 'aria-hidden': accessibilityElementsHidden }, children),
  Text: ({ children }: NativeProps) => createElement('span', null, children),
  Pressable: ({ children, onPress, accessibilityLabel }: NativeProps) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
}));
vi.mock('expo-router', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    router: {
      replace: (path: string) => deps.transport!.replace(path),
      push: (path: string) => deps.transport!.push(path),
      back: () => deps.transport!.back(),
      canGoBack: () => deps.transport!.canGoBack(),
    },
    usePathname: () => useSyncExternalStore(deps.transport!.subscribe, deps.transport!.pathname),
  };
});
vi.mock('../state/sessionStore', () => {
  const useSessionStore = (selector: (state: { session: typeof deps.session }) => unknown) => selector({ session: deps.session });
  useSessionStore.persist = {
    hasHydrated: () => true,
    onHydrate: () => () => undefined,
    onFinishHydration: () => () => undefined,
  };
  return { useSessionStore };
});
vi.mock('../state/usePlan', () => ({ usePlan: () => ({ effectiveTier: deps.tier, loading: deps.loading }) }));
vi.mock('../dev/runtimeDiagnostics', () => ({ markRuntimeDiagnosticStep: vi.fn(), sessionDiagnosticContext: () => ({}) }));
vi.mock('../components/ui/AccessDenied', () => ({ AccessDenied: () => createElement('span', null, 'denied') }));
vi.mock('../components/ui/PremiumLock', () => ({ PremiumLock: ({ feature }: { feature: string }) => createElement('span', null, `locked:${feature}`) }));
vi.mock('../components/staff/DashboardLoadState', () => ({ DashboardLoadState: () => createElement('span', null, 'loading') }));

const requireCore = createRequire(import.meta.url);
const { getRoutes } = requireCore('expo-router/build/getRoutesCore') as typeof import('expo-router/build/getRoutesCore');
const { getReactNavigationConfig } = requireCore('expo-router/build/getReactNavigationConfig') as typeof import('expo-router/build/getReactNavigationConfig');
const { StackRouter, StackActions } = requireCore('expo-router/build/react-navigation/routers/StackRouter') as typeof import('expo-router/build/react-navigation/routers/StackRouter');

// The parser's only native-barrel dependency is validatePathConfig. Load the
// unchanged installed CJS source with that barrel redirected to its REAL pure
// implementation, avoiding unrelated native UI imports (no parser/auth mocks).
const parserFile = requireCore.resolve('expo-router/build/fork/getStateFromPath');
const parserRequire = createRequire(parserFile);
const parserModule = { exports: {} };
const loadParser = runInThisContext(`(function(require,module,exports){${readFileSync(parserFile, 'utf8')}\n})`, { filename: parserFile }) as
  (require: (id: string) => unknown, module: typeof parserModule, exports: object) => void;
loadParser((id) => id === '../react-navigation/native'
  ? requireCore('expo-router/build/react-navigation/core/validatePathConfig')
  : parserRequire(id), parserModule, parserModule.exports);
const { getStateFromPath } = parserModule.exports as typeof import('expo-router/build/fork/getStateFromPath');

const notFoundModule = await import('../app/+not-found');
const { NavigationBoundary } = await import('../components/navigation/NavigationBoundary');
const { useLocaleStore } = await import('../state/localeStore');
const { catalog } = await import('../i18n/catalog');
const appDirectory = resolve(dirname(requireCore.resolve('../app/+not-found.tsx')), '.');
const routeFiles = readdirSync(appDirectory, { recursive: true })
  .filter((file): file is string => typeof file === 'string')
  .filter((file) => /\.[jt]sx?$/.test(file))
  .map((file) => `./${file.replaceAll('\\', '/')}`);
const context = Object.assign((file: string) => file === './+not-found.tsx'
  ? notFoundModule
  : { default: () => createElement('span', null, `destination:${file}`) }, {
  keys: () => routeFiles,
  resolve: (file: string) => file,
  id: appDirectory,
}) as RequireContext;
const tree = getRoutes(context, {
  platform: 'android', ignoreEntryPoints: true, skipGenerated: true,
  getSystemRoute: () => { throw new Error('This test requires the real app route files'); },
})!;
const linking = getReactNavigationConfig(tree, true);

function match(path: string) {
  const parsed = getStateFromPath(path, linking);
  if (!parsed) throw new Error(`No Expo route for ${path}`);
  let current = parsed.routes[parsed.index ?? parsed.routes.length - 1];
  if (!current) throw new Error(`Empty route state for ${path}`);
  const rootName = current.name;
  let node: RouteNode = tree;
  for (;;) {
    if (!current) throw new Error(`Empty nested state for ${path}`);
    const name = current.name;
    const child = node.children.find((child) => child.route === name);
    if (!child) throw new Error(`No registered node for ${current.name}`);
    node = child;
    if (!current.state) break;
    current = current.state.routes[current.state.index ?? current.state.routes.length - 1];
  }
  return { rootName, node };
}

function createHistory(paths: string[]) {
  const firstPath = paths[0];
  if (!firstPath) throw new Error('History must have an initial URL');
  const reducer = StackRouter({ initialRouteName: match(firstPath).rootName });
  const options = { routeNames: tree.children.map((node) => node.route), routeParamList: {}, routeGetIdList: {} };
  let state = reducer.getInitialState(options);
  const listeners = new Set<() => void>();
  const actions: string[] = [];
  function pathFromParams(params: object | undefined): string {
    const path: unknown = (params as { __testPath?: unknown } | undefined)?.__testPath;
    if (typeof path !== 'string') throw new Error('Stack entry lost its URL');
    return path;
  }
  function dispatch(action: Parameters<typeof reducer.getStateForAction>[1]) {
    actions.push(action.type);
    if (actions.length > 30) throw new Error('Navigation loop');
    const next = reducer.getStateForAction(state, action, options);
    if (next) {
      state = reducer.getRehydratedState(next, options);
      listeners.forEach((listener) => listener());
    }
  }
  const history = {
    replace: (path: string) => dispatch(StackActions.replace(match(path).rootName, { __testPath: path })),
    push: (path: string) => dispatch(StackActions.push(match(path).rootName, { __testPath: path })),
    back: () => dispatch({ type: 'GO_BACK' }),
    canGoBack: () => reducer.getStateForAction(state, { type: 'GO_BACK' }, options) !== null,
    pathname: () => pathFromParams(state.routes[state.index]?.params),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    paths: () => state.routes.map((route) => pathFromParams(route.params)),
    actions,
  };
  paths.forEach((path, index) => index === 0 ? history.replace(path) : history.push(path));
  actions.length = 0;
  return history;
}

function RoutedOutlet() {
  const pathname = useSyncExternalStore(deps.transport!.subscribe, deps.transport!.pathname);
  const routeModule = match(pathname).node.loadRoute();
  if (routeModule instanceof Promise) throw new Error('Expected synchronous route loading');
  return createElement(NavigationBoundary, null, createElement(routeModule.default!));
}
function start(paths: string[]) {
  const history = createHistory(paths);
  deps.transport = history;
  render(createElement(RoutedOutlet));
  return history;
}
beforeEach(() => {
  deps.session = { shopId: 'shop', userId: 'owner', role: 'owner' };
  deps.tier = 'ultra';
  deps.loading = false;
  useLocaleStore.setState({ locale: 'bn' });
});
afterEach(cleanup);

describe('M-1 registered route / real stack core integration', () => {
  it('resolves a genuinely unmatched URL to the actual app file and renders Owner Not Found', () => {
    const resolved = match('/old-link/removed-page');
    expect(resolved.node.contextKey).toBe('./+not-found.tsx');
    expect(resolved.node.loadRoute()).toBe(notFoundModule);
    expect(match('/dashboard').node.contextKey).not.toBe('./+not-found.tsx');
    const history = start(['/old-link/removed-page']);
    expect(screen.getByText('404')).toBeTruthy();
    expect(screen.getByText(catalog.bn.pageNotFound)).toBeTruthy();
    expect(history.actions).toEqual([]);
    expect(screen.queryByRole('button', { name: catalog.bn.goBack })).toBeNull();
  });

  it.each([
    ['owner', '/dashboard'], ['manager', '/staff-home'], ['staff', '/staff-home'],
  ] as const)('%s replaces the dead entry with %s; later Back cannot revisit it', (role, home) => {
    deps.session = { shopId: 'shop', userId: role, role };
    const history = start([home, '/old-link/removed-page']);
    fireEvent.click(screen.getByRole('button', { name: catalog.bn.goToHome }));
    expect(history.actions).toEqual(['REPLACE']);
    expect(history.paths()).toEqual([home, home]);
    expect(screen.queryByText('404')).toBeNull();
    expect(history.pathname()).toBe(home);
    act(() => history.back());
    expect(history.paths()).toEqual([home]);
    act(() => history.back());
    expect(history.paths()).toEqual([home]);
    expect(history.actions).toEqual(['REPLACE', 'GO_BACK', 'GO_BACK']);
    expect(screen.queryByText('404')).toBeNull();
  });

  it('signed-out auth-prefix typo CTA replaces to /, never an authenticated destination', () => {
    deps.session = null;
    const history = start(['/register-typo']);
    expect(screen.getByText('404')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: catalog.bn.goToHome }));
    expect(history.paths()).toEqual(['/']);
    expect(history.actions).toEqual(['REPLACE']);
    act(() => history.back());
    expect(history.paths()).toEqual(['/']);
  });

  it('signed-out neutral typo is replaced by the real boundary once, without a redirect loop', () => {
    deps.session = null;
    const history = start(['/old-link/removed-page']);
    expect(history.paths()).toEqual(['/']);
    expect(history.actions).toEqual(['REPLACE']);
    expect(screen.queryByText('404')).toBeNull();
    act(() => history.back());
    expect(history.paths()).toEqual(['/']);
    expect(history.actions).toEqual(['REPLACE', 'GO_BACK']);
  });

  it('secondary Back pops the dead entry; repeated Back at the root is a no-op', () => {
    const history = start(['/dashboard', '/old-link/removed-page']);
    fireEvent.click(screen.getByRole('button', { name: catalog.bn.goBack }));
    expect(history.paths()).toEqual(['/dashboard']);
    act(() => history.back());
    expect(history.paths()).toEqual(['/dashboard']);
    expect(history.actions).toEqual(['GO_BACK', 'GO_BACK']);
    expect(screen.queryByText('404')).toBeNull();
  });

  it.each(['manager', 'staff'] as const)('%s cannot reach a guarded typo through the Not Found outlet', (role) => {
    deps.session = { shopId: 'shop', userId: role, role };
    const history = start(['/settings/removed-page']);
    expect(match(history.pathname()).node.contextKey).toBe('./+not-found.tsx');
    expect(screen.getByText('denied')).toBeTruthy();
    expect(screen.queryByRole('button', { name: catalog.bn.goToHome })).toBeNull();
    expect(screen.getByText('404').closest('[data-pointer-events]')?.getAttribute('data-pointer-events')).toBe('none');
    expect(history.actions).toEqual([]);
  });

  it.each(['/reports/report/removed-page', '/reports/data-export/removed-page'])('Free/expired-effective-Free Owner retains the premium overlay at %s', (path) => {
    deps.tier = 'free';
    const history = start([path]);
    expect(match(path).node.contextKey).toBe('./+not-found.tsx');
    expect(screen.getByText(path.includes('data-export') ? 'locked:export' : 'locked:reports')).toBeTruthy();
    expect(screen.queryByRole('button', { name: catalog.bn.goToHome })).toBeNull();
    expect(screen.getByText('404').closest('[data-pointer-events]')?.getAttribute('data-pointer-events')).toBe('none');
    expect(history.actions).toEqual([]);
  });

  it('a loading entitlement covers a guarded typo without redirects', () => {
    deps.loading = true;
    const history = start(['/reports/report/removed-page']);
    expect(screen.getByText('spinner')).toBeTruthy();
    expect(screen.queryByRole('button', { name: catalog.bn.goToHome })).toBeNull();
    expect(history.actions).toEqual([]);
  });
});
