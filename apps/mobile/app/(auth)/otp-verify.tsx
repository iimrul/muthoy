import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { normalizeBdPhoneInput, otpCodeSchema } from "@muthoy/validation";
import type { Session } from "@supabase/supabase-js";
import { AuthButton } from "../../components/auth/AuthButton";
import { AuthIconTile } from "../../components/auth/AuthIconTile";
import { otpSendErrorKey, otpVerifyErrorKey } from "../../components/auth/authMessages";
import { AuthNotice } from "../../components/auth/AuthNotice";
import { AuthShell } from "../../components/auth/AuthShell";
import { formatPhoneForDisplay } from "../../components/auth/phoneInput";
import { latinFont, useCopyFont } from "../../components/auth/typography";
import { OtpInput } from "../../components/ui/OtpInput";
import { StandardHeader } from "../../components/ui/StandardHeader";
import { showToast } from "../../components/ui/Toast";
import {
  createShopAndOwner,
  getOwnerOnboardingPayload,
  markShopCloudLinked,
} from "../../db/auth";
import type { CatalogKey } from "../../i18n/catalog";
import { useI18n } from "../../state/localeStore";
import { captureSession } from "../../state/sessionGuard";
import { LinkDeviceServerError, linkDeviceToShop } from "../../sync/linkDevice";
import { resendOtp, sendOtp, verifyOtp } from "../../sync/otp";
import { OTP_RESEND_COOLDOWN_SECONDS } from "../../sync/otpPolicy";
import { pullChanges } from "../../sync/pull";

// OTP Verify — prototype-web's OTPVerification look (Gen A): header, ring
// illustration, six boxes, a verifying card, the resend row and a manual
// Verify button. Everything that decides anything is unchanged: the hidden
// single-input OtpInput (SMS autofill, paste), verifyOtp, and the canonical
// onboarding → link-device → cloud-marker sequence H-2 pins.

/** The linking step's refusal, as something the screen can say and act on. */
function setupFailureKey(cause: unknown): { key: CatalogKey; codeExpired: boolean } {
  if (cause instanceof LinkDeviceServerError) {
    // The server's own OTP-freshness rule. Retrying setup with the same proof
    // can never pass, so the person is sent back for a new code instead of
    // being offered a "Try again" that would fail forever.
    if (cause.code === "otp_required") return { key: "otpCodeTooOld", codeExpired: true };
    if (cause.code === "device_enrollment_held") {
      return { key: "authErrorEnrollmentHeld", codeExpired: false };
    }
  }
  return { key: "otpSetupFailed", codeExpired: false };
}

