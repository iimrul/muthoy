import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { formatMoney } from "@muthoy/utils";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  listStaffSaleEvents,
  listStaffSales,
  type StaffSaleEvent,
  type StaffSalesSummary,
} from "../../db/saleHistory";
import { usePermission } from "../../state/usePermission";

export default function StaffSalesViewScreen() {
  const { session, isAllowed } = usePermission("staff_manage");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<StaffSalesSummary[]>([]);
  const [events, setEvents] = useState<StaffSaleEvent[]>([]);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<StaffSaleEvent["action"] | undefined>();
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!session || !isAllowed) return;
    try {
      const [summaries, audit] = await Promise.all([
        listStaffSales(
          session.shopId,
          session.userId,
          from || undefined,
          to || undefined,
        ),
        listStaffSaleEvents(session.shopId, session.userId, {
          fromBusinessDate: from || undefined,
          toBusinessDate: to || undefined,
          query,
          action,
        }),
      ]);
      setRows(summaries);
      setEvents(audit);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load staff sales.",
      );
    }
  }, [action, from, isAllowed, query, session, to]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  if (!session || !isAllowed) return <AccessDenied />;
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Staff sales" onBackPress={() => router.back()} />
      <View className="gap-3 p-4 pb-0">
        <View className="flex-row gap-3">
          <TextInput
            value={from}
            onChangeText={setFrom}
            placeholder="From YYYY-MM-DD"
            className="flex-1 rounded border border-midGray bg-white p-3"
          />
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="To YYYY-MM-DD"
            className="flex-1 rounded border border-midGray bg-white p-3"
          />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Invoice or staff"
          className="rounded border border-midGray bg-white p-3"
        />
        <View className="flex-row gap-2">
          {([undefined, "sale", "discount", "refund"] as const).map((value) => (
            <Pressable
              key={value ?? "all"}
              onPress={() => setAction(value)}
              className={`rounded-full px-3 py-2 ${action === value ? "bg-brand-green" : "bg-white"}`}
            >
              <Text className={action === value ? "text-white" : ""}>
                {value ?? "all"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error ? <Text className="p-4 text-error">{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.staffId}
        contentContainerClassName="flex-grow gap-3 p-4"
        onRefresh={reload}
        refreshing={false}
        ListHeaderComponent={
          <View className="gap-2 pb-2">
            {events.map((event) => (
              <View
                key={event.id}
                className="flex-row justify-between rounded bg-white p-3"
              >
                <Text>
                  {event.businessDate} · {event.actorName} · {event.action}
                </Text>
                <Text className="font-mono">{formatMoney(event.amount)}</Text>
              </View>
            ))}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No staff sales"
            message="No attributed sales in this period."
          />
        }
        renderItem={({ item }) => (
          <View className="gap-2 rounded-lg bg-white p-4">
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold">{item.staffName}</Text>
              <Text>{item.saleCount} sales</Text>
            </View>
            <View className="flex-row justify-between">
              <Text>Gross</Text>
              <Text>{formatMoney(item.grossSales)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text>Discounts</Text>
              <Text>-{formatMoney(item.discounts)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text>Refunds</Text>
              <Text>-{formatMoney(item.refunds)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold">Net</Text>
              <Text className="font-mono text-brand-green">
                {formatMoney(item.netSales)}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
