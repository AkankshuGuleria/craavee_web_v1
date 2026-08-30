import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View className="flex-1 items-center justify-center gap-3 bg-paper px-6">
        <Text className="text-lg font-semibold text-inkdeep">
          This screen doesn't exist.
        </Text>
        <Link href="/" className="text-brand underline">
          Go to home
        </Link>
      </View>
    </>
  );
}
