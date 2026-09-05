import { useCallback, useState, type ComponentProps } from "react";
import Feather from "@expo/vector-icons/Feather";
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
import { PlanBadge } from "../../components/ui/PlanBadge";
import {
  changeOwnPin,
  getB2Settings,
  getShopProfile,
  updateB2Settings,
  type B2Settings,
  getTaxSettings,
  updateTaxSettings,
  type TaxSettings,
  updateShopProfile,
  type ShopProfile,
} from "../../db/settings";
import {
  requestNotificationPermissionsAsync,
  syncClosingTimeScheduleAsync,
} from "../../native/notifications";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  useNotificationPreferencesStore,
  type NotificationPreferences,
} from "../../state/notificationPreferencesStore";
import type { Session } from "../../state/sessionStore";
import { useSessionStore } from "../../state/sessionStore";
import { usePlan } from "../../state/usePlan";
import { useMultiShopAccess } from "../../state/useMultiShopAccess";
import { switchUser } from "../../state/switchUser";
import { triggerSyncNow } from "../../sync";
import { MULTI_SHOP_HREF } from "../../navigation/routes";

const profileSchema = z.object({
  name: z.string().trim().min(2),
  address: z.string().trim().max(300),
  email: z.union([z.literal(""), z.email()]),
});

function Row({
  label,
  value,
  sub,
  icon,
  iconColor,
  iconBg,
  badge,
  onPress,
  disabled = false,
}: {
  label: string;
  value?: string;
  /** Prototype SettingRow's secondary line. */
  sub?: string;
  icon?: ComponentProps<typeof Feather>["name"];
  iconColor?: string;
  iconBg?: string;
  /** Prototype SettingRow's right-hand pill (e.g. PREMIUM). */
  badge?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={disabled || !onPress}
      onPress={onPress}
      className={`flex-row items-center gap-3 border-b border-brand-softGreen py-4 ${disabled ? "opacity-40" : ""}`}
    >
      {icon ? (
        <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: iconBg ?? "#ECFDF5" }}>
          <Feather name={icon} size={19} color={iconColor ?? "#059669"} />
        </View>
      ) : null}
      <View className="flex-1">
        <Text className="font-sans-semibold text-sm">{label}</Text>
        {sub ? <Text className="mt-0.5 font-sans text-[11px] text-midGray">{sub}</Text> : null}
      </View>
      {badge ? (
        <View className="rounded-full bg-[#F3E8FF] px-2 py-0.5">
          <Text className="font-sans-bold text-[9px] tracking-wide text-[#7C3AED]">{badge}</Text>
        </View>
      ) : null}
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

