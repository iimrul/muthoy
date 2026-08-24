// @vitest-environment jsdom

import { createElement, useEffect, type ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface NativeProps {
  children?: ReactNode;
  visible?: boolean;
  onPress?: () => void;
  value?: string;
  onChangeText?: (value: string) => void;
  data?: unknown[];
  renderItem?: (info: { item: unknown; index: number }) => ReactNode;
  ListHeaderComponent?: ReactNode;
  ListEmptyComponent?: ReactNode;
}

vi.mock('react-native', () => ({
  View: ({ children }: NativeProps) => createElement('div', null, children),
  Text: ({ children }: NativeProps) => createElement('span', null, children),
  Pressable: ({ children, onPress }: NativeProps) => createElement('button', { onClick: onPress }, children),
  ScrollView: ({ children }: NativeProps) => createElement('div', null, children),
  TextInput: ({ value, onChangeText }: NativeProps) => createElement('input', {
    value: value ?? '',
    onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
  }),
  Modal: ({ visible, children }: NativeProps) => visible ? createElement('div', null, children) : null,
  FlatList: ({ data = [], renderItem, ListHeaderComponent, ListEmptyComponent }: NativeProps) => createElement(
    'div',
    null,
    ListHeaderComponent,
    data.length === 0 ? ListEmptyComponent : data.map((item, index) => createElement('div', { key: index }, renderItem?.({ item, index }))),
  ),
  Switch: () => createElement('input', { type: 'checkbox' }),
}));

const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('expo-router', () => ({
  router,
  useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
}));

const SESSION = { shopId: 'shop-1', userId: 'owner-1', role: 'owner' };
vi.mock('../state/usePermission', () => ({
  usePermission: () => ({ session: SESSION, isAllowed: true }),
  useOwnerAccess: () => ({ session: SESSION, isAllowed: true }),
}));
vi.mock('../state/useUnreadCount', () => ({ useUnreadCount: () => 0 }));
vi.mock('../state/sessionGuard', () => ({
  captureSessionFor: () => ({ isStale: () => false, isStillActive: () => true, ifLive: (fn: () => void) => fn() }),
}));
vi.mock('../sync', () => ({ triggerSyncNow: vi.fn() }));
vi.mock('../components/ui/AccessDenied', () => ({ AccessDenied: () => createElement('div', null, 'denied') }));
vi.mock('../components/ui/StandardHeader', () => ({ StandardHeader: ({ title }: { title: string }) => createElement('h1', null, title) }));
vi.mock('../components/forms/FormField', () => ({ FormField: ({ label }: { label: string }) => createElement('label', null, label) }));
vi.mock('../components/credit/PaymentSheet', () => ({ PaymentSheet: () => null }));
vi.mock('../components/scanner/MedicineTextScanner', () => ({ MedicineTextScanner: () => null }));

vi.mock('../db/customers', () => ({
  CUSTOMER_LIST_PAGE_SIZE: 50,
  collectPayment: vi.fn(),
  createCustomer: vi.fn(),
  getCustomerListTotals: vi.fn().mockResolvedValue({ customerCount: 0, totalOutstanding: 0 }),
  listCustomersWithBalance: vi.fn().mockResolvedValue([]),
}));
vi.mock('../db/suppliers', () => ({
  createSupplier: vi.fn(),
  listSuppliers: vi.fn().mockResolvedValue([]),
}));
vi.mock('../db/purchases', () => ({
  createPurchase: vi.fn(),
  findDuplicatePurchase: vi.fn().mockResolvedValue(null),
  searchMedicinesForPurchase: vi.fn().mockResolvedValue([]),
}));
vi.mock('../db/inventory', () => ({
  createMedicineOnly: vi.fn(),
  listMedicines: vi.fn().mockResolvedValue([]),
}));

const { useLocaleStore } = await import('../state/localeStore');
const CreditSalesScreen = (await import('../app/credit/credit-sales')).default;
const SupplierListScreen = (await import('../app/suppliers/list')).default;
const PurchaseCreateScreen = (await import('../app/suppliers/purchase-create')).default;

beforeEach(() => {
  act(() => useLocaleStore.getState().setLocale('en'));
});

afterEach(cleanup);

describe('B3 Groups 4-6 live locale switching', () => {
  it('updates the Group 4 Credit screen without remounting', async () => {
    render(createElement(CreditSalesScreen));
    expect(await screen.findByText('Credit Sales')).toBeTruthy();
    expect(screen.getByText('No credit customers yet')).toBeTruthy();

    act(() => useLocaleStore.getState().setLocale('bn'));

    expect(await screen.findByText('বাকি বিক্রয়')).toBeTruthy();
    expect(screen.getByText('এখনও কোনো বাকি গ্রাহক নেই')).toBeTruthy();
  });

  it('updates the Group 5 Supplier screen without remounting', async () => {
    render(createElement(SupplierListScreen));
    expect(await screen.findByText('Suppliers')).toBeTruthy();
    expect(screen.getByText('No suppliers yet')).toBeTruthy();

    act(() => useLocaleStore.getState().setLocale('bn'));

    expect(await screen.findByText('সাপ্লাইয়ার')).toBeTruthy();
    expect(screen.getByText('এখনও কোনো সাপ্লাইয়ার নেই')).toBeTruthy();
  });

  it('updates Group 6 step labels and digits without remounting', async () => {
    render(createElement(PurchaseCreateScreen));
    expect(screen.getByText('Method')).toBeTruthy();
    expect(screen.getByText('Scan Invoice')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();

    act(() => useLocaleStore.getState().setLocale('bn'));

    await waitFor(() => expect(screen.getByText('পদ্ধতি')).toBeTruthy());
    expect(screen.getByText('চালান স্ক্যান করুন')).toBeTruthy();
    expect(screen.getByText('১')).toBeTruthy();
    expect(screen.queryByText('Method')).toBeNull();
  });
});
