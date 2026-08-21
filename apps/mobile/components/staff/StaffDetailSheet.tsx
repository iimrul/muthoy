import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { formatMoney } from "@muthoy/utils";
import { ZERO_PAISA } from "@muthoy/types";
import { PinPad, useConfirmedPinEntry } from "../ui/PinPad";
import { PermissionMatrix } from "./PermissionMatrix";
import {
  activateStaff,
  deactivateStaff,
  removeStaff,
  resetStaffPin,
  setStaffPermissions,
  type StaffMember,
} from "../../db/staff";
import {
  getStaffPerformance,
  type PerformanceRange,
  type StaffPerformanceRow,
} from "../../db/staffDashboard";
import {
  PERMISSION_KEYS,
  resolvePermission,
  type PermissionOverrides,
} from "../../domain/permissions";
import { DuplicatePinError } from "../../db/errors";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import type { Session } from "../../state/sessionStore";
import { triggerSyncNow } from "../../sync";

function effective(staff: StaffMember): PermissionOverrides {
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [
      key,
      resolvePermission(staff.role, key, staff.permissions),
    ]),
  ) as PermissionOverrides;
}

export function StaffDetailSheet({
  staff,
  session,
  onClose,
  onChanged,
}: {
  staff: StaffMember | null;
  session: Session;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, formatNumber } = useI18n();
  const [range, setRange] = useState<PerformanceRange>("today");
  const [performance, setPerformance] = useState<StaffPerformanceRow | null>(
    null,
  );
  const [permissions, setPermissions] = useState<PermissionOverrides>({});
  const [resetOpen, setResetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const owner = session.role === "owner";
  useEffect(() => {
    if (staff) setPermissions(effective(staff));
  }, [staff]);
  useEffect(() => {
    if (!staff) return;
    void getStaffPerformance(session.shopId, session.userId, range, staff.id)
      .then((rows) => setPerformance(rows[0] ?? null))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Performance failed"),
      );
  }, [range, session.shopId, session.userId, staff]);
  const mutate = useCallback(
    async (operation: (guard: () => boolean) => Promise<void>) => {
      if (!staff) return;
      const guard = captureSessionFor(session);
      if (!guard) return;
      setSaving(true);
      setError(null);
      try {
        await operation(guard.isStillActive);
        void triggerSyncNow(session.shopId);
        guard.ifLive(onChanged);
      } catch (cause) {
        guard.ifLive(() =>
          setError(cause instanceof Error ? cause.message : "Action failed"),
        );
      } finally {
        guard.ifLive(() => setSaving(false));
      }
    },
    [onChanged, session, staff],
  );
  const pinConfirmed = useCallback(
    async (pin: string) => {
      if (!staff) return;
      const guard = captureSessionFor(session);
      if (!guard) return;
      try {
        await resetStaffPin(staff.id, pin, session.userId, guard.isStillActive);
        void triggerSyncNow(session.shopId);
        guard.ifLive(() => {
          setResetOpen(false);
          onChanged();
        });
      } catch (cause) {
        guard.ifLive(() =>
          setError(
            cause instanceof DuplicatePinError
              ? cause.message
              : cause instanceof Error
                ? cause.message
                : "PIN reset failed",
          ),
        );
      }
    },
    [onChanged, session, staff],
  );
  const pinEntry = useConfirmedPinEntry(pinConfirmed, () =>
    setError("PINs did not match"),
  );
  if (!staff) return null;
  const closeResetPin = () => {
    pinEntry.reset();
    setResetOpen(false);
    setError(null);
  };
  const confirmAction = (label: string, action: () => void) =>
    Alert.alert(label, staff.name, [
      { text: t("cancel"), style: "cancel" },
      { text: label, style: "destructive", onPress: action },
    ]);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-brand-softGreen">
        <View className="flex-row items-center justify-between p-4">
          <Pressable onPress={onClose}>
            <Text>✕</Text>
          </Pressable>
          <Text className="font-sans-bold">{staff.name}</Text>
          <View className="w-4" />
        </View>
        <ScrollView contentContainerClassName="gap-4 p-4 pb-12">
          {error ? <Text className="text-error">{error}</Text> : null}
          <View className="items-center gap-1 rounded-xl bg-white p-5">
            <Text className="font-sans-bold text-xl">{staff.name}</Text>
            <Text className="font-sans text-sm text-midGray">
              {staff.phone} ·{" "}
              {staff.role === "manager" ? t("manager") : t("cashier")} ·{" "}
              {staff.isActive ? t("active") : t("off")}
            </Text>
          </View>
          <View className="flex-row gap-2">
            {(["today", "week", "all"] as PerformanceRange[]).map((item) => (
              <Pressable
                key={item}
                onPress={() => setRange(item)}
                className={`flex-1 items-center rounded-xl p-3 ${range === item ? "bg-brand-green" : "bg-white"}`}
              >
                <Text className={range === item ? "text-white" : ""}>
                  {item === "today"
                    ? t("today")
                    : item === "week"
                      ? t("thisWeek")
                      : t("allTime")}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1 rounded-xl bg-white p-3">
              <Text className="text-xs text-midGray">{t("sales")}</Text>
              <Text className="font-mono">
                {formatMoney(performance?.sales ?? ZERO_PAISA)}
              </Text>
            </View>
            <View className="flex-1 rounded-xl bg-white p-3">
              <Text className="text-xs text-midGray">{t("txns")}</Text>
              <Text className="font-mono">
                {formatNumber(performance?.transactionCount ?? 0)}
              </Text>
            </View>
            <View className="flex-1 rounded-xl bg-white p-3">
              <Text className="text-xs text-midGray">{t("average")}</Text>
              <Text className="font-mono">
                {formatMoney(performance?.averageBill ?? ZERO_PAISA)}
              </Text>
            </View>
          </View>
          {owner ? (
            <View className="gap-3 rounded-xl bg-white p-4">
              <Text className="font-sans-bold">{t("permissions")}</Text>
              <PermissionMatrix value={permissions} onChange={setPermissions} />
              <Pressable
                disabled={saving}
                onPress={() =>
                  void mutate((live) =>
                    setStaffPermissions(
                      session.shopId,
                      session.userId,
                      staff.id,
                      permissions,
                      live,
                    ),
                  )
                }
                className="items-center rounded-xl bg-brand-green p-3"
              >
                <Text className="text-white">{t("save")}</Text>
              </Pressable>
            </View>
          ) : null}
          {owner ? (
            <View className="gap-2 rounded-xl bg-white p-4">
              <Pressable
                onPress={() => setResetOpen(true)}
                className="rounded-xl bg-brand-softGreen p-3"
              >
                <Text className="text-center font-sans-semibold">
                  {t("resetPin")}
                </Text>
              </Pressable>
              <Pressable
                disabled={saving}
                onPress={() =>
                  confirmAction(
                    staff.isActive ? t("deactivate") : t("activate"),
                    () =>
                      void mutate((live) =>
                        staff.isActive
                          ? deactivateStaff(staff.id, session.userId, live)
                          : activateStaff(staff.id, session.userId, live),
                      ),
                  )
                }
                className="rounded-xl bg-warningBg p-3"
              >
                <Text className="text-center font-sans-semibold text-warning">
                  {staff.isActive ? t("deactivate") : t("activate")}
                </Text>
              </Pressable>
              <Pressable
                disabled={saving}
                onPress={() =>
                  confirmAction(
                    t("removeStaff"),
                    () =>
                      void mutate((live) =>
                        removeStaff(staff.id, session.userId, live),
                      ),
                  )
                }
                className="rounded-xl bg-errorBg p-3"
              >
                <Text className="text-center font-sans-semibold text-error">
                  {t("removeStaff")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {saving ? <ActivityIndicator /> : null}
        </ScrollView>
        <Modal
          visible={resetOpen}
          transparent
          animationType="slide"
          onRequestClose={closeResetPin}
        >
          <View className="flex-1 items-center justify-center bg-black/50 p-5">
            <View className="items-center gap-4 rounded-2xl bg-white p-5">
              <Text className="font-sans-bold">
                {pinEntry.step === "enter" ? t("resetPin") : t("confirmPin")}
              </Text>
              <PinPad
                value={pinEntry.pin}
                onDigitPress={pinEntry.handleDigitPress}
                onBackspace={pinEntry.handleBackspace}
                error={Boolean(error)}
                disabled={pinEntry.isSubmitting}
              />
              <Pressable onPress={closeResetPin}>
                <Text>{t("cancel")}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}
