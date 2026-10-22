// @vitest-environment jsdom
//
// W2-01 / gate E9 — the boundary test. A scanner-only negative assertion cannot
// protect a resumed held draft, because the durable prescription URI lives in
// app/sale/checkout.tsx, and that is a file W2-01 modifies. So this suite drives
// the REAL MedicineTextScanner inside the REAL checkout screen, with the REAL
// native/prescriptionAttachment helpers running against a fake filesystem — only
// the camera and the database are doubled. Anything that deletes a file is
// therefore visible here as the file disappearing.
//
// The scenario is the one that broke two of the five designs plan section 6.2.2
// records: checkout opened from a held draft whose imageUri is ALREADY DURABLE
// (db/saleDrafts.ts copied it into the documents directory when the sale was
// held). A retake, a cancel and an unmount must all leave that file alone.

import { createElement, useEffect, useImperativeHandle, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const SHOP_ID = '4a2d9b10-0000-4000-8000-000000000001';
const MEDICINE_ID = '4a2d9b10-0000-4000-8000-000000000004';
const BATCH_ID = '4a2d9b10-0000-4000-8000-000000000005';

/** The held draft's prescription, already copied into the documents directory. */
const DURABLE_URI =
  'file:///documents/prescription-drafts/shop-1/draft-1/attachment-1.jpg';
/** What a retake's captureAsync() writes into the cache directory. */
const RETAKE_URI = 'file:///cache/retake-1.jpg';

const fakeFs = vi.hoisted(() => ({
  files: new Set<string>(),
  deleted: [] as string[],
}));

// A filesystem the test can inspect. native/prescriptionAttachment.ts runs for
// real on top of it, so a cleanup call actually removes a file here.
vi.mock('expo-file-system', () => {
  class Directory {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map(String).join('/');
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
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  ScrollView: ({ children }: StubProps) => createElement('div', null, children),
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

// The camera is the only part of the scanner that is doubled: a capture writes
// a new cache file and hands back its URI, exactly as captureAsync() does.
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

// monitoring/sink.ts opens MMKV at module scope; the scanner only reaches it on
// a cleanup failure, which is not what this suite is about.
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
  userId: '4a2d9b10-0000-4000-8000-000000000002',
  role: 'owner',
};

/** Checkout as it opens from a held draft carrying a durable prescription. */
function resumeHeldDraft(): void {
  useCartStore.getState().addItem({
    medicineId: MEDICINE_ID,
    medicineName: 'Napa',
    batchId: BATCH_ID,
    quantity: 1,
    unitPrice: asPaisa(1000),
  });
  useCartStore.setState({
    resumedDraftId: 'draft-1',
    resumedDraftDeviceId: 'device-1',
    checkoutSnapshot: {
      paymentType: 'cash',
      cashText: '',
      discountType: 'none',
      discountText: '',
      customerId: null,
      newCustomer: false,
      customerName: '',
      customerPhone: '',
      prescriptionNo: 'RX-1',
      patientName: 'Patient',
      prescriberName: 'Doctor',
      imageUri: DURABLE_URI,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  fakeFs.files.clear();
  fakeFs.deleted.length = 0;
  // The held draft's durable copy is on disk before checkout opens.
  fakeFs.files.add(DURABLE_URI);
  useLocaleStore.getState().setLocale('en');
  useSessionStore.setState({ session: null });
  useCartStore.setState({ items: [], resumedDraftId: null, checkoutSnapshot: null });
  captureAsyncMock.mockImplementation(async () => {
    fakeFs.files.add(RETAKE_URI);
    return RETAKE_URI;
  });
  scanTextMock.mockResolvedValue({ recognizedText: 'Napa 500mg' });
  deps.listCustomers.mockResolvedValue([]);
  deps.getTaxSettings.mockResolvedValue({ rateBp: 0, label: 'VAT' });
  // This suite is about the capture's lifetime, not matching: a prescription
  // that matches nothing still exercises every path it cares about.
  deps.searchMedicinesForSale.mockResolvedValue([]);
  deps.runNotificationChecks.mockResolvedValue(undefined);
  deps.cancelSaleDraft.mockResolvedValue(undefined);
  deps.createCancelledSaleDraft.mockResolvedValue({ draftId: 'draft-1' });
  deps.getActiveBatchForMedicine.mockResolvedValue({
    id: BATCH_ID,
    medicineId: MEDICINE_ID,
    quantityAvailable: 10,
    salePrice: asPaisa(1000),
    expiryDate: null,
  });
});

afterEach(() => cleanup());

describe('a resumed held draft keeps its durable prescription image', () => {
  it('survives a retake', async () => {
    useSessionStore.getState().login(OWNER);
    resumeHeldDraft();
    render(createElement(CheckoutScreen));

    // The screen opened with the durable image already attached, so the button
    // offers a retake rather than an attach.
    fireEvent.click(await screen.findByText('Retake prescription image'));
    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Capture photo'));
    });

    await waitFor(() => expect(captureAsyncMock).toHaveBeenCalled());
    expect(fakeFs.files.has(DURABLE_URI)).toBe(true);
    expect(fakeFs.deleted).toEqual([]);
  });

  it('survives a cancel', async () => {
    useSessionStore.getState().login(OWNER);
    resumeHeldDraft();
    render(createElement(CheckoutScreen));

    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Cancel'));
    });

    await waitFor(() => expect(deps.cancelSaleDraft).toHaveBeenCalled());
    expect(fakeFs.files.has(DURABLE_URI)).toBe(true);
    expect(fakeFs.deleted).toEqual([]);
  });

  it('survives an unmount', async () => {
    useSessionStore.getState().login(OWNER);
    resumeHeldDraft();
    const view = render(createElement(CheckoutScreen));
    await screen.findByText('Retake prescription image');

    await act(async () => {
      view.unmount();
    });

    expect(fakeFs.files.has(DURABLE_URI)).toBe(true);
    expect(fakeFs.deleted).toEqual([]);
  });

  it('survives a retake followed by a cancel', async () => {
    useSessionStore.getState().login(OWNER);
    resumeHeldDraft();
    render(createElement(CheckoutScreen));

    fireEvent.click(await screen.findByText('Retake prescription image'));
    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Capture photo'));
    });
    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Cancel'));
    });

    // The replaced durable file is still there: checkout does not own it, and
    // nothing in this flow may decide to tidy it up (gate E9).
    expect(fakeFs.files.has(DURABLE_URI)).toBe(true);
    expect(fakeFs.deleted).toEqual([]);
  });
});
