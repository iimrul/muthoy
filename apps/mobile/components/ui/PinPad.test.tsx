// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StubProps {
  children?: ReactNode;
}

vi.mock('react-native', () => ({
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  Pressable: ({ children }: StubProps) => createElement('button', null, children),
}));

const { useConfirmedPinEntry, usePinEntry } = await import('./PinPad');

let frameQueue: FrameRequestCallback[];

function enterPin(handleDigitPress: (digit: string) => void, pin: string): void {
  act(() => {
    for (const digit of pin) {
      handleDigitPress(digit);
    }
  });
}

async function paintAndComplete(): Promise<void> {
  act(() => frameQueue.shift()?.(0));
  await act(async () => frameQueue.shift()?.(16));
}

beforeEach(() => {
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

describe('usePinEntry', () => {
  it('shows digit four before submitting the synchronously computed PIN', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => usePinEntry(onComplete));

    enterPin(result.current.handleDigitPress, '1234');

    expect(result.current.pin).toBe('1234');
    expect(result.current.isSubmitting).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();

    await paintAndComplete();

    expect(onComplete).toHaveBeenCalledWith(
      '1234',
      expect.objectContaining({ completedAt: expect.any(Number) }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.current.pin).toBe('');
  });

  it('never submits a stale three-digit value during rapid presses', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => usePinEntry(onComplete));

    enterPin(result.current.handleDigitPress, '9876');
    await paintAndComplete();

    expect(onComplete).toHaveBeenCalledWith(
      '9876',
      expect.objectContaining({ completedAt: expect.any(Number) }),
    );
    expect(onComplete).not.toHaveBeenCalledWith('987');
  });

  it('locks synchronously and cannot submit twice while completion is pending', async () => {
    let resolveCompletion: (() => void) | undefined;
    const onComplete = vi.fn(() => new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    }));
    const { result } = renderHook(() => usePinEntry(onComplete));

    enterPin(result.current.handleDigitPress, '1234');
    act(() => {
      result.current.handleDigitPress('4');
      result.current.handleBackspace();
    });
    await paintAndComplete();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.current.pin).toBe('1234');

    await act(async () => resolveCompletion?.());
    expect(result.current.pin).toBe('');
    expect(result.current.isSubmitting).toBe(false);
  });
});

describe('useConfirmedPinEntry', () => {
  it('advances Set PIN to Confirm PIN and submits the matching four digits', async () => {
    const onConfirmed = vi.fn();
    const { result } = renderHook(() => useConfirmedPinEntry(onConfirmed));

    enterPin(result.current.handleDigitPress, '4321');
    expect(result.current.pin).toBe('4321');
    await paintAndComplete();

    expect(result.current.step).toBe('confirm');
    expect(onConfirmed).not.toHaveBeenCalled();

    enterPin(result.current.handleDigitPress, '4321');
    expect(result.current.pin).toBe('4321');
    await paintAndComplete();

    expect(onConfirmed).toHaveBeenCalledWith(
      '4321',
      expect.objectContaining({ completedAt: expect.any(Number) }),
    );
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('reports a mismatch and never submits it', async () => {
    const onConfirmed = vi.fn();
    const onMismatch = vi.fn();
    const { result } = renderHook(() => useConfirmedPinEntry(onConfirmed, onMismatch));

    enterPin(result.current.handleDigitPress, '1234');
    await paintAndComplete();
    enterPin(result.current.handleDigitPress, '1235');
    await paintAndComplete();

    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(result.current.step).toBe('enter');
  });
});
