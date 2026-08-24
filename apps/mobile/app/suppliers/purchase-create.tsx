import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  purchaseLineItemFieldsSchema,
  type PurchaseLineItemFieldsInput,
  type PurchaseLineItemFieldsOutput,
} from '@muthoy/validation';
import { addPaisa, fromTaka, multiplyPaisa, ZERO_PAISA, type Paisa } from '@muthoy/types';
import { dhakaBusinessDate, formatMoney } from '@muthoy/utils';
import { FormField } from '../../components/forms/FormField';
import { MedicineTextScanner } from '../../components/scanner/MedicineTextScanner';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { parseScannedInvoiceLines, type ScannedInvoiceLineCandidate } from '../../domain/ocrText';
import { fuzzyMatchMedicines } from '../../domain/medicineMatch';
import { isValidInvoiceDate } from '../../domain/invoice';
import { BatchExpiryMismatchError, DuplicateBatchError } from '../../db/errors';
import {
  createPurchase,
  findDuplicatePurchase,
  searchMedicinesForPurchase,
  type DuplicatePurchaseMatch,
  type PurchaseMedicineSearchResult,
} from '../../db/purchases';
import { createMedicineOnly, listMedicines } from '../../db/inventory';
import { listSuppliers } from '../../db/suppliers';
import type { PurchasePaymentType } from '../../domain/purchases';
import { captureSessionFor } from '../../state/sessionGuard';
import { useI18n } from '../../state/localeStore';
import type { CatalogKey } from '../../i18n/catalog';
import { countLabel, userFacingError } from '../../i18n/display';
import { useOwnerAccess } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

// screens/SupplierInvoiceCreate.tsx parity (plan §1.12, review-corrected):
// a real 3-step stepper (Method -> Review -> Confirm) with multi-line OCR,
// deterministic per-line confidence, fuzzy-match picker, and Add-as-New —
// replacing the prior single-screen flat form.
//   - Editable invoice date (purely descriptive — never passed to
//     assertBusinessDateOpen or any ledger/movement write; those always use
//     the actual dhakaBusinessDate() at transaction time, unconditionally).
//   - IC-3/IC-6: real on-device OCR (native/scanner.ts + domain/ocrText.ts,
//     already shipped for Add Medicine), now multi-line via
//     parseScannedInvoiceLines, each candidate carrying a deterministic
//     confidence score — never an ML guess.
//   - Fuzzy match picker (domain/medicineMatch.ts) + "Add as New Medicine"
//     (db/inventory.ts's createMedicineOnly — deliberately medicine-only, so
//     the purchase line's own addStock is the sole source of the batch/stock,
//     never double-counted).
//   - IC-11: a "Pending (received later)" toggle per line.
//   - IC-16: advisory duplicate-invoice detection with an explicit
//     acknowledgement gate, checked on Confirm.
//   - IC-18: COD / Credit payment terms, chosen on the Confirm step.
//   - After create: navigates to Invoice Detail (not Supplier Detail).

type Step = 'method' | 'review' | 'confirm';

interface DraftLine {
  medicine: PurchaseMedicineSearchResult;
  fields: PurchaseLineItemFieldsOutput;
  pending: boolean;
}

interface CatalogMedicine {
  medicineId: string;
  name: string;
}

interface ScannedCandidate extends ScannedInvoiceLineCandidate {
  candidateId: string;
}

function lineTotal(line: DraftLine): Paisa {
  return line.pending ? ZERO_PAISA : multiplyPaisa(fromTaka(line.fields.purchasePrice), line.fields.quantity);
}

let candidateSeq = 0;
function nextCandidateId(): string {
  candidateSeq += 1;
  return `candidate-${candidateSeq}`;
}

function StepCircle({ index, label, active, done, formatNumber }: { index: number; label: string; active: boolean; done: boolean; formatNumber: (value: number) => string }) {
  return (
    <View className="items-center gap-1">
      <View
        className={`h-7 w-7 items-center justify-center rounded-full ${
          active || done ? 'bg-brand-green' : 'bg-midGray/20'
        }`}
      >
        <Text className={`font-sans-bold text-xs ${active || done ? 'text-white' : 'text-midGray'}`}>{formatNumber(index)}</Text>
      </View>
      <Text className={`font-sans-medium text-xs ${active ? 'text-brand-green' : 'text-midGray'}`}>{label}</Text>
    </View>
  );
}

