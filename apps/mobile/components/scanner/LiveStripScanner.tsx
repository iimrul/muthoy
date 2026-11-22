import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StatusBar, Text, View } from "react-native";
import type { CameraPermissionState } from "../../domain/cameraPermissionState";
import { buildStripIndex, type ScanVocabularyEntry, type StripIndex } from "../../domain/stripMatcher";
import { getActiveBatchForMedicine } from "../../db/sales";
import { listScanVocabulary } from "../../db/scanVocabulary";
import { ScannerCamera, type ScannerCameraHandle } from "../../native/ScannerCamera";
import { scanBarcode } from "../../native/scanner";
import { playScanBeep } from "../../native/scanSound";
import { useCartStore } from "../../state/cartStore";
import { useI18n } from "../../state/localeStore";
import {
  LiveScanCartBar,
  LiveScanChoices,
  LiveScanNoticeBanner,
  type LiveScanNotice,
  type LiveScanNoticeTone,
} from "./LiveScanPanels";
import { ScannerPermissionPanel } from "./ScannerPermissionPanel";
import { useLiveStripScan, type LiveScanAction } from "./useLiveStripScan";

// components/scanner/LiveStripScanner.tsx — scan-to-sell without pressing
// anything: bring a strip in front of the camera and it is in the cart.
//
// FOUNDER DECISION 2026-11-20 (recorded in docs/plans/ocr-and-multilingual-
// search.md): this REPLACES the W2-01 confirmation sheet on the sale scan. A
// confident match adds one unit straight away with a short Undo window; an
// ambiguous strip is offered as a one-tap choice and never guessed; a strip
// that is not in the shop's inventory says so. Prescription medicines add the
// same way — the cart and checkout carry the prescription warning. What did
// NOT change: the stock ceiling (addItem refuses past available stock), the
// FEFO batch (getActiveBatchForMedicine, real expiry dates) and everything
// offline: the dictionary is the shop's own SQLite inventory.

const UNDO_WINDOW_MS = 3_000;
const NOTICE_MS = 1_800;
const BARCODE_RELOCK_MS = 900;

let nextNoticeId = 0;

export interface LiveStripScannerProps {
  visible: boolean;
  shopId: string;
  userId: string;
  onClose: () => void;
  /** "Done" — the seller is finished scanning and wants the cart. */
  onDone: () => void;
  /** Defaults to onClose. */
  onManualSearch?: () => void;
  /** The Sale tab's existing barcode path, passed through unchanged (Q1). */
  onBarcodeRecognized?: (data: string, format: string) => void | Promise<void>;
  /** Test seam. */
  frameIntervalMs?: number;
}

/** Unmounted while hidden, so every opening starts a fresh scanning session. */
export function LiveStripScanner(props: LiveStripScannerProps) {
  return props.visible ? <LiveStripScannerModal {...props} /> : null;
}

type LoadState = "loading" | "ready" | "failed";

const FRAME_BORDER: Record<LiveScanNoticeTone | "idle", string> = {
  idle: "border-white/40",
  success: "border-brand-green",
  warning: "border-warning",
  error: "border-error",
};

