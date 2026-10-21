import { useCallback, useEffect, useState } from "react";
import {
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
import { useI18n } from "../../state/localeStore";
import { ownKey, userFacingError } from "../../i18n/display";
import type { CatalogKey } from "../../i18n/catalog";
import { showToast } from "../../components/ui/Toast";

/**
 * The payment type as the owner reads it, not as the column stores it.
 *
 * `sales.payment_type` is an enum slug (`cash`/`credit`/`split`/`free`) and a
 * held draft has none at all. Rendering the slug raw was D9's defect: a
 * Bangla-first screen showing "credit" is the same bug as showing "Credit".
 */
const PAYMENT_TYPE_KEYS: Record<string, CatalogKey> = {
  cash: "paymentTypeCash",
  credit: "paymentTypeCredit",
  split: "paymentTypeSplit",
  free: "paymentTypeFree",
};

/**
 * db/refunds.ts answers ineligibility with English prose, not a code.
 *
 * Changing that contract touches refund logic, which CLAUDE.md rule 10 puts
 * behind an approved plan, so the mapping lives here instead. It is pinned by
 * tests/localization-and-ui-consistency.test.ts, which reads
 * getRefundEligibility's own literals and fails if one is not mapped — so a new
 * reason cannot silently appear in English.
 */
/**
 * The sale status as a word, not a column value.
 *
 * `sales.status` is an enum slug. Rendering it raw put "completed" and
 * "refunded" on a Bangla screen — the same defect as a hardcoded English
 * string, and one a literal-scanning test cannot see, so the test instead
 * checks this map against the SaleHistoryStatus union itself.
 */
/**
 * `medicines.unit_of_measure` is free text the shopkeeper types, so it is NOT
 * translated — their own words are already in their language. Only the value
 * the SCHEMA supplies by default is ours to translate, and a shop that never
 * edits it would otherwise read "piece" on a Bangla screen forever.
 */
const SYSTEM_UNIT_KEYS: Record<string, CatalogKey> = {
  piece: "unitPiece",
};

const STATUS_KEYS: Record<string, CatalogKey> = {
  completed: "statusCompleted",
  refunded: "statusRefunded",
  held: "statusHeld",
  cancelled: "statusCancelled",
};

const REFUND_REASON_KEYS: Record<string, CatalogKey> = {
  "Sale not found": "refundReasonSaleNotFound",
  "Sale already refunded": "refundReasonAlreadyRefunded",
  "Refund window has expired": "refundReasonWindowExpired",
  "Customer credit history requires reconciliation":
    "refundReasonCreditReconcile",
};

export default function SalesHistoryScreen() {
  const { t } = useI18n();
  const paymentLabel = (type: string | null | undefined): string =>
    t((type ? ownKey(PAYMENT_TYPE_KEYS, type) : undefined) ?? "paymentTypeDraft");
  const unitLabel = (unit: string | null | undefined): string => {
    if (!unit) return "";
    const key = ownKey(SYSTEM_UNIT_KEYS, unit);
    return key ? t(key) : unit;
  };
  const statusLabel = (value: string | null | undefined): string =>
    t((value ? ownKey(STATUS_KEYS, value) : undefined) ?? "statusAll");
  const refundReasonLabel = (reason: string | null | undefined): string =>
    reason ? t(ownKey(REFUND_REASON_KEYS, reason) ?? "notRefundable") : t("notRefundable");
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
        userFacingError(caught, "couldNotLoadSales", t),
      );
    }
  }, [fromDate, query, session, status, toDate, t]);
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
        userFacingError(caught, "couldNotLoadSale", t),
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
      setRefundMessage(t("refundReasonRequired"));
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) return;
    setRefunding(true);
    setRefundMessage(null);
    try {
      const connected = await hasNetworkConnection();
      setOnline(connected);
      if (!connected) throw new Error(t("refundNeedsInternet"));
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
      // W3-10. A success confirmation is exactly what the shared Toast is for:
      // it does not block the till on an OK tap after a refund that already
      // committed. The failure Alert below keeps its dialog deliberately —
      // Toast.tsx's own contract says a toast is never how a failure is
      // reported, because it disappears before it can be acted on.
      showToast({
        variant: "card",
        label: t("refundCommittedTitle"),
        message: t("refundCommittedBody"),
      });
    } catch (caught) {
      if (!guard.isStale())
        setRefundMessage(
          userFacingError(caught, "refundFailed", t),
        );
    } finally {
      setRefunding(false);
    }
  };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t("salesHistoryTitle")} onBackPress={() => router.back()} />
      <View className="gap-3 p-4 pb-0">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("salesHistorySearchPlaceholder")}
          className="rounded-lg border border-midGray bg-white p-3"
        />
        <View className="flex-row gap-2">
          <TextInput
            value={fromDate}
            onChangeText={setFromDate}
            placeholder={t("dateFromPlaceholder")}
            className="flex-1 rounded border border-midGray bg-white p-3"
          />
          <TextInput
            value={toDate}
            onChangeText={setToDate}
            placeholder={t("dateToPlaceholder")}
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
                  {statusLabel(value)}
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
            title={t("noSalesFound")}
            message={t("salesHistoryEmptyBody")}
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
              {paymentLabel(item.paymentType)}
            </Text>
            <Text
              className={
                item.status === "refunded" || item.status === "cancelled"
                  ? "text-error"
                  : "text-midGray"
              }
            >
              {statusLabel(item.status)}
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
            title={detail?.invoiceNo ?? t("saleFallbackTitle")}
            onBackPress={() => setDetail(null)}
          />
          {detail ? (
            <ScrollView contentContainerClassName="gap-3 p-4">
              <View className="rounded-lg bg-white p-4">
                <Text>
                  {detail.businessDate} · {detail.sellerName}
                </Text>
                <Text>{detail.customerName ?? t("walkInCustomer")}</Text>
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
                    {t("batchLabel")} {item.batchNo} · {item.quantity}{' '}
                    {unitLabel(item.unit)}
                  </Text>
                </View>
              ))}
              {detail.prescriptionNo ||
              detail.patientName ||
              detail.prescriberName ? (
                <View className="rounded-lg bg-white p-4">
                  <Text className="font-sans-semibold">{t("prescriptionLabel")}</Text>
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
                      placeholder={t("refundReasonPlaceholder")}
                      accessibilityLabel={t("refundReasonLabel")}
                      multiline
                      className="rounded-lg border border-midGray bg-white p-3"
                    />
                  ) : null}
                  <Pressable
                    onPress={() => void refund()}
                    disabled={!online || !eligibility?.eligible || refunding}
                    accessibilityLabel={t("fullRefundLabel")}
                    className="items-center rounded-lg bg-error py-4 disabled:opacity-40"
                  >
                    <Text className="text-white">
                      {refunding ? t("refundClaimingAuthority") : t("fullRefundLabel")}
                    </Text>
                  </Pressable>
                  {!online ? (
                    <Text className="text-center text-error">
                      {t("refundNeedsInternet")}
                    </Text>
                  ) : !eligibility?.eligible ? (
                    <Text className="text-center text-error">
                      {refundReasonLabel(eligibility?.reason)}
                    </Text>
                  ) : (
                    <Text className="text-center text-xs text-midGray">
                      {t("refundServerAuthorityNote")}
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
