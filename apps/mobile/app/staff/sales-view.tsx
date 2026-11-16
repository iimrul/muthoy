import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { AppTextInput as TextInput } from "../../components/ui/AppTextInput";
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
import { userFacingError } from "../../i18n/display";
import { useI18n } from "../../state/localeStore";
import { useOwnerAccess } from "../../state/usePermission";

export default function StaffSalesViewScreen() {
  const { session, isAllowed } = useOwnerAccess();
  const { t, formatNumber } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<StaffSalesSummary[]>([]);
  const [events, setEvents] = useState<StaffSaleEvent[]>([]);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<StaffSaleEvent["action"] | undefined>();
  const [error, setError] = useState<string | null>(null);
  const actionLabel = (value: StaffSaleEvent["action"] | undefined) =>
    t(value === undefined ? "staffSalesAll" : value === "sale" ? "staffSalesSale" : value === "discount" ? "staffSalesDiscount" : "staffSalesRefund");
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
      setError(userFacingError(caught, "staffSalesLoadFailed", t));
    }
  }, [action, from, isAllowed, query, session, t, to]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  if (!session || !isAllowed) return <AccessDenied />;
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t("staffSales")} onBackPress={() => router.back()} />
      <View className="gap-3 p-4 pb-0">
        <View className="flex-row gap-3">
          <TextInput
            value={from}
            onChangeText={setFrom}
            placeholder={t("staffSalesFromDate")}
            className="flex-1 rounded border border-midGray bg-white p-3"
          />
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder={t("staffSalesToDate")}
            className="flex-1 rounded border border-midGray bg-white p-3"
          />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("staffSalesSearch")}
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
                {actionLabel(value)}
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
                  {event.businessDate} · {event.actorName} · {actionLabel(event.action)}
                </Text>
                <Text className="font-mono">{formatMoney(event.amount)}</Text>
              </View>
            ))}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={t("noStaffSales")}
            message={t("staffSalesEmptyPeriod")}
          />
        }
        renderItem={({ item }) => (
          <View className="gap-2 rounded-lg bg-white p-4">
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold">{item.staffName}</Text>
              <Text>{formatNumber(item.saleCount)} {t("staffSalesCount")}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text>{t("staffSalesGross")}</Text>
              <Text>{formatMoney(item.grossSales)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text>{t("staffSalesDiscounts")}</Text>
              <Text>-{formatMoney(item.discounts)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text>{t("staffSalesRefunds")}</Text>
              <Text>-{formatMoney(item.refunds)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold">{t("staffSalesNet")}</Text>
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
