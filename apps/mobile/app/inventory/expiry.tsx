import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { formatNumber } from "@muthoy/utils";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  listBatchesByExpiry,
  reverseBatchPromotion,
  setBatchPromotion,
  setBulkBatchPromotion,
  type ExpiryListRow,
} from "../../db/inventory";
import { getB2Settings, type B2Settings } from "../../db/settings";
import { expiryBand, type ExpiryBand } from "../../domain/inventoryRules";
import type { ExpiryStatus } from "../../domain/notificationRules";
import { useSessionStore } from "../../state/sessionStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { usePermission } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";

// Expiry Management — Volume 0 Day 9. Every non-deleted batch for this shop,
// nearest REAL expiry date first (CLAUDE.md rule 3 — recomputed at read
// time, db/inventory.ts's listBatchesByExpiry, never a stored day-count).
// Read-only: no money/stock mutation, no Supabase/network reads — SQLite via
// db/inventory.ts only.
//
// Near/Far bands use the shop's B2 settings (30/60-day defaults).
const STATUS_LABEL: Record<ExpiryStatus, string> = {
  expired: "Expired",
  critical: "Critical",
  warning: "Soon",
  ok: "OK",
  unknown: "No expiry",
};

// Reuses the existing error/warning/success tokens (@muthoy/constants) —
// no new colors invented for this screen.
const STATUS_CLASSES: Record<ExpiryStatus, string> = {
  expired: "bg-error",
  critical: "bg-errorBg",
  warning: "bg-warningBg",
  ok: "bg-brand-softGreen",
  unknown: "bg-brand-softGreen",
};

const STATUS_TEXT_CLASSES: Record<ExpiryStatus, string> = {
  expired: "text-white",
  critical: "text-error",
  warning: "text-warning",
  ok: "text-success",
  unknown: "text-midGray",
};

