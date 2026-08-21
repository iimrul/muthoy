import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { createStaffSchema } from "@muthoy/validation";
import {
  PinPad,
  useConfirmedPinEntry,
  type PinCompletionMeta,
} from "../ui/PinPad";
import { PermissionMatrix } from "./PermissionMatrix";
import { createStaff } from "../../db/staff";
import { DuplicatePhoneError, DuplicatePinError } from "../../db/errors";
import {
  PERMISSION_PRESETS,
  type PermissionOverrides,
  type PermissionPreset,
} from "../../domain/permissions";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import type { Session } from "../../state/sessionStore";
import { triggerSyncAfterInteractions } from "../../sync";

type Step = "details" | "pin" | "permissions";

export function AddStaffModal({
  visible,
  session,
  onClose,
  onCreated,
}: {
  visible: boolean;
  session: Session;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"staff" | "manager">("staff");
  const [rawPin, setRawPin] = useState("");
  const [preset, setPreset] = useState<PermissionPreset>("cashier");
  const [permissions, setPermissions] = useState<PermissionOverrides>(() => ({
    ...PERMISSION_PRESETS.cashier,
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isOwner = session.role === "owner";
  const reset = useCallback(() => {
    setStep("details");
    setName("");
    setPhone("");
    setRole("staff");
    setRawPin("");
    setPreset("cashier");
    setPermissions({ ...PERMISSION_PRESETS.cashier });
    setError(null);
  }, []);
  const handlePin = useCallback((pin: string, _meta: PinCompletionMeta) => {
    setRawPin(pin);
    setStep("permissions");
    setError(null);
  }, []);
  const pinEntry = useConfirmedPinEntry(handlePin, () =>
    setError("PINs did not match"),
  );
  const close = () => {
    pinEntry.reset();
    reset();
    onClose();
  };
  const title = useMemo(
    () => `${step === "details" ? "1" : step === "pin" ? "2" : "3"} / 3`,
    [step],
  );
  const handleDetails = () => {
    const result = createStaffSchema.safeParse({
      name,
      phone,
      pin: "0000",
      confirmPin: "0000",
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid details");
      return;
    }
    setError(null);
    setStep("pin");
  };
  const chooseRole = (next: "staff" | "manager") => {
    if (!isOwner && next === "manager") return;
    setRole(next);
    const nextPreset = next === "manager" ? "manager" : "cashier";
    setPreset(nextPreset);
    setPermissions({ ...PERMISSION_PRESETS[nextPreset] });
  };
  const choosePreset = (next: PermissionPreset) => {
    if (!isOwner && next !== "cashier") return;
    setPreset(next);
    setPermissions({ ...PERMISSION_PRESETS[next] });
  };
  const save = async () => {
    const result = createStaffSchema.safeParse({
      name,
      phone,
      pin: rawPin,
      confirmPin: rawPin,
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid staff details");
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) return;
    setSaving(true);
    setError(null);
    try {
      await createStaff(
        session.shopId,
        session.userId,
        {
          name: result.data.name,
          phone: result.data.phone,
          rawPin: result.data.pin,
          role,
          permissions,
        },
        guard.isStillActive,
      );
      guard.ifLive(() => {
        triggerSyncAfterInteractions(session.shopId);
        reset();
        onCreated();
      });
    } catch (cause) {
      guard.ifLive(() =>
        setError(
          cause instanceof DuplicatePhoneError ||
            cause instanceof DuplicatePinError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : "Staff could not be created",
        ),
      );
    } finally {
      guard.ifLive(() => setSaving(false));
    }
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View className="flex-1 bg-brand-softGreen">
        <View className="flex-row items-center justify-between p-4">
          <Pressable onPress={close}>
            <Text>✕</Text>
          </Pressable>
          <Text className="font-sans-bold">
            {t("addNewStaff")} · {title}
          </Text>
          <View className="w-4" />
        </View>
        <ScrollView
          contentContainerClassName="gap-4 p-4"
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <Text className="font-sans text-sm text-error">{error}</Text>
          ) : null}
          {step === "details" ? (
            <View className="gap-4 rounded-xl bg-white p-4">
              <Text className="font-sans-semibold">{t("name")}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                accessibilityLabel={t("name")}
                className="rounded-xl border border-midGray p-3"
              />
              <Text className="font-sans-semibold">{t("phone")}</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                accessibilityLabel={t("phone")}
                keyboardType="phone-pad"
                className="rounded-xl border border-midGray p-3"
              />
              <Text className="font-sans-semibold">{t("role")}</Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => chooseRole("staff")}
                  className={`flex-1 items-center rounded-xl p-3 ${role === "staff" ? "bg-brand-green" : "bg-brand-softGreen"}`}
                >
                  <Text className={role === "staff" ? "text-white" : ""}>
                    {t("cashier")}
                  </Text>
                </Pressable>
                {isOwner ? (
                  <Pressable
                    onPress={() => chooseRole("manager")}
                    className={`flex-1 items-center rounded-xl p-3 ${role === "manager" ? "bg-brand-green" : "bg-brand-softGreen"}`}
                  >
                    <Text className={role === "manager" ? "text-white" : ""}>
                      {t("manager")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                onPress={handleDetails}
                className="items-center rounded-xl bg-brand-green p-3"
              >
                <Text className="text-white">{t("next")}</Text>
              </Pressable>
            </View>
          ) : null}
          {step === "pin" ? (
            <View className="items-center gap-5 rounded-xl bg-white p-4">
              <Text className="font-sans-semibold">
                {pinEntry.step === "enter" ? t("setPin") : t("confirmPin")}
              </Text>
              <PinPad
                value={pinEntry.pin}
                onDigitPress={pinEntry.handleDigitPress}
                onBackspace={pinEntry.handleBackspace}
                error={Boolean(error)}
                disabled={pinEntry.isSubmitting}
              />
              <Pressable onPress={() => setStep("details")}>
                <Text className="text-brand-green">{t("back")}</Text>
              </Pressable>
            </View>
          ) : null}
          {step === "permissions" ? (
            <View className="gap-4 rounded-xl bg-white p-4">
              <View className="flex-row gap-2">
                {(["cashier", "manager", "custom"] as PermissionPreset[]).map(
                  (item) =>
                    !isOwner && item !== "cashier" ? null : (
                      <Pressable
                        key={item}
                        onPress={() => choosePreset(item)}
                        className={`flex-1 items-center rounded-xl p-2 ${preset === item ? "bg-brand-green" : "bg-brand-softGreen"}`}
                      >
                        <Text className={preset === item ? "text-white" : ""}>
                          {item === "cashier"
                            ? t("cashier")
                            : item === "manager"
                              ? t("manager")
                              : t("custom")}
                        </Text>
                      </Pressable>
                    ),
                )}
              </View>
              <PermissionMatrix
                value={permissions}
                editable={isOwner}
                onChange={(next) => {
                  setPreset("custom");
                  setPermissions(next);
                }}
              />
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => setStep("pin")}
                  className="flex-1 items-center rounded-xl bg-brand-softGreen p-3"
                >
                  <Text>{t("back")}</Text>
                </Pressable>
                <Pressable
                  disabled={saving}
                  onPress={() => void save()}
                  className="flex-1 items-center rounded-xl bg-brand-green p-3"
                >
                  {saving ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white">{t("save")}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
