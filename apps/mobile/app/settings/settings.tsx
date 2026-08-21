import { useCallback, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import { z } from "zod";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { LanguageToggle } from "../../components/ui/LanguageToggle";
import {
  PinPad,
  useConfirmedPinEntry,
  usePinEntry,
} from "../../components/ui/PinPad";
import { StandardHeader } from "../../components/ui/StandardHeader";
import {
  changeOwnPin,
  getShopProfile,
  updateShopProfile,
  type ShopProfile,
} from "../../db/settings";
import { requestNotificationPermissionsAsync } from "../../native/notifications";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  useNotificationPreferencesStore,
  type NotificationPreferences,
} from "../../state/notificationPreferencesStore";
import type { Session } from "../../state/sessionStore";
import { useSessionStore } from "../../state/sessionStore";
import { switchUser } from "../../state/switchUser";
import { triggerSyncNow } from "../../sync";

const profileSchema = z.object({
  name: z.string().trim().min(2),
  address: z.string().trim().max(300),
  email: z.union([z.literal(""), z.email()]),
});

function Row({
  label,
  value,
  onPress,
  disabled = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled || !onPress}
      onPress={onPress}
      className={`flex-row items-center justify-between border-b border-brand-softGreen py-4 ${disabled ? "opacity-40" : ""}`}
    >
      <Text className="font-sans-semibold text-sm">{label}</Text>
      <Text className="font-sans text-xs text-midGray">
        {value ?? (onPress ? "›" : "")}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => onChange(!value)}
      className={`flex-row items-center justify-between py-3 ${disabled ? "opacity-40" : ""}`}
    >
      <Text className="font-sans text-sm">{label}</Text>
      <View
        className={`h-6 w-11 rounded-full p-0.5 ${value ? "bg-brand-green" : "bg-midGray"}`}
      >
        <View
          className={`h-5 w-5 rounded-full bg-white ${value ? "self-end" : "self-start"}`}
        />
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const session = useSessionStore((state) => state.session);
  const { t } = useI18n();
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!session || session.role !== "owner") return;
    try {
      setProfile(await getShopProfile(session.shopId, session.userId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Settings failed");
    }
  }, [session]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  if (!session || session.role !== "owner") return <AccessDenied />;
  const version = `${Constants.expoConfig?.version ?? "0.1.0"}${Constants.expoConfig?.android?.versionCode ? ` (${Constants.expoConfig.android.versionCode})` : ""}`;
  const logout = () =>
    Alert.alert(t("switchUser"), t("shiftSummary"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("switchUser"),
        style: "destructive",
        onPress: () => {
          switchUser();
          router.replace("/");
        },
      },
    ]);
  return (
    <View className="flex-1 bg-brand-softGreen pb-20">
      <StandardHeader title={t("settings")} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-28">
        {error ? <Text className="text-error">{error}</Text> : null}
        <View className="rounded-xl bg-white px-4">
          <Row
            label={t("personalData")}
            value={profile?.name}
            onPress={() => setProfileOpen(true)}
          />
          <Row
            label={t("notifications")}
            onPress={() => setNotificationsOpen(true)}
          />
          <View className="flex-row items-center justify-between py-4">
            <Text className="font-sans-semibold">{t("language")}</Text>
            <LanguageToggle />
          </View>
        </View>
        <View className="rounded-xl bg-white px-4">
          <Row
            label={t("plans")}
            onPress={() => router.push("/settings/plans")}
          />
          <Row label={t("multiShop")} value="B4" disabled />
          <Row
            label={t("printer")}
            onPress={() => router.push("/settings/printer-settings")}
          />
          <Row label={t("lowStockExpiryRules")} value="B2" disabled />
          <Row label={t("creditRefundRules")} value="B2/B3" disabled />
          <Row label={t("closingTax")} value="B3" disabled />
        </View>
        <View className="rounded-xl bg-white px-4">
          <Row label={t("changePin")} onPress={() => setPinOpen(true)} />
          <Row label={t("backupKey")} value={t("securityPhase")} disabled />
          <Row label={t("remoteWipe")} value={t("securityPhase")} disabled />
        </View>
        <Pressable
          onPress={logout}
          className="items-center rounded-xl bg-error p-4"
        >
          <Text className="font-sans-bold text-white">{t("logout")}</Text>
        </Pressable>
        <Text className="text-center font-mono text-xs text-midGray">
          Muthoy {version}
        </Text>
      </ScrollView>
      {profile && profileOpen ? (
        <ProfileModal
          visible
          profile={profile}
          session={session}
          onClose={() => setProfileOpen(false)}
          onSaved={() => {
            setProfileOpen(false);
            void load();
          }}
        />
      ) : null}
      {notificationsOpen ? (
        <NotificationSettingsModal
          visible
          session={session}
          onClose={() => setNotificationsOpen(false)}
        />
      ) : null}
      {pinOpen ? (
        <ChangePinModal
          visible
          session={session}
          onClose={() => setPinOpen(false)}
        />
      ) : null}
    </View>
  );
}

