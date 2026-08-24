import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatMoney } from '@muthoy/utils';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { listPurchases, type PurchaseListSummary } from '../../db/purchases';
import { countLabel, userFacingError } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';
import { useOwnerAccess } from '../../state/usePermission';

// screens/SupplierInvoices.tsx parity (plan §1.11): the shop-wide invoices
// list — search by supplier/date/medicine, pending-count chip per row,
// empty state, FAB → the create flow. W-3: this route is what
// navigation/routes.ts's "Supplier Invoices" quick link/tile now points at,
// instead of jumping straight into a blank create form.

export default function SupplierInvoicesScreen() {
  const { t, formatNumber, formatDate } = useI18n();
  const { session, isAllowed } = useOwnerAccess();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PurchaseListSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (searchText: string) => {
    if (!session || !isAllowed) return;
    try {
      setRows(await listPurchases(session.shopId, session.userId, searchText));
      setError(null);
    } catch (caught) {
      setError(userFacingError(caught, 'invoicesLoadFailedLabel', t));
    }
  }, [isAllowed, session, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isAllowed, session]);

  if (!session || !isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t('supplierInvoices')} onBackPress={() => router.back()} />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 p-4 pb-24"
        ListHeaderComponent={
          <View className="mb-3 gap-3">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('searchInvoicesHint')}
              accessibilityLabel="Search invoices"
              className="rounded-2xl border border-midGray/40 bg-white px-4 py-3 font-sans text-base text-richBlack"
            />
            {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <View className="items-center gap-1 py-12">
            <Text className="font-sans-semibold text-base text-richBlack">{t('noInvoicesYetLabel')}</Text>
            <Text className="font-sans text-sm text-midGray">{t('tapButtonBelowLabel')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/suppliers/invoice-detail', params: { purchaseId: item.id } })}
            className="gap-2 rounded-2xl bg-white p-4"
          >
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-semibold text-base text-richBlack">{item.supplierName}</Text>
              {item.voidedAt ? (
                <View className="rounded-full bg-error/10 px-2 py-0.5">
                  <Text className="font-sans-semibold text-xs text-error">{t('statusVoidedLabel')}</Text>
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs text-midGray">
                {formatDate(item.createdAt)} · {formatNumber(item.itemCount)} {countLabel(item.itemCount, 'itemCountLabel', 'itemsCountLabel', t)}
                {item.pendingCount > 0 ? ` · ⏳ ${formatNumber(item.pendingCount)} ${t('pendingCountLabel')}` : ''}
              </Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(item.total)}</Text>
            </View>
          </Pressable>
        )}
      />
      <Pressable
        onPress={() => router.push('/suppliers/purchase-create')}
        className="absolute bottom-6 left-6 right-6 items-center rounded-2xl bg-brand-green py-4"
      >
        <Text className="font-sans-bold text-white">{t('newInvoiceLabel')}</Text>
      </Pressable>
    </View>
  );
}
