import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import type { Paisa } from "@muthoy/types";
import { DosageFormTag } from "../../components/medicine/DosageFormBadge";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { AppTextInput as TextInput } from "../../components/ui/AppTextInput";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  importInventoryCsv,
  previewInventoryCsv,
  type InventoryImportPreviewRow,
} from "../../db/inventoryImport";
import {
  InventoryCsvError,
  type InventoryCsvIssue,
  type InventoryCsvIssueCode,
} from "../../domain/inventoryCsvIssue";
import { INVENTORY_CSV_COLUMNS } from "../../domain/inventoryCsvTemplate";
import type { CatalogKey } from "../../i18n/catalog";
import { CsvPickError, pickInventoryCsv, shareInventoryCsvTemplate } from "../../native/inventoryCsvFile";
import { useI18n } from "../../state/localeStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useOwnerAccess } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";

// Founder, 2026-11-27: bulk-add inventory from a spreadsheet, with a template
// that says what each column needs (prototype "Import CSV" + "Template").
// Download template → choose the filled .csv → see every problem at once, or
// a summary of what will be added → import all rows in one atomic group.

const ISSUE_KEY: Readonly<Record<InventoryCsvIssueCode, CatalogKey>> = {
  too_large: "csvFileTooLarge",
  too_many_rows: "csvIssueTooManyRows",
  unclosed_quote: "csvIssueUnclosedQuote",
  uneven_columns: "csvIssueUnevenColumns",
  no_rows: "csvIssueNoRows",
  duplicate_headers: "csvIssueDuplicateHeaders",
  missing_column: "csvIssueMissingColumn",
  missing_text: "csvIssueMissingText",
  example_row: "csvIssueExampleRow",
  bad_stock: "csvIssueBadStock",
  bad_price: "csvIssueBadPrice",
  bad_expiry: "csvIssueBadExpiry",
  bad_threshold: "csvIssueBadThreshold",
  bad_barcode: "csvIssueBadBarcode",
  duplicate_row: "csvIssueDuplicateRow",
  ambiguous_medicine: "csvIssueAmbiguous",
  batch_exists: "csvIssueBatchExists",
};

const PREVIEW_LIMIT = 20;
const ISSUE_LIMIT = 50;

interface CheckedFile {
  csv: string;
  fingerprint: string;
  rows: InventoryImportPreviewRow[];
}

type Busy = "checking" | "importing" | null;
type T = (key: CatalogKey) => string;

