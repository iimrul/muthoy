import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  addMedicineSchema,
  isoDateSchema,
  supplierFieldsSchema,
  type AddMedicineInput,
  type AddMedicineOutput,
} from "@muthoy/validation";
import { fromTaka } from "@muthoy/types";
import type { PurchasePaymentType } from "../../domain/purchases";
import { MedicineTextScanner } from "../scanner/MedicineTextScanner";
import { FormField } from "../forms/FormField";
import {
  addBatchWithPurchase,
  getMedicine,
  searchRestockMedicines,
  type MedicineDetail,
  createMedicineWithPurchase,
  listManufacturerSuggestions,
} from "../../db/inventory";
import {
  createSupplier,
  listSupplierPickerOptions,
} from "../../db/suppliers";
import { parseScannedMedicineStrip } from "../../domain/ocrText";
import type { MedicinePrefill } from "../../domain/catalogPrefill";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import { localizeValidationMessage, userFacingError } from "../../i18n/display";
import { ManufacturerPicker } from "./ManufacturerPicker";
import type { Session } from "../../state/sessionStore";
import { triggerSyncNow } from "../../sync";
import { ExistingMedicinePicker } from "./ExistingMedicinePicker";
import { SupplierPickerField } from "./SupplierPickerField";

interface ManualEntryFormProps {
  session: Session;
  onSaved: () => void;
  initialMedicine?: MedicinePrefill | null;
  scanRequest?: number;
  existingMedicineId?: string;
}

