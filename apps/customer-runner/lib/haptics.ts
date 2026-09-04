/**
 * Semantic haptics.
 *
 * `expo-haptics` has been a dependency since Phase 2B with zero call
 * sites. The reason to add it now is not that taps should buzz — it is
 * that this product is used one-handed, outdoors, often without looking
 * closely at the screen. A runner confirming a delivery code and a
 * customer watching an order total change both benefit from a physical
 * acknowledgement.
 *
 * The API is deliberately semantic (`success`, `error`) rather than
 * physical (`heavy`, `light`). A screen should say what happened; this
 * module decides how that feels, so the vocabulary stays consistent and
 * can be tuned in one place.
 *
 * RULES
 *   * Never on navigation, scrolling, or an ordinary button. Haptics on
 *     everything is the same as haptics on nothing.
 *   * Only on: a committed state change, a destructive confirmation, a
 *     rejection the user must notice, and discrete selection.
 *   * Never required for correctness. Every call is fire-and-forget and
 *     swallows failure — a device with the Taptic Engine disabled, or a
 *     simulator, must behave identically.
 */
import * as Haptics from "expo-haptics";

type Feedback = "selection" | "success" | "warning" | "error" | "impact";

/** Fire-and-forget. Never awaited by a caller, never throws. */
export function haptic(kind: Feedback): void {
  try {
    switch (kind) {
      case "selection":
        void Haptics.selectionAsync();
        break;
      case "success":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case "warning":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case "error":
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      case "impact":
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
    }
  } catch {
    // A simulator, a device with haptics off, or a platform without a
    // Taptic Engine. None of these is a failure worth surfacing.
  }
}
