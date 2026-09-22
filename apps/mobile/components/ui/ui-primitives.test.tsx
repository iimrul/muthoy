// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface StubProps {
  children?: ReactNode;
  className?: string;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityElementsHidden?: boolean;
  accessibilityState?: { selected?: boolean };
  accessible?: boolean;
  onPress?: () => void;
  onChangeText?: (value: string) => void;
  onRequestClose?: () => void;
  visible?: boolean;
  value?: string;
  placeholder?: string;
  onFocus?: () => void;
  testID?: string;
}

vi.mock('react-native', () => ({
  View: (p: StubProps) => createElement('div', {
    className: p.className,
    'aria-label': p.accessibilityLabel,
    role: p.accessibilityRole,
    'data-a11y-hidden': p.accessibilityElementsHidden ? 'true' : undefined,
  }, p.children),
  Text: (p: StubProps) => createElement('span', { className: p.className }, p.children),
  Pressable: (p: StubProps) => createElement('button', {
    className: p.className,
    onClick: p.onPress,
    'aria-label': p.accessibilityLabel,
    'aria-selected': p.accessibilityState?.selected,
    'aria-hidden': p.accessible === false ? 'true' : undefined,
    'data-testid': p.testID,
  }, p.children),
  TextInput: (p: StubProps) => createElement('input', {
    className: p.className,
    value: p.value ?? '',
    placeholder: p.placeholder,
    'aria-label': p.accessibilityLabel,
    onFocus: p.onFocus,
    onChange: (event: { target: { value: string } }) => p.onChangeText?.(event.target.value),
  }),
  // The real Modal renders nothing when visible is false; the stub has to
  // agree or every "is it closed" assertion becomes meaningless.
  Modal: (p: StubProps) => (p.visible ? createElement('div', { role: 'dialog' }, p.children) : null),
  KeyboardAvoidingView: (p: StubProps) => createElement('div', { className: p.className }, p.children),
  Platform: { OS: 'android' },
}));

const { ToastHost, clearToasts, showToast } = await import('./Toast');
const { Skeleton, SkeletonCard, SkeletonList, SkeletonRegion, SkeletonText } =
  await import('./Skeleton');
const { BaseModal, BaseSheet } = await import('./BaseModal');
const { DiscountFields } = await import('../sale/DiscountFields');
const { ManufacturerPicker } = await import('../inventory/ManufacturerPicker');
const { useLocaleStore } = await import('../../state/localeStore');

