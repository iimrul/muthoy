import { memo, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SectionList,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { router } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { colors } from "@muthoy/constants";
import { formatMoney } from "@muthoy/utils";
import { AppTextInput as TextInput } from "../../components/ui/AppTextInput";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  listExpiringBatches,
  reverseBatchPromotion,
  setBatchPromotion,
  setBulkBatchPromotion,
  type ExpiringBand,
  type ExpiringBatchRow,
  type ExpiringBatches,
} from "../../db/inventory";
import { effectiveUnitPrice } from "../../domain/pricing";
import type { CatalogKey } from "../../i18n/catalog";
import { fillTemplate, ownKey, userFacingError } from "../../i18n/display";
import { useFocusRefresh } from "../../navigation/useFocusRefresh";
import { useI18n } from "../../state/localeStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore } from "../../state/sessionStore";
import { useOwnerAccess, usePermission } from "../../state/usePermission";
import { triggerSyncNow } from "../../sync";

// Expiry Management, laid out after the prototype's ExpiryManagement screen
// (reference only, CLAUDE.md rule 15): two summary cards, an Urgent and a
// Warning section of batch cards, and one bulk-discount action. The rows come
// from listExpiringBatches — only stocked batches past or inside the shop's
// Far window, banded from the REAL expiry date (rule 3). SQLite only (rule 1).

const PENDING = "—";
const PRESET_PERCENTS = [10, 20, 30, 50] as const;
const MAX_PERCENT = 100;
// AppNavigationShell draws an h-20 (80) bar over the bottom of every page,
// with the Scan button rising above it. The bulk action floats clear of both,
// where Sale's cart button sits, and the list scrolls clear of whichever is lower.
const SHELL_NAV_HEIGHT = 80;
const FAB_BOTTOM = SHELL_NAV_HEIGHT + 24;
const FAB_CLEARANCE = FAB_BOTTOM + 72;
const LIST_CLEARANCE = SHELL_NAV_HEIGHT + 24;

/** Every band a row can carry has a name (localization test reads this map). */
const BAND_CHIP_KEYS: Record<ExpiringBand, CatalogKey> = {
  expired: "expiredLabel",
  near: "expiryUrgentTitle",
  far: "expiryWarningTitle",
};

interface Tone {
  accent: string;
  tint: string;
  ink: string;
}
const URGENT: Tone = { accent: colors.error, tint: colors.authErrorCard, ink: colors.noticeErrorInk };
const WARNING: Tone = { accent: colors.warning, tint: colors.warningBg, ink: colors.authWarningInk };
const BAND_TONE: Record<ExpiringBand, Tone> = { expired: URGENT, near: URGENT, far: WARNING };

type MciName = keyof typeof MaterialCommunityIcons.glyphMap;
/** The card's icon follows the dosage form, as the prototype's does. */
function formIcon(form: string | null): MciName {
  const value = (form ?? "").toLowerCase();
  if (value.includes("syrup") || value.includes("suspension") || value.includes("drop")) return "bottle-tonic-outline";
  if (value.includes("inject") || value.includes("vial")) return "needle";
  if (value.includes("tablet") || value.includes("capsule")) return "pill";
  return "medical-bag";
}

// Module scope, so no style object is rebuilt per render or per row.
const CARD_SHADOW: ViewStyle = {
  elevation: 1,
  shadowColor: colors.richBlack,
  shadowOpacity: 0.05,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
};
const FAB_POSITION: ViewStyle = { bottom: FAB_BOTTOM };
const FAB_SHADOW: ViewStyle = {
  elevation: 6,
  shadowColor: colors.brandGreen,
  shadowOpacity: 0.3,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
};

type Section = { key: "urgent" | "warning"; tone: Tone; titleKey: CatalogKey; days: number; data: ExpiringBatchRow[] };
type DiscountTarget = { kind: "one"; row: ExpiringBatchRow } | { kind: "all"; rows: ExpiringBatchRow[] };

function rowKey(row: ExpiringBatchRow): string {
  return row.id;
}

function parsePercent(text: string): number | null {
  const value = Number(text.trim());
  if (!Number.isFinite(value) || value <= 0 || value > MAX_PERCENT) return null;
  return value;
}

