// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHOP_ID = '8c2f1a30-0000-4000-8000-000000000001';
const USER_ID = '8c2f1a30-0000-4000-8000-000000000002';

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  value?: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

vi.mock('react-native', () => ({
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  ActivityIndicator: () => createElement('span', { role: 'progressbar' }),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children),
  TextInput: ({ value, onChangeText, accessibilityLabel, placeholder }: StubProps) =>
    createElement('input', {
      value: value ?? '',
      'aria-label': accessibilityLabel,
      placeholder,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
  Alert: { alert: vi.fn() },
}));

const deps = vi.hoisted(() => ({
  params: {
    role: 'staff',
    shopId: '8c2f1a30-0000-4000-8000-000000000001',
    userId: '8c2f1a30-0000-4000-8000-000000000002',
  },
  replace: vi.fn(),
  push: vi.fn(),
  verifyPin: vi.fn(),
  recordSuccessfulLogin: vi.fn(),
  setOwnerPin: vi.fn(),
  verifyPinForUser: vi.fn(),
  refreshBillingStatus: vi.fn(),
  loginOnNewDevice: vi.fn(),
  login: vi.fn(),
  inspectCloudActorBinding: vi.fn(),
  networkReachability: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: { replace: deps.replace, push: deps.push },
  useLocalSearchParams: () => deps.params,
}));

vi.mock('../db/auth', () => ({
  verifyPin: deps.verifyPin,
  recordSuccessfulLogin: deps.recordSuccessfulLogin,
  setOwnerPin: deps.setOwnerPin,
  verifyPinForUser: deps.verifyPinForUser,
}));

vi.mock('../sync/billing', () => ({ refreshBillingStatus: deps.refreshBillingStatus }));
vi.mock('../sync/authActorBinding', () => ({
  inspectCloudActorBinding: deps.inspectCloudActorBinding,
}));
vi.mock('../sync/connectivity', () => ({
  networkReachability: deps.networkReachability,
}));

vi.mock('../sync/deviceAuth', async () => {
  class DeviceLoginError extends Error {}
  return { DeviceLoginError, loginOnNewDevice: deps.loginOnNewDevice };
});

vi.mock('../state/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: (state: { login: typeof deps.login }) => unknown) => selector({ login: deps.login }),
    { getState: () => ({ epoch: 0, session: null }) },
  ),
  // H-4: PIN Login reads the last shop to scope its offline attempt budget.
  // The real db/pinAttemptLock runs against the MMKV double, so the budget
  // behaves here exactly as it does on device — only the shop id is stubbed.
  readLastShopIdSync: () => null,
}));

const { default: DeviceLoginScreen } = await import('../app/(auth)/device-login');
const { default: PinLoginScreen } = await import('../app/(auth)/pin-login');
const { default: PinSetupScreen } = await import('../app/(auth)/pin-setup');
const { useLocaleStore } = await import('../state/localeStore');

