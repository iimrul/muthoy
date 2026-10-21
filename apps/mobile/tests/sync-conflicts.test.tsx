// @vitest-environment jsdom

// W3-02's five UI states, which the db-level suites cannot see: the empty
// state, the offline notice, a failed resolution, a row the actor may see but
// not resolve, and a grouped row whose keep_remote button must be ABSENT rather
// than disabled. Both locales, because a Bangla-first POS that renders English
// here would repeat D8/D9.
//
// db/conflicts.ts is mocked at the module boundary: the permission filtering,
// tenant isolation and transaction semantics are proven for real on SQLite in
// db/h6-conflict-*.sqlite.test.ts, and re-proving them through a renderer would
// test the mock rather than the rule.

import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DayClosedError } from '../db/errors';

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

vi.mock('react-native', () => ({
  View: ({ children, accessibilityLabel }: StubProps) =>
    createElement('div', { 'aria-label': accessibilityLabel }, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  ScrollView: ({ children }: StubProps) => createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement(
      'button',
      { onClick: onPress, 'aria-label': accessibilityLabel, disabled },
      children,
    ),
  ActivityIndicator: () => createElement('span', null, 'loading'),
  Alert: { alert: vi.fn() },
}));

vi.mock('@expo/vector-icons/Feather', () => ({
  default: () => createElement('span', null, 'icon'),
}));

const pushed: string[] = [];
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    router: { back: vi.fn(), push: (href: string) => pushed.push(href) },
    // Must run in an EFFECT, not during render. The real useFocusEffect does,
    // and a synchronous call here would setState mid-render and loop forever —
    // which is a property of the mock, not of the screen.
    useFocusEffect: (callback: () => void | (() => void)) => {
      useEffect(() => {
        // The cleanup the real useFocusEffect runs on blur is RETURNED here, so
        // the screen's blur cancellation is exercised rather than discarded.
        return callback();
        // Deliberately keyed on nothing: the screen passes a useCallback whose
        // identity is stable for a given session, and re-running on every
        // render is what produced the loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});

const connected = { value: true };
vi.mock('../sync/connectivity', () => ({
  hasNetworkConnection: () => Promise.resolve(connected.value),
}));

const listConflicts = vi.fn();
const resolveConflict = vi.fn();
vi.mock('../db/conflicts', () => ({ listConflicts, resolveConflict }));

const session = {
  value: {
    shopId: 'shop-1',
    userId: 'user-1',
    role: 'owner',
    permissions: undefined,
  } as Record<string, unknown> | null,
};
vi.mock('../state/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: (state: { session: unknown }) => unknown) =>
      selector({ session: session.value }),
    { getState: () => ({ session: session.value }) },
  ),
}));

const locale = { value: 'en' as 'en' | 'bn' };
vi.mock('../state/localeStore', async () => {
  const { catalog } = await import('../i18n/catalog');
  return {
    useI18n: () => ({
      locale: locale.value,
      t: (key: string) => (catalog[locale.value] as Record<string, string>)[key],
      formatNumber: (value: number) => String(value),
    }),
    // StandardHeader -> LanguageToggle reads the store directly.
    useLocaleStore: Object.assign(
      (selector: (state: Record<string, unknown>) => unknown) =>
        selector({ locale: locale.value, setLocale: () => {}, toggle: () => {} }),
      { getState: () => ({ locale: locale.value, setLocale: () => {}, toggle: () => {} }) },
    ),
  };
});

const { catalog } = await import('../i18n/catalog');
const SyncConflictsScreen = (await import('../app/sync-conflicts')).default;

function conflict(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conflict-1',
    tableName: 'customers',
    rowId: 'row-abcdef12',
    reason: 'pull_local_pending',
    localValue: { name: 'Local Name', phone: '01811111111' },
    remoteValue: { name: 'Server Name', phone: '01899999999' },
    localUpdatedAt: '2026-10-20T13:00:00.000Z',
    remoteUpdatedAt: '2026-10-20T11:00:00.000Z',
    occurrences: 1,
    createdAt: '2026-10-20T13:00:00.000Z',
    canResolve: true,
    isGrouped: false,
    ...overrides,
  };
}

const en = catalog.en as Record<string, string>;
const bn = catalog.bn as Record<string, string>;

beforeEach(() => {
  listConflicts.mockReset();
  listConflicts.mockResolvedValue([]);
  resolveConflict.mockReset();
  resolveConflict.mockResolvedValue(undefined);
  pushed.length = 0;
  connected.value = true;
  locale.value = 'en';
  session.value = { shopId: 'shop-1', userId: 'user-1', role: 'owner', permissions: undefined };
});

afterEach(cleanup);

async function renderScreen() {
  await act(async () => {
    render(createElement(SyncConflictsScreen));
  });
}

describe('empty state', () => {
  it('says there is nothing to resolve rather than showing a bare list', async () => {
    listConflicts.mockResolvedValue([]);
    await renderScreen();
    expect(screen.getByText(en.syncConflictsEmptyTitle!)).toBeTruthy();
    expect(screen.queryByText(en.syncConflictsIntro!)).toBeNull();
  });
});

