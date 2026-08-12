import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addMedicineSchema, type AddMedicineInput, type AddMedicineOutput } from '@muthoy/validation';
import { fromTaka } from '@muthoy/types';
import { FormField } from '../../components/forms/FormField';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { createMedicineWithBatch } from '../../db/inventory';
import { useSessionStore } from '../../state/sessionStore';

// Add Medicine — Volume 4 INVENTORY, Volume 0 Day 8. React Hook Form + Zod
// (addMedicineSchema, packages/validation): name, generic, manufacturer,
// strength, category, unit_of_measure, requires_prescription, threshold,
// barcode, plus the first batch (batch_no, expiry, qty, purchase/sale price).
//
// This screen's first batch can NEVER collide with the
// UNIQUE(shop_id, medicine_id, batch_no) constraint — createMedicineWithBatch
// always generates a fresh medicineId, so there is no existing row to
// duplicate against. The friendly duplicate-batch error lives on Add Batch
// (app/inventory/batches.tsx), the path that adds a batch to a medicine that
// already exists.
export default function AddMedicineScreen() {
  const session = useSessionStore((s) => s.session);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { control, handleSubmit } = useForm<AddMedicineInput, unknown, AddMedicineOutput>({
    resolver: zodResolver(addMedicineSchema),
    defaultValues: {
      name: '',
      unitOfMeasure: 'piece',
      requiresPrescription: false,
      threshold: 20,
      firstBatch: { batchNo: '', quantity: 0, purchasePrice: 0, salePrice: 0 },
    },
  });

  const onSubmit = useCallback(
    async (input: AddMedicineOutput) => {
      if (!session) {
        return;
      }
      setIsSubmitting(true);
      try {
        await createMedicineWithBatch({
          shopId: session.shopId,
          name: input.name,
          generic: input.generic,
          manufacturer: input.manufacturer,
          strength: input.strength,
          category: input.category,
          unitOfMeasure: input.unitOfMeasure,
          requiresPrescription: input.requiresPrescription,
          threshold: input.threshold,
          barcode: input.barcode,
          firstBatch: {
            batchNo: input.firstBatch.batchNo,
            expiryDate: input.firstBatch.expiryDate,
            quantity: input.firstBatch.quantity,
            purchasePrice: fromTaka(input.firstBatch.purchasePrice),
            salePrice: fromTaka(input.firstBatch.salePrice),
          },
        });
        router.back();
      } catch {
        Alert.alert('Something went wrong', 'Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [session],
  );

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Add medicine" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-5 p-6" keyboardShouldPersistTaps="handled">
        <FormField control={control} name="name" label="Medicine name" placeholder="e.g. Napa Extra" />
        <FormField control={control} name="generic" label="Generic name" placeholder="e.g. Paracetamol" />
        <FormField control={control} name="manufacturer" label="Manufacturer" placeholder="e.g. Beximco" />
        <FormField control={control} name="strength" label="Strength" placeholder="e.g. 500mg" />
        <FormField control={control} name="category" label="Category" placeholder="e.g. Analgesic" />
        <FormField control={control} name="unitOfMeasure" label="Unit of measure" placeholder="piece" />
        <FormField control={control} name="barcode" label="Barcode" placeholder="Optional" />
        <FormField control={control} name="threshold" label="Low-stock threshold" numeric />

        <View className="flex-row items-center justify-between rounded-lg bg-white px-4 py-3">
          <Text className="font-sans-medium text-sm text-richBlack">Requires prescription</Text>
          <Controller
            control={control}
            name="requiresPrescription"
            render={({ field: { value, onChange } }) => (
              <Switch value={value} onValueChange={onChange} accessibilityLabel="Requires prescription" />
            )}
          />
        </View>

        <View className="gap-4 rounded-lg bg-white p-4">
          <Text className="font-sans-bold text-base text-richBlack">First batch</Text>
          <FormField control={control} name="firstBatch.batchNo" label="Batch number" placeholder="e.g. B-2024-01" />
          <FormField control={control} name="firstBatch.expiryDate" label="Expiry date" placeholder="YYYY-MM-DD" />
          <FormField control={control} name="firstBatch.quantity" label="Quantity" numeric />
          <FormField control={control} name="firstBatch.purchasePrice" label="Purchase price (৳)" numeric />
          <FormField control={control} name="firstBatch.salePrice" label="Sale price (৳)" numeric />
        </View>

        <Pressable
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
          accessibilityRole="button"
          accessibilityLabel="Save medicine"
          className="items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">{isSubmitting ? 'Saving…' : 'Save medicine'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