export default function InventoryImportScreen() {
  const { t, formatNumber, formatMoney } = useI18n();
  const { session, isAllowed } = useOwnerAccess();
  const [checked, setChecked] = useState<CheckedFile | null>(null);
  const [issues, setIssues] = useState<readonly InventoryCsvIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [isPasteOpen, setPasteOpen] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  if (!session || !isAllowed) return <AccessDenied />;

  const reset = () => {
    setChecked(null);
    setIssues([]);
    setError(null);
    setImportedCount(null);
  };

  const check = async (csv: string) => {
    reset();
    setBusy("checking");
    try {
      const preview = await previewInventoryCsv(session.shopId, session.userId, csv);
      setChecked({ csv, fingerprint: preview.fingerprint, rows: preview.rows });
    } catch (caught) {
      if (caught instanceof InventoryCsvError) setIssues(caught.issues);
      else setError(t("csvPickFailed"));
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async () => {
    try {
      const picked = await pickInventoryCsv();
      if (!picked) return;
      setFileName(picked.name);
      await check(picked.text);
    } catch (caught) {
      reset();
      if (caught instanceof CsvPickError) {
        setError(t(caught.problem === "too_large" ? "csvFileTooLarge" : "csvNotCsv"));
      } else setError(t("csvPickFailed"));
    }
  };

  const shareTemplate = async () => {
    try {
      await shareInventoryCsvTemplate(t("csvTemplateShareTitle"));
    } catch {
      setError(t("csvTemplateShareFailed"));
    }
  };

  const runImport = async () => {
    if (!checked) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    setBusy("importing");
    try {
      const result = await importInventoryCsv(
        session.shopId,
        session.userId,
        checked.csv,
        checked.fingerprint,
        guard.isStillActive,
      );
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => {
        reset();
        setImportedCount(result.rowCount);
      });
    } catch (caught) {
      if (guard.isStale()) return;
      // The inventory may have changed since the check (a batch added meanwhile).
      if (caught instanceof InventoryCsvError) {
        setChecked(null);
        setIssues(caught.issues);
      } else {
        const isReplay = caught instanceof Error && caught.message.includes("already imported");
        setError(t(isReplay ? "csvAlreadyImported" : "csvImportFailed"));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t("importCsvLabel")} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
        <Text className="font-sans text-sm text-midGray">{t("csvImportIntro")}</Text>
        {importedCount !== null ? (
          <DoneCard t={t} count={formatNumber(importedCount)} />
        ) : null}
        <TemplateCard t={t} onShare={() => void shareTemplate()} />
        <View className="gap-3 rounded-2xl bg-white p-4">
          <Text className="font-sans-bold text-base text-richBlack">{t("csvStepFileTitle")}</Text>
          <Pressable
            onPress={() => void chooseFile()}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={t("csvChooseFile")}
            className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-brand-green active:opacity-80 disabled:opacity-50"
          >
            <Feather name="file-text" size={18} color="#FFFFFF" />
            <Text className="font-sans-semibold text-base text-white">{t("csvChooseFile")}</Text>
          </Pressable>
          {fileName ? <Text className="font-sans text-xs text-midGray">{fileName}</Text> : null}
          <Pressable
            onPress={() => setPasteOpen(!isPasteOpen)}
            accessibilityRole="button"
            accessibilityLabel={t("csvPasteInstead")}
            className="items-center py-1 active:opacity-70"
          >
            <Text className="font-sans-medium text-sm text-brand-green">{t("csvPasteInstead")}</Text>
          </Pressable>
          {isPasteOpen ? (
            <View className="gap-2">
              <TextInput
                value={pasted}
                onChangeText={setPasted}
                multiline
                textAlignVertical="top"
                accessibilityLabel={t("csvPastePlaceholder")}
                placeholder={t("csvPastePlaceholder")}
                className="min-h-32 rounded-xl border border-fieldBorder bg-white p-3 font-mono text-xs"
              />
              <Pressable
                onPress={() => {
                  setFileName(null);
                  void check(pasted);
                }}
                disabled={busy !== null || !pasted.trim()}
                accessibilityRole="button"
                accessibilityLabel={t("csvCheckPasted")}
                className="h-11 items-center justify-center rounded-xl border border-brand-green active:opacity-80 disabled:opacity-40"
              >
                <Text className="font-sans-semibold text-sm text-brand-green">{t("csvCheckPasted")}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        {busy === "checking" ? (
          <Text className="font-sans text-sm text-midGray">{t("csvChecking")}</Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="font-sans-medium text-sm text-error">
            {error}
          </Text>
        ) : null}
        {issues.length > 0 ? <IssueList t={t} issues={issues} formatNumber={formatNumber} /> : null}
        {checked ? (
          <PreviewCard
            t={t}
            rows={checked.rows}
            isImporting={busy === "importing"}
            formatNumber={formatNumber}
            formatMoney={formatMoney}
            onImport={() => void runImport()}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function TemplateCard({ t, onShare }: { t: T; onShare: () => void }) {
  return (
    <View className="gap-3 rounded-2xl bg-white p-4">
      <Text className="font-sans-bold text-base text-richBlack">{t("csvStepTemplateTitle")}</Text>
      <Text className="font-sans text-sm text-midGray">{t("csvStepTemplateBody")}</Text>
      <Pressable
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel={t("csvDownloadTemplate")}
        className="h-11 flex-row items-center justify-center gap-2 rounded-xl border border-brand-green bg-brand-softGreen active:opacity-80"
      >
        <Feather name="download" size={16} color="#059669" />
        <Text className="font-sans-semibold text-sm text-brand-green">{t("csvDownloadTemplate")}</Text>
      </Pressable>
      <Text className="font-sans-semibold text-sm text-richBlack">{t("csvColumnsTitle")}</Text>
      {INVENTORY_CSV_COLUMNS.map((column) => (
        <View key={column.key} className="flex-row items-start gap-2">
          <Text className="w-28 font-mono text-xs text-richBlack">{column.key}</Text>
          <View className="flex-1">
            <Text className="font-sans text-xs text-midGray">{t(column.hint)}</Text>
          </View>
          <Text
            className={`font-sans-semibold text-[10px] ${column.isRequired ? "text-error" : "text-midGray"}`}
          >
            {t(column.isRequired ? "csvRequiredTag" : "csvOptionalTag")}
          </Text>
        </View>
      ))}
    </View>
  );
}

function issueText(issue: InventoryCsvIssue, t: T, formatNumber: (value: number) => string): string {
  const what = issue.column ? `${t(ISSUE_KEY[issue.code])} (${issue.column})` : t(ISSUE_KEY[issue.code]);
  return issue.rowNumber === null ? what : `${t("csvRowLabel")} ${formatNumber(issue.rowNumber)}: ${what}`;
}

function IssueList({
  t,
  issues,
  formatNumber,
}: {
  t: T;
  issues: readonly InventoryCsvIssue[];
  formatNumber: (value: number) => string;
}) {
  const hidden = issues.length - ISSUE_LIMIT;
  return (
    <View testID="csv-issues" className="gap-2 rounded-2xl border border-error/30 bg-errorBg p-4">
      <View className="flex-row items-center gap-2">
        <Feather name="alert-circle" size={16} color="#DC2626" />
        <Text className="flex-1 font-sans-semibold text-sm text-error">{t("csvIssuesTitle")}</Text>
      </View>
      {issues.slice(0, ISSUE_LIMIT).map((issue, index) => (
        <Text key={`${issue.rowNumber ?? 0}-${issue.code}-${issue.column ?? ""}-${index}`} className="font-sans text-xs text-error">
          {issueText(issue, t, formatNumber)}
        </Text>
      ))}
      {hidden > 0 ? (
        <Text className="font-sans text-xs text-error">
          + {formatNumber(hidden)} {t("csvMoreRows")}
        </Text>
      ) : null}
    </View>
  );
}

function PreviewCard({
  t,
  rows,
  isImporting,
  formatNumber,
  formatMoney,
  onImport,
}: {
  t: T;
  rows: readonly InventoryImportPreviewRow[];
  isImporting: boolean;
  formatNumber: (value: number) => string;
  formatMoney: (value: Paisa) => string;
  onImport: () => void;
}) {
  const newMedicines = rows.filter((row) => row.action === "create_medicine").length;
  const units = rows.reduce((sum, row) => sum + row.stock, 0);
  const hidden = rows.length - PREVIEW_LIMIT;
  return (
    <View testID="csv-preview" className="gap-3 rounded-2xl bg-white p-4">
      <Text className="font-sans-bold text-base text-richBlack">{t("csvStepPreviewTitle")}</Text>
      <View className="flex-row gap-2">
        <Stat label={t("csvNewMedicines")} value={formatNumber(newMedicines)} />
        <Stat label={t("csvBatchesLabel")} value={formatNumber(rows.length)} />
        <Stat label={t("csvTotalUnits")} value={formatNumber(units)} />
      </View>
      {rows.slice(0, PREVIEW_LIMIT).map((row) => (
        <View key={row.rowNumber} className="flex-row items-center gap-3 border-t border-midGray/15 pt-2">
          <View className="flex-1 gap-0.5">
            <Text className="font-sans-semibold text-sm text-richBlack">{row.name}</Text>
            <DosageFormTag type={row.type} strength={null} />
            <Text className="font-sans text-xs text-midGray">
              #{row.batchNo} · {formatNumber(row.stock)}
              {row.expiryDate ? ` · ${row.expiryDate}` : ""}
            </Text>
          </View>
          <View className="items-end gap-1">
            <Text className="font-mono text-sm text-brand-green">{formatMoney(row.salePrice)}</Text>
            <Text className="font-sans-semibold text-[10px] text-midGray">
              {t(row.action === "create_medicine" ? "csvActionNew" : "csvActionAddBatch")}
            </Text>
          </View>
        </View>
      ))}
      {hidden > 0 ? (
        <Text className="font-sans text-xs text-midGray">
          + {formatNumber(hidden)} {t("csvMoreRows")}
        </Text>
      ) : null}
      <Pressable
        onPress={onImport}
        disabled={isImporting}
        accessibilityRole="button"
        accessibilityLabel={t("csvImportButton")}
        className="h-12 items-center justify-center rounded-xl bg-brand-green active:opacity-80 disabled:opacity-50"
      >
        <Text className="font-sans-semibold text-base text-white">
          {isImporting ? t("csvImporting") : `${t("csvImportButton")} (${formatNumber(rows.length)})`}
        </Text>
      </Pressable>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center rounded-xl bg-brand-softGreen py-2">
      <Text className="font-sans-bold text-lg text-richBlack">{value}</Text>
      <Text className="font-sans text-[11px] text-midGray">{label}</Text>
    </View>
  );
}

function DoneCard({ t, count }: { t: T; count: string }) {
  return (
    <View
      testID="csv-import-done"
      accessibilityRole="alert"
      className="gap-2 rounded-2xl border border-brand-green/30 bg-white p-4"
    >
      <View className="flex-row items-center gap-2">
        <Feather name="check-circle" size={18} color="#059669" />
        <Text className="font-sans-bold text-base text-brand-green">{t("csvImportDoneTitle")}</Text>
      </View>
      <Text className="font-sans text-sm text-richBlack">
        {count} {t("csvImportDoneBody")}
      </Text>
    </View>
  );
}
