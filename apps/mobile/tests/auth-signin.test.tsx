// @vitest-environment jsdom
//
// Auth parity, Phase C: sign-in and shared-till surfaces — PIN Login's new
// states (typed refusal, localized lock, one-time sign-out notice), Device
// Login's translated refusals, Forgot PIN's stale-code recovery, the H-3
// recovery screen's PIN pad, and the shared logout sheet's handover. The
// H-4 loading/lock/revocation behaviour itself stays pinned by
// tests/auth-pin-latency.test.tsx.

import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () =>
  (await import('./support/reactNativeMock')).createReactNativeMock(),
);

const deps = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  dismissAll: vi.fn(),
  canDismiss: vi.fn(() => true),
  verifyPin: vi.fn(),
  recordSuccessfulLogin: vi.fn(),
  loginOnNewDevice: vi.fn(),
  recoverOwnerPin: vi.fn(),
  sendOtp: vi.fn(),
  resendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  recoverDatabaseFromServer: vi.fn(),
  inspectCloudActorBinding: vi.fn(),
  networkReachability: vi.fn(),
  switchActorOnDevice: vi.fn(),
  switchUser: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: {
    push: deps.push,
    replace: deps.replace,
    back: deps.back,
    dismissAll: deps.dismissAll,
    canDismiss: deps.canDismiss,
  },
  useLocalSearchParams: () => deps.params,
}));
vi.mock('../db/auth', () => ({ verifyPin: deps.verifyPin, recordSuccessfulLogin: deps.recordSuccessfulLogin }));
vi.mock('../sync/deviceAuth', () => {
  class DeviceLoginError extends Error {
    constructor(message: string, readonly isCredentialFailure: boolean, readonly code: string) {
      super(message);
      this.name = 'DeviceLoginError';
    }
  }
  return { DeviceLoginError, loginOnNewDevice: deps.loginOnNewDevice, recoverOwnerPin: deps.recoverOwnerPin };
});
vi.mock('../sync/otp', () => ({ sendOtp: deps.sendOtp, resendOtp: deps.resendOtp, verifyOtp: deps.verifyOtp }));
vi.mock('../sync/databaseRecovery', () => ({ recoverDatabaseFromServer: deps.recoverDatabaseFromServer }));
vi.mock('../sync/authActorBinding', () => ({ inspectCloudActorBinding: deps.inspectCloudActorBinding }));
vi.mock('../sync/connectivity', () => ({ networkReachability: deps.networkReachability }));
vi.mock('../sync/deviceRegistry', () => {
  class DeviceRegistryError extends Error {
    constructor(readonly code: string | null, message: string) {
      super(message);
    }
  }
  return { DeviceRegistryError, switchActorOnDevice: deps.switchActorOnDevice };
});
vi.mock('../state/switchUser', () => ({ switchUser: deps.switchUser }));

const { useLocaleStore } = await import('../state/localeStore');
const { useSessionStore } = await import('../state/sessionStore');
const { recordSignOutNotice, clearSignOutNotice, peekSignOutNotice } = await import('../state/signOutNotice');
const { PinAccountRefusedError, PinLockedOutError } = await import('../db/errors');
const { DeviceLoginError } = await import('../sync/deviceAuth');
const { OtpCodeRejectedError, OtpRateLimitedError, OtpSendFailedError, OtpVerifyFailedError } =
  await import('../sync/otpPolicy');
const { catalog } = await import('../i18n/catalog');
const { default: PinLoginScreen } = await import('../app/(auth)/pin-login');
const { default: DeviceLoginScreen } = await import('../app/(auth)/device-login');
const { default: ForgotPinScreen } = await import('../app/(auth)/forgot-pin');
const { DatabaseRecoveryScreen } = await import('../components/database/DatabaseRecoveryScreen');
const { endShiftToPinPad } = await import('../navigation/endShift');