describe('a resolvable conflict', () => {
  it('shows both sides and both choices', async () => {
    listConflicts.mockResolvedValue([conflict()]);
    await renderScreen();

    expect(screen.getByText('Local Name · 01811111111')).toBeTruthy();
    expect(screen.getByText('Server Name · 01899999999')).toBeTruthy();
    expect(screen.getByRole('button', { name: en.syncConflictKeepLocal! })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.syncConflictKeepRemote! })).toBeTruthy();
  });

  it('passes the chosen side through, with a working liveness callback', async () => {
    listConflicts.mockResolvedValue([conflict()]);
    await renderScreen();

    fireEvent.click(screen.getByRole('button', { name: en.syncConflictKeepRemote! }));

    await waitFor(() => expect(resolveConflict).toHaveBeenCalledTimes(1));
    const [shopId, conflictId, actorUserId, resolution, isStillActive] = resolveConflict.mock.calls[0]!;
    expect(shopId).toBe('shop-1');
    expect(conflictId).toBe('conflict-1');
    // An ID, not a role claim: authorization is re-derived from SQLite inside
    // resolveConflict, so the screen cannot assert its own permissions.
    expect(actorUserId).toBe('user-1');
    expect(resolution).toBe('keep_remote');
    // The handover guard: true for the actor who pressed, false the moment the
    // session changes underneath.
    expect(isStillActive()).toBe(true);
    session.value = { shopId: 'shop-1', userId: 'someone-else', role: 'staff', permissions: undefined };
    expect(isStillActive()).toBe(false);
  });

  it('surfaces a failed resolution inline and keeps the row listed', async () => {
    listConflicts.mockResolvedValue([conflict()]);
    // The REAL class from db/errors.ts, constructed — not a bare Error with its
    // .name reassigned. Hand-setting the name would pass this test while the
    // production class could have a different name entirely, which is the kind
    // of agreement-with-myself a test is supposed to rule out.
    resolveConflict.mockRejectedValue(new DayClosedError('2026-10-21'));
    await renderScreen();

    fireEvent.click(screen.getByRole('button', { name: en.syncConflictKeepLocal! }));

    // Inline and persistent, not a toast that vanishes before it is read.
    // dayClosedErrorLabel, not a conflict-specific key: ERROR_NAME_KEYS in
    // i18n/display.ts is the single map, and DayClosedError already had a
    // translation there long before H-6 existed.
    expect(await screen.findByText(en.dayClosedErrorLabel!)).toBeTruthy();
    expect(screen.getByText('Local Name · 01811111111')).toBeTruthy();
  });
});

describe('rows the actor may see but not resolve', () => {
  it('renders read-only guidance instead of buttons that would be refused', async () => {
    listConflicts.mockResolvedValue([conflict({ canResolve: false })]);
    await renderScreen();

    expect(screen.getByText(en.syncConflictReadOnly!)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.syncConflictKeepLocal! })).toBeNull();
    expect(screen.queryByRole('button', { name: en.syncConflictKeepRemote! })).toBeNull();
  });
});

describe('atomic operation groups', () => {
  it('withholds keep_remote entirely and explains why', async () => {
    listConflicts.mockResolvedValue([conflict({ isGrouped: true })]);
    await renderScreen();

    expect(screen.getByText(en.syncConflictGrouped!)).toBeTruthy();
    // Absent, not disabled: a torn money operation is worse than an unresolved
    // notice, so the choice is not offered at all.
    expect(screen.queryByRole('button', { name: en.syncConflictKeepRemote! })).toBeNull();
    expect(screen.getByRole('button', { name: en.syncConflictKeepLocal! })).toBeTruthy();
  });
});

describe('offline', () => {
  it('tells the owner their choice is saved and syncs later', async () => {
    connected.value = false;
    listConflicts.mockResolvedValue([conflict()]);
    await renderScreen();
    expect(await screen.findByText(en.syncConflictOffline!)).toBeTruthy();
  });

  it('shows no offline notice when connected', async () => {
    listConflicts.mockResolvedValue([conflict()]);
    await renderScreen();
    await waitFor(() => expect(screen.queryByText(en.syncConflictOffline!)).toBeNull());
  });
});

describe('repeat sightings', () => {
  it('reports the count only when a conflict has been seen more than once', async () => {
    listConflicts.mockResolvedValue([conflict({ occurrences: 4 })]);
    await renderScreen();
    expect(screen.getByText(`${en.syncConflictSeenAgain} ×4`)).toBeTruthy();
  });
});

describe('both locales', () => {
  it('renders Bangla under locale=bn', async () => {
    locale.value = 'bn';
    listConflicts.mockResolvedValue([conflict()]);
    await renderScreen();

    expect(screen.getByText(bn.syncConflictsIntro!)).toBeTruthy();
    expect(screen.getByRole('button', { name: bn.syncConflictKeepLocal! })).toBeTruthy();
    // And none of the English equivalents leaked through.
    expect(screen.queryByText(en.syncConflictsIntro!)).toBeNull();
  });

  it('has a distinct Bangla string for every key the screen renders', () => {
    for (const key of [
      'syncConflicts', 'syncConflictsEmptyTitle', 'syncConflictsEmptyBody',
      'syncConflictsIntro', 'syncConflictKeepLocal', 'syncConflictKeepRemote',
      'syncConflictThisDevice', 'syncConflictServer', 'syncConflictReasonPending',
      'syncConflictReasonSuperseded', 'syncConflictReadOnly', 'syncConflictGrouped',
      'syncConflictResolveFailed', 'syncConflictOffline', 'syncConflictSeenAgain',
    ]) {
      expect(bn[key], `missing bn translation for ${key}`).toBeTruthy();
      expect(bn[key]).not.toBe(en[key]);
    }
  });
});

describe('reason wording', () => {
  it('distinguishes a silent push drop from an unpushed local edit', async () => {
    listConflicts.mockResolvedValue([conflict({ reason: 'push_superseded' })]);
    await renderScreen();
    expect(screen.getByText(en.syncConflictReasonSuperseded!)).toBeTruthy();
    expect(screen.queryByText(en.syncConflictReasonPending!)).toBeNull();
  });
});
