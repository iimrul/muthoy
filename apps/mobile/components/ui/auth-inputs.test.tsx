// @vitest-environment jsdom
//
// The PIN pad and OTP input as RENDERED components. PinPad.test.tsx covers the
// entry hooks (the H-4-sensitive buffering and submission); this covers what
// the auth parity pass added on top: the two visual variants, localized
// accessibility labels, the create/confirm-only digit reveal, the opt-in
// stay-on-confirm mismatch, and the OTP field's autofill contract.

import { createElement, createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () =>
  (await import('../../tests/support/reactNativeMock')).createReactNativeMock(),
);

const { useLocaleStore } = await import('../../state/localeStore');
const { PinPad, useConfirmedPinEntry } = await import('./PinPad');
const { OtpInput } = await import('./OtpInput');

let frameQueue: FrameRequestCallback[];

beforeEach(() => {
  useLocaleStore.setState({ locale: 'en' });
  frameQueue = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frameQueue.push(callback);
    return frameQueue.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function paintAndComplete(): Promise<void> {
  act(() => frameQueue.shift()?.(0));
  await act(async () => frameQueue.shift()?.(16));
}

function Pad(props: { variant?: 'secure' | 'compact'; revealLastDigit?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState('');
  return createElement(PinPad, {
    value,
    onDigitPress: (digit: string) => setValue((current) => (current + digit).slice(0, 4)),
    onBackspace: () => setValue((current) => current.slice(0, -1)),
    ...props,
  });
}

describe('PinPad', () => {
  it.each(['secure', 'compact'] as const)('keeps the English key labels the rest of the suite relies on (%s)', (variant) => {
    render(createElement(Pad, { variant }));
    for (const digit of '0123456789') {
      expect(screen.getByLabelText(`Digit ${digit}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('Backspace')).toBeTruthy();
  });

  it('labels keys in Bangla when Bangla is active', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(Pad, {}));
    expect(screen.getByLabelText('সংখ্যা ৭')).toBeTruthy();
    expect(screen.getByLabelText('মুছুন')).toBeTruthy();
    expect(screen.queryByLabelText('Digit 7')).toBeNull();
  });

  it('announces progress, not the digits', () => {
    render(createElement(Pad, {}));
    fireEvent.click(screen.getByLabelText('Digit 9'));
    fireEvent.click(screen.getByLabelText('Digit 3'));
    expect(screen.getByLabelText('2 of 4 digits entered')).toBeTruthy();
  });

  it('never shows a typed digit on a sign-in pad', () => {
    render(createElement(Pad, {}));
    fireEvent.click(screen.getByLabelText('Digit 7'));
    const indicator = screen.getByLabelText('1 of 4 digits entered');
    expect(indicator.textContent).toBe('');
  });

  it('reveals only the latest digit for ~400 ms on a create/confirm pad', () => {
    vi.useFakeTimers();
    render(createElement(Pad, { revealLastDigit: true }));
    fireEvent.click(screen.getByLabelText('Digit 7'));
    expect(screen.getByLabelText('1 of 4 digits entered').textContent).toBe('7');
    fireEvent.click(screen.getByLabelText('Digit 5'));
    expect(screen.getByLabelText('2 of 4 digits entered').textContent).toBe('5');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByLabelText('2 of 4 digits entered').textContent).toBe('');
  });

  it('hides a revealed digit immediately on backspace', () => {
    vi.useFakeTimers();
    render(createElement(Pad, { revealLastDigit: true }));
    fireEvent.click(screen.getByLabelText('Digit 4'));
    fireEvent.click(screen.getByLabelText('Digit 2'));
    fireEvent.click(screen.getByLabelText('Backspace'));
    expect(screen.getByLabelText('1 of 4 digits entered').textContent).toBe('');
  });

  it('disables every key once four digits are in, and when told to', () => {
    render(createElement(Pad, {}));
    for (const digit of '1234') fireEvent.click(screen.getByLabelText(`Digit ${digit}`));
    expect((screen.getByLabelText('Digit 5') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(createElement(Pad, { disabled: true }));
    expect((screen.getByLabelText('Digit 5') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Backspace') as HTMLButtonElement).disabled).toBe(true);
  });

  it('plays a shake without touching the value or the keys', () => {
    const onDigitPress = vi.fn();
    const { rerender } = render(createElement(PinPad, { value: '', onDigitPress, onBackspace: vi.fn(), shakeKey: 0 }));
    rerender(createElement(PinPad, { value: '', onDigitPress, onBackspace: vi.fn(), shakeKey: 1, error: true }));
    fireEvent.click(screen.getByLabelText('Digit 1'));
    expect(onDigitPress).toHaveBeenCalledWith('1');
  });
});

describe('useConfirmedPinEntry stay-on-confirm (opt-in)', () => {
  function enter(handle: (digit: string) => void, pin: string) {
    act(() => {
      for (const digit of pin) handle(digit);
    });
  }

  it('keeps the first PIN after a mismatch and accepts a matching retry', async () => {
    const onConfirmed = vi.fn();
    const onMismatch = vi.fn();
    const { result } = renderHook(() =>
      useConfirmedPinEntry(onConfirmed, onMismatch, { onMismatchStep: 'stay-on-confirm' }),
    );
    enter(result.current.handleDigitPress, '2468');
    await paintAndComplete();
    enter(result.current.handleDigitPress, '2469');
    await paintAndComplete();

    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(result.current.step).toBe('confirm');
    expect(result.current.pin).toBe('');

    enter(result.current.handleDigitPress, '2468');
    await paintAndComplete();
    expect(onConfirmed).toHaveBeenCalledWith('2468', expect.objectContaining({ completedAt: expect.any(Number) }));
  });

  it('"Change PIN" (reset) returns to the first entry', async () => {
    const { result } = renderHook(() =>
      useConfirmedPinEntry(vi.fn(), vi.fn(), { onMismatchStep: 'stay-on-confirm' }),
    );
    enter(result.current.handleDigitPress, '1357');
    await paintAndComplete();
    expect(result.current.step).toBe('confirm');
    act(() => result.current.reset());
    expect(result.current.step).toBe('enter');
  });

  it('leaves the default behaviour — restart on mismatch — unchanged', async () => {
    const { result } = renderHook(() => useConfirmedPinEntry(vi.fn(), vi.fn()));
    enter(result.current.handleDigitPress, '1357');
    await paintAndComplete();
    enter(result.current.handleDigitPress, '1358');
    await paintAndComplete();
    expect(result.current.step).toBe('enter');
  });
});

describe('OtpInput', () => {
  function hiddenField(label: string): HTMLInputElement {
    return screen.getAllByLabelText(label).find((node) => node.tagName === 'INPUT') as HTMLInputElement;
  }

  it('exposes exactly one accessible OTP field to a screen reader', () => {
    render(createElement(OtpInput, { value: '48', onChangeText: vi.fn() }));
    const label = 'Enter six digit verification code';
    // One control carries the label, and it is the edit box itself...
    const labelled = screen.getAllByLabelText(label);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]?.tagName).toBe('INPUT');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    // ...the tap-to-focus wrapper is no second control...
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // ...and the six visual boxes are out of the accessibility tree.
    expect(screen.getByText('4').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: label })).toBe(labelled[0]);
  });

  it('still focuses the hidden input when the boxes are tapped', () => {
    const ref = createRef<HTMLInputElement>();
    const { container } = render(
      createElement(OtpInput, { ref: ref as never, value: '', onChangeText: vi.fn() }),
    );
    (ref.current as HTMLInputElement).blur();
    fireEvent.click(container.firstElementChild as Element);
    expect(document.activeElement).toBe(ref.current);
  });

  it('reports verification as busy on the one field', () => {
    render(createElement(OtpInput, { value: '482913', onChangeText: vi.fn(), verifying: true }));
    expect(hiddenField('Enter six digit verification code').getAttribute('aria-busy')).toBe('true');
  });

  it('keeps one hidden input carrying the SMS autofill contract', () => {
    render(createElement(OtpInput, { value: '', onChangeText: vi.fn() }));
    const field = hiddenField('Enter six digit verification code');
    expect(field.getAttribute('data-autocomplete')).toBe('sms-otp');
    expect(field.getAttribute('data-content-type')).toBe('oneTimeCode');
    expect(field.getAttribute('data-keyboard')).toBe('number-pad');
  });

  it('accepts a pasted code as six digits and drops everything else', () => {
    const onChangeText = vi.fn();
    render(createElement(OtpInput, { value: '', onChangeText }));
    fireEvent.change(hiddenField('Enter six digit verification code'), { target: { value: 'Code: 123-4567' } });
    expect(onChangeText).toHaveBeenCalledWith('123456');
  });

  it('shows each digit in its box and locks editing while verifying', () => {
    render(createElement(OtpInput, { value: '482', onChangeText: vi.fn(), verifying: true }));
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(hiddenField('Enter six digit verification code').readOnly).toBe(true);
  });

  it('is labelled in Bangla in Bangla', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(OtpInput, { value: '', onChangeText: vi.fn() }));
    expect(hiddenField('৬ ডিজিটের যাচাই কোড দিন')).toBeTruthy();
  });
});
