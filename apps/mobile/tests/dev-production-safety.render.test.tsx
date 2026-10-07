// @vitest-environment jsdom
//
// H-2 — the behavioural half of the production-safety proof.
//
// dev-production-safety.test.ts proves the DEV bypass and the DEV registration
// harness are absent from the import graph. This file proves the screen a user
// can actually reach renders no bypass, repair or harness affordance — in the
// production build mode that vitest.config.ts pins (`define: { __DEV__: false }`)
// and, since H-5 removed the harness, in a dev build too — and that the real
// OTP submission still runs unchanged underneath.

import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  sendOtp: vi.fn(async (_phone: string) => undefined),
  push: vi.fn(),
  replace: vi.fn(),
  alert: vi.fn(),
}));

interface StubProps {
  children?: ReactNode;
  className?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}

vi.mock('react-native', () => ({
  Alert: { alert: deps.alert },
  ActivityIndicator: () => createElement('span', null, 'spinner'),
  View: ({ children, className }: StubProps) => createElement('div', { className }, children),
  Text: ({ children, className }: StubProps) => createElement('span', { className }, children),
  Pressable: ({ children, onPress, accessibilityLabel }: StubProps) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
  // Auth parity: Registration now renders inside the shared auth shell, which
  // scrolls and avoids the keyboard. Layout only; nothing asserted changes.
  ScrollView: ({ children }: StubProps) => createElement('div', null, children),
  KeyboardAvoidingView: ({ children }: StubProps) => createElement('div', null, children),
}));

vi.mock('expo-router', () => ({ router: { push: deps.push, replace: deps.replace } }));
vi.mock('../sync/otp', () => ({ sendOtp: (phone: string) => deps.sendOtp(phone) }));

// The real form is react-hook-form + Zod over RN TextInputs; none of that is
// under test here. Stub it down to the one thing that matters — that pressing
// submit reaches the production OTP call.
vi.mock('../components/forms/RegistrationForm', () => ({
  RegistrationForm: ({
    onSubmit,
  }: {
    onSubmit: (input: { shopName: string; phone: string }) => void;
  }) =>
    createElement(
      'button',
      {
        'aria-label': 'submit registration',
        onClick: () => onSubmit({ shopName: 'Test Pharmacy', phone: '+8801812345678' }),
      },
      'register',
    ),
}));

const { default: RegisterScreen } = await import('../app/(auth)/register');
const { markRuntimeDiagnosticStep, runtimeDiagnosticError, sessionDiagnosticContext } =
  await import('../dev/runtimeDiagnostics');

const SESSION = { shopId: 'shop-1', userId: 'user-1', role: 'owner', permissions: undefined };