// Prototype ST-4: "h:00 AM/PM" — display only, never fed back into storage.
function formatClosingHour(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:00 ${period}`;
}

export default function SettingsScreen() {
  const session = useSessionStore((state) => state.session);
  const { t, locale } = useI18n();
  const plan = usePlan();
  const multiShop = useMultiShopAccess();
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [b2Settings, setB2Settings] = useState<B2Settings | null>(null);
  const [b2SettingsOpen, setB2SettingsOpen] = useState(false);
  const [taxSettings, setTaxSettings] = useState<TaxSettings | null>(null);
  const [taxSettingsOpen, setTaxSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!session || session.role !== "owner") return;
    try {
      const [nextProfile, nextB2Settings, nextTaxSettings] = await Promise.all([
        getShopProfile(session.shopId, session.userId),
        getB2Settings(session.shopId),
        getTaxSettings(session.shopId),
      ]);
      setProfile(nextProfile);
      setB2Settings(nextB2Settings);
      setTaxSettings(nextTaxSettings);
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
          {/* Prototype Settings "Your Plan" row: shield bubble, badge, and an
              Upgrade cue for anything below Ultra. */}
          <Pressable accessibilityRole="button" onPress={() => router.push('/settings/plans')} className="flex-row items-center gap-3 border-b border-brand-softGreen py-4">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-[#ECFDF5]"><Feather name="shield" size={19} color="#059669" /></View>
            <View className="flex-1">
              <Text className="font-sans-semibold text-sm">{locale === 'bn' ? 'আপনার প্ল্যান' : 'Your Plan'}</Text>
              <View className="mt-1 flex-row items-center gap-2">
                <PlanBadge interactive={false} onLight plan={plan.plan} daysLeft={plan.daysLeft} expired={plan.reason === 'paid_expired' || plan.reason === 'verification_stale'} grace={plan.reason === 'paid_grace'} />
                {plan.effectiveTier !== 'ultra' ? <Text className="font-sans-bold text-xs text-brand-green">{locale === 'bn' ? 'আপগ্রেড' : 'Upgrade'}</Text> : null}
              </View>
            </View>
            <Text className="font-sans text-lg text-midGray">›</Text>
          </Pressable>
          {/* Always listed, never silently hidden: the row is how a Free owner
              discovers the feature. Entitlement is enforced on the screen and
              on the server, not by removing the entry point. */}
          <Row
            icon="shopping-bag"
            iconColor="#7C3AED"
            iconBg="#F3E8FF"
            label={locale === 'bn' ? 'একাধিক দোকান পরিচালনা' : 'Manage Multiple Shops'}
            sub={locale === 'bn' ? 'দোকান যোগ করুন, বদলান ও সারসংক্ষেপ দেখুন' : 'Add, switch, and view summary across shops'}
            badge={multiShop.entitled ? undefined : 'PREMIUM'}
            onPress={() => router.push(MULTI_SHOP_HREF)}
          />
          <Row
            label={t("printer")}
            onPress={() => router.push("/settings/printer-settings")}
          />
          <Row
            label={t("lowStockExpiryRules")}
            value={b2Settings ? `${b2Settings.lowStockDefault} · ${b2Settings.expiryNearDays}/${b2Settings.expiryFarDays}d` : "…"}
            onPress={() => setB2SettingsOpen(true)}
          />
          <Row
            label="Refund window"
            value={b2Settings ? `${b2Settings.maxRefundDays} days` : "…"}
            onPress={() => setB2SettingsOpen(true)}
          />
          <Row
            label={t("creditRefundRules")}
            value={b2Settings ? `${b2Settings.creditMaxDays} days` : "…"}
            onPress={() => setB2SettingsOpen(true)}
          />
          <Row
            label={t("closingTime")}
            value={b2Settings ? formatClosingHour(b2Settings.closingHour) : "…"}
            onPress={() => setB2SettingsOpen(true)}
          />
          <Row
            label={t("taxVat")}
            value={taxSettings ? taxSettings.rateBp === 0 ? locale === "bn" ? "নিষ্ক্রিয়" : "Disabled" : `${taxSettings.rateBp / 100}% ${taxSettings.label}` : "…"}
            onPress={() => setTaxSettingsOpen(true)}
          />
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
      {b2Settings && b2SettingsOpen ? (
        <B2SettingsModal
          visible
          settings={b2Settings}
          session={session}
          onClose={() => setB2SettingsOpen(false)}
          onSaved={() => {
            setB2SettingsOpen(false);
            void load();
          }}
        />
      ) : null}
      {taxSettings && taxSettingsOpen ? (
        <TaxSettingsModal
          visible
          settings={taxSettings}
          session={session}
          onClose={() => setTaxSettingsOpen(false)}
          onSaved={() => { setTaxSettingsOpen(false); void load(); }}
        />
      ) : null}
    </View>
  );
}

function TaxSettingsModal({ visible, settings, session, onClose, onSaved }: {
  visible: boolean; settings: TaxSettings; session: Session; onClose: () => void; onSaved: () => void;
}) {
  const { locale } = useI18n();
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bn = locale === 'bn';
  const save = async () => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    setSaving(true); setError(null);
    try {
      await updateTaxSettings(session.shopId, session.userId, draft, guard.isStillActive);
      void triggerSyncNow(session.shopId);
      guard.ifLive(onSaved);
    } catch (cause) {
      guard.ifLive(() => setError(cause instanceof Error ? cause.message : (bn ? 'সংরক্ষণ করা যায়নি' : 'Save failed')));
    } finally { guard.ifLive(() => setSaving(false)); }
  };
  const adjust = (delta: number) => setDraft((value) => ({ ...value, rateBp: Math.max(0, Math.min(10_000, value.rateBp + delta)) }));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <View className="gap-5 rounded-t-3xl bg-white p-5 pb-8">
          <Text className="font-sans-bold text-lg text-richBlack">{bn ? 'ট্যাক্স / ভ্যাট' : 'Tax / VAT'}</Text>
          <Text className="font-sans text-xs text-midGray">
            {bn ? 'MRP-এর মধ্যেই ট্যাক্স অন্তর্ভুক্ত। বিক্রয়ের মোট বাড়বে না।' : 'Tax is extracted from the MRP. The sale total will not increase.'}
          </Text>
          <View className="flex-row items-center justify-center gap-5 rounded-2xl bg-brand-softGreen p-4">
            <Pressable onPress={() => adjust(-50)} className="h-11 w-11 items-center justify-center rounded-full bg-white">
              <Text className="font-sans-bold text-xl text-brand-green">−</Text>
            </Pressable>
            <Text className="min-w-24 text-center font-mono text-3xl text-richBlack">{draft.rateBp / 100}%</Text>
            <Pressable onPress={() => adjust(50)} className="h-11 w-11 items-center justify-center rounded-full bg-white">
              <Text className="font-sans-bold text-xl text-brand-green">+</Text>
            </Pressable>
          </View>
          <View className="flex-row gap-2">
            {['VAT', 'GST'].map((label) => (
              <Pressable key={label} onPress={() => setDraft({ ...draft, label })}
                className={`flex-1 items-center rounded-xl border p-3 ${draft.label === label ? 'border-brand-green bg-brand-softGreen' : 'border-midGray'}`}>
                <Text className="font-sans-semibold text-richBlack">{label}</Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
          <View className="flex-row gap-2">
            <Pressable onPress={onClose} className="flex-1 items-center rounded-xl bg-brand-softGreen p-3">
              <Text className="font-sans-semibold text-richBlack">{bn ? 'বাতিল' : 'Cancel'}</Text>
            </Pressable>
            <Pressable disabled={saving} onPress={() => void save()} className="flex-1 items-center rounded-xl bg-brand-green p-3 disabled:opacity-50">
              <Text className="font-sans-semibold text-white">{saving ? '…' : (bn ? 'সংরক্ষণ' : 'Save')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function B2SettingsModal({
  visible,
  settings,
  session,
  onClose,
  onSaved,
}: {
  visible: boolean;
  settings: B2Settings;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (draft.expiryNearDays >= draft.expiryFarDays) {
      setError("Near expiry must be less than Far expiry.");
      return;
    }
    if (draft.closingHour > 23) {
      setError("Closing hour must be between 0 and 23.");
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) return;
    setSaving(true);
    try {
      await updateB2Settings(session.shopId, session.userId, draft, guard.isStillActive);
      void triggerSyncNow(session.shopId);
      // D-11: a closing-hour change must re-point the OS-scheduled reminder
      // immediately, not wait for the next app open.
      void syncClosingTimeScheduleAsync(session.shopId);
      guard.ifLive(onSaved);
    } catch (cause) {
      guard.ifLive(() => setError(cause instanceof Error ? cause.message : "Save failed"));
    } finally {
      guard.ifLive(() => setSaving(false));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/50 p-5">
        <View className="w-full gap-4 rounded-2xl bg-white p-5">
          <Text className="font-sans-bold text-lg">Sales & inventory rules</Text>
          {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
          <NumberSetting
            label="Low-stock fallback"
            value={draft.lowStockDefault}
            onChange={(lowStockDefault) => setDraft({ ...draft, lowStockDefault })}
          />
          <NumberSetting
            label="Near expiry (days)"
            value={draft.expiryNearDays}
            onChange={(expiryNearDays) => setDraft({ ...draft, expiryNearDays })}
          />
          <NumberSetting
            label="Far expiry (days)"
            value={draft.expiryFarDays}
            onChange={(expiryFarDays) => setDraft({ ...draft, expiryFarDays })}
          />
          <NumberSetting
            label="Refund window (days)"
            value={draft.maxRefundDays}
            onChange={(maxRefundDays) => setDraft({ ...draft, maxRefundDays })}
          />
          <NumberSetting
            label="Credit period (days)"
            value={draft.creditMaxDays}
            onChange={(creditMaxDays) => setDraft({ ...draft, creditMaxDays })}
          />
          <NumberSetting
            label="Closing time (hour, 0-23)"
            value={draft.closingHour}
            max={23}
            onChange={(closingHour) => setDraft({ ...draft, closingHour })}
          />
          <View className="flex-row gap-2">
            <Pressable onPress={onClose} className="flex-1 items-center rounded-xl bg-brand-softGreen p-3">
              <Text>Cancel</Text>
            </Pressable>
            <Pressable disabled={saving} onPress={() => void save()} className="flex-1 items-center rounded-xl bg-brand-green p-3 disabled:opacity-50">
              <Text className="text-white">{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NumberSetting({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="font-sans-medium text-sm text-richBlack">{label}</Text>
      <TextInput
        value={String(value)}
        onChangeText={(next) => {
          const parsed = Number.parseInt(next, 10);
          if (Number.isInteger(parsed) && parsed >= 0 && (max === undefined || parsed <= max)) onChange(parsed);
        }}
        selectTextOnFocus
        keyboardType="number-pad"
        accessibilityLabel={label}
        className="rounded-xl border border-midGray p-3 font-mono text-base text-richBlack"
      />
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
    // D-11: turning the daily cash summary on/off must (de)schedule the
    // closing-time OS trigger right away, not wait for the next app open.
    void syncClosingTimeScheduleAsync(session.shopId);
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
