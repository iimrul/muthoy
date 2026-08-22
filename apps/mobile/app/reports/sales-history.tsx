import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { formatMoney } from "@muthoy/utils";
import { EmptyState } from "../../components/ui/EmptyState";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  createFullSaleRefund,
  getRefundEligibility,
  type RefundEligibility,
} from "../../db/refunds";
import {
  getSaleDetail,
  listSalesHistory,
  type SaleDetail,
  type SaleHistoryRow,
  type SaleHistoryStatus,
} from "../../db/saleHistory";
import { hasNetworkConnection } from "../../sync/connectivity";
import { claimRefundAuthority, triggerSyncNow } from "../../sync";
import { getDeviceId } from "../../native/deviceId";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore } from "../../state/sessionStore";
import { usePermission } from "../../state/usePermission";

export default function SalesHistoryScreen() {
  const session = useSessionStore((state) => state.session);
  const { isAllowed: canRefund } = usePermission("sale_return");
  const [rows, setRows] = useState<SaleHistoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SaleHistoryStatus | undefined>();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [eligibility, setEligibility] = useState<RefundEligibility | null>(
    null,
  );
  const [online, setOnline] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundMessage, setRefundMessage] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!session) return;
    try {
      setRows(
        await listSalesHistory(session.shopId, session.userId, {
          query,
          status,
          fromBusinessDate: fromDate || undefined,
          toBusinessDate: toDate || undefined,
        }),
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load sales.",
      );
    }
  }, [fromDate, query, session, status, toDate]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  if (!session) return null;
  const open = async (saleId: string) => {
    try {
      const [sale, refundEligibility, connected] = await Promise.all([
        getSaleDetail(session.shopId, session.userId, saleId),
        canRefund
          ? getRefundEligibility(session.shopId, session.userId, saleId)
          : Promise.resolve(null),
        hasNetworkConnection(),
      ]);
      setDetail(sale);
      setEligibility(refundEligibility);
      setOnline(connected);
      setRefundReason("");
      setRefundMessage(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load sale.",
      );
    }
  };
  const loadMore = async () => {
    const last = rows.at(-1);
    if (!last) return;
    const next = await listSalesHistory(session.shopId, session.userId, {
      query,
      status,
      fromBusinessDate: fromDate || undefined,
      toBusinessDate: toDate || undefined,
      beforeCreatedAt: last.createdAt,
      beforeId: last.id,
    });
    setRows((current) => [...current, ...next]);
  };
  const refund = async () => {
    if (!canRefund || !detail || !eligibility?.eligible || refunding) return;
    const reason = refundReason.trim();
    if (!reason) {
      setRefundMessage("Refund reason is required.");
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) return;
    setRefunding(true);
    setRefundMessage(null);
    try {
      const connected = await hasNetworkConnection();
      setOnline(connected);
      if (!connected) throw new Error("Internet required for refund");
      const deviceId = getDeviceId();
      const claim = await claimRefundAuthority({
        shopId: session.shopId,
        saleId: detail.id,
        operationId: eligibility.operationId,
        deviceId,
      });
      await createFullSaleRefund({
        shopId: session.shopId,
        actorUserId: session.userId,
        saleId: detail.id,
        reason,
        claim,
        currentDeviceId: deviceId,
        isStillActive: guard.isStillActive,
      });
      if (guard.isStale()) return;
      triggerSyncNow(session.shopId);
      setDetail(null);
      await reload();
      Alert.alert(
        "Refund committed",
        "The full-sale refund is recorded. Complete any physical payout now.",
      );
    } catch (caught) {
      if (!guard.isStale())
        setRefundMessage(
          caught instanceof Error ? caught.message : "Refund failed.",
        );
    } finally {
      setRefunding(false);
    }
  };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Sales history" onBackPress={() => router.back()} />
      <View className="gap-3 p-4 pb-0">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Invoice, customer, or seller"
          className="rounded-lg border border-midGray bg-white p-3"
        />
        <View className="flex-row gap-2">
          <TextInput
            value={fromDate}
            onChangeText={setFromDate}
            placeholder="From YYYY-MM-DD"
            className="flex-1 rounded border border-midGray bg-white p-3"
          />
          <TextInput
            value={toDate}
            onChangeText={setToDate}
            placeholder="To YYYY-MM-DD"
            className="flex-1 rounded border border-midGray bg-white p-3"
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {(
              [undefined, "completed", "refunded", "held", "cancelled"] as const
            ).map((value) => (
              <Pressable
                key={value ?? "all"}
                onPress={() => setStatus(value)}
                className={`rounded-full px-4 py-2 ${status === value ? "bg-brand-green" : "bg-white"}`}
              >
                <Text className={status === value ? "text-white" : ""}>
                  {value ?? "all"}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
      {error ? <Text className="p-4 text-error">{error}</Text> : null}
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerClassName="flex-grow gap-3 p-4"
        onRefresh={reload}
        refreshing={false}
        onEndReached={() => void loadMore()}
        ListEmptyComponent={
          <EmptyState
            title="No sales found"
            message="Completed and draft sale events appear here."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              item.status === "held" || item.status === "cancelled"
                ? router.push("/sale/held")
                : void open(item.id)
            }
            className="gap-1 rounded-lg bg-white p-4"
          >
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold">{item.invoiceNo}</Text>
              <Text className="font-mono text-brand-green">
                {formatMoney(item.total)}
              </Text>
            </View>
            <Text className="text-xs text-midGray">
              {item.businessDate} · {item.sellerName} ·{" "}
              {item.paymentType ?? "draft"}
            </Text>
            <Text
              className={
                item.status === "refunded" || item.status === "cancelled"
                  ? "text-error"
                  : "text-midGray"
              }
            >
              {item.status}
            </Text>
          </Pressable>
        )}
      />
      <Modal
        visible={detail !== null}
        animationType="slide"
        onRequestClose={() => setDetail(null)}
      >
        <View className="flex-1 bg-brand-softGreen">
          <StandardHeader
            title={detail?.invoiceNo ?? "Sale"}
            onBackPress={() => setDetail(null)}
          />
          {detail ? (
            <ScrollView contentContainerClassName="gap-3 p-4">
              <View className="rounded-lg bg-white p-4">
                <Text>
                  {detail.businessDate} · {detail.sellerName}
                </Text>
                <Text>{detail.customerName ?? "Walk-in customer"}</Text>
                <Text className="mt-2 font-mono text-xl">
                  {formatMoney(detail.total)}
                </Text>
              </View>
              {detail.items.map((item) => (
                <View key={item.id} className="rounded-lg bg-white p-4">
                  <View className="flex-row justify-between">
                    <Text>{item.medicineName}</Text>
                    <Text>{formatMoney(item.lineTotal)}</Text>
                  </View>
                  <Text className="text-xs text-midGray">
                    Batch {item.batchNo} · {item.quantity} {item.unit}
                  </Text>
                </View>
              ))}
              {detail.prescriptionNo ||
              detail.patientName ||
              detail.prescriberName ? (
                <View className="rounded-lg bg-white p-4">
                  <Text className="font-sans-semibold">Prescription</Text>
                  <Text>
                    {detail.prescriptionNo ?? "—"} · {detail.patientName ?? "—"}{" "}
                    · {detail.prescriberName ?? "—"}
                  </Text>
                </View>
              ) : null}
              {canRefund ? (
                <>
                  {online && eligibility?.eligible ? (
                    <TextInput
                      value={refundReason}
                      onChangeText={setRefundReason}
                      placeholder="Refund reason (required)"
                      accessibilityLabel="Refund reason"
                      multiline
                      className="rounded-lg border border-midGray bg-white p-3"
                    />
                  ) : null}
                  <Pressable
                    onPress={() => void refund()}
                    disabled={!online || !eligibility?.eligible || refunding}
                    accessibilityLabel="Full refund"
                    className="items-center rounded-lg bg-error py-4 disabled:opacity-40"
                  >
                    <Text className="text-white">
                      {refunding ? "Claiming authority…" : "Full refund"}
                    </Text>
                  </Pressable>
                  {!online ? (
                    <Text className="text-center text-error">
                      Internet required for refund
                    </Text>
                  ) : !eligibility?.eligible ? (
                    <Text className="text-center text-error">
                      {eligibility?.reason ?? "Not refundable."}
                    </Text>
                  ) : (
                    <Text className="text-center text-xs text-midGray">
                      Server authority is claimed before the local refund
                      commits.
                    </Text>
                  )}
                  {refundMessage ? (
                    <Text className="text-center text-error">
                      {refundMessage}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
