import { Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "@muthoy/constants";
import type {
  InventoryCsvIssue,
  InventoryCsvIssueCode,
  InventoryCsvWarning,
} from "../../domain/inventoryCsvIssue";
import { INVENTORY_CSV_COLUMNS } from "../../domain/inventoryCsvTemplate";
import type { CatalogKey } from "../../i18n/catalog";

// The CSV import's problem list (founder, 2026-11-28: "কয়টা ঔষধের কি কি
// ইনপুট পড়ে নি সব ভুলের তালিকা দেখা যাওয়া উচিত, আর না হলে ইউজারের অনেক
// কষ্ট হয়ে যাবে খুঁজতে কোথায় আসলেই ভুল ছিল").
//
// Every problem, never a "+N more": one card per sheet row, headed by the
// row number and the medicine's name, then one line per cell — the column in
// the owner's language, what the cell actually held, and what it needs.

type T = (key: CatalogKey) => string;
type FormatNumber = (value: number) => string;

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

const COLUMN_LABEL = new Map(INVENTORY_CSV_COLUMNS.map((column) => [column.key, column.label]));

/** "{bad} of {total}" style catalog text with its values filled in. */
export function fillText(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

function columnName(column: string, t: T): string {
  const label = COLUMN_LABEL.get(column);
  return label ? t(label) : column;
}

/** One line: "মেয়াদ: “31/12/2027” — তারিখ YYYY-MM-DD আকারে লিখুন". */
export function issueLine(issue: InventoryCsvIssue, t: T): string {
  if (issue.code === "ambiguous_medicine") {
    return fillText(t(ISSUE_KEY[issue.code]), { value: issue.value ?? "" });
  }
  const message = t(ISSUE_KEY[issue.code]);
  if (!issue.column) return message;
  if (issue.code === "missing_column") return `${message}: ${columnName(issue.column, t)} (${issue.column})`;
  const quoted = issue.value ? ` “${issue.value}”` : "";
  return `${columnName(issue.column, t)}:${quoted} — ${message}`;
}

interface RowGroup {
  rowNumber: number | null;
  medicineName: string | undefined;
  issues: InventoryCsvIssue[];
}

function groupByRow(issues: readonly InventoryCsvIssue[]): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  for (const issue of issues) {
    const key = String(issue.rowNumber);
    const group = groups.get(key) ?? { rowNumber: issue.rowNumber, medicineName: undefined, issues: [] };
    group.medicineName = group.medicineName ?? issue.medicineName;
    group.issues.push(issue);
    groups.set(key, group);
  }
  // The whole-file problems first, then the sheet in order.
  return [...groups.values()].sort((a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0));
}

export function CsvIssueList({
  t,
  issues,
  rowCount,
  formatNumber,
}: {
  t: T;
  issues: readonly InventoryCsvIssue[];
  rowCount: number;
  formatNumber: FormatNumber;
}) {
  const groups = groupByRow(issues);
  const badRows = groups.filter((group) => group.rowNumber !== null).length;
  return (
    <View testID="csv-issues" className="gap-3 rounded-2xl border border-error/30 bg-errorBg p-4">
      <View className="flex-row items-start gap-2">
        <Feather name="alert-circle" size={16} color={colors.error} />
        <View className="flex-1 gap-1">
          {badRows > 0 && rowCount > 0 ? (
            <Text testID="csv-issue-summary" className="font-sans-bold text-sm text-error">
              {fillText(t("csvIssueSummary"), { bad: formatNumber(badRows), total: formatNumber(rowCount) })}
            </Text>
          ) : null}
          <Text className="font-sans-semibold text-sm text-error">{t("csvIssuesTitle")}</Text>
        </View>
      </View>
      {groups.map((group) => (
        <View
          key={String(group.rowNumber)}
          testID={`csv-issue-row-${group.rowNumber ?? "file"}`}
          className="gap-1 rounded-xl bg-white p-3"
        >
          <Text className="font-sans-bold text-sm text-richBlack">
            {group.rowNumber === null
              ? t("csvIssueFileLevel")
              : `${t("csvRowLabel")} ${formatNumber(group.rowNumber)} · ${group.medicineName ?? t("csvNoName")}`}
          </Text>
          {group.issues.map((issue, index) => (
            <Text key={`${issue.code}-${issue.column ?? ""}-${index}`} className="font-sans text-xs text-error">
              • {issueLine(issue, t)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function CsvWarningList({
  t,
  warnings,
  formatNumber,
}: {
  t: T;
  warnings: readonly InventoryCsvWarning[];
  formatNumber: FormatNumber;
}) {
  if (warnings.length === 0) return null;
  return (
    <View testID="csv-warnings" className="gap-2 rounded-2xl border border-warning/40 bg-warningBg p-4">
      <View className="flex-row items-center gap-2">
        <Feather name="alert-triangle" size={16} color={colors.warning} />
        <Text className="flex-1 font-sans-semibold text-sm text-richBlack">{t("csvWarningsTitle")}</Text>
      </View>
      {warnings.map((warning) => (
        <View key={`${warning.rowNumber}-${warning.code}`} className="gap-0.5 rounded-xl bg-white p-3">
          <Text className="font-sans-bold text-sm text-richBlack">
            {`${t("csvRowLabel")} ${formatNumber(warning.rowNumber)} · ${warning.medicineName}`}
          </Text>
          <Text className="font-sans text-xs text-richBlack">
            {fillText(t("csvWarnSimilarCompany"), { value: warning.value, existing: warning.existing })}
          </Text>
        </View>
      ))}
    </View>
  );
}
