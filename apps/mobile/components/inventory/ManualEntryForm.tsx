import { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  addMedicineSchema,
  isoDateSchema,
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
import { listSupplierPickerOptions } from "../../db/suppliers";
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
      firstBatch: { batchNo: "", quantity: 0, purchasePrice: 0, salePrice: 0 },
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

  return (
    <View className="gap-5">
      <Pressable
        onPress={() => setIsScannerVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={t("scanStripToPrefillLabel")}
        className="flex-row items-center justify-center gap-2 rounded-lg border border-brand-green bg-white py-3 active:opacity-80"
      >
        <Feather name="camera" size={18} color="#059669" />
        <Text className="font-sans-semibold text-sm text-brand-green">
          {t("scanStripToPrefillLabel")}
        </Text>
      </Pressable>
      {scanNotice ? (
        <Text className="font-sans text-sm text-midGray">{scanNotice}</Text>
      ) : null}

      <FormField
        control={control}
        name="name"
        label={`${t("medicineNameLabel")} *`}
        placeholder={t("medicineNamePlaceholder")}
      />
      <FormField
        control={control}
        name="generic"
        label={t("genericNameLabel")}
        placeholder={t("genericNamePlaceholder")}
      />
      <View className="gap-2">
        <Text className="font-sans-medium text-sm text-richBlack">
          {t("manufacturerLabel")}
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
                accessibilityLabel={t("manufacturerLabel")}
                className="rounded-lg border border-midGray bg-white px-4 py-3"
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
          />
        </View>
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.expiryDate"
            label={t("expiryDateLabel")}
            placeholder="YYYY-MM-DD"
          />
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.purchasePrice"
            label={`${t("purchasePriceLabel")} *`}
            numeric
            money
          />
        </View>
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.salePrice"
            label={`${t("salePriceLabel")} *`}
            numeric
            money
          />
        </View>
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <FormField
            control={control}
            name="firstBatch.quantity"
            label={`${t("quantityLabel")} *`}
            numeric
          />
        </View>
        <View className="flex-1">
          <FormField
            control={control}
            name="threshold"
            label={t("minimumStockLabel")}
            numeric
          />
        </View>
      </View>

      <SupplierPickerField
        suppliers={suppliers}
        selectedId={supplierId}
        onSelect={setSupplierId}
      />

      <View className="gap-2">
        <Text className="font-sans-bold text-base text-richBlack">
          {t("paymentMethodLabel")}
        </Text>
        <View className="flex-row gap-3">
          {(["cod", "credit"] as const).map((type) => (
            <Pressable
              key={type}
              onPress={() => setPaymentType(type)}
              className={`flex-1 items-center rounded-lg border py-3 ${
                paymentType === type
                  ? "border-brand-green bg-brand-green"
                  : "border-midGray bg-white"
              }`}
            >
              <Text
                className={`font-sans-semibold ${
                  paymentType === type ? "text-white" : "text-richBlack"
                }`}
              >
                {type === "cod" ? t("codLabel") : t("onCreditLabel")}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View className="flex-row items-center justify-between rounded-xl bg-white px-4 py-3">
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

      <Text className="font-sans text-xs text-midGray">
        {t("requiredFieldsNoteLabel")}
      </Text>
      {errorMessage ? (
        <Text className="font-sans text-sm text-error">{errorMessage}</Text>
      ) : null}

      <View className="flex-row gap-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("cancelLabel")}
          className="flex-1 items-center rounded-lg border border-brand-green py-3.5 active:opacity-80"
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
          className="flex-1 items-center rounded-lg bg-brand-green py-3.5 active:opacity-80 disabled:opacity-50"
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