// Manual Entry — the prototype-parity field set (Volume 0 Day 8's identity
// fields, plus Supplier + Payment Method now that Add Medicine's first batch
// is a real supplier purchase, per the founder's Sales+Inventory recovery
// decision), while Requires-prescription remains explicit because silently
// defaulting every new medicine to false suppresses the production checkout
// warning.
//
// W2-02 adds Strength, Dosage form and Unit, which the recovery had left out:
// the medicine catalogue prefills exactly those three, and a prefilled value
// the user can neither see nor correct must never reach the database. Category
// and barcode are still out of scope — nothing prefills them.
export function ManualEntryForm({
  session,
  onSaved,
  initialMedicine,
  scanRequest = 0,
  existingMedicineId,
}: ManualEntryFormProps) {
  const { t } = useI18n();
  const submitLock = useRef(false);
  const validationLock = useRef(false);
  const selectionRequest = useRef(0);
  const selectionPending = useRef(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [existing, setExisting] = useState<MedicineDetail | null>(null);
  const [chosenMedicineId, setChosenMedicineId] = useState(existingMedicineId ?? null);
  const [showPicker, setShowPicker] = useState(false);
  const [reviewInput, setReviewInput] = useState<AddMedicineOutput | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [manufacturerSuggestions, setManufacturerSuggestions] = useState<
    string[]
  >([]);
  const [suppliers, setSuppliers] = useState<
    Awaited<ReturnType<typeof listSupplierPickerOptions>>
  >([]);
  const [supplierId, setSupplierId] = useState("");
  const [paymentType, setPaymentType] = useState<PurchasePaymentType>("cod");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    listSupplierPickerOptions(session.shopId, session.userId)
      .then((rows) => {
        if (isCurrent) {
          setSuppliers(rows);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setErrorMessage(t("suppliersLoadFailedLabel"));
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [session.shopId, session.userId, t]);

  const { control, handleSubmit, getValues, setValue } = useForm<
    AddMedicineInput,
    unknown,
    AddMedicineOutput
  >({
    // Existing identity is immutable here. Hidden new-medicine fields must
    // never prevent receiving a batch (for example an old threshold error).
    resolver: (values, context, options) => zodResolver(addMedicineSchema)(
      existing ? {
        ...values, name: existing.name, generic: undefined, manufacturer: undefined,
        strength: undefined, type: undefined, threshold: undefined,
        unitOfMeasure: existing.unitOfMeasure, requiresPrescription: existing.requiresPrescription,
      } : values, context, options,
    ),
    defaultValues: {
      name: "",
      unitOfMeasure: "piece",
      requiresPrescription: false,
      firstBatch: { batchNo: "", expiryDate: "" },
    },
  });

  const selectExisting = useCallback(async (id: string) => {
    if (submitLock.current || validationLock.current) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    const request = ++selectionRequest.current;
    selectionPending.current = true;
    setIsSelecting(true);
    setChosenMedicineId(id);
    setExisting(null);
    try {
      const row = await getMedicine(session.shopId, id);
      guard.ifLive(() => {
        if (request !== selectionRequest.current) return;
        if (!row) { setErrorMessage(t("restockLoadFailed")); return; }
        setExisting(row); setShowPicker(false); setReviewInput(null);
        setValue("name", row.name);
        setValue("generic", row.generic ?? "");
        setValue("manufacturer", row.manufacturer ?? "");
        setValue("unitOfMeasure", row.unitOfMeasure);
      });
    } catch { guard.ifLive(() => {
      if (request === selectionRequest.current) setErrorMessage(t("restockLoadFailed"));
    }); } finally {
      if (request === selectionRequest.current) {
        selectionPending.current = false;
        guard.ifLive(() => setIsSelecting(false));
      }
    }
  }, [session, setValue, t]);
  useEffect(() => {
    if (existingMedicineId) void selectExisting(existingMedicineId);
  }, [existingMedicineId, selectExisting]);

  // Every mapped catalogue field lands in its own editable field — never
  // concatenated into `name`, which must stay the brand name (medicines_fts
  // indexes it, findExactNameMatch compares it). Unit of measure is only
  // overwritten when the catalogue actually supplied one, so an unmapped pack
  // size leaves the "piece" default standing rather than blanking a required
  // field (domain/catalogPrefill.ts).
  useEffect(() => {
    if (!initialMedicine || existingMedicineId) return;
    setValue("name", initialMedicine.name, { shouldDirty: true });
    setValue("generic", initialMedicine.generic ?? "", { shouldDirty: true });
    setValue("manufacturer", initialMedicine.manufacturer ?? "", {
      shouldDirty: true,
    });
    setValue("strength", initialMedicine.strength ?? "", { shouldDirty: true });
    setValue("type", initialMedicine.type ?? "", { shouldDirty: true });
    if (initialMedicine.unitOfMeasure) {
      setValue("unitOfMeasure", initialMedicine.unitOfMeasure, {
        shouldDirty: true,
      });
    }
  }, [initialMedicine, existingMedicineId, setValue]);

  useEffect(() => {
    if (scanRequest > 0) setIsScannerVisible(true);
  }, [scanRequest]);

  // Prefills only fields the user hasn't already typed into, and only after
  // the scanned date passes isoDateSchema — every field stays fully
  // editable; Save remains the only commit path (never auto-saves a scanned
  // value — docs/plans/ocr.md).
  const handleScanResult = (recognizedText: string) => {
    const parsed = parseScannedMedicineStrip(recognizedText);
    let prefilledAny = false;

    if (parsed.name && !getValues("name")) {
      setValue("name", parsed.name, { shouldDirty: true });
      prefilledAny = true;
    }
    if (parsed.batchNo && !getValues("firstBatch.batchNo")) {
      setValue("firstBatch.batchNo", parsed.batchNo, { shouldDirty: true });
      prefilledAny = true;
    }
    if (parsed.expiryDate && !getValues("firstBatch.expiryDate")) {
      const checked = isoDateSchema.safeParse(parsed.expiryDate);
      if (checked.success && checked.data) {
        setValue("firstBatch.expiryDate", checked.data, { shouldDirty: true });
        prefilledAny = true;
      }
    }

    setScanNotice(
      prefilledAny
        ? t("scanPrefilledNotice")
        : t("scanNothingRecognizedNotice"),
    );
  };

  const onSubmit = async (input: AddMedicineOutput, confirmDistinctMedicine = false) => {
      if (submitLock.current || selectionPending.current) return;
      // Confirm only the identity name the user actually reviewed. Other
      // fields are revalidated from the current form, never a stale snapshot.
      if (confirmDistinctMedicine && input.name !== reviewInput?.name) {
        confirmDistinctMedicine = false;
        setReviewInput(null);
      }
      setErrorMessage(null);
      if (
        (!existing && (!input.generic?.trim() || !input.manufacturer?.trim())) ||
        !input.firstBatch.expiryDate
      ) {
        setErrorMessage(t("fillRequiredFieldsLabel"));
        return;
      }
      if (!supplierId) {
        setErrorMessage(t("selectSupplierLabel"));
        return;
      }
      if (
        !Number.isInteger(input.firstBatch.quantity) ||
        input.firstBatch.quantity < 1
      ) {
        setErrorMessage(t("quantityMinimumLabel"));
        return;
      }
      if (input.firstBatch.salePrice <= input.firstBatch.purchasePrice) {
        setErrorMessage(t("saleGreaterThanPurchaseLabel"));
        return;
      }

      const guard = captureSessionFor(session);
      if (!guard) {
        return;
      }
      submitLock.current = true;
      setIsSubmitting(true);
      let saved = false;
      try {
        if (chosenMedicineId && !existing) throw new Error(t("restockLoadFailed"));
        if (!existing && !confirmDistinctMedicine) {
          const matches = await searchRestockMedicines(session.shopId, input.name);
          if (!guard.isStillActive()) return;
          if (matches.length > 0) { setReviewInput(input); return; }
        }
        const batch = {
          batchNo: input.firstBatch.batchNo,
          expiryDate: input.firstBatch.expiryDate,
          quantity: input.firstBatch.quantity,
          purchasePrice: fromTaka(input.firstBatch.purchasePrice),
          salePrice: fromTaka(input.firstBatch.salePrice),
        };
        if (existing) {
          await addBatchWithPurchase({
            shopId: session.shopId, actorUserId: session.userId,
            isStillActive: guard.isStillActive, medicineId: existing.id,
            supplierId, paymentType, batch,
          });
        } else await createMedicineWithPurchase({
          confirmDistinctMedicine,
          shopId: session.shopId,
          actorUserId: session.userId,
          isStillActive: guard.isStillActive,
          name: input.name,
          generic: input.generic,
          manufacturer: input.manufacturer,
          // A blank optional field is "not recorded", not an empty value: the
          // column is nullable and an empty string would read back as present.
          strength: input.strength?.trim() || undefined,
          type: input.type?.trim() || undefined,
          unitOfMeasure: input.unitOfMeasure,
          requiresPrescription: input.requiresPrescription,
          threshold: input.threshold,
          supplierId,
          paymentType,
          firstBatch: {
            batchNo: input.firstBatch.batchNo,
            expiryDate: input.firstBatch.expiryDate,
            quantity: input.firstBatch.quantity,
            purchasePrice: fromTaka(input.firstBatch.purchasePrice),
            salePrice: fromTaka(input.firstBatch.salePrice),
          },
        });
        saved = true;
        void triggerSyncNow(session.shopId);
        guard.ifLive(onSaved);
      } catch (caught) {
        guard.ifLive(() =>
          setErrorMessage(userFacingError(caught, "medicineAddFailedLabel", t)),
        );
      } finally {
        // Keep a successful receipt locked until navigation unmounts the form.
        // A delayed second resolver must not record the same physical receipt.
        if (!saved) {
          submitLock.current = false;
          setIsSubmitting(false);
        }
      }
    };

  const handleCreateSupplier = useCallback(
    async (input: {
      name: string;
      phone: string;
      manufacturer?: string;
      notes?: string;
    }) => {
      const fields = supplierFieldsSchema.parse({
        ...input,
        address: "",
        email: "",
        contactPerson: "",
      });
      const guard = captureSessionFor(session);
      if (!guard) throw new Error("Session unavailable");
      const created = await createSupplier(
        session.shopId,
        session.userId,
        fields,
        guard.isStillActive,
      );
      if (!guard.isStillActive()) throw new Error("Session changed");
      setSuppliers((current) => [
        ...current.filter((supplier) => supplier.id !== created.id),
        { id: created.id, name: created.name },
      ]);
      setSupplierId(created.id);
      void triggerSyncNow(session.shopId);
    },
    [session],
  );

  // React Hook Form awaits the resolver. Lock identity before validation so
  // a picker tap cannot swap medicines under a pending Save closure.
  const submitValidated = async (confirmDistinctMedicine = false) => {
    if (validationLock.current || submitLock.current || selectionPending.current) return;
    validationLock.current = true;
    setIsSubmitting(true);
    try {
      await handleSubmit((input) => onSubmit(input, confirmDistinctMedicine))();
    } finally {
      validationLock.current = false;
      if (!submitLock.current) setIsSubmitting(false);
    }
  };

  return (
    <View className="gap-4">
      {existing ? <View className="gap-2 rounded-xl bg-white p-4">
        <Text className="font-sans-semibold">{t("restockSameLabel")}: {existing.name}</Text>
        <Text className="font-sans">{[existing.generic, existing.manufacturer, existing.strength, existing.type, existing.unitOfMeasure, existing.barcode].filter(Boolean).join(" / ")}</Text>
        <Text className="font-sans text-xs">{existing.id}</Text>
        <Text className="font-sans text-sm">{t("restockBatchHint")}</Text>
        {!existingMedicineId ? <Pressable disabled={isSubmitting} onPress={() => setShowPicker(!showPicker)} accessibilityRole="button" accessibilityLabel={t("restockChooseLabel")}>
          <Text className="font-sans-semibold text-brand-green">{t("restockChooseLabel")}</Text>
        </Pressable> : null}
      </View> : !chosenMedicineId ? <Pressable onPress={() => setShowPicker(!showPicker)} accessibilityRole="button" accessibilityLabel={t("restockLabel")} className="rounded-xl bg-brand-softGreen p-4">
        <Text className="font-sans-semibold text-brand-green">{t("restockLabel")}</Text>
      </Pressable> : <Text className="font-sans">{t("loadingLabel")}</Text>}
      {showPicker || reviewInput ? <ExistingMedicinePicker key={`${session.shopId}:${reviewInput?.name ?? ""}`} shopId={session.shopId} initialQuery={reviewInput?.name} onSelect={(id) => { void selectExisting(id); }} /> : null}
      {reviewInput ? <View className="gap-3 rounded-xl bg-white p-4">
        <Text className="font-sans">{t("restockReviewHint")}</Text>
        <Pressable disabled={isSubmitting || isSelecting} onPress={() => { void submitValidated(true); }} accessibilityRole="button" accessibilityLabel={t("restockDistinctLabel")} className="rounded-lg border border-brand-green p-3">
          <Text className="font-sans-semibold text-brand-green">{t("restockDistinctLabel")}</Text>
        </Pressable>
        <Pressable onPress={() => setReviewInput(null)} accessibilityRole="button" accessibilityLabel={t("cancelLabel")}><Text className="font-sans">{t("cancelLabel")}</Text></Pressable>
      </View> : null}
      <View className="flex-row items-center justify-between rounded-lg border border-info bg-[#EFF6FF] p-4">
        <View className="flex-1 pr-3">
          <Text className="mb-1 font-sans-semibold text-sm text-info">
            {t("quickAddLabel")}
          </Text>
          <Text className="font-sans text-xs text-info">
            {t("quickAddHint")}
          </Text>
        </View>
        <Pressable
          onPress={() => setIsScannerVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={t("scanStripToPrefillLabel")}
          className="h-12 w-12 items-center justify-center rounded-full bg-info active:opacity-80"
        >
          <Feather name="camera" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
      {scanNotice ? (
        <Text className="font-sans text-sm text-midGray">{scanNotice}</Text>
      ) : null}

      {!existing && !chosenMedicineId ? <>
      <FormField
        control={control}
        name="name"
        label={`${t("medicineNameLabel")} *`}
        placeholder={t("medicineNamePlaceholder")}
        prototypeStyle
      />
      <FormField
        control={control}
        name="generic"
        label={`${t("genericNameLabel")} *`}
        placeholder={t("genericNamePlaceholder")}
        prototypeStyle
      />
      <View className="gap-2">
        <Text className="font-sans-semibold text-sm text-richBlack">
          {t("manufacturerLabel")} *
        </Text>
        <Controller
          control={control}
          name="manufacturer"
          render={({
            field: { value, onChange, onBlur },
            fieldState: { error },
          }) => (
            <ManufacturerPicker
              value={value ?? ""}
              onChange={onChange}
              onBlur={onBlur}
              suggestions={manufacturerSuggestions}
              onRequestSuggestions={(query) =>
                void listManufacturerSuggestions(session.shopId, query).then(
                  setManufacturerSuggestions,
                )
              }
              onDismissSuggestions={() => setManufacturerSuggestions([])}
              errorMessage={error ? localizeValidationMessage(error.message, t) : null}
            />
          )}
        />
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <FormField
            control={control}
            name="strength"
            label={t("strengthLabel")}
            placeholder={t("strengthPlaceholder")}
            prototypeStyle
          />
        </View>
        <View className="flex-1">
          <FormField
            control={control}
            name="type"
            label={t("dosageFormLabel")}
            placeholder={t("dosageFormPlaceholder")}
            prototypeStyle
          />
        </View>
      </View>
      <FormField
        control={control}
        name="unitOfMeasure"
        label={t("unitOfMeasureLabel")}
        placeholder={t("unitOfMeasurePlaceholder")}
        prototypeStyle
      />

      </> : null}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.batchNo"
            label={`${t("batchNumberLabel")} *`}
            placeholder="B2401"
            prototypeStyle
          />
        </View>
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.expiryDate"
            label={`${t("expiryDateLabel")} *`}
            placeholder="YYYY-MM-DD"
            prototypeStyle
          />
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.purchasePrice"
            label={`${t("purchasePriceLabel")} *`}
            placeholder="0.00"
            numeric
            money
            prototypeStyle
          />
        </View>
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.salePrice"
            label={`${t("salePriceLabel")} *`}
            placeholder="0.00"
            numeric
            money
            prototypeStyle
          />
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.quantity"
            label={`${t("quantityLabel")} *`}
            placeholder="0"
            numeric
            prototypeStyle
          />
        </View>
        {!existing ? <View className="flex-1">
          <FormField
            control={control}
            name="threshold"
            label={t("minimumStockLabel")}
            placeholder="10"
            numeric
            prototypeStyle
          />
        </View> : null}
      </View>

      <SupplierPickerField
        suppliers={suppliers}
        selectedId={supplierId}
        onSelect={setSupplierId}
        onCreateSupplier={
          session.role === "owner" ? handleCreateSupplier : undefined
        }
      />

      <View className="gap-2">
        <Text className="font-sans-bold text-xs text-[#374151]">
          {t("addMedicinePaymentMethodLabel")}
        </Text>
        <View className="flex-row gap-3">
          {(["cod", "credit"] as const).map((type) => (
            <Pressable
              key={type}
              onPress={() => setPaymentType(type)}
              className={`h-11 flex-1 items-center justify-center rounded-xl border-2 ${
                paymentType === type
                  ? "border-brand-green bg-brand-softGreen"
                  : "border-[#E5E7EB] bg-white"
              }`}
            >
              <Text
                className={`font-sans-semibold ${
                  paymentType === type ? "text-[#047857]" : "text-midGray"
                }`}
              >
                {type === "cod"
                  ? t("addMedicineCodLabel")
                  : t("addMedicineCreditLabel")}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {!existing ? <View className="flex-row items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
        <View className="flex-1 pr-3">
          <Text className="font-sans-semibold text-sm text-richBlack">
            {t("requiresPrescriptionLabel")}
          </Text>
          <Text className="font-sans text-xs text-midGray">
            {t("requiresPrescriptionHint")}
          </Text>
        </View>
        <Controller
          control={control}
          name="requiresPrescription"
          render={({ field: { value, onChange } }) => (
            <Switch
              value={value}
              onValueChange={onChange}
              accessibilityLabel={t("requiresPrescriptionLabel")}
              trackColor={{ true: "#059669" }}
            />
          )}
        />
      </View>

      : null}
      <Text className="text-center font-sans text-xs text-midGray">
        {t("requiredFieldsNoteLabel")}
      </Text>
      {errorMessage ? (
        <Text className="font-sans text-sm text-error">{errorMessage}</Text>
      ) : null}

      <View className="flex-row gap-3 pt-4">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("cancelLabel")}
          className="h-12 flex-1 items-center justify-center rounded-lg border border-brand-green bg-white active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-brand-green">
            {t("cancelLabel")}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { void submitValidated(); }}
          disabled={isSubmitting || isSelecting || Boolean(reviewInput) || Boolean(chosenMedicineId && !existing)}
          accessibilityRole="button"
          accessibilityLabel={t("saveMedicineLabel")}
          className="h-12 flex-1 items-center justify-center rounded-lg bg-brand-green active:opacity-80 disabled:opacity-50"
        >
          <Text className="font-sans-semibold text-base text-white">
            {isSubmitting ? t("savingMedicineLabel") : t("saveMedicineLabel")}
          </Text>
        </Pressable>
      </View>

      <MedicineTextScanner
        visible={isScannerVisible}
        mode="prefill"
        onClose={() => setIsScannerVisible(false)}
        onTextRecognized={handleScanResult}
      />
    </View>
  );
}
