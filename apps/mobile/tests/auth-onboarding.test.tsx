// @vitest-environment jsdom
//
// Auth parity, Phase B: the onboarding screens as a new owner meets them —
// Role Select, Registration, OTP verification and PIN setup — in both
// languages. The network and SQLite edges are mocked; everything the screens
// decide (what they send, where they go, what they say) is real.

import { createElement, Fragment } from 'react';
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
  sendOtp: vi.fn(),
  resendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  createShopAndOwner: vi.fn(),
  getOwnerOnboardingPayload: vi.fn(),
  markShopCloudLinked: vi.fn(),
  setOwnerPin: vi.fn(),
  verifyPinForUser: vi.fn(),
  linkDeviceToShop: vi.fn(),
  pullChanges: vi.fn(),
  refreshBillingStatus: vi.fn(),
}));

vi.mock('expo-router', () => ({
  router: { push: deps.push, replace: deps.replace, back: deps.back },
  useLocalSearchParams: () => deps.params,
}));
vi.mock('../sync/otp', () => ({
  sendOtp: deps.sendOtp,
  resendOtp: deps.resendOtp,
  verifyOtp: deps.verifyOtp,
}));
vi.mock('../db/auth', () => ({
  createShopAndOwner: deps.createShopAndOwner,
  getOwnerOnboardingPayload: deps.getOwnerOnboardingPayload,
  markShopCloudLinked: deps.markShopCloudLinked,
  setOwnerPin: deps.setOwnerPin,
  verifyPinForUser: deps.verifyPinForUser,
}));
vi.mock('../sync/linkDevice', () => {
  class LinkDeviceServerError extends Error {
    constructor(
      readonly status: number | null,
      readonly code: string | null,
    ) {
      super(`link-device failed (${status}, ${code})`);
      this.name = 'LinkDeviceServerError';
    }
  }
  return { LinkDeviceServerError, linkDeviceToShop: deps.linkDeviceToShop };
});
vi.mock('../sync/pull', () => ({ pullChanges: deps.pullChanges }));
vi.mock('../sync/billing', () => ({ refreshBillingStatus: deps.refreshBillingStatus }));

const { useLocaleStore } = await import('../state/localeStore');
const { useSessionStore } = await import('../state/sessionStore');
const { catalog } = await import('../i18n/catalog');
const { LinkDeviceServerError } = await import('../sync/linkDevice');
const { OtpCodeRejectedError, OtpRateLimitedError, OtpVerifyFailedError } = await import('../sync/otpPolicy');
const { ToastHost, clearToasts } = await import('../components/ui/Toast');
const { default: RoleSelectScreen } = await import('../app/(auth)/role-select');
const { default: RegisterScreen } = await import('../app/(auth)/register');
const { default: OtpVerifyScreen } = await import('../app/(auth)/otp-verify');
const { default: PinSetupScreen } = await import('../app/(auth)/pin-setup');

let frameQueue: FrameRequestCallback[];

beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'en' });
  useSessionStore.setState({ session: null, epoch: 0, authorityTransitioning: false });
  deps.params = {};
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frameQueue.push(callback);
    return frameQueue.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  deps.sendOtp.mockResolvedValue(undefined);
  deps.resendOtp.mockResolvedValue(undefined);
  deps.verifyOtp.mockResolvedValue({ user: { app_metadata: {} } });
  deps.createShopAndOwner.mockResolvedValue({ shopId: 'shop-new', userId: 'owner-new' });
  deps.getOwnerOnboardingPayload.mockResolvedValue({ shop: 'payload' });
  deps.linkDeviceToShop.mockResolvedValue(undefined);
  deps.markShopCloudLinked.mockResolvedValue(undefined);
  deps.refreshBillingStatus.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  clearToasts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function otpField(): HTMLInputElement {
  return screen
    .getAllByLabelText(catalog[useLocaleStore.getState().locale].otpInputA11y)
    .find((node) => node.tagName === 'INPUT') as HTMLInputElement;
}

