import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addMedicineSchema, isoDateSchema, type AddMedicineInput, type AddMedicineOutput } from '@muthoy/validation';
import { fromTaka } from '@muthoy/types';
import { MedicineTextScanner } from '../../components/scanner/MedicineTextScanner';
import { FormField } from '../../components/forms/FormField';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { createMedicineWithBatch } from '../../db/inventory';
import { parseScannedMedicineStrip } from '../../domain/ocrText';
import { captureSessionFor } from '../../state/sessionGuard';
import { usePermission } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

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
  // Volume 0 Day 11: Staff is inventory-VIEW only, so creating a medicine and
  // its first batch is owner-only. Browsing inventory stays open to both.
  const { session, isAllowed } = usePermission('inventory_write');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  const { control, handleSubmit, getValues, setValue } = useForm<AddMedicineInput, unknown, AddMedicineOutput>({
    resolver: zodResolver(addMedicineSchema),
    defaultValues: {
      name: '',
      unitOfMeasure: 'piece',
      requiresPrescription: false,
      threshold: 20,
      firstBatch: { batchNo: '', quantity: 0, purchasePrice: 0, salePrice: 0 },
    },
  });

  // Prefills only fields the user hasn't already typed into, and only after
  // the scanned date passes isoDateSchema — a malformed or past-dated
  // candidate (e.g. OCR mistaking a printed MFG date for EXP) is silently
  // dropped rather than shown as a pre-populated validation error. Every
  // field stays fully editable; Save remains the only commit path (never
  // auto-saves a scanned value — docs/plans/ocr.md).
  const handleScanResult = (recognizedText: string) => {
    const parsed = parseScannedMedicineStrip(recognizedText);
    let prefilledAny = false;

    if (parsed.name && !getValues('name')) {
      setValue('name', parsed.name, { shouldDirty: true });
      prefilledAny = true;
    }
    if (parsed.batchNo && !getValues('firstBatch.batchNo')) {
      setValue('firstBatch.batchNo', parsed.batchNo, { shouldDirty: true });
      prefilledAny = true;
    }
    if (parsed.expiryDate && !getValues('firstBatch.expiryDate')) {
      const checked = isoDateSchema.safeParse(parsed.expiryDate);
      if (checked.success && checked.data) {
        setValue('firstBatch.expiryDate', checked.data, { shouldDirty: true });
        prefilledAny = true;
      }
    }

    setScanNotice(
      prefilledAny ? 'Prefilled from scan — review before saving.' : 'Nothing recognized. Fill in manually.',
    );
  };

  const onSubmit = useCallback(
    async (input: AddMedicineOutput) => {
      if (!session || !isAllowed) {
        return;
      }
      // react-hook-form awaits its resolver before this handler runs, and the
      // write below is a stock mutation stamped with an actor id.
      const guard = captureSessionFor(session);
      if (!guard) {
        return;
      }
      setIsSubmitting(true);
      try {
        await createMedicineWithBatch({
          shopId: session.shopId,
          actorUserId: session.userId,
          isStillActive: guard.isStillActive,
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
        void triggerSyncNow(session.shopId);
        // Navigating back is the outgoing user's continuation; after a
        // handover app/index.tsx's gate owns where the device goes next.
        guard.ifLive(() => router.back());
      } catch {
        guard.ifLive(() => Alert.alert('Something went wrong', 'Please try again.'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [isAllowed, session],
  );

  // Volume 0 Day 11 checklist: a Staff-role login reaching this route
  // directly gets the denial, and db/inventory.ts rejects the write anyway.
  if (!session || !isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Add medicine" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-5 p-6" keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => setIsScannerVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Scan medicine strip to prefill"
          className="flex-row items-center justify-center gap-2 rounded-lg border border-brand-green bg-white py-3 active:opacity-80"
        >
          <Text className="text-lg">📷</Text>
          <Text className="font-sans-semibold text-sm text-brand-green">Scan strip to prefill</Text>
        </Pressable>
        {scanNotice ? <Text className="font-sans text-sm text-midGray">{scanNotice}</Text> : null}

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
      <MedicineTextScanner
        visible={isScannerVisible}
        mode="prefill"
        onClose={() => setIsScannerVisible(false)}
        onTextRecognized={handleScanResult}
      />
    </View>
  );
}
