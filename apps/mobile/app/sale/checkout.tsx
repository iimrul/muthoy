import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { fromTaka, subtractPaisa, type Paisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { checkoutCustomerSchema, tenderedAmountSchema } from '@muthoy/validation';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { listCustomers, type Customer } from '../../db/customers';
import { listBatchesForMedicine } from '../../db/inventory';
import { createSaleTransaction } from '../../db/sales';
import { deduct, InsufficientStockError } from '../../domain/fefo';
import { useCartStore } from '../../state/cartStore';
import { useSessionStore } from '../../state/sessionStore';

type PaymentType = 'cash' | 'credit';

export default function CheckoutScreen() {
  const session = useSessionStore((state) => state.session);
  const items = useCartStore((state) => state.items);
  const total = useCartStore((state) => state.total());
  const clearCart = useCartStore((state) => state.clear);
  const [paymentType, setPaymentType] = useState<PaymentType>('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const customerRequestId = useRef(0);

  if (!session) {
    return null;
  }

  const loadCustomers = async (query?: string) => {
    const currentRequest = ++customerRequestId.current;
    try {
      const matches = await listCustomers(session.shopId, query);
      if (currentRequest === customerRequestId.current) {
        setCustomers(matches);
      }
    } catch {
      if (currentRequest === customerRequestId.current) {
        setError('Customer search failed. Try again.');
      }
    }
  };

  const handlePaymentTypeChange = (next: PaymentType) => {
    setPaymentType(next);
    setError(null);
    if (next === 'credit') {
      void loadCustomers();
    }
  };

  const handleCustomerQueryChange = (value: string) => {
    setCustomerQuery(value);
    setSelectedCustomerId(null);
    void loadCustomers(value);
  };

  const parsedTendered = tenderedAmountSchema.safeParse(amountTendered);
  const tenderedPaisa = parsedTendered.success ? fromTaka(parsedTendered.data) : undefined;
  const displayedChange = tenderedPaisa !== undefined && tenderedPaisa >= total
    ? subtractPaisa(tenderedPaisa, total)
    : undefined;

  const handleConfirm = async () => {
    setError(null);
    if (items.length === 0) {
      setError('Cart is empty.');
      return;
    }

    let cashTendered: Paisa | undefined;
    let newCustomer: { name: string; phone?: string } | undefined;
    if (paymentType === 'cash') {
      const parsed = tenderedAmountSchema.safeParse(amountTendered);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Enter a valid tendered amount.');
        return;
      }
      cashTendered = fromTaka(parsed.data);
      if (cashTendered < total) {
        setError('Amount tendered is less than the total.');
        return;
      }
    } else if (isNewCustomer) {
      const parsed = checkoutCustomerSchema.safeParse({ name: newCustomerName, phone: newCustomerPhone });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Enter valid customer details.');
        return;
      }
      newCustomer = parsed.data;
    } else if (!selectedCustomerId) {
      setError('Select a customer or create a new customer.');
      return;
    }

    setIsSubmitting(true);
    try {
      const freshBatches = await Promise.all(
        items.map((item) => listBatchesForMedicine(session.shopId, item.medicineId)),
      );
      const lines = items.map((item, index) => ({
        medicineId: item.medicineId,
        deductions: deduct(item.medicineId, item.quantity, freshBatches[index] ?? []),
        unitPrice: item.unitPrice,
        discount: item.discount,
      }));
      const result = await createSaleTransaction({
        shopId: session.shopId,
        staffId: session.userId,
        paymentType,
        amountTendered: cashTendered,
        customerId: paymentType === 'credit' && !isNewCustomer ? selectedCustomerId ?? undefined : undefined,
        newCustomer,
        lines,
      });

      clearCart();
      router.replace({
        pathname: './confirmation',
        params: {
          invoiceNo: result.invoiceNo,
          total: String(result.total),
          paymentType,
          change: String(result.change),
        },
      });
    } catch (caught) {
      if (caught instanceof InsufficientStockError) {
        const item = items.find((candidate) => candidate.medicineId === caught.medicineId);
        setError(`${item?.medicineName ?? 'Medicine'} has only ${caught.available} in stock. Cart was not changed.`);
      } else {
        setError(caught instanceof Error ? caught.message : 'Checkout failed. Cart was not changed.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Checkout" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-5 p-4" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center justify-between rounded-lg bg-white p-4">
          <Text className="font-sans-bold text-lg text-richBlack">Total</Text>
          <Text className="font-mono text-xl text-brand-green">{formatMoney(total)}</Text>
        </View>

        <View className="flex-row gap-3">
          {(['cash', 'credit'] as const).map((type) => (
            <Pressable
              key={type}
              onPress={() => handlePaymentTypeChange(type)}
              accessibilityRole="button"
              accessibilityState={{ selected: paymentType === type }}
              className={`flex-1 items-center rounded-lg py-3 ${paymentType === type ? 'bg-brand-green' : 'bg-white'}`}
            >
              <Text className={`font-sans-semibold text-base ${paymentType === type ? 'text-white' : 'text-richBlack'}`}>
                {type === 'cash' ? 'Cash' : 'Credit'}
              </Text>
            </Pressable>
          ))}
        </View>

        {paymentType === 'cash' ? (
          <View className="gap-3 rounded-lg bg-white p-4">
            <Text className="font-sans-medium text-sm text-richBlack">Amount tendered (৳)</Text>
            <TextInput
              value={amountTendered}
              onChangeText={setAmountTendered}
              keyboardType="decimal-pad"
              accessibilityLabel="Amount tendered"
              placeholder="0.00"
              className="rounded-lg border border-midGray px-4 py-3 font-mono text-base text-richBlack"
            />
            <View className="flex-row justify-between">
              <Text className="font-sans text-sm text-midGray">Change</Text>
              <Text className="font-mono text-base text-richBlack">
                {displayedChange === undefined ? '—' : formatMoney(displayedChange)}
              </Text>
            </View>
          </View>
        ) : (
          <View className="gap-4 rounded-lg bg-white p-4">
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setIsNewCustomer(false)}
                className={`flex-1 items-center rounded-lg border py-3 ${!isNewCustomer ? 'border-brand-green' : 'border-midGray'}`}
              >
                <Text className="font-sans-medium text-sm text-richBlack">Existing</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setIsNewCustomer(true);
                  setSelectedCustomerId(null);
                }}
                className={`flex-1 items-center rounded-lg border py-3 ${isNewCustomer ? 'border-brand-green' : 'border-midGray'}`}
              >
                <Text className="font-sans-medium text-sm text-richBlack">New customer</Text>
              </Pressable>
            </View>

            {isNewCustomer ? (
              <>
                <TextInput
                  value={newCustomerName}
                  onChangeText={setNewCustomerName}
                  placeholder="Customer name"
                  accessibilityLabel="Customer name"
                  className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
                />
                <TextInput
                  value={newCustomerPhone}
                  onChangeText={setNewCustomerPhone}
                  placeholder="Phone (optional)"
                  keyboardType="phone-pad"
                  accessibilityLabel="Customer phone"
                  className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
                />
              </>
            ) : (
              <>
                <TextInput
                  value={customerQuery}
                  onChangeText={handleCustomerQueryChange}
                  placeholder="Search customer name or phone"
                  accessibilityLabel="Search customers"
                  className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
                />
                {customers.length === 0 ? (
                  <Text className="font-sans text-sm text-midGray">No customers found.</Text>
                ) : (
                  customers.map((customer) => (
                    <Pressable
                      key={customer.id}
                      onPress={() => setSelectedCustomerId(customer.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedCustomerId === customer.id }}
                      className={`rounded-lg border p-3 ${selectedCustomerId === customer.id ? 'border-brand-green' : 'border-midGray'}`}
                    >
                      <Text className="font-sans-medium text-sm text-richBlack">{customer.name}</Text>
                      {customer.phone ? <Text className="font-sans text-xs text-midGray">{customer.phone}</Text> : null}
                    </Pressable>
                  ))
                )}
              </>
            )}
          </View>
        )}

        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
        <Pressable
          onPress={handleConfirm}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Confirm sale"
          className="items-center rounded-lg bg-brand-green py-3.5 active:opacity-80 disabled:opacity-50"
        >
          <Text className="font-sans-semibold text-base text-white">{isSubmitting ? 'Saving…' : 'Confirm sale'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