function pressPin(pin: string): void {
  act(() => {
    for (const digit of pin) fireEvent.click(screen.getByLabelText(`Digit ${digit}`));
  });
}

async function paintAndSubmit(): Promise<void> {
  act(() => frameQueue.shift()?.(0));
  await act(async () => frameQueue.shift()?.(16));
}

describe('Role Select', () => {
  it('offers the three doors and routes each one; the role tapped is display-only', () => {
    render(createElement(RoleSelectScreen));
    fireEvent.click(screen.getByRole('button', { name: 'Register a new shop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Owner login' }));
    fireEvent.click(screen.getByRole('button', { name: 'Staff login' }));
    expect(deps.push).toHaveBeenNthCalledWith(1, '/register');
    expect(deps.push).toHaveBeenNthCalledWith(2, { pathname: '/device-login', params: { role: 'owner' } });
    expect(deps.push).toHaveBeenNthCalledWith(3, { pathname: '/device-login', params: { role: 'staff' } });
  });

  it('is Bangla-first and branded Muthoy, never "Portable POS"', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(RoleSelectScreen));
    expect(screen.getByText(catalog.bn.roleSelectPrompt)).toBeTruthy();
    expect(screen.getByRole('button', { name: catalog.bn.roleOwnerA11y })).toBeTruthy();
    expect(screen.getAllByText('Muthoy').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Portable POS/)).toBeNull();
    expect(screen.getByRole('button', { name: 'English' })).toBeTruthy();
  });
});