export default function ExpiryManagementScreen() {
  const session = useSessionStore((state) => state.session);
  const { isAllowed: canManageExpiry } = usePermission("expiry_manage");
  const { isAllowed: canDiscount } = usePermission("sale_discount");
  const [rows, setRows] = useState<ExpiryListRow[]>([]);
  const [settings, setSettings] = useState<B2Settings | null>(null);
  const [filter, setFilter] = useState<"all" | ExpiryBand>("all");
  const [selected, setSelected] = useState<ExpiryListRow | null>(null);
  const [percent, setPercent] = useState("");

  const reload = useCallback(async () => {
    if (!session) {
      return;
    }
    const [nextRows, nextSettings] = await Promise.all([
      listBatchesByExpiry(session.shopId),
      getB2Settings(session.shopId),
    ]);
    setRows(nextRows);
    setSettings(nextSettings);
  }, [session]);

  useEffect(() => {
    // SQLite load-on-mount, same pattern as the sibling inventory screens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (!session) {
    return null;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Expiry" onBackPress={() => router.back()} />
      <View className="flex-row flex-wrap gap-2 px-4 pt-4">
        {(["all", "expired", "near", "far", "later", "unknown"] as const).map(
          (value) => (
            <Pressable
              key={value}
              onPress={() => setFilter(value)}
              className={`rounded-full px-3 py-2 ${filter === value ? "bg-brand-green" : "bg-white"}`}
            >
              <Text className={filter === value ? "text-white" : ""}>
                {value}
              </Text>
            </Pressable>
          ),
        )}
      </View>
      {canManageExpiry &&
      canDiscount &&
      (filter === "near" || filter === "far") ? (
        <View className="flex-row gap-2 px-4 pt-3">
          <TextInput
            value={percent}
            onChangeText={setPercent}
            keyboardType="decimal-pad"
            placeholder="Bulk %"
            className="flex-1 rounded border border-midGray bg-white p-3"
          />
          <Pressable
            onPress={async () => {
              const guard = captureSessionFor(session);
              if (!guard) return;
              try {
                const eligible = rows.filter(
                  (row) =>
                    expiryBand(
                      row.daysUntilExpiry,
                      settings?.expiryNearDays,
                      settings?.expiryFarDays,
                    ) === filter,
                );
                await setBulkBatchPromotion({
                  shopId: session.shopId,
                  actorUserId: session.userId,
                  batchIds: eligible.map((row) => row.id),
                  discountBps: Math.round(Number(percent) * 100),
                  isStillActive: guard.isStillActive,
                });
                void triggerSyncNow(session.shopId);
                await reload();
              } catch (caught) {
                Alert.alert(
                  "Cannot apply bulk promotion",
                  caught instanceof Error ? caught.message : "Try again.",
                );
              }
            }}
            className="justify-center rounded bg-brand-green px-4"
          >
            <Text className="text-white">Apply to {filter}</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={rows.filter(
          (row) =>
            filter === "all" ||
            expiryBand(
              row.daysUntilExpiry,
              settings?.expiryNearDays,
              settings?.expiryFarDays,
            ) === filter,
        )}
        keyExtractor={(item) => item.id}
        className="flex-1"
        contentContainerClassName="flex-grow gap-3 p-4"
        onRefresh={reload}
        refreshing={false}
        ListEmptyComponent={
          <EmptyState
            title="No batches yet"
            message="Batches you add to medicines will show up here, nearest expiry first."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            disabled={
              !canManageExpiry ||
              !canDiscount ||
              !["critical", "warning"].includes(item.status)
            }
            onPress={() => setSelected(item)}
          >
            <ExpiryRow row={item} />
          </Pressable>
        )}
      />
      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="gap-3 rounded-t-2xl bg-white p-5">
            <Text className="font-sans-bold">Batch promotion</Text>
            <Text>
              {selected?.medicineName} · {selected?.batchNo}
            </Text>
            <TextInput
              value={percent}
              onChangeText={setPercent}
              keyboardType="decimal-pad"
              placeholder="Discount percent"
              className="rounded border border-midGray p-3"
            />
            <Pressable
              onPress={async () => {
                if (!selected) return;
                const guard = captureSessionFor(session);
                if (!guard) return;
                try {
                  const basisPoints = Math.round(Number(percent) * 100);
                  await setBatchPromotion({
                    shopId: session.shopId,
                    actorUserId: session.userId,
                    batchId: selected.id,
                    discountBps: basisPoints,
                    isStillActive: guard.isStillActive,
                  });
                  void triggerSyncNow(session.shopId);
                  setSelected(null);
                  await reload();
                } catch (caught) {
                  Alert.alert(
                    "Cannot promote batch",
                    caught instanceof Error ? caught.message : "Try again.",
                  );
                }
              }}
              className="items-center rounded bg-brand-green py-3"
            >
              <Text className="text-white">Set promotion</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!selected) return;
                const guard = captureSessionFor(session);
                if (!guard) return;
                try {
                  await reverseBatchPromotion(
                    session.shopId,
                    session.userId,
                    selected.id,
                    guard.isStillActive,
                  );
                  void triggerSyncNow(session.shopId);
                  setSelected(null);
                  await reload();
                } catch (caught) {
                  Alert.alert(
                    "Cannot reverse promotion",
                    caught instanceof Error ? caught.message : "Try again.",
                  );
                }
              }}
              className="items-center rounded border border-error py-3"
            >
              <Text className="text-error">Reverse active promotion</Text>
            </Pressable>
            <Pressable
              onPress={() => setSelected(null)}
              className="items-center p-2"
            >
              <Text>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ExpiryRow({ row }: { row: ExpiryListRow }) {
  return (
    <View className="gap-1 rounded-lg bg-white p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <Text className="font-sans-medium text-base text-richBlack">
            {row.medicineName}
          </Text>
          <Text className="font-sans text-xs text-midGray">
            Batch {row.batchNo}
          </Text>
        </View>
        <View
          className={`rounded-full px-3 py-1 ${STATUS_CLASSES[row.status]}`}
        >
          <Text
            className={`font-sans-semibold text-xs ${STATUS_TEXT_CLASSES[row.status]}`}
          >
            {STATUS_LABEL[row.status]}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-xs text-midGray">
          {row.expiryDate ?? "No expiry date recorded"}
        </Text>
        <Text className="font-sans text-sm text-richBlack">
          {formatNumber(row.quantityAvailable)} left
        </Text>
      </View>
    </View>
  );
}