function Stepper({ step, t, formatNumber }: { step: Step; t: (key: CatalogKey) => string; formatNumber: (value: number) => string }) {
  const order: Step[] = ['method', 'review', 'confirm'];
  const currentIndex = order.indexOf(step);
  const labels: Record<Step, string> = {
    method: t('stepMethodLabel'),
    review: t('stepReviewLabel'),
    confirm: t('stepConfirmLabel'),
  };
  return (
    <View className="flex-row items-start px-2">
      {order.map((entry, index) => (
        <View key={entry} className="flex-1 flex-row items-center">
          <StepCircle index={index + 1} label={labels[entry]} active={index === currentIndex} done={index < currentIndex} formatNumber={formatNumber} />
          {index < order.length - 1 ? (
            <View className={`mx-1 h-1 flex-1 rounded-full ${index < currentIndex ? 'bg-brand-green' : 'bg-midGray/20'}`} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

export default function PurchaseCreateScreen() {
  const params = useLocalSearchParams<{ supplierId?: string }>();
  const { t, formatNumber, formatDate, formatPercent } = useI18n();
  const { session, isAllowed } = useOwnerAccess();
  const [step, setStep] = useState<Step>('method');
  const [source, setSource] = useState<'manual' | 'ocr'>('manual');
  const [invoiceDateText, setInvoiceDateText] = useState(() => dhakaBusinessDate(new Date()));
  const [supplierRows, setSupplierRows] = useState<Awaited<ReturnType<typeof listSuppliers>>>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState(params.supplierId ?? '');
  const [paymentType, setPaymentType] = useState<PurchasePaymentType>('credit');
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineResults, setMedicineResults] = useState<PurchaseMedicineSearchResult[]>([]);
  const [selectedMedicine, setSelectedMedicine] = useState<PurchaseMedicineSearchResult | null>(null);
  const [isPendingLine, setIsPendingLine] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicatePurchaseMatch | null>(null);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [catalog, setCatalog] = useState<CatalogMedicine[]>([]);
  const [scannedCandidates, setScannedCandidates] = useState<ScannedCandidate[]>([]);
  const [addNewCandidateId, setAddNewCandidateId] = useState<string | null>(null);
  const [newMedicineName, setNewMedicineName] = useState('');
  const [isCreatingMedicine, setIsCreatingMedicine] = useState(false);
  const medicineRequestId = useRef(0);
  const { control, handleSubmit, reset, setError, setValue } = useForm<
    PurchaseLineItemFieldsInput,
    unknown,
    PurchaseLineItemFieldsOutput
  >({
    resolver: zodResolver(purchaseLineItemFieldsSchema),
    defaultValues: { batchNo: '', expiryDate: '', quantity: 1, purchasePrice: 0, salePrice: 0 },
  });

  useEffect(() => {
    if (!session || !isAllowed) {
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
          setErrorMessage(userFacingError(caught, 'suppliersLoadFailedLabel', t));
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [isAllowed, session, t]);

  // Loaded once, lazily, the first time OCR match-picking is actually needed
  // — fuzzy matching runs client-side against this list.
  const ensureCatalogLoaded = useCallback(async () => {
    if (!session || !isAllowed || catalog.length > 0) {
      return;
    }
    try {
      const rows = await listMedicines(session.shopId);
      setCatalog(rows.map((row) => ({ medicineId: row.medicineId, name: row.name })));
    } catch {
      // Fuzzy matching is an assist, not a requirement — search still works.
    }
  }, [catalog.length, isAllowed, session]);

  const handleMedicineQueryChange = useCallback((value: string) => {
    setMedicineQuery(value);
    setSelectedMedicine(null);
    const requestId = ++medicineRequestId.current;
    if (!session || !isAllowed || !value.trim()) {
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
          setErrorMessage(t('medicineSearchFailedLabel'));
        }
      });
  }, [isAllowed, session, t]);

  const handleSelectMedicine = useCallback((medicine: PurchaseMedicineSearchResult) => {
    medicineRequestId.current += 1;
    setSelectedMedicine(medicine);
    setMedicineQuery(medicine.name);
    setMedicineResults([]);
    setErrorMessage(null);
  }, []);

  // IC-3/IC-6: capture an invoice photo, run it through the SAME OCR pipeline
  // Add Medicine already uses (native/scanner.ts's ML Kit text recognition +
  // domain/ocrText.ts's label-anchored extractors) — never a fixture/mock.
  // parseScannedInvoiceLines degrades to one candidate for a single-strip
  // capture, so this one handler covers both the Method step's whole-invoice
  // scan and the Review step's "scan another line" re-capture. Never
  // auto-commits: candidates only populate the review queue below.
  const handleScanResult = useCallback(async (recognizedText: string) => {
    void ensureCatalogLoaded();
    const candidates = parseScannedInvoiceLines(recognizedText).map((candidate) => ({
      ...candidate,
      candidateId: nextCandidateId(),
    }));
    if (candidates.length === 0) {
      setErrorMessage(t('couldNotReadLinesLabel'));
      return;
    }
    setScannedCandidates((current) => [...current, ...candidates]);
  }, [ensureCatalogLoaded, t]);

  const handleUseCandidateMatch = useCallback((candidate: ScannedCandidate, medicine: CatalogMedicine) => {
    setSelectedMedicine({ medicineId: medicine.medicineId, name: medicine.name, generic: null });
    setMedicineQuery(medicine.name);
    setMedicineResults([]);
    if (candidate.batchNo) setValue('batchNo', candidate.batchNo);
    if (candidate.expiryDate) setValue('expiryDate', candidate.expiryDate);
    setScannedCandidates((current) => current.filter((entry) => entry.candidateId !== candidate.candidateId));
    setAddNewCandidateId(null);
  }, [setValue]);

  const handleDismissCandidate = useCallback((candidateId: string) => {
    setScannedCandidates((current) => current.filter((entry) => entry.candidateId !== candidateId));
    if (addNewCandidateId === candidateId) setAddNewCandidateId(null);
  }, [addNewCandidateId]);

  const handleCreateMedicineForCandidate = useCallback(async (candidate: ScannedCandidate) => {
    if (!session || !isAllowed || !newMedicineName.trim()) {
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) return;
    setIsCreatingMedicine(true);
    try {
      const { medicineId } = await createMedicineOnly({
        shopId: session.shopId, actorUserId: session.userId, isStillActive: guard.isStillActive,
        name: newMedicineName.trim(),
      });
      if (guard.isStale()) return;
      setCatalog((current) => [...current, { medicineId, name: newMedicineName.trim() }]);
      handleUseCandidateMatch(candidate, { medicineId, name: newMedicineName.trim() });
      setNewMedicineName('');
    } catch (caught) {
      if (!guard.isStale()) setErrorMessage(userFacingError(caught, 'medicineCreateFailedLabel', t));
    } finally {
      setIsCreatingMedicine(false);
    }
  }, [handleUseCandidateMatch, isAllowed, newMedicineName, session, t]);

  const handleAddLine = useCallback((fields: PurchaseLineItemFieldsOutput) => {
    if (!selectedMedicine) {
      setErrorMessage(t('selectMedicineFirstLabel'));
      return;
    }
    setLines((current) => [...current, { medicine: selectedMedicine, fields, pending: isPendingLine }]);
    setSelectedMedicine(null);
    setMedicineQuery('');
    setIsPendingLine(false);
    setErrorMessage(null);
    reset({ batchNo: '', expiryDate: '', quantity: 1, purchasePrice: 0, salePrice: 0 });
  }, [isPendingLine, reset, selectedMedicine, t]);

  const total = useMemo(() => addPaisa(...lines.map(lineTotal)), [lines]);
  const pendingCount = useMemo(() => lines.filter((line) => line.pending).length, [lines]);

  const restoreFailedLine = useCallback((caught: BatchExpiryMismatchError | DuplicateBatchError) => {
    const failedIndex = lines.findIndex((line) =>
      line.medicine.medicineId === caught.medicineId && line.fields.batchNo === caught.batchNo,
    );
    const failedLine = lines[failedIndex];
    if (!failedLine) {
      setErrorMessage(userFacingError(caught, 'purchaseSaveFailedLabel', t));
      return;
    }
    setLines((current) => current.filter((_, index) => index !== failedIndex));
    setSelectedMedicine(failedLine.medicine);
    setMedicineQuery(failedLine.medicine.name);
    reset(failedLine.fields);
    setError(caught instanceof BatchExpiryMismatchError ? 'expiryDate' : 'batchNo', {
      message: userFacingError(caught, 'purchaseSaveFailedLabel', t),
    });
    setStep('review');
  }, [lines, reset, setError, t]);

  const submitPurchase = useCallback(async () => {
    if (!session || !isAllowed) {
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await createPurchase({
        shopId: session.shopId,
        supplierId: selectedSupplierId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        paymentType,
        invoiceDate: invoiceDateText.trim() || undefined,
        source,
        lineItems: lines.map((line) => ({
          medicineId: line.medicine.medicineId,
          batchNo: line.fields.batchNo,
          expiryDate: line.fields.expiryDate,
          quantity: line.fields.quantity,
          purchasePrice: fromTaka(line.fields.purchasePrice),
          salePrice: fromTaka(line.fields.salePrice),
          pending: line.pending,
        })),
      });
      void triggerSyncNow(session.shopId);
      if (guard.isStale()) {
        return;
      }
      router.replace({ pathname: '/suppliers/invoice-detail', params: { purchaseId: result.purchaseId } });
    } catch (caught) {
      if (guard.isStale()) {
        return;
      }
      if (caught instanceof BatchExpiryMismatchError || caught instanceof DuplicateBatchError) {
        restoreFailedLine(caught);
      } else {
        setErrorMessage(userFacingError(caught, 'purchaseSaveFailedLabel', t));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [invoiceDateText, isAllowed, lines, paymentType, restoreFailedLine, selectedSupplierId, session, source, t]);

  const handleConfirm = useCallback(async () => {
    if (!session || !isAllowed) {
      return;
    }
    // IC-16: advisory duplicate check runs once per attempt; a matched,
    // unacknowledged duplicate blocks Confirm and shows the warning instead.
    try {
      if (!duplicateAcknowledged) {
        const businessDate = dhakaBusinessDate(new Date());
        const match = await findDuplicatePurchase(session.shopId, session.userId, selectedSupplierId, businessDate, total);
        if (match) {
          setDuplicateMatch(match);
          return;
        }
      }
      await submitPurchase();
    } catch (caught) {
      setErrorMessage(userFacingError(caught, 'purchaseSaveFailedLabel', t));
    }
  }, [duplicateAcknowledged, isAllowed, selectedSupplierId, session, submitPurchase, t, total]);

  const handleContinueToConfirm = useCallback(() => {
    if (!selectedSupplierId) {
      setErrorMessage(t('selectSupplierLabel'));
      return;
    }
    if (lines.length === 0) {
      setErrorMessage(t('addLineItemFirstLabel'));
      return;
    }
    if (!isValidInvoiceDate(invoiceDateText.trim())) {
      setErrorMessage(t('invalidDateLabel'));
      return;
    }
    setErrorMessage(null);
    setStep('confirm');
  }, [invoiceDateText, lines.length, selectedSupplierId, t]);

  if (!session || !isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t('newPurchaseLabel')} onBackPress={() => (step === 'method' ? router.back() : setStep((current) => (current === 'confirm' ? 'review' : 'method')))} />
      <View className="bg-brand-softGreen px-4 pb-3 pt-1">
        <Stepper step={step} t={t} formatNumber={formatNumber} />
      </View>

      {step === 'method' ? (
        <ScrollView contentContainerClassName="gap-4 p-4">
          <Pressable
            onPress={() => { setSource('ocr'); setStep('review'); setIsScannerOpen(true); void ensureCatalogLoaded(); }}
            className="flex-row items-center gap-4 rounded-3xl bg-white p-5"
          >
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-brand-softGreen">
              <Text className="text-2xl">📷</Text>
            </View>
            <View className="flex-1 gap-1">
              <Text className="font-sans-bold text-base text-richBlack">{t('scanInvoiceTitle')}</Text>
              <Text className="font-sans text-xs text-midGray">{t('scanInvoiceDesc')}</Text>
            </View>
            <Text className="font-sans text-lg text-midGray">›</Text>
          </Pressable>
          <Pressable
            onPress={() => { setSource('manual'); setStep('review'); }}
            className="flex-row items-center gap-4 rounded-3xl bg-white p-5"
          >
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-brand-softGreen">
              <Text className="text-2xl">✎</Text>
            </View>
            <View className="flex-1 gap-1">
              <Text className="font-sans-bold text-base text-richBlack">{t('manualEntryTitle')}</Text>
              <Text className="font-sans text-xs text-midGray">{t('manualEntryDesc')}</Text>
            </View>
            <Text className="font-sans text-lg text-midGray">›</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {step === 'review' ? (
        <>
          <ScrollView contentContainerClassName="gap-4 p-4 pb-32" keyboardShouldPersistTaps="handled">
            <View className="gap-3 rounded-lg bg-white p-4">
              <Text className="font-sans-bold text-base text-richBlack">{t('supplierLabel')}</Text>
              {supplierRows.length === 0 ? (
                <Pressable onPress={() => router.replace('/suppliers/list')}>
                  <Text className="font-sans-medium text-brand-green">{t('createSupplierFirst')}</Text>
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
              <Text className="font-sans-medium text-sm text-richBlack">{t('invoiceDateLabel')}</Text>
              <TextInput
                value={invoiceDateText}
                onChangeText={setInvoiceDateText}
                placeholder="YYYY-MM-DD"
                accessibilityLabel="Invoice date"
                className="rounded-lg border border-midGray px-4 py-3 font-mono text-base text-richBlack"
              />
              <Text className="font-sans text-xs text-midGray">{t('invoiceDateHint')}</Text>
            </View>

            {scannedCandidates.length > 0 ? (
              <View className="gap-3">
                <Text className="font-sans-bold text-base text-richBlack">{t('scannedLinesToReview')} ({formatNumber(scannedCandidates.length)})</Text>
                {scannedCandidates.map((candidate) => {
                  const matches = fuzzyMatchMedicines(candidate.name ?? candidate.rawText, catalog);
                  const isAddingNew = addNewCandidateId === candidate.candidateId;
                  return (
                    <View key={candidate.candidateId} className="gap-2 rounded-2xl bg-white p-4">
                      <View className="flex-row items-center justify-between">
                        <Text className="font-sans-semibold text-richBlack">{candidate.name ?? t('unrecognizedLine')}</Text>
                        <View className="rounded-full bg-brand-softGreen px-2 py-0.5">
                          <Text className="font-sans-semibold text-xs text-brand-green">{formatPercent(candidate.confidence / 100)} {t('percentReadLabel')}</Text>
                        </View>
                      </View>
                      <Text className="font-sans text-xs text-midGray">
                        {candidate.batchNo ? `${t('batchPrefixLabel')} ${candidate.batchNo}` : t('noBatchReadLabel')} · {candidate.expiryDate ? formatDate(`${candidate.expiryDate}T12:00:00`) : t('noExpiryReadLabel')}
                      </Text>
                      {matches.length > 0 ? (
                        <View className="gap-1.5">
                          <Text className="font-sans-medium text-xs text-midGray">{t('matchExistingMedicine')}</Text>
                          {matches.map((match) => (
                            <Pressable
                              key={match.medicine.medicineId}
                              onPress={() => handleUseCandidateMatch(candidate, match.medicine)}
                              className="flex-row items-center justify-between rounded-xl border border-brand-green/40 px-3 py-2"
                            >
                              <Text className="font-sans-medium text-sm text-richBlack">{match.medicine.name}</Text>
                              <Text className="font-mono text-xs text-brand-green">{formatPercent(match.score / 100)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <Text className="font-sans text-xs text-midGray">{t('noCloseMatch')}</Text>
                      )}
                      {isAddingNew ? (
                        <View className="gap-2 rounded-xl bg-brand-softGreen/60 p-3">
                          <TextInput
                            value={newMedicineName}
                            onChangeText={setNewMedicineName}
                            placeholder={t('newMedicineNamePlaceholder')}
                            className="rounded-lg border border-midGray bg-white px-3 py-2 font-sans text-sm text-richBlack"
                          />
                          <Pressable
                            onPress={() => void handleCreateMedicineForCandidate(candidate)}
                            disabled={isCreatingMedicine || !newMedicineName.trim()}
                            className="items-center rounded-lg bg-brand-green py-2 disabled:opacity-50"
                          >
                            <Text className="font-sans-semibold text-white">{isCreatingMedicine ? t('creatingLabel') : t('createAndUseLabel')}</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <View className="flex-row gap-2">
                          <Pressable
                            onPress={() => { setAddNewCandidateId(candidate.candidateId); setNewMedicineName(candidate.name ?? ''); }}
                            className="flex-1 items-center rounded-lg border border-brand-green py-2"
                          >
                            <Text className="font-sans-semibold text-xs text-brand-green">{t('addAsNewMedicine')}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleDismissCandidate(candidate.candidateId)}
                            className="flex-1 items-center rounded-lg border border-midGray py-2"
                          >
                            <Text className="font-sans-semibold text-xs text-midGray">{t('dismissLabel')}</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View className="gap-4 rounded-lg bg-white p-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans-bold text-base text-richBlack">{t('addLineItemLabel')}</Text>
                <Pressable
                  onPress={() => setIsScannerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Scan another line"
                  className="rounded-full border border-brand-green px-3 py-1.5"
                >
                  <Text className="font-sans-semibold text-xs text-brand-green">📷 {t('scanLabel')}</Text>
                </Pressable>
              </View>
              <TextInput
                value={medicineQuery}
                onChangeText={handleMedicineQueryChange}
                placeholder={t('searchMedicineLabel')}
                className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
              />
              {medicineResults.map((medicine) => (
                <Pressable key={medicine.medicineId} onPress={() => handleSelectMedicine(medicine)} className="rounded-lg bg-brand-softGreen p-3">
                  <Text className="font-sans-medium text-richBlack">{medicine.name}</Text>
                  {medicine.generic ? <Text className="font-sans text-xs text-midGray">{medicine.generic}</Text> : null}
                </Pressable>
              ))}
              {selectedMedicine ? <Text className="font-sans-medium text-brand-green">{t('selectedLabel')}: {selectedMedicine.name}</Text> : null}
              <FormField control={control} name="batchNo" label={t('batchNumberLabel')} />
              <FormField control={control} name="expiryDate" label={t('expiryDateLabel')} placeholder="YYYY-MM-DD" />
              <FormField control={control} name="quantity" label={t('quantityLabel')} numeric />
              <FormField control={control} name="purchasePrice" label={t('purchasePriceLabel')} numeric money />
              <FormField control={control} name="salePrice" label={t('salePriceLabel')} numeric money />

              <View className="flex-row items-center justify-between rounded-lg bg-brand-softGreen/60 px-3 py-2.5">
                <Text className="font-sans-medium text-sm text-richBlack">{t('pendingReceiveLaterLabel')}</Text>
                <Switch value={isPendingLine} onValueChange={setIsPendingLine} />
              </View>

              <Pressable onPress={handleSubmit(handleAddLine)} className="items-center rounded-lg border border-brand-green py-3">
                <Text className="font-sans-semibold text-brand-green">{t('addLineLabel')}</Text>
              </Pressable>
            </View>

            {lines.map((line, index) => (
              <View key={`${line.medicine.medicineId}-${line.fields.batchNo}-${index}`} className="gap-2 rounded-lg bg-white p-4">
                <View className="flex-row justify-between">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-sans-semibold text-richBlack">{line.medicine.name}</Text>
                    {line.pending ? (
                      <View className="rounded-full bg-amber-100 px-2 py-0.5">
                        <Text className="font-sans-semibold text-xs text-amber-700">{t('pendingStatusLabel')}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Pressable onPress={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <Text className="font-sans-medium text-error">{t('removeLabel')}</Text>
                  </Pressable>
                </View>
                <Text className="font-sans text-sm text-midGray">{t('batchPrefixLabel')} {line.fields.batchNo} · {t('expPrefixLabel')} {formatDate(`${line.fields.expiryDate}T12:00:00`)}</Text>
                <View className="flex-row justify-between">
                  <Text className="font-sans text-sm text-midGray">{t('qtyPrefixLabel')} {formatNumber(line.fields.quantity)}</Text>
                  <Text className="font-mono text-base text-richBlack">{line.pending ? '—' : formatMoney(lineTotal(line))}</Text>
                </View>
              </View>
            ))}
            {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
          </ScrollView>

          <View className="absolute bottom-0 left-0 right-0 gap-2 rounded-t-3xl bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs text-midGray">
                {formatNumber(lines.length)} {countLabel(lines.length, 'itemCountLabel', 'itemsCountLabel', t)}{pendingCount > 0 ? ` · ⏳ ${formatNumber(pendingCount)} ${t('pendingCountLabel')}` : ''}
                {scannedCandidates.length > 0 ? ` · ⚠ ${formatNumber(scannedCandidates.length)} ${countLabel(scannedCandidates.length, 'unresolvedScanLabel', 'unresolvedScansLabel', t)}` : ''}
              </Text>
              <Text className="font-mono text-lg text-brand-green">{formatMoney(total)}</Text>
            </View>
            <Pressable
              onPress={handleContinueToConfirm}
              className="items-center rounded-lg bg-brand-green py-3.5"
            >
              <Text className="font-sans-semibold text-white">{t('continueLabel')}</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {step === 'confirm' ? (
        <>
          <ScrollView contentContainerClassName="gap-4 p-4 pb-40">
            <View className="gap-2 rounded-2xl bg-white p-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans text-sm text-midGray">{t('supplierLabel')}</Text>
                <Text className="font-sans-medium text-sm text-richBlack">{supplierRows.find((s) => s.id === selectedSupplierId)?.name ?? '—'}</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="font-sans text-sm text-midGray">{t('invoiceDateLabel')}</Text>
                <Text className="font-mono text-sm text-richBlack">{invoiceDateText ? formatDate(`${invoiceDateText}T12:00:00`) : '—'}</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="font-sans text-sm text-midGray">{t('itemsLabel')}</Text>
                <Text className="font-mono text-sm text-richBlack">
                  {formatNumber(lines.length)} {countLabel(lines.length, 'itemCountLabel', 'itemsCountLabel', t)}
                  {pendingCount > 0 ? ` (${formatNumber(pendingCount)} ${t('pendingCountLabel')})` : ''}
                </Text>
              </View>
              <View className="flex-row items-center justify-between border-t border-midGray/20 pt-2">
                <Text className="font-sans-medium text-sm text-richBlack">{t('totalLabel')}</Text>
                <Text className="font-mono text-lg text-brand-green">{formatMoney(total)}</Text>
              </View>
            </View>

            <View className="gap-2">
              <Text className="font-sans-bold text-base text-richBlack">{t('paymentTermsLabel')}</Text>
              <View className="flex-row gap-3">
                {(['cod', 'credit'] as const).map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setPaymentType(type)}
                    className={`flex-1 items-center rounded-lg border py-3 ${paymentType === type ? 'border-brand-green bg-brand-green' : 'border-midGray bg-white'}`}
                  >
                    <Text className={`font-sans-semibold ${paymentType === type ? 'text-white' : 'text-richBlack'}`}>
                      {type === 'cod' ? t('codLabel') : t('onCreditLabel')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {duplicateMatch ? (
              <View className="gap-3 rounded-lg bg-amber-50 p-4">
                <Text className="font-sans-semibold text-amber-800">{t('possibleDuplicateInvoice')}</Text>
                <Text className="font-sans text-sm text-amber-800">
                  {duplicateMatch.invoiceNo} · {formatMoney(duplicateMatch.total)}
                </Text>
                <Text className="font-sans text-sm text-amber-800">{t('duplicateWasRecordedToday')}</Text>
                <Pressable
                  onPress={() => setDuplicateAcknowledged((current) => !current)}
                  className="flex-row items-center gap-2"
                >
                  <View className={`h-5 w-5 items-center justify-center rounded border ${duplicateAcknowledged ? 'border-brand-green bg-brand-green' : 'border-amber-800'}`}>
                    {duplicateAcknowledged ? <Text className="text-xs text-white">✓</Text> : null}
                  </View>
                  <Text className="font-sans text-sm text-amber-800">{t('iVerifiedSaveAnyway')}</Text>
                </Pressable>
              </View>
            ) : null}
            {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
          </ScrollView>

          <View className="absolute bottom-0 left-0 right-0 gap-2 rounded-t-3xl bg-white p-4">
            <Pressable
              onPress={() => void handleConfirm()}
              disabled={isSubmitting || (duplicateMatch !== null && !duplicateAcknowledged)}
              className="flex-row items-center justify-center gap-2 rounded-lg bg-brand-green py-4 disabled:opacity-50"
            >
              <Text className="font-sans-bold text-white">{isSubmitting ? t('confirmingLabel') : `✓ ${t('confirmInvoiceLabel')}`}</Text>
            </Pressable>
            <Text className="text-center font-sans text-xs text-midGray">{t('stockUpdateHint')}</Text>
          </View>
        </>
      ) : null}

      <MedicineTextScanner
        visible={isScannerOpen}
        mode="prefill"
        onClose={() => setIsScannerOpen(false)}
        onTextRecognized={(text) => void handleScanResult(text)}
      />
    </View>
  );
}
