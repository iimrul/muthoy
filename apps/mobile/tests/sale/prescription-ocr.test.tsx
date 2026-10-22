// @vitest-environment jsdom
//
// W2-01 section 6.2.4 — reading the captured prescription.
//
// Before this, checkout opened the scanner with captureOnly and
// onTextRecognized={() => undefined}, and the scanner returned from the
// captureOnly branch before scanText was ever called: the camera ran, the
// image was stored, and the image-to-text step did not happen at all.
//
// Driven for real: the real scanner, the real invoice-line extractor, the real
// exact-name matching, the real review list and the real cart store. Only the
// camera, the database and the filesystem are doubled.
//
// Founder-approved behaviour for a confirmed line (plan section 6.2.4 left it
// open): it goes through the cart store's own addItem and then resets the
// quote, so the total is recomputed and the sale needs reconfirmation.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const SHOP_ID = '8d3f2b40-0000-4000-8000-000000000001';
const MEDICINE_ID = '8d3f2b40-0000-4000-8000-000000000004';
const BATCH_ID = '8d3f2b40-0000-4000-8000-000000000005';
const CAPTURE_URI = 'file:///cache/prescription-1.jpg';

/** Two blocks: one the shop stocks, one it does not. */
const PRESCRIPTION_TEXT = 'Napa Extra\nBatch: B-2401\n\nMysterymed 999';

const fakeFs = vi.hoisted(() => ({ files: new Set<string>(), deleted: [] as string[] }));
vi.mock('expo-file-system', () => {
  class Directory {
    constructor(...parts: unknown[]) {
      void parts;
    }
    create() {}
  }
  class File {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map(String).join('/');
    }
    get exists() {
      return fakeFs.files.has(this.uri);
    }
    get extension() {
      return '.jpg';
    }
    delete() {
      fakeFs.files.delete(this.uri);
      fakeFs.deleted.push(this.uri);
    }
    async copy() {}
  }
  return { Directory, File, Paths: { document: 'file:///documents' } };
});

const mmkv = vi.hoisted(() => {
  const stores = new Map<string, Map<string, string>>();
  return {
    stores,
    createMMKV: ({ id }: { id: string }) => {
      const store = stores.get(id) ?? new Map<string, string>();
      stores.set(id, store);
      return {
        set: (key: string, value: string) => void store.set(key, value),
        getString: (key: string) => store.get(key),
        remove: (key: string) => void store.delete(key),
      };
    },
  };
});
vi.mock('react-native-mmkv', () => ({ createMMKV: mmkv.createMMKV }));

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  value?: string;
  onChangeText?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  visible?: boolean;
}

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Linking: { openSettings: vi.fn() },
  Platform: { OS: 'android' },
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  ScrollView: ({ children }: StubProps) => createElement('div', null, children),
  KeyboardAvoidingView: ({ children }: StubProps) => createElement('div', null, children),
  ActivityIndicator: () => createElement('div', { role: 'progressbar' }),
  Modal: ({ children, visible }: StubProps) =>
    visible === false ? null : createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement(
      'button',
      { onClick: onPress, 'aria-label': accessibilityLabel, disabled },
      children,
    ),
  TextInput: ({ value, onChangeText, accessibilityLabel, placeholder }: StubProps) =>
    createElement('input', {
      value: value ?? '',
      'aria-label': accessibilityLabel ?? placeholder,
      placeholder,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
}));

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }));
vi.mock('expo-router', () => ({ router: routerMock }));

vi.mock('../../components/ui/StandardHeader', () => ({
  StandardHeader: ({ title }: { title: string }) => createElement('h1', null, title),
}));

const captureAsyncMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock('../../native/ScannerCamera', () => ({
  ScannerCamera: ({
    onPermissionStateChange,
    ref,
  }: {
    onPermissionStateChange: (state: string) => void;
    ref?: React.Ref<unknown>;
  }) => {
    useEffect(() => {
      onPermissionStateChange('granted');
    }, [onPermissionStateChange]);
    useImperativeHandle(ref, () => ({
      requestPermission: async () => true,
      captureAsync: captureAsyncMock,
    }));
    return null;
  },
}));

const scanTextMock = vi.hoisted(() =>
  vi.fn<(uri: string) => Promise<{ recognizedText: string } | null>>(),
);
vi.mock('../../native/scanner', () => ({
  scanText: (uri: string) => scanTextMock(uri),
  scanBarcode: () => null,
}));

