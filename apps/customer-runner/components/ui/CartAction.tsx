/**
 * The Add ⇄ quantity control, as one component with a transition between
 * its two states.
 *
 * WHY THIS EXISTS. Previously `ProductCard` swapped an "Add" button for a
 * `QtyStepper` by a bare conditional. Functionally correct, and it made
 * the most frequent interaction in the whole product — adding something to
 * a cart — feel like a screen glitch: one control vanished and a different
 * one appeared in its place. The commerce apps that feel fast are not
 * faster over the network; they make the state change *visible* as a
 * change rather than a replacement.
 *
 * Nothing here waits on the network, because nothing here needs to. The
 * cart is local Zustand state (server-authoritative at checkout, per D7),
 * so the transition is honest: it reflects a change that has genuinely
 * already happened. **This is not optimistic UI** — there is no server
 * round trip to be optimistic about, and no money claim is being made.
 *
 * Motion is RN's `Animated` rather than Reanimated. Reanimated is present
 * but unused, and the React Compiler's `react-hooks/immutability` rule
 * rejects `sharedValue.value = ...` assignments; the project's standing
 * decision is to use the platform primitive rather than suppress a
 * correctness rule. A single opacity/scale interpolation does not need a
 * worklet.
 *
 * Reduced motion is honoured through `useMotion()`, which collapses
 * durations to 1ms — the transition still *completes* deterministically
 * rather than being skipped mid-flight.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";

import { haptic } from "../../lib/haptics";
import { useMotion } from "../../lib/motion";
import { QtyStepper } from "./QtyStepper";

export function CartAction({
  qty,
  productName,
  onAdd,
  onIncrement,
  onDecrement,
  testIDPrefix,
}: {
  qty: number;
  productName: string;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  testIDPrefix?: string;
}) {
  const { fast, reduced } = useMotion();
  const inCart = qty > 0;

  // 0 = showing "Add", 1 = showing the stepper.
  //
  // `useState` with a lazy initialiser rather than `useRef(...).current`:
  // the React Compiler's `react-hooks/refs` rule forbids reading a ref
  // during render, and the interpolations below do exactly that. This
  // creates the value once and is legal to read while rendering - the same
  // resolution the project chose for Reanimated: fix the pattern rather
  // than suppress a correctness rule.
  const [progress] = useState(() => new Animated.Value(inCart ? 1 : 0));
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      // Skip the animation on first render: a grid of tiles animating
      // themselves into existence on scroll is noise, not feedback.
      mounted.current = true;
      progress.setValue(inCart ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: inCart ? 1 : 0,
      duration: fast,
      useNativeDriver: true,
    }).start();
  }, [inCart, fast, progress]);

  // The two controls cross-fade in place. Both are laid out in the same
  // cell so the tile's height never changes - a shifting row on add is the
  // exact jank this component exists to remove.
  const addStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [
      {
        scale: reduced
          ? 1
          : progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }),
      },
    ],
  };

  const stepperStyle = {
    opacity: progress,
    transform: [
      {
        scale: reduced
          ? 1
          : progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
      },
    ],
  };

  return (
    <View>
      {/* The stepper is the layout-defining child; "Add" is absolutely
          positioned over it, so the row is always the taller of the two and
          swapping between them cannot move anything. */}
      <Animated.View style={stepperStyle} pointerEvents={inCart ? "auto" : "none"}>
        <QtyStepper
          qty={Math.max(qty, 1)}
          productName={productName}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
          testIDPrefix={testIDPrefix}
        />
      </Animated.View>

      <Animated.View
        style={[{ position: "absolute", left: 0, top: 0 }, addStyle]}
        pointerEvents={inCart ? "none" : "auto"}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${productName} to cart`}
          // Hidden from assistive tech once the stepper is live, so a
          // screen reader never offers both controls for the same product.
          accessibilityElementsHidden={inCart}
          importantForAccessibility={inCart ? "no-hide-descendants" : "yes"}
          hitSlop={8}
          onPress={() => {
            haptic("success");
            onAdd();
          }}
          testID={testIDPrefix ? `add-${testIDPrefix}` : undefined}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          className="self-start rounded-full border border-brand/30 bg-brand/10 px-5 py-1.5"
        >
          <Text className="text-sm font-bold text-brand">Add</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