export default function ExpiryManagementScreen() {
  const { t, formatNumber } = useI18n();
  const session = useSessionStore((state) => state.session);
  const { isAllowed: canManageExpiry } = usePermission("expiry_manage");
  const { isAllowed: canDiscountPermission } = usePermission("sale_discount");
  const { isAllowed: isOwner } = useOwnerAccess();
  const canDiscount = canManageExpiry && canDiscountPermission;
  const [result, setResult] = useState<ExpiringBatches | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [target, setTarget] = useState<DiscountTarget | null>(null);

  const reload = useCallback(async () => {
    if (!session) return;
    const guard = captureSessionFor(session);
    const next = await listExpiringBatches(session.shopId, { includePurchaseLinks: isOwner });
    guard?.ifLive(() => setResult(next));
  }, [isOwner, session]);
  useFocusRefresh(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const handleSync = useCallback(async () => {
    if (!session) return;
    setIsSyncing(true);
    try {
      await triggerSyncNow(session.shopId);
      await reload();
    } finally {
      setIsSyncing(false);
    }
  }, [reload, session]);

  const sections = useMemo<Section[]>(() => {
    if (!result) return [];
    const urgent = result.rows.filter((row) => row.band !== "far");
    const warning = result.rows.filter((row) => row.band === "far");
    const all: Section[] = [
      { key: "urgent", tone: URGENT, titleKey: "expiryUrgentSection", days: result.nearDays, data: urgent },
      { key: "warning", tone: WARNING, titleKey: "expiryWarningSection", days: result.farDays, data: warning },
    ];
    return all.filter((section) => section.data.length > 0);
  }, [result]);

  const discountable = useMemo(
    () => (result ? result.rows.filter((row) => row.band !== "expired") : []),
    [result],
  );
  const showFab = canDiscount && discountable.length > 0;
  const contentStyle = useMemo<ViewStyle>(
    () => ({ paddingHorizontal: 16, paddingBottom: showFab ? FAB_CLEARANCE : LIST_CLEARANCE }),
    [showFab],
  );

  const openDiscount = useCallback((row: ExpiringBatchRow) => setTarget({ kind: "one", row }), []);
  const openReturn = useCallback((purchaseId: string) => {
    router.push({ pathname: "/suppliers/invoice-detail", params: { purchaseId } });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ExpiringBatchRow }) => (
      <ExpiryCard
        row={item}
        canDiscount={canDiscount && item.band !== "expired"}
        canReturn={isOwner && item.purchaseId !== null}
        onDiscount={openDiscount}
        onReturn={openReturn}
      />
    ),
    [canDiscount, isOwner, openDiscount, openReturn],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <View className="mb-3 mt-3 flex-row px-1">
        <View className="flex-row items-center gap-2 rounded-xl px-3 py-1.5" style={{ backgroundColor: section.tone.tint }}>
          <Feather name={section.key === "urgent" ? "alert-circle" : "alert-triangle"} size={14} color={section.tone.accent} />
          <Text className="font-sans-bold text-sm" style={{ color: section.tone.ink }}>
            {fillTemplate(t(section.titleKey), { days: formatNumber(section.days) })}
          </Text>
        </View>
      </View>
    ),
    [formatNumber, t],
  );

  if (!session) return null;

  const urgentCount = result ? result.rows.filter((row) => row.band !== "far").length : null;
  const warningCount = result && urgentCount !== null ? result.rows.length - urgentCount : null;

  const header = (
    <View className="flex-row gap-3 pb-2 pt-4">
      <SummaryCard
        tone={URGENT}
        icon="alert-circle"
        title={t("expiryUrgentTitle")}
        count={urgentCount === null ? PENDING : formatNumber(urgentCount)}
        caption={result ? fillTemplate(t("expiryWithinDays"), { days: formatNumber(result.nearDays) }) : PENDING}
      />
      <SummaryCard
        tone={WARNING}
        icon="alert-triangle"
        title={t("expiryWarningTitle")}
        count={warningCount === null ? PENDING : formatNumber(warningCount)}
        caption={
          result
            ? fillTemplate(t("expiryDayRange"), {
                from: formatNumber(result.nearDays + 1),
                to: formatNumber(result.farDays),
              })
            : PENDING
        }
      />
    </View>
  );

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={t("expiry")}
        onBackPress={() => router.back()}
        onSyncPress={() => void handleSync()}
        syncing={isSyncing}
      />
      <SectionList
        sections={sections}
        keyExtractor={rowKey}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        ListEmptyComponent={result ? <EmptyExpiry /> : null}
        ItemSeparatorComponent={CardGap}
        contentContainerStyle={contentStyle}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
      />
      {showFab ? (
        <View className="absolute left-0 right-0 items-center px-4" style={FAB_POSITION} pointerEvents="box-none">
          <Pressable
            onPress={() => setTarget({ kind: "all", rows: discountable })}
            accessibilityRole="button"
            accessibilityLabel={t("expiryDiscountAll")}
            className="flex-row items-center gap-3 rounded-full bg-brand-green px-6 py-3.5 active:opacity-90"
            style={FAB_SHADOW}
          >
            <Feather name="tag" size={18} color={colors.white} />
            <Text className="font-sans-bold text-sm text-white">{t("expiryDiscountAll")}</Text>
          </Pressable>
        </View>
      ) : null}
      <DiscountSheet
        target={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          void triggerSyncNow(session.shopId);
          void reload();
        }}
      />
    </View>
  );
}