let frameQueue: FrameRequestCallback[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pressPin(pin: string): void {
  act(() => {
    for (const digit of pin) {
      fireEvent.click(screen.getByLabelText(`Digit ${digit}`));
    }
  });
}

async function paintAndSubmit(): Promise<void> {
  act(() => frameQueue.shift()?.(0));
  await act(async () => frameQueue.shift()?.(16));
}

beforeEach(() => {
  vi.stubGlobal('__DEV__', true);
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frameQueue.push(callback);
    return frameQueue.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  deps.params.role = 'staff';
  deps.replace.mockReset();
  deps.push.mockReset();
  deps.verifyPin.mockReset();
  deps.recordSuccessfulLogin.mockReset();
  deps.recordSuccessfulLogin.mockResolvedValue(undefined);
  deps.setOwnerPin.mockReset();
  deps.verifyPinForUser.mockReset();
  deps.verifyPinForUser.mockResolvedValue({
    shopId: SHOP_ID,
    userId: USER_ID,
    role: 'owner',
    permissions: {},
    principalUserId: USER_ID,
    billingAccountId: 'account-1',
  });
  deps.refreshBillingStatus.mockReset();
  deps.refreshBillingStatus.mockResolvedValue(undefined);
  deps.loginOnNewDevice.mockReset();
  deps.login.mockReset();
  deps.inspectCloudActorBinding.mockReset();
  deps.inspectCloudActorBinding.mockResolvedValue({
    status: 'matched', actorUserId: USER_ID, shopId: SHOP_ID,
  });
  deps.networkReachability.mockReset();
  deps.networkReachability.mockResolvedValue('online');
  useLocaleStore.setState({ locale: 'en' });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PIN authentication loading state', () => {
  it('shows loading immediately, submits once, and navigates after offline bcrypt completes', async () => {
    const verification = deferred<{
      shopId: string;
      userId: string;
      role: 'owner';
      permissions: Record<string, never>;
    } | null>();
    deps.verifyPin.mockReturnValueOnce(verification.promise);
    render(createElement(PinLoginScreen));

    pressPin('1234');

    expect(screen.getByText('Signing in…')).toBeTruthy();
    expect((screen.getByLabelText('Digit 1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Digit 1'));
    await paintAndSubmit();
    expect(deps.verifyPin).toHaveBeenCalledTimes(1);
    expect(deps.verifyPin).toHaveBeenCalledWith(
      '1234',
      expect.objectContaining({ flow: 'offline_pin_login' }),
    );
    expect(deps.replace).not.toHaveBeenCalled();

    verification.resolve({
      shopId: SHOP_ID,
      userId: USER_ID,
      role: 'owner',
      permissions: {},
    });
    await waitFor(() => expect(deps.replace).toHaveBeenCalledWith('/dashboard'));
    expect(deps.recordSuccessfulLogin).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
    expect(deps.login).toHaveBeenCalledTimes(1);
  });

  it('recovers from a rejected offline PIN and re-enables retry', async () => {
    deps.verifyPin.mockResolvedValueOnce(null);
    render(createElement(PinLoginScreen));

    pressPin('9999');
    await paintAndSubmit();

    expect(await screen.findByText('Incorrect PIN — try again')).toBeTruthy();
    expect(screen.queryByText('Signing in…')).toBeNull();
    expect((screen.getByLabelText('Digit 1') as HTMLButtonElement).disabled).toBe(false);
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['staff', '/staff-home'],
    ['manager', '/staff-home'],
  ] as const)('routes a successful %s PIN login to StaffHome', async (role, destination) => {
    deps.verifyPin.mockResolvedValueOnce({
      shopId: SHOP_ID,
      userId: USER_ID,
      role,
      permissions: {},
    });
    render(createElement(PinLoginScreen));

    pressPin('1234');
    await paintAndSubmit();

    await waitFor(() => expect(deps.replace).toHaveBeenCalledWith(destination));
  });

  it('routes an online shared-device actor mismatch to authoritative re-link before login', async () => {
    deps.verifyPin.mockResolvedValueOnce({
      shopId: SHOP_ID,
      userId: USER_ID,
      role: 'staff',
      permissions: {},
    });
    deps.inspectCloudActorBinding.mockResolvedValueOnce({
      status: 'mismatched', actorUserId: 'outgoing-owner', shopId: SHOP_ID,
    });
    render(createElement(PinLoginScreen));

    pressPin('1234');
    await paintAndSubmit();

    await waitFor(() => expect(deps.replace).toHaveBeenCalledWith({
      pathname: '/device-login', params: { role: 'staff' },
    }));
    expect(deps.recordSuccessfulLogin).not.toHaveBeenCalled();
    expect(deps.login).not.toHaveBeenCalled();
  });

  it('keeps a mismatched actor offline-capable without claiming cloud confirmation', async () => {
    deps.verifyPin.mockResolvedValueOnce({
      shopId: SHOP_ID,
      userId: USER_ID,
      role: 'staff',
      permissions: {},
    });
    deps.inspectCloudActorBinding.mockResolvedValueOnce({
      status: 'missing', actorUserId: null, shopId: null,
    });
    deps.networkReachability.mockResolvedValueOnce('offline');
    render(createElement(PinLoginScreen));

    pressPin('1234');
    await paintAndSubmit();

    await waitFor(() => expect(deps.login).toHaveBeenCalledWith(
      expect.objectContaining({ cloudActorConfirmed: false }),
    ));
    expect(deps.replace).toHaveBeenCalledWith('/staff-home');
  });

  it('keeps Confirm PIN visible while Owner setup hashes, then navigates', async () => {
    const setup = deferred<void>();
    deps.setOwnerPin.mockReturnValueOnce(setup.promise);
    deps.params.role = 'owner';
    render(createElement(PinSetupScreen));

    pressPin('4321');
    await paintAndSubmit();
    expect(screen.getByText('Confirm your PIN')).toBeTruthy();

    pressPin('4321');
    expect(screen.getByText('Setting up account…')).toBeTruthy();
    expect((screen.getByLabelText('Digit 4') as HTMLButtonElement).disabled).toBe(true);
    await paintAndSubmit();
    expect(deps.setOwnerPin).toHaveBeenCalledTimes(1);
    expect(deps.setOwnerPin).toHaveBeenCalledWith(USER_ID, '4321');

    setup.resolve();
    await waitFor(() => expect(deps.replace).toHaveBeenCalledWith('/dashboard'));
    expect(deps.refreshBillingStatus).toHaveBeenCalledWith(
      SHOP_ID,
      undefined,
      { isCurrent: expect.any(Function) },
    );
    expect(deps.verifyPinForUser).toHaveBeenCalledWith(
      '4321',
      SHOP_ID,
      USER_ID,
      expect.any(Object),
    );
    expect(deps.login).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      principalUserId: USER_ID,
      billingAccountId: 'account-1',
    }));
  });

  it('shows fresh-device loading for Staff, prevents duplicates, and recovers from failure', async () => {
    const login = deferred<void>();
    deps.loginOnNewDevice.mockReturnValueOnce(login.promise);
    render(createElement(DeviceLoginScreen));

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    pressPin('2468');

    expect(screen.getByText('Setting up account…')).toBeTruthy();
    expect((screen.getByLabelText('Digit 2') as HTMLButtonElement).disabled).toBe(true);
    await paintAndSubmit();
    fireEvent.click(screen.getByLabelText('Digit 2'));
    expect(deps.loginOnNewDevice).toHaveBeenCalledTimes(1);
    expect(deps.loginOnNewDevice).toHaveBeenCalledWith(
      '01712345678',
      '2468',
      expect.objectContaining({ correlationId: expect.any(String) }),
    );

    login.reject(new Error('network unavailable'));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText('Setting up account…')).toBeNull();
    expect((screen.getByLabelText('Digit 2') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('owner recovery is reachable from the PIN pad (H-4 #3)', () => {
  it('offers a visible recovery affordance', () => {
    render(createElement(PinLoginScreen));
    // Not decorative. A successful PIN no longer refills the attempt budget,
    // so an owner who has forgotten theirs can lock the pad — and without
    // this, waiting out the cooldown would be their only way forward.
    expect(screen.getByLabelText('Forgot your PIN? Recover access')).toBeTruthy();
  });

  it('routes to the existing OTP recovery flow', () => {
    render(createElement(PinLoginScreen));
    fireEvent.click(screen.getByLabelText('Forgot your PIN? Recover access'));
    // The existing screen, with no phone param: this pad never asked for one.
    expect(deps.push).toHaveBeenCalledWith('/forgot-pin');
  });

  it('tells staff what to do instead, since the pad cannot know who is holding it', () => {
    render(createElement(PinLoginScreen));
    expect(screen.getByText(/Staff: ask the shop\s+owner to reset your PIN/)).toBeTruthy();
  });

  it('uses the Bangla catalog for visible recovery copy and its accessibility name', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(PinLoginScreen));

    expect(screen.getByLabelText('পিন ভুলে গেছেন? অ্যাক্সেস পুনরুদ্ধার করুন')).toBeTruthy();
    expect(screen.getByText(
      'মালিক ফোন নম্বর দিয়ে অনলাইনে পুনরুদ্ধার করুন। কর্মী: পিন রিসেট করতে দোকানের মালিককে বলুন।',
    )).toBeTruthy();
    expect(screen.queryByText('Forgot your PIN? Recover access')).toBeNull();
  });

  it('stays reachable while the pad is locked out', async () => {
    const { PinLockedOutError } = await import('../db/errors');
    deps.verifyPin.mockRejectedValueOnce(new PinLockedOutError(30_000));
    render(createElement(PinLoginScreen));

    pressPin('9999');
    await paintAndSubmit();

    expect(await screen.findByText(/Too many incorrect attempts/)).toBeTruthy();
    // The lock is on GUESSING, not on recovering. Disabling recovery here
    // would be the one moment it is most needed.
    const recover = screen.getByLabelText('Forgot your PIN? Recover access') as HTMLButtonElement;
    expect(recover.disabled).toBeFalsy();
    fireEvent.click(recover);
    expect(deps.push).toHaveBeenCalledWith('/forgot-pin');
  });

  it('disables the keypad while locked, but not the way out', async () => {
    const { PinLockedOutError } = await import('../db/errors');
    deps.verifyPin.mockRejectedValueOnce(new PinLockedOutError(30_000));
    render(createElement(PinLoginScreen));

    pressPin('9999');
    await paintAndSubmit();

    expect((screen.getByLabelText('Digit 1') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Incorrect PIN — try again')).toBeNull();
  });
});