describe('Registration', () => {
  it('sends the OTP to the canonical number and advances to verification', async () => {
    render(createElement(RegisterScreen));
    fireEvent.change(screen.getByLabelText('Shop Name'), { target: { value: 'Rahim Pharmacy' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '01712345678' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });

    await waitFor(() => expect(deps.sendOtp).toHaveBeenCalledWith('+8801712345678'));
    expect(deps.push).toHaveBeenCalledWith({
      pathname: '/otp-verify',
      params: { phone: '+8801712345678', shopName: 'Rahim Pharmacy' },
    });
  });

  it('shows one localized error card and sends nothing for a bad number', async () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(RegisterScreen));
    fireEvent.change(screen.getByLabelText(catalog.bn.registerShopNameLabel), { target: { value: 'রহিম ফার্মেসি' } });
    fireEvent.change(screen.getByLabelText(catalog.bn.authPhoneA11y), { target: { value: '0171' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.bn.registerContinue }));
    });

    expect(await screen.findByText(catalog.bn.authPhoneInvalid)).toBeTruthy();
    expect(deps.sendOtp).not.toHaveBeenCalled();
  });

  it.each(['+88001712345678', '+880+1712345678', '017abc12345678'])(
    'never cleans a malformed %j into a number it would text a code to',
    async (typed) => {
      render(createElement(RegisterScreen));
      fireEvent.change(screen.getByLabelText('Shop Name'), { target: { value: 'Rahim Pharmacy' } });
      fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: typed } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      });

      expect(await screen.findByText(catalog.en.authPhoneInvalid)).toBeTruthy();
      expect(deps.sendOtp).not.toHaveBeenCalled();
      expect(deps.push).not.toHaveBeenCalled();
    },
  );

  it('reports a failed send inline instead of a native alert', async () => {
    deps.sendOtp.mockRejectedValueOnce(new Error('network'));
    render(createElement(RegisterScreen));
    fireEvent.change(screen.getByLabelText('Shop Name'), { target: { value: 'Rahim Pharmacy' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '1812345678' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(await screen.findByText(catalog.en.otpSendFailed)).toBeTruthy();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('names a rate limit instead of a generic failure, and stays put', async () => {
    deps.sendOtp.mockRejectedValueOnce(new OtpRateLimitedError());
    render(createElement(RegisterScreen));
    fireEvent.change(screen.getByLabelText('Shop Name'), { target: { value: 'Rahim Pharmacy' } });
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '1812345678' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(await screen.findByText(catalog.en.otpRateLimited)).toBeTruthy();
    expect(screen.queryByText(catalog.en.otpSendFailed)).toBeNull();
    expect(deps.push).not.toHaveBeenCalled();
  });

  it('keeps production fields only: no owner name, no pre-OTP account check, no fake links', () => {
    render(createElement(RegisterScreen));
    expect(screen.queryByText(/Your Name/i)).toBeNull();
    expect(screen.queryByText(/already exists/i)).toBeNull();
    expect(screen.queryByText(/Terms|Privacy/)).toBeNull();
    expect(screen.getByText(catalog.en.authCloudReady)).toBeTruthy();
  });

  it('translates the cloud-ready pill, on screen and for TalkBack', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(RegisterScreen));
    expect(screen.getByText(catalog.bn.authCloudReady)).toBeTruthy();
    expect(screen.getByLabelText(catalog.bn.authCloudReady)).toBeTruthy();
    expect(screen.queryByText('Cloud Ready')).toBeNull();
  });

  it('links an existing owner to phone + PIN sign-in', () => {
    render(createElement(RegisterScreen));
    fireEvent.click(screen.getByRole('button', { name: catalog.en.registerLoginLink }));
    expect(deps.push).toHaveBeenCalledWith({ pathname: '/device-login', params: { role: 'owner' } });
  });
});

describe('OTP verification', () => {
  beforeEach(() => {
    deps.params = { phone: '+8801712345678', shopName: 'Rahim Pharmacy' };
  });

  it('drops a restored-shop hydration after the session changes, without linking or navigating', async () => {
    deps.verifyOtp.mockResolvedValueOnce({ user: { app_metadata: { shop_id: 'old-shop' } } });
    deps.pullChanges.mockImplementationOnce(async (_shopId, _cursor, isCancelled: () => boolean) => {
      expect(isCancelled()).toBe(false);
      useSessionStore.setState({ epoch: 1 });
      expect(isCancelled()).toBe(true);
    });
    render(createElement(OtpVerifyScreen));
    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '123456' } });
    });
    expect(deps.pullChanges).toHaveBeenCalledTimes(1);
    expect(deps.markShopCloudLinked).not.toHaveBeenCalled();
    expect(deps.replace).not.toHaveBeenCalled();
  });

  it('shows the number it texted and runs the canonical onboarding on a full code', async () => {
    render(createElement(OtpVerifyScreen));
    expect(screen.getByText('+880 1712-345678')).toBeTruthy();

    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '123456' } });
    });

    await waitFor(() => expect(deps.replace).toHaveBeenCalledWith('/'));
    expect(deps.verifyOtp).toHaveBeenCalledWith('+8801712345678', '123456');
    expect(deps.createShopAndOwner).toHaveBeenCalledWith({ shopName: 'Rahim Pharmacy', phone: '+8801712345678' });
    expect(deps.linkDeviceToShop).toHaveBeenCalledWith('shop-new', 'owner-new', {
      onboarding: { shop: 'payload' }, isStillActive: expect.any(Function),
    });
    expect(deps.markShopCloudLinked).toHaveBeenCalledWith('shop-new');
  });

  it.each(['en', 'bn'] as const)(
    'tells the owner to check their messages, never that an SMS was sent (%s)',
    (locale) => {
      // The hook may have answered success for a send whose outcome nobody
      // knows yet (pending, ambiguous); the screen cannot tell, so it never says.
      useLocaleStore.setState({ locale });
      render(createElement(OtpVerifyScreen));
      expect(screen.getByText(catalog[locale].otpCheckMessages)).toBeTruthy();
    },
  );

  it('confirms a resend as requested — never as sent', async () => {
    vi.useFakeTimers();
    render(createElement(Fragment, null, createElement(OtpVerifyScreen), createElement(ToastHost)));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.otpResend }));
    });
    expect(deps.resendOtp).toHaveBeenCalledWith('+8801712345678');
    expect(screen.getByText(catalog.en.otpResendRequested)).toBeTruthy();
    expect(screen.getByText(catalog.en.otpCheckMessages)).toBeTruthy();
  });

  it('says a wrong code is wrong, clears it, and keeps going', async () => {
    deps.verifyOtp.mockRejectedValueOnce(new OtpCodeRejectedError());
    render(createElement(OtpVerifyScreen));
    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '111111' } });
    });
    expect(await screen.findByText(catalog.en.otpIncorrect)).toBeTruthy();
    expect(otpField().value).toBe('');
    expect(deps.createShopAndOwner).not.toHaveBeenCalled();
  });

  // H-5. Supabase refuses a wrong code and an expired one identically, so the
  // screen tells them apart by when the code was sent.
  it('calls a refused code expired once its five-minute lifetime has passed', async () => {
    vi.useFakeTimers();
    deps.verifyOtp.mockRejectedValueOnce(new OtpCodeRejectedError());
    render(createElement(OtpVerifyScreen));
    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '111111' } });
    });
    expect(screen.getByText(catalog.en.otpExpired)).toBeTruthy();
    expect(screen.queryByText(catalog.en.otpIncorrect)).toBeNull();
  });

  it('never calls a code wrong when it could not be checked at all', async () => {
    deps.verifyOtp.mockRejectedValueOnce(new OtpVerifyFailedError());
    render(createElement(OtpVerifyScreen));
    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '123456' } });
    });
    expect(await screen.findByText(catalog.en.otpVerifyFailed)).toBeTruthy();
    expect(screen.queryByText(catalog.en.otpIncorrect)).toBeNull();
    expect(deps.createShopAndOwner).not.toHaveBeenCalled();
  });

  it('names a verification rate limit', async () => {
    deps.verifyOtp.mockRejectedValueOnce(new OtpRateLimitedError());
    render(createElement(OtpVerifyScreen));
    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '123456' } });
    });
    expect(await screen.findByText(catalog.en.otpRateLimited)).toBeTruthy();
  });

  it('counts the one-minute resend down in the active language, then resends', async () => {
    vi.useFakeTimers();
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(OtpVerifyScreen));
    expect(screen.getByText(`৬০${catalog.bn.otpSecondsSuffix}`)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(screen.queryByRole('button', { name: catalog.bn.otpResend })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.bn.otpResend }));
    });
    expect(deps.resendOtp).toHaveBeenCalledWith('+8801712345678');
    expect(screen.getByText(`৬০${catalog.bn.otpSecondsSuffix}`)).toBeTruthy();
  });

  it('restarts the wait when a resend is rate-limited', async () => {
    vi.useFakeTimers();
    deps.resendOtp.mockRejectedValueOnce(new OtpRateLimitedError());
    render(createElement(OtpVerifyScreen));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.otpResend }));
    });
    expect(screen.getByText(catalog.en.otpRateLimited)).toBeTruthy();
    expect(screen.getByText(`60${catalog.en.otpSecondsSuffix}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: catalog.en.otpResend })).toBeNull();
  });

  it('says a refused resend failed, without restarting the wait', async () => {
    vi.useFakeTimers();
    deps.resendOtp.mockRejectedValueOnce(new Error('network'));
    render(createElement(OtpVerifyScreen));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.otpResend }));
    });
    expect(screen.getByText(catalog.en.otpResendFailed)).toBeTruthy();
    expect(screen.getByRole('button', { name: catalog.en.otpResend })).toBeTruthy();
  });

  it('sends the owner back for a NEW code when the proof went stale before setup finished', async () => {
    deps.linkDeviceToShop
      .mockRejectedValueOnce(new LinkDeviceServerError(403, 'otp_required', 'fresh OTP required', null))
      .mockResolvedValueOnce(undefined);
    render(createElement(OtpVerifyScreen));
    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '123456' } });
    });

    expect(await screen.findByText(catalog.en.otpCodeTooOld)).toBeTruthy();
    // No "Try setup again": the same proof can never pass. A new code can.
    expect(screen.queryByRole('button', { name: catalog.en.otpSetupRetry })).toBeNull();
    expect(screen.getByRole('button', { name: catalog.en.otpResend })).toBeTruthy();

    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '654321' } });
    });
    await waitFor(() => expect(deps.replace).toHaveBeenCalledWith('/'));
    expect(deps.verifyOtp).toHaveBeenCalledTimes(2);
    // The shop the first attempt created is reused, never duplicated.
    expect(deps.createShopAndOwner).toHaveBeenCalledTimes(1);
  });

  it('offers a setup retry (not a new code) for an ordinary setup failure', async () => {
    deps.linkDeviceToShop.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    render(createElement(OtpVerifyScreen));
    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '123456' } });
    });
    expect(await screen.findByText(catalog.en.otpSetupFailed)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.otpSetupRetry }));
    });
    await waitFor(() => expect(deps.replace).toHaveBeenCalledWith('/'));
    expect(deps.verifyOtp).toHaveBeenCalledTimes(1);
    expect(deps.linkDeviceToShop).toHaveBeenCalledTimes(2);
  });

  it.each(['01712345678', '8801712345678', '1712345678'])(
    'canonicalizes a %s route param before every OTP call and the owner row',
    async (phone) => {
      deps.params = { phone, shopName: 'Rahim Pharmacy' };
      render(createElement(OtpVerifyScreen));
      expect(screen.getByText('+880 1712-345678')).toBeTruthy();

      await act(async () => {
        fireEvent.change(otpField(), { target: { value: '123456' } });
      });

      await waitFor(() => expect(deps.replace).toHaveBeenCalledWith('/'));
      expect(deps.verifyOtp).toHaveBeenCalledWith('+8801712345678', '123456');
      expect(deps.createShopAndOwner).toHaveBeenCalledWith({ shopName: 'Rahim Pharmacy', phone: '+8801712345678' });
    },
  );

  it("re-sends a resumed registration's code to the canonical number", async () => {
    deps.params = { phone: '01712345678', resumeShopId: 'shop-1', resumeOwnerUserId: 'owner-1' };
    render(createElement(OtpVerifyScreen));
    await waitFor(() => expect(deps.sendOtp).toHaveBeenCalledWith('+8801712345678'));
  });

  it("names a rate limit on a resumed registration's code and keeps the resend waiting", async () => {
    deps.sendOtp.mockRejectedValueOnce(new OtpRateLimitedError());
    deps.params = { phone: '01712345678', resumeShopId: 'shop-1', resumeOwnerUserId: 'owner-1' };
    render(createElement(OtpVerifyScreen));
    expect(await screen.findByText(catalog.en.otpRateLimited)).toBeTruthy();
    expect(screen.getByText(`60${catalog.en.otpSecondsSuffix}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: catalog.en.otpResend })).toBeNull();
  });

  it('resends to the canonical number', async () => {
    vi.useFakeTimers();
    deps.params = { phone: '01712345678', shopName: 'Rahim Pharmacy' };
    render(createElement(OtpVerifyScreen));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.otpResend }));
    });
    expect(deps.resendOtp).toHaveBeenCalledWith('+8801712345678');
  });

  it.each([
    ['a foreign number', { phone: '+911712345678', shopName: 'Rahim Pharmacy' }],
    ['a +1 code over a Bangladeshi-looking number', { phone: '+1712345678', shopName: 'Rahim Pharmacy' }],
    ['a resumed registration with a bad stored number', { phone: '0171', resumeShopId: 'shop-1', resumeOwnerUserId: 'owner-1' }],
  ])('refuses %s before any OTP call, in words', async (_label, params) => {
    deps.params = params;
    render(createElement(OtpVerifyScreen));
    expect(screen.getByText(catalog.en.authPhoneInvalid)).toBeTruthy();
    // "Code sent to" never presents the rejected value as a Bangladeshi number.
    expect(screen.queryByText('+880 1712-345678')).toBeNull();
    expect(otpField().readOnly).toBe(true);

    await act(async () => {
      fireEvent.change(otpField(), { target: { value: '123456' } });
    });
    expect(deps.sendOtp).not.toHaveBeenCalled();
    expect(deps.verifyOtp).not.toHaveBeenCalled();
    expect(deps.createShopAndOwner).not.toHaveBeenCalled();
  });

  it('offers Back on a fresh registration but not while resuming one', () => {
    const { unmount } = render(createElement(OtpVerifyScreen));
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(deps.back).toHaveBeenCalledTimes(1);
    unmount();

    deps.params = { phone: '+8801712345678', resumeShopId: 'shop-1', resumeOwnerUserId: 'owner-1' };
    render(createElement(OtpVerifyScreen));
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
  });
});

