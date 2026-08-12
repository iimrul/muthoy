import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { subtractPaisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { listPurchasesForSupplier, type PurchaseListRow } from '../../db/purchases';
import { getSupplierDetail, type Supplier } from '../../db/suppliers';
import { useSessionStore } from '../../state/sessionStore';

export default function SupplierDetailScreen() {
  const { supplierId } = useLocalSearchParams<{ supplierId: string }>();
  const session = useSessionStore((state) => state.session);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [payable, setPayable] = useState<Awaited<ReturnType<typeof getSupplierDetail>>['payable'] | null>(null);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseListRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session || session.role !== 'owner' || !supplierId) {
      return;
    }
    try {
      const [detail, history] = await Promise.all([
        getSupplierDetail(session.shopId, session.userId, supplierId),
        listPurchasesForSupplier(session.shopId, session.userId, supplierId),
      ]);
      setSupplier(detail.supplier);
      setPayable(detail.payable);
      setPurchaseRows(history);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Supplier details failed to load.');
    }
  }, [session, supplierId]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (!session || session.role !== 'owner') {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans-semibold text-base text-error">Owner access only.</Text>
      </View>
    );
  }

  if (!supplierId) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans text-base text-error">Supplier is missing.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={supplier?.name ?? 'Supplier'} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
        {supplier ? (
          <View className="gap-2 rounded-lg bg-white p-4">
            <Text className="font-sans-bold text-lg text-richBlack">{supplier.name}</Text>
            {supplier.contactPerson ? <Text className="font-sans text-sm text-richBlack">Contact: {supplier.contactPerson}</Text> : null}
            {supplier.phone ? <Text className="font-sans text-sm text-richBlack">{supplier.phone}</Text> : null}
            {supplier.email ? <Text className="font-sans text-sm text-richBlack">{supplier.email}</Text> : null}
            {supplier.address ? <Text className="font-sans text-sm text-midGray">{supplier.address}</Text> : null}
            <View className="mt-2 flex-row items-center justify-between border-t border-midGray pt-3">
              <Text className="font-sans-medium text-sm text-richBlack">Outstanding payable</Text>
              <Text className="font-mono text-lg text-error">{payable === null ? '—' : formatMoney(payable)}</Text>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={() => router.push({ pathname: '/suppliers/purchase-create', params: { supplierId } })}
          className="items-center rounded-lg bg-brand-green py-3"
        >
          <Text className="font-sans-semibold text-white">New purchase</Text>
        </Pressable>

        <Text className="font-sans-bold text-base text-richBlack">Purchase history</Text>
        {purchaseRows.length === 0 ? (
          <Text className="py-6 text-center font-sans text-midGray">No purchases yet.</Text>
        ) : purchaseRows.map((purchase) => (
          <View key={purchase.id} className="gap-2 rounded-lg bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-mono text-sm text-richBlack">{purchase.invoiceNo}</Text>
              <Text className="font-sans-medium text-xs uppercase text-midGray">{purchase.paymentType}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs text-midGray">{new Date(purchase.createdAt).toLocaleDateString()}</Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(purchase.total)}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs text-midGray">Outstanding</Text>
              <Text className="font-mono text-sm text-error">
                {formatMoney(subtractPaisa(purchase.total, purchase.paidAmount))}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