beforeEach(() => {
  deps.sendOtp.mockClear();
  deps.push.mockClear();
  deps.replace.mockClear();
  deps.alert.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('H-2 · Registration in production mode', () => {
  it('renders no Skip OTP control', () => {
    render(createElement(RegisterScreen));
    expect(screen.queryByText(/skip otp/i)).toBeNull();
    expect(screen.queryByLabelText(/skip otp/i)).toBeNull();
    expect(screen.queryByText(/resume linking/i)).toBeNull();
  });

  it('renders no Repair owner link control', () => {
    render(createElement(RegisterScreen));
    expect(screen.queryByText(/repair owner link/i)).toBeNull();
    expect(screen.queryByLabelText(/repair owner link/i)).toBeNull();
    expect(screen.queryByText(/hook_not_configured/i)).toBeNull();
  });

  it('renders no dev-build banner and no DEV registration control', () => {
    render(createElement(RegisterScreen));
    expect(screen.queryByText(/dev build only/i)).toBeNull();
    expect(screen.queryByText(/temporary dev build/i)).toBeNull();
    expect(screen.queryByText(/anonymously/i)).toBeNull();
    expect(screen.queryByLabelText('Dev: Create test shop')).toBeNull();
    expect(screen.queryByText(/create test shop/i)).toBeNull();
  });

  // The point of removing the bypass is that the real path is the only path.
  it('still sends a real OTP and advances to verification', async () => {
    render(createElement(RegisterScreen));
    fireEvent.click(screen.getByLabelText('submit registration'));
    await vi.waitFor(() => expect(deps.sendOtp).toHaveBeenCalledWith('+8801812345678'));
    expect(deps.push).toHaveBeenCalledWith({
      pathname: '/otp-verify',
      params: { phone: '+8801812345678', shopName: 'Test Pharmacy' },
    });
  });
});

describe('H-5 · Registration in a dev build is the same screen', () => {
  // The DEV registration harness is deleted, not hidden: a dev build has no
  // control a release build lacks, and its only way forward is the real OTP.
  it('renders no DEV registration control even with __DEV__ on', () => {
    vi.stubGlobal('__DEV__', true);
    render(createElement(RegisterScreen));
    expect(screen.queryByText(/dev build only/i)).toBeNull();
    expect(screen.queryByLabelText('Dev: Create test shop')).toBeNull();
    expect(screen.queryByText(/create test shop/i)).toBeNull();
    expect(screen.queryByLabelText(/restore test owner session/i)).toBeNull();
  });

  it('still sends a real OTP and advances to verification with __DEV__ on', async () => {
    vi.stubGlobal('__DEV__', true);
    render(createElement(RegisterScreen));
    fireEvent.click(screen.getByLabelText('submit registration'));
    await vi.waitFor(() => expect(deps.sendOtp).toHaveBeenCalledWith('+8801812345678'));
    expect(deps.push).toHaveBeenCalledWith({
      pathname: '/otp-verify',
      params: { phone: '+8801812345678', shopName: 'Test Pharmacy' },
    });
    expect(deps.replace).not.toHaveBeenCalled();
  });
});

describe('H-2 · runtime diagnostics refuse to run in production mode', () => {
  it('assembles no session identifiers at all', () => {
    // Not "assembles them but does not log them" — an object that never holds
    // a user or shop id cannot leak one through a future caller.
    expect(sessionDiagnosticContext(SESSION as never, '/dashboard')).toEqual({});
  });

  it('emits nothing on any console channel', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    markRuntimeDiagnosticStep('pin_submit', sessionDiagnosticContext(SESSION as never, '/pin-login'));
    runtimeDiagnosticError(new Error('boom'), sessionDiagnosticContext(SESSION as never, '/pin-login'));

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('returns an identifier-free snapshot even when handed a populated context', () => {
    const snapshot = runtimeDiagnosticError(new Error('boom'), {
      currentRoute: '/staff-home',
      userId: 'user-1',
      shopId: 'shop-1',
      resolvedRole: 'staff',
      permissionCount: 2,
    });

    expect(snapshot).toEqual({
      currentRoute: 'unknown',
      userId: 'none',
      shopId: 'none',
      resolvedRole: 'unknown',
      permissionCount: 0,
      lastCompletedStep: 'none',
    });
    expect(JSON.stringify(snapshot)).not.toContain('user-1');
    expect(JSON.stringify(snapshot)).not.toContain('shop-1');
    expect(snapshot.errorMessage).toBeUndefined();
    expect(snapshot.stack).toBeUndefined();
  });

  it('still works when a developer flips __DEV__ on', () => {
    vi.stubGlobal('__DEV__', true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const context = sessionDiagnosticContext(SESSION as never, '/dashboard');
    expect(context).toMatchObject({ userId: 'user-1', shopId: 'shop-1', resolvedRole: 'owner' });
    markRuntimeDiagnosticStep('dashboard_mounted', context);
    expect(log).toHaveBeenCalledWith(
      '[staff-home:diagnostic-step]',
      expect.objectContaining({ userId: 'user-1', shopId: 'shop-1' }),
    );
  });
});
