import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { PermissionMatrix } from "./PermissionMatrix";
import { setStaffPermissions, type StaffMember } from "../../db/staff";
import {
  PERMISSION_KEYS,
  resolvePermission,
  type PermissionOverrides,
} from "../../domain/permissions";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import type { Session } from "../../state/sessionStore";
import { triggerSyncNow } from "../../sync";

export function StaffPermissionCard({
  staff,
  session,
  onSaved,
}: {
  staff: StaffMember;
  session: Session;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<PermissionOverrides>(
    () =>
      Object.fromEntries(
        PERMISSION_KEYS.map((key) => [
          key,
          resolvePermission(staff.role, key, staff.permissions),
        ]),
      ) as PermissionOverrides,
  );
  const save = async () => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    setSaving(true);
    setError(null);
    try {
      await setStaffPermissions(
        session.shopId,
        session.userId,
        staff.id,
        value,
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
    <View className="rounded-xl bg-white p-4">
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        className="flex-row justify-between"
      >
        <View>
          <Text className="font-sans-bold">{staff.name}</Text>
          <Text className="font-sans text-xs text-midGray">
            {staff.role === "manager" ? t("manager") : t("cashier")}
          </Text>
        </View>
        <Text>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>
      {expanded ? (
        <View className="mt-4 gap-3">
          {error ? <Text className="text-error">{error}</Text> : null}
          <PermissionMatrix value={value} onChange={setValue} />
          <Pressable
            disabled={saving}
            onPress={() => void save()}
            className="items-center rounded-xl bg-brand-green p-3"
          >
            <Text className="text-white">{saving ? "…" : t("save")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