describe('PIN setup', () => {
  beforeEach(() => {
    deps.params = { shopId: 'shop-new', userId: 'owner-new' };
    deps.setOwnerPin.mockResolvedValue(undefined);
    deps.verifyPinForUser.mockResolvedValue({
      shopId: 'shop-new',
      userId: 'owner-new',
      role: 'owner',
      principalUserId: 'owner-new',
      billingAccountId: 'billing-1',
    });
  });

  it('keeps the first PIN on a mismatch, then saves the matching confirmation', async () => {
    render(createElement(PinSetupScreen));
    expect(screen.getByText(catalog.en.pinSetupTitleCreate)).toBeTruthy();

    pressPin('2468');
    await paintAndSubmit();
    expect(screen.getByText(catalog.en.pinSetupTitleConfirm)).toBeTruthy();

    pressPin('2469');
    await paintAndSubmit();
    expect(screen.getByText(catalog.en.pinMismatch)).toBeTruthy();
    // Still confirming: the prototype's Try Again / Change PIN, not a restart.
    expect(screen.getByText(catalog.en.pinSetupTitleConfirm)).toBeTruthy();
    expect(screen.getByRole('button', { name: catalog.en.pinTryAgain })).toBeTruthy();
    expect(screen.getByRole('button', { name: catalog.en.pinChange })).toBeTruthy();

    pressPin('2468');
    await paintAndSubmit();
    await waitFor(() => expect(deps.replace).toHaveBeenCalledWith('/dashboard'));
    expect(deps.setOwnerPin).toHaveBeenCalledWith('owner-new', '2468');
    expect(useSessionStore.getState().session?.userId).toBe('owner-new');
  });

  it('Change PIN returns to choosing a new one', async () => {
    render(createElement(PinSetupScreen));
    pressPin('1357');
    await paintAndSubmit();
    fireEvent.click(screen.getByRole('button', { name: catalog.en.pinChange }));
    expect(screen.getByText(catalog.en.pinSetupTitleCreate)).toBeTruthy();
  });

  it('reports a failed setup inline and never logs anyone in', async () => {
    deps.setOwnerPin.mockRejectedValueOnce(new Error('disk full'));
    render(createElement(PinSetupScreen));
    pressPin('1357');
    await paintAndSubmit();
    pressPin('1357');
    await paintAndSubmit();
    expect(await screen.findByText(catalog.en.pinSetupFailed)).toBeTruthy();
    expect(deps.replace).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('tells the truth about where the PIN lives, in Bangla too', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(PinSetupScreen));
    expect(screen.getByText(catalog.bn.pinSetupFootnote)).toBeTruthy();
    expect(screen.queryByText(/stays securely stored on this device/i)).toBeNull();
    expect(screen.queryByText(/fingerprint/i)).toBeNull();
    expect(screen.getByText('Muthoy Secure')).toBeTruthy();
  });
});
