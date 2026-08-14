import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { otpCodeSchema } from "@muthoy/validation";
import type { Session } from "@supabase/supabase-js";
import { OtpInput } from "../../components/ui/OtpInput";
import { createShopAndOwner, markShopCloudLinked } from "../../db/auth";
import { linkDeviceToShop } from "../../sync/linkDevice";
import { resendOtp, sendOtp, verifyOtp } from "../../sync/otp";
import { pullChanges } from "../../sync/pull";

const RESEND_COOLDOWN_SECONDS = 30;

export default function OtpVerifyScreen() {
  const { phone, shopName, resumeShopId } = useLocalSearchParams<{
    phone: string;
    shopName?: string;
    resumeShopId?: string;
  }>();
  const inputRef = useRef<TextInput>(null);
  const verifiedSessionRef = useRef<Session | null>(null);
  const pendingShopIdRef = useRef<string | null>(null);
  const resendInFlightRef = useRef(false);
  const recoveryOtpRequestedRef = useRef(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [hasVerifiedSession, setHasVerifiedSession] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isSendingRecoveryOtp, setIsSendingRecoveryOtp] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

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
      .catch(() => {
        setCooldown(0);
        Alert.alert(
          "OTP could not be sent",
          "Check your connection and phone number, then try again.",
        );
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
          verifiedSessionRef.current = session;
          setHasVerifiedSession(true);
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message.toLowerCase() : "";
          setError(
            message.includes("expired")
              ? "Code expired — request a new one"
              : "Incorrect code — try again",
          );
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
          await linkDeviceToShop(resumeShopId);
          completedShopId = resumeShopId;
        } else if (typeof linkedShopId === "string" && linkedShopId.length > 0) {
          setIsRestoring(true);
          await pullChanges(linkedShopId, null);
          completedShopId = linkedShopId;
        } else {
          let shopId = pendingShopIdRef.current;
          if (!shopId) {
            ({ shopId } = await createShopAndOwner({ shopName: shopName!, phone }));
            pendingShopIdRef.current = shopId;
          }
          await linkDeviceToShop(shopId);
          completedShopId = shopId;
        }
        await markShopCloudLinked(completedShopId);
        router.replace("/");
      } catch {
        setError("Phone verified, but shop setup did not finish. Try again.");
        Alert.alert(
          "Shop setup incomplete",
          "Your phone is verified. Check your connection and try setup again.",
        );
      } finally {
        setIsSubmitting(false);
        setIsRestoring(false);
      }
    },
    [isSendingRecoveryOtp, isSubmitting, phone, resumeShopId, shopName],
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
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setError(null);
      setCode("");
      inputRef.current?.focus();
    } catch {
      Alert.alert(
        "OTP could not be resent",
        "Check your connection and try again.",
      );
    } finally {
      resendInFlightRef.current = false;
      setIsResending(false);
    }
  };

  return (
    <View className="flex-1 justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-2">
        <Text className="font-sans-bold text-2xl text-richBlack">
          {isRestoring ? "Restoring your shop data…" : "Verify your phone"}
        </Text>
        <Text className="font-sans text-center text-sm text-midGray">
          {isRestoring
            ? "Keep the app open while your records download."
            : "Enter the code sent to " + (phone ?? "")}
        </Text>
      </View>

      {!isRestoring ? (
        <OtpInput
          ref={inputRef}
          value={code}
          onChangeText={handleCodeChange}
          error={Boolean(error)}
          disabled={isSubmitting || isSendingRecoveryOtp}
        />
      ) : null}

      {error ? (
        <Text className="font-sans text-center text-sm text-error">
          {error}
        </Text>
      ) : null}

      {hasVerifiedSession && error ? (
        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={() => void handleVerify(code)}
          className="items-center rounded-lg bg-brand-green py-3.5"
        >
          <Text className="font-sans-semibold text-base text-white">
            Try setup again
          </Text>
        </Pressable>
      ) : null}

      {!hasVerifiedSession ? (
        <Pressable
          accessibilityRole="button"
          disabled={
            cooldown > 0 ||
            isSubmitting ||
            isResending ||
            isSendingRecoveryOtp
          }
          onPress={() => void handleResend()}
          className="items-center py-3"
        >
          <Text className="font-sans-semibold text-sm text-brand-green">
            {cooldown > 0 ? "Resend code in " + cooldown + "s" : "Resend code"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