let frameQueue: FrameRequestCallback[];

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'en' });
  useSessionStore.setState({ session: null, epoch: 0, lastShopId: null, authorityTransitioning: false });
  clearSignOutNotice();
  deps.params = {};
  deps.canDismiss.mockReturnValue(true);
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frameQueue.push(callback);
    return frameQueue.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function pressPin(pin: string, locale: 'en' | 'bn' = 'en'): void {
  const label = catalog[locale].pinDigitA11y;
  const digits = '০১২৩৪৫৬৭৮৯';
  act(() => {
    for (const digit of pin) {
      const shown = locale === 'bn' ? digits[Number(digit)] : digit;
      fireEvent.click(screen.getByLabelText(`${label} ${shown}`));
    }
  });
}

async function paintAndSubmit(): Promise<void> {
  act(() => frameQueue.shift()?.(0));
  await act(async () => frameQueue.shift()?.(16));
}

describe('PIN Login', () => {
  it('says a correct-but-refused PIN is refused, not incorrect', async () => {
    deps.verifyPin.mockRejectedValueOnce(new PinAccountRefusedError('staff_limit'));
    render(createElement(PinLoginScreen));
    pressPin('4321');
    await paintAndSubmit();

    expect(await screen.findByText(catalog.en.pinRefusedStaffLimit)).toBeTruthy();
    expect(screen.queryByText(catalog.en.pinIncorrect)).toBeNull();
    expect(deps.recordSuccessfulLogin).not.toHaveBeenCalled();
    // The pad is not locked by a refusal.
    expect((screen.getByLabelText('Digit 1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('counts the lockout down in Bangla digits, and never shows attempts left', async () => {
    useLocaleStore.setState({ locale: 'bn' });
    deps.verifyPin.mockRejectedValueOnce(new PinLockedOutError(245_000));
    render(createElement(PinLoginScreen));
    pressPin('1111', 'bn');
    await paintAndSubmit();

    expect(await screen.findByText(catalog.bn.pinLockedTitle)).toBeTruthy();
    expect(screen.getByText(/৪ মি ০৫ সে পরে/)).toBeTruthy();
    expect(screen.queryByText(/attempt|চেষ্টা বাকি/i)).toBeNull();
  });

  it('shows the one-time sign-out notice by category, then forgets it', () => {
    recordSignOutNotice('access_changed');
    const { unmount } = render(createElement(PinLoginScreen));
    expect(screen.getByText(catalog.en.signedOutTitle)).toBeTruthy();
    expect(screen.getByText(catalog.en.signedOutAccessChanged)).toBeTruthy();
    expect(peekSignOutNotice()).toBeNull();
    unmount();

    render(createElement(PinLoginScreen));
    expect(screen.queryByText(catalog.en.signedOutTitle)).toBeNull();
  });

  it('warns on a wrong PIN without adding any delay of its own', async () => {
    deps.verifyPin.mockResolvedValueOnce(null);
    render(createElement(PinLoginScreen));
    pressPin('9999');
    await paintAndSubmit();
    expect(await screen.findByText(catalog.en.pinIncorrect)).toBeTruthy();
    expect(screen.getByText(catalog.en.pinIncorrectHint)).toBeTruthy();
    expect(deps.verifyPin).toHaveBeenCalledTimes(1);
  });
});

describe('Device Login', () => {
  async function submit(phone: string, pin: string) {
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: phone } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    pressPin(pin);
    await paintAndSubmit();
  }

  it('explains why a correct PIN was not enough when sent here to re-link', () => {
    deps.params = { role: 'staff', reason: 'relink' };
    render(createElement(DeviceLoginScreen));
    expect(screen.getByText(catalog.en.deviceLoginRelinkNotice)).toBeTruthy();
    expect(screen.getByText('Muthoy Staff')).toBeTruthy();
  });

  // H-5. Arriving from Forgot PIN's pin_changed_login_required hand-off: the
  // new PIN already works here, this screen just says so.
  it.each(['en', 'bn'] as const)('%s: confirms the new PIN works on normal sign-in after partial recovery', (locale) => {
    useLocaleStore.setState({ locale });
    deps.params = { role: 'owner', reason: 'pin-recovered' };
    render(createElement(DeviceLoginScreen));
    expect(screen.getByText(catalog[locale].authErrorPinChangedLoginRequired)).toBeTruthy();
  });

  it('shows an enrolment hold as "waiting for approval", in the active language', async () => {
    useLocaleStore.setState({ locale: 'bn' });
    deps.params = { role: 'owner' };
    deps.loginOnNewDevice.mockRejectedValueOnce(
      new DeviceLoginError('Another active Owner or Manager must approve this device.', false, 'enrollment_held'),
    );
    render(createElement(DeviceLoginScreen));
    fireEvent.change(screen.getByLabelText(catalog.bn.authPhoneA11y), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByRole('button', { name: catalog.bn.deviceLoginContinue }));
    pressPin('2468', 'bn');
    await paintAndSubmit();

    expect(await screen.findByText(catalog.bn.deviceHeldTitle)).toBeTruthy();
    expect(screen.getByText(catalog.bn.authErrorEnrollmentHeld)).toBeTruthy();
  });

  it('keeps every credential failure to one message (anti-enumeration)', async () => {
    deps.params = { role: 'owner' };
    deps.loginOnNewDevice.mockRejectedValueOnce(new DeviceLoginError('Incorrect phone number or PIN', true, 'credentials'));
    render(createElement(DeviceLoginScreen));
    await submit('01712345678', '2468');
    expect(await screen.findByText(catalog.en.authErrorCredentials)).toBeTruthy();
    expect(screen.queryByText(/no account|not registered/i)).toBeNull();
  });

  it.each(['0171', '+88001712345678', '+880+1712345678', '017abc12345678'])(
    'rejects %j before any request, in words — never cleaned up into a number',
    (typed) => {
      render(createElement(DeviceLoginScreen));
      fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: typed } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(screen.getByText(catalog.en.authPhoneInvalid)).toBeTruthy();
      // Still on the phone step: no PIN pad, and nothing sent.
      expect(screen.getByLabelText('Phone number')).toBeTruthy();
      expect(deps.loginOnNewDevice).not.toHaveBeenCalled();
    },
  );

  it('switches the role label only; the endpoint decides the role', () => {
    deps.params = { role: 'owner' };
    render(createElement(DeviceLoginScreen));
    fireEvent.click(screen.getByRole('button', { name: catalog.en.deviceLoginStaffTitle }));
    expect(deps.replace).toHaveBeenCalledWith({ pathname: '/device-login', params: { role: 'staff' } });
  });
});

describe('Forgot PIN', () => {
  it('canonicalizes a prefilled number and proves and recovers with exactly that number', async () => {
    deps.params = { phone: '01712345678' };
    deps.sendOtp.mockResolvedValue(undefined);
    deps.verifyOtp.mockResolvedValue({});
    deps.recoverOwnerPin.mockResolvedValue(undefined);
    render(createElement(ForgotPinScreen));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
    });
    expect(deps.sendOtp).toHaveBeenCalledWith('+8801712345678');

    const otp = screen.getAllByLabelText(catalog.en.otpInputA11y).find((node) => node.tagName === 'INPUT')!;
    await act(async () => {
      fireEvent.change(otp, { target: { value: '123456' } });
    });
    expect(deps.verifyOtp).toHaveBeenCalledWith('+8801712345678', '123456');
    pressPin('2468');
    await paintAndSubmit();
    pressPin('2468');
    await paintAndSubmit();

    await waitFor(() => expect(deps.recoverOwnerPin).toHaveBeenCalledWith('+8801712345678', '2468'));
  });

  it.each(['+1712345678', '+911712345678', '(+1) 712345678', '017123456789'])(
    'rejects a %j prefill: never shown as Bangladeshi, never sent',
    async (phone) => {
      deps.params = { phone };
      render(createElement(ForgotPinScreen));
      // Not prefilled as a Bangladeshi number (the old bug showed 1712345678).
      expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
      });
      expect(screen.getByText(catalog.en.authPhoneInvalid)).toBeTruthy();
      expect(deps.sendOtp).not.toHaveBeenCalled();
      expect(deps.resendOtp).not.toHaveBeenCalled();
      expect(deps.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it.each(['01712345678', '1712345678', '8801712345678', '+8801712345678'])(
    'sends the code for a %j prefill to the canonical number',
    async (phone) => {
      deps.params = { phone };
      deps.sendOtp.mockResolvedValue(undefined);
      render(createElement(ForgotPinScreen));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
      });
      expect(deps.sendOtp).toHaveBeenCalledWith('+8801712345678');
    },
  );

  it('rejects a foreign number typed into the field before any request', async () => {
    render(createElement(ForgotPinScreen));
    const field = screen.getByLabelText('Phone number') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '+1712345678' } });
    // Shown exactly as typed, not as +880 1712345678.
    expect(field.value).toBe('+1712345678');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
    });
    expect(screen.getByText(catalog.en.authPhoneInvalid)).toBeTruthy();
    expect(deps.sendOtp).not.toHaveBeenCalled();
  });

  it('sends the owner back for a new code when the proof went stale', async () => {
    deps.params = { phone: '+8801712345678' };
    deps.sendOtp.mockResolvedValue(undefined);
    deps.verifyOtp.mockResolvedValue({});
    deps.recoverOwnerPin.mockRejectedValueOnce(
      new DeviceLoginError('Your verification code is too old. Request a new code.', false, 'otp_required'),
    );
    render(createElement(ForgotPinScreen));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
    });
    expect(deps.sendOtp).toHaveBeenCalledWith('+8801712345678');

    const otp = screen.getAllByLabelText(catalog.en.otpInputA11y).find((node) => node.tagName === 'INPUT')!;
    await act(async () => {
      fireEvent.change(otp, { target: { value: '123456' } });
    });
    pressPin('2468');
    await paintAndSubmit();
    pressPin('2468');
    await paintAndSubmit();

    expect(await screen.findByText(catalog.en.authErrorOtpRequired)).toBeTruthy();
    // Back on the code step, with a way to get a new code.
    expect(screen.getAllByLabelText(catalog.en.otpInputA11y).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: catalog.en.otpResend })).toBeTruthy();
    expect(deps.replace).not.toHaveBeenCalled();
  });

  // H-5. The one recover-pin refusal that is not a refusal: the server has
  // already committed the new PIN, only the automatic sign-in that was
  // supposed to follow could not finish. Nothing on THIS screen can be
  // retried, so it hands off to normal phone+PIN sign-in instead of showing
  // an error on a step that has nothing left to do.
  it.each(['en', 'bn'] as const)('%s: routes to normal sign-in when the server confirms the PIN changed', async (locale) => {
    useLocaleStore.setState({ locale });
    deps.params = { phone: '+8801712345678' };
    deps.sendOtp.mockResolvedValue(undefined);
    deps.verifyOtp.mockResolvedValue({});
    deps.recoverOwnerPin.mockRejectedValueOnce(
      new DeviceLoginError('PIN changed successfully. Sign in with your new PIN.', false, 'pin_changed_login_required'),
    );
    render(createElement(ForgotPinScreen));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog[locale].forgotPinSendCode }));
    });
    const otp = screen.getAllByLabelText(catalog[locale].otpInputA11y).find((node) => node.tagName === 'INPUT')!;
    await act(async () => {
      fireEvent.change(otp, { target: { value: '123456' } });
    });
    pressPin('2468', locale);
    await paintAndSubmit();
    pressPin('2468', locale);
    await paintAndSubmit();

    expect(deps.replace).toHaveBeenCalledWith({
      pathname: '/device-login',
      params: { role: 'owner', reason: 'pin-recovered' },
    });
  });

  // H-5 (DEV, 2026-10-05). Every refusal used to read "Could not reach the
  // server" right after the owner had paid for the SMS. Each is now its own
  // message, and only a request that got no answer is a network failure.
  it.each([
    ['en', 'pin_in_use', 'authErrorPinInUse'],
    ['bn', 'pin_in_use', 'authErrorPinInUse'],
    ['en', 'recovery_failed', 'authErrorRecoveryFailed'],
    ['bn', 'recovery_failed', 'authErrorRecoveryFailed'],
    ['en', 'recovery_refused', 'authErrorRecoveryRefused'],
    ['bn', 'recovery_refused', 'authErrorRecoveryRefused'],
    ['en', 'network', 'authErrorNetwork'],
    // No response at all. Unlike every other case here, the write may
    // already have landed — see deviceAuth.ts's toRecoverPinError — so this
    // reads distinctly from the confident-retry `network` message above.
    ['en', 'recovery_uncertain', 'authErrorRecoveryUncertain'],
    ['bn', 'recovery_uncertain', 'authErrorRecoveryUncertain'],
  ] as const)('%s: a %s refusal shows its own message and stays on the new-PIN step', async (locale, code, key) => {
    useLocaleStore.setState({ locale });
    deps.params = { phone: '+8801712345678' };
    deps.sendOtp.mockResolvedValue(undefined);
    deps.verifyOtp.mockResolvedValue({});
    deps.recoverOwnerPin.mockRejectedValueOnce(new DeviceLoginError('English fallback', false, code));
    render(createElement(ForgotPinScreen));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog[locale].forgotPinSendCode }));
    });
    const otp = screen.getAllByLabelText(catalog[locale].otpInputA11y).find((node) => node.tagName === 'INPUT')!;
    await act(async () => {
      fireEvent.change(otp, { target: { value: '123456' } });
    });
    pressPin('2468', locale);
    await paintAndSubmit();
    pressPin('2468', locale);
    await paintAndSubmit();

    expect(await screen.findByText(catalog[locale][key])).toBeTruthy();
    if (code !== 'network') expect(screen.queryByText(catalog[locale].authErrorNetwork)).toBeNull();
    expect(screen.queryByText('English fallback')).toBeNull();
    // Still choosing a PIN — a PIN already in use is fixed by choosing another.
    expect(screen.getByText(catalog[locale].forgotPinNewTitle)).toBeTruthy();
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it('shows progress inline instead of replacing the screen', async () => {
    let finishSend!: () => void;
    deps.sendOtp.mockReturnValueOnce(new Promise<void>((resolve) => { finishSend = resolve; }));
    deps.params = { phone: '+8801712345678' };
    render(createElement(ForgotPinScreen));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
    });
    expect(screen.getByText(catalog.en.forgotPinSending)).toBeTruthy();
    expect(screen.getByText(catalog.en.forgotPinTitle)).toBeTruthy();
    await act(async () => finishSend());
  });

  // H-5. Typed OTP failures, never message text.
  describe('OTP failures', () => {
    function codeField(): HTMLInputElement {
      return screen.getAllByLabelText(catalog.en.otpInputA11y).find((node) => node.tagName === 'INPUT') as HTMLInputElement;
    }

    async function reachCodeStep(): Promise<void> {
      deps.params = { phone: '+8801712345678' };
      deps.sendOtp.mockResolvedValue(undefined);
      render(createElement(ForgotPinScreen));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('names a rate limit and stays on the number', async () => {
      deps.params = { phone: '+8801712345678' };
      deps.sendOtp.mockRejectedValueOnce(new OtpRateLimitedError());
      render(createElement(ForgotPinScreen));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
      });
      expect(screen.getByText(catalog.en.otpRateLimited)).toBeTruthy();
      expect(screen.getByRole('button', { name: catalog.en.forgotPinSendCode })).toBeTruthy();
    });

    it.each(['en', 'bn'] as const)(
      'after a send, shows the same neutral prompt as registration, whoever the number belongs to (%s)',
      async (locale) => {
        // Nothing here knows whether an owner has this number, or whether the
        // SMS went out — so the prompt says neither.
        useLocaleStore.setState({ locale });
        deps.params = { phone: '+8801712345678' };
        deps.sendOtp.mockResolvedValue(undefined);
        render(createElement(ForgotPinScreen));
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: catalog[locale].forgotPinSendCode }));
        });
        expect(screen.getByText(catalog[locale].otpCheckMessages)).toBeTruthy();
      },
    );

    it('gives every other send failure one message, whoever the number belongs to', async () => {
      deps.params = { phone: '+8801712345678' };
      deps.sendOtp.mockRejectedValueOnce(new OtpSendFailedError());
      render(createElement(ForgotPinScreen));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: catalog.en.forgotPinSendCode }));
      });
      expect(screen.getByText(catalog.en.otpSendFailed)).toBeTruthy();
    });

    it('calls a refused code incorrect while it can still be valid', async () => {
      await reachCodeStep();
      deps.verifyOtp.mockRejectedValueOnce(new OtpCodeRejectedError());
      await act(async () => {
        fireEvent.change(codeField(), { target: { value: '111111' } });
      });
      expect(screen.getByText(catalog.en.otpIncorrect)).toBeTruthy();
      expect(deps.recoverOwnerPin).not.toHaveBeenCalled();
    });

    it('calls a refused code expired once its five-minute lifetime has passed', async () => {
      vi.useFakeTimers();
      await reachCodeStep();
      act(() => {
        vi.advanceTimersByTime(300_000);
      });
      deps.verifyOtp.mockRejectedValueOnce(new OtpCodeRejectedError());
      await act(async () => {
        fireEvent.change(codeField(), { target: { value: '111111' } });
      });
      expect(screen.getByText(catalog.en.otpExpired)).toBeTruthy();
    });

    it('never calls a code wrong when it could not be checked', async () => {
      await reachCodeStep();
      deps.verifyOtp.mockRejectedValueOnce(new OtpVerifyFailedError());
      await act(async () => {
        fireEvent.change(codeField(), { target: { value: '123456' } });
      });
      expect(screen.getByText(catalog.en.otpVerifyFailed)).toBeTruthy();
      expect(screen.queryByText(catalog.en.otpIncorrect)).toBeNull();
    });

    it('waits a full minute before offering a resend, and restarts the wait on a rate limit', async () => {
      vi.useFakeTimers();
      await reachCodeStep();
      expect(screen.getByText(`60${catalog.en.otpSecondsSuffix}`)).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(59_000);
      });
      expect(screen.queryByRole('button', { name: catalog.en.otpResend })).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      deps.resendOtp.mockRejectedValueOnce(new OtpRateLimitedError());
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: catalog.en.otpResend }));
      });
      expect(screen.getByText(catalog.en.otpRateLimited)).toBeTruthy();
      expect(screen.getByText(`60${catalog.en.otpSecondsSuffix}`)).toBeTruthy();
    });
  });
});