export default function OtpVerifyScreen() {
  const { phone: phoneParam, shopName, resumeShopId, resumeOwnerUserId } = useLocalSearchParams<{
    phone: string;
    shopName?: string;
    resumeShopId?: string;
    // Supplied by app/index.tsx when resuming an interrupted registration, so
    // linkDeviceToShop can bind this auth account to the owner's app user (see
    // sync/linkDevice.ts). The users row exists locally but has not synced up
    // yet, which is why the id has to travel with the request.
    resumeOwnerUserId?: string;
  }>();
  // The number arrives as a route param — from Registration, or from a resumed
  // registration app/index.tsx read back out of SQLite — so it is outside
  // input and is canonicalized here, once. Every send, resend, verify and the
  // owner row then use this one string; a value that is not a Bangladeshi
  // mobile number reaches no OTP call at all.
  const phone = normalizeBdPhoneInput(phoneParam);
  const phoneInvalid = phone === null;
  const { t, formatNumber } = useI18n();
  const font = useCopyFont();
  const inputRef = useRef<TextInput>(null);
  const verifiedSessionRef = useRef<Session | null>(null);
  const pendingShopIdRef = useRef<string | null>(null);
  // Held alongside the shop id across a retry, for the same reason: a second
  // attempt must reuse the owner row the first one created rather than binding
  // a different id.
  const pendingOwnerUserIdRef = useRef<string | null>(null);
  const resendInFlightRef = useRef(false);
  const recoveryOtpRequestedRef = useRef(false);
  // When the code being typed was sent. Supabase refuses a wrong code and an
  // expired one identically, so this is what tells the two apart on screen.
  const codeSentAtRef = useRef<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<CatalogKey | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [hasVerifiedSession, setHasVerifiedSession] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isSendingRecoveryOtp, setIsSendingRecoveryOtp] = useState(false);
  const [cooldown, setCooldown] = useState(OTP_RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    // A fresh registration arrives here the moment Registration's send
    // succeeded. A resumed one sends its own code below.
    if (!resumeShopId) {
      codeSentAtRef.current = Date.now();
    }
  }, [resumeShopId]);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!resumeShopId || !phone || recoveryOtpRequestedRef.current) {
      return;
    }
    recoveryOtpRequestedRef.current = true;
    setIsSendingRecoveryOtp(true);
    void sendOtp(phone)
      .then(() => {
        codeSentAtRef.current = Date.now();
      })
      .catch((cause: unknown) => {
        const key = otpSendErrorKey(cause);
        // Rate-limited: the server refuses another code until the window
        // passes, so the resend waits too. Anything else may resend at once.
        setCooldown(key === "otpRateLimited" ? OTP_RESEND_COOLDOWN_SECONDS : 0);
        setError(key);
      })
      .finally(() => {
        setIsSendingRecoveryOtp(false);
      });
  }, [phone, resumeShopId]);

  const handleVerify = useCallback(
    async (token: string) => {
      if (
        isSubmitting ||
        isSendingRecoveryOtp ||
        !phone ||
        (!shopName && !resumeShopId)
      ) {
        return;
      }
      const guard = captureSession();
      setIsSubmitting(true);
      setError(null);
      let session = verifiedSessionRef.current;
      if (!session) {
        const parsed = otpCodeSchema.safeParse(token);
        if (!parsed.success) {
          setIsSubmitting(false);
          return;
        }
        try {
          session = await verifyOtp(phone, parsed.data);
          guard.assertLive();
          verifiedSessionRef.current = session;
          setHasVerifiedSession(true);
        } catch (cause) {
          if (!guard.isStillActive()) return;
          // Typed by sync/otp.ts from the auth error's status and code — wrong
          // and expired told apart by when the code was sent, and a check
          // that never happened never shown as a wrong code.
          setError(otpVerifyErrorKey(cause, codeSentAtRef.current, Date.now()));
          setCode("");
          inputRef.current?.focus();
          setIsSubmitting(false);
          return;
        }
      }

      try {
        let completedShopId: string;
        const linkedShopId = session.user.app_metadata.shop_id;

        if (resumeShopId) {
          await linkDeviceToShop(resumeShopId, resumeOwnerUserId, {
            isStillActive: guard.isStillActive,
          });
          completedShopId = resumeShopId;
        } else if (typeof linkedShopId === "string" && linkedShopId.length > 0) {
          setIsRestoring(true);
          await pullChanges(linkedShopId, null, () => !guard.isStillActive());
          completedShopId = linkedShopId;
        } else {
          let shopId = pendingShopIdRef.current;
          if (!shopId) {
            const created = await createShopAndOwner({ shopName: shopName!, phone });
            guard.assertLive();
            shopId = created.shopId;
            pendingShopIdRef.current = shopId;
            pendingOwnerUserIdRef.current = created.userId;
          }
          const ownerUserId = pendingOwnerUserIdRef.current ?? undefined;
          // The shop, roles and Owner travel WITH the link, because nothing
          // else can put them on the server: link-device reads the Owner back
          // to write the auth binding, and ordinary sync push refuses a caller
          // that has no binding yet. Without this a brand-new registration
          // never completes — the same gap DEV Skip-OTP had been papering over
          // with its own private bootstrap.
          const onboarding = ownerUserId
            ? await getOwnerOnboardingPayload(shopId, ownerUserId)
            : undefined;
          guard.assertLive();
          await linkDeviceToShop(shopId, ownerUserId, {
            onboarding,
            isStillActive: guard.isStillActive,
          });
          completedShopId = shopId;
        }
        guard.assertLive();
        await markShopCloudLinked(completedShopId);
        guard.assertLive();
        router.replace("/");
      } catch (cause) {
        if (!guard.isStillActive()) return;
        const failure = setupFailureKey(cause);
        if (failure.codeExpired) {
          // Back to a fresh code. The pending shop/owner refs are kept, so the
          // next verified code reuses the rows this attempt already created.
          verifiedSessionRef.current = null;
          setHasVerifiedSession(false);
          setCode("");
          setCooldown(0);
        }
        setError(failure.key);
      } finally {
        guard.ifLive(() => {
          setIsSubmitting(false);
          setIsRestoring(false);
        });
      }
    },
    [isSendingRecoveryOtp, isSubmitting, phone, resumeShopId, resumeOwnerUserId, shopName],
  );

  const handleCodeChange = (next: string) => {
    setCode(next);
    setError(null);
    if (next.length === 6) {
      void handleVerify(next);
    }
  };

  const handleResend = async () => {
    if (
      cooldown > 0 ||
      !phone ||
      verifiedSessionRef.current ||
      resendInFlightRef.current
    ) {
      return;
    }
    resendInFlightRef.current = true;
    setIsResending(true);
    try {
      await resendOtp(phone);
      codeSentAtRef.current = Date.now();
      setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setError(null);
      setCode("");
      inputRef.current?.focus();
      showToast({ message: t("otpResendRequested"), variant: "card" });
    } catch (cause) {
      const key = otpSendErrorKey(cause, "otpResendFailed");
      if (key === "otpRateLimited") {
        setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      }
      setError(key);
    } finally {
      resendInFlightRef.current = false;
      setIsResending(false);
    }
  };

  const isBusy = isSubmitting || isSendingRecoveryOtp;
  // Back is only offered while nothing irreversible has happened: a resumed
  // registration has nowhere to go back to, and once the phone is verified the
  // next step is setup, not a second registration.
  const canGoBack = !resumeShopId && !hasVerifiedSession && !isBusy;
  const setupFailed = hasVerifiedSession && error !== null;

  return (
    <AuthShell
      variant="brand"
      header={
        <StandardHeader
          tone="auth"
          safeAreaTop
          title={t("otpHeaderTitle")}
          onBackPress={canGoBack ? () => router.back() : undefined}
        />
      }
      footer={
        <View className="w-full gap-6">
          {!hasVerifiedSession ? (
            <View className="items-center">
              {cooldown > 0 ? (
                <Text className={`${font()} text-center text-sm text-midGray`}>
                  {t("otpResendIn")}{" "}
                  <Text className={`${latinFont("bold")} text-brand-green`}>
                    {formatNumber(cooldown)}
                    {t("otpSecondsSuffix")}
                  </Text>
                </Text>
              ) : (
                <AuthButton
                  variant="link"
                  leadingIcon="refresh"
                  label={t("otpResend")}
                  loading={isResending}
                  disabled={isBusy || phoneInvalid}
                  onPress={() => void handleResend()}
                />
              )}
            </View>
          ) : null}
          {code.length === 6 && !isBusy && !hasVerifiedSession ? (
            <AuthButton
              variant="gradient"
              leadingIcon="check"
              label={t("otpVerify")}
              onPress={() => void handleVerify(code)}
            />
          ) : null}
        </View>
      }
    >
      <View className="items-center pt-4">
        <AuthIconTile icon="email-check-outline" variant="ring" />
        <View className="mb-8 mt-8 items-center">
          <Text accessibilityRole="header" className={`${font("bold")} mb-2 text-center text-xl text-richBlack`}>
            {isRestoring ? t("otpRestoringTitle") : t("otpTitle")}
          </Text>
          <Text className={`${font()} text-center text-sm text-midGray`}>
            {isRestoring ? t("otpRestoringBody") : t("otpCheckMessages")}
          </Text>
          {!isRestoring ? (
            <Text className={`${latinFont("bold")} mt-1 text-center text-base text-richBlack`}>
              {formatPhoneForDisplay(phone ?? phoneParam ?? "")}
            </Text>
          ) : null}
        </View>
      </View>

      {!isRestoring ? (
        <OtpInput
          ref={inputRef}
          value={code}
          onChangeText={handleCodeChange}
          error={Boolean(error) && !hasVerifiedSession}
          disabled={isSendingRecoveryOtp || phoneInvalid}
          verifying={isSubmitting}
        />
      ) : null}

      <View className="mt-6 gap-4">
        {error ? (
          <AuthNotice tone="brandError" align="center" message={t(error)} />
        ) : phoneInvalid ? (
          <AuthNotice tone="brandError" align="center" message={t("authPhoneInvalid")} />
        ) : null}
        {isSubmitting || isRestoring ? (
          <AuthNotice tone="brandProgress" message={isRestoring ? t("otpRestoringTitle") : t("otpVerifying")} />
        ) : null}
        {setupFailed ? (
          <AuthButton
            variant="gradient"
            label={t("otpSetupRetry")}
            disabled={isSubmitting}
            onPress={() => void handleVerify(code)}
          />
        ) : null}
      </View>
    </AuthShell>
  );
}
