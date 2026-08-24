import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  supplierFieldsSchema,
  type SupplierFieldsInput,
  type SupplierFieldsOutput,
} from '@muthoy/validation';
import { ZERO_PAISA } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { FormField } from '../../components/forms/FormField';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { createSupplier, listSuppliers, type SupplierListItem } from '../../db/suppliers';
import { userFacingError } from '../../i18n/display';
import { captureSessionFor } from '../../state/sessionGuard';
import { useI18n } from '../../state/localeStore';
import { useOwnerAccess } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

// screens/Suppliers.tsx parity (plan §1.9 + design-parity review fix):
// search, per-supplier stats (invoice count, total purchase, last purchase
// date), "due" emphasis in bold red when payable > 0, row Invoice/Edit
// actions, empty state, last-purchase-descending sort (already the query's
// own order) — and now a circular FAB + bottom-sheet Add Supplier modal
// matching the prototype's composition, replacing the old inline "+/✕"
// header toggle and inline expanding form.

export default function SupplierListScreen() {
  const { t, formatNumber, formatDate } = useI18n();
  const { session, isAllowed } = useOwnerAccess();
  const [query, setQuery] = useState('');
  const [supplierRows, setSupplierRows] = useState<SupplierListItem[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, reset } = useForm<SupplierFieldsInput, unknown, SupplierFieldsOutput>({
    resolver: zodResolver(supplierFieldsSchema),
    defaultValues: { name: '', phone: '', address: '', email: '', contactPerson: '', manufacturer: '', notes: '' },
  });

  const reload = useCallback(async (searchText: string) => {
    if (!session || !isAllowed) {
      return;
    }
    try {
      setSupplierRows(await listSuppliers(session.shopId, session.userId, searchText));
      setError(null);
    } catch (caught) {
      setError(userFacingError(caught, 'supplierListLoadFailedLabel', t));
    }
  }, [isAllowed, session, t]);

  useFocusEffect(useCallback(() => {
    // Re-read SQLite whenever this route regains focus so edits, payments,
    // and archives made on child screens cannot leave stale list cards.
    void reload(query);
  }, [query, reload]));

  const closeAddSheet = useCallback(() => {
    setIsAdding(false);
    setError(null);
    reset();
  }, [reset]);

  const handleCreate = useCallback(async (values: SupplierFieldsOutput) => {
    if (!session || !isAllowed) {
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const supplier = await createSupplier(session.shopId, session.userId, values, guard.isStillActive);
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => {
        reset();
        setIsAdding(false);
      });
      if (guard.isStillActive()) {
        // SU-10: navigate straight to the new supplier's detail.
        router.push({ pathname: '/suppliers/detail', params: { supplierId: supplier.id } });
      }
    } catch (caught) {
      guard.ifLive(() => setError(userFacingError(caught, 'supplierSaveFailedLabel', t)));
    } finally {
      setIsSubmitting(false);
    }
  }, [isAllowed, reset, session, t]);

  if (!session || !isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t('suppliers')} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-3 p-4 pb-24" keyboardShouldPersistTaps="handled">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('searchSuppliersHint')}
          accessibilityLabel="Search suppliers"
          className="rounded-2xl border border-midGray/40 bg-white px-4 py-3 font-sans text-base text-richBlack"
        />

        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}

        {supplierRows.length === 0 ? (
          <View className="items-center gap-1 py-12">
            <Text className="font-sans-semibold text-base text-richBlack">{t('noSuppliersYet')}</Text>
            <Text className="font-sans text-sm text-midGray">{t('addSupplierHint')}</Text>
          </View>
        ) : supplierRows.map((supplier) => (
          <Pressable
            key={supplier.id}
            onPress={() => router.push({ pathname: '/suppliers/detail', params: { supplierId: supplier.id } })}
            className="gap-3 rounded-2xl bg-white p-4"
          >
            <View className="flex-row items-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-softGreen">
                <Text className="text-xl">🚚</Text>
              </View>
              <View className="flex-1 gap-1">
                <Text className="font-sans-semibold text-base text-richBlack">{supplier.name}</Text>
                {supplier.manufacturer ? <Text className="font-sans-medium text-xs text-brand-green">{supplier.manufacturer}</Text> : null}
                {supplier.phone ? <Text className="font-mono text-sm text-midGray">{supplier.phone}</Text> : null}
              </View>
              {supplier.payable > ZERO_PAISA ? (
                <Text className="font-mono text-base font-bold text-error">{formatMoney(supplier.payable)} {t('dueSlashLabel').toLowerCase()}</Text>
              ) : null}
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs text-midGray">
                {t('invoiceLabel')}: {formatNumber(supplier.invoiceCount)} · {formatMoney(supplier.totalPurchase)}
              </Text>
              <Text className="font-sans text-xs text-midGray">
                {supplier.lastPurchaseDate ? formatDate(supplier.lastPurchaseDate) : '—'}
              </Text>
            </View>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => router.push({ pathname: '/suppliers/purchase-create', params: { supplierId: supplier.id } })}
                className="flex-1 items-center rounded-xl bg-brand-green py-2.5"
              >
                <Text className="font-sans-semibold text-white">{t('invoiceLabel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: '/suppliers/detail', params: { supplierId: supplier.id, edit: '1' } })}
                className="flex-1 items-center rounded-xl border border-brand-green py-2.5"
              >
                <Text className="font-sans-semibold text-brand-green">{t('editLabel')}</Text>
              </Pressable>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable
        onPress={() => setIsAdding(true)}
        accessibilityRole="button"
        accessibilityLabel="Add supplier"
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand-green shadow-lg"
      >
        <Text className="font-sans-bold text-2xl text-white">+</Text>
      </Pressable>

      <Modal visible={isAdding} transparent animationType="slide" onRequestClose={closeAddSheet}>
        <Pressable onPress={closeAddSheet} className="flex-1 justify-end bg-black/50">
          <Pressable className="max-h-[85%] gap-4 rounded-t-3xl bg-white p-5">
            <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans-bold text-lg text-richBlack">{t('addSupplierLabel')}</Text>
                <Pressable onPress={closeAddSheet} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
                  <Text className="font-sans-semibold text-xl text-midGray">✕</Text>
                </Pressable>
              </View>
              <FormField control={control} name="name" label={t('supplierNameLabel')} />
              <FormField control={control} name="phone" label={t('phone')} keyboardType="phone-pad" />
              <FormField control={control} name="address" label={t('address')} />
              <FormField control={control} name="email" label={t('email')} keyboardType="email-address" autoCapitalize="none" />
              <FormField control={control} name="contactPerson" label={t('contactPersonLabel')} />
              <FormField control={control} name="manufacturer" label={t('manufacturerCompanyLabel')} />
              <FormField control={control} name="notes" label={t('notesLabel')} />
              {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
              <Pressable
                onPress={handleSubmit(handleCreate)}
                disabled={isSubmitting}
                className="items-center rounded-2xl bg-brand-green py-4 disabled:opacity-50"
              >
                <Text className="font-sans-bold text-white">{isSubmitting ? t('savingChangesLabel') : t('saveSupplierLabel')}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