beforeEach(() => {
  vi.useFakeTimers();
  clearToasts();
  useLocaleStore.setState({ locale: 'en' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ToastHost', () => {
  it('renders nothing until something asks it to', () => {
    const { container } = render(createElement(ToastHost));
    expect(container.firstChild).toBeNull();
  });

  it('shows the message and then clears itself', () => {
    render(createElement(ToastHost));
    act(() => showToast({ message: 'Saved' }));
    expect(screen.getByText(/Saved/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_800));
    expect(screen.queryByText(/Saved/)).toBeNull();
  });

  it('replaces an in-flight toast rather than queueing behind it', () => {
    // A pharmacist scanning items in quick succession wants the LATEST
    // confirmation, not four of them playing out after they have moved on.
    render(createElement(ToastHost));
    act(() => showToast({ message: 'First' }));
    act(() => vi.advanceTimersByTime(900));
    act(() => showToast({ message: 'Second' }));
    expect(screen.queryByText(/First/)).toBeNull();
    expect(screen.getByText(/Second/)).toBeTruthy();
    // The replacement gets a FULL duration, and the first toast's timer must
    // not take the second one down with it when it fires.
    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByText(/Second/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(900));
    expect(screen.queryByText(/Second/)).toBeNull();
  });

  it('carries the supporting label only on the card variant', () => {
    render(createElement(ToastHost));
    act(() => showToast({ variant: 'card', label: 'Added to cart', message: 'Napa 500' }));
    expect(screen.getByText('Added to cart')).toBeTruthy();
    act(() => showToast({ message: 'Napa 500' }));
    expect(screen.queryByText('Added to cart')).toBeNull();
  });

  it('honours a caller-supplied duration', () => {
    render(createElement(ToastHost));
    act(() => showToast({ message: 'Slow', durationMs: 5_000 }));
    act(() => vi.advanceTimersByTime(1_800));
    expect(screen.getByText(/Slow/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(3_200));
    expect(screen.queryByText(/Slow/)).toBeNull();
  });
});

describe('Skeleton accessibility and localisation', () => {
  it('announces nothing at all on its own', () => {
    // The blocks are decorative. The first version gave every one of them
    // accessibilityRole="progressbar" with a hardcoded English label, so a
    // four-row list read out as twelve English progress bars to a
    // Bangla-speaking pharmacist waiting for ONE thing.
    const { container } = render(createElement(SkeletonList, { rows: 4 }));
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(0);
    expect(container.querySelectorAll('[data-a11y-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('announces exactly once inside a region, however much it contains', () => {
    const { container } = render(
      <SkeletonRegion>
        <SkeletonList rows={4} />
        <SkeletonCard lines={3} />
        <SkeletonText lines={5} />
      </SkeletonRegion>,
    );
    expect(container.querySelectorAll('[role="progressbar"]').length).toBe(1);
  });

  it('localises the announcement', () => {
    const { container, rerender } = render(<SkeletonRegion><Skeleton /></SkeletonRegion>);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label'))
      .toBe('Loading…');

    act(() => useLocaleStore.setState({ locale: 'bn' }));
    rerender(<SkeletonRegion><Skeleton /></SkeletonRegion>);
    // A hardcoded English string here is the bug, not a placeholder for one.
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label'))
      .toBe('লোড হচ্ছে…');
  });

  it('lets a screen say something more useful than the generic string', () => {
    const { container } = render(
      <SkeletonRegion label="Loading dashboard…"><Skeleton /></SkeletonRegion>,
    );
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-label'))
      .toBe('Loading dashboard…');
  });

  it('shortens the last text line so a run does not read as a table', () => {
    const { container } = render(createElement(SkeletonText, { lines: 3 }));
    const blocks = container.querySelectorAll('[data-a11y-hidden="true"]');
    expect(blocks.length).toBe(3);
    expect(blocks[2]?.className).toContain('w-2/3');
    expect(blocks[0]?.className).toContain('w-full');
  });

  it('never renders an empty placeholder for a zero or negative count', () => {
    const { container } = render(createElement(SkeletonList, { rows: 0 }));
    expect(container.querySelectorAll('[data-a11y-hidden="true"]').length).toBeGreaterThan(0);
  });
});

describe('BaseSheet / BaseModal', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <BaseSheet visible={false} onClose={vi.fn()} title="Discount"><span>body</span></BaseSheet>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each([
    ['BaseSheet', BaseSheet],
    ['BaseModal', BaseModal],
  ])('%s closes from the backdrop and from the visible X', (_name, Component) => {
    const onClose = vi.fn();
    render(<Component visible onClose={onClose} title="Discount"><span>body</span></Component>);
    // Both affordances existed in some sheets and not others before this was
    // extracted; the shared shell has to guarantee both, every time.
    expect(screen.getAllByLabelText('Close').length).toBe(1);
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('can refuse the backdrop tap for a sheet that must not be dismissed that way', () => {
    const onClose = vi.fn();
    render(
      <BaseSheet visible onClose={onClose} title="Discount" dismissOnBackdropPress={false}>
        <span>body</span>
      </BaseSheet>,
    );
    expect(screen.getAllByLabelText('Close').length).toBe(1);
    expect(screen.queryByTestId('modal-backdrop')).toBeNull();
  });

  it('renders its children and a visible close button even without a title', () => {
    render(<BaseSheet visible onClose={vi.fn()}><span>the body</span></BaseSheet>);
    expect(screen.getByText('the body')).toBeTruthy();
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });

  it('omits the default close button only for an explicit equivalent control', () => {
    render(
      <BaseSheet visible onClose={vi.fn()} hasEquivalentDismissControl>
        <button aria-label="Done">Done</button>
      </BaseSheet>,
    );
    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.getByLabelText('Done')).toBeTruthy();
  });
});

describe('DiscountFields', () => {
  const setup = (overrides = {}) => {
    const onChange = vi.fn();
    render(createElement(DiscountFields, {
      type: 'none' as const, text: '', onChange, ...overrides,
    }));
    return onChange;
  };

  it('hides the value field until a discount type is chosen', () => {
    setup();
    expect(screen.queryByLabelText('Checkout discount')).toBeNull();
  });

  it('reports the type and the current text together', () => {
    // One callback, not two, so the caller resets its stale quote in exactly
    // one place — splitting it is how a screen forgets one of the branches.
    const onChange = setup({ text: '10' });
    fireEvent.click(screen.getByLabelText('Amount'));
    expect(onChange).toHaveBeenCalledWith({ type: 'amount', text: '10' });
  });

  it('reports the type unchanged when only the value is edited', () => {
    const onChange = setup({ type: 'percentage' as const, text: '5' });
    fireEvent.change(screen.getByLabelText('Checkout discount'), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith({ type: 'percentage', text: '7' });
  });

  it('uses DM Mono for a taka amount and Plus Jakarta Sans for a percentage', () => {
    // CLAUDE.md rule 6. A percentage is not money.
    const { unmount } = render(createElement(DiscountFields, {
      type: 'amount' as const, text: '10', onChange: vi.fn(),
    }));
    expect(screen.getByLabelText('Checkout discount').className).toContain('font-mono');
    unmount();

    render(createElement(DiscountFields, {
      type: 'percentage' as const, text: '10', onChange: vi.fn(),
    }));
    expect(screen.getByLabelText('Checkout discount').className).toContain('font-sans');
    expect(screen.getByLabelText('Checkout discount').className).not.toContain('font-mono');
  });

  it('surfaces the caller-parsed error without inventing one', () => {
    setup({ type: 'amount' as const, text: 'abc', errorMessage: 'Enter a number' });
    expect(screen.getByText('Enter a number')).toBeTruthy();
  });

  it('marks the active type for a screen reader', () => {
    setup({ type: 'amount' as const });
    expect(screen.getByLabelText('Amount').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('None').getAttribute('aria-selected')).toBe('false');
  });
});

describe('ManufacturerPicker', () => {
  const setup = (overrides = {}) => {
    const props = {
      value: '',
      onChange: vi.fn(),
      onRequestSuggestions: vi.fn(),
      suggestions: [] as readonly string[],
      onDismissSuggestions: vi.fn(),
      ...overrides,
    };
    render(createElement(ManufacturerPicker, props));
    return props;
  };

  it('asks for suggestions on focus, with no query', () => {
    const props = setup();
    fireEvent.focus(screen.getByLabelText('Manufacturer'));
    expect(props.onRequestSuggestions).toHaveBeenCalledWith();
  });

  it('asks again, with the typed text, on every keystroke', () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Square' } });
    expect(props.onChange).toHaveBeenCalledWith('Square');
    expect(props.onRequestSuggestions).toHaveBeenCalledWith('Square');
  });

  it('never fetches anything itself', async () => {
    // The shop id and the query stay on the screen side. A picker that
    // imported db/ would quietly become a data-access path
    // (CLAUDE.md rule 1, DEVELOPMENT_RULES.md).
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve('apps/mobile/components/inventory/ManufacturerPicker.tsx'), 'utf8',
    );
    expect(source).not.toContain('../../db/');
    expect(source).not.toContain('listManufacturerSuggestions');
  });

  it('takes a suggestion and dismisses the list', () => {
    const props = setup({ suggestions: ['Square', 'Beximco'] });
    fireEvent.click(screen.getByLabelText('Beximco'));
    expect(props.onChange).toHaveBeenCalledWith('Beximco');
    expect(props.onDismissSuggestions).toHaveBeenCalled();
  });

  it('renders the validation message the form gave it', () => {
    setup({ errorMessage: 'Manufacturer is required' });
    expect(screen.getByText('Manufacturer is required')).toBeTruthy();
  });

  it('renders no suggestion list when there is nothing to suggest', () => {
    setup({ suggestions: [] });
    expect(screen.queryByLabelText('Square')).toBeNull();
  });
});

describe('the migrated screens actually use the shared primitives', () => {
  const read = async (relative: string) => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    return readFileSync(resolve('apps/mobile', relative), 'utf8');
  };

  it.each([
    ['app/cash-summary.tsx'],
    ['app/suppliers/invoice-detail.tsx'],
    ['app/(tabs)/sale.tsx'],
  ])('%s raises toasts through the shared host', async (relative) => {
    const source = await read(relative);
    expect(source).toContain('showToast');
    // The three private implementations are gone: no local visibility flag,
    // no private timer, no duplicated markup.
    expect(source).not.toContain('isToastVisible');
    expect(source).not.toContain('TOAST_DURATION_MS');
    expect(source).not.toContain('addedToCartName');
  });

  it('mounts exactly one toast host, above the navigator', async () => {
    const layout = await read('app/_layout.tsx');
    expect(layout.split('<ToastHost').length - 1).toBe(1);
  });

  it('checkout renders the extracted discount control and keeps the maths where it was', async () => {
    const checkout = await read('app/sale/checkout.tsx');
    expect(checkout).toContain('<DiscountFields');
    // Pass 1 extracts; it does not re-decide. The inline section stays inline
    // (Pass 3 owns Checkout's parity), and resetQuote still fires on edit.
    expect(checkout).toContain('resetQuote();');
    expect(checkout).not.toContain('discountAmountPlaceholder');
  });

  it('the manual entry form renders the extracted picker', async () => {
    const form = await read('components/inventory/ManualEntryForm.tsx');
    expect(form).toContain('<ManufacturerPicker');
    expect(form).toContain('listManufacturerSuggestions');
  });
});
