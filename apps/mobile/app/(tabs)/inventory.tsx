import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { daysUntilExpiry } from "@muthoy/utils";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import type { CatalogKey } from "../../i18n/catalog";
import {
  archiveMedicine,
  listBatchesForMedicine,
  listMedicines,
  type BatchDetailRow,
  type MedicineListRow,
} from "../../db/inventory";
import { useI18n } from "../../state/localeStore";
import { userFacingError } from "../../i18n/display";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore } from "../../state/sessionStore";
import { useOwnerAccess, usePermission } from "../../state/usePermission";
import { useUnreadCount } from "../../state/useUnreadCount";

const FILTERS = [
  { value: "all", labelKey: "allLabel" },
  { value: "low", labelKey: "lowStock" },
  { value: "out", labelKey: "outOfStockLabel" },
  { value: "expiring", labelKey: "expiringSoonLabel" },
] as const;

const NEAR_EXPIRY_DAYS = 60;

// Inventory (list) — Volume 4 INVENTORY, Volume 0 Day 8, revised for the
// founder's Sales+Inventory prototype-parity recovery: rich per-medicine
// cards (status badge, stock heatmap, expandable FEFO batch table,
// inline Edit/Delete) matching the prototype's Inventory Management screen.
// Delete routes through db/inventory.ts's archiveMedicine — the same
// zero-stock/no-oversell/no-active-promotion safety check Edit Medicine's
// own Archive action uses, never a raw destructive delete.
export default function InventoryScreen() {
  const { t, formatNumber, formatDate, formatPercent, formatMoney } = useI18n();
  const session = useSessionStore((s) => s.session);
  const { isAllowed: canAddMedicine } = usePermission("inventory_add");
  const { isAllowed: canEditInventory } = usePermission("inventory_edit");
  const { isAllowed: canManageExpiry } = usePermission("expiry_manage");
  const { isAllowed: isOwner } = useOwnerAccess();
  const unreadCount = useUnreadCount(session?.shopId, session?.userId);
  const [medicines, setMedicines] = useState<MedicineListRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out" | "expiring">(
    "all",
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [batchesById, setBatchesById] = useState<
    Record<string, BatchDetailRow[]>
  >({});

  const reloadMedicines = useCallback(async () => {
    if (!session) {
      return;
    }
    setMedicines(await listMedicines(session.shopId));
  }, [session]);

  useEffect(() => {
    // Load-once-on-mount from SQLite, same pattern as app/staff/management.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadMedicines();
  }, [reloadMedicines]);

  if (!session) {
    return null;
  }
  const visible = medicines.filter((medicine) => {
    const matches =
      `${medicine.name} ${medicine.generic ?? ""} ${medicine.batchSearchText}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase());
    if (!matches) return false;
    if (filter === "out") return medicine.sellableStock === 0;
    if (filter === "low")
      return (
        medicine.sellableStock > 0 &&
        medicine.sellableStock < medicine.threshold
      );
    if (filter === "expiring") return medicine.hasExpiringStock;
    return true;
  });

  const toggleBatches = async (medicine: MedicineListRow) => {
    if (expandedId === medicine.medicineId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(medicine.medicineId);
    if (!batchesById[medicine.medicineId]) {
      const rows = await listBatchesForMedicine(
        session.shopId,
        medicine.medicineId,
      );
      setBatchesById((current) => ({ ...current, [medicine.medicineId]: rows }));
    }
  };

  const handleDelete = (medicine: MedicineListRow) => {
    Alert.alert(
      t("deleteLabel") + "?",
      medicine.name,
      [
        { text: t("cancelLabel"), style: "cancel" },
        {
          text: t("deleteLabel"),
          style: "destructive",
          onPress: () => {
            const guard = captureSessionFor(session);
            if (!guard) return;
            void archiveMedicine(
              session.shopId,
              session.userId,
              medicine.medicineId,
              guard.isStillActive,
            )
              .then(() => guard.ifLive(reloadMedicines))
              .catch((caught: unknown) =>
                guard.ifLive(() =>
                  Alert.alert(
                    t("medicineArchiveFailedTitle"),
                    userFacingError(
                      caught,
                      "medicineArchiveFailedLabel",
                      t,
                    ),
                  ),
                ),
              );
          },
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={t("inventoryManagementTitle")}
        onBellPress={() => router.push("/notifications")}
        unreadCount={unreadCount}
      />
      <View className="gap-3 px-4 pt-4">
        <View className="relative">
          <View className="absolute inset-y-0 left-3 z-10 items-center justify-center">
            <Feather name="search" size={18} color="#6B7280" />
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("searchByNameGenericBatchPlaceholder")}
            className="rounded-lg border border-midGray bg-white py-3 pl-10 pr-4"
          />
        </View>
        {canAddMedicine || canManageExpiry || isOwner ? (
          <View className="flex-row gap-2">
            {canAddMedicine ? (
              <Pressable
                onPress={() => router.push("/inventory/add-medicine")}
                accessibilityRole="button"
                accessibilityLabel={t("addStockLabel")}
                className="flex-1 flex-row items-center justify-center gap-2 rounded-lg bg-brand-green py-3 active:opacity-80"
              >
                <Feather name="plus-circle" size={16} color="#FFFFFF" />
                <Text className="font-sans-semibold text-sm text-white">
                  {t("addStockLabel")}
                </Text>
              </Pressable>
            ) : null}
            {canManageExpiry ? (
              <Pressable
                onPress={() => router.push("/inventory/expiry")}
                accessibilityRole="button"
                accessibilityLabel={t("expiryShortLabel")}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-brand-green bg-white py-3"
              >
                <Feather name="clock" size={15} color="#059669" />
                <Text className="font-sans-medium text-sm text-brand-green">
                  {t("expiryShortLabel")}
                </Text>
              </Pressable>
            ) : null}
            {isOwner ? (
              <Pressable
                onPress={() => router.push("/inventory/import")}
                accessibilityRole="button"
                accessibilityLabel={t("importCsvLabel")}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-brand-green bg-white py-3"
              >
                <Feather name="upload" size={15} color="#059669" />
                <Text className="font-sans-medium text-sm text-brand-green">
                  {t("importCsvLabel")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <View className="flex-row gap-2">
          {FILTERS.map(({ value, labelKey }) => {
            const count =
              value === "all"
                ? medicines.length
                : medicines.filter((medicine) =>
                    value === "out"
                      ? medicine.sellableStock === 0
                      : value === "low"
                        ? medicine.sellableStock > 0 &&
                          medicine.sellableStock < medicine.threshold
                        : medicine.hasExpiringStock,
                  ).length;
            const active = filter === value;
            return (
              <Pressable
                key={value}
                onPress={() => setFilter(value)}
                className={`flex-row items-center gap-1 rounded-full px-3 py-2 ${active ? "bg-brand-green" : "bg-white"}`}
              >
                <Text
                  className={`font-sans-medium text-xs ${active ? "text-white" : "text-richBlack"}`}
                >
                  {t(labelKey)}
                </Text>
                {count > 0 ? (
                  <View
                    className={`rounded-full px-1.5 ${active ? "bg-white/20" : "bg-brand-softGreen"}`}
                  >
                    <Text
                      className={`font-sans-bold text-[9px] ${active ? "text-white" : "text-brand-green"}`}
                    >
                      {formatNumber(count)}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.medicineId}
        className="flex-1"
        contentContainerClassName="flex-grow gap-3 p-4"
        onRefresh={reloadMedicines}
        refreshing={false}
        ListEmptyComponent={
          medicines.length === 0 ? (
            <EmptyState
              icon="package"
              title={t("inventoryEmptyTitle")}
              message={t("inventoryEmptyMessage")}
              actionLabel={
                canAddMedicine ? t("addFirstMedicineLabel") : undefined
              }
              onAction={
                canAddMedicine
                  ? () => router.push("/inventory/add-medicine")
                  : undefined
              }
            />
          ) : (
            <EmptyState
              icon="package"
              title={t("noResultsFoundTitle")}
              message={t("noResultsFoundMessage")}
            />
          )
        }
        renderItem={({ item }) => (
          <InventoryCard
            medicine={item}
            t={t}
            formatNumber={formatNumber}
            formatDate={formatDate}
            formatPercent={formatPercent}
            formatMoney={formatMoney}
            expanded={expandedId === item.medicineId}
            batches={batchesById[item.medicineId]}
            onToggleBatches={() => void toggleBatches(item)}
            onEdit={() =>
              router.push({
                pathname: "/inventory/edit-medicine",
                params: { medicineId: item.medicineId },
              })
            }
            onDelete={() => handleDelete(item)}
            canEdit={canEditInventory}
            onEditBatch={(batchId) =>
              router.push({
                pathname: "/inventory/edit-batch" as never,
                params: { medicineId: item.medicineId, batchId },
              })
            }
          />
        )}
      />
    </View>
  );
}

export function InventoryCard({
  medicine,
  t,
  formatNumber,
  formatDate,
  formatPercent,
  formatMoney,
  expanded,
  batches,
  onToggleBatches,
  onEdit,
  onDelete,
  canEdit,
  onEditBatch,
}: {
  medicine: MedicineListRow;
  t: (key: CatalogKey) => string;
  formatNumber: (value: number) => string;
  formatDate: (value: string | Date) => string;
  formatPercent: (value: number) => string;
  formatMoney: (value: BatchDetailRow["salePrice"]) => string;
  expanded: boolean;
  batches: BatchDetailRow[] | undefined;
  onToggleBatches: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  onEditBatch: (batchId: string) => void;
}) {
  const days = medicine.activeBatch
    ? daysUntilExpiry(medicine.activeBatch.expiryDate, new Date())
    : null;
  const expiryLabel =
    days === null
      ? "—"
      : days < 0
        ? "—"
        : `${formatNumber(days)}${t("daysShortSuffix")}`;
  const isOut = medicine.sellableStock === 0;
  const isExpiring =
    !isOut && days !== null && days >= 0 && days < NEAR_EXPIRY_DAYS;
  const isLow =
    !isOut && !isExpiring && medicine.sellableStock < medicine.threshold;

  const status = isOut
    ? { bg: "bg-[#ffdad6]", text: "text-[#93000a]", label: t("outOfStockLabel") }
    : isExpiring
      ? { bg: "bg-[#ffdad6]", text: "text-[#93000a]", label: `${formatNumber(days ?? 0)}${t("daysShortSuffix")}` }
      : isLow
        ? { bg: "bg-[#ffdbca]", text: "text-[#713610]", label: t("lowStock") }
        : { bg: "bg-[#95f2f1]", text: "text-[#004f4f]", label: t("statusOkLabel") };

  const heatmapPct = Math.min(
    (medicine.sellableStock / Math.max(medicine.threshold, 1)) * 100,
    100,
  );
  const heatmapColor = isOut
    ? "bg-[#ba1a1a]"
    : isLow || isExpiring
      ? "bg-[#84451e]"
      : "bg-brand-green";

  return (
    <View className="gap-3 rounded-2xl border border-[#e2e2e5]/10 bg-white p-4 shadow-sm">
      <View className="flex-row items-start justify-between gap-2">
        <View className={`h-12 w-12 items-center justify-center rounded-xl ${status.bg}`}>
          <Feather
            name="package"
            size={20}
            color={isOut ? "#93000a" : isLow || isExpiring ? "#713610" : "#004f4f"}
          />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="font-sans-bold text-base text-richBlack">
            {medicine.name}
          </Text>
          {medicine.generic ? (
            <Text className="font-sans-medium text-xs text-midGray">
              {t("genericNameLabel")}: {medicine.generic}
            </Text>
          ) : null}
          <Text className="font-sans text-xs text-midGray">
            {t("manufacturerLabel")}: {medicine.manufacturer ?? "—"}
          </Text>
          {medicine.activePromotionBps ? (
            <View className="mt-1 self-start flex-row items-center gap-1 rounded-full bg-brand-green px-2 py-0.5">
              <Feather name="tag" size={10} color="#FFFFFF" />
              <Text className="font-sans-bold text-[9px] uppercase tracking-wide text-white">
                {t("discountedLabel")} {formatPercent(medicine.activePromotionBps / 10_000)}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="items-end gap-1">
          <View className={`rounded-full px-2 py-0.5 ${status.bg}`}>
            <Text className={`font-sans-bold text-[10px] uppercase tracking-wider ${status.text}`}>
              {status.label}
            </Text>
          </View>
          <Text className="text-[10px] uppercase tracking-widest text-midGray">
            {t("thresholdLabel")}: {formatNumber(medicine.threshold)}
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2">
        <View className="flex-1 items-center rounded-lg bg-[#f3f3f6] p-2">
          <Text className="font-sans text-[10px] uppercase text-midGray">{t("currentLabel")}</Text>
          <Text
            className={`font-sans-extrabold text-lg ${isOut ? "text-[#ba1a1a]" : isLow || isExpiring ? "text-[#84451e]" : "text-brand-green"}`}
          >
            {formatNumber(medicine.sellableStock)}
          </Text>
        </View>
        <View className="flex-1 items-center rounded-lg bg-[#f3f3f6] p-2">
          <Text className="font-sans text-[10px] uppercase text-midGray">{t("batchesCountLabel")}</Text>
          <Text className="font-sans-extrabold text-lg text-richBlack">
            {formatNumber(medicine.batchCount)}
          </Text>
        </View>
        <View className="flex-1 items-center rounded-lg bg-[#f3f3f6] p-2">
          <Text className="font-sans text-[10px] uppercase text-midGray">{t("expiryShortLabel")}</Text>
          <Text className="font-sans-extrabold text-lg text-richBlack">{expiryLabel}</Text>
        </View>
      </View>

      <View className="h-1.5 overflow-hidden rounded-full bg-[#e8e8ea]">
        <View
          className={`h-full rounded-full ${heatmapColor}`}
          style={{ width: `${heatmapPct}%` }}
        />
      </View>

      <View className="flex-row gap-2">
        {medicine.batchCount > 1 ? (
          <Pressable
            onPress={onToggleBatches}
            className="flex-1 flex-row items-center justify-center gap-1 rounded-lg bg-[#cfe6f2] py-2.5"
          >
            <Text className="font-sans-semibold text-sm text-[#526772]">
              {t("viewBatchesLabel")}
            </Text>
            <Feather
              name={expanded ? "chevron-up" : "chevron-down"}
              size={14}
              color="#526772"
            />
          </Pressable>
        ) : null}
        {canEdit ? (
          <>
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel={t("editLabel")}
              className="h-10 w-10 items-center justify-center rounded-lg bg-[#e8e8ea]"
            >
              <Feather name="edit-2" size={16} color="#3e4949" />
            </Pressable>
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={t("deleteLabel")}
              className="h-10 w-10 items-center justify-center rounded-lg bg-[#e8e8ea]"
            >
              <Feather name="trash-2" size={16} color="#DC2626" />
            </Pressable>
          </>
        ) : null}
      </View>

      {expanded && batches ? (
        <View className="overflow-hidden rounded-xl border border-[#bdc9c8]/30">
          <View className="flex-row bg-[#e8e8ea] px-2 py-1.5">
            <Text className="flex-1 font-sans-bold text-[9px] uppercase text-midGray">{t("batchNoColumnLabel")}</Text>
            <Text className="flex-1 font-sans-bold text-[9px] uppercase text-midGray">{t("expiryShortLabel")}</Text>
            <Text className="w-12 text-right font-sans-bold text-[9px] uppercase text-midGray">{t("qtyColumnLabel")}</Text>
            <Text className="w-16 text-right font-sans-bold text-[9px] uppercase text-midGray">{t("priceColumnLabel")}</Text>
            {canEdit ? <View className="w-8" /> : null}
          </View>
          {batches.map((batch) => {
            const batchDays = daysUntilExpiry(batch.expiryDate, new Date());
            const batchNear =
              batchDays !== null && batchDays >= 0 && batchDays < NEAR_EXPIRY_DAYS;
            const batchExpired = batchDays !== null && batchDays < 0;
            const isActiveBatch = batch.id === medicine.activeBatch?.id;
            const batchExpiryLabel = batch.expiryDate
              ? `${formatDate(batch.expiryDate)} (${batchExpired ? t("expiredLabel") : `${formatNumber(batchDays ?? 0)}${t("daysShortSuffix")}`})`
              : "—";
            return (
              <View
                key={batch.id}
                className={`flex-row items-center px-2 py-2 ${isActiveBatch ? "bg-brand-softGreen/50" : ""}`}
              >
                <View className="flex-1 flex-row items-center gap-1">
                  <Text className="font-sans-bold text-xs text-richBlack">#{batch.batchNo}</Text>
                  {isActiveBatch ? (
                    <View
                      accessible
                      accessibilityLabel={`${t("activeBatchLabel")} ${batch.batchNo}`}
                      className="rounded-full bg-brand-green px-1.5 py-0.5"
                    >
                      <Text className="font-sans-bold text-[8px] uppercase text-white">{t("activeBatchLabel")}</Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  className={`flex-1 font-sans text-xs ${batchNear || batchExpired ? "font-sans-semibold text-error" : "text-richBlack"}`}
                >
                  {batchExpiryLabel}
                </Text>
                <Text className="w-12 text-right font-sans-bold text-xs text-richBlack">
                  {formatNumber(batch.quantityAvailable)}
                </Text>
                <Text className="w-16 text-right font-mono text-xs text-richBlack">
                  {formatMoney(batch.salePrice)}
                </Text>
                {canEdit ? (
                  <Pressable
                    onPress={() => onEditBatch(batch.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("editLabel")} ${batch.batchNo}`}
                    className="ml-1 h-8 w-8 items-center justify-center rounded-lg bg-white"
                  >
                    <Feather name="edit-2" size={13} color="#059669" />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
