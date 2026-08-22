import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { daysUntilExpiry, formatNumber } from "@muthoy/utils";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { listMedicines, type MedicineListRow } from "../../db/inventory";
import { useSessionStore } from "../../state/sessionStore";
import { useUnreadCount } from "../../state/useUnreadCount";

// Inventory (list) — Volume 4 INVENTORY, Volume 0 Day 8. Lists medicines —
// name, current total stock, batch count, active-batch expiry countdown
// (db/inventory.ts's listMedicines, which resolves the active batch via
// domain/fefo.activeBatch). Tapping a row opens app/inventory/batches.tsx;
// the FAB opens app/inventory/add-medicine.tsx.
export default function InventoryScreen() {
  const session = useSessionStore((s) => s.session);
  const unreadCount = useUnreadCount(session?.shopId, session?.userId);
  const [medicines, setMedicines] = useState<MedicineListRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out" | "expiring">(
    "all",
  );

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

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title="Inventory"
        onBellPress={() => router.push("/notifications")}
        unreadCount={unreadCount}
      />
      <View className="gap-3 px-4 pt-4">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search medicine, generic, or batch"
          className="rounded-lg border border-midGray bg-white px-4 py-3"
        />
        <View className="flex-row gap-2">
          {(["all", "low", "out", "expiring"] as const).map((value) => {
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
            return (
              <Pressable
                key={value}
                onPress={() => setFilter(value)}
                className={`rounded-full px-3 py-2 ${filter === value ? "bg-brand-green" : "bg-white"}`}
              >
                <Text className={filter === value ? "text-white" : ""}>
                  {value === "out" ? "Out" : value} {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => router.push("/inventory/expiry")}
            className="flex-1 items-center rounded-lg border border-brand-green bg-white py-3"
          >
            <Text className="text-brand-green">Expiry</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/inventory/import")}
            className="flex-1 items-center rounded-lg border border-brand-green bg-white py-3"
          >
            <Text className="text-brand-green">Import CSV</Text>
          </Pressable>
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
          <EmptyState
            title="No medicines yet"
            message="Add your first medicine to start tracking stock."
            actionLabel="Add medicine"
            onAction={() => router.push("/inventory/add-medicine")}
          />
        }
        renderItem={({ item }) => <InventoryRow medicine={item} />}
      />
      <Pressable
        onPress={() => router.push("/inventory/add-medicine")}
        accessibilityRole="button"
        accessibilityLabel="Add medicine"
        className="absolute bottom-6 right-6 h-14 w-14 items-center justify-center rounded-full bg-brand-green active:opacity-80"
      >
        <Text className="font-sans-bold text-2xl text-white">+</Text>
      </Pressable>
    </View>
  );
}

function InventoryRow({ medicine }: { medicine: MedicineListRow }) {
  const days = medicine.activeBatch
    ? daysUntilExpiry(medicine.activeBatch.expiryDate, new Date())
    : null;
  const expiryLabel =
    days === null ? "—" : days < 0 ? "Expired" : `${formatNumber(days)}d`;

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/inventory/batches",
          params: { medicineId: medicine.medicineId },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={medicine.name}
      className="flex-row items-center justify-between rounded-lg bg-white p-4 active:opacity-80"
    >
      <View className="flex-1 gap-1 pr-3">
        <Text className="font-sans-medium text-base text-richBlack">
          {medicine.name}
        </Text>
        {medicine.generic ? (
          <Text className="font-sans text-xs text-midGray">
            {medicine.generic}
          </Text>
        ) : null}
      </View>
      <View className="items-end gap-1">
        <Text className="font-sans text-base text-richBlack">
          {formatNumber(medicine.sellableStock)} sellable
        </Text>
        <Text className="font-sans text-xs text-midGray">
          {formatNumber(medicine.batchCount)} batch
          {medicine.batchCount === 1 ? "" : "es"} · {expiryLabel}
        </Text>
        {medicine.activePromotionBps ? (
          <Text className="text-xs text-brand-green">
            {medicine.activePromotionBps / 100}% promotion
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
