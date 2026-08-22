import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { parseCsv } from "@muthoy/utils";
import { inventoryCsvRowSchema } from "@muthoy/validation";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  importInventoryCsv,
  previewInventoryCsv,
} from "../../db/inventoryImport";
import { captureSessionFor } from "../../state/sessionGuard";
import { usePermission } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";

const REQUIRED = [
  "name",
  "generic",
  "manufacturer",
  "batch_no",
  "stock",
  "purchase_price",
  "sale_price",
];

export default function InventoryImportScreen() {
  const { session, isAllowed } = usePermission("inventory_write");
  const [csv, setCsv] = useState("");
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [dbRows, setDbRows] = useState<
    { rowNumber: number; name: string; batchNo: string; action: string }[]
  >([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    if (!csv.trim())
      return { rows: [] as Record<string, string>[], errors: [] as string[] };
    try {
      const [headers = [], ...values] = parseCsv(csv);
      const missing = REQUIRED.filter((name) => !headers.includes(name));
      if (missing.length)
        return { rows: [], errors: [`Missing columns: ${missing.join(", ")}`] };
      const rows = values.map((row) =>
        Object.fromEntries(
          headers.map((header, index) => [header, row[index] ?? ""]),
        ),
      );
      const errors = rows.flatMap((row, index) => {
        const result = inventoryCsvRowSchema.safeParse(row);
        return result.success
          ? []
          : [
              `Row ${index + 2}: ${result.error.issues[0]?.message ?? "Invalid row"}`,
            ];
      });
      return { rows, errors };
    } catch (caught) {
      return {
        rows: [],
        errors: [caught instanceof Error ? caught.message : "Invalid CSV"],
      };
    }
  }, [csv]);
  if (!session || !isAllowed) return <AccessDenied />;
  const confirmPreview = async () => {
    setBusy(true);
    setDbError(null);
    try {
      const result = await previewInventoryCsv(
        session.shopId,
        session.userId,
        csv,
      );
      setFingerprint(result.fingerprint);
      setDbRows(result.rows);
    } catch (caught) {
      setFingerprint(null);
      setDbRows([]);
      setDbError(caught instanceof Error ? caught.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  };
  const runImport = async () => {
    if (!fingerprint) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    setBusy(true);
    try {
      const result = await importInventoryCsv(
        session.shopId,
        session.userId,
        csv,
        fingerprint,
        guard.isStillActive,
      );
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => {
        setCsv("");
        setFingerprint(null);
        setDbRows([]);
        setDbError(`Imported ${result.rowCount} rows.`);
      });
    } catch (caught) {
      if (!guard.isStale())
        setDbError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title="Import inventory"
        onBackPress={() => router.back()}
      />
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-sm text-midGray">
          Owner only. Paste CSV, preview every error, then import all rows
          atomically.
        </Text>
        <TextInput
          value={csv}
          onChangeText={(value) => {
            setCsv(value);
            setFingerprint(null);
            setDbRows([]);
          }}
          multiline
          textAlignVertical="top"
          placeholder="name,generic,manufacturer,batch_no,stock,purchase_price,sale_price"
          className="min-h-48 rounded-lg border border-midGray bg-white p-4"
        />
        <View className="rounded-lg bg-white p-4">
          <Text className="font-sans-semibold">
            Preview: {dbRows.length || preview.rows.length} rows
          </Text>
          {(dbRows.length
            ? dbRows.map((row) => ({
                name: row.name,
                batch_no: row.batchNo,
                stock: row.action,
              }))
            : preview.rows
          )
            .slice(0, 5)
            .map((row, index) => (
              <Text key={index} className="mt-2 text-sm">
                {index + 1}. {row.name} · {row.batch_no} · {row.stock}
              </Text>
            ))}
        </View>
        {preview.errors.map((message, index) => (
          <Text key={index} className="text-error">
            {message}
          </Text>
        ))}
        {dbError ? <Text className="text-error">{dbError}</Text> : null}
        {!fingerprint ? (
          <Pressable
            onPress={() => void confirmPreview()}
            disabled={busy || preview.errors.length > 0 || !csv.trim()}
            className="items-center rounded-lg bg-brand-green py-4 disabled:opacity-40"
          >
            <Text className="text-white">
              {busy ? "Checking…" : "Validate preview"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void runImport()}
            disabled={busy}
            className="items-center rounded-lg bg-brand-green py-4 disabled:opacity-40"
          >
            <Text className="text-white">
              {busy ? "Importing…" : `Import all ${dbRows.length} rows`}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