const reportEventMock = vi.hoisted(() => vi.fn<(event: string) => void>());
vi.mock('../../monitoring', () => ({ reportEvent: reportEventMock }));

const deps = vi.hoisted(() => ({
  listCustomers: vi.fn(),
  createSaleTransaction: vi.fn(),
  getActiveBatchForMedicine: vi.fn(),
  searchMedicinesForSale: vi.fn(),
  holdSaleDraft: vi.fn(),
  cancelSaleDraft: vi.fn(),
  createCancelledSaleDraft: vi.fn(),
  runNotificationChecks: vi.fn(),
  triggerSyncNow: vi.fn(),
  stopSyncEngine: vi.fn(),
  getTaxSettings: vi.fn(),
}));

vi.mock('../../db/customers', () => ({ listCustomers: deps.listCustomers }));
vi.mock('../../db/settings', () => ({ getTaxSettings: deps.getTaxSettings }));
vi.mock('../../db/sales', () => ({
  createSaleTransaction: deps.createSaleTransaction,
  getActiveBatchForMedicine: deps.getActiveBatchForMedicine,
  searchMedicinesForSale: deps.searchMedicinesForSale,
  SaleQuoteChangedError: class SaleQuoteChangedError extends Error {},
}));
vi.mock('../../db/saleDrafts', () => ({
  holdSaleDraft: deps.holdSaleDraft,
  cancelSaleDraft: deps.cancelSaleDraft,
  createCancelledSaleDraft: deps.createCancelledSaleDraft,
}));
vi.mock('../../native/notifications', () => ({
  runNotificationChecks: deps.runNotificationChecks,
}));
vi.mock('../../sync', () => ({
  triggerSyncNow: deps.triggerSyncNow,
  stopSyncEngine: deps.stopSyncEngine,
}));

const { useLocaleStore } = await import('../../state/localeStore');
const { useSessionStore } = await import('../../state/sessionStore');
type Session = import('../../state/sessionStore').Session;
const { useCartStore } = await import('../../state/cartStore');
const { asPaisa } = await import('@muthoy/types');
const CheckoutScreen = (await import('../../app/sale/checkout')).default;

const OWNER: Session = {
  shopId: SHOP_ID,
  userId: '8d3f2b40-0000-4000-8000-000000000002',
  role: 'owner',
};

const NAPA = {
  medicineId: MEDICINE_ID,
  name: 'Napa Extra',
  generic: 'Paracetamol + Caffeine',
  manufacturer: 'Beximco',
  requiresPrescription: false,
  activeBatch: {
    id: BATCH_ID,
    medicineId: MEDICINE_ID,
    quantityAvailable: 10,
    salePrice: asPaisa(1200),
    expiryDate: '2099-01-01',
  },
  activeBatchNo: 'B-2401',
  promotionBps: 0,
  originalUnitPrice: asPaisa(1200),
};

/** The sale already has one unrelated line, so added lines are countable. */
function startCheckout(): void {
  useCartStore.getState().addItem({
    medicineId: '8d3f2b40-0000-4000-8000-00000000000f',
    medicineName: 'Seclo',
    batchId: '8d3f2b40-0000-4000-8000-00000000000e',
    quantity: 1,
    unitPrice: asPaisa(800),
  });
}

