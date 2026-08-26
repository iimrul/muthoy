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
  accessibilityRole?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  visible?: boolean;
  value?: string;
  placeholder?: string;
  onChangeText?: (value: string) => void;
  className?: string;
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
  listPurchaseReturnsForPurchase: vi.fn(),
  getPurchaseReturnLineContext: vi.fn(),
  previewPurchaseReturn: vi.fn(),
  archiveSupplier: vi.fn(),
  recordSupplierPayment: vi.fn(),
  updateSupplier: vi.fn(),
  triggerSyncNow: vi.fn(),
  t: (key: string) => key,
  formatNumber: (value: number) => String(value),
  formatDate: (value: string) => value.slice(0, 10),
  formatPercent: (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`,
  numberPrefix: '',
}));

vi.mock('react-native', () => ({
  View: ({ children, className }: StubProps) => createElement('div', { className }, children),
  Text: ({ children, className }: StubProps) => createElement('span', { className }, children),
  ScrollView: ({ children }: StubProps) => createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityRole, accessibilityLabel, disabled, className }: StubProps) =>
    accessibilityRole === 'button'
      ? createElement('button', {
          onClick: (event: { stopPropagation: () => void }) => {
            event.stopPropagation();
            onPress?.();
          },
          'aria-label': accessibilityLabel,
          disabled,
          className,
        }, children)
      : createElement('div', { onClick: onPress, className }, children),
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
vi.mock('../../db/purchaseReturns', () => ({
  listPurchaseReturnsForPurchase: deps.listPurchaseReturnsForPurchase,
  getPurchaseReturnLineContext: deps.getPurchaseReturnLineContext,
  previewPurchaseReturn: deps.previewPurchaseReturn,
}));
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
    formatNumber: (value: number) => `${deps.numberPrefix}${deps.formatNumber(value)}`,
    formatDate: deps.formatDate,
    formatPercent: deps.formatPercent,
  }),
}));
vi.mock('../../sync', () => ({ triggerSyncNow: deps.triggerSyncNow }));

const { default: SupplierListScreen } = await import('../../app/suppliers/list');
const { default: SupplierDetailScreen } = await import('../../app/suppliers/detail');
const { PurchaseReturnSheet } = await import('./PurchaseReturnSheet');

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
    deps.numberPrefix = '';
    deps.listSuppliers.mockResolvedValue([]);
    deps.getSupplierDetail.mockResolvedValue({
      supplier: baseSupplier,
      payable: 0,
      supplierCredit: 0,
      totalPurchase: 30000,
      invoiceCount: 2,
      lastPurchaseDate: '2026-08-20T00:00:00.000Z',
      thisMonthTotal: 30000,
      lastMonthTotal: 20000,
    });
    deps.listPurchasesForSupplier.mockResolvedValue([
      {
        id: 'paid-purchase', invoiceNo: 'INV-1', total: 20000, paidAmount: 10000, effectivePayable: 0,
        paymentType: 'credit', createdAt: '2026-08-20T00:00:00.000Z', voidedAt: null, itemCount: 1,
      },
      {
        id: 'unpaid-purchase', invoiceNo: 'INV-2', total: 10000, paidAmount: 0, effectivePayable: 5000,
        paymentType: 'credit', createdAt: '2026-08-19T00:00:00.000Z', voidedAt: null, itemCount: 1,
      },
    ]);
    deps.listSupplierPaymentsForPurchase.mockImplementation(async (_shopId: string, _ownerId: string, purchaseId: string) =>
      purchaseId === 'paid-purchase'
        ? [{ id: 'payment-1', amount: 10000, method: 'cash', note: null, createdAt: '2026-08-21T00:00:00.000Z' }]
        : [],
    );
    deps.listPurchaseReturnsForPurchase.mockImplementation(async (_shopId: string, _ownerId: string, purchaseId: string) =>
      purchaseId === 'paid-purchase'
        ? [{
            id: 'return-1', medicineName: 'Very Long Medicine Name For Narrow Screens', qty: 1,
            creditAmount: 5000, reason: 'supplier_recall', createdAt: '2026-08-22T00:00:00.000Z',
          }]
        : [],
    );
    deps.getPurchaseReturnLineContext.mockResolvedValue({
      purchaseItemId: 'item-1', purchaseId: 'purchase-1', supplierId: SUPPLIER_ID, medicineId: 'medicine-1',
      medicineName: 'Medicine', batchNo: 'B-1', purchaseQty: 12, alreadyReturnedQty: 2,
      currentBatchStock: 7, maxReturnable: 5, purchasePrice: 10000,
    });
    deps.previewPurchaseReturn.mockResolvedValue({
      creditAmount: 30000, currentPayable: 50000, resultingPayable: 20000, resultingSupplierCredit: 0,
    });
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
    await act(async () => { deps.focusCallback?.(); });

    await waitFor(() => expect(deps.listSupplierPaymentsForPurchase).toHaveBeenCalledTimes(2));
    const expandButtons = await screen.findAllByRole('button', { name: 'expandHistoryAccessibilityLabel' });
    expect(expandButtons).toHaveLength(1);
    expect(screen.getByText('partialLabel')).toBeTruthy();

    fireEvent.click(expandButtons[0]!);
    expect(await screen.findByText('+৳100.00')).toBeTruthy();
    expect(screen.getByText(/Very Long Medicine Name/).className).toContain('flex-1');
    expect(screen.getByText('৳50.00').className).toContain('shrink-0');
    expect(screen.getByRole('button', { name: 'collapseHistoryAccessibilityLabel' })).toBeTruthy();
  });

  it('reloads supplier position whenever the detail route regains focus', async () => {
    render(createElement(SupplierDetailScreen));

    expect(deps.focusCallback).toBeTypeOf('function');
    await act(async () => { deps.focusCallback?.(); });
    await waitFor(() => expect(deps.getSupplierDetail).toHaveBeenCalledTimes(1));

    await act(async () => { deps.focusCallback?.(); });
    await waitFor(() => expect(deps.getSupplierDetail).toHaveBeenCalledTimes(2));
  });

  it('localizes return controls and formats return quantities through the active locale', async () => {
    deps.numberPrefix = 'BN-';
    render(createElement(PurchaseReturnSheet, {
      visible: true,
      shopId: SHOP_ID,
      actorUserId: OWNER_ID,
      purchaseId: 'purchase-1',
      purchaseItemId: 'item-1',
      isSubmitting: false,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
    }));

    expect(await screen.findByText('BN-12')).toBeTruthy();
    expect(screen.getByText('BN-2')).toBeTruthy();
    expect(screen.getByText('BN-7')).toBeTruthy();
    expect(screen.getByText('BN-5')).toBeTruthy();
    expect(screen.getByText('maxReturnableLabel: BN-5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'close' })).toBeTruthy();

    const qtyInput = screen.getByRole('textbox', { name: 'returnQtyLabel' });
    fireEvent.change(qtyInput, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'reasonOtherLabel' }));
    expect(screen.getByRole('textbox', { name: 'otherReasonNoteLabel' })).toBeTruthy();
    expect(await screen.findByText(/BN-3 stockWillDecreaseWarning/)).toBeTruthy();
  });
});