function CardGap() {
  return <View className="h-3" />;
}

function SummaryCard({ tone, icon, title, count, caption }: {
  tone: Tone;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  count: string;
  caption: string;
}) {
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tone.tint }}>
      <View className="mb-2 flex-row items-center gap-2">
        <View className="h-8 w-8 items-center justify-center rounded-lg bg-white/60">
          <Feather name={icon} size={16} color={tone.accent} />
        </View>
        <Text className="font-sans-bold text-xs uppercase tracking-wide" style={{ color: tone.ink }}>{title}</Text>
      </View>
      <Text className="font-sans-extrabold text-3xl" style={{ color: tone.accent }}>{count}</Text>
      <Text className="mt-1 font-sans-medium text-[10px]" style={{ color: tone.ink }}>{caption}</Text>
    </View>
  );
}

function InfoCell({ icon, label, value, valueColor }: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View className="flex-1 rounded-lg bg-auth-neutralFill p-2">
      <View className="mb-1 flex-row items-center gap-1">
        <Feather name={icon} size={11} color={colors.midGray} />
        <Text className="font-sans-bold text-[9px] uppercase text-midGray">{label}</Text>
      </View>
      <Text numberOfLines={1} className="font-sans-bold text-xs text-richBlack" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </Text>
    </View>
  );
}

