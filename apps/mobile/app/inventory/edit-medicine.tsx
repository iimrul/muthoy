import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { medicineMetadataSchema } from "@muthoy/validation";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  archiveMedicine,
  getMedicine,
  updateMedicine,
} from "../../db/inventory";
import { captureSessionFor } from "../../state/sessionGuard";
import { usePermission } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";

export default function EditMedicineScreen() {
  const { medicineId } = useLocalSearchParams<{ medicineId: string }>();
  const { session, isAllowed } = usePermission("inventory_write");
  const [name, setName] = useState("");
  const [generic, setGeneric] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [barcode, setBarcode] = useState("");
  const [threshold, setThreshold] = useState("");
  const [requiresPrescription, setRequiresPrescription] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (session && medicineId)
      void getMedicine(session.shopId, medicineId).then((row) => {
        if (!row) return;
        setName(row.name);
        setGeneric(row.generic ?? "");
        setManufacturer(row.manufacturer ?? "");
        setBarcode(row.barcode ?? "");
        setThreshold(String(row.threshold));
        setRequiresPrescription(row.requiresPrescription);
      });
  }, [medicineId, session]);
  if (!session || !isAllowed || !medicineId) return <AccessDenied />;
  const save = async () => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    setSaving(true);
    try {
      const parsed = medicineMetadataSchema.parse({
        name,
        generic,
        manufacturer,
        barcode,
        requiresPrescription,
        lowStockThresholdOverride: threshold.trim() ? Number(threshold) : null,
      });
      await updateMedicine({
        shopId: session.shopId,
        actorUserId: session.userId,
        medicineId,
        isStillActive: guard.isStillActive,
        values: parsed,
      });
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => router.back());
    } catch (caught) {
      if (!guard.isStale())
        Alert.alert(
          "Could not save",
          caught instanceof Error ? caught.message : "Try again.",
        );
    } finally {
      setSaving(false);
    }
  };
  const archive = async () => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    try {
      await archiveMedicine(
        session.shopId,
        session.userId,
        medicineId,
        guard.isStillActive,
      );
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => router.replace("/inventory"));
    } catch (caught) {
      if (!guard.isStale())
        Alert.alert(
          "Cannot archive",
          caught instanceof Error
            ? caught.message
            : "Medicine must have zero stock, no oversell, and no active promotion.",
        );
    }
  };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Edit medicine" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Field label="Name" value={name} onChange={setName} />
        <Field label="Generic" value={generic} onChange={setGeneric} />
        <Field
          label="Manufacturer"
          value={manufacturer}
          onChange={setManufacturer}
        />
        <Field label="Barcode" value={barcode} onChange={setBarcode} />
        <Field
          label="Low-stock override"
          value={threshold}
          onChange={setThreshold}
          numeric
        />
        <View className="flex-row justify-between rounded-lg bg-white p-4">
          <Text>Requires prescription</Text>
          <Switch
            value={requiresPrescription}
            onValueChange={setRequiresPrescription}
          />
        </View>
        <Pressable
          onPress={() => void save()}
          disabled={saving}
          className="items-center rounded-lg bg-brand-green py-4"
        >
          <Text className="text-white">
            {saving ? "Saving…" : "Save changes"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert(
              "Archive medicine?",
              "Only zero-stock medicines without oversell or active promotions can be archived.",
              [
                { text: "Cancel" },
                {
                  text: "Archive",
                  style: "destructive",
                  onPress: () => void archive(),
                },
              ],
            )
          }
          className="items-center rounded-lg border border-error py-4"
        >
          <Text className="text-error">Archive medicine</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "number-pad" : "default"}
        className="rounded-lg border border-midGray bg-white p-3"
      />
    </View>
  );
}
