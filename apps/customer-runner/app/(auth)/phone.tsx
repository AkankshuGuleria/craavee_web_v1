import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { toAuthUiError, type AuthUiError } from "../../lib/auth/errors";
import { supabase } from "../../lib/supabase";

// India-only for now — the dossier's campus market. A country-code picker
// is a real future need (Craavee expanding beyond one country), not a
// Phase 3 concern; scoped here deliberately rather than half-built.
const COUNTRY_CODE = "+91";

export default function PhoneScreen() {
  const router = useRouter();
  const [digits, setDigits] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<AuthUiError | null>(null);

  const isValid = /^\d{10}$/.test(digits);

  async function handleSubmit() {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const phone = `${COUNTRY_CODE}${digits}`;
    const { error: sendError } = await supabase.auth.signInWithOtp({ phone });

    setIsSubmitting(false);
    if (sendError) {
      setError(toAuthUiError(sendError));
      return;
    }
    router.push({ pathname: "/(auth)/verify", params: { phone } });
  }

  return (
    <View className="flex-1 justify-center gap-6 bg-paper px-6">
      <View className="gap-2">
        <Text className="text-3xl font-bold text-brand-deep">Craavee</Text>
        <Text className="text-base text-inkdeep/70">
          Enter your phone number to get started.
        </Text>
      </View>

      <View className="flex-row items-center gap-2 rounded-lg border border-inkdeep/15 bg-white px-4 py-3">
        <Text className="text-base font-medium text-inkdeep">{COUNTRY_CODE}</Text>
        <TextInput
          className="flex-1 text-base text-inkdeep"
          keyboardType="number-pad"
          maxLength={10}
          placeholder="98765 43210"
          placeholderTextColor="#12201966"
          value={digits}
          onChangeText={(text) => setDigits(text.replace(/\D/g, ""))}
          autoFocus
          testID="phone-input"
        />
      </View>

      {error ? (
        <Text className="text-sm text-red-600" testID="phone-error">
          {error.message}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={!isValid || isSubmitting}
        onPress={handleSubmit}
        className={`items-center rounded-lg py-3 ${isValid && !isSubmitting ? "bg-brand" : "bg-inkdeep/20"}`}
        testID="send-otp-button"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#F3F5EC" />
        ) : (
          <Text className="text-base font-semibold text-paper">Send code</Text>
        )}
      </Pressable>
    </View>
  );
}
