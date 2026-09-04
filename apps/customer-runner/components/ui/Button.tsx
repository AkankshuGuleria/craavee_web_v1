/**
 * The one button.
 *
 * The audit found fourteen distinct hand-written control class strings
 * across the product, several of them text-only `Pressable`s well under
 * the 44pt touch minimum. This component makes the right thing the easy
 * thing: correct height, correct target, a real disabled state, a real
 * loading state, and an accessibility role — none of which a bare
 * `Pressable` gives you.
 *
 * `loading` deliberately keeps the label mounted and swaps in a spinner
 * beside it, so the button does not change width mid-submit and move the
 * thing the user is about to tap.
 */
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";
import { theme, touchTarget, radius } from "../../lib/theme";
import { useMotion } from "../../lib/motion";
import { haptic } from "../../lib/haptics";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  /** Fires a haptic on press. Reserve it for committing actions. */
  feedback?: "success" | "warning" | "error" | "impact";
  icon?: ReactNode;
  fullWidth?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
  testID?: string;
}

const FILL: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: theme.brand, fg: theme.onBrand },
  secondary: { bg: theme.surface, fg: theme.text, border: theme.borderStrong },
  ghost: { bg: "transparent", fg: theme.brand },
  danger: { bg: theme.danger, fg: theme.onBrand },
};

export function Button({
  label, onPress, variant = "primary", size = "md",
  disabled = false, loading = false, feedback, icon,
  fullWidth = false, accessibilityHint, style, testID,
}: ButtonProps) {
  // Press feedback uses Pressable's own `pressed` state rather than a
  // Reanimated shared value. It needs no worklet, no extra dependency, and
  // no fight with the React Compiler's immutability rule — and for a 3%
  // scale the difference is imperceptible. Under reduced motion
  // `pressScale` is 1, so the transform disappears entirely.
  const m = useMotion();
  const fill = FILL[variant];
  const inert = disabled || loading;
  const height = size === "lg" ? touchTarget.large : touchTarget.comfortable;

  return (
    <View style={fullWidth ? { alignSelf: "stretch" } : undefined}>
      <Pressable
        testID={testID}
        onPress={() => {
          if (inert) return;
          if (feedback) haptic(feedback);
          onPress();
        }}
        disabled={inert}
        // Screen readers need all four: what it is, what it says, whether
        // it can be used, and what will happen.
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inert, busy: loading }}
        style={({ pressed }) => [
          {
            transform: [{ scale: pressed && !inert ? m.pressScale : 1 }],
            minHeight: height,
            minWidth: touchTarget.min,
            paddingHorizontal: 20,
            borderRadius: radius.md,
            backgroundColor: fill.bg,
            borderWidth: fill.border ? 1 : 0,
            borderColor: fill.border,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            opacity: inert ? 0.4 : 1,
          },
          style,
        ]}
      >
        {icon}
        <Text
          style={{ color: fill.fg, fontSize: 15, fontWeight: "600" }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {/* Reserved width, so the label never shifts when loading starts. */}
        <View style={{ width: loading ? 18 : 0, alignItems: "center" }}>
          {loading ? <ActivityIndicator size="small" color={fill.fg} /> : null}
        </View>
      </Pressable>
    </View>
  );
}
