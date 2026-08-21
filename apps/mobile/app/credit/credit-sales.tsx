import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  customerFieldsSchema,
  type CustomerFieldsInput,
  type CustomerFieldsOutput,
} from '@muthoy/validation';
import { formatMoney } from '@muthoy/utils';
import { FormField } from '../../components/forms/FormField';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { createCustomer, listCustomersWithBalance } from '../../db/customers';
import { captureSessionFor } from '../../state/sessionGuard';
import { usePermission } from '../../state/usePermission';
import { useUnreadCount } from '../../state/useUnreadCount';
import { triggerSyncNow } from '../../sync';

export default function CreditSalesScreen() {
  // Volume 0 Day 11: standalone customer credit management is owner-only —
  // Staff still makes credit SALES at checkout (db/sales.ts), just not here.
  const { session, isAllowed } = usePermission('credit_view');
  const { isAllowed: canManage } = usePermission('credit_manage');
  const unreadCount = useUnreadCount(session?.shopId, session?.userId);
  const [customerRows, setCustomerRows] = useState<Awaited<ReturnType<typeof listCustomersWithBalance>>>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, reset } = useForm<CustomerFieldsInput, unknown, CustomerFieldsOutput>({
    resolver: zodResolver(customerFieldsSchema),
    defaultValues: { name: '', phone: '', address: '', notes: '' },
  });

  const reload = useCallback(async () => {
    // A denied role reads nothing: standalone credit balances are exactly
    // what this screen is protecting.
    if (!session || !isAllowed) {
      return;
    }
    // Owner-only balances: a read that lands after the handover must not paint
    // them for whoever is holding the phone now.
    const guard = captureSessionFor(session);
    try {
      const rows = await listCustomersWithBalance(session.shopId, session.userId);
      if (!guard || guard.isStale()) {
        return;
      }
      setCustomerRows(rows);
      setError(null);
    } catch (caught) {
      if (!guard || guard.isStale()) {
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Customer list failed to load.');
    }
  }, [isAllowed, session]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const handleCreate = useCallback(async (values: CustomerFieldsOutput) => {
    if (!session || !isAllowed || !canManage) {
      return;
    }
    // react-hook-form awaits the zod resolver BEFORE calling this handler, so
    // a handover can land in that gap and this closure still holds the
    // outgoing `session`. captureSessionFor refuses outright when the store has
    // already moved on, so createCustomer is never even reached.
    const guard = captureSessionFor(session);
    if (!guard) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createCustomer({
        shopId: session.shopId,
        actorUserId: session.userId,
        isStillActive: guard.isStillActive,
        ...values,
      });
      void triggerSyncNow(session.shopId);
      // Closing the form and repainting the list belong to the user who saved.
      if (guard.isStale()) {
        return;
      }
      reset();
      setIsAdding(false);
      await reload();
    } catch (caught) {
      if (guard.isStale()) {
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Customer could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  }, [canManage, isAllowed, reload, reset, session]);

  if (!session) {
    return <AccessDenied message="Active session required." />;
  }

  // Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
  // screens." Arriving here by direct navigation renders this instead, and
  // db/customers.ts rejects the writes independently.
  if (!isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title="Customer credit"
        onBackPress={() => router.back()}
        onBellPress={() => router.push('/notifications')}
        unreadCount={unreadCount}
      />
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        {canManage ? <Pressable
          onPress={() => setIsAdding((current) => !current)}
          className="items-center rounded-lg bg-brand-green py-3"
        >
          <Text className="font-sans-semibold text-white">{isAdding ? 'Cancel' : 'Add customer'}</Text>
        </Pressable> : null}

        {isAdding && canManage ? (
          <View className="gap-4 rounded-lg bg-white p-4">
            <FormField control={control} name="name" label="Customer name" />
            <FormField control={control} name="phone" label="Phone" keyboardType="phone-pad" />
            <FormField control={control} name="address" label="Address" />
            <FormField control={control} name="notes" label="Notes" />
            <Pressable
              onPress={handleSubmit(handleCreate)}
              disabled={isSubmitting}
              className="items-center rounded-lg bg-brand-green py-3 disabled:opacity-50"
            >
              <Text className="font-sans-semibold text-white">{isSubmitting ? 'Saving…' : 'Save customer'}</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
        {customerRows.length === 0 && !isAdding ? (
          <Text className="py-8 text-center font-sans text-midGray">No customers yet.</Text>
        ) : customerRows.map((customer) => (
          <Pressable
            key={customer.id}
            onPress={() => router.push({ pathname: '/credit/customer-detail', params: { customerId: customer.id } })}
            className="gap-2 rounded-lg bg-white p-4"
          >
            <Text className="font-sans-semibold text-base text-richBlack">{customer.name}</Text>
            {customer.phone ? <Text className="font-sans text-sm text-midGray">{customer.phone}</Text> : null}
            <View className="flex-row justify-between">
              <Text className="font-sans text-sm text-midGray">Outstanding balance</Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(customer.balance)}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
