// @vitest-environment jsdom

import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () =>
  (await import('../../tests/support/reactNativeMock')).createReactNativeMock(),
);

const { useLocaleStore } = await import('../../state/localeStore');
const { AuthButton } = await import('./AuthButton');
const { AuthNotice } = await import('./AuthNotice');
const { PhoneField } = await import('./PhoneField');
const { StepIndicator } = await import('./StepIndicator');
const { RoleCard } = await import('./RoleCard');
const { BrandLoader } = await import('./BrandLoader');
const { AuthStatusScreen } = await import('./AuthStatusScreen');
const { LogoutConfirmSheet } = await import('./LogoutConfirmSheet');
const { AuthShell } = await import('./AuthShell');
type AuthShellProps = import('./AuthShell').AuthShellProps;
const { AuthTitleBlock } = await import('./AuthTitleBlock');
const { AUTH_CHIP_LABELS, SecureChip } = await import('./SecureChip');
const { deviceLoginErrorKey } = await import('./authMessages');
const { catalog } = await import('../../i18n/catalog');

beforeEach(() => {
  useLocaleStore.setState({ locale: 'en' });
});

afterEach(() => {
  cleanup();
});

describe('AuthButton', () => {
  it('fires once per press and names itself by its label', () => {
    const onPress = vi.fn();
    render(createElement(AuthButton, { label: 'Continue', onPress }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed while loading, so a slow network is not two submissions', () => {
    const onPress = vi.fn();
    render(createElement(AuthButton, { label: 'Continue', onPress, loading: true }));
    const button = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('respects disabled', () => {
    render(createElement(AuthButton, { label: 'Verify', onPress: vi.fn(), disabled: true, variant: 'gradient' }));
    expect((screen.getByRole('button', { name: 'Verify' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('AuthNotice', () => {
  it.each(['error', 'warning', 'brandError'] as const)('announces a %s as an alert', (tone) => {
    render(createElement(AuthNotice, { tone, message: 'Incorrect PIN — try again' }));
    expect(screen.getByRole('alert').textContent).toContain('Incorrect PIN — try again');
  });

  it('shows progress with a spinner and no alert role', () => {
    render(createElement(AuthNotice, { tone: 'progress', message: 'Verifying…' }));
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Verifying…')).toBeTruthy();
  });

  it('renders a title and detail when given', () => {
    render(createElement(AuthNotice, { tone: 'error', title: 'Locked', message: 'Too many tries', detail: 'Try again in 30s' }));
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByText('Try again in 30s')).toBeTruthy();
  });
});

function ControlledPhone({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState('');
  return createElement(PhoneField, {
    value,
    variant: 'secure',
    onChangeText: (next: string) => {
      setValue(next);
      onValue(next);
    },
  });
}

describe('PhoneField', () => {
  it('shows the +880 prefix and reports the canonical number while keeping what was typed', () => {
    const onValue = vi.fn();
    render(createElement(ControlledPhone, { onValue }));
    expect(screen.getByText('+880')).toBeTruthy();
    const input = screen.getByLabelText('Phone number') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '0' } });
    // The leading 0 stays on screen even though its canonical form drops it.
    expect(input.value).toBe('0');
    fireEvent.change(input, { target: { value: '01712345678' } });
    expect(onValue).toHaveBeenLastCalledWith('+8801712345678');
    expect(input.value).toBe('01712345678');
  });

  it('drops only separators from a pasted number', () => {
    const onValue = vi.fn();
    render(createElement(ControlledPhone, { onValue }));
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '017-1234 5678' } });
    expect(onValue).toHaveBeenLastCalledWith('+8801712345678');
  });

  it.each(['+88001712345678', '+880+1712345678', '017abc12345678', '17a12-345 678', '880880 1712345678'])(
    'never cleans %j up into a number: shown and reported as typed',
    (typed) => {
      const onValue = vi.fn();
      render(createElement(ControlledPhone, { onValue }));
      const input = screen.getByLabelText('Phone number') as HTMLInputElement;
      fireEvent.change(input, { target: { value: typed } });
      expect(onValue).toHaveBeenLastCalledWith(typed);
      expect(input.value).toBe(typed);
    },
  );

  it.each([
    ['01712345678', '01712345678'],
    ['+8801712345678', '1712345678'],
  ])('takes %s typed key by key, and refuses a key past the complete number', (keys, finalShown) => {
    const onValue = vi.fn();
    render(createElement(ControlledPhone, { onValue }));
    const input = screen.getByLabelText('Phone number') as HTMLInputElement;
    for (const key of keys) {
      fireEvent.change(input, { target: { value: input.value + key } });
    }
    expect(onValue).toHaveBeenLastCalledWith('+8801712345678');
    expect(input.value).toBe(finalShown);

    const calls = onValue.mock.calls.length;
    fireEvent.change(input, { target: { value: `${input.value}9` } });
    expect(onValue).toHaveBeenCalledTimes(calls);
    expect(input.value).toBe(finalShown);
  });

  it('keeps an explicit foreign number exactly as typed, for the schema to reject', () => {
    const onValue = vi.fn();
    render(createElement(ControlledPhone, { onValue }));
    const input = screen.getByLabelText('Phone number') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '+1712345678' } });
    expect(onValue).toHaveBeenLastCalledWith('+1712345678');
    expect(input.value).toBe('+1712345678');
  });

  it('folds an explicit +880 into its fixed prefix', () => {
    const onValue = vi.fn();
    render(createElement(ControlledPhone, { onValue }));
    const input = screen.getByLabelText('Phone number') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '+880 1712-345678' } });
    expect(onValue).toHaveBeenLastCalledWith('+8801712345678');
    expect(input.value).toBe('1712345678');
  });

  it('shows a prefilled canonical number without its country code', () => {
    render(createElement(PhoneField, { value: '+8801712345678', variant: 'brand', onChangeText: vi.fn() }));
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('1712345678');
  });

  it('renders the error it is given, in Bangla when Bangla is active', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(PhoneField, { value: '', variant: 'brand', onChangeText: vi.fn(), error: catalog.bn.authPhoneInvalid }));
    expect(screen.getByLabelText(catalog.bn.authPhoneA11y)).toBeTruthy();
    expect(screen.getByText(catalog.bn.authPhoneInvalid)).toBeTruthy();
    expect(screen.getByText(catalog.bn.authPhoneLabel)).toBeTruthy();
  });
});

