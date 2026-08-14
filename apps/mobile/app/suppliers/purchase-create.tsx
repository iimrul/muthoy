import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  purchaseLineItemFieldsSchema,
  type PurchaseLineItemFieldsInput,
  type PurchaseLineItemFieldsOutput,
} from '@muthoy/validation';
import { addPaisa, fromTaka, multiplyPaisa, type Paisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { FormField } from '../../components/forms/FormField';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { BatchExpiryMismatchError, DuplicateBatchError } from '../../db/errors';
import {
  createPurchase,
  searchMedicinesForPurchase,
  type PurchaseMedicineSearchResult,
} from '../../db/purchases';
import { listSuppliers } from '../../db/suppliers';
import type { PurchasePaymentType } from '../../domain/purchases';
import { useSessionStore } from '../../state/sessionStore';
import { triggerSyncNow } from '../../sync';

interface DraftLine {
  medicine: PurchaseMedicineSearchResult;
  fields: PurchaseLineItemFieldsOutput;
}

function lineTotal(line: DraftLine): Paisa {
  return multiplyPaisa(fromTaka(line.fields.purchasePrice), line.fields.quantity);
}

export default function PurchaseCreateScreen() {
  const params = useLocalSearchParams<{ supplierId?: string }>();
  const session = useSessionStore((state) => state.session);
  const [supplierRows, setSupplierRows] = useState<Awaited<ReturnType<typeof listSuppliers>>>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState(params.supplierId ?? '');
  const [paymentType, setPaymentType] = useState<PurchasePaymentType>('cod');
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineResults, setMedicineResults] = useState<PurchaseMedicineSearchResult[]>([]);
  const [selectedMedicine, setSelectedMedicine] = useState<PurchaseMedicineSearchResult | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const medicineRequestId = useRef(0);
  const { control, handleSubmit, reset, setError } = useForm<
    PurchaseLineItemFieldsInput,
    unknown,
    PurchaseLineItemFieldsOutput
  >({
    resolver: zodResolver(purchaseLineItemFieldsSchema),
    defaultValues: { batchNo: '', expiryDate: '', quantity: 1, purchasePrice: 0, salePrice: 0 },
  });

  useEffect(() => {
    if (!session || session.role !== 'owner') {
      return;
    }
    let isCurrent = true;
    listSuppliers(session.shopId, session.userId)
      .then((rows) => {
        if (isCurrent) {
          setSupplierRows(rows);
          setSelectedSupplierId((current) =>
            rows.some((supplier) => supplier.id === current) ? current : rows[0]?.id ?? '',
          );
        }
      })
      .catch((caught: unknown) => {
        if (isCurrent) {
          setErrorMessage(caught instanceof Error ? caught.message : 'Suppliers failed to load.');
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [session]);

  const handleMedicineQueryChange = useCallback((value: string) => {
    setMedicineQuery(value);
    setSelectedMedicine(null);
    const requestId = ++medicineRequestId.current;
    if (!session || session.role !== 'owner' || !value.trim()) {
      setMedicineResults([]);
      return;
    }
    searchMedicinesForPurchase(session.shopId, value)
      .then((rows) => {
        if (requestId === medicineRequestId.current) {
          setMedicineResults(rows);
        }
      })
      .catch(() => {
        if (requestId === medicineRequestId.current) {
          setErrorMessage('Medicine search failed.');
        }
      });
  }, [session]);

  const handleSelectMedicine = useCallback((medicine: PurchaseMedicineSearchResult) => {
    medicineRequestId.current += 1;
    setSelectedMedicine(medicine);
    setMedicineQuery(medicine.name);
    setMedicineResults([]);
    setErrorMessage(null);
  }, []);

  const handleAddLine = useCallback((fields: PurchaseLineItemFieldsOutput) => {
    if (!selectedMedicine) {
      setErrorMessage('Select a medicine first.');
      return;
    }
    setLines((current) => [...current, { medicine: selectedMedicine, fields }]);
    setSelectedMedicine(null);
    setMedicineQuery('');
    setErrorMessage(null);
    reset({ batchNo: '', expiryDate: '', quantity: 1, purchasePrice: 0, salePrice: 0 });
  }, [reset, selectedMedicine]);

  const total = useMemo(() => addPaisa(...lines.map(lineTotal)), [lines]);

  const restoreFailedLine = useCallback((caught: BatchExpiryMismatchError | DuplicateBatchError) => {
    const failedIndex = lines.findIndex((line) =>
      line.medicine.medicineId === caught.medicineId && line.fields.batchNo === caught.batchNo,
    );
    const failedLine = lines[failedIndex];
    if (!failedLine) {
      setErrorMessage(caught.message);
      return;
    }
    setLines((current) => current.filter((_, index) => index !== failedIndex));
    setSelectedMedicine(failedLine.medicine);
    setMedicineQuery(failedLine.medicine.name);
    reset(failedLine.fields);
    setError(caught instanceof BatchExpiryMismatchError ? 'expiryDate' : 'batchNo', { message: caught.message });
  }, [lines, reset, setError]);

  const handleSave = useCallback(async () => {
    if (!session || session.role !== 'owner') {
      return;
    }
    if (!selectedSupplierId) {
      setErrorMessage('Select a supplier.');
      return;
    }
    if (lines.length === 0) {
      setErrorMessage('Add at least one line item.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await createPurchase({
        shopId: session.shopId,
        supplierId: selectedSupplierId,
        staffId: session.userId,
        paymentType,
        lineItems: lines.map((line) => ({
          medicineId: line.medicine.medicineId,
          batchNo: line.fields.batchNo,
          expiryDate: line.fields.expiryDate,
          quantity: line.fields.quantity,
          purchasePrice: fromTaka(line.fields.purchasePrice),
          salePrice: fromTaka(line.fields.salePrice),
        })),
      });
      void triggerSyncNow(session.shopId);
      router.replace({ pathname: '/suppliers/detail', params: { supplierId: selectedSupplierId } });
    } catch (caught) {
      if (caught instanceof BatchExpiryMismatchError || caught instanceof DuplicateBatchError) {
        restoreFailedLine(caught);
      } else {
        setErrorMessage(caught instanceof Error ? caught.message : 'Purchase could not be saved.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [lines, paymentType, restoreFailedLine, selectedSupplierId, session]);

  if (!session || session.role !== 'owner') {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans-semibold text-base text-error">Owner access only.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="New purchase" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        <View className="gap-3 rounded-lg bg-white p-4">
          <Text className="font-sans-bold text-base text-richBlack">Supplier</Text>
          {supplierRows.length === 0 ? (
            <Pressable onPress={() => router.replace('/suppliers/list')}>
              <Text className="font-sans-medium text-brand-green">Create a supplier first</Text>
            </Pressable>
          ) : supplierRows.map((supplier) => (
            <Pressable
              key={supplier.id}
              onPress={() => setSelectedSupplierId(supplier.id)}
              className={`rounded-lg border p-3 ${selectedSupplierId === supplier.id ? 'border-brand-green bg-brand-softGreen' : 'border-midGray'}`}
            >
              <Text className="font-sans-medium text-richBlack">{supplier.name}</Text>
            </Pressable>
          ))}
        </View>

        <View className="flex-row gap-3">
          {(['cod', 'credit'] as const).map((type) => (
            <Pressable
              key={type}
              onPress={() => setPaymentType(type)}
              className={`flex-1 items-center rounded-lg py-3 ${paymentType === type ? 'bg-brand-green' : 'bg-white'}`}
            >
              <Text className={`font-sans-semibold ${paymentType === type ? 'text-white' : 'text-richBlack'}`}>
                {type === 'cod' ? 'COD / cash' : 'Credit'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="gap-4 rounded-lg bg-white p-4">
          <Text className="font-sans-bold text-base text-richBlack">Add line item</Text>
          <TextInput
            value={medicineQuery}
            onChangeText={handleMedicineQueryChange}
            placeholder="Search medicine"
            className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
          />
          {medicineResults.map((medicine) => (
            <Pressable key={medicine.medicineId} onPress={() => handleSelectMedicine(medicine)} className="rounded-lg bg-brand-softGreen p-3">
              <Text className="font-sans-medium text-richBlack">{medicine.name}</Text>
              {medicine.generic ? <Text className="font-sans text-xs text-midGray">{medicine.generic}</Text> : null}
            </Pressable>
          ))}
          {selectedMedicine ? <Text className="font-sans-medium text-brand-green">Selected: {selectedMedicine.name}</Text> : null}
          <FormField control={control} name="batchNo" label="Batch number" />
          <FormField control={control} name="expiryDate" label="Expiry date" placeholder="YYYY-MM-DD" />
          <FormField control={control} name="quantity" label="Quantity" numeric />
          <FormField control={control} name="purchasePrice" label="Purchase price (৳)" numeric money />
          <FormField control={control} name="salePrice" label="Sale price (৳)" numeric money />
          <Pressable onPress={handleSubmit(handleAddLine)} className="items-center rounded-lg border border-brand-green py-3">
            <Text className="font-sans-semibold text-brand-green">Add line</Text>
          </Pressable>
        </View>

        {lines.map((line, index) => (
          <View key={`${line.medicine.medicineId}-${line.fields.batchNo}-${index}`} className="gap-2 rounded-lg bg-white p-4">
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold text-richBlack">{line.medicine.name}</Text>
              <Pressable onPress={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                <Text className="font-sans-medium text-error">Remove</Text>
              </Pressable>
            </View>
            <Text className="font-sans text-sm text-midGray">Batch {line.fields.batchNo} · Exp {line.fields.expiryDate}</Text>
            <View className="flex-row justify-between">
              <Text className="font-sans text-sm text-midGray">Qty {line.fields.quantity}</Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(lineTotal(line))}</Text>
            </View>
          </View>
        ))}

        <View className="flex-row items-center justify-between rounded-lg bg-white p-4">
          <Text className="font-sans-bold text-lg text-richBlack">Total</Text>
          <Text className="font-mono text-xl text-brand-green">{formatMoney(total)}</Text>
        </View>
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
        <Pressable
          onPress={handleSave}
          disabled={isSubmitting}
          className="items-center rounded-lg bg-brand-green py-3.5 disabled:opacity-50"
        >
          <Text className="font-sans-semibold text-white">{isSubmitting ? 'Saving…' : 'Save purchase'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