async function capturePrescription(): Promise<void> {
  fireEvent.click(await screen.findByText('Attach prescription image'));
  await act(async () => {
    fireEvent.click(await screen.findByLabelText('Capture photo'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  fakeFs.files.clear();
  fakeFs.deleted.length = 0;
  useLocaleStore.getState().setLocale('en');
  useSessionStore.setState({ session: OWNER });
  useCartStore.setState({ items: [], resumedDraftId: null, checkoutSnapshot: null });
  captureAsyncMock.mockImplementation(async () => {
    fakeFs.files.add(CAPTURE_URI);
    return CAPTURE_URI;
  });
  scanTextMock.mockResolvedValue({ recognizedText: PRESCRIPTION_TEXT });
  deps.searchMedicinesForSale.mockImplementation(async (_shopId: string, query: string) =>
    query.toLowerCase().includes('napa') ? [NAPA] : [],
  );
  deps.listCustomers.mockResolvedValue([]);
  deps.getTaxSettings.mockResolvedValue({ rateBp: 0, label: 'VAT' });
  deps.runNotificationChecks.mockResolvedValue(undefined);
  deps.createSaleTransaction.mockResolvedValue({
    saleId: '8d3f2b40-0000-4000-8000-00000000000a',
    invoiceNo: 'INV-1',
    total: asPaisa(2000),
    change: asPaisa(0),
  });
  deps.getActiveBatchForMedicine.mockResolvedValue({
    id: BATCH_ID,
    medicineId: MEDICINE_ID,
    quantityAvailable: 10,
    salePrice: asPaisa(1200),
    expiryDate: '2099-01-01',
  });
  deps.cancelSaleDraft.mockResolvedValue(undefined);
  deps.createCancelledSaleDraft.mockResolvedValue({ draftId: 'draft-1' });
  deps.holdSaleDraft.mockResolvedValue({ draftId: 'draft-1' });
});

afterEach(() => cleanup());

describe('a captured prescription is read as well as stored', () => {
  it('runs recognition on the capture and reviews each line without adding anything', async () => {
    startCheckout();
    render(createElement(CheckoutScreen));
    await capturePrescription();

    await waitFor(() => expect(scanTextMock).toHaveBeenCalledWith(CAPTURE_URI));
    expect(await screen.findByText('From the prescription')).toBeTruthy();
    // The stocked line is matched and offered; the other is not.
    expect(await screen.findByLabelText('Add Napa Extra')).toBeTruthy();
    expect(screen.getByText('No match in your stock')).toBeTruthy();
    // Nothing is added on its own — the cart still holds only its own line.
    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('adds a matched line only when its own Add is pressed', async () => {
    startCheckout();
    render(createElement(CheckoutScreen));
    await capturePrescription();

    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Add Napa Extra'));
    });

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      medicineId: MEDICINE_ID,
      medicineName: 'Napa Extra',
      batchId: BATCH_ID,
      quantity: 1,
    });
    // The row stops offering Add, so one press cannot become two.
    expect(await screen.findByText('Added to this sale')).toBeTruthy();
    expect(screen.queryByLabelText('Add Napa Extra')).toBeNull();
  });

  it('offers a manual search for an unmatched line and adds nothing', async () => {
    startCheckout();
    render(createElement(CheckoutScreen));
    await capturePrescription();

    const search = await screen.findByLabelText('Search Mysterymed 999');
    await act(async () => {
      fireEvent.click(search);
    });

    expect(useCartStore.getState().items).toHaveLength(1);
    // push, not replace: a half-filled checkout is not discarded.
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/sale',
      params: { q: 'Mysterymed 999' },
    });
  });

  it('keeps the image and the sale when the prescription cannot be read', async () => {
    scanTextMock.mockResolvedValueOnce(null);
    startCheckout();
    render(createElement(CheckoutScreen));
    await capturePrescription();

    expect(
      await screen.findByText("Couldn't read the prescription. The image is still attached."),
    ).toBeTruthy();
    // The capture is attached and untouched, and the sale is still completable.
    expect(screen.getByText('Image captured. Sale is not blocked by image upload.')).toBeTruthy();
    expect(fakeFs.files.has(CAPTURE_URI)).toBe(true);
    expect(fakeFs.deleted).toEqual([]);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(screen.queryByLabelText('Add Napa Extra')).toBeNull();
  });

  it('never persists the recognised text with the sale', async () => {
    startCheckout();
    render(createElement(CheckoutScreen));
    await capturePrescription();
    await screen.findByText('From the prescription');

    fireEvent.change(screen.getByLabelText('Amount tendered (৳)'), {
      target: { value: '100' },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Confirm sale'));
    });

    await waitFor(() => expect(deps.createSaleTransaction).toHaveBeenCalled());
    const payload = JSON.stringify(deps.createSaleTransaction.mock.calls.at(-1)?.[0] ?? {});
    expect(payload).not.toContain('Mysterymed');
    expect(payload).not.toContain('Batch: B-2401');
  });
});

describe('a confirmed prescription line invalidates the quote', () => {
  it('resets the quote so the total is recomputed before the sale commits', () => {
    // The quote-change flow itself is covered by checkout.test.tsx's
    // "requires stale-quote reconfirmation again after any cart edit"; what is
    // asserted here is that this new cart write is wired into the same reset.
    const source = readFileSync(
      resolve(process.cwd(), 'apps/mobile/app/sale/checkout.tsx'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const adder = source.slice(
      source.indexOf('const addPrescriptionLine'),
      source.indexOf('const resetQuote'),
    );
    expect(adder).toContain('addItem({');
    expect(adder).toContain('resetQuote();');
  });
});
