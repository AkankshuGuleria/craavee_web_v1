import { ActivityIndicator, View, Text } from "react-native";

/**
 * Minimal loading state, shared by both route groups while their real
 * screens (catalog, order tracking, runner job feed, etc.) don't exist yet.
 */
export function LoadingScreen({ label }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-paper">
      <ActivityIndicator size="large" color="#178A50" />
      {label ? <Text className="mt-3 text-inkdeep">{label}</Text> : null}
    </View>
  );
}