function LiveStripScannerModal({
  shopId,
  userId,
  onClose,
  onDone,
  onManualSearch,
  onBarcodeRecognized,
  frameIntervalMs,
}: LiveStripScannerProps) {
  const { t } = useI18n();
  const cameraRef = useRef<ScannerCameraHandle>(null);
  const barcodeLockedRef = useRef(false);
  const [permissionState, setPermissionState] = useState<CameraPermissionState>("checking");
  const [cameraKey, setCameraKey] = useState(0);
  const [index, setIndex] = useState<StripIndex | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [notice, setNotice] = useState<LiveScanNotice | null>(null);
  const [choices, setChoices] = useState<readonly ScanVocabularyEntry[] | null>(null);
  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);

  useEffect(() => {
    let isCurrent = true;
    listScanVocabulary(shopId, userId)
      .then((vocabulary) => {
        if (!isCurrent) return;
        setIndex(buildStripIndex(vocabulary));
        setLoadState("ready");
      })
      .catch(() => {
        if (isCurrent) setLoadState("failed");
      });
    return () => {
      isCurrent = false;
    };
  }, [shopId, userId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(
      () => setNotice((current) => (current?.id === notice.id ? null : current)),
      notice.undoMedicineId ? UNDO_WINDOW_MS : NOTICE_MS,
    );
    return () => clearTimeout(timer);
  }, [notice]);

  const showNotice = useCallback((next: Omit<LiveScanNotice, "id">) => {
    nextNoticeId += 1;
    setNotice({ ...next, id: nextNoticeId });
  }, []);

  const addToCart = useCallback(
    async (medicine: ScanVocabularyEntry) => {
      const outOfStock = { tone: "warning", title: t("liveScanOutOfStock"), message: medicine.name } as const;
      if (!medicine.isSellable) return showNotice(outOfStock);
      try {
        const batch = await getActiveBatchForMedicine(shopId, medicine.medicineId);
        if (!batch) return showNotice(outOfStock);
        const isAdded = addItem({
          medicineId: medicine.medicineId,
          medicineName: medicine.name,
          generic: medicine.generic,
          manufacturer: medicine.manufacturer,
          requiresPrescription: medicine.requiresPrescription,
          batchId: batch.id,
          expiryDate: batch.expiryDate,
          availableQuantity: batch.quantityAvailable,
          quantity: 1,
          unitPrice: batch.salePrice,
        });
        if (!isAdded) {
          return showNotice({ tone: "warning", title: t("cartQuantityAtStockLimitLabel"), message: medicine.name });
        }
        // Only a unit that really entered the cart beeps (prototype parity).
        playScanBeep();
        return showNotice({
          tone: "success",
          title: `${t("liveScanAddedLabel")}: ${medicine.name}`,
          message: medicine.requiresPrescription ? t("requiresPrescriptionLabel") : undefined,
          undoMedicineId: medicine.medicineId,
        });
      } catch {
        return showNotice({ tone: "error", title: t("scanSearchFailed") });
      }
    },
    [addItem, shopId, showNotice, t],
  );

  const handleAction = useCallback(
    async (action: LiveScanAction) => {
      if (action.kind === "add") await addToCart(action.medicine);
      else if (action.kind === "choose") setChoices(action.options);
      else showNotice({ tone: "error", title: t("liveScanNotFound") });
    },
    [addToCart, showNotice, t],
  );

  const { isReadFailing, lockMedicines } = useLiveStripScan({
    isEnabled: permissionState === "granted" && loadState === "ready" && choices === null,
    cameraRef,
    index,
    onAction: handleAction,
    frameIntervalMs,
  });

  const resolveChoice = (picked: ScanVocabularyEntry | null) => {
    // Every option is locked: the strip that raised the question is still in
    // view, and must not raise it again the moment scanning resumes.
    lockMedicines((choices ?? []).map((option) => option.medicineId));
    setChoices(null);
    if (picked) void addToCart(picked);
  };

  const undo = (medicineId: string) => {
    const cart = useCartStore.getState();
    const line = cart.items.find((item) => item.medicineId === medicineId);
    if (line) cart.updateQuantity(medicineId, line.quantity - 1);
    showNotice({ tone: "warning", title: t("liveScanUndone"), message: line?.medicineName });
  };

  const handleBarcode = async ({ data, type }: { data: string; type: string }) => {
    if (!onBarcodeRecognized || barcodeLockedRef.current) return;
    const result = scanBarcode(data, type);
    if (!result) return;
    barcodeLockedRef.current = true;
    try {
      await onBarcodeRecognized(result.data, result.format);
    } catch {
      showNotice({ tone: "error", title: t("scanSearchFailed") });
    } finally {
      setTimeout(() => {
        barcodeLockedRef.current = false;
      }, BARCODE_RELOCK_MS);
    }
  };

  const hint =
    loadState === "loading"
      ? t("liveScanLoading")
      : loadState === "failed"
        ? t("liveScanLoadFailed")
        : isReadFailing
          ? t("liveScanReadFailed")
          : t("liveScanHint");
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Modal visible statusBarTranslucent presentationStyle="fullScreen" animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white">
        <View pointerEvents="none" className="bg-white" style={{ height: StatusBar?.currentHeight ?? 0 }} />
        <View className="flex-1 bg-richBlack">
          <ScannerCamera
            key={cameraKey}
            ref={cameraRef}
            isContinuous
            onPermissionStateChange={setPermissionState}
            barcodeEnabled={Boolean(onBarcodeRecognized)}
            onBarcodeScanned={(result) => void handleBarcode(result)}
          />
          <View className="absolute inset-0">
            <View className="flex-row justify-end p-4">
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t("closeScanner")}
                hitSlop={8}
                className="h-10 w-10 items-center justify-center rounded-full bg-white/10 active:opacity-70"
              >
                <Text className="font-sans-semibold text-lg text-white">✕</Text>
              </Pressable>
            </View>
            {notice ? <LiveScanNoticeBanner notice={notice} onUndo={undo} /> : null}
            <View className="flex-1 items-center justify-center gap-4 p-10">
              {permissionState === "granted" ? (
                <>
                  <View
                    className={`aspect-square w-full max-w-sm rounded-3xl border-2 ${FRAME_BORDER[notice?.tone ?? "idle"]}`}
                  />
                  <Text className="text-center font-sans text-sm text-white/80">{hint}</Text>
                </>
              ) : null}
            </View>
            <View className="gap-4 p-6 pb-10">
              <ScannerPermissionPanel
                permissionState={permissionState}
                onRequestPermission={async () => (await cameraRef.current?.requestPermission()) ?? false}
                onRetryMount={() => setCameraKey((key) => key + 1)}
              />
              {permissionState === "granted" && choices ? (
                <LiveScanChoices options={choices} onChoose={resolveChoice} onDismiss={() => resolveChoice(null)} />
              ) : null}
              {permissionState === "granted" && !choices ? (
                <LiveScanCartBar
                  lines={items.map((item) => ({
                    medicineId: item.medicineId,
                    name: item.medicineName,
                    quantity: item.quantity,
                  }))}
                  itemCount={itemCount}
                  total={useCartStore.getState().total()}
                  onDone={onDone}
                  onManualSearch={onManualSearch ?? onClose}
                />
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
