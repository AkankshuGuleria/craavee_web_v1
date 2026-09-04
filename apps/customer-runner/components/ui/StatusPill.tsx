/**
 * Order status, rendered the same way everywhere.
 *
 * The tone mapping lives here rather than in each screen so "what colour
 * is delivery_failed" has one answer. It mirrors the Console's
 * `statusTone` grouping (live / done / attention / dead) rather than
 * inventing a second vocabulary for the same nine states.
 */
import { Text, View } from "react-native";
import { theme, radius, space } from "../../lib/theme";

type Tone = "live" | "done" | "attention" | "dead";

const TONE: Record<Tone, { fg: string; bg: string }> = {
  live: { fg: theme.brand, bg: theme.brandSoft },
  done: { fg: theme.success, bg: theme.successSoft },
  attention: { fg: theme.warning, bg: theme.warningSoft },
  dead: { fg: theme.danger, bg: theme.dangerSoft },
};

export function statusTone(status: string): Tone {
  switch (status) {
    case "delivered": return "done";
    case "delivery_failed": return "attention";
    case "cancelled":
    case "payment_failed": return "dead";
    default: return "live";
  }
}

const LABEL: Record<string, string> = {
  created: "Awaiting payment",
  confirmed: "Confirmed",
  packed: "Packed",
  assigned: "Runner assigned",
  picked_up: "On the way",
  delivered: "Delivered",
  delivery_failed: "Delivery failed",
  cancelled: "Cancelled",
  payment_failed: "Payment failed",
};

export function StatusPill({ status, testID }: { status: string; testID?: string }) {
  const tone = TONE[statusTone(status)];
  const label = LABEL[status] ?? status;
  return (
    <View
      testID={testID}
      // Read as one phrase rather than a bare word with no context.
      accessibilityRole="text"
      accessibilityLabel={`Order status: ${label}`}
      style={{
        alignSelf: "flex-start", paddingHorizontal: space.md, paddingVertical: space.xs,
        borderRadius: radius.full, backgroundColor: tone.bg,
      }}
    >
      <Text style={{ color: tone.fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