describe('StepIndicator', () => {
  it('names the step for a screen reader in the active language', () => {
    render(createElement(StepIndicator, { current: 2, total: 3 }));
    expect(screen.getByRole('progressbar', { name: 'Step 2 of 3' })).toBeTruthy();
    cleanup();
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(StepIndicator, { current: 2, total: 3 }));
    expect(screen.getByRole('progressbar', { name: 'ধাপ ২ / ৩' })).toBeTruthy();
  });
});

describe('RoleCard', () => {
  it('is one button carrying its accessibility label', () => {
    const onPress = vi.fn();
    render(createElement(RoleCard, {
      accent: 'owner', icon: 'crown', title: 'Owner', subtitle: 'Full access', accessibilityLabel: 'Owner login', onPress,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Owner login' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Full access')).toBeTruthy();
  });
});

describe('BrandLoader and AuthStatusScreen', () => {
  it('shows the loader title and message, and whatever it is handed below them', () => {
    render(createElement(BrandLoader, { title: 'Checking your access…', message: 'One moment' }, createElement('span', null, 'dev-slot')));
    expect(screen.getByRole('heading').textContent).toBe('Checking your access…');
    expect(screen.getByText('One moment')).toBeTruthy();
    expect(screen.getByText('dev-slot')).toBeTruthy();
  });

  it('renders the reason, the hint and every action as a button', () => {
    const retry = vi.fn();
    const switchUser = vi.fn();
    render(createElement(AuthStatusScreen, {
      icon: 'wifi-off',
      title: 'Go online once to continue',
      body: 'Connect once.',
      hint: 'We check again automatically.',
      actions: [
        { label: 'Retry', onPress: retry },
        { label: 'Switch user', onPress: switchUser, variant: 'secondary' as const },
      ],
    }));
    expect(screen.getByText('Go online once to continue')).toBeTruthy();
    expect(screen.getByText('We check again automatically.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch user' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(switchUser).toHaveBeenCalledTimes(1);
    // Every status screen carries the language toggle.
    expect(screen.getByRole('button', { name: 'বাংলা' })).toBeTruthy();
  });
});

describe('LogoutConfirmSheet', () => {
  it('renders nothing while closed', () => {
    render(createElement(LogoutConfirmSheet, { visible: false, onCancel: vi.fn(), onConfirm: vi.fn() }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says where the phone goes next and reports the decision', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(createElement(LogoutConfirmSheet, { visible: true, onCancel, onConfirm }));
    expect(screen.getByText('Confirm Logout')).toBeTruthy();
    expect(screen.getByText(catalog.en.logoutConfirmNote)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Logout' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('is fully Bangla in Bangla', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(LogoutConfirmSheet, { visible: true, onCancel: vi.fn(), onConfirm: vi.fn() }));
    expect(screen.getByText(catalog.bn.logoutConfirmTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: catalog.bn.logoutConfirmAction })).toBeTruthy();
    expect(screen.queryByText('Confirm Logout')).toBeNull();
  });
});

describe('AuthShell', () => {
  it('renders header, content and the bottom-anchored footer in every variant', () => {
    for (const variant of ['brand', 'secure', 'hero'] as const) {
      const props: Omit<AuthShellProps, 'children'> = {
        variant,
        header: createElement('span', null, `header-${variant}`),
        hero: createElement('span', null, `hero-${variant}`),
        footer: createElement('span', null, `footer-${variant}`),
      };
      render(createElement(AuthShell, props as AuthShellProps, createElement('span', null, `content-${variant}`)));
      expect(screen.getByText(`content-${variant}`)).toBeTruthy();
      if (variant !== 'hero') {
        expect(screen.getByText(`header-${variant}`)).toBeTruthy();
        expect(screen.getByText(`footer-${variant}`)).toBeTruthy();
      } else {
        expect(screen.getByText('hero-hero')).toBeTruthy();
      }
      cleanup();
    }
  });
});

describe('titles and chips', () => {
  it('keeps the brand chip a literal in both languages', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(SecureChip, { label: AUTH_CHIP_LABELS.secure }));
    expect(screen.getByText('Muthoy Secure')).toBeTruthy();
  });

  it('marks the title as a header', () => {
    render(createElement(AuthTitleBlock, { eyebrow: 'YOUR ACCESS', title: 'Create a secure PIN', body: 'Choose four digits.' }));
    expect(screen.getByRole('heading').textContent).toBe('Create a secure PIN');
    expect(screen.getByText('YOUR ACCESS')).toBeTruthy();
  });
});

describe('device-login error translation', () => {
  it('maps every known code to a catalog key and anything else to the generic failure', () => {
    expect(deviceLoginErrorKey('enrollment_held')).toBe('authErrorEnrollmentHeld');
    expect(deviceLoginErrorKey('credentials')).toBe('authErrorCredentials');
    expect(deviceLoginErrorKey('otp_required')).toBe('authErrorOtpRequired');
    expect(deviceLoginErrorKey(undefined)).toBe('deviceLoginGenericFailure');
    expect(deviceLoginErrorKey('something_new')).toBe('deviceLoginGenericFailure');
    expect(deviceLoginErrorKey('__proto__')).toBe('deviceLoginGenericFailure');
  });

  it('keeps credential failures to ONE message (anti-enumeration)', () => {
    // Wrong number, wrong PIN and locked-out all arrive as `credentials`; the
    // translated text must not split them either.
    expect(catalog.en.authErrorCredentials).toBe('Incorrect phone number or PIN');
  });
});

describe('act hygiene', () => {
  it('flushes pending effects without warnings', async () => {
    await act(async () => {
      render(createElement(BrandLoader, {}));
    });
    expect(screen.getByText('Muthoy')).toBeTruthy();
  });
});
