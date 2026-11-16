import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppTextInput } from "../ui/AppTextInput";
import { confirmOwnerRecoveryCode, getOwnerRecoveryStatus, type OwnerRecoveryStatus } from "../../db/recoveryCustody";
import { generateRecoveryCode } from "../../domain/recoveryArchive";
import { getDeviceId } from "../../native/deviceId";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore, type Session } from "../../state/sessionStore";
import { useI18n } from "../../state/localeStore";
import { getRecoveryRunState, subscribeToRecoveryStatus } from "../../sync/recoveryCoordinator";
import { subscribeToSyncCompletion, triggerSyncNow } from "../../sync";

export function RecoveryBackupSetup({ session }: { session: Session }) {
  const epoch = useSessionStore(state => state.epoch);
  return <RecoveryBackupSetupContent key={session.shopId + ":" + session.userId + ":" + epoch} session={session} />;
}
function RecoveryBackupSetupContent({ session }: { session: Session }) {
  const { t, formatNumber } = useI18n();
  const [status, setStatus] = useState<OwnerRecoveryStatus | null>(null);
  const [open,setOpen] = useState(false);
  const [code,setCode] = useState("");
  const [confirmation,setConfirmation] = useState("");
  const [error,setError] = useState(false);
  const [busy,setBusy] = useState(false);
  const [runState,setRunState] = useState(getRecoveryRunState(session.shopId));
  const attempt = useRef({ value: 0 });
  const close = useCallback(() => { attempt.current.value++; setOpen(false); setCode(""); setConfirmation(""); setError(false); setBusy(false); },[]);
  useEffect(() => {
    const lifetime = attempt.current;
    const sub = AppState.addEventListener("change",state => { if(state !== "active") close(); });
    return () => { lifetime.value++; sub.remove(); };
  },[close]);
  useFocusEffect(useCallback(() => {
    if(session.role !== "owner") return;
    let active = true;
    const refresh = async () => {
      const guard = captureSessionFor(session); if(!guard) return;
      try {
        const next = await getOwnerRecoveryStatus({shopId:session.shopId,ownerId:session.userId,isStillActive:guard.isStillActive},getDeviceId());
        if(active) guard.ifLive(() => { setStatus(next); setRunState(getRecoveryRunState(session.shopId)); });
      } catch { if(active) guard.ifLive(() => setStatus(null)); }
    };
    void refresh();
    const stopSync = subscribeToSyncCompletion(session.shopId,refresh);
    const stopBackup = subscribeToRecoveryStatus(session.shopId,() => void refresh());
    return () => { active=false; stopSync(); stopBackup(); close(); };
  },[session,close]));
  if(session.role !== "owner") return null;
  async function generate() {
    const guard = captureSessionFor(session); if(!guard) return;
    const token=++attempt.current.value;setBusy(true);setError(false);
    try {
      const {nativeRecoveryCipher} = await import("../../native/recoveryCrypto");
      if(!guard.isStillActive() || token !== attempt.current.value) return;
      const generated = await generateRecoveryCode(nativeRecoveryCipher);
      if(token === attempt.current.value) guard.ifLive(() => {setCode(generated);setConfirmation("");setOpen(true);});
    } catch { if(token === attempt.current.value) guard.ifLive(() => setError(true)); }
    finally { if(token === attempt.current.value) guard.ifLive(() => setBusy(false)); }
  }
  async function confirm() {
    const guard = captureSessionFor(session); if(!guard || !code || busy) return;
    const token=attempt.current.value;setBusy(true);setError(false);
    try {
      await confirmOwnerRecoveryCode({shopId:session.shopId,ownerId:session.userId,isStillActive:()=>guard.isStillActive() && token === attempt.current.value},code,confirmation);
      if(token !== attempt.current.value || !guard.isStillActive()) return;
      close();
      const next=await getOwnerRecoveryStatus({shopId:session.shopId,ownerId:session.userId,isStillActive:guard.isStillActive},getDeviceId());
      guard.ifLive(()=>setStatus(next));
    } catch { if(token === attempt.current.value) guard.ifLive(()=>setError(true)); }
    finally { if(token === attempt.current.value) guard.ifLive(()=>setBusy(false)); }
  }
  const reason = runState === "incomplete" ? t("recoveryIncomplete") : runState === "oversize" ? t("recoveryOversize") : runState === "credentials_pending" ? t("recoveryCredentialsPending") : t("recoveryHostedInactive");
  return <View className="gap-3 rounded-xl border border-midGray bg-white p-4">
    <Text className="font-sans-semibold text-base text-richBlack">{t("recoveryTitle")}</Text>
    <Text className="font-sans text-sm text-richBlack">{status ? status.enabled ? t("recoveryConfigured") : t("recoveryDisabled") : t("syncExposureUnavailable")}</Text>
    <Text className="font-sans text-sm text-richBlack">{t("recoveryVerifiedCopy")}: {status?.verifiedAt ?? t("recoveryNever")}</Text>
    <Text className="font-sans text-sm text-richBlack">{t("recoveryUnprotected")}: {status ? formatNumber(status.unprotectedChanges) : t("syncExposureUnavailable")}</Text>
    <Text className="font-sans text-sm text-midGray">{reason}</Text>
    <Text className="font-sans text-sm text-midGray">{t("recoveryLimits")}</Text>
    {status && !status.enabled ? <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void generate()} className="rounded-lg bg-brand-green p-3"><Text className="font-sans-semibold text-white">{t("recoverySetup")}</Text></Pressable> : null}
    {status?.enabled ? <Pressable accessibilityRole="button" onPress={()=>{const guard=captureSessionFor(session);if(guard)void triggerSyncNow(session.shopId);}} className="rounded-lg border border-midGray p-3"><Text className="font-sans-semibold text-richBlack">{t("recoveryCheck")}</Text></Pressable> : null}
    {error ? <Text accessibilityRole="alert" className="font-sans text-sm text-error">{t("recoverySetupError")}</Text> : null}
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 justify-center bg-black/40 p-5"><View className="gap-4 rounded-xl bg-white p-5">
        <Text className="font-sans-semibold text-lg text-richBlack">{t("recoverySaveCode")}</Text>
        <Text className="font-sans text-sm text-richBlack">{t("recoveryCodeWarning")}</Text>
        <Text testID="recovery-code" className="font-mono text-base text-richBlack">{code}</Text>
        <AppTextInput accessibilityLabel={t("recoveryConfirmCode")} value={confirmation} onChangeText={setConfirmation} autoCapitalize="none" autoCorrect={false} secureTextEntry className="rounded-lg border border-midGray p-3" />
        <Pressable accessibilityRole="button" disabled={busy || !confirmation.trim()} onPress={()=>void confirm()} className="rounded-lg bg-brand-green p-3"><Text className="font-sans-semibold text-white">{t("recoveryConfirmCode")}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={close}><Text className="font-sans-semibold text-richBlack">{t("cancel")}</Text></Pressable>
      </View></View>
    </Modal>
  </View>;
}