const ExpiryCard = memo(function ExpiryCard({ row, canDiscount, canReturn, onDiscount, onReturn }: {
  row: ExpiringBatchRow;
  canDiscount: boolean;
  canReturn: boolean;
  onDiscount: (row: ExpiringBatchRow) => void;
  onReturn: (purchaseId: string) => void;
}) {
  const { t, formatNumber } = useI18n();
  const tone = BAND_TONE[row.band];
  const isExpired = row.band === "expired";
  const dayLabel = isExpired
    ? t("expiredLabel")
    : row.daysUntilExpiry === 0
      ? t("today")
      : `${formatNumber(row.daysUntilExpiry)} ${t("days")}`;
  const purchaseId = row.purchaseId;
  const bandLabel = t(ownKey(BAND_CHIP_KEYS, row.band) ?? "expiredLabel");
  return (
    <View className="overflow-hidden rounded-2xl border border-auth-fieldBorder bg-white p-4" style={CARD_SHADOW}>
      <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: tone.accent }} />
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: tone.tint }}>
          <MaterialCommunityIcons name={formIcon(row.form)} size={20} color={tone.accent} />
        </View>
        <View className="flex-1">
          <Text
            numberOfLines={2}
            className="font-sans-bold text-base text-richBlack"
            accessibilityLabel={[row.medicineName, bandLabel].join(", ")}
          >
            {row.medicineName}
          </Text>
          {row.generic ? (
            <Text numberOfLines={1} className="mt-0.5 font-sans-medium text-xs text-richBlack/70">
              {t("expiryGenericPrefix")}: {row.generic}
            </Text>
          ) : null}
          {row.manufacturer ? (
            <Text numberOfLines={1} className="mt-0.5 font-sans text-xs text-midGray">{row.manufacturer}</Text>
          ) : null}
        </View>
        <View className="rounded-full px-3 py-1.5" style={{ backgroundColor: isExpired ? tone.accent : tone.tint }}>
          <Text className="font-sans-bold text-xs" style={{ color: isExpired ? colors.white : tone.ink }}>
            {dayLabel}
          </Text>
        </View>
      </View>

      <View className="mt-4 flex-row gap-2">
        <InfoCell icon="package" label={t("expiryStockShort")} value={formatNumber(row.quantityAvailable)} valueColor={tone.accent} />
        <InfoCell icon="hash" label={t("batchLabel")} value={`#${row.batchNo}`} />
        <InfoCell icon="calendar" label={t("expiryShortLabel")} value={row.expiryDate} />
      </View>

      {row.promotionBps > 0 ? (
        <View className="mt-3 flex-row">
          <View className="flex-row items-center gap-1.5 rounded-full bg-brand-softGreen px-2.5 py-1">
            <Feather name="tag" size={12} color={colors.authHeroEnd} />
            <Text className="font-sans-bold text-[11px] text-auth-heroEnd">
              {fillTemplate(t("expiryPromotionActive"), { percent: formatNumber(row.promotionBps / 100) })}
            </Text>
          </View>
        </View>
      ) : null}

      {(canReturn && purchaseId) || canDiscount ? (
        <View className="mt-4 flex-row gap-2">
          {canReturn && purchaseId ? (
            <Pressable
              onPress={() => onReturn(purchaseId)}
              accessibilityRole="button"
              accessibilityLabel={`${t("returnLabel")} ${row.medicineName}`}
              className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-auth-neutralFill active:opacity-80"
            >
              <Feather name="corner-up-left" size={16} color={colors.richBlack} />
              <Text className="font-sans-semibold text-sm text-richBlack">{t("returnLabel")}</Text>
            </Pressable>
          ) : null}
          {canDiscount ? (
            <Pressable
              onPress={() => onDiscount(row)}
              accessibilityRole="button"
              accessibilityLabel={`${t("discountLabel")} ${row.medicineName}`}
              className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-brand-green active:opacity-90"
            >
              <Feather name="tag" size={16} color={colors.white} />
              <Text className="font-sans-bold text-sm text-white">{t("discountLabel")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function EmptyExpiry() {
  const { t } = useI18n();
  return (
    <View className="items-center px-4 py-16">
      <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-white">
        <Feather name="check-circle" size={40} color={colors.brandGreen} />
      </View>
      <Text className="mb-2 text-center font-sans-bold text-lg text-richBlack">{t("expiryNoneTitle")}</Text>
      <Text className="text-center font-sans text-sm text-midGray">{t("expiryNoneBody")}</Text>
    </View>
  );
}

function DiscountSheet({ target, onClose, onDone }: {
  target: DiscountTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const session = useSessionStore((state) => state.session);
  const [percentText, setPercentText] = useState("");
  const [isInvalid, setIsInvalid] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const percent = parsePercent(percentText);
  const single = target?.kind === "one" ? target.row : null;

  const reset = () => {
    setPercentText("");
    setIsInvalid(false);
  };
  const close = () => {
    if (isBusy) return;
    reset();
    onClose();
  };

  const run = async (
    work: (shopId: string, actorUserId: string, isStillActive: () => boolean) => Promise<unknown>,
    failureTitle: CatalogKey,
  ) => {
    if (!session) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    setIsBusy(true);
    try {
      await work(session.shopId, session.userId, guard.isStillActive);
      reset();
      onDone();
    } catch (caught) {
      Alert.alert(t(failureTitle), userFacingError(caught, "pleaseTryAgain", t));
    } finally {
      setIsBusy(false);
    }
  };

  const apply = () => {
    if (!target) return;
    if (percent === null) {
      setIsInvalid(true);
      return;
    }
    const discountBps = Math.round(percent * 100);
    if (target.kind === "one") {
      void run(
        (shopId, actorUserId, isStillActive) =>
          setBatchPromotion({ shopId, actorUserId, batchId: target.row.id, discountBps, isStillActive }),
        "promoteBatchFailedTitle",
      );
      return;
    }
    void run(
      (shopId, actorUserId, isStillActive) =>
        setBulkBatchPromotion({ shopId, actorUserId, batchIds: target.rows.map(rowKey), discountBps, isStillActive }),
      "bulkPromotionFailedTitle",
    );
  };

  const reverse = () => {
    if (!single) return;
    void run(
      (shopId, actorUserId, isStillActive) => reverseBatchPromotion(shopId, actorUserId, single.id, isStillActive),
      "reversePromotionFailedTitle",
    );
  };

  const subtitle = target?.kind === "all"
    ? fillTemplate(t("expiryBulkDiscountBody"), { count: formatNumber(target.rows.length) })
    : single
      ? `${single.medicineName} · #${single.batchNo}`
      : "";

  return (
    <Modal visible={target !== null} transparent animationType="fade" onRequestClose={close}>
      <Pressable onPress={close} className="flex-1 justify-end bg-black/50">
        <Pressable className="overflow-hidden rounded-t-3xl bg-white pb-2">
          <View className="flex-row items-center gap-3 bg-brand-green p-5">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-white/20">
              <Feather name="trending-down" size={22} color={colors.white} />
            </View>
            <View className="flex-1">
              <Text className="font-sans-bold text-lg text-white">
                {target?.kind === "all" ? t("expiryDiscountAll") : t("expiryApplyDiscountTitle")}
              </Text>
              <Text numberOfLines={1} className="mt-0.5 font-sans text-xs text-white/80">{subtitle}</Text>
            </View>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel={t("cancel")}
              className="h-9 w-9 items-center justify-center rounded-full bg-white/20"
            >
              <Feather name="x" size={18} color={colors.white} />
            </Pressable>
          </View>

          <View className="gap-5 p-5">
            {single ? (
              <View className="flex-row rounded-xl bg-auth-neutralFill p-4">
                <View className="flex-1">
                  <Text className="mb-1 font-sans text-xs text-midGray">{t("expiryCurrentPrice")}</Text>
                  <Text className="font-mono-medium text-base text-richBlack">{formatMoney(single.salePrice)}</Text>
                </View>
                <View className="flex-1">
                  <Text className="mb-1 font-sans text-xs text-midGray">{t("expiryStockShort")}</Text>
                  <Text className="font-sans-bold text-base text-richBlack">{formatNumber(single.quantityAvailable)}</Text>
                </View>
              </View>
            ) : null}

            <View>
              <Text className="mb-3 font-sans-bold text-sm text-richBlack">{t("expiryQuickSelect")}</Text>
              <View className="flex-row gap-2">
                {PRESET_PERCENTS.map((preset) => {
                  const isSelected = percent === preset;
                  return (
                    <Pressable
                      key={preset}
                      onPress={() => {
                        setPercentText(String(preset));
                        setIsInvalid(false);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      className={`h-14 flex-1 items-center justify-center rounded-xl ${isSelected ? "bg-brand-green" : "bg-auth-neutralFill"}`}
                    >
                      <Text className={`font-sans-bold text-lg ${isSelected ? "text-white" : "text-richBlack"}`}>
                        {formatNumber(preset)}%
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View>
              <Text className="mb-2 font-sans-bold text-sm text-richBlack">{t("expiryCustomPercent")}</Text>
              <TextInput
                value={percentText}
                onChangeText={(value) => {
                  setPercentText(value);
                  setIsInvalid(false);
                }}
                keyboardType="decimal-pad"
                placeholder={t("discountPercentLabel")}
                accessibilityLabel={t("expiryCustomPercent")}
                className="h-14 rounded-xl bg-auth-neutralFill px-4 font-sans-bold text-lg text-richBlack"
              />
              {isInvalid ? (
                <Text accessibilityRole="alert" className="mt-2 font-sans text-xs text-error">{t("expiryInvalidPercent")}</Text>
              ) : null}
            </View>

            {single && percent !== null ? (
              <View className="rounded-xl border border-brand-green/20 bg-brand-softGreen p-4">
                <Text className="mb-1 font-sans-semibold text-xs uppercase tracking-wide text-brand-deepGreen">
                  {t("expiryPriceAfter")}
                </Text>
                <Text className="font-mono-medium text-2xl text-brand-green">
                  {formatMoney(effectiveUnitPrice(single.salePrice, Math.round(percent * 100)))}
                </Text>
              </View>
            ) : null}

            <View className="gap-2">
              <Pressable
                onPress={apply}
                disabled={isBusy}
                accessibilityRole="button"
                accessibilityState={{ disabled: isBusy }}
                className={`h-14 items-center justify-center rounded-xl bg-brand-green ${isBusy ? "opacity-60" : "active:opacity-90"}`}
              >
                {isBusy ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text className="font-sans-bold text-base text-white">{t("expiryApplyAction")}</Text>
                )}
              </Pressable>
              {single && single.promotionBps > 0 ? (
                <Pressable
                  onPress={reverse}
                  disabled={isBusy}
                  accessibilityRole="button"
                  className="h-12 items-center justify-center rounded-xl border border-error/40 active:opacity-80"
                >
                  <Text className="font-sans-semibold text-sm text-error">{t("reversePromotionLabel")}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
