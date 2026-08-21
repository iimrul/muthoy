import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  openSettingsErrorMessage,
  requestPermissionErrorMessage,
  type CameraPermissionState,
} from "../../domain/cameraPermissionState";
import {
  ScannerCamera,
  type ScannerCameraHandle,
} from "../../native/ScannerCamera";
import { scanText } from "../../native/scanner";
import { useI18n } from "../../state/localeStore";

// components/scanner/MedicineTextScanner.tsx — polished, reusable full-screen
// scan modal (docs/plans/ocr.md). Imports ONLY native/ScannerCamera +
// native/scanner — never expo-camera or the ML Kit package directly, keeping
// native-module imports confined to native/ (DEVELOPMENT_RULES.md).
//
// Tap-to-capture, not continuous live scanning — no frame-processor pipeline
// exists in this codebase; see docs/plans/ocr.md's Camera UX section.
// `mode` only changes copy, never branching business logic — matching
// results/prefill handling is entirely the calling screen's concern via
// onTextRecognized.

export type ScannerMode = "lookup" | "prefill";

export interface MedicineTextScannerProps {
  visible: boolean;
  mode: ScannerMode;
  onClose: () => void;
  onTextRecognized: (recognizedText: string) => void;
}

type CaptureState = "ready" | "capturing" | "processing" | "error";

export function MedicineTextScanner({
  visible,
  mode,
  onClose,
  onTextRecognized,
}: MedicineTextScannerProps) {
  const { t } = useI18n();
  const cameraRef = useRef<ScannerCameraHandle>(null);
  const [permissionState, setPermissionState] =
    useState<CameraPermissionState>("checking");
  const [captureState, setCaptureState] = useState<CaptureState>("ready");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // Bumped to force ScannerCamera to fully remount (via its `key`) after a
  // native mount failure — a fresh mount re-runs its permission check and
  // clears its internal hasMountError, giving the 'unavailable' state a real
  // in-place retry instead of forcing the user to close and reopen the whole
  // modal (docs/plans/ocr.md — "no dead scanner state").
  const [cameraInstanceKey, setCameraInstanceKey] = useState(0);

  // Resets before calling onClose (rather than reacting to `visible` via an
  // effect) so every exit path leaves state clean for the next open, with no
  // one-frame flash of stale content — see docs/plans/ocr.md.
  const resetAndClose = useCallback(() => {
    setCaptureState("ready");
    setErrorMessage(null);
    setPermissionState("checking");
    setRequestError(null);
    setSettingsError(null);
    onClose();
  }, [onClose]);

  const handleRequestPermission = useCallback(async () => {
    setRequestError(null);
    const succeeded = (await cameraRef.current?.requestPermission()) ?? false;
    setRequestError(requestPermissionErrorMessage(succeeded));
  }, []);

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

  const handleRetryMount = useCallback(() => {
    setCameraInstanceKey((key) => key + 1);
  }, []);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current) {
      return;
    }
    setCaptureState("capturing");
    const uri = await cameraRef.current.captureAsync();
    if (!uri) {
      setCaptureState("error");
      setErrorMessage(t("cameraCaptureFailed"));
      return;
    }

    setCaptureState("processing");
    try {
      const result = await scanText(uri);
      if (!result) {
        setCaptureState("error");
        setErrorMessage(t("cameraNoText"));
        return;
      }
      onTextRecognized(result.recognizedText);
      resetAndClose();
    } catch {
      setCaptureState("error");
      setErrorMessage(t("cameraReadFailed"));
    }
  }, [onTextRecognized, resetAndClose, t]);

  const handleRetry = useCallback(() => {
    setCaptureState("ready");
    setErrorMessage(null);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      presentationStyle="fullScreen"
      animationType="slide"
      onRequestClose={resetAndClose}
    >
      <View className="flex-1 bg-richBlack">
        <ScannerCamera
          key={cameraInstanceKey}
          ref={cameraRef}
          onPermissionStateChange={setPermissionState}
        />

        <View className="absolute inset-0">
          <View className="flex-row justify-end p-4">
            <Pressable
              onPress={resetAndClose}
              accessibilityRole="button"
              accessibilityLabel={t("closeScanner")}
              hitSlop={8}
              className="h-10 w-10 items-center justify-center rounded-full bg-white/10 active:opacity-70"
            >
              <Text className="font-sans-semibold text-lg text-white">✕</Text>
            </Pressable>
          </View>

          {permissionState === "granted" ? (
            <View className="flex-1 items-center justify-center p-10">
              <View className="aspect-square w-full max-w-sm rounded-3xl border-2 border-white/40" />
            </View>
          ) : (
            <View className="flex-1" />
          )}

          <View className="gap-4 p-6 pb-10">
            {permissionState === "deniable" ? (
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
            ) : null}

            {permissionState === "blocked" ? (
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
            ) : null}

            {permissionState === "unavailable" ? (
              <View className="items-center gap-3">
                <Text className="text-center font-sans text-sm text-white">
                  {t("cameraUnavailable")}
                </Text>
                <Pressable
                  onPress={handleRetryMount}
                  accessibilityRole="button"
                  accessibilityLabel={t("retryCamera")}
                  className="items-center rounded-lg bg-brand-green px-5 py-3 active:opacity-80"
                >
                  <Text className="font-sans-semibold text-base text-white">
                    {t("retry")}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {permissionState === "granted" && captureState === "ready" ? (
              <Text className="text-center font-sans text-sm text-white/80">
                {t(mode === "lookup" ? "cameraLookup" : "cameraPrefill")}
              </Text>
            ) : null}

            {permissionState === "granted" &&
            (captureState === "capturing" || captureState === "processing") ? (
              <View className="items-center gap-3">
                <ActivityIndicator color="#FFFFFF" />
                <Text className="font-sans text-sm text-white">
                  {t("readingStrip")}
                </Text>
              </View>
            ) : null}

            {permissionState === "granted" && captureState === "error" ? (
              <View className="items-center gap-3">
                <Text className="text-center font-sans text-sm text-white">
                  {errorMessage}
                </Text>
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={handleRetry}
                    accessibilityRole="button"
                    accessibilityLabel={t("retryScan")}
                    className="items-center rounded-lg bg-brand-green px-5 py-3 active:opacity-80"
                  >
                    <Text className="font-sans-semibold text-base text-white">
                      {t("retry")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={resetAndClose}
                    accessibilityRole="button"
                    accessibilityLabel={t("cancelScan")}
                    className="items-center rounded-lg bg-white/10 px-5 py-3 active:opacity-70"
                  >
                    <Text className="font-sans-semibold text-base text-white">
                      {t("cancel")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {permissionState === "granted" && captureState === "ready" ? (
              <Pressable
                onPress={handleCapture}
                accessibilityRole="button"
                accessibilityLabel={t("capturePhoto")}
                className="items-center rounded-lg bg-brand-green py-4 active:opacity-80"
              >
                <Text className="font-sans-semibold text-base text-white">
                  {t("capture")}
                </Text>
              </Pressable>
            ) : null}

            {captureState !== "processing" ? (
              <Pressable
                onPress={resetAndClose}
                accessibilityRole="button"
                accessibilityLabel={t("searchManually")}
                className="items-center py-2 active:opacity-70"
              >
                <Text className="font-sans text-sm text-white/70 underline">
                  {t("searchManually")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
