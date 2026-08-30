import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { toAuthUiError, type AuthUiError } from "../../lib/auth/errors";
import { supabase } from "../../lib/supabase";

const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<AuthUiError | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const isValid = /^\d{6}$/.test(code);

  async function handleVerify() {
    if (!isValid || isSubmitting || !phone) return;
    setIsSubmitting(true);
    setError(null);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });

    setIsSubmitting(false);
    if (verifyError) {
      setError(toAuthUiError(verifyError));
      return;
    }
    // No manual navigation on success: the session change flows into
    // AuthProvider via onAuthStateChange, and the root AuthBoundary
    // redirects into the right route group once the role claim loads —
    // a second, competing navigation here would race it.
  }

  async function handleResend() {
    if (cooldown > 0 || isResending || !phone) return;
    setIsResending(true);
    setError(null);

    const { error: resendError } = await supabase.auth.signInWithOtp({ phone });

    setIsResending(false);
    if (resendError) {
      setError(toAuthUiError(resendError));
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <View className="flex-1 justify-center gap-6 bg-paper px-6">
      <View className="gap-2">
        <Text className="text-3xl font-bold text-brand-deep">Enter the code</Text>
        <Text className="text-base text-inkdeep/70">
          We sent a 6-digit code to {phone ?? "your phone"}.
        </Text>
      </View>

      <TextInput
        className="rounded-lg border border-inkdeep/15 bg-white px-4 py-3 text-center text-2xl tracking-[8px] text-inkdeep"
        keyboardType="number-pad"
        maxLength={6}
        placeholder="000000"
        placeholderTextColor="#12201933"
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, ""))}
        autoFocus
        testID="otp-input"
      />

      {error ? (
        <Text className="text-sm text-red-600" testID="verify-error">
          {error.message}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={!isValid || isSubmitting}
        onPress={handleVerify}
        className={`items-center rounded-lg py-3 ${isValid && !isSubmitting ? "bg-brand" : "bg-inkdeep/20"}`}
        testID="verify-button"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#F3F5EC" />
        ) : (
          <Text className="text-base font-semibold text-paper">Verify</Text>
        )}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={cooldown > 0 || isResending}
        onPress={handleResend}
        className="items-center py-2"
        testID="resend-button"
      >
        <Text className={cooldown > 0 ? "text-inkdeep/40" : "text-brand"}>
          {isResending ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Text>
      </Pressable>
    </View>
  );
}
