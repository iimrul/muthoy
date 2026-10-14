// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { EnvironmentRefusalError } from '../config/environmentPolicy';
import { catalog } from '../i18n/catalog';

const boot = vi.hoisted(() => ({ error: undefined as Error | undefined, locale: 'en' as 'en' | 'bn', auth: vi.fn(), sync: vi.fn(), billing: vi.fn(), notifications: vi.fn(), cleanup: vi.fn(), recovery: vi.fn(), retry: vi.fn() }));
const view = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: vi.fn() } }));
vi.mock('expo-router', () => ({ Stack: () => createElement('div', null, 'navigator') }));
vi.mock('expo-splash-screen', () => ({ preventAutoHideAsync: vi.fn(), hideAsync: vi.fn() }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null] }));
vi.mock('@expo-google-fonts/plus-jakarta-sans', () => ({ PlusJakartaSans_300Light: 'font', PlusJakartaSans_400Regular: 'font', PlusJakartaSans_500Medium: 'font', PlusJakartaSans_600SemiBold: 'font', PlusJakartaSans_700Bold: 'font', PlusJakartaSans_800ExtraBold: 'font' }));
vi.mock('@expo-google-fonts/hind-siliguri', () => ({ HindSiliguri_300Light: 'font', HindSiliguri_400Regular: 'font', HindSiliguri_600SemiBold: 'font', HindSiliguri_700Bold: 'font' }));
vi.mock('@expo-google-fonts/dm-mono', () => ({ DMMono_400Regular: 'font', DMMono_500Medium: 'font' }));
vi.mock('../db', () => ({ useDatabaseMigrations: () => ({ isReady: false, error: boot.error, retry: boot.retry }) }));
vi.mock('../state/sessionStore', () => ({ useSessionStore: (select: (state: object) => unknown) => select({ session: null, epoch: 0, authorityTransitioning: false }) }));
vi.mock('../state/localeStore', () => ({ useI18n: () => ({ t: (key: keyof typeof catalog.en) => catalog[boot.locale][key] }) }));
vi.mock('../sync/supabaseClient', () => ({ isSupabaseConfigured: true, handleAppStateChangeForAuthRefresh: boot.auth }));
vi.mock('../sync', () => ({ startSyncEngine: boot.sync, stopSyncEngine: vi.fn() }));
vi.mock('../sync/billingHydration', () => ({ startBillingHydration: boot.billing, stopBillingHydration: vi.fn() }));
vi.mock('../sync/connectivity', () => ({ subscribeToReconnect: vi.fn() }));
vi.mock('../native/notifications', () => ({ registerNotificationBackgroundTaskAsync: boot.notifications, runNotificationChecks: boot.notifications, syncClosingTimeScheduleAsync: boot.notifications }));
vi.mock('../state/switchShop', () => ({ revalidateOfflineSelectedShop: vi.fn() }));
vi.mock('../state/signOutDevice', () => ({ CredentialCleanupError: class extends Error {}, enforceSessionAuthority: boot.cleanup, readSessionAuthorityDeadlineMs: vi.fn(), retryCloudCredentialCleanup: boot.cleanup }));
vi.mock('../state/switchUser', () => ({ switchUser: boot.cleanup }));
vi.mock('../global.css', () => ({}));
vi.mock('../components/navigation/AppNavigationShell', () => ({ AppNavigationShell: view }));
vi.mock('../components/navigation/AuthenticatedRuntimeErrorBoundary', () => ({ AuthenticatedRuntimeErrorBoundary: view }));
vi.mock('../components/navigation/NavigationBoundary', () => ({ NavigationBoundary: view }));
vi.mock('../components/ui/Toast', () => ({ ToastHost: () => null }));
vi.mock('../components/database/DatabaseRecoveryScreen', () => ({ DatabaseRecoveryScreen: boot.recovery }));
vi.mock('../components/auth/AuthorityBlockedScreen', () => ({ AuthorityBlockedScreen: view }));
vi.mock('../components/auth/BrandLoader', () => ({ BrandLoader: () => null }));
vi.mock('../components/auth/AuthStatusScreen', () => ({ AuthStatusScreen: ({ title, body, actions }: { title: string; body: string; actions?: { label: string; onPress: () => void }[] }) => createElement('div', null, title, body, ...(actions ?? []).map(action => createElement('button', { key: action.label, onClick: action.onPress }, action.label))) }));
const { default: RootLayout } = await import('../app/_layout');
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('localized environment refusal before normal/recovery startup', () => {
  test.each(['en', 'bn'] as const)('%s existing data refusal exposes no reset, sign-out or recovery action', locale => {
    boot.locale = locale; boot.error = new EnvironmentRefusalError('unclassified-data');
    render(createElement(RootLayout));
    expect(screen.getByText(catalog[locale].environmentDataBlockedTitle, { exact: false })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull(); expect(screen.queryByText('navigator')).toBeNull();
    for (const call of [boot.auth, boot.sync, boot.billing, boot.notifications, boot.cleanup, boot.recovery]) expect(call).not.toHaveBeenCalled();
  });
  test.each(['configuration-invalid', 'native-identity-invalid'] as const)('%s renders safe configuration copy', code => {
    boot.locale = 'en'; boot.error = new EnvironmentRefusalError(code);
    render(createElement(RootLayout));
    expect(screen.getByText(catalog.en.environmentConfigurationBlockedBody, { exact: false })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull(); expect(boot.recovery).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/SUPABASE|btfprhticjgeihcngpif|com\.muthoy/);
  });
  test.each(['binding-mismatch', 'binding-write-failed'] as const)('%s keeps the data refusal closed with no action', code => {
    boot.locale = 'en'; boot.error = new EnvironmentRefusalError(code);
    render(createElement(RootLayout));
    expect(screen.getByText(catalog.en.environmentDataBlockedTitle, { exact: false })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
  test.each(['en', 'bn'] as const)('%s inspection failure offers only a retry that re-runs startup checks', locale => {
    boot.locale = locale; boot.error = new EnvironmentRefusalError('inspection-failed');
    render(createElement(RootLayout));
    expect(screen.getByText(catalog[locale].startupFailedTitle, { exact: false })).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual([catalog[locale].retry]);
    fireEvent.click(buttons[0]!);
    expect(boot.retry).toHaveBeenCalledOnce();
    for (const call of [boot.auth, boot.sync, boot.billing, boot.notifications, boot.cleanup, boot.recovery]) expect(call).not.toHaveBeenCalled();
    expect(screen.queryByText('navigator')).toBeNull();
  });
});
