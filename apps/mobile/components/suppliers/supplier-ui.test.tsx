// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHOP_ID = '8c2f1a30-0000-4000-8000-000000000001';
const OWNER_ID = '8c2f1a30-0000-4000-8000-000000000002';
const SUPPLIER_ID = '8c2f1a30-0000-4000-8000-000000000003';

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  visible?: boolean;
  value?: string;
  placeholder?: string;
  onChangeText?: (value: string) => void;
}

const deps = vi.hoisted(() => ({
  session: {
    shopId: '8c2f1a30-0000-4000-8000-000000000001',
    userId: '8c2f1a30-0000-4000-8000-000000000002',
    role: 'owner',
  },
  focusCallback: undefined as undefined | (() => void | (() => void)),
  listSuppliers: vi.fn(),
  createSupplier: vi.fn(),
  getSupplierDetail: vi.fn(),
  listPurchasesForSupplier: vi.fn(),
  listSupplierPaymentsForPurchase: vi.fn(),
  archiveSupplier: vi.fn(),
  recordSupplierPayment: vi.fn(),
  updateSupplier: vi.fn(),
  triggerSyncNow: vi.fn(),
  t: (key: string) => key,
  formatNumber: (value: number) => String(value),
  formatDate: (value: string) => value.slice(0, 10),
  formatPercent: (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`,
}));

vi.mock('react-native', () => ({
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  ScrollView: ({ children }: StubProps) => createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children),
  TextInput: ({ value, onChangeText, accessibilityLabel, placeholder }: StubProps) =>
    createElement('input', {
      value: value ?? '',
      'aria-label': accessibilityLabel,
      placeholder,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
  Modal: ({ children, visible }: StubProps) => visible ? createElement('div', null, children) : null,
  Alert: { alert: vi.fn() },
}));

vi.mock('expo-router', () => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
  useFocusEffect: (callback: () => void | (() => void)) => {
    deps.focusCallback = callback;
  },
  useLocalSearchParams: () => ({ supplierId: SUPPLIER_ID }),
}));

vi.mock('../../components/forms/FormField', () => ({ FormField: () => null }));
vi.mock('../../components/ui/AccessDenied', () => ({ AccessDenied: () => createElement('p', null, 'Access denied') }));
vi.mock('../../components/ui/StandardHeader', () => ({
  StandardHeader: ({ title }: { title: string }) => createElement('h1', null, title),
}));
vi.mock('./SupplierPaymentSheet', () => ({ SupplierPaymentSheet: () => null }));

vi.mock('../../db/suppliers', () => ({
  listSuppliers: deps.listSuppliers,
  createSupplier: deps.createSupplier,
  getSupplierDetail: deps.getSupplierDetail,
  listSupplierPaymentsForPurchase: deps.listSupplierPaymentsForPurchase,
  archiveSupplier: deps.archiveSupplier,
  recordSupplierPayment: deps.recordSupplierPayment,
  updateSupplier: deps.updateSupplier,
}));
vi.mock('../../db/purchases', () => ({ listPurchasesForSupplier: deps.listPurchasesForSupplier }));
vi.mock('../../state/usePermission', () => ({
  useOwnerAccess: () => ({
    session: deps.session,
    isAllowed: true,
  }),
}));
vi.mock('../../state/sessionGuard', () => ({
  captureSessionFor: () => ({
    isStillActive: () => true,
    isStale: () => false,
    ifLive: (effect: () => void) => effect(),
  }),
}));
vi.mock('../../state/localeStore', () => ({
  useI18n: () => ({
    t: deps.t,
    formatNumber: deps.formatNumber,
    formatDate: deps.formatDate,
    formatPercent: deps.formatPercent,
  }),
}));
vi.mock('../../sync', () => ({ triggerSyncNow: deps.triggerSyncNow }));

const { default: SupplierListScreen } = await import('../../app/suppliers/list');
const { default: SupplierDetailScreen } = await import('../../app/suppliers/detail');

const baseSupplier = {
  id: SUPPLIER_ID,
  shopId: SHOP_ID,
  name: 'Acme',
  phone: null,
  address: null,
  email: null,
  contactPerson: null,
  manufacturer: null,
  notes: null,
  archivedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('supplier screen parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.focusCallback = undefined;
    deps.listSuppliers.mockResolvedValue([]);
    deps.getSupplierDetail.mockResolvedValue({
      supplier: baseSupplier,
      payable: 0,
      totalPurchase: 30000,
      invoiceCount: 2,
      lastPurchaseDate: '2026-08-20T00:00:00.000Z',
      thisMonthTotal: 30000,
      lastMonthTotal: 20000,
    });
    deps.listPurchasesForSupplier.mockResolvedValue([
      {
        id: 'paid-purchase', invoiceNo: 'INV-1', total: 20000, paidAmount: 10000,
        paymentType: 'credit', createdAt: '2026-08-20T00:00:00.000Z', voidedAt: null, itemCount: 1,
      },
      {
        id: 'unpaid-purchase', invoiceNo: 'INV-2', total: 10000, paidAmount: 0,
        paymentType: 'credit', createdAt: '2026-08-19T00:00:00.000Z', voidedAt: null, itemCount: 1,
      },
    ]);
    deps.listSupplierPaymentsForPurchase.mockImplementation(async (_shopId: string, _ownerId: string, purchaseId: string) =>
      purchaseId === 'paid-purchase'
        ? [{ id: 'payment-1', amount: 10000, method: 'cash', note: null, createdAt: '2026-08-21T00:00:00.000Z' }]
        : [],
    );
  });

  afterEach(cleanup);

  it('reloads the supplier list whenever the route regains focus', async () => {
    render(createElement(SupplierListScreen));

    expect(deps.focusCallback).toBeTypeOf('function');
    await act(async () => { deps.focusCallback?.(); });
    await waitFor(() => expect(deps.listSuppliers).toHaveBeenCalledTimes(1));

    await act(async () => { deps.focusCallback?.(); });
    await waitFor(() => expect(deps.listSuppliers).toHaveBeenCalledTimes(2));
    expect(deps.listSuppliers).toHaveBeenLastCalledWith(SHOP_ID, OWNER_ID, '');
  });

  it('shows the prototype chevron only for invoices with payment history', async () => {
    render(createElement(SupplierDetailScreen));

    await waitFor(() => expect(deps.listSupplierPaymentsForPurchase).toHaveBeenCalledTimes(2));
    const expandButtons = await screen.findAllByRole('button', { name: 'Expand payment history' });
    expect(expandButtons).toHaveLength(1);

    fireEvent.click(expandButtons[0]!);
    expect(await screen.findByText('+৳100.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse payment history' })).toBeTruthy();
  });
});