describe('H-3 database recovery', () => {
  it('takes the PIN on the secure pad, never in a text field', async () => {
    deps.recoverDatabaseFromServer.mockResolvedValueOnce(undefined);
    const onRestored = vi.fn();
    render(createElement(DatabaseRecoveryScreen, { canRestore: true, onRetry: vi.fn(), onRestored }));
    expect(screen.queryByLabelText(/Recovery PIN/i)).toBeNull();

    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByRole('button', { name: catalog.en.dbRestoreAction }));
    // The PIN step has no text input at all: only the pad.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    pressPin('2468');
    await paintAndSubmit();

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(deps.recoverDatabaseFromServer).toHaveBeenCalledWith('+8801712345678', '2468');
  });

  it('keeps the locked database and says so when the restore fails', async () => {
    deps.recoverDatabaseFromServer.mockRejectedValueOnce(new Error('disk'));
    render(createElement(DatabaseRecoveryScreen, { canRestore: true, onRetry: vi.fn(), onRestored: vi.fn() }));
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByRole('button', { name: catalog.en.dbRestoreAction }));
    pressPin('2468');
    await paintAndSubmit();
    expect(await screen.findByText(catalog.en.dbRestoreFailed)).toBeTruthy();
  });

  it('offers only secure-storage retry when a restore is not possible', () => {
    const onRetry = vi.fn();
    render(createElement(DatabaseRecoveryScreen, { canRestore: false, onRetry, onRestored: vi.fn() }));
    expect(screen.getByText(catalog.en.dbUnavailableTitle)).toBeTruthy();
    expect(screen.queryByLabelText('Phone number')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: catalog.en.dbRetryStorage }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ending a shift', () => {
  it('hands over, leaves nothing underneath the PIN pad, and returns to the root gate', () => {
    endShiftToPinPad();
    expect(deps.switchUser).toHaveBeenCalledTimes(1);
    expect(deps.dismissAll).toHaveBeenCalledTimes(1);
    expect(deps.replace).toHaveBeenCalledWith('/');
    expect(deps.switchUser.mock.invocationCallOrder[0]).toBeLessThan(deps.replace.mock.invocationCallOrder[0]!);
  });

  it('does not try to dismiss a stack that has nothing to dismiss', () => {
    deps.canDismiss.mockReturnValue(false);
    endShiftToPinPad();
    expect(deps.dismissAll).not.toHaveBeenCalled();
    expect(deps.replace).toHaveBeenCalledWith('/');
  });
});
