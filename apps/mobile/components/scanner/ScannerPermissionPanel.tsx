import { useCallback, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import {
  openSettingsErrorMessage,
  requestPermissionErrorMessage,
  type CameraPermissionState,
} from "../../domain/cameraPermissionState";
import { useI18n } from "../../state/localeStore";

// components/scanner/ScannerPermissionPanel.tsx — the camera-permission states
// both scanners share: ask, send to Settings, or retry a camera that failed to
// mount. Extracted unchanged from MedicineTextScanner so the live strip scanner
// cannot drift from it (docs/plans/ocr.md — "no dead scanner state").
//
// Renders nothing for "checking" and "granted"; those belong to the scanner.

export interface ScannerPermissionPanelProps {
  permissionState: CameraPermissionState;
  /** Resolves false when the native request itself threw. */
  onRequestPermission: () => Promise<boolean>;
  onRetryMount: () => void;
}

export function ScannerPermissionPanel({
  permissionState,
  onRequestPermission,
  onRetryMount,
}: ScannerPermissionPanelProps) {
  const { t } = useI18n();
  const [requestError, setRequestError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const handleRequestPermission = useCallback(async () => {
    setRequestError(null);
    setRequestError(requestPermissionErrorMessage(await onRequestPermission()));
  }, [onRequestPermission]);

  // Linking.openSettings() can reject (no resolvable Settings activity on some
  // Android OEM builds). Awaited and caught so the failure is visible with a
  // manual fallback path instead of the button silently doing nothing.
  const handleOpenSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      await Linking.openSettings();
      setSettingsError(openSettingsErrorMessage(true));
    } catch {
      setSettingsError(openSettingsErrorMessage(false));
    }
  }, []);

  if (permissionState === "deniable") {
    return (
      <View className="items-center gap-3">
        <Text className="text-center font-sans text-sm text-white">
          {t("cameraNeeded")}
        </Text>
        <Pressable
          onPress={handleRequestPermission}
          accessibilityRole="button"
          accessibilityLabel={t("grantCameraAccess")}
          className="items-center rounded-lg bg-brand-green px-5 py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">
            {t("grantAccess")}
          </Text>
        </Pressable>
        {requestError ? (
          <Text className="text-center font-sans text-xs text-white/80">
            {requestError}
          </Text>
        ) : null}
      </View>
    );
  }

  if (permissionState === "blocked") {
    return (
      <View className="items-center gap-3">
        <Text className="text-center font-sans text-sm text-white">
          {t("cameraDenied")}
        </Text>
        <Pressable
          onPress={handleOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={t("openSettings")}
          className="items-center rounded-lg bg-brand-green px-5 py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">
            {t("openSettings")}
          </Text>
        </Pressable>
        {settingsError ? (
          <Text className="text-center font-sans text-xs text-white/80">
            {settingsError}
          </Text>
        ) : null}
      </View>
    );
  }

  if (permissionState === "unavailable") {
    return (
      <View className="items-center gap-3">
        <Text className="text-center font-sans text-sm text-white">
          {t("cameraUnavailable")}
        </Text>
        <Pressable
          onPress={onRetryMount}
          accessibilityRole="button"
          accessibilityLabel={t("retryCamera")}
          className="items-center rounded-lg bg-brand-green px-5 py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">
            {t("retry")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return null;
}
