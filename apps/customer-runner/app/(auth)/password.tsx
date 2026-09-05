/**
 * Sign in with a password.
 *
 * The identity is still the phone number — this screen is a second way to
 * prove the same identity, not a second account. Verified against real
 * staging before it was written: `signInWithPassword({ phone, password })`
 * returns the SAME `auth.users` id as OTP for the same number, and the
 * token it issues carries the same server `role` claim, so role routing is
 * identical whichever credential was used.
 *
 * REACHED BY CHOICE, NOT BY DEFAULT. The entry screen leads with the code
 * route because that is the one every account can use; a password only
 * exists if the customer chose to set one. Putting both on the first screen
 * with equal weight would ask a question most people cannot answer yet.
 *
 * The recovery route is a real one, not a placeholder: "use a code instead"
 * signs in via OTP, from which the customer can set a new password. There
 * is no email reset because email is disabled on this project, so an email
 * reset screen would be a dead end.
 */
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { Screen } from "../../components/ui";
import { passwordSignInMessage } from "../../lib/auth/password";
import { supabase } from "../../lib/supabase";
import { theme } from "../../lib/theme";

const COUNTRY_CODE = "+91";

export default function PasswordSignInScreen() {
  const router = useRouter();
  const [digits, setDigits] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = /^\d{10}$/.test(digits) && password.length > 0;

  async function handleSubmit() {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      phone: `${COUNTRY_CODE}${digits}`,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      // Mapped, never raw. The provider returns the same message for a wrong
      // password and for an account with no password set - preserving that
      // ambiguity is what stops this screen confirming which numbers exist.
      setError(passwordSignInMessage(signInError.message));
      return;
    }

    // No manual navigation: AuthBoundary observes the new session, resolves
    // the server role, and routes. Pushing a destination here would be a
    // second routing authority and could disagree with it.
    setPassword("");
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <View className="flex-1 justify-center">
        <Text className="text-3xl font-bold text-brand-deep" accessibilityRole="header">
          Sign in
        </Text>
        <Text className="mt-2 text-sm text-inkdeep/60">
          Use the password you set for your Craavee account.
        </Text>

        <View className="mt-8 flex-row items-center gap-2 rounded-xl border border-inkdeep/15 bg-white px-4 py-3">
          <Text className="text-base font-medium text-inkdeep">{COUNTRY_CODE}</Text>
          <TextInput
            className="min-h-[44px] flex-1 text-base text-inkdeep"
            keyboardType="number-pad"
            maxLength={10}
            placeholder="98765 43210"
            placeholderTextColor={theme.textFaint}
            value={digits}
            onChangeText={(t) => setDigits(t.replace(/\D/g, ""))}
            accessibilityLabel="Phone number"
            autoComplete="tel"
            testID="password-phone"
          />
        </View>

        <View className="mt-3 flex-row items-center gap-2 rounded-xl border border-inkdeep/15 bg-white px-4 py-3">
          <TextInput
            className="min-h-[44px] flex-1 text-base text-inkdeep"
            placeholder="Password"
            placeholderTextColor={theme.textFaint}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            // `password` rather than `current-password` keeps managers from
            // offering to save a value the customer is still typing.
            autoComplete="password"
            accessibilityLabel="Password"
            testID="password-input"
            onSubmitEditing={handleSubmit}
            returnKeyType="go"
          />
          <Pressable
            accessibilityRole="button"
            // The label states the ACTION, not the state - a screen reader
            // user needs to know what pressing it will do.
            accessibilityLabel={reveal ? "Hide password" : "Show password"}
            hitSlop={12}
            onPress={() => setReveal((v) => !v)}
            testID="password-reveal"
            className="min-h-[44px] justify-center pl-2"
          >
            <Text className="text-xs font-semibold text-brand">{reveal ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>

        {error ? (
          <Text
            // Announced, not just coloured - an error a screen reader never
            // reads is an error the customer never gets.
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="mt-3 text-sm text-mango"
            testID="password-error"
          >
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ disabled: !isValid || isSubmitting, busy: isSubmitting }}
          disabled={!isValid || isSubmitting}
          onPress={handleSubmit}
          testID="password-submit"
          className={`mt-6 min-h-[56px] items-center justify-center rounded-2xl ${
            isValid && !isSubmitting ? "bg-brand" : "bg-inkdeep/20"
          }`}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-bold text-white">Sign in</Text>
          )}
        </Pressable>

        {/* The real recovery route. Not a dead-end "reset by email" - email
            is disabled on this project, so that screen could deliver
            nothing. A code proves control of the number just as well, and
            the customer can set a new password once inside. */}
        <Link href="/(auth)/phone" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in with a code instead"
            accessibilityHint="Sends a one-time code to your phone. You can set a new password afterwards"
            testID="password-use-code"
            className="mt-5 min-h-[44px] items-center justify-center"
          >
            <Text className="text-sm font-semibold text-brand">
              Forgot it? Sign in with a code instead
            </Text>
          </Pressable>
        </Link>
      </View>
    </Screen>
  );
}