function ProfileModal({
  visible,
  profile,
  session,
  onClose,
  onSaved,
}: {
  visible: boolean;
  profile: ShopProfile;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(profile.name);
  const [address, setAddress] = useState(profile.address ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const parsed = profileSchema.safeParse({ name, address, email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid profile");
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) return;
    setSaving(true);
    try {
      await updateShopProfile(
        session.shopId,
        session.userId,
        parsed.data,
        guard.isStillActive,
      );
      void triggerSyncNow(session.shopId);
      guard.ifLive(onSaved);
    } catch (cause) {
      guard.ifLive(() =>
        setError(cause instanceof Error ? cause.message : "Save failed"),
      );
    } finally {
      guard.ifLive(() => setSaving(false));
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center bg-black/50 p-5">
        <View className="w-full gap-3 rounded-2xl bg-white p-5">
          <Text className="font-sans-bold text-lg">{t("personalData")}</Text>
          {error ? <Text className="text-error">{error}</Text> : null}
          <Text>{t("name")}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            className="rounded-xl border border-midGray p-3"
          />
          <Text>{t("phone")}</Text>
          <TextInput
            value={profile.phone}
            editable={false}
            className="rounded-xl bg-brand-softGreen p-3 text-midGray"
          />
          <Text className="text-xs text-midGray">{t("readOnlyPhone")}</Text>
          <Text>{t("address")}</Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            className="rounded-xl border border-midGray p-3"
          />
          <Text>{t("email")}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            className="rounded-xl border border-midGray p-3"
          />
          <View className="flex-row gap-2">
            <Pressable
              onPress={onClose}
              className="flex-1 items-center rounded-xl bg-brand-softGreen p-3"
            >
              <Text>{t("cancel")}</Text>
            </Pressable>
            <Pressable
              disabled={saving}
              onPress={() => void save()}
              className="flex-1 items-center rounded-xl bg-brand-green p-3"
            >
              <Text className="text-white">{saving ? "…" : t("save")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NotificationSettingsModal({
  visible,
  session,
  onClose,
}: {
  visible: boolean;
  session: Session;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const stored = useNotificationPreferencesStore(
    (state) => state.byShop[session.shopId] ?? DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const saveStored = useNotificationPreferencesStore(
    (state) => state.saveForShop,
  );
  const [draft, setDraft] = useState<NotificationPreferences>(stored);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const save = async () => {
    const granted =
      !(draft.all && draft.dailyCash) ||
      (await requestNotificationPermissionsAsync());
    saveStored(session.shopId, draft);
    setPermissionDenied(!granted);
    if (granted) onClose();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center bg-black/50 p-5">
        <View className="w-full gap-2 rounded-2xl bg-white p-5">
          <Text className="font-sans-bold text-lg">{t("notifications")}</Text>
          <ToggleRow
            label={t("allNotifications")}
            value={draft.all}
            onChange={(all) => setDraft({ ...draft, all })}
          />
          <ToggleRow
            label={t("stockAlerts")}
            value={draft.stock}
            disabled={!draft.all}
            onChange={(stock) => setDraft({ ...draft, stock })}
          />
          <ToggleRow
            label={t("expiryAlertsSetting")}
            value={draft.expiry}
            disabled={!draft.all}
            onChange={(expiry) => setDraft({ ...draft, expiry })}
          />
          <ToggleRow
            label={t("creditAlerts")}
            value={draft.credit}
            disabled={!draft.all}
            onChange={(credit) => setDraft({ ...draft, credit })}
          />
          <ToggleRow
            label={t("dailyCashSummary")}
            value={draft.dailyCash}
            disabled={!draft.all}
            onChange={(dailyCash) => setDraft({ ...draft, dailyCash })}
          />
          {permissionDenied ? (
            <Text className="text-sm text-warning">
              {t("notificationPermissionDenied")}
            </Text>
          ) : null}
          <View className="flex-row gap-2">
            <Pressable
              onPress={onClose}
              className="flex-1 items-center rounded-xl bg-brand-softGreen p-3"
            >
              <Text>{t("cancel")}</Text>
            </Pressable>
            <Pressable
              onPress={() => void save()}
              className="flex-1 items-center rounded-xl bg-brand-green p-3"
            >
              <Text className="text-white">{t("save")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChangePinModal({
  visible,
  session,
  onClose,
}: {
  visible: boolean;
  session: Session;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<"current" | "new">("current");
  const [currentPin, setCurrentPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = usePinEntry((pin) => {
    setCurrentPin(pin);
    setStep("new");
    setError(null);
  });
  const confirmed = useConfirmedPinEntry(
    useCallback(
      async (pin: string) => {
        const guard = captureSessionFor(session);
        if (!guard) return;
        try {
          await changeOwnPin(
            session.userId,
            currentPin,
            pin,
            guard.isStillActive,
          );
          void triggerSyncNow(session.shopId);
          guard.ifLive(onClose);
        } catch {
          guard.ifLive(() => {
            setError("Current PIN is incorrect");
            setStep("current");
            setCurrentPin("");
          });
        }
      },
      [currentPin, onClose, session],
    ),
    () => setError("PINs did not match"),
  );
  const entry = step === "current" ? current : confirmed;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center bg-black/50 p-5">
        <View className="items-center gap-4 rounded-2xl bg-white p-5">
          <Text className="font-sans-bold">{t("changePin")}</Text>
          {error ? <Text className="text-error">{error}</Text> : null}
          <PinPad
            value={entry.pin}
            onDigitPress={entry.handleDigitPress}
            onBackspace={entry.handleBackspace}
            error={Boolean(error)}
          />
          <Pressable onPress={onClose}>
            <Text>{t("cancel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
