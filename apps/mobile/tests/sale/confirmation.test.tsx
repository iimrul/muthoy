// @vitest-environment jsdom
//
// Item 5 (founder, 2026-11-27): after a sale the confirmation shows the amount
// for a moment and returns to Sale by itself, as the prototype does. A tap
// stops the countdown; "New sale" and the back button go straight to Sale.

import { createElement, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mmkv = vi.hoisted(() => ({
  createMMKV: () => {
    const store = new Map<string, string>();
    return {
      set: (key: string, value: string) => void store.set(key, value),
      getString: (key: string) => store.get(key),
      remove: (key: string) => void store.delete(key),
    };
  },
}));
vi.mock('react-native-mmkv', () => ({ createMMKV: mmkv.createMMKV }));

const back = vi.hoisted(() => ({ handler: null as null | (() => boolean), removed: 0 }));
interface StubProps { children?: ReactNode; onPress?: () => void; accessibilityLabel?: string }
vi.mock('react-native', () => ({
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  Pressable: ({ children, onPress, accessibilityLabel }: StubProps) =>
    createElement('button', {
      onClick: (event: { stopPropagation: () => void }) => { event.stopPropagation(); onPress?.(); },
      'aria-label': accessibilityLabel,
    }, children),
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      back.handler = handler;
      return { remove: () => { back.removed += 1; back.handler = null; } };
    },
  },
}));
vi.mock('@expo/vector-icons/Feather', () => ({ default: () => null }));

const params = vi.hoisted(() => ({ value: {} as Record<string, string> }));
const routerMock = vi.hoisted(() => ({ dismissTo: vi.fn() }));
vi.mock('expo-router', () => ({
  router: routerMock,
  useLocalSearchParams: () => params.value,
  // Focus = mounted, blur = unmounted, for this screen in isolation.
  useFocusEffect: (effect: () => void | (() => void)) => {
    useEffect(() => effect(), [effect]);
  },
}));

const { useLocaleStore } = await import('../../state/localeStore');
const SaleConfirmationScreen = (await import('../../app/sale/confirmation')).default;
const { AUTO_RETURN_SECONDS } = await import('../../app/sale/confirmation');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  back.handler = null;
  back.removed = 0;
  useLocaleStore.setState({ locale: 'en' });
  params.value = { invoiceNo: 'INV-2026-000009', total: '3000', paymentType: 'cash', change: '2000' };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function advance(seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => { vi.advanceTimersByTime(1_000); });
  }
}

describe('sale confirmation returns to Sale by itself (item 5)', () => {
  it('shows the total and the change to give, then returns after the countdown', async () => {
    render(createElement(SaleConfirmationScreen));
    expect(screen.getByText('Sale confirmed')).toBeTruthy();
    expect(document.body.textContent).toContain('৳30.00');
    expect(screen.getByText('Give change')).toBeTruthy();
    expect(document.body.textContent).toContain('৳20.00');
    expect(document.body.textContent).toContain(`Back to Sale in ${AUTO_RETURN_SECONDS} s`);

    await advance(AUTO_RETURN_SECONDS - 1);
    expect(routerMock.dismissTo).not.toHaveBeenCalled();
    await advance(1);
    expect(routerMock.dismissTo).toHaveBeenCalledTimes(1);
    expect(routerMock.dismissTo).toHaveBeenCalledWith('/sale');
  });

  it('a tap stops the countdown, and New sale still goes straight back', async () => {
    render(createElement(SaleConfirmationScreen));
    fireEvent.click(screen.getByLabelText('Sale confirmed'));
    await advance(AUTO_RETURN_SECONDS + 5);
    expect(routerMock.dismissTo).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Stopped here');

    fireEvent.click(screen.getByLabelText('Start new sale'));
    expect(routerMock.dismissTo).toHaveBeenCalledTimes(1);
  });

  it('the back button returns to Sale instead of the emptied cart', () => {
    render(createElement(SaleConfirmationScreen));
    expect(back.handler?.()).toBe(true);
    expect(routerMock.dismissTo).toHaveBeenCalledWith('/sale');
  });

  it('never pulls the person back once they have left the screen', async () => {
    const view = render(createElement(SaleConfirmationScreen));
    view.unmount();
    expect(back.removed).toBe(1);
    await advance(AUTO_RETURN_SECONDS + 1);
    expect(routerMock.dismissTo).not.toHaveBeenCalled();
  });

  it('shows no change line for a credit sale or exact cash', () => {
    params.value = { invoiceNo: 'INV-1', total: '3000', paymentType: 'credit', change: '0' };
    render(createElement(SaleConfirmationScreen));
    expect(screen.queryByText('Give change')).toBeNull();
    cleanup();
    params.value = { invoiceNo: 'INV-2', total: '3000', paymentType: 'cash', change: '0' };
    render(createElement(SaleConfirmationScreen));
    expect(screen.queryByText('Give change')).toBeNull();
  });
});
