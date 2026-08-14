import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  supplierFieldsSchema,
  type SupplierFieldsInput,
  type SupplierFieldsOutput,
} from '@muthoy/validation';
import { formatMoney } from '@muthoy/utils';
import { FormField } from '../../components/forms/FormField';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { createSupplier, listSuppliers } from '../../db/suppliers';
import { useSessionStore } from '../../state/sessionStore';
import { triggerSyncNow } from '../../sync';

export default function SupplierListScreen() {
  const session = useSessionStore((state) => state.session);
  const [supplierRows, setSupplierRows] = useState<Awaited<ReturnType<typeof listSuppliers>>>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, reset } = useForm<SupplierFieldsInput, unknown, SupplierFieldsOutput>({
    resolver: zodResolver(supplierFieldsSchema),
    defaultValues: { name: '', phone: '', address: '', email: '', contactPerson: '' },
  });

  const reload = useCallback(async () => {
    if (!session || session.role !== 'owner') {
      return;
    }
    try {
      setSupplierRows(await listSuppliers(session.shopId, session.userId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Supplier list failed to load.');
    }
  }, [session]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const handleCreate = useCallback(async (values: SupplierFieldsOutput) => {
    if (!session || session.role !== 'owner') {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createSupplier(session.shopId, session.userId, values);
      void triggerSyncNow(session.shopId);
      reset();
      setIsAdding(false);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Supplier could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  }, [reload, reset, session]);

  if (!session || session.role !== 'owner') {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans-semibold text-base text-error">Owner access only.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Suppliers" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        <View className="flex-row gap-3">
          <Pressable
            onPress={() => router.push('/suppliers/purchase-create')}
            className="flex-1 items-center rounded-lg bg-brand-green py-3"
          >
            <Text className="font-sans-semibold text-white">New purchase</Text>
          </Pressable>
          <Pressable
            onPress={() => setIsAdding((current) => !current)}
            className="flex-1 items-center rounded-lg border border-brand-green bg-white py-3"
          >
            <Text className="font-sans-semibold text-brand-green">{isAdding ? 'Cancel' : 'Add supplier'}</Text>
          </Pressable>
        </View>

        {isAdding ? (
          <View className="gap-4 rounded-lg bg-white p-4">
            <FormField control={control} name="name" label="Supplier name" />
            <FormField control={control} name="phone" label="Phone" keyboardType="phone-pad" />
            <FormField control={control} name="address" label="Address" />
            <FormField control={control} name="email" label="Email" keyboardType="email-address" autoCapitalize="none" />
            <FormField control={control} name="contactPerson" label="Contact person" />
            <Pressable
              onPress={handleSubmit(handleCreate)}
              disabled={isSubmitting}
              className="items-center rounded-lg bg-brand-green py-3 disabled:opacity-50"
            >
              <Text className="font-sans-semibold text-white">{isSubmitting ? 'Saving…' : 'Save supplier'}</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
        {supplierRows.length === 0 && !isAdding ? (
          <Text className="py-8 text-center font-sans text-midGray">No suppliers yet.</Text>
        ) : supplierRows.map((supplier) => (
          <Pressable
            key={supplier.id}
            onPress={() => router.push({ pathname: '/suppliers/detail', params: { supplierId: supplier.id } })}
            className="gap-2 rounded-lg bg-white p-4"
          >
            <Text className="font-sans-semibold text-base text-richBlack">{supplier.name}</Text>
            {supplier.phone ? <Text className="font-sans text-sm text-midGray">{supplier.phone}</Text> : null}
            <View className="flex-row justify-between">
              <Text className="font-sans text-sm text-midGray">Outstanding payable</Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(supplier.payable)}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
