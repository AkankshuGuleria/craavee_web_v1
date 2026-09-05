/**
 * The order timeline.
 *
 * A vertical rail of steps with a connecting line. Every time shown is a
 * real recorded timestamp; a step with no timestamp shows no time rather
 * than an estimate.
 *
 * Progress is communicated three ways, not one: the marker fill, the text
 * weight, and — for the current step — the word "Now". A customer who
 * cannot distinguish the brand green from the muted grey still knows
 * where the order is.
 */
import { Text, View } from "react-native";

import type { TimelineStep } from "../../lib/orders/timeline";
import { theme } from "../../lib/theme";

function clockTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

export function OrderTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel="Order progress"
      testID="order-timeline"
    >
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const done = step.state === "done" || step.state === "current";
        const failed = step.state === "failed";

        const markerColor = failed ? theme.accent : done ? theme.brand : theme.border;
        const time = clockTime(step.at);

        return (
          <View
            key={step.key}
            className="flex-row"
            accessibilityLabel={`${step.label}${
              step.state === "current" ? ", current step" : step.state === "done" ? ", completed" : step.state === "failed" ? ", failed" : ", pending"
            }${time ? `, at ${time}` : ""}`}
          >
            {/* Rail: marker plus the connector to the next step. */}
            <View className="w-6 items-center">
              <View
                style={{
                  width: step.state === "current" ? 14 : 10,
                  height: step.state === "current" ? 14 : 10,
                  borderRadius: 999,
                  backgroundColor: markerColor,
                  marginTop: 4,
                }}
              />
              {!last ? (
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    minHeight: 28,
                    backgroundColor: done ? theme.brand : theme.border,
                    opacity: done ? 0.35 : 1,
                  }}
                />
              ) : null}
            </View>

            <View className={`flex-1 pb-5 pl-3 ${last ? "pb-0" : ""}`}>
              <View className="flex-row items-baseline justify-between">
                <Text
                  className={`flex-1 text-[15px] ${
                    failed
                      ? "font-bold text-mango"
                      : step.state === "current"
                        ? "font-bold text-inkdeep"
                        : done
                          ? "font-semibold text-inkdeep/80"
                          : "text-inkdeep/40"
                  }`}
                >
                  {step.label}
                </Text>
                {time ? (
                  <Text className="shrink-0 pl-2 pr-1 text-xs text-inkdeep/45">{time}</Text>
                ) : step.state === "current" ? (
                  // Not a colour cue: the word itself says where we are.
                  <Text className="shrink-0 pl-2 pr-1 text-xs font-semibold text-brand">Now</Text>
                ) : null}
              </View>
              <Text
                className={`mt-0.5 text-xs leading-4 ${
                  step.state === "pending" ? "text-inkdeep/30" : "text-inkdeep/55"
                }`}
              >
                {step.hint}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
