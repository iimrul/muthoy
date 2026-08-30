import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
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
  createMedicineWithPurchase,
  listManufacturerSuggestions,
} from "../../db/inventory";
import {
  createSupplier,
  listSupplierPickerOptions,
} from "../../db/suppliers";
import { parseScannedMedicineStrip } from "../../domain/ocrText";
import type { MedicineSearchResult } from "../../domain/medicineSearchProvider";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import { localizeValidationMessage, userFacingError } from "../../i18n/display";
import type { Session } from "../../state/sessionStore";
import { triggerSyncNow } from "../../sync";
import { SupplierPickerField } from "./SupplierPickerField";

interface ManualEntryFormProps {
  session: Session;
  onSaved: () => void;
  initialMedicine?: MedicineSearchResult | null;
  scanRequest?: number;
}

// Manual Entry — the prototype-parity field set (Volume 0 Day 8's identity
// fields, plus Supplier + Payment Method now that Add Medicine's first batch
// is a real supplier purchase, per the founder's Sales+Inventory recovery
// decision). Strength, Category, unit and barcode stay outside this recovery,
// while Requires-prescription remains explicit because silently defaulting
// every new medicine to false suppresses the production checkout warning.
export function ManualEntryForm({
  session,
  onSaved,
  initialMedicine,
  scanRequest = 0,
}: ManualEntryFormProps) {
  const { t } = useI18n();
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
    resolver: zodResolver(addMedicineSchema),
    defaultValues: {
      name: "",
      unitOfMeasure: "piece",
      requiresPrescription: false,
      firstBatch: { batchNo: "", expiryDate: "" },
    },
  });

  useEffect(() => {
    if (!initialMedicine) return;
    setValue("name", initialMedicine.name, { shouldDirty: true });
    setValue("generic", initialMedicine.generic ?? "", { shouldDirty: true });
    setValue("manufacturer", initialMedicine.manufacturer ?? "", {
      shouldDirty: true,
    });
  }, [initialMedicine, setValue]);

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

  const onSubmit = useCallback(
    async (input: AddMedicineOutput) => {
      setErrorMessage(null);
      if (
        !input.generic?.trim() ||
        !input.manufacturer?.trim() ||
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
      setIsSubmitting(true);
      try {
        await createMedicineWithPurchase({
          shopId: session.shopId,
          actorUserId: session.userId,
          isStillActive: guard.isStillActive,
          name: input.name,
          generic: input.generic,
          manufacturer: input.manufacturer,
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
        void triggerSyncNow(session.shopId);
        guard.ifLive(onSaved);
      } catch (caught) {
        guard.ifLive(() =>
          setErrorMessage(userFacingError(caught, "medicineAddFailedLabel", t)),
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [onSaved, paymentType, session, supplierId, t],
  );

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

  return (
    <View className="gap-4">
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
            <>
              <TextInput
                value={value ?? ""}
                onBlur={onBlur}
                onFocus={() =>
                  void listManufacturerSuggestions(session.shopId).then(
                    setManufacturerSuggestions,
                  )
                }
                onChangeText={(text) => {
                  onChange(text);
                  void listManufacturerSuggestions(session.shopId, text).then(
                    setManufacturerSuggestions,
                  );
                }}
                placeholder={t("manufacturerPlaceholder")}
                placeholderTextColor="#6B7280"
                accessibilityLabel={t("manufacturerLabel")}
                className="h-12 rounded-xl border border-[#D1D5DB] bg-white px-4 font-sans text-base text-richBlack"
              />
              {manufacturerSuggestions.length ? (
                <View className="flex-row flex-wrap gap-2">
                  {manufacturerSuggestions.map((name) => (
                    <Pressable
                      key={name}
                      onPress={() => {
                        onChange(name);
                        setManufacturerSuggestions([]);
                      }}
                      className="rounded-full bg-white px-3 py-2"
                    >
                      <Text className="text-xs text-brand-green">{name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {error ? (
                <Text className="font-sans text-sm text-error">
                  {localizeValidationMessage(error.message, t)}
                </Text>
              ) : null}
            </>
          )}
        />
      </View>

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
        <View className="flex-1">
          <FormField
            control={control}
            name="threshold"
            label={t("minimumStockLabel")}
            placeholder="10"
            numeric
            prototypeStyle
          />
        </View>
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

      <View className="flex-row items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
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
          onPress={handleSubmit(onSubmit)}
          disabled={isSubmitting}
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
