/**
 * Set (or change) the account password.
 *
 * WHY THIS SCREEN IS BEHIND AUTHENTICATION, and why that is the whole
 * security design rather than an inconvenience:
 *
 * Every Craavee account was created by phone OTP, so no account has a
 * password until its owner sets one here. Enrolment therefore requires an
 * already-authenticated session — which means the customer has just proved
 * control of the phone number by receiving a code. `updateUser` applies the
 * password to that same `auth.users` row, so no second identity is created
 * and no verification step is skipped.
 *
 * §35 is explicit and this obeys it: **the password is chosen by the
 * customer.** Nothing here generates one, suggests one, or sets one
 * silently on an existing account.
 *
 * This is also the recovery endpoint. "Forgot password" on the sign-in
 * screen routes through OTP, and OTP lands the customer in the app — from
 * here they set a new one. That is a complete recovery loop over a channel
 * that actually exists, rather than an email reset this project cannot
 * deliver.
 *
 * The value is never logged, never persisted locally, and never placed in a
 * route param.
 */
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { Screen } from "../../components/ui";
import { haptic } from "../../lib/haptics";
import {
  MIN_PASSWORD_LENGTH,
  passwordProblemMessage,
  validatePasswordPair,
} from "../../lib/auth/password";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";

export default function SetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reveal, setReveal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (isSubmitting) return;

    // Validated before anything leaves the device, so an obviously bad
    // password never becomes a network round trip or a provider error.
    const problem = validatePasswordPair(password, confirmation);
    if (problem) {
      setError(passwordProblemMessage(problem));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    setIsSubmitting(false);

    if (updateError) {
      // Mapped, never raw.
      setError(
        /weak|short|password/i.test(updateError.message)
          ? "That password was rejected. Try a longer one."
          : "We couldn't save that just now. Check your connection and try again.",
      );
      return;
    }

    // Cleared immediately: no reason for the value to outlive the request.
    setPassword("");
    setConfirmation("");
    // A committed credential change the customer should feel land.
    haptic("success");
    setDone(true);
  }

  if (done) {
    return (
      <Screen edges={["top", "bottom"]}>
        <Stack.Screen options={{ title: "Password" }} />
        <View className="flex-1 justify-center">
          <Text className="text-2xl font-bold text-brand-deep" accessibilityRole="header">
            Password saved
          </Text>
          <Text className="mt-2 text-sm leading-5 text-inkdeep/60">
            You can now sign in with your phone number and this password. A one-time
            code still works too — whichever is easier.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={() => router.back()}
            testID="set-password-done"
            className="mt-8 min-h-[52px] items-center justify-center rounded-2xl bg-brand"
          >
            <Text className="text-base font-bold text-white">Done</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <Stack.Screen options={{ title: "Set a password" }} />
      <View className="flex-1 justify-center">
        <Text className="text-2xl font-bold text-brand-deep" accessibilityRole="header">
          Set a password
        </Text>
        <Text className="mt-2 text-sm leading-5 text-inkdeep/60">
          An optional, faster way to sign in. Your phone number stays your account —
          a one-time code will always work.
        </Text>

        <View className="mt-8 flex-row items-center gap-2 rounded-xl border border-inkdeep/15 bg-white px-4 py-3">
          <TextInput
            className="min-h-[44px] flex-1 text-base text-inkdeep"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            placeholderTextColor={theme.textFaint}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            accessibilityLabel="New password"
            testID="set-password-new"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reveal ? "Hide password" : "Show password"}
            hitSlop={12}
            onPress={() => setReveal((v) => !v)}
            testID="set-password-reveal"
            className="min-h-[44px] justify-center pl-2"
          >
            <Text className="text-xs font-semibold text-brand">{reveal ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>

        <View className="mt-3 rounded-xl border border-inkdeep/15 bg-white px-4 py-3">
          <TextInput
            className="min-h-[44px] text-base text-inkdeep"
            placeholder="Confirm password"
            placeholderTextColor={theme.textFaint}
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            accessibilityLabel="Confirm new password"
            testID="set-password-confirm"
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
          />
        </View>

        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="mt-3 text-sm text-mango"
            testID="set-password-error"
          >
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save password"
          accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
          disabled={isSubmitting}
          onPress={handleSubmit}
          testID="set-password-submit"
          className={`mt-6 min-h-[56px] items-center justify-center rounded-2xl ${
            isSubmitting ? "bg-inkdeep/20" : "bg-brand"
          }`}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-bold text-white">Save password</Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}
