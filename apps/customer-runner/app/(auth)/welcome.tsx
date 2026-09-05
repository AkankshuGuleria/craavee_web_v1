/**
 * The entry screen — the first thing a person sees.
 *
 * Before this, an unauthenticated launch dropped straight onto a bare
 * phone-number field. Functionally fine, and it told a first-time visitor
 * nothing: not what Craavee is, not what it delivers, not why they should
 * hand over their number. The number field is the second question; this
 * screen answers the first.
 *
 * EVERY CLAIM ON THIS SCREEN IS TRUE, and that constraint did most of the
 * design work. Quick-commerce entry screens are usually built on speed
 * promises — "10 minutes", "free delivery", "lowest prices". Craavee can
 * say none of those:
 *
 *   - There is no delivery-time SLA anywhere in the schema, so no time is
 *     promised.
 *   - Delivery is NOT free; `addresses.delivery_fee` is real and non-zero
 *     (₹10–₹12 in the current data), so "free delivery" would be a lie.
 *   - There is no price-comparison data, so "best prices" is unsupportable.
 *
 * What IS true and worth saying: it is a campus store, it delivers to your
 * hostel block, a real person brings it, and you can watch it happen. The
 * three lines below are exactly those, and each maps to a capability that
 * genuinely exists (catalog, `zones` = hostel blocks, runner delivery with
 * order tracking).
 *
 * ONE primary action, not a wall of buttons. §5 asks for progressive
 * disclosure, and right now there is exactly one authentication method
 * that works: phone OTP. Google is not configured on the Supabase project
 * (there is no `[auth.external.google]` block at all) and passwords do not
 * exist in this auth model, so no button for either appears here. A button
 * that opens nothing is worse than no button. The layout leaves room for
 * a second method to slot in beneath the primary one when a real one
 * exists.
 */
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Screen } from "../../components/ui";

const PROMISES: { title: string; body: string }[] = [
  {
    title: "Your campus store",
    body: "Snacks, drinks, dairy and daily essentials from the store on campus.",
  },
  {
    title: "Brought to your block",
    body: "Delivered to your hostel block by a Craavee runner.",
  },
  {
    title: "Watch it arrive",
    body: "Follow your order from packed to picked up to handed over.",
  },
];

export default function WelcomeScreen() {
  return (
    <Screen edges={["top", "bottom"]}>
      {/* `justify-center` on the upper block, not `pt-8` with
          `justify-between`: pinning content to the top on a 2800px phone
          left a dead third of the screen in the middle. The content now
          sits optically centred with the action anchored at the bottom
          where the thumb is. */}
      <View className="flex-1 py-4">
        <View className="flex-1 justify-center">
          {/* The wordmark carries the brand; there is no logo asset in the
              repo and inventing one here would be a design decision made
              in the wrong place. */}
          <Text className="text-4xl font-bold text-brand-deep" accessibilityRole="header">
            Craavee
          </Text>
          <Text className="mt-2 text-base leading-6 text-inkdeep/60">
            The campus shop, delivered to your door.
          </Text>

          <View className="mt-9 gap-7">
            {PROMISES.map((p) => (
              <View key={p.title} className="flex-row">
                {/* A rule rather than an icon: there is no icon set in the
                    app, and three invented glyphs would be decoration
                    pretending to be information. */}
                <View className="mr-4 w-1 rounded-full bg-brand/25" />
                <View className="flex-1">
                  <Text className="text-[15px] font-semibold text-inkdeep">{p.title}</Text>
                  <Text className="mt-1 text-sm leading-5 text-inkdeep/55">{p.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View>
          <Link href="/(auth)/phone" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue with phone"
              accessibilityHint="Sign in or create an account with your phone number"
              testID="welcome-continue-phone"
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
              className="min-h-[56px] items-center justify-center rounded-2xl bg-brand"
            >
              <Text className="text-base font-bold text-white">Continue with phone</Text>
            </Pressable>
          </Link>

          {/*
            Deliberately no "Continue with Google" and no "Sign in with
            password". Neither is configured or supported in this auth
            model, and a control that cannot work is worse than its
            absence. When Google is configured on the Supabase project, it
            belongs directly beneath this button.
          */}

          <Text className="mt-4 text-center text-xs leading-4 text-inkdeep/45">
            We'll send a one-time code to verify your number.
          </Text>
        </View>
      </View>
    </Screen>
  );
}
